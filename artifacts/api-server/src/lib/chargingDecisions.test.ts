import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideNoShow, validateRefundRequest } from "./chargingDecisions.js";

const baseStartsAt = "2025-01-01T12:00:00Z";
const baseStartMs = new Date(baseStartsAt).getTime();

describe("decideNoShow", () => {
  it("skips while still inside the per-port grace window", () => {
    const out = decideNoShow(
      { startsAt: baseStartsAt, unitId: "A-101" },
      { noShowGraceMinutes: 15, noShowFeeCents: 500 },
      baseStartMs + 14 * 60 * 1000,
    );
    assert.deepEqual(out, { action: "skip", reason: "within_grace" });
  });

  it("treats the grace boundary as strictly less-than: 1ms before skips, exactly at forfeits", () => {
    const justBefore = decideNoShow(
      { startsAt: baseStartsAt, unitId: "A-101" },
      { noShowGraceMinutes: 15, noShowFeeCents: 500 },
      baseStartMs + 15 * 60 * 1000 - 1,
    );
    assert.equal(justBefore.action, "skip", "1ms before grace expiry should still skip");
    const exactlyAt = decideNoShow(
      { startsAt: baseStartsAt, unitId: "A-101" },
      { noShowGraceMinutes: 15, noShowFeeCents: 500 },
      baseStartMs + 15 * 60 * 1000,
    );
    assert.equal(exactlyAt.action, "forfeit_with_fee", "exactly at grace expiry should forfeit");
  });

  it("forfeits with the configured fee once grace has elapsed", () => {
    const out = decideNoShow(
      { startsAt: baseStartsAt, unitId: "A-101" },
      { noShowGraceMinutes: 15, noShowFeeCents: 500 },
      baseStartMs + 16 * 60 * 1000,
    );
    assert.deepEqual(out, { action: "forfeit_with_fee", feeCents: 500 });
  });

  it("forfeits without a fee when the port has no fee configured", () => {
    const out = decideNoShow(
      { startsAt: baseStartsAt, unitId: "A-101" },
      { noShowGraceMinutes: 15, noShowFeeCents: 0 },
      baseStartMs + 60 * 60 * 1000,
    );
    assert.deepEqual(out, { action: "forfeit_no_fee", reason: "fee_disabled" });
  });

  it("forfeits without a fee when the reservation has no unit to bill", () => {
    const out = decideNoShow(
      { startsAt: baseStartsAt, unitId: null },
      { noShowGraceMinutes: 15, noShowFeeCents: 500 },
      baseStartMs + 60 * 60 * 1000,
    );
    assert.deepEqual(out, { action: "forfeit_no_fee", reason: "no_unit" });
  });

  it("treats negative grace as zero", () => {
    const out = decideNoShow(
      { startsAt: baseStartsAt, unitId: "A-101" },
      { noShowGraceMinutes: -10, noShowFeeCents: 200 },
      baseStartMs + 1,
    );
    assert.equal(out.action, "forfeit_with_fee");
  });

  it("skips silently on an invalid startsAt rather than charging", () => {
    const out = decideNoShow(
      { startsAt: "not-a-date", unitId: "A-101" },
      { noShowGraceMinutes: 15, noShowFeeCents: 500 },
      baseStartMs,
    );
    assert.equal(out.action, "skip");
  });
});

describe("validateRefundRequest", () => {
  const billed = {
    status: "billed",
    refundLedgerEntryId: null,
    costCents: 1500,
    unitId: "A-101",
  };

  it("defaults to a full refund when no amount is provided", () => {
    const v = validateRefundRequest(billed, null);
    assert.deepEqual(v, { ok: true, amountCents: 1500 });
  });

  it("accepts a partial refund within the cost", () => {
    const v = validateRefundRequest(billed, 500);
    assert.deepEqual(v, { ok: true, amountCents: 500 });
  });

  it("rejects a refund that exceeds the original charge (no inverted/over-refund)", () => {
    const v = validateRefundRequest(billed, 1501);
    assert.deepEqual(v, { ok: false, status: 400, error: "Invalid refund amount" });
  });

  it("rejects a zero refund", () => {
    const v = validateRefundRequest(billed, 0);
    assert.equal(v.ok, false);
  });

  it("rejects a negative refund (refund inversion guard)", () => {
    const v = validateRefundRequest(billed, -50);
    assert.equal(v.ok, false);
  });

  it("rejects a session that is not billed", () => {
    const v = validateRefundRequest({ ...billed, status: "active" }, 100);
    assert.deepEqual(v, { ok: false, status: 400, error: "Only billed sessions can be refunded" });
  });

  it("rejects a session that has already been refunded", () => {
    const v = validateRefundRequest({ ...billed, refundLedgerEntryId: 42 }, 100);
    assert.deepEqual(v, { ok: false, status: 400, error: "Already refunded" });
  });

  it("rejects a session with no unit", () => {
    const v = validateRefundRequest({ ...billed, unitId: null }, 100);
    assert.deepEqual(v, { ok: false, status: 400, error: "Session has no unit" });
  });

  it("floors fractional cent amounts before validating", () => {
    const v = validateRefundRequest(billed, 499.9);
    assert.deepEqual(v, { ok: true, amountCents: 499 });
  });
});
