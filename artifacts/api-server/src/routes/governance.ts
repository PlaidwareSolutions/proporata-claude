// Task #64: Board spending and policy gates — REST routes.
//
// Two convenience endpoints build correctly-shaped motions for the gated
// actions (expenditure / policy_change). A third endpoint records an
// admin-initiated emergency bypass and auto-creates the retroactive
// ratification motion that the board votes on after the fact.

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  motionsTable,
  emergencyBypassesTable,
  organizationSettingsTable,
  type MotionVotingRule,
} from "@workspace/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  authenticateJwt,
  requireAdmin,
  requireManagerOrBoardMember,
} from "../middleware/auth.js";
import {
  findAdoptedMotionFor,
  findPendingMotionFor,
  loadGovernanceSettings,
  type GateTargetType,
} from "../lib/motionGates.js";

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

function isValidTargetType(t: unknown): t is GateTargetType {
  return t === "work_order" || t === "bid_award" || t === "special_assessment" || t === "policy";
}

// ── Expenditure motion helper ───────────────────────────────────────────────
// Used by Create-Work-Order and Bid-Award flows to spin up a draft motion
// referencing the proposed expenditure. The caller can then open it for vote
// via the existing /api/motions/:id/open route.
router.post("/governance/expenditure-motion", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const body = req.body as {
    targetType?: string;
    targetId?: string;
    amountCents?: number;
    summary?: string;
    body?: string;
    vendorId?: number;
    vendorName?: string;
    votingRule?: unknown;
    closesAt?: string;
  };
  if (!isValidTargetType(body.targetType)) { res.status(400).json({ error: "targetType must be work_order or bid_award" }); return; }
  if (body.targetType !== "work_order" && body.targetType !== "bid_award") {
    res.status(400).json({ error: "Expenditure motions only target work_order or bid_award" });
    return;
  }
  if (!body.targetId || typeof body.targetId !== "string") { res.status(400).json({ error: "targetId required" }); return; }
  const amt = Number(body.amountCents);
  if (!Number.isFinite(amt) || amt <= 0) { res.status(400).json({ error: "amountCents must be a positive integer" }); return; }
  const summary = (body.summary ?? "").trim();
  if (!summary) { res.status(400).json({ error: "summary required" }); return; }
  const rule = parseRule(body.votingRule) ?? { type: "majority" };

  const title = `Authorize expenditure: ${summary}`;
  const motionBody = body.body?.trim() || [
    `The board authorizes an expenditure of $${(amt / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} for ${summary}.`,
    body.vendorName ? `Vendor: ${body.vendorName}.` : "",
    `Target: ${body.targetType} ${body.targetId}.`,
  ].filter(Boolean).join("\n\n");

  const [row] = await db.insert(motionsTable).values({
    kind: "expenditure",
    title,
    body: motionBody,
    votingRule: rule,
    status: "draft",
    createdByUserId: req.user!.id,
    createdByName: req.user!.name || req.user!.email,
    createdAt: nowISO(),
    closesAt: body.closesAt ?? null,
    payload: {
      targetType: body.targetType,
      targetId: body.targetId,
      amountCents: amt,
      summary,
      vendorId: body.vendorId ?? null,
      vendorName: body.vendorName ?? null,
    },
  }).returning();
  res.status(201).json({ id: row!.id });
});

// ── Policy proposal helper ──────────────────────────────────────────────────
router.post("/governance/policy-proposal", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const body = req.body as {
    policyKey?: string;
    currentValue?: unknown;
    newValue?: unknown;
    summary?: string;
    body?: string;
    votingRule?: unknown;
    closesAt?: string;
    targetType?: string;
    targetId?: string;
  };
  const policyKey = (body.policyKey ?? "").trim();
  if (!policyKey) { res.status(400).json({ error: "policyKey required" }); return; }
  const summary = (body.summary ?? `Update ${policyKey}`).trim();
  const rule = parseRule(body.votingRule) ?? { type: "majority" };
  const targetType: GateTargetType = isValidTargetType(body.targetType) ? body.targetType : "policy";
  const targetId = body.targetId && typeof body.targetId === "string" && body.targetId.trim()
    ? body.targetId.trim()
    : `policy:${policyKey}`;

  const motionBody = body.body?.trim() || [
    `The board adopts the following change to ${policyKey}:`,
    `From: ${JSON.stringify(body.currentValue ?? null)}`,
    `To:   ${JSON.stringify(body.newValue ?? null)}`,
  ].join("\n");

  const [row] = await db.insert(motionsTable).values({
    kind: "policy_change",
    title: summary,
    body: motionBody,
    votingRule: rule,
    status: "draft",
    createdByUserId: req.user!.id,
    createdByName: req.user!.name || req.user!.email,
    createdAt: nowISO(),
    closesAt: body.closesAt ?? null,
    payload: {
      targetType,
      targetId,
      policyKey,
      currentValue: body.currentValue ?? null,
      newValue: body.newValue ?? null,
    },
  }).returning();
  res.status(201).json({ id: row!.id });
});

// ── Gate state lookup ───────────────────────────────────────────────────────
router.get("/governance/gates/:targetType/:targetId", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const targetType = req.params.targetType as string;
  const targetId = req.params.targetId as string;
  if (!isValidTargetType(targetType)) { res.status(400).json({ error: "Invalid targetType" }); return; }
  const adopted = await findAdoptedMotionFor(targetType, targetId);
  const pending = await findPendingMotionFor(targetType, targetId);
  // Bypasses for this target that are still active (not consumed) authorize
  // the action once the manager retries the call. Surface those too.
  const bypasses = await db
    .select()
    .from(emergencyBypassesTable)
    .where(and(eq(emergencyBypassesTable.targetType, targetType), eq(emergencyBypassesTable.targetId, targetId)))
    .orderBy(desc(emergencyBypassesTable.createdAt));
  res.json({
    targetType,
    targetId,
    adoptedMotionId: adopted,
    pendingMotionId: pending,
    bypasses: bypasses.map((b) => ({
      id: b.id,
      action: b.action,
      reason: b.reason,
      ratificationMotionId: b.ratificationMotionId,
      ratificationStatus: b.ratificationStatus,
      reversalRequired: b.reversalRequired,
      consumedAt: b.consumedAt,
      createdAt: b.createdAt,
      byUserName: b.byUserName,
    })),
  });
});

// ── Emergency bypass (admin only) ───────────────────────────────────────────
// Records a bypass and auto-creates a retroactive ratification motion. The
// caller then re-tries the gated action passing `bypassId` instead of
// `motionId`. If the ratification motion is rejected, the bypass is flagged
// for reversal in the admin task list.
router.post("/governance/bypass", authenticateJwt, requireAdmin, async (req, res) => {
  const body = req.body as {
    targetType?: string;
    targetId?: string;
    action?: string;
    reason?: string;
    payload?: unknown;
    votingRule?: unknown;
    closesAt?: string;
  };
  if (!isValidTargetType(body.targetType)) { res.status(400).json({ error: "Invalid targetType" }); return; }
  if (!body.targetId) { res.status(400).json({ error: "targetId required" }); return; }
  const reason = (body.reason ?? "").trim();
  if (!reason) { res.status(400).json({ error: "reason required" }); return; }
  const action = (body.action ?? "").trim() || `${body.targetType}:bypass`;

  const settings = await loadGovernanceSettings();
  if (!settings.emergencyBypassEnabled) {
    res.status(409).json({ error: "Emergency bypass is disabled in Settings → Governance" });
    return;
  }

  const rule = parseRule(body.votingRule) ?? { type: "majority" };
  const created = nowISO();

  const result = await db.transaction(async (tx) => {
    const [bypass] = await tx
      .insert(emergencyBypassesTable)
      .values({
        targetType: body.targetType!,
        targetId: body.targetId!,
        action,
        reason,
        byUserId: req.user!.id,
        byUserName: req.user!.name || req.user!.email,
        payload: (body.payload ?? null) as object | null,
        createdAt: created,
      })
      .returning();
    const [motion] = await tx
      .insert(motionsTable)
      .values({
        kind: "policy_change",
        title: `Ratify emergency action: ${action}`,
        body: [
          `On ${created.slice(0, 10)}, ${req.user!.name || req.user!.email} took the following action under emergency bypass:`,
          `  • Target: ${body.targetType} ${body.targetId}`,
          `  • Action: ${action}`,
          `  • Reason: ${reason}`,
          ``,
          `The board is asked to ratify this action retroactively. If rejected, the action will be flagged for reversal in the admin task list.`,
        ].join("\n"),
        votingRule: rule,
        status: "open",
        openedAt: created,
        closesAt: body.closesAt ?? null,
        createdByUserId: req.user!.id,
        createdByName: req.user!.name || req.user!.email,
        createdAt: created,
        payload: {
          targetType: body.targetType,
          targetId: body.targetId,
          ratification: true,
          bypassId: bypass!.id,
          action,
        },
      })
      .returning();
    await tx
      .update(emergencyBypassesTable)
      .set({ ratificationMotionId: motion!.id })
      .where(eq(emergencyBypassesTable.id, bypass!.id));
    return { bypassId: bypass!.id, ratificationMotionId: motion!.id };
  });
  res.status(201).json(result);
});

// ── Bypass list (admin task list) ───────────────────────────────────────────
router.get("/governance/bypasses", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const where = [];
  if (req.query.reversalRequired === "true") {
    where.push(eq(emergencyBypassesTable.reversalRequired, true));
  }
  const rows = await db
    .select()
    .from(emergencyBypassesTable)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(emergencyBypassesTable.createdAt));
  res.json(rows.map((b) => ({
    id: b.id,
    targetType: b.targetType,
    targetId: b.targetId,
    action: b.action,
    reason: b.reason,
    byUserId: b.byUserId,
    byUserName: b.byUserName,
    ratificationMotionId: b.ratificationMotionId,
    ratificationStatus: b.ratificationStatus,
    reversalRequired: b.reversalRequired,
    consumedAt: b.consumedAt,
    createdAt: b.createdAt,
    payload: b.payload,
  })));
  void sql; // silence unused import — kept for parity with motions.ts
});

// ── Settings: governance config ─────────────────────────────────────────────
// Read+write the gate-related settings. Writes go directly because changing
// the gate config itself is intentionally exempt from the gate (chicken/egg).
router.get("/governance/settings", authenticateJwt, requireManagerOrBoardMember, async (_req, res) => {
  const s = await loadGovernanceSettings();
  res.json(s);
});

router.patch("/governance/settings", authenticateJwt, requireAdmin, async (req, res) => {
  const body = req.body as {
    expenditureThresholdCents?: number;
    gatedPolicies?: unknown;
    emergencyBypassEnabled?: boolean;
  };
  const patch: Record<string, unknown> = {};
  if (typeof body.expenditureThresholdCents === "number" && Number.isFinite(body.expenditureThresholdCents)) {
    patch.expenditureThresholdCents = Math.max(0, Math.floor(body.expenditureThresholdCents));
  }
  if (Array.isArray(body.gatedPolicies)) {
    patch.gatedPolicies = (body.gatedPolicies as unknown[])
      .map((v) => String(v))
      .filter((s) => s.length > 0);
  }
  if (typeof body.emergencyBypassEnabled === "boolean") {
    patch.emergencyBypassEnabled = body.emergencyBypassEnabled;
  }
  if (Object.keys(patch).length === 0) {
    const s = await loadGovernanceSettings();
    res.json(s);
    return;
  }
  // Ensure the singleton row exists.
  const [row] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  if (!row) {
    await db.insert(organizationSettingsTable).values({ id: 1, name: "" });
  }
  await db
    .update(organizationSettingsTable)
    .set(patch)
    .where(eq(organizationSettingsTable.id, 1));
  const s = await loadGovernanceSettings();
  res.json(s);
});

export default router;
