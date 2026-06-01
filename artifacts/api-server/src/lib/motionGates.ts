// Task #64: Board spending and policy gates.
//
// Helpers for routes that gate sensitive actions behind an Adopted motion (or
// a recorded emergency bypass). Routes typically:
//   1. Look up the org settings to decide whether the gate applies.
//   2. Call `findAdoptedAuth` to find an Adopted motion or pending bypass.
//   3. If neither exists, return 409 with a structured payload the UI uses
//      to surface "Open motion" / "Awaiting motion #N" affordances.

import { db } from "@workspace/db";
import {
  motionsTable,
  emergencyBypassesTable,
  organizationSettingsTable,
} from "@workspace/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";

export type GateTargetType =
  | "work_order"
  | "bid_award"
  | "special_assessment"
  | "policy";

export interface GateAuth {
  /** The motion id whose adoption authorizes the action. */
  motionId: number | null;
  /** The bypass record id (admin emergency override) authorizing the action. */
  bypassId: number | null;
  /** True when the caller may proceed with the action. */
  authorized: boolean;
  /** Open-but-not-resolved motion already proposed for this target, if any. */
  pendingMotionId: number | null;
}

export interface OrgGovernanceSettings {
  expenditureThresholdCents: number;
  gatedPolicies: string[];
  emergencyBypassEnabled: boolean;
}

export async function loadGovernanceSettings(): Promise<OrgGovernanceSettings> {
  const [row] = await db
    .select()
    .from(organizationSettingsTable)
    .where(eq(organizationSettingsTable.id, 1));
  return {
    expenditureThresholdCents: row?.expenditureThresholdCents ?? 0,
    gatedPolicies: (row?.gatedPolicies as string[] | null) ?? [],
    emergencyBypassEnabled: !!row?.emergencyBypassEnabled,
  };
}

/**
 * Look up an Adopted motion whose `payload.targetType` and `payload.targetId`
 * match. Routes pass the proposed target identifier; for "create" actions
 * before the row exists we use a synthetic identifier (e.g. a hash of the
 * proposed payload, or the bid id whose award is being authorized).
 */
export async function findAdoptedMotionFor(
  targetType: GateTargetType,
  targetId: string,
): Promise<number | null> {
  const rows = await db
    .select({ id: motionsTable.id })
    .from(motionsTable)
    .where(
      and(
        eq(motionsTable.status, "adopted"),
        sql`${motionsTable.payload}->>'targetType' = ${targetType}`,
        sql`${motionsTable.payload}->>'targetId' = ${targetId}`,
      ),
    )
    .orderBy(desc(motionsTable.resolvedAt));
  return rows[0]?.id ?? null;
}

/** Find any motion proposed for this target that is still pending (draft or open). */
export async function findPendingMotionFor(
  targetType: GateTargetType,
  targetId: string,
): Promise<number | null> {
  const rows = await db
    .select({ id: motionsTable.id, status: motionsTable.status })
    .from(motionsTable)
    .where(
      and(
        sql`${motionsTable.payload}->>'targetType' = ${targetType}`,
        sql`${motionsTable.payload}->>'targetId' = ${targetId}`,
      ),
    )
    .orderBy(desc(motionsTable.createdAt));
  for (const r of rows) {
    if (r.status === "draft" || r.status === "open") return r.id;
  }
  return null;
}

/**
 * Look for a bypass that authorizes the action. Bypasses are single-use:
 * once `consumedAt` is set the bypass cannot authorize another action.
 */
export async function findUnconsumedBypassFor(
  targetType: GateTargetType,
  targetId: string,
  bypassId: number,
): Promise<{ id: number } | null> {
  const [row] = await db
    .select()
    .from(emergencyBypassesTable)
    .where(
      and(
        eq(emergencyBypassesTable.id, bypassId),
        eq(emergencyBypassesTable.targetType, targetType),
        eq(emergencyBypassesTable.targetId, targetId),
      ),
    );
  if (!row) return null;
  if (row.consumedAt) return null;
  return { id: row.id };
}

export async function markBypassConsumed(bypassId: number): Promise<void> {
  await db
    .update(emergencyBypassesTable)
    .set({ consumedAt: new Date().toISOString() })
    .where(eq(emergencyBypassesTable.id, bypassId));
}

/**
 * Validate that the supplied motionId actually authorizes the target. Returns
 * the row if everything matches, otherwise a string error reason.
 */
export async function validateMotionAuthorizes(opts: {
  motionId: number;
  expectedKind: "expenditure" | "policy_change";
  targetType: GateTargetType;
  targetId: string;
  /** When provided, the motion's amountCents must be >= this. */
  minAmountCents?: number;
}): Promise<{ ok: true; motionId: number } | { ok: false; reason: string }> {
  const [m] = await db.select().from(motionsTable).where(eq(motionsTable.id, opts.motionId));
  if (!m) return { ok: false, reason: "Motion not found" };
  if (m.kind !== opts.expectedKind) {
    return { ok: false, reason: `Motion #${m.id} is ${m.kind}, not ${opts.expectedKind}` };
  }
  if (m.status !== "adopted") {
    return { ok: false, reason: `Motion #${m.id} is ${m.status}; only Adopted motions authorize this action` };
  }
  const payload = (m.payload ?? {}) as Record<string, unknown>;
  if (payload["targetType"] !== opts.targetType || String(payload["targetId"] ?? "") !== opts.targetId) {
    return { ok: false, reason: `Motion #${m.id} does not reference this target` };
  }
  if (opts.minAmountCents !== undefined) {
    const amt = Number(payload["amountCents"] ?? 0);
    if (!Number.isFinite(amt) || amt < opts.minAmountCents) {
      return { ok: false, reason: `Motion #${m.id} authorizes only $${(amt / 100).toFixed(2)} but action requires $${(opts.minAmountCents / 100).toFixed(2)}` };
    }
  }
  return { ok: true, motionId: m.id };
}

export interface GateRequiredError {
  status: 409;
  body: {
    error: "motion_required";
    reason: string;
    targetType: GateTargetType;
    targetId: string;
    motionKind: "expenditure" | "policy_change";
    pendingMotionId: number | null;
    helperEndpoint: string;
  };
}

export function gateRequiredError(opts: {
  reason: string;
  targetType: GateTargetType;
  targetId: string;
  motionKind: "expenditure" | "policy_change";
  pendingMotionId: number | null;
}): GateRequiredError {
  const helperEndpoint = opts.motionKind === "expenditure"
    ? "/api/governance/expenditure-motion"
    : "/api/governance/policy-proposal";
  return {
    status: 409,
    body: {
      error: "motion_required",
      reason: opts.reason,
      targetType: opts.targetType,
      targetId: opts.targetId,
      motionKind: opts.motionKind,
      pendingMotionId: opts.pendingMotionId,
      helperEndpoint,
    },
  };
}
