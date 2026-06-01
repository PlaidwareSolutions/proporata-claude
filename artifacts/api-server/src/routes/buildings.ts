import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { buildingsTable, unitsTable, workOrdersTable, insurancePoliciesTable, documentsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { GetBuildingParams, CreateBuildingBody, UpdateBuildingBody } from "@workspace/api-zod";
import { driveService } from "../lib/driveService";

const router: IRouter = Router();

router.get("/buildings", async (_req, res) => {
  const rows = await db.select().from(buildingsTable).orderBy(buildingsTable.num);
  res.json(rows.map(toBuilding));
});

router.post("/buildings", async (req, res) => {
  const parsed = CreateBuildingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }
  const d = parsed.data;
  const [created] = await db
    .insert(buildingsTable)
    .values({
      num: d.num,
      x: d.x ?? 0,
      y: d.y ?? 0,
      w: d.w ?? 100,
      h: d.h ?? 100,
      status: d.status,
      openWO: d.openWO ?? 0,
      address: d.address,
      street: d.street,
      units: d.units,
      yearBuilt: d.yearBuilt,
      roofYear: d.roofYear,
      insuranceStatus: d.insuranceStatus,
      notes: d.notes ?? null,
    })
    .returning();
  res.status(201).json(toBuilding(created));
});

router.get("/buildings/:id", async (req, res) => {
  const parsed = GetBuildingParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid building id" });
    return;
  }
  const [row] = await db
    .select()
    .from(buildingsTable)
    .where(eq(buildingsTable.num, parsed.data.id));
  if (!row) {
    res.status(404).json({ error: "Building not found" });
    return;
  }
  res.json(toBuilding(row));
});

router.patch("/buildings/:id", async (req, res) => {
  const idParsed = GetBuildingParams.safeParse({ id: req.params.id });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid building id" });
    return;
  }
  const bodyParsed = UpdateBuildingBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request body", details: bodyParsed.error.issues });
    return;
  }
  const [existing] = await db
    .select()
    .from(buildingsTable)
    .where(eq(buildingsTable.num, idParsed.data.id));
  if (!existing) {
    res.status(404).json({ error: "Building not found" });
    return;
  }
  const b = bodyParsed.data;
  const updates: Partial<typeof buildingsTable.$inferInsert> = {};
  if (b.address !== undefined) updates.address = b.address;
  if (b.street !== undefined) updates.street = b.street;
  if (b.units !== undefined) updates.units = b.units;
  if (b.yearBuilt !== undefined) updates.yearBuilt = b.yearBuilt;
  if (b.roofYear !== undefined) updates.roofYear = b.roofYear;
  if (b.status !== undefined) updates.status = b.status;
  if (b.insuranceStatus !== undefined) updates.insuranceStatus = b.insuranceStatus;
  if (b.notes !== undefined) updates.notes = b.notes;
  if (b.openWO !== undefined) updates.openWO = b.openWO;
  if (b.x !== undefined) updates.x = b.x;
  if (b.y !== undefined) updates.y = b.y;
  if (b.w !== undefined) updates.w = b.w;
  if (b.h !== undefined) updates.h = b.h;

  const [updated] = await db
    .update(buildingsTable)
    .set(updates)
    .where(eq(buildingsTable.num, idParsed.data.id))
    .returning();

  if (b.address !== undefined && b.address !== existing.address && existing.driveFolderId) {
    try {
      await driveService.renameBuildingFolder(idParsed.data.id);
    } catch (err) {
      req.log.warn({ err }, "Google Drive building folder rename failed");
    }
  }

  res.json(toBuilding(updated));
});

router.delete("/buildings/:id", async (req, res) => {
  const parsed = GetBuildingParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid building id" });
    return;
  }
  const buildingNum = parsed.data.id;

  const [existing] = await db
    .select()
    .from(buildingsTable)
    .where(eq(buildingsTable.num, buildingNum));
  if (!existing) {
    res.status(404).json({ error: "Building not found" });
    return;
  }

  try {
    await db.transaction(async (tx) => {
      await tx.delete(workOrdersTable).where(eq(workOrdersTable.building, buildingNum));
      await tx.delete(insurancePoliciesTable).where(eq(insurancePoliciesTable.building, buildingNum));
      await tx
        .update(documentsTable)
        .set({ building: null })
        .where(eq(documentsTable.building, buildingNum));
      await tx.delete(unitsTable).where(eq(unitsTable.building, buildingNum));
      await tx.delete(buildingsTable).where(eq(buildingsTable.num, buildingNum));
    });
  } catch {
    res.status(409).json({ error: "Cannot delete building: dependent records exist that could not be removed." });
    return;
  }

  res.status(204).send();
});

function toBuilding(row: typeof buildingsTable.$inferSelect) {
  return {
    num: row.num,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    status: row.status,
    openWO: row.openWO,
    address: row.address,
    street: row.street,
    units: row.units,
    yearBuilt: row.yearBuilt,
    roofYear: row.roofYear,
    insuranceStatus: row.insuranceStatus,
    notes: row.notes ?? null,
  };
}

export default router;
