// Task #82: Amenity access control REST routes — access codes/QR, fobs,
// pool tags, unit vehicles, booking guest passes, manager patrol lookup,
// and the access audit trail.

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  amenitiesTable,
  amenityBookingsTable,
  amenityAccessCodesTable,
  amenityAccessAuditTable,
  fobInventoryTable,
  fobAssignmentsTable,
  poolTagsTable,
  unitVehiclesTable,
  bookingGuestPassesTable,
  unitsTable,
  usersTable,
} from "@workspace/db/schema";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { AuthUser } from "../middleware/auth.js";
import {
  getAmenityProvider,
  upsertAmenityProvider,
  publicProvider,
  publicCode,
  issueAccessForBooking,
  revokeAccessForBooking,
  testProvider,
  validatePresentedCode,
  renderQrSvg,
  recordAudit,
} from "../lib/amenityAccess.js";

const router: IRouter = Router();

function nowISO(): string { return new Date().toISOString(); }
function isManager(u: AuthUser): boolean { return u.role === "admin" || u.role === "manager"; }

// ── Provider config (per amenity) ────────────────────────────────────────

router.get("/amenities/:slug/access-provider", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const [a] = await db.select().from(amenitiesTable).where(eq(amenitiesTable.slug, req.params.slug));
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const p = await getAmenityProvider(a.id);
  res.json(p ? publicProvider(p) : null);
});

router.put("/amenities/:slug/access-provider", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const [a] = await db.select().from(amenitiesTable).where(eq(amenitiesTable.slug, req.params.slug));
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body ?? {};
  const kind = typeof body.kind === "string" ? body.kind : "virtual_lock";
  if (!["none", "virtual_lock", "stub_http"].includes(kind)) {
    res.status(400).json({ error: "Invalid kind" }); return;
  }
  const updated = await upsertAmenityProvider(a.id, {
    kind,
    baseUrlEnvVar: typeof body.baseUrlEnvVar === "string" ? body.baseUrlEnvVar.slice(0, 120) : null,
    apiKeyEnvVar: typeof body.apiKeyEnvVar === "string" ? body.apiKeyEnvVar.slice(0, 120) : null,
    config: body.config && typeof body.config === "object" ? body.config : {},
    enabled: typeof body.enabled === "boolean" ? body.enabled : true,
  });
  res.json(publicProvider(updated));
});

router.post("/amenities/:slug/access-provider/test", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const [a] = await db.select().from(amenitiesTable).where(eq(amenitiesTable.slug, req.params.slug));
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const out = await testProvider(a.id);
  res.json(out);
});

// ── Per-booking access code & QR ─────────────────────────────────────────

router.get("/amenity-bookings/:id/access-code", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [b] = await db.select().from(amenityBookingsTable).where(eq(amenityBookingsTable.id, id));
  if (!b) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!) && b.ownerUserId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const [code] = await db.select().from(amenityAccessCodesTable).where(eq(amenityAccessCodesTable.bookingId, id));
  if (!code) { res.status(404).json({ error: "No access code issued" }); return; }
  res.json(publicCode(code));
});

router.get("/amenity-bookings/:id/access-code/qr.svg", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [b] = await db.select().from(amenityBookingsTable).where(eq(amenityBookingsTable.id, id));
  if (!b) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!) && b.ownerUserId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const [code] = await db.select().from(amenityAccessCodesTable).where(eq(amenityAccessCodesTable.bookingId, id));
  if (!code) { res.status(404).json({ error: "No access code issued" }); return; }
  const svg = await renderQrSvg(code.qrPayload);
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(svg);
});

router.post("/amenity-bookings/:id/access-code/reissue", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [b] = await db.select().from(amenityBookingsTable).where(eq(amenityBookingsTable.id, id));
  if (!b) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!) && b.ownerUserId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (b.status !== "confirmed") { res.status(400).json({ error: "Booking is not confirmed" }); return; }
  const [a] = await db.select().from(amenitiesTable).where(eq(amenitiesTable.id, b.amenityId));
  if (!a) { res.status(404).json({ error: "Amenity not found" }); return; }
  await revokeAccessForBooking(id, "manual reissue", { id: req.user!.id, name: req.user!.name });
  const code = await issueAccessForBooking(b, a, { id: req.user!.id, name: req.user!.name });
  if (!code) { res.status(500).json({ error: "Could not issue code" }); return; }
  res.json(publicCode(code));
});

// ── Validation (kiosk / patrol) ──────────────────────────────────────────

router.post("/amenity-access/validate", async (req, res) => {
  const body = req.body ?? {};
  const code = typeof body.code === "string" ? body.code : undefined;
  const token = typeof body.token === "string" ? body.token : undefined;
  const out = await validatePresentedCode({ code, token });
  await recordAudit({
    bookingId: out.booking?.id ?? null,
    amenityId: out.amenity?.id ?? null,
    accessCodeId: out.code?.id ?? null,
    providerKind: out.code?.providerKind ?? "none",
    action: "validate",
    success: out.ok,
    actorUserId: req.user?.id ?? null,
    actorName: req.user?.name ?? null,
    message: out.reason ?? "",
    payload: { codeProvided: Boolean(code), tokenProvided: Boolean(token) },
  });
  if (!out.ok) {
    res.status(200).json({ ok: false, reason: out.reason ?? "Invalid" });
    return;
  }
  res.json({
    ok: true,
    booking: out.booking ? {
      id: out.booking.id,
      ownerUserId: out.booking.ownerUserId,
      unitId: out.booking.unitId,
      startsAt: out.booking.startsAt,
      endsAt: out.booking.endsAt,
      guestCount: out.booking.guestCount,
      status: out.booking.status,
    } : null,
    amenity: out.amenity ? { id: out.amenity.id, slug: out.amenity.slug, name: out.amenity.name } : null,
    code: out.code ? publicCode(out.code) : null,
  });
});

// ── Fob inventory ────────────────────────────────────────────────────────

router.get("/fobs", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const fobs = await db.select().from(fobInventoryTable).orderBy(asc(fobInventoryTable.serial));
  const assignments = await db.select().from(fobAssignmentsTable).where(isNull(fobAssignmentsTable.returnedAt));
  const amap = new Map<number, typeof assignments[number]>();
  for (const a of assignments) amap.set(a.fobId, a);
  res.json(fobs.map((f) => ({
    id: f.id,
    serial: f.serial,
    status: f.status,
    zoneTags: f.zoneTags,
    notes: f.notes,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    activeAssignment: amap.get(f.id) ?? null,
  })));
});

router.post("/fobs", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const body = req.body ?? {};
  const serial = typeof body.serial === "string" ? body.serial.trim() : "";
  if (!serial) { res.status(400).json({ error: "serial required" }); return; }
  const [row] = await db.insert(fobInventoryTable).values({
    serial,
    status: "available",
    zoneTags: Array.isArray(body.zoneTags) ? body.zoneTags.map((s: unknown) => String(s)).slice(0, 20) : [],
    notes: typeof body.notes === "string" ? body.notes.slice(0, 1000) : "",
    createdAt: nowISO(),
    updatedAt: nowISO(),
  }).returning();
  res.status(201).json(row);
});

router.patch("/fobs/:id", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body ?? {};
  const patch: Partial<typeof fobInventoryTable.$inferInsert> = { updatedAt: nowISO() };
  if (typeof body.status === "string") patch.status = body.status;
  if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 1000);
  if (Array.isArray(body.zoneTags)) patch.zoneTags = body.zoneTags.map((s: unknown) => String(s)).slice(0, 20);
  const [updated] = await db.update(fobInventoryTable).set(patch).where(eq(fobInventoryTable.id, id)).returning();
  res.json(updated);
});

router.post("/fobs/:id/assign", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body ?? {};
  const [fob] = await db.select().from(fobInventoryTable).where(eq(fobInventoryTable.id, id));
  if (!fob) { res.status(404).json({ error: "Not found" }); return; }
  if (fob.status !== "available") { res.status(400).json({ error: "Fob is not available" }); return; }
  const [row] = await db.insert(fobAssignmentsTable).values({
    fobId: id,
    unitId: typeof body.unitId === "string" ? body.unitId : null,
    bookingId: typeof body.bookingId === "number" ? body.bookingId : null,
    assignedToUserId: typeof body.userId === "number" ? body.userId : null,
    assignedToName: typeof body.name === "string" ? body.name.slice(0, 200) : "",
    assignedAt: nowISO(),
    returnedAt: null,
    returnedNote: "",
    assignedByUserId: req.user!.id,
  }).returning();
  await db.update(fobInventoryTable).set({ status: "assigned", updatedAt: nowISO() }).where(eq(fobInventoryTable.id, id));
  res.status(201).json(row);
});

router.post("/fobs/:id/return", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body ?? {};
  const [active] = await db
    .select()
    .from(fobAssignmentsTable)
    .where(and(eq(fobAssignmentsTable.fobId, id), isNull(fobAssignmentsTable.returnedAt)));
  if (!active) { res.status(400).json({ error: "No active assignment" }); return; }
  await db.update(fobAssignmentsTable).set({
    returnedAt: nowISO(),
    returnedNote: typeof body.note === "string" ? body.note.slice(0, 500) : "",
  }).where(eq(fobAssignmentsTable.id, active.id));
  await db.update(fobInventoryTable).set({ status: "available", updatedAt: nowISO() }).where(eq(fobInventoryTable.id, id));
  res.status(204).end();
});

router.get("/fobs/:id/history", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db
    .select()
    .from(fobAssignmentsTable)
    .where(eq(fobAssignmentsTable.fobId, id))
    .orderBy(desc(fobAssignmentsTable.assignedAt));
  res.json(rows);
});

// ── Pool tags ────────────────────────────────────────────────────────────

router.get("/pool-tags", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const rows = await db.select().from(poolTagsTable).orderBy(asc(poolTagsTable.unitId));
  res.json(rows);
});

router.get("/pool-tags/me", async (req, res) => {
  if (!req.user!.unitId) { res.json([]); return; }
  const rows = await db
    .select()
    .from(poolTagsTable)
    .where(eq(poolTagsTable.unitId, req.user!.unitId))
    .orderBy(asc(poolTagsTable.id));
  res.json(rows);
});

router.post("/pool-tags", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const body = req.body ?? {};
  const unitId = typeof body.unitId === "string" ? body.unitId : null;
  if (!unitId) { res.status(400).json({ error: "unitId required" }); return; }
  const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, unitId));
  if (!unit) { res.status(400).json({ error: "Unknown unit" }); return; }
  const [row] = await db.insert(poolTagsTable).values({
    unitId,
    residentUserId: typeof body.residentUserId === "number" ? body.residentUserId : null,
    residentName: typeof body.residentName === "string" ? body.residentName.slice(0, 200) : "",
    photoStorageKey: typeof body.photoStorageKey === "string" ? body.photoStorageKey : null,
    expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
    status: "active",
    suspendedReason: "",
    suspendedAt: null,
    issuedAt: nowISO(),
    issuedByUserId: req.user!.id,
    updatedAt: nowISO(),
  }).returning();
  res.status(201).json(row);
});

router.patch("/pool-tags/:id", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body ?? {};
  const patch: Partial<typeof poolTagsTable.$inferInsert> = { updatedAt: nowISO() };
  if (typeof body.residentName === "string") patch.residentName = body.residentName.slice(0, 200);
  if (typeof body.photoStorageKey === "string" || body.photoStorageKey === null) patch.photoStorageKey = body.photoStorageKey;
  if (typeof body.expiresAt === "string" || body.expiresAt === null) patch.expiresAt = body.expiresAt;
  const [row] = await db.update(poolTagsTable).set(patch).where(eq(poolTagsTable.id, id)).returning();
  res.json(row);
});

router.post("/pool-tags/:id/suspend", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : "manual";
  const [row] = await db.update(poolTagsTable).set({
    status: "suspended",
    suspendedReason: reason,
    suspendedAt: nowISO(),
    updatedAt: nowISO(),
  }).where(eq(poolTagsTable.id, id)).returning();
  res.json(row);
});

router.post("/pool-tags/:id/restore", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.update(poolTagsTable).set({
    status: "active",
    suspendedReason: "",
    suspendedAt: null,
    updatedAt: nowISO(),
  }).where(eq(poolTagsTable.id, id)).returning();
  res.json(row);
});

// ── Unit vehicles ────────────────────────────────────────────────────────

router.get("/units/me/vehicles", async (req, res) => {
  if (!req.user!.unitId) { res.json([]); return; }
  const rows = await db.select().from(unitVehiclesTable).where(eq(unitVehiclesTable.unitId, req.user!.unitId));
  res.json(rows);
});

router.get("/units/:unitId/vehicles", async (req, res) => {
  if (!isManager(req.user!) && req.user!.unitId !== req.params.unitId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const rows = await db.select().from(unitVehiclesTable).where(eq(unitVehiclesTable.unitId, req.params.unitId));
  res.json(rows);
});

router.post("/units/:unitId/vehicles", async (req, res) => {
  if (!isManager(req.user!) && req.user!.unitId !== req.params.unitId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const body = req.body ?? {};
  if (typeof body.plate !== "string" || !body.plate.trim()) { res.status(400).json({ error: "plate required" }); return; }
  const [row] = await db.insert(unitVehiclesTable).values({
    unitId: req.params.unitId,
    plate: body.plate.trim().toUpperCase().slice(0, 20),
    state: typeof body.state === "string" ? body.state.slice(0, 8).toUpperCase() : "",
    make: typeof body.make === "string" ? body.make.slice(0, 80) : "",
    model: typeof body.model === "string" ? body.model.slice(0, 80) : "",
    color: typeof body.color === "string" ? body.color.slice(0, 40) : "",
    notes: typeof body.notes === "string" ? body.notes.slice(0, 500) : "",
    createdAt: nowISO(),
    updatedAt: nowISO(),
  }).returning();
  res.status(201).json(row);
});

router.patch("/unit-vehicles/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [v] = await db.select().from(unitVehiclesTable).where(eq(unitVehiclesTable.id, id));
  if (!v) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!) && req.user!.unitId !== v.unitId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const body = req.body ?? {};
  const patch: Partial<typeof unitVehiclesTable.$inferInsert> = { updatedAt: nowISO() };
  if (typeof body.plate === "string") patch.plate = body.plate.trim().toUpperCase().slice(0, 20);
  if (typeof body.state === "string") patch.state = body.state.slice(0, 8).toUpperCase();
  if (typeof body.make === "string") patch.make = body.make.slice(0, 80);
  if (typeof body.model === "string") patch.model = body.model.slice(0, 80);
  if (typeof body.color === "string") patch.color = body.color.slice(0, 40);
  if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 500);
  const [row] = await db.update(unitVehiclesTable).set(patch).where(eq(unitVehiclesTable.id, id)).returning();
  res.json(row);
});

router.delete("/unit-vehicles/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [v] = await db.select().from(unitVehiclesTable).where(eq(unitVehiclesTable.id, id));
  if (!v) { res.status(404).end(); return; }
  if (!isManager(req.user!) && req.user!.unitId !== v.unitId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  await db.delete(unitVehiclesTable).where(eq(unitVehiclesTable.id, id));
  res.status(204).end();
});

// ── Booking guest passes ─────────────────────────────────────────────────

router.get("/amenity-bookings/:id/guests", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [b] = await db.select().from(amenityBookingsTable).where(eq(amenityBookingsTable.id, id));
  if (!b) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!) && b.ownerUserId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const rows = await db.select().from(bookingGuestPassesTable).where(eq(bookingGuestPassesTable.bookingId, id));
  res.json(rows);
});

router.post("/amenity-bookings/:id/guests", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [b] = await db.select().from(amenityBookingsTable).where(eq(amenityBookingsTable.id, id));
  if (!b) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!) && b.ownerUserId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const body = req.body ?? {};
  if (typeof body.name !== "string" || !body.name.trim()) { res.status(400).json({ error: "name required" }); return; }
  const [row] = await db.insert(bookingGuestPassesTable).values({
    bookingId: id,
    name: body.name.trim().slice(0, 200),
    plate: typeof body.plate === "string" ? body.plate.trim().toUpperCase().slice(0, 20) : "",
    vehicleDesc: typeof body.vehicleDesc === "string" ? body.vehicleDesc.slice(0, 200) : "",
    notes: typeof body.notes === "string" ? body.notes.slice(0, 500) : "",
    createdAt: nowISO(),
  }).returning();
  res.status(201).json(row);
});

router.delete("/amenity-bookings/:bookingId/guests/:id", async (req, res) => {
  const bookingId = parseInt(req.params.bookingId, 10);
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(bookingId) || Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [b] = await db.select().from(amenityBookingsTable).where(eq(amenityBookingsTable.id, bookingId));
  if (!b) { res.status(404).end(); return; }
  if (!isManager(req.user!) && b.ownerUserId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  await db.delete(bookingGuestPassesTable).where(eq(bookingGuestPassesTable.id, id));
  res.status(204).end();
});

router.post("/amenity-bookings/:bookingId/guests/:id/check-in", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.update(bookingGuestPassesTable)
    .set({ checkedInAt: nowISO() })
    .where(eq(bookingGuestPassesTable.id, id))
    .returning();
  res.json(row);
});

// ── Manager patrol lookup ────────────────────────────────────────────────

router.get("/patrol/lookup", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) { res.json({ query: "", vehicles: [], guests: [], poolTags: [], fobs: [], bookings: [] }); return; }
  const upper = q.toUpperCase();
  const like = `%${q}%`;
  const upperLike = `%${upper}%`;

  const [vehicles, guests, tags, fobs, codes] = await Promise.all([
    db.select().from(unitVehiclesTable).where(sql`upper(${unitVehiclesTable.plate}) like ${upperLike}`),
    db.select().from(bookingGuestPassesTable).where(
      sql`upper(${bookingGuestPassesTable.plate}) like ${upperLike} or ${bookingGuestPassesTable.name} ilike ${like}`,
    ),
    db.select().from(poolTagsTable).where(
      sql`${poolTagsTable.residentName} ilike ${like} or ${poolTagsTable.unitId} ilike ${like}`,
    ),
    db.select().from(fobInventoryTable).where(sql`${fobInventoryTable.serial} ilike ${like}`),
    db.select().from(amenityAccessCodesTable).where(eq(amenityAccessCodesTable.code, upper.replace(/[^A-Z0-9-]/g, ""))),
  ]);

  // Resolve booking metadata for matched guests / codes.
  const bookingIds = new Set<number>();
  for (const g of guests) bookingIds.add(g.bookingId);
  for (const c of codes) bookingIds.add(c.bookingId);
  const bookings = bookingIds.size > 0
    ? await db.select().from(amenityBookingsTable)
    : [];
  const bookingMap = new Map(bookings.filter((b) => bookingIds.has(b.id)).map((b) => [b.id, b] as const));

  const amenityIds = new Set<number>();
  for (const b of bookingMap.values()) amenityIds.add(b.amenityId);
  const amenities = amenityIds.size > 0 ? await db.select().from(amenitiesTable) : [];
  const amenityMap = new Map(amenities.filter((a) => amenityIds.has(a.id)).map((a) => [a.id, a] as const));

  const ownerIds = new Set<number>();
  for (const b of bookingMap.values()) ownerIds.add(b.ownerUserId);
  const users = ownerIds.size > 0 ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable) : [];
  const userMap = new Map(users.filter((u) => ownerIds.has(u.id)).map((u) => [u.id, u.name] as const));

  await recordAudit({
    action: "validate_lookup",
    success: true,
    actorUserId: req.user!.id,
    actorName: req.user!.name,
    message: q,
  });

  res.json({
    query: q,
    vehicles: vehicles.map((v) => ({ ...v, kind: "registered_vehicle" as const })),
    guests: guests.map((g) => ({
      ...g,
      kind: "guest_pass" as const,
      bookingId: g.bookingId,
      booking: bookingMap.has(g.bookingId) ? {
        id: bookingMap.get(g.bookingId)!.id,
        startsAt: bookingMap.get(g.bookingId)!.startsAt,
        endsAt: bookingMap.get(g.bookingId)!.endsAt,
        status: bookingMap.get(g.bookingId)!.status,
        amenityName: amenityMap.get(bookingMap.get(g.bookingId)!.amenityId)?.name ?? null,
        ownerName: userMap.get(bookingMap.get(g.bookingId)!.ownerUserId) ?? null,
      } : null,
    })),
    poolTags: tags.map((t) => ({ ...t, kind: "pool_tag" as const })),
    fobs: fobs.map((f) => ({ ...f, kind: "fob" as const })),
    accessCodes: codes.map((c) => ({
      ...publicCode(c),
      kind: "access_code" as const,
      booking: bookingMap.has(c.bookingId) ? {
        id: bookingMap.get(c.bookingId)!.id,
        startsAt: bookingMap.get(c.bookingId)!.startsAt,
        endsAt: bookingMap.get(c.bookingId)!.endsAt,
        status: bookingMap.get(c.bookingId)!.status,
        amenityName: amenityMap.get(bookingMap.get(c.bookingId)!.amenityId)?.name ?? null,
        ownerName: userMap.get(bookingMap.get(c.bookingId)!.ownerUserId) ?? null,
      } : null,
    })),
  });
});

// ── Audit trail ──────────────────────────────────────────────────────────

router.get("/amenity-access/audit", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? "100"), 10) || 100));
  const rows = await db.select().from(amenityAccessAuditTable).orderBy(desc(amenityAccessAuditTable.createdAt)).limit(limit);
  res.json(rows);
});

export default router;
