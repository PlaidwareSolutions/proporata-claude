// Stripe key change flow — now backed by motions.
//
// Endpoints below preserve their original shapes so the existing Settings UI
// still works, but every read/write goes through the generic motions tables
// (kind='stripe_config', voting rule = unanimous). Approval-time application
// of Stripe keys is handled inside `maybeFinalize` (see ../routes/motions.ts).

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  stripeConfigTable,
  motionsTable,
  motionVotesTable,
  type Motion,
  type MotionVote,
} from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { authenticateJwt, requireManager, requireManagerOrBoardMember, requireBoardMember } from "../middleware/auth.js";
import { isStripeConfigured, getPublishableKey, getWebhookSecret } from "../lib/stripe.js";
import { maybeFinalize } from "./motions.js";

const router: IRouter = Router();

function nowISO(): string { return new Date().toISOString(); }

function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}
function publishablePreview(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}

async function loadBoardMembers() {
  const rows = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, pending: usersTable.pending })
    .from(usersTable)
    .where(eq(usersTable.boardMember, true));
  return rows.filter((u) => !u.pending);
}

async function loadActiveConfigRow() {
  const [row] = await db.select().from(stripeConfigTable).where(eq(stripeConfigTable.id, 1));
  return row ?? null;
}

async function loadOpenStripeMotion(): Promise<Motion | null> {
  const [row] = await db.select().from(motionsTable)
    .where(and(eq(motionsTable.kind, "stripe_config"), eq(motionsTable.status, "open")))
    .orderBy(desc(motionsTable.createdAt))
    .limit(1);
  return row ?? null;
}

async function loadLatestStripeMotion(): Promise<Motion | null> {
  const [row] = await db.select().from(motionsTable)
    .where(eq(motionsTable.kind, "stripe_config"))
    .orderBy(desc(motionsTable.createdAt))
    .limit(1);
  return row ?? null;
}

function buildRequestSummary(
  motion: Motion,
  votes: MotionVote[],
  board: { id: number; name: string; email: string; role: string }[],
) {
  const payload = (motion.payload ?? {}) as { secretKey?: string | null; publishableKey?: string | null; webhookSecret?: string | null; reason?: string | null };
  const decisionsByUser = new Map<number, "approve" | "reject">();
  for (const v of votes) {
    if (v.decision === "approve" || v.decision === "reject") decisionsByUser.set(v.userId, v.decision);
  }
  const memberStatuses = board.map((m) => ({
    userId: m.id,
    name: m.name || m.email,
    role: m.role,
    decision: decisionsByUser.get(m.id) ?? null,
  }));
  // Map motion status back to legacy aliases the UI understands.
  const legacyStatus =
    motion.status === "open" ? "pending"
    : motion.status === "adopted" ? "applied"
    : motion.status === "rejected" ? "rejected"
    : motion.status === "withdrawn" ? "cancelled"
    : motion.status;
  return {
    id: motion.id,
    proposedByUserId: motion.createdByUserId,
    proposedByName: motion.createdByName,
    reason: payload.reason ?? null,
    createdAt: motion.createdAt,
    status: legacyStatus,
    fields: {
      secretKey: !!payload.secretKey,
      publishableKey: !!payload.publishableKey,
      webhookSecret: !!payload.webhookSecret,
    },
    proposedPublishablePreview: publishablePreview(payload.publishableKey),
    proposedSecretLast4: maskSecret(payload.secretKey),
    proposedWebhookSecretLast4: maskSecret(payload.webhookSecret),
    boardApprovals: memberStatuses,
    approvalsCount: memberStatuses.filter((m) => m.decision === "approve").length,
    rejectionsCount: memberStatuses.filter((m) => m.decision === "reject").length,
    boardMemberCount: board.length,
  };
}

// ── GET /settings/stripe ────────────────────────────────────────────────────
router.get("/settings/stripe", authenticateJwt, requireManagerOrBoardMember, async (_req: Request, res: Response) => {
  const [configRow, motion, latest, board] = await Promise.all([
    loadActiveConfigRow(),
    loadOpenStripeMotion(),
    loadLatestStripeMotion(),
    loadBoardMembers(),
  ]);
  const liveSecretConfigured = isStripeConfigured();
  const livePublishable = getPublishableKey();
  const liveWebhookSecret = getWebhookSecret();

  let pendingSummary = null as ReturnType<typeof buildRequestSummary> | null;
  if (motion) {
    const votes = await db.select().from(motionVotesTable).where(eq(motionVotesTable.motionId, motion.id));
    pendingSummary = buildRequestSummary(motion, votes, board);
  }

  // Surface the latest request so the members list can show per-user
  // approve/reject/pending status even after a rejection has finalized
  // the request. We expose pending requests and recently-rejected ones so
  // admins can see who rejected before re-proposing; applied/cancelled
  // requests are hidden because their decisions are no longer actionable.
  let latestSummary = null as ReturnType<typeof buildRequestSummary> | null;
  if (latest && (latest.status === "open" || latest.status === "rejected")) {
    const votes = await db.select().from(motionVotesTable).where(eq(motionVotesTable.motionId, latest.id));
    latestSummary = buildRequestSummary(latest, votes, board);
  }

  res.json({
    configured: liveSecretConfigured,
    secretKeyLast4: liveSecretConfigured ? "••••set" : null,
    publishableKeyPreview: publishablePreview(livePublishable),
    webhookSecretConfigured: !!liveWebhookSecret,
    lastUpdatedAt: configRow?.updatedAt ?? null,
    lastUpdatedByName: configRow?.updatedByName ?? null,
    boardMembers: board.map((m) => ({ id: m.id, name: m.name || m.email, role: m.role })),
    pendingRequest: pendingSummary,
    latestRequest: latestSummary,
  });
});

// ── POST /settings/stripe/requests ──────────────────────────────────────────
router.post("/settings/stripe/requests", authenticateJwt, requireManager, async (req, res) => {
  const body = req.body as { secretKey?: string; publishableKey?: string; webhookSecret?: string; reason?: string };
  const secretKey = body.secretKey?.trim() || null;
  const publishableKey = body.publishableKey?.trim() || null;
  const webhookSecret = body.webhookSecret?.trim() || null;
  if (!secretKey && !publishableKey && !webhookSecret) {
    res.status(400).json({ error: "Provide at least one of secretKey, publishableKey, webhookSecret" });
    return;
  }
  if (secretKey && !/^sk_(test|live)_/.test(secretKey)) {
    res.status(400).json({ error: "secretKey must start with sk_test_ or sk_live_" }); return;
  }
  if (publishableKey && !/^pk_(test|live)_/.test(publishableKey)) {
    res.status(400).json({ error: "publishableKey must start with pk_test_ or pk_live_" }); return;
  }
  if (webhookSecret && !/^whsec_/.test(webhookSecret)) {
    res.status(400).json({ error: "webhookSecret must start with whsec_" }); return;
  }
  const existing = await loadOpenStripeMotion();
  if (existing) {
    res.status(409).json({ error: "A pending Stripe key change already exists. Resolve it first.", pendingRequestId: existing.id });
    return;
  }
  const created = nowISO();
  const [row] = await db.insert(motionsTable).values({
    kind: "stripe_config",
    title: "Stripe key change",
    body: body.reason?.trim() || "",
    votingRule: { type: "unanimous" },
    status: "open",
    createdByUserId: req.user!.id,
    createdByName: req.user!.name || req.user!.email,
    createdAt: created,
    openedAt: created,
    payload: { secretKey, publishableKey, webhookSecret, reason: body.reason?.trim() || null },
  }).returning();

  // Auto-approve from the proposer when they themselves are a board member.
  const board = await loadBoardMembers();
  if (board.some((m) => m.id === req.user!.id)) {
    await db.insert(motionVotesTable).values({
      motionId: row!.id,
      userId: req.user!.id,
      userName: req.user!.name || req.user!.email,
      decision: "approve",
      createdAt: created,
    });
    await maybeFinalize(row!.id);
  }
  res.status(201).json({ ok: true, id: row!.id });
});

// ── POST /settings/stripe/requests/:id/decisions ────────────────────────────
router.post("/settings/stripe/requests/:id/decisions", authenticateJwt, requireBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid request id" }); return; }
  const decision = (req.body as { decision?: string })?.decision;
  if (decision !== "approve" && decision !== "reject") {
    res.status(400).json({ error: "decision must be 'approve' or 'reject'" }); return;
  }
  const [m] = await db.select().from(motionsTable).where(eq(motionsTable.id, id));
  if (!m || m.kind !== "stripe_config") { res.status(404).json({ error: "Request not found" }); return; }
  if (m.status !== "open") { res.status(409).json({ error: `Request is already ${m.status}` }); return; }

  // Replace any prior decision from this user.
  await db.delete(motionVotesTable).where(
    and(eq(motionVotesTable.motionId, id), eq(motionVotesTable.userId, req.user!.id)),
  );
  await db.insert(motionVotesTable).values({
    motionId: id,
    userId: req.user!.id,
    userName: req.user!.name || req.user!.email,
    decision,
    createdAt: nowISO(),
  });
  const after = await maybeFinalize(id);
  res.json({ ok: true, applied: after.outcome === "adopted", rejected: after.outcome === "rejected" });
});

// ── DELETE /settings/stripe/requests/:id ────────────────────────────────────
router.delete("/settings/stripe/requests/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid request id" }); return; }
  const [m] = await db.select().from(motionsTable).where(eq(motionsTable.id, id));
  if (!m || m.kind !== "stripe_config") { res.status(404).json({ error: "Request not found" }); return; }
  if (m.status !== "open") { res.status(409).json({ error: `Request is already ${m.status}` }); return; }
  if (m.createdByUserId !== req.user!.id && req.user!.role !== "admin") {
    res.status(403).json({ error: "Only the proposer or an admin may cancel a request" }); return;
  }
  await db.update(motionsTable).set({
    status: "withdrawn", outcome: "withdrawn", resolvedAt: nowISO(),
  }).where(eq(motionsTable.id, id));
  res.json({ ok: true });
});

export default router;
