// Task #77: Mark confirmed bookings as "used" once their end time has passed,
// and forfeit pending_payment bookings that go unpaid for >2h.
// Task #82: Evaluate pool-tag delinquency suspensions.
// Task #83: Confirmed bookings transition to "used_pending_inspection" instead
// of "used" when they end. After 72 hours without a post-inspection, they are
// auto-finalized to "used" (deposit treated as released) so the lifecycle does
// not stall indefinitely.

import { db } from "@workspace/db";
import {
  amenityBookingsTable,
  amenityBookingAuditTable,
  poolTagsTable,
  ledgerEntriesTable,
  ownerAccountsTable,
  amenityDepositLedgerTable,
  amenitiesTable,
  amenityCertificatesTable,
  amenityRequiredPostingsTable,
  amenityPostingIssuancesTable,
  amenityIncidentReportsTable,
  amenityIncidentAuditTable,
  organizationSettingsTable,
  usersTable,
} from "@workspace/db/schema";
import { and, eq, lt, or, ne } from "drizzle-orm";
import { logger } from "./logger.js";
import { recordAudit, revokeAccessForBooking } from "./amenityAccess.js";
import { sendEmail } from "./email.js";

// Compute remaining open charges per unit using FIFO allocation; if any
// unpaid charge is older than 30 days the unit is delinquent.
async function computeDelinquentUnitIds(): Promise<Set<string>> {
  const entries = await db.select().from(ledgerEntriesTable);
  const accounts = await db.select().from(ownerAccountsTable);
  const accountToUnit = new Map<number, string>();
  for (const a of accounts) accountToUnit.set(a.id, a.unitId);
  const byUnit = new Map<string, typeof entries>();
  for (const e of entries) {
    const unitId = accountToUnit.get(e.ownerAccountId);
    if (!unitId) continue;
    const list = byUnit.get(unitId) ?? [];
    list.push(e);
    byUnit.set(unitId, list);
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const out = new Set<string>();
  for (const [unitId, rows] of byUnit) {
    rows.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
    type Charge = { occurredOn: string; remaining: number };
    const openCharges: Charge[] = [];
    let credit = 0;
    const applyCredit = (amount: number) => {
      let r = amount;
      for (const c of openCharges) { if (r <= 0) break; if (c.remaining <= 0) continue; const take = Math.min(c.remaining, r); c.remaining -= take; r -= take; }
      credit += r;
    };
    const consumeCredit = (amount: number) => { const take = Math.min(credit, amount); credit -= take; return amount - take; };
    for (const e of rows) {
      if (e.kind === "charge") { const after = consumeCredit(e.amountCents); if (after > 0) openCharges.push({ occurredOn: e.occurredOn, remaining: after }); }
      else if (e.kind === "payment") applyCredit(e.amountCents);
      else if (e.kind === "void" || e.kind === "refund") { const r = -e.amountCents; if (r < 0) applyCredit(-r); else openCharges.push({ occurredOn: e.occurredOn, remaining: r }); }
    }
    if (openCharges.some((c) => c.remaining > 0 && c.occurredOn <= cutoffIso)) out.add(unitId);
  }
  return out;
}

async function evaluatePoolTagDelinquency(): Promise<void> {
  const delinquent = await computeDelinquentUnitIds();
  const tags = await db.select().from(poolTagsTable);
  for (const t of tags) {
    const isDelq = delinquent.has(t.unitId);
    if (isDelq && t.status === "active") {
      await db.update(poolTagsTable).set({
        status: "suspended",
        suspendedReason: "delinquency_auto",
        suspendedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).where(eq(poolTagsTable.id, t.id));
      await recordAudit({ amenityId: null, action: "pool_tag_auto_suspend", success: true, message: `Unit ${t.unitId} delinquent` });
    } else if (!isDelq && t.status === "suspended" && t.suspendedReason === "delinquency_auto") {
      await db.update(poolTagsTable).set({
        status: "active",
        suspendedReason: "",
        suspendedAt: null,
        updatedAt: new Date().toISOString(),
      }).where(eq(poolTagsTable.id, t.id));
      await recordAudit({ amenityId: null, action: "pool_tag_auto_restore", success: true, message: `Unit ${t.unitId} cured` });
    }
  }
}

// Task #82: Auto-revoke access codes for bookings that overlap a new
// blackout window. We piggy-back on the scheduler tick.
async function autoExpireAccessCodes(): Promise<void> {
  const nowIso = new Date().toISOString();
  const stale = await db
    .select()
    .from(amenityBookingsTable)
    .where(or(eq(amenityBookingsTable.status, "cancelled"), eq(amenityBookingsTable.status, "refunded"), eq(amenityBookingsTable.status, "forfeited")));
  for (const b of stale) {
    await revokeAccessForBooking(b.id, "booking ended/cancelled", { id: null, name: "system" });
  }
  void nowIso;
}

const TICK_MS = 5 * 60 * 1000;
const AUTO_FINALIZE_HOURS = 72;

export function startAmenityScheduler(): void {
  const tick = async () => {
    try {
      const now = new Date();
      const nowIso = now.toISOString();
      const stalePayCutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
      const autoFinalizeCutoff = new Date(now.getTime() - AUTO_FINALIZE_HOURS * 60 * 60 * 1000).toISOString();

      // Confirmed bookings whose end time passed → used_pending_inspection.
      const pending = await db
        .update(amenityBookingsTable)
        .set({ status: "used_pending_inspection", updatedAt: nowIso })
        .where(and(eq(amenityBookingsTable.status, "confirmed"), lt(amenityBookingsTable.endsAt, nowIso)))
        .returning();
      for (const b of pending) {
        await db.insert(amenityBookingAuditTable).values({
          bookingId: b.id, action: "ended_pending_inspection", actorUserId: null, actorName: "system", diff: null, createdAt: nowIso,
        });
      }

      // Auto-finalize bookings that have been pending inspection for >72h.
      const used = await db
        .update(amenityBookingsTable)
        .set({ status: "used", updatedAt: nowIso })
        .where(and(
          eq(amenityBookingsTable.status, "used_pending_inspection"),
          lt(amenityBookingsTable.endsAt, autoFinalizeCutoff),
        ))
        .returning();
      for (const b of used) {
        await db.insert(amenityBookingAuditTable).values({
          bookingId: b.id, action: "auto_finalized", actorUserId: null, actorName: "system",
          diff: { reason: `no inspection within ${AUTO_FINALIZE_HOURS}h` }, createdAt: nowIso,
        });
        if (b.depositCents > 0 && b.depositPaidAt && !b.depositRefundedAt) {
          await db.insert(amenityDepositLedgerTable).values({
            bookingId: b.id, kind: "released", amountCents: b.depositCents,
            balanceCents: 0, reason: "auto-released after inspection window",
            actorUserId: null, actorName: "system", createdAt: nowIso,
          });
        }
      }

      // Pending-payment older than 2h → forfeited.
      const forfeit = await db
        .update(amenityBookingsTable)
        .set({ status: "forfeited", updatedAt: nowIso })
        .where(and(eq(amenityBookingsTable.status, "pending_payment"), lt(amenityBookingsTable.createdAt, stalePayCutoff)))
        .returning();
      for (const b of forfeit) {
        await db.insert(amenityBookingAuditTable).values({
          bookingId: b.id, action: "forfeited", actorUserId: null, actorName: "system", diff: { reason: "unpaid >2h" }, createdAt: nowIso,
        });
      }

      if (pending.length || used.length || forfeit.length) {
        logger.info({ pending: pending.length, used: used.length, forfeit: forfeit.length }, "Amenity scheduler tick");
      }

      // Task #82: revoke access codes whose bookings have ended/been cancelled.
      await autoExpireAccessCodes();
      // Task #82: pool-tag delinquency evaluation.
      await evaluatePoolTagDelinquency();
      // Task #89: compliance expiry notifications + overdue follow-ups.
      await evaluateAmenityCompliance(now);
    } catch (err) {
      logger.error({ err }, "Amenity scheduler tick failed");
    }
  };
  // Avoid TS lint about unused export
  void or;
  setTimeout(tick, 30_000);
  setInterval(tick, TICK_MS);
}

// ── Task #89: notify managers when amenity certificates / postings expire
// in <=30d, when an annual cycle is overdue, and when an open major
// incident's follow-up date passes. State is kept in
// amenity_incident_audit (action prefixed with `notify_`) for incidents,
// and a per-day in-memory dedupe Set for cert/posting expiries (resets on
// process restart — over-firing once a day is acceptable).
const AMBER_DAYS = 30;
const expiryNotifiedToday = new Set<string>();
let expiryNotifiedDay = "";

async function listManagerEmails(): Promise<string[]> {
  const rows = await db.select().from(usersTable).where(ne(usersTable.role, "resident"));
  return rows.filter((u) => !u.pending && u.email).map((u) => u.email);
}

async function evaluateAmenityCompliance(now: Date): Promise<void> {
  const today = now.toISOString().slice(0, 10);
  if (today !== expiryNotifiedDay) {
    expiryNotifiedToday.clear();
    expiryNotifiedDay = today;
  }
  const amenities = await db.select().from(amenitiesTable);
  const amenityById = new Map(amenities.map((a) => [a.id, a]));

  // Cert expiry
  const certs = await db.select().from(amenityCertificatesTable);
  for (const cert of certs) {
    if (!cert.expiresOn) continue;
    const days = Math.round(
      (new Date(cert.expiresOn).getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (days < 0 || days > AMBER_DAYS) continue;
    const dedupe = `cert:${cert.id}:${today}`;
    if (expiryNotifiedToday.has(dedupe)) continue;
    expiryNotifiedToday.add(dedupe);
    const a = amenityById.get(cert.amenityId);
    if (!a) continue;
    const recipients = await listManagerEmails();
    const subj = `[Compliance] ${cert.title} for ${a.name} expires in ${days}d`;
    const body = `<p>The certificate <strong>${cert.title}</strong> (${cert.kind}) for amenity <strong>${a.name}</strong> expires on <strong>${cert.expiresOn}</strong> (${days} day${days === 1 ? "" : "s"} away).</p><p>Open Settings → Amenity Compliance to renew.</p>`;
    for (const r of recipients) await sendEmail(r, subj, body).catch(() => {});
  }

  // Posting issuance expiry (active issuances with replaceEveryDays > 0)
  const postings = await db.select().from(amenityRequiredPostingsTable);
  const postingById = new Map(postings.map((p) => [p.id, p]));
  const issuances = await db.select().from(amenityPostingIssuancesTable);
  for (const i of issuances) {
    if (i.status !== "active") continue;
    let expiresAt = i.expiresAt;
    const p = postingById.get(i.postingId);
    if (!expiresAt && p && p.replaceEveryDays > 0) {
      const d = new Date(i.postedAt);
      d.setUTCDate(d.getUTCDate() + p.replaceEveryDays);
      expiresAt = d.toISOString();
    }
    if (!expiresAt) continue;
    const days = Math.round(
      (new Date(expiresAt).getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (days < 0 || days > AMBER_DAYS) continue;
    const dedupe = `issuance:${i.id}:${today}`;
    if (expiryNotifiedToday.has(dedupe)) continue;
    expiryNotifiedToday.add(dedupe);
    const a = amenityById.get(i.amenityId);
    if (!a || !p) continue;
    const recipients = await listManagerEmails();
    const subj = `[Compliance] Posting "${p.title}" at ${a.name} needs replacement in ${days}d`;
    const body = `<p>The posted copy of <strong>${p.title}</strong> at <strong>${a.name}</strong> is due for replacement on <strong>${expiresAt.slice(0, 10)}</strong>.</p>`;
    for (const r of recipients) await sendEmail(r, subj, body).catch(() => {});
  }

  // Incident follow-up due (open/follow_up incidents)
  const incidents = await db.select().from(amenityIncidentReportsTable);
  for (const inc of incidents) {
    if (inc.status === "closed" || !inc.followUpDueOn) continue;
    if (inc.followUpDueOn > today) continue;
    const dedupe = `incident:${inc.id}:${today}`;
    const audit = await db.select().from(amenityIncidentAuditTable)
      .where(eq(amenityIncidentAuditTable.incidentId, inc.id));
    if (audit.some((a) => a.action === `notify_followup_${today}`)) continue;
    if (expiryNotifiedToday.has(dedupe)) continue;
    expiryNotifiedToday.add(dedupe);
    const a = amenityById.get(inc.amenityId);
    if (!a) continue;
    const recipients = await listManagerEmails();
    const subj = `[Compliance] Incident #${inc.id} at ${a.name} follow-up due`;
    const body = `<p>Incident <strong>#${inc.id}</strong> (${inc.kind}, ${inc.severity}) at <strong>${a.name}</strong> has a follow-up scheduled for <strong>${inc.followUpDueOn}</strong>.</p>`;
    for (const r of recipients) await sendEmail(r, subj, body).catch(() => {});
    await db.insert(amenityIncidentAuditTable).values({
      incidentId: inc.id, action: `notify_followup_${today}`,
      actorUserId: null, actorName: "system", diff: null, createdAt: now.toISOString(),
    });
  }
}
