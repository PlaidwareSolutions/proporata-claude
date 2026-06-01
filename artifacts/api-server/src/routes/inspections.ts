// Task #75: Inspections + permit/easement deadlines.

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { inspectionsTable, usersTable } from "@workspace/db/schema";
import { asc, eq } from "drizzle-orm";
import { authenticateJwt, requireManager, requireNotResident } from "../middleware/auth.js";
import { materializeInspection, removeSourceEvent } from "../lib/calendarMaterialize.js";

const router: IRouter = Router();
function nowISO(): string { return new Date().toISOString(); }
const VALID_KINDS = new Set(["annual_walkthrough", "acc_sweep", "insurance", "reserve_study", "permit", "easement", "other"]);

router.get("/inspections", authenticateJwt, requireNotResident, async (_req, res) => {
  const rows = await db.select().from(inspectionsTable).orderBy(asc(inspectionsTable.scheduledOn));
  res.json(rows);
});

router.post("/inspections", authenticateJwt, requireManager, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "other";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const scheduledOn = typeof body.scheduledOn === "string" ? body.scheduledOn : "";
  if (!title || !scheduledOn || !VALID_KINDS.has(kind)) {
    res.status(400).json({ error: "title, scheduledOn, valid kind required" }); return;
  }
  let assigneeName: string | null = (body.assigneeName as string | null) ?? null;
  if (typeof body.assigneeUserId === "number" && !assigneeName) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, body.assigneeUserId));
    assigneeName = u ? (u.name || u.email) : null;
  }
  const [row] = await db.insert(inspectionsTable).values({
    kind, title, scheduledOn,
    durationMinutes: typeof body.durationMinutes === "number" ? body.durationMinutes : 120,
    assigneeUserId: typeof body.assigneeUserId === "number" ? body.assigneeUserId : null,
    assigneeName,
    buildingNum: typeof body.buildingNum === "number" ? body.buildingNum : null,
    vendorId: typeof body.vendorId === "number" ? body.vendorId : null,
    agency: (body.agency as string | null) ?? null,
    status: "scheduled",
    notes: typeof body.notes === "string" ? body.notes : "",
    createdAt: nowISO(),
  }).returning();
  await materializeInspection(row!);
  res.status(201).json(row);
});

router.patch("/inspections/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of ["kind", "title", "scheduledOn", "durationMinutes", "assigneeUserId", "assigneeName", "buildingNum", "vendorId", "agency", "status", "notes"]) {
    if (k in body) patch[k] = body[k];
  }
  if (patch.kind && !VALID_KINDS.has(patch.kind as string)) {
    res.status(400).json({ error: "invalid kind" }); return;
  }
  const [row] = await db.update(inspectionsTable).set(patch).where(eq(inspectionsTable.id, id)).returning();
  if (row) await materializeInspection(row);
  res.json(row);
});

router.delete("/inspections/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(inspectionsTable).where(eq(inspectionsTable.id, id));
  await removeSourceEvent("inspection", String(id));
  res.status(204).end();
});

export default router;
