// Task #83: Amenity inspections, damage reports, disputes, deposit ledger,
// and pool chemistry log. Mounted under authenticateJwt; manager-only routes
// gate themselves with `isManager`.

import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  amenitiesTable,
  amenityBookingsTable,
  amenityBookingAuditTable,
  amenityInspectionTemplatesTable,
  amenityInspectionTemplateItemsTable,
  amenityInspectionsTable,
  amenityInspectionItemResultsTable,
  amenityDamageReportsTable,
  amenityDamageDisputesTable,
  amenityDepositLedgerTable,
  poolChemistryLogsTable,
  workOrdersTable,
  usersTable,
  organizationSettingsTable,
  type Amenity,
  type AmenityBooking,
  type AmenityInspection,
  type AmenityInspectionItemResult,
  type AmenityInspectionTemplate,
  type AmenityInspectionTemplateItem,
  type AmenityDamageReport,
  type AmenityDamageDispute,
  type AmenityDepositLedger,
  type PoolChemistryLog,
} from "@workspace/db/schema";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage";
import { type AuthUser } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import {
  sendEmail,
  buildAmenityInspectionEmail,
  buildAmenityDamageReportEmail,
  buildAmenityDisputeEmail,
  buildPoolChemistryAlertEmail,
  buildWorkOrderEmail,
} from "../lib/email.js";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

function nowISO(): string { return new Date().toISOString(); }
function isManager(user: AuthUser): boolean { return user.role === "admin" || user.role === "manager"; }

async function loadOrgName(): Promise<string> {
  const [s] = await db.select().from(organizationSettingsTable);
  return s?.name ?? "HOA";
}

async function loadOwner(userId: number) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return u ?? null;
}

async function loadBooking(id: number) {
  const [b] = await db.select().from(amenityBookingsTable).where(eq(amenityBookingsTable.id, id));
  return b ?? null;
}

async function loadAmenity(id: number) {
  const [a] = await db.select().from(amenitiesTable).where(eq(amenitiesTable.id, id));
  return a ?? null;
}

async function audit(bookingId: number, action: string, actor: AuthUser | null, diff: unknown): Promise<void> {
  await db.insert(amenityBookingAuditTable).values({
    bookingId, action,
    actorUserId: actor?.id ?? null,
    actorName: actor?.name ?? "system",
    diff: (diff as object) ?? null,
    createdAt: nowISO(),
  });
}

function publicTemplate(t: AmenityInspectionTemplate, items: AmenityInspectionTemplateItem[]) {
  return {
    id: t.id,
    amenitySlug: t.amenitySlug ?? null,
    name: t.name,
    kind: t.kind,
    description: t.description,
    enabled: t.enabled,
    sortOrder: t.sortOrder,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    items: items
      .filter((i) => i.templateId === t.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(publicTemplateItem),
  };
}

function publicTemplateItem(i: AmenityInspectionTemplateItem) {
  return {
    id: i.id,
    templateId: i.templateId,
    label: i.label,
    helpText: i.helpText,
    requiresPhoto: i.requiresPhoto,
    severity: i.severity,
    sortOrder: i.sortOrder,
  };
}

function publicInspection(
  insp: AmenityInspection,
  results: AmenityInspectionItemResult[],
) {
  return {
    id: insp.id,
    bookingId: insp.bookingId,
    templateId: insp.templateId ?? null,
    kind: insp.kind,
    status: insp.status,
    inspectorUserId: insp.inspectorUserId ?? null,
    inspectorName: insp.inspectorName,
    inspectorRole: insp.inspectorRole,
    notes: insp.notes,
    signature: insp.signature,
    performedAt: insp.performedAt ?? null,
    createdAt: insp.createdAt,
    updatedAt: insp.updatedAt,
    items: results
      .filter((r) => r.inspectionId === insp.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(publicResult),
  };
}

function publicResult(r: AmenityInspectionItemResult) {
  return {
    id: r.id,
    inspectionId: r.inspectionId,
    templateItemId: r.templateItemId ?? null,
    label: r.label,
    status: r.status,
    note: r.note,
    photoStorageKey: r.photoStorageKey ?? null,
    sortOrder: r.sortOrder,
  };
}

function publicDamage(d: AmenityDamageReport) {
  return {
    id: d.id,
    bookingId: d.bookingId,
    inspectionId: d.inspectionId ?? null,
    reportedByUserId: d.reportedByUserId ?? null,
    reportedByName: d.reportedByName,
    summary: d.summary,
    details: d.details,
    estimatedCostCents: d.estimatedCostCents,
    depositChargedCents: d.depositChargedCents,
    photoStorageKeys: d.photoStorageKeys ?? [],
    status: d.status,
    workOrderId: d.workOrderId ?? null,
    managerNotes: d.managerNotes,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    resolvedAt: d.resolvedAt ?? null,
  };
}

function publicDispute(d: AmenityDamageDispute) {
  return {
    id: d.id,
    damageReportId: d.damageReportId,
    ownerUserId: d.ownerUserId,
    ownerName: d.ownerName,
    message: d.message,
    evidenceStorageKeys: d.evidenceStorageKeys ?? [],
    status: d.status,
    managerResponse: d.managerResponse,
    resolvedByUserId: d.resolvedByUserId ?? null,
    resolvedAt: d.resolvedAt ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function publicLedger(l: AmenityDepositLedger) {
  return {
    id: l.id,
    bookingId: l.bookingId,
    kind: l.kind,
    amountCents: l.amountCents,
    balanceCents: l.balanceCents,
    reason: l.reason,
    damageReportId: l.damageReportId ?? null,
    actorUserId: l.actorUserId ?? null,
    actorName: l.actorName,
    createdAt: l.createdAt,
  };
}

function publicPoolLog(p: PoolChemistryLog) {
  return {
    id: p.id,
    recordedAt: p.recordedAt,
    recordedByUserId: p.recordedByUserId ?? null,
    recordedByName: p.recordedByName,
    freeChlorinePpm: p.freeChlorinePpm ?? null,
    totalChlorinePpm: p.totalChlorinePpm ?? null,
    ph: p.ph ?? null,
    alkalinityPpm: p.alkalinityPpm ?? null,
    calciumHardnessPpm: p.calciumHardnessPpm ?? null,
    cyanuricAcidPpm: p.cyanuricAcidPpm ?? null,
    temperatureF: p.temperatureF ?? null,
    notes: p.notes,
    flagged: p.flagged,
    flagReasons: p.flagReasons ?? [],
    workOrderId: p.workOrderId ?? null,
    createdAt: p.createdAt,
  };
}

// ── Inspection upload-URL: any authenticated user can request a presigned
// upload URL for inspection / damage / dispute photo evidence.
router.post("/amenity-inspections/uploads/request-url", async (req, res) => {
  try {
    const body = req.body ?? {};
    const name = typeof body.name === "string" ? body.name : "photo";
    const size = typeof body.size === "number" ? body.size : 0;
    const contentType = typeof body.contentType === "string" ? body.contentType : "application/octet-stream";
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
  } catch (err) {
    logger.error({ err }, "amenity inspection upload URL failed");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// ── Templates (manager only) ──────────────────────────────────────────────

router.get("/amenity-inspection-templates", async (req, res) => {
  const slug = typeof req.query.amenitySlug === "string" ? req.query.amenitySlug : null;
  const kind = typeof req.query.kind === "string" ? req.query.kind : null;
  let templates = await db.select().from(amenityInspectionTemplatesTable)
    .orderBy(asc(amenityInspectionTemplatesTable.sortOrder));
  if (slug) templates = templates.filter((t) => t.amenitySlug === slug || t.amenitySlug === null);
  if (kind) templates = templates.filter((t) => t.kind === kind);
  const items = await db.select().from(amenityInspectionTemplateItemsTable);
  res.json(templates.map((t) => publicTemplate(t, items)));
});

router.post("/amenity-inspection-templates", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const body = req.body ?? {};
  const name = typeof body.name === "string" ? body.name.slice(0, 240) : "";
  const kind = typeof body.kind === "string" ? body.kind : "post";
  if (!name || !["pre", "post", "owner_self"].includes(kind)) {
    res.status(400).json({ error: "name and valid kind required" }); return;
  }
  const now = nowISO();
  const [tpl] = await db.insert(amenityInspectionTemplatesTable).values({
    amenitySlug: typeof body.amenitySlug === "string" ? body.amenitySlug : null,
    name,
    kind,
    description: typeof body.description === "string" ? body.description.slice(0, 4000) : "",
    enabled: body.enabled !== false,
    sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
    createdAt: now,
    updatedAt: now,
  }).returning();
  if (Array.isArray(body.items)) {
    for (let i = 0; i < body.items.length; i++) {
      const it = body.items[i];
      await db.insert(amenityInspectionTemplateItemsTable).values({
        templateId: tpl.id,
        label: typeof it.label === "string" ? it.label.slice(0, 500) : "",
        helpText: typeof it.helpText === "string" ? it.helpText.slice(0, 1000) : "",
        requiresPhoto: it.requiresPhoto === true,
        severity: ["info", "warn", "critical"].includes(it.severity) ? it.severity : "warn",
        sortOrder: typeof it.sortOrder === "number" ? it.sortOrder : i * 10,
      });
    }
  }
  const items = await db.select().from(amenityInspectionTemplateItemsTable)
    .where(eq(amenityInspectionTemplateItemsTable.templateId, tpl.id));
  res.status(201).json(publicTemplate(tpl, items));
});

router.patch("/amenity-inspection-templates/:id", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [t] = await db.select().from(amenityInspectionTemplatesTable).where(eq(amenityInspectionTemplatesTable.id, id));
  if (!t) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body ?? {};
  const patch: Partial<typeof amenityInspectionTemplatesTable.$inferInsert> = { updatedAt: nowISO() };
  if (typeof body.name === "string") patch.name = body.name.slice(0, 240);
  if (typeof body.description === "string") patch.description = body.description.slice(0, 4000);
  if (typeof body.amenitySlug === "string" || body.amenitySlug === null) patch.amenitySlug = body.amenitySlug;
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;
  await db.update(amenityInspectionTemplatesTable).set(patch).where(eq(amenityInspectionTemplatesTable.id, id));

  if (Array.isArray(body.items)) {
    await db.delete(amenityInspectionTemplateItemsTable).where(eq(amenityInspectionTemplateItemsTable.templateId, id));
    for (let i = 0; i < body.items.length; i++) {
      const it = body.items[i];
      await db.insert(amenityInspectionTemplateItemsTable).values({
        templateId: id,
        label: typeof it.label === "string" ? it.label.slice(0, 500) : "",
        helpText: typeof it.helpText === "string" ? it.helpText.slice(0, 1000) : "",
        requiresPhoto: it.requiresPhoto === true,
        severity: ["info", "warn", "critical"].includes(it.severity) ? it.severity : "warn",
        sortOrder: typeof it.sortOrder === "number" ? it.sortOrder : i * 10,
      });
    }
  }

  const [updated] = await db.select().from(amenityInspectionTemplatesTable).where(eq(amenityInspectionTemplatesTable.id, id));
  const items = await db.select().from(amenityInspectionTemplateItemsTable)
    .where(eq(amenityInspectionTemplateItemsTable.templateId, id));
  res.json(publicTemplate(updated, items));
});

router.delete("/amenity-inspection-templates/:id", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(amenityInspectionTemplatesTable).where(eq(amenityInspectionTemplatesTable.id, id));
  res.status(204).end();
});

// ── Inspections per booking ───────────────────────────────────────────────

async function findApplicableTemplate(amenitySlug: string, kind: "pre" | "post" | "owner_self") {
  const [tpl] = await db.select().from(amenityInspectionTemplatesTable).where(and(
    eq(amenityInspectionTemplatesTable.amenitySlug, amenitySlug),
    eq(amenityInspectionTemplatesTable.kind, kind),
    eq(amenityInspectionTemplatesTable.enabled, true),
  )).orderBy(asc(amenityInspectionTemplatesTable.sortOrder)).limit(1);
  if (tpl) return tpl;
  const [generic] = await db.select().from(amenityInspectionTemplatesTable).where(and(
    isNull(amenityInspectionTemplatesTable.amenitySlug),
    eq(amenityInspectionTemplatesTable.kind, kind),
    eq(amenityInspectionTemplatesTable.enabled, true),
  )).orderBy(asc(amenityInspectionTemplatesTable.sortOrder)).limit(1);
  return generic ?? null;
}

router.get("/amenity-bookings/:id/inspections", async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  if (Number.isNaN(bookingId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const booking = await loadBooking(bookingId);
  if (!booking) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!) && booking.ownerUserId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const inspections = await db.select().from(amenityInspectionsTable)
    .where(eq(amenityInspectionsTable.bookingId, bookingId))
    .orderBy(asc(amenityInspectionsTable.createdAt));
  const ids = inspections.map((i) => i.id);
  let results: AmenityInspectionItemResult[] = [];
  if (ids.length > 0) {
    results = await db.select().from(amenityInspectionItemResultsTable);
    results = results.filter((r) => ids.includes(r.inspectionId));
  }
  res.json(inspections.map((i) => publicInspection(i, results)));
});

router.post("/amenity-bookings/:id/inspections", async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  if (Number.isNaN(bookingId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const booking = await loadBooking(bookingId);
  if (!booking) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body ?? {};
  const kind = typeof body.kind === "string" ? body.kind : null;
  if (!kind || !["pre", "post", "owner_self"].includes(kind)) {
    res.status(400).json({ error: "kind must be pre, post, or owner_self" }); return;
  }
  const ownerOnly = booking.ownerUserId === req.user!.id;
  if (!isManager(req.user!) && !(ownerOnly && kind === "owner_self")) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const amenity = await loadAmenity(booking.amenityId);
  if (!amenity) { res.status(404).json({ error: "Amenity not found" }); return; }
  let templateId: number | null = typeof body.templateId === "number" ? body.templateId : null;
  if (!templateId) {
    const tpl = await findApplicableTemplate(amenity.slug, kind);
    templateId = tpl?.id ?? null;
  }
  const now = nowISO();
  const [created] = await db.insert(amenityInspectionsTable).values({
    bookingId,
    templateId,
    kind,
    status: "draft",
    inspectorUserId: req.user!.id,
    inspectorName: req.user!.name ?? "",
    inspectorRole: req.user!.role,
    notes: "",
    signature: "",
    performedAt: null,
    createdAt: now,
    updatedAt: now,
  }).returning();
  // Materialize result rows from template items so the UI can render them.
  if (templateId) {
    const items = await db.select().from(amenityInspectionTemplateItemsTable)
      .where(eq(amenityInspectionTemplateItemsTable.templateId, templateId))
      .orderBy(asc(amenityInspectionTemplateItemsTable.sortOrder));
    for (const it of items) {
      await db.insert(amenityInspectionItemResultsTable).values({
        inspectionId: created.id,
        templateItemId: it.id,
        label: it.label,
        status: "ok",
        note: "",
        photoStorageKey: null,
        sortOrder: it.sortOrder,
      });
    }
  }
  await audit(bookingId, `inspection_created_${kind}`, req.user!, { inspectionId: created.id });
  const results = await db.select().from(amenityInspectionItemResultsTable)
    .where(eq(amenityInspectionItemResultsTable.inspectionId, created.id));
  res.status(201).json(publicInspection(created, results));
});

router.patch("/amenity-inspections/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [insp] = await db.select().from(amenityInspectionsTable).where(eq(amenityInspectionsTable.id, id));
  if (!insp) { res.status(404).json({ error: "Not found" }); return; }
  const booking = await loadBooking(insp.bookingId);
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  const ownerOnly = booking.ownerUserId === req.user!.id;
  if (!isManager(req.user!) && !(ownerOnly && insp.kind === "owner_self")) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (insp.status === "submitted") {
    res.status(400).json({ error: "Inspection already submitted" }); return;
  }
  const body = req.body ?? {};
  const patch: Partial<typeof amenityInspectionsTable.$inferInsert> = { updatedAt: nowISO() };
  if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 4000);
  if (typeof body.signature === "string") patch.signature = body.signature.slice(0, 240);
  await db.update(amenityInspectionsTable).set(patch).where(eq(amenityInspectionsTable.id, id));

  if (Array.isArray(body.items)) {
    for (const it of body.items) {
      if (typeof it.id !== "number") continue;
      const itemPatch: Partial<typeof amenityInspectionItemResultsTable.$inferInsert> = {};
      if (["ok", "flagged", "na"].includes(it.status)) itemPatch.status = it.status;
      if (typeof it.note === "string") itemPatch.note = it.note.slice(0, 2000);
      if (typeof it.photoStorageKey === "string" || it.photoStorageKey === null) {
        itemPatch.photoStorageKey = it.photoStorageKey;
      }
      if (Object.keys(itemPatch).length > 0) {
        await db.update(amenityInspectionItemResultsTable)
          .set(itemPatch)
          .where(and(
            eq(amenityInspectionItemResultsTable.id, it.id),
            eq(amenityInspectionItemResultsTable.inspectionId, id),
          ));
      }
    }
  }

  const [updated] = await db.select().from(amenityInspectionsTable).where(eq(amenityInspectionsTable.id, id));
  const results = await db.select().from(amenityInspectionItemResultsTable)
    .where(eq(amenityInspectionItemResultsTable.inspectionId, id));
  res.json(publicInspection(updated, results));
});

router.post("/amenity-inspections/:id/submit", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [insp] = await db.select().from(amenityInspectionsTable).where(eq(amenityInspectionsTable.id, id));
  if (!insp) { res.status(404).json({ error: "Not found" }); return; }
  const booking = await loadBooking(insp.bookingId);
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  const ownerOnly = booking.ownerUserId === req.user!.id;
  if (!isManager(req.user!) && !(ownerOnly && insp.kind === "owner_self")) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (insp.status === "submitted") {
    res.status(400).json({ error: "Already submitted" }); return;
  }
  const now = nowISO();
  await db.update(amenityInspectionsTable).set({
    status: "submitted",
    performedAt: now,
    updatedAt: now,
  }).where(eq(amenityInspectionsTable.id, id));

  const results = await db.select().from(amenityInspectionItemResultsTable)
    .where(eq(amenityInspectionItemResultsTable.inspectionId, id));
  const flagged = results.filter((r) => r.status === "flagged");
  await audit(booking.id, `inspection_submitted_${insp.kind}`, req.user!, {
    inspectionId: id, flaggedCount: flagged.length,
  });

  // Post-inspection (manager) finalizes the booking lifecycle.
  if (insp.kind === "post" && booking.status === "used_pending_inspection") {
    if (flagged.length === 0) {
      await db.update(amenityBookingsTable).set({ status: "used", updatedAt: now })
        .where(eq(amenityBookingsTable.id, booking.id));
      if (booking.depositCents > 0 && booking.depositPaidAt && !booking.depositRefundedAt) {
        await db.insert(amenityDepositLedgerTable).values({
          bookingId: booking.id, kind: "released", amountCents: booking.depositCents,
          balanceCents: 0, reason: "post-inspection clean",
          actorUserId: req.user!.id, actorName: req.user!.name ?? "", createdAt: now,
        });
      }
    }
    // If flagged items exist, the booking remains in used_pending_inspection
    // until the manager files / waives a damage report; on resolve we finalize.
  }

  const [updated] = await db.select().from(amenityInspectionsTable).where(eq(amenityInspectionsTable.id, id));

  // Notify owner of inspection completion or flags.
  void (async () => {
    try {
      const owner = await loadOwner(booking.ownerUserId);
      const amenity = await loadAmenity(booking.amenityId);
      if (!owner?.email || !amenity) return;
      const orgName = await loadOrgName();
      const html = buildAmenityInspectionEmail({
        orgName,
        amenityName: amenity.name,
        ownerName: owner.name ?? "Owner",
        kind: insp.kind,
        status: flagged.length > 0 ? "flagged" : "completed",
        startsAt: booking.startsAt,
        flaggedItems: flagged.map((r) => r.label),
      });
      await sendEmail(owner.email, `${insp.kind === "pre" ? "Pre-use" : insp.kind === "post" ? "Post-use" : "Self"} inspection — ${amenity.name}`, html);
    } catch (err) {
      logger.error({ err }, "inspection submit email failed");
    }
  })();

  res.json(publicInspection(updated, results));
});

// ── Damage reports ────────────────────────────────────────────────────────

router.get("/amenity-bookings/:id/damage-reports", async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  if (Number.isNaN(bookingId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const booking = await loadBooking(bookingId);
  if (!booking) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!) && booking.ownerUserId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const rows = await db.select().from(amenityDamageReportsTable)
    .where(eq(amenityDamageReportsTable.bookingId, bookingId))
    .orderBy(desc(amenityDamageReportsTable.createdAt));
  res.json(rows.map(publicDamage));
});

router.get("/amenity-damage-reports", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const status = typeof req.query.status === "string" ? req.query.status : null;
  let rows = await db.select().from(amenityDamageReportsTable)
    .orderBy(desc(amenityDamageReportsTable.createdAt));
  if (status) rows = rows.filter((r) => r.status === status);
  res.json(rows.map(publicDamage));
});

router.post("/amenity-bookings/:id/damage-reports", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const bookingId = parseInt(req.params.id, 10);
  if (Number.isNaN(bookingId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const booking = await loadBooking(bookingId);
  if (!booking) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body ?? {};
  const summary = typeof body.summary === "string" ? body.summary.slice(0, 500) : "";
  if (!summary.trim()) { res.status(400).json({ error: "summary required" }); return; }
  const photos = Array.isArray(body.photoStorageKeys)
    ? body.photoStorageKeys.filter((k: unknown): k is string => typeof k === "string").slice(0, 20)
    : [];
  const now = nowISO();
  const [created] = await db.insert(amenityDamageReportsTable).values({
    bookingId,
    inspectionId: typeof body.inspectionId === "number" ? body.inspectionId : null,
    reportedByUserId: req.user!.id,
    reportedByName: req.user!.name ?? "",
    summary,
    details: typeof body.details === "string" ? body.details.slice(0, 4000) : "",
    estimatedCostCents: typeof body.estimatedCostCents === "number" ? Math.max(0, Math.floor(body.estimatedCostCents)) : 0,
    depositChargedCents: 0,
    photoStorageKeys: photos,
    status: "open",
    workOrderId: null,
    managerNotes: typeof body.managerNotes === "string" ? body.managerNotes.slice(0, 2000) : "",
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
  }).returning();
  await audit(bookingId, "damage_filed", req.user!, { damageReportId: created.id, summary });

  // Notify owner.
  void (async () => {
    try {
      const owner = await loadOwner(booking.ownerUserId);
      const amenity = await loadAmenity(booking.amenityId);
      if (!owner?.email || !amenity) return;
      const orgName = await loadOrgName();
      const html = buildAmenityDamageReportEmail({
        orgName, amenityName: amenity.name, ownerName: owner.name ?? "Owner",
        summary, estimatedCostCents: created.estimatedCostCents, status: "filed",
      });
      await sendEmail(owner.email, `Damage report — ${amenity.name}`, html);
    } catch (err) { logger.error({ err }, "damage filed email failed"); }
  })();

  res.status(201).json(publicDamage(created));
});

router.post("/amenity-damage-reports/:id/charge", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [d] = await db.select().from(amenityDamageReportsTable).where(eq(amenityDamageReportsTable.id, id));
  if (!d) { res.status(404).json({ error: "Not found" }); return; }
  if (d.status !== "open" && d.status !== "disputed") {
    res.status(400).json({ error: "Damage report not chargeable" }); return;
  }
  const booking = await loadBooking(d.bookingId);
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  const body = req.body ?? {};
  const requested = typeof body.amountCents === "number" ? Math.max(0, Math.floor(body.amountCents)) : d.estimatedCostCents;
  const charged = Math.min(requested, booking.depositCents);
  const now = nowISO();
  await db.update(amenityDamageReportsTable).set({
    status: "charged",
    depositChargedCents: charged,
    updatedAt: now,
    resolvedAt: now,
    managerNotes: typeof body.managerNotes === "string" ? body.managerNotes.slice(0, 2000) : d.managerNotes,
  }).where(eq(amenityDamageReportsTable.id, id));

  await db.insert(amenityDepositLedgerTable).values({
    bookingId: booking.id, kind: "charged", amountCents: charged,
    balanceCents: Math.max(0, booking.depositCents - charged),
    reason: `damage report #${id}`,
    damageReportId: id,
    actorUserId: req.user!.id, actorName: req.user!.name ?? "", createdAt: now,
  });

  // If anything is left of the deposit, treat it as released.
  const remainder = Math.max(0, booking.depositCents - charged);
  if (remainder > 0 && booking.depositCents > 0 && booking.depositPaidAt && !booking.depositRefundedAt) {
    await db.insert(amenityDepositLedgerTable).values({
      bookingId: booking.id, kind: "released", amountCents: remainder,
      balanceCents: 0, reason: "remainder after damage charge",
      damageReportId: id,
      actorUserId: req.user!.id, actorName: req.user!.name ?? "", createdAt: now,
    });
  }

  // Finalize booking lifecycle.
  if (booking.status === "used_pending_inspection") {
    await db.update(amenityBookingsTable).set({ status: "used", updatedAt: now })
      .where(eq(amenityBookingsTable.id, booking.id));
  }
  await audit(booking.id, "damage_charged", req.user!, { damageReportId: id, charged });

  void (async () => {
    try {
      const owner = await loadOwner(booking.ownerUserId);
      const amenity = await loadAmenity(booking.amenityId);
      if (!owner?.email || !amenity) return;
      const orgName = await loadOrgName();
      const html = buildAmenityDamageReportEmail({
        orgName, amenityName: amenity.name, ownerName: owner.name ?? "Owner",
        summary: d.summary, estimatedCostCents: charged, status: "charged",
      });
      await sendEmail(owner.email, `Deposit charged — ${amenity.name}`, html);
    } catch (err) { logger.error({ err }, "damage charge email failed"); }
  })();

  const [updated] = await db.select().from(amenityDamageReportsTable).where(eq(amenityDamageReportsTable.id, id));
  res.json(publicDamage(updated));
});

router.post("/amenity-damage-reports/:id/waive", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [d] = await db.select().from(amenityDamageReportsTable).where(eq(amenityDamageReportsTable.id, id));
  if (!d) { res.status(404).json({ error: "Not found" }); return; }
  if (d.status === "charged" || d.status === "waived" || d.status === "resolved") {
    res.status(400).json({ error: "Damage report already finalized" }); return;
  }
  const booking = await loadBooking(d.bookingId);
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  const note = typeof req.body?.managerNotes === "string" ? req.body.managerNotes.slice(0, 2000) : "";
  const now = nowISO();
  await db.update(amenityDamageReportsTable).set({
    status: "waived", managerNotes: note, updatedAt: now, resolvedAt: now,
  }).where(eq(amenityDamageReportsTable.id, id));
  if (booking.depositCents > 0 && booking.depositPaidAt && !booking.depositRefundedAt) {
    await db.insert(amenityDepositLedgerTable).values({
      bookingId: booking.id, kind: "released", amountCents: booking.depositCents,
      balanceCents: 0, reason: `damage waived (#${id})`,
      damageReportId: id,
      actorUserId: req.user!.id, actorName: req.user!.name ?? "", createdAt: now,
    });
  }
  if (booking.status === "used_pending_inspection") {
    await db.update(amenityBookingsTable).set({ status: "used", updatedAt: now })
      .where(eq(amenityBookingsTable.id, booking.id));
  }
  await audit(booking.id, "damage_waived", req.user!, { damageReportId: id });

  void (async () => {
    try {
      const owner = await loadOwner(booking.ownerUserId);
      const amenity = await loadAmenity(booking.amenityId);
      if (!owner?.email || !amenity) return;
      const orgName = await loadOrgName();
      const html = buildAmenityDamageReportEmail({
        orgName, amenityName: amenity.name, ownerName: owner.name ?? "Owner",
        summary: d.summary, estimatedCostCents: 0, status: "waived", managerNotes: note,
      });
      await sendEmail(owner.email, `Damage waived — ${amenity.name}`, html);
    } catch (err) { logger.error({ err }, "damage waive email failed"); }
  })();

  const [updated] = await db.select().from(amenityDamageReportsTable).where(eq(amenityDamageReportsTable.id, id));
  res.json(publicDamage(updated));
});

router.post("/amenity-damage-reports/:id/work-order", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [d] = await db.select().from(amenityDamageReportsTable).where(eq(amenityDamageReportsTable.id, id));
  if (!d) { res.status(404).json({ error: "Not found" }); return; }
  if (d.workOrderId) { res.status(400).json({ error: "Work order already created" }); return; }
  const booking = await loadBooking(d.bookingId);
  const amenity = booking ? await loadAmenity(booking.amenityId) : null;
  const body = req.body ?? {};
  const buildingNum = typeof body.building === "number" ? body.building : 1;
  const woId = `WO-${new Date().getUTCFullYear()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const now = nowISO();
  await db.insert(workOrdersTable).values({
    id: woId,
    building: buildingNum,
    unit: null,
    title: `Amenity damage: ${amenity?.name ?? "amenity"} — ${d.summary}`.slice(0, 240),
    category: typeof body.category === "string" ? body.category : "amenity_damage",
    priority: typeof body.priority === "string" ? body.priority : "high",
    status: "open",
    vendor: null,
    vendorId: null,
    opened: now,
    due: null,
    estCost: d.estimatedCostCents,
    description: `${d.details || d.summary}\n\nLinked to damage report #${id} on amenity booking #${d.bookingId}.`,
    sourceBidId: null,
    sourceMotionId: null,
    emergencyBypassId: null,
    resolutionId: null,
  });
  await db.update(amenityDamageReportsTable).set({
    workOrderId: woId, updatedAt: now,
  }).where(eq(amenityDamageReportsTable.id, id));
  await audit(d.bookingId, "damage_work_order", req.user!, { damageReportId: id, workOrderId: woId });
  const [updated] = await db.select().from(amenityDamageReportsTable).where(eq(amenityDamageReportsTable.id, id));
  res.json(publicDamage(updated));
});

// ── Disputes ──────────────────────────────────────────────────────────────

router.get("/amenity-damage-reports/:id/disputes", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [d] = await db.select().from(amenityDamageReportsTable).where(eq(amenityDamageReportsTable.id, id));
  if (!d) { res.status(404).json({ error: "Not found" }); return; }
  const booking = await loadBooking(d.bookingId);
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (!isManager(req.user!) && booking.ownerUserId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const rows = await db.select().from(amenityDamageDisputesTable)
    .where(eq(amenityDamageDisputesTable.damageReportId, id))
    .orderBy(desc(amenityDamageDisputesTable.createdAt));
  res.json(rows.map(publicDispute));
});

router.post("/amenity-damage-reports/:id/disputes", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [d] = await db.select().from(amenityDamageReportsTable).where(eq(amenityDamageReportsTable.id, id));
  if (!d) { res.status(404).json({ error: "Not found" }); return; }
  const booking = await loadBooking(d.bookingId);
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.ownerUserId !== req.user!.id) {
    res.status(403).json({ error: "Only the booking owner can dispute" }); return;
  }
  const body = req.body ?? {};
  const message = typeof body.message === "string" ? body.message.slice(0, 4000) : "";
  if (!message.trim()) { res.status(400).json({ error: "message required" }); return; }
  const evidence = Array.isArray(body.evidenceStorageKeys)
    ? body.evidenceStorageKeys.filter((k: unknown): k is string => typeof k === "string").slice(0, 20)
    : [];
  const now = nowISO();
  const [created] = await db.insert(amenityDamageDisputesTable).values({
    damageReportId: id,
    ownerUserId: req.user!.id,
    ownerName: req.user!.name ?? "",
    message,
    evidenceStorageKeys: evidence,
    status: "open",
    managerResponse: "",
    resolvedByUserId: null,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
  }).returning();
  // Bump damage status to disputed unless already finalized.
  if (d.status === "open" || d.status === "charged") {
    await db.update(amenityDamageReportsTable).set({ status: "disputed", updatedAt: now })
      .where(eq(amenityDamageReportsTable.id, id));
  }
  await audit(booking.id, "dispute_filed", req.user!, { damageReportId: id, disputeId: created.id });

  void (async () => {
    try {
      const orgSetting = await loadOrgName();
      const amenity = await loadAmenity(booking.amenityId);
      if (!amenity) return;
      // Notify managers (best effort: notify all admin/manager users).
      const mgrs = await db.select().from(usersTable).where(or(
        eq(usersTable.role, "admin"),
        eq(usersTable.role, "manager"),
      ));
      const emails = mgrs.map((u) => u.email).filter((e): e is string => !!e);
      if (emails.length === 0) return;
      const html = buildAmenityDisputeEmail({
        orgName: orgSetting,
        amenityName: amenity.name,
        ownerName: req.user!.name ?? "Owner",
        status: "filed",
        message,
      });
      await sendEmail(emails, `Dispute filed — ${amenity.name}`, html);
    } catch (err) { logger.error({ err }, "dispute file email failed"); }
  })();

  res.status(201).json(publicDispute(created));
});

router.post("/amenity-disputes/:id/respond", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [dispute] = await db.select().from(amenityDamageDisputesTable).where(eq(amenityDamageDisputesTable.id, id));
  if (!dispute) { res.status(404).json({ error: "Not found" }); return; }
  if (dispute.status === "upheld" || dispute.status === "denied") {
    res.status(400).json({ error: "Dispute already resolved" }); return;
  }
  const body = req.body ?? {};
  const decision = typeof body.decision === "string" ? body.decision : null;
  if (!["upheld", "denied", "under_review"].includes(decision ?? "")) {
    res.status(400).json({ error: "decision must be upheld, denied, or under_review" }); return;
  }
  const response = typeof body.managerResponse === "string" ? body.managerResponse.slice(0, 4000) : "";
  const now = nowISO();
  const isFinal = decision === "upheld" || decision === "denied";
  await db.update(amenityDamageDisputesTable).set({
    status: decision as "upheld" | "denied" | "under_review",
    managerResponse: response,
    resolvedByUserId: isFinal ? req.user!.id : null,
    resolvedAt: isFinal ? now : null,
    updatedAt: now,
  }).where(eq(amenityDamageDisputesTable.id, id));

  const [d] = await db.select().from(amenityDamageReportsTable).where(eq(amenityDamageReportsTable.id, dispute.damageReportId));
  if (d) {
    if (decision === "upheld") {
      // Owner wins → waive the damage and release deposit.
      const booking = await loadBooking(d.bookingId);
      await db.update(amenityDamageReportsTable).set({ status: "waived", resolvedAt: now, updatedAt: now })
        .where(eq(amenityDamageReportsTable.id, d.id));
      if (booking && booking.depositCents > 0 && booking.depositPaidAt && !booking.depositRefundedAt) {
        await db.insert(amenityDepositLedgerTable).values({
          bookingId: booking.id, kind: "released", amountCents: booking.depositCents,
          balanceCents: 0, reason: `dispute upheld (#${id})`,
          damageReportId: d.id,
          actorUserId: req.user!.id, actorName: req.user!.name ?? "", createdAt: now,
        });
        if (booking.status === "used_pending_inspection") {
          await db.update(amenityBookingsTable).set({ status: "used", updatedAt: now })
            .where(eq(amenityBookingsTable.id, booking.id));
        }
      }
    } else if (decision === "denied") {
      // Owner loses → mark damage resolved (charge stands if previously charged).
      await db.update(amenityDamageReportsTable).set({ status: d.status === "disputed" ? "resolved" : d.status, resolvedAt: now, updatedAt: now })
        .where(eq(amenityDamageReportsTable.id, d.id));
    }
    const booking = await loadBooking(d.bookingId);
    if (booking) {
      await audit(booking.id, `dispute_${decision}`, req.user!, { disputeId: id });
      void (async () => {
        try {
          const owner = await loadOwner(booking.ownerUserId);
          const amenity = await loadAmenity(booking.amenityId);
          if (!owner?.email || !amenity) return;
          const orgName = await loadOrgName();
          const html = buildAmenityDisputeEmail({
            orgName, amenityName: amenity.name, ownerName: owner.name ?? "Owner",
            status: decision === "upheld" ? "upheld" : decision === "denied" ? "denied" : "responded",
            message: response,
          });
          await sendEmail(owner.email, `Dispute ${decision} — ${amenity.name}`, html);
        } catch (err) { logger.error({ err }, "dispute respond email failed"); }
      })();
    }
  }

  const [updated] = await db.select().from(amenityDamageDisputesTable).where(eq(amenityDamageDisputesTable.id, id));
  res.json(publicDispute(updated));
});

// ── Deposit ledger ────────────────────────────────────────────────────────

router.get("/amenity-bookings/:id/deposit-ledger", async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  if (Number.isNaN(bookingId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const booking = await loadBooking(bookingId);
  if (!booking) { res.status(404).json({ error: "Not found" }); return; }
  if (!isManager(req.user!) && booking.ownerUserId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const rows = await db.select().from(amenityDepositLedgerTable)
    .where(eq(amenityDepositLedgerTable.bookingId, bookingId))
    .orderBy(asc(amenityDepositLedgerTable.createdAt));
  res.json(rows.map(publicLedger));
});

// ── Pool chemistry log ────────────────────────────────────────────────────

interface ChemRange { min: number; max: number; label: string; }
const CHEM_RANGES: Record<string, ChemRange> = {
  freeChlorinePpm: { min: 1, max: 4, label: "Free chlorine (ppm)" },
  ph: { min: 7.2, max: 7.8, label: "pH" },
  alkalinityPpm: { min: 80, max: 120, label: "Total alkalinity (ppm)" },
  cyanuricAcidPpm: { min: 30, max: 50, label: "Cyanuric acid (ppm)" },
};

function evaluateChemistry(values: Record<string, number | null | undefined>): string[] {
  const reasons: string[] = [];
  for (const [key, range] of Object.entries(CHEM_RANGES)) {
    const v = values[key];
    if (v === null || v === undefined) continue;
    if (v < range.min) reasons.push(`${range.label} too low: ${v} (min ${range.min})`);
    if (v > range.max) reasons.push(`${range.label} too high: ${v} (max ${range.max})`);
  }
  return reasons;
}

router.get("/pool-chemistry-logs", async (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(typeof req.query.limit === "string" ? req.query.limit : "60", 10) || 60));
  const rows = await db.select().from(poolChemistryLogsTable)
    .orderBy(desc(poolChemistryLogsTable.recordedAt))
    .limit(limit);
  res.json(rows.map(publicPoolLog));
});

router.post("/pool-chemistry-logs", async (req, res) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const body = req.body ?? {};
  const recordedAt = typeof body.recordedAt === "string" ? body.recordedAt : nowISO();
  const numeric = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
  const values = {
    freeChlorinePpm: numeric(body.freeChlorinePpm),
    totalChlorinePpm: numeric(body.totalChlorinePpm),
    ph: numeric(body.ph),
    alkalinityPpm: numeric(body.alkalinityPpm),
    calciumHardnessPpm: numeric(body.calciumHardnessPpm),
    cyanuricAcidPpm: numeric(body.cyanuricAcidPpm),
    temperatureF: numeric(body.temperatureF),
  };
  const reasons = evaluateChemistry(values);
  const flagged = reasons.length > 0;
  const now = nowISO();
  let workOrderId: string | null = null;
  if (flagged) {
    workOrderId = `WO-${new Date().getUTCFullYear()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    await db.insert(workOrdersTable).values({
      id: workOrderId,
      building: 1,
      unit: null,
      title: `Pool chemistry out of range`,
      category: "pool_maintenance",
      priority: "high",
      status: "open",
      vendor: null,
      vendorId: null,
      opened: now,
      due: null,
      estCost: 0,
      description: `Auto-created from pool chemistry log.\n${reasons.join("\n")}`,
      sourceBidId: null,
      sourceMotionId: null,
      emergencyBypassId: null,
      resolutionId: null,
    });
  }
  const [created] = await db.insert(poolChemistryLogsTable).values({
    recordedAt,
    recordedByUserId: req.user!.id,
    recordedByName: req.user!.name ?? "",
    freeChlorinePpm: values.freeChlorinePpm,
    totalChlorinePpm: values.totalChlorinePpm,
    ph: values.ph,
    alkalinityPpm: values.alkalinityPpm,
    calciumHardnessPpm: values.calciumHardnessPpm,
    cyanuricAcidPpm: values.cyanuricAcidPpm,
    temperatureF: values.temperatureF,
    notes: typeof body.notes === "string" ? body.notes.slice(0, 2000) : "",
    flagged,
    flagReasons: reasons,
    workOrderId,
    createdAt: now,
  }).returning();

  if (flagged && workOrderId) {
    void (async () => {
      try {
        const orgName = await loadOrgName();
        const mgrs = await db.select().from(usersTable).where(or(
          eq(usersTable.role, "admin"),
          eq(usersTable.role, "manager"),
        ));
        const emails = mgrs.map((u) => u.email).filter((e): e is string => !!e);
        if (emails.length === 0) return;
        const html = buildPoolChemistryAlertEmail({
          orgName, recordedAt, reasons, workOrderId,
        });
        await sendEmail(emails, "Pool chemistry out of range", html);
        // Also send the regular high-priority work order email.
        const woHtml = buildWorkOrderEmail({
          orgName, title: "Pool chemistry out of range", priority: "high",
          building: 1, id: workOrderId,
        });
        await sendEmail(emails, `🟠 High Work Order: Pool chemistry out of range`, woHtml);
      } catch (err) { logger.error({ err }, "pool chemistry alert email failed"); }
    })();
  }

  res.status(201).json(publicPoolLog(created));
});

void or; // keep reference
export default router;
