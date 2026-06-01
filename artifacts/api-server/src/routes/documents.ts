import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  documentsTable,
  documentImportBatchesTable,
  unitsTable,
  buildingsTable,
  documentOcrJobsTable,
  organizationSettingsTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte, like, or, sql, inArray, desc } from "drizzle-orm";
import { enqueueOcrJob, getOcrJobsByStorageKeys } from "../lib/ocrScheduler.js";
import {
  ListDocumentsQueryParams as ListDocumentsParams,
  GetDocumentParams,
  DeleteDocumentParams,
  DownloadDocumentParams,
  CreateDocumentBody,
  UpdateDocumentBody,
  ExportDocumentsBody,
  PreviewDocumentImportBatchBody as ImportBatchPreviewBody,
  CommitDocumentImportBatchBody as ImportBatchCommitBody,
} from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";
import { driveService } from "../lib/driveService";
import archiver from "archiver";
import { requireManager } from "../middleware/auth.js";
import { buildPlaceholderPdf } from "../lib/placeholderPdf.js";

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;
const VALID_SOURCES = ["original", "imported", "scanned", "prior_mgmt", "vendor"] as const;
type DocumentSource = (typeof VALID_SOURCES)[number];

function withinUndoWindow(createdAt: string): boolean {
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < UNDO_WINDOW_MS;
}

function toBatch(row: typeof documentImportBatchesTable.$inferSelect) {
  return {
    id: row.id,
    label: row.label ?? null,
    status: row.status,
    fileCount: row.fileCount,
    defaultCategory: row.defaultCategory ?? null,
    defaultBuilding: row.defaultBuilding ?? null,
    defaultUnit: row.defaultUnit ?? null,
    defaultSource: row.defaultSource,
    defaultIsHistorical: row.defaultIsHistorical,
    createdBy: row.createdBy ?? null,
    createdByName: row.createdByName ?? null,
    createdAt: row.createdAt,
    undoneAt: row.undoneAt ?? null,
    undoneBy: row.undoneBy ?? null,
    undoneByName: row.undoneByName ?? null,
    notes: row.notes ?? null,
    canUndo: row.status === "committed" && withinUndoWindow(row.createdAt),
  };
}

const router: IRouter = Router();
const storage = new ObjectStorageService();

router.get("/documents", async (req, res) => {
  const parsed = ListDocumentsParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }
  let query = db.select().from(documentsTable).$dynamic();
  const conditions = [];
  if (parsed.data.building) conditions.push(eq(documentsTable.building, parsed.data.building));
  if (parsed.data.unit) conditions.push(eq(documentsTable.unit, parsed.data.unit));
  if (parsed.data.category) conditions.push(eq(documentsTable.category, parsed.data.category));
  if (parsed.data.dateFrom) conditions.push(gte(documentsTable.uploaded, parsed.data.dateFrom));
  if (parsed.data.dateTo) conditions.push(lte(documentsTable.uploaded, parsed.data.dateTo));
  // Task #119: filter by historical/source/import-batch.
  const historical = (req.query.historical as string | undefined) ?? "all";
  if (historical === "true") conditions.push(eq(documentsTable.isHistorical, true));
  else if (historical === "false") conditions.push(eq(documentsTable.isHistorical, false));
  if (parsed.data.source) conditions.push(eq(documentsTable.source, parsed.data.source));
  if (parsed.data.importBatchId) conditions.push(eq(documentsTable.importBatchId, parsed.data.importBatchId));
  if (parsed.data.vendorId != null) conditions.push(eq(documentsTable.vendorId, parsed.data.vendorId));
  if (parsed.data.workOrderId) conditions.push(eq(documentsTable.workOrderId, parsed.data.workOrderId));
  if (parsed.data.search) {
    const s = `%${parsed.data.search.toLowerCase()}%`;
    conditions.push(
      or(
        like(sql`lower(${documentsTable.name})`, s),
        like(sql`lower(${documentsTable.uploadedBy})`, s),
        like(sql`lower(${documentsTable.category})`, s),
        like(sql`lower(cast(${documentsTable.building} as text))`, s),
        // Include OCR-extracted full-text in document search.
        like(sql`lower(coalesce(${documentsTable.extractedText}, ''))`, s),
      )!
    );
  }

  if (req.user?.role === "resident" && req.user.unitId) {
    const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, req.user.unitId));
    if (unit) {
      conditions.push(eq(documentsTable.building, unit.building));
      conditions.push(
        or(
          sql`${documentsTable.unit} is null`,
          eq(documentsTable.unit, req.user.unitId)
        )!
      );
    }
  }

  if (conditions.length > 0) query = query.where(and(...conditions));
  const rows = await query.orderBy(documentsTable.uploaded);
  res.json(rows.map(toDocument));
});

router.get("/documents/:id", async (req, res) => {
  const parsed = GetDocumentParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid document id" });
    return;
  }
  const [row] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.id, parsed.data.id));
  if (!row) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  if (req.user?.role === "resident" && req.user.unitId) {
    const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, req.user.unitId));
    if (!unit || row.building !== unit.building) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    if (row.unit != null && row.unit !== req.user.unitId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }
  res.json(toDocument(row));
});

router.post("/documents", requireManager, async (req, res) => {
  const parsed = CreateDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }

  if (parsed.data.unit) {
    const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, parsed.data.unit));
    if (!unit) {
      res.status(400).json({ error: "Unit not found" });
      return;
    }
    if (parsed.data.building != null && unit.building !== parsed.data.building) {
      res.status(400).json({ error: "Unit does not belong to the specified building" });
      return;
    }
  }

  const id = `D-${Date.now()}`;
  const today = new Date().toISOString().slice(0, 10);
  const sourceVal: DocumentSource =
    parsed.data.source && (VALID_SOURCES as readonly string[]).includes(parsed.data.source)
      ? (parsed.data.source as DocumentSource)
      : "original";
  const isHistorical = parsed.data.isHistorical === true || sourceVal !== "original";

  const [row] = await db
    .insert(documentsTable)
    .values({
      id,
      name: parsed.data.name,
      category: parsed.data.category,
      building: parsed.data.building ?? null,
      unit: parsed.data.unit ?? null,
      uploaded: today,
      size: parsed.data.size,
      uploadedBy: parsed.data.uploadedBy,
      storageKey: parsed.data.storageKey,
      driveFileId: null,
      documentDate: parsed.data.documentDate ?? null,
      isHistorical,
      source: sourceVal,
      notes: parsed.data.notes ?? null,
      vendorId: parsed.data.vendorId ?? null,
      workOrderId: parsed.data.workOrderId ?? null,
    })
    .returning();

  if (!row) {
    res.status(500).json({ error: "Failed to create document" });
    return;
  }

  if (parsed.data.storageKey) {
    try {
      const fileBuffer = await storage.downloadObjectToBuffer(parsed.data.storageKey);
      const driveFileId = await driveService.uploadDocument(
        {
          id: row.id,
          name: row.name,
          category: row.category,
          building: row.building ?? null,
          unit: row.unit ?? null,
        },
        fileBuffer,
        "application/pdf",
      );
      if (driveFileId) {
        await db
          .update(documentsTable)
          .set({ driveFileId })
          .where(eq(documentsTable.id, id));
        row.driveFileId = driveFileId;
      }
    } catch (err) {
      req.log.warn({ err }, "Google Drive sync failed — document saved to Replit Storage only");
    }
  }

  res.status(201).json(toDocument(row));
});

router.post("/documents/export", requireManager, async (req, res) => {
  const parsed = ExportDocumentsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }

  const { ids } = parsed.data;
  if (ids.length === 0) {
    res.status(400).json({ error: "No document IDs provided" });
    return;
  }

  const rows = await db
    .select()
    .from(documentsTable)
    .where(inArray(documentsTable.id, ids));
  const selected = rows.filter((r) => !!r.storageKey);

  if (selected.length === 0) {
    res.status(404).json({ error: "No downloadable documents found for the given IDs" });
    return;
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="documents-export-${new Date().toISOString().slice(0, 10)}.zip"`
  );

  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.pipe(res);

  for (const row of selected) {
    try {
      const buffer = await storage.downloadObjectToBuffer(row.storageKey!);
      const safeName = row.name.replace(/[/\\?%*:|"<>]/g, "-");
      archive.append(buffer, { name: safeName });
    } catch (err) {
      req.log.warn({ err, docId: row.id }, "Skipping document in export — file not in storage");
    }
  }

  await archive.finalize();
});

router.get("/documents/:id/download", async (req, res) => {
  const parsed = DownloadDocumentParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid document id" });
    return;
  }
  const [row] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.id, parsed.data.id));
  if (!row) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  if (req.user?.role === "resident" && req.user.unitId) {
    const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, req.user.unitId));
    if (!unit || row.building !== unit.building) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    if (row.unit != null && row.unit !== req.user.unitId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  if (!row.storageKey) {
    const pdfBuffer = buildPlaceholderPdf(row.name, row.category, row.uploaded);
    const safeName = encodeURIComponent(row.name.replace(/[^\w\s.-]/g, "_"));
    res
      .status(200)
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Content-Length": String(pdfBuffer.length),
      })
      .send(pdfBuffer);
    return;
  }

  const objectPath = row.storageKey.startsWith("/objects/")
    ? row.storageKey.slice("/objects/".length)
    : row.storageKey;

  const downloadUrl = `/api/storage/objects/${objectPath}`;
  res.json({ url: downloadUrl, storageKey: row.storageKey, driveFileId: row.driveFileId ?? null });
});

router.patch("/documents/:id", requireManager, async (req, res) => {
  const idParsed = GetDocumentParams.safeParse({ id: req.params.id });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid document id" });
    return;
  }
  const bodyParsed = UpdateDocumentBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request body", details: bodyParsed.error.issues });
    return;
  }

  const [existing] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.id, idParsed.data.id));
  if (!existing) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const updates: {
    building?: number | null;
    unit?: string | null;
    category?: string;
    documentDate?: string | null;
    isHistorical?: boolean;
    source?: string;
    notes?: string | null;
    vendorId?: number | null;
    workOrderId?: string | null;
  } = {};
  let nextBuilding: number | null = existing.building ?? null;
  let nextUnit: string | null = existing.unit ?? null;

  if (Object.prototype.hasOwnProperty.call(bodyParsed.data, "building")) {
    nextBuilding = bodyParsed.data.building ?? null;
    updates.building = nextBuilding;
  }
  if (Object.prototype.hasOwnProperty.call(bodyParsed.data, "unit")) {
    nextUnit = bodyParsed.data.unit ?? null;
    updates.unit = nextUnit;
  }
  if (bodyParsed.data.category !== undefined) updates.category = bodyParsed.data.category;
  if (Object.prototype.hasOwnProperty.call(bodyParsed.data, "documentDate")) {
    updates.documentDate = bodyParsed.data.documentDate ?? null;
  }
  if (bodyParsed.data.isHistorical !== undefined) updates.isHistorical = bodyParsed.data.isHistorical;
  if (bodyParsed.data.source !== undefined) {
    if (!(VALID_SOURCES as readonly string[]).includes(bodyParsed.data.source)) {
      res.status(400).json({ error: "Invalid source" });
      return;
    }
    updates.source = bodyParsed.data.source;
  }
  if (Object.prototype.hasOwnProperty.call(bodyParsed.data, "notes")) {
    updates.notes = bodyParsed.data.notes ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(bodyParsed.data, "vendorId")) {
    updates.vendorId = bodyParsed.data.vendorId ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(bodyParsed.data, "workOrderId")) {
    updates.workOrderId = bodyParsed.data.workOrderId ?? null;
  }

  if (nextUnit) {
    const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, nextUnit));
    if (!unit) {
      res.status(400).json({ error: "Unit not found" });
      return;
    }
    if (nextBuilding != null && unit.building !== nextBuilding) {
      res.status(400).json({ error: "Unit does not belong to the specified building" });
      return;
    }
    if (nextBuilding == null) {
      nextBuilding = unit.building;
      updates.building = nextBuilding;
    }
  }

  if (Object.keys(updates).length === 0) {
    res.json(toDocument(existing));
    return;
  }

  const [row] = await db
    .update(documentsTable)
    .set(updates)
    .where(eq(documentsTable.id, idParsed.data.id))
    .returning();

  if (!row) {
    res.status(500).json({ error: "Failed to update document" });
    return;
  }

  if (row.driveFileId) {
    try {
      await driveService.moveDocument(
        {
          id: row.id,
          name: row.name,
          category: row.category,
          building: row.building ?? null,
          unit: row.unit ?? null,
        },
        row.driveFileId,
      );
    } catch (err) {
      req.log.warn({ err }, "Google Drive move failed — local document still updated");
    }
  }

  res.json(toDocument(row));
});

router.delete("/documents/:id", requireManager, async (req, res) => {
  const parsed = DeleteDocumentParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid document id" });
    return;
  }
  const [row] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.id, parsed.data.id));
  if (!row) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  if (row.storageKey) {
    try {
      const objectFile = await storage.getObjectEntityFile(row.storageKey);
      await objectFile.delete();
    } catch (err) {
      req.log.warn({ err }, "Failed to delete object from storage");
    }
  }

  if (row.driveFileId) {
    try {
      await driveService.trashDocument(row.driveFileId);
    } catch (err) {
      req.log.warn({ err }, "Failed to trash document in Google Drive");
    }
  }

  await db.delete(documentsTable).where(eq(documentsTable.id, parsed.data.id));
  res.status(204).send();
});


function toDocument(row: typeof documentsTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    building: row.building ?? null,
    unit: row.unit ?? null,
    uploaded: row.uploaded,
    size: row.size,
    uploadedBy: row.uploadedBy,
    storageKey: row.storageKey ?? null,
    driveFileId: row.driveFileId ?? null,
    documentDate: row.documentDate ?? null,
    isHistorical: row.isHistorical,
    source: row.source,
    importBatchId: row.importBatchId ?? null,
    notes: row.notes ?? null,
    vendorId: row.vendorId ?? null,
    workOrderId: row.workOrderId ?? null,
  };
}

// ---- Bulk import batches (Task #119) ----

const VALID_BATCH_SOURCES: DocumentSource[] = ["imported", "scanned", "prior_mgmt", "vendor"];
const VALID_CATEGORIES = ["Bylaws", "Insurance", "Inspection", "Financial", "Vendor", "Meeting"] as const;

type BatchPreviewInput = {
  defaultCategory?: string;
  defaultBuilding?: number | null;
  defaultUnit?: string | null;
  defaultSource?: string;
  defaultIsHistorical?: boolean;
  // Per-batch override to skip OCR even when the org toggle is on.
  skipOcr?: boolean;
  files: Array<{
    name: string;
    size: string;
    storageKey: string;
    contentType?: string | null;
    category?: string;
    building?: number | null;
    unit?: string | null;
    documentDate?: string | null;
    vendorId?: number | null;
    notes?: string | null;
  }>;
};

// OCR suggestions are auto-applied to the row when the manager hasn't
// already supplied a per-file override AND the heuristic confidence clears
// this floor. Tunable single-source for the threshold.
const OCR_AUTOFILL_CONFIDENCE = 0.5;

async function isOcrEnabledOrg(): Promise<boolean> {
  const [row] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  return row?.ocrEnabled ?? true;
}

async function buildPreview(
  input: BatchPreviewInput,
  opts: { enqueueOcr?: boolean; useSuggestions?: boolean; userId?: number | null } = {},
) {
  const useSuggestions = opts.useSuggestions ?? opts.enqueueOcr ?? false;
  const buildingNums = new Set<number>();
  const unitIds = new Set<string>();
  if (input.defaultBuilding != null) buildingNums.add(input.defaultBuilding);
  if (input.defaultUnit) unitIds.add(input.defaultUnit);
  for (const f of input.files) {
    if (f.building != null) buildingNums.add(f.building);
    if (f.unit) unitIds.add(f.unit);
  }
  const [bldgRows, unitRows] = await Promise.all([
    buildingNums.size
      ? db.select({ num: buildingsTable.num }).from(buildingsTable).where(inArray(buildingsTable.num, Array.from(buildingNums)))
      : Promise.resolve([] as { num: number }[]),
    unitIds.size
      ? db
          .select({ id: unitsTable.id, building: unitsTable.building })
          .from(unitsTable)
          .where(inArray(unitsTable.id, Array.from(unitIds)))
      : Promise.resolve([] as { id: string; building: number }[]),
  ]);
  const validBuildings = new Set(bldgRows.map((b) => b.num));
  const unitMap = new Map(unitRows.map((u) => [u.id, u.building]));

  const defSource: DocumentSource =
    input.defaultSource && (VALID_BATCH_SOURCES as readonly string[]).includes(input.defaultSource)
      ? (input.defaultSource as DocumentSource)
      : "imported";
  const defHistorical = input.defaultIsHistorical !== false;

  const storageKeys = input.files.map((f) => f.storageKey).filter((k): k is string => Boolean(k));
  const existingJobs = useSuggestions ? await getOcrJobsByStorageKeys(storageKeys) : [];
  const jobByKey = new Map(existingJobs.map((j) => [j.storageKey, j]));
  if (opts.enqueueOcr) {
    for (const f of input.files) {
      if (!f.storageKey || jobByKey.has(f.storageKey)) continue;
      // eslint-disable-next-line no-await-in-loop
      await enqueueOcrJob({
        storageKey: f.storageKey,
        fileName: f.name,
        contentType: f.contentType ?? null,
        enqueuedBy: opts.userId ?? null,
      });
    }
  }

  type Suggestion = { value: string | number; confidence: number; snippet: string; name?: string; applied?: boolean };
  type SuggestionMap = {
    category?: Suggestion | null;
    documentDate?: Suggestion | null;
    vendor?: Suggestion | null;
    building?: Suggestion | null;
    unit?: Suggestion | null;
  };

  const rowsWithOcr = input.files.map((f, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const job = f.storageKey ? jobByKey.get(f.storageKey) : undefined;
    const rawSuggestions = (job?.suggestions as SuggestionMap | null) ?? null;
    const suggestions: SuggestionMap | null = rawSuggestions
      ? {
          category: rawSuggestions.category ? { ...rawSuggestions.category } : null,
          documentDate: rawSuggestions.documentDate ? { ...rawSuggestions.documentDate } : null,
          vendor: rawSuggestions.vendor ? { ...rawSuggestions.vendor } : null,
          building: rawSuggestions.building ? { ...rawSuggestions.building } : null,
          unit: rawSuggestions.unit ? { ...rawSuggestions.unit } : null,
        }
      : null;

    // Override semantics: `undefined` means "no override — fall back to the
    // batch default and then to a high-confidence OCR suggestion". An
    // explicit `null` is a manager-issued clear and suppresses both the
    // default and the OCR suggestion, so an incorrect auto-tagged value
    // can be removed by the manager and won't reappear on re-preview or at
    // commit.
    function pickSuggested<T>(
      override: T | null | undefined,
      sug: Suggestion | null | undefined,
      ofType: "string" | "number",
    ): { value: T | null; appliedFromOcr: boolean } {
      if (override !== undefined) return { value: override, appliedFromOcr: false };
      if (!sug || sug.confidence < OCR_AUTOFILL_CONFIDENCE) return { value: null, appliedFromOcr: false };
      if (typeof sug.value !== ofType) return { value: null, appliedFromOcr: false };
      sug.applied = true;
      return { value: sug.value as unknown as T, appliedFromOcr: true };
    }

    const categoryOverride =
      f.category !== undefined ? f.category : input.defaultCategory;
    let category = (categoryOverride ?? "").trim();
    if (categoryOverride === undefined && !category && suggestions?.category
        && suggestions.category.confidence >= OCR_AUTOFILL_CONFIDENCE
        && typeof suggestions.category.value === "string") {
      category = suggestions.category.value;
      suggestions.category.applied = true;
    }
    if (!category) errors.push("Missing category");
    else if (!(VALID_CATEGORIES as readonly string[]).includes(category)) {
      errors.push(`Invalid category: ${category}`);
    }

    const buildingOverride =
      f.building !== undefined ? f.building : (input.defaultBuilding ?? undefined);
    const buildingPick = pickSuggested<number>(buildingOverride, suggestions?.building, "number");
    const building = buildingPick.value;
    if (building != null && !validBuildings.has(building)) {
      errors.push(`Unknown building: ${building}`);
    }

    const unitOverride =
      f.unit !== undefined ? f.unit : (input.defaultUnit ?? undefined);
    const unitPick = pickSuggested<string>(unitOverride, suggestions?.unit, "string");
    const unit = unitPick.value;
    if (unit) {
      const unitBldg = unitMap.get(unit);
      if (unitBldg == null) errors.push(`Unknown unit: ${unit}`);
      else if (building != null && unitBldg !== building) {
        errors.push(`Unit ${unit} does not belong to building ${building}`);
      }
    }

    const datePick = pickSuggested<string>(f.documentDate, suggestions?.documentDate, "string");
    const documentDate = datePick.value;
    if (documentDate && !/^\d{4}-\d{2}-\d{2}$/.test(documentDate)) {
      errors.push(`Invalid documentDate: ${documentDate} (expected YYYY-MM-DD)`);
    }

    const vendorPick = pickSuggested<number>(f.vendorId, suggestions?.vendor, "number");
    const vendorId = vendorPick.value;

    if (!f.storageKey) errors.push("Missing storageKey — file must be uploaded first");
    if (!f.name) errors.push("Missing file name");
    if (!f.size) warnings.push("Missing file size");

    const ocr = job
      ? {
          status: job.status,
          suggestions: suggestions ?? null,
          attempts: job.attempts,
          lastError: job.lastError ?? null,
        }
      : opts.enqueueOcr
        ? { status: "queued" as const, suggestions: null, attempts: 0, lastError: null }
        : null;

    return {
      index,
      name: f.name,
      size: f.size,
      storageKey: f.storageKey,
      category,
      building,
      unit,
      documentDate,
      vendorId,
      source: defSource,
      isHistorical: defHistorical,
      notes: f.notes ?? null,
      warnings,
      errors,
      ocr,
    };
  });

  const validRowCount = rowsWithOcr.filter((r) => r.errors.length === 0).length;
  return { rows: rowsWithOcr, validRowCount, errorRowCount: rowsWithOcr.length - validRowCount };
}

router.get("/documents/import-batches", requireManager, async (_req, res) => {
  const rows = await db
    .select()
    .from(documentImportBatchesTable)
    .orderBy(desc(documentImportBatchesTable.createdAt))
    .limit(100);
  res.json(rows.map(toBatch));
});

router.get("/documents/import-batches/:id", requireManager, async (req, res) => {
  const [row] = await db
    .select()
    .from(documentImportBatchesTable)
    .where(eq(documentImportBatchesTable.id, req.params.id as string));
  if (!row) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  res.json(toBatch(row));
});

router.post("/documents/import-batches/preview", requireManager, async (req, res) => {
  const parsed = ImportBatchPreviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }
  const data = parsed.data as BatchPreviewInput;
  const orgOcrEnabled = await isOcrEnabledOrg();
  const ocrActive = orgOcrEnabled && data.skipOcr !== true;
  const preview = await buildPreview(data, {
    enqueueOcr: ocrActive,
    useSuggestions: ocrActive,
    userId: req.user?.id ?? null,
  });
  res.json({ ...preview, ocrEnabled: ocrActive });
});

router.post("/documents/import-batches/commit", requireManager, async (req, res) => {
  const parsed = ImportBatchCommitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }
  const data = parsed.data as BatchPreviewInput & { label?: string | null; notes?: string | null };
  const orgOcrEnabledCommit = await isOcrEnabledOrg();
  const ocrActiveCommit = orgOcrEnabledCommit && data.skipOcr !== true;
  const preview = await buildPreview(data, {
    enqueueOcr: false,
    useSuggestions: ocrActiveCommit,
  });
  if (preview.errorRowCount > 0) {
    res.status(400).json({
      error: "Cannot commit batch with validation errors",
      preview,
    });
    return;
  }
  if (preview.rows.length === 0) {
    res.status(400).json({ error: "No files in batch" });
    return;
  }

  const actor = req.user!;
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const batchId = `IB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [batch] = await db.transaction(async (tx) => {
    const [b] = await tx
      .insert(documentImportBatchesTable)
      .values({
        id: batchId,
        label: data.label ?? null,
        status: "committed",
        fileCount: preview.rows.length,
        defaultCategory: data.defaultCategory ?? null,
        defaultBuilding: data.defaultBuilding ?? null,
        defaultUnit: data.defaultUnit ?? null,
        defaultSource: preview.rows[0]?.source ?? "imported",
        defaultIsHistorical: preview.rows[0]?.isHistorical ?? true,
        createdBy: actor.id,
        createdByName: actor.name,
        createdAt: now,
        notes: data.notes ?? null,
      })
      .returning();

    // Copy any already-extracted OCR full text onto each document so it
    // shows up in document search. Late completions are back-filled by the
    // scheduler against `storage_key`.
    const ocrTextByKey = new Map<string, string>();
    if (preview.rows.length > 0) {
      const keys = preview.rows.map((r) => r.storageKey);
      const jobs = await tx
        .select({ storageKey: documentOcrJobsTable.storageKey, fullText: documentOcrJobsTable.fullText })
        .from(documentOcrJobsTable)
        .where(inArray(documentOcrJobsTable.storageKey, keys));
      for (const j of jobs) {
        if (j.fullText) ocrTextByKey.set(j.storageKey, j.fullText);
      }
    }

    for (const r of preview.rows) {
      const id = `D-${Date.now()}-${r.index}-${Math.random().toString(36).slice(2, 6)}`;
      await tx.insert(documentsTable).values({
        id,
        name: r.name,
        category: r.category,
        building: r.building ?? null,
        unit: r.unit ?? null,
        uploaded: today,
        size: r.size,
        uploadedBy: actor.name,
        storageKey: r.storageKey,
        driveFileId: null,
        documentDate: r.documentDate ?? null,
        isHistorical: r.isHistorical,
        source: r.source,
        importBatchId: b.id,
        notes: r.notes ?? null,
        vendorId: r.vendorId ?? null,
        // OCR may still be in-flight at commit time; the scheduler back-fills
        // `extractedText` and `vendorId` against `storage_key` when the job
        // completes (see ocrScheduler.processJob).
        extractedText: ocrTextByKey.get(r.storageKey) ?? null,
      });
    }
    return [b];
  });

  req.log.info(
    { batchId: batch.id, fileCount: batch.fileCount, actorId: actor.id },
    "Document import batch committed",
  );
  res.status(201).json(toBatch(batch));
});

router.post("/documents/import-batches/:id/undo", requireManager, async (req, res) => {
  const id = req.params.id as string;
  const [row] = await db
    .select()
    .from(documentImportBatchesTable)
    .where(eq(documentImportBatchesTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  if (row.status === "undone") {
    res.status(409).json({ error: "Batch already undone" });
    return;
  }
  if (!withinUndoWindow(row.createdAt)) {
    res.status(409).json({ error: "Undo window (24 hours) has expired" });
    return;
  }

  const actor = req.user!;
  const now = new Date().toISOString();

  // Best-effort: delete underlying objects, then DB rows, then mark batch undone.
  const docRows = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.importBatchId, id));

  for (const d of docRows) {
    if (d.storageKey) {
      try {
        const file = await storage.getObjectEntityFile(d.storageKey);
        await file.delete();
      } catch (err) {
        req.log.warn({ err, docId: d.id }, "Failed to delete object during batch undo");
      }
    }
    if (d.driveFileId) {
      try {
        await driveService.trashDocument(d.driveFileId);
      } catch (err) {
        req.log.warn({ err, docId: d.id }, "Failed to trash drive document during batch undo");
      }
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(documentsTable).where(eq(documentsTable.importBatchId, id));
    await tx
      .update(documentImportBatchesTable)
      .set({ status: "undone", undoneAt: now, undoneBy: actor.id, undoneByName: actor.name })
      .where(eq(documentImportBatchesTable.id, id));
  });

  const [updated] = await db
    .select()
    .from(documentImportBatchesTable)
    .where(eq(documentImportBatchesTable.id, id));
  req.log.info(
    { batchId: id, removed: docRows.length, actorId: actor.id },
    "Document import batch undone",
  );
  res.json(toBatch(updated));
});

export default router;
