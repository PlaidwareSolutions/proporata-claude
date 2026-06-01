// Task #74: Calendar reminders + external feed refresh schedulers.
//
// • Reminders: tick every minute, find reminders whose
//   (instance_starts_at - lead_minutes) is now-ish, dispatch in-app + email.
//   Email respects quiet hours (10pm–7am America/Chicago). SMS is gated
//   behind a feature flag (CAL_SMS_ENABLED) — wiring exists, no provider.
// • External feed refresh: tick once per day, fetch each enabled feed,
//   parse, upsert events with externalUid for idempotency.

import { db } from "@workspace/db";
import {
  calendarEventsTable,
  calendarEventRemindersTable,
  calendarSubCalendarsTable,
  calendarExternalFeedsTable,
  calendarUserPrefsTable,
  notificationsTable,
  usersTable,
  organizationSettingsTable,
} from "@workspace/db/schema";
import { and, eq, isNull, lte } from "drizzle-orm";
import { logger } from "./logger.js";
import { sendEmail } from "./email.js";
import { sendSms } from "./sms.js";
import { parseIcs } from "./calendarIcal.js";
import { syncAutoCalendarEvents } from "./calendarAutoEvents.js";

const REMINDER_TICK_MS = 60 * 1000;
const FEED_TICK_MS = 24 * 60 * 60 * 1000;
const AUTO_EVENTS_TICK_MS = 60 * 60 * 1000;

const CAL_SMS_ENABLED = process.env.CAL_SMS_ENABLED === "1";

async function getOrgName(): Promise<string> {
  const [row] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  return row?.name ?? "HOA Hub";
}

// Quiet-hours check: 10pm–7am America/Chicago.
function inQuietHours(now: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    hour12: false,
  });
  const hour = parseInt(fmt.format(now), 10);
  return hour >= 22 || hour < 7;
}

async function loadAudienceForSub(subId: number): Promise<Array<typeof usersTable.$inferSelect>> {
  const [sub] = await db.select().from(calendarSubCalendarsTable).where(eq(calendarSubCalendarsTable.id, subId));
  if (!sub) return [];
  const users = await db.select().from(usersTable);
  return users.filter((u) => {
    if (u.pending) return false;
    if (sub.viewerRoles.length === 0) return true;
    if (sub.viewerRoles.includes(u.role)) return true;
    if (sub.viewerRoles.includes("board") && u.boardMember) return true;
    return false;
  });
}

async function dispatchReminderTick(): Promise<void> {
  try {
    const now = new Date();
    const nowMs = now.getTime();
    // Pull all undispatched reminders. Volume is small in practice.
    const due = await db
      .select()
      .from(calendarEventRemindersTable)
      .where(isNull(calendarEventRemindersTable.dispatchedAt));
    if (due.length === 0) return;

    const orgName = await getOrgName();
    const quiet = inQuietHours(now);

    for (const r of due) {
      const startMs = new Date(r.instanceStartsAt).getTime();
      const fireMs = startMs - r.leadMinutes * 60 * 1000;
      if (fireMs > nowMs) continue;
      if (startMs < nowMs - 5 * 60 * 1000) {
        // Past event by >5min — mark dispatched to avoid retrying forever.
        await db.update(calendarEventRemindersTable)
          .set({ dispatchedAt: now.toISOString() })
          .where(eq(calendarEventRemindersTable.id, r.id));
        continue;
      }

      const [ev] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, r.eventId));
      if (!ev || ev.cancelled) {
        await db.update(calendarEventRemindersTable)
          .set({ dispatchedAt: now.toISOString() })
          .where(eq(calendarEventRemindersTable.id, r.id));
        continue;
      }

      let recipients: Array<typeof usersTable.$inferSelect> = [];
      if (r.userId) {
        const [u] = await db.select().from(usersTable).where(eq(usersTable.id, r.userId));
        if (u && !u.pending) recipients = [u];
      } else {
        recipients = await loadAudienceForSub(ev.subCalendarId);
        // Also intersect with users who have this sub-calendar visible.
        const prefs = await db.select().from(calendarUserPrefsTable);
        const subSlugRow = await db.select({ slug: calendarSubCalendarsTable.slug })
          .from(calendarSubCalendarsTable).where(eq(calendarSubCalendarsTable.id, ev.subCalendarId));
        const slug = subSlugRow[0]?.slug;
        if (slug) {
          const prefByUser = new Map(prefs.map((p) => [p.userId, p.visibleSubCalendars] as const));
          recipients = recipients.filter((u) => {
            const v = prefByUser.get(u.id);
            // If no prefs row exists, assume default-visible behavior.
            if (!v || Object.keys(v).length === 0) return true;
            return v[slug] !== false;
          });
        }
      }

      const friendlyTime = new Date(r.instanceStartsAt).toLocaleString("en-US", {
        timeZone: "America/Chicago",
        dateStyle: "medium", timeStyle: "short",
      });

      for (const u of recipients) {
        if (r.channelInApp) {
          await db.insert(notificationsTable).values({
            userId: u.id,
            type: "calendar_reminder",
            message: `Upcoming: "${ev.title}" — ${friendlyTime}`,
            entityType: "calendar_event",
            entityId: String(ev.id),
            read: false,
            createdAt: now.toISOString(),
          });
        }
        if (r.channelEmail && !quiet && u.email) {
          try {
            await sendEmail(
              u.email,
              `[${orgName}] Reminder: ${ev.title}`,
              `<div style="font-family:system-ui,sans-serif">
                <h2 style="margin:0 0 8px">${ev.title}</h2>
                <p style="margin:0 0 8px;color:#555">${friendlyTime} (Central Time)</p>
                ${ev.locationText ? `<p style="margin:0 0 8px"><strong>Where:</strong> ${ev.locationText}</p>` : ""}
                ${ev.body ? `<p style="margin:0 0 8px">${ev.body}</p>` : ""}
              </div>`,
            );
          } catch (err) {
            logger.warn({ err, userId: u.id, eventId: ev.id }, "Calendar reminder email failed");
          }
        }
        if (r.channelSms && CAL_SMS_ENABLED && !quiet && u.phoneNumber && u.phoneVerified) {
          try {
            const where = ev.locationText ? ` @ ${ev.locationText}` : "";
            const body = `[${orgName}] Reminder: ${ev.title} — ${friendlyTime} CT${where}`;
            const result = await sendSms(u.phoneNumber, body);
            if (!result.ok) {
              logger.warn({ userId: u.id, eventId: ev.id, error: result.error }, "Calendar SMS reminder failed");
            } else {
              logger.info({ userId: u.id, eventId: ev.id, sid: result.sid }, "Calendar SMS reminder sent");
            }
          } catch (err) {
            logger.warn({ err, userId: u.id, eventId: ev.id }, "Calendar SMS reminder threw");
          }
        }
      }

      await db.update(calendarEventRemindersTable)
        .set({ dispatchedAt: now.toISOString() })
        .where(eq(calendarEventRemindersTable.id, r.id));
    }
  } catch (err) {
    logger.error({ err }, "Calendar reminder tick failed");
  }
}

async function refreshExternalFeeds(): Promise<void> {
  try {
    const feeds = await db.select().from(calendarExternalFeedsTable).where(eq(calendarExternalFeedsTable.enabled, true));
    if (feeds.length === 0) return;
    for (const feed of feeds) {
      try {
        const res = await fetch(feed.url, { headers: { "User-Agent": "HOA-Hub-Calendar/1.0" } });
        if (!res.ok) {
          await db.update(calendarExternalFeedsTable)
            .set({ lastError: `HTTP ${res.status}`, lastFetchedAt: new Date().toISOString() })
            .where(eq(calendarExternalFeedsTable.id, feed.id));
          continue;
        }
        const text = await res.text();
        const parsed = parseIcs(text);
        // Upsert by externalUid scoped to this feed.
        const sourceTag = `external:${feed.id}`;
        // Soft-delete events for this feed not present in the new payload.
        const existing = await db.select().from(calendarEventsTable)
          .where(eq(calendarEventsTable.source, sourceTag));
        const seen = new Set<string>();
        for (const p of parsed) {
          seen.add(p.uid);
          const match = existing.find((e) => e.externalUid === p.uid);
          const now = new Date().toISOString();
          if (match) {
            await db.update(calendarEventsTable).set({
              title: p.summary || match.title,
              body: p.description || match.body,
              startsAt: p.startsAt,
              endsAt: p.endsAt,
              allDay: p.allDay,
              locationText: p.location || null,
              cancelled: false,
              updatedAt: now,
            }).where(eq(calendarEventsTable.id, match.id));
          } else {
            await db.insert(calendarEventsTable).values({
              subCalendarId: feed.subCalendarId,
              title: p.summary || "(untitled)",
              body: p.description ?? "",
              startsAt: p.startsAt,
              endsAt: p.endsAt,
              allDay: p.allDay,
              locationText: p.location || null,
              locationUrl: null,
              recurrence: null,
              exceptions: [],
              overrides: [],
              source: sourceTag,
              sourceRefType: "external_feed",
              sourceRefId: String(feed.id),
              externalUid: p.uid,
              cancelled: false,
              createdByUserId: null,
              createdByName: feed.name,
              createdAt: now,
              updatedAt: now,
            });
          }
        }
        for (const e of existing) {
          if (e.externalUid && !seen.has(e.externalUid) && !e.cancelled) {
            await db.update(calendarEventsTable)
              .set({ cancelled: true, updatedAt: new Date().toISOString() })
              .where(eq(calendarEventsTable.id, e.id));
          }
        }
        await db.update(calendarExternalFeedsTable).set({
          lastFetchedAt: new Date().toISOString(),
          lastError: null,
          lastEventCount: parsed.length,
        }).where(eq(calendarExternalFeedsTable.id, feed.id));
        logger.info({ feedId: feed.id, count: parsed.length }, "External calendar feed refreshed");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db.update(calendarExternalFeedsTable).set({
          lastFetchedAt: new Date().toISOString(),
          lastError: msg,
        }).where(eq(calendarExternalFeedsTable.id, feed.id));
        logger.warn({ err, feedId: feed.id }, "External calendar feed refresh failed");
      }
    }
  } catch (err) {
    logger.error({ err }, "External feed refresh tick failed");
  }
}

export function startCalendarSchedulers(): void {
  void dispatchReminderTick();
  setInterval(() => { void dispatchReminderTick(); }, REMINDER_TICK_MS);
  void refreshExternalFeeds();
  setInterval(() => { void refreshExternalFeeds(); }, FEED_TICK_MS);
  // Stagger the first auto-events sync so it doesn't race with app boot work.
  setTimeout(() => { void syncAutoCalendarEvents(); }, 10_000);
  setInterval(() => { void syncAutoCalendarEvents(); }, AUTO_EVENTS_TICK_MS);
  logger.info("Calendar schedulers started");
}
