// Task #76: Calendar materializer.
//
// Upserts/cancels calendar events that mirror domain records (assessments,
// special assessments, budget cycles, reserve projects, compliance items,
// violations, hearings, ACC requests). Each event is tagged with
// (sourceRefType, sourceRefId, source) so writes are idempotent: re-running
// a materializer for the same source updates the existing event in place.
//
// Owner-scoped events set ownerUserId so they appear only on that owner's
// private timeline endpoint (/calendar/me/timeline) — never broadly visible
// even if the sub-calendar is otherwise viewable.

import { db } from "@workspace/db";
import {
  calendarEventsTable,
  calendarEventRemindersTable,
  calendarEventAuditTable,
  calendarSubCalendarsTable,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger.js";

const ALLOWED_LEADS = new Set([15, 60, 1440, 4320, 10080, 43200]);

export type SubSlug =
  | "operations" | "financial" | "compliance" | "board"
  | "committees" | "community" | "amenities" | "external"
  // Task #78: notices sub-calendar surfaces statutory notices
  | "notices";

export interface MaterializeInput {
  subSlug: SubSlug;
  sourceRefType: string;
  sourceRefId: string;
  // Slot key for sources that emit multiple events (e.g. milestones).
  // Combined with sourceRefId in the source tag for uniqueness.
  slot?: string;
  title: string;
  body?: string;
  startsAt: string; // ISO or YYYY-MM-DD
  endsAt?: string;
  allDay?: boolean;
  locationText?: string | null;
  locationUrl?: string | null;
  ownerUserId?: number | null;
  reminderLeadsMinutes?: number[];
  cancelled?: boolean;
}

function nowISO() { return new Date().toISOString(); }

function isDateOnly(s: string) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }

async function getSubCalendarId(slug: SubSlug): Promise<number | null> {
  const [row] = await db.select().from(calendarSubCalendarsTable).where(eq(calendarSubCalendarsTable.slug, slug));
  return row?.id ?? null;
}

function sourceTag(refType: string, refId: string, slot?: string) {
  return slot ? `${refType}:${refId}:${slot}` : `${refType}:${refId}`;
}

/**
 * Upsert a calendar event for a domain record. Returns the resulting event id,
 * or null if the materialization was skipped (e.g. missing sub-calendar).
 */
export async function upsertEvent(input: MaterializeInput): Promise<number | null> {
  const subId = await getSubCalendarId(input.subSlug);
  if (subId == null) {
    logger.warn({ slug: input.subSlug }, "calendarMaterializer: sub-calendar missing");
    return null;
  }
  const allDay = input.allDay ?? isDateOnly(input.startsAt);
  const startsAt = input.startsAt;
  const endsAt = input.endsAt ?? input.startsAt;
  const tag = sourceTag(input.sourceRefType, input.sourceRefId, input.slot);

  const existingRows = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.source, tag));
  const existing = existingRows[0];
  const now = nowISO();

  if (existing) {
    await db.update(calendarEventsTable).set({
      subCalendarId: subId,
      title: input.title.slice(0, 240),
      body: (input.body ?? "").slice(0, 10000),
      startsAt,
      endsAt,
      allDay,
      locationText: input.locationText ?? null,
      locationUrl: input.locationUrl ?? null,
      ownerUserId: input.ownerUserId ?? null,
      cancelled: input.cancelled === true,
      updatedAt: now,
    }).where(eq(calendarEventsTable.id, existing.id));
    await db.insert(calendarEventAuditTable).values({
      eventId: existing.id, action: input.cancelled ? "cancelled" : "updated",
      actorUserId: null, actorName: "system", diff: { source: tag, startsAt, endsAt }, createdAt: now,
    });
    if (!input.cancelled) {
      await syncReminders(existing.id, startsAt, input.reminderLeadsMinutes ?? []);
    }
    return existing.id;
  }

  if (input.cancelled) return null;
  const [row] = await db.insert(calendarEventsTable).values({
    subCalendarId: subId,
    title: input.title.slice(0, 240),
    body: (input.body ?? "").slice(0, 10000),
    startsAt,
    endsAt,
    allDay,
    locationText: input.locationText ?? null,
    locationUrl: input.locationUrl ?? null,
    recurrence: null,
    exceptions: [],
    overrides: [],
    source: tag,
    sourceRefType: input.sourceRefType,
    sourceRefId: input.sourceRefId,
    externalUid: null,
    ownerUserId: input.ownerUserId ?? null,
    cancelled: false,
    createdByUserId: null,
    createdByName: "system",
    createdAt: now,
    updatedAt: now,
  }).returning();

  await db.insert(calendarEventAuditTable).values({
    eventId: row.id, action: "created", actorUserId: null, actorName: "system",
    diff: { source: tag, title: row.title }, createdAt: now,
  });
  await syncReminders(row.id, startsAt, input.reminderLeadsMinutes ?? []);
  return row.id;
}

async function syncReminders(eventId: number, instanceStartsAt: string, leads: number[]) {
  const valid = leads.filter((l) => ALLOWED_LEADS.has(l));
  // Replace existing system reminders (userId IS NULL) for this event.
  await db.delete(calendarEventRemindersTable).where(eq(calendarEventRemindersTable.eventId, eventId));
  const now = nowISO();
  for (const lead of valid) {
    await db.insert(calendarEventRemindersTable).values({
      eventId,
      instanceStartsAt,
      leadMinutes: lead,
      channelInApp: true,
      channelEmail: true,
      channelSms: false,
      userId: null,
      dispatchedAt: null,
      createdAt: now,
    });
  }
}

/**
 * Cancel (soft-delete) all events whose source begins with this refType:refId.
 * Useful when a domain record is deleted and all its slot events should clear.
 */
export async function cancelEventsForSource(sourceRefType: string, sourceRefId: string): Promise<void> {
  const prefix = `${sourceRefType}:${sourceRefId}`;
  const rows = await db.select().from(calendarEventsTable).where(
    and(
      eq(calendarEventsTable.sourceRefType, sourceRefType),
      eq(calendarEventsTable.sourceRefId, sourceRefId),
    ),
  );
  const now = nowISO();
  for (const r of rows) {
    if (r.cancelled) continue;
    await db.update(calendarEventsTable).set({ cancelled: true, updatedAt: now }).where(eq(calendarEventsTable.id, r.id));
    await db.insert(calendarEventAuditTable).values({
      eventId: r.id, action: "cancelled", actorUserId: null, actorName: "system",
      diff: { source: r.source ?? prefix }, createdAt: now,
    });
  }
}

// ── Domain-specific materializers ────────────────────────────────────────

export interface MilestoneSpec { slot: string; title: string; date: string | null | undefined; reminderLeadsMinutes?: number[]; locationText?: string | null }

/**
 * Helper: materialize a set of milestone slots for a single domain record.
 * Slots whose date is null/undefined are cancelled.
 */
export async function syncMilestones(
  subSlug: SubSlug,
  sourceRefType: string,
  sourceRefId: string,
  milestones: MilestoneSpec[],
  baseTitle: string,
  body: string = "",
  ownerUserId: number | null = null,
): Promise<void> {
  for (const m of milestones) {
    if (!m.date) {
      await cancelSlot(sourceRefType, sourceRefId, m.slot);
      continue;
    }
    await upsertEvent({
      subSlug,
      sourceRefType,
      sourceRefId,
      slot: m.slot,
      title: `${baseTitle} — ${m.title}`,
      body,
      startsAt: m.date,
      ownerUserId,
      reminderLeadsMinutes: m.reminderLeadsMinutes ?? [10080, 1440],
      locationText: m.locationText ?? null,
    });
  }
}

async function cancelSlot(sourceRefType: string, sourceRefId: string, slot: string) {
  const tag = `${sourceRefType}:${sourceRefId}:${slot}`;
  const [existing] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.source, tag));
  if (!existing || existing.cancelled) return;
  const now = nowISO();
  await db.update(calendarEventsTable).set({ cancelled: true, updatedAt: now }).where(eq(calendarEventsTable.id, existing.id));
  await db.insert(calendarEventAuditTable).values({
    eventId: existing.id, action: "cancelled", actorUserId: null, actorName: "system",
    diff: { source: tag }, createdAt: now,
  });
}
