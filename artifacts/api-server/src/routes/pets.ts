// Task #85: Pet registry & dog-park module REST routes.
//
// Endpoints:
//   GET    /pets/me                         resident: my unit's pets
//   POST   /pets/me                         resident/manager: register a pet
//   GET    /pets/:id                        owner/manager
//   PATCH  /pets/:id                        owner/manager
//   DELETE /pets/:id                        soft-archive
//   POST   /pets/:id/approve                owner approves a tenant-filed pet
//   POST   /pets/:id/reject                 owner rejects
//   GET    /pets/:id/vaccinations
//   POST   /pets/:id/vaccinations
//   DELETE /pets/vaccinations/:id
//   POST   /pets/upload-url                 returns object-storage uploadURL
//
//   GET    /pets/dogpark/agreement/me       active agreement for my unit
//   POST   /pets/dogpark/agreement          sign agreement
//   GET    /pets/dogpark/eligibility/me     {ok, reason, eligiblePets}
//   GET    /pets/dogpark/settings           current settings (public-safe)
//   PUT    /pets/dogpark/settings           manager only
//
//   GET    /pets                            manager: dashboard list
//   GET    /pets/dashboard                  manager: counts/expiring soon
//   GET    /pets/incidents                  manager: list / filter
//   POST   /pets/:id/incidents              manager: file an incident
//   PATCH  /pets/incidents/:id              manager: update status/resolution
//   POST   /pets/:id/suspend                manager: manual suspension
//   POST   /pets/:id/restore                manager: lift suspension
//   GET    /pets/audit                      manager: audit trail
//   GET    /pets/export.csv                 manager: CSV export

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  petsTable,
  petVaccinationsTable,
  petDogparkAgreementsTable,
  petIncidentsTable,
  petAuditTable,
  dogParkSettingsTable,
  unitsTable,
  organizationSettingsTable,
  amenitiesTable,
  amenityBookingsTable,
  amenityAccessCodesTable,
  type Pet,
  type DogParkSettings,
} from "@workspace/db/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { AuthUser } from "../middleware/auth.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import {
  audit,
  computePetStatus,
  defaultDogParkSettings,
  getDogParkAmenityId,
  getDogParkSettings,
  isUnitDogParkEligible,
  nowISO,
  petIncidentSuspension,
  recomputePetStatus,
  vaccinationStatusList,
} from "../lib/petsCompliance.js";
import { recordAudit } from "../lib/amenityAccess.js";
import {
  buildPetIncidentEmail,
  buildPetSuspensionEmail,
  sendEmail,
} from "../lib/email.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

function isManager(u: AuthUser): boolean { return u.role === "admin" || u.role === "manager"; }

async function loadOrgName(): Promise<string> {
  const [s] = await db.select().from(organizationSettingsTable);
  return s?.name ?? "HOA";
}

async function unitContacts(unitId: string): Promise<string[]> {
  const [u] = await db.select().from(unitsTable).where(eq(unitsTable.id, unitId));
  if (!u) return [];
  const out: string[] = [];
  if (u.ownerEmail) out.push(u.ownerEmail);
  if (u.tenantEmail) out.push(u.tenantEmail);
  return out;
}

function publicPet(p: Pet) {
  return {
    id: p.id,
    unitId: p.unitId,
    filedByUserId: p.filedByUserId,
    filedByName: p.filedByName,
    name: p.name,
    species: p.species,
    breed: p.breed,
    weightLbs: p.weightLbs,
    sex: p.sex,
    spayedNeutered: p.spayedNeutered,
    color: p.color,
    photoStorageKey: p.photoStorageKey,
    microchipNumber: p.microchipNumber,
    vetName: p.vetName,
    vetPhone: p.vetPhone,
    notes: p.notes,
    status: p.status,
    approvalState: p.approvalState,
    approvedAt: p.approvedAt,
    suspendedUntil: p.suspendedUntil,
    suspendedReason: p.suspendedReason,
    archivedAt: p.archivedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

async function loadPetWithDetails(id: number) {
  const [pet] = await db.select().from(petsTable).where(eq(petsTable.id, id));
  if (!pet) return null;
  const vaxs = await db.select().from(petVaccinationsTable).where(eq(petVaccinationsTable.petId, id)).orderBy(desc(petVaccinationsTable.expiresOn));
  const incidents = await db.select().from(petIncidentsTable).where(eq(petIncidentsTable.petId, id)).orderBy(desc(petIncidentsTable.occurredAt));
  return {
    ...publicPet(pet),
    vaccinations: vaxs,
    vaccinationSummary: vaccinationStatusList(pet, vaxs),
    incidents,
  };
}

function canEditUnitPets(u: AuthUser, unitId: string): boolean {
  if (isManager(u)) return true;
  return Boolean(u.unitId) && u.unitId === unitId;
}

// ── Pets CRUD ────────────────────────────────────────────────────────────

router.get("/pets/me", async (req, res) => {
  if (!req.user!.unitId) { res.json([]); return; }
  const pets = await db.select().from(petsTable).where(eq(petsTable.unitId, req.user!.unitId));
  const out = await Promise.all(pets.filter((p) => !p.archivedAt).map(async (p) => {
    const vaxs = await db.select().from(petVaccinationsTable).where(eq(petVaccinationsTable.petId, p.id));
    return { ...publicPet(p), vaccinations: vaxs, vaccinationSummary: vaccinationStatusList(p, vaxs) };
  }));
  res.json(out);
});

router.post("/pets/me", async (req, res) => {
  const body = req.body ?? {};
  let unitId: string | null = req.user!.unitId ?? null;
  if (isManager(req.user!) && typeof body.unitId === "string") unitId = body.unitId;
  if (!unitId) { res.status(400).json({ error: "Unit required" }); return; }
  if (!canEditUnitPets(req.user!, unitId)) { res.status(403).json({ error: "Forbidden" }); return; }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const species = ["dog", "cat", "other"].includes(body.species) ? body.species : "dog";
  const sex = ["male", "female", "unknown"].includes(body.sex) ? body.sex : "unknown";
  const settings = await getDogParkSettings();
  // Tenant-filed pets need owner approval if configured.
  const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, unitId));
  const isTenant = !isManager(req.user!)
    && unit?.tenantEmail
    && unit.tenantEmail.toLowerCase() === (req.user!.email ?? "").toLowerCase();
  const approvalState = settings.ownerApprovalRequiredForTenants && isTenant ? "pending" : "approved";

  const [created] = await db.insert(petsTable).values({
    unitId,
    filedByUserId: req.user!.id,
    filedByName: req.user!.name ?? "",
    name,
    species,
    breed: typeof body.breed === "string" ? body.breed.slice(0, 80) : "",
    weightLbs: typeof body.weightLbs === "number" ? Math.max(0, Math.floor(body.weightLbs)) : 0,
    sex,
    spayedNeutered: body.spayedNeutered === true,
    color: typeof body.color === "string" ? body.color.slice(0, 80) : "",
    photoStorageKey: typeof body.photoStorageKey === "string" ? body.photoStorageKey : null,
    microchipNumber: typeof body.microchipNumber === "string" ? body.microchipNumber.slice(0, 60) : "",
    vetName: typeof body.vetName === "string" ? body.vetName.slice(0, 200) : "",
    vetPhone: typeof body.vetPhone === "string" ? body.vetPhone.slice(0, 40) : "",
    notes: typeof body.notes === "string" ? body.notes.slice(0, 2000) : "",
    status: "non_compliant",
    approvalState,
    approvedByUserId: approvalState === "approved" ? req.user!.id : null,
    approvedAt: approvalState === "approved" ? nowISO() : null,
    suspendedUntil: null,
    suspendedReason: "",
    archivedAt: null,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  }).returning();

  await audit({
    petId: created.id, unitId, action: "created",
    actorUserId: req.user!.id, actorName: req.user!.name,
    diff: { name, species, approvalState },
  });
  await recomputePetStatus(created.id);
  const detail = await loadPetWithDetails(created.id);
  res.status(201).json(detail);
});

// ── Manager dashboard ────────────────────────────────────────────────────
// Note: literal /pets/<word> routes must be registered BEFORE /pets/:id,
// otherwise Express matches them as :id and returns 400 "Invalid id".

router.get("/pets", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const unit = typeof req.query.unitId === "string" ? req.query.unitId : "";
  let rows = await db.select().from(petsTable).orderBy(asc(petsTable.unitId));
  if (status) rows = rows.filter((p) => p.status === status);
  if (unit) rows = rows.filter((p) => p.unitId === unit);
  // attach quick vaccination summary
  const out = await Promise.all(rows.map(async (p) => {
    const vaxs = await db.select().from(petVaccinationsTable).where(eq(petVaccinationsTable.petId, p.id));
    return { ...publicPet(p), vaccinationSummary: vaccinationStatusList(p, vaxs) };
  }));
  res.json(out);
});

router.get("/pets/dashboard", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const pets = await db.select().from(petsTable);
  const active = pets.filter((p) => !p.archivedAt);
  const counts = {
    total: active.length,
    compliant: active.filter((p) => p.status === "compliant").length,
    expiringSoon: active.filter((p) => p.status === "expiring_soon").length,
    nonCompliant: active.filter((p) => p.status === "non_compliant").length,
    pendingApproval: active.filter((p) => p.status === "pending_approval").length,
    suspended: active.filter((p) => p.status === "suspended").length,
  };
  // Expiring vaccinations (next 30 days, current pets)
  const vaxs = await db.select().from(petVaccinationsTable);
  const now = Date.now();
  const horizon = now + 30 * 86_400_000;
  const petById = new Map(active.map((p) => [p.id, p] as const));
  const expiring = vaxs
    .filter((v) => petById.has(v.petId))
    .filter((v) => {
      const t = new Date(v.expiresOn + "T00:00:00Z").getTime();
      return t >= now - 86_400_000 && t <= horizon;
    })
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
    .slice(0, 50)
    .map((v) => ({
      id: v.id,
      petId: v.petId,
      petName: petById.get(v.petId)?.name ?? "",
      unitId: petById.get(v.petId)?.unitId ?? "",
      vaccineType: v.vaccineType,
      expiresOn: v.expiresOn,
    }));
  // Recent incidents (last 14 days)
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const recentIncidents = await db
    .select()
    .from(petIncidentsTable)
    .orderBy(desc(petIncidentsTable.occurredAt))
    .limit(20);
  res.json({
    counts,
    expiringVaccinations: expiring,
    recentIncidents: recentIncidents.filter((i) => i.occurredAt >= since),
  });
});

router.get("/pets/incidents", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const status = typeof req.query.status === "string" ? req.query.status : "";
  let rows = await db.select().from(petIncidentsTable).orderBy(desc(petIncidentsTable.occurredAt));
  if (status) rows = rows.filter((r) => r.status === status);
  res.json(rows);
});

router.get("/pets/audit", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const petIdParam = typeof req.query.petId === "string" ? parseInt(req.query.petId, 10) : NaN;
  let q = db.select().from(petAuditTable).$dynamic();
  if (!Number.isNaN(petIdParam)) q = q.where(eq(petAuditTable.petId, petIdParam));
  const rows = await q.orderBy(desc(petAuditTable.createdAt)).limit(500);
  res.json(rows);
});

router.get("/pets/export.csv", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const pets = await db.select().from(petsTable);
  const vaxs = await db.select().from(petVaccinationsTable);
  const byPet = new Map<number, typeof vaxs>();
  for (const v of vaxs) {
    if (!byPet.has(v.petId)) byPet.set(v.petId, []);
    byPet.get(v.petId)!.push(v);
  }
  const headers = [
    "id", "unit", "name", "species", "breed", "weightLbs", "sex",
    "spayedNeutered", "color", "status", "approvalState", "suspendedUntil",
    "rabiesExpires", "dhppExpires", "createdAt",
  ];
  const lines = [headers.join(",")];
  for (const p of pets) {
    if (p.archivedAt) continue;
    const pv = byPet.get(p.id) ?? [];
    const findExp = (t: string) => {
      const sorted = pv.filter((v) => v.vaccineType === t).sort((a, b) => b.expiresOn.localeCompare(a.expiresOn));
      return sorted[0]?.expiresOn ?? "";
    };
    const cells = [
      String(p.id), p.unitId, p.name, p.species, p.breed,
      String(p.weightLbs), p.sex, String(p.spayedNeutered),
      p.color, p.status, p.approvalState, p.suspendedUntil ?? "",
      findExp("rabies"), findExp("dhpp"), p.createdAt,
    ].map((c) => {
      const s = String(c).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    });
    lines.push(cells.join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="pets-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join("\n"));
});

// ── Pet detail / per-id routes ───────────────────────────────────────────

router.get("/pets/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const detail = await loadPetWithDetails(id);
  if (!detail) { res.status(404).json({ error: "Not found" }); return; }
  if (!canEditUnitPets(req.user!, detail.unitId)) { res.status(403).json({ error: "Forbidden" }); return; }
  res.json(detail);
});

router.patch("/pets/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [pet] = await db.select().from(petsTable).where(eq(petsTable.id, id));
  if (!pet) { res.status(404).json({ error: "Not found" }); return; }
  if (!canEditUnitPets(req.user!, pet.unitId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const body = req.body ?? {};
  const patch: Partial<typeof petsTable.$inferInsert> = { updatedAt: nowISO() };
  if (typeof body.name === "string") patch.name = body.name.slice(0, 80);
  if (["dog", "cat", "other"].includes(body.species)) patch.species = body.species;
  if (typeof body.breed === "string") patch.breed = body.breed.slice(0, 80);
  if (typeof body.weightLbs === "number") patch.weightLbs = Math.max(0, Math.floor(body.weightLbs));
  if (["male", "female", "unknown"].includes(body.sex)) patch.sex = body.sex;
  if (typeof body.spayedNeutered === "boolean") patch.spayedNeutered = body.spayedNeutered;
  if (typeof body.color === "string") patch.color = body.color.slice(0, 80);
  if (typeof body.photoStorageKey === "string" || body.photoStorageKey === null) patch.photoStorageKey = body.photoStorageKey;
  if (typeof body.microchipNumber === "string") patch.microchipNumber = body.microchipNumber.slice(0, 60);
  if (typeof body.vetName === "string") patch.vetName = body.vetName.slice(0, 200);
  if (typeof body.vetPhone === "string") patch.vetPhone = body.vetPhone.slice(0, 40);
  if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 2000);
  await db.update(petsTable).set(patch).where(eq(petsTable.id, id));
  await audit({
    petId: id, unitId: pet.unitId, action: "edited",
    actorUserId: req.user!.id, actorName: req.user!.name, diff: patch,
  });
  await recomputePetStatus(id);
  res.json(await loadPetWithDetails(id));
});

router.delete("/pets/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [pet] = await db.select().from(petsTable).where(eq(petsTable.id, id));
  if (!pet) { res.status(404).end(); return; }
  if (!canEditUnitPets(req.user!, pet.unitId)) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.update(petsTable).set({ archivedAt: nowISO(), updatedAt: nowISO() }).where(eq(petsTable.id, id));
  await audit({
    petId: id, unitId: pet.unitId, action: "deleted",
    actorUserId: req.user!.id, actorName: req.user!.name,
  });
  res.status(204).end();
});

router.post("/pets/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [pet] = await db.select().from(petsTable).where(eq(petsTable.id, id));
  if (!pet) { res.status(404).json({ error: "Not found" }); return; }
  if (!canEditUnitPets(req.user!, pet.unitId)) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.update(petsTable).set({
    approvalState: "approved",
    approvedByUserId: req.user!.id,
    approvedAt: nowISO(),
    updatedAt: nowISO(),
  }).where(eq(petsTable.id, id));
  await audit({ petId: id, unitId: pet.unitId, action: "approved", actorUserId: req.user!.id, actorName: req.user!.name });
  await recomputePetStatus(id);
  res.json(await loadPetWithDetails(id));
});

router.post("/pets/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [pet] = await db.select().from(petsTable).where(eq(petsTable.id, id));
  if (!pet) { res.status(404).json({ error: "Not found" }); return; }
  if (!canEditUnitPets(req.user!, pet.unitId)) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.update(petsTable).set({
    approvalState: "rejected",
    approvedByUserId: req.user!.id,
    approvedAt: nowISO(),
    archivedAt: nowISO(),
    updatedAt: nowISO(),
  }).where(eq(petsTable.id, id));
  await audit({ petId: id, unitId: pet.unitId, action: "rejected", actorUserId: req.user!.id, actorName: req.user!.name });
  res.json(await loadPetWithDetails(id));
});

// ── Vaccinations ─────────────────────────────────────────────────────────

router.get("/pets/:id/vaccinations", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [pet] = await db.select().from(petsTable).where(eq(petsTable.id, id));
  if (!pet) { res.status(404).json({ error: "Not found" }); return; }
  if (!canEditUnitPets(req.user!, pet.unitId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const rows = await db.select().from(petVaccinationsTable).where(eq(petVaccinationsTable.petId, id)).orderBy(desc(petVaccinationsTable.expiresOn));
  res.json(rows);
});

router.post("/pets/:id/vaccinations", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [pet] = await db.select().from(petsTable).where(eq(petsTable.id, id));
  if (!pet) { res.status(404).json({ error: "Not found" }); return; }
  if (!canEditUnitPets(req.user!, pet.unitId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const body = req.body ?? {};
  const vaccineType = typeof body.vaccineType === "string" ? body.vaccineType.toLowerCase().slice(0, 40) : "";
  if (!vaccineType) { res.status(400).json({ error: "vaccineType required" }); return; }
  const administeredOn = typeof body.administeredOn === "string" ? body.administeredOn.slice(0, 10) : "";
  const expiresOn = typeof body.expiresOn === "string" ? body.expiresOn.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(administeredOn) || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) {
    res.status(400).json({ error: "administeredOn and expiresOn must be YYYY-MM-DD" }); return;
  }
  const [row] = await db.insert(petVaccinationsTable).values({
    petId: id,
    vaccineType,
    administeredOn,
    expiresOn,
    certificateStorageKey: typeof body.certificateStorageKey === "string" ? body.certificateStorageKey : null,
    notes: typeof body.notes === "string" ? body.notes.slice(0, 1000) : "",
    uploadedByUserId: req.user!.id,
    uploadedByName: req.user!.name ?? "",
    remindersSent: [],
    createdAt: nowISO(),
  }).returning();
  await audit({
    petId: id, unitId: pet.unitId, action: "vaccination_added",
    actorUserId: req.user!.id, actorName: req.user!.name,
    diff: { vaccineType, administeredOn, expiresOn },
  });
  await recomputePetStatus(id);
  res.status(201).json(row);
});

router.delete("/pets/vaccinations/:vid", async (req, res) => {
  const vid = parseInt(req.params.vid, 10);
  if (Number.isNaN(vid)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [v] = await db.select().from(petVaccinationsTable).where(eq(petVaccinationsTable.id, vid));
  if (!v) { res.status(404).end(); return; }
  const [pet] = await db.select().from(petsTable).where(eq(petsTable.id, v.petId));
  if (!pet) { res.status(404).end(); return; }
  if (!canEditUnitPets(req.user!, pet.unitId)) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.delete(petVaccinationsTable).where(eq(petVaccinationsTable.id, vid));
  await audit({
    petId: v.petId, unitId: pet.unitId, action: "vaccination_deleted",
    actorUserId: req.user!.id, actorName: req.user!.name, diff: { vaccinationId: vid },
  });
  await recomputePetStatus(v.petId);
  res.status(204).end();
});

router.post("/pets/upload-url", async (_req, res) => {
  try {
    const storage = new ObjectStorageService();
    const uploadURL = await storage.getObjectEntityUploadURL();
    res.json({ uploadURL });
  } catch (err) {
    logger.error({ err }, "Pets upload-url failed");
    res.status(500).json({ error: "Could not create upload URL" });
  }
});

// ── Dog-park agreement ───────────────────────────────────────────────────

router.get("/pets/dogpark/agreement/me", async (req, res) => {
  if (!req.user!.unitId) { res.json(null); return; }
  const [row] = await db
    .select()
    .from(petDogparkAgreementsTable)
    .where(eq(petDogparkAgreementsTable.unitId, req.user!.unitId))
    .orderBy(desc(petDogparkAgreementsTable.signedAt))
    .limit(1);
  res.json(row ?? null);
});

router.post("/pets/dogpark/agreement", async (req, res) => {
  const body = req.body ?? {};
  let unitId: string | null = req.user!.unitId ?? null;
  if (isManager(req.user!) && typeof body.unitId === "string") unitId = body.unitId;
  if (!unitId) { res.status(400).json({ error: "Unit required" }); return; }
  if (!canEditUnitPets(req.user!, unitId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const settings = await getDogParkSettings();
  const text = settings.agreementText ?? "";
  const signedByName = typeof body.signedByName === "string" ? body.signedByName.trim().slice(0, 200) : "";
  if (!signedByName) { res.status(400).json({ error: "signedByName required" }); return; }
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null;
  const signedAt = nowISO();
  // Annual expiry
  const expiresAt = new Date(Date.now() + 365 * 86_400_000).toISOString();
  const [row] = await db.insert(petDogparkAgreementsTable).values({
    unitId,
    signedByUserId: req.user!.id,
    signedByName,
    signedIp: ip,
    agreementText: text,
    signedAt,
    expiresAt,
  }).returning();
  await audit({
    unitId, action: "agreement_signed",
    actorUserId: req.user!.id, actorName: req.user!.name,
    diff: { agreementId: row.id, expiresAt },
  });
  res.status(201).json(row);
});

router.get("/pets/dogpark/eligibility/me", async (req, res) => {
  if (!req.user!.unitId) {
    res.json({ ok: false, reason: "No unit on file", eligiblePets: [] }); return;
  }
  const result = await isUnitDogParkEligible(req.user!.unitId);
  res.json(result);
});

router.get("/pets/dogpark/settings", async (_req, res) => {
  const settings = await getDogParkSettings();
  res.json(settings);
});

router.put("/pets/dogpark/settings", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const amenityId = await getDogParkAmenityId();
  if (!amenityId) { res.status(400).json({ error: "Dog-park amenity not initialized" }); return; }
  const body = req.body ?? {};
  const merged: DogParkSettings = { ...defaultDogParkSettings(), ...(body as DogParkSettings) };
  const [existing] = await db.select().from(dogParkSettingsTable).where(eq(dogParkSettingsTable.amenityId, amenityId));
  if (existing) {
    await db.update(dogParkSettingsTable).set({ settings: merged, updatedAt: nowISO() }).where(eq(dogParkSettingsTable.id, existing.id));
  } else {
    await db.insert(dogParkSettingsTable).values({ amenityId, settings: merged, updatedAt: nowISO() });
  }
  res.json(merged);
});

// ── Incidents ────────────────────────────────────────────────────────────

router.post("/pets/:id/incidents", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [pet] = await db.select().from(petsTable).where(eq(petsTable.id, id));
  if (!pet) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body ?? {};
  const kind = typeof body.kind === "string" ? body.kind.slice(0, 40) : "other";
  const severity = ["minor", "major", "severe"].includes(body.severity) ? body.severity : "minor";
  const occurredAt = typeof body.occurredAt === "string" ? body.occurredAt : nowISO();
  const description = typeof body.description === "string" ? body.description.slice(0, 4000) : "";
  const [row] = await db.insert(petIncidentsTable).values({
    petId: id,
    unitId: pet.unitId,
    occurredAt,
    kind,
    severity,
    description,
    reportedByUserId: req.user!.id,
    reportedByName: req.user!.name ?? "",
    resolution: "",
    resolvedAt: null,
    resolvedByUserId: null,
    status: "open",
    createdAt: nowISO(),
  }).returning();
  await audit({
    petId: id, unitId: pet.unitId, action: "incident",
    actorUserId: req.user!.id, actorName: req.user!.name,
    diff: { incidentId: row.id, kind, severity },
  });

  // Auto-suspension check
  const sus = await petIncidentSuspension(id);
  if (sus.shouldSuspend) {
    const suspendedUntil = new Date(Date.now() + sus.durationDays * 86_400_000).toISOString();
    const reason = `Auto-suspended: ${sus.recent} incidents in window (threshold ${sus.threshold})`;
    await db.update(petsTable).set({
      suspendedUntil, suspendedReason: reason, updatedAt: nowISO(),
    }).where(eq(petsTable.id, id));
    await audit({
      petId: id, unitId: pet.unitId, action: "suspended",
      actorUserId: null, actorName: "system",
      diff: { suspendedUntil, reason },
    });
    await recomputePetStatus(id);
    // Revoke any future dog-park access codes for this unit.
    const dogParkAmenityId = await getDogParkAmenityId();
    if (dogParkAmenityId) {
      const bookings = await db.select().from(amenityBookingsTable).where(and(
        eq(amenityBookingsTable.amenityId, dogParkAmenityId),
        eq(amenityBookingsTable.unitId, pet.unitId),
      ));
      if (bookings.length > 0) {
        const codes = await db.select().from(amenityAccessCodesTable).where(and(
          inArray(amenityAccessCodesTable.bookingId, bookings.map((b) => b.id)),
          eq(amenityAccessCodesTable.status, "active"),
        ));
        for (const c of codes) {
          await db.update(amenityAccessCodesTable).set({ status: "revoked", revokedAt: nowISO() }).where(eq(amenityAccessCodesTable.id, c.id));
          await recordAudit({
            bookingId: c.bookingId, amenityId: c.amenityId, accessCodeId: c.id,
            providerKind: c.providerKind, action: "revoke", success: true,
            actorName: "system", message: reason,
          });
        }
      }
    }
  } else {
    await recomputePetStatus(id);
  }

  // Email notify resident
  const orgName = await loadOrgName();
  const recipients = await unitContacts(pet.unitId);
  if (recipients.length > 0) {
    void sendEmail(
      recipients,
      `Pet incident reported: ${pet.name}`,
      buildPetIncidentEmail({ orgName, petName: pet.name, kind, severity, occurredAt, description }),
    ).catch((err) => logger.warn({ err }, "incident email failed"));
    if (sus.shouldSuspend) {
      void sendEmail(
        recipients,
        `Dog-park access suspended — ${orgName}`,
        buildPetSuspensionEmail({ orgName, unitId: pet.unitId, reason: `Repeated incidents: ${sus.recent} in ${sus.threshold}-incident window.` }),
      ).catch((err) => logger.warn({ err }, "suspension email failed"));
    }
  }

  res.status(201).json(row);
});

router.patch("/pets/incidents/:incidentId", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const incidentId = parseInt(req.params.incidentId, 10);
  if (Number.isNaN(incidentId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [inc] = await db.select().from(petIncidentsTable).where(eq(petIncidentsTable.id, incidentId));
  if (!inc) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body ?? {};
  const patch: Partial<typeof petIncidentsTable.$inferInsert> = {};
  if (["open", "reviewed", "dismissed"].includes(body.status)) patch.status = body.status;
  if (typeof body.resolution === "string") patch.resolution = body.resolution.slice(0, 4000);
  if (body.status === "reviewed" || body.status === "dismissed") {
    patch.resolvedAt = nowISO();
    patch.resolvedByUserId = req.user!.id;
  }
  const [row] = await db.update(petIncidentsTable).set(patch).where(eq(petIncidentsTable.id, incidentId)).returning();
  await audit({
    petId: inc.petId, unitId: inc.unitId, action: "incident_updated",
    actorUserId: req.user!.id, actorName: req.user!.name, diff: patch,
  });
  res.json(row);
});

router.post("/pets/:id/suspend", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [pet] = await db.select().from(petsTable).where(eq(petsTable.id, id));
  if (!pet) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body ?? {};
  const days = typeof body.durationDays === "number" ? Math.max(1, Math.min(365, Math.floor(body.durationDays))) : 30;
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : "Manual suspension";
  const suspendedUntil = new Date(Date.now() + days * 86_400_000).toISOString();
  await db.update(petsTable).set({
    suspendedUntil, suspendedReason: reason, updatedAt: nowISO(),
  }).where(eq(petsTable.id, id));
  await audit({
    petId: id, unitId: pet.unitId, action: "suspended",
    actorUserId: req.user!.id, actorName: req.user!.name, diff: { suspendedUntil, reason },
  });
  await recomputePetStatus(id);
  res.json(await loadPetWithDetails(id));
});

router.post("/pets/:id/restore", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [pet] = await db.select().from(petsTable).where(eq(petsTable.id, id));
  if (!pet) { res.status(404).json({ error: "Not found" }); return; }
  await db.update(petsTable).set({
    suspendedUntil: null, suspendedReason: "", archivedAt: null, updatedAt: nowISO(),
  }).where(eq(petsTable.id, id));
  await audit({
    petId: id, unitId: pet.unitId, action: "restored",
    actorUserId: req.user!.id, actorName: req.user!.name,
  });
  await recomputePetStatus(id);
  res.json(await loadPetWithDetails(id));
});

// helper to satisfy unused import (computePetStatus is exported helper)
void computePetStatus;

export default router;
