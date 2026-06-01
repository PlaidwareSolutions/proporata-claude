import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  ownerAccountsTable,
  ledgerEntriesTable,
  ownerPaymentMethodsTable,
  paymentAttemptsTable,
  unitsTable,
  organizationSettingsTable,
  usersTable,
  notificationsTable,
} from "@workspace/db/schema";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import { requireManager } from "../middleware/auth.js";
import { getStripe, getStripeOrThrow, getPublishableKey, isStripeConfigured } from "../lib/stripe.js";
import { logger } from "../lib/logger.js";
import { sendEmail, buildPaymentReceiptEmail, paymentMethodLabelFromCharge } from "../lib/email.js";

const router: IRouter = Router();

type EntryRow = typeof ledgerEntriesTable.$inferSelect;
type Unit = typeof unitsTable.$inferSelect;

function signedAmount(e: EntryRow): number {
  if (e.kind === "charge") return e.amountCents;
  if (e.kind === "payment") return -e.amountCents;
  if (e.kind === "void") return -e.amountCents;
  return 0;
}

async function loadSettings() {
  const [s] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  return s ?? null;
}

async function ensureOwnerAccount(unitId: string) {
  const [existing] = await db.select().from(ownerAccountsTable).where(eq(ownerAccountsTable.unitId, unitId));
  if (existing) return existing;
  const [created] = await db
    .insert(ownerAccountsTable)
    .values({ unitId, openingBalance: 0, createdAt: new Date().toISOString() })
    .returning();
  return created;
}

async function resolveOwnerUnitOrFail(req: Request, res: Response): Promise<Unit | null> {
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
  if (unit.occupancy !== "owner") {
    res.status(403).json({ error: "Only the unit owner can make online payments" });
    return null;
  }
  return unit;
}

async function getOrCreateStripeCustomer(
  ownerAccountId: number,
  unit: Unit,
  user: { email: string; name: string },
): Promise<string> {
  const stripe = getStripeOrThrow();
  const [acct] = await db.select().from(ownerAccountsTable).where(eq(ownerAccountsTable.id, ownerAccountId));
  if (acct?.stripeCustomerId) return acct.stripeCustomerId;
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name || unit.ownerName,
    metadata: { ownerAccountId: String(ownerAccountId), unitId: unit.id },
  });
  await db
    .update(ownerAccountsTable)
    .set({ stripeCustomerId: customer.id })
    .where(eq(ownerAccountsTable.id, ownerAccountId));
  return customer.id;
}

function calcSurcharge(amountCents: number, settings: { paymentsSurchargeEnabled: boolean; paymentsSurchargePercentBp: number } | null): number {
  if (!settings || !settings.paymentsSurchargeEnabled) return 0;
  const bp = Math.max(0, settings.paymentsSurchargePercentBp || 0);
  return Math.round((amountCents * bp) / 10000);
}

// ACH typically settles in ~4 US business days. We pick a conservative date so
// owners don't see "expected today" only to find funds still clearing.
const ACH_SETTLEMENT_BUSINESS_DAYS = 4;

function addBusinessDays(fromIso: string, businessDays: number): string {
  const start = new Date(fromIso);
  if (Number.isNaN(start.getTime())) return fromIso.slice(0, 10);
  let added = 0;
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  while (added < businessDays) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return d.toISOString().slice(0, 10);
}

export type AttemptSerialized = {
  id: number;
  amountCents: number;
  surchargeCents: number;
  refundedAmountCents: number;
  kind: string;
  status: string;
  stripePaymentIntentId: string | null;
  errorMessage: string | null;
  expectedSettlementAt: string | null;
  paymentMethodKind: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function serializeOwnerAttempts(
  attempts: (typeof paymentAttemptsTable.$inferSelect)[],
): Promise<AttemptSerialized[]> {
  const pmIds = Array.from(
    new Set(attempts.map((a) => a.paymentMethodId).filter((x): x is number => typeof x === "number")),
  );
  const pmRows = pmIds.length
    ? await db.select().from(ownerPaymentMethodsTable).where(inArray(ownerPaymentMethodsTable.id, pmIds))
    : [];
  const pmKindById = new Map(pmRows.map((p) => [p.id, p.kind]));
  return attempts.map((a) => {
    let pmKind: string | null = a.paymentMethodId ? pmKindById.get(a.paymentMethodId) ?? null : null;
    // Cards confirm in seconds — a "processing" attempt almost certainly used
    // an ACH (us_bank_account) payment method, so we infer the kind for
    // one-off payments that didn't save the method.
    if (!pmKind && a.status === "processing") pmKind = "us_bank_account";
    const expectedSettlementAt =
      a.status === "processing" && (pmKind === "us_bank_account" || pmKind === null)
        ? addBusinessDays(a.createdAt, ACH_SETTLEMENT_BUSINESS_DAYS)
        : null;
    return {
      id: a.id,
      amountCents: a.amountCents,
      surchargeCents: a.surchargeCents,
      refundedAmountCents: a.refundedAmountCents ?? 0,
      kind: a.kind,
      status: a.status,
      stripePaymentIntentId: a.stripePaymentIntentId,
      errorMessage: a.errorMessage,
      expectedSettlementAt,
      paymentMethodKind: pmKind,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  });
}

// --- Public config ---
router.get("/payments/config", async (_req, res) => {
  const settings = await loadSettings();
  const publishableKey = getPublishableKey();
  // Frontend cannot render Elements without the publishable key, so treat
  // a missing publishable key as "payments disabled" even if other Stripe
  // config is present.
  res.json({
    enabled: isStripeConfigured() && !!publishableKey && !!(settings?.paymentsEnabled),
    publishableKey,
    surchargeEnabled: !!settings?.paymentsSurchargeEnabled,
    surchargePercentBp: settings?.paymentsSurchargePercentBp ?? 0,
    autoPayLagDays: settings?.paymentsAutoPayLagDays ?? 3,
  });
});

// --- Owner endpoints ---

router.get("/me/payments/methods", async (req, res) => {
  const unit = await resolveOwnerUnitOrFail(req, res);
  if (!unit) return;
  const acct = await ensureOwnerAccount(unit.id);
  const methods = await db
    .select()
    .from(ownerPaymentMethodsTable)
    .where(eq(ownerPaymentMethodsTable.ownerAccountId, acct.id))
    .orderBy(desc(ownerPaymentMethodsTable.createdAt));
  res.json(
    methods.map((m) => ({
      id: m.id,
      brand: m.brand,
      last4: m.last4,
      kind: m.kind,
      isAutoPay: m.isAutoPay,
      createdAt: m.createdAt,
    })),
  );
});

router.post("/me/payments/setup-intent", async (req, res) => {
  const unit = await resolveOwnerUnitOrFail(req, res);
  if (!unit) return;
  const settings = await loadSettings();
  if (!settings?.paymentsEnabled || !isStripeConfigured()) {
    res.status(503).json({ error: "Online payments are not enabled" });
    return;
  }
  const acct = await ensureOwnerAccount(unit.id);
  const customerId = await getOrCreateStripeCustomer(acct.id, unit, {
    email: req.user!.email,
    name: req.user!.name,
  });
  const stripe = getStripeOrThrow();
  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ["card", "us_bank_account"],
    usage: "off_session",
  });
  res.json({ clientSecret: setupIntent.client_secret });
});

router.delete("/me/payments/methods/:id", async (req, res) => {
  const unit = await resolveOwnerUnitOrFail(req, res);
  if (!unit) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const acct = await ensureOwnerAccount(unit.id);
  const [pm] = await db
    .select()
    .from(ownerPaymentMethodsTable)
    .where(and(eq(ownerPaymentMethodsTable.id, id), eq(ownerPaymentMethodsTable.ownerAccountId, acct.id)));
  if (!pm) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const stripe = getStripe();
  if (stripe) {
    try {
      await stripe.paymentMethods.detach(pm.stripePaymentMethodId);
    } catch (e) {
      logger.warn({ err: e }, "Failed to detach Stripe payment method");
    }
  }
  await db.delete(ownerPaymentMethodsTable).where(eq(ownerPaymentMethodsTable.id, id));
  res.json({ ok: true });
});

router.post("/me/payments/methods/:id/auto-pay", async (req, res) => {
  const unit = await resolveOwnerUnitOrFail(req, res);
  if (!unit) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const enable = !!req.body?.enabled;
  const acct = await ensureOwnerAccount(unit.id);
  const [pm] = await db
    .select()
    .from(ownerPaymentMethodsTable)
    .where(and(eq(ownerPaymentMethodsTable.id, id), eq(ownerPaymentMethodsTable.ownerAccountId, acct.id)));
  if (!pm) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Only one method can be auto-pay at a time
  if (enable) {
    await db
      .update(ownerPaymentMethodsTable)
      .set({ isAutoPay: false })
      .where(eq(ownerPaymentMethodsTable.ownerAccountId, acct.id));
  }
  await db
    .update(ownerPaymentMethodsTable)
    .set({ isAutoPay: enable })
    .where(eq(ownerPaymentMethodsTable.id, id));
  res.json({ ok: true });
});

router.post("/me/payments/intent", async (req, res) => {
  const unit = await resolveOwnerUnitOrFail(req, res);
  if (!unit) return;
  const settings = await loadSettings();
  if (!settings?.paymentsEnabled || !isStripeConfigured()) {
    res.status(503).json({ error: "Online payments are not enabled" });
    return;
  }
  const amountCents = Number(req.body?.amountCents);
  if (!Number.isFinite(amountCents) || amountCents <= 0 || !Number.isInteger(amountCents)) {
    res.status(400).json({ error: "amountCents must be a positive integer" });
    return;
  }
  if (amountCents < 100) {
    res.status(400).json({ error: "Minimum payment is $1.00" });
    return;
  }
  const acct = await ensureOwnerAccount(unit.id);
  const customerId = await getOrCreateStripeCustomer(acct.id, unit, {
    email: req.user!.email,
    name: req.user!.name,
  });
  const surchargeCents = calcSurcharge(amountCents, settings);
  const totalCents = amountCents + surchargeCents;

  const saveMethod = !!req.body?.savePaymentMethod;
  const now = new Date().toISOString();

  // Insert attempt FIRST so the webhook can resolve via metadata.paymentAttemptId
  // even if payment_intent.succeeded arrives before our PI-id update.
  const [attempt] = await db
    .insert(paymentAttemptsTable)
    .values({
      ownerAccountId: acct.id,
      amountCents,
      surchargeCents,
      kind: "owner_initiated",
      status: "pending",
      saveMethodRequested: saveMethod,
      initiatedBy: "owner",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const stripe = getStripeOrThrow();
  let pi;
  try {
    pi = await stripe.paymentIntents.create(
      {
        amount: totalCents,
        currency: "usd",
        customer: customerId,
        payment_method_types: ["card", "us_bank_account"],
        metadata: {
          ownerAccountId: String(acct.id),
          unitId: unit.id,
          baseAmountCents: String(amountCents),
          surchargeCents: String(surchargeCents),
          paymentAttemptId: String(attempt.id),
          kind: "owner_initiated",
        },
        setup_future_usage: saveMethod ? "off_session" : undefined,
      },
      { idempotencyKey: `pi-attempt-${attempt.id}` },
    );
  } catch (err) {
    await db
      .update(paymentAttemptsTable)
      .set({
        status: "failed",
        errorMessage: err instanceof Error ? err.message : "Stripe error",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(paymentAttemptsTable.id, attempt.id));
    throw err;
  }

  await db
    .update(paymentAttemptsTable)
    .set({ stripePaymentIntentId: pi.id, updatedAt: new Date().toISOString() })
    .where(eq(paymentAttemptsTable.id, attempt.id));

  res.json({
    paymentIntentId: pi.id,
    clientSecret: pi.client_secret,
    amountCents,
    surchargeCents,
    totalCents,
  });
});

// --- Manager endpoints ---

router.get("/billing/payments", requireManager, async (_req, res) => {
  const attempts = await db
    .select()
    .from(paymentAttemptsTable)
    .orderBy(desc(paymentAttemptsTable.createdAt))
    .limit(500);
  const acctIds = Array.from(new Set(attempts.map((a) => a.ownerAccountId)));
  const accts = acctIds.length
    ? await db.select().from(ownerAccountsTable).where(inArray(ownerAccountsTable.id, acctIds))
    : [];
  const unitIds = accts.map((a) => a.unitId);
  const units = unitIds.length ? await db.select().from(unitsTable).where(inArray(unitsTable.id, unitIds)) : [];
  const acctById = new Map(accts.map((a) => [a.id, a]));
  const unitById = new Map(units.map((u) => [u.id, u]));
  res.json(
    attempts.map((a) => {
      const acct = acctById.get(a.ownerAccountId);
      const unit = acct ? unitById.get(acct.unitId) : null;
      return {
        id: a.id,
        ownerAccountId: a.ownerAccountId,
        unitId: unit?.id ?? null,
        unitLabel: unit?.unit ?? null,
        ownerName: unit?.ownerName ?? null,
        amountCents: a.amountCents,
        surchargeCents: a.surchargeCents,
        refundedAmountCents: a.refundedAmountCents ?? 0,
        kind: a.kind,
        status: a.status,
        disputeStatus: a.disputeStatus,
        stripePaymentIntentId: a.stripePaymentIntentId,
        ledgerEntryId: a.ledgerEntryId,
        initiatedBy: a.initiatedBy,
        errorMessage: a.errorMessage,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      };
    }),
  );
});

router.post("/billing/payments/:id/refund", requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [attempt] = await db.select().from(paymentAttemptsTable).where(eq(paymentAttemptsTable.id, id));
  if (!attempt) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }
  if (
    (attempt.status !== "succeeded" && attempt.status !== "partially_refunded") ||
    !attempt.stripeChargeId
  ) {
    res.status(400).json({ error: "Only settled payments can be refunded" });
    return;
  }
  // Refunds apply to the full charged amount (base + surcharge) since Stripe
  // captured both as a single charge.
  const totalCharged = attempt.amountCents + attempt.surchargeCents;
  const remaining = totalCharged - (attempt.refundedAmountCents ?? 0);
  if (remaining <= 0) {
    res.status(400).json({ error: "Payment is fully refunded" });
    return;
  }
  const refundCents = Number(req.body?.amountCents ?? remaining);
  if (!Number.isFinite(refundCents) || refundCents <= 0 || refundCents > remaining) {
    res.status(400).json({ error: `Invalid refund amount (max ${remaining} cents remaining)` });
    return;
  }

  // Webhook (`charge.refunded`) is authoritative for ledger reconciliation
  // and for updating `refundedAmountCents`. We only call Stripe here, with a
  // deterministic idempotency key so retries from this endpoint can't double-
  // refund the same chunk.
  const stripe = getStripeOrThrow();
  await stripe.refunds.create(
    {
      charge: attempt.stripeChargeId,
      amount: refundCents,
      metadata: {
        ownerAccountId: String(attempt.ownerAccountId),
        paymentAttemptId: String(attempt.id),
        reason: typeof req.body?.reason === "string" ? req.body.reason : "",
        kind: "manager_refund",
      },
    },
    {
      idempotencyKey: `refund-attempt-${attempt.id}-${attempt.refundedAmountCents ?? 0}-${refundCents}`,
    },
  );

  res.json({ ok: true });
});

// Owner: list their own payment attempts (so the UI can surface ACH
// "pending bank confirmation" and recent failures).
router.get("/me/payments/attempts", async (req, res) => {
  const unit = await resolveOwnerUnitOrFail(req, res);
  if (!unit) return;
  const acct = await ensureOwnerAccount(unit.id);
  const rows = await db
    .select()
    .from(paymentAttemptsTable)
    .where(eq(paymentAttemptsTable.ownerAccountId, acct.id))
    .orderBy(desc(paymentAttemptsTable.createdAt))
    .limit(50);
  res.json(await serializeOwnerAttempts(rows));
});

router.get("/billing/payments/:id/receipt", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [attempt] = await db.select().from(paymentAttemptsTable).where(eq(paymentAttemptsTable.id, id));
  if (!attempt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Authorization: managers/admins always allowed; residents must be the
  // owner (not a tenant) of the unit this payment belongs to. Tenants are
  // excluded from online payments per task spec, so they may not view
  // receipts either.
  const user = req.user!;
  if (user.role !== "admin" && user.role !== "manager") {
    const [acct] = await db.select().from(ownerAccountsTable).where(eq(ownerAccountsTable.id, attempt.ownerAccountId));
    if (!acct || !user.unitId || acct.unitId !== user.unitId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, user.unitId));
    if (!unit || unit.occupancy !== "owner") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }
  const stripe = getStripe();
  let receiptUrl: string | null = null;
  if (stripe && attempt.stripeChargeId) {
    try {
      const ch = await stripe.charges.retrieve(attempt.stripeChargeId);
      receiptUrl = ch.receipt_url ?? null;
    } catch (e) {
      logger.warn({ err: e }, "Failed to fetch Stripe charge for receipt");
    }
  }
  res.json({
    id: attempt.id,
    amountCents: attempt.amountCents,
    surchargeCents: attempt.surchargeCents,
    status: attempt.status,
    stripePaymentIntentId: attempt.stripePaymentIntentId,
    receiptUrl,
    createdAt: attempt.createdAt,
  });
});

// Manager: re-send the receipt email for a settled payment.
router.post("/billing/payments/:id/receipt/resend", requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [attempt] = await db
    .select()
    .from(paymentAttemptsTable)
    .where(eq(paymentAttemptsTable.id, id));
  if (!attempt) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }
  if (attempt.status !== "succeeded" && attempt.status !== "partially_refunded" && attempt.status !== "refunded") {
    res.status(400).json({ error: "Receipts can only be re-sent for settled payments" });
    return;
  }
  const [acct] = await db
    .select()
    .from(ownerAccountsTable)
    .where(eq(ownerAccountsTable.id, attempt.ownerAccountId));
  if (!acct) {
    res.status(404).json({ error: "Owner account not found" });
    return;
  }
  const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, acct.unitId));
  if (!unit) {
    res.status(404).json({ error: "Unit not found" });
    return;
  }
  const owners = (
    await db.select().from(usersTable).where(eq(usersTable.unitId, unit.id))
  ).filter((u) => u.role === "resident" && !u.pending && u.email);
  if (owners.length === 0) {
    res.status(400).json({ error: "No owner email on file for this unit" });
    return;
  }

  const stripe = getStripe();
  let receiptUrl: string | null = null;
  let methodLabel = "Online payment";
  if (stripe && attempt.stripeChargeId) {
    try {
      const ch = await stripe.charges.retrieve(attempt.stripeChargeId);
      receiptUrl = ch.receipt_url ?? null;
      methodLabel = paymentMethodLabelFromCharge(ch);
    } catch (e) {
      logger.warn({ err: e, attemptId: id }, "Failed to fetch Stripe charge for receipt resend");
    }
  }

  const [settings] = await db
    .select()
    .from(organizationSettingsTable)
    .where(eq(organizationSettingsTable.id, 1));
  const orgName = settings?.name || "HOA Hub";
  const html = buildPaymentReceiptEmail({
    orgName,
    unitLabel: unit.unit,
    amountCents: attempt.amountCents,
    surchargeCents: attempt.surchargeCents,
    dateIso: attempt.updatedAt ?? attempt.createdAt,
    paymentMethod: methodLabel,
    kind: attempt.kind,
    receiptUrl,
  });
  const subject = `Payment receipt — Unit ${unit.unit}`;
  const recipients: string[] = [];
  let lastError: string | null = null;
  for (const o of owners) {
    if (!o.email) continue;
    try {
      const result = await sendEmail(o.email, subject, html);
      if (result.ok) {
        recipients.push(o.email);
      } else {
        lastError = result.error ?? "Email provider rejected the message";
        logger.warn({ attemptId: id, to: o.email, error: lastError }, "Resend receipt email failed");
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn({ err, attemptId: id, to: o.email }, "Failed to re-send receipt email");
    }
  }
  if (recipients.length === 0) {
    res.status(500).json({ error: lastError ?? "Failed to send receipt email" });
    return;
  }
  res.json({ ok: true, recipients });
});

export default router;
