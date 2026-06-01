// Task #75: Vendor recurring service contracts.

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { vendorContractsTable, vendorsTable, type CalendarRecurrence } from "@workspace/db/schema";
import { asc, eq } from "drizzle-orm";
import { authenticateJwt, requireManager, requireNotResident } from "../middleware/auth.js";
import { materializeVendorContract, removeSourceEvent } from "../lib/calendarMaterialize.js";

const router: IRouter = Router();
function nowISO(): string { return new Date().toISOString(); }
const VALID_TYPES = new Set(["landscaping", "pool", "pest", "trash", "gate", "fire", "other"]);

function parseRec(raw: unknown): CalendarRecurrence | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.freq !== "DAILY" && r.freq !== "WEEKLY" && r.freq !== "MONTHLY" && r.freq !== "YEARLY") return null;
  const out: NonNullable<CalendarRecurrence> = { freq: r.freq };
  if (typeof r.interval === "number" && r.interval > 0) out.interval = Math.floor(r.interval);
  if (Array.isArray(r.byday)) out.byday = r.byday.filter((d) => typeof d === "string");
  if (typeof r.until === "string") out.until = r.until;
  if (typeof r.count === "number" && r.count > 0) out.count = Math.floor(r.count);
  return out;
}

async function vendorName(id: number): Promise<string> {
  const [v] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id));
  return v?.name ?? "Vendor";
}

router.get("/vendor-contracts", authenticateJwt, requireNotResident, async (_req, res) => {
  const rows = await db.select().from(vendorContractsTable).orderBy(asc(vendorContractsTable.title));
  res.json(rows);
});

router.post("/vendor-contracts", authenticateJwt, requireManager, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const vendorId = Number(body.vendorId);
  const serviceType = typeof body.serviceType === "string" ? body.serviceType : "other";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const firstServiceOn = typeof body.firstServiceOn === "string" ? body.firstServiceOn : "";
  if (!Number.isFinite(vendorId) || !title || !firstServiceOn || !VALID_TYPES.has(serviceType)) {
    res.status(400).json({ error: "vendorId, title, firstServiceOn, valid serviceType required" }); return;
  }
  const [row] = await db.insert(vendorContractsTable).values({
    vendorId, serviceType, title,
    recurrence: parseRec(body.recurrence) ?? { freq: "WEEKLY" },
    firstServiceOn,
    durationMinutes: typeof body.durationMinutes === "number" ? body.durationMinutes : 60,
    active: body.active !== false,
    contractDocStorageKey: (body.contractDocStorageKey as string | null) ?? null,
    notes: typeof body.notes === "string" ? body.notes : "",
    createdAt: nowISO(),
  }).returning();
  await materializeVendorContract({ ...row!, vendorName: await vendorName(row!.vendorId) });
  res.status(201).json(row);
});

router.patch("/vendor-contracts/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of ["serviceType", "title", "firstServiceOn", "durationMinutes", "active", "contractDocStorageKey", "notes"]) {
    if (k in body) patch[k] = body[k];
  }
  if ("recurrence" in body) patch.recurrence = parseRec(body.recurrence);
  if (patch.serviceType && !VALID_TYPES.has(patch.serviceType as string)) { res.status(400).json({ error: "invalid serviceType" }); return; }
  const [row] = await db.update(vendorContractsTable).set(patch).where(eq(vendorContractsTable.id, id)).returning();
  if (row) await materializeVendorContract({ ...row, vendorName: await vendorName(row.vendorId) });
  res.json(row);
});

router.delete("/vendor-contracts/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(vendorContractsTable).where(eq(vendorContractsTable.id, id));
  await removeSourceEvent("vendor_contract", String(id));
  res.status(204).end();
});

export default router;
