// Task #77: Amenity reservations REST routes.

import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  amenitiesTable,
  amenityBlackoutsTable,
  amenityLifeguardWindowsTable,
  amenityBookingsTable,
  amenityBookingAuditTable,
  calendarEventsTable,
  calendarSubCalendarsTable,
  usersTable,
  unitsTable,
  organizationSettingsTable,
  type Amenity,
  type AmenityBooking,
  type AmenityRules,
} from "@workspace/db/schema";
import { and, asc, eq, gt, gte, lt, ne, or } from "drizzle-orm";
import { authenticateJwt, type AuthUser } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { buildIcs } from "../lib/calendarIcal.js";
import { sendEmail, buildAmenityBookingEmail } from "../lib/email.js";
import { getAmenitiesSubCalendarId } from "../lib/amenitiesBootstrap.js";
import { issueAccessForBooking, reissueAccessForBooking, revokeAccessForBooking } from "../lib/amenityAccess.js";

const router: IRouter = Router();

function nowISO(): string { return new Date().toISOString(); }

function isManager(user: AuthUser): boolean {
  return user.role === "admin" || user.role === "manager";
}

function publicAmenity(a: Amenity) {
  return {
    id: a.id,
    slug: a.slug,
    name: a.name,
    description: a.description,
    photoUrl: a.photoUrl ?? null,
    capacity: a.capacity,
    bookingUnit: a.bookingUnit,
    depositCents: a.depositCents,
    rules: a.rules ?? {},
    agreementText: a.agreementText,
    enabled: a.enabled,
    sortOrder: a.sortOrder,
  };
}

function publicBooking(b: AmenityBooking, amenity?: Amenity | null, ownerName?: string | null) {
  return {
    id: b.id,
    amenityId: b.amenityId,
    amenitySlug: amenity?.slug ?? null,
    amenityName: amenity?.name ?? null,
    ownerUserId: b.ownerUserId,
    ownerName: ownerName ?? null,
    unitId: b.unitId ?? null,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    guestCount: b.guestCount,
    purpose: b.purpose,
    status: b.status,
    depositCents: b.depositCents,
    depositPaidAt: b.depositPaidAt ?? null,
    depositRefundedAt: b.depositRefundedAt ?? null,
    agreementSigned: b.agreementSigned,
    agreementSignedAt: b.agreementSignedAt ?? null,
    agreementSignedName: b.agreementSignedName,
    lifeguardRequested: b.lifeguardRequested,
    permitNumber: b.permitNumber ?? null,
    calendarEventId: b.calendarEventId ?? null,
    managerNotes: b.managerNotes,
    cancelledAt: b.cancelledAt ?? null,
    cancellationReason: b.cancellationReason,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

// ── Rules engine ────────────────────────────────────────────────────────

function dayBoundsLocal(iso: string): { startOfDay: string; endOfDay: string; weekday: number; hhmm: string } {
  // Local-time interpretation in UTC for hour/weekday computations. The
  // stored rules use string "HH:MM" with weekday index — we interpret
  // ISO timestamps in UTC for simplicity (the front-end constructs UTC
  // ISO strings directly when forming bookings).
  const d = new Date(iso);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0)).toISOString();
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59)).toISOString();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return { startOfDay: start, endOfDay: end, weekday: d.getUTCDay(), hhmm: `${hh}:${mm}` };
}

function timeStrToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  return h * 60 + (m || 0);
}

function checkWithinHours(rules: AmenityRules, startsAt: string, endsAt: string): string | null {
  if (!rules.hoursByWeekday || rules.hoursByWeekday.length !== 7) return null;
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  if (s.getUTCFullYear() !== e.getUTCFullYear() ||
      s.getUTCMonth() !== e.getUTCMonth() ||
      s.getUTCDate() !== e.getUTCDate()) {
    // Multi-day reservations: only overnight booking unit allows this. The
    // caller checks bookingUnit separately.
    return null;
  }
  const wd = s.getUTCDay();
  const window = rules.hoursByWeekday[wd];
  if (!window) return "Closed on this day";
  const sm = s.getUTCHours() * 60 + s.getUTCMinutes();
  const em = e.getUTCHours() * 60 + e.getUTCMinutes();
  if (sm < timeStrToMinutes(window.open) || em > timeStrToMinutes(window.close)) {
    return `Outside open hours (${window.open}–${window.close})`;
  }
  return null;
}

async function findOverlappingBookings(amenityId: number, startsAt: string, endsAt: string, excludeId?: number): Promise<AmenityBooking[]> {
  const all = await db
    .select()
    .from(amenityBookingsTable)
    .where(eq(amenityBookingsTable.amenityId, amenityId));
  return all.filter((b) => {
    if (excludeId && b.id === excludeId) return false;
    if (b.status === "cancelled" || b.status === "forfeited" || b.status === "refunded") return false;
    return b.startsAt < endsAt && b.endsAt > startsAt;
  });
}

async function findOverlappingBlackouts(amenityId: number, startsAt: string, endsAt: string) {
  const rows = await db
    .select()
    .from(amenityBlackoutsTable)
    .where(eq(amenityBlackoutsTable.amenityId, amenityId));
  return rows.filter((b) => b.startsAt < endsAt && b.endsAt > startsAt);
}

async function checkMonthlyCap(amenity: Amenity, ownerUserId: number, startsAt: string): Promise<string | null> {
  const cap = amenity.rules?.monthlyCapPerOwner;
  if (!cap || cap <= 0) return null;
  const d = new Date(startsAt);
  const monthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  const monthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
  const rows = await db
    .select()
    .from(amenityBookingsTable)
    .where(and(
      eq(amenityBookingsTable.amenityId, amenity.id),
      eq(amenityBookingsTable.ownerUserId, ownerUserId),
    ));
  const count = rows.filter((b) =>
    b.startsAt >= monthStart && b.startsAt < monthEnd &&
    b.status !== "cancelled" && b.status !== "forfeited"
  ).length;
  if (count >= cap) return `Monthly limit reached (${cap})`;
  return null;
}

async function checkGuestParkingCap(amenity: Amenity, ownerUserId: number, startsAt: string, endsAt: string): Promise<string | null> {
  const cap = amenity.rules?.guestParkingNightlyCap;
  if (!cap || amenity.slug !== "guest_parking") return null;
  const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db
    .select()
    .from(amenityBookingsTable)
    .where(eq(amenityBookingsTable.ownerUserId, ownerUserId));
  let nights = 0;
  for (const b of rows) {
    if (b.amenityId !== amenity.id) continue;
    if (b.status === "cancelled" || b.status === "forfeited") continue;
    if (b.endsAt < windowStart) continue;
    const ms = new Date(b.endsAt).getTime() - new Date(b.startsAt).getTime();
    nights += Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)));
  }
  const ms = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  const reqNights = Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)));
  if (nights + reqNights > cap) return `Guest-parking nightly cap reached (${cap} nights / 30 days)`;
  return null;
}

interface ValidationResult { ok: boolean; error?: string; }

async function validateBookingRequest(amenity: Amenity, ownerUserId: number, startsAt: string, endsAt: string, opts: { ignoreOverlapId?: number; isManager?: boolean } = {}): Promise<ValidationResult> {
  if (!amenity.enabled) return { ok: false, error: "Amenity is currently disabled" };
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return { ok: false, error: "Invalid start/end" };
  if (s >= e) return { ok: false, error: "End must be after start" };

  const rules = amenity.rules ?? {};
  const now = Date.now();
  const minLead = (rules.minLeadMinutes ?? 0) * 60 * 1000;
  if (!opts.isManager && s.getTime() - now < minLead) {
    return { ok: false, error: `Must book at least ${rules.minLeadMinutes ?? 0} minutes in advance` };
  }
  if (rules.maxLeadDays && rules.maxLeadDays > 0) {
    const max = rules.maxLeadDays * 24 * 60 * 60 * 1000;
    if (s.getTime() - now > max) return { ok: false, error: `Cannot book more than ${rules.maxLeadDays} days in advance` };
  }

  // Block-size check
  if (amenity.bookingUnit === "block" && rules.blockHours) {
    const expectedMs = rules.blockHours * 60 * 60 * 1000;
    if (Math.abs(e.getTime() - s.getTime() - expectedMs) > 60_000) {
      return { ok: false, error: `Reservation must be exactly ${rules.blockHours} hours` };
    }
  }
  if (amenity.bookingUnit === "hourly") {
    const ms = e.getTime() - s.getTime();
    if (ms < 30 * 60_000 || ms > 4 * 60 * 60_000) {
      return { ok: false, error: "Hourly reservations must be 30 min – 4 hours" };
    }
  }

  // Hours-of-operation
  if (amenity.bookingUnit !== "overnight") {
    const hrErr = checkWithinHours(rules, startsAt, endsAt);
    if (hrErr) return { ok: false, error: hrErr };
  }

  // Capacity / overlap (capacity 1 = single concurrent booking)
  const overlaps = await findOverlappingBookings(amenity.id, startsAt, endsAt, opts.ignoreOverlapId);
  if (amenity.capacity > 0 && overlaps.length >= 1 && (amenity.bookingUnit !== "hourly" || amenity.capacity === 1)) {
    return { ok: false, error: "That time conflicts with another reservation" };
  }
  if (amenity.bookingUnit === "hourly" && amenity.capacity > 0) {
    if (overlaps.length >= amenity.capacity) {
      return { ok: false, error: "All courts are booked at that time" };
    }
  }

  // Blackouts
  const blackouts = await findOverlappingBlackouts(amenity.id, startsAt, endsAt);
  if (blackouts.length > 0) {
    return { ok: false, error: `Conflicts with a closure: ${blackouts[0].reason || "maintenance"}` };
  }

  // Per-owner caps
  if (!opts.isManager) {
    const cap = await checkMonthlyCap(amenity, ownerUserId, startsAt);
    if (cap) return { ok: false, error: cap };
    const gp = await checkGuestParkingCap(amenity, ownerUserId, startsAt, endsAt);
    if (gp) return { ok: false, error: gp };
  }

  return { ok: true };
}

// ── Calendar materialization ─────────────────────────────────────────────

async function ensureCalendarEventForBooking(
  booking: AmenityBooking,
  amenity: Amenity,
  ownerName: string,
): Promise<number | null> {
  const subId = await getAmenitiesSubCalendarId();
  if (!subId) return null;
  const title = `${amenity.name} — ${ownerName}`;
  const body =
    `Reservation #${booking.id}\n` +
    `Owner: ${ownerName}\n` +
    `Guests: ${booking.guestCount || 0}\n` +
    (booking.purpose ? `Purpose: ${booking.purpose}\n` : "") +
    (booking.permitNumber ? `Permit #: ${booking.permitNumber}\n` : "");
  if (booking.calendarEventId) {
    await db.update(calendarEventsTable).set({
      title, body,
      startsAt: booking.startsAt, endsAt: booking.endsAt,
      cancelled: booking.status === "cancelled" || booking.status === "refunded" || booking.status === "forfeited",
      updatedAt: nowISO(),
    }).where(eq(calendarEventsTable.id, booking.calendarEventId));
    return booking.calendarEventId;
  }
  const [row] = await db.insert(calendarEventsTable).values({
    subCalendarId: subId,
    title,
    body,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    allDay: false,
    locationText: amenity.name,
    locationUrl: null,
    recurrence: null,
    exceptions: [],
    overrides: [],
    source: "amenity_booking",
    sourceRefType: "amenity_booking",
    sourceRefId: String(booking.id),
    externalUid: null,
    cancelled: false,
    createdByUserId: booking.ownerUserId,
    createdByName: ownerName,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  }).returning();
  return row.id;
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function loadAmenityBySlug(slug: string): Promise<Amenity | null> {
  const [row] = await db.select().from(amenitiesTable).where(eq(amenitiesTable.slug, slug));
  return row ?? null;
}

async function loadAmenityById(id: number): Promise<Amenity | null> {
  const [row] = await db.select().from(amenitiesTable).where(eq(amenitiesTable.id, id));
  return row ?? null;
}

async function loadOwnerName(userId: number): Promise<string> {
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  return u?.name ?? "Owner";
}

async function loadOrgName(): Promise<string> {
  const [s] = await db.select().from(organizationSettingsTable);
  return s?.name ?? "HOA";
}

function generatePermitNumber(): string {
  const part = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `GP-${new Date().getUTCFullYear()}-${part}`;
}

async function audit(bookingId: number, action: string, actor: AuthUser | null, diff: unknown): Promise<void> {
  await db.insert(amenityBookingAuditTable).values({
    bookingId,
    action,
    actorUserId: actor?.id ?? null,
    actorName: actor?.name ?? "system",
    diff: (diff as object) ?? null,
    createdAt: nowISO(),
  });
}

// ── Routes: catalog ──────────────────────────────────────────────────────

router.get("/amenities", async (_req, res) => {
  const rows = await db.select().from(amenitiesTable).orderBy(asc(amenitiesTable.sortOrder));
  res.json(rows.map(publicAmenity));
});

router.get("/amenities/:slug", async (req, res) => {
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  res.json(publicAmenity(a));
});

router.patch("/amenities/:slug", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body ?? {};
  const patch: Partial<typeof amenitiesTable.$inferInsert> = { updatedAt: nowISO() };
  if (typeof body.name === "string") patch.name = body.name.slice(0, 240);
  if (typeof body.description === "string") patch.description = body.description.slice(0, 4000);
  if (typeof body.photoUrl === "string" || body.photoUrl === null) patch.photoUrl = body.photoUrl;
  if (typeof body.capacity === "number") patch.capacity = Math.max(0, Math.floor(body.capacity));
  if (typeof body.depositCents === "number") patch.depositCents = Math.max(0, Math.floor(body.depositCents));
  if (typeof body.bookingUnit === "string") patch.bookingUnit = body.bookingUnit;
  if (body.rules && typeof body.rules === "object") patch.rules = body.rules;
  if (typeof body.agreementText === "string") patch.agreementText = body.agreementText.slice(0, 20000);
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;
  const [updated] = await db.update(amenitiesTable).set(patch).where(eq(amenitiesTable.id, a.id)).returning();
  res.json(publicAmenity(updated));
});

// ── Blackouts ────────────────────────────────────────────────────────────

router.get("/amenities/:slug/blackouts", async (req, res) => {
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const rows = await db.select().from(amenityBlackoutsTable).where(eq(amenityBlackoutsTable.amenityId, a.id));
  res.json(rows);
});

router.post("/amenities/:slug/blackouts", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const { startsAt, endsAt, reason } = req.body ?? {};
  if (typeof startsAt !== "string" || typeof endsAt !== "string") {
    res.status(400).json({ error: "startsAt and endsAt required" }); return;
  }
  const [row] = await db.insert(amenityBlackoutsTable).values({
    amenityId: a.id,
    startsAt, endsAt,
    reason: typeof reason === "string" ? reason.slice(0, 240) : "",
    createdByUserId: req.user!.id,
    createdAt: nowISO(),
  }).returning();
  res.status(201).json(row);
});

router.delete("/amenities/:slug/blackouts/:id", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(amenityBlackoutsTable).where(eq(amenityBlackoutsTable.id, id));
  res.status(204).end();
});

// ── Lifeguard windows ────────────────────────────────────────────────────

router.get("/amenities/:slug/lifeguard-windows", async (req, res) => {
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const rows = await db.select().from(amenityLifeguardWindowsTable).where(eq(amenityLifeguardWindowsTable.amenityId, a.id));
  res.json(rows);
});

router.post("/amenities/:slug/lifeguard-windows", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const { startsAt, endsAt, staffName } = req.body ?? {};
  if (typeof startsAt !== "string" || typeof endsAt !== "string") {
    res.status(400).json({ error: "startsAt and endsAt required" }); return;
  }
  const [row] = await db.insert(amenityLifeguardWindowsTable).values({
    amenityId: a.id,
    startsAt, endsAt,
    staffName: typeof staffName === "string" ? staffName.slice(0, 120) : "",
    createdByUserId: req.user!.id,
    createdAt: nowISO(),
  }).returning();
  res.status(201).json(row);
});

router.delete("/amenities/:slug/lifeguard-windows/:id", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(amenityLifeguardWindowsTable).where(eq(amenityLifeguardWindowsTable.id, id));
  res.status(204).end();
});

// ── Availability ─────────────────────────────────────────────────────────

router.get("/amenities/:slug/availability", async (req, res) => {
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  if (!from || !to) { res.status(400).json({ error: "from and to required" }); return; }

  const bookingsAll = await db
    .select()
    .from(amenityBookingsTable)
    .where(eq(amenityBookingsTable.amenityId, a.id));
  const blackouts = await db
    .select()
    .from(amenityBlackoutsTable)
    .where(eq(amenityBlackoutsTable.amenityId, a.id));
  const lifeguard = await db
    .select()
    .from(amenityLifeguardWindowsTable)
    .where(eq(amenityLifeguardWindowsTable.amenityId, a.id));

  const isMgr = isManager(req.user!);
  const bookings = bookingsAll
    .filter((b) => b.startsAt < to && b.endsAt > from)
    .filter((b) => b.status !== "cancelled" && b.status !== "forfeited")
    .map((b) => ({
      id: b.id,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      status: b.status,
      mine: b.ownerUserId === req.user!.id,
      // Privacy: residents see "Reserved", managers see actual booking owner.
      label: (isMgr || b.ownerUserId === req.user!.id) ? null : "Reserved",
    }));

  res.json({
    amenity: publicAmenity(a),
    bookings,
    blackouts: blackouts.filter((b) => b.startsAt < to && b.endsAt > from),
    lifeguardWindows: lifeguard.filter((b) => b.startsAt < to && b.endsAt > from),
  });
});

// ── Bookings: list ───────────────────────────────────────────────────────

router.get("/amenity-bookings/me", async (req, res) => {
  const rows = await db
    .select()
    .from(amenityBookingsTable)
    .where(eq(amenityBookingsTable.ownerUserId, req.user!.id))
    .orderBy(asc(amenityBookingsTable.startsAt));
  const amenities = await db.select().from(amenitiesTable);
  const amap = new Map(amenities.map((a) => [a.id, a] as const));
  const ownerName = req.user!.name ?? "Owner";
  res.json(rows.map((b) => publicBooking(b, amap.get(b.amenityId), ownerName)));
});

router.get("/amenity-bookings", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const status = typeof req.query.status === "string" ? req.query.status : null;
  let rows = await db.select().from(amenityBookingsTable).orderBy(asc(amenityBookingsTable.startsAt));
  if (status) rows = rows.filter((r) => r.status === status);
  const amenities = await db.select().from(amenitiesTable);
  const amap = new Map(amenities.map((a) => [a.id, a] as const));
  const userIds = Array.from(new Set(rows.map((r) => r.ownerUserId)));
  const users = userIds.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable)
    : [];
  const umap = new Map(users.map((u) => [u.id, u.name] as const));
  res.json(rows.map((b) => publicBooking(b, amap.get(b.amenityId), umap.get(b.ownerUserId) ?? "Owner")));
});

router.get("/amenity-bookings/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [b] = await db.select().from(amenityBookingsTable).where(eq(amenityBookingsTable.id, id));
  if (!b) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!) && b.ownerUserId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const amenity = await loadAmenityById(b.amenityId);
  const ownerName = await loadOwnerName(b.ownerUserId);
  res.json(publicBooking(b, amenity, ownerName));
});

// ── Bookings: create ─────────────────────────────────────────────────────

router.post("/amenities/:slug/bookings", async (req, res) => {
  const amenity = await loadAmenityBySlug(req.params.slug);
  if (!amenity) { res.status(404).json({ error: "Not found" }); return; }
  if (req.user!.role === "resident" && !req.user!.unitId) {
    res.status(403).json({ error: "Only owners with a unit can book amenities" }); return;
  }
  const body = req.body ?? {};
  const startsAt = typeof body.startsAt === "string" ? body.startsAt : null;
  const endsAt = typeof body.endsAt === "string" ? body.endsAt : null;
  if (!startsAt || !endsAt) { res.status(400).json({ error: "startsAt and endsAt required" }); return; }

  const ownerUserId = isManager(req.user!) && typeof body.ownerUserId === "number" ? body.ownerUserId : req.user!.id;
  let unitId: string | null = req.user!.unitId ?? null;
  if (isManager(req.user!) && typeof body.unitId === "string") unitId = body.unitId;

  const v = await validateBookingRequest(amenity, ownerUserId, startsAt, endsAt, { isManager: isManager(req.user!) });
  if (!v.ok) { res.status(400).json({ error: v.error }); return; }

  const guestCount = typeof body.guestCount === "number" ? Math.max(0, Math.floor(body.guestCount)) : 0;
  if (amenity.capacity > 0 && guestCount > amenity.capacity) {
    res.status(400).json({ error: `Guest count exceeds capacity (${amenity.capacity})` }); return;
  }

  // Agreement signing is required up-front: the client posts the signedName.
  const agreementSigned = body.agreementSigned === true;
  const agreementSignedName = typeof body.agreementSignedName === "string" ? body.agreementSignedName.slice(0, 120) : "";
  if (!agreementSigned || !agreementSignedName.trim()) {
    res.status(400).json({ error: "Agreement must be signed before booking" }); return;
  }

  // Task #85: Dog-park eligibility gate.
  if (amenity.slug === "dog_park") {
    if (!unitId) { res.status(400).json({ error: "Dog-park requires a unit" }); return; }
    const { isUnitDogParkEligible } = await import("../lib/petsCompliance.js");
    const eligibility = await isUnitDogParkEligible(unitId);
    if (!eligibility.ok) {
      res.status(400).json({ error: eligibility.reason || "Unit is not eligible for dog-park access", code: "dog_park_ineligible" });
      return;
    }
  }

  const lifeguardRequested = amenity.rules?.requiresLifeguard ? body.lifeguardRequested !== false : false;

  const requiresPayment = amenity.depositCents > 0;
  const status: AmenityBooking["status"] = requiresPayment ? "pending_payment" : "confirmed";
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null;

  const [created] = await db.insert(amenityBookingsTable).values({
    amenityId: amenity.id,
    ownerUserId,
    unitId,
    startsAt, endsAt,
    guestCount,
    purpose: typeof body.purpose === "string" ? body.purpose.slice(0, 1000) : "",
    status,
    depositCents: amenity.depositCents,
    depositPaidAt: requiresPayment ? null : nowISO(),
    depositRefundedAt: null,
    agreementSigned: true,
    agreementSignedAt: nowISO(),
    agreementSignedIp: ip,
    agreementSignedName,
    agreementText: amenity.agreementText,
    lifeguardRequested,
    permitNumber: amenity.slug === "guest_parking" ? generatePermitNumber() : null,
    calendarEventId: null,
    managerNotes: "",
    cancelledAt: null,
    cancelledByUserId: null,
    cancellationReason: "",
    createdAt: nowISO(),
    updatedAt: nowISO(),
  }).returning();

  await audit(created.id, "created", req.user!, { startsAt, endsAt, amenitySlug: amenity.slug });
  if (status === "confirmed") {
    const ownerName = await loadOwnerName(ownerUserId);
    const eventId = await ensureCalendarEventForBooking(created, amenity, ownerName);
    if (eventId) {
      await db.update(amenityBookingsTable).set({ calendarEventId: eventId }).where(eq(amenityBookingsTable.id, created.id));
      created.calendarEventId = eventId;
    }
    void sendConfirmationEmail(created, amenity, ownerUserId).catch((err) => logger.error({ err }, "Email failed"));
    void issueAccessForBooking(created, amenity, { id: req.user!.id, name: req.user!.name }).catch((err) => logger.error({ err }, "Access issue failed"));
  }

  const ownerName = await loadOwnerName(ownerUserId);
  res.status(201).json(publicBooking(created, amenity, ownerName));
});

async function sendConfirmationEmail(booking: AmenityBooking, amenity: Amenity, ownerUserId: number): Promise<void> {
  const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, ownerUserId));
  if (!owner?.email) return;
  const orgName = await loadOrgName();
  const html = buildAmenityBookingEmail({
    orgName,
    amenityName: amenity.name,
    ownerName: owner.name ?? "Owner",
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    status: "confirmed",
    permitNumber: booking.permitNumber,
  });
  await sendEmail(owner.email, `Reservation confirmed: ${amenity.name}`, html);
}

// ── Bookings: edit / mark-paid / cancel / refund ─────────────────────────

router.patch("/amenity-bookings/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [b] = await db.select().from(amenityBookingsTable).where(eq(amenityBookingsTable.id, id));
  if (!b) { res.status(404).json({ error: "Not found" }); return; }
  const ownerOnly = b.ownerUserId === req.user!.id;
  if (!isManager(req.user!) && !ownerOnly) { res.status(403).json({ error: "Forbidden" }); return; }
  if (b.status !== "confirmed" && b.status !== "pending_payment") {
    res.status(400).json({ error: "Booking cannot be edited" }); return;
  }
  const amenity = await loadAmenityById(b.amenityId);
  if (!amenity) { res.status(404).json({ error: "Amenity not found" }); return; }
  const body = req.body ?? {};
  const newStart = typeof body.startsAt === "string" ? body.startsAt : b.startsAt;
  const newEnd = typeof body.endsAt === "string" ? body.endsAt : b.endsAt;
  if (newStart !== b.startsAt || newEnd !== b.endsAt) {
    const v = await validateBookingRequest(amenity, b.ownerUserId, newStart, newEnd, { ignoreOverlapId: id, isManager: isManager(req.user!) });
    if (!v.ok) { res.status(400).json({ error: v.error }); return; }
  }
  const patch: Partial<typeof amenityBookingsTable.$inferInsert> = { updatedAt: nowISO() };
  patch.startsAt = newStart;
  patch.endsAt = newEnd;
  if (typeof body.guestCount === "number") patch.guestCount = Math.max(0, Math.floor(body.guestCount));
  if (typeof body.purpose === "string") patch.purpose = body.purpose.slice(0, 1000);
  if (isManager(req.user!) && typeof body.managerNotes === "string") patch.managerNotes = body.managerNotes.slice(0, 4000);
  const [updated] = await db.update(amenityBookingsTable).set(patch).where(eq(amenityBookingsTable.id, id)).returning();
  await audit(id, "edited", req.user!, patch);
  if (updated.calendarEventId) {
    const ownerName = await loadOwnerName(updated.ownerUserId);
    await ensureCalendarEventForBooking(updated, amenity, ownerName);
  }
  // Reissue access code if the booking is confirmed and the time changed.
  if (updated.status === "confirmed" && (newStart !== b.startsAt || newEnd !== b.endsAt)) {
    void reissueAccessForBooking(updated, amenity, { id: req.user!.id, name: req.user!.name }).catch((err) => logger.error({ err }, "Access reissue failed"));
  }
  res.json(publicBooking(updated, amenity, await loadOwnerName(updated.ownerUserId)));
});

router.post("/amenity-bookings/:id/mark-paid", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [b] = await db.select().from(amenityBookingsTable).where(eq(amenityBookingsTable.id, id));
  if (!b) { res.status(404).json({ error: "Not found" }); return; }
  if (b.status !== "pending_payment") { res.status(400).json({ error: "Not pending payment" }); return; }
  const amenity = await loadAmenityById(b.amenityId);
  if (!amenity) { res.status(404).json({ error: "Amenity not found" }); return; }
  const [updated] = await db.update(amenityBookingsTable)
    .set({ status: "confirmed", depositPaidAt: nowISO(), updatedAt: nowISO() })
    .where(eq(amenityBookingsTable.id, id))
    .returning();
  await audit(id, "deposit_paid", req.user!, null);
  const ownerName = await loadOwnerName(updated.ownerUserId);
  const eventId = await ensureCalendarEventForBooking(updated, amenity, ownerName);
  if (eventId && !updated.calendarEventId) {
    await db.update(amenityBookingsTable).set({ calendarEventId: eventId }).where(eq(amenityBookingsTable.id, id));
    updated.calendarEventId = eventId;
  }
  void sendConfirmationEmail(updated, amenity, updated.ownerUserId).catch((err) => logger.error({ err }, "Email failed"));
  void issueAccessForBooking(updated, amenity, { id: req.user!.id, name: req.user!.name }).catch((err) => logger.error({ err }, "Access issue failed"));
  res.json(publicBooking(updated, amenity, ownerName));
});

router.post("/amenity-bookings/:id/cancel", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [b] = await db.select().from(amenityBookingsTable).where(eq(amenityBookingsTable.id, id));
  if (!b) { res.status(404).json({ error: "Not found" }); return; }
  const ownerOnly = b.ownerUserId === req.user!.id;
  if (!isManager(req.user!) && !ownerOnly) { res.status(403).json({ error: "Forbidden" }); return; }
  if (b.status === "cancelled" || b.status === "refunded") {
    res.status(400).json({ error: "Already cancelled" }); return;
  }
  const amenity = await loadAmenityById(b.amenityId);
  if (!amenity) { res.status(404).json({ error: "Amenity not found" }); return; }
  // Cancel-window enforcement for owners.
  if (!isManager(req.user!)) {
    const cw = (amenity.rules?.cancelWindowHours ?? 0) * 60 * 60 * 1000;
    if (new Date(b.startsAt).getTime() - Date.now() < cw) {
      res.status(400).json({ error: `Reservations must be cancelled at least ${amenity.rules?.cancelWindowHours} hours in advance` });
      return;
    }
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : "";
  const [updated] = await db.update(amenityBookingsTable).set({
    status: "cancelled",
    cancelledAt: nowISO(),
    cancelledByUserId: req.user!.id,
    cancellationReason: reason,
    updatedAt: nowISO(),
  }).where(eq(amenityBookingsTable.id, id)).returning();
  await audit(id, "cancelled", req.user!, { reason });
  if (updated.calendarEventId) {
    await db.update(calendarEventsTable).set({ cancelled: true, updatedAt: nowISO() }).where(eq(calendarEventsTable.id, updated.calendarEventId));
  }
  void revokeAccessForBooking(id, "booking cancelled", { id: req.user!.id, name: req.user!.name }).catch((err) => logger.error({ err }, "Access revoke failed"));
  // Notify
  const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, updated.ownerUserId));
  if (owner?.email) {
    const orgName = await loadOrgName();
    const html = buildAmenityBookingEmail({
      orgName, amenityName: amenity.name, ownerName: owner.name ?? "Owner",
      startsAt: updated.startsAt, endsAt: updated.endsAt, status: "cancelled", reason,
    });
    void sendEmail(owner.email, `Reservation cancelled: ${amenity.name}`, html);
  }
  res.json(publicBooking(updated, amenity, await loadOwnerName(updated.ownerUserId)));
});

router.post("/amenity-bookings/:id/refund", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [b] = await db.select().from(amenityBookingsTable).where(eq(amenityBookingsTable.id, id));
  if (!b) { res.status(404).json({ error: "Not found" }); return; }
  if (b.depositCents <= 0 || !b.depositPaidAt) { res.status(400).json({ error: "No deposit on file" }); return; }
  if (b.depositRefundedAt) { res.status(400).json({ error: "Already refunded" }); return; }
  const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 500) : "";
  const [updated] = await db.update(amenityBookingsTable).set({
    status: "refunded",
    depositRefundedAt: nowISO(),
    managerNotes: note ? `${b.managerNotes}\n${note}`.trim() : b.managerNotes,
    updatedAt: nowISO(),
  }).where(eq(amenityBookingsTable.id, id)).returning();
  await audit(id, "refunded", req.user!, { note });
  void revokeAccessForBooking(id, "booking refunded", { id: req.user!.id, name: req.user!.name }).catch((err) => logger.error({ err }, "Access revoke failed"));
  const amenity = await loadAmenityById(b.amenityId);
  const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, updated.ownerUserId));
  if (owner?.email && amenity) {
    const orgName = await loadOrgName();
    const html = buildAmenityBookingEmail({
      orgName, amenityName: amenity.name, ownerName: owner.name ?? "Owner",
      startsAt: updated.startsAt, endsAt: updated.endsAt, status: "refunded", managerNote: note,
    });
    void sendEmail(owner.email, `Deposit refunded: ${amenity.name}`, html);
  }
  res.json(publicBooking(updated, amenity, await loadOwnerName(updated.ownerUserId)));
});

router.get("/amenity-bookings/:id/audit", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [b] = await db.select().from(amenityBookingsTable).where(eq(amenityBookingsTable.id, id));
  if (!b) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!) && b.ownerUserId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const rows = await db.select().from(amenityBookingAuditTable).where(eq(amenityBookingAuditTable.bookingId, id));
  res.json(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

// ── iCal feed for one booking ────────────────────────────────────────────

router.get("/amenity-bookings/:id/ical", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [b] = await db.select().from(amenityBookingsTable).where(eq(amenityBookingsTable.id, id));
  if (!b) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!) && b.ownerUserId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const amenity = await loadAmenityById(b.amenityId);
  if (!amenity) { res.status(404).json({ error: "Not found" }); return; }
  const ics = buildIcs({
    calendarName: `${amenity.name} reservation`,
    events: [{
      instance: { eventId: b.id, occurrenceKey: `booking-${b.id}`, startsAt: b.startsAt, endsAt: b.endsAt, cancelled: b.status === "cancelled" },
      title: `${amenity.name} reservation`,
      body: b.purpose || "",
      location: amenity.name,
      locationUrl: null,
      allDay: false,
    }],
  });
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="reservation-${b.id}.ics"`);
  res.send(ics);
});

// ── Permit (printable HTML) for guest parking ────────────────────────────

router.get("/amenity-bookings/:id/permit", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [b] = await db.select().from(amenityBookingsTable).where(eq(amenityBookingsTable.id, id));
  if (!b) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!) && b.ownerUserId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (!b.permitNumber) { res.status(400).json({ error: "No permit on this booking" }); return; }
  const amenity = await loadAmenityById(b.amenityId);
  const ownerName = await loadOwnerName(b.ownerUserId);
  const orgName = await loadOrgName();
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Guest Parking Permit ${b.permitNumber}</title>
<style>
@page { size: letter; margin: 0.75in; }
body { font-family: system-ui, sans-serif; color: #111; }
.permit { border: 4px double #111; padding: 24px; max-width: 700px; margin: 24px auto; }
h1 { margin: 0 0 4px; font-size: 28px; letter-spacing: 0.05em; text-transform: uppercase; }
h2 { margin: 0 0 16px; font-weight: 500; color: #555; font-size: 14px; }
table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
td { padding: 6px 0; border-bottom: 1px solid #eee; }
td.l { color: #666; width: 35%; }
.permit-id { font-size: 32px; font-family: 'JetBrains Mono', monospace; letter-spacing: 0.1em; padding: 16px; background: #FFF7E0; border: 2px solid #C49600; text-align: center; margin: 16px 0; }
.notice { font-size: 12px; color: #555; margin-top: 24px; line-height: 1.5; }
@media print { body { margin: 0 } .no-print { display: none } }
</style></head><body>
<div class="permit">
  <h1>Guest Parking Permit</h1>
  <h2>${escapeHtml(orgName)}</h2>
  <div class="permit-id">${escapeHtml(b.permitNumber)}</div>
  <table>
    <tr><td class="l">Issued to</td><td>${escapeHtml(ownerName)}${b.unitId ? ` — Unit ${escapeHtml(b.unitId)}` : ""}</td></tr>
    <tr><td class="l">Valid from</td><td>${escapeHtml(fmt(b.startsAt))}</td></tr>
    <tr><td class="l">Valid until</td><td>${escapeHtml(fmt(b.endsAt))}</td></tr>
    <tr><td class="l">Amenity</td><td>${escapeHtml(amenity?.name ?? "Guest parking")}</td></tr>
    <tr><td class="l">Status</td><td>${escapeHtml(b.status)}</td></tr>
  </table>
  <p class="notice">This permit must be displayed face-up on the dashboard of the parked vehicle. Vehicles parked in guest spots without a valid permit may be towed at the owner's expense. The HOA is not responsible for theft or damage to vehicles.</p>
  <p class="notice"><strong>Booking #:</strong> ${b.id} · <strong>Issued:</strong> ${escapeHtml(fmt(b.createdAt))}</p>
  <button class="no-print" onclick="window.print()" style="margin-top:16px;padding:8px 16px;background:#3245FF;color:#fff;border:0;border-radius:6px;font-weight:600;cursor:pointer">Print permit</button>
</div></body></html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

function escapeHtml(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Avoid unused-import lint
void unitsTable; void gt; void gte; void lt; void ne; void or;

export default router;
