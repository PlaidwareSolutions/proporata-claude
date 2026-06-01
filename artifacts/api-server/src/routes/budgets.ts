// Task #159: Annual budget targets CRUD.
//
// Lets managers and board members set per-category annual budget amounts
// directly in the app instead of having to insert rows via SQL/seed. The
// Reports page reads from the same `budgetsTable` to show "Spend by
// category" vs budget, so edits here surface there immediately.

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { budgetsTable } from "@workspace/db/schema";
import { and, asc, eq } from "drizzle-orm";
import {
  authenticateJwt,
  requireManagerOrBoardMember,
} from "../middleware/auth.js";

const router: IRouter = Router();

function nowISO(): string {
  return new Date().toISOString();
}

function parseAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

function parseFiscalYear(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d{4}$/.test(value.trim())) return Number(value);
  return null;
}

// GET /budgets?fiscalYear=2026 — list per-category budget targets, optionally
// filtered by fiscal year (the common case for the Budgets admin screen).
// Reads are open to managers/admins AND board members (including resident
// board members), since the Budgets admin screen is a board governance tool.
router.get("/budgets", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const fyParam = req.query.fiscalYear;
  const fy = fyParam !== undefined ? parseFiscalYear(fyParam) : null;
  if (fyParam !== undefined && fy === null) {
    res.status(400).json({ error: "Invalid fiscalYear" });
    return;
  }
  const rows = fy !== null
    ? await db.select().from(budgetsTable).where(eq(budgetsTable.fiscalYear, fy)).orderBy(asc(budgetsTable.category))
    : await db.select().from(budgetsTable).orderBy(asc(budgetsTable.fiscalYear), asc(budgetsTable.category));
  res.json(rows);
});

router.post("/budgets", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const fiscalYear = parseFiscalYear(body.fiscalYear);
  const amount = parseAmount(body.amount);
  if (!category) {
    res.status(400).json({ error: "category is required" });
    return;
  }
  if (fiscalYear === null) {
    res.status(400).json({ error: "fiscalYear is required (4-digit year)" });
    return;
  }
  if (amount === null || amount < 0) {
    res.status(400).json({ error: "amount must be a non-negative whole number" });
    return;
  }

  // The (category, fiscalYear) pair is unique — surface a 409 instead of a
  // raw DB error so the UI can show a friendly conflict message.
  const [existing] = await db
    .select()
    .from(budgetsTable)
    .where(and(eq(budgetsTable.category, category), eq(budgetsTable.fiscalYear, fiscalYear)));
  if (existing) {
    res.status(409).json({ error: "A budget for that category and fiscal year already exists" });
    return;
  }

  const ts = nowISO();
  const [row] = await db
    .insert(budgetsTable)
    .values({
      category,
      fiscalYear,
      amount,
      notes: typeof body.notes === "string" ? body.notes : null,
      createdAt: ts,
      updatedAt: ts,
    })
    .returning();
  res.status(201).json(row);
});

router.put("/budgets/:id", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db.select().from(budgetsTable).where(eq(budgetsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (typeof body.category === "string") {
    const c = body.category.trim();
    if (!c) {
      res.status(400).json({ error: "category cannot be blank" });
      return;
    }
    patch.category = c;
  }
  if (body.fiscalYear !== undefined) {
    const fy = parseFiscalYear(body.fiscalYear);
    if (fy === null) {
      res.status(400).json({ error: "Invalid fiscalYear" });
      return;
    }
    patch.fiscalYear = fy;
  }
  if (body.amount !== undefined) {
    const amt = parseAmount(body.amount);
    if (amt === null || amt < 0) {
      res.status(400).json({ error: "amount must be a non-negative whole number" });
      return;
    }
    patch.amount = amt;
  }
  if ("notes" in body) {
    patch.notes = typeof body.notes === "string" ? body.notes : null;
  }
  if (Object.keys(patch).length === 0) {
    res.json(existing);
    return;
  }

  // Guard the unique (category, fiscalYear) constraint when either is changing.
  const nextCategory = (patch.category as string | undefined) ?? existing.category;
  const nextFy = (patch.fiscalYear as number | undefined) ?? existing.fiscalYear;
  if (nextCategory !== existing.category || nextFy !== existing.fiscalYear) {
    const [conflict] = await db
      .select()
      .from(budgetsTable)
      .where(and(eq(budgetsTable.category, nextCategory), eq(budgetsTable.fiscalYear, nextFy)));
    if (conflict && conflict.id !== id) {
      res.status(409).json({ error: "A budget for that category and fiscal year already exists" });
      return;
    }
  }

  patch.updatedAt = nowISO();
  const [row] = await db.update(budgetsTable).set(patch).where(eq(budgetsTable.id, id)).returning();
  res.json(row);
});

router.delete("/budgets/:id", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(budgetsTable).where(eq(budgetsTable.id, id));
  res.status(204).end();
});

export default router;
