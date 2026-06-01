import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  buildingSystemsTable,
  buildingSystemDocumentsTable,
  buildingSystemInspectionsTable,
  buildingSystemRepairsTable,
  workOrdersTable,
  documentsTable,
  type BuildingSystemKind,
  type BuildingSystemStatus,
} from "@workspace/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  ListBuildingSystemsQueryParams,
  GetBuildingSystemParams,
  CreateBuildingSystemBody,
  UpdateBuildingSystemBody,
  CreateBuildingSystemInspectionBody,
  LinkBuildingSystemDocumentBody,
  LinkBuildingSystemRepairBody,
} from "@workspace/api-zod";
import { deriveBuildingSystemStatus } from "../lib/buildingSystemStatus.js";
import { buildingAccessFor, canSeeBuilding } from "../lib/buildingAccess.js";
import type { Request, Response } from "express";

export const buildingSystemsReadRouter: IRouter = Router();
const router: IRouter = Router();

// Resolve the system row's building and 403 when the caller can't see it.
// Returns the system row when access is granted, otherwise responds and
// returns null for the caller to early-return.
async function authzSystem(req: Request, res: Response, systemId: number) {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return null; }
  const [row] = (await db.select().from(buildingSystemsTable).where(eq(buildingSystemsTable.id, systemId))) as SystemRow[];
  if (!row) { res.status(404).json({ error: "Building system not found" }); return null; }
  const access = await buildingAccessFor(req.user);
  if (!canSeeBuilding(access, row.building)) { res.status(403).json({ error: "Forbidden" }); return null; }
  return row;
}

const VALID_KINDS: readonly BuildingSystemKind[] = [
  "roof", "hvac", "plumbing", "electrical", "foundation",
  "exterior", "fire_safety", "elevator", "other",
] as const;

interface SystemRow {
  id: number;
  building: number;
  kind: BuildingSystemKind;
  label: string;
  installedOn: string | null;
  warrantyExpiresOn: string | null;
  manufacturer: string | null;
  model: string | null;
  serialNo: string | null;
  status: BuildingSystemStatus;
  retiredOn: string | null;
  notes: string | null;
  createdAt: string;
}

async function lastInspectedFor(systemIds: number[]): Promise<Map<number, string>> {
  if (systemIds.length === 0) return new Map();
  const rows = await db
    .select({
      systemId: buildingSystemInspectionsTable.systemId,
      inspectedOn: buildingSystemInspectionsTable.inspectedOn,
    })
    .from(buildingSystemInspectionsTable)
    .where(inArray(buildingSystemInspectionsTable.systemId, systemIds))
    .orderBy(desc(buildingSystemInspectionsTable.inspectedOn));
  const out = new Map<number, string>();
  for (const r of rows) if (!out.has(r.systemId)) out.set(r.systemId, r.inspectedOn);
  return out;
}

function toBuildingSystem(row: SystemRow, lastInspectedOn: string | null) {
  const derived = deriveBuildingSystemStatus({
    warrantyExpiresOn: row.warrantyExpiresOn,
    retiredOn: row.retiredOn,
    lastInspectedOn,
  });
  return {
    id: row.id,
    building: row.building,
    kind: row.kind,
    label: row.label,
    installedOn: row.installedOn,
    warrantyExpiresOn: row.warrantyExpiresOn,
    manufacturer: row.manufacturer,
    model: row.model,
    serialNo: row.serialNo,
    status: row.status,
    derivedStatus: derived,
    retiredOn: row.retiredOn,
    notes: row.notes,
    lastInspectedOn,
    createdAt: row.createdAt,
  };
}

buildingSystemsReadRouter.get("/building-systems", async (req, res) => {
  const parsed = ListBuildingSystemsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const access = await buildingAccessFor(req.user);
  if (parsed.data.building != null && !canSeeBuilding(access, parsed.data.building)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  let q = db.select().from(buildingSystemsTable).$dynamic();
  if (parsed.data.building != null) {
    q = q.where(eq(buildingSystemsTable.building, parsed.data.building));
  } else if (access.buildingIds === null) {
    // unrestricted
  } else if (access.buildingIds.length === 0) {
    res.json([]);
    return;
  } else {
    q = q.where(inArray(buildingSystemsTable.building, access.buildingIds));
  }
  const rows = (await q.orderBy(buildingSystemsTable.building, buildingSystemsTable.kind)) as SystemRow[];
  const insp = await lastInspectedFor(rows.map((r) => r.id));
  res.json(rows.map((r) => toBuildingSystem(r, insp.get(r.id) ?? null)));
});

buildingSystemsReadRouter.get("/building-systems/:id", async (req, res) => {
  const parsed = GetBuildingSystemParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid system id" });
    return;
  }
  const row = await authzSystem(req, res, parsed.data.id);
  if (!row) return;
  const insp = await lastInspectedFor([row.id]);
  res.json(toBuildingSystem(row, insp.get(row.id) ?? null));
});

router.post("/building-systems", async (req, res) => {
  const parsed = CreateBuildingSystemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }
  const kind = parsed.data.kind as BuildingSystemKind;
  if (!VALID_KINDS.includes(kind)) {
    res.status(400).json({ error: "Invalid kind" });
    return;
  }
  const [row] = (await db
    .insert(buildingSystemsTable)
    .values({
      building: parsed.data.building,
      kind,
      label: parsed.data.label,
      installedOn: parsed.data.installedOn ?? null,
      warrantyExpiresOn: parsed.data.warrantyExpiresOn ?? null,
      manufacturer: parsed.data.manufacturer ?? null,
      model: parsed.data.model ?? null,
      serialNo: parsed.data.serialNo ?? null,
      status: "good",
      notes: parsed.data.notes ?? null,
      createdAt: new Date().toISOString(),
    })
    .returning()) as SystemRow[];
  res.status(201).json(toBuildingSystem(row, null));
});

router.patch("/building-systems/:id", async (req, res) => {
  const idParsed = GetBuildingSystemParams.safeParse({ id: req.params.id });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid system id" });
    return;
  }
  const bodyParsed = UpdateBuildingSystemBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request body", details: bodyParsed.error.issues });
    return;
  }
  const updates: Partial<typeof buildingSystemsTable.$inferInsert> = {};
  const b = bodyParsed.data;
  if (b.label !== undefined) updates.label = b.label;
  if (b.installedOn !== undefined) updates.installedOn = b.installedOn;
  if (b.warrantyExpiresOn !== undefined) updates.warrantyExpiresOn = b.warrantyExpiresOn;
  if (b.manufacturer !== undefined) updates.manufacturer = b.manufacturer;
  if (b.model !== undefined) updates.model = b.model;
  if (b.serialNo !== undefined) updates.serialNo = b.serialNo;
  if (b.retiredOn !== undefined) updates.retiredOn = b.retiredOn;
  if (b.notes !== undefined) updates.notes = b.notes;
  if (b.status !== undefined) updates.status = b.status as BuildingSystemStatus;

  const [updated] = (await db
    .update(buildingSystemsTable)
    .set(updates)
    .where(eq(buildingSystemsTable.id, idParsed.data.id))
    .returning()) as SystemRow[];
  if (!updated) {
    res.status(404).json({ error: "Building system not found" });
    return;
  }
  const insp = await lastInspectedFor([updated.id]);
  res.json(toBuildingSystem(updated, insp.get(updated.id) ?? null));
});

router.delete("/building-systems/:id", async (req, res) => {
  const parsed = GetBuildingSystemParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid system id" });
    return;
  }
  const result = await db
    .delete(buildingSystemsTable)
    .where(eq(buildingSystemsTable.id, parsed.data.id))
    .returning({ id: buildingSystemsTable.id });
  if (result.length === 0) {
    res.status(404).json({ error: "Building system not found" });
    return;
  }
  res.status(204).send();
});

// Manager-only: inspection log entries are an internal archive.
router.get("/building-systems/:id/inspections", async (req, res) => {
  const parsed = GetBuildingSystemParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid system id" });
    return;
  }
  const rows = await db
    .select()
    .from(buildingSystemInspectionsTable)
    .where(eq(buildingSystemInspectionsTable.systemId, parsed.data.id))
    .orderBy(desc(buildingSystemInspectionsTable.inspectedOn));
  res.json(rows.map((r) => ({
    id: r.id,
    systemId: r.systemId,
    inspectedOn: r.inspectedOn,
    inspector: r.inspector,
    summary: r.summary,
    documentId: r.documentId,
    createdAt: r.createdAt,
  })));
});

router.post("/building-systems/:id/inspections", async (req, res) => {
  const idParsed = GetBuildingSystemParams.safeParse({ id: req.params.id });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid system id" });
    return;
  }
  const bodyParsed = CreateBuildingSystemInspectionBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request body", details: bodyParsed.error.issues });
    return;
  }
  const [system] = await db
    .select()
    .from(buildingSystemsTable)
    .where(eq(buildingSystemsTable.id, idParsed.data.id));
  if (!system) {
    res.status(404).json({ error: "Building system not found" });
    return;
  }
  const [row] = await db
    .insert(buildingSystemInspectionsTable)
    .values({
      systemId: idParsed.data.id,
      inspectedOn: bodyParsed.data.inspectedOn,
      inspector: bodyParsed.data.inspector ?? null,
      summary: bodyParsed.data.summary ?? null,
      documentId: bodyParsed.data.documentId ?? null,
      createdAt: new Date().toISOString(),
    })
    .returning();
  res.status(201).json({
    id: row.id,
    systemId: row.systemId,
    inspectedOn: row.inspectedOn,
    inspector: row.inspector,
    summary: row.summary,
    documentId: row.documentId,
    createdAt: row.createdAt,
  });
});

// Manager-only: linked install/warranty/inspection docs.
router.get("/building-systems/:id/documents", async (req, res) => {
  const parsed = GetBuildingSystemParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid system id" });
    return;
  }
  const links = await db
    .select()
    .from(buildingSystemDocumentsTable)
    .where(eq(buildingSystemDocumentsTable.systemId, parsed.data.id));
  if (links.length === 0) {
    res.json([]);
    return;
  }
  const docIds = links.map((l) => l.documentId);
  const docs = await db
    .select()
    .from(documentsTable)
    .where(inArray(documentsTable.id, docIds));
  const docMap = new Map(docs.map((d) => [d.id, d]));
  res.json(
    links
      .map((l) => {
        const d = docMap.get(l.documentId);
        if (!d) return null;
        return {
          linkId: l.id,
          systemId: l.systemId,
          kind: l.kind,
          documentId: d.id,
          name: d.name,
          category: d.category,
          uploaded: d.uploaded,
        };
      })
      .filter((x) => x !== null),
  );
});

router.post("/building-systems/:id/documents", async (req, res) => {
  const idParsed = GetBuildingSystemParams.safeParse({ id: req.params.id });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid system id" });
    return;
  }
  const bodyParsed = LinkBuildingSystemDocumentBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request body", details: bodyParsed.error.issues });
    return;
  }
  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.id, bodyParsed.data.documentId));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const [row] = await db
    .insert(buildingSystemDocumentsTable)
    .values({
      systemId: idParsed.data.id,
      documentId: bodyParsed.data.documentId,
      kind: bodyParsed.data.kind ?? "other",
      createdAt: new Date().toISOString(),
    })
    .returning();
  res.status(201).json({
    linkId: row.id,
    systemId: row.systemId,
    documentId: row.documentId,
    kind: row.kind,
  });
});

// Manager-only: linked repair work orders.
router.get("/building-systems/:id/repairs", async (req, res) => {
  const parsed = GetBuildingSystemParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid system id" });
    return;
  }
  const links = await db
    .select()
    .from(buildingSystemRepairsTable)
    .where(eq(buildingSystemRepairsTable.systemId, parsed.data.id));
  if (links.length === 0) {
    res.json([]);
    return;
  }
  const woIds = links.map((l) => l.workOrderId);
  const wos = await db
    .select()
    .from(workOrdersTable)
    .where(inArray(workOrdersTable.id, woIds));
  const woMap = new Map(wos.map((w) => [w.id, w]));
  res.json(
    links
      .map((l) => {
        const w = woMap.get(l.workOrderId);
        if (!w) return null;
        return {
          linkId: l.id,
          systemId: l.systemId,
          workOrderId: w.id,
          title: w.title,
          status: w.status,
          opened: w.opened,
          completedOn: w.completedOn ?? null,
          actualCost: w.actualCost ?? null,
          historical: w.historical,
        };
      })
      .filter((x) => x !== null),
  );
});

router.post("/building-systems/:id/repairs", async (req, res) => {
  const idParsed = GetBuildingSystemParams.safeParse({ id: req.params.id });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid system id" });
    return;
  }
  const bodyParsed = LinkBuildingSystemRepairBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request body", details: bodyParsed.error.issues });
    return;
  }
  const [wo] = await db
    .select()
    .from(workOrdersTable)
    .where(eq(workOrdersTable.id, bodyParsed.data.workOrderId));
  if (!wo) {
    res.status(404).json({ error: "Work order not found" });
    return;
  }
  // Pre-check the unique (systemId, workOrderId) link before inserting so we
  // don't catch unrelated DB errors. Race condition between this select and
  // insert is handled by re-throwing any insert error other than 23505.
  const [existing] = await db
    .select({ id: buildingSystemRepairsTable.id })
    .from(buildingSystemRepairsTable)
    .where(and(
      eq(buildingSystemRepairsTable.systemId, idParsed.data.id),
      eq(buildingSystemRepairsTable.workOrderId, bodyParsed.data.workOrderId),
    ));
  if (existing) {
    res.status(409).json({ error: "Work order already linked to this system" });
    return;
  }
  try {
    const [row] = await db
      .insert(buildingSystemRepairsTable)
      .values({
        systemId: idParsed.data.id,
        workOrderId: bodyParsed.data.workOrderId,
        createdAt: new Date().toISOString(),
      })
      .returning();
    res.status(201).json({
      linkId: row.id,
      systemId: row.systemId,
      workOrderId: row.workOrderId,
    });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "23505") {
      res.status(409).json({ error: "Work order already linked to this system" });
      return;
    }
    throw e;
  }
});

export default router;
