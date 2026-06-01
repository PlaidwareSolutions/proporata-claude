// Task #74: Calendar foundation REST routes.
//
// Routes mounted under `/api`. Reads are scoped to sub-calendars the user can
// view; writes are gated by sub-calendar `editorRoles`.

import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  calendarSubCalendarsTable,
  calendarEventsTable,
  calendarEventAttachmentsTable,
  calendarEventRemindersTable,
  calendarEventAuditTable,
  calendarUserPrefsTable,
  calendarExternalFeedsTable,
  calendarResourcesTable,
  calendarEventRsvpsTable,
  calendarShareTokensTable,
  trashHolidayShiftsTable,
  usersTable,
  type CalendarRecurrence,
  type CalendarSubCalendar,
} from "@workspace/db/schema";
import { and, asc, eq, inArray, ne, or, isNull, gte, lte, sql } from "drizzle-orm";
import { authenticateJwt, type AuthUser } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { expandEvent, type BaseEvent } from "../lib/calendarRecurrence.js";
import { buildIcs, buildInviteIcs } from "../lib/calendarIcal.js";
import { sendEmailWithIcs, buildEventInviteEmail } from "../lib/email.js";
import { ensureTrashSchedule, applyHolidayShifts } from "../lib/calendarTrash.js";

const router: IRouter = Router();
const publicRouter: IRouter = Router();
const storage = new ObjectStorageService();

const ALLOWED_LEAD_MINUTES = new Set([15, 60, 1440, 4320, 10080, 43200]);

function nowISO(): string { return new Date().toISOString(); }

function userRoleSet(user: AuthUser): Set<string> {
  const s = new Set<string>([user.role]);
  if (user.boardMember) s.add("board");
  return s;
}

function canView(user: AuthUser, sub: CalendarSubCalendar): boolean {
  if (sub.viewerRoles.length === 0) return true;
  const roles = userRoleSet(user);
  return sub.viewerRoles.some((r) => roles.has(r));
}

function canEdit(user: AuthUser, sub: CalendarSubCalendar): boolean {
  if (sub.isExternal) return false;
  const roles = userRoleSet(user);
  return sub.editorRoles.some((r) => roles.has(r));
}

async function loadAllSubs(): Promise<CalendarSubCalendar[]> {
  return db.select().from(calendarSubCalendarsTable).orderBy(asc(calendarSubCalendarsTable.sortOrder));
}

async function getOrCreatePrefs(userId: number) {
  const [row] = await db
    .select()
    .from(calendarUserPrefsTable)
    .where(eq(calendarUserPrefsTable.userId, userId));
  if (row) return row;
  const [created] = await db
    .insert(calendarUserPrefsTable)
    .values({
      userId,
      visibleSubCalendars: {},
      defaultView: "month",
      icalToken: null,
      icalTokenCreatedAt: null,
      updatedAt: nowISO(),
    })
    .returning();
  return created;
}

function defaultVisibleForRole(user: AuthUser, subs: CalendarSubCalendar[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const s of subs) {
    let on = false;
    if (user.role === "admin") on = true;
    else if (user.role === "manager") {
      on = ["operations", "financial", "compliance", "board", "committees", "community", "amenities", "external"].includes(s.slug);
    } else if (user.boardMember) {
      on = ["board", "committees", "operations", "community", "amenities", "compliance"].includes(s.slug);
    } else if (user.role === "resident") {
      on = ["community", "amenities"].includes(s.slug);
    }
    out[s.slug] = on;
  }
  return out;
}

function eventToBase(row: typeof calendarEventsTable.$inferSelect): BaseEvent {
  return {
    id: row.id,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    recurrence: row.recurrence as CalendarRecurrence,
    exceptions: row.exceptions ?? [],
    overrides: row.overrides ?? [],
  };
}

function publicEvent(row: typeof calendarEventsTable.$inferSelect, sub: CalendarSubCalendar) {
  return {
    id: row.id,
    subCalendarId: row.subCalendarId,
    subCalendarSlug: sub.slug,
    color: sub.color,
    title: row.title,
    body: row.body,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    locationText: row.locationText,
    locationUrl: row.locationUrl,
    resourceId: row.resourceId ?? null,
    capacity: row.capacity ?? null,
    recurrence: row.recurrence,
    exceptions: row.exceptions,
    overrides: row.overrides,
    source: row.source,
    sourceRefType: row.sourceRefType,
    sourceRefId: row.sourceRefId,
    cancelled: row.cancelled,
    createdByUserId: row.createdByUserId,
    createdByName: row.createdByName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseResourceId(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "" ) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseCapacity(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

async function findResourceConflict(
  resourceId: number,
  startsAt: string,
  endsAt: string,
  excludeEventId: number | null,
): Promise<typeof calendarEventsTable.$inferSelect | null> {
  // Fetch all non-cancelled events with this resource (small list per
  // community) and check overlap in JS so we don't have to express
  // complex SQL across recurring events. For recurring events we only
  // check the base window — recurring amenity bookings are rare and
  // editors get a clear conflict message either way.
  const rows = await db
    .select()
    .from(calendarEventsTable)
    .where(and(eq(calendarEventsTable.resourceId, resourceId), eq(calendarEventsTable.cancelled, false)));
  const aStart = startsAt;
  const aEnd = endsAt;
  for (const row of rows) {
    if (excludeEventId !== null && row.id === excludeEventId) continue;
    if (aStart < row.endsAt && row.startsAt < aEnd) return row;
  }
  return null;
}

function rsvpAllowedForSub(sub: CalendarSubCalendar): boolean {
  return sub.slug === "community" || sub.slug === "amenities";
}

function emptyCounts() { return { yes: 0, no: 0, maybe: 0, waitlisted: 0 } as Record<"yes" | "no" | "maybe" | "waitlisted", number>; }

// Task #78: Resolve the user's unit (the column lives on users).
async function resolveUserUnitId(userId: number): Promise<string | null> {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return u?.unitId ?? null;
}

async function loadRsvpSummary(eventId: number, occurrenceKey: string, userId: number | null) {
  const rows = await db
    .select()
    .from(calendarEventRsvpsTable)
    .where(and(eq(calendarEventRsvpsTable.eventId, eventId), eq(calendarEventRsvpsTable.occurrenceKey, occurrenceKey)));
  const counts = emptyCounts();
  let myRsvp: { status: string; partySize: number; waitlistPosition: number | null } | null = null;
  let attendingPartySize = 0;
  let waitlistPartySize = 0;
  for (const r of rows) {
    if (r.status === "yes" || r.status === "no" || r.status === "maybe") {
      if (r.status === "yes" && r.waitlistPosition !== null) {
        counts.waitlisted += 1;
        waitlistPartySize += r.partySize ?? 1;
      } else {
        counts[r.status] += 1;
        if (r.status === "yes") attendingPartySize += r.partySize ?? 1;
      }
    }
    if (userId !== null && r.userId === userId) {
      myRsvp = { status: r.status, partySize: r.partySize ?? 1, waitlistPosition: r.waitlistPosition };
    }
  }
  const entries = rows.map((r) => ({
    userId: r.userId,
    userName: r.userName,
    status: r.status,
    partySize: r.partySize ?? 1,
    waitlistPosition: r.waitlistPosition,
    unitId: r.unitId,
    updatedAt: r.updatedAt,
  }));
  return {
    eventId,
    occurrenceKey,
    counts,
    attendingPartySize,
    waitlistPartySize,
    myRsvp: myRsvp?.status ?? null,
    myRsvpDetail: myRsvp,
    entries,
  };
}

function publicSub(s: CalendarSubCalendar) {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    color: s.color,
    description: s.description,
    editorRoles: s.editorRoles,
    viewerRoles: s.viewerRoles,
    isPublic: s.isPublic,
    isExternal: s.isExternal,
    sortOrder: s.sortOrder,
  };
}

// ── Sub-calendars ────────────────────────────────────────────────────────

router.get("/calendar/sub-calendars", authenticateJwt, async (req, res) => {
  const subs = await loadAllSubs();
  const visible = subs.filter((s) => canView(req.user!, s));
  res.json(visible.map(publicSub));
});

// ── My prefs ─────────────────────────────────────────────────────────────

router.get("/calendar/me/prefs", authenticateJwt, async (req, res) => {
  const subs = await loadAllSubs();
  const prefs = await getOrCreatePrefs(req.user!.id);
  let visible = prefs.visibleSubCalendars ?? {};
  if (Object.keys(visible).length === 0) {
    visible = defaultVisibleForRole(req.user!, subs);
  }
  res.json({
    visibleSubCalendars: visible,
    defaultView: prefs.defaultView,
    icalToken: prefs.icalToken ?? null,
    icalTokenCreatedAt: prefs.icalTokenCreatedAt ?? null,
  });
});

router.patch("/calendar/me/prefs", authenticateJwt, async (req, res) => {
  const body = req.body ?? {};
  const visibleSubCalendars = body.visibleSubCalendars && typeof body.visibleSubCalendars === "object"
    ? body.visibleSubCalendars as Record<string, boolean>
    : undefined;
  const defaultView = typeof body.defaultView === "string" ? body.defaultView : undefined;
  const prefs = await getOrCreatePrefs(req.user!.id);
  await db
    .update(calendarUserPrefsTable)
    .set({
      visibleSubCalendars: visibleSubCalendars ?? prefs.visibleSubCalendars,
      defaultView: defaultView ?? prefs.defaultView,
      updatedAt: nowISO(),
    })
    .where(eq(calendarUserPrefsTable.userId, req.user!.id));
  const [updated] = await db.select().from(calendarUserPrefsTable).where(eq(calendarUserPrefsTable.userId, req.user!.id));
  res.json({
    visibleSubCalendars: updated.visibleSubCalendars,
    defaultView: updated.defaultView,
    icalToken: updated.icalToken ?? null,
    icalTokenCreatedAt: updated.icalTokenCreatedAt ?? null,
  });
});

router.post("/calendar/me/ical-token", authenticateJwt, async (req, res) => {
  await getOrCreatePrefs(req.user!.id);
  const token = crypto.randomBytes(24).toString("hex");
  await db
    .update(calendarUserPrefsTable)
    .set({ icalToken: token, icalTokenCreatedAt: nowISO(), updatedAt: nowISO() })
    .where(eq(calendarUserPrefsTable.userId, req.user!.id));
  res.json({ icalToken: token, icalTokenCreatedAt: nowISO() });
});

// ── Events ───────────────────────────────────────────────────────────────

function parseRecurrence(raw: unknown): CalendarRecurrence | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const freq = r.freq;
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;
  const out: NonNullable<CalendarRecurrence> = { freq };
  if (typeof r.interval === "number" && r.interval > 0) out.interval = Math.floor(r.interval);
  if (Array.isArray(r.byday)) {
    out.byday = r.byday.filter((d) => typeof d === "string");
  }
  if (typeof r.until === "string") out.until = r.until;
  if (typeof r.count === "number" && r.count > 0) out.count = Math.floor(r.count);
  return out;
}

// ── Task #76: Owner-private timeline ─────────────────────────────────────
//
// Returns events that are either (a) tagged with ownerUserId = caller, or
// (b) on a sub-calendar visible to the caller AND have no ownerUserId set
// (broadcast). Owner-scoped events are excluded from the broad /events feed
// regardless of role; they appear here only for their owner.
router.get("/calendar/me/timeline", authenticateJwt, async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  if (!from || !to) {
    res.status(400).json({ error: "from and to query params (ISO date) are required" });
    return;
  }

  const subs = await loadAllSubs();
  const visibleSubs = subs.filter((s) => canView(req.user!, s));
  const subById = new Map(subs.map((s) => [s.id, s] as const));
  const visibleIds = visibleSubs.map((s) => s.id);

  const rows = await db.select().from(calendarEventsTable).where(
    or(
      eq(calendarEventsTable.ownerUserId, req.user!.id),
      and(
        isNull(calendarEventsTable.ownerUserId),
        visibleIds.length > 0 ? inArray(calendarEventsTable.subCalendarId, visibleIds) : eq(calendarEventsTable.id, -1),
      ),
    ),
  );

  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    if (row.cancelled) continue;
    const sub = subById.get(row.subCalendarId);
    if (!sub) continue;
    // Broadcast events still need view permission. Owner-scoped events
    // bypass viewerRoles but require ownerUserId match (already enforced).
    if (!row.ownerUserId && !canView(req.user!, sub)) continue;
    const instances = expandEvent(eventToBase(row), from, to);
    const base = publicEvent(row, sub);
    for (const inst of instances) {
      if (inst.cancelled) continue;
      out.push({
        ...base,
        instanceId: `${row.id}:${inst.occurrenceKey}`,
        occurrenceKey: inst.occurrenceKey,
        startsAt: inst.startsAt,
        endsAt: inst.endsAt,
        title: inst.titleOverride ?? row.title,
        body: inst.bodyOverride ?? row.body,
        ownerUserId: row.ownerUserId,
        isPrivate: row.ownerUserId === req.user!.id,
      });
    }
  }
  out.sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
  res.json(out);
});

router.get("/calendar/events", authenticateJwt, async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  const search = typeof req.query.search === "string" ? req.query.search.toLowerCase() : null;
  if (!from || !to) {
    res.status(400).json({ error: "from and to query params (ISO date) are required" });
    return;
  }

  const subs = await loadAllSubs();
  const visibleSubs = subs.filter((s) => canView(req.user!, s));
  if (visibleSubs.length === 0) { res.json([]); return; }
  const subById = new Map(visibleSubs.map((s) => [s.id, s] as const));
  const visibleIds = visibleSubs.map((s) => s.id);

  const rows = await db
    .select()
    .from(calendarEventsTable)
    .where(and(
      inArray(calendarEventsTable.subCalendarId, visibleIds),
      // Task #76: hide owner-scoped events from the broad feed; they only
      // surface on /calendar/me/timeline for their assigned owner.
      isNull(calendarEventsTable.ownerUserId),
    ));

  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    if (row.cancelled) continue;
    const sub = subById.get(row.subCalendarId);
    if (!sub) continue;
    if (search) {
      const blob = `${row.title} ${row.body} ${row.locationText ?? ""}`.toLowerCase();
      if (!blob.includes(search)) continue;
    }
    const instances = expandEvent(eventToBase(row), from, to);
    const base = publicEvent(row, sub);
    for (const inst of instances) {
      if (inst.cancelled) continue;
      out.push({
        ...base,
        instanceId: `${row.id}:${inst.occurrenceKey}`,
        occurrenceKey: inst.occurrenceKey,
        startsAt: inst.startsAt,
        endsAt: inst.endsAt,
        title: inst.titleOverride ?? row.title,
        body: inst.bodyOverride ?? row.body,
      });
    }
  }
  out.sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
  res.json(out);
});

router.get("/calendar/events/:id", authenticateJwt, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const subs = await loadAllSubs();
  const sub = subs.find((s) => s.id === row.subCalendarId);
  if (!sub || !canView(req.user!, sub)) { res.status(403).json({ error: "Forbidden" }); return; }
  const attachments = await db.select().from(calendarEventAttachmentsTable).where(eq(calendarEventAttachmentsTable.eventId, id));
  const reminders = await db.select().from(calendarEventRemindersTable).where(eq(calendarEventRemindersTable.eventId, id));
  const occurrenceKey = typeof req.query.occurrenceKey === "string" ? req.query.occurrenceKey : "";
  const rsvpSummary = await loadRsvpSummary(id, occurrenceKey, req.user!.id);
  res.json({
    ...publicEvent(row, sub),
    attachments,
    reminders,
    canEdit: canEdit(req.user!, sub),
    rsvpCounts: rsvpSummary.counts,
    myRsvp: rsvpSummary.myRsvp,
  });
});

router.post("/calendar/events", authenticateJwt, async (req, res) => {
  const body = req.body ?? {};
  const subCalendarId = Number(body.subCalendarId);
  if (!Number.isFinite(subCalendarId)) { res.status(400).json({ error: "subCalendarId required" }); return; }
  const subs = await loadAllSubs();
  const sub = subs.find((s) => s.id === subCalendarId);
  if (!sub) { res.status(404).json({ error: "Sub-calendar not found" }); return; }
  if (!canEdit(req.user!, sub)) { res.status(403).json({ error: "Cannot write to this sub-calendar" }); return; }

  if (typeof body.title !== "string" || body.title.trim() === "") {
    res.status(400).json({ error: "title required" }); return;
  }
  if (typeof body.startsAt !== "string" || typeof body.endsAt !== "string") {
    res.status(400).json({ error: "startsAt/endsAt required" }); return;
  }

  const resourceId = parseResourceId(body.resourceId);
  const capacity = parseCapacity(body.capacity);
  if (resourceId !== undefined && resourceId !== null) {
    const conflict = await findResourceConflict(resourceId, body.startsAt, body.endsAt, null);
    if (conflict) {
      res.status(409).json({ error: "Resource is already booked for that time", conflict: { eventId: conflict.id, title: conflict.title, startsAt: conflict.startsAt, endsAt: conflict.endsAt } });
      return;
    }
  }

  const now = nowISO();
  const reminders: Array<{ leadMinutes: number; channelEmail: boolean; channelInApp: boolean; channelSms: boolean }> = Array.isArray(body.reminders)
    ? body.reminders.filter((r: unknown) => r && typeof r === "object").map((r: any) => ({
        leadMinutes: Number(r.leadMinutes),
        channelEmail: r.channelEmail !== false,
        channelInApp: r.channelInApp !== false,
        channelSms: r.channelSms === true,
      })).filter((r: { leadMinutes: number }) => ALLOWED_LEAD_MINUTES.has(r.leadMinutes))
    : [];

  const [row] = await db.insert(calendarEventsTable).values({
    subCalendarId,
    title: body.title.trim().slice(0, 240),
    body: typeof body.body === "string" ? body.body.slice(0, 10000) : "",
    startsAt: body.startsAt,
    endsAt: body.endsAt,
    allDay: body.allDay === true,
    locationText: typeof body.locationText === "string" ? body.locationText.slice(0, 240) : null,
    locationUrl: typeof body.locationUrl === "string" ? body.locationUrl.slice(0, 1024) : null,
    resourceId: resourceId ?? null,
    capacity: capacity ?? null,
    recurrence: parseRecurrence(body.recurrence) ?? null,
    exceptions: Array.isArray(body.exceptions) ? body.exceptions.filter((s: unknown) => typeof s === "string") : [],
    overrides: [],
    source: typeof body.source === "string" ? body.source : null,
    sourceRefType: typeof body.sourceRefType === "string" ? body.sourceRefType : null,
    sourceRefId: typeof body.sourceRefId === "string" ? body.sourceRefId : null,
    externalUid: null,
    cancelled: false,
    createdByUserId: req.user!.id,
    createdByName: req.user!.name ?? "",
    createdAt: now,
    updatedAt: now,
  }).returning();

  for (const r of reminders) {
    await db.insert(calendarEventRemindersTable).values({
      eventId: row.id,
      instanceStartsAt: row.startsAt,
      leadMinutes: r.leadMinutes,
      channelInApp: r.channelInApp,
      channelEmail: r.channelEmail,
      channelSms: r.channelSms,
      userId: null,
      dispatchedAt: null,
      createdAt: now,
    });
  }

  await db.insert(calendarEventAuditTable).values({
    eventId: row.id, action: "created", actorUserId: req.user!.id,
    actorName: req.user!.name ?? "", diff: { title: row.title }, createdAt: now,
  });

  res.status(201).json(publicEvent(row, sub));
});

router.patch("/calendar/events/:id", authenticateJwt, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const subs = await loadAllSubs();
  const sub = subs.find((s) => s.id === existing.subCalendarId);
  if (!sub || !canEdit(req.user!, sub)) { res.status(403).json({ error: "Forbidden" }); return; }

  const body = req.body ?? {};
  const patch: Partial<typeof calendarEventsTable.$inferInsert> = { updatedAt: nowISO() };
  if (typeof body.title === "string") patch.title = body.title.trim().slice(0, 240);
  if (typeof body.body === "string") patch.body = body.body.slice(0, 10000);
  if (typeof body.startsAt === "string") patch.startsAt = body.startsAt;
  if (typeof body.endsAt === "string") patch.endsAt = body.endsAt;
  if (typeof body.allDay === "boolean") patch.allDay = body.allDay;
  if (typeof body.locationText === "string" || body.locationText === null) patch.locationText = body.locationText;
  if (typeof body.locationUrl === "string" || body.locationUrl === null) patch.locationUrl = body.locationUrl;
  if (body.resourceId !== undefined) patch.resourceId = parseResourceId(body.resourceId) ?? null;
  if (body.capacity !== undefined) patch.capacity = parseCapacity(body.capacity) ?? null;
  if (body.recurrence !== undefined) patch.recurrence = parseRecurrence(body.recurrence);
  if (Array.isArray(body.exceptions)) patch.exceptions = body.exceptions.filter((s: unknown) => typeof s === "string");
  if (Array.isArray(body.overrides)) patch.overrides = body.overrides;

  const finalResourceId = patch.resourceId !== undefined ? patch.resourceId : existing.resourceId;
  const finalStarts = patch.startsAt ?? existing.startsAt;
  const finalEnds = patch.endsAt ?? existing.endsAt;
  if (finalResourceId !== null && finalResourceId !== undefined) {
    const conflict = await findResourceConflict(finalResourceId, finalStarts, finalEnds, id);
    if (conflict) {
      res.status(409).json({ error: "Resource is already booked for that time", conflict: { eventId: conflict.id, title: conflict.title, startsAt: conflict.startsAt, endsAt: conflict.endsAt } });
      return;
    }
  }

  const [row] = await db.update(calendarEventsTable).set(patch).where(eq(calendarEventsTable.id, id)).returning();
  await db.insert(calendarEventAuditTable).values({
    eventId: id, action: "updated", actorUserId: req.user!.id,
    actorName: req.user!.name ?? "", diff: patch, createdAt: nowISO(),
  });
  res.json(publicEvent(row, sub));
});

router.delete("/calendar/events/:id", authenticateJwt, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const subs = await loadAllSubs();
  const sub = subs.find((s) => s.id === existing.subCalendarId);
  if (!sub || !canEdit(req.user!, sub)) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.update(calendarEventsTable)
    .set({ cancelled: true, updatedAt: nowISO() })
    .where(eq(calendarEventsTable.id, id));
  await db.insert(calendarEventAuditTable).values({
    eventId: id, action: "cancelled", actorUserId: req.user!.id,
    actorName: req.user!.name ?? "", diff: null, createdAt: nowISO(),
  });
  res.status(204).end();
});

// ── Audit ────────────────────────────────────────────────────────────────

router.get("/calendar/events/:id/audit", authenticateJwt, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [event] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, id));
  if (!event) { res.status(404).json({ error: "Not found" }); return; }
  const subs = await loadAllSubs();
  const sub = subs.find((s) => s.id === event.subCalendarId);
  if (!sub || !canView(req.user!, sub)) { res.status(403).json({ error: "Forbidden" }); return; }
  const rows = await db.select().from(calendarEventAuditTable).where(eq(calendarEventAuditTable.eventId, id));
  res.json(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

// ── Attachments ──────────────────────────────────────────────────────────

router.post("/calendar/events/:id/attachments/upload-url", authenticateJwt, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [event] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, id));
  if (!event) { res.status(404).json({ error: "Not found" }); return; }
  const subs = await loadAllSubs();
  const sub = subs.find((s) => s.id === event.subCalendarId);
  if (!sub || !canEdit(req.user!, sub)) { res.status(403).json({ error: "Forbidden" }); return; }
  try {
    const url = await storage.getObjectEntityUploadURL();
    res.json({ uploadURL: url });
  } catch (err) {
    logger.error({ err }, "Calendar attachment upload-url failed");
    res.status(500).json({ error: "Could not get upload URL" });
  }
});

router.post("/calendar/events/:id/attachments", authenticateJwt, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [event] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, id));
  if (!event) { res.status(404).json({ error: "Not found" }); return; }
  const subs = await loadAllSubs();
  const sub = subs.find((s) => s.id === event.subCalendarId);
  if (!sub || !canEdit(req.user!, sub)) { res.status(403).json({ error: "Forbidden" }); return; }
  const { name, size, contentType, storageKey } = req.body ?? {};
  if (typeof name !== "string" || typeof storageKey !== "string") {
    res.status(400).json({ error: "name and storageKey required" }); return;
  }
  const [row] = await db.insert(calendarEventAttachmentsTable).values({
    eventId: id,
    name: name.slice(0, 240),
    size: typeof size === "number" ? size : 0,
    contentType: typeof contentType === "string" ? contentType : null,
    storageKey,
    uploadedByUserId: req.user!.id,
    uploadedByName: req.user!.name ?? "",
    uploadedAt: nowISO(),
  }).returning();
  res.status(201).json(row);
});

router.delete("/calendar/events/:id/attachments/:attId", authenticateJwt, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  const attId = parseInt(req.params.attId as string, 10);
  if (Number.isNaN(id) || Number.isNaN(attId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [event] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, id));
  if (!event) { res.status(404).json({ error: "Not found" }); return; }
  const subs = await loadAllSubs();
  const sub = subs.find((s) => s.id === event.subCalendarId);
  if (!sub || !canEdit(req.user!, sub)) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.delete(calendarEventAttachmentsTable)
    .where(and(eq(calendarEventAttachmentsTable.id, attId), eq(calendarEventAttachmentsTable.eventId, id)));
  res.status(204).end();
});

// ── External feeds (admin) ───────────────────────────────────────────────

router.get("/calendar/external-feeds", authenticateJwt, async (req, res) => {
  if (req.user!.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const rows = await db.select().from(calendarExternalFeedsTable);
  res.json(rows);
});

router.post("/calendar/external-feeds", authenticateJwt, async (req, res) => {
  if (req.user!.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const { name, url, subCalendarSlug } = req.body ?? {};
  if (typeof name !== "string" || typeof url !== "string") {
    res.status(400).json({ error: "name and url required" }); return;
  }
  const subs = await loadAllSubs();
  const slug = typeof subCalendarSlug === "string" ? subCalendarSlug : "external";
  const sub = subs.find((s) => s.slug === slug);
  if (!sub) { res.status(400).json({ error: "Unknown sub-calendar" }); return; }
  const [row] = await db.insert(calendarExternalFeedsTable).values({
    subCalendarId: sub.id,
    name: name.slice(0, 240),
    url: url.slice(0, 2048),
    enabled: true,
    lastFetchedAt: null,
    lastError: null,
    lastEventCount: 0,
    createdByUserId: req.user!.id,
    createdAt: nowISO(),
  }).returning();
  res.status(201).json(row);
});

router.delete("/calendar/external-feeds/:id", authenticateJwt, async (req, res) => {
  if (req.user!.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(calendarExternalFeedsTable).where(eq(calendarExternalFeedsTable.id, id));
  res.status(204).end();
});

// ── iCal feeds ───────────────────────────────────────────────────────────

async function buildSubFeed(slug: string, fromIso: string, toIso: string, calendarName: string) {
  const subs = await loadAllSubs();
  const sub = subs.find((s) => s.slug === slug);
  if (!sub) return null;
  const rows = await db.select().from(calendarEventsTable)
    .where(eq(calendarEventsTable.subCalendarId, sub.id));
  const items: Parameters<typeof buildIcs>[0]["events"] = [];
  for (const row of rows) {
    if (row.cancelled) continue;
    const expanded = expandEvent(eventToBase(row), fromIso, toIso);
    for (const inst of expanded) {
      if (inst.cancelled) continue;
      items.push({
        instance: inst,
        title: inst.titleOverride ?? row.title,
        body: inst.bodyOverride ?? row.body,
        location: row.locationText ?? null,
        locationUrl: row.locationUrl ?? null,
        allDay: row.allDay,
      });
    }
  }
  return { sub, ics: buildIcs({ calendarName, events: items }) };
}

// Per-user secret-token feed: /calendar/feeds/:slug/:token.ics
publicRouter.get("/calendar/feeds/:slug/:token.ics", async (req, res) => {
  const { slug, token } = req.params;
  const [pref] = await db.select().from(calendarUserPrefsTable).where(eq(calendarUserPrefsTable.icalToken, token));
  if (!pref) { res.status(404).end(); return; }
  // The token is per-user but feeds are sub-calendar scoped. Make sure the
  // user can view this sub-calendar.
  const subs = await loadAllSubs();
  const sub = subs.find((s) => s.slug === slug);
  if (!sub) { res.status(404).end(); return; }
  // Re-check viewability based on the user's role — board flag is stored on user row.
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, pref.userId));
  if (!u) { res.status(404).end(); return; }
  const fakeUser: AuthUser = {
    id: u.id, email: u.email, role: u.role as AuthUser["role"], name: u.name,
    unitId: u.unitId, boardMember: u.boardMember,
  };
  if (!canView(fakeUser, sub)) { res.status(403).end(); return; }
  // Window: previous 60 days through next 365 days for portability.
  const now = Date.now();
  const fromIso = new Date(now - 60 * 24 * 3600 * 1000).toISOString();
  const toIso = new Date(now + 365 * 24 * 3600 * 1000).toISOString();
  const result = await buildSubFeed(slug, fromIso, toIso, sub.name);
  if (!result) { res.status(404).end(); return; }
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${slug}.ics"`);
  res.send(result.ics);
});

// Public unauthenticated feed for community/notice-style sub-calendars.
publicRouter.get("/calendar/public/:slug.ics", async (req, res) => {
  const { slug } = req.params;
  const subs = await loadAllSubs();
  const sub = subs.find((s) => s.slug === slug);
  if (!sub || !sub.isPublic) { res.status(404).end(); return; }
  const now = Date.now();
  const fromIso = new Date(now - 60 * 24 * 3600 * 1000).toISOString();
  const toIso = new Date(now + 365 * 24 * 3600 * 1000).toISOString();
  const result = await buildSubFeed(slug, fromIso, toIso, sub.name);
  if (!result) { res.status(404).end(); return; }
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${slug}-public.ics"`);
  res.send(result.ics);
});

// On-demand authenticated download.
router.get("/calendar/sub-calendars/:slug/ical", authenticateJwt, async (req, res) => {
  const subs = await loadAllSubs();
  const slug = String(req.params.slug);
  const sub = subs.find((s) => s.slug === slug);
  if (!sub || !canView(req.user!, sub)) { res.status(404).end(); return; }
  const now = Date.now();
  const fromIso = new Date(now - 60 * 24 * 3600 * 1000).toISOString();
  const toIso = new Date(now + 365 * 24 * 3600 * 1000).toISOString();
  const result = await buildSubFeed(slug, fromIso, toIso, sub.name);
  if (!result) { res.status(404).end(); return; }
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${sub.slug}.ics"`);
  res.send(result.ics);
});

// ── Resources (bookable amenities) ───────────────────────────────────────

router.get("/calendar/resources", authenticateJwt, async (_req, res) => {
  const rows = await db
    .select()
    .from(calendarResourcesTable)
    .orderBy(asc(calendarResourcesTable.sortOrder), asc(calendarResourcesTable.name));
  res.json(rows);
});

function canManageResources(user: AuthUser): boolean {
  return user.role === "admin" || user.role === "manager";
}

router.post("/calendar/resources", authenticateJwt, async (req, res) => {
  if (!canManageResources(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const body = req.body ?? {};
  if (typeof body.name !== "string" || body.name.trim() === "") {
    res.status(400).json({ error: "name required" }); return;
  }
  const cap = parseCapacity(body.capacity);
  try {
    const [row] = await db.insert(calendarResourcesTable).values({
      name: body.name.trim().slice(0, 120),
      description: typeof body.description === "string" ? body.description.slice(0, 1000) : "",
      capacity: cap === undefined ? null : cap,
      active: body.active === false ? false : true,
      sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
      createdAt: nowISO(),
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    if (String(err?.message || "").includes("duplicate")) {
      res.status(409).json({ error: "Name already in use" }); return;
    }
    logger.error({ err }, "Resource create failed");
    res.status(500).json({ error: "Could not create resource" });
  }
});

router.patch("/calendar/resources/:id", authenticateJwt, async (req, res) => {
  if (!canManageResources(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body ?? {};
  const patch: Partial<typeof calendarResourcesTable.$inferInsert> = {};
  if (typeof body.name === "string") patch.name = body.name.trim().slice(0, 120);
  if (typeof body.description === "string") patch.description = body.description.slice(0, 1000);
  if (body.capacity !== undefined) {
    const cap = parseCapacity(body.capacity);
    patch.capacity = cap === undefined ? null : cap;
  }
  if (typeof body.active === "boolean") patch.active = body.active;
  if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) patch.sortOrder = Number(body.sortOrder);
  const [row] = await db.update(calendarResourcesTable).set(patch).where(eq(calendarResourcesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/calendar/resources/:id", authenticateJwt, async (req, res) => {
  if (!canManageResources(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(calendarResourcesTable).where(eq(calendarResourcesTable.id, id));
  res.status(204).end();
});

// ── RSVPs ────────────────────────────────────────────────────────────────

router.get("/calendar/events/:id/rsvps", authenticateJwt, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [event] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, id));
  if (!event) { res.status(404).json({ error: "Not found" }); return; }
  const subs = await loadAllSubs();
  const sub = subs.find((s) => s.id === event.subCalendarId);
  if (!sub || !canView(req.user!, sub)) { res.status(403).json({ error: "Forbidden" }); return; }
  const occurrenceKey = typeof req.query.occurrenceKey === "string" ? req.query.occurrenceKey : "";
  const summary = await loadRsvpSummary(id, occurrenceKey, req.user!.id);
  res.json(summary);
});

router.put("/calendar/events/:id/rsvp", authenticateJwt, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [event] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, id));
  if (!event) { res.status(404).json({ error: "Not found" }); return; }
  const subs = await loadAllSubs();
  const sub = subs.find((s) => s.id === event.subCalendarId);
  if (!sub || !canView(req.user!, sub)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!rsvpAllowedForSub(sub)) { res.status(400).json({ error: "RSVPs are only available for community/amenity events" }); return; }
  const status = String(req.body?.status ?? "");
  if (status !== "yes" && status !== "no" && status !== "maybe") {
    res.status(400).json({ error: "status must be yes/no/maybe" }); return;
  }
  // Task #78: party size + per-unit cap + capacity-aware waitlist.
  const partySizeRaw = Number(req.body?.partySize ?? 1);
  const partySize = Number.isFinite(partySizeRaw) && partySizeRaw >= 1 && partySizeRaw <= 20 ? Math.floor(partySizeRaw) : 1;
  const occurrenceKey = typeof req.body?.occurrenceKey === "string" ? req.body.occurrenceKey : "";
  const userId = req.user!.id;
  const userName = req.user!.name ?? "";
  const now = nowISO();
  const userUnitId = await resolveUserUnitId(userId);

  // Existing RSVPs for the same occurrence to compute capacity + waitlist.
  const allForOccurrence = await db.select().from(calendarEventRsvpsTable).where(and(
    eq(calendarEventRsvpsTable.eventId, id),
    eq(calendarEventRsvpsTable.occurrenceKey, occurrenceKey),
  ));
  const myRow = allForOccurrence.find((r) => r.userId === userId) ?? null;

  let waitlistPosition: number | null = null;
  if (status === "yes") {
    // Per-unit cap check (excludes my own existing yes-row contribution).
    if (event.perUnitCap != null && userUnitId) {
      const myCurrent = myRow && myRow.status === "yes" ? (myRow.partySize ?? 1) : 0;
      const otherUnitYes = allForOccurrence
        .filter((r) => r.userId !== userId && r.status === "yes" && r.unitId === userUnitId && r.waitlistPosition === null)
        .reduce((s, r) => s + (r.partySize ?? 1), 0);
      if (otherUnitYes + partySize > event.perUnitCap) {
        res.status(409).json({ error: "Per-unit cap exceeded", reason: "per_unit_cap", limit: event.perUnitCap });
        return;
      }
    }
    // Overall capacity → waitlist promotion.
    if (event.capacity != null) {
      const myCurrent = myRow && myRow.status === "yes" && myRow.waitlistPosition === null ? (myRow.partySize ?? 1) : 0;
      const attendingOthers = allForOccurrence
        .filter((r) => r.userId !== userId && r.status === "yes" && r.waitlistPosition === null)
        .reduce((s, r) => s + (r.partySize ?? 1), 0);
      if (attendingOthers + partySize > event.capacity) {
        // Place at end of current waitlist
        const maxWl = allForOccurrence
          .filter((r) => r.userId !== userId && r.waitlistPosition !== null)
          .reduce((m, r) => Math.max(m, r.waitlistPosition ?? 0), 0);
        waitlistPosition = maxWl + 1;
      }
    }
  }

  if (myRow) {
    await db.update(calendarEventRsvpsTable)
      .set({ status, userName, partySize, waitlistPosition, unitId: userUnitId, updatedAt: now })
      .where(eq(calendarEventRsvpsTable.id, myRow.id));
  } else {
    await db.insert(calendarEventRsvpsTable).values({
      eventId: id,
      occurrenceKey,
      userId,
      userName,
      status,
      partySize,
      waitlistPosition,
      unitId: userUnitId,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Task #78: when a "yes" attendee changes to no/maybe, promote the
  // first waitlisted RSVP whose party size fits the freed capacity.
  if (event.capacity != null && (status === "no" || status === "maybe") && myRow && myRow.status === "yes" && myRow.waitlistPosition === null) {
    const refreshed = await db.select().from(calendarEventRsvpsTable).where(and(
      eq(calendarEventRsvpsTable.eventId, id),
      eq(calendarEventRsvpsTable.occurrenceKey, occurrenceKey),
    ));
    const attending = refreshed.filter((r) => r.status === "yes" && r.waitlistPosition === null).reduce((s, r) => s + (r.partySize ?? 1), 0);
    const wl = refreshed.filter((r) => r.waitlistPosition !== null).sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0));
    let free = event.capacity - attending;
    for (const w of wl) {
      const ps = w.partySize ?? 1;
      if (ps <= free) {
        await db.update(calendarEventRsvpsTable)
          .set({ waitlistPosition: null, updatedAt: nowISO() })
          .where(eq(calendarEventRsvpsTable.id, w.id));
        free -= ps;
      }
    }
  }

  // Task #78: send ICS-attached email invite (best-effort, non-blocking).
  try {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (u?.email) {
      const inviteStatus: "attending" | "waitlisted" | "declined" =
        status === "yes" && waitlistPosition === null ? "attending" :
        status === "yes" ? "waitlisted" : "declined";
      const occStart = occurrenceKey || event.startsAt;
      const occEnd = occurrenceKey ? occurrenceKey : event.endsAt;
      const ics = buildInviteIcs({
        eventId: event.id,
        occurrenceKey,
        title: event.title,
        description: event.body ?? "",
        startsAt: occStart,
        endsAt: occEnd,
        allDay: event.allDay ?? false,
        location: event.locationText ?? null,
        organizerEmail: process.env.EMAIL_FROM ?? "no-reply@hoahub.app",
        organizerName: "HOA Operations Hub",
        attendeeEmail: u.email,
        attendeeName: u.name ?? userName,
        cancel: inviteStatus === "declined",
      });
      const html = buildEventInviteEmail({
        orgName: "HOA Operations Hub",
        eventTitle: event.title,
        startsAtLabel: occStart,
        location: event.locationText ?? null,
        status: inviteStatus,
        partySize,
      });
      await sendEmailWithIcs({
        to: u.email,
        subject: inviteStatus === "declined" ? `RSVP cancelled: ${event.title}` : inviteStatus === "waitlisted" ? `Waitlisted: ${event.title}` : `RSVP confirmed: ${event.title}`,
        html,
        ics,
      });
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "RSVP invite email failed");
  }

  const summary = await loadRsvpSummary(id, occurrenceKey, userId);
  res.json(summary);
});

router.delete("/calendar/events/:id/rsvp", authenticateJwt, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [event] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, id));
  if (!event) { res.status(404).json({ error: "Not found" }); return; }
  const subs = await loadAllSubs();
  const sub = subs.find((s) => s.id === event.subCalendarId);
  if (!sub || !canView(req.user!, sub)) { res.status(403).json({ error: "Forbidden" }); return; }
  const occurrenceKey = typeof req.query.occurrenceKey === "string" ? req.query.occurrenceKey : "";
  await db.delete(calendarEventRsvpsTable).where(and(
    eq(calendarEventRsvpsTable.eventId, id),
    eq(calendarEventRsvpsTable.occurrenceKey, occurrenceKey),
    eq(calendarEventRsvpsTable.userId, req.user!.id),
  ));
  const summary = await loadRsvpSummary(id, occurrenceKey, req.user!.id);
  res.json(summary);
});

// ── Task #78: Trash holiday shifts CRUD ──────────────────────────────────

router.get("/calendar/trash/holidays", authenticateJwt, async (_req, res) => {
  const rows = await db.select().from(trashHolidayShiftsTable).orderBy(asc(trashHolidayShiftsTable.holidayDate));
  res.json(rows);
});

router.post("/calendar/trash/holidays", authenticateJwt, async (req, res) => {
  if (req.user!.role !== "admin" && req.user!.role !== "manager") { res.status(403).json({ error: "Manager only" }); return; }
  const { holidayDate, label, shiftDays, weekdays } = req.body ?? {};
  if (typeof holidayDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(holidayDate)) { res.status(400).json({ error: "holidayDate required (YYYY-MM-DD)" }); return; }
  if (typeof label !== "string" || !label.trim()) { res.status(400).json({ error: "label required" }); return; }
  const days = Number(shiftDays);
  if (!Number.isFinite(days)) { res.status(400).json({ error: "shiftDays must be a number" }); return; }
  const wd = typeof weekdays === "string" ? weekdays : "";
  const now = nowISO();
  const [row] = await db.insert(trashHolidayShiftsTable).values({
    holidayDate, label: label.trim(), shiftDays: Math.floor(days), weekdays: wd,
    createdAt: now,
  }).returning();
  await applyHolidayShifts();
  res.status(201).json(row);
});

router.delete("/calendar/trash/holidays/:id", authenticateJwt, async (req, res) => {
  if (req.user!.role !== "admin" && req.user!.role !== "manager") { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(trashHolidayShiftsTable).where(eq(trashHolidayShiftsTable.id, id));
  await applyHolidayShifts();
  res.status(204).end();
});

router.post("/calendar/trash/seed", authenticateJwt, async (req, res) => {
  if (req.user!.role !== "admin" && req.user!.role !== "manager") { res.status(403).json({ error: "Manager only" }); return; }
  await ensureTrashSchedule();
  res.json({ ok: true });
});

// ── Task #78: Public share tokens ────────────────────────────────────────

router.get("/calendar/share-tokens", authenticateJwt, async (req, res) => {
  if (req.user!.role !== "admin" && req.user!.role !== "manager") { res.status(403).json({ error: "Manager only" }); return; }
  const rows = await db.select().from(calendarShareTokensTable).orderBy(asc(calendarShareTokensTable.id));
  res.json(rows.map((r) => ({
    id: r.id, token: r.token, label: r.label, subCalendarSlugs: r.subCalendarSlugs,
    createdAt: r.createdAt, revokedAt: r.revokedAt,
  })));
});

router.post("/calendar/share-tokens", authenticateJwt, async (req, res) => {
  if (req.user!.role !== "admin" && req.user!.role !== "manager") { res.status(403).json({ error: "Manager only" }); return; }
  const label = String(req.body?.label ?? "Public share").slice(0, 200);
  const subCalendarSlugs = Array.isArray(req.body?.subCalendarSlugs) ? req.body.subCalendarSlugs.map(String) : ["community", "amenities"];
  const token = crypto.randomBytes(24).toString("base64url");
  const now = nowISO();
  const [row] = await db.insert(calendarShareTokensTable).values({
    token, label, subCalendarSlugs, createdByUserId: req.user!.id,
    createdAt: now, revokedAt: null,
  }).returning();
  res.status(201).json(row);
});

router.delete("/calendar/share-tokens/:id", authenticateJwt, async (req, res) => {
  if (req.user!.role !== "admin" && req.user!.role !== "manager") { res.status(403).json({ error: "Manager only" }); return; }
  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.update(calendarShareTokensTable).set({ revokedAt: nowISO() }).where(eq(calendarShareTokensTable.id, id));
  res.status(204).end();
});

// Public read endpoint — token-gated, no auth.
publicRouter.get("/public/calendar/:token", async (req, res) => {
  const token = String(req.params.token ?? "");
  const [row] = await db.select().from(calendarShareTokensTable).where(eq(calendarShareTokensTable.token, token));
  if (!row || row.revokedAt) { res.status(404).json({ error: "Invalid or revoked link" }); return; }
  const subs = await loadAllSubs();
  const allowed = subs.filter((s) => row.subCalendarSlugs.includes(s.slug));
  if (allowed.length === 0) { res.status(404).json({ error: "No sub-calendars" }); return; }
  const allowedIds = allowed.map((s) => s.id);
  const events = await db.select().from(calendarEventsTable).where(and(
    inArray(calendarEventsTable.subCalendarId, allowedIds),
    eq(calendarEventsTable.cancelled, false),
  ));
  // Strip private fields (descriptions, attendees, attachments, RSVPs).
  const sanitized = events.map((e) => ({
    id: e.id,
    subCalendarId: e.subCalendarId,
    subCalendarSlug: allowed.find((s) => s.id === e.subCalendarId)?.slug ?? null,
    title: e.title,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    allDay: e.allDay,
    locationText: e.locationText,
    recurrence: e.recurrence,
    exceptions: e.exceptions,
    overrides: e.overrides,
  }));
  res.json({
    label: row.label,
    subCalendars: allowed.map(publicSub),
    events: sanitized,
  });
});

export { publicRouter as calendarPublicRouter };
export default router;
