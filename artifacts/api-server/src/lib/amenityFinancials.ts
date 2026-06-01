// Task #88: Shared aggregation helpers for the amenity financials &
// reporting layer. The "unified revenue events" model is computed in-memory
// by unioning rows from amenity_bookings, amenity_deposit_ledger,
// charging_sessions, charging_reservations (no-show fees), and
// guest_parking_permits. Refunds appear as negative net rows.

import { db } from "@workspace/db";
import {
  amenitiesTable,
  amenityBookingsTable,
  amenityDepositLedgerTable,
  amenityDamageReportsTable,
  chargingSessionsTable,
  chargingReservationsTable,
  chargingPortsTable,
  guestParkingPermitsTable,
  amenityExpenseEntriesTable,
  unitsTable,
  usersTable,
  ledgerEntriesTable,
  ownerAccountsTable,
  type Amenity,
} from "@workspace/db/schema";
import { and, asc, eq, gte, lte } from "drizzle-orm";

export type RevenueKind =
  | "booking_fee"
  | "deposit_forfeiture"
  | "ev_energy"
  | "ev_idle"
  | "ev_no_show"
  | "guest_parking"
  | "refund";

export interface RevenueEvent {
  amenityId: number;
  amenitySlug: string;
  amenityName: string;
  unitId: string | null;
  ownerUserId: number | null;
  kind: RevenueKind;
  grossCents: number;   // signed (refund is negative)
  refundCents: number;  // positive when this row is itself a refund
  netCents: number;     // gross - refund
  occurredAt: string;   // ISO
  sourceKind: "booking" | "deposit_ledger" | "charging_session" | "charging_reservation" | "guest_parking_permit";
  sourceId: number;
  memo: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDate(s: string | undefined | null): boolean {
  return typeof s === "string" && ISO_DATE_RE.test(s);
}
export function nowISO(): string { return new Date().toISOString(); }

function toIsoDay(s: string | null | undefined): string {
  if (!s) return "";
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function inRange(occurredAt: string, from?: string, to?: string): boolean {
  const d = toIsoDay(occurredAt);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

/** Build the unified list of revenue events across all amenity sources. */
export async function loadRevenueEvents(opts: {
  from?: string;
  to?: string;
  amenityId?: number;
  unitId?: string;
}): Promise<RevenueEvent[]> {
  const amenities = await db.select().from(amenitiesTable);
  const amenityById = new Map<number, Amenity>(amenities.map((a) => [a.id, a]));
  const evAmenityId = amenities.find((a) => a.slug === "ev_chargers" || a.slug === "ev_charger")?.id;
  const guestParkingAmenityId = amenities.find((a) => a.slug === "guest_parking")?.id;

  const events: RevenueEvent[] = [];

  // 1) Amenity bookings — booking_fee + refund (when refunded). The deposit
  //    is held but not revenue until forfeited.
  const bookings = await db.select().from(amenityBookingsTable);
  for (const b of bookings) {
    if (opts.amenityId && b.amenityId !== opts.amenityId) continue;
    if (opts.unitId && b.unitId !== opts.unitId) continue;
    const a = amenityById.get(b.amenityId);
    if (!a) continue;
    const slug = a.slug;
    const name = a.name;

    // Owner-paid booking fee (only when the booking has been paid / used).
    if (b.depositPaidAt && b.depositCents === 0) {
      // booking with no deposit but a paid fee — guest_parking has separate flow
    }
    // Simpler: any booking that is `confirmed`/`used`/`used_pending_inspection`
    // contributes the depositCents to "held" balance, not revenue. Revenue
    // only comes from deposit forfeitures (below) and explicit fee charges.
    // We treat depositRefunded as a refund event when the booking was paid.
    if (b.depositRefundedAt && b.depositPaidAt && b.depositCents > 0) {
      const at = b.depositRefundedAt;
      if (inRange(at, opts.from, opts.to)) {
        events.push({
          amenityId: b.amenityId, amenitySlug: slug, amenityName: name,
          unitId: b.unitId, ownerUserId: b.ownerUserId,
          kind: "refund", grossCents: 0, refundCents: b.depositCents, netCents: -b.depositCents,
          occurredAt: at, sourceKind: "booking", sourceId: b.id,
          memo: `Deposit refund — booking #${b.id}`,
        });
      }
    }
  }

  // 2) Deposit ledger — `charged` rows are deposit forfeitures (revenue).
  //    `refunded` ledger rows are explicit refunds (already covered by
  //    booking refunded above? No — kind=refunded in the ledger is the
  //    primary signal once Inspections & Damage flow is in use).
  const depRows = await db.select().from(amenityDepositLedgerTable);
  for (const r of depRows) {
    const booking = bookings.find((b) => b.id === r.bookingId);
    if (!booking) continue;
    if (opts.amenityId && booking.amenityId !== opts.amenityId) continue;
    if (opts.unitId && booking.unitId !== opts.unitId) continue;
    const a = amenityById.get(booking.amenityId);
    if (!a) continue;
    if (!inRange(r.createdAt, opts.from, opts.to)) continue;
    if (r.kind === "charged") {
      events.push({
        amenityId: booking.amenityId, amenitySlug: a.slug, amenityName: a.name,
        unitId: booking.unitId, ownerUserId: booking.ownerUserId,
        kind: "deposit_forfeiture",
        grossCents: r.amountCents, refundCents: 0, netCents: r.amountCents,
        occurredAt: r.createdAt, sourceKind: "deposit_ledger", sourceId: r.id,
        memo: r.reason || `Deposit forfeiture — booking #${booking.id}`,
      });
    } else if (r.kind === "refunded") {
      events.push({
        amenityId: booking.amenityId, amenitySlug: a.slug, amenityName: a.name,
        unitId: booking.unitId, ownerUserId: booking.ownerUserId,
        kind: "refund", grossCents: 0, refundCents: r.amountCents, netCents: -r.amountCents,
        occurredAt: r.createdAt, sourceKind: "deposit_ledger", sourceId: r.id,
        memo: r.reason || `Deposit refund — booking #${booking.id}`,
      });
    }
  }

  // 3) Charging sessions — energy + idle revenue (when billed); refunds.
  const sessions = await db.select().from(chargingSessionsTable);
  for (const s of sessions) {
    if (opts.amenityId && s.portId && evAmenityId && opts.amenityId !== evAmenityId) continue;
    if (opts.unitId && s.unitId !== opts.unitId) continue;
    const amenityId = evAmenityId ?? null;
    if (!amenityId) continue;
    const a = amenityById.get(amenityId);
    if (!a) continue;
    if (s.status === "billed" || s.status === "refunded") {
      const at = s.endAt ?? s.updatedAt;
      if (s.energyCostCents > 0 && inRange(at, opts.from, opts.to)) {
        events.push({
          amenityId, amenitySlug: a.slug, amenityName: a.name,
          unitId: s.unitId, ownerUserId: s.ownerUserId,
          kind: "ev_energy",
          grossCents: s.energyCostCents, refundCents: 0, netCents: s.energyCostCents,
          occurredAt: at, sourceKind: "charging_session", sourceId: s.id,
          memo: `EV energy — ${Number(s.kwh).toFixed(2)} kWh`,
        });
      }
      if (s.idleCostCents > 0 && inRange(at, opts.from, opts.to)) {
        events.push({
          amenityId, amenitySlug: a.slug, amenityName: a.name,
          unitId: s.unitId, ownerUserId: s.ownerUserId,
          kind: "ev_idle",
          grossCents: s.idleCostCents, refundCents: 0, netCents: s.idleCostCents,
          occurredAt: at, sourceKind: "charging_session", sourceId: s.id,
          memo: `EV idle fee — ${s.idleMinutes} min`,
        });
      }
    }
    if (s.status === "refunded" && s.costCents > 0) {
      const at = s.updatedAt;
      if (inRange(at, opts.from, opts.to)) {
        events.push({
          amenityId, amenitySlug: a.slug, amenityName: a.name,
          unitId: s.unitId, ownerUserId: s.ownerUserId,
          kind: "refund",
          grossCents: 0, refundCents: s.costCents, netCents: -s.costCents,
          occurredAt: at, sourceKind: "charging_session", sourceId: s.id,
          memo: s.refundReason || `EV session refund #${s.id}`,
        });
      }
    }
  }

  // 4) Charging reservations — no-show fees.
  const reservations = await db.select().from(chargingReservationsTable);
  const ports = await db.select().from(chargingPortsTable);
  const portById = new Map(ports.map((p) => [p.id, p]));
  for (const r of reservations) {
    if (r.status !== "no_show") continue;
    const port = portById.get(r.portId);
    if (!port || !port.noShowFeeCents) continue;
    const amenityId = evAmenityId;
    if (!amenityId) continue;
    if (opts.amenityId && opts.amenityId !== amenityId) continue;
    if (opts.unitId && r.unitId !== opts.unitId) continue;
    const a = amenityById.get(amenityId);
    if (!a) continue;
    const at = r.updatedAt;
    if (!inRange(at, opts.from, opts.to)) continue;
    events.push({
      amenityId, amenitySlug: a.slug, amenityName: a.name,
      unitId: r.unitId, ownerUserId: r.ownerUserId,
      kind: "ev_no_show",
      grossCents: port.noShowFeeCents, refundCents: 0, netCents: port.noShowFeeCents,
      occurredAt: at, sourceKind: "charging_reservation", sourceId: r.id,
      memo: `EV no-show fee — port ${port.name}`,
    });
  }

  // 5) Guest parking permits — flat permit fee if encoded in the amenity
  //    rules (rules.permitFeeCents). The permit window is `startsOn/endsOn`.
  if (guestParkingAmenityId) {
    const amenity = amenityById.get(guestParkingAmenityId);
    const permitFeeCents = (amenity?.rules as { permitFeeCents?: number } | undefined)?.permitFeeCents ?? 0;
    if (amenity && permitFeeCents > 0) {
      if (!opts.amenityId || opts.amenityId === guestParkingAmenityId) {
        const permits = await db.select().from(guestParkingPermitsTable);
        for (const p of permits) {
          if (opts.unitId && p.unitId !== opts.unitId) continue;
          if (p.status === "cancelled") continue;
          const at = p.createdAt;
          if (!inRange(at, opts.from, opts.to)) continue;
          events.push({
            amenityId: guestParkingAmenityId, amenitySlug: amenity.slug, amenityName: amenity.name,
            unitId: p.unitId, ownerUserId: p.ownerUserId,
            kind: "guest_parking",
            grossCents: permitFeeCents * p.nights, refundCents: 0, netCents: permitFeeCents * p.nights,
            occurredAt: at, sourceKind: "guest_parking_permit", sourceId: p.id,
            memo: `Guest parking permit ${p.permitNumber} (${p.nights} night${p.nights === 1 ? "" : "s"})`,
          });
        }
      }
    }
  }

  events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return events;
}

export interface RevenueRollup {
  totalGrossCents: number;
  totalRefundCents: number;
  totalNetCents: number;
  byKind: Record<RevenueKind, number>;
  byAmenity: Array<{ amenityId: number; amenitySlug: string; amenityName: string; grossCents: number; refundCents: number; netCents: number; events: number }>;
  byMonth: Array<{ month: string; grossCents: number; refundCents: number; netCents: number }>;
}

export function rollupRevenue(events: RevenueEvent[]): RevenueRollup {
  const byKind: Record<RevenueKind, number> = {
    booking_fee: 0, deposit_forfeiture: 0, ev_energy: 0, ev_idle: 0,
    ev_no_show: 0, guest_parking: 0, refund: 0,
  };
  const byAmenityMap = new Map<number, RevenueRollup["byAmenity"][number]>();
  const byMonthMap = new Map<string, RevenueRollup["byMonth"][number]>();
  let gross = 0, refund = 0, net = 0;
  for (const e of events) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + (e.kind === "refund" ? e.refundCents : e.grossCents);
    gross += e.grossCents;
    refund += e.refundCents;
    net += e.netCents;
    let am = byAmenityMap.get(e.amenityId);
    if (!am) {
      am = { amenityId: e.amenityId, amenitySlug: e.amenitySlug, amenityName: e.amenityName, grossCents: 0, refundCents: 0, netCents: 0, events: 0 };
      byAmenityMap.set(e.amenityId, am);
    }
    am.grossCents += e.grossCents;
    am.refundCents += e.refundCents;
    am.netCents += e.netCents;
    am.events += 1;
    const month = toIsoDay(e.occurredAt).slice(0, 7);
    let mm = byMonthMap.get(month);
    if (!mm) { mm = { month, grossCents: 0, refundCents: 0, netCents: 0 }; byMonthMap.set(month, mm); }
    mm.grossCents += e.grossCents;
    mm.refundCents += e.refundCents;
    mm.netCents += e.netCents;
  }
  return {
    totalGrossCents: gross, totalRefundCents: refund, totalNetCents: net,
    byKind,
    byAmenity: Array.from(byAmenityMap.values()).sort((a, b) => b.netCents - a.netCents),
    byMonth: Array.from(byMonthMap.values()).sort((a, b) => a.month.localeCompare(b.month)),
  };
}

// ── Utilization heat-map ─────────────────────────────────────────────────

export interface UtilizationGridCell { weekday: number; hour: number; bookings: number; minutes: number; }

export async function loadUtilizationGrid(amenityId: number | null, from: string, to: string): Promise<{ cells: UtilizationGridCell[]; totalBookings: number; totalMinutes: number; peak: UtilizationGridCell | null }> {
  const all = await db.select().from(amenityBookingsTable);
  const grid = new Map<string, UtilizationGridCell>();
  let totalBookings = 0, totalMinutes = 0;
  for (const b of all) {
    if (amenityId && b.amenityId !== amenityId) continue;
    if (b.status === "cancelled" || b.status === "refunded" || b.status === "forfeited") continue;
    if (b.startsAt < from || b.startsAt > `${to}T23:59:59Z`) continue;
    const start = new Date(b.startsAt);
    const end = new Date(b.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    const wd = start.getUTCDay();
    const hour = start.getUTCHours();
    const key = `${wd}-${hour}`;
    let cell = grid.get(key);
    if (!cell) { cell = { weekday: wd, hour, bookings: 0, minutes: 0 }; grid.set(key, cell); }
    cell.bookings += 1;
    const mins = Math.max(0, (end.getTime() - start.getTime()) / 60000);
    cell.minutes += mins;
    totalBookings += 1;
    totalMinutes += mins;
  }
  const cells = Array.from(grid.values()).sort((a, b) => a.weekday * 24 + a.hour - (b.weekday * 24 + b.hour));
  const peak = cells.reduce<UtilizationGridCell | null>((best, c) => !best || c.bookings > best.bookings ? c : best, null);
  return { cells, totalBookings, totalMinutes, peak };
}

// ── Deposit lifecycle / aging ────────────────────────────────────────────

export interface DepositLedgerRow {
  id: number;
  bookingId: number;
  amenityId: number;
  amenityName: string;
  unitId: string | null;
  ownerUserId: number;
  ownerName: string;
  kind: string;
  amountCents: number;
  balanceCents: number;
  reason: string;
  damageReportId: number | null;
  actorName: string;
  createdAt: string;
}

export interface HeldDeposit {
  bookingId: number;
  amenityId: number;
  amenityName: string;
  unitId: string | null;
  ownerUserId: number;
  ownerName: string;
  depositCents: number;
  paidAt: string;
  startsAt: string;
  endsAt: string;
  ageDays: number;
  status: string;
  hasDamageReport: boolean;
  hasDispute: boolean;
}

export async function loadDepositSnapshot(opts: { from?: string; to?: string; ageDaysMin?: number }): Promise<{
  ledger: DepositLedgerRow[];
  held: HeldDeposit[];
  heldBalanceCents: number;
  releasedCents: number;
  forfeitedCents: number;
  refundedCents: number;
  stuckCount: number;
}> {
  const [ledgerRows, bookings, amenities, damageReports, users] = await Promise.all([
    db.select().from(amenityDepositLedgerTable).orderBy(asc(amenityDepositLedgerTable.createdAt)),
    db.select().from(amenityBookingsTable),
    db.select().from(amenitiesTable),
    db.select().from(amenityDamageReportsTable),
    db.select().from(usersTable),
  ]);

  const amenityMap = new Map<number, Amenity>(amenities.map((a) => [a.id, a]));
  const bookingMap = new Map<number, typeof bookings[number]>(bookings.map((b) => [b.id, b]));
  const userNameById = new Map<number, string>(users.map((u) => [u.id, u.name ?? u.email ?? `User ${u.id}`]));
  const damageByBooking = new Map<number, typeof damageReports[number]>();
  for (const d of damageReports) damageByBooking.set(d.bookingId, d);

  const ledger: DepositLedgerRow[] = [];
  let releasedCents = 0, forfeitedCents = 0, refundedCents = 0;
  for (const r of ledgerRows) {
    const booking = bookingMap.get(r.bookingId);
    if (!booking) continue;
    if (opts.from && r.createdAt.slice(0, 10) < opts.from) continue;
    if (opts.to && r.createdAt.slice(0, 10) > opts.to) continue;
    const a = amenityMap.get(booking.amenityId);
    if (r.kind === "released") releasedCents += r.amountCents;
    if (r.kind === "charged") forfeitedCents += r.amountCents;
    if (r.kind === "refunded") refundedCents += r.amountCents;
    ledger.push({
      id: r.id, bookingId: r.bookingId,
      amenityId: booking.amenityId,
      amenityName: a?.name ?? `Amenity ${booking.amenityId}`,
      unitId: booking.unitId,
      ownerUserId: booking.ownerUserId,
      ownerName: userNameById.get(booking.ownerUserId) ?? "",
      kind: r.kind,
      amountCents: r.amountCents,
      balanceCents: r.balanceCents,
      reason: r.reason,
      damageReportId: r.damageReportId ?? null,
      actorName: r.actorName,
      createdAt: r.createdAt,
    });
  }

  const held: HeldDeposit[] = [];
  let heldBalanceCents = 0;
  const now = Date.now();
  for (const b of bookings) {
    if (b.depositCents <= 0) continue;
    if (!b.depositPaidAt) continue;
    if (b.depositRefundedAt) continue;
    // Compute net held = depositCents - sum of charged on this booking
    const charged = ledgerRows.filter((r) => r.bookingId === b.id && r.kind === "charged").reduce((s, r) => s + r.amountCents, 0);
    const released = ledgerRows.filter((r) => r.bookingId === b.id && r.kind === "released").reduce((s, r) => s + r.amountCents, 0);
    const refunded = ledgerRows.filter((r) => r.bookingId === b.id && r.kind === "refunded").reduce((s, r) => s + r.amountCents, 0);
    const remaining = b.depositCents - charged - released - refunded;
    if (remaining <= 0) continue;
    const a = amenityMap.get(b.amenityId);
    const ageDays = Math.floor((now - new Date(b.depositPaidAt).getTime()) / (24 * 60 * 60 * 1000));
    if (opts.ageDaysMin != null && ageDays < opts.ageDaysMin) continue;
    held.push({
      bookingId: b.id,
      amenityId: b.amenityId,
      amenityName: a?.name ?? `Amenity ${b.amenityId}`,
      unitId: b.unitId,
      ownerUserId: b.ownerUserId,
      ownerName: userNameById.get(b.ownerUserId) ?? "",
      depositCents: remaining,
      paidAt: b.depositPaidAt,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      ageDays,
      status: b.status,
      hasDamageReport: damageByBooking.has(b.id),
      hasDispute: false, // augmented elsewhere if needed
    });
    heldBalanceCents += remaining;
  }
  held.sort((a, b) => b.ageDays - a.ageDays);
  const stuckCount = held.filter((h) => h.ageDays > 30).length;
  return { ledger, held, heldBalanceCents, releasedCents, forfeitedCents, refundedCents, stuckCount };
}

// ── Refund engine ────────────────────────────────────────────────────────

export type RefundSource = "booking" | "charging_session" | "guest_parking_permit";
export interface RefundInput {
  source: RefundSource;
  sourceId: number;
  amountCents?: number; // optional partial; defaults to full
  reason: string;
  actorUserId: number;
  actorName: string;
  approveAboveThreshold?: boolean;
}
export interface RefundResult {
  ok: boolean;
  error?: string;
  approvalRequired?: boolean;
  thresholdCents?: number;
  refundedCents?: number;
  ledgerEntryId?: number | null;
}

export async function executeRefund(input: RefundInput, thresholdCents: number, isAdmin: boolean): Promise<RefundResult> {
  const at = nowISO();
  if (!input.reason.trim()) return { ok: false, error: "Reason required" };

  if (input.source === "booking") {
    const [b] = await db.select().from(amenityBookingsTable).where(eq(amenityBookingsTable.id, input.sourceId));
    if (!b) return { ok: false, error: "Booking not found" };
    if (b.depositCents <= 0 || !b.depositPaidAt) return { ok: false, error: "No deposit on file" };
    const refundAmount = input.amountCents ?? b.depositCents;
    if (refundAmount <= 0 || refundAmount > b.depositCents) return { ok: false, error: "Invalid refund amount" };
    if (refundAmount > thresholdCents && !isAdmin && !input.approveAboveThreshold) {
      return { ok: false, approvalRequired: true, thresholdCents, error: "Admin approval required for this amount" };
    }
    const charged = await db.select().from(amenityDepositLedgerTable).where(and(eq(amenityDepositLedgerTable.bookingId, b.id), eq(amenityDepositLedgerTable.kind, "charged")));
    const totalCharged = charged.reduce((s, r) => s + r.amountCents, 0);
    const available = b.depositCents - totalCharged;
    if (refundAmount > available) return { ok: false, error: `Only ${available} cents available to refund` };
    // Insert ledger row
    const [row] = await db.insert(amenityDepositLedgerTable).values({
      bookingId: b.id,
      kind: "refunded",
      amountCents: refundAmount,
      balanceCents: available - refundAmount,
      reason: input.reason.slice(0, 500),
      damageReportId: null,
      actorUserId: input.actorUserId,
      actorName: input.actorName,
      createdAt: at,
    }).returning();
    if (refundAmount === available) {
      await db.update(amenityBookingsTable).set({
        status: "refunded", depositRefundedAt: at, updatedAt: at,
      }).where(eq(amenityBookingsTable.id, b.id));
    }
    // Post a credit on the unit's dues ledger
    let entryId: number | null = null;
    if (b.unitId) {
      const [acct] = await db.select().from(ownerAccountsTable).where(eq(ownerAccountsTable.unitId, b.unitId));
      if (acct) {
        const [entry] = await db.insert(ledgerEntriesTable).values({
          ownerAccountId: acct.id,
          occurredOn: at.slice(0, 10),
          postedAt: at,
          kind: "credit",
          chargeType: "amenity_refund",
          paymentMethod: null,
          amountCents: refundAmount,
          memo: `Amenity refund — booking #${b.id}: ${input.reason}`.slice(0, 500),
          postedBy: input.actorUserId,
          batchRef: `amenity-refund-booking-${b.id}-${row.id}`,
        }).returning();
        entryId = entry.id;
      }
    }
    return { ok: true, refundedCents: refundAmount, ledgerEntryId: entryId };
  }

  if (input.source === "charging_session") {
    const [s] = await db.select().from(chargingSessionsTable).where(eq(chargingSessionsTable.id, input.sourceId));
    if (!s) return { ok: false, error: "Session not found" };
    if (s.status !== "billed") return { ok: false, error: "Session is not billed" };
    const refundAmount = input.amountCents ?? s.costCents;
    if (refundAmount <= 0 || refundAmount > s.costCents) return { ok: false, error: "Invalid refund amount" };
    if (refundAmount > thresholdCents && !isAdmin && !input.approveAboveThreshold) {
      return { ok: false, approvalRequired: true, thresholdCents, error: "Admin approval required for this amount" };
    }
    let entryId: number | null = null;
    if (s.unitId) {
      const [acct] = await db.select().from(ownerAccountsTable).where(eq(ownerAccountsTable.unitId, s.unitId));
      if (acct) {
        const [entry] = await db.insert(ledgerEntriesTable).values({
          ownerAccountId: acct.id,
          occurredOn: at.slice(0, 10),
          postedAt: at,
          kind: "credit",
          chargeType: "amenity_refund",
          paymentMethod: null,
          amountCents: refundAmount,
          memo: `EV session refund #${s.id}: ${input.reason}`.slice(0, 500),
          postedBy: input.actorUserId,
          batchRef: `amenity-refund-ev-${s.id}`,
        }).returning();
        entryId = entry.id;
      }
    }
    await db.update(chargingSessionsTable).set({
      status: "refunded",
      refundLedgerEntryId: entryId,
      refundReason: input.reason.slice(0, 500),
      updatedAt: at,
    }).where(eq(chargingSessionsTable.id, s.id));
    return { ok: true, refundedCents: refundAmount, ledgerEntryId: entryId };
  }

  if (input.source === "guest_parking_permit") {
    const [p] = await db.select().from(guestParkingPermitsTable).where(eq(guestParkingPermitsTable.id, input.sourceId));
    if (!p) return { ok: false, error: "Permit not found" };
    if (p.status === "cancelled") return { ok: false, error: "Permit already cancelled" };
    const refundAmount = input.amountCents ?? 0;
    if (refundAmount > thresholdCents && !isAdmin && !input.approveAboveThreshold) {
      return { ok: false, approvalRequired: true, thresholdCents, error: "Admin approval required for this amount" };
    }
    let entryId: number | null = null;
    if (refundAmount > 0) {
      const [acct] = await db.select().from(ownerAccountsTable).where(eq(ownerAccountsTable.unitId, p.unitId));
      if (acct) {
        const [entry] = await db.insert(ledgerEntriesTable).values({
          ownerAccountId: acct.id,
          occurredOn: at.slice(0, 10),
          postedAt: at,
          kind: "credit",
          chargeType: "amenity_refund",
          paymentMethod: null,
          amountCents: refundAmount,
          memo: `Guest parking refund — ${p.permitNumber}: ${input.reason}`.slice(0, 500),
          postedBy: input.actorUserId,
          batchRef: `amenity-refund-permit-${p.id}`,
        }).returning();
        entryId = entry.id;
      }
    }
    await db.update(guestParkingPermitsTable).set({
      status: "cancelled",
      cancelledAt: at,
      cancelledByUserId: input.actorUserId,
      cancellationReason: input.reason.slice(0, 500),
      updatedAt: at,
    }).where(eq(guestParkingPermitsTable.id, p.id));
    return { ok: true, refundedCents: refundAmount, ledgerEntryId: entryId };
  }

  return { ok: false, error: "Unsupported refund source" };
}

// ── Per-owner usage ──────────────────────────────────────────────────────

export interface UserUsageRow {
  kind: "booking" | "ev_session" | "guest_parking" | "damage_report" | "deposit_event";
  occurredAt: string;
  amenityId: number | null;
  amenityName: string;
  status: string;
  amountCents: number;
  detail: string;
  sourceId: number;
}

export async function loadUserUsage(userId: number, opts: { from?: string; to?: string }): Promise<UserUsageRow[]> {
  const [bookings, sessions, permits, ledger, damages, amenities, ports] = await Promise.all([
    db.select().from(amenityBookingsTable).where(eq(amenityBookingsTable.ownerUserId, userId)),
    db.select().from(chargingSessionsTable).where(eq(chargingSessionsTable.ownerUserId, userId)),
    db.select().from(guestParkingPermitsTable).where(eq(guestParkingPermitsTable.ownerUserId, userId)),
    db.select().from(amenityDepositLedgerTable),
    db.select().from(amenityDamageReportsTable),
    db.select().from(amenitiesTable),
    db.select().from(chargingPortsTable),
  ]);
  const amenityById = new Map(amenities.map((a) => [a.id, a]));
  const evAmenityId = amenities.find((a) => a.slug === "ev_chargers" || a.slug === "ev_charger")?.id ?? null;
  const guestParkingAmenityId = amenities.find((a) => a.slug === "guest_parking")?.id ?? null;

  const out: UserUsageRow[] = [];
  for (const b of bookings) {
    const a = amenityById.get(b.amenityId);
    out.push({
      kind: "booking", occurredAt: b.startsAt, amenityId: b.amenityId,
      amenityName: a?.name ?? `Amenity ${b.amenityId}`,
      status: b.status, amountCents: b.depositCents,
      detail: `${b.startsAt.slice(0, 16)} → ${b.endsAt.slice(0, 16)}${b.purpose ? ` · ${b.purpose}` : ""}`,
      sourceId: b.id,
    });
  }
  for (const s of sessions) {
    const a = evAmenityId ? amenityById.get(evAmenityId) : null;
    const port = ports.find((p) => p.id === s.portId);
    out.push({
      kind: "ev_session", occurredAt: s.startAt, amenityId: evAmenityId,
      amenityName: a?.name ?? "EV charging",
      status: s.status, amountCents: s.costCents,
      detail: `${port?.name ?? "Port"} · ${Number(s.kwh).toFixed(2)} kWh${s.idleMinutes ? ` · ${s.idleMinutes}m idle` : ""}`,
      sourceId: s.id,
    });
  }
  for (const p of permits) {
    const a = guestParkingAmenityId ? amenityById.get(guestParkingAmenityId) : null;
    out.push({
      kind: "guest_parking", occurredAt: `${p.startsOn}T00:00:00.000Z`, amenityId: guestParkingAmenityId,
      amenityName: a?.name ?? "Guest parking",
      status: p.status, amountCents: 0,
      detail: `${p.permitNumber} · ${p.plate}${p.guestName ? ` · ${p.guestName}` : ""} · ${p.nights} night${p.nights === 1 ? "" : "s"}`,
      sourceId: p.id,
    });
  }
  for (const d of damages) {
    const b = bookings.find((bk) => bk.id === d.bookingId);
    if (!b) continue;
    const a = amenityById.get(b.amenityId);
    out.push({
      kind: "damage_report", occurredAt: d.createdAt, amenityId: b.amenityId,
      amenityName: a?.name ?? "Amenity",
      status: d.status, amountCents: d.depositChargedCents,
      detail: d.summary || "Damage report",
      sourceId: d.id,
    });
  }
  for (const r of ledger) {
    const b = bookings.find((bk) => bk.id === r.bookingId);
    if (!b) continue;
    const a = amenityById.get(b.amenityId);
    if (r.kind === "refunded" || r.kind === "charged" || r.kind === "released") {
      out.push({
        kind: "deposit_event", occurredAt: r.createdAt, amenityId: b.amenityId,
        amenityName: a?.name ?? "Amenity",
        status: r.kind, amountCents: r.amountCents,
        detail: r.reason || `Deposit ${r.kind}`,
        sourceId: r.id,
      });
    }
  }
  let filtered = out;
  if (opts.from || opts.to) {
    filtered = out.filter((r) => {
      const d = r.occurredAt.slice(0, 10);
      if (opts.from && d < opts.from) return false;
      if (opts.to && d > opts.to) return false;
      return true;
    });
  }
  filtered.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return filtered;
}

// ── Expense entries ──────────────────────────────────────────────────────

export async function loadExpenseTotals(opts: { from?: string; to?: string; amenityId?: number }): Promise<{ rows: typeof amenityExpenseEntriesTable.$inferSelect[]; totalCents: number; byAmenity: Map<number, number>; byMonth: Map<string, number>; }> {
  const conds = [] as ReturnType<typeof eq>[];
  if (opts.amenityId) conds.push(eq(amenityExpenseEntriesTable.amenityId, opts.amenityId));
  if (opts.from) conds.push(gte(amenityExpenseEntriesTable.occurredOn, opts.from));
  if (opts.to) conds.push(lte(amenityExpenseEntriesTable.occurredOn, opts.to));
  const rows = await db.select().from(amenityExpenseEntriesTable).where(conds.length ? and(...conds) : undefined).orderBy(asc(amenityExpenseEntriesTable.occurredOn));
  let total = 0;
  const byAmenity = new Map<number, number>();
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    total += r.amountCents;
    byAmenity.set(r.amenityId, (byAmenity.get(r.amenityId) ?? 0) + r.amountCents);
    const m = r.occurredOn.slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + r.amountCents);
  }
  return { rows, totalCents: total, byAmenity, byMonth };
}

// ── CSV helpers ──────────────────────────────────────────────────────────

export function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
export function csvRow(values: unknown[]): string { return values.map(csvEscape).join(",") + "\n"; }

void unitsTable;
