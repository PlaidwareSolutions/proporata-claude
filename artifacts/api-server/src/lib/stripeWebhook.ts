import type { Request, Response } from "express";
import type Stripe from "stripe";
import { db } from "@workspace/db";
import {
  ledgerEntriesTable,
  ownerAccountsTable,
  ownerPaymentMethodsTable,
  paymentAttemptsTable,
  stripeEventsProcessedTable,
  notificationsTable,
  usersTable,
  unitsTable,
  organizationSettingsTable,
} from "@workspace/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { getStripe, getWebhookSecret } from "./stripe.js";
import { logger } from "./logger.js";
import {
  sendEmail,
  buildPaymentReceiptEmail,
  buildPaymentRefundEmail,
  paymentMethodLabelFromCharge,
} from "./email.js";

async function claimEvent(eventId: string, type: string): Promise<boolean> {
  try {
    await db.insert(stripeEventsProcessedTable).values({
      stripeEventId: eventId,
      type,
      processedAt: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}

async function findAttemptByPI(paymentIntentId: string) {
  const [a] = await db
    .select()
    .from(paymentAttemptsTable)
    .where(eq(paymentAttemptsTable.stripePaymentIntentId, paymentIntentId));
  return a ?? null;
}

/**
 * Resolve the attempt for a PaymentIntent event. Looks up first by
 * `stripe_payment_intent_id`, then falls back to the PI metadata
 * `paymentAttemptId` (set by the auto-pay scheduler) so we don't miss
 * attempts when `payment_intent.succeeded` arrives before our DB UPDATE
 * has populated the PI id.
 */
async function resolveAttempt(pi: Stripe.PaymentIntent) {
  const byPi = await findAttemptByPI(pi.id);
  if (byPi) return byPi;
  const metaId = pi.metadata?.paymentAttemptId;
  if (metaId) {
    const numId = Number(metaId);
    if (Number.isFinite(numId)) {
      const [a] = await db
        .select()
        .from(paymentAttemptsTable)
        .where(eq(paymentAttemptsTable.id, numId));
      if (a) return a;
    }
  }
  return null;
}

async function getOrgName(): Promise<string> {
  const [row] = await db
    .select()
    .from(organizationSettingsTable)
    .where(eq(organizationSettingsTable.id, 1));
  return row?.name ?? "HOA Hub";
}

async function notifyManagers(message: string, entityType: string, entityId: string, type: string) {
  const now = new Date().toISOString();
  const managers = await db.select().from(usersTable).where(ne(usersTable.role, "resident"));
  for (const u of managers) {
    if (u.pending) continue;
    await db.insert(notificationsTable).values({
      userId: u.id,
      type,
      message,
      entityType,
      entityId,
      read: false,
      createdAt: now,
    });
  }
}

async function getUnitOwners(unitId: string) {
  const owners = await db.select().from(usersTable).where(eq(usersTable.unitId, unitId));
  return owners.filter((u) => u.role === "resident" && !u.pending);
}

async function notifyUnitOwner(
  unitId: string,
  message: string,
  entityType: string,
  entityId: string,
  type: string,
) {
  const now = new Date().toISOString();
  const owners = await getUnitOwners(unitId);
  for (const u of owners) {
    await db.insert(notificationsTable).values({
      userId: u.id,
      type,
      message,
      entityType,
      entityId,
      read: false,
      createdAt: now,
    });
  }
}

async function getUnitForAccount(ownerAccountId: number) {
  const [acct] = await db.select().from(ownerAccountsTable).where(eq(ownerAccountsTable.id, ownerAccountId));
  if (!acct) return null;
  const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, acct.unitId));
  return unit ?? null;
}

async function recordPaymentLedger(
  attemptId: number,
  pi: Stripe.PaymentIntent,
): Promise<void> {
  const charge = pi.latest_charge && typeof pi.latest_charge !== "string" ? pi.latest_charge : null;
  const chargeId =
    typeof pi.latest_charge === "string" ? pi.latest_charge : (charge?.id ?? null);
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    const [fresh] = await tx
      .select()
      .from(paymentAttemptsTable)
      .where(eq(paymentAttemptsTable.id, attemptId));
    if (!fresh) return;
    if (fresh.ledgerEntryId) return;

    const [entry] = await tx
      .insert(ledgerEntriesTable)
      .values({
        ownerAccountId: fresh.ownerAccountId,
        occurredOn: now.slice(0, 10),
        postedAt: now,
        kind: "payment",
        chargeType: null,
        paymentMethod: "online",
        amountCents: fresh.amountCents,
        memo:
          fresh.kind === "auto_pay"
            ? "Online auto-pay (Stripe)"
            : "Online payment (Stripe)",
        postedBy: 0,
        stripePaymentIntentId: pi.id,
        stripeChargeId: chargeId,
        stripeStatus: pi.status,
      })
      .returning();

    await tx
      .update(paymentAttemptsTable)
      .set({
        status: "succeeded",
        stripeChargeId: chargeId,
        stripePaymentIntentId: pi.id,
        ledgerEntryId: entry.id,
        updatedAt: now,
      })
      .where(eq(paymentAttemptsTable.id, attemptId));
  });
}

async function persistSavedPaymentMethodFromPI(pi: Stripe.PaymentIntent): Promise<void> {
  const stripe = getStripe();
  if (!stripe) return;
  // Only persist if the PI was set up for future use.
  if (!pi.setup_future_usage) return;
  const pmId = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
  const customerId = typeof pi.customer === "string" ? pi.customer : pi.customer?.id;
  if (!pmId || !customerId) return;

  const [acct] = await db
    .select()
    .from(ownerAccountsTable)
    .where(eq(ownerAccountsTable.stripeCustomerId, customerId));
  if (!acct) return;

  const [existing] = await db
    .select()
    .from(ownerPaymentMethodsTable)
    .where(eq(ownerPaymentMethodsTable.stripePaymentMethodId, pmId));
  if (existing) return;

  let pm: Stripe.PaymentMethod;
  try {
    pm = await stripe.paymentMethods.retrieve(pmId);
  } catch (err) {
    logger.warn({ err, pmId }, "Failed to retrieve payment method for persistence");
    return;
  }
  const kind = pm.type === "us_bank_account" ? "us_bank_account" : "card";
  const brand = pm.card?.brand ?? pm.us_bank_account?.bank_name ?? null;
  const last4 = pm.card?.last4 ?? pm.us_bank_account?.last4 ?? null;
  await db.insert(ownerPaymentMethodsTable).values({
    ownerAccountId: acct.id,
    stripeCustomerId: customerId,
    stripePaymentMethodId: pmId,
    brand,
    last4,
    kind,
    isAutoPay: false,
    createdAt: new Date().toISOString(),
  });
}

async function emailPaymentReceipt(
  attempt: typeof paymentAttemptsTable.$inferSelect,
  charge: Stripe.Charge | null,
): Promise<void> {
  const unit = await getUnitForAccount(attempt.ownerAccountId);
  if (!unit) return;
  const owners = await getUnitOwners(unit.id);
  if (owners.length === 0) return;
  const orgName = await getOrgName();
  const html = buildPaymentReceiptEmail({
    orgName,
    unitLabel: unit.unit,
    amountCents: attempt.amountCents,
    surchargeCents: attempt.surchargeCents,
    dateIso: attempt.updatedAt ?? attempt.createdAt,
    paymentMethod: paymentMethodLabelFromCharge(charge),
    kind: attempt.kind,
    receiptUrl: charge?.receipt_url ?? null,
  });
  const subject = `Payment receipt — Unit ${unit.unit}`;
  for (const o of owners) {
    if (!o.email) continue;
    try {
      const result = await sendEmail(o.email, subject, html);
      if (!result.ok) {
        logger.warn(
          { attemptId: attempt.id, to: o.email, error: result.error },
          "Receipt email rejected by provider",
        );
      }
    } catch (err) {
      logger.warn({ err, attemptId: attempt.id, to: o.email }, "Failed to send payment receipt email");
    }
  }
}

async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent) {
  const attempt = await resolveAttempt(pi);
  if (!attempt) {
    logger.warn({ paymentIntentId: pi.id }, "PaymentIntent succeeded but no attempt found");
    return;
  }
  if (!attempt.ledgerEntryId) {
    await recordPaymentLedger(attempt.id, pi);
  }
  await persistSavedPaymentMethodFromPI(pi);

  // Reload the attempt so we email a receipt that reflects the final state
  // (status: succeeded, stripeChargeId set) written by recordPaymentLedger.
  const [fresh] = await db
    .select()
    .from(paymentAttemptsTable)
    .where(eq(paymentAttemptsTable.id, attempt.id));
  // Webhook PaymentIntent objects typically have `latest_charge` as a
  // string id (not expanded). Fetch the charge so the receipt email can
  // include the actual payment method (brand/last4) and Stripe receipt URL.
  let charge: Stripe.Charge | null =
    pi.latest_charge && typeof pi.latest_charge !== "string" ? pi.latest_charge : null;
  if (!charge) {
    const chargeId =
      typeof pi.latest_charge === "string" ? pi.latest_charge : fresh?.stripeChargeId ?? null;
    const stripe = getStripe();
    if (stripe && chargeId) {
      try {
        charge = await stripe.charges.retrieve(chargeId);
      } catch (err) {
        logger.warn(
          { err, chargeId, paymentIntentId: pi.id },
          "Failed to fetch charge for receipt email",
        );
      }
    }
  }

  const unit = await getUnitForAccount(attempt.ownerAccountId);
  if (unit) {
    const dollars = (attempt.amountCents / 100).toFixed(2);
    await notifyUnitOwner(
      unit.id,
      `Payment of $${dollars} received for Unit ${unit.unit}. Receipt available in your account.`,
      "payment_attempt",
      String(attempt.id),
      "payment_succeeded",
    );
  }

  await emailPaymentReceipt(fresh ?? attempt, charge);
}

async function handlePaymentIntentProcessing(pi: Stripe.PaymentIntent) {
  const attempt = await resolveAttempt(pi);
  if (!attempt) return;
  const now = new Date().toISOString();
  if (attempt.status !== "succeeded" && attempt.status !== "refunded") {
    await db
      .update(paymentAttemptsTable)
      .set({ status: "processing", stripePaymentIntentId: pi.id, updatedAt: now })
      .where(eq(paymentAttemptsTable.id, attempt.id));
  }
  const unit = await getUnitForAccount(attempt.ownerAccountId);
  if (unit) {
    const dollars = (attempt.amountCents / 100).toFixed(2);
    await notifyUnitOwner(
      unit.id,
      `Bank payment of $${dollars} initiated for Unit ${unit.unit}. Pending bank confirmation (3–5 days).`,
      "payment_attempt",
      String(attempt.id),
      "payment_processing",
    );
  }
}

async function handlePaymentIntentFailed(pi: Stripe.PaymentIntent) {
  const attempt = await resolveAttempt(pi);
  if (!attempt) return;
  const now = new Date().toISOString();
  const errorMsg = pi.last_payment_error?.message ?? null;
  await db
    .update(paymentAttemptsTable)
    .set({ status: "failed", stripePaymentIntentId: pi.id, errorMessage: errorMsg, updatedAt: now })
    .where(eq(paymentAttemptsTable.id, attempt.id));

  const unit = await getUnitForAccount(attempt.ownerAccountId);
  if (!unit) return;
  const dollars = (attempt.amountCents / 100).toFixed(2);
  const reason = errorMsg ? `: ${errorMsg}` : "";
  await notifyUnitOwner(
    unit.id,
    `Online payment of $${dollars} for Unit ${unit.unit} failed${reason}. Please retry.`,
    "payment_attempt",
    String(attempt.id),
    "payment_failed",
  );
  await notifyManagers(
    `Online payment of $${dollars} for Unit ${unit.unit} failed${reason}.`,
    "payment_attempt",
    String(attempt.id),
    "payment_failed",
  );
  // Email the owner so they know to retry.
  const orgName = await getOrgName();
  const owners = await getUnitOwners(unit.id);
  for (const o of owners) {
    if (!o.email) continue;
    const html = `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">Payment Failed — Unit ${unit.unit}</h2>
  <p style="color:#555;margin:0 0 16px">${orgName}</p>
  <p style="color:#333">Your online payment of <strong>$${dollars}</strong>${reason ? ` failed${reason}` : " failed"}. Please log in to retry the payment or use a different method.</p>
</div>`;
    await sendEmail(o.email, `Payment failed — Unit ${unit.unit}`, html);
  }
}

async function handleSetupIntentSucceeded(si: Stripe.SetupIntent) {
  const stripe = getStripe();
  if (!stripe) return;
  const pmId = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
  const customerId = typeof si.customer === "string" ? si.customer : si.customer?.id;
  if (!pmId || !customerId) return;
  const [acct] = await db
    .select()
    .from(ownerAccountsTable)
    .where(eq(ownerAccountsTable.stripeCustomerId, customerId));
  if (!acct) return;
  const [existing] = await db
    .select()
    .from(ownerPaymentMethodsTable)
    .where(eq(ownerPaymentMethodsTable.stripePaymentMethodId, pmId));
  if (existing) return;
  const pm = await stripe.paymentMethods.retrieve(pmId);
  const kind = pm.type === "us_bank_account" ? "us_bank_account" : "card";
  const brand = pm.card?.brand ?? pm.us_bank_account?.bank_name ?? null;
  const last4 = pm.card?.last4 ?? pm.us_bank_account?.last4 ?? null;
  await db.insert(ownerPaymentMethodsTable).values({
    ownerAccountId: acct.id,
    stripeCustomerId: customerId,
    stripePaymentMethodId: pmId,
    brand,
    last4,
    kind,
    isAutoPay: false,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Charge.refunded handler. Treats the webhook as the authoritative
 * source for *all* refund-driven ledger writes — whether a refund was
 * issued via the manager UI (which already wrote a tombstone) or
 * externally via the Stripe Dashboard. We compute the delta between
 * `charge.amount_refunded` and our recorded `refundedAmountCents` and
 * write a tombstone for the gap.
 */
async function handleChargeRefunded(charge: Stripe.Charge) {
  const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!piId) return;
  const attempt = await findAttemptByPI(piId);
  if (!attempt) return;
  const stripeRefunded = charge.amount_refunded ?? 0;
  const recorded = attempt.refundedAmountCents ?? 0;
  const totalCharged = attempt.amountCents + attempt.surchargeCents;
  const now = new Date().toISOString();

  // Only the *base* portion of a payment was posted to the ledger; the
  // surcharge was charged in Stripe but never written as a ledger payment.
  // Allocate refunds proportionally between base and surcharge so a refund
  // of just the surcharge does not wrongly credit the HOA ledger, and a
  // partial base refund is reflected correctly even when surcharge is on.
  const baseShare = (cents: number) =>
    totalCharged > 0 ? Math.floor((cents * attempt.amountCents) / totalCharged) : 0;
  const ledgerAppliedSoFar = baseShare(recorded);
  const ledgerAppliedNow = baseShare(stripeRefunded);
  const ledgerDelta = ledgerAppliedNow - ledgerAppliedSoFar;

  if (stripeRefunded <= recorded) {
    // Nothing new to reconcile (duplicate webhook delivery).
    return;
  }

  // Idempotency guard: claim the new refundedAmountCents value first via a
  // conditional update. Only the delivery that successfully advances the
  // counter from `recorded` to `stripeRefunded` is allowed to insert the
  // ledger void row. Concurrent/duplicate deliveries observe a row count of
  // 0 and bail out before writing duplicate financial rows.
  const newStatus =
    stripeRefunded >= totalCharged
      ? "refunded"
      : stripeRefunded > 0
        ? "partially_refunded"
        : attempt.status;
  const claim = await db
    .update(paymentAttemptsTable)
    .set({ refundedAmountCents: stripeRefunded, status: newStatus, updatedAt: now })
    .where(
      and(
        eq(paymentAttemptsTable.id, attempt.id),
        eq(paymentAttemptsTable.refundedAmountCents, recorded),
      ),
    )
    .returning({ id: paymentAttemptsTable.id });
  if (claim.length === 0) return;

  if (ledgerDelta > 0 && attempt.ledgerEntryId) {
    const [origEntry] = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.id, attempt.ledgerEntryId));
    if (origEntry) {
      const isFullBaseRefund = ledgerAppliedNow >= attempt.amountCents;
      // Refund tombstone — a distinct `refund` ledger row that reverses the
      // base-portion delta. Negative amount restores the owner's balance.
      await db.insert(ledgerEntriesTable).values({
        ownerAccountId: origEntry.ownerAccountId,
        occurredOn: now.slice(0, 10),
        postedAt: now,
        kind: "refund",
        chargeType: null,
        paymentMethod: origEntry.paymentMethod,
        amountCents: -ledgerDelta,
        memo: `Stripe refund (${charge.id})`,
        postedBy: 0,
        voidsEntryId: isFullBaseRefund ? origEntry.id : null,
        stripePaymentIntentId: origEntry.stripePaymentIntentId,
        stripeChargeId: charge.id,
        stripeStatus: charge.refunded ? "refunded" : "partially_refunded",
      });
      // For a fully-refunded base payment, also stamp the original payment
      // row with `voidedAt`/`voidedBy=0` (system) so the ledger UI renders
      // the original payment line as voided. The refund row is the actual
      // financial reversal, so this stamping is audit-only — `signedAmount`
      // for a voided payment already returns -amountCents (unchanged), and
      // the refund's negative amountCents adds back the same amount.
      if (isFullBaseRefund && !origEntry.voidedAt) {
        await db
          .update(ledgerEntriesTable)
          .set({ voidedAt: now, voidedBy: 0 })
          .where(eq(ledgerEntriesTable.id, origEntry.id));
      }
    }
  }

  const unit = await getUnitForAccount(attempt.ownerAccountId);
  if (unit) {
    const refundDeltaCents = stripeRefunded - recorded;
    const dollars = (refundDeltaCents / 100).toFixed(2);
    await notifyUnitOwner(
      unit.id,
      `A refund of $${dollars} has been issued to your account.`,
      "payment_attempt",
      String(attempt.id),
      "payment_refunded",
    );
    await notifyManagers(
      `Stripe refund of $${dollars} processed for Unit ${unit.unit}.`,
      "payment_attempt",
      String(attempt.id),
      "payment_refunded",
    );
    const owners = await getUnitOwners(unit.id);
    if (owners.length > 0) {
      const orgName = await getOrgName();
      const html = buildPaymentRefundEmail({
        orgName,
        unitLabel: unit.unit,
        refundCents: refundDeltaCents,
        dateIso: now,
        paymentMethod: paymentMethodLabelFromCharge(charge),
        receiptUrl: charge.receipt_url ?? null,
      });
      const subject = `Refund issued — Unit ${unit.unit}`;
      for (const o of owners) {
        if (!o.email) continue;
        try {
          const result = await sendEmail(o.email, subject, html);
          if (!result.ok) {
            logger.warn(
              { attemptId: attempt.id, to: o.email, error: result.error },
              "Refund email rejected by provider",
            );
          }
        } catch (err) {
          logger.warn(
            { err, attemptId: attempt.id, to: o.email },
            "Failed to send refund email",
          );
        }
      }
    }
  }
}

/**
 * Refund-object events (`charge.refund.updated`, `refund.updated`, `refund.failed`).
 * The event object is a Stripe.Refund, not a Charge — fetch the parent Charge and
 * re-run the charge-level reconciliation so refundedAmountCents stays consistent.
 */
async function handleRefundUpdated(refund: Stripe.Refund) {
  const stripe = getStripe();
  if (!stripe) return;
  const chargeId = typeof refund.charge === "string" ? refund.charge : refund.charge?.id;
  if (!chargeId) return;
  try {
    const charge = await stripe.charges.retrieve(chargeId);
    await handleChargeRefunded(charge);
  } catch (err) {
    logger.warn({ err, chargeId, refundId: refund.id }, "Failed to fetch charge for refund event");
  }
}

async function handleChargeDispute(dispute: Stripe.Dispute, eventType: string) {
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
  if (!chargeId) return;
  const [attempt] = await db
    .select()
    .from(paymentAttemptsTable)
    .where(eq(paymentAttemptsTable.stripeChargeId, chargeId));
  if (!attempt) return;
  const now = new Date().toISOString();
  await db
    .update(paymentAttemptsTable)
    .set({ disputeStatus: dispute.status, updatedAt: now })
    .where(eq(paymentAttemptsTable.id, attempt.id));

  // Flag the underlying ledger payment entry so the unit ledger UI can
  // surface the dispute alongside the payment row.
  if (attempt.ledgerEntryId) {
    await db
      .update(ledgerEntriesTable)
      .set({ stripeStatus: `disputed:${dispute.status}` })
      .where(eq(ledgerEntriesTable.id, attempt.ledgerEntryId));
  }

  const unit = await getUnitForAccount(attempt.ownerAccountId);
  const reason = dispute.reason ?? "unspecified";
  const dollars = (dispute.amount / 100).toFixed(2);
  const unitLabel = unit ? `Unit ${unit.unit}` : `account #${attempt.ownerAccountId}`;
  const verb = eventType === "charge.dispute.created" ? "opened" : `updated (${dispute.status})`;
  await notifyManagers(
    `Stripe dispute ${verb} on ${unitLabel} for $${dollars} (reason: ${reason}). Action required in Stripe Dashboard.`,
    "payment_attempt",
    String(attempt.id),
    "payment_disputed",
  );
}

export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const stripe = getStripe();
  const secret = getWebhookSecret();
  if (!stripe || !secret) {
    res.status(503).json({ error: "Stripe webhooks not configured" });
    return;
  }
  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!sig) {
    res.status(400).json({ error: "Missing signature" });
    return;
  }
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, secret);
  } catch (err) {
    logger.warn({ err }, "Stripe webhook signature verification failed");
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  const claimed = await claimEvent(event.id, event.type);
  if (!claimed) {
    res.json({ received: true, dedup: true });
    return;
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      case "payment_intent.processing":
        await handlePaymentIntentProcessing(event.data.object as Stripe.PaymentIntent);
        break;
      case "payment_intent.payment_failed":
      case "payment_intent.canceled":
        await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      case "setup_intent.succeeded":
        await handleSetupIntentSucceeded(event.data.object as Stripe.SetupIntent);
        break;
      case "charge.refunded":
        await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;
      case "charge.refund.updated":
      case "refund.updated":
      case "refund.failed":
        await handleRefundUpdated(event.data.object as Stripe.Refund);
        break;
      case "charge.dispute.created":
      case "charge.dispute.updated":
        await handleChargeDispute(event.data.object as Stripe.Dispute, event.type);
        break;
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    try {
      await db
        .delete(stripeEventsProcessedTable)
        .where(eq(stripeEventsProcessedTable.stripeEventId, event.id));
    } catch (delErr) {
      logger.error({ delErr }, "Failed to roll back stripe_events_processed claim");
    }
    logger.error({ err, eventType: event.type }, "Error processing Stripe webhook");
    res.status(500).json({ error: "Webhook handler error" });
  }
}
