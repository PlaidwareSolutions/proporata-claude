// Task #75: Vendor certificate (COI / W-9 / license) expirations.

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { vendorCertificatesTable, vendorsTable } from "@workspace/db/schema";
import { asc, eq } from "drizzle-orm";
import { authenticateJwt, requireManager, requireNotResident } from "../middleware/auth.js";
import { materializeVendorCertificate, removeVendorCertificate } from "../lib/calendarMaterialize.js";

const router: IRouter = Router();
function nowISO(): string { return new Date().toISOString(); }
const VALID_KINDS = new Set(["coi", "w9", "license"]);

async function vendorName(id: number): Promise<string> {
  const [v] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id));
  return v?.name ?? "Vendor";
}

router.get("/vendor-certificates", authenticateJwt, requireNotResident, async (_req, res) => {
  const rows = await db.select().from(vendorCertificatesTable).orderBy(asc(vendorCertificatesTable.expiresOn));
  res.json(rows);
});

router.post("/vendor-certificates", authenticateJwt, requireManager, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const vendorId = Number(body.vendorId);
  const kind = typeof body.kind === "string" ? body.kind : "";
  const expiresOn = typeof body.expiresOn === "string" ? body.expiresOn : "";
  if (!Number.isFinite(vendorId) || !VALID_KINDS.has(kind) || !expiresOn) {
    res.status(400).json({ error: "vendorId, valid kind, expiresOn required" }); return;
  }
  const [row] = await db.insert(vendorCertificatesTable).values({
    vendorId, kind, expiresOn,
    documentStorageKey: (body.documentStorageKey as string | null) ?? null,
    notes: typeof body.notes === "string" ? body.notes : "",
    createdAt: nowISO(),
  }).returning();
  await materializeVendorCertificate({ id: row!.id, vendorName: await vendorName(row!.vendorId), kind: row!.kind, expiresOn: row!.expiresOn });
  res.status(201).json(row);
});

router.patch("/vendor-certificates/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of ["kind", "expiresOn", "documentStorageKey", "notes"]) {
    if (k in body) patch[k] = body[k];
  }
  if (patch.kind && !VALID_KINDS.has(patch.kind as string)) { res.status(400).json({ error: "invalid kind" }); return; }
  const [row] = await db.update(vendorCertificatesTable).set(patch).where(eq(vendorCertificatesTable.id, id)).returning();
  if (row) await materializeVendorCertificate({ id: row.id, vendorName: await vendorName(row.vendorId), kind: row.kind, expiresOn: row.expiresOn });
  res.json(row);
});

router.delete("/vendor-certificates/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(vendorCertificatesTable).where(eq(vendorCertificatesTable.id, id));
  await removeVendorCertificate(id);
  res.status(204).end();
});

export default router;
