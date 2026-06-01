import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  ownerAccountsTable,
  ledgerEntriesTable,
  unitsTable,
  usersTable,
  buildingsTable,
  organizationSettingsTable,
  paymentAttemptsTable,
} from "@workspace/db/schema";
import { eq, and, inArray, desc, asc, isNull } from "drizzle-orm";
import {
  PostLedgerEntryBody,
  UpdateLedgerEntryBody,
  BatchPostChargeBody,
  GetMyAccountStatementQueryParams,
} from "@workspace/api-zod";
import { requireManager } from "../middleware/auth.js";
import { serializeOwnerAttempts } from "./payments.js";
import {
  validateMotionAuthorizes,
  findUnconsumedBypassFor,
  findPendingMotionFor,
  gateRequiredError,
  markBypassConsumed,
} from "../lib/motionGates.js";
import { upsertEvent } from "../lib/calendarMaterializer.js";

// Task #76: Materialize an owner-private payment-due event for special
// assessment charges so it appears on the homeowner's private timeline.
async function materializeOwnerCharge(unitId: string, entry: typeof ledgerEntriesTable.$inferSelect) {
  if (entry.chargeType !== "special_assessment") return;
  try {
    const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, unitId));
    if (!unit) return;
    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.unitId, unitId));
    if (!user) return;
    await upsertEvent({
      subSlug: "financial",
      sourceRefType: "ledger_entry",
      sourceRefId: String(entry.id),
      title: `Special assessment due — $${(entry.amountCents / 100).toFixed(2)}`,
      body: entry.memo ?? "",
      startsAt: entry.occurredOn,
      allDay: true,
      ownerUserId: user.id,
      reminderLeadsMinutes: [10080, 1440],
    });
  } catch {
    // Best-effort; never fail the billing transaction on calendar issues.
  }
}

const router: IRouter = Router();

const VOID_WINDOW_DAYS = 30;

type EntryRow = typeof ledgerEntriesTable.$inferSelect;

function signedAmount(e: EntryRow): number {
  // Originals always contribute; the matching void/refund row negates them.
  if (e.kind === "charge") return e.amountCents;
  if (e.kind === "payment") return -e.amountCents;
  if (e.kind === "void" || e.kind === "refund") return -e.amountCents;
  return 0;
}

function deriveBalance(entries: EntryRow[]): number {
  return entries.reduce((s, e) => s + signedAmount(e), 0);
}

function unitOccupancyAllowsOwner(occ: string): boolean {
  return occ === "owner";
}

function deriveStatus(balance: number, entries: EntryRow[]): "current" | "past_due" | "credit" {
  if (balance < 0) return "credit";
  if (balance === 0) return "current";

  // FIFO-apply payments/credits against outstanding charges; past_due if any
  // unpaid charge is older than 30 days.
  type Charge = { occurredOn: string; remaining: number };
  const openCharges: Charge[] = [];
  let credit = 0; // unallocated credit pool (overpayments)

  function applyCredit(amount: number) {
    let remaining = amount;
    for (const c of openCharges) {
      if (remaining <= 0) break;
      if (c.remaining <= 0) continue;
      const take = Math.min(c.remaining, remaining);
      c.remaining -= take;
      remaining -= take;
    }
    credit += remaining;
  }

  function consumeCredit(amount: number): number {
    const take = Math.min(credit, amount);
    credit -= take;
    return amount - take;
  }

  for (const e of entries) {
    if (e.kind === "charge") {
      const after = consumeCredit(e.amountCents);
      if (after > 0) openCharges.push({ occurredOn: e.occurredOn, remaining: after });
    } else if (e.kind === "payment") {
      applyCredit(e.amountCents);
    } else if (e.kind === "void" || e.kind === "refund") {
      const reversal = -e.amountCents;
      if (reversal < 0) applyCredit(-reversal);
      else openCharges.push({ occurredOn: e.occurredOn, remaining: reversal });
    }
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const hasAgedUnpaid = openCharges.some((c) => c.remaining > 0 && c.occurredOn <= cutoffIso);
  return hasAgedUnpaid ? "past_due" : "current";
}

async function ensureOwnerAccount(unitId: string): Promise<typeof ownerAccountsTable.$inferSelect> {
  const [existing] = await db
    .select()
    .from(ownerAccountsTable)
    .where(eq(ownerAccountsTable.unitId, unitId));
  if (existing) return existing;
  const [created] = await db
    .insert(ownerAccountsTable)
    .values({
      unitId,
      openingBalance: 0,
      createdAt: new Date().toISOString(),
    })
    .returning();
  return created;
}

function entryToJson(e: EntryRow, postedByName: string | null, runningBalanceCents?: number) {
  return {
    id: e.id,
    ownerAccountId: e.ownerAccountId,
    occurredOn: e.occurredOn,
    postedAt: e.postedAt,
    kind: e.kind,
    chargeType: e.chargeType ?? null,
    paymentMethod: e.paymentMethod ?? null,
    stripePaymentIntentId: e.stripePaymentIntentId ?? null,
    stripeChargeId: e.stripeChargeId ?? null,
    stripeStatus: e.stripeStatus ?? null,
    amountCents: e.amountCents,
    memo: e.memo ?? null,
    postedBy: e.postedBy,
    postedByName,
    voidedAt: e.voidedAt ?? null,
    voidedBy: e.voidedBy ?? null,
    voidsEntryId: e.voidsEntryId ?? null,
    batchRef: e.batchRef ?? null,
    runningBalanceCents: runningBalanceCents ?? 0,
    sourceMotionId: e.sourceMotionId ?? null,
    emergencyBypassId: e.emergencyBypassId ?? null,
  };
}

async function loadEntriesWithNames(ownerAccountId: number): Promise<{ rows: EntryRow[]; names: Map<number, string> }> {
  const rows = await db
    .select()
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.ownerAccountId, ownerAccountId))
    .orderBy(asc(ledgerEntriesTable.occurredOn), asc(ledgerEntriesTable.id));
  const ids = Array.from(new Set(rows.map((r) => r.postedBy)));
  const names = new Map<number, string>();
  if (ids.length > 0) {
    const users = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(inArray(usersTable.id, ids));
    for (const u of users) names.set(u.id, u.name || u.email);
  }
  return { rows, names };
}

function buildEntriesJson(rows: EntryRow[], names: Map<number, string>) {
  let running = 0;
  return rows.map((e) => {
    running += signedAmount(e);
    return entryToJson(e, names.get(e.postedBy) ?? null, running);
  });
}

router.get("/billing/accounts", requireManager, async (_req, res) => {
  const units = await db.select().from(unitsTable).orderBy(unitsTable.id);
  const accounts = await db.select().from(ownerAccountsTable);
  const accountByUnit = new Map(accounts.map((a) => [a.unitId, a]));

  // Make sure all units have an account row.
  const missing = units.filter((u) => !accountByUnit.has(u.id));
  if (missing.length > 0) {
    const now = new Date().toISOString();
    const inserted = await db
      .insert(ownerAccountsTable)
      .values(missing.map((u) => ({ unitId: u.id, openingBalance: 0, createdAt: now })))
      .returning();
    for (const a of inserted) accountByUnit.set(a.unitId, a);
  }

  const allEntries = await db.select().from(ledgerEntriesTable);
  const entriesByAccount = new Map<number, EntryRow[]>();
  for (const e of allEntries) {
    const list = entriesByAccount.get(e.ownerAccountId) ?? [];
    list.push(e);
    entriesByAccount.set(e.ownerAccountId, list);
  }

  const summaries = units.map((u) => {
    const acct = accountByUnit.get(u.id)!;
    const entries = (entriesByAccount.get(acct.id) ?? []).sort((a, b) =>
      a.occurredOn === b.occurredOn ? a.id - b.id : a.occurredOn.localeCompare(b.occurredOn),
    );
    const balance = deriveBalance(entries);
    const status = deriveStatus(balance, entries);
    const lastEntry = entries[entries.length - 1];
    const lastPaymentEntry = [...entries].reverse().find((e) => e.kind === "payment" && !e.voidedAt);
    return {
      unitId: u.id,
      unitLabel: u.unit,
      building: u.building,
      address: u.address,
      ownerName: u.ownerName,
      occupancy: u.occupancy,
      balanceCents: balance,
      status,
      lastActivity: lastEntry?.occurredOn ?? null,
      lastPayment: lastPaymentEntry?.occurredOn ?? null,
    };
  });

  res.json(summaries);
});

router.get("/billing/accounts/:unitId", requireManager, async (req, res) => {
  const unitId = String(req.params.unitId);
  const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, unitId));
  if (!unit) {
    res.status(404).json({ error: "Unit not found" });
    return;
  }
  const acct = await ensureOwnerAccount(unitId);
  const { rows, names } = await loadEntriesWithNames(acct.id);
  const balance = deriveBalance(rows);
  const status = deriveStatus(balance, rows);
  const lastPaymentEntry = [...rows].reverse().find((e) => e.kind === "payment" && !e.voidedAt);

  res.json({
    unitId: unit.id,
    unitLabel: unit.unit,
    building: unit.building,
    address: unit.address,
    ownerName: unit.ownerName,
    occupancy: unit.occupancy,
    balanceCents: balance,
    status,
    lastPayment: lastPaymentEntry?.occurredOn ?? null,
    entries: buildEntriesJson(rows, names),
  });
});

router.post("/billing/accounts/:unitId/entries", requireManager, async (req, res) => {
  const parsed = PostLedgerEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const body = parsed.data;
  if (body.amountCents <= 0) {
    res.status(400).json({ error: "amountCents must be a positive integer" });
    return;
  }
  if (body.kind === "charge" && !body.chargeType) {
    res.status(400).json({ error: "chargeType is required for charges" });
    return;
  }
  if (body.kind === "payment" && !body.paymentMethod) {
    res.status(400).json({ error: "paymentMethod is required for payments" });
    return;
  }

  // Task #64: special_assessment charges are gated behind an Adopted
  // policy_change motion (or admin emergency bypass). The motion's payload
  // must reference both amount and date so a single Adopted motion cannot be
  // reused for unrelated assessments.
  let assessmentMotionId: number | null = null;
  let assessmentBypassId: number | null = null;
  if (body.kind === "charge" && body.chargeType === "special_assessment") {
    const targetId = `unit:${req.params.unitId}:${body.occurredOn}:${body.amountCents}`;
    const motionIdRaw = (req.body as { motionId?: number | null }).motionId;
    const bypassIdRaw = (req.body as { bypassId?: number | null }).bypassId;
    if (typeof bypassIdRaw === "number") {
      const bp = await findUnconsumedBypassFor("special_assessment", targetId, bypassIdRaw);
      if (!bp) { res.status(409).json({ error: "motion_required", reason: "Bypass not found or already consumed" }); return; }
      assessmentBypassId = bp.id;
    } else if (typeof motionIdRaw === "number") {
      const v = await validateMotionAuthorizes({
        motionId: motionIdRaw, expectedKind: "policy_change",
        targetType: "special_assessment", targetId,
      });
      if (!v.ok) { res.status(409).json({ error: "motion_required", reason: v.reason }); return; }
      assessmentMotionId = v.motionId;
    } else {
      res.status(409).json(gateRequiredError({
        reason: "Special assessments require an Adopted policy_change motion before posting.",
        targetType: "special_assessment", targetId, motionKind: "policy_change",
        pendingMotionId: await findPendingMotionFor("special_assessment", targetId),
      }).body);
      return;
    }
  }

  const unitId = String(req.params.unitId);
  const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, unitId));
  if (!unit) {
    res.status(404).json({ error: "Unit not found" });
    return;
  }
  const acct = await ensureOwnerAccount(unitId);

  const [entry] = await db
    .insert(ledgerEntriesTable)
    .values({
      ownerAccountId: acct.id,
      occurredOn: body.occurredOn,
      postedAt: new Date().toISOString(),
      kind: body.kind,
      chargeType: body.kind === "charge" ? body.chargeType! : null,
      paymentMethod: body.kind === "payment" ? body.paymentMethod! : null,
      amountCents: body.amountCents,
      memo: body.memo ?? null,
      postedBy: req.user!.id,
      sourceMotionId: assessmentMotionId,
      emergencyBypassId: assessmentBypassId,
    })
    .returning();

  if (assessmentBypassId) await markBypassConsumed(assessmentBypassId);

  await materializeOwnerCharge(unitId, entry);

  res.status(201).json(entryToJson(entry, req.user!.name || req.user!.email, 0));
});

router.post("/billing/batch-post", requireManager, async (req, res) => {
  const parsed = BatchPostChargeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const body = parsed.data;
  if (body.amountCents <= 0) {
    res.status(400).json({ error: "amountCents must be a positive integer" });
    return;
  }

  // Task #64: gate batch special assessments behind an Adopted policy_change
  // motion. The targetId hashes amount+date+memo so the motion authorizes a
  // single, specific assessment rather than any future batch.
  let batchMotionId: number | null = null;
  let batchBypassId: number | null = null;
  if (body.chargeType === "special_assessment") {
    const targetId = `batch:${body.occurredOn}:${body.amountCents}:${(body.memo ?? "").slice(0, 80)}`;
    const motionIdRaw = (req.body as { motionId?: number | null }).motionId;
    const bypassIdRaw = (req.body as { bypassId?: number | null }).bypassId;
    if (typeof bypassIdRaw === "number") {
      const bp = await findUnconsumedBypassFor("special_assessment", targetId, bypassIdRaw);
      if (!bp) { res.status(409).json({ error: "motion_required", reason: "Bypass not found or already consumed" }); return; }
      batchBypassId = bp.id;
    } else if (typeof motionIdRaw === "number") {
      const v = await validateMotionAuthorizes({
        motionId: motionIdRaw, expectedKind: "policy_change",
        targetType: "special_assessment", targetId,
      });
      if (!v.ok) { res.status(409).json({ error: "motion_required", reason: v.reason }); return; }
      batchMotionId = v.motionId;
    } else {
      res.status(409).json(gateRequiredError({
        reason: "Special assessments require an Adopted policy_change motion before posting.",
        targetType: "special_assessment", targetId, motionKind: "policy_change",
        pendingMotionId: await findPendingMotionFor("special_assessment", targetId),
      }).body);
      return;
    }
  }

  const rawUnitIds = body.unitIds;
  let unitIds: string[] = Array.isArray(rawUnitIds)
    ? rawUnitIds
    : typeof rawUnitIds === "string"
    ? [rawUnitIds]
    : [];
  if (unitIds.length === 0) {
    const allUnits = await db.select({ id: unitsTable.id }).from(unitsTable);
    unitIds = allUnits.map((u) => u.id);
  }

  // Make sure accounts exist
  for (const uid of unitIds) await ensureOwnerAccount(uid);
  const accounts = await db
    .select()
    .from(ownerAccountsTable)
    .where(inArray(ownerAccountsTable.unitId, unitIds));
  const acctByUnit = new Map(accounts.map((a) => [a.unitId, a]));

  const batchRef = `B-${Date.now()}`;
  const now = new Date().toISOString();
  const values = unitIds
    .map((uid) => acctByUnit.get(uid))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map((a) => ({
      ownerAccountId: a.id,
      occurredOn: body.occurredOn,
      postedAt: now,
      kind: "charge" as const,
      chargeType: body.chargeType,
      paymentMethod: null,
      amountCents: body.amountCents,
      memo: body.memo ?? null,
      postedBy: req.user!.id,
      batchRef,
      sourceMotionId: batchMotionId,
      emergencyBypassId: batchBypassId,
    }));

  let inserted: typeof ledgerEntriesTable.$inferSelect[] = [];
  if (values.length > 0) {
    inserted = await db.insert(ledgerEntriesTable).values(values).returning();
  }

  if (batchBypassId) await markBypassConsumed(batchBypassId);

  // Task #76: per-owner private events for batch special assessments.
  if (body.chargeType === "special_assessment") {
    const acctById = new Map(accounts.map((a) => [a.id, a] as const));
    for (const e of inserted) {
      const acct = acctById.get(e.ownerAccountId);
      if (acct) await materializeOwnerCharge(acct.unitId, e);
    }
  }

  res.status(201).json({ batchRef, count: values.length });
});

router.patch("/billing/entries/:id", requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateLedgerEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const [existing] = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }
  const ageDays = (Date.now() - new Date(existing.postedAt).getTime()) / 86400000;
  if (ageDays > VOID_WINDOW_DAYS) {
    res.status(400).json({ error: "Entry is older than 30 days; memo cannot be edited" });
    return;
  }
  if (existing.voidedAt) {
    res.status(400).json({ error: "Voided entries cannot be edited" });
    return;
  }
  const [updated] = await db
    .update(ledgerEntriesTable)
    .set({ memo: parsed.data.memo ?? null })
    .where(eq(ledgerEntriesTable.id, id))
    .returning();

  const [postedByUser] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, updated.postedBy));

  res.json(entryToJson(updated, postedByUser ? postedByUser.name || postedByUser.email : null, 0));
});

router.post("/billing/entries/:id/void", requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }
  if (existing.kind === "void") {
    res.status(400).json({ error: "Cannot void a void entry" });
    return;
  }
  if (existing.voidedAt) {
    res.status(400).json({ error: "Entry is already voided" });
    return;
  }
  const ageDays = (Date.now() - new Date(existing.postedAt).getTime()) / 86400000;
  if (ageDays > VOID_WINDOW_DAYS) {
    res.status(400).json({ error: "Entry is older than 30 days; cannot be voided" });
    return;
  }

  const now = new Date().toISOString();
  await db
    .update(ledgerEntriesTable)
    .set({ voidedAt: now, voidedBy: req.user!.id })
    .where(eq(ledgerEntriesTable.id, id));

  // Insert reversing void entry
  await db.insert(ledgerEntriesTable).values({
    ownerAccountId: existing.ownerAccountId,
    occurredOn: now.slice(0, 10),
    postedAt: now,
    kind: "void",
    chargeType: existing.chargeType,
    paymentMethod: existing.paymentMethod,
    amountCents: existing.kind === "charge" ? existing.amountCents : -existing.amountCents,
    memo: `Void of entry #${existing.id}${existing.memo ? ` — ${existing.memo}` : ""}`,
    postedBy: req.user!.id,
    voidsEntryId: existing.id,
  });

  const [updated] = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, id));
  res.json(entryToJson(updated, req.user!.name || req.user!.email, 0));
});

// --- Owner-side endpoints ---

async function resolveOwnerUnitOrFail(
  req: import("express").Request,
  res: import("express").Response,
): Promise<typeof unitsTable.$inferSelect | null> {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (!req.user.unitId) {
    res.status(403).json({ error: "No unit assigned" });
    return null;
  }
  const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, req.user.unitId));
  if (!unit) {
    res.status(403).json({ error: "Unit not found" });
    return null;
  }
  if (!unitOccupancyAllowsOwner(unit.occupancy)) {
    res.status(403).json({ error: "Only the unit owner can view the account ledger" });
    return null;
  }
  return unit;
}

router.get("/me/account", async (req, res) => {
  const unit = await resolveOwnerUnitOrFail(req, res);
  if (!unit) return;
  const acct = await ensureOwnerAccount(unit.id);
  const { rows, names } = await loadEntriesWithNames(acct.id);
  const balance = deriveBalance(rows);
  const status = deriveStatus(balance, rows);
  const lastPaymentEntry = [...rows].reverse().find((e) => e.kind === "payment" && !e.voidedAt);
  const recentAttempts = await db
    .select()
    .from(paymentAttemptsTable)
    .where(eq(paymentAttemptsTable.ownerAccountId, acct.id))
    .orderBy(desc(paymentAttemptsTable.createdAt))
    .limit(20);
  // Show in-flight (pending/processing) and recent failures so owners can see
  // ACH transfers awaiting settlement and any declined cards needing retry.
  // Older "failed" attempts are hidden after 30 days to avoid clutter.
  const FAIL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  const failCutoff = Date.now() - FAIL_WINDOW_MS;
  const visibleRows = recentAttempts.filter((a) => {
    if (a.status === "pending" || a.status === "processing") return true;
    if (a.status === "failed") {
      const ts = Date.parse(a.updatedAt);
      return Number.isFinite(ts) && ts >= failCutoff;
    }
    return false;
  });
  const visiblePending = await serializeOwnerAttempts(visibleRows);
  res.json({
    unitId: unit.id,
    unitLabel: unit.unit,
    building: unit.building,
    address: unit.address,
    ownerName: unit.ownerName,
    occupancy: unit.occupancy,
    balanceCents: balance,
    status,
    lastPayment: lastPaymentEntry?.occurredOn ?? null,
    entries: buildEntriesJson(rows, names),
    pendingAttempts: visiblePending,
  });
});

router.get("/me/account/statement", async (req, res) => {
  const parsed = GetMyAccountStatementQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid period" });
    return;
  }
  const period = parsed.data.period;
  if (!/^\d{4}-\d{2}$/.test(period)) {
    res.status(400).json({ error: "period must be YYYY-MM" });
    return;
  }
  const unit = await resolveOwnerUnitOrFail(req, res);
  if (!unit) return;
  const acct = await ensureOwnerAccount(unit.id);
  const { rows, names } = await loadEntriesWithNames(acct.id);

  const periodStart = `${period}-01`;
  const [yy, mm] = period.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(yy, mm, 1));
  const periodEndExclusive = nextMonth.toISOString().slice(0, 10);

  let running = 0;
  let opening = 0;
  const inPeriod: Array<{ entry: EntryRow; running: number }> = [];
  for (const e of rows) {
    if (e.occurredOn < periodStart) {
      running += signedAmount(e);
      opening = running;
    } else if (e.occurredOn < periodEndExclusive) {
      running += signedAmount(e);
      inPeriod.push({ entry: e, running });
    } else {
      break;
    }
  }
  const closing = inPeriod.length > 0 ? inPeriod[inPeriod.length - 1].running : opening;

  const [building] = await db.select().from(buildingsTable).where(eq(buildingsTable.num, unit.building));
  const [orgRow] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  const orgName = orgRow?.name || "Quail Valley HOA";
  const orgAddr = orgRow?.address || "";

  const pdf = buildStatementPdf({
    orgName,
    orgAddr,
    period,
    unitAddress: unit.address,
    ownerName: unit.ownerName,
    openingCents: opening,
    closingCents: closing,
    entries: inPeriod.map(({ entry, running }) => ({
      occurredOn: entry.occurredOn,
      description: describeEntry(entry, names),
      chargeCents: entry.kind === "charge" && !entry.voidedAt ? entry.amountCents : entry.kind === "void" && entry.amountCents > 0 ? entry.amountCents : 0,
      paymentCents: entry.kind === "payment" && !entry.voidedAt ? entry.amountCents : entry.kind === "void" && entry.amountCents < 0 ? -entry.amountCents : 0,
      runningCents: running,
    })),
  });

  res
    .status(200)
    .set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="statement-${unit.id}-${period}.pdf"`,
      "Content-Length": String(pdf.length),
    })
    .send(pdf);
});

function describeEntry(e: EntryRow, names: Map<number, string>): string {
  if (e.voidedAt) return `(VOIDED) ${kindLabel(e)}`;
  if (e.kind === "void") {
    return `Void of entry #${e.voidsEntryId ?? ""}${e.memo ? ` — ${e.memo}` : ""}`;
  }
  const base = kindLabel(e);
  return e.memo ? `${base} — ${e.memo}` : base;
}

function kindLabel(e: EntryRow): string {
  if (e.kind === "charge") {
    const m: Record<string, string> = {
      monthly_assessment: "Monthly Assessment",
      late_fee: "Late Fee",
      special_assessment: "Special Assessment",
      fine: "Fine",
      other: "Charge",
    };
    return m[e.chargeType ?? "other"] ?? "Charge";
  }
  if (e.kind === "payment") {
    const m: Record<string, string> = {
      check: "Payment — Check",
      ach_manual: "Payment — ACH",
      cash: "Payment — Cash",
      online: "Payment — Online",
      other: "Payment",
    };
    return m[e.paymentMethod ?? "other"] ?? "Payment";
  }
  return "Void";
}

function fmtUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const c = (abs % 100).toString().padStart(2, "0");
  return `${sign}$${dollars.toLocaleString("en-US")}.${c}`;
}

function escPdf(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildStatementPdf(input: {
  orgName: string;
  orgAddr: string;
  period: string;
  unitAddress: string;
  ownerName: string;
  openingCents: number;
  closingCents: number;
  entries: Array<{
    occurredOn: string;
    description: string;
    chargeCents: number;
    paymentCents: number;
    runningCents: number;
  }>;
}): Buffer {
  const lines: string[] = [];
  lines.push("BT");
  lines.push("/F1 18 Tf");
  lines.push("72 750 Td");
  lines.push(`(${escPdf(input.orgName)}) Tj`);
  lines.push("/F1 9 Tf");
  if (input.orgAddr) {
    lines.push("0 -14 Td");
    lines.push(`(${escPdf(input.orgAddr)}) Tj`);
  }
  lines.push("/F1 13 Tf");
  lines.push("0 -28 Td");
  lines.push(`(Account Statement — ${escPdf(input.period)}) Tj`);
  lines.push("/F1 10 Tf");
  lines.push("0 -18 Td");
  lines.push(`(Owner: ${escPdf(input.ownerName)}) Tj`);
  lines.push("0 -13 Td");
  lines.push(`(Unit: ${escPdf(input.unitAddress)}) Tj`);
  lines.push("0 -22 Td");
  lines.push(`(Opening Balance: ${escPdf(fmtUsd(input.openingCents))}) Tj`);
  lines.push("0 -20 Td");
  lines.push("/F1 9 Tf");
  lines.push(`(Date         Description                                                Charge      Payment     Balance) Tj`);
  lines.push("0 -6 Td");
  lines.push("(_______________________________________________________________________________________________) Tj");
  for (const e of input.entries) {
    const date = e.occurredOn.padEnd(12);
    const desc = e.description.slice(0, 50).padEnd(52);
    const ch = e.chargeCents ? fmtUsd(e.chargeCents) : "-";
    const pay = e.paymentCents ? fmtUsd(e.paymentCents) : "-";
    const bal = fmtUsd(e.runningCents);
    const line = `${date}${desc}${ch.padStart(10)}  ${pay.padStart(10)}  ${bal.padStart(10)}`;
    lines.push("0 -13 Td");
    lines.push(`(${escPdf(line)}) Tj`);
  }
  lines.push("0 -18 Td");
  lines.push("/F1 11 Tf");
  lines.push(`(Closing Balance: ${escPdf(fmtUsd(input.closingCents))}) Tj`);
  lines.push("0 -28 Td");
  lines.push("/F1 9 Tf");
  lines.push(`(Please remit payment to ${escPdf(input.orgName)}. Thank you.) Tj`);
  lines.push("ET");

  const streamContent = lines.join("\n");
  const streamBytes = Buffer.from(streamContent, "latin1");

  const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`;
  const obj4 = `4 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`;
  const obj5 = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;

  const header = `%PDF-1.4\n`;
  const offsets: number[] = [];
  let pos = header.length;
  const objects = [obj1, obj2, obj3, obj4, obj5];
  for (const obj of objects) {
    offsets.push(pos);
    pos += Buffer.byteLength(obj, "latin1");
  }
  const xrefOffset = pos;
  const xref = [
    `xref\n`,
    `0 6\n`,
    `0000000000 65535 f \n`,
    ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`),
  ].join("");
  const trailer = `trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.concat([
    Buffer.from(header, "latin1"),
    ...objects.map((o) => Buffer.from(o, "latin1")),
    Buffer.from(xref, "latin1"),
    Buffer.from(trailer, "latin1"),
  ]);
}

export default router;
