// Task #62: Board Motions & Voting Engine — REST routes.
//
// Mounted under `/api` with the same auth posture as the bids router: every
// request goes through `authenticateJwt` upstream, but board-only writes are
// gated by `requireBoardMember` per-handler so a manager-but-not-board user
// can still read the inbox.

import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { db } from "@workspace/db";
import {
  motionsTable,
  motionVotesTable,
  motionAttachmentsTable,
  usersTable,
  notificationsTable,
  stripeConfigTable,
  organizationSettingsTable,
  emergencyBypassesTable,
  meetingsTable,
  type MotionVotingRule,
} from "@workspace/db/schema";
import { computeQuorum, markMinutesAdoptedByMotion } from "./meetings.js";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { authenticateJwt, requireManagerOrBoardMember } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { buildCurrentSignatureBlockLines } from "../lib/signatureBlock.js";
import { materializeMotionDeadline } from "../lib/calendarMaterialize.js";
import { sendEmail } from "../lib/email.js";
import { ObjectStorageService } from "../lib/objectStorage.js";

const storage = new ObjectStorageService();
import { refreshStripeConfig } from "../lib/stripe.js";
import {
  evaluateMotion,
  computeBodyHash,
  describeRule,
  isTerminal,
  type Decision,
} from "../lib/motions.js";
import {
  onResolutionMotionAdopted,
  onRescindMotionAdopted,
} from "../lib/resolutions.js";
import {
  countMembersInGoodStanding,
  isMemberInGoodStanding,
} from "../lib/membership.js";
import { userIsOwner } from "../lib/governance.js";

const router: IRouter = Router();

function nowISO(): string { return new Date().toISOString(); }

const VALID_RULE_TYPES = new Set(["unanimous", "majority", "supermajority", "single_approver", "quorum_only"]);
function parseRule(raw: unknown): MotionVotingRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { type?: string; threshold?: number; quorum?: number };
  if (!r.type || !VALID_RULE_TYPES.has(r.type)) return null;
  if (r.type === "supermajority") {
    const t = typeof r.threshold === "number" ? r.threshold : 2 / 3;
    return { type: "supermajority", threshold: Math.min(1, Math.max(0.5, t)) };
  }
  if (r.type === "quorum_only") {
    const q = typeof r.quorum === "number" && r.quorum >= 1 ? Math.floor(r.quorum) : 1;
    return { type: "quorum_only", quorum: q };
  }
  return { type: r.type as "unanimous" | "majority" | "single_approver" };
}

async function loadBoardMembers() {
  const rows = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, pending: usersTable.pending })
    .from(usersTable)
    .where(eq(usersTable.boardMember, true));
  return rows.filter((u) => !u.pending);
}

async function getOrgName(): Promise<string> {
  const [row] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  return row?.name ?? "HOA Hub";
}

async function loadMotionFull(id: number) {
  const [m] = await db.select().from(motionsTable).where(eq(motionsTable.id, id));
  if (!m) return null;
  const votes = await db.select().from(motionVotesTable)
    .where(eq(motionVotesTable.motionId, id))
    .orderBy(asc(motionVotesTable.createdAt));
  const attachments = await db.select().from(motionAttachmentsTable)
    .where(eq(motionAttachmentsTable.motionId, id));
  return { motion: m, votes, attachments };
}

type MotionAudience = "board" | "members";

function parseAudience(raw: unknown): MotionAudience {
  return raw === "members" ? "members" : "board";
}

function readAudience(motion: { audience?: string | null }): MotionAudience {
  return motion.audience === "members" ? "members" : "board";
}

interface MotionSummary {
  id: number;
  kind: string;
  title: string;
  body: string;
  bodyHash: string | null;
  votingRule: MotionVotingRule;
  votingRuleDescription: string;
  status: string;
  outcome: string | null;
  createdByUserId: number | null;
  createdByName: string;
  createdAt: string;
  openedAt: string | null;
  closesAt: string | null;
  resolvedAt: string | null;
  payload: unknown;
  tally: { approve: number; reject: number; abstain: number; total: number };
  needed: number | null;
  finalizable: boolean;
  boardMemberCount: number;
  // Total legal membership (one row per unit, owners only) and how many
  // of those members are currently in good standing. For board-audience
  // motions the evaluator still uses `boardMemberCount` as the
  // denominator; for member-audience motions (Task #142) the evaluator
  // uses `memberInGoodStandingCount`.
  memberCount: number;
  memberInGoodStandingCount: number;
  audience: MotionAudience;
  canVote: boolean;
  votes: Array<{
    id: number; userId: number; userName: string; decision: string;
    comment: string | null; createdAt: string; bodyHashAtVote: string | null;
  }>;
  attachments: Array<{
    id: number; name: string; size: number; contentType: string | null;
    storageKey: string; uploadedByName: string; uploadedAt: string;
  }>;
}

/**
 * Decide whether the current request user may cast a vote on this motion
 * right now. Combines audience, status, role, ownership, and good-standing.
 * Used both by the vote endpoint (as the gate) and by buildSummary (so
 * the UI can render the vote panel without round-tripping a 403).
 */
async function canUserVote(
  user: { id: number; role?: string; boardMember?: boolean } | undefined,
  motion: { status: string; audience: MotionAudience },
): Promise<{ allowed: boolean; reason?: string }> {
  if (!user) return { allowed: false, reason: "not_authenticated" };
  if (motion.status !== "open") return { allowed: false, reason: "not_open" };
  if (motion.audience === "board") {
    if (!user.boardMember) return { allowed: false, reason: "not_board_member" };
    // Owners on the board must still be in good standing on their unit.
    const ownerCheck = await userIsOwner(user.id);
    if (ownerCheck.isOwner) {
      const eligibility = await isMemberInGoodStanding({ id: user.id });
      if (!eligibility.inGoodStanding) return { allowed: false, reason: "not_in_good_standing" };
    }
    return { allowed: true };
  }
  // audience === "members"
  const eligibility = await isMemberInGoodStanding({ id: user.id });
  if (!eligibility.inGoodStanding) {
    return { allowed: false, reason: eligibility.reason };
  }
  return { allowed: true };
}

async function buildSummary(
  id: number,
  user?: { id: number; role?: string; boardMember?: boolean },
): Promise<MotionSummary | null> {
  const ctx = await loadMotionFull(id);
  if (!ctx) return null;
  const audience = readAudience(ctx.motion);
  const board = await loadBoardMembers();
  const memberCounts = await countMembersInGoodStanding();
  const denominator = audience === "members" ? memberCounts.inGoodStanding : board.length;
  const ev = evaluateMotion(ctx.motion.votingRule as MotionVotingRule, ctx.votes, denominator);
  const voteCheck = await canUserVote(user, { status: ctx.motion.status, audience });
  return {
    id: ctx.motion.id,
    kind: ctx.motion.kind,
    title: ctx.motion.title,
    body: ctx.motion.body,
    bodyHash: ctx.motion.bodyHash,
    votingRule: ctx.motion.votingRule as MotionVotingRule,
    votingRuleDescription: describeRule(ctx.motion.votingRule as MotionVotingRule),
    status: ctx.motion.status,
    outcome: ctx.motion.outcome,
    createdByUserId: ctx.motion.createdByUserId,
    createdByName: ctx.motion.createdByName,
    createdAt: ctx.motion.createdAt,
    openedAt: ctx.motion.openedAt,
    closesAt: ctx.motion.closesAt,
    resolvedAt: ctx.motion.resolvedAt,
    payload: ctx.motion.payload,
    tally: ev.tally,
    needed: ev.needed,
    finalizable: ev.finalizable,
    boardMemberCount: board.length,
    memberCount: memberCounts.total,
    memberInGoodStandingCount: memberCounts.inGoodStanding,
    audience,
    canVote: voteCheck.allowed,
    votes: ctx.votes.map((v) => ({
      id: v.id, userId: v.userId, userName: v.userName, decision: v.decision,
      comment: v.comment, createdAt: v.createdAt, bodyHashAtVote: v.bodyHashAtVote,
    })),
    attachments: ctx.attachments.map((a) => ({
      id: a.id, name: a.name, size: a.size, contentType: a.contentType,
      storageKey: a.storageKey, uploadedByName: a.uploadedByName, uploadedAt: a.uploadedAt,
    })),
  };
}

// ── List ────────────────────────────────────────────────────────────────────
// Manager/board users see every motion. Authenticated owners may also see
// motions whose audience is "members" so they can find and vote on them
// from the resident portal — Task #142.
router.get("/motions", authenticateJwt, async (req, res) => {
  const status = (req.query.status as string | undefined)?.toLowerCase();
  const kind = (req.query.kind as string | undefined);
  const where = [];
  if (status && status !== "all") where.push(eq(motionsTable.status, status));
  if (kind) where.push(eq(motionsTable.kind, kind));
  const role = req.user?.role;
  const isManagerOrBoard = role === "admin" || role === "manager" || req.user?.boardMember === true;
  const ownerCheck = isManagerOrBoard
    ? { isOwner: false, unitId: null }
    : await userIsOwner(req.user!.id);
  if (!isManagerOrBoard && !ownerCheck.isOwner) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const rows = await db.select().from(motionsTable)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(motionsTable.createdAt));
  // Owners may only see *open* member-audience motions; managers and
  // board members see everything (including drafts and resolved).
  const visible = isManagerOrBoard
    ? rows
    : rows.filter((m) => readAudience(m) === "members" && m.status === "open");
  const ids = visible.map((r) => r.id);
  const allVotes = ids.length
    ? await db.select().from(motionVotesTable).where(inArray(motionVotesTable.motionId, ids))
    : [];
  const board = await loadBoardMembers();
  const memberCounts = await countMembersInGoodStanding();
  const meId = req.user?.id ?? null;
  const items = await Promise.all(visible.map(async (m) => {
    const audience = readAudience(m);
    const denominator = audience === "members" ? memberCounts.inGoodStanding : board.length;
    const votes = allVotes.filter((v) => v.motionId === m.id);
    const ev = evaluateMotion(m.votingRule as MotionVotingRule, votes, denominator);
    const myVote = meId == null ? null : votes.find((v) => v.userId === meId)?.decision ?? null;
    const voteCheck = await canUserVote(req.user, { status: m.status, audience });
    return {
      id: m.id, kind: m.kind, title: m.title, status: m.status, outcome: m.outcome,
      createdByName: m.createdByName, createdAt: m.createdAt,
      openedAt: m.openedAt, closesAt: m.closesAt, resolvedAt: m.resolvedAt,
      votingRule: m.votingRule, votingRuleDescription: describeRule(m.votingRule as MotionVotingRule),
      tally: ev.tally, needed: ev.needed,
      boardMemberCount: board.length,
      memberCount: memberCounts.total,
      memberInGoodStandingCount: memberCounts.inGoodStanding,
      audience,
      canVote: voteCheck.allowed,
      myVote,
    };
  }));
  res.json(items);
});

// ── Get one ─────────────────────────────────────────────────────────────────
router.get("/motions/:id", authenticateJwt, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [m] = await db.select().from(motionsTable).where(eq(motionsTable.id, id));
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  const role = req.user?.role;
  const isManagerOrBoard = role === "admin" || role === "manager" || req.user?.boardMember === true;
  if (!isManagerOrBoard) {
    // Owners may only fetch open member-audience motions; drafts and
    // resolved motions stay private until/unless they're opened.
    if (readAudience(m) !== "members" || m.status !== "open") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const ownerCheck = await userIsOwner(req.user!.id);
    if (!ownerCheck.isOwner) { res.status(403).json({ error: "Forbidden" }); return; }
  }
  const summary = await buildSummary(id, req.user);
  if (!summary) { res.status(404).json({ error: "Not found" }); return; }
  res.json(summary);
});

// ── Create (draft) ──────────────────────────────────────────────────────────
router.post("/motions", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const body = req.body as {
    kind?: string; title?: string; body?: string;
    votingRule?: unknown; audience?: unknown; closesAt?: string | null; payload?: unknown;
  };
  const title = body.title?.trim();
  const kind = body.kind?.trim() || "general";
  if (!title) { res.status(400).json({ error: "title required" }); return; }
  const rule = parseRule(body.votingRule);
  if (!rule) { res.status(400).json({ error: "votingRule is invalid or missing" }); return; }
  const audience = parseAudience(body.audience);
  const created = nowISO();
  const [row] = await db.insert(motionsTable).values({
    kind,
    title,
    body: body.body ?? "",
    votingRule: rule,
    audience,
    status: "draft",
    createdByUserId: req.user!.id,
    createdByName: req.user!.name || req.user!.email,
    createdAt: created,
    closesAt: body.closesAt ?? null,
    payload: (body.payload ?? null) as object | null,
  }).returning();
  res.status(201).json({ id: row!.id });
});

// ── Open ────────────────────────────────────────────────────────────────────
router.post("/motions/:id/open", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const ctx = await loadMotionFull(id);
  if (!ctx) { res.status(404).json({ error: "Not found" }); return; }
  if (ctx.motion.status !== "draft") {
    res.status(409).json({ error: `Cannot open a motion in status ${ctx.motion.status}` }); return;
  }
  const closesAt = (req.body as { closesAt?: string })?.closesAt ?? ctx.motion.closesAt ?? null;
  await db.update(motionsTable).set({
    status: "open", openedAt: nowISO(), closesAt,
  }).where(eq(motionsTable.id, id));
  // Task #75: deadline event on the Board calendar so board members can see
  // when voting closes from the calendar view.
  await materializeMotionDeadline({ id, title: ctx.motion.title, closesAt, status: "open", outcome: null });
  // Notify board members (in-app + email).
  await notifyBoardOpened(id, ctx.motion.title);
  res.json({ ok: true });
});

// ── Vote ────────────────────────────────────────────────────────────────────
// Eligibility depends on the motion's audience (Task #142):
//   - audience="board"   → board members only; owner board members must
//                          additionally be in good standing on their unit.
//   - audience="members" → every owner whose ownership_status is "active"
//                          (good standing); board flag is not required.
router.post("/motions/:id/votes", authenticateJwt, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as { decision?: string; comment?: string | null };
  if (body.decision !== "approve" && body.decision !== "reject" && body.decision !== "abstain") {
    res.status(400).json({ error: "decision must be approve|reject|abstain" }); return;
  }
  const ctx = await loadMotionFull(id);
  if (!ctx) { res.status(404).json({ error: "Not found" }); return; }
  if (ctx.motion.status !== "open") {
    res.status(409).json({ error: `Motion is ${ctx.motion.status}; voting is closed` }); return;
  }
  const audience = readAudience(ctx.motion);
  const voteCheck = await canUserVote(req.user, { status: ctx.motion.status, audience });
  if (!voteCheck.allowed) {
    if (voteCheck.reason === "not_board_member") {
      res.status(403).json({ error: "Only board members may vote on this motion." });
      return;
    }
    if (voteCheck.reason === "not_in_good_standing") {
      const eligibility = await isMemberInGoodStanding(req.user!);
      res.status(403).json({
        error: "Owner is not in good standing; voting rights are suspended.",
        ownershipStatus: eligibility.ownershipStatus,
        reason: eligibility.reason,
      });
      return;
    }
    if (audience === "members") {
      const eligibility = await isMemberInGoodStanding(req.user!);
      res.status(403).json({
        error: "Only owners in good standing may vote on this member motion.",
        ownershipStatus: eligibility.ownershipStatus,
        reason: eligibility.reason,
      });
      return;
    }
    res.status(403).json({ error: "You are not eligible to vote on this motion." });
    return;
  }

  // Freeze the body hash on the first vote so later edits cannot rewrite the
  // text under cast votes.
  let bodyHash = ctx.motion.bodyHash;
  if (!bodyHash) {
    bodyHash = computeBodyHash({ title: ctx.motion.title, body: ctx.motion.body, attachments: ctx.attachments });
    await db.update(motionsTable).set({ bodyHash }).where(eq(motionsTable.id, id));
  }

  // Replace any prior decision from this user (vote changes are allowed
  // until the motion resolves).
  await db.delete(motionVotesTable).where(
    and(eq(motionVotesTable.motionId, id), eq(motionVotesTable.userId, req.user!.id)),
  );
  await db.insert(motionVotesTable).values({
    motionId: id,
    userId: req.user!.id,
    userName: req.user!.name || req.user!.email,
    decision: body.decision as Decision,
    comment: body.comment?.trim() || null,
    bodyHashAtVote: bodyHash,
    createdAt: nowISO(),
  });

  const after = await maybeFinalize(id);
  res.json({ ok: true, finalized: after.finalized, outcome: after.outcome });
});

// ── Withdraw ────────────────────────────────────────────────────────────────
router.post("/motions/:id/withdraw", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [m] = await db.select().from(motionsTable).where(eq(motionsTable.id, id));
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  if (isTerminal(m.status)) {
    res.status(409).json({ error: `Motion is already ${m.status}` }); return;
  }
  if (m.createdByUserId !== req.user!.id && req.user!.role !== "admin") {
    res.status(403).json({ error: "Only the proposer or an admin may withdraw" }); return;
  }
  await db.update(motionsTable).set({
    status: "withdrawn", outcome: "withdrawn", resolvedAt: nowISO(),
  }).where(eq(motionsTable.id, id));
  // Task #75: cancel the deadline event.
  await materializeMotionDeadline({ id, title: m.title, closesAt: m.closesAt, status: "withdrawn", outcome: "withdrawn" });
  res.json({ ok: true });
});

// ── Attachments ─────────────────────────────────────────────────────────────
router.post("/motions/upload-url", authenticateJwt, requireManagerOrBoardMember, async (_req, res) => {
  try {
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
  } catch {
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.post("/motions/:id/attachments", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [m] = await db.select().from(motionsTable).where(eq(motionsTable.id, id));
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  if (m.bodyHash) {
    res.status(409).json({ error: "Cannot modify attachments after voting has begun" }); return;
  }
  const body = req.body as { name?: string; storageKey?: string; size?: number; contentType?: string };
  if (!body.name || !body.storageKey) { res.status(400).json({ error: "name and storageKey required" }); return; }
  const [att] = await db.insert(motionAttachmentsTable).values({
    motionId: id,
    name: body.name,
    size: body.size ?? 0,
    contentType: body.contentType ?? null,
    storageKey: body.storageKey,
    uploadedByUserId: req.user!.id,
    uploadedByName: req.user!.name || req.user!.email,
    uploadedAt: nowISO(),
  }).returning();
  res.status(201).json({ id: att!.id });
});

router.get("/motions/:id/attachments/:attId", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  const attId = Number(req.params.attId);
  if (!Number.isFinite(id) || !Number.isFinite(attId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [att] = await db.select().from(motionAttachmentsTable)
    .where(and(eq(motionAttachmentsTable.id, attId), eq(motionAttachmentsTable.motionId, id)));
  if (!att) { res.status(404).json({ error: "Not found" }); return; }
  try {
    const file = await storage.getObjectEntityFile(att.storageKey);
    const response = await storage.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((v: string, k: string) => res.setHeader(k, v));
    res.setHeader("Content-Disposition", `inline; filename="${att.name.replace(/"/g, "")}"`);
    if (response.body) {
      const node = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      node.pipe(res);
    } else { res.end(); }
  } catch {
    res.status(500).json({ error: "Download failed" });
  }
});

// ── Resolution PDF ──────────────────────────────────────────────────────────
router.get("/motions/:id/pdf", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const summary = await buildSummary(id);
  if (!summary) { res.status(404).json({ error: "Not found" }); return; }
  const orgName = await getOrgName();
  const pdf = await buildMotionPdf({ orgName, motion: summary });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="motion-${id}.pdf"`);
  res.end(pdf);
});

// ── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Re-evaluate the motion under its rule and resolve it if finalizable.
 * Triggers any kind-specific side effects (e.g. apply Stripe keys when a
 * `stripe_config` motion is adopted).
 */
export async function maybeFinalize(motionId: number): Promise<{ finalized: boolean; outcome: string | null }> {
  const ctx = await loadMotionFull(motionId);
  if (!ctx || ctx.motion.status !== "open") return { finalized: false, outcome: null };
  const audience = readAudience(ctx.motion);
  let denominator: number;
  if (audience === "members") {
    const memberCounts = await countMembersInGoodStanding();
    denominator = memberCounts.inGoodStanding;
  } else {
    const board = await loadBoardMembers();
    denominator = board.length;
  }
  const ev = evaluateMotion(ctx.motion.votingRule as MotionVotingRule, ctx.votes, denominator);
  if (!ev.finalizable) return { finalized: false, outcome: null };

  // Task #65: meeting-bound motions cannot finalize until the parent meeting
  // has reached quorum. The motion stays "open" — voting is preserved — and
  // will finalize automatically once attendance is recorded.
  if (ctx.motion.meetingId) {
    const [mt] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, ctx.motion.meetingId));
    if (mt && mt.status !== "adjourned" && mt.status !== "cancelled") {
      const q = await computeQuorum(ctx.motion.meetingId);
      if (!q.met) return { finalized: false, outcome: null };
    }
  }

  const resolvedAt = nowISO();
  await db.update(motionsTable).set({
    status: ev.outcome!, outcome: ev.outcome!, resolvedAt,
  }).where(eq(motionsTable.id, motionId));
  // Task #75: update deadline event title to reflect outcome.
  await materializeMotionDeadline({
    id: motionId, title: ctx.motion.title, closesAt: ctx.motion.closesAt,
    status: ev.outcome!, outcome: ev.outcome!,
  });

  try { await applyResolved(motionId, ev.outcome!); }
  catch (err) { logger.error({ err, motionId, outcome: ev.outcome }, "applyResolved failed"); }
  if (ev.outcome === "adopted" && ctx.motion.kind === "minutes_adoption") {
    try { await markMinutesAdoptedByMotion(motionId); }
    catch (err) { logger.error({ err, motionId }, "markMinutesAdoptedByMotion failed"); }
  }
  await notifyBoardResolved(motionId, ctx.motion.title, ev.outcome!);
  return { finalized: true, outcome: ev.outcome };
}

// Task #64: known policy keys that a `policy_change` motion may write back to
// the organization_settings singleton when adopted.
const POLICY_SETTINGS_COLUMNS = new Set<string>([
  "bidMinQuotesThresholdCents",
  "bidDefaultSealed",
  "bidReminderDaysBefore",
  "accEnabled",
  "accQuorumMode",
  "accAutoApprovalDays",
  "paymentsEnabled",
  "paymentsSurchargeEnabled",
  "paymentsSurchargePercentBp",
  "paymentsAutoPayLagDays",
  "expenditureThresholdCents",
  "gatedPolicies",
  "emergencyBypassEnabled",
  "name",
  "address",
  "contactEmail",
  "phone",
  "timezone",
  "notificationPreferences",
]);

async function applyResolved(motionId: number, outcome: "adopted" | "rejected") {
  const [m] = await db.select().from(motionsTable).where(eq(motionsTable.id, motionId));
  if (!m) return;
  const payload = (m.payload ?? {}) as Record<string, unknown>;

  // Ratification motions update the linked bypass row regardless of outcome.
  if (m.kind === "policy_change" && payload.ratification && typeof payload.bypassId === "number") {
    await db.update(emergencyBypassesTable).set({
      ratificationStatus: outcome === "adopted" ? "ratified" : "rejected",
      reversalRequired: outcome === "rejected",
    }).where(eq(emergencyBypassesTable.id, payload.bypassId));
    logger.info({ motionId, bypassId: payload.bypassId, outcome }, "Bypass ratification resolved");
    return;
  }

  // The remaining branches only fire when the motion is Adopted.
  if (outcome !== "adopted") return;
  await applyAdopted(m, payload);
}

async function applyAdopted(
  m: typeof motionsTable.$inferSelect,
  payload: Record<string, unknown>,
) {
  if (m.kind === "policy_change") {
    const policyKey = typeof payload.policyKey === "string" ? payload.policyKey : null;
    if (!policyKey || !POLICY_SETTINGS_COLUMNS.has(policyKey)) {
      logger.warn({ motionId: m.id, policyKey }, "policy_change: unknown policyKey — no-op");
      return;
    }
    const newValue = payload.newValue;
    const [existing] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
    if (!existing) await db.insert(organizationSettingsTable).values({ id: 1, name: "" });
    await db
      .update(organizationSettingsTable)
      .set({ [policyKey]: newValue as never })
      .where(eq(organizationSettingsTable.id, 1));
    logger.info({ motionId: m.id, policyKey }, "Applied policy_change to organization_settings");
    return;
  }
  if (m.kind === "expenditure") {
    // Adoption authorizes the action but does not itself create the work order
    // or post the assessment — the manager retries the original endpoint with
    // motionId=N. This keeps the existing route logic the source of truth and
    // gives auditors a clean cross-link via sourceMotionId.
    logger.info({ motionId: m.id, target: payload.targetType, targetId: payload.targetId }, "Expenditure motion adopted — awaiting manager action");
    return;
  }
  if (m.kind === "stripe_config") {
    const payload = (m.payload ?? {}) as {
      secretKey?: string | null; publishableKey?: string | null; webhookSecret?: string | null;
    };
    const [existing] = await db.select().from(stripeConfigTable).where(eq(stripeConfigTable.id, 1));
    const next = {
      secretKey: payload.secretKey ?? existing?.secretKey ?? null,
      publishableKey: payload.publishableKey ?? existing?.publishableKey ?? null,
      webhookSecret: payload.webhookSecret ?? existing?.webhookSecret ?? null,
      updatedAt: nowISO(),
      updatedByUserId: m.createdByUserId,
      updatedByName: m.createdByName,
    };
    if (existing) {
      await db.update(stripeConfigTable).set(next).where(eq(stripeConfigTable.id, 1));
    } else {
      await db.insert(stripeConfigTable).values({ id: 1, ...next });
    }
    await refreshStripeConfig();
    logger.info({ motionId: m.id }, "Applied Stripe configuration via motion");
  }
  if (m.kind === "resolution") {
    await onResolutionMotionAdopted(m.id);
  }
  if (m.kind === "rescind_resolution") {
    await onRescindMotionAdopted(m.id);
  }
}

async function notifyBoardOpened(motionId: number, title: string) {
  const board = await loadBoardMembers();
  const orgName = await getOrgName();
  const now = nowISO();
  for (const m of board) {
    await db.insert(notificationsTable).values({
      userId: m.id,
      type: "motion_open",
      message: `New motion needs your vote: "${title}"`,
      entityType: "motion",
      entityId: String(motionId),
      read: false,
      createdAt: now,
    });
    try {
      await sendEmail(m.email, `[${orgName}] New motion needs your vote`,
        `<p>A new motion is open for board voting:</p><p><strong>${escapeHtml(title)}</strong></p>` +
        `<p>Open the HOA Hub to review and cast your vote.</p>`);
    } catch (err) { logger.warn({ err, userId: m.id }, "motion open email failed"); }
  }
}

async function notifyBoardResolved(motionId: number, title: string, outcome: string) {
  const board = await loadBoardMembers();
  const now = nowISO();
  for (const m of board) {
    await db.insert(notificationsTable).values({
      userId: m.id,
      type: "motion_resolved",
      message: `Motion "${title}" was ${outcome}`,
      entityType: "motion",
      entityId: String(motionId),
      read: false,
      createdAt: now,
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Minimal PDF builder for motion resolution ───────────────────────────────
async function buildMotionPdf(opts: {
  orgName: string;
  motion: MotionSummary;
}): Promise<Buffer> {
  const m = opts.motion;
  const lines: Array<[string, number]> = [];
  lines.push([`${opts.orgName} — Board Resolution`, 16]);
  lines.push([``, 6]);
  lines.push([`Motion #M-${m.id} — ${m.title}`, 12]);
  lines.push([`Kind: ${m.kind}`, 10]);
  lines.push([`Voting rule: ${m.votingRuleDescription}`, 10]);
  lines.push([`Proposed by: ${m.createdByName}`, 10]);
  lines.push([`Proposed on: ${m.createdAt.slice(0, 10)}`, 10]);
  if (m.openedAt) lines.push([`Opened: ${m.openedAt.slice(0, 10)}`, 10]);
  if (m.resolvedAt) lines.push([`Resolved: ${m.resolvedAt.slice(0, 10)}`, 10]);
  lines.push([`Status: ${m.status.toUpperCase()}${m.outcome ? ` (${m.outcome})` : ""}`, 11]);
  if (m.bodyHash) lines.push([`Body hash: ${m.bodyHash.slice(0, 16)}…`, 9]);
  lines.push([``, 8]);
  if (m.body) {
    lines.push([`Body:`, 11]);
    for (const c of chunkText(m.body, 90)) lines.push([c, 10]);
    lines.push([``, 6]);
  }
  lines.push([`Tally: ${m.tally.approve} approve · ${m.tally.reject} reject · ${m.tally.abstain} abstain (board size ${m.boardMemberCount})`, 10]);
  lines.push([``, 6]);
  lines.push([`Vote audit trail:`, 11]);
  for (const v of m.votes) {
    lines.push([` · ${v.userName}: ${v.decision} on ${v.createdAt.slice(0, 10)}${v.comment ? ` — ${v.comment}` : ""}`, 9]);
  }

  const sigDate = (m.resolvedAt ?? m.createdAt).slice(0, 10);
  const signatureLines = await buildCurrentSignatureBlockLines(sigDate);
  for (const sl of signatureLines) lines.push(sl);

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
function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").slice(0, 200);
}
function chunkText(s: string, n: number): string[] {
  const out: string[] = [];
  for (const para of s.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if ((line + " " + word).length > n) { if (line) out.push(line); line = word; }
      else { line = line ? `${line} ${word}` : word; }
    }
    if (line) out.push(line);
  }
  return out;
}

export default router;
