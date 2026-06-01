// Task #76: Compliance calendar integrations.
//
// CRUD for compliance items (tax/audit/insurance/regulatory deadlines),
// violations (with stage-driven cure deadlines), and hearings. Each write
// materializes/cancels events on the compliance sub-calendar. Violation
// stage events are owner-scoped so they appear in the homeowner timeline.

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  complianceItemsTable,
  violationsTable,
  hearingsTable,
  unitsTable,
} from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";
import { authenticateJwt, requireManager, requireNotResident } from "../middleware/auth.js";
import {
  upsertEvent,
  cancelEventsForSource,
  syncMilestones,
} from "../lib/calendarMaterializer.js";

const router: IRouter = Router();

function nowISO() { return new Date().toISOString(); }

// ── Compliance items (tax / audit / insurance / regulatory) ──────────────

async function materializeComplianceItem(c: typeof complianceItemsTable.$inferSelect) {
  await upsertEvent({
    subSlug: "compliance",
    sourceRefType: "compliance_item",
    sourceRefId: String(c.id),
    title: `[${c.kind}] ${c.title}`,
    body: c.description,
    startsAt: c.dueDate,
    allDay: /^\d{4}-\d{2}-\d{2}$/.test(c.dueDate),
    cancelled: c.status === "done",
    reminderLeadsMinutes: c.reminderLeadsMinutes ?? [43200, 10080, 1440],
  });
}

router.get("/compliance/items", authenticateJwt, requireNotResident, async (_req, res) => {
  res.json(await db.select().from(complianceItemsTable).orderBy(asc(complianceItemsTable.dueDate)));
});

router.post("/compliance/items", authenticateJwt, requireManager, async (req, res) => {
  const b = req.body ?? {};
  if (typeof b.kind !== "string" || typeof b.title !== "string" || typeof b.dueDate !== "string") {
    res.status(400).json({ error: "kind, title, dueDate required" }); return;
  }
  const now = nowISO();
  const [row] = await db.insert(complianceItemsTable).values({
    kind: b.kind, title: b.title, description: b.description ?? "",
    dueDate: b.dueDate, recurrence: b.recurrence ?? null,
    status: b.status ?? "open",
    ownerUserId: typeof b.ownerUserId === "number" ? b.ownerUserId : null,
    reminderLeadsMinutes: Array.isArray(b.reminderLeadsMinutes) ? b.reminderLeadsMinutes : [43200, 10080, 1440],
    notes: b.notes ?? "",
    createdAt: now, updatedAt: now,
  }).returning();
  await materializeComplianceItem(row);
  res.status(201).json(row);
});

router.patch("/compliance/items/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body ?? {};
  const patch: Partial<typeof complianceItemsTable.$inferInsert> = { updatedAt: nowISO() };
  for (const k of ["kind", "title", "description", "dueDate", "status", "notes"] as const) {
    if (typeof b[k] === "string") (patch as any)[k] = b[k];
  }
  if (Array.isArray(b.reminderLeadsMinutes)) patch.reminderLeadsMinutes = b.reminderLeadsMinutes;
  if ("recurrence" in b) patch.recurrence = b.recurrence ?? null;
  if (b.status === "done") patch.completedAt = nowISO();
  await db.update(complianceItemsTable).set(patch).where(eq(complianceItemsTable.id, id));
  const [row] = await db.select().from(complianceItemsTable).where(eq(complianceItemsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await materializeComplianceItem(row);
  res.json(row);
});

router.delete("/compliance/items/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await cancelEventsForSource("compliance_item", String(id));
  await db.delete(complianceItemsTable).where(eq(complianceItemsTable.id, id));
  res.status(204).end();
});

// ── Violations ───────────────────────────────────────────────────────────

async function materializeViolation(v: typeof violationsTable.$inferSelect) {
  // Stage milestones: cure deadline, second notice, hearing, resolution.
  // Owner-scoped so they only appear on that owner's private timeline.
  await syncMilestones(
    "compliance",
    "violation",
    String(v.id),
    [
      { slot: "first_notice", title: "First notice", date: v.firstNoticeDate, reminderLeadsMinutes: [1440] },
      { slot: "cure_deadline", title: "Cure deadline", date: v.cureDeadline, reminderLeadsMinutes: [10080, 1440] },
      { slot: "second_notice", title: "Second notice", date: v.secondNoticeDate, reminderLeadsMinutes: [1440] },
      { slot: "hearing", title: "Hearing", date: v.hearingDate, reminderLeadsMinutes: [10080, 1440] },
    ],
    `Violation: ${v.category}`,
    v.description,
    v.ownerUserId ?? null,
  );
}

router.get("/compliance/violations", authenticateJwt, async (req, res) => {
  // Residents only see their own.
  if (req.user!.role === "resident") {
    res.json(await db.select().from(violationsTable).where(eq(violationsTable.ownerUserId, req.user!.id)).orderBy(asc(violationsTable.observedAt)));
    return;
  }
  res.json(await db.select().from(violationsTable).orderBy(asc(violationsTable.observedAt)));
});

router.post("/compliance/violations", authenticateJwt, requireManager, async (req, res) => {
  const b = req.body ?? {};
  if (typeof b.unitId !== "string" || typeof b.category !== "string" || typeof b.description !== "string" || typeof b.observedAt !== "string") {
    res.status(400).json({ error: "unitId, category, description, observedAt required" }); return;
  }
  const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, b.unitId));
  if (!unit) { res.status(404).json({ error: "Unit not found" }); return; }
  const now = nowISO();
  const [row] = await db.insert(violationsTable).values({
    unitId: b.unitId, ownerUserId: typeof b.ownerUserId === "number" ? b.ownerUserId : null,
    ownerName: b.ownerName ?? unit.ownerName,
    category: b.category, description: b.description,
    status: b.status ?? "open", observedAt: b.observedAt,
    firstNoticeDate: b.firstNoticeDate ?? null,
    cureDeadline: b.cureDeadline ?? null,
    secondNoticeDate: b.secondNoticeDate ?? null,
    hearingDate: b.hearingDate ?? null,
    fineCents: typeof b.fineCents === "number" ? b.fineCents : 0,
    createdByUserId: req.user!.id,
    createdAt: now, updatedAt: now,
  }).returning();
  await materializeViolation(row);
  res.status(201).json(row);
});

router.patch("/compliance/violations/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body ?? {};
  const patch: Partial<typeof violationsTable.$inferInsert> = { updatedAt: nowISO() };
  for (const k of ["category", "description", "status", "firstNoticeDate", "cureDeadline", "secondNoticeDate", "hearingDate", "resolvedAt"] as const) {
    if (k in b) (patch as any)[k] = b[k];
  }
  if (typeof b.fineCents === "number") patch.fineCents = b.fineCents;
  if (b.status === "resolved" || b.status === "dismissed") patch.resolvedAt = patch.resolvedAt ?? nowISO();
  await db.update(violationsTable).set(patch).where(eq(violationsTable.id, id));
  const [row] = await db.select().from(violationsTable).where(eq(violationsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.status === "resolved" || row.status === "dismissed") {
    await cancelEventsForSource("violation", String(row.id));
  } else {
    await materializeViolation(row);
  }
  res.json(row);
});

router.delete("/compliance/violations/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await cancelEventsForSource("violation", String(id));
  await db.delete(violationsTable).where(eq(violationsTable.id, id));
  res.status(204).end();
});

// ── Hearings ─────────────────────────────────────────────────────────────

async function materializeHearing(h: typeof hearingsTable.$inferSelect) {
  await upsertEvent({
    subSlug: h.kind === "violation" ? "compliance" : "board",
    sourceRefType: "hearing",
    sourceRefId: String(h.id),
    title: `Hearing: ${h.title}`,
    body: h.outcome ? `Outcome: ${h.outcome}` : "",
    startsAt: h.scheduledAt,
    locationText: h.locationText ?? null,
    locationUrl: h.locationUrl ?? null,
    cancelled: h.status === "cancelled",
    reminderLeadsMinutes: [10080, 1440, 60],
  });
}

router.get("/compliance/hearings", authenticateJwt, requireNotResident, async (_req, res) => {
  res.json(await db.select().from(hearingsTable).orderBy(asc(hearingsTable.scheduledAt)));
});

router.post("/compliance/hearings", authenticateJwt, requireManager, async (req, res) => {
  const b = req.body ?? {};
  if (typeof b.kind !== "string" || typeof b.title !== "string" || typeof b.scheduledAt !== "string") {
    res.status(400).json({ error: "kind, title, scheduledAt required" }); return;
  }
  const now = nowISO();
  const [row] = await db.insert(hearingsTable).values({
    kind: b.kind, refType: b.refType ?? null, refId: typeof b.refId === "number" ? b.refId : null,
    title: b.title, scheduledAt: b.scheduledAt,
    locationText: b.locationText ?? null, locationUrl: b.locationUrl ?? null,
    noticeDate: b.noticeDate ?? null, status: b.status ?? "scheduled",
    outcome: b.outcome ?? null, createdByUserId: req.user!.id,
    createdAt: now, updatedAt: now,
  }).returning();
  await materializeHearing(row);
  res.status(201).json(row);
});

router.patch("/compliance/hearings/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body ?? {};
  const patch: Partial<typeof hearingsTable.$inferInsert> = { updatedAt: nowISO() };
  for (const k of ["title", "scheduledAt", "locationText", "locationUrl", "noticeDate", "status", "outcome"] as const) {
    if (k in b) (patch as any)[k] = b[k];
  }
  await db.update(hearingsTable).set(patch).where(eq(hearingsTable.id, id));
  const [row] = await db.select().from(hearingsTable).where(eq(hearingsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await materializeHearing(row);
  res.json(row);
});

router.delete("/compliance/hearings/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await cancelEventsForSource("hearing", String(id));
  await db.delete(hearingsTable).where(eq(hearingsTable.id, id));
  res.status(204).end();
});

export default router;
