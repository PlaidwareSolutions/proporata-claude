// Task #89: Amenity Compliance & Safety Records routes.
// Required postings + issuances, certificates (permits/insurance/vendor COIs),
// annual inspections, incident reports + attachments, emergency procedures,
// and safety pins (AED, fire extinguisher, etc.).

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  amenitiesTable,
  amenityRequiredPostingsTable,
  amenityPostingIssuancesTable,
  amenityCertificatesTable,
  amenityAnnualInspectionsTable,
  amenityIncidentReportsTable,
  amenityIncidentAttachmentsTable,
  amenityIncidentAuditTable,
  amenityEmergencyProceduresTable,
  amenitySafetyPinsTable,
  organizationSettingsTable,
  usersTable,
  type AmenityRequiredPosting,
  type AmenityPostingIssuance,
  type AmenityCertificate,
  type AmenityAnnualInspection,
  type AmenityIncidentReport,
  type AmenityIncidentAttachment,
  type AmenityEmergencyProcedure,
  type AmenitySafetyPin,
} from "@workspace/db/schema";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { type AuthUser } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { sendEmail } from "../lib/email.js";
import {
  summarizeAmenityCompliance,
  summarizeAllAmenities,
  renderTemplate,
} from "../lib/amenityCompliance.js";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const POSTING_KINDS = [
  "occupancy_card", "pool_rules", "depth_markers", "no_lifeguard_warning",
  "emergency_911", "evacuation_map", "aed_location", "permit", "insurance", "other",
];
const CERT_KINDS = ["permit", "insurance", "inspection_cert", "vendor_coi", "license", "other"];
const INCIDENT_KINDS = [
  "injury", "near_miss", "drowning", "ems_called",
  "vandalism", "theft", "rule_violation", "equipment_failure", "other",
];
const INCIDENT_SEV = ["minor", "moderate", "major"];
const PIN_KINDS = [
  "aed", "fire_extinguisher", "first_aid", "rescue_hook",
  "life_ring", "phone", "shut_off", "exit", "other",
];

function isManager(u: AuthUser): boolean { return u.role === "admin" || u.role === "manager"; }
function nowISO(): string { return new Date().toISOString(); }

async function loadAmenityBySlug(slug: string) {
  const [a] = await db.select().from(amenitiesTable).where(eq(amenitiesTable.slug, slug));
  return a ?? null;
}
async function loadAmenityById(id: number) {
  const [a] = await db.select().from(amenitiesTable).where(eq(amenitiesTable.id, id));
  return a ?? null;
}
async function loadOrgName(): Promise<string> {
  const [s] = await db.select().from(organizationSettingsTable);
  return s?.name ?? "HOA";
}

function publicPosting(p: AmenityRequiredPosting) {
  return {
    id: p.id, amenityId: p.amenityId, kind: p.kind, title: p.title,
    description: p.description, templateBody: p.templateBody,
    replaceEveryDays: p.replaceEveryDays, required: p.required, citation: p.citation,
    sortOrder: p.sortOrder, createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}
function publicIssuance(i: AmenityPostingIssuance) {
  return {
    id: i.id, postingId: i.postingId, amenityId: i.amenityId,
    renderedBody: i.renderedBody, documentStorageKey: i.documentStorageKey ?? null,
    postedAt: i.postedAt, postedByUserId: i.postedByUserId ?? null, postedByName: i.postedByName,
    expiresAt: i.expiresAt ?? null, status: i.status,
    removedAt: i.removedAt ?? null, removedReason: i.removedReason, createdAt: i.createdAt,
  };
}
function publicCert(c: AmenityCertificate) {
  return {
    id: c.id, amenityId: c.amenityId, kind: c.kind, title: c.title, issuer: c.issuer,
    identifier: c.identifier, vendorId: c.vendorId ?? null,
    effectiveOn: c.effectiveOn ?? null, expiresOn: c.expiresOn ?? null,
    documentStorageKey: c.documentStorageKey ?? null, notes: c.notes,
    createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}
function publicAnnual(i: AmenityAnnualInspection) {
  return {
    id: i.id, amenityId: i.amenityId, year: i.year,
    scheduledOn: i.scheduledOn, performedOn: i.performedOn ?? null,
    inspectorName: i.inspectorName, inspectorAgency: i.inspectorAgency,
    inspectorUserId: i.inspectorUserId ?? null,
    status: i.status, checklist: i.checklist ?? [],
    reportStorageKey: i.reportStorageKey ?? null, notes: i.notes,
    workOrderIds: i.workOrderIds ?? [], calendarEventId: i.calendarEventId ?? null,
    createdAt: i.createdAt, updatedAt: i.updatedAt,
  };
}
function publicIncident(r: AmenityIncidentReport, attachments: AmenityIncidentAttachment[]) {
  return {
    id: r.id, amenityId: r.amenityId, bookingId: r.bookingId ?? null,
    occurredAt: r.occurredAt, reportedAt: r.reportedAt,
    reportedByUserId: r.reportedByUserId ?? null, reportedByName: r.reportedByName,
    reportedByRole: r.reportedByRole, kind: r.kind, severity: r.severity,
    involvedParties: r.involvedParties, witnesses: r.witnesses,
    emsCalled: r.emsCalled, policeCalled: r.policeCalled,
    insuranceNotified: r.insuranceNotified, insuranceClaimNumber: r.insuranceClaimNumber,
    narrative: r.narrative, immediateActions: r.immediateActions,
    followUpActions: r.followUpActions, followUpDueOn: r.followUpDueOn ?? null,
    status: r.status, closedAt: r.closedAt ?? null, closedByUserId: r.closedByUserId ?? null,
    workOrderIds: r.workOrderIds ?? [], ownerVisible: r.ownerVisible,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
    attachments: attachments
      .filter((a) => a.incidentId === r.id)
      .map((a) => ({
        id: a.id, incidentId: a.incidentId, storageKey: a.storageKey,
        caption: a.caption, uploadedByName: a.uploadedByName,
        uploadedByUserId: a.uploadedByUserId ?? null, createdAt: a.createdAt,
      })),
  };
}
function publicEmergency(e: AmenityEmergencyProcedure) {
  return {
    amenityId: e.amenityId, emergencyContact: e.emergencyContact,
    managerOnCallName: e.managerOnCallName, managerOnCallPhone: e.managerOnCallPhone,
    evacuationRoute: e.evacuationRoute, shelterLocation: e.shelterLocation,
    hazardNotes: e.hazardNotes, steps: e.steps ?? [],
    postedStorageKey: e.postedStorageKey ?? null,
    updatedAt: e.updatedAt, createdAt: e.createdAt,
  };
}
function publicPin(p: AmenitySafetyPin) {
  return {
    id: p.id, amenityId: p.amenityId, kind: p.kind, label: p.label,
    locationDescription: p.locationDescription,
    posX: p.posX ?? null, posY: p.posY ?? null,
    lastCheckedOn: p.lastCheckedOn ?? null, lastCheckedByName: p.lastCheckedByName,
    serviceDueOn: p.serviceDueOn ?? null, notes: p.notes,
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

async function auditIncident(incidentId: number, action: string, actor: AuthUser | null, diff: unknown) {
  await db.insert(amenityIncidentAuditTable).values({
    incidentId, action,
    actorUserId: actor?.id ?? null,
    actorName: actor?.name ?? "system",
    diff: (diff as object) ?? null,
    createdAt: nowISO(),
  });
}

// ── Upload URL (any authenticated user) ─────────────────────────────────
router.post("/amenity-compliance/uploads/request-url", async (_req, res) => {
  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
  } catch (err) {
    logger.error({ err }, "compliance upload URL failed");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// ── Dashboard ───────────────────────────────────────────────────────────
router.get("/amenity-compliance/summary", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  res.json(await summarizeAllAmenities());
});

router.get("/amenities/:slug/compliance", async (req, res) => {
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  // Owner-visible safety summary: only postings/cert state + safety pins +
  // emergency procedure (no incident details).
  if (!isManager(req.user!)) {
    const summary = await summarizeAmenityCompliance(a);
    const [emergency] = await db.select().from(amenityEmergencyProceduresTable)
      .where(eq(amenityEmergencyProceduresTable.amenityId, a.id));
    const pins = await db.select().from(amenitySafetyPinsTable)
      .where(eq(amenitySafetyPinsTable.amenityId, a.id))
      .orderBy(asc(amenitySafetyPinsTable.kind));
    res.json({
      amenitySlug: a.slug, amenityName: a.name,
      overall: summary.overall,
      postings: summary.postings.map((p) => ({
        title: p.posting.title, kind: p.posting.kind, color: p.color,
      })),
      inspection: {
        passedOn: summary.inspection.latest?.performedOn ?? null,
        color: summary.inspection.color,
      },
      emergency: emergency ? publicEmergency(emergency) : null,
      pins: pins.map(publicPin),
    });
    return;
  }
  res.json(await summarizeAmenityCompliance(a));
});

// ── Required postings (templates) ───────────────────────────────────────
router.get("/amenities/:slug/postings", async (req, res) => {
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const rows = await db.select().from(amenityRequiredPostingsTable)
    .where(eq(amenityRequiredPostingsTable.amenityId, a.id))
    .orderBy(asc(amenityRequiredPostingsTable.sortOrder));
  res.json(rows.map(publicPosting));
});

router.post("/amenities/:slug/postings", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const b = req.body ?? {};
  if (!POSTING_KINDS.includes(b.kind)) { res.status(400).json({ error: "Invalid kind" }); return; }
  if (typeof b.title !== "string" || !b.title.trim()) {
    res.status(400).json({ error: "title required" }); return;
  }
  const now = nowISO();
  const [row] = await db.insert(amenityRequiredPostingsTable).values({
    amenityId: a.id, kind: b.kind,
    title: b.title.slice(0, 240),
    description: typeof b.description === "string" ? b.description.slice(0, 4000) : "",
    templateBody: typeof b.templateBody === "string" ? b.templateBody.slice(0, 16000) : "",
    replaceEveryDays: typeof b.replaceEveryDays === "number" ? Math.max(0, b.replaceEveryDays) : 0,
    required: b.required !== false,
    citation: typeof b.citation === "string" ? b.citation.slice(0, 240) : "",
    sortOrder: typeof b.sortOrder === "number" ? b.sortOrder : 0,
    createdAt: now, updatedAt: now,
  }).returning();
  res.status(201).json(publicPosting(row));
});

router.patch("/amenity-postings/:id", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(amenityRequiredPostingsTable).where(eq(amenityRequiredPostingsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const b = req.body ?? {};
  const patch: Partial<typeof amenityRequiredPostingsTable.$inferInsert> = { updatedAt: nowISO() };
  if (typeof b.title === "string") patch.title = b.title.slice(0, 240);
  if (typeof b.description === "string") patch.description = b.description.slice(0, 4000);
  if (typeof b.templateBody === "string") patch.templateBody = b.templateBody.slice(0, 16000);
  if (typeof b.replaceEveryDays === "number") patch.replaceEveryDays = Math.max(0, b.replaceEveryDays);
  if (typeof b.required === "boolean") patch.required = b.required;
  if (typeof b.citation === "string") patch.citation = b.citation.slice(0, 240);
  if (typeof b.sortOrder === "number") patch.sortOrder = b.sortOrder;
  if (POSTING_KINDS.includes(b.kind)) patch.kind = b.kind;
  await db.update(amenityRequiredPostingsTable).set(patch).where(eq(amenityRequiredPostingsTable.id, id));
  const [updated] = await db.select().from(amenityRequiredPostingsTable).where(eq(amenityRequiredPostingsTable.id, id));
  res.json(publicPosting(updated));
});

router.delete("/amenity-postings/:id", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(amenityRequiredPostingsTable).where(eq(amenityRequiredPostingsTable.id, id));
  res.status(204).end();
});

// Render printable poster for a posting (uses merge tokens). Returns plain HTML.
router.get("/amenity-postings/:id/render", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  const [p] = await db.select().from(amenityRequiredPostingsTable).where(eq(amenityRequiredPostingsTable.id, id));
  if (!p) { res.status(404).json({ error: "Not found" }); return; }
  const a = await loadAmenityById(p.amenityId);
  const orgName = await loadOrgName();
  const tokens: Record<string, string> = {
    orgName, amenityName: a?.name ?? "",
    capacity: a?.capacity ? String(a.capacity) : "",
    title: p.title, citation: p.citation,
    today: new Date().toLocaleDateString("en-US"),
  };
  const body = renderTemplate(p.templateBody || `<h1>${p.title}</h1>\n<p>${p.description}</p>`, tokens);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${p.title}</title>
<style>body{font-family:system-ui,Arial,sans-serif;padding:40px;max-width:800px;margin:0 auto}h1{font-size:32px;margin-bottom:8px}.meta{color:#666;font-size:12px;margin-bottom:24px}.body{font-size:16px;line-height:1.5}.foot{margin-top:48px;font-size:11px;color:#888}@media print{body{padding:0}}</style></head>
<body><h1>${p.title}</h1><div class="meta">${orgName} · ${a?.name ?? ""}${p.citation ? " · " + p.citation : ""}</div><div class="body">${body}</div><div class="foot">Posted ${tokens.today}. Required posting — do not remove.</div></body></html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// ── Posting issuances (printed copies posted on-site) ───────────────────
router.get("/amenities/:slug/posting-issuances", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const rows = await db.select().from(amenityPostingIssuancesTable)
    .where(eq(amenityPostingIssuancesTable.amenityId, a.id))
    .orderBy(desc(amenityPostingIssuancesTable.postedAt));
  res.json(rows.map(publicIssuance));
});

router.post("/amenity-postings/:id/issue", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  const [p] = await db.select().from(amenityRequiredPostingsTable).where(eq(amenityRequiredPostingsTable.id, id));
  if (!p) { res.status(404).json({ error: "Not found" }); return; }
  const b = req.body ?? {};
  const now = nowISO();
  // Mark previous active issuances as superseded.
  await db.update(amenityPostingIssuancesTable)
    .set({ status: "superseded" })
    .where(and(eq(amenityPostingIssuancesTable.postingId, p.id),
               eq(amenityPostingIssuancesTable.status, "active")));
  const a = await loadAmenityById(p.amenityId);
  const orgName = await loadOrgName();
  const renderedBody = renderTemplate(p.templateBody || p.description, {
    orgName, amenityName: a?.name ?? "", capacity: a?.capacity ? String(a.capacity) : "",
    title: p.title, citation: p.citation, today: now.slice(0, 10),
  });
  let expiresAt: string | null = typeof b.expiresAt === "string" ? b.expiresAt : null;
  if (!expiresAt && p.replaceEveryDays > 0) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + p.replaceEveryDays);
    expiresAt = d.toISOString();
  }
  const [row] = await db.insert(amenityPostingIssuancesTable).values({
    postingId: p.id, amenityId: p.amenityId,
    renderedBody,
    documentStorageKey: typeof b.documentStorageKey === "string" ? b.documentStorageKey : null,
    postedAt: typeof b.postedAt === "string" ? b.postedAt : now,
    postedByUserId: req.user!.id,
    postedByName: req.user!.name ?? "",
    expiresAt,
    status: "active",
    removedAt: null, removedReason: "", createdAt: now,
  }).returning();
  res.status(201).json(publicIssuance(row));
});

router.post("/amenity-posting-issuances/:id/remove", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  const b = req.body ?? {};
  const now = nowISO();
  await db.update(amenityPostingIssuancesTable).set({
    status: "removed", removedAt: now,
    removedReason: typeof b.reason === "string" ? b.reason.slice(0, 240) : "",
  }).where(eq(amenityPostingIssuancesTable.id, id));
  const [row] = await db.select().from(amenityPostingIssuancesTable).where(eq(amenityPostingIssuancesTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(publicIssuance(row));
});

// ── Certificates (permits / insurance / vendor COIs) ────────────────────
router.get("/amenities/:slug/certificates", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const rows = await db.select().from(amenityCertificatesTable)
    .where(eq(amenityCertificatesTable.amenityId, a.id))
    .orderBy(asc(amenityCertificatesTable.expiresOn));
  res.json(rows.map(publicCert));
});

router.post("/amenities/:slug/certificates", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const b = req.body ?? {};
  if (!CERT_KINDS.includes(b.kind)) { res.status(400).json({ error: "Invalid kind" }); return; }
  if (typeof b.title !== "string" || !b.title.trim()) {
    res.status(400).json({ error: "title required" }); return;
  }
  const now = nowISO();
  const [row] = await db.insert(amenityCertificatesTable).values({
    amenityId: a.id, kind: b.kind, title: b.title.slice(0, 240),
    issuer: typeof b.issuer === "string" ? b.issuer.slice(0, 240) : "",
    identifier: typeof b.identifier === "string" ? b.identifier.slice(0, 240) : "",
    vendorId: typeof b.vendorId === "number" ? b.vendorId : null,
    effectiveOn: typeof b.effectiveOn === "string" ? b.effectiveOn : null,
    expiresOn: typeof b.expiresOn === "string" ? b.expiresOn : null,
    documentStorageKey: typeof b.documentStorageKey === "string" ? b.documentStorageKey : null,
    notes: typeof b.notes === "string" ? b.notes.slice(0, 2000) : "",
    createdAt: now, updatedAt: now,
  }).returning();
  res.status(201).json(publicCert(row));
});

router.patch("/amenity-certificates/:id", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  const [row] = await db.select().from(amenityCertificatesTable).where(eq(amenityCertificatesTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const b = req.body ?? {};
  const patch: Partial<typeof amenityCertificatesTable.$inferInsert> = { updatedAt: nowISO() };
  if (CERT_KINDS.includes(b.kind)) patch.kind = b.kind;
  if (typeof b.title === "string") patch.title = b.title.slice(0, 240);
  if (typeof b.issuer === "string") patch.issuer = b.issuer.slice(0, 240);
  if (typeof b.identifier === "string") patch.identifier = b.identifier.slice(0, 240);
  if (typeof b.vendorId === "number" || b.vendorId === null) patch.vendorId = b.vendorId;
  if (typeof b.effectiveOn === "string" || b.effectiveOn === null) patch.effectiveOn = b.effectiveOn;
  if (typeof b.expiresOn === "string" || b.expiresOn === null) patch.expiresOn = b.expiresOn;
  if (typeof b.documentStorageKey === "string" || b.documentStorageKey === null) patch.documentStorageKey = b.documentStorageKey;
  if (typeof b.notes === "string") patch.notes = b.notes.slice(0, 2000);
  await db.update(amenityCertificatesTable).set(patch).where(eq(amenityCertificatesTable.id, id));
  const [updated] = await db.select().from(amenityCertificatesTable).where(eq(amenityCertificatesTable.id, id));
  res.json(publicCert(updated));
});

router.delete("/amenity-certificates/:id", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  await db.delete(amenityCertificatesTable).where(eq(amenityCertificatesTable.id, id));
  res.status(204).end();
});

// ── Annual inspections ──────────────────────────────────────────────────
router.get("/amenities/:slug/annual-inspections", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const rows = await db.select().from(amenityAnnualInspectionsTable)
    .where(eq(amenityAnnualInspectionsTable.amenityId, a.id))
    .orderBy(desc(amenityAnnualInspectionsTable.scheduledOn));
  res.json(rows.map(publicAnnual));
});

router.post("/amenities/:slug/annual-inspections", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const b = req.body ?? {};
  const now = nowISO();
  const scheduledOn = typeof b.scheduledOn === "string" ? b.scheduledOn : now.slice(0, 10);
  const year = typeof b.year === "number" ? b.year : new Date(scheduledOn).getUTCFullYear();
  const [row] = await db.insert(amenityAnnualInspectionsTable).values({
    amenityId: a.id, year, scheduledOn,
    performedOn: typeof b.performedOn === "string" ? b.performedOn : null,
    inspectorName: typeof b.inspectorName === "string" ? b.inspectorName.slice(0, 240) : "",
    inspectorAgency: typeof b.inspectorAgency === "string" ? b.inspectorAgency.slice(0, 240) : "",
    inspectorUserId: typeof b.inspectorUserId === "number" ? b.inspectorUserId : null,
    status: ["scheduled","in_progress","passed","failed","cancelled"].includes(b.status) ? b.status : "scheduled",
    checklist: Array.isArray(b.checklist) ? b.checklist : [],
    reportStorageKey: typeof b.reportStorageKey === "string" ? b.reportStorageKey : null,
    notes: typeof b.notes === "string" ? b.notes.slice(0, 4000) : "",
    workOrderIds: Array.isArray(b.workOrderIds) ? b.workOrderIds : [],
    calendarEventId: typeof b.calendarEventId === "number" ? b.calendarEventId : null,
    createdAt: now, updatedAt: now,
  }).returning();
  res.status(201).json(publicAnnual(row));
});

router.patch("/amenity-annual-inspections/:id", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  const [row] = await db.select().from(amenityAnnualInspectionsTable).where(eq(amenityAnnualInspectionsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const b = req.body ?? {};
  const patch: Partial<typeof amenityAnnualInspectionsTable.$inferInsert> = { updatedAt: nowISO() };
  if (typeof b.scheduledOn === "string") patch.scheduledOn = b.scheduledOn;
  if (typeof b.performedOn === "string" || b.performedOn === null) patch.performedOn = b.performedOn;
  if (typeof b.inspectorName === "string") patch.inspectorName = b.inspectorName.slice(0, 240);
  if (typeof b.inspectorAgency === "string") patch.inspectorAgency = b.inspectorAgency.slice(0, 240);
  if (["scheduled","in_progress","passed","failed","cancelled"].includes(b.status)) patch.status = b.status;
  if (Array.isArray(b.checklist)) patch.checklist = b.checklist;
  if (typeof b.reportStorageKey === "string" || b.reportStorageKey === null) patch.reportStorageKey = b.reportStorageKey;
  if (typeof b.notes === "string") patch.notes = b.notes.slice(0, 4000);
  if (Array.isArray(b.workOrderIds)) patch.workOrderIds = b.workOrderIds;
  await db.update(amenityAnnualInspectionsTable).set(patch).where(eq(amenityAnnualInspectionsTable.id, id));
  const [updated] = await db.select().from(amenityAnnualInspectionsTable).where(eq(amenityAnnualInspectionsTable.id, id));
  res.json(publicAnnual(updated));
});

router.delete("/amenity-annual-inspections/:id", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  await db.delete(amenityAnnualInspectionsTable).where(eq(amenityAnnualInspectionsTable.id, id));
  res.status(204).end();
});

// ── Incidents ───────────────────────────────────────────────────────────
router.get("/amenity-incidents", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const slug = typeof req.query.amenitySlug === "string" ? req.query.amenitySlug : null;
  let rows = await db.select().from(amenityIncidentReportsTable)
    .orderBy(desc(amenityIncidentReportsTable.occurredAt));
  if (status) rows = rows.filter((r) => r.status === status);
  if (slug) {
    const a = await loadAmenityBySlug(slug);
    if (!a) { res.json([]); return; }
    rows = rows.filter((r) => r.amenityId === a.id);
  }
  const ids = rows.map((r) => r.id);
  const attachments = ids.length === 0 ? [] :
    (await db.select().from(amenityIncidentAttachmentsTable))
      .filter((a) => ids.includes(a.incidentId));
  res.json(rows.map((r) => publicIncident(r, attachments)));
});

router.get("/amenity-incidents/:id", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  const [r] = await db.select().from(amenityIncidentReportsTable).where(eq(amenityIncidentReportsTable.id, id));
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  const attachments = await db.select().from(amenityIncidentAttachmentsTable)
    .where(eq(amenityIncidentAttachmentsTable.incidentId, id));
  res.json(publicIncident(r, attachments));
});

router.post("/amenities/:slug/incidents", async (req, res) => {
  // Any authenticated user (resident or staff) can report. Owners can file
  // incidents for amenities; managers see them in the queue.
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const b = req.body ?? {};
  if (!INCIDENT_KINDS.includes(b.kind)) { res.status(400).json({ error: "Invalid kind" }); return; }
  const severity = INCIDENT_SEV.includes(b.severity) ? b.severity : "minor";
  const now = nowISO();
  const occurredAt = typeof b.occurredAt === "string" ? b.occurredAt : now;
  const [row] = await db.insert(amenityIncidentReportsTable).values({
    amenityId: a.id,
    bookingId: typeof b.bookingId === "number" ? b.bookingId : null,
    occurredAt, reportedAt: now,
    reportedByUserId: req.user!.id,
    reportedByName: req.user!.name ?? "",
    reportedByRole: req.user!.role,
    kind: b.kind, severity,
    involvedParties: typeof b.involvedParties === "string" ? b.involvedParties.slice(0, 2000) : "",
    witnesses: typeof b.witnesses === "string" ? b.witnesses.slice(0, 2000) : "",
    emsCalled: b.emsCalled === true,
    policeCalled: b.policeCalled === true,
    insuranceNotified: b.insuranceNotified === true,
    insuranceClaimNumber: typeof b.insuranceClaimNumber === "string" ? b.insuranceClaimNumber.slice(0, 240) : "",
    narrative: typeof b.narrative === "string" ? b.narrative.slice(0, 16000) : "",
    immediateActions: typeof b.immediateActions === "string" ? b.immediateActions.slice(0, 4000) : "",
    followUpActions: typeof b.followUpActions === "string" ? b.followUpActions.slice(0, 4000) : "",
    followUpDueOn: typeof b.followUpDueOn === "string" ? b.followUpDueOn : null,
    status: "open",
    closedAt: null, closedByUserId: null,
    workOrderIds: Array.isArray(b.workOrderIds) ? b.workOrderIds : [],
    ownerVisible: b.ownerVisible === true,
    createdAt: now, updatedAt: now,
  }).returning();
  if (Array.isArray(b.attachments)) {
    for (const att of b.attachments) {
      if (typeof att?.storageKey !== "string") continue;
      await db.insert(amenityIncidentAttachmentsTable).values({
        incidentId: row.id, storageKey: att.storageKey,
        caption: typeof att.caption === "string" ? att.caption.slice(0, 500) : "",
        uploadedByUserId: req.user!.id, uploadedByName: req.user!.name ?? "",
        createdAt: now,
      });
    }
  }
  await auditIncident(row.id, "created", req.user!, { severity, kind: b.kind });

  // Major-incident escalation — notify all managers + admins.
  if (severity === "major") {
    void (async () => {
      try {
        const recipients = (await db.select().from(usersTable).where(ne(usersTable.role, "resident")))
          .filter((u) => !u.pending && u.email);
        const orgName = await loadOrgName();
        const subj = `[URGENT] Major incident at ${a.name} (${orgName})`;
        const body = `<p>A <strong>major</strong> incident was just reported at <strong>${a.name}</strong>.</p>
<ul>
  <li>Kind: ${b.kind}</li>
  <li>Reported by: ${row.reportedByName}</li>
  <li>Occurred: ${occurredAt}</li>
  <li>EMS called: ${row.emsCalled ? "yes" : "no"}</li>
</ul>
<p>${(row.narrative || "").slice(0, 500)}</p>
<p>Open the manager incident queue to review and follow up.</p>`;
        for (const r of recipients) {
          if (r.email) await sendEmail(r.email, subj, body);
        }
      } catch (err) {
        logger.error({ err }, "major incident escalation email failed");
      }
    })();
  }

  const attachments = await db.select().from(amenityIncidentAttachmentsTable)
    .where(eq(amenityIncidentAttachmentsTable.incidentId, row.id));
  res.status(201).json(publicIncident(row, attachments));
});

router.patch("/amenity-incidents/:id", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  const [row] = await db.select().from(amenityIncidentReportsTable).where(eq(amenityIncidentReportsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const b = req.body ?? {};
  const patch: Partial<typeof amenityIncidentReportsTable.$inferInsert> = { updatedAt: nowISO() };
  if (INCIDENT_SEV.includes(b.severity)) patch.severity = b.severity;
  if (typeof b.narrative === "string") patch.narrative = b.narrative.slice(0, 16000);
  if (typeof b.immediateActions === "string") patch.immediateActions = b.immediateActions.slice(0, 4000);
  if (typeof b.followUpActions === "string") patch.followUpActions = b.followUpActions.slice(0, 4000);
  if (typeof b.followUpDueOn === "string" || b.followUpDueOn === null) patch.followUpDueOn = b.followUpDueOn;
  if (typeof b.involvedParties === "string") patch.involvedParties = b.involvedParties.slice(0, 2000);
  if (typeof b.witnesses === "string") patch.witnesses = b.witnesses.slice(0, 2000);
  if (typeof b.emsCalled === "boolean") patch.emsCalled = b.emsCalled;
  if (typeof b.policeCalled === "boolean") patch.policeCalled = b.policeCalled;
  if (typeof b.insuranceNotified === "boolean") patch.insuranceNotified = b.insuranceNotified;
  if (typeof b.insuranceClaimNumber === "string") patch.insuranceClaimNumber = b.insuranceClaimNumber.slice(0, 240);
  if (typeof b.ownerVisible === "boolean") patch.ownerVisible = b.ownerVisible;
  if (Array.isArray(b.workOrderIds)) patch.workOrderIds = b.workOrderIds;
  if (["open", "follow_up", "closed"].includes(b.status)) patch.status = b.status;
  await db.update(amenityIncidentReportsTable).set(patch).where(eq(amenityIncidentReportsTable.id, id));
  await auditIncident(id, "updated", req.user!, patch);
  const [updated] = await db.select().from(amenityIncidentReportsTable).where(eq(amenityIncidentReportsTable.id, id));
  const attachments = await db.select().from(amenityIncidentAttachmentsTable)
    .where(eq(amenityIncidentAttachmentsTable.incidentId, id));
  res.json(publicIncident(updated, attachments));
});

router.post("/amenity-incidents/:id/close", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  const now = nowISO();
  await db.update(amenityIncidentReportsTable).set({
    status: "closed", closedAt: now, closedByUserId: req.user!.id, updatedAt: now,
  }).where(eq(amenityIncidentReportsTable.id, id));
  const [updated] = await db.select().from(amenityIncidentReportsTable).where(eq(amenityIncidentReportsTable.id, id));
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  await auditIncident(id, "closed", req.user!, null);
  const attachments = await db.select().from(amenityIncidentAttachmentsTable)
    .where(eq(amenityIncidentAttachmentsTable.incidentId, id));
  res.json(publicIncident(updated, attachments));
});

router.post("/amenity-incidents/:id/attachments", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  const b = req.body ?? {};
  if (typeof b.storageKey !== "string") { res.status(400).json({ error: "storageKey required" }); return; }
  const [att] = await db.insert(amenityIncidentAttachmentsTable).values({
    incidentId: id, storageKey: b.storageKey,
    caption: typeof b.caption === "string" ? b.caption.slice(0, 500) : "",
    uploadedByUserId: req.user!.id, uploadedByName: req.user!.name ?? "",
    createdAt: nowISO(),
  }).returning();
  res.status(201).json(att);
});

router.get("/amenity-incidents/:id/audit", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  const rows = await db.select().from(amenityIncidentAuditTable)
    .where(eq(amenityIncidentAuditTable.incidentId, id))
    .orderBy(asc(amenityIncidentAuditTable.createdAt));
  res.json(rows);
});

// ── Emergency procedures (one per amenity) ──────────────────────────────
router.get("/amenities/:slug/emergency-procedure", async (req, res) => {
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const [row] = await db.select().from(amenityEmergencyProceduresTable)
    .where(eq(amenityEmergencyProceduresTable.amenityId, a.id));
  res.json(row ? publicEmergency(row) : null);
});

router.put("/amenities/:slug/emergency-procedure", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const b = req.body ?? {};
  const now = nowISO();
  const [existing] = await db.select().from(amenityEmergencyProceduresTable)
    .where(eq(amenityEmergencyProceduresTable.amenityId, a.id));
  const values = {
    amenityId: a.id,
    emergencyContact: typeof b.emergencyContact === "string" ? b.emergencyContact.slice(0, 80) : "911",
    managerOnCallName: typeof b.managerOnCallName === "string" ? b.managerOnCallName.slice(0, 240) : "",
    managerOnCallPhone: typeof b.managerOnCallPhone === "string" ? b.managerOnCallPhone.slice(0, 80) : "",
    evacuationRoute: typeof b.evacuationRoute === "string" ? b.evacuationRoute.slice(0, 4000) : "",
    shelterLocation: typeof b.shelterLocation === "string" ? b.shelterLocation.slice(0, 1000) : "",
    hazardNotes: typeof b.hazardNotes === "string" ? b.hazardNotes.slice(0, 4000) : "",
    steps: Array.isArray(b.steps) ? b.steps.slice(0, 50).map((s: unknown) => String(s).slice(0, 500)) : [],
    postedStorageKey: typeof b.postedStorageKey === "string" ? b.postedStorageKey : null,
    updatedAt: now,
  };
  if (existing) {
    await db.update(amenityEmergencyProceduresTable).set(values)
      .where(eq(amenityEmergencyProceduresTable.amenityId, a.id));
  } else {
    await db.insert(amenityEmergencyProceduresTable).values({ ...values, createdAt: now });
  }
  const [updated] = await db.select().from(amenityEmergencyProceduresTable)
    .where(eq(amenityEmergencyProceduresTable.amenityId, a.id));
  res.json(publicEmergency(updated));
});

// ── Safety pins (AED, fire ext, first-aid) ──────────────────────────────
router.get("/amenities/:slug/safety-pins", async (req, res) => {
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const rows = await db.select().from(amenitySafetyPinsTable)
    .where(eq(amenitySafetyPinsTable.amenityId, a.id))
    .orderBy(asc(amenitySafetyPinsTable.kind));
  res.json(rows.map(publicPin));
});

router.post("/amenities/:slug/safety-pins", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const a = await loadAmenityBySlug(req.params.slug);
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const b = req.body ?? {};
  if (!PIN_KINDS.includes(b.kind)) { res.status(400).json({ error: "Invalid kind" }); return; }
  if (typeof b.label !== "string" || !b.label.trim()) { res.status(400).json({ error: "label required" }); return; }
  const now = nowISO();
  const [row] = await db.insert(amenitySafetyPinsTable).values({
    amenityId: a.id, kind: b.kind, label: b.label.slice(0, 240),
    locationDescription: typeof b.locationDescription === "string" ? b.locationDescription.slice(0, 1000) : "",
    posX: typeof b.posX === "number" ? b.posX : null,
    posY: typeof b.posY === "number" ? b.posY : null,
    lastCheckedOn: typeof b.lastCheckedOn === "string" ? b.lastCheckedOn : null,
    lastCheckedByName: typeof b.lastCheckedByName === "string" ? b.lastCheckedByName.slice(0, 240) : "",
    serviceDueOn: typeof b.serviceDueOn === "string" ? b.serviceDueOn : null,
    notes: typeof b.notes === "string" ? b.notes.slice(0, 2000) : "",
    createdAt: now, updatedAt: now,
  }).returning();
  res.status(201).json(publicPin(row));
});

router.patch("/amenity-safety-pins/:id", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  const [row] = await db.select().from(amenitySafetyPinsTable).where(eq(amenitySafetyPinsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const b = req.body ?? {};
  const patch: Partial<typeof amenitySafetyPinsTable.$inferInsert> = { updatedAt: nowISO() };
  if (PIN_KINDS.includes(b.kind)) patch.kind = b.kind;
  if (typeof b.label === "string") patch.label = b.label.slice(0, 240);
  if (typeof b.locationDescription === "string") patch.locationDescription = b.locationDescription.slice(0, 1000);
  if (typeof b.posX === "number" || b.posX === null) patch.posX = b.posX;
  if (typeof b.posY === "number" || b.posY === null) patch.posY = b.posY;
  if (typeof b.lastCheckedOn === "string" || b.lastCheckedOn === null) patch.lastCheckedOn = b.lastCheckedOn;
  if (typeof b.lastCheckedByName === "string") patch.lastCheckedByName = b.lastCheckedByName.slice(0, 240);
  if (typeof b.serviceDueOn === "string" || b.serviceDueOn === null) patch.serviceDueOn = b.serviceDueOn;
  if (typeof b.notes === "string") patch.notes = b.notes.slice(0, 2000);
  await db.update(amenitySafetyPinsTable).set(patch).where(eq(amenitySafetyPinsTable.id, id));
  const [updated] = await db.select().from(amenitySafetyPinsTable).where(eq(amenitySafetyPinsTable.id, id));
  res.json(publicPin(updated));
});

router.delete("/amenity-safety-pins/:id", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  await db.delete(amenitySafetyPinsTable).where(eq(amenitySafetyPinsTable.id, id));
  res.status(204).end();
});

export default router;
