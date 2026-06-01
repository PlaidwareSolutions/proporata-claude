// Integration tests for the EV no-show forfeiture and refund flows.
// We exercise the real orchestration (`processNoShowForfeitures`,
// `processRefund`) against in-memory fake stores so the full sequence of
// reads/inserts/updates and audit logging is observable, without needing
// a Postgres instance in CI.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  ChargingPort,
  ChargingReservation,
  ChargingSession,
} from "@workspace/db/schema";
import {
  processNoShowForfeitures,
  processRefund,
  type Actor,
  type NoShowFeeInput,
  type NoShowPersistence,
  type RefundLedgerInput,
  type RefundPersistence,
} from "./chargingPersistence.js";

// ── Helpers ────────────────────────────────────────────────────────────

function makePort(overrides: Partial<ChargingPort> = {}): ChargingPort {
  return {
    id: 1,
    amenityId: 1,
    name: "Bay 1",
    location: "",
    connectorType: "J1772",
    maxKw: 7,
    mode: "reserved",
    provider: "manual",
    providerConfig: {},
    perKwhCents: 35,
    idlePerMinuteCents: 40,
    idleGraceMinutes: 10,
    idleCapCents: 2000,
    noShowFeeCents: 500,
    noShowGraceMinutes: 15,
    enabled: true,
    sortOrder: 0,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeReservation(overrides: Partial<ChargingReservation> = {}): ChargingReservation {
  return {
    id: 1,
    portId: 1,
    ownerUserId: 42,
    unitId: "A-101",
    startsAt: "2025-01-01T12:00:00Z",
    endsAt: "2025-01-01T13:00:00Z",
    status: "pending",
    sessionId: null,
    noShowFeeLedgerEntryId: null,
    cancelledAt: null,
    createdAt: "2025-01-01T11:00:00Z",
    updatedAt: "2025-01-01T11:00:00Z",
    ...overrides,
  };
}

function makeSession(overrides: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 1,
    portId: 1,
    reservationId: null,
    ownerUserId: 42,
    unitId: "A-101",
    startAt: "2025-01-01T12:00:00Z",
    endAt: "2025-01-01T13:00:00Z",
    scheduledEndAt: "2025-01-01T13:00:00Z",
    kwh: "10.0000",
    meterStartKwh: null,
    meterEndKwh: null,
    energyCostCents: 350,
    idleMinutes: 0,
    idleCostCents: 0,
    costCents: 1500,
    status: "billed",
    providerSessionRef: null,
    ledgerEntryId: 999,
    refundLedgerEntryId: null,
    refundReason: null,
    lastPolledAt: null,
    createdAt: "2025-01-01T12:00:00Z",
    updatedAt: "2025-01-01T13:00:00Z",
    ...overrides,
  };
}

interface NoShowSpy {
  store: NoShowPersistence;
  ownerAccounts: Map<string, { id: number }>;
  feeEntries: NoShowFeeInput[];
  reservationUpdates: Array<{ reservationId: number; ledgerEntryId: number | null; now: string }>;
  errors: Array<{ err: unknown; reservationId: number }>;
}

function makeNoShowStore(opts: {
  reservations: ChargingReservation[];
  ports: ChargingPort[];
  failInsertFee?: boolean;
}): NoShowSpy {
  const ownerAccounts = new Map<string, { id: number }>();
  const feeEntries: NoShowFeeInput[] = [];
  const reservationUpdates: Array<{ reservationId: number; ledgerEntryId: number | null; now: string }> = [];
  const errors: Array<{ err: unknown; reservationId: number }> = [];
  let nextAccountId = 100;
  let nextEntryId = 5000;
  const store: NoShowPersistence = {
    async listStalePendingReservations(now) {
      return opts.reservations.filter((r) => r.status === "pending" && r.startsAt < now);
    },
    async listPorts() { return opts.ports; },
    async ensureOwnerAccount(unitId) {
      const existing = ownerAccounts.get(unitId);
      if (existing) return existing;
      const acct = { id: nextAccountId++ };
      ownerAccounts.set(unitId, acct);
      return acct;
    },
    async insertNoShowFee(input) {
      if (opts.failInsertFee) throw new Error("ledger insert failed");
      feeEntries.push(input);
      return { id: nextEntryId++ };
    },
    async markReservationNoShow(reservationId, ledgerEntryId, now) {
      reservationUpdates.push({ reservationId, ledgerEntryId, now });
    },
    logError(err, ctx) { errors.push({ err, reservationId: ctx.reservationId }); },
  };
  return { store, ownerAccounts, feeEntries, reservationUpdates, errors };
}

// ── No-show integration tests ──────────────────────────────────────────

describe("processNoShowForfeitures (integration)", () => {
  it("posts a no-show fee and marks the reservation when grace has elapsed", async () => {
    const port = makePort({ noShowFeeCents: 500, noShowGraceMinutes: 15 });
    const resv = makeReservation({ id: 7, portId: port.id, unitId: "B-202", ownerUserId: 9, startsAt: "2025-01-01T12:00:00Z" });
    const spy = makeNoShowStore({ reservations: [resv], ports: [port] });

    // 20 minutes after start (past 15min grace).
    const now = new Date("2025-01-01T12:20:00Z");
    const summary = await processNoShowForfeitures(spy.store, now);

    assert.deepEqual(summary, { considered: 1, skipped: 0, forfeitedNoFee: 0, forfeitedWithFee: 1 });
    assert.equal(spy.feeEntries.length, 1);
    const fee = spy.feeEntries[0];
    assert.equal(fee.amountCents, 500);
    assert.equal(fee.memo, "EV no-show fee — Bay 1");
    assert.equal(fee.batchRef, "ev-no-show-7");
    assert.equal(fee.postedBy, 9);
    assert.equal(fee.occurredOn, "2025-01-01");
    assert.equal(fee.postedAt, "2025-01-01T12:20:00.000Z");
    assert.equal(spy.ownerAccounts.get("B-202")?.id, 100);
    assert.equal(spy.reservationUpdates.length, 1);
    assert.equal(spy.reservationUpdates[0].reservationId, 7);
    assert.equal(spy.reservationUpdates[0].ledgerEntryId, 5000);
  });

  it("skips reservations that are still inside the grace window (no fee, no status change)", async () => {
    const port = makePort({ noShowGraceMinutes: 15, noShowFeeCents: 500 });
    const resv = makeReservation({ startsAt: "2025-01-01T12:00:00Z" });
    const spy = makeNoShowStore({ reservations: [resv], ports: [port] });

    // 10 minutes after start (still inside 15min grace).
    const summary = await processNoShowForfeitures(spy.store, new Date("2025-01-01T12:10:00Z"));

    assert.deepEqual(summary, { considered: 1, skipped: 1, forfeitedNoFee: 0, forfeitedWithFee: 0 });
    assert.equal(spy.feeEntries.length, 0);
    assert.equal(spy.reservationUpdates.length, 0);
    assert.equal(spy.ownerAccounts.size, 0);
  });

  it("forfeits without a fee when the port has no-show fee disabled", async () => {
    const port = makePort({ noShowFeeCents: 0, noShowGraceMinutes: 15 });
    const resv = makeReservation({ id: 11 });
    const spy = makeNoShowStore({ reservations: [resv], ports: [port] });

    const summary = await processNoShowForfeitures(spy.store, new Date("2025-01-01T12:30:00Z"));

    assert.deepEqual(summary, { considered: 1, skipped: 0, forfeitedNoFee: 1, forfeitedWithFee: 0 });
    assert.equal(spy.feeEntries.length, 0, "no fee entry should be posted when fee is 0");
    assert.equal(spy.reservationUpdates.length, 1);
    assert.equal(spy.reservationUpdates[0].ledgerEntryId, null);
  });

  it("forfeits without a fee when the reservation has no unit to bill", async () => {
    const port = makePort({ noShowFeeCents: 500, noShowGraceMinutes: 15 });
    const resv = makeReservation({ id: 12, unitId: null });
    const spy = makeNoShowStore({ reservations: [resv], ports: [port] });

    const summary = await processNoShowForfeitures(spy.store, new Date("2025-01-01T12:30:00Z"));

    assert.deepEqual(summary, { considered: 1, skipped: 0, forfeitedNoFee: 1, forfeitedWithFee: 0 });
    assert.equal(spy.feeEntries.length, 0);
    assert.equal(spy.reservationUpdates[0].ledgerEntryId, null);
  });

  it("skips reservations whose port has been deleted (does not crash)", async () => {
    const resv = makeReservation({ portId: 999 }); // no matching port
    const spy = makeNoShowStore({ reservations: [resv], ports: [] });

    const summary = await processNoShowForfeitures(spy.store, new Date("2025-01-01T13:00:00Z"));

    assert.deepEqual(summary, { considered: 1, skipped: 1, forfeitedNoFee: 0, forfeitedWithFee: 0 });
    assert.equal(spy.reservationUpdates.length, 0);
  });

  it("processes a mixed batch correctly (skip + fee + no-fee)", async () => {
    const port = makePort({ id: 1, noShowFeeCents: 500, noShowGraceMinutes: 15 });
    const freePort = makePort({ id: 2, noShowFeeCents: 0, noShowGraceMinutes: 15 });
    const within = makeReservation({ id: 1, portId: 1, startsAt: "2025-01-01T12:55:00Z" }); // within grace
    const past = makeReservation({ id: 2, portId: 1, startsAt: "2025-01-01T12:00:00Z" }); // past grace
    const noFee = makeReservation({ id: 3, portId: 2, startsAt: "2025-01-01T12:00:00Z" }); // past grace, no fee
    const spy = makeNoShowStore({ reservations: [within, past, noFee], ports: [port, freePort] });

    const summary = await processNoShowForfeitures(spy.store, new Date("2025-01-01T13:00:00Z"));

    assert.deepEqual(summary, { considered: 3, skipped: 1, forfeitedNoFee: 1, forfeitedWithFee: 1 });
    assert.equal(spy.feeEntries.length, 1);
    assert.equal(spy.reservationUpdates.length, 2);
    const updatedIds = spy.reservationUpdates.map((u) => u.reservationId).sort();
    assert.deepEqual(updatedIds, [2, 3]);
  });

  it("returns early without listing ports when no stale reservations exist", async () => {
    let portsListed = 0;
    const store: NoShowPersistence = {
      async listStalePendingReservations() { return []; },
      async listPorts() { portsListed += 1; return []; },
      async ensureOwnerAccount() { throw new Error("nope"); },
      async insertNoShowFee() { throw new Error("nope"); },
      async markReservationNoShow() { throw new Error("nope"); },
      logError() {},
    };
    const summary = await processNoShowForfeitures(store, new Date("2025-01-01T13:00:00Z"));
    assert.deepEqual(summary, { considered: 0, skipped: 0, forfeitedNoFee: 0, forfeitedWithFee: 0 });
    assert.equal(portsListed, 0);
  });

  it("still marks the reservation no_show (without ledger id) when fee insert fails", async () => {
    const port = makePort({ noShowFeeCents: 500 });
    const resv = makeReservation({ id: 5 });
    const spy = makeNoShowStore({ reservations: [resv], ports: [port], failInsertFee: true });

    const summary = await processNoShowForfeitures(spy.store, new Date("2025-01-01T12:30:00Z"));

    assert.equal(summary.forfeitedWithFee, 0);
    assert.equal(summary.forfeitedNoFee, 1);
    assert.equal(spy.errors.length, 1);
    assert.equal(spy.errors[0].reservationId, 5);
    assert.equal(spy.reservationUpdates.length, 1);
    assert.equal(spy.reservationUpdates[0].ledgerEntryId, null, "fallback to no ledger when fee insert fails");
  });
});

// ── Refund integration tests ──────────────────────────────────────────

interface RefundSpy {
  store: RefundPersistence;
  refundEntries: RefundLedgerInput[];
  sessionUpdates: Array<{ sessionId: number; refundLedgerEntryId: number; reason: string; now: string }>;
  audits: Array<{ sessionId: number; action: string; actor: Actor | null; diff: unknown }>;
  ownerAccountLookups: string[];
}

function makeRefundStore(opts: { session: ChargingSession | null }): RefundSpy {
  const refundEntries: RefundLedgerInput[] = [];
  const sessionUpdates: Array<{ sessionId: number; refundLedgerEntryId: number; reason: string; now: string }> = [];
  const audits: Array<{ sessionId: number; action: string; actor: Actor | null; diff: unknown }> = [];
  const ownerAccountLookups: string[] = [];
  let nextLedgerId = 7000;
  const store: RefundPersistence = {
    async getSession(_id) { return opts.session; },
    async ensureOwnerAccount(unitId) { ownerAccountLookups.push(unitId); return { id: 200 }; },
    async insertRefundEntry(input) { refundEntries.push(input); return { id: nextLedgerId++ }; },
    async markSessionRefunded(sessionId, refundLedgerEntryId, reason, now) {
      sessionUpdates.push({ sessionId, refundLedgerEntryId, reason, now });
      return {
        ...(opts.session as ChargingSession),
        status: "refunded",
        refundLedgerEntryId,
        refundReason: reason,
        updatedAt: now,
      };
    },
    async recordAudit(sessionId, action, actor, diff) { audits.push({ sessionId, action, actor, diff }); },
  };
  return { store, refundEntries, sessionUpdates, audits, ownerAccountLookups };
}

const actor: Actor = { id: 7, email: "manager@example.com", name: "Manny" };

describe("processRefund (integration)", () => {
  it("posts a negative ledger entry, flips the session to refunded, and writes an audit row", async () => {
    const session = makeSession({ id: 33, costCents: 1500, ledgerEntryId: 999 });
    const spy = makeRefundStore({ session });

    const result = await processRefund(spy.store, 33, { amountCents: 1500, reason: "Driver no-charge" }, actor, new Date("2025-02-01T10:00:00Z"));

    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.amountCents, 1500);
    assert.equal(result.refundLedgerEntryId, 7000);
    assert.equal(result.session.status, "refunded");
    assert.equal(result.session.refundLedgerEntryId, 7000);
    assert.equal(result.session.refundReason, "Driver no-charge");

    assert.equal(spy.refundEntries.length, 1);
    const entry = spy.refundEntries[0];
    assert.equal(entry.amountCents, -1500, "refund must invert the original charge");
    assert.equal(entry.voidsEntryId, 999, "links back to the original charge ledger entry");
    assert.equal(entry.batchRef, "ev-refund-33");
    assert.equal(entry.postedBy, actor.id);
    assert.equal(entry.memo, "EV charging refund — session #33 · Driver no-charge");

    assert.equal(spy.sessionUpdates.length, 1);
    assert.equal(spy.sessionUpdates[0].sessionId, 33);
    assert.equal(spy.sessionUpdates[0].refundLedgerEntryId, 7000);

    assert.equal(spy.audits.length, 1);
    assert.equal(spy.audits[0].action, "refunded");
    assert.equal(spy.audits[0].actor?.id, actor.id);
    assert.deepEqual(spy.audits[0].diff, { amountCents: 1500, reason: "Driver no-charge", refundLedgerEntryId: 7000 });

    assert.deepEqual(spy.ownerAccountLookups, ["A-101"]);
  });

  it("defaults to a full refund when amountCents is omitted", async () => {
    const session = makeSession({ costCents: 800 });
    const spy = makeRefundStore({ session });

    const result = await processRefund(spy.store, session.id, {}, actor, new Date());

    assert.equal(result.ok, true);
    assert.equal(spy.refundEntries[0].amountCents, -800);
  });

  it("supports partial refunds (memo has no reason suffix when unset)", async () => {
    const session = makeSession({ id: 4, costCents: 1500 });
    const spy = makeRefundStore({ session });

    const result = await processRefund(spy.store, 4, { amountCents: 600 }, actor, new Date());

    assert.equal(result.ok, true);
    assert.equal(spy.refundEntries[0].amountCents, -600);
    assert.equal(spy.refundEntries[0].memo, "EV charging refund — session #4");
  });

  it("returns 404 when the session does not exist (no side effects)", async () => {
    const spy = makeRefundStore({ session: null });

    const result = await processRefund(spy.store, 99, { amountCents: 100 }, actor, new Date());

    assert.deepEqual(result, { ok: false, status: 404, error: "Not found" });
    assert.equal(spy.refundEntries.length, 0);
    assert.equal(spy.sessionUpdates.length, 0);
    assert.equal(spy.audits.length, 0);
  });

  it("rejects refunds on non-billed sessions without touching ledger or audit", async () => {
    const session = makeSession({ status: "active" });
    const spy = makeRefundStore({ session });

    const result = await processRefund(spy.store, session.id, { amountCents: 100 }, actor, new Date());

    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.status, 400);
    assert.equal(result.error, "Only billed sessions can be refunded");
    assert.equal(spy.refundEntries.length, 0);
    assert.equal(spy.audits.length, 0);
  });

  it("rejects double refunds (session already has a refundLedgerEntryId)", async () => {
    const session = makeSession({ refundLedgerEntryId: 1234 });
    const spy = makeRefundStore({ session });

    const result = await processRefund(spy.store, session.id, { amountCents: 100 }, actor, new Date());

    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.error, "Already refunded");
    assert.equal(spy.refundEntries.length, 0);
  });

  it("rejects an over-refund (amount > original charge)", async () => {
    const session = makeSession({ costCents: 500 });
    const spy = makeRefundStore({ session });

    const result = await processRefund(spy.store, session.id, { amountCents: 999 }, actor, new Date());

    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.error, "Invalid refund amount");
    assert.equal(spy.refundEntries.length, 0);
  });

  it("rejects refunds on sessions with no unit", async () => {
    const session = makeSession({ unitId: null });
    const spy = makeRefundStore({ session });

    const result = await processRefund(spy.store, session.id, { amountCents: 100 }, actor, new Date());

    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.error, "Session has no unit");
  });
});
