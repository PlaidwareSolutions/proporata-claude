// Orchestration + persistence interfaces for the EV no-show forfeiture and
// refund flows. Splitting these out lets the scheduler and the refund route
// share the same logic (and lets the tests substitute an in-memory fake for
// the database without spinning up Postgres).

import type { ChargingPort, ChargingReservation, ChargingSession } from "@workspace/db/schema";
import { decideNoShow, validateRefundRequest } from "./chargingDecisions.js";

export interface Actor {
  id: number;
  email: string;
  name: string;
}

// ── No-show forfeiture ──────────────────────────────────────────────────

export interface NoShowFeeInput {
  ownerAccountId: number;
  occurredOn: string;
  postedAt: string;
  amountCents: number;
  memo: string;
  postedBy: number;
  batchRef: string;
}

export interface NoShowPersistence {
  listStalePendingReservations(now: string): Promise<ChargingReservation[]>;
  listPorts(): Promise<ChargingPort[]>;
  ensureOwnerAccount(unitId: string, now: string): Promise<{ id: number }>;
  insertNoShowFee(input: NoShowFeeInput): Promise<{ id: number }>;
  markReservationNoShow(reservationId: number, ledgerEntryId: number | null, now: string): Promise<void>;
  logError(err: unknown, ctx: { reservationId: number }): void;
}

export interface NoShowSummary {
  considered: number;
  skipped: number;
  forfeitedNoFee: number;
  forfeitedWithFee: number;
}

export async function processNoShowForfeitures(
  store: NoShowPersistence,
  now: Date,
): Promise<NoShowSummary> {
  const nowIso = now.toISOString();
  const summary: NoShowSummary = { considered: 0, skipped: 0, forfeitedNoFee: 0, forfeitedWithFee: 0 };
  const stale = await store.listStalePendingReservations(nowIso);
  if (stale.length === 0) return summary;
  const ports = await store.listPorts();
  const portById = new Map(ports.map((p) => [p.id, p]));
  for (const r of stale) {
    summary.considered += 1;
    const port = portById.get(r.portId);
    if (!port) { summary.skipped += 1; continue; }
    const decision = decideNoShow(
      { startsAt: r.startsAt, unitId: r.unitId ?? null },
      { noShowGraceMinutes: port.noShowGraceMinutes, noShowFeeCents: port.noShowFeeCents },
      now.getTime(),
    );
    if (decision.action === "skip") { summary.skipped += 1; continue; }
    let ledgerEntryId: number | null = null;
    if (decision.action === "forfeit_with_fee" && r.unitId) {
      try {
        const account = await store.ensureOwnerAccount(r.unitId, nowIso);
        const entry = await store.insertNoShowFee({
          ownerAccountId: account.id,
          occurredOn: nowIso.slice(0, 10),
          postedAt: nowIso,
          amountCents: decision.feeCents,
          memo: `EV no-show fee — ${port.name}`,
          postedBy: r.ownerUserId,
          batchRef: `ev-no-show-${r.id}`,
        });
        ledgerEntryId = entry.id;
        summary.forfeitedWithFee += 1;
      } catch (err) {
        store.logError(err, { reservationId: r.id });
        summary.forfeitedNoFee += 1;
      }
    } else {
      summary.forfeitedNoFee += 1;
    }
    await store.markReservationNoShow(r.id, ledgerEntryId, nowIso);
  }
  return summary;
}

// ── Refund flow ─────────────────────────────────────────────────────────

export interface RefundLedgerInput {
  ownerAccountId: number;
  occurredOn: string;
  postedAt: string;
  amountCents: number; // already negative
  memo: string;
  postedBy: number;
  voidsEntryId: number | null;
  batchRef: string;
}

export interface RefundPersistence {
  getSession(id: number): Promise<ChargingSession | null>;
  ensureOwnerAccount(unitId: string, now: string): Promise<{ id: number }>;
  insertRefundEntry(input: RefundLedgerInput): Promise<{ id: number }>;
  markSessionRefunded(sessionId: number, refundLedgerEntryId: number, reason: string, now: string): Promise<ChargingSession>;
  recordAudit(sessionId: number, action: string, actor: Actor | null, diff: unknown): Promise<void>;
}

export interface RefundRequestBody {
  amountCents?: number | null;
  reason?: string | null;
}

export type RefundResult =
  | { ok: true; session: ChargingSession; refundLedgerEntryId: number; amountCents: number }
  | { ok: false; status: number; error: string };

export async function processRefund(
  store: RefundPersistence,
  sessionId: number,
  body: RefundRequestBody,
  actor: Actor,
  now: Date,
): Promise<RefundResult> {
  const session = await store.getSession(sessionId);
  if (!session) return { ok: false, status: 404, error: "Not found" };
  const validation = validateRefundRequest(
    {
      status: session.status,
      refundLedgerEntryId: session.refundLedgerEntryId ?? null,
      costCents: session.costCents,
      unitId: session.unitId ?? null,
    },
    typeof body.amountCents === "number" ? body.amountCents : null,
  );
  if (!validation.ok) return { ok: false, status: validation.status, error: validation.error };
  const amount = validation.amountCents;
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : "";
  const nowIso = now.toISOString();
  // session.unitId is non-null here (validateRefundRequest guarantees it)
  const account = await store.ensureOwnerAccount(session.unitId!, nowIso);
  const refund = await store.insertRefundEntry({
    ownerAccountId: account.id,
    occurredOn: nowIso.slice(0, 10),
    postedAt: nowIso,
    amountCents: -amount, // refund inverts the original charge
    memo: `EV charging refund — session #${session.id}${reason ? ` · ${reason}` : ""}`,
    postedBy: actor.id,
    voidsEntryId: session.ledgerEntryId ?? null,
    batchRef: `ev-refund-${session.id}`,
  });
  const updated = await store.markSessionRefunded(session.id, refund.id, reason, nowIso);
  await store.recordAudit(session.id, "refunded", actor, {
    amountCents: amount,
    reason,
    refundLedgerEntryId: refund.id,
  });
  return { ok: true, session: updated, refundLedgerEntryId: refund.id, amountCents: amount };
}
