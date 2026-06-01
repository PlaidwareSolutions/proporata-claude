// Task #65: Board Meetings, Agendas, Minutes — REST routes.
//
// Mounted under `/api`. Reads are open to manager-or-board; writes are
// gated to manager-or-board. Quorum is computed from attendance and used
// to gate finalization of meeting-bound motions (see motions.ts).

import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { db } from "@workspace/db";
import {
  meetingsTable,
  meetingAgendaItemsTable,
  meetingAttendanceTable,
  motionsTable,
  motionVotesTable,
  usersTable,
  organizationSettingsTable,
  type MotionVotingRule,
} from "@workspace/db/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { authenticateJwt, requireManagerOrBoardMember, verifyToken } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { buildCurrentSignatureBlockLines } from "../lib/signatureBlock.js";
import { sendEmail, buildGovernanceEmail } from "../lib/email.js";
import {
  publishNotice,
  notifyOwners,
  onMinutesAdoptedForOwners,
} from "../lib/governance.js";
import {
  notifyMeetingNotice,
  notifyMinutesAdopted,
  verifyMeetingDocToken,
} from "../lib/notificationService.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { materializeMeeting, removeMeeting } from "../lib/calendarMaterialize.js";
import { describeRule, evaluateMotion } from "../lib/motions.js";
import { randomBytes } from "crypto";

const storage = new ObjectStorageService();
const router: IRouter = Router();

function nowISO(): string { return new Date().toISOString(); }

const VALID_KINDS = new Set(["open", "executive", "annual"]);
const VALID_STATUSES = new Set(["scheduled", "in_progress", "adjourned", "cancelled"]);
const VALID_ITEM_KINDS = new Set(["discussion", "motion", "report", "break"]);
const VALID_ATTENDANCE = new Set(["present", "remote", "absent", "excused"]);

async function loadOrgSettings() {
  const [row] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  return row ?? null;
}

async function loadBoardMembers() {
  return db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(and(eq(usersTable.boardMember, true), eq(usersTable.pending, false)));
}

interface QuorumState {
  required: number;
  attending: number;
  met: boolean;
  boardSize: number;
  mode: string;
  percentBp: number;
}

export async function computeQuorum(meetingId: number): Promise<QuorumState> {
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, meetingId));
  const board = await loadBoardMembers();
  const boardSize = board.length;
  const org = await loadOrgSettings();
  const mode = meeting?.quorumMode ?? org?.meetingQuorumMode ?? "majority";
  const percentBp = meeting?.quorumPercentBp ?? org?.meetingQuorumPercentBp ?? 5000;

  let required: number;
  if (mode === "percent") {
    required = Math.max(1, Math.ceil((boardSize * percentBp) / 10000));
  } else if (mode === "all") {
    required = boardSize;
  } else {
    // "majority" default
    required = boardSize > 0 ? Math.floor(boardSize / 2) + 1 : 0;
  }

  const att = await db.select().from(meetingAttendanceTable).where(eq(meetingAttendanceTable.meetingId, meetingId));
  const boardIds = new Set(board.map((b) => b.id));
  const attending = att.filter((a) => boardIds.has(a.userId) && (a.status === "present" || a.status === "remote")).length;
  return { required, attending, met: attending >= required && boardSize > 0, boardSize, mode, percentBp };
}

async function buildMeetingDetail(id: number) {
  const [m] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!m) return null;
  const items = await db.select().from(meetingAgendaItemsTable)
    .where(eq(meetingAgendaItemsTable.meetingId, id))
    .orderBy(asc(meetingAgendaItemsTable.sortOrder), asc(meetingAgendaItemsTable.id));
  const attendance = await db.select().from(meetingAttendanceTable).where(eq(meetingAttendanceTable.meetingId, id));

  // Hydrate motion summaries for any agenda items that link to a motion.
  const motionIds = items.map((i) => i.motionId).filter((x): x is number => x != null);
  const motions = motionIds.length
    ? await db.select().from(motionsTable).where(inArray(motionsTable.id, motionIds))
    : [];
  const motionVotes = motionIds.length
    ? await db.select().from(motionVotesTable).where(inArray(motionVotesTable.motionId, motionIds))
    : [];
  const board = await loadBoardMembers();
  const motionMap: Record<number, unknown> = {};
  for (const mt of motions) {
    const votes = motionVotes.filter((v) => v.motionId === mt.id);
    const ev = evaluateMotion(mt.votingRule as MotionVotingRule, votes, board.length);
    motionMap[mt.id] = {
      id: mt.id, kind: mt.kind, title: mt.title, status: mt.status, outcome: mt.outcome,
      votingRule: mt.votingRule, votingRuleDescription: describeRule(mt.votingRule as MotionVotingRule),
      tally: ev.tally, needed: ev.needed, finalizable: ev.finalizable,
    };
  }

  const quorum = await computeQuorum(id);
  const org = await loadOrgSettings();
  const noticeDays = m.kind === "annual"
    ? (org?.meetingNoticeAnnualDays ?? 30)
    : m.kind === "executive"
      ? (org?.meetingNoticeExecutiveDays ?? 2)
      : (org?.meetingNoticeOpenDays ?? 3);
  const requiredNoticeBy = new Date(m.scheduledAt);
  requiredNoticeBy.setDate(requiredNoticeBy.getDate() - noticeDays);
  const noticeOk = m.noticePostedAt
    ? new Date(m.noticePostedAt).getTime() <= requiredNoticeBy.getTime()
    : false;

  return {
    id: m.id, kind: m.kind, title: m.title, scheduledAt: m.scheduledAt,
    durationMinutes: m.durationMinutes,
    locationPhysical: m.locationPhysical, locationVideoLink: m.locationVideoLink,
    noticeText: m.noticeText, noticePostedAt: m.noticePostedAt,
    noticeRequiredDays: noticeDays, noticeOk,
    status: m.status, startedAt: m.startedAt, adjournedAt: m.adjournedAt,
    minutesContent: m.minutesContent, minutesStatus: m.minutesStatus,
    minutesAdoptionMotionId: m.minutesAdoptionMotionId,
    minutesAdoptedAt: m.minutesAdoptedAt,
    createdByName: m.createdByName, createdAt: m.createdAt,
    quorum,
    agenda: items.map((it) => ({
      id: it.id, sortOrder: it.sortOrder, kind: it.kind, title: it.title,
      notes: it.notes, motionId: it.motionId, presenter: it.presenter,
      itemMinutes: it.itemMinutes,
      closedSession: it.closedSession ?? false,
      motion: it.motionId ? motionMap[it.motionId] ?? null : null,
    })),
    attendance: attendance.map((a) => ({
      id: a.id, userId: a.userId, userName: a.userName,
      status: a.status, isBoardMember: a.isBoardMember, recordedAt: a.recordedAt,
    })),
  };
}

// ── List meetings ────────────────────────────────────────────────────────
router.get("/meetings", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const status = (req.query.status as string | undefined)?.toLowerCase();
  const where = [];
  if (status && status !== "all") where.push(eq(meetingsTable.status, status));
  const rows = await db.select().from(meetingsTable)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(meetingsTable.scheduledAt));
  const out = await Promise.all(rows.map(async (m) => {
    const q = await computeQuorum(m.id);
    return {
      id: m.id, kind: m.kind, title: m.title, scheduledAt: m.scheduledAt,
      status: m.status, minutesStatus: m.minutesStatus,
      durationMinutes: m.durationMinutes,
      locationPhysical: m.locationPhysical, locationVideoLink: m.locationVideoLink,
      noticePostedAt: m.noticePostedAt,
      quorum: q,
      createdByName: m.createdByName, createdAt: m.createdAt,
    };
  }));
  res.json(out);
});

// ── Get one ──────────────────────────────────────────────────────────────
router.get("/meetings/:id", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const detail = await buildMeetingDetail(id);
  if (!detail) { res.status(404).json({ error: "Not found" }); return; }
  res.json(detail);
});

// ── Create ───────────────────────────────────────────────────────────────
router.post("/meetings", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const body = req.body as {
    kind?: string; title?: string; scheduledAt?: string; durationMinutes?: number;
    locationPhysical?: string | null; locationVideoLink?: string | null;
    noticeText?: string;
  };
  const kind = body.kind ?? "open";
  if (!VALID_KINDS.has(kind)) { res.status(400).json({ error: "Invalid meeting kind" }); return; }
  const title = body.title?.trim();
  if (!title) { res.status(400).json({ error: "title required" }); return; }
  if (!body.scheduledAt) { res.status(400).json({ error: "scheduledAt required" }); return; }
  const [row] = await db.insert(meetingsTable).values({
    kind,
    title,
    scheduledAt: body.scheduledAt,
    durationMinutes: typeof body.durationMinutes === "number" ? Math.max(15, Math.floor(body.durationMinutes)) : 60,
    locationPhysical: body.locationPhysical ?? null,
    locationVideoLink: body.locationVideoLink ?? null,
    noticeText: body.noticeText ?? "",
    createdByUserId: req.user!.id,
    createdByName: req.user!.name || req.user!.email,
    createdAt: nowISO(),
  }).returning();
  // Task #75: materialize calendar event for the new meeting + earliest-legal-date marker.
  const orgRow = await loadOrgSettings();
  await materializeMeeting(row!, {
    open: orgRow?.meetingNoticeOpenDays ?? 3,
    executive: orgRow?.meetingNoticeExecutiveDays ?? 2,
    annual: orgRow?.meetingNoticeAnnualDays ?? 30,
  });
  res.status(201).json({ id: row!.id });
});

// ── Update ───────────────────────────────────────────────────────────────
router.patch("/meetings/:id", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [m] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (typeof body.kind === "string" && VALID_KINDS.has(body.kind)) patch.kind = body.kind;
  if (typeof body.scheduledAt === "string") patch.scheduledAt = body.scheduledAt;
  if (typeof body.durationMinutes === "number") patch.durationMinutes = Math.max(15, Math.floor(body.durationMinutes));
  if ("locationPhysical" in body) patch.locationPhysical = body.locationPhysical === null ? null : String(body.locationPhysical);
  if ("locationVideoLink" in body) patch.locationVideoLink = body.locationVideoLink === null ? null : String(body.locationVideoLink);
  if (typeof body.noticeText === "string") patch.noticeText = body.noticeText;
  if (typeof body.minutesContent === "string") patch.minutesContent = body.minutesContent;
  if (typeof body.quorumMode === "string" && ["majority", "percent", "all"].includes(body.quorumMode)) patch.quorumMode = body.quorumMode;
  if (typeof body.quorumPercentBp === "number") patch.quorumPercentBp = Math.max(0, Math.min(10000, Math.floor(body.quorumPercentBp)));
  if (typeof body.status === "string" && VALID_STATUSES.has(body.status)) patch.status = body.status;
  if (Object.keys(patch).length === 0) { res.json(await buildMeetingDetail(id)); return; }
  await db.update(meetingsTable).set(patch).where(eq(meetingsTable.id, id));
  // Task #75: re-materialize calendar event after edit.
  const [m2] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (m2) {
    const orgRow = await loadOrgSettings();
    await materializeMeeting(m2, {
      open: orgRow?.meetingNoticeOpenDays ?? 3,
      executive: orgRow?.meetingNoticeExecutiveDays ?? 2,
      annual: orgRow?.meetingNoticeAnnualDays ?? 30,
    });
  }
  res.json(await buildMeetingDetail(id));
});

// ── Delete (only if scheduled) ───────────────────────────────────────────
router.delete("/meetings/:id", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [m] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  if (m.status !== "scheduled" && m.status !== "cancelled") {
    res.status(409).json({ error: `Cannot delete a meeting in status ${m.status}` }); return;
  }
  await db.delete(meetingsTable).where(eq(meetingsTable.id, id));
  await removeMeeting(id);
  res.status(204).send();
});

// ── Post notice ──────────────────────────────────────────────────────────
router.post("/meetings/:id/notice", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [m] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!m) { res.status(404).json({ error: "Not found" }); return; }

  const postedAt = nowISO();
  await db.update(meetingsTable).set({ noticePostedAt: postedAt }).where(eq(meetingsTable.id, id));

  // Task #75: re-materialize so the "Notice posted" marker appears on calendar.
  const [m3] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (m3) {
    const orgRow0 = await loadOrgSettings();
    await materializeMeeting(m3, {
      open: orgRow0?.meetingNoticeOpenDays ?? 3,
      executive: orgRow0?.meetingNoticeExecutiveDays ?? 2,
      annual: orgRow0?.meetingNoticeAnnualDays ?? 30,
    });
  }

  // Notify all members (residents + board + managers) — in-app + email,
  // respecting per-user announcementsEmail pref and 10pm–7am quiet hours.
  try {
    await notifyMeetingNotice({
      id,
      title: m.title,
      kind: m.kind,
      scheduledAt: m.scheduledAt,
      locationPhysical: m.locationPhysical,
      locationVideoLink: m.locationVideoLink,
      noticeText: m.noticeText || "",
    });
  } catch (err) { logger.warn({ err }, "meeting notice notify failed"); }

  // Task #66: post a public Notice for owners + notify all owner residents
  // (executive sessions still notify owners that *a* meeting is scheduled,
  // but the agenda detail and minutes remain restricted).
  try {
    const orgRow = await loadOrgSettings();
    const noticeDays = m.kind === "annual"
      ? (orgRow?.meetingNoticeAnnualDays ?? 30)
      : m.kind === "executive"
        ? (orgRow?.meetingNoticeExecutiveDays ?? 2)
        : (orgRow?.meetingNoticeOpenDays ?? 3);
    const whenStr = new Date(m.scheduledAt).toLocaleString();
    await publishNotice({
      kind: "meeting_scheduled",
      title: `${m.kind === "executive" ? "Executive session" : m.kind === "annual" ? "Annual meeting" : "Board meeting"}: ${m.title}`,
      body: m.noticeText || "",
      sourceType: "meeting",
      sourceId: m.id,
      meetingId: m.id,
      requiredWindowDays: noticeDays,
      postedAt,
    });
    // Agenda packet is now considered "published" once notice is posted.
    await publishNotice({
      kind: "agenda_published",
      title: `Agenda published: ${m.title}`,
      body: m.noticeText || "",
      sourceType: "meeting",
      sourceId: m.id,
      meetingId: m.id,
      postedAt,
    });
    await notifyOwners({
      type: "meeting_scheduled",
      title: `Meeting scheduled: ${m.title}`,
      message: `A board meeting "${m.title}" is scheduled for ${whenStr}.`,
      entityType: "meeting",
      entityId: m.id,
      emailIntro: `A board meeting "${m.title}" is scheduled for ${whenStr}. Notice and agenda are available in the resident portal.`,
      emailDetail: m.noticeText || undefined,
    });
    await notifyOwners({
      type: "agenda_published",
      title: `Agenda published: ${m.title}`,
      message: `The agenda for "${m.title}" has been published.`,
      entityType: "meeting",
      entityId: m.id,
    });
    void buildGovernanceEmail; // referenced via notifyOwners helper
  } catch (err) { logger.warn({ err }, "owner-side meeting notice publish failed"); }
  res.json(await buildMeetingDetail(id));
});

// ── Agenda items ─────────────────────────────────────────────────────────
router.post("/meetings/:id/agenda", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as { kind?: string; title?: string; notes?: string; motionId?: number; presenter?: string };
  const title = body.title?.trim();
  if (!title) { res.status(400).json({ error: "title required" }); return; }
  const kind = body.kind && VALID_ITEM_KINDS.has(body.kind) ? body.kind : "discussion";
  const existing = await db.select().from(meetingAgendaItemsTable).where(eq(meetingAgendaItemsTable.meetingId, id));
  const sortOrder = existing.length === 0 ? 0 : Math.max(...existing.map((i) => i.sortOrder)) + 1;
  const [row] = await db.insert(meetingAgendaItemsTable).values({
    meetingId: id, sortOrder, kind, title,
    notes: body.notes ?? null,
    motionId: typeof body.motionId === "number" ? body.motionId : null,
    presenter: body.presenter ?? null,
  }).returning();
  // If linking to a motion, set its meetingId so quorum gating applies.
  if (typeof body.motionId === "number") {
    await db.update(motionsTable).set({ meetingId: id }).where(eq(motionsTable.id, body.motionId));
  }
  res.status(201).json({ id: row!.id });
});

router.patch("/meetings/:id/agenda/:itemId", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  if (!Number.isFinite(id) || !Number.isFinite(itemId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (typeof body.kind === "string" && VALID_ITEM_KINDS.has(body.kind)) patch.kind = body.kind;
  if ("notes" in body) patch.notes = body.notes === null ? null : String(body.notes);
  if ("presenter" in body) patch.presenter = body.presenter === null ? null : String(body.presenter);
  if ("motionId" in body) patch.motionId = typeof body.motionId === "number" ? body.motionId : null;
  if (typeof body.itemMinutes === "string") patch.itemMinutes = body.itemMinutes;
  if (typeof body.closedSession === "boolean") patch.closedSession = body.closedSession;
  if (typeof body.sortOrder === "number") patch.sortOrder = Math.floor(body.sortOrder);
  if (Object.keys(patch).length === 0) { res.json({ ok: true }); return; }
  await db.update(meetingAgendaItemsTable).set(patch)
    .where(and(eq(meetingAgendaItemsTable.id, itemId), eq(meetingAgendaItemsTable.meetingId, id)));
  if (typeof body.motionId === "number") {
    await db.update(motionsTable).set({ meetingId: id }).where(eq(motionsTable.id, body.motionId));
  }
  res.json({ ok: true });
});

router.delete("/meetings/:id/agenda/:itemId", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  if (!Number.isFinite(id) || !Number.isFinite(itemId)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(meetingAgendaItemsTable)
    .where(and(eq(meetingAgendaItemsTable.id, itemId), eq(meetingAgendaItemsTable.meetingId, id)));
  res.status(204).send();
});

router.post("/meetings/:id/agenda/reorder", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as { itemIds?: number[] };
  if (!Array.isArray(body.itemIds)) { res.status(400).json({ error: "itemIds[] required" }); return; }
  for (let i = 0; i < body.itemIds.length; i++) {
    await db.update(meetingAgendaItemsTable).set({ sortOrder: i })
      .where(and(eq(meetingAgendaItemsTable.id, body.itemIds[i]!), eq(meetingAgendaItemsTable.meetingId, id)));
  }
  res.json({ ok: true });
});

// ── Attendance ───────────────────────────────────────────────────────────
router.post("/meetings/:id/attendance", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as { userId?: number; status?: string };
  if (typeof body.userId !== "number" || !body.status || !VALID_ATTENDANCE.has(body.status)) {
    res.status(400).json({ error: "userId and status required" }); return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, body.userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const [existing] = await db.select().from(meetingAttendanceTable)
    .where(and(eq(meetingAttendanceTable.meetingId, id), eq(meetingAttendanceTable.userId, body.userId)));
  if (existing) {
    await db.update(meetingAttendanceTable).set({
      status: body.status, recordedAt: nowISO(),
    }).where(eq(meetingAttendanceTable.id, existing.id));
  } else {
    await db.insert(meetingAttendanceTable).values({
      meetingId: id, userId: body.userId,
      userName: user.name || user.email,
      status: body.status,
      isBoardMember: !!user.boardMember,
      recordedAt: nowISO(),
    });
  }
  res.json({ ok: true, quorum: await computeQuorum(id) });
});

// ── Lifecycle: start / adjourn ───────────────────────────────────────────
router.post("/meetings/:id/start", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [m] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  if (m.status !== "scheduled") { res.status(409).json({ error: `Cannot start meeting in status ${m.status}` }); return; }
  await db.update(meetingsTable).set({ status: "in_progress", startedAt: nowISO() }).where(eq(meetingsTable.id, id));
  res.json({ ok: true });
});

router.post("/meetings/:id/adjourn", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [m] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  if (m.status !== "in_progress") { res.status(409).json({ error: `Cannot adjourn meeting in status ${m.status}` }); return; }

  // Auto-generate a draft minutes blob from agenda + attendance + motions.
  const draft = await composeDraftMinutes(id);
  await db.update(meetingsTable).set({
    status: "adjourned", adjournedAt: nowISO(),
    minutesContent: m.minutesContent && m.minutesContent.trim() ? m.minutesContent : draft,
    minutesStatus: "draft",
  }).where(eq(meetingsTable.id, id));
  res.json({ ok: true });
});

async function composeDraftMinutes(id: number): Promise<string> {
  const detail = await buildMeetingDetail(id);
  if (!detail) return "";
  const lines: string[] = [];
  lines.push(`MINUTES — ${detail.title}`);
  lines.push(`Date/Time: ${detail.scheduledAt}`);
  lines.push(`Type: ${detail.kind}`);
  lines.push(`Location: ${detail.locationPhysical || detail.locationVideoLink || "—"}`);
  lines.push("");
  lines.push("Attendance:");
  for (const a of detail.attendance) lines.push(`  · ${a.userName} — ${a.status}${a.isBoardMember ? " (board)" : ""}`);
  lines.push(`Quorum: ${detail.quorum.attending}/${detail.quorum.required} (${detail.quorum.met ? "MET" : "NOT MET"})`);
  lines.push("");
  lines.push("Agenda:");
  for (const it of detail.agenda) {
    lines.push(`  ${it.sortOrder + 1}. [${it.kind}] ${it.title}${it.presenter ? ` — ${it.presenter}` : ""}`);
    if (it.notes) lines.push(`     Notes: ${it.notes}`);
    if (it.motion) {
      const mt = it.motion as { id: number; title: string; status: string; outcome: string | null; tally: { approve: number; reject: number; abstain: number } };
      lines.push(`     Motion #M-${mt.id}: ${mt.title} — ${mt.status}${mt.outcome ? `/${mt.outcome}` : ""} (a:${mt.tally.approve} r:${mt.tally.reject} ab:${mt.tally.abstain})`);
    }
    if (it.itemMinutes) lines.push(`     Minutes: ${it.itemMinutes}`);
  }
  return lines.join("\n");
}

// ── Minutes draft / proposal ─────────────────────────────────────────────
router.post("/meetings/:id/minutes/propose", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [m] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body as { adoptionMeetingId?: number };
  if (typeof body.adoptionMeetingId !== "number") {
    res.status(400).json({ error: "adoptionMeetingId required" }); return;
  }
  const [next] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, body.adoptionMeetingId));
  if (!next) { res.status(404).json({ error: "Adoption meeting not found" }); return; }

  // Create a "majority" motion bound to the adoption meeting that, when
  // adopted, marks these minutes adopted.
  const created = nowISO();
  const [motion] = await db.insert(motionsTable).values({
    kind: "minutes_adoption",
    title: `Adopt minutes — ${m.title}`,
    body: m.minutesContent || "",
    votingRule: { type: "majority" },
    status: "open",
    openedAt: created,
    createdByUserId: req.user!.id,
    createdByName: req.user!.name || req.user!.email,
    createdAt: created,
    meetingId: body.adoptionMeetingId,
    payload: { sourceMeetingId: id },
  }).returning();

  // Add it as an agenda item on the adoption meeting.
  const existingItems = await db.select().from(meetingAgendaItemsTable).where(eq(meetingAgendaItemsTable.meetingId, body.adoptionMeetingId));
  const sortOrder = existingItems.length === 0 ? 0 : Math.max(...existingItems.map((i) => i.sortOrder)) + 1;
  await db.insert(meetingAgendaItemsTable).values({
    meetingId: body.adoptionMeetingId, sortOrder, kind: "motion",
    title: `Adopt minutes from ${m.title}`,
    motionId: motion!.id,
  });

  await db.update(meetingsTable).set({
    minutesStatus: "proposed", minutesAdoptionMotionId: motion!.id,
  }).where(eq(meetingsTable.id, id));
  res.json({ ok: true, motionId: motion!.id });
});

/**
 * Build the full adopted-minutes PDF (minutes body + signature block) for a
 * meeting. Returns null if the meeting / detail can't be loaded. Shared by
 * the snapshot-on-adopt path and the on-demand PDF route.
 */
async function buildAdoptedMinutesPdf(meetingId: number): Promise<Buffer | null> {
  const detail = await buildMeetingDetail(meetingId);
  if (!detail) return null;
  const orgRow = await loadOrgSettings();
  const minutesLines = buildMinutesLines(orgRow?.name ?? "HOA Hub", detail);
  const sigDate = (detail.minutesAdoptedAt ?? detail.scheduledAt).slice(0, 10);
  const signatureLines = await buildCurrentSignatureBlockLines(sigDate);
  for (const sl of signatureLines) minutesLines.push(sl);
  return buildPdf(minutesLines);
}

// Called by motions.ts when an adoption motion is adopted.
export async function markMinutesAdoptedByMotion(motionId: number): Promise<void> {
  const [m] = await db.select().from(meetingsTable).where(eq(meetingsTable.minutesAdoptionMotionId, motionId));
  if (!m) return;
  const adoptedAt = nowISO();
  await db.update(meetingsTable).set({
    minutesStatus: "adopted", minutesAdoptedAt: adoptedAt,
  }).where(eq(meetingsTable.id, m.id));

  // Snapshot the adopted minutes to object storage so the official PDF is
  // frozen at adoption time (mirrors onResolutionMotionAdopted in
  // lib/resolutions.ts). Subsequent /minutes.pdf requests stream this file.
  try {
    const pdf = await buildAdoptedMinutesPdf(m.id);
    if (pdf) {
      const uploadURL = await storage.getObjectEntityUploadURL();
      const objectPath = storage.normalizeObjectEntityPath(uploadURL);
      const put = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: pdf,
      });
      if (put.ok) {
        await db.update(meetingsTable)
          .set({ minutesStorageKey: objectPath })
          .where(eq(meetingsTable.id, m.id));
      } else {
        logger.warn({ status: put.status, meetingId: m.id }, "minutes PDF upload failed");
      }
    }
  } catch (err) {
    logger.error({ err, meetingId: m.id }, "minutes PDF snapshot failed (adoption still recorded)");
  }

  // Email + in-app notify all members that adopted minutes are available.
  try {
    await notifyMinutesAdopted({
      id: m.id,
      title: m.title,
      kind: m.kind,
      scheduledAt: m.scheduledAt,
      adoptedAt,
    });
  } catch (err) { logger.warn({ err, meetingId: m.id }, "minutes adopted notify failed"); }

  // Task #66: notify owners and publish a "minutes adopted" notice for the
  // *source* meeting whose minutes were just ratified.
  try { await onMinutesAdoptedForOwners(m.id); }
  catch (err) { logger.warn({ err, meetingId: m.id }, "owner-side minutes-adopted notify failed"); }
}

// ── PDFs ─────────────────────────────────────────────────────────────────
/** Dual-mode auth helper for meeting PDFs (agenda/minutes) */
async function resolvePdfAccess(req: Request, res: Response, doc: "agenda" | "minutes") {
  const meetingId = Number(req.params.id);
  if (!Number.isFinite(meetingId)) { res.status(400).json({ error: "Invalid id" }); return null; }

  const [m] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, meetingId));
  if (!m) { res.status(404).json({ error: "Not found" }); return null; }

  let userId: number | undefined;
  let isManagerOrBoard = false;

  // Mode 1: Standard staff cookie auth
  const cookieUser = await verifyToken(req.cookies.token);
  if (cookieUser) {
    userId = cookieUser.id;
    isManagerOrBoard = ["manager", "admin", "board"].includes(cookieUser.role);
  }

  // Mode 2: Scoped member token auth
  const token = req.query.token as string | undefined;
  if (!userId && token) {
    const payload = await verifyMeetingDocToken(token);
    if (payload && payload.meetingId === meetingId && payload.doc === doc) {
      userId = payload.userId;
      // Scoped tokens are for ordinary members; they don't get staff-level draft access.
    }
  }

  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return null; }

  // Executive sessions are strictly board-only, even with a token.
  if (m.kind === "executive" && !isManagerOrBoard) {
    // Check if user is on the board.
    const [u] = await db.select().from(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.boardMember, true)));
    if (!u) { res.status(403).json({ error: "Forbidden" }); return null; }
  }

  // Gating based on document status for non-staff.
  if (!isManagerOrBoard) {
    if (doc === "agenda" && !m.noticePostedAt) {
      res.status(403).json({ error: "Agenda packet not yet published" }); return null;
    }
    if (doc === "minutes" && m.minutesStatus !== "adopted") {
      res.status(403).json({ error: "Minutes not yet adopted" }); return null;
    }
  }

  const detail = await buildMeetingDetail(meetingId);
  return { m, detail };
}

router.get("/meetings/:id/agenda-packet.pdf", async (req, res) => {
  const access = await resolvePdfAccess(req, res, "agenda");
  if (!access) return;
  const { detail } = access;
  if (!detail) { res.status(404).json({ error: "Not found" }); return; }
  const orgRow = await loadOrgSettings();
  const pdf = buildPdf(buildAgendaPacketLines(orgRow?.name ?? "HOA Hub", detail));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="meeting-${detail.id}-agenda-packet.pdf"`);
  res.end(pdf);
});

router.get("/meetings/:id/minutes.pdf", async (req, res) => {
  const access = await resolvePdfAccess(req, res, "minutes");
  if (!access) return;
  const { m, detail } = access;
  if (!detail) { res.status(404).json({ error: "Not found" }); return; }

  // If a frozen snapshot exists (created when minutes were adopted), stream it
  // verbatim so the official document is byte-stable. Falls back to a live
  // render for historical meetings adopted before snapshotting was added, and
  // for staff previewing draft minutes.
  if (m.minutesStorageKey) {
    try {
      const file = await storage.getObjectEntityFile(m.minutesStorageKey);
      const response = await storage.downloadObject(file);
      if (response.status >= 200 && response.status < 300 && response.body) {
        res.status(response.status);
        response.headers.forEach((v, k) => res.setHeader(k, v));
        res.setHeader("Content-Disposition", `attachment; filename="meeting-${detail.id}-minutes.pdf"`);
        const node = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
        node.pipe(res);
        return;
      }
      logger.warn(
        { meetingId: detail.id, status: response.status, hasBody: !!response.body },
        "minutes snapshot non-2xx or empty body; rendering live",
      );
    } catch (err) {
      logger.warn({ err, meetingId: detail.id }, "minutes snapshot stream failed; rendering live");
    }
  }

  const pdf = await buildAdoptedMinutesPdf(detail.id);
  if (!pdf) { res.status(404).json({ error: "Not found" }); return; }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="meeting-${detail.id}-minutes.pdf"`);
  res.end(pdf);
});

// ── ICS calendar ─────────────────────────────────────────────────────────
router.get("/meetings/:id/ics", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [m] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  const orgRow = await loadOrgSettings();
  const ics = buildIcs([m], orgRow?.name ?? "HOA Hub");
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="meeting-${id}.ics"`);
  res.end(ics);
});

// Personal feed: GET /api/calendar/meetings.ics?token=...
router.get("/calendar/meetings.ics", async (req, res) => {
  const token = req.query.token as string | undefined;
  if (!token) { res.status(401).json({ error: "token required" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.icalFeedToken, token));
  if (!user) { res.status(401).json({ error: "Invalid token" }); return; }
  const rows = await db.select().from(meetingsTable).orderBy(asc(meetingsTable.scheduledAt));
  const orgRow = await loadOrgSettings();
  // Hide executive-session meetings from non-board users.
  const visible = rows.filter((m) => m.kind !== "executive" || user.boardMember);
  const ics = buildIcs(visible, orgRow?.name ?? "HOA Hub");
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.end(ics);
});

router.post("/me/ical-token", authenticateJwt, async (req, res) => {
  const userId = req.user!.id;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  let token = user.icalFeedToken;
  if (!token || (req.body as { rotate?: boolean })?.rotate) {
    token = randomBytes(24).toString("hex");
    await db.update(usersTable).set({ icalFeedToken: token }).where(eq(usersTable.id, userId));
  }
  res.json({ token, url: `/api/calendar/meetings.ics?token=${token}` });
});

// ── Helpers ──────────────────────────────────────────────────────────────
function icsEsc(s: string): string {
  return (s ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function icsDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "19700101T000000Z";
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
}

function buildIcs(meetings: Array<typeof meetingsTable.$inferSelect>, orgName: string): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${icsEsc(orgName)}//Meetings//EN`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const m of meetings) {
    if (m.status === "cancelled") continue;
    const start = new Date(m.scheduledAt);
    const end = new Date(start.getTime() + (m.durationMinutes || 60) * 60_000);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:meeting-${m.id}@hoa-hub`);
    lines.push(`DTSTAMP:${icsDate(m.createdAt)}`);
    lines.push(`DTSTART:${icsDate(start.toISOString())}`);
    lines.push(`DTEND:${icsDate(end.toISOString())}`);
    lines.push(`SUMMARY:${icsEsc(`[${m.kind}] ${m.title}`)}`);
    const loc = m.locationPhysical || m.locationVideoLink || "";
    if (loc) lines.push(`LOCATION:${icsEsc(loc)}`);
    if (m.noticeText) lines.push(`DESCRIPTION:${icsEsc(m.noticeText)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// ── Minimal PDF builder (mirrors motions.ts style) ───────────────────────
type Line = [string, number];

function buildAgendaPacketLines(orgName: string, detail: NonNullable<Awaited<ReturnType<typeof buildMeetingDetail>>>): Line[] {
  const lines: Line[] = [];
  lines.push([`${orgName} — Meeting Agenda Packet`, 16]);
  lines.push([``, 6]);
  lines.push([`${detail.title}`, 13]);
  lines.push([`Type: ${detail.kind} · ${detail.scheduledAt.slice(0, 16).replace("T", " ")}`, 10]);
  if (detail.locationPhysical) lines.push([`Location: ${detail.locationPhysical}`, 10]);
  if (detail.locationVideoLink) lines.push([`Video: ${detail.locationVideoLink}`, 10]);
  lines.push([`Notice required: ${detail.noticeRequiredDays} days · Posted: ${detail.noticePostedAt ?? "NOT POSTED"} · ${detail.noticeOk ? "OK" : "INSUFFICIENT"}`, 10]);
  lines.push([``, 6]);
  if (detail.noticeText) {
    lines.push([`Notice:`, 11]);
    for (const l of chunkText(detail.noticeText, 90)) lines.push([l, 10]);
    lines.push([``, 6]);
  }
  lines.push([`Quorum target: ${detail.quorum.required} of ${detail.quorum.boardSize}`, 10]);
  lines.push([``, 6]);
  lines.push([`Agenda:`, 12]);
  for (const it of detail.agenda) {
    lines.push([`  ${it.sortOrder + 1}. [${it.kind}] ${it.title}${it.presenter ? ` — ${it.presenter}` : ""}`, 11]);
    if (it.notes) for (const l of chunkText(it.notes, 86)) lines.push([`     ${l}`, 10]);
    if (it.motion) {
      const mt = it.motion as { id: number; title: string; votingRuleDescription: string };
      lines.push([`     Motion #M-${mt.id}: ${mt.title}`, 10]);
      lines.push([`     Rule: ${mt.votingRuleDescription}`, 9]);
    }
  }
  return lines;
}

function buildMinutesLines(orgName: string, detail: NonNullable<Awaited<ReturnType<typeof buildMeetingDetail>>>): Line[] {
  const lines: Line[] = [];
  lines.push([`${orgName} — Meeting Minutes`, 16]);
  lines.push([``, 6]);
  lines.push([`${detail.title}`, 13]);
  lines.push([`Type: ${detail.kind} · ${detail.scheduledAt.slice(0, 16).replace("T", " ")}`, 10]);
  lines.push([`Status: ${detail.status} · Minutes: ${detail.minutesStatus.toUpperCase()}${detail.minutesAdoptedAt ? ` (adopted ${detail.minutesAdoptedAt.slice(0, 10)})` : ""}`, 10]);
  lines.push([``, 6]);
  lines.push([`Attendance:`, 12]);
  for (const a of detail.attendance) lines.push([`  · ${a.userName} — ${a.status}${a.isBoardMember ? " (board)" : ""}`, 10]);
  lines.push([`Quorum: ${detail.quorum.attending}/${detail.quorum.required} ${detail.quorum.met ? "(MET)" : "(NOT MET)"}`, 10]);
  lines.push([``, 6]);
  lines.push([`Minutes:`, 12]);
  for (const l of chunkText(detail.minutesContent || "(no minutes recorded)", 90)) lines.push([l, 10]);
  return lines;
}

function buildPdf(rows: Line[]): Buffer {
  const ops: string[] = ["BT", "/F1 16 Tf", "72 740 Td"];
  let first = true;
  for (const [t, sz] of rows) {
    if (first) { ops.push(`(${esc(t)}) Tj`); first = false; }
    else { ops.push(`/F1 ${sz} Tf`, "0 -16 Td", `(${esc(t)}) Tj`); }
  }
  ops.push("ET");
  const stream = ops.join("\n");
  const streamBytes = Buffer.from(stream, "latin1");
  const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`;
  const obj4 = `4 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream\nendobj\n`;
  const obj5 = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
  const header = `%PDF-1.4\n`;
  const offsets: number[] = [];
  let pos = header.length;
  const objects = [obj1, obj2, obj3, obj4, obj5];
  for (const o of objects) { offsets.push(pos); pos += Buffer.byteLength(o, "latin1"); }
  const xrefOffset = pos;
  const xref = [`xref\n`, `0 6\n`, `0000000000 65535 f \n`,
    ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  const trailer = `trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.concat([
    Buffer.from(header, "latin1"),
    ...objects.map((o) => Buffer.from(o, "latin1")),
    Buffer.from(xref, "latin1"),
    Buffer.from(trailer, "latin1"),
  ]);
}

function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").slice(0, 200);
}

function chunkText(s: string, n: number): string[] {
  const out: string[] = [];
  for (const para of s.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if ((line + " " + word).trim().length > n) { if (line) out.push(line); line = word; }
      else { line = line ? `${line} ${word}` : word; }
    }
    if (line) out.push(line);
  }
  return out;
}

// Storage stub used by future minutes upload (kept for parity with motions).
void Readable; void storage;

export default router;
