import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { CalendarDays, ArrowRight } from "lucide-react";
import { useListCalendarEvents, useListCalendarSubCalendars } from "@workspace/api-client-react";
import { c } from "@/lib/theme";

export default function UpcomingEventsWidget({ limit = 5 }: { limit?: number }) {
  const from = new Date().toISOString();
  const to = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
  const { data: events = [], isLoading } = useListCalendarEvents({ from, to });
  const { data: subs = [] } = useListCalendarSubCalendars();
  const subById = new Map(subs.map((s) => [s.id, s] as const));
  const items = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, limit);

  return (
    <div className="rounded-xl border bg-white" style={{ borderColor: c.border }}>
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: c.border }}>
        <h3 className="text-[14px] inline-flex items-center gap-2" style={{ color: c.ink, fontWeight: 700 }}>
          <CalendarDays className="h-4 w-4" /> Upcoming events
        </h3>
        <Link href="/calendar" className="text-[12px] inline-flex items-center gap-1" style={{ color: c.cobalt, fontWeight: 600 }}>
          View calendar <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {isLoading ? (
        <div className="p-4 text-[13px]" style={{ color: c.inkMute }}>Loading…</div>
      ) : items.length === 0 ? (
        <div className="p-4 text-[13px]" style={{ color: c.inkMute }}>Nothing in the next two weeks.</div>
      ) : (
        <ul>
          {items.map((e) => {
            const sub = subById.get(e.subCalendarId);
            return (
              <li key={e.instanceId} className="px-4 py-2.5 border-t flex items-center gap-3" style={{ borderColor: "#F1F2F8" }}>
                <span className="h-7 w-1 rounded-sm" style={{ background: sub?.color ?? "#888" }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] truncate" style={{ color: c.ink, fontWeight: 600 }}>{e.title}</div>
                  <div className="text-[11px]" style={{ color: c.inkMute }}>
                    {e.allDay
                      ? format(parseISO(e.startsAt), "EEE, MMM d") + " · All day"
                      : format(parseISO(e.startsAt), "EEE, MMM d · h:mm a")}
                    {sub && <span> · <span style={{ color: sub.color }}>{sub.name}</span></span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
