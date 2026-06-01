import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { X, Trash2, Paperclip, Bell, Clock } from "lucide-react";
import {
  useGetCalendarEvent, useCreateCalendarEvent, useUpdateCalendarEvent,
  useCancelCalendarEvent, useListCalendarEventAudit,
  getGetCalendarEventQueryKey, getListCalendarEventsQueryKey, getListCalendarEventAuditQueryKey,
  getCalendarAttachmentUploadUrl, useRegisterCalendarAttachment,
  useDeleteCalendarAttachment,
  useListCalendarResources,
  useSetCalendarRsvp, useClearCalendarRsvp,
  type CalendarSubCalendar, type CalendarRecurrence,
} from "@workspace/api-client-react";
import { c } from "@/lib/theme";

const LEAD_OPTIONS = [
  { v: 15, l: "15 minutes before" },
  { v: 60, l: "1 hour before" },
  { v: 1440, l: "1 day before" },
  { v: 4320, l: "3 days before" },
  { v: 10080, l: "1 week before" },
  { v: 43200, l: "30 days before" },
];

interface ReminderInput { leadMinutes: number; channelInApp: boolean; channelEmail: boolean; channelSms: boolean }

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}
function fromLocalInput(s: string): string { return new Date(s).toISOString(); }

export default function EventModal({
  eventId, createDefaults, subs, editableSubs, onClose, onSaved,
}: {
  eventId: number | null;
  createDefaults: { subId: number; startsAt: string } | null;
  subs: CalendarSubCalendar[];
  editableSubs: CalendarSubCalendar[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = eventId !== null;

  const { data: detail } = useGetCalendarEvent(eventId ?? 0, {
    query: { enabled: isEdit, queryKey: getGetCalendarEventQueryKey(eventId ?? 0) },
  });
  const { data: audit = [] } = useListCalendarEventAudit(eventId ?? 0, {
    query: { enabled: isEdit, queryKey: getListCalendarEventAuditQueryKey(eventId ?? 0) },
  });
  const create = useCreateCalendarEvent();
  const update = useUpdateCalendarEvent();
  const cancel = useCancelCalendarEvent();
  const registerAttachment = useRegisterCalendarAttachment();
  const deleteAttachment = useDeleteCalendarAttachment();

  const defaultSub = createDefaults?.subId ?? editableSubs[0]?.id ?? subs[0]?.id ?? 0;
  const defaultStart = createDefaults?.startsAt ?? new Date().toISOString();

  const [subId, setSubId] = useState<number>(defaultSub);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [endsAt, setEndsAt] = useState(new Date(new Date(defaultStart).getTime() + 60 * 60 * 1000).toISOString());
  const [allDay, setAllDay] = useState(false);
  const [locationText, setLocationText] = useState("");
  const [locationUrl, setLocationUrl] = useState("");
  const [recurrence, setRecurrence] = useState<CalendarRecurrence | null>(null);
  const [reminders, setReminders] = useState<ReminderInput[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [resourceId, setResourceId] = useState<number | null>(null);
  const [capacity, setCapacity] = useState<string>("");
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);

  const { data: resources = [] } = useListCalendarResources();
  const setRsvp = useSetCalendarRsvp();
  const clearRsvp = useClearCalendarRsvp();

  useEffect(() => {
    if (!detail) return;
    setSubId(detail.subCalendarId);
    setTitle(detail.title);
    setBody(detail.body ?? "");
    setStartsAt(detail.startsAt);
    setEndsAt(detail.endsAt);
    setAllDay(detail.allDay);
    setLocationText(detail.locationText ?? "");
    setLocationUrl(detail.locationUrl ?? "");
    setRecurrence((detail.recurrence ?? null) as CalendarRecurrence | null);
    setReminders((detail.reminders ?? []).map((r) => ({
      leadMinutes: r.leadMinutes,
      channelInApp: r.channelInApp,
      channelEmail: r.channelEmail,
      channelSms: r.channelSms,
    })));
    setResourceId((detail as { resourceId?: number | null }).resourceId ?? null);
    const cap = (detail as { capacity?: number | null }).capacity;
    setCapacity(cap == null ? "" : String(cap));
  }, [detail]);

  const sub = subs.find((s) => s.id === subId);
  const canEdit = isEdit ? (detail?.canEdit ?? false) : editableSubs.some((s) => s.id === subId);

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListCalendarEventsQueryKey() });
    if (eventId) qc.invalidateQueries({ queryKey: getGetCalendarEventQueryKey(eventId) });
  }

  async function handleSave() {
    if (!title.trim()) return;
    setConflictMsg(null);
    const capNum = capacity.trim() === "" ? null : Math.max(0, parseInt(capacity, 10) || 0);
    try {
      if (isEdit && eventId) {
        await update.mutateAsync({
          id: eventId,
          data: {
            title, body, startsAt, endsAt, allDay,
            locationText: locationText || null,
            locationUrl: locationUrl || null,
            resourceId: resourceId ?? null,
            capacity: capNum,
            recurrence: recurrence ?? undefined,
          },
        });
      } else {
        await create.mutateAsync({
          data: {
            subCalendarId: subId, title, body, startsAt, endsAt, allDay,
            locationText: locationText || null,
            locationUrl: locationUrl || null,
            resourceId: resourceId ?? null,
            capacity: capNum,
            recurrence: recurrence ?? undefined,
            reminders,
          },
        });
      }
      invalidate(); onSaved(); onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const m = msg.match(/"error":"([^"]+)"/);
      if (/409|already booked/i.test(msg) || /Resource is already booked/i.test(msg)) {
        setConflictMsg(m?.[1] ?? "This resource is already booked for that time.");
      } else {
        setConflictMsg(m?.[1] ?? "Could not save event.");
      }
    }
  }

  async function handleRsvp(status: "yes" | "no" | "maybe" | null) {
    if (!eventId) return;
    if (status === null) {
      await clearRsvp.mutateAsync({ id: eventId, params: { occurrenceKey: "" } });
    } else {
      await setRsvp.mutateAsync({ id: eventId, data: { status, occurrenceKey: "" } });
    }
    qc.invalidateQueries({ queryKey: getGetCalendarEventQueryKey(eventId) });
  }

  async function handleDelete() {
    if (!isEdit || !eventId) return;
    if (!confirm("Cancel this event? Subscribers will see it as cancelled.")) return;
    await cancel.mutateAsync({ id: eventId });
    invalidate(); onSaved(); onClose();
  }

  async function handleUpload(file: File) {
    if (!eventId) return;
    const { uploadURL } = await getCalendarAttachmentUploadUrl(eventId);
    const put = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
    if (!put.ok) { alert("Upload failed"); return; }
    const url = new URL(uploadURL);
    const storageKey = url.pathname;
    await registerAttachment.mutateAsync({
      id: eventId,
      data: { name: file.name, size: file.size, contentType: file.type, storageKey },
    });
    qc.invalidateQueries({ queryKey: getGetCalendarEventQueryKey(eventId) });
  }

  function toggleReminder(lead: number) {
    setReminders((rs) => {
      const exists = rs.find((r) => r.leadMinutes === lead);
      if (exists) return rs.filter((r) => r.leadMinutes !== lead);
      return [...rs, { leadMinutes: lead, channelInApp: true, channelEmail: true, channelSms: false }];
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 no-print" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b flex items-center justify-between" style={{ borderColor: c.border }}>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: sub?.color ?? "#888" }} />
            <h2 className="text-[16px]" style={{ fontWeight: 700 }}>
              {isEdit ? "Edit event" : "New event"}
            </h2>
          </div>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-[1fr_280px] gap-5">
          <div className="space-y-3">
            <div>
              <label className="text-[11px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>Calendar</label>
              <select value={subId} onChange={(e) => setSubId(Number(e.target.value))}
                disabled={isEdit}
                className="mt-1 w-full border rounded px-2 py-2 text-[14px]" style={{ borderColor: c.border }}>
                {(isEdit ? subs : editableSubs).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)}
                disabled={!canEdit}
                className="mt-1 w-full border rounded px-2 py-2 text-[14px]"
                style={{ borderColor: c.border }} data-testid="event-title" />
            </div>
            <div className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={allDay} disabled={!canEdit} onChange={(e) => setAllDay(e.target.checked)} />
              All day
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>Starts</label>
                <input type="datetime-local" value={toLocalInput(startsAt)} disabled={!canEdit}
                  onChange={(e) => setStartsAt(fromLocalInput(e.target.value))}
                  className="mt-1 w-full border rounded px-2 py-2 text-[13px]" style={{ borderColor: c.border }} />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>Ends</label>
                <input type="datetime-local" value={toLocalInput(endsAt)} disabled={!canEdit}
                  onChange={(e) => setEndsAt(fromLocalInput(e.target.value))}
                  className="mt-1 w-full border rounded px-2 py-2 text-[13px]" style={{ borderColor: c.border }} />
              </div>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>Location</label>
              <input value={locationText} onChange={(e) => setLocationText(e.target.value)} disabled={!canEdit}
                placeholder="Clubhouse, Building 4 conference room…"
                className="mt-1 w-full border rounded px-2 py-2 text-[13px]" style={{ borderColor: c.border }} />
              <input value={locationUrl} onChange={(e) => setLocationUrl(e.target.value)} disabled={!canEdit}
                placeholder="Optional URL (Zoom, Maps)"
                className="mt-2 w-full border rounded px-2 py-2 text-[13px]" style={{ borderColor: c.border }} />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>Description</label>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={!canEdit}
                rows={4}
                className="mt-1 w-full border rounded px-2 py-2 text-[13px]" style={{ borderColor: c.border }} />
            </div>

            {(sub?.slug === "amenities" || sub?.slug === "community") && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>Amenity / Resource</label>
                  <select value={resourceId ?? ""} onChange={(e) => setResourceId(e.target.value === "" ? null : Number(e.target.value))}
                    disabled={!canEdit}
                    className="mt-1 w-full border rounded px-2 py-2 text-[13px]" style={{ borderColor: c.border }}
                    data-testid="event-resource">
                    <option value="">— None —</option>
                    {resources.filter((r) => r.active || r.id === resourceId).map((r) => (
                      <option key={r.id} value={r.id}>{r.name}{r.capacity ? ` (cap ${r.capacity})` : ""}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>Capacity (optional)</label>
                  <input type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)}
                    disabled={!canEdit}
                    placeholder="e.g. 25"
                    className="mt-1 w-full border rounded px-2 py-2 text-[13px]" style={{ borderColor: c.border }}
                    data-testid="event-capacity" />
                </div>
              </div>
            )}

            {conflictMsg && (
              <div className="rounded border px-3 py-2 text-[12px]" style={{ borderColor: "#FECDCA", background: "#FEF3F2", color: "#B42318" }}>
                {conflictMsg}
              </div>
            )}

            <RecurrenceEditor recurrence={recurrence} onChange={setRecurrence} disabled={!canEdit} />
          </div>

          <aside className="space-y-4">
            {isEdit && detail && (sub?.slug === "community" || sub?.slug === "amenities") && (
              <section className="rounded border p-3" style={{ borderColor: c.border }}>
                <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: c.inkMute, fontWeight: 700 }}>RSVP</div>
                {(() => {
                  const my = (detail as { myRsvp?: string | null }).myRsvp ?? null;
                  const counts = (detail as { rsvpCounts?: { yes: number; no: number; maybe: number } }).rsvpCounts ?? { yes: 0, no: 0, maybe: 0 };
                  const cap = (detail as { capacity?: number | null }).capacity ?? null;
                  const opts: Array<{ v: "yes" | "no" | "maybe"; l: string; bg: string }> = [
                    { v: "yes", l: "Going", bg: "#067647" },
                    { v: "maybe", l: "Maybe", bg: "#B54708" },
                    { v: "no", l: "Can't go", bg: "#B42318" },
                  ];
                  return (
                    <>
                      <div className="grid grid-cols-3 gap-1 mb-2">
                        {opts.map((o) => {
                          const on = my === o.v;
                          return (
                            <button key={o.v} onClick={() => handleRsvp(o.v)}
                              className="rounded px-2 py-1.5 text-[12px]"
                              style={{
                                background: on ? o.bg : "#fff",
                                color: on ? "#fff" : c.ink,
                                border: `1px solid ${on ? o.bg : c.border}`,
                                fontWeight: 600,
                              }}
                              data-testid={`rsvp-${o.v}`}>
                              {o.l}
                            </button>
                          );
                        })}
                      </div>
                      <div className="text-[12px]" style={{ color: c.inkSoft }}>
                        <span style={{ fontWeight: 600, color: "#067647" }}>{counts.yes}</span> going
                        {" · "}<span style={{ fontWeight: 600, color: "#B54708" }}>{counts.maybe}</span> maybe
                        {" · "}<span style={{ fontWeight: 600, color: "#B42318" }}>{counts.no}</span> no
                        {cap != null && <span> · capacity {cap}</span>}
                      </div>
                      {cap != null && counts.yes >= cap && (
                        <div className="mt-1 text-[11px]" style={{ color: "#B54708", fontWeight: 600 }}>
                          At capacity — additional yes RSVPs are waitlisted.
                        </div>
                      )}
                      {my && (
                        <button onClick={() => handleRsvp(null)}
                          className="mt-2 text-[11px]" style={{ color: c.cobalt, fontWeight: 600 }}>
                          Clear my RSVP
                        </button>
                      )}
                    </>
                  );
                })()}
              </section>
            )}

            <section>
              <div className="flex items-center gap-1 mb-1.5 text-[11px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>
                <Bell className="h-3 w-3" /> Reminders
              </div>
              <div className="space-y-1">
                {LEAD_OPTIONS.map((opt) => {
                  const on = reminders.some((r) => r.leadMinutes === opt.v);
                  return (
                    <label key={opt.v} className="flex items-center gap-2 text-[12px]" style={{ color: c.ink }}>
                      <input type="checkbox" checked={on} disabled={!canEdit} onChange={() => toggleReminder(opt.v)} />
                      {opt.l}
                    </label>
                  );
                })}
              </div>
              <p className="text-[11px] mt-2" style={{ color: c.inkMute }}>
                Email respects quiet hours (10pm–7am Central).
              </p>
            </section>

            {isEdit && detail && (
              <section>
                <div className="flex items-center gap-1 mb-1.5 text-[11px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>
                  <Paperclip className="h-3 w-3" /> Attachments
                </div>
                <ul className="space-y-1 mb-2">
                  {detail.attachments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between text-[12px] border rounded px-2 py-1" style={{ borderColor: c.border }}>
                      <span className="truncate">{a.name}</span>
                      {canEdit && (
                        <button onClick={async () => {
                          await deleteAttachment.mutateAsync({ id: detail.id, attId: a.id });
                          qc.invalidateQueries({ queryKey: getGetCalendarEventQueryKey(detail.id) });
                        }} className="text-[11px]" style={{ color: "#B42318" }}>Remove</button>
                      )}
                    </li>
                  ))}
                </ul>
                {canEdit && (
                  <input type="file" onChange={(e) => {
                    const f = e.target.files?.[0]; if (f) handleUpload(f);
                  }} className="text-[11px]" />
                )}
              </section>
            )}

            {isEdit && detail && (
              <section>
                <button onClick={() => setShowAudit((v) => !v)} className="text-[11px]" style={{ color: c.cobalt, fontWeight: 600 }}>
                  {showAudit ? "Hide" : "Show"} change history
                </button>
                {showAudit && (
                  <ul className="mt-2 space-y-1 text-[11px]" style={{ color: c.inkMute }}>
                    {audit.map((a) => (
                      <li key={a.id}>
                        <Clock className="inline h-2.5 w-2.5 mr-1" />
                        {format(parseISO(a.createdAt), "MMM d h:mm a")} · {a.actorName} {a.action}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </aside>
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: c.border }}>
          <div>
            {isEdit && canEdit && (
              <button onClick={handleDelete} className="inline-flex items-center gap-1 text-[13px]" style={{ color: "#B42318", fontWeight: 600 }}>
                <Trash2 className="h-3.5 w-3.5" /> Cancel event
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded-md border px-3 py-2 text-[13px]" style={{ borderColor: c.border, fontWeight: 600 }}>Close</button>
            {canEdit && (
              <button onClick={handleSave} disabled={!title.trim()}
                className="rounded-md px-3 py-2 text-[13px]"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 600, opacity: title.trim() ? 1 : 0.5 }}
                data-testid="event-save">
                {isEdit ? "Save changes" : "Create event"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecurrenceEditor({
  recurrence, onChange, disabled,
}: { recurrence: CalendarRecurrence | null; onChange: (r: CalendarRecurrence | null) => void; disabled: boolean }) {
  const r = recurrence ?? null;
  const freq = r?.freq ?? "NONE";
  const setFreq = (f: string) => {
    if (f === "NONE") { onChange(null); return; }
    onChange({ freq: f as "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY", interval: r?.interval ?? 1, byday: r?.byday, until: r?.until, count: r?.count });
  };
  const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  return (
    <div className="rounded border p-3 space-y-2" style={{ borderColor: c.border }}>
      <div className="text-[11px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>Repeat</div>
      <div className="grid grid-cols-2 gap-2">
        <select value={freq} onChange={(e) => setFreq(e.target.value)} disabled={disabled}
          className="border rounded px-2 py-1.5 text-[13px]" style={{ borderColor: c.border }}>
          <option value="NONE">Does not repeat</option>
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="YEARLY">Yearly</option>
        </select>
        {r && (
          <div className="flex items-center gap-1 text-[12px]">
            every
            <input type="number" min={1} max={99} value={r.interval ?? 1} disabled={disabled}
              onChange={(e) => onChange({ ...r, interval: Math.max(1, Number(e.target.value) || 1) })}
              className="w-14 border rounded px-1.5 py-1 text-[13px]" style={{ borderColor: c.border }} />
            <span>{r.freq.toLowerCase().replace("ly", "")}{(r.interval ?? 1) > 1 ? "s" : ""}</span>
          </div>
        )}
      </div>
      {r?.freq === "WEEKLY" && (
        <div className="flex gap-1">
          {DAYS.map((d) => {
            const on = (r.byday ?? []).includes(d);
            return (
              <button key={d} type="button" disabled={disabled}
                onClick={() => {
                  const cur = r.byday ?? [];
                  const next = on ? cur.filter((x) => x !== d) : [...cur, d];
                  onChange({ ...r, byday: next });
                }}
                className="w-8 h-8 rounded text-[11px]"
                style={{
                  background: on ? c.cobalt : "#fff",
                  color: on ? "#fff" : c.ink,
                  border: `1px solid ${c.border}`,
                  fontWeight: 600,
                }}>{d.slice(0, 1)}</button>
            );
          })}
        </div>
      )}
      {r && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px]" style={{ color: c.inkMute }}>Until (optional)</label>
            <input type="date" value={r.until?.slice(0, 10) ?? ""} disabled={disabled}
              onChange={(e) => onChange({ ...r, until: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
              className="w-full border rounded px-2 py-1.5 text-[13px]" style={{ borderColor: c.border }} />
          </div>
          <div>
            <label className="text-[11px]" style={{ color: c.inkMute }}>Count (optional)</label>
            <input type="number" min={1} max={500} value={r.count ?? ""} disabled={disabled}
              onChange={(e) => onChange({ ...r, count: e.target.value ? Number(e.target.value) : undefined })}
              className="w-full border rounded px-2 py-1.5 text-[13px]" style={{ borderColor: c.border }} />
          </div>
        </div>
      )}
    </div>
  );
}
