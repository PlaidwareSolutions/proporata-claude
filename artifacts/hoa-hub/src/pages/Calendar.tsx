import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft, ChevronRight, Plus, Printer, Download, Settings as SettingsIcon,
  Calendar as CalIcon, Clock, MapPin, Search, Link2, RefreshCcw,
} from "lucide-react";
import {
  addDays, addMonths, endOfMonth, endOfWeek, format, isSameDay, isSameMonth,
  isWithinInterval, parseISO, startOfDay, startOfMonth, startOfWeek,
} from "date-fns";
import {
  useListCalendarSubCalendars, useGetCalendarPrefs, useUpdateCalendarPrefs,
  useRotateCalendarIcalToken, useListCalendarEvents, getListCalendarEventsQueryKey,
  getGetCalendarPrefsQueryKey,
  useListCalendarExternalFeeds, useCreateCalendarExternalFeed, useDeleteCalendarExternalFeed,
  getListCalendarExternalFeedsQueryKey,
  type CalendarEventInstance, type CalendarSubCalendar,
} from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/apiFetch";
import EventModal from "@/components/calendar/EventModal";

interface MyTimelineEvent extends CalendarEventInstance {
  ownerUserId: number | null;
  isPrivate: boolean;
}

type View = "month" | "week" | "day" | "agenda";

const printCSS = `
@media print {
  aside, header, .no-print { display: none !important; }
  body { background: #fff !important; }
  .cal-print-grid { break-inside: avoid; }
}
`;

export default function Calendar() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState<Date>(startOfDay(new Date()));
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [creatingFor, setCreatingFor] = useState<{ subId: number; startsAt: string } | null>(null);
  const [showFeeds, setShowFeeds] = useState(false);
  const [showMine, setShowMine] = useState(false);

  const { data: subs = [] } = useListCalendarSubCalendars();
  const { data: prefs } = useGetCalendarPrefs();
  const updatePrefs = useUpdateCalendarPrefs();
  const rotateToken = useRotateCalendarIcalToken();

  const visibleSubMap = (prefs?.visibleSubCalendars ?? {}) as Record<string, boolean>;
  const visibleSubIds = subs.filter((s) => visibleSubMap[s.slug] !== false).map((s) => s.id);
  const subById = useMemo(() => new Map(subs.map((s) => [s.id, s] as const)), [subs]);

  const range = useMemo(() => {
    if (view === "month") {
      const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
      const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
      return { from: start, to: end };
    }
    if (view === "week") {
      return { from: startOfWeek(cursor, { weekStartsOn: 0 }), to: endOfWeek(cursor, { weekStartsOn: 0 }) };
    }
    if (view === "day") {
      return { from: startOfDay(cursor), to: addDays(startOfDay(cursor), 1) };
    }
    return { from: startOfDay(cursor), to: addDays(startOfDay(cursor), 60) };
  }, [view, cursor]);

  const { data: rawEvents = [], isLoading } = useListCalendarEvents({
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    search: search || undefined,
  });

  const [mineEvents, setMineEvents] = useState<MyTimelineEvent[]>([]);
  useEffect(() => {
    if (!showMine) {
      setMineEvents([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch<MyTimelineEvent[]>({
          url: `/calendar/me/timeline?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`,
          method: "GET",
        });
        if (!cancelled) setMineEvents(r);
      } catch {
        if (!cancelled) setMineEvents([]);
      }
    })();
    return () => { cancelled = true; };
  }, [showMine, range.from, range.to]);

  const baseEvents = rawEvents.filter((e) => visibleSubIds.includes(e.subCalendarId));
  const privateEventIds = useMemo(
    () => new Set(mineEvents.filter((e) => e.isPrivate).map((e) => e.id)),
    [mineEvents],
  );
  const events = useMemo(() => {
    if (!showMine) return baseEvents;
    const seen = new Set(baseEvents.map((e) => e.instanceId));
    const merged: CalendarEventInstance[] = [...baseEvents];
    const needle = search.trim().toLowerCase();
    for (const e of mineEvents) {
      if (!e.isPrivate) continue;
      if (seen.has(e.instanceId)) continue;
      if (needle) {
        const blob = `${e.title} ${e.body ?? ""} ${e.locationText ?? ""}`.toLowerCase();
        if (!blob.includes(needle)) continue;
      }
      merged.push(e);
    }
    return merged;
  }, [baseEvents, mineEvents, showMine, search]);

  function toggleSub(slug: string) {
    const next = { ...visibleSubMap, [slug]: visibleSubMap[slug] === false ? true : false };
    updatePrefs.mutate({ data: { visibleSubCalendars: next } }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getGetCalendarPrefsQueryKey() }),
    });
  }

  function refetchEvents() {
    qc.invalidateQueries({ queryKey: getListCalendarEventsQueryKey() });
  }

  function go(delta: number) {
    if (view === "month") setCursor(addMonths(cursor, delta));
    else if (view === "week") setCursor(addDays(cursor, 7 * delta));
    else if (view === "day") setCursor(addDays(cursor, delta));
    else setCursor(addDays(cursor, 14 * delta));
  }

  const headerLabel =
    view === "month" ? format(cursor, "MMMM yyyy")
    : view === "week" ? `${format(startOfWeek(cursor, { weekStartsOn: 0 }), "MMM d")} – ${format(endOfWeek(cursor, { weekStartsOn: 0 }), "MMM d, yyyy")}`
    : view === "day" ? format(cursor, "EEEE, MMMM d, yyyy")
    : `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`;

  const isManagerOrBoard = user?.role === "admin" || user?.role === "manager" || user?.boardMember;

  const editableSubs = subs.filter((s) => {
    if (s.isExternal) return false;
    if (user?.role === "admin") return true;
    if (s.editorRoles.includes(user?.role ?? "")) return true;
    if (user?.boardMember && s.editorRoles.includes("board")) return true;
    return false;
  });

  return (
    <Layout
      title="Calendar"
      subtitle="Meetings, deadlines, community events"
      actions={
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-1.5 rounded-md border px-2.5 py-1.5" style={{ borderColor: c.border, background: "#fff" }}>
            <Search className="h-3.5 w-3.5" style={{ color: c.inkMute }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events"
              className="text-[13px] outline-none w-44"
              style={{ background: "transparent", color: c.ink }}
              data-testid="calendar-search"
            />
          </div>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-[13px] no-print"
            style={{ borderColor: c.border, background: "#fff", color: c.ink, fontWeight: 600 }}
          >
            <Printer className="h-4 w-4" /> Print
          </button>
          <button
            onClick={() => setShowFeeds(true)}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-[13px] no-print"
            style={{ borderColor: c.border, background: "#fff", color: c.ink, fontWeight: 600 }}
          >
            <SettingsIcon className="h-4 w-4" /> Subscribe
          </button>
          {editableSubs.length > 0 && (
            <button
              onClick={() => setCreatingFor({ subId: editableSubs[0].id, startsAt: cursor.toISOString() })}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px]"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
              data-testid="calendar-new-event"
            >
              <Plus className="h-4 w-4" /> New Event
            </button>
          )}
        </div>
      }
    >
      <style>{printCSS}</style>
      <div className="grid grid-cols-[240px_1fr] gap-4">
        <aside className="space-y-4">
          <div className="rounded-xl border bg-white p-3" style={{ borderColor: c.border }}>
            <label
              className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] cursor-pointer hover:bg-slate-50"
              data-testid="cal-toggle-mine"
            >
              <input
                type="checkbox"
                checked={showMine}
                onChange={(e) => setShowMine(e.target.checked)}
                className="accent-blue-600"
              />
              <span style={{ color: c.ink, fontWeight: showMine ? 700 : 600 }}>My events</span>
              <span className="ml-auto text-[10.5px] px-1.5 py-0.5 rounded" style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}>
                private
              </span>
            </label>
            <div className="text-[11px] mt-1" style={{ color: c.inkMute }}>
              Includes your dues, violations, and ACC milestones.
            </div>
          </div>

          <div className="rounded-xl border bg-white p-3" style={{ borderColor: c.border }}>
            <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: c.inkMute, fontWeight: 700 }}>
              My Calendars
            </div>
            <div className="space-y-1">
              {subs.map((s) => {
                const on = visibleSubMap[s.slug] !== false;
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleSub(s.slug)}
                    className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-slate-50"
                    style={{ color: c.ink }}
                    data-testid={`cal-toggle-${s.slug}`}
                  >
                    <span
                      className="h-3 w-3 rounded-sm flex-shrink-0"
                      style={{ background: on ? s.color : "transparent", border: `1.5px solid ${s.color}` }}
                    />
                    <span className="flex-1 text-left truncate" style={{ fontWeight: on ? 600 : 400, opacity: on ? 1 : 0.55 }}>
                      {s.name}
                    </span>
                    {s.isExternal && <span className="text-[10px]" style={{ color: c.inkMute }}>ext</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border bg-white p-3" style={{ borderColor: c.border }}>
            <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: c.inkMute, fontWeight: 700 }}>
              Quick Stats
            </div>
            <div className="space-y-1.5 text-[13px]" style={{ color: c.ink }}>
              <div>Visible events: <strong>{events.length}</strong></div>
              <div>Sub-calendars on: <strong>{visibleSubIds.length}/{subs.length}</strong></div>
            </div>
          </div>
        </aside>

        <main>
          <div className="flex items-center gap-2 mb-3 flex-wrap no-print">
            <button onClick={() => go(-1)} className="rounded-md border px-2 py-1.5" style={{ borderColor: c.border, background: "#fff" }}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={() => setCursor(startOfDay(new Date()))} className="rounded-md border px-3 py-1.5 text-[13px]" style={{ borderColor: c.border, background: "#fff", fontWeight: 600 }}>
              Today
            </button>
            <button onClick={() => go(1)} className="rounded-md border px-2 py-1.5" style={{ borderColor: c.border, background: "#fff" }}>
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="ml-2 text-[16px]" style={{ color: c.ink, fontWeight: 700 }}>{headerLabel}</div>
            <div className="ml-auto inline-flex rounded-md border overflow-hidden" style={{ borderColor: c.border }}>
              {(["month", "week", "day", "agenda"] as View[]).map((v) => (
                <button key={v} onClick={() => setView(v)}
                  className="px-3 py-1.5 text-[13px] capitalize"
                  style={{
                    background: view === v ? c.cobalt : "#fff",
                    color: view === v ? "#fff" : c.ink,
                    fontWeight: 600,
                  }}>
                  {v}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="rounded-xl border bg-white p-8 text-center" style={{ borderColor: c.border, color: c.inkMute }}>Loading…</div>
          ) : view === "month" ? (
            <MonthGrid cursor={cursor} events={events} subById={subById} onSelectEvent={(e) => { if (!privateEventIds.has(e.id)) setEditingId(e.id); }}
              onCreateAt={(d) => editableSubs.length > 0 && setCreatingFor({ subId: editableSubs[0].id, startsAt: d.toISOString() })} />
          ) : view === "week" || view === "day" ? (
            <DayList from={range.from} to={range.to} events={events} subById={subById}
              onSelectEvent={(e) => { if (!privateEventIds.has(e.id)) setEditingId(e.id); }} />
          ) : (
            <AgendaList events={events} subById={subById} onSelectEvent={(e) => { if (!privateEventIds.has(e.id)) setEditingId(e.id); }} />
          )}
        </main>
      </div>

      {(editingId !== null || creatingFor !== null) && (
        <EventModal
          eventId={editingId}
          createDefaults={creatingFor}
          subs={subs}
          editableSubs={editableSubs}
          onClose={() => { setEditingId(null); setCreatingFor(null); }}
          onSaved={() => { refetchEvents(); }}
        />
      )}

      {showFeeds && (
        <SubscribeModal
          subs={subs}
          icalToken={prefs?.icalToken ?? null}
          onRotate={() =>
            rotateToken.mutate(undefined, {
              onSuccess: () => qc.invalidateQueries({ queryKey: getGetCalendarPrefsQueryKey() }),
            })
          }
          onClose={() => setShowFeeds(false)}
          isAdmin={user?.role === "admin"}
        />
      )}
    </Layout>
  );
}

// ── Month grid ──────────────────────────────────────────────────────────

function MonthGrid({
  cursor, events, subById, onSelectEvent, onCreateAt,
}: {
  cursor: Date;
  events: CalendarEventInstance[];
  subById: Map<number, CalendarSubCalendar>;
  onSelectEvent: (e: CalendarEventInstance) => void;
  onCreateAt: (d: Date) => void;
}) {
  const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
  const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
  const days: Date[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);

  const eventsByDay = new Map<string, CalendarEventInstance[]>();
  for (const e of events) {
    const key = format(parseISO(e.startsAt), "yyyy-MM-dd");
    if (!eventsByDay.has(key)) eventsByDay.set(key, []);
    eventsByDay.get(key)!.push(e);
  }

  return (
    <div className="rounded-xl border bg-white overflow-hidden cal-print-grid" style={{ borderColor: c.border }}>
      <div className="grid grid-cols-7 border-b" style={{ borderColor: c.border }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-2 py-2 text-[11px] uppercase tracking-wider"
            style={{ color: c.inkMute, fontWeight: 700, borderRight: `1px solid ${c.border}` }}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7" style={{ gridAutoRows: "minmax(110px,1fr)" }}>
        {days.map((d) => {
          const inMonth = isSameMonth(d, cursor);
          const today = isSameDay(d, new Date());
          const key = format(d, "yyyy-MM-dd");
          const dayEvents = (eventsByDay.get(key) ?? []).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
          return (
            <div key={key}
              className="relative border-r border-b p-1.5 cursor-pointer hover:bg-slate-50"
              style={{ borderColor: c.border, background: inMonth ? "#fff" : "#FAFBFD" }}
              onDoubleClick={() => onCreateAt(d)}
              data-testid={`cal-day-${key}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[12px]" style={{
                  color: today ? "#fff" : (inMonth ? c.ink : c.inkMute),
                  background: today ? c.cobalt : "transparent",
                  borderRadius: 999, padding: today ? "1px 7px" : 0, fontWeight: today ? 700 : 600,
                }}>{format(d, "d")}</span>
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 4).map((e) => {
                  const sub = subById.get(e.subCalendarId);
                  return (
                    <button
                      key={e.instanceId}
                      onClick={(ev) => { ev.stopPropagation(); onSelectEvent(e); }}
                      className="w-full text-left truncate text-[11px] px-1.5 py-0.5 rounded"
                      style={{ background: (sub?.color ?? "#888") + "22", color: c.ink, fontWeight: 600, borderLeft: `3px solid ${sub?.color ?? "#888"}` }}
                      data-testid={`cal-event-${e.id}`}
                    >
                      {!e.allDay && <span className="font-mono-num mr-1" style={{ color: c.inkMute }}>{format(parseISO(e.startsAt), "HH:mm")}</span>}
                      {e.title}
                    </button>
                  );
                })}
                {dayEvents.length > 4 && (
                  <div className="text-[11px]" style={{ color: c.inkMute }}>+{dayEvents.length - 4} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayList({
  from, to, events, subById, onSelectEvent,
}: {
  from: Date; to: Date;
  events: CalendarEventInstance[];
  subById: Map<number, CalendarSubCalendar>;
  onSelectEvent: (e: CalendarEventInstance) => void;
}) {
  const days: Date[] = [];
  for (let d = startOfDay(from); d < to; d = addDays(d, 1)) days.push(d);
  return (
    <div className="space-y-3 cal-print-grid">
      {days.map((d) => {
        const dayEv = events.filter((e) => isWithinInterval(parseISO(e.startsAt), { start: d, end: addDays(d, 1) }))
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        return (
          <div key={d.toISOString()} className="rounded-xl border bg-white" style={{ borderColor: c.border }}>
            <div className="px-4 py-2 border-b text-[13px]" style={{ borderColor: c.border, color: c.ink, fontWeight: 700 }}>
              {format(d, "EEEE, MMMM d")}
            </div>
            {dayEv.length === 0 ? (
              <div className="px-4 py-3 text-[13px]" style={{ color: c.inkMute }}>No events</div>
            ) : (
              <ul>
                {dayEv.map((e) => <EventRow key={e.instanceId} event={e} subById={subById} onSelect={() => onSelectEvent(e)} />)}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AgendaList({
  events, subById, onSelectEvent,
}: {
  events: CalendarEventInstance[];
  subById: Map<number, CalendarSubCalendar>;
  onSelectEvent: (e: CalendarEventInstance) => void;
}) {
  const sorted = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const groups = new Map<string, CalendarEventInstance[]>();
  for (const e of sorted) {
    const key = format(parseISO(e.startsAt), "yyyy-MM-dd");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  return (
    <div className="rounded-xl border bg-white" style={{ borderColor: c.border }}>
      {sorted.length === 0 ? (
        <div className="p-8 text-center" style={{ color: c.inkMute }}>No upcoming events</div>
      ) : (
        Array.from(groups.entries()).map(([key, evs]) => (
          <div key={key} className="border-b" style={{ borderColor: c.border }}>
            <div className="px-4 py-2 text-[12px]" style={{ color: c.inkMute, background: "#FAFBFD", fontWeight: 700 }}>
              {format(parseISO(key + "T00:00:00"), "EEEE, MMMM d")}
            </div>
            <ul>
              {evs.map((e) => <EventRow key={e.instanceId} event={e} subById={subById} onSelect={() => onSelectEvent(e)} />)}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}

function EventRow({ event, subById, onSelect }: {
  event: CalendarEventInstance;
  subById: Map<number, CalendarSubCalendar>;
  onSelect: () => void;
}) {
  const sub = subById.get(event.subCalendarId);
  return (
    <li className="px-4 py-2.5 border-t flex items-center gap-3 hover:bg-slate-50 cursor-pointer"
      style={{ borderColor: "#F1F2F8" }} onClick={onSelect} data-testid={`event-row-${event.id}`}>
      <span className="h-8 w-1 rounded-sm" style={{ background: sub?.color ?? "#888" }} />
      <div className="flex-1 min-w-0">
        <div className="text-[14px] truncate" style={{ color: c.ink, fontWeight: 600 }}>{event.title}</div>
        <div className="text-[12px] flex items-center gap-3" style={{ color: c.inkMute }}>
          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />
            {event.allDay ? "All day" : `${format(parseISO(event.startsAt), "h:mm a")} – ${format(parseISO(event.endsAt), "h:mm a")}`}
          </span>
          {event.locationText && <span className="inline-flex items-center gap-1 truncate"><MapPin className="h-3 w-3" />{event.locationText}</span>}
          <span style={{ color: sub?.color }}>{sub?.name}</span>
        </div>
      </div>
    </li>
  );
}

// ── Subscribe / external feeds modal ───────────────────────────────────

function SubscribeModal({
  subs, icalToken, onRotate, onClose, isAdmin,
}: {
  subs: CalendarSubCalendar[];
  icalToken: string | null;
  onRotate: () => void;
  onClose: () => void;
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const { data: feeds = [] } = useListCalendarExternalFeeds({
    query: { enabled: isAdmin, queryKey: getListCalendarExternalFeedsQueryKey() },
  });
  const createFeed = useCreateCalendarExternalFeed();
  const deleteFeed = useDeleteCalendarExternalFeed();
  const [feedName, setFeedName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [feedSlug, setFeedSlug] = useState("external");
  const origin = window.location.origin;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 no-print" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: c.border }}>
          <h2 className="text-[16px]" style={{ fontWeight: 700 }}>Subscribe to calendar</h2>
          <button onClick={onClose} className="text-[13px]" style={{ color: c.inkMute }}>Close</button>
        </div>
        <div className="p-5 space-y-5">
          <section>
            <h3 className="text-[13px] mb-1" style={{ fontWeight: 700 }}>Personal subscription</h3>
            <p className="text-[12px] mb-2" style={{ color: c.inkMute }}>
              Use these URLs in Google Calendar, Apple Calendar, or Outlook to keep events in sync.
              Treat your token like a password.
            </p>
            {!icalToken ? (
              <button onClick={onRotate} className="rounded-md px-3 py-2 text-[13px]"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
                Generate my token
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <code className="text-[11px] rounded bg-slate-100 px-2 py-1 break-all flex-1">{icalToken}</code>
                  <button onClick={onRotate} className="rounded-md border px-2 py-1.5 text-[12px] inline-flex items-center gap-1" style={{ borderColor: c.border }}>
                    <RefreshCcw className="h-3.5 w-3.5" /> Rotate
                  </button>
                </div>
                <ul className="space-y-1">
                  {subs.map((s) => (
                    <li key={s.id} className="flex items-center justify-between text-[12px] border rounded px-2 py-1.5" style={{ borderColor: c.border }}>
                      <span><span className="inline-block h-2.5 w-2.5 rounded-sm mr-2 align-middle" style={{ background: s.color }} />{s.name}</span>
                      <button onClick={() => navigator.clipboard.writeText(`${origin}/api/calendar/feeds/${s.slug}/${icalToken}.ics`)}
                        className="inline-flex items-center gap-1 text-[11px]" style={{ color: c.cobalt, fontWeight: 600 }}>
                        <Link2 className="h-3 w-3" /> Copy URL
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section>
            <h3 className="text-[13px] mb-1" style={{ fontWeight: 700 }}>Public feeds</h3>
            <ul className="space-y-1">
              {subs.filter((s) => s.isPublic).map((s) => (
                <li key={s.id} className="flex items-center justify-between text-[12px] border rounded px-2 py-1.5" style={{ borderColor: c.border }}>
                  <span>{s.name}</span>
                  <a className="text-[11px] inline-flex items-center gap-1" style={{ color: c.cobalt, fontWeight: 600 }}
                    href={`/api/calendar/public/${s.slug}.ics`}>
                    <Download className="h-3 w-3" /> Download
                  </a>
                </li>
              ))}
            </ul>
          </section>

          {isAdmin && (
            <section>
              <h3 className="text-[13px] mb-1" style={{ fontWeight: 700 }}>External feeds (admin)</h3>
              <p className="text-[12px] mb-2" style={{ color: c.inkMute }}>
                Pull in third-party iCal feeds (e.g. trash schedule). Refreshes daily.
              </p>
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-2">
                <input value={feedName} onChange={(e) => setFeedName(e.target.value)} placeholder="Name"
                  className="border rounded px-2 py-1.5 text-[12px]" style={{ borderColor: c.border }} />
                <input value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://… .ics"
                  className="border rounded px-2 py-1.5 text-[12px]" style={{ borderColor: c.border }} />
                <select value={feedSlug} onChange={(e) => setFeedSlug(e.target.value)}
                  className="border rounded px-2 py-1.5 text-[12px]" style={{ borderColor: c.border }}>
                  {subs.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
                </select>
              </div>
              <button
                disabled={!feedName.trim() || !feedUrl.trim()}
                onClick={() =>
                  createFeed.mutate({ data: { name: feedName, url: feedUrl, subCalendarSlug: feedSlug } }, {
                    onSuccess: () => {
                      setFeedName(""); setFeedUrl("");
                      qc.invalidateQueries({ queryKey: getListCalendarExternalFeedsQueryKey() });
                    },
                  })
                }
                className="rounded-md px-3 py-1.5 text-[12px]"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 600, opacity: !feedName.trim() || !feedUrl.trim() ? 0.5 : 1 }}>
                Add feed
              </button>
              <ul className="mt-3 space-y-1">
                {feeds.map((f) => (
                  <li key={f.id} className="flex items-center justify-between text-[12px] border rounded px-2 py-1.5" style={{ borderColor: c.border }}>
                    <div className="min-w-0">
                      <div style={{ fontWeight: 600 }}>{f.name}</div>
                      <div className="truncate" style={{ color: c.inkMute }}>{f.url}</div>
                      <div style={{ color: c.inkMute }}>
                        {f.lastFetchedAt ? `Last sync ${format(parseISO(f.lastFetchedAt), "MMM d, h:mm a")}` : "Not synced yet"}
                        {f.lastError && <span style={{ color: "#B42318" }}> · {f.lastError}</span>}
                        {" · "}{f.lastEventCount} events
                      </div>
                    </div>
                    <button
                      onClick={() => deleteFeed.mutate({ id: f.id }, {
                        onSuccess: () => qc.invalidateQueries({ queryKey: getListCalendarExternalFeedsQueryKey() }),
                      })}
                      className="text-[11px]" style={{ color: "#B42318", fontWeight: 600 }}>Remove</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
