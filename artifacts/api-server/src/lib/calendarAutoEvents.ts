// Task #93: Auto-create calendar events from board motions, insurance
// policies, and bid requests. Events are linked to their source object via
// (sourceRefType, sourceRefId) and upserted idempotently. When a source
// object changes, the event is updated; when it is withdrawn / cancelled /
// deleted, the event is cancelled.
//
// Slug -> sub-calendar mapping:
//   motions       -> "board"
//   insurance     -> "compliance"
//   bid open/close-> "operations"

import { db } from "@workspace/db";
import {
  calendarEventsTable,
  calendarSubCalendarsTable,
  motionsTable,
  insurancePoliciesTable,
  bidRequestsTable,
  bidInvitationsTable,
} from "@workspace/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { logger } from "./logger.js";

const SOURCE_REF_MOTION = "motion";
const SOURCE_REF_INSURANCE = "insurance_policy";
const SOURCE_REF_BID_OPEN = "bid_request_open";
const SOURCE_REF_BID_CLOSE = "bid_request_close";

async function getSubIdBySlug(slug: string): Promise<number | null> {
  const [s] = await db
    .select()
    .from(calendarSubCalendarsTable)
    .where(eq(calendarSubCalendarsTable.slug, slug));
  return s?.id ?? null;
}

type UpsertArgs = {
  subCalendarId: number;
  sourceRefType: string;
  sourceRefId: string;
  source: string;
  title: string;
  body: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  locationText?: string | null;
  cancelled: boolean;
};

async function upsertEvent(a: UpsertArgs): Promise<void> {
  const now = new Date().toISOString();
  const [existing] = await db
    .select()
    .from(calendarEventsTable)
    .where(
      and(
        eq(calendarEventsTable.sourceRefType, a.sourceRefType),
        eq(calendarEventsTable.sourceRefId, a.sourceRefId),
      ),
    );
  if (existing) {
    const changed =
      existing.title !== a.title ||
      existing.body !== a.body ||
      existing.startsAt !== a.startsAt ||
      existing.endsAt !== a.endsAt ||
      existing.allDay !== a.allDay ||
      (existing.locationText ?? null) !== (a.locationText ?? null) ||
      existing.cancelled !== a.cancelled ||
      existing.subCalendarId !== a.subCalendarId ||
      existing.source !== a.source;
    if (!changed) return;
    await db
      .update(calendarEventsTable)
      .set({
        subCalendarId: a.subCalendarId,
        title: a.title,
        body: a.body,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        allDay: a.allDay,
        locationText: a.locationText ?? null,
        cancelled: a.cancelled,
        source: a.source,
        updatedAt: now,
      })
      .where(eq(calendarEventsTable.id, existing.id));
  } else {
    await db.insert(calendarEventsTable).values({
      subCalendarId: a.subCalendarId,
      title: a.title,
      body: a.body,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      allDay: a.allDay,
      locationText: a.locationText ?? null,
      locationUrl: null,
      recurrence: null,
      exceptions: [],
      overrides: [],
      source: a.source,
      sourceRefType: a.sourceRefType,
      sourceRefId: a.sourceRefId,
      externalUid: null,
      cancelled: a.cancelled,
      createdByUserId: null,
      createdByName: "System",
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function pruneOrphanEvents(
  sourceRefType: string,
  validIds: Set<string>,
): Promise<void> {
  const events = await db
    .select()
    .from(calendarEventsTable)
    .where(eq(calendarEventsTable.sourceRefType, sourceRefType));
  const now = new Date().toISOString();
  for (const e of events) {
    if (!e.sourceRefId) continue;
    if (!validIds.has(e.sourceRefId) && !e.cancelled) {
      await db
        .update(calendarEventsTable)
        .set({ cancelled: true, updatedAt: now })
        .where(eq(calendarEventsTable.id, e.id));
    }
  }
}

function isValidIso(s: string | null | undefined): s is string {
  if (!s) return false;
  const t = new Date(s).getTime();
  return !Number.isNaN(t);
}

// ── Motions → "board" sub-calendar ──────────────────────────────────────────
async function syncMotionsToCalendar(): Promise<void> {
  const subId = await getSubIdBySlug("board");
  if (!subId) return;
  const motions = await db.select().from(motionsTable);
  const validIds = new Set<string>();
  for (const m of motions) {
    if (!isValidIso(m.closesAt)) continue;
    const refId = String(m.id);
    validIds.add(refId);
    const startsAt = m.closesAt!;
    const endsAt = new Date(new Date(startsAt).getTime() + 30 * 60_000).toISOString();
    // Withdrawn motions never happened — cancel the event. Adopted, rejected,
    // and expired are real outcomes — keep the event as a record. Drafts and
    // open motions also keep the event so reminders fire.
    const cancelled = m.status === "withdrawn";
    const statusTag =
      m.status === "open" || m.status === "draft"
        ? "Closes"
        : `Closed — ${m.status}`;
    const title = `Motion ${statusTag}: ${m.title}`;
    await upsertEvent({
      subCalendarId: subId,
      sourceRefType: SOURCE_REF_MOTION,
      sourceRefId: refId,
      source: `motion:${m.id}`,
      title,
      body: m.body ?? "",
      startsAt,
      endsAt,
      allDay: false,
      cancelled,
    });
  }
  await pruneOrphanEvents(SOURCE_REF_MOTION, validIds);
}

// ── Insurance policies → "compliance" sub-calendar ──────────────────────────
async function syncInsuranceToCalendar(): Promise<void> {
  const subId = await getSubIdBySlug("compliance");
  if (!subId) return;
  const policies = await db.select().from(insurancePoliciesTable);
  const validIds = new Set<string>();
  for (const p of policies) {
    // expires is stored as YYYY-MM-DD (or "—" placeholder). Skip non-dates.
    const expires = p.expires;
    if (!expires || !/^\d{4}-\d{2}-\d{2}$/.test(expires)) continue;
    const refId = String(p.id);
    validIds.add(refId);
    const title = `Insurance expires — Building ${p.building} (${p.carrier})`;
    const body =
      `Policy ${p.policyNo} from ${p.carrier} expires on ${expires}. ` +
      `Coverage: $${p.coverage.toLocaleString()}. Renew before this date to avoid a lapse.`;
    await upsertEvent({
      subCalendarId: subId,
      sourceRefType: SOURCE_REF_INSURANCE,
      sourceRefId: refId,
      source: `insurance_policy:${p.id}`,
      title,
      body,
      // All-day: same date for start and end.
      startsAt: expires,
      endsAt: expires,
      allDay: true,
      cancelled: false,
    });
  }
  await pruneOrphanEvents(SOURCE_REF_INSURANCE, validIds);
}

// ── Bid requests → "operations" sub-calendar (open + close milestones) ──────
async function syncBidsToCalendar(): Promise<void> {
  const subId = await getSubIdBySlug("operations");
  if (!subId) return;
  const bids = await db.select().from(bidRequestsTable);
  const openIds = new Set<string>();
  const closeIds = new Set<string>();
  for (const b of bids) {
    const refId = String(b.id);
    // The bid "open" milestone is the moment the bid was actually sent to
    // vendors (status transitions draft → open via /bids/:id/send), not the
    // createdAt of the draft. We infer the send time from the earliest
    // bid_invitations.invitedAt, which the send hook stamps with nowISO().
    // For drafts (or sent bids that have since been cancelled or reverted),
    // we cancel both linked events so the calendar reflects reality.
    const isCancelled = b.status === "cancelled";
    const isDraft = b.status === "draft";
    const eventsCancelled = isDraft || isCancelled;

    let openTimestamp: string | null = null;
    if (!isDraft) {
      const [firstInv] = await db
        .select()
        .from(bidInvitationsTable)
        .where(eq(bidInvitationsTable.bidRequestId, b.id))
        .orderBy(asc(bidInvitationsTable.invitedAt))
        .limit(1);
      if (firstInv && isValidIso(firstInv.invitedAt)) {
        openTimestamp = firstInv.invitedAt;
      }
    }

    if (openTimestamp || eventsCancelled) {
      // Even when cancelled, we need a stable startsAt for the existing
      // event row. Fall back to deadline or createdAt only as a last resort
      // so the row remains addressable; it will be marked cancelled.
      const fallback = isValidIso(b.deadline)
        ? b.deadline
        : isValidIso(b.createdAt)
          ? b.createdAt
          : null;
      const startsAt = openTimestamp ?? fallback;
      if (startsAt) {
        openIds.add(refId);
        const endsAt = new Date(new Date(startsAt).getTime() + 30 * 60_000).toISOString();
        await upsertEvent({
          subCalendarId: subId,
          sourceRefType: SOURCE_REF_BID_OPEN,
          sourceRefId: refId,
          source: `bid_request:${b.id}`,
          title: `Bid opened: ${b.title}`,
          body: `${b.tradeCategory} — bid invitations sent. Deadline: ${b.deadline}.`,
          startsAt,
          endsAt,
          allDay: false,
          cancelled: eventsCancelled,
        });
      }
    }

    // Bid "close" milestone = deadline. Cancelled when the bid is in draft
    // (not yet sent) or has been explicitly cancelled.
    if (isValidIso(b.deadline)) {
      closeIds.add(refId);
      const startsAt = b.deadline;
      const endsAt = new Date(new Date(startsAt).getTime() + 30 * 60_000).toISOString();
      const statusTag =
        b.status === "awarded"
          ? "Awarded"
          : b.status === "closed"
            ? "Closed"
            : b.status === "cancelled"
              ? "Cancelled"
              : "Closes";
      await upsertEvent({
        subCalendarId: subId,
        sourceRefType: SOURCE_REF_BID_CLOSE,
        sourceRefId: refId,
        source: `bid_request:${b.id}`,
        title: `Bid ${statusTag}: ${b.title}`,
        body: `${b.tradeCategory} — quotes due ${b.deadline}.`,
        startsAt,
        endsAt,
        allDay: false,
        cancelled: eventsCancelled,
      });
    }
  }
  await pruneOrphanEvents(SOURCE_REF_BID_OPEN, openIds);
  await pruneOrphanEvents(SOURCE_REF_BID_CLOSE, closeIds);
}

export async function syncAutoCalendarEvents(): Promise<void> {
  try {
    await syncMotionsToCalendar();
  } catch (err) {
    logger.error({ err }, "Calendar auto-events: motions sync failed");
  }
  try {
    await syncInsuranceToCalendar();
  } catch (err) {
    logger.error({ err }, "Calendar auto-events: insurance sync failed");
  }
  try {
    await syncBidsToCalendar();
  } catch (err) {
    logger.error({ err }, "Calendar auto-events: bids sync failed");
  }
}
