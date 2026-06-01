// Task #75: Calendar — Governance & Operations Integrations.
//
// Service-layer helper that materializes calendar events from existing data
// sources (meetings, motions, resolutions, work orders, bids, ACC apps,
// vendor contracts, inspections, compliance items, lifecycle items, vendor
// cert expirations, election cycles, officer terms). Each source provides a
// (sourceRefType, sourceRefId) pair that uniquely identifies the calendar
// event so this helper can upsert idempotently.

import { db } from "@workspace/db";
import {
  calendarSubCalendarsTable,
  calendarEventsTable,
  type CalendarRecurrence,
  type CalendarSubCalendar,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger.js";

function nowISO(): string { return new Date().toISOString(); }

// Default sub-calendars seeded on first call. Foundation task uses these
// slugs; we ensure the rows exist so materialization never blows up on a
// fresh DB.
const DEFAULT_SUBS: Array<Omit<CalendarSubCalendar, "id">> = [
  { slug: "board",       name: "Board",       color: "#3245FF", description: "Board meetings, motions, resolutions, terms",
    editorRoles: ["admin", "manager", "board"], viewerRoles: ["admin", "manager", "board"], isPublic: false, isExternal: false, sortOrder: 10 },
  { slug: "committees",  name: "Committees",  color: "#8B5CF6", description: "Committee meetings (parent)",
    editorRoles: ["admin", "manager", "board"], viewerRoles: ["admin", "manager", "board"], isPublic: false, isExternal: false, sortOrder: 20 },
  { slug: "operations",  name: "Operations",  color: "#0EA5E9", description: "Work orders, bids, vendor service contracts",
    editorRoles: ["admin", "manager"], viewerRoles: ["admin", "manager", "board"], isPublic: false, isExternal: false, sortOrder: 30 },
  { slug: "financial",   name: "Financial",   color: "#10B981", description: "Financial milestones",
    editorRoles: ["admin", "manager"], viewerRoles: ["admin", "manager", "board"], isPublic: false, isExternal: false, sortOrder: 40 },
  { slug: "compliance",  name: "Compliance",  color: "#F59E0B", description: "Compliance, inspections, vendor cert expirations",
    editorRoles: ["admin", "manager"], viewerRoles: ["admin", "manager", "board"], isPublic: false, isExternal: false, sortOrder: 50 },
  { slug: "community",   name: "Community",   color: "#EC4899", description: "Community events",
    editorRoles: ["admin", "manager"], viewerRoles: [], isPublic: true, isExternal: false, sortOrder: 60 },
  { slug: "amenities",   name: "Amenities",   color: "#A855F7", description: "Amenity reservations",
    editorRoles: ["admin", "manager"], viewerRoles: [], isPublic: false, isExternal: false, sortOrder: 70 },
  { slug: "external",    name: "External",    color: "#64748B", description: "External feeds",
    editorRoles: ["admin"], viewerRoles: ["admin", "manager", "board"], isPublic: false, isExternal: true, sortOrder: 80 },
];

let subsEnsured = false;
async function ensureDefaultSubs(): Promise<void> {
  if (subsEnsured) return;
  const existing = await db.select().from(calendarSubCalendarsTable);
  const have = new Set(existing.map((s) => s.slug));
  for (const s of DEFAULT_SUBS) {
    if (have.has(s.slug)) continue;
    await db.insert(calendarSubCalendarsTable).values({
      slug: s.slug, name: s.name, color: s.color, description: s.description,
      editorRoles: s.editorRoles, viewerRoles: s.viewerRoles,
      isPublic: s.isPublic, isExternal: s.isExternal, sortOrder: s.sortOrder,
    });
  }
  subsEnsured = true;
}

export async function getSubBySlug(slug: string): Promise<CalendarSubCalendar | null> {
  await ensureDefaultSubs();
  const [row] = await db.select().from(calendarSubCalendarsTable).where(eq(calendarSubCalendarsTable.slug, slug));
  return row ?? null;
}

export async function getOrCreateCommitteeSub(committeeSlug: string, name: string, color = "#8B5CF6"): Promise<CalendarSubCalendar> {
  await ensureDefaultSubs();
  const slug = `committees-${committeeSlug}`;
  const [existing] = await db.select().from(calendarSubCalendarsTable).where(eq(calendarSubCalendarsTable.slug, slug));
  if (existing) return existing;
  const [created] = await db.insert(calendarSubCalendarsTable).values({
    slug, name: `Committee — ${name}`, color, description: `${name} committee meetings`,
    editorRoles: ["admin", "manager", "board"], viewerRoles: ["admin", "manager", "board"],
    isPublic: false, isExternal: false, sortOrder: 25,
  }).returning();
  return created!;
}

export interface UpsertEventOpts {
  subSlug: string;
  sourceRefType: string;
  sourceRefId: string;
  title: string;
  body?: string;
  startsAt: string;
  endsAt: string;
  allDay?: boolean;
  locationText?: string | null;
  locationUrl?: string | null;
  recurrence?: CalendarRecurrence | null;
  cancelled?: boolean;
}

/**
 * Upsert a calendar event by (sourceRefType, sourceRefId). If the row exists
 * it is updated in place, preserving its id, attachments, reminders, etc.
 * `source` column is set to "<type>:<id>" for human readability.
 */
export async function upsertSourceEvent(opts: UpsertEventOpts): Promise<number | null> {
  try {
    await ensureDefaultSubs();
    const sub = await getSubBySlug(opts.subSlug);
    if (!sub) {
      logger.warn({ slug: opts.subSlug }, "calendarMaterialize: sub-calendar not found");
      return null;
    }
    const source = `${opts.sourceRefType}:${opts.sourceRefId}`;
    const existing = await db.select().from(calendarEventsTable).where(and(
      eq(calendarEventsTable.sourceRefType, opts.sourceRefType),
      eq(calendarEventsTable.sourceRefId, opts.sourceRefId),
    ));
    const now = nowISO();
    if (existing[0]) {
      await db.update(calendarEventsTable).set({
        subCalendarId: sub.id,
        title: opts.title.slice(0, 240),
        body: opts.body ?? "",
        startsAt: opts.startsAt,
        endsAt: opts.endsAt,
        allDay: opts.allDay === true,
        locationText: opts.locationText ?? null,
        locationUrl: opts.locationUrl ?? null,
        recurrence: opts.recurrence ?? null,
        source,
        cancelled: opts.cancelled === true,
        updatedAt: now,
      }).where(eq(calendarEventsTable.id, existing[0].id));
      return existing[0].id;
    }
    const [created] = await db.insert(calendarEventsTable).values({
      subCalendarId: sub.id,
      title: opts.title.slice(0, 240),
      body: opts.body ?? "",
      startsAt: opts.startsAt,
      endsAt: opts.endsAt,
      allDay: opts.allDay === true,
      locationText: opts.locationText ?? null,
      locationUrl: opts.locationUrl ?? null,
      recurrence: opts.recurrence ?? null,
      exceptions: [],
      overrides: [],
      source,
      sourceRefType: opts.sourceRefType,
      sourceRefId: opts.sourceRefId,
      externalUid: null,
      cancelled: opts.cancelled === true,
      createdByUserId: null,
      createdByName: opts.sourceRefType,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return created!.id;
  } catch (err) {
    logger.warn({ err, opts }, "calendarMaterialize: upsertSourceEvent failed");
    return null;
  }
}

export async function removeSourceEvent(sourceRefType: string, sourceRefId: string): Promise<void> {
  try {
    await db.update(calendarEventsTable).set({
      cancelled: true, updatedAt: nowISO(),
    }).where(and(
      eq(calendarEventsTable.sourceRefType, sourceRefType),
      eq(calendarEventsTable.sourceRefId, sourceRefId),
    ));
  } catch (err) {
    logger.warn({ err, sourceRefType, sourceRefId }, "calendarMaterialize: removeSourceEvent failed");
  }
}

export async function removeSourceEventsByPrefix(sourceRefType: string, sourceRefIdPrefix: string): Promise<void> {
  try {
    const rows = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.sourceRefType, sourceRefType));
    for (const row of rows) {
      if (row.sourceRefId && row.sourceRefId.startsWith(sourceRefIdPrefix)) {
        await db.update(calendarEventsTable).set({
          cancelled: true, updatedAt: nowISO(),
        }).where(eq(calendarEventsTable.id, row.id));
      }
    }
  } catch (err) {
    logger.warn({ err, sourceRefType, sourceRefIdPrefix }, "calendarMaterialize: removeSourceEventsByPrefix failed");
  }
}

// ── Source-specific materializers ──────────────────────────────────────────

function plusMinutesISO(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}
function minusDaysISO(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() - days * 86_400_000).toISOString();
}
function dayOnly(iso: string): string {
  return iso.slice(0, 10);
}

interface MeetingShape {
  id: number; kind: string; title: string; scheduledAt: string;
  durationMinutes: number; locationPhysical: string | null;
  locationVideoLink: string | null; status: string; noticePostedAt: string | null;
}
interface OrgNoticeDays { open: number; executive: number; annual: number }

export async function materializeMeeting(m: MeetingShape, noticeDays: OrgNoticeDays): Promise<void> {
  const cancelled = m.status === "cancelled";
  await upsertSourceEvent({
    subSlug: "board",
    sourceRefType: "meeting",
    sourceRefId: String(m.id),
    title: `[${m.kind}] ${m.title}`,
    body: `Meeting status: ${m.status}`,
    startsAt: m.scheduledAt,
    endsAt: plusMinutesISO(m.scheduledAt, m.durationMinutes),
    locationText: m.locationPhysical,
    locationUrl: m.locationVideoLink,
    cancelled,
  });
  // Earliest legal date marker = scheduledAt - noticeDays(kind).
  const reqDays = m.kind === "annual" ? noticeDays.annual : m.kind === "executive" ? noticeDays.executive : noticeDays.open;
  const earliestIso = minusDaysISO(m.scheduledAt, reqDays);
  await upsertSourceEvent({
    subSlug: "board",
    sourceRefType: "meeting_notice_window",
    sourceRefId: String(m.id),
    title: `Earliest legal date: "${m.title}"`,
    body: `Notice window for ${m.kind} meeting: ${reqDays} days. Posting on or before this date keeps the meeting compliant.`,
    startsAt: dayOnly(earliestIso),
    endsAt: dayOnly(earliestIso),
    allDay: true,
    cancelled,
  });
  // Notice posted marker.
  if (m.noticePostedAt) {
    await upsertSourceEvent({
      subSlug: "board",
      sourceRefType: "meeting_notice_posted",
      sourceRefId: String(m.id),
      title: `Notice posted: "${m.title}"`,
      body: `Meeting notice posted ${m.noticePostedAt}`,
      startsAt: dayOnly(m.noticePostedAt),
      endsAt: dayOnly(m.noticePostedAt),
      allDay: true,
      cancelled,
    });
  }
}

export async function removeMeeting(id: number): Promise<void> {
  await removeSourceEvent("meeting", String(id));
  await removeSourceEvent("meeting_notice_window", String(id));
  await removeSourceEvent("meeting_notice_posted", String(id));
}

export async function materializeMotionDeadline(motion: { id: number; title: string; closesAt: string | null; status: string; outcome: string | null }): Promise<void> {
  if (!motion.closesAt) {
    await removeSourceEvent("motion", String(motion.id));
    return;
  }
  const isResolved = motion.status !== "open" && motion.status !== "draft";
  const titlePrefix = isResolved ? `[${motion.outcome ?? motion.status}] ` : "Vote closes: ";
  await upsertSourceEvent({
    subSlug: "board",
    sourceRefType: "motion",
    sourceRefId: String(motion.id),
    title: `${titlePrefix}${motion.title}`,
    body: `Motion #M-${motion.id}`,
    startsAt: motion.closesAt,
    endsAt: motion.closesAt,
    allDay: false,
    cancelled: motion.status === "withdrawn",
  });
}

export async function materializeResolutionEffective(r: { id: number; number: string | null; title: string; adoptedAt: string | null }): Promise<void> {
  if (!r.adoptedAt) { await removeSourceEvent("resolution", String(r.id)); return; }
  const day = dayOnly(r.adoptedAt);
  await upsertSourceEvent({
    subSlug: "board",
    sourceRefType: "resolution",
    sourceRefId: String(r.id),
    title: `Effective: Resolution ${r.number ?? `#${r.id}`} — ${r.title}`,
    body: `Adopted ${r.adoptedAt}`,
    startsAt: day, endsAt: day, allDay: true,
  });
}

export async function materializeWorkOrder(wo: { id: string; title: string; status: string; due: string | null; opened: string }): Promise<void> {
  if (!wo.due) { await removeSourceEvent("work_order", wo.id); return; }
  const cancelled = wo.status === "cancelled";
  const day = dayOnly(wo.due);
  await upsertSourceEvent({
    subSlug: "operations",
    sourceRefType: "work_order",
    sourceRefId: wo.id,
    title: `[${wo.status}] WO ${wo.id}: ${wo.title}`,
    body: `Status: ${wo.status} · Opened: ${wo.opened}`,
    startsAt: day, endsAt: day, allDay: true,
    cancelled,
  });
}

export async function materializeBidMilestones(bid: { id: number; title: string; status: string; createdAt: string; deadline: string; awardedAt: string | null; awardedVendorName: string | null }): Promise<void> {
  const open = dayOnly(bid.createdAt);
  await upsertSourceEvent({
    subSlug: "operations",
    sourceRefType: "bid_open", sourceRefId: String(bid.id),
    title: `Bid open: ${bid.title}`, body: `Bid #${bid.id}`,
    startsAt: open, endsAt: open, allDay: true,
    cancelled: bid.status === "cancelled",
  });
  const close = dayOnly(bid.deadline);
  await upsertSourceEvent({
    subSlug: "operations",
    sourceRefType: "bid_close", sourceRefId: String(bid.id),
    title: `Bid deadline: ${bid.title}`, body: `Bid #${bid.id}`,
    startsAt: close, endsAt: close, allDay: true,
    cancelled: bid.status === "cancelled",
  });
  // Decision deadline = close + 7 days (default review window).
  const decision = dayOnly(new Date(new Date(bid.deadline).getTime() + 7 * 86400000).toISOString());
  await upsertSourceEvent({
    subSlug: "operations",
    sourceRefType: "bid_decision", sourceRefId: String(bid.id),
    title: `Bid decision by: ${bid.title}`, body: `Bid #${bid.id}`,
    startsAt: decision, endsAt: decision, allDay: true,
    cancelled: bid.status === "cancelled" || bid.status === "awarded",
  });
  if (bid.awardedAt) {
    const awarded = dayOnly(bid.awardedAt);
    await upsertSourceEvent({
      subSlug: "operations",
      sourceRefType: "bid_awarded", sourceRefId: String(bid.id),
      title: `Awarded${bid.awardedVendorName ? ` to ${bid.awardedVendorName}` : ""}: ${bid.title}`,
      body: `Bid #${bid.id}`,
      startsAt: awarded, endsAt: awarded, allDay: true,
    });
  }
}

export async function removeBidMilestones(id: number): Promise<void> {
  for (const t of ["bid_open", "bid_close", "bid_decision", "bid_awarded"]) {
    await removeSourceEvent(t, String(id));
  }
}

export async function materializeAccDeadline(req: { id: number; title: string; submittedAt: string; status: string; decidedAt: string | null }, autoApprovalDays: number): Promise<void> {
  if (req.status !== "submitted" && req.status !== "under_review") {
    await removeSourceEvent("acc_request", String(req.id));
    return;
  }
  if (autoApprovalDays <= 0) return;
  const decideBy = dayOnly(new Date(new Date(req.submittedAt).getTime() + autoApprovalDays * 86400000).toISOString());
  // Try to use the ACC committee sub-calendar if present, else fall back to "committees".
  const accSub = await getSubBySlug("committees-acc");
  const subSlug = accSub ? "committees-acc" : "committees";
  await upsertSourceEvent({
    subSlug,
    sourceRefType: "acc_request",
    sourceRefId: String(req.id),
    title: `ACC decide by: ${req.title}`,
    body: `Application #${req.id} · status: ${req.status}`,
    startsAt: decideBy, endsAt: decideBy, allDay: true,
  });
}

export async function materializeOfficerTerm(u: { id: number; name: string; email: string; officerTitle: string | null; termStart: string | null; termEnd: string | null; boardMember: boolean }): Promise<void> {
  if (!u.boardMember || !u.officerTitle) {
    await removeSourceEvent("officer_term_start", String(u.id));
    await removeSourceEvent("officer_term_end", String(u.id));
    return;
  }
  const display = u.name || u.email;
  if (u.termStart) {
    const d = dayOnly(u.termStart);
    await upsertSourceEvent({
      subSlug: "board",
      sourceRefType: "officer_term_start", sourceRefId: String(u.id),
      title: `${u.officerTitle} term start — ${display}`,
      body: `Officer term begins`,
      startsAt: d, endsAt: d, allDay: true,
    });
  } else {
    await removeSourceEvent("officer_term_start", String(u.id));
  }
  if (u.termEnd) {
    const d = dayOnly(u.termEnd);
    await upsertSourceEvent({
      subSlug: "board",
      sourceRefType: "officer_term_end", sourceRefId: String(u.id),
      title: `${u.officerTitle} term end — ${display}`,
      body: `Officer term concludes`,
      startsAt: d, endsAt: d, allDay: true,
    });
  } else {
    await removeSourceEvent("officer_term_end", String(u.id));
  }
}

export async function materializeElectionCycle(c: { id: number; year: number; label: string; nominationsOpenOn: string | null; nominationsCloseOn: string | null; ballotMailingOn: string | null; electionDayOn: string | null }): Promise<void> {
  const milestones: Array<[string, string | null, string]> = [
    ["nominations_open", c.nominationsOpenOn, "Nominations open"],
    ["nominations_close", c.nominationsCloseOn, "Nominations close"],
    ["ballot_mailing", c.ballotMailingOn, "Ballot mailing"],
    ["election_day", c.electionDayOn, "Election day"],
  ];
  for (const [key, date, label] of milestones) {
    const refType = `election_${key}`;
    if (!date) {
      await removeSourceEvent(refType, String(c.id));
      continue;
    }
    const d = dayOnly(date);
    await upsertSourceEvent({
      subSlug: "board",
      sourceRefType: refType, sourceRefId: String(c.id),
      title: `${label} — ${c.label}`,
      body: `Election cycle ${c.year}`,
      startsAt: d, endsAt: d, allDay: true,
    });
  }
}

export async function removeElectionCycle(id: number): Promise<void> {
  for (const key of ["nominations_open", "nominations_close", "ballot_mailing", "election_day"]) {
    await removeSourceEvent(`election_${key}`, String(id));
  }
}

export async function materializeVendorContract(c: { id: number; title: string; firstServiceOn: string; durationMinutes: number; recurrence: CalendarRecurrence | null; active: boolean; vendorName: string }): Promise<void> {
  const start = c.firstServiceOn.length === 10 ? `${c.firstServiceOn}T08:00:00.000Z` : c.firstServiceOn;
  await upsertSourceEvent({
    subSlug: "operations",
    sourceRefType: "vendor_contract", sourceRefId: String(c.id),
    title: `${c.title} — ${c.vendorName}`,
    body: `Recurring vendor service`,
    startsAt: start,
    endsAt: plusMinutesISO(start, c.durationMinutes),
    recurrence: c.recurrence ?? null,
    cancelled: !c.active,
  });
}

export async function materializeInspection(i: { id: number; title: string; scheduledOn: string; durationMinutes: number; assigneeName: string | null; status: string; agency: string | null; kind: string }): Promise<void> {
  const start = i.scheduledOn.length === 10 ? `${i.scheduledOn}T09:00:00.000Z` : i.scheduledOn;
  // Permits / easements go on Compliance; everything else stays on Operations.
  const subSlug = (i.kind === "permit" || i.kind === "easement") ? "compliance" : "operations";
  await upsertSourceEvent({
    subSlug,
    sourceRefType: "inspection", sourceRefId: String(i.id),
    title: `Inspection: ${i.title}`,
    body: [i.assigneeName ? `Assignee: ${i.assigneeName}` : "", i.agency ? `Agency: ${i.agency}` : ""].filter(Boolean).join(" · "),
    startsAt: start, endsAt: plusMinutesISO(start, i.durationMinutes),
    cancelled: i.status === "cancelled",
  });
}



export async function materializeLifecycleItem(l: { id: number; title: string; lastDoneOn: string | null; intervalMonths: number; recurrence: CalendarRecurrence | null; active: boolean }): Promise<void> {
  const cancelled = !l.active;
  let nextDue: string | null = null;
  if (l.recurrence) {
    nextDue = l.lastDoneOn ?? new Date().toISOString().slice(0, 10);
  } else if (l.lastDoneOn) {
    const d = new Date(l.lastDoneOn);
    d.setMonth(d.getMonth() + (l.intervalMonths || 12));
    nextDue = d.toISOString().slice(0, 10);
  } else {
    // No history yet — schedule for today + interval.
    const d = new Date();
    d.setMonth(d.getMonth() + (l.intervalMonths || 12));
    nextDue = d.toISOString().slice(0, 10);
  }
  await upsertSourceEvent({
    subSlug: "operations",
    sourceRefType: "lifecycle_item", sourceRefId: String(l.id),
    title: `Next due: ${l.title}`,
    body: l.lastDoneOn ? `Last done ${l.lastDoneOn}; interval ${l.intervalMonths}m.` : `Interval ${l.intervalMonths}m.`,
    startsAt: nextDue, endsAt: nextDue, allDay: true,
    recurrence: l.recurrence ?? null,
    cancelled,
  });
}

export async function materializeVendorCertificate(c: { id: number; vendorName: string; kind: string; expiresOn: string }): Promise<void> {
  const exp = dayOnly(c.expiresOn);
  await upsertSourceEvent({
    subSlug: "compliance",
    sourceRefType: "vendor_certificate", sourceRefId: String(c.id),
    title: `${c.kind.toUpperCase()} expires: ${c.vendorName}`,
    body: `Vendor ${c.kind} expiry`,
    startsAt: exp, endsAt: exp, allDay: true,
  });
  for (const d of [30, 60, 90]) {
    const remDay = dayOnly(new Date(new Date(c.expiresOn).getTime() - d * 86400000).toISOString());
    await upsertSourceEvent({
      subSlug: "compliance",
      sourceRefType: `vendor_certificate_reminder_${d}`,
      sourceRefId: String(c.id),
      title: `${d}d reminder: ${c.kind.toUpperCase()} expires — ${c.vendorName}`,
      body: `Reminder ${d} days before ${c.vendorName} ${c.kind} expiry`,
      startsAt: remDay, endsAt: remDay, allDay: true,
    });
  }
}

export async function removeVendorCertificate(id: number): Promise<void> {
  await removeSourceEvent("vendor_certificate", String(id));
  for (const d of [30, 60, 90]) await removeSourceEvent(`vendor_certificate_reminder_${d}`, String(id));
}
