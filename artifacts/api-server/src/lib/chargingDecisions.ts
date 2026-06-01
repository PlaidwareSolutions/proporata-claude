// Pure decision helpers for the EV charging flow. Kept free of database or
// network side-effects so they can be unit-tested without spinning up a
// Postgres instance — the scheduler and the refund route import these and
// wrap them with the actual persistence calls.

export interface NoShowReservationInput {
  startsAt: string;
  unitId: string | null;
}

export interface NoShowPortInput {
  noShowGraceMinutes: number;
  noShowFeeCents: number;
}

export type NoShowDecision =
  | { action: "skip"; reason: "within_grace" }
  | { action: "forfeit_no_fee"; reason: "fee_disabled" | "no_unit" }
  | { action: "forfeit_with_fee"; feeCents: number };

export function decideNoShow(
  reservation: NoShowReservationInput,
  port: NoShowPortInput,
  nowMs: number,
): NoShowDecision {
  const graceMs = Math.max(0, port.noShowGraceMinutes) * 60 * 1000;
  const startedMs = new Date(reservation.startsAt).getTime();
  if (!Number.isFinite(startedMs) || nowMs - startedMs < graceMs) {
    return { action: "skip", reason: "within_grace" };
  }
  if (port.noShowFeeCents > 0 && reservation.unitId) {
    return { action: "forfeit_with_fee", feeCents: port.noShowFeeCents };
  }
  if (port.noShowFeeCents <= 0) return { action: "forfeit_no_fee", reason: "fee_disabled" };
  return { action: "forfeit_no_fee", reason: "no_unit" };
}

export interface RefundSessionInput {
  status: string;
  refundLedgerEntryId: number | null;
  costCents: number;
  unitId: string | null;
}

export type RefundValidation =
  | { ok: true; amountCents: number }
  | { ok: false; status: number; error: string };

export function validateRefundRequest(
  session: RefundSessionInput,
  requestedAmountCents: number | null | undefined,
): RefundValidation {
  if (session.status !== "billed") {
    return { ok: false, status: 400, error: "Only billed sessions can be refunded" };
  }
  if (session.refundLedgerEntryId) {
    return { ok: false, status: 400, error: "Already refunded" };
  }
  if (!session.unitId) {
    return { ok: false, status: 400, error: "Session has no unit" };
  }
  const amount = typeof requestedAmountCents === "number"
    ? Math.max(0, Math.floor(requestedAmountCents))
    : session.costCents;
  if (amount <= 0 || amount > session.costCents) {
    return { ok: false, status: 400, error: "Invalid refund amount" };
  }
  return { ok: true, amountCents: amount };
}
