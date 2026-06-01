// Task #75: Election cycles — milestone-only model.

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { electionCyclesTable } from "@workspace/db/schema";
import { asc, eq } from "drizzle-orm";
import { authenticateJwt, requireManager } from "../middleware/auth.js";
import { materializeElectionCycle, removeElectionCycle } from "../lib/calendarMaterialize.js";

const router: IRouter = Router();
function nowISO(): string { return new Date().toISOString(); }

router.get("/election-cycles", authenticateJwt, async (_req, res) => {
  const rows = await db.select().from(electionCyclesTable).orderBy(asc(electionCyclesTable.year));
  res.json(rows);
});

router.post("/election-cycles", authenticateJwt, requireManager, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const year = Number(body.year);
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!Number.isFinite(year) || !label) { res.status(400).json({ error: "year and label required" }); return; }
  const [row] = await db.insert(electionCyclesTable).values({
    year, label,
    nominationsOpenOn: (body.nominationsOpenOn as string | null) ?? null,
    nominationsCloseOn: (body.nominationsCloseOn as string | null) ?? null,
    ballotMailingOn: (body.ballotMailingOn as string | null) ?? null,
    electionDayOn: (body.electionDayOn as string | null) ?? null,
    notes: typeof body.notes === "string" ? body.notes : "",
    createdAt: nowISO(),
  }).returning();
  await materializeElectionCycle(row!);
  res.status(201).json(row);
});

router.patch("/election-cycles/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of ["year", "label", "nominationsOpenOn", "nominationsCloseOn", "ballotMailingOn", "electionDayOn", "notes"]) {
    if (k in body) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) {
    const [row] = await db.select().from(electionCyclesTable).where(eq(electionCyclesTable.id, id));
    res.json(row); return;
  }
  const [row] = await db.update(electionCyclesTable).set(patch).where(eq(electionCyclesTable.id, id)).returning();
  if (row) await materializeElectionCycle(row);
  res.json(row);
});

router.delete("/election-cycles/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(electionCyclesTable).where(eq(electionCyclesTable.id, id));
  await removeElectionCycle(id);
  res.status(204).end();
});

export default router;
