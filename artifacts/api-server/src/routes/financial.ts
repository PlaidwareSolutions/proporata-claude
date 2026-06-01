// Task #76: Financial calendar integrations.
//
// CRUD for assessment schedules, special assessments, budget cycles, reserve
// projects, and the org-wide collections policy. Each write materializes (or
// cancels) calendar events on the financial sub-calendar via the materializer.

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  assessmentSchedulesTable,
  specialAssessmentsTable,
  budgetCyclesTable,
  reserveProjectsTable,
  collectionsPoliciesTable,
} from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";
import { authenticateJwt, requireManager } from "../middleware/auth.js";
import {
  upsertEvent,
  cancelEventsForSource,
  syncMilestones,
} from "../lib/calendarMaterializer.js";

const router: IRouter = Router();

function nowISO() { return new Date().toISOString(); }

// ── Assessment schedules (recurring dues) ────────────────────────────────

router.get("/financial/assessment-schedules", authenticateJwt, async (_req, res) => {
  const rows = await db.select().from(assessmentSchedulesTable).orderBy(asc(assessmentSchedulesTable.startDate));
  res.json(rows);
});

async function materializeAssessmentSchedule(s: typeof assessmentSchedulesTable.$inferSelect) {
  // Materialize one calendar event with appropriate recurrence rule. The
  // recurrence column on calendar_events handles the expansion in queries.
  const freqMap: Record<string, "MONTHLY" | "YEARLY"> = {
    monthly: "MONTHLY", quarterly: "MONTHLY", semiannual: "MONTHLY",
    annual: "YEARLY",
  };
  const intervalMap: Record<string, number> = {
    monthly: 1, quarterly: 3, semiannual: 6, annual: 1,
  };
  // Compute the first instance date: replace day with dueDay for monthly-ish.
  const start = s.startDate;
  // We synthesize an ISO start at 09:00 local for visibility.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : start.slice(0, 10);
  const evId = await upsertEvent({
    subSlug: "financial",
    sourceRefType: "assessment_schedule",
    sourceRefId: String(s.id),
    title: `${s.name} due — $${(s.amountCents / 100).toFixed(2)}`,
    body: s.notes,
    startsAt: dateOnly,
    allDay: true,
    cancelled: !s.active,
    reminderLeadsMinutes: s.reminderLeadsMinutes ?? [10080, 1440],
  });
  if (evId && s.active) {
    // Best-effort: write recurrence rule directly; materializer doesn't yet
    // expose recurrence, so patch in-place.
    const { calendarEventsTable } = await import("@workspace/db/schema");
    await db.update(calendarEventsTable).set({
      recurrence: { freq: freqMap[s.frequency] ?? "MONTHLY", interval: intervalMap[s.frequency] ?? 1, until: s.endDate ?? undefined },
      updatedAt: nowISO(),
    }).where(eq(calendarEventsTable.id, evId));
    if (s.calendarEventId !== evId) {
      await db.update(assessmentSchedulesTable).set({ calendarEventId: evId, updatedAt: nowISO() }).where(eq(assessmentSchedulesTable.id, s.id));
    }
  }
}

router.post("/financial/assessment-schedules", authenticateJwt, requireManager, async (req, res) => {
  const b = req.body ?? {};
  if (typeof b.name !== "string" || typeof b.frequency !== "string" || typeof b.amountCents !== "number" || typeof b.startDate !== "string") {
    res.status(400).json({ error: "name, frequency, amountCents, startDate required" }); return;
  }
  const now = nowISO();
  const [row] = await db.insert(assessmentSchedulesTable).values({
    name: b.name, frequency: b.frequency, amountCents: b.amountCents,
    dueDay: typeof b.dueDay === "number" ? b.dueDay : 1,
    startDate: b.startDate, endDate: b.endDate ?? null,
    active: b.active !== false, reminderLeadsMinutes: Array.isArray(b.reminderLeadsMinutes) ? b.reminderLeadsMinutes : [10080, 1440],
    notes: typeof b.notes === "string" ? b.notes : "",
    createdAt: now, updatedAt: now,
  }).returning();
  await materializeAssessmentSchedule(row);
  res.status(201).json(row);
});

router.patch("/financial/assessment-schedules/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(assessmentSchedulesTable).where(eq(assessmentSchedulesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const b = req.body ?? {};
  const patch: Partial<typeof assessmentSchedulesTable.$inferInsert> = { updatedAt: nowISO() };
  for (const k of ["name", "frequency", "startDate", "endDate", "notes"] as const) {
    if (typeof b[k] === "string") (patch as any)[k] = b[k];
  }
  if (typeof b.amountCents === "number") patch.amountCents = b.amountCents;
  if (typeof b.dueDay === "number") patch.dueDay = b.dueDay;
  if (typeof b.active === "boolean") patch.active = b.active;
  if (Array.isArray(b.reminderLeadsMinutes)) patch.reminderLeadsMinutes = b.reminderLeadsMinutes;
  await db.update(assessmentSchedulesTable).set(patch).where(eq(assessmentSchedulesTable.id, id));
  const [row] = await db.select().from(assessmentSchedulesTable).where(eq(assessmentSchedulesTable.id, id));
  await materializeAssessmentSchedule(row);
  res.json(row);
});

router.delete("/financial/assessment-schedules/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await cancelEventsForSource("assessment_schedule", String(id));
  await db.delete(assessmentSchedulesTable).where(eq(assessmentSchedulesTable.id, id));
  res.status(204).end();
});

// ── Special assessments (one-time, milestone-driven) ─────────────────────

async function materializeSpecial(s: typeof specialAssessmentsTable.$inferSelect) {
  await syncMilestones(
    "financial",
    "special_assessment",
    String(s.id),
    [
      { slot: "notice", title: "Notice mailed", date: s.noticeDate, reminderLeadsMinutes: [10080] },
      { slot: "hearing", title: "Hearing", date: s.hearingDate, reminderLeadsMinutes: [10080, 1440], locationText: s.hearingLocation ?? null },
      { slot: "adoption", title: "Adoption", date: s.adoptionDate, reminderLeadsMinutes: [1440] },
      { slot: "billing", title: "Billing date", date: s.billingDate, reminderLeadsMinutes: [10080, 1440] },
      { slot: "due", title: "Payment due", date: s.dueDate, reminderLeadsMinutes: [10080, 1440] },
    ],
    `Special Assessment: ${s.title}`,
    `$${(s.amountCents / 100).toFixed(2)} — ${s.description}`,
  );
}

router.get("/financial/special-assessments", authenticateJwt, async (_req, res) => {
  res.json(await db.select().from(specialAssessmentsTable).orderBy(asc(specialAssessmentsTable.createdAt)));
});

router.post("/financial/special-assessments", authenticateJwt, requireManager, async (req, res) => {
  const b = req.body ?? {};
  if (typeof b.title !== "string" || typeof b.amountCents !== "number") {
    res.status(400).json({ error: "title, amountCents required" }); return;
  }
  const now = nowISO();
  const [row] = await db.insert(specialAssessmentsTable).values({
    title: b.title, description: b.description ?? "", amountCents: b.amountCents,
    status: typeof b.status === "string" ? b.status : "draft",
    noticeDate: b.noticeDate ?? null, hearingDate: b.hearingDate ?? null,
    hearingLocation: b.hearingLocation ?? null, adoptionDate: b.adoptionDate ?? null,
    billingDate: b.billingDate ?? null, dueDate: b.dueDate ?? null,
    motionId: typeof b.motionId === "number" ? b.motionId : null,
    notes: b.notes ?? "", createdByUserId: req.user!.id,
    createdAt: now, updatedAt: now,
  }).returning();
  await materializeSpecial(row);
  res.status(201).json(row);
});

router.patch("/financial/special-assessments/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body ?? {};
  const patch: Partial<typeof specialAssessmentsTable.$inferInsert> = { updatedAt: nowISO() };
  for (const k of ["title", "description", "status", "noticeDate", "hearingDate", "hearingLocation", "adoptionDate", "billingDate", "dueDate", "notes"] as const) {
    if (k in b) (patch as any)[k] = b[k];
  }
  if (typeof b.amountCents === "number") patch.amountCents = b.amountCents;
  if (typeof b.motionId === "number" || b.motionId === null) patch.motionId = b.motionId;
  await db.update(specialAssessmentsTable).set(patch).where(eq(specialAssessmentsTable.id, id));
  const [row] = await db.select().from(specialAssessmentsTable).where(eq(specialAssessmentsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await materializeSpecial(row);
  res.json(row);
});

router.delete("/financial/special-assessments/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await cancelEventsForSource("special_assessment", String(id));
  await db.delete(specialAssessmentsTable).where(eq(specialAssessmentsTable.id, id));
  res.status(204).end();
});

// ── Budget cycles ────────────────────────────────────────────────────────

async function materializeBudgetCycle(c: typeof budgetCyclesTable.$inferSelect) {
  await syncMilestones("financial", "budget_cycle", String(c.id), [
    { slot: "draft", title: "Draft due", date: c.draftDueDate, reminderLeadsMinutes: [10080, 1440] },
    { slot: "review", title: "Review meeting", date: c.reviewMeetingDate, reminderLeadsMinutes: [10080, 1440] },
    { slot: "ratify", title: "Ratification meeting", date: c.ratificationMeetingDate, reminderLeadsMinutes: [10080, 1440] },
    { slot: "publish", title: "Publication", date: c.publicationDate, reminderLeadsMinutes: [1440] },
    { slot: "reserve_study", title: "Reserve study refresh", date: c.reserveStudyRefreshDate, reminderLeadsMinutes: [43200, 10080] },
  ], `Budget FY${c.fiscalYear}`, c.notes);
}

router.get("/financial/budget-cycles", authenticateJwt, async (_req, res) => {
  res.json(await db.select().from(budgetCyclesTable).orderBy(asc(budgetCyclesTable.fiscalYear)));
});

router.post("/financial/budget-cycles", authenticateJwt, requireManager, async (req, res) => {
  const b = req.body ?? {};
  if (typeof b.fiscalYear !== "number") { res.status(400).json({ error: "fiscalYear required" }); return; }
  const now = nowISO();
  try {
    const [row] = await db.insert(budgetCyclesTable).values({
      fiscalYear: b.fiscalYear,
      draftDueDate: b.draftDueDate ?? null,
      reviewMeetingDate: b.reviewMeetingDate ?? null,
      ratificationMeetingDate: b.ratificationMeetingDate ?? null,
      publicationDate: b.publicationDate ?? null,
      reserveStudyRefreshDate: b.reserveStudyRefreshDate ?? null,
      notes: b.notes ?? "",
      createdAt: now, updatedAt: now,
    }).returning();
    await materializeBudgetCycle(row);
    res.status(201).json(row);
  } catch (err) {
    res.status(409).json({ error: "fiscalYear conflict or invalid" });
  }
});

router.patch("/financial/budget-cycles/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body ?? {};
  const patch: Partial<typeof budgetCyclesTable.$inferInsert> = { updatedAt: nowISO() };
  for (const k of ["draftDueDate", "reviewMeetingDate", "ratificationMeetingDate", "publicationDate", "reserveStudyRefreshDate", "notes"] as const) {
    if (k in b) (patch as any)[k] = b[k];
  }
  await db.update(budgetCyclesTable).set(patch).where(eq(budgetCyclesTable.id, id));
  const [row] = await db.select().from(budgetCyclesTable).where(eq(budgetCyclesTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await materializeBudgetCycle(row);
  res.json(row);
});

router.delete("/financial/budget-cycles/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await cancelEventsForSource("budget_cycle", String(id));
  await db.delete(budgetCyclesTable).where(eq(budgetCyclesTable.id, id));
  res.status(204).end();
});

// ── Reserve projects ─────────────────────────────────────────────────────

async function materializeReserveProject(p: typeof reserveProjectsTable.$inferSelect) {
  await syncMilestones("financial", "reserve_project", String(p.id), [
    { slot: "funding", title: "Funding date", date: p.fundingDate, reminderLeadsMinutes: [43200, 10080] },
    { slot: "bid_open", title: "Bid window opens", date: p.bidWindowStart, reminderLeadsMinutes: [10080, 1440] },
    { slot: "bid_close", title: "Bid window closes", date: p.bidWindowEnd, reminderLeadsMinutes: [10080, 1440] },
    { slot: "start", title: "Scheduled start", date: p.scheduledStart, reminderLeadsMinutes: [10080, 1440] },
    { slot: "end", title: "Scheduled end", date: p.scheduledEnd, reminderLeadsMinutes: [1440] },
  ], `Reserve project: ${p.name}`, p.notes);
}

router.get("/financial/reserve-projects", authenticateJwt, async (_req, res) => {
  res.json(await db.select().from(reserveProjectsTable).orderBy(asc(reserveProjectsTable.createdAt)));
});

router.post("/financial/reserve-projects", authenticateJwt, requireManager, async (req, res) => {
  const b = req.body ?? {};
  if (typeof b.name !== "string") { res.status(400).json({ error: "name required" }); return; }
  const now = nowISO();
  const [row] = await db.insert(reserveProjectsTable).values({
    name: b.name, category: b.category ?? "other",
    estimatedCostCents: typeof b.estimatedCostCents === "number" ? b.estimatedCostCents : 0,
    fundingDate: b.fundingDate ?? null, bidWindowStart: b.bidWindowStart ?? null,
    bidWindowEnd: b.bidWindowEnd ?? null, scheduledStart: b.scheduledStart ?? null,
    scheduledEnd: b.scheduledEnd ?? null, status: b.status ?? "planned",
    notes: b.notes ?? "", createdAt: now, updatedAt: now,
  }).returning();
  await materializeReserveProject(row);
  res.status(201).json(row);
});

router.patch("/financial/reserve-projects/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body ?? {};
  const patch: Partial<typeof reserveProjectsTable.$inferInsert> = { updatedAt: nowISO() };
  for (const k of ["name", "category", "fundingDate", "bidWindowStart", "bidWindowEnd", "scheduledStart", "scheduledEnd", "status", "notes"] as const) {
    if (k in b) (patch as any)[k] = b[k];
  }
  if (typeof b.estimatedCostCents === "number") patch.estimatedCostCents = b.estimatedCostCents;
  await db.update(reserveProjectsTable).set(patch).where(eq(reserveProjectsTable.id, id));
  const [row] = await db.select().from(reserveProjectsTable).where(eq(reserveProjectsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await materializeReserveProject(row);
  res.json(row);
});

router.delete("/financial/reserve-projects/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await cancelEventsForSource("reserve_project", String(id));
  await db.delete(reserveProjectsTable).where(eq(reserveProjectsTable.id, id));
  res.status(204).end();
});

// ── Collections policy (singleton) ───────────────────────────────────────

router.get("/financial/collections-policy", authenticateJwt, async (_req, res) => {
  let [row] = await db.select().from(collectionsPoliciesTable).where(eq(collectionsPoliciesTable.id, 1));
  if (!row) {
    [row] = await db.insert(collectionsPoliciesTable).values({ id: 1, updatedAt: nowISO() }).returning();
  }
  res.json(row);
});

router.put("/financial/collections-policy", authenticateJwt, requireManager, async (req, res) => {
  const b = req.body ?? {};
  const patch: Partial<typeof collectionsPoliciesTable.$inferInsert> = { id: 1, updatedAt: nowISO() };
  for (const k of ["reminderDays", "lateNoticeDays", "demandLetterDays", "lienDays", "attorneyDays"] as const) {
    if (typeof b[k] === "number") (patch as any)[k] = b[k];
  }
  if (typeof b.active === "boolean") patch.active = b.active;
  const [existing] = await db.select().from(collectionsPoliciesTable).where(eq(collectionsPoliciesTable.id, 1));
  if (existing) {
    await db.update(collectionsPoliciesTable).set(patch).where(eq(collectionsPoliciesTable.id, 1));
  } else {
    await db.insert(collectionsPoliciesTable).values(patch as any);
  }
  const [row] = await db.select().from(collectionsPoliciesTable).where(eq(collectionsPoliciesTable.id, 1));
  res.json(row);
});

export default router;
