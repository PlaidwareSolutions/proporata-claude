// Task #75: Lifecycle items — reserve-driven recurring upkeep.

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { lifecycleItemsTable, type CalendarRecurrence } from "@workspace/db/schema";
import { asc, eq } from "drizzle-orm";
import { authenticateJwt, requireManager, requireNotResident } from "../middleware/auth.js";
import { materializeLifecycleItem, removeSourceEvent } from "../lib/calendarMaterialize.js";

const router: IRouter = Router();
function nowISO(): string { return new Date().toISOString(); }
const VALID_KINDS = new Set(["roof_inspection", "paint_cycle", "fence_repair", "parking_reseal", "drainage_cleanout", "equipment", "seasonal", "other"]);

function parseRec(raw: unknown): CalendarRecurrence | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.freq !== "DAILY" && r.freq !== "WEEKLY" && r.freq !== "MONTHLY" && r.freq !== "YEARLY") return null;
  const out: NonNullable<CalendarRecurrence> = { freq: r.freq };
  if (typeof r.interval === "number" && r.interval > 0) out.interval = Math.floor(r.interval);
  if (typeof r.until === "string") out.until = r.until;
  return out;
}

router.get("/lifecycle-items", authenticateJwt, requireNotResident, async (_req, res) => {
  const rows = await db.select().from(lifecycleItemsTable).orderBy(asc(lifecycleItemsTable.title));
  res.json(rows);
});

router.post("/lifecycle-items", authenticateJwt, requireManager, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "other";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || !VALID_KINDS.has(kind)) { res.status(400).json({ error: "title and valid kind required" }); return; }
  const checklist = Array.isArray(body.checklist)
    ? (body.checklist as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  const [row] = await db.insert(lifecycleItemsTable).values({
    kind, title,
    buildingNum: typeof body.buildingNum === "number" ? body.buildingNum : null,
    lastDoneOn: (body.lastDoneOn as string | null) ?? null,
    intervalMonths: typeof body.intervalMonths === "number" ? body.intervalMonths : 12,
    equipmentName: (body.equipmentName as string | null) ?? null,
    recurrence: parseRec(body.recurrence),
    checklist,
    notes: typeof body.notes === "string" ? body.notes : "",
    active: body.active !== false,
    createdAt: nowISO(),
  }).returning();
  await materializeLifecycleItem(row!);
  res.status(201).json(row);
});

router.patch("/lifecycle-items/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of ["kind", "title", "buildingNum", "lastDoneOn", "intervalMonths", "equipmentName", "checklist", "notes", "active"]) {
    if (k in body) patch[k] = body[k];
  }
  if ("recurrence" in body) patch.recurrence = parseRec(body.recurrence);
  if (patch.kind && !VALID_KINDS.has(patch.kind as string)) { res.status(400).json({ error: "invalid kind" }); return; }
  const [row] = await db.update(lifecycleItemsTable).set(patch).where(eq(lifecycleItemsTable.id, id)).returning();
  if (row) await materializeLifecycleItem(row);
  res.json(row);
});

router.delete("/lifecycle-items/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(lifecycleItemsTable).where(eq(lifecycleItemsTable.id, id));
  await removeSourceEvent("lifecycle_item", String(id));
  res.status(204).end();
});

export default router;
