import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  amenitiesTable,
  chargingPortsTable,
  chargingReservationsTable,
  chargingSessionsTable,
  chargingSessionUsageSamplesTable,
  chargingSessionAuditTable,
  chargingIdleEventsTable,
  ledgerEntriesTable,
  ownerAccountsTable,
  type ChargingPort,
  type ChargingReservation,
  type ChargingSession,
} from "@workspace/db/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { requireManager, type AuthUser } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import {
  computeIdleMinutes,
  computeSessionCost,
  getProvider,
} from "../lib/meteredAmenity.js";
import { processRefund, type RefundPersistence } from "../lib/chargingPersistence.js";

const router: IRouter = Router();

const EV_AMENITY_SLUG = "ev_charger";

function nowIso(): string { return new Date().toISOString(); }
function isManager(u: AuthUser): boolean { return u.role === "admin" || u.role === "manager"; }

// Strip masked-secret sentinels before persisting providerConfig; if the admin
// did not change a password the UI sends back the masked placeholder, which
// must not be written over the real value.
function sanitizeProviderConfig(
  raw: unknown,
  prev: Record<string, string>,
): Record<string, string> {
  if (typeof raw !== "object" || !raw) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k === "passwordSet") continue;
    if (k === "password") {
      if (typeof v !== "string") continue;
      if (v === "" || v === "********") {
        if (typeof prev.password === "string") out.password = prev.password;
        continue;
      }
      out.password = v;
      continue;
    }
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
  }
  return out;
}

async function getEvAmenityId(): Promise<number | null> {
  const [a] = await db.select().from(amenitiesTable).where(eq(amenitiesTable.slug, EV_AMENITY_SLUG));
  return a?.id ?? null;
}

function publicPort(p: ChargingPort, opts: { includeConfig?: boolean } = {}) {
  // providerConfig may carry credentials (OCPP basic-auth password); only
  // managers/admins see it, and we mask the password unconditionally.
  let providerConfig: Record<string, unknown> | undefined;
  if (opts.includeConfig) {
    const raw = (p.providerConfig ?? {}) as Record<string, unknown>;
    const masked: Record<string, unknown> = { ...raw };
    if (typeof masked.password === "string" && masked.password) {
      masked.password = "********";
      masked.passwordSet = true;
    } else {
      masked.passwordSet = false;
    }
    providerConfig = masked;
  }
  return {
    id: p.id,
    amenityId: p.amenityId,
    name: p.name,
    location: p.location,
    connectorType: p.connectorType,
    maxKw: p.maxKw,
    mode: p.mode,
    provider: p.provider,
    providerConfig,
    perKwhCents: p.perKwhCents,
    idlePerMinuteCents: p.idlePerMinuteCents,
    idleGraceMinutes: p.idleGraceMinutes,
    idleCapCents: p.idleCapCents,
    noShowFeeCents: p.noShowFeeCents,
    noShowGraceMinutes: p.noShowGraceMinutes,
    enabled: p.enabled,
    sortOrder: p.sortOrder,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function publicReservation(r: ChargingReservation) {
  return {
    id: r.id,
    portId: r.portId,
    ownerUserId: r.ownerUserId,
    unitId: r.unitId ?? null,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    status: r.status,
    sessionId: r.sessionId ?? null,
    cancelledAt: r.cancelledAt ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function publicSession(s: ChargingSession) {
  return {
    id: s.id,
    portId: s.portId,
    reservationId: s.reservationId ?? null,
    ownerUserId: s.ownerUserId,
    unitId: s.unitId ?? null,
    startAt: s.startAt,
    endAt: s.endAt ?? null,
    scheduledEndAt: s.scheduledEndAt ?? null,
    kwh: Number(s.kwh ?? 0),
    meterStartKwh: s.meterStartKwh != null ? Number(s.meterStartKwh) : null,
    meterEndKwh: s.meterEndKwh != null ? Number(s.meterEndKwh) : null,
    energyCostCents: s.energyCostCents,
    idleMinutes: s.idleMinutes,
    idleCostCents: s.idleCostCents,
    costCents: s.costCents,
    status: s.status,
    providerSessionRef: s.providerSessionRef ?? null,
    ledgerEntryId: s.ledgerEntryId ?? null,
    refundLedgerEntryId: s.refundLedgerEntryId ?? null,
    refundReason: s.refundReason ?? null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

async function audit(sessionId: number, action: string, user: AuthUser | null, diff: unknown): Promise<void> {
  await db.insert(chargingSessionAuditTable).values({
    sessionId, action,
    actorUserId: user?.id ?? null,
    actorName: user ? (user.name || user.email || "") : "system",
    diff: diff as never,
    createdAt: nowIso(),
  });
}

async function ensureOwnerAccountForUnit(unitId: string): Promise<typeof ownerAccountsTable.$inferSelect> {
  const [existing] = await db.select().from(ownerAccountsTable).where(eq(ownerAccountsTable.unitId, unitId));
  if (existing) return existing;
  const [created] = await db.insert(ownerAccountsTable).values({
    unitId, openingBalance: 0, createdAt: nowIso(),
  }).returning();
  return created;
}

async function postChargeForSession(session: ChargingSession, port: ChargingPort): Promise<number | null> {
  if (!session.unitId) return null;
  if (session.costCents <= 0) return null;
  try {
    const acct = await ensureOwnerAccountForUnit(session.unitId);
    const memo = `EV charging — ${port.name} · ${Number(session.kwh).toFixed(3)} kWh`
      + (session.idleCostCents > 0 ? ` (incl. ${session.idleMinutes}min idle)` : "");
    const [entry] = await db.insert(ledgerEntriesTable).values({
      ownerAccountId: acct.id,
      occurredOn: (session.endAt ?? nowIso()).slice(0, 10),
      postedAt: nowIso(),
      kind: "charge",
      chargeType: "ev_charging",
      paymentMethod: null,
      amountCents: session.costCents,
      memo,
      postedBy: session.ownerUserId,
      batchRef: `ev-session-${session.id}`,
    }).returning();
    return entry.id;
  } catch (err) {
    logger.error({ err, sessionId: session.id }, "Failed to post EV charge to ledger");
    return null;
  }
}

// ── Port management (admin) ──────────────────────────────────────────────

router.get("/charging/ports", async (req, res) => {
  const rows = await db.select().from(chargingPortsTable).orderBy(asc(chargingPortsTable.sortOrder), asc(chargingPortsTable.id));
  const includeConfig = isManager(req.user!);
  res.json(rows.map((p) => publicPort(p, { includeConfig })));
});

router.post("/charging/ports", requireManager, async (req, res) => {
  const evId = await getEvAmenityId();
  if (!evId) { res.status(400).json({ error: "EV charger amenity not bootstrapped" }); return; }
  const b = req.body ?? {};
  if (typeof b.name !== "string" || !b.name.trim()) { res.status(400).json({ error: "name required" }); return; }
  const created_ = await (async () => null)(); void created_;
  const [created] = await db.insert(chargingPortsTable).values({
    amenityId: evId,
    name: b.name.slice(0, 120),
    location: typeof b.location === "string" ? b.location.slice(0, 200) : "",
    connectorType: ["J1772", "CCS", "NACS", "CHAdeMO"].includes(b.connectorType) ? b.connectorType : "J1772",
    maxKw: typeof b.maxKw === "number" ? Math.max(1, Math.floor(b.maxKw)) : 7,
    mode: ["reserved", "fcfs", "reserved_fcfs"].includes(b.mode) ? b.mode : "reserved",
    provider: ["manual", "stub_http", "ocpp16"].includes(b.provider) ? b.provider : "manual",
    providerConfig: sanitizeProviderConfig(b.providerConfig, {}),
    perKwhCents: typeof b.perKwhCents === "number" ? Math.max(0, Math.floor(b.perKwhCents)) : 35,
    idlePerMinuteCents: typeof b.idlePerMinuteCents === "number" ? Math.max(0, Math.floor(b.idlePerMinuteCents)) : 40,
    idleGraceMinutes: typeof b.idleGraceMinutes === "number" ? Math.max(0, Math.floor(b.idleGraceMinutes)) : 10,
    idleCapCents: typeof b.idleCapCents === "number" ? Math.max(0, Math.floor(b.idleCapCents)) : 2000,
    noShowFeeCents: typeof b.noShowFeeCents === "number" ? Math.max(0, Math.floor(b.noShowFeeCents)) : 0,
    noShowGraceMinutes: typeof b.noShowGraceMinutes === "number" ? Math.max(0, Math.floor(b.noShowGraceMinutes)) : 15,
    enabled: b.enabled !== false,
    sortOrder: typeof b.sortOrder === "number" ? Math.floor(b.sortOrder) : 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }).returning();
  res.status(201).json(publicPort(created));
});

router.patch("/charging/ports/:id", requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(chargingPortsTable).where(eq(chargingPortsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const b = req.body ?? {};
  const patch: Partial<typeof chargingPortsTable.$inferInsert> = { updatedAt: nowIso() };
  if (typeof b.name === "string") patch.name = b.name.slice(0, 120);
  if (typeof b.location === "string") patch.location = b.location.slice(0, 200);
  if (["J1772", "CCS", "NACS", "CHAdeMO"].includes(b.connectorType)) patch.connectorType = b.connectorType;
  if (typeof b.maxKw === "number") patch.maxKw = Math.max(1, Math.floor(b.maxKw));
  if (["reserved", "fcfs", "reserved_fcfs"].includes(b.mode)) patch.mode = b.mode;
  if (["manual", "stub_http", "ocpp16"].includes(b.provider)) patch.provider = b.provider;
  if (typeof b.providerConfig === "object" && b.providerConfig) {
    const prev = (existing.providerConfig ?? {}) as Record<string, string>;
    patch.providerConfig = sanitizeProviderConfig(b.providerConfig, prev);
  }
  if (typeof b.perKwhCents === "number") patch.perKwhCents = Math.max(0, Math.floor(b.perKwhCents));
  if (typeof b.idlePerMinuteCents === "number") patch.idlePerMinuteCents = Math.max(0, Math.floor(b.idlePerMinuteCents));
  if (typeof b.idleGraceMinutes === "number") patch.idleGraceMinutes = Math.max(0, Math.floor(b.idleGraceMinutes));
  if (typeof b.idleCapCents === "number") patch.idleCapCents = Math.max(0, Math.floor(b.idleCapCents));
  if (typeof b.noShowFeeCents === "number") patch.noShowFeeCents = Math.max(0, Math.floor(b.noShowFeeCents));
  if (typeof b.noShowGraceMinutes === "number") patch.noShowGraceMinutes = Math.max(0, Math.floor(b.noShowGraceMinutes));
  if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
  if (typeof b.sortOrder === "number") patch.sortOrder = Math.floor(b.sortOrder);
  const [updated] = await db.update(chargingPortsTable).set(patch).where(eq(chargingPortsTable.id, id)).returning();
  res.json(publicPort(updated));
});

router.delete("/charging/ports/:id", requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [active] = await db.select().from(chargingSessionsTable)
    .where(and(eq(chargingSessionsTable.portId, id), eq(chargingSessionsTable.status, "active")));
  if (active) { res.status(400).json({ error: "Cannot delete a port with an active session" }); return; }
  await db.delete(chargingPortsTable).where(eq(chargingPortsTable.id, id));
  res.status(204).end();
});

// ── Live status & availability ───────────────────────────────────────────

router.get("/charging/ports/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [port] = await db.select().from(chargingPortsTable).where(eq(chargingPortsTable.id, id));
  if (!port) { res.status(404).json({ error: "Not found" }); return; }
  const [active] = await db.select().from(chargingSessionsTable)
    .where(and(eq(chargingSessionsTable.portId, id), eq(chargingSessionsTable.status, "active")))
    .orderBy(desc(chargingSessionsTable.id))
    .limit(1);
  const now = nowIso();
  const upcoming = await db.select().from(chargingReservationsTable)
    .where(and(eq(chargingReservationsTable.portId, id), eq(chargingReservationsTable.status, "pending")))
    .orderBy(asc(chargingReservationsTable.startsAt));
  const next = upcoming.find((r) => r.endsAt > now) ?? null;
  let liveStatus: "available" | "in_use" | "reserved_soon" = "available";
  if (active) liveStatus = "in_use";
  else if (next && new Date(next.startsAt).getTime() - Date.now() < 30 * 60 * 1000) liveStatus = "reserved_soon";
  res.json({
    port: publicPort(port),
    liveStatus,
    activeSession: active ? publicSession(active) : null,
    nextReservation: next ? publicReservation(next) : null,
  });
});

router.get("/charging/ports/:id/availability", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  if (!from || !to) { res.status(400).json({ error: "from and to required" }); return; }
  const rows = await db.select().from(chargingReservationsTable)
    .where(and(
      eq(chargingReservationsTable.portId, id),
      inArray(chargingReservationsTable.status, ["pending", "active"]),
    ));
  const overlapping = rows.filter((r) => r.startsAt < to && r.endsAt > from);
  res.json({ portId: id, reservations: overlapping.map(publicReservation) });
});

// ── Reservations (owner) ─────────────────────────────────────────────────

router.post("/charging/ports/:id/reservations", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [port] = await db.select().from(chargingPortsTable).where(eq(chargingPortsTable.id, id));
  if (!port || !port.enabled) { res.status(404).json({ error: "Port unavailable" }); return; }
  if (port.mode === "fcfs") { res.status(400).json({ error: "Port is first-come-first-served — start a session instead" }); return; }
  const b = req.body ?? {};
  const startsAt = typeof b.startsAt === "string" ? b.startsAt : null;
  const endsAt = typeof b.endsAt === "string" ? b.endsAt : null;
  if (!startsAt || !endsAt || startsAt >= endsAt) { res.status(400).json({ error: "startsAt/endsAt required" }); return; }
  const minutes = (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000;
  if (![30, 60, 90, 120].includes(Math.round(minutes))) {
    res.status(400).json({ error: "Slots must be 30, 60, 90, or 120 minutes" }); return;
  }
  // Conflict check: any pending/active reservation overlapping the window.
  const existing = await db.select().from(chargingReservationsTable)
    .where(and(
      eq(chargingReservationsTable.portId, id),
      inArray(chargingReservationsTable.status, ["pending", "active"]),
    ));
  const overlap = existing.find((r) => r.startsAt < endsAt && r.endsAt > startsAt);
  if (overlap) { res.status(409).json({ error: "Slot overlaps an existing reservation" }); return; }
  const [active] = await db.select().from(chargingSessionsTable)
    .where(and(eq(chargingSessionsTable.portId, id), eq(chargingSessionsTable.status, "active")));
  if (active && (active.scheduledEndAt ?? active.startAt) > startsAt) {
    res.status(409).json({ error: "Port has an in-progress session that conflicts" }); return;
  }

  const ownerUserId = isManager(req.user!) && typeof b.ownerUserId === "number" ? b.ownerUserId : req.user!.id;
  let unitId: string | null = req.user!.unitId ?? null;
  if (isManager(req.user!) && typeof b.unitId === "string") unitId = b.unitId;
  if (!unitId) { res.status(403).json({ error: "Owner must have a unit" }); return; }

  const [created] = await db.insert(chargingReservationsTable).values({
    portId: id, ownerUserId, unitId,
    startsAt, endsAt,
    status: "pending",
    sessionId: null, noShowFeeLedgerEntryId: null, cancelledAt: null,
    createdAt: nowIso(), updatedAt: nowIso(),
  }).returning();
  res.status(201).json(publicReservation(created));
});

router.get("/charging/reservations/me", async (req, res) => {
  const rows = await db.select().from(chargingReservationsTable)
    .where(eq(chargingReservationsTable.ownerUserId, req.user!.id))
    .orderBy(desc(chargingReservationsTable.startsAt));
  res.json(rows.map(publicReservation));
});

router.post("/charging/reservations/:id/cancel", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [r] = await db.select().from(chargingReservationsTable).where(eq(chargingReservationsTable.id, id));
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!) && r.ownerUserId !== req.user!.id) { res.status(403).json({ error: "Forbidden" }); return; }
  if (r.status !== "pending") { res.status(400).json({ error: "Reservation cannot be cancelled" }); return; }
  const [updated] = await db.update(chargingReservationsTable).set({
    status: "cancelled", cancelledAt: nowIso(), updatedAt: nowIso(),
  }).where(eq(chargingReservationsTable.id, id)).returning();
  res.json(publicReservation(updated));
});

// ── Sessions ─────────────────────────────────────────────────────────────

router.post("/charging/ports/:id/sessions", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [port] = await db.select().from(chargingPortsTable).where(eq(chargingPortsTable.id, id));
  if (!port || !port.enabled) { res.status(404).json({ error: "Port unavailable" }); return; }
  const [busy] = await db.select().from(chargingSessionsTable)
    .where(and(eq(chargingSessionsTable.portId, id), eq(chargingSessionsTable.status, "active")));
  if (busy) { res.status(409).json({ error: "Port is currently in use" }); return; }

  const ownerUserId = isManager(req.user!) && typeof req.body?.ownerUserId === "number" ? req.body.ownerUserId : req.user!.id;
  const unitId: string | null = (isManager(req.user!) && typeof req.body?.unitId === "string") ? req.body.unitId : (req.user!.unitId ?? null);
  if (!unitId) { res.status(403).json({ error: "Owner must have a unit" }); return; }

  // Bind to a current/imminent reservation belonging to this owner, or, for
  // FCFS / reserved+FCFS ports, allow an ad-hoc session as long as it would
  // not bleed into an upcoming reservation owned by someone else.
  const now = nowIso();
  const startWindow = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const myReservations = await db.select().from(chargingReservationsTable)
    .where(and(
      eq(chargingReservationsTable.portId, id),
      eq(chargingReservationsTable.ownerUserId, ownerUserId),
      eq(chargingReservationsTable.status, "pending"),
    ));
  const matching = myReservations.find((r) => r.startsAt <= startWindow && r.endsAt > now);
  if (!matching && port.mode === "reserved") {
    res.status(409).json({ error: "Port requires a reservation; none found for this owner at this time" }); return;
  }

  const requestedEnd = typeof req.body?.scheduledEndAt === "string" ? req.body.scheduledEndAt : null;
  const scheduledEndAt = matching?.endsAt
    ?? (requestedEnd ?? new Date(Date.now() + 60 * 60 * 1000).toISOString());

  // FCFS overflow guard: refuse to start if it would collide with the next
  // pending reservation belonging to anyone else.
  if (!matching) {
    const upcoming = await db.select().from(chargingReservationsTable)
      .where(and(
        eq(chargingReservationsTable.portId, id),
        eq(chargingReservationsTable.status, "pending"),
      ));
    const blocker = upcoming.find((r) => r.startsAt < scheduledEndAt && r.endsAt > now);
    if (blocker) {
      res.status(409).json({
        error: "Port is reserved soon by another owner — pick a shorter session or wait until after the upcoming reservation",
        nextReservationStartsAt: blocker.startsAt,
      });
      return;
    }
  }

  const provider = getProvider(port);
  const startInfo = await provider.startSession({
    port, ownerUserId, unitId, scheduledEndAt, reservationId: matching?.id ?? null,
  });

  // For manual ports the admin/owner can record the visible meter at session
  // start so a later meter-end reading produces an auditable kWh delta.
  const meterStartFromBody =
    typeof req.body?.meterStartKwh === "number" && Number.isFinite(req.body.meterStartKwh)
      ? Math.max(0, req.body.meterStartKwh)
      : null;
  const meterStartKwh = startInfo.meterStartKwh ?? meterStartFromBody;

  const [created] = await db.insert(chargingSessionsTable).values({
    portId: id,
    reservationId: matching?.id ?? null,
    ownerUserId, unitId,
    startAt: now,
    endAt: null,
    scheduledEndAt,
    kwh: "0",
    meterStartKwh: meterStartKwh != null ? String(meterStartKwh) : null,
    meterEndKwh: null,
    energyCostCents: 0, idleMinutes: 0, idleCostCents: 0, costCents: 0,
    status: "active",
    providerSessionRef: startInfo.providerSessionRef,
    ledgerEntryId: null, refundLedgerEntryId: null, refundReason: null,
    lastPolledAt: null,
    createdAt: now, updatedAt: now,
  }).returning();

  if (matching) {
    await db.update(chargingReservationsTable).set({
      status: "active", sessionId: created.id, updatedAt: now,
    }).where(eq(chargingReservationsTable.id, matching.id));
  }

  await audit(created.id, "started", req.user!, { portId: id, providerSessionRef: startInfo.providerSessionRef });
  res.status(201).json(publicSession(created));
});

router.get("/charging/sessions", requireManager, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  let rows: ChargingSession[];
  if (status) {
    rows = await db.select().from(chargingSessionsTable)
      .where(eq(chargingSessionsTable.status, status as ChargingSession["status"]))
      .orderBy(desc(chargingSessionsTable.startAt));
  } else {
    rows = await db.select().from(chargingSessionsTable).orderBy(desc(chargingSessionsTable.startAt));
  }
  res.json(rows.map(publicSession));
});

router.get("/charging/sessions/me", async (req, res) => {
  const rows = await db.select().from(chargingSessionsTable)
    .where(eq(chargingSessionsTable.ownerUserId, req.user!.id))
    .orderBy(desc(chargingSessionsTable.startAt));
  res.json(rows.map(publicSession));
});

router.get("/charging/sessions/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [s] = await db.select().from(chargingSessionsTable).where(eq(chargingSessionsTable.id, id));
  if (!s) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!) && s.ownerUserId !== req.user!.id) { res.status(403).json({ error: "Forbidden" }); return; }
  const samples = await db.select().from(chargingSessionUsageSamplesTable)
    .where(eq(chargingSessionUsageSamplesTable.sessionId, id))
    .orderBy(asc(chargingSessionUsageSamplesTable.sampledAt));
  res.json({
    session: publicSession(s),
    samples: samples.map((u) => ({
      id: u.id, sampledAt: u.sampledAt,
      kwh: Number(u.kwh), powerKw: u.powerKw != null ? Number(u.powerKw) : null,
    })),
  });
});

export async function finalizeSession(
  sessionId: number,
  opts: {
    actor?: AuthUser | null;
    overrideKwh?: number | null;
    meterEndKwh?: number | null;
    endAt?: string | null;
  } = {},
): Promise<ChargingSession | null> {
  const [s] = await db.select().from(chargingSessionsTable).where(eq(chargingSessionsTable.id, sessionId));
  if (!s) return null;
  if (s.status !== "active") return s;
  const [port] = await db.select().from(chargingPortsTable).where(eq(chargingPortsTable.id, s.portId));
  if (!port) return null;

  const endAt = opts.endAt ?? nowIso();
  let kwh: number;
  if (opts.overrideKwh != null) kwh = Math.max(0, opts.overrideKwh);
  else if (opts.meterEndKwh != null && s.meterStartKwh != null) {
    kwh = Math.max(0, opts.meterEndKwh - Number(s.meterStartKwh));
  } else {
    const provider = getProvider(port);
    const stop = await provider.stopSession(s.providerSessionRef, port);
    kwh = stop.finalKwh != null ? stop.finalKwh : Number(s.kwh ?? 0);
  }

  const idleMinutes = computeIdleMinutes({
    scheduledEndAt: s.scheduledEndAt ?? null,
    endAt,
    idleGraceMinutes: port.idleGraceMinutes,
  });
  const cost = computeSessionCost({
    kwh,
    perKwhCents: port.perKwhCents,
    idleMinutes,
    idlePerMinuteCents: port.idlePerMinuteCents,
    idleCapCents: port.idleCapCents,
  });

  if (idleMinutes > 0) {
    await db.insert(chargingIdleEventsTable).values({
      sessionId: s.id,
      startedAt: s.scheduledEndAt ?? endAt,
      endedAt: endAt,
      minutes: idleMinutes,
      feeCents: cost.idleCostCents,
    });
  }

  const [updatedPre] = await db.update(chargingSessionsTable).set({
    endAt,
    kwh: String(kwh),
    meterEndKwh: opts.meterEndKwh != null ? String(opts.meterEndKwh) : null,
    energyCostCents: cost.energyCostCents,
    idleMinutes,
    idleCostCents: cost.idleCostCents,
    costCents: cost.totalCostCents,
    status: "stopped",
    updatedAt: nowIso(),
  }).where(eq(chargingSessionsTable.id, s.id)).returning();

  await audit(s.id, "stopped", opts.actor ?? null, { kwh, cost });

  let updated = updatedPre;
  if (cost.totalCostCents > 0) {
    const ledgerId = await postChargeForSession(updated, port);
    if (ledgerId) {
      const [billed] = await db.update(chargingSessionsTable).set({
        status: "billed", ledgerEntryId: ledgerId, updatedAt: nowIso(),
      }).where(eq(chargingSessionsTable.id, s.id)).returning();
      updated = billed;
      await audit(s.id, "billed", opts.actor ?? null, { ledgerEntryId: ledgerId, amountCents: cost.totalCostCents });
    }
  }

  if (s.reservationId) {
    await db.update(chargingReservationsTable).set({
      status: "completed", updatedAt: nowIso(),
    }).where(eq(chargingReservationsTable.id, s.reservationId));
  }

  return updated;
}

router.post("/charging/sessions/:id/stop", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [s] = await db.select().from(chargingSessionsTable).where(eq(chargingSessionsTable.id, id));
  if (!s) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!) && s.ownerUserId !== req.user!.id) { res.status(403).json({ error: "Forbidden" }); return; }
  if (s.status !== "active") { res.status(400).json({ error: "Session not active" }); return; }
  const updated = await finalizeSession(id, { actor: req.user! });
  if (!updated) { res.status(500).json({ error: "Failed to stop" }); return; }
  res.json(publicSession(updated));
});

// Capture the visible meter at session start. Manual ports often have a
// physical kWh display that the admin records when plugging in; we store
// it here so the eventual meter-end reading produces an auditable delta.
router.post("/charging/sessions/:id/meter-start", requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [s] = await db.select().from(chargingSessionsTable).where(eq(chargingSessionsTable.id, id));
  if (!s) { res.status(404).json({ error: "Not found" }); return; }
  if (s.status !== "active") { res.status(400).json({ error: "Session not active" }); return; }
  const b = req.body ?? {};
  const meterStartKwh = typeof b.meterStartKwh === "number" ? Math.max(0, b.meterStartKwh) : null;
  if (meterStartKwh == null) { res.status(400).json({ error: "meterStartKwh required" }); return; }
  const [updated] = await db.update(chargingSessionsTable).set({
    meterStartKwh: String(meterStartKwh), updatedAt: nowIso(),
  }).where(eq(chargingSessionsTable.id, id)).returning();
  await audit(id, "meter_start_recorded", req.user!, { meterStartKwh });
  res.json(publicSession(updated));
});

router.post("/charging/sessions/:id/manual-readings", requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [s] = await db.select().from(chargingSessionsTable).where(eq(chargingSessionsTable.id, id));
  if (!s) { res.status(404).json({ error: "Not found" }); return; }
  const b = req.body ?? {};
  const meterStartKwh = typeof b.meterStartKwh === "number" ? Math.max(0, b.meterStartKwh) : null;
  const meterEndKwh = typeof b.meterEndKwh === "number" ? b.meterEndKwh : null;
  const overrideKwh = typeof b.kwh === "number" ? b.kwh : null;
  if (overrideKwh == null && meterEndKwh == null) {
    res.status(400).json({ error: "Provide kwh or meterEndKwh" }); return;
  }
  if (meterEndKwh != null && overrideKwh == null) {
    const startVal = meterStartKwh ?? (s.meterStartKwh != null ? Number(s.meterStartKwh) : null);
    if (startVal == null) {
      res.status(400).json({ error: "Session has no recorded meter-start; record it first or pass meterStartKwh together with meterEndKwh" });
      return;
    }
    if (meterEndKwh < startVal) {
      res.status(400).json({ error: "meterEndKwh must be >= meterStartKwh" });
      return;
    }
  }
  if (meterStartKwh != null) {
    await db.update(chargingSessionsTable).set({
      meterStartKwh: String(meterStartKwh), updatedAt: nowIso(),
    }).where(eq(chargingSessionsTable.id, id));
    await audit(id, "meter_start_recorded", req.user!, { meterStartKwh });
  }
  const endAt = typeof b.endAt === "string" ? b.endAt : null;
  const updated = await finalizeSession(id, { actor: req.user!, meterEndKwh, overrideKwh, endAt });
  if (!updated) { res.status(500).json({ error: "Failed to record readings" }); return; }
  res.json(publicSession(updated));
});

function dbRefundPersistence(): RefundPersistence {
  return {
    async getSession(id) {
      const [s] = await db.select().from(chargingSessionsTable).where(eq(chargingSessionsTable.id, id));
      return s ?? null;
    },
    async ensureOwnerAccount(unitId, _now) {
      const acct = await ensureOwnerAccountForUnit(unitId);
      return { id: acct.id };
    },
    async insertRefundEntry(input) {
      const [refund] = await db.insert(ledgerEntriesTable).values({
        ownerAccountId: input.ownerAccountId,
        occurredOn: input.occurredOn,
        postedAt: input.postedAt,
        kind: "refund",
        chargeType: "ev_charging",
        paymentMethod: null,
        amountCents: input.amountCents,
        memo: input.memo,
        postedBy: input.postedBy,
        voidsEntryId: input.voidsEntryId,
        batchRef: input.batchRef,
      }).returning();
      return { id: refund.id };
    },
    async markSessionRefunded(sessionId, refundLedgerEntryId, reason, now) {
      const [updated] = await db.update(chargingSessionsTable).set({
        status: "refunded",
        refundLedgerEntryId,
        refundReason: reason,
        updatedAt: now,
      }).where(eq(chargingSessionsTable.id, sessionId)).returning();
      return updated;
    },
    async recordAudit(sessionId, action, actor, diff) {
      await audit(sessionId, action, actor as AuthUser | null, diff);
    },
  };
}

router.post("/charging/sessions/:id/refund", requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const result = await processRefund(
    dbRefundPersistence(),
    id,
    req.body ?? {},
    { id: req.user!.id, email: req.user!.email, name: req.user!.name },
    new Date(),
  );
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(publicSession(result.session));
});

router.get("/charging/sessions/:id/audit", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [s] = await db.select().from(chargingSessionsTable).where(eq(chargingSessionsTable.id, id));
  if (!s) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!) && s.ownerUserId !== req.user!.id) { res.status(403).json({ error: "Forbidden" }); return; }
  const rows = await db.select().from(chargingSessionAuditTable)
    .where(eq(chargingSessionAuditTable.sessionId, id))
    .orderBy(desc(chargingSessionAuditTable.id));
  // Spec exposes `details` (not the DB column name `diff`); remap so
  // owner-facing clients can render structured audit context.
  res.json(rows.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    action: r.action,
    actorUserId: r.actorUserId,
    actorName: r.actorName,
    details: (r.diff ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt,
  })));
});

// ── Per-port admin dashboard ─────────────────────────────────────────────

router.get("/charging/ports/:id/stats", requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const sessions = await db.select().from(chargingSessionsTable)
    .where(eq(chargingSessionsTable.portId, id));
  const totalSessions = sessions.length;
  const totalKwh = sessions.reduce((s, x) => s + Number(x.kwh ?? 0), 0);
  const totalRevenue = sessions
    .filter((x) => x.status === "billed" || x.status === "refunded")
    .reduce((s, x) => s + x.costCents - (x.status === "refunded" ? x.costCents : 0), 0);
  const idleMinutes = sessions.reduce((s, x) => s + (x.idleMinutes ?? 0), 0);
  const avgIdle = totalSessions > 0 ? idleMinutes / totalSessions : 0;
  const byDay = new Map<string, number>();
  for (const x of sessions) {
    const d = x.startAt.slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  res.json({
    portId: id,
    totalSessions,
    totalKwh: +totalKwh.toFixed(3),
    totalRevenueCents: totalRevenue,
    averageIdleMinutes: +avgIdle.toFixed(2),
    sessionsByDay: Array.from(byDay.entries()).map(([date, count]) => ({ date, count })),
  });
});

// ── CSV export for owner history ─────────────────────────────────────────

router.get("/charging/sessions/me/csv", async (req, res) => {
  const rows = await db.select().from(chargingSessionsTable)
    .where(eq(chargingSessionsTable.ownerUserId, req.user!.id))
    .orderBy(desc(chargingSessionsTable.startAt));
  const ports = await db.select().from(chargingPortsTable);
  const portById = new Map(ports.map((p) => [p.id, p]));
  const lines = ["session_id,port,start_at,end_at,kwh,energy_cents,idle_minutes,idle_cents,total_cents,status"];
  for (const s of rows) {
    const p = portById.get(s.portId);
    lines.push([
      s.id,
      JSON.stringify(p?.name ?? ""),
      s.startAt,
      s.endAt ?? "",
      Number(s.kwh ?? 0).toFixed(3),
      s.energyCostCents,
      s.idleMinutes,
      s.idleCostCents,
      s.costCents,
      s.status,
    ].join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="ev-sessions-${req.user!.id}.csv"`);
  res.send(lines.join("\n"));
});

export default router;
