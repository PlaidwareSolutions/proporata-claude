// Task #84: Amenity Guest Parking & Vehicle Registry — REST routes.
// Owner/manager permit lifecycle, printable PDF, public digital pass,
// patrol parking lookup, and towable CSV export.

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  guestParkingPermitsTable,
  unitsTable,
  usersTable,
  unitVehiclesTable,
  organizationSettingsTable,
  type GuestParkingPermit,
} from "@workspace/db/schema";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import type { AuthUser } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { sendEmail } from "../lib/email.js";
import {
  DEFAULT_GUEST_PARKING_SETTINGS,
  loadSettings,
  saveSettings,
  allocatePermitNumber,
  checkEligibility,
  newQrToken,
  verifyQrToken,
  renderQrSvg,
  renderPermitHtml,
  recordPermitAudit,
  recordLookup,
  loadOwnerName,
  loadUnitLabel,
  publicPermit,
  nightsBetween,
  nightsUsedForUnit,
} from "../lib/guestParking.js";

const router: IRouter = Router();
export const guestParkingPublicRouter: IRouter = Router();

function nowISO(): string { return new Date().toISOString(); }
function isManager(user: AuthUser): boolean { return user.role === "admin" || user.role === "manager"; }

async function loadOrgName(): Promise<string> {
  const [s] = await db.select().from(organizationSettingsTable);
  return s?.name ?? "Your HOA";
}

async function publicPassUrl(req: { protocol: string; get: (h: string) => string | undefined }, token: string): Promise<string> {
  const host = req.get("x-forwarded-host") || req.get("host") || "";
  const proto = (req.get("x-forwarded-proto") || req.protocol || "http").split(",")[0];
  // Falls back to relative path when host is unknown.
  if (!host) return `/permit/${token}`;
  return `${proto}://${host}/permit/${token}`;
}

// ── Settings ─────────────────────────────────────────────────────────────

router.get("/guest-parking/settings", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const cfg = await loadSettings();
  res.json({ ...cfg, defaults: DEFAULT_GUEST_PARKING_SETTINGS });
});

router.put("/guest-parking/settings", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const body = req.body ?? {};
  const cur = await loadSettings();
  const merged = {
    perUnitNightlyCap: clampInt(body.perUnitNightlyCap, cur.perUnitNightlyCap, 0, 365),
    rollingWindowDays: clampInt(body.rollingWindowDays, cur.rollingWindowDays, 1, 365),
    maxConsecutiveNights: clampInt(body.maxConsecutiveNights, cur.maxConsecutiveNights, 1, 90),
    maxAdvanceDays: clampInt(body.maxAdvanceDays, cur.maxAdvanceDays, 0, 365),
    requireAccountCurrent: typeof body.requireAccountCurrent === "boolean" ? body.requireAccountCurrent : cur.requireAccountCurrent,
    requireNoOpenViolations: typeof body.requireNoOpenViolations === "boolean" ? body.requireNoOpenViolations : cur.requireNoOpenViolations,
    excludeRegisteredVehicles: typeof body.excludeRegisteredVehicles === "boolean" ? body.excludeRegisteredVehicles : cur.excludeRegisteredVehicles,
    agreementText: typeof body.agreementText === "string" ? body.agreementText.slice(0, 8000) : cur.agreementText,
  };
  const saved = await saveSettings(merged, req.user!.id);
  res.json({ ...saved, defaults: DEFAULT_GUEST_PARKING_SETTINGS });
});

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

// ── Eligibility preview (no-op create, used by the resident wizard) ─────

router.post("/guest-parking/eligibility-preview", async (req, res) => {
  const body = req.body ?? {};
  const unitId = isManager(req.user!) && typeof body.unitId === "string" ? body.unitId : req.user!.unitId;
  if (!unitId) { res.status(400).json({ error: "Unit required" }); return; }
  if (typeof body.startsOn !== "string" || typeof body.endsOn !== "string" || typeof body.plate !== "string") {
    res.status(400).json({ error: "startsOn, endsOn and plate required" }); return;
  }
  const issues = await checkEligibility({
    unitId,
    ownerUserId: req.user!.id,
    startsOn: body.startsOn.slice(0, 10),
    endsOn: body.endsOn.slice(0, 10),
    plate: String(body.plate).toUpperCase().slice(0, 20),
  });
  const settings = await loadSettings();
  const used = await nightsUsedForUnit(unitId, new Date(`${body.endsOn.slice(0, 10)}T23:59:59Z`), settings.rollingWindowDays);
  const remaining = Math.max(0, settings.perUnitNightlyCap - used);
  res.json({ ok: issues.length === 0, issues, settings, used, remaining });
});

// ── Owner / manager listing ─────────────────────────────────────────────

router.get("/guest-parking/permits/me", async (req, res) => {
  if (!req.user!.unitId) { res.json([]); return; }
  const rows = await db
    .select()
    .from(guestParkingPermitsTable)
    .where(eq(guestParkingPermitsTable.unitId, req.user!.unitId))
    .orderBy(desc(guestParkingPermitsTable.startsOn));
  const today = new Date().toISOString().slice(0, 10);
  res.json(rows.map((p) => publicPermit(annotateExpired(p, today))));
});

router.get("/guest-parking/permits", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const unitId = typeof req.query.unitId === "string" ? req.query.unitId : null;
  let rows = await db.select().from(guestParkingPermitsTable).orderBy(desc(guestParkingPermitsTable.startsOn));
  const today = new Date().toISOString().slice(0, 10);
  rows = rows.map((p) => annotateExpired(p, today));
  if (status) rows = rows.filter((p) => p.status === status);
  if (unitId) rows = rows.filter((p) => p.unitId === unitId);
  const ownerIds = Array.from(new Set(rows.map((p) => p.ownerUserId)));
  const owners = ownerIds.length
    ? await db.select().from(usersTable).where(sql`${usersTable.id} = ANY(${ownerIds as unknown as number[]})`)
    : [];
  const nameById = new Map(owners.map((u) => [u.id, u.name ?? "Owner"]));
  res.json(rows.map((p) => publicPermit(p, nameById.get(p.ownerUserId) ?? null)));
});

function annotateExpired(p: GuestParkingPermit, today: string): GuestParkingPermit {
  if (p.status === "active" && p.endsOn < today) return { ...p, status: "expired" };
  return p;
}

// ── Create permit ──────────────────────────────────────────────────────

router.post("/guest-parking/permits", async (req, res) => {
  const body = req.body ?? {};
  const unitId = isManager(req.user!) && typeof body.unitId === "string" ? body.unitId : req.user!.unitId;
  if (!unitId) { res.status(400).json({ error: "Unit required" }); return; }
  const ownerUserId = isManager(req.user!) && typeof body.ownerUserId === "number" ? body.ownerUserId : req.user!.id;

  const startsOn = typeof body.startsOn === "string" ? body.startsOn.slice(0, 10) : "";
  const endsOn = typeof body.endsOn === "string" ? body.endsOn.slice(0, 10) : "";
  const plate = typeof body.plate === "string" ? body.plate.trim().toUpperCase().slice(0, 20) : "";
  if (!startsOn || !endsOn || !plate) { res.status(400).json({ error: "startsOn, endsOn, and plate are required" }); return; }

  const agreementSignedName = typeof body.agreementSignedName === "string" ? body.agreementSignedName.slice(0, 200).trim() : "";
  if (!isManager(req.user!) && !agreementSignedName) {
    res.status(400).json({ error: "Sign the permit agreement to continue." }); return;
  }

  const issues = await checkEligibility({ unitId, ownerUserId, startsOn, endsOn, plate });
  if (issues.length > 0 && !(isManager(req.user!) && body.overrideEligibility === true)) {
    res.status(400).json({ error: "Permit cannot be issued.", issues });
    return;
  }

  // Allocate sequential permit number for the year of startsOn.
  const year = parseInt(startsOn.slice(0, 4), 10);
  const { number, seq } = await allocatePermitNumber(year);

  // Insert with placeholder qrToken so we can sign with the row id.
  const placeholderToken = `pending-${number}-${Date.now()}`;
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null;
  const [row] = await db.insert(guestParkingPermitsTable).values({
    unitId,
    ownerUserId,
    permitNumber: number,
    numberYear: year,
    numberSeq: seq,
    startsOn,
    endsOn,
    nights: nightsBetween(startsOn, endsOn),
    guestName: typeof body.guestName === "string" ? body.guestName.slice(0, 200) : "",
    plate,
    plateState: typeof body.plateState === "string" ? body.plateState.slice(0, 8).toUpperCase() : "",
    vehicleMake: typeof body.vehicleMake === "string" ? body.vehicleMake.slice(0, 80) : "",
    vehicleModel: typeof body.vehicleModel === "string" ? body.vehicleModel.slice(0, 80) : "",
    vehicleColor: typeof body.vehicleColor === "string" ? body.vehicleColor.slice(0, 40) : "",
    vehicleDesc: typeof body.vehicleDesc === "string" ? body.vehicleDesc.slice(0, 200) : "",
    notes: typeof body.notes === "string" ? body.notes.slice(0, 1000) : "",
    status: "active",
    agreementSignedName,
    agreementSignedAt: agreementSignedName ? nowISO() : null,
    agreementSignedIp: agreementSignedName ? ip : null,
    qrToken: placeholderToken,
    pdfStorageKey: null,
    cancelledAt: null,
    cancelledByUserId: null,
    cancellationReason: "",
    createdByUserId: req.user!.id,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  }).returning();

  const qrToken = newQrToken({ permitId: row.id, permitNumber: row.permitNumber, plate: row.plate });
  await db.update(guestParkingPermitsTable).set({ qrToken }).where(eq(guestParkingPermitsTable.id, row.id));
  row.qrToken = qrToken;

  await recordPermitAudit({ permitId: row.id, action: "issued", actorUserId: req.user!.id, actorName: req.user!.name, message: `${number} ${plate}`, payload: { startsOn, endsOn, plate } });

  void notifyOwner(row, "issued").catch((err) => logger.error({ err }, "Permit email failed"));

  res.status(201).json(publicPermit(row, await loadOwnerName(ownerUserId)));
});

// ── Modify ─────────────────────────────────────────────────────────────

router.patch("/guest-parking/permits/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [p] = await db.select().from(guestParkingPermitsTable).where(eq(guestParkingPermitsTable.id, id));
  if (!p) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!) && (p.ownerUserId !== req.user!.id && p.unitId !== req.user!.unitId)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (p.status !== "active") { res.status(400).json({ error: `Cannot modify a ${p.status} permit` }); return; }

  const body = req.body ?? {};
  const startsOn = typeof body.startsOn === "string" ? body.startsOn.slice(0, 10) : p.startsOn;
  const endsOn = typeof body.endsOn === "string" ? body.endsOn.slice(0, 10) : p.endsOn;
  const plate = typeof body.plate === "string" ? body.plate.trim().toUpperCase().slice(0, 20) : p.plate;

  if (startsOn !== p.startsOn || endsOn !== p.endsOn || plate !== p.plate) {
    const issues = await checkEligibility({
      unitId: p.unitId, ownerUserId: p.ownerUserId, startsOn, endsOn, plate, excludePermitId: p.id,
    });
    if (issues.length > 0 && !(isManager(req.user!) && body.overrideEligibility === true)) {
      res.status(400).json({ error: "Modification not allowed.", issues });
      return;
    }
  }

  const patch: Partial<typeof guestParkingPermitsTable.$inferInsert> = {
    startsOn, endsOn, plate,
    nights: nightsBetween(startsOn, endsOn),
    updatedAt: nowISO(),
  };
  if (typeof body.guestName === "string") patch.guestName = body.guestName.slice(0, 200);
  if (typeof body.plateState === "string") patch.plateState = body.plateState.slice(0, 8).toUpperCase();
  if (typeof body.vehicleMake === "string") patch.vehicleMake = body.vehicleMake.slice(0, 80);
  if (typeof body.vehicleModel === "string") patch.vehicleModel = body.vehicleModel.slice(0, 80);
  if (typeof body.vehicleColor === "string") patch.vehicleColor = body.vehicleColor.slice(0, 40);
  if (typeof body.vehicleDesc === "string") patch.vehicleDesc = body.vehicleDesc.slice(0, 200);
  if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 1000);

  const [updated] = await db.update(guestParkingPermitsTable).set(patch).where(eq(guestParkingPermitsTable.id, id)).returning();
  await recordPermitAudit({ permitId: id, action: "modified", actorUserId: req.user!.id, actorName: req.user!.name, payload: patch });
  void notifyOwner(updated, "modified").catch((err) => logger.error({ err }, "Permit email failed"));
  res.json(publicPermit(updated, await loadOwnerName(updated.ownerUserId)));
});

// ── Cancel ─────────────────────────────────────────────────────────────

router.post("/guest-parking/permits/:id/cancel", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [p] = await db.select().from(guestParkingPermitsTable).where(eq(guestParkingPermitsTable.id, id));
  if (!p) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!) && (p.ownerUserId !== req.user!.id && p.unitId !== req.user!.unitId)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (p.status !== "active") { res.status(400).json({ error: `Already ${p.status}` }); return; }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : "";
  const [updated] = await db.update(guestParkingPermitsTable).set({
    status: "cancelled",
    cancelledAt: nowISO(),
    cancelledByUserId: req.user!.id,
    cancellationReason: reason,
    updatedAt: nowISO(),
  }).where(eq(guestParkingPermitsTable.id, id)).returning();
  await recordPermitAudit({ permitId: id, action: "cancelled", actorUserId: req.user!.id, actorName: req.user!.name, message: reason });
  void notifyOwner(updated, "cancelled", reason).catch((err) => logger.error({ err }, "Permit email failed"));
  res.json(publicPermit(updated, await loadOwnerName(updated.ownerUserId)));
});

// ── Printable PDF (HTML) ────────────────────────────────────────────────

router.get("/guest-parking/permits/:id/permit.html", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [p] = await db.select().from(guestParkingPermitsTable).where(eq(guestParkingPermitsTable.id, id));
  if (!p) { res.status(404).end(); return; }
  if (!isManager(req.user!) && p.ownerUserId !== req.user!.id && p.unitId !== req.user!.unitId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const orgName = await loadOrgName();
  const ownerName = await loadOwnerName(p.ownerUserId);
  const unitLabel = await loadUnitLabel(p.unitId);
  const passUrl = await publicPassUrl(req, p.qrToken);
  const html = await renderPermitHtml(p, { orgName, ownerName, unitLabel, publicPassUrl: passUrl });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

router.get("/guest-parking/permits/:id/qr.svg", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [p] = await db.select().from(guestParkingPermitsTable).where(eq(guestParkingPermitsTable.id, id));
  if (!p) { res.status(404).end(); return; }
  if (!isManager(req.user!) && p.ownerUserId !== req.user!.id && p.unitId !== req.user!.unitId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const passUrl = await publicPassUrl(req, p.qrToken);
  const svg = await renderQrSvg(passUrl);
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(svg);
});

// ── Public digital pass (no auth, opaque signed token) ─────────────────

guestParkingPublicRouter.get("/permit/:token", async (req, res) => {
  const decoded = verifyQrToken(req.params.token);
  if (!decoded) { res.status(404).type("text/html").send(passErrorHtml("Invalid permit token.")); return; }
  const [p] = await db.select().from(guestParkingPermitsTable).where(eq(guestParkingPermitsTable.id, decoded.permitId));
  if (!p || p.qrToken !== req.params.token) { res.status(404).type("text/html").send(passErrorHtml("Permit not found.")); return; }
  const today = new Date().toISOString().slice(0, 10);
  const annotated = annotateExpired(p, today);
  const orgName = await loadOrgName();
  const ownerName = await loadOwnerName(p.ownerUserId);
  const validNow = annotated.status === "active" && p.startsOn <= today && p.endsOn >= today;
  const e = (s: string) => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Guest Parking Permit ${e(p.permitNumber)}</title>
<style>
body { font-family: system-ui, sans-serif; margin: 0; padding: 0; color: #111; background: #f5f5f7; }
.card { max-width: 480px; margin: 24px auto; background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,.06); overflow: hidden; }
.head { padding: 18px 22px; background: ${validNow ? "#0E8A6B" : "#9A2542"}; color: #fff; }
.head h1 { margin: 0; font-size: 18px; letter-spacing: .04em; text-transform: uppercase; }
.head p { margin: 4px 0 0; font-size: 13px; opacity: .9; }
.body { padding: 18px 22px; }
.permit-id { text-align: center; font-family: ui-monospace, monospace; font-size: 22px; padding: 12px; background: #FFF7E0; border-radius: 10px; margin-bottom: 14px; }
.row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; }
.row .l { color: #666; }
.note { font-size: 12px; color: #555; margin-top: 16px; line-height: 1.5; }
.status { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; background: rgba(255,255,255,.18); }
</style></head><body>
<div class="card">
  <div class="head">
    <h1>Guest Parking Pass</h1>
    <p>${e(orgName)} <span class="status">${validNow ? "VALID NOW" : annotated.status.toUpperCase()}</span></p>
  </div>
  <div class="body">
    <div class="permit-id">${e(p.permitNumber)}</div>
    <div class="row"><span class="l">Plate</span><strong>${e(p.plate)}${p.plateState ? " (" + e(p.plateState) + ")" : ""}</strong></div>
    <div class="row"><span class="l">Vehicle</span><span>${e([p.vehicleColor, p.vehicleMake, p.vehicleModel].filter(Boolean).join(" ") || "—")}</span></div>
    <div class="row"><span class="l">Unit</span><span>${e(p.unitId)} (${e(ownerName)})</span></div>
    <div class="row"><span class="l">Valid</span><span>${e(p.startsOn)} → ${e(p.endsOn)} (${p.nights}n)</span></div>
    <div class="row"><span class="l">Status</span><span>${e(annotated.status)}</span></div>
    <p class="note">Verified by ${e(orgName)}. This digital pass is signed and tamper-evident.</p>
  </div>
</div>
</body></html>`);
});

function passErrorHtml(msg: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;text-align:center;padding:48px;color:#9A2542">
<h1 style="margin:0">Invalid Permit</h1><p>${msg}</p></body></html>`;
}

// ── Patrol parking lookup ──────────────────────────────────────────────

router.get("/patrol/parking", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) { res.json({ query: "", plate: "", permits: [], registeredVehicles: [], result: "empty" }); return; }
  const upper = q.toUpperCase();
  const today = new Date().toISOString().slice(0, 10);

  const [permits, vehicles] = await Promise.all([
    db.select().from(guestParkingPermitsTable).where(sql`upper(${guestParkingPermitsTable.plate}) = ${upper} or ${guestParkingPermitsTable.permitNumber} ilike ${"%" + q + "%"}`),
    db.select().from(unitVehiclesTable).where(sql`upper(${unitVehiclesTable.plate}) = ${upper}`),
  ]);

  const annotated = permits.map((p) => annotateExpired(p, today));
  const ownerIds = Array.from(new Set(annotated.map((p) => p.ownerUserId)));
  const owners = ownerIds.length
    ? await db.select().from(usersTable).where(sql`${usersTable.id} = ANY(${ownerIds as unknown as number[]})`)
    : [];
  const nameById = new Map(owners.map((u) => [u.id, u.name ?? "Owner"]));

  let result: "permitted" | "expired" | "cancelled" | "registered_resident" | "unregistered" = "unregistered";
  let permitId: number | null = null;
  let unitId: string | null = null;

  const validNow = annotated.find((p) => p.plate.toUpperCase() === upper && p.status === "active" && p.startsOn <= today && p.endsOn >= today);
  if (validNow) { result = "permitted"; permitId = validNow.id; unitId = validNow.unitId; }
  else if (vehicles.length > 0) { result = "registered_resident"; unitId = vehicles[0].unitId; }
  else if (annotated.some((p) => p.plate.toUpperCase() === upper && p.status === "expired")) result = "expired";
  else if (annotated.some((p) => p.plate.toUpperCase() === upper && p.status === "cancelled")) result = "cancelled";

  await recordLookup({
    query: q, plate: upper, result, permitId, unitId,
    patrolUserId: req.user!.id, patrolName: req.user!.name,
  });

  res.json({
    query: q,
    plate: upper,
    result,
    permits: annotated.map((p) => publicPermit(p, nameById.get(p.ownerUserId) ?? null)),
    registeredVehicles: vehicles,
  });
});

// ── Towable CSV ────────────────────────────────────────────────────────
// Export a list of plates that are observed (provided by patrol) but have
// no active permit and are not in the resident registry. Patrol uploads a
// list of observed plates as a CSV body or query param `plates=A,B,C`.

router.get("/guest-parking/towable.csv", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const platesParam = typeof req.query.plates === "string" ? req.query.plates : "";
  const observed = platesParam.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);

  const towable: Array<{ plate: string; reason: string; lastSeen?: string }> = [];
  for (const plate of observed) {
    const [veh] = await db.select().from(unitVehiclesTable).where(sql`upper(${unitVehiclesTable.plate}) = ${plate}`);
    if (veh) continue; // resident-registered, do not tow
    const permits = await db.select().from(guestParkingPermitsTable).where(sql`upper(${guestParkingPermitsTable.plate}) = ${plate}`);
    const valid = permits.find((p) => p.status === "active" && p.startsOn <= today && p.endsOn >= today);
    if (valid) continue;
    const reason = permits.length === 0 ? "no permit" : (permits.some((p) => p.status === "cancelled") ? "permit cancelled" : "permit expired");
    towable.push({ plate, reason });
  }

  const lines = ["plate,reason"];
  for (const t of towable) lines.push(`${t.plate},${t.reason}`);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="towable-${today}.csv"`);
  res.send(lines.join("\n"));
});

// ── Lookup history (audit) ─────────────────────────────────────────────

router.get("/guest-parking/lookups", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const { guestParkingLookupsTable } = await import("@workspace/db/schema");
  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
  const rows = await db.select().from(guestParkingLookupsTable).orderBy(desc(guestParkingLookupsTable.createdAt)).limit(limit);
  res.json(rows);
});

// ── Notifications ──────────────────────────────────────────────────────

async function notifyOwner(p: GuestParkingPermit, action: "issued" | "modified" | "cancelled", reason?: string): Promise<void> {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, p.ownerUserId));
  if (!u?.email) return;
  const orgName = await loadOrgName();
  const subjMap = {
    issued: `Guest parking permit ${p.permitNumber} issued`,
    modified: `Guest parking permit ${p.permitNumber} updated`,
    cancelled: `Guest parking permit ${p.permitNumber} cancelled`,
  };
  const html = `<p>Hi ${u.name ?? "Owner"},</p>
<p>Your guest parking permit <strong>${p.permitNumber}</strong> for plate <strong>${p.plate}</strong> has been <strong>${action}</strong>.</p>
<p>Valid: ${p.startsOn} → ${p.endsOn} (${p.nights} night${p.nights === 1 ? "" : "s"})</p>
${reason ? `<p>Reason: ${reason}</p>` : ""}
<p>— ${orgName}</p>`;
  await sendEmail(u.email, subjMap[action], html);
}

void and; void asc; void ne;

export default router;
