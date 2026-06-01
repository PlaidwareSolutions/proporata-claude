// Task #74: Recurring expansion engine.
// Given a base event + recurrence rule + exceptions/overrides, expand to
// concrete instances within [from, to]. Server-side so clients always
// receive concrete dates.

import type { CalendarRecurrence } from "@workspace/db/schema";

export interface BaseEvent {
  id: number;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  recurrence: CalendarRecurrence;
  exceptions: string[];
  overrides: Array<{
    originalDate: string;
    startsAt?: string;
    endsAt?: string;
    title?: string;
    body?: string;
    cancelled?: boolean;
  }>;
}

export interface ExpandedInstance {
  eventId: number;
  occurrenceKey: string; // ISO date of the original (un-overridden) start
  startsAt: string;
  endsAt: string;
  cancelled: boolean;
  titleOverride?: string;
  bodyOverride?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

function dayCodeIndex(code: string): number {
  return DAY_CODES.indexOf(code as (typeof DAY_CODES)[number]);
}

function clampWindow(d: Date, from: Date, to: Date): boolean {
  const t = d.getTime();
  return t >= from.getTime() && t <= to.getTime();
}

function addInterval(d: Date, freq: string, n: number): Date {
  const r = new Date(d.getTime());
  if (freq === "DAILY") r.setUTCDate(r.getUTCDate() + n);
  else if (freq === "WEEKLY") r.setUTCDate(r.getUTCDate() + n * 7);
  else if (freq === "MONTHLY") r.setUTCMonth(r.getUTCMonth() + n);
  else if (freq === "YEARLY") r.setUTCFullYear(r.getUTCFullYear() + n);
  return r;
}

export function expandEvent(
  ev: BaseEvent,
  fromIso: string,
  toIso: string,
  hardCap = 500,
): ExpandedInstance[] {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const start = new Date(ev.startsAt);
  const end = new Date(ev.endsAt);
  const durationMs = end.getTime() - start.getTime();

  const out: ExpandedInstance[] = [];

  const exceptionSet = new Set(
    (ev.exceptions ?? []).map((s) => s.slice(0, 10)),
  );
  const overridesByKey = new Map<string, BaseEvent["overrides"][number]>();
  for (const o of ev.overrides ?? []) {
    overridesByKey.set(o.originalDate.slice(0, 10), o);
  }

  function pushInstance(occStart: Date) {
    const key = occStart.toISOString().slice(0, 10);
    if (exceptionSet.has(key)) return;
    const override = overridesByKey.get(key);
    const startIso = override?.startsAt ?? occStart.toISOString();
    const endIso =
      override?.endsAt ??
      new Date(occStart.getTime() + durationMs).toISOString();
    const instStart = new Date(startIso);
    const instEnd = new Date(endIso);
    // Include if any overlap with [from, to]
    if (instEnd.getTime() < from.getTime()) return;
    if (instStart.getTime() > to.getTime()) return;
    out.push({
      eventId: ev.id,
      occurrenceKey: key,
      startsAt: startIso,
      endsAt: endIso,
      cancelled: override?.cancelled === true,
      titleOverride: override?.title,
      bodyOverride: override?.body,
    });
  }

  if (!ev.recurrence) {
    if (clampWindow(start, from, to) || clampWindow(end, from, to) ||
        (start.getTime() <= from.getTime() && end.getTime() >= to.getTime())) {
      pushInstance(start);
    } else if (end.getTime() >= from.getTime() && start.getTime() <= to.getTime()) {
      pushInstance(start);
    }
    return out;
  }

  const rule = ev.recurrence;
  const interval = Math.max(1, rule.interval ?? 1);
  const freq = rule.freq;
  const until = rule.until ? new Date(rule.until) : null;
  const count = rule.count && rule.count > 0 ? rule.count : null;

  // Hard upper bound to prevent runaway loops on bad rules.
  let produced = 0;
  let iter = 0;
  const maxIter = 10000;

  if (freq === "WEEKLY" && rule.byday && rule.byday.length > 0) {
    // Walk by single days within each interval-week, emitting on byday matches.
    const byDayIdx = new Set(rule.byday.map((c) => dayCodeIndex(c)).filter((i) => i >= 0));
    // Anchor: start of the week containing the base start (Sunday).
    const anchor = new Date(start.getTime());
    anchor.setUTCDate(anchor.getUTCDate() - anchor.getUTCDay());
    let weekStart = new Date(anchor.getTime());
    while (iter++ < maxIter) {
      // Stop if entire week is past the window.
      if (weekStart.getTime() > to.getTime() + 7 * DAY_MS) break;
      for (let dow = 0; dow < 7; dow++) {
        if (!byDayIdx.has(dow)) continue;
        const occStart = new Date(weekStart.getTime());
        occStart.setUTCDate(occStart.getUTCDate() + dow);
        // Preserve the time-of-day from the base start.
        occStart.setUTCHours(start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), 0);
        if (occStart.getTime() < start.getTime()) continue;
        if (until && occStart.getTime() > until.getTime()) return out;
        if (count && produced >= count) return out;
        // Only count toward `count` if not in the past relative to start
        if (occStart.getTime() <= to.getTime() + DAY_MS) {
          pushInstance(occStart);
        }
        produced++;
        if (out.length >= hardCap) return out;
      }
      weekStart = addInterval(weekStart, "WEEKLY", interval);
    }
    return out;
  }

  // Simple interval-based expansion for DAILY / WEEKLY (no byday) / MONTHLY / YEARLY.
  let cursor = new Date(start.getTime());
  while (iter++ < maxIter) {
    if (until && cursor.getTime() > until.getTime()) break;
    if (count && produced >= count) break;
    if (cursor.getTime() > to.getTime() + DAY_MS) break;
    pushInstance(cursor);
    produced++;
    if (out.length >= hardCap) break;
    cursor = addInterval(cursor, freq, interval);
  }
  return out;
}

export function describeRecurrence(r: CalendarRecurrence): string {
  if (!r) return "Does not repeat";
  const interval = r.interval && r.interval > 1 ? `every ${r.interval} ` : "";
  const freqLabel: Record<string, string> = {
    DAILY: "day",
    WEEKLY: "week",
    MONTHLY: "month",
    YEARLY: "year",
  };
  const base = `${interval}${freqLabel[r.freq] ?? "occurrence"}${interval ? "s" : ""}`;
  const byday =
    r.byday && r.byday.length > 0 ? ` on ${r.byday.join(", ")}` : "";
  const tail = r.until
    ? ` until ${r.until.slice(0, 10)}`
    : r.count
      ? `, ${r.count} times`
      : "";
  return `Repeats ${interval ? base : `every ${base}`}${byday}${tail}`;
}
