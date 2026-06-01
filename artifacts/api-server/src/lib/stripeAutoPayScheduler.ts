import { db } from "@workspace/db";
import {
  ledgerEntriesTable,
  ownerAccountsTable,
  ownerPaymentMethodsTable,
  paymentAttemptsTable,
  organizationSettingsTable,
  unitsTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { getStripe, isStripeConfigured } from "./stripe.js";
import { logger } from "./logger.js";
import { sendEmail, buildAutoPayInitiatedEmail } from "./email.js";

const TICK_MS = 6 * 60 * 60 * 1000; // every 6 hours

async function runOnce(): Promise<void> {
  if (!isStripeConfigured()) return;
  const stripe = getStripe();
  if (!stripe) return;

  const [settings] = await db
    .select()
    .from(organizationSettingsTable)
    .where(eq(organizationSettingsTable.id, 1));
  if (!settings?.paymentsEnabled) return;
  const lagDays = settings.paymentsAutoPayLagDays ?? 3;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lagDays);
  const cutoffIso = cutoffDate.toISOString().slice(0, 10);

  const autoPayMethods = await db
    .select()
    .from(ownerPaymentMethodsTable)
    .where(eq(ownerPaymentMethodsTable.isAutoPay, true));

  for (const pm of autoPayMethods) {
    try {
      await runForMethod(pm, settings, cutoffIso);
    } catch (err) {
      logger.error({ err, paymentMethodId: pm.id }, "Auto-pay failed for payment method");
    }
  }
}

function computeOutstanding(
  entries: Array<typeof ledgerEntriesTable.$inferSelect>,
): number {
  // Mirror billing.ts `signedAmount`: voidedAt is a display flag — the
  // matching void/refund row carries the reversing -amountCents, so we
  // don't skip voided originals (doing so would double-reverse balances
  // for voided payments and refunded charges).
  return entries.reduce((sum, e) => {
    if (e.kind === "charge") return sum + e.amountCents;
    if (e.kind === "payment") return sum - e.amountCents;
    if (e.kind === "void" || e.kind === "refund") return sum - e.amountCents;
    return sum;
  }, 0);
}

async function runForMethod(
  pm: typeof ownerPaymentMethodsTable.$inferSelect,
  settings: typeof organizationSettingsTable.$inferSelect,
  cutoffIso: string,
): Promise<void> {
  const stripe = getStripe();
  if (!stripe) return;

  const [acct] = await db
    .select()
    .from(ownerAccountsTable)
    .where(eq(ownerAccountsTable.id, pm.ownerAccountId));
  if (!acct?.stripeCustomerId) return;

  const allEntries = await db
    .select()
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.ownerAccountId, pm.ownerAccountId));

  if (computeOutstanding(allEntries) <= 0) return;

  // FIFO-apply all ledger payments and voids to monthly_assessment charges so we
  // know each charge's truly-unpaid remaining amount, regardless of whether the
  // payment came from auto-pay, manual posting, or owner-initiated online pay.
  type OpenCharge = { id: number; occurredOn: string; remaining: number };
  const sorted = [...allEntries].sort((a, b) =>
    a.occurredOn === b.occurredOn ? a.id - b.id : a.occurredOn.localeCompare(b.occurredOn),
  );
  const openMA: OpenCharge[] = [];
  let credit = 0;
  const applyPayment = (amount: number) => {
    let remaining = amount;
    for (const c of openMA) {
      if (remaining <= 0) break;
      if (c.remaining <= 0) continue;
      const take = Math.min(c.remaining, remaining);
      c.remaining -= take;
      remaining -= take;
    }
    credit += Math.max(0, remaining);
  };
  const consumeCredit = (amt: number): number => {
    const take = Math.min(credit, amt);
    credit -= take;
    return amt - take;
  };
  for (const e of sorted) {
    if (e.kind === "charge") {
      if (e.chargeType === "monthly_assessment") {
        const after = consumeCredit(e.amountCents);
        if (after > 0) openMA.push({ id: e.id, occurredOn: e.occurredOn, remaining: after });
      } else {
        consumeCredit(e.amountCents);
      }
    } else if (e.kind === "payment") {
      applyPayment(e.amountCents);
    } else if (e.kind === "void" || e.kind === "refund") {
      // Adjustment/refund rows: positive amountCents is a credit applied to
      // open charges; negative amountCents re-adds balance (refund of a
      // payment) and doesn't consume any open charge.
      if (e.amountCents > 0) applyPayment(e.amountCents);
    }
  }

  // Look up any non-terminal payment_attempts for this owner. We use these to:
  //  (a) FIFO-subtract Stripe-confirmed in-flight charges (owner-initiated PIs
  //      that don't target a specific ledger entry) from open balances; and
  //  (b) block per-charge retries when an attempt already exists for that
  //      ledger entry (pending/processing/succeeded), so a delayed webhook or
  //      a `requires_action` PI can't trigger duplicate auto-pay drafts every
  //      tick.
  const ownerAttempts = await db
    .select()
    .from(paymentAttemptsTable)
    .where(eq(paymentAttemptsTable.ownerAccountId, pm.ownerAccountId));
  const ACTIVE_STATUSES = new Set(["pending", "processing", "succeeded"]);
  const blockedLedgerIds = new Set<number>();
  // Per-charge failure cooldown: a recently-failed auto-pay attempt should
  // not be retried by every scheduler tick — back off for 24h to avoid
  // hammering Stripe and spamming owner notifications when (e.g.) a card is
  // declined or a bank balance is insufficient.
  const FAILURE_BACKOFF_MS = 24 * 60 * 60 * 1000;
  const cooldownCutoff = Date.now() - FAILURE_BACKOFF_MS;
  for (const a of ownerAttempts) {
    if (ACTIVE_STATUSES.has(a.status)) {
      if (a.paidLedgerEntryId) {
        blockedLedgerIds.add(a.paidLedgerEntryId);
      } else if (a.status === "processing" && !a.ledgerEntryId) {
        // Owner-initiated processing payment with no ledger entry yet
        applyPayment(a.amountCents);
      }
    } else if (a.status === "failed" && a.kind === "auto_pay" && a.paidLedgerEntryId) {
      const updatedMs = Date.parse(a.updatedAt);
      if (Number.isFinite(updatedMs) && updatedMs > cooldownCutoff) {
        blockedLedgerIds.add(a.paidLedgerEntryId);
      }
    }
  }

  // Charge any aged monthly_assessment charge whose unpaid remainder is > 0
  // and which is not already blocked by an active attempt.
  for (const charge of openMA) {
    if (charge.remaining <= 0) continue;
    if (charge.occurredOn > cutoffIso) continue;
    if (blockedLedgerIds.has(charge.id)) continue;

    const baseCents = charge.remaining;
    const bp = settings.paymentsSurchargeEnabled ? settings.paymentsSurchargePercentBp : 0;
    const surchargeCents = Math.round((baseCents * bp) / 10000);

    const now = new Date().toISOString();

    const [attempt] = await db
      .insert(paymentAttemptsTable)
      .values({
        ownerAccountId: pm.ownerAccountId,
        paidLedgerEntryId: charge.id,
        amountCents: baseCents,
        surchargeCents,
        kind: "auto_pay",
        status: "pending",
        paymentMethodId: pm.id,
        initiatedBy: "system",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    let pi;
    try {
      pi = await stripe.paymentIntents.create(
        {
          amount: baseCents + surchargeCents,
          currency: "usd",
          customer: acct.stripeCustomerId!,
          payment_method: pm.stripePaymentMethodId,
          off_session: true,
          confirm: true,
          metadata: {
            ownerAccountId: String(pm.ownerAccountId),
            unitId: acct.unitId,
            baseAmountCents: String(baseCents),
            surchargeCents: String(surchargeCents),
            paidLedgerEntryId: String(charge.id),
            paymentAttemptId: String(attempt.id),
            kind: "auto_pay",
          },
        },
        // Deterministic idempotency key tied to the owner+payment-method+
        // ledger charge — re-running with the same arguments will return the
        // same PI rather than creating a duplicate.
        { idempotencyKey: `auto-pay-acct${pm.ownerAccountId}-pm${pm.id}-charge${charge.id}` },
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
      logger.warn({ err, attemptId: attempt.id }, "Auto-pay charge create failed");
      continue;
    }

    const stripeStatus =
      pi.status === "succeeded"
        ? "pending"
        : pi.status === "processing"
          ? "processing"
          : "pending";
    // Avoid clobbering a webhook-driven status update (succeeded/failed/etc.)
    // that may have already landed for this PI: only update while the row
    // is still in its initial pending state with no PI id attached.
    await db
      .update(paymentAttemptsTable)
      .set({
        status: stripeStatus,
        stripePaymentIntentId: pi.id,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(paymentAttemptsTable.id, attempt.id),
          eq(paymentAttemptsTable.status, "pending"),
        ),
      );
    logger.info(
      { attemptId: attempt.id, paymentIntentId: pi.id, baseCents, surchargeCents },
      "Auto-pay initiated",
    );

    // Pre-charge notice email to the owner so they know auto-pay just ran.
    // The settled receipt arrives separately from the success webhook; this
    // gives a heads-up immediately for ACH payments that may take days to
    // settle.
    try {
      const [unit] = await db
        .select()
        .from(unitsTable)
        .where(eq(unitsTable.id, acct.unitId));
      if (unit) {
        const owners = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.unitId, unit.id));
        const ownerEmails = owners
          .filter((o) => o.role === "resident" && !o.pending && o.email)
          .map((o) => o.email);
        if (ownerEmails.length > 0) {
          const methodLabel =
            pm.kind === "us_bank_account"
              ? `${pm.brand ?? "Bank account"}${pm.last4 ? ` ending in ${pm.last4}` : ""}`
              : `${pm.brand ? pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1) : "Card"}${pm.last4 ? ` ending in ${pm.last4}` : ""}`;
          const html = buildAutoPayInitiatedEmail({
            orgName: settings.name || "HOA Hub",
            unitLabel: unit.unit,
            amountCents: baseCents,
            surchargeCents,
            dateIso: now,
            paymentMethod: methodLabel,
          });
          const subject = `Auto-pay initiated — Unit ${unit.unit}`;
          for (const email of ownerEmails) {
            try {
              const result = await sendEmail(email, subject, html);
              if (!result.ok) {
                logger.warn(
                  { attemptId: attempt.id, to: email, error: result.error },
                  "Auto-pay initiated email rejected by provider",
                );
              }
            } catch (err) {
              logger.warn({ err, attemptId: attempt.id, to: email }, "Failed to send auto-pay initiated email");
            }
          }
        }
      }
    } catch (err) {
      logger.warn({ err, attemptId: attempt.id }, "Failed to send auto-pay pre-charge notice");
    }

    charge.remaining = 0;
  }
}

export function startStripeAutoPayScheduler(): void {
  if (!isStripeConfigured()) {
    logger.info("Stripe not configured; auto-pay scheduler not started");
    return;
  }
  setTimeout(() => {
    runOnce().catch((err) => logger.error({ err }, "Auto-pay scheduler tick failed"));
    setInterval(() => {
      runOnce().catch((err) => logger.error({ err }, "Auto-pay scheduler tick failed"));
    }, TICK_MS);
  }, 60_000);
  logger.info("Stripe auto-pay scheduler started");
}
