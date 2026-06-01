// Task #66: Owner-facing governance transparency — Board section.
//
// All endpoints are mounted under `/api/me/board/*` and require an
// authenticated owner-of-record. We trust `userIsOwner` (matches the
// user's email to a unit's ownerEmail) for the resident gate.

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { Readable } from "stream";
import { db } from "@workspace/db";
import {
  meetingsTable,
  meetingAgendaItemsTable,
  meetingAgendaCommentsTable,
  motionsTable,
  motionVotesTable,
  resolutionsTable,
  noticesTable,
  unitsTable,
  organizationSettingsTable,
  type MotionVotingRule,
} from "@workspace/db/schema";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { authenticateJwt } from "../middleware/auth.js";
import { describeRule } from "../lib/motions.js";
import { userIsOwner } from "../lib/governance.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { buildCurrentSignatureBlockLines } from "../lib/signatureBlock.js";

const router: IRouter = Router();
const storage = new ObjectStorageService();
function nowISO(): string { return new Date().toISOString(); }

const COMMENT_MAX = 4000;

interface OwnerCtx { userId: number; unitId: string | null; }

async function requireOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { isOwner, unitId } = await userIsOwner(req.user.id);
  if (!isOwner) { res.status(403).json({ error: "Owner access required" }); return; }
  (req as Request & { ownerCtx?: OwnerCtx }).ownerCtx = { userId: req.user.id, unitId };
  next();
}

function ctxOf(req: Request): OwnerCtx {
  return (req as Request & { ownerCtx?: OwnerCtx }).ownerCtx!;
}

// ── Resolutions: adopted + public only ──────────────────────────────────────
router.get("/me/board/resolutions", authenticateJwt, requireOwner, async (_req, res) => {
  const rows = await db
    .select()
    .from(resolutionsTable)
    .where(eq(resolutionsTable.public, true))
    .orderBy(desc(resolutionsTable.id));
  const motionIds = rows.map((r) => r.motionId);
  const motions = motionIds.length
    ? await db.select().from(motionsTable).where(inArray(motionsTable.id, motionIds))
    : [];
  const mById = new Map(motions.map((m) => [m.id, m]));
  const out = rows
    .filter((r) => {
      const m = mById.get(r.motionId);
      return m && m.status === "adopted" && r.number != null;
    })
    .map((r) => {
      const m = mById.get(r.motionId)!;
      const status = r.supersededByResolutionId
        ? "superseded"
        : r.rescindedByMotionId
          ? "rescinded"
          : "adopted";
      return {
        id: r.id,
        number: r.number,
        category: r.category,
        title: m.title,
        body: m.body,
        adoptedAt: r.adoptedAt,
        status,
        pdfAvailable: !!r.pdfStorageKey && status === "adopted",
        votingRuleDescription: describeRule(m.votingRule as MotionVotingRule),
      };
    });
  res.json(out);
});

router.get("/me/board/resolutions/:id/pdf", authenticateJwt, requireOwner, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [r] = await db.select().from(resolutionsTable).where(eq(resolutionsTable.id, id));
  if (!r || !r.public || !r.pdfStorageKey) { res.status(404).json({ error: "Not found" }); return; }
  const [m] = await db.select().from(motionsTable).where(eq(motionsTable.id, r.motionId));
  if (!m || m.status !== "adopted") { res.status(404).json({ error: "Not found" }); return; }
  // Status must currently be "adopted" (not superseded/rescinded) for the
  // PDF to remain available to owners — matches the read-only library view.
  if (r.supersededByResolutionId || r.rescindedByMotionId) {
    res.status(404).json({ error: "Not in effect" });
    return;
  }
  try {
    const file = await storage.getObjectEntityFile(r.pdfStorageKey);
    const response = await storage.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.setHeader("Content-Disposition", `attachment; filename="resolution-${r.number}.pdf"`);
    if (response.body) {
      const node = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      node.pipe(res);
    } else { res.end(); }
  } catch {
    res.status(500).json({ error: "Download failed" });
  }
});

// ── Meetings: list ──────────────────────────────────────────────────────────
//
// Owners see open + annual meetings. Executive sessions are intentionally
// excluded from the list (a meeting_scheduled notice is still posted, but
// agenda detail is private).
router.get("/me/board/meetings", authenticateJwt, requireOwner, async (req, res) => {
  const range = (req.query.range as string | undefined) ?? "all";
  const rows = await db
    .select()
    .from(meetingsTable)
    .orderBy(asc(meetingsTable.scheduledAt));
  const now = Date.now();
  const visible = rows.filter((m) => m.kind !== "executive");
  const out = visible
    .filter((m) => {
      if (range === "upcoming") {
        return m.status !== "cancelled" && new Date(m.scheduledAt).getTime() >= now - 6 * 60 * 60 * 1000;
      }
      if (range === "past") {
        return m.status === "adjourned" || new Date(m.scheduledAt).getTime() < now - 6 * 60 * 60 * 1000;
      }
      return true;
    })
    .map((m) => ({
      id: m.id,
      kind: m.kind,
      title: m.title,
      scheduledAt: m.scheduledAt,
      durationMinutes: m.durationMinutes,
      locationPhysical: m.locationPhysical,
      locationVideoLink: m.locationVideoLink,
      status: m.status,
      noticePostedAt: m.noticePostedAt,
      minutesStatus: m.minutesStatus,
      minutesAdoptedAt: m.minutesAdoptedAt,
    }));
  res.json(out);
});

// ── Meetings: detail (with comments, exclude closed-session items) ─────────
router.get("/me/board/meetings/:id", authenticateJwt, requireOwner, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [m] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!m || m.kind === "executive") { res.status(404).json({ error: "Not found" }); return; }

  const items = await db.select().from(meetingAgendaItemsTable)
    .where(and(eq(meetingAgendaItemsTable.meetingId, id), eq(meetingAgendaItemsTable.closedSession, false)))
    .orderBy(asc(meetingAgendaItemsTable.sortOrder), asc(meetingAgendaItemsTable.id));
  const itemIds = items.map((i) => i.id);
  const comments = itemIds.length
    ? await db.select().from(meetingAgendaCommentsTable)
        .where(and(
          inArray(meetingAgendaCommentsTable.agendaItemId, itemIds),
          isNull(meetingAgendaCommentsTable.deletedAt),
        ))
        .orderBy(asc(meetingAgendaCommentsTable.createdAt))
    : [];
  const me = ctxOf(req).userId;
  res.json({
    id: m.id, kind: m.kind, title: m.title,
    scheduledAt: m.scheduledAt, durationMinutes: m.durationMinutes,
    locationPhysical: m.locationPhysical, locationVideoLink: m.locationVideoLink,
    noticeText: m.noticeText, noticePostedAt: m.noticePostedAt,
    status: m.status, startedAt: m.startedAt, adjournedAt: m.adjournedAt,
    minutesStatus: m.minutesStatus, minutesAdoptedAt: m.minutesAdoptedAt,
    agendaPacketAvailable: !!m.noticePostedAt,
    minutesPdfAvailable: m.minutesStatus === "adopted",
    agenda: items.map((it) => ({
      id: it.id, sortOrder: it.sortOrder, kind: it.kind, title: it.title,
      notes: it.notes, presenter: it.presenter,
      itemMinutes: m.minutesStatus === "adopted" ? it.itemMinutes : null,
      comments: comments
        .filter((c) => c.agendaItemId === it.id)
        .map((c) => ({
          id: c.id,
          ownerName: c.ownerName,
          unitId: c.unitId,
          body: c.body,
          createdAt: c.createdAt,
          editedAt: c.editedAt,
          mine: c.ownerUserId === me,
        })),
    })),
  });
});

router.get("/me/board/meetings/:id/agenda-packet.pdf", authenticateJwt, requireOwner, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [m] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!m || m.kind === "executive" || !m.noticePostedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Reuse the same agenda-packet generator used for board members but skip
  // closed-session rows. We render here to keep the owner endpoint
  // self-contained.
  const items = await db.select().from(meetingAgendaItemsTable)
    .where(and(eq(meetingAgendaItemsTable.meetingId, id), eq(meetingAgendaItemsTable.closedSession, false)))
    .orderBy(asc(meetingAgendaItemsTable.sortOrder), asc(meetingAgendaItemsTable.id));
  const [org] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  const pdf = renderSimplePdf([
    [`${org?.name ?? "HOA"} — Agenda Packet`, 16],
    [m.title, 13],
    [`Scheduled: ${new Date(m.scheduledAt).toLocaleString()}`, 10],
    [`Notice posted: ${(m.noticePostedAt || "").slice(0, 10)}`, 9],
    ["", 6],
    ...(m.noticeText
      ? [
          ["Notice:", 11] as [string, number],
          ...wrap(m.noticeText, 92).map((l) => [l, 10] as [string, number]),
          ["", 4] as [string, number],
        ]
      : []),
    ["Agenda:", 12] as [string, number],
    ...items.flatMap((it, i): Array<[string, number]> => [
      [`${i + 1}. ${it.title}${it.presenter ? ` — ${it.presenter}` : ""}`, 11],
      ...(it.notes ? wrap(`   ${it.notes}`, 92).map((l) => [l, 9] as [string, number]) : []),
    ]),
  ]);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="meeting-${id}-agenda-packet.pdf"`);
  res.end(pdf);
});

router.get("/me/board/meetings/:id/minutes.pdf", authenticateJwt, requireOwner, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [m] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!m || m.kind === "executive" || m.minutesStatus !== "adopted") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const items = await db.select().from(meetingAgendaItemsTable)
    .where(and(eq(meetingAgendaItemsTable.meetingId, id), eq(meetingAgendaItemsTable.closedSession, false)))
    .orderBy(asc(meetingAgendaItemsTable.sortOrder), asc(meetingAgendaItemsTable.id));
  const motionIds = items.map((i) => i.motionId).filter((x): x is number => x != null);
  const motions = motionIds.length
    ? await db.select().from(motionsTable).where(inArray(motionsTable.id, motionIds))
    : [];
  const motionVotes = motionIds.length
    ? await db.select().from(motionVotesTable).where(inArray(motionVotesTable.motionId, motionIds))
    : [];
  const motionMap = new Map(motions.map((mt) => [mt.id, mt]));
  const [org] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  const lines: Array<[string, number]> = [
    [`${org?.name ?? "HOA"} — Adopted Minutes`, 16],
    [m.title, 13],
    [`Date: ${new Date(m.scheduledAt).toLocaleString()}`, 10],
    [`Adopted: ${(m.minutesAdoptedAt || "").slice(0, 10)}`, 10],
    ["", 6],
  ];
  if (m.minutesContent) {
    for (const l of wrap(m.minutesContent, 92)) lines.push([l, 10]);
    lines.push(["", 6]);
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    lines.push([`${i + 1}. ${it.title}`, 11]);
    if (it.notes) for (const l of wrap(`   ${it.notes}`, 92)) lines.push([l, 9]);
    if (it.itemMinutes) for (const l of wrap(`   ${it.itemMinutes}`, 92)) lines.push([l, 10]);
    if (it.motionId) {
      const mt = motionMap.get(it.motionId);
      if (mt) {
        const votes = motionVotes.filter((v) => v.motionId === mt.id);
        const ap = votes.filter((v) => v.decision === "approve").length;
        const rj = votes.filter((v) => v.decision === "reject").length;
        const ab = votes.filter((v) => v.decision === "abstain").length;
        lines.push([`   Motion: ${mt.title} — ${mt.status}${mt.outcome ? `/${mt.outcome}` : ""} (a:${ap} r:${rj} ab:${ab})`, 9]);
      }
    }
  }
  const sigDate = (m.minutesAdoptedAt ?? m.scheduledAt).slice(0, 10);
  const signatureLines = await buildCurrentSignatureBlockLines(sigDate);
  for (const sl of signatureLines) lines.push(sl);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="meeting-${id}-minutes.pdf"`);
  res.end(renderSimplePdf(lines));
});

// ── Agenda comments: CRUD by owners ─────────────────────────────────────────
router.post(
  "/me/board/meetings/:id/agenda/:itemId/comments",
  authenticateJwt,
  requireOwner,
  async (req, res) => {
    const meetingId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(meetingId) || !Number.isFinite(itemId)) {
      res.status(400).json({ error: "Invalid id" }); return;
    }
    const body = (req.body as { body?: string })?.body;
    const text = typeof body === "string" ? body.trim() : "";
    if (!text) { res.status(400).json({ error: "body required" }); return; }
    if (text.length > COMMENT_MAX) { res.status(400).json({ error: "comment too long" }); return; }
    const [m] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, meetingId));
    if (!m || m.kind === "executive") { res.status(404).json({ error: "Not found" }); return; }
    const [item] = await db.select().from(meetingAgendaItemsTable)
      .where(and(eq(meetingAgendaItemsTable.id, itemId), eq(meetingAgendaItemsTable.meetingId, meetingId)));
    if (!item || item.closedSession) { res.status(404).json({ error: "Not found" }); return; }
    // Comments are accepted up until the meeting is in_progress, so owners
    // have a clear window before the board convenes.
    if (m.status !== "scheduled") {
      res.status(409).json({ error: "Comment window has closed for this meeting" });
      return;
    }
    const ctx = ctxOf(req);
    const ownerName = req.user!.name || req.user!.email;
    const [row] = await db.insert(meetingAgendaCommentsTable).values({
      agendaItemId: itemId,
      meetingId,
      ownerUserId: ctx.userId,
      ownerName,
      unitId: ctx.unitId,
      body: text,
      createdAt: nowISO(),
    }).returning();
    res.status(201).json({
      id: row!.id, ownerName, unitId: ctx.unitId, body: text,
      createdAt: row!.createdAt, editedAt: null, mine: true,
    });
  },
);

router.patch(
  "/me/board/meetings/:meetingId/agenda/:itemId/comments/:commentId",
  authenticateJwt,
  requireOwner,
  async (req, res) => {
    const commentId = Number(req.params.commentId);
    if (!Number.isFinite(commentId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const text = typeof (req.body as { body?: string })?.body === "string"
      ? (req.body as { body: string }).body.trim() : "";
    if (!text) { res.status(400).json({ error: "body required" }); return; }
    if (text.length > COMMENT_MAX) { res.status(400).json({ error: "comment too long" }); return; }
    const [c] = await db.select().from(meetingAgendaCommentsTable).where(eq(meetingAgendaCommentsTable.id, commentId));
    const ctx = ctxOf(req);
    if (!c || c.deletedAt || c.ownerUserId !== ctx.userId) { res.status(404).json({ error: "Not found" }); return; }
    const [m] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, c.meetingId));
    if (!m || m.status !== "scheduled") {
      res.status(409).json({ error: "Comment window has closed for this meeting" });
      return;
    }
    await db.update(meetingAgendaCommentsTable)
      .set({ body: text, editedAt: nowISO() })
      .where(eq(meetingAgendaCommentsTable.id, commentId));
    res.json({ ok: true });
  },
);

router.delete(
  "/me/board/meetings/:meetingId/agenda/:itemId/comments/:commentId",
  authenticateJwt,
  requireOwner,
  async (req, res) => {
    const commentId = Number(req.params.commentId);
    if (!Number.isFinite(commentId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [c] = await db.select().from(meetingAgendaCommentsTable).where(eq(meetingAgendaCommentsTable.id, commentId));
    const ctx = ctxOf(req);
    if (!c || c.deletedAt || c.ownerUserId !== ctx.userId) { res.status(404).json({ error: "Not found" }); return; }
    const [m] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, c.meetingId));
    if (!m || m.status !== "scheduled") {
      res.status(409).json({ error: "Comment window has closed for this meeting" });
      return;
    }
    await db.update(meetingAgendaCommentsTable)
      .set({ deletedAt: nowISO() })
      .where(eq(meetingAgendaCommentsTable.id, commentId));
    res.status(204).send();
  },
);

// ── Notices ────────────────────────────────────────────────────────────────
router.get("/me/board/notices", authenticateJwt, requireOwner, async (_req, res) => {
  const rows = await db.select().from(noticesTable)
    .orderBy(desc(noticesTable.postedAt))
    .limit(200);
  // Hide notices for resolutions whose `public` flag has been turned off,
  // and notices for executive-session meetings (defensive — they shouldn't
  // be created in the first place).
  const resolutionIds = rows
    .filter((n) => n.sourceType === "resolution")
    .map((n) => n.sourceId);
  const meetingIds = rows
    .filter((n) => n.sourceType === "meeting")
    .map((n) => n.sourceId);
  const [resols, meets] = await Promise.all([
    resolutionIds.length
      ? db.select().from(resolutionsTable).where(inArray(resolutionsTable.id, resolutionIds))
      : Promise.resolve([] as Array<typeof resolutionsTable.$inferSelect>),
    meetingIds.length
      ? db.select().from(meetingsTable).where(inArray(meetingsTable.id, meetingIds))
      : Promise.resolve([] as Array<typeof meetingsTable.$inferSelect>),
  ]);
  const publicResIds = new Set(resols.filter((r) => r.public).map((r) => r.id));
  const visibleMeetings = new Set(meets.filter((m) => m.kind !== "executive").map((m) => m.id));
  const out = rows
    .filter((n) => {
      if (n.sourceType === "resolution") return publicResIds.has(n.sourceId);
      if (n.sourceType === "meeting") return visibleMeetings.has(n.sourceId);
      return true;
    })
    .map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      sourceType: n.sourceType,
      sourceId: n.sourceId,
      meetingId: n.meetingId,
      postedAt: n.postedAt,
      requiredWindowDays: n.requiredWindowDays,
    }));
  res.json(out);
});

// ── Helpers ────────────────────────────────────────────────────────────────
function wrap(s: string, n: number): string[] {
  const out: string[] = [];
  for (const para of s.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if ((line + " " + word).trim().length > n) {
        if (line) out.push(line);
        line = word;
      } else {
        line = line ? line + " " + word : word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function renderSimplePdf(lines: Array<[string, number]>): Buffer {
  const ops: string[] = ["BT", "/F1 16 Tf", "72 740 Td"];
  let first = true;
  for (const [t, sz] of lines) {
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
function esc(s: string) { return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").slice(0, 200); }

void unitsTable; // imported for type completeness
export default router;
