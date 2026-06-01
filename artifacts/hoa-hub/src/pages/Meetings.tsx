import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Calendar, Plus, X, Users, ChevronRight, FileDown } from "lucide-react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import {
  meetingsApi,
  MEETING_KIND_LABELS,
  MEETING_STATUS_LABELS,
  MINUTES_STATUS_LABELS,
  type MeetingListItem,
} from "@/lib/meetingsApi";

const LIST_KEY = ["meetings-list"] as const;

export default function Meetings() {
  const [filter, setFilter] = useState<string>("all");
  const [showNew, setShowNew] = useState(false);
  const qc = useQueryClient();
  const search = useSearch();
  // Auto-open the New Meeting modal when arriving via the global
  // quick-create menu (e.g. /meetings?new=1).
  useEffect(() => {
    if (new URLSearchParams(search).get("new") === "1") {
      setShowNew(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [search]);

  const { data: meetings = [], isLoading } = useQuery({
    queryKey: [...LIST_KEY, filter],
    queryFn: () => meetingsApi.list(filter === "all" ? undefined : filter),
  });

  const tabs = [
    { key: "all", label: "All" },
    { key: "scheduled", label: "Scheduled" },
    { key: "in_progress", label: "In Progress" },
    { key: "adjourned", label: "Adjourned" },
    { key: "cancelled", label: "Cancelled" },
  ];

  return (
    <Layout
      title="Board Meetings"
      subtitle="Schedule, run, and adopt minutes for board meetings"
      actions={
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] hover:opacity-90"
          style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
          data-testid="button-new-meeting"
        >
          <Plus className="h-4 w-4" /> New Meeting
        </button>
      }
    >
      <div className="flex gap-2 mb-4 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key} onClick={() => setFilter(t.key)}
            className="px-3 py-1.5 rounded-md text-[13px] border"
            style={{
              background: filter === t.key ? c.cobalt : "#fff",
              color: filter === t.key ? "#fff" : c.ink,
              borderColor: filter === t.key ? c.cobalt : c.border,
              fontWeight: 600,
            }}
          >
            {t.label}
          </button>
        ))}
        <CalendarFeedButton />
      </div>

      <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
        <div className="grid grid-cols-[60px_1fr_110px_110px_120px_140px_120px_24px] items-center gap-3 px-4 py-2.5 border-b text-[11px] uppercase tracking-wider"
          style={{ borderColor: c.border, color: c.inkMute, fontWeight: 700 }}>
          <div>ID</div><div>Title</div><div>Type</div><div>Status</div><div>When</div><div>Quorum</div><div>Minutes</div><div></div>
        </div>
        {isLoading ? (
          <div className="p-8 text-center" style={{ color: c.inkMute }}>Loading…</div>
        ) : meetings.length === 0 ? (
          <div className="p-8 text-center" style={{ color: c.inkMute }}>
            <Calendar className="inline h-5 w-5 mr-2" /> No meetings yet.
          </div>
        ) : meetings.map((m) => <MeetingRow key={m.id} m={m} />)}
      </div>

      {showNew && (
        <NewMeetingModal onClose={() => setShowNew(false)} onCreated={() => {
          qc.invalidateQueries({ queryKey: LIST_KEY });
          setShowNew(false);
        }} />
      )}
    </Layout>
  );
}

function MeetingRow({ m }: { m: MeetingListItem }) {
  const kind = MEETING_KIND_LABELS[m.kind] ?? { label: m.kind, bg: "#EEF1F8", fg: "#5A6280" };
  const status = MEETING_STATUS_LABELS[m.status] ?? { label: m.status, bg: "#EEF1F8", fg: "#5A6280" };
  const minutes = MINUTES_STATUS_LABELS[m.minutesStatus] ?? { label: m.minutesStatus, bg: "#F3F4F6", fg: "#64748B" };
  const when = new Date(m.scheduledAt);
  const whenStr = isNaN(when.getTime()) ? m.scheduledAt : when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <Link href={`/meetings/${m.id}`}>
      <div
        className="grid grid-cols-[60px_1fr_110px_110px_120px_140px_120px_24px] items-center gap-3 px-4 py-3 border-b cursor-pointer hover:bg-slate-50"
        style={{ borderColor: c.borderSoft }}
        data-testid={`meeting-row-${m.id}`}
      >
        <div className="font-mono-num text-[12px]" style={{ color: c.inkMute }}>M-{m.id}</div>
        <div className="min-w-0">
          <div className="text-[14px] truncate" style={{ color: c.ink, fontWeight: 600 }}>{m.title}</div>
          <div className="text-[11.5px] truncate" style={{ color: c.inkMute }}>{m.createdByName}</div>
        </div>
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] w-fit" style={{ background: kind.bg, color: kind.fg, fontWeight: 700 }}>{kind.label}</span>
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] w-fit" style={{ background: status.bg, color: status.fg, fontWeight: 700 }}>{status.label}</span>
        <div className="text-[12.5px]" style={{ color: c.inkSoft }}>{whenStr}</div>
        <div className="text-[12px]">
          <span style={{ color: m.quorum.met ? "#0E8A6B" : c.inkMute, fontWeight: 600 }}>
            {m.quorum.attending}/{m.quorum.required}
          </span>
          {m.quorum.met && <span className="ml-1 text-[10px]" style={{ color: "#0E8A6B" }}>✓</span>}
        </div>
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] w-fit" style={{ background: minutes.bg, color: minutes.fg, fontWeight: 700 }}>{minutes.label}</span>
        <ChevronRight className="h-4 w-4" style={{ color: c.inkMute }} />
      </div>
    </Link>
  );
}

function NewMeetingModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [kind, setKind] = useState<"open" | "executive" | "annual">("open");
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [duration, setDuration] = useState(60);
  const [locPhys, setLocPhys] = useState("");
  const [locVideo, setLocVideo] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => meetingsApi.create({
      kind, title: title.trim(),
      scheduledAt: new Date(scheduledAt).toISOString(),
      durationMinutes: duration,
      locationPhysical: locPhys.trim() || null,
      locationVideoLink: locVideo.trim() || null,
      noticeText: notice,
    }),
    onSuccess: (r) => onCreated(r.id),
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl my-8" style={{ borderColor: c.border }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: c.border }}>
          <h3 className="text-[16px]" style={{ fontWeight: 700 }}>New Meeting</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Type">
            <select value={kind} onChange={(e) => setKind(e.target.value as "open" | "executive" | "annual")}
              className="w-full px-2.5 py-2 border rounded-md text-[13px]" style={{ borderColor: c.border }}>
              <option value="open">Open / regular</option>
              <option value="executive">Executive session</option>
              <option value="annual">Annual</option>
            </select>
          </Field>
          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full px-2.5 py-2 border rounded-md text-[13px]" style={{ borderColor: c.border }}
              placeholder="e.g. May Board Meeting" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date / time">
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full px-2.5 py-2 border rounded-md text-[13px]" style={{ borderColor: c.border }} />
            </Field>
            <Field label="Duration (min)">
              <input type="number" min={15} step={15} value={duration} onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full px-2.5 py-2 border rounded-md text-[13px]" style={{ borderColor: c.border }} />
            </Field>
          </div>
          <Field label="Physical location (optional)">
            <input value={locPhys} onChange={(e) => setLocPhys(e.target.value)}
              className="w-full px-2.5 py-2 border rounded-md text-[13px]" style={{ borderColor: c.border }} />
          </Field>
          <Field label="Video link (optional)">
            <input value={locVideo} onChange={(e) => setLocVideo(e.target.value)}
              className="w-full px-2.5 py-2 border rounded-md text-[13px]" style={{ borderColor: c.border }} />
          </Field>
          <Field label="Notice text">
            <textarea value={notice} onChange={(e) => setNotice(e.target.value)} rows={3}
              className="w-full px-2.5 py-2 border rounded-md text-[13px]" style={{ borderColor: c.border }} />
          </Field>
          {error && <div className="text-[12px]" style={{ color: "#B8264C" }}>{error}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t" style={{ borderColor: c.border }}>
          <button onClick={onClose} className="px-3 py-2 rounded-md border text-[13px]" style={{ borderColor: c.border }}>Cancel</button>
          <button
            onClick={() => { setError(null); if (!title.trim() || !scheduledAt) { setError("Title and date are required"); return; } create.mutate(); }}
            disabled={create.isPending}
            className="px-3 py-2 rounded-md text-[13px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
            {create.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11.5px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  );
}

function CalendarFeedButton() {
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState<{ token: string; url: string } | null>(null);
  return (
    <>
      <button
        onClick={async () => { setOpen(true); if (!feed) setFeed(await meetingsApi.getIcalToken(false)); }}
        className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] border hover:bg-slate-50"
        style={{ borderColor: c.border, color: c.ink, fontWeight: 600 }}
      >
        <Users className="h-4 w-4" /> Subscribe (.ics)
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md my-12" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: c.border }}>
              <h3 className="text-[15px]" style={{ fontWeight: 700 }}>Personal calendar feed</h3>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-slate-100 rounded"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5 space-y-3 text-[13px]" style={{ color: c.ink }}>
              <p style={{ color: c.inkSoft }}>Add this URL to Google Calendar / Apple Calendar / Outlook to subscribe to upcoming meetings. Executive-session meetings are only included for board members.</p>
              <div className="rounded-md border p-2 font-mono-num text-[11px] break-all" style={{ borderColor: c.border, background: c.canvas }}>
                {feed ? `${window.location.origin}${feed.url}` : "Loading…"}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => setFeed(await meetingsApi.getIcalToken(true))}
                  className="px-2.5 py-1.5 rounded border text-[12px]" style={{ borderColor: c.border }}
                >
                  Rotate token
                </button>
                <button
                  onClick={() => { if (feed) navigator.clipboard.writeText(`${window.location.origin}${feed.url}`); }}
                  className="px-2.5 py-1.5 rounded text-[12px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                >
                  Copy URL
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export { FileDown };
