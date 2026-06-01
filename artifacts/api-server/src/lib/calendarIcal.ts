// Task #74: Minimal RFC 5545 iCalendar producer + lightweight parser for
// external feed import. Hand-rolled to avoid a heavy dependency.

import type { CalendarRecurrence } from "@workspace/db/schema";
import type { ExpandedInstance } from "./calendarRecurrence.js";

function escIcal(s: string): string {
  return (s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function toIcalUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function toIcalDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, "");
}

export function buildIcs(opts: {
  calendarName: string;
  events: Array<{
    instance: ExpandedInstance;
    title: string;
    body: string;
    location: string | null;
    locationUrl: string | null;
    allDay: boolean;
  }>;
}): string {
  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//HOA Hub//Calendar//EN");
  lines.push("CALSCALE:GREGORIAN");
  lines.push(`X-WR-CALNAME:${escIcal(opts.calendarName)}`);
  lines.push("X-WR-TIMEZONE:America/Chicago");

  for (const e of opts.events) {
    lines.push("BEGIN:VEVENT");
    const uid = `event-${e.instance.eventId}-${e.instance.occurrenceKey}@hoahub`;
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${toIcalUtc(new Date().toISOString())}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${toIcalDate(e.instance.startsAt)}`);
      lines.push(`DTEND;VALUE=DATE:${toIcalDate(e.instance.endsAt)}`);
    } else {
      lines.push(`DTSTART:${toIcalUtc(e.instance.startsAt)}`);
      lines.push(`DTEND:${toIcalUtc(e.instance.endsAt)}`);
    }
    lines.push(`SUMMARY:${escIcal(e.title)}`);
    if (e.body) lines.push(`DESCRIPTION:${escIcal(e.body)}`);
    if (e.location) lines.push(`LOCATION:${escIcal(e.location)}`);
    if (e.locationUrl) lines.push(`URL:${escIcal(e.locationUrl)}`);
    if (e.instance.cancelled) lines.push("STATUS:CANCELLED");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// ── Lightweight ICS parser for external feeds ─────────────────────────────
// Returns flat events (no recurrence expansion). Fields: uid, summary,
// description, location, dtstart/dtend (ISO), allDay.
export interface ParsedIcalEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
}

function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function unesc(s: string): string {
  return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function parseIcalDate(value: string, isDate: boolean): string {
  // Date-only: YYYYMMDD
  if (isDate || /^\d{8}$/.test(value)) {
    const y = value.slice(0, 4);
    const m = value.slice(4, 6);
    const d = value.slice(6, 8);
    return `${y}-${m}-${d}`;
  }
  // YYYYMMDDTHHMMSSZ or local
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!m) return new Date(value).toISOString();
  const [, y, mo, d, h, mi, s, z] = m;
  if (z === "Z") {
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString();
  }
  // Treat as America/Chicago (UTC-6 / DST UTC-5). For external feeds that
  // typically use UTC or DATE values this branch is rarely hit; we fall back
  // to UTC interpretation rather than guess.
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString();
}

export function parseIcs(text: string): ParsedIcalEvent[] {
  const lines = unfold(text);
  const events: ParsedIcalEvent[] = [];
  let cur: Partial<ParsedIcalEvent> & { _allDay?: boolean } | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = { uid: "", summary: "", description: "", location: "", startsAt: "", endsAt: "", _allDay: false };
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur && cur.uid && cur.startsAt) {
        if (!cur.endsAt) cur.endsAt = cur.startsAt;
        events.push({
          uid: cur.uid,
          summary: cur.summary ?? "",
          description: cur.description ?? "",
          location: cur.location ?? "",
          startsAt: cur.startsAt,
          endsAt: cur.endsAt,
          allDay: cur._allDay === true,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const head = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);
    const [name, ...params] = head.split(";");
    const isDate = params.some((p) => p.toUpperCase() === "VALUE=DATE");
    const upper = name.toUpperCase();
    if (upper === "UID") cur.uid = value;
    else if (upper === "SUMMARY") cur.summary = unesc(value);
    else if (upper === "DESCRIPTION") cur.description = unesc(value);
    else if (upper === "LOCATION") cur.location = unesc(value);
    else if (upper === "DTSTART") {
      cur.startsAt = parseIcalDate(value, isDate);
      cur._allDay = isDate;
    } else if (upper === "DTEND") {
      cur.endsAt = parseIcalDate(value, isDate);
    }
  }
  return events;
}

export function describeRecurrenceForIcal(_r: CalendarRecurrence): string | null {
  // Reserved for a future RRULE serializer. The MVP serves expanded
  // instances which is what most calendar clients consume cleanly.
  return null;
}

// Task #78: METHOD:REQUEST/CANCEL invite for a single occurrence — emailed
// to the RSVP'ing user so their personal calendar picks up the event. The
// SEQUENCE value increments on cancel so calendar clients treat the new ICS
// as an update to the original invite.
export interface InviteIcsOpts {
  eventId: number;
  occurrenceKey: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string | null;
  organizerEmail: string;
  organizerName: string;
  attendeeEmail: string;
  attendeeName: string;
  cancel: boolean;
  sequence?: number;
}

export function buildInviteIcs(opts: InviteIcsOpts): string {
  const lines: string[] = [];
  const method = opts.cancel ? "CANCEL" : "REQUEST";
  const seq = opts.sequence ?? (opts.cancel ? 1 : 0);
  const uid = `event-${opts.eventId}-${opts.occurrenceKey || "base"}@hoahub`;
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//HOA Hub//Calendar//EN");
  lines.push("CALSCALE:GREGORIAN");
  lines.push(`METHOD:${method}`);
  lines.push("BEGIN:VEVENT");
  lines.push(`UID:${uid}`);
  lines.push(`DTSTAMP:${toIcalUtc(new Date().toISOString())}`);
  lines.push(`SEQUENCE:${seq}`);
  if (opts.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${toIcalDate(opts.startsAt)}`);
    lines.push(`DTEND;VALUE=DATE:${toIcalDate(opts.endsAt)}`);
  } else {
    lines.push(`DTSTART:${toIcalUtc(opts.startsAt)}`);
    lines.push(`DTEND:${toIcalUtc(opts.endsAt)}`);
  }
  lines.push(`SUMMARY:${escIcal(opts.title)}`);
  if (opts.description) lines.push(`DESCRIPTION:${escIcal(opts.description)}`);
  if (opts.location) lines.push(`LOCATION:${escIcal(opts.location)}`);
  lines.push(`ORGANIZER;CN=${escIcal(opts.organizerName)}:mailto:${opts.organizerEmail}`);
  lines.push(
    `ATTENDEE;CN=${escIcal(opts.attendeeName)};RSVP=TRUE;PARTSTAT=${opts.cancel ? "DECLINED" : "ACCEPTED"};ROLE=REQ-PARTICIPANT:mailto:${opts.attendeeEmail}`,
  );
  lines.push(`STATUS:${opts.cancel ? "CANCELLED" : "CONFIRMED"}`);
  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
