// Task #78: Trash & bulk-pickup schedule helpers.
//
// Maintains a recurring weekly trash event and a recurring weekly recycling
// event on the Amenities sub-calendar (idempotent). Holiday shifts in
// trash_holiday_shifts are applied as one-off overrides on the recurring
// base events so the materialized calendar reflects "Thursday pickup moves
// to Friday after Thanksgiving" without admin hand-editing.

import { db } from "@workspace/db";
import {
  calendarEventsTable,
  calendarSubCalendarsTable,
  trashHolidayShiftsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

const WEEKDAY_NUM: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

const TRASH_DEFAULTS = [
  {
    slot: "trash_weekly",
    title: "Trash pickup",
    weekday: "tue",
    body: "Curbside trash collection. Place bins out the night before.",
  },
  {
    slot: "recycling_weekly",
    title: "Recycling pickup",
    weekday: "thu",
    body: "Recycling collection. Place bins out the night before.",
  },
];

function nowISO() { return new Date().toISOString(); }

function nextDateForWeekday(weekday: number, ref: Date = new Date()): string {
  const d = new Date(ref);
  d.setUTCHours(0, 0, 0, 0);
  const diff = (weekday - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function getAmenitiesSubId(): Promise<number | null> {
  const [row] = await db.select().from(calendarSubCalendarsTable).where(eq(calendarSubCalendarsTable.slug, "amenities"));
  return row?.id ?? null;
}

/**
 * Ensure both default trash + recycling weekly recurring events exist on
 * the Amenities sub-calendar. Idempotent — re-running has no effect if the
 * source-tagged events already exist.
 */
export async function ensureTrashSchedule(): Promise<void> {
  const subId = await getAmenitiesSubId();
  if (subId == null) {
    logger.warn("ensureTrashSchedule: amenities sub-calendar missing");
    return;
  }
  for (const def of TRASH_DEFAULTS) {
    const tag = `trash:${def.slot}`;
    const existing = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.source, tag));
    if (existing.length > 0) continue;
    const wd = WEEKDAY_NUM[def.weekday];
    const start = nextDateForWeekday(wd);
    const now = nowISO();
    await db.insert(calendarEventsTable).values({
      subCalendarId: subId,
      title: def.title,
      body: def.body,
      startsAt: start,
      endsAt: start,
      allDay: true,
      locationText: null,
      locationUrl: null,
      capacity: null,
      perUnitCap: null,
      recurrence: { freq: "WEEKLY", interval: 1 },
      exceptions: [],
      overrides: [],
      source: tag,
      sourceRefType: "trash",
      sourceRefId: def.slot,
      externalUid: null,
      cancelled: false,
      createdByUserId: null,
      createdByName: "system",
      createdAt: now,
      updatedAt: now,
    });
  }
  await applyHolidayShifts();
}

/**
 * Recompute holiday shift overrides on the trash+recycling recurring events.
 * Strategy: for each holiday in trash_holiday_shifts, walk the affected week
 * and add an override entry { originalDate, startsAt, endsAt } on each
 * matching recurring event when its scheduled day falls on or after the
 * holiday. The override moves that single instance by `shiftDays`.
 */
export async function applyHolidayShifts(): Promise<void> {
  const subId = await getAmenitiesSubId();
  if (subId == null) return;
  const shifts = await db.select().from(trashHolidayShiftsTable);
  if (shifts.length === 0) {
    // Clear holiday-derived overrides on trash events
    const trashEvents = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.sourceRefType, "trash"));
    for (const ev of trashEvents) {
      const cleaned = (ev.overrides ?? []).filter((o) => !(o as any).holidayShift);
      if (cleaned.length !== (ev.overrides ?? []).length) {
        await db.update(calendarEventsTable).set({ overrides: cleaned, updatedAt: nowISO() }).where(eq(calendarEventsTable.id, ev.id));
      }
    }
    return;
  }
  const trashEvents = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.sourceRefType, "trash"));
  for (const ev of trashEvents) {
    const recurring = ev.recurrence as { freq: string; interval?: number } | null;
    if (!recurring || recurring.freq !== "WEEKLY") continue;
    const baseStart = ev.startsAt; // YYYY-MM-DD anchor; same weekday repeats
    const eventWeekday = new Date(baseStart + "T00:00:00Z").getUTCDay();
    const overrides: Array<Record<string, unknown>> = (ev.overrides ?? []).filter((o) => !(o as any).holidayShift);
    for (const sh of shifts) {
      const filter = sh.weekdays.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
      if (filter.length > 0) {
        const allowed = filter.map((w) => WEEKDAY_NUM[w]).filter((n) => n !== undefined);
        if (!allowed.includes(eventWeekday)) continue;
      }
      // Find the next pickup day at or after the holiday in the same week.
      const holiday = new Date(sh.holidayDate + "T00:00:00Z");
      const holidayWeekday = holiday.getUTCDay();
      // The pickup day in the holiday's week
      const dayDiff = (eventWeekday - holidayWeekday + 7) % 7;
      const pickupInHolidayWeek = addDaysIso(sh.holidayDate, dayDiff);
      // Skip pickups before the holiday
      if (pickupInHolidayWeek < sh.holidayDate) continue;
      const shifted = addDaysIso(pickupInHolidayWeek, sh.shiftDays);
      overrides.push({
        originalDate: pickupInHolidayWeek,
        startsAt: shifted,
        endsAt: shifted,
        title: `${ev.title} (shifted for ${sh.label})`,
        holidayShift: true,
      });
    }
    await db.update(calendarEventsTable).set({ overrides: overrides as any, updatedAt: nowISO() }).where(eq(calendarEventsTable.id, ev.id));
  }
}
