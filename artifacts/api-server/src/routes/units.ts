import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { unitsTable, workOrdersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  ListUnitsQueryParams as ListUnitsParams,
  GetUnitParams,
  CreateUnitBody,
  UpdateUnitBody,
} from "@workspace/api-zod";
import { driveService } from "../lib/driveService";

const router: IRouter = Router();

router.get("/units", async (req, res) => {
  const parsed = ListUnitsParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }
  const rows = parsed.data.building
    ? await db.select().from(unitsTable).where(eq(unitsTable.building, parsed.data.building))
    : await db.select().from(unitsTable);
  res.json(rows.map(toUnit));
});

router.post("/units", async (req, res) => {
  const parsed = CreateUnitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }
  const d = parsed.data;
  const unitId = `${d.building}-${d.unit}`;
  const [created] = await db
    .insert(unitsTable)
    .values({
      id: unitId,
      building: d.building,
      unit: d.unit,
      address: d.address,
      beds: d.beds,
      baths: d.baths,
      sqft: d.sqft,
      occupancy: d.occupancy,
      ownerName: d.ownerName,
      ownerPhone: d.ownerPhone,
      ownerEmail: d.ownerEmail,
      tenantName: d.tenantName ?? null,
      tenantPhone: d.tenantPhone ?? null,
      tenantEmail: d.tenantEmail ?? null,
    })
    .returning();
  res.status(201).json(toUnit(created));
});

router.get("/units/:id", async (req, res) => {
  const parsed = GetUnitParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid unit id" });
    return;
  }
  const [row] = await db
    .select()
    .from(unitsTable)
    .where(eq(unitsTable.id, parsed.data.id));
  if (!row) {
    res.status(404).json({ error: "Unit not found" });
    return;
  }
  res.json(toUnit(row));
});

// Resident-readable read router for the user's own unit. Mounted in
// routes/index.ts before the manager-gated unitsRouter so that a resident
// can fetch the unit they belong to (e.g. for the sidebar user card).
// Returns a sanitized payload for residents — owner/tenant contact details
// are omitted. Managers fall through to the full unitsRouter handler above.
const unitsReadRouter: IRouter = Router();
unitsReadRouter.get("/units/:id", async (req, res, next) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const isManager = user.role === "admin" || user.role === "manager";
  if (isManager) {
    next();
    return;
  }
  const parsed = GetUnitParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid unit id" });
    return;
  }
  if (user.unitId !== parsed.data.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const [row] = await db
    .select()
    .from(unitsTable)
    .where(eq(unitsTable.id, parsed.data.id));
  if (!row) {
    res.status(404).json({ error: "Unit not found" });
    return;
  }
  res.json(toResidentUnit(row));
});

function toResidentUnit(row: typeof unitsTable.$inferSelect) {
  return {
    id: row.id,
    building: row.building,
    unit: row.unit,
    address: row.address,
    beds: row.beds,
    baths: row.baths,
    sqft: row.sqft,
    occupancy: row.occupancy,
  };
}

export { unitsReadRouter };

router.patch("/units/:id", async (req, res) => {
  const idParsed = GetUnitParams.safeParse({ id: req.params.id });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid unit id" });
    return;
  }
  const bodyParsed = UpdateUnitBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request body", details: bodyParsed.error.issues });
    return;
  }
  const [existing] = await db
    .select()
    .from(unitsTable)
    .where(eq(unitsTable.id, idParsed.data.id));
  if (!existing) {
    res.status(404).json({ error: "Unit not found" });
    return;
  }
  const u = bodyParsed.data;
  const updates: Partial<typeof unitsTable.$inferInsert> = {};
  if (u.address !== undefined) updates.address = u.address;
  if (u.beds !== undefined) updates.beds = u.beds;
  if (u.baths !== undefined) updates.baths = u.baths;
  if (u.sqft !== undefined) updates.sqft = u.sqft;
  if (u.occupancy !== undefined) updates.occupancy = u.occupancy;
  if (u.ownerName !== undefined) updates.ownerName = u.ownerName;
  if (u.ownerPhone !== undefined) updates.ownerPhone = u.ownerPhone;
  if (u.ownerEmail !== undefined) updates.ownerEmail = u.ownerEmail;
  if (u.tenantName !== undefined) updates.tenantName = u.tenantName;
  if (u.tenantPhone !== undefined) updates.tenantPhone = u.tenantPhone;
  if (u.tenantEmail !== undefined) updates.tenantEmail = u.tenantEmail;

  const [updated] = await db
    .update(unitsTable)
    .set(updates)
    .where(eq(unitsTable.id, idParsed.data.id))
    .returning();

  if (u.address !== undefined && u.address !== existing.address && existing.driveFolderId) {
    try {
      await driveService.renameUnitFolder(idParsed.data.id);
    } catch (err) {
      req.log.warn({ err }, "Google Drive unit folder rename failed");
    }
  }

  res.json(toUnit(updated));
});

router.delete("/units/:id", async (req, res) => {
  const parsed = GetUnitParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid unit id" });
    return;
  }
  const unitId = parsed.data.id;

  const [existing] = await db
    .select()
    .from(unitsTable)
    .where(eq(unitsTable.id, unitId));
  if (!existing) {
    res.status(404).json({ error: "Unit not found" });
    return;
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(workOrdersTable)
        .set({ unit: null })
        .where(eq(workOrdersTable.unit, unitId));
      await tx.delete(unitsTable).where(eq(unitsTable.id, unitId));
    });
  } catch {
    res.status(409).json({ error: "Cannot delete unit: dependent records exist that could not be removed." });
    return;
  }

  res.status(204).send();
});

function toUnit(row: typeof unitsTable.$inferSelect) {
  return {
    id: row.id,
    building: row.building,
    unit: row.unit,
    address: row.address,
    beds: row.beds,
    baths: row.baths,
    sqft: row.sqft,
    occupancy: row.occupancy,
    ownerName: row.ownerName,
    ownerPhone: row.ownerPhone,
    ownerEmail: row.ownerEmail,
    tenantName: row.tenantName,
    tenantPhone: row.tenantPhone,
    tenantEmail: row.tenantEmail,
  };
}

export default router;
