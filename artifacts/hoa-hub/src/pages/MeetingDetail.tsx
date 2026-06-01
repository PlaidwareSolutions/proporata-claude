import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Calendar, Plus, X, FileDown, Play, Square, Send, AlertTriangle,
  Trash2, GripVertical, ChevronDown, ChevronUp, FileText, CheckCircle2, Lock,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { useAuth } from "@/contexts/AuthContext";
import {
  meetingsApi,
  MEETING_KIND_LABELS,
  MEETING_STATUS_LABELS,
  MINUTES_STATUS_LABELS,
  type MeetingDetail as MD,
  type MeetingAgendaItem,
} from "@/lib/meetingsApi";
import { motionsApi, type MotionListItem } from "@/lib/motionsApi";
import { useListUsers } from "@workspace/api-client-react";

export default function MeetingDetail() {
  const [, params] = useRoute("/meetings/:id");
  const id = Number(params?.id);
  const qc = useQueryClient();
  const { user } = useAuth();
  const isManager = user?.role === "admin" || user?.role === "manager" || user?.boardMember;

  const detailKey = ["meeting", id] as const;
  const { data: meeting, isLoading } = useQuery({
    queryKey: detailKey,
    queryFn: () => meetingsApi.get(id),
    enabled: Number.isFinite(id),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: detailKey });

  if (!Number.isFinite(id)) return <Layout title="Meeting"><div>Invalid id</div></Layout>;
  if (isLoading || !meeting) return <Layout title="Meeting"><div className="p-6" style={{ color: c.inkMute }}>Loading…</div></Layout>;

  const kind = MEETING_KIND_LABELS[meeting.kind] ?? { label: meeting.kind, bg: "#EEF1F8", fg: "#5A6280" };
  const status = MEETING_STATUS_LABELS[meeting.status] ?? { label: meeting.status, bg: "#EEF1F8", fg: "#5A6280" };
  const minutes = MINUTES_STATUS_LABELS[meeting.minutesStatus] ?? { label: meeting.minutesStatus, bg: "#F3F4F6", fg: "#64748B" };
  const when = new Date(meeting.scheduledAt);

  return (
    <Layout
      title={meeting.title}
      subtitle={`Meeting M-${meeting.id} · ${kind.label}`}
      actions={
        <div className="flex items-center gap-2">
          <a href={meetingsApi.agendaPacketUrl(meeting.id)} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border text-[12.5px]"
             style={{ borderColor: c.border, color: c.ink, fontWeight: 600 }}>
            <FileDown className="h-3.5 w-3.5" /> Agenda PDF
          </a>
          <a href={meetingsApi.icsUrl(meeting.id)} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border text-[12.5px]"
             style={{ borderColor: c.border, color: c.ink, fontWeight: 600 }}>
            <Calendar className="h-3.5 w-3.5" /> .ics
          </a>
        </div>
      }
    >
      <div className="mb-3">
        <Link href="/meetings" className="text-[12.5px] inline-flex items-center gap-1" style={{ color: c.cobalt, fontWeight: 600 }}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back to meetings
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        <div className="space-y-4">
          {/* Header card */}
          <div className="rounded-xl border bg-white p-4" style={{ borderColor: c.border }}>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px]" style={{ background: kind.bg, color: kind.fg, fontWeight: 700 }}>{kind.label}</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px]" style={{ background: status.bg, color: status.fg, fontWeight: 700 }}>{status.label}</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px]" style={{ background: minutes.bg, color: minutes.fg, fontWeight: 700 }}>Minutes: {minutes.label}</span>
            </div>
            <div className="text-[14px]" style={{ color: c.ink }}>
              {isNaN(when.getTime()) ? meeting.scheduledAt : when.toLocaleString()} · {meeting.durationMinutes} min
            </div>
            {(meeting.locationPhysical || meeting.locationVideoLink) && (
              <div className="text-[12.5px] mt-1" style={{ color: c.inkSoft }}>
                {meeting.locationPhysical ?? ""}{meeting.locationPhysical && meeting.locationVideoLink ? " · " : ""}
                {meeting.locationVideoLink && <a href={meeting.locationVideoLink} target="_blank" rel="noreferrer" style={{ color: c.cobalt }}>{meeting.locationVideoLink}</a>}
              </div>
            )}
            <NoticeBanner meeting={meeting} onChanged={refresh} canManage={!!isManager} />
          </div>

          {/* Agenda */}
          <AgendaCard meeting={meeting} canManage={!!isManager} onChanged={refresh} />

          {/* Minutes */}
          <MinutesCard meeting={meeting} canManage={!!isManager} onChanged={refresh} />
        </div>

        <div className="space-y-4">
          <LifecycleCard meeting={meeting} canManage={!!isManager} onChanged={refresh} />
          <AttendanceCard meeting={meeting} canManage={!!isManager} onChanged={refresh} />
        </div>
      </div>
    </Layout>
  );
}

function NoticeBanner({ meeting, onChanged, canManage }: { meeting: MD; onChanged: () => void; canManage: boolean }) {
  const post = useMutation({ mutationFn: () => meetingsApi.postNotice(meeting.id), onSuccess: onChanged });
  const required = meeting.noticeRequiredDays;
  const ok = meeting.noticeOk;
  const posted = meeting.noticePostedAt;
  return (
    <div className="mt-3 rounded-md border p-2.5 text-[12.5px] flex items-center justify-between gap-2"
      style={{ borderColor: ok ? "#9AD9C1" : "#F1B5C2", background: ok ? "#F1FAF6" : "#FDF2F5" }}>
      <div style={{ color: c.ink }}>
        {ok ? <CheckCircle2 className="inline h-4 w-4 mr-1" style={{ color: "#0E8A6B" }} />
            : <AlertTriangle className="inline h-4 w-4 mr-1" style={{ color: "#B8264C" }} />}
        Notice required <strong>{required} days</strong> before meeting · {posted ? `posted ${new Date(posted).toLocaleString()}` : "NOT POSTED"} · {ok ? "OK" : "INSUFFICIENT"}
      </div>
      {canManage && (
        <button onClick={() => post.mutate()} disabled={post.isPending}
          className="px-2.5 py-1.5 rounded-md text-[12px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
          {posted ? "Repost notice" : "Post notice"}
        </button>
      )}
    </div>
  );
}

function AgendaCard({ meeting, canManage, onChanged }: { meeting: MD; canManage: boolean; onChanged: () => void }) {
  const [showAdd, setShowAdd] = useState(false);
  return (
    <div className="rounded-xl border bg-white" style={{ borderColor: c.border }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: c.border }}>
        <h3 className="text-[14px]" style={{ fontWeight: 700 }}>Agenda</h3>
        {canManage && meeting.status !== "adjourned" && (
          <button onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
            <Plus className="h-3.5 w-3.5" /> Add item
          </button>
        )}
      </div>
      <div className="divide-y" style={{ borderColor: c.borderSoft }}>
        {meeting.agenda.length === 0 ? (
          <div className="p-6 text-center text-[13px]" style={{ color: c.inkMute }}>No agenda items yet.</div>
        ) : meeting.agenda.map((it, idx) => (
          <AgendaRow key={it.id} meeting={meeting} item={it} idx={idx} canManage={canManage} onChanged={onChanged} />
        ))}
      </div>
      {showAdd && <AddAgendaItemModal meetingId={meeting.id} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); onChanged(); }} />}
    </div>
  );
}

function AgendaRow({ meeting, item, idx, canManage, onChanged }: { meeting: MD; item: MeetingAgendaItem; idx: number; canManage: boolean; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editingMinutes, setEditingMinutes] = useState(false);
  const [draft, setDraft] = useState(item.itemMinutes);

  const updateMinutes = useMutation({
    mutationFn: () => meetingsApi.updateAgendaItem(meeting.id, item.id, { itemMinutes: draft }),
    onSuccess: () => { setEditingMinutes(false); onChanged(); },
  });
  const toggleClosed = useMutation({
    mutationFn: (next: boolean) =>
      meetingsApi.updateAgendaItem(meeting.id, item.id, { closedSession: next }),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => meetingsApi.removeAgendaItem(meeting.id, item.id),
    onSuccess: onChanged,
  });
  const move = useMutation({
    mutationFn: (dir: -1 | 1) => {
      const ids = meeting.agenda.map((a) => a.id);
      const j = idx + dir;
      if (j < 0 || j >= ids.length) return Promise.resolve({ ok: true } as const);
      const next = ids.slice();
      [next[idx], next[j]] = [next[j]!, next[idx]!];
      return meetingsApi.reorderAgenda(meeting.id, next);
    },
    onSuccess: onChanged,
  });

  const motion = item.motion;
  const motionTallyText = motion ? `a:${motion.tally.approve} r:${motion.tally.reject} ab:${motion.tally.abstain}` : null;

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-2">
        {canManage && meeting.status !== "adjourned" && (
          <div className="flex flex-col items-center pt-0.5">
            <button onClick={() => move.mutate(-1)} disabled={idx === 0} className="p-0.5 disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
            <GripVertical className="h-3.5 w-3.5" style={{ color: c.inkMute }} />
            <button onClick={() => move.mutate(1)} disabled={idx === meeting.agenda.length - 1} className="p-0.5 disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono-num text-[11.5px] px-1.5 py-0.5 rounded" style={{ background: c.canvas, color: c.inkMute, fontWeight: 700 }}>{idx + 1}</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "#EEF1F8", color: "#5A6280", fontWeight: 700 }}>{item.kind}</span>
            <span className="text-[14px]" style={{ color: c.ink, fontWeight: 600 }}>{item.title}</span>
            {item.presenter && <span className="text-[12px]" style={{ color: c.inkMute }}>· {item.presenter}</span>}
            {item.closedSession && (
              <span
                className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10.5px]"
                style={{ background: "#F3EEFF", color: "#5A3FD9", fontWeight: 700 }}
                title="Closed session — hidden from owners"
                data-testid={`agenda-closed-badge-${item.id}`}
              >
                <Lock className="h-3 w-3" /> Closed session
              </span>
            )}
          </div>
          {canManage && (
            <label
              className="mt-1 inline-flex items-center gap-1.5 text-[11.5px] cursor-pointer"
              style={{ color: c.inkSoft }}
            >
              <input
                type="checkbox"
                checked={item.closedSession}
                disabled={toggleClosed.isPending}
                onChange={(e) => toggleClosed.mutate(e.target.checked)}
                data-testid={`agenda-closed-toggle-${item.id}`}
              />
              Closed session (hide from owners)
            </label>
          )}
          {motion && (
            <div className="mt-1 text-[12px] flex items-center gap-2" style={{ color: c.inkSoft }}>
              <Link href={`/motions`} className="inline-flex items-center gap-1" style={{ color: c.cobalt, fontWeight: 600 }}>
                <FileText className="h-3.5 w-3.5" /> Motion #M-{motion.id}
              </Link>
              <span>· {motion.status}{motion.outcome ? `/${motion.outcome}` : ""}</span>
              <span style={{ color: c.inkMute }}>· {motionTallyText}</span>
              {motion.finalizable && motion.status === "open" && !meeting.quorum.met && (
                <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "#FFEFD0", color: "#9A6500", fontWeight: 700 }}>Awaiting quorum</span>
              )}
            </div>
          )}
          {item.notes && <div className="mt-1 text-[12.5px]" style={{ color: c.inkSoft }}>{item.notes}</div>}

          {(expanded || item.itemMinutes) && (
            <div className="mt-2">
              <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: c.inkMute, fontWeight: 700 }}>In-meeting notes</div>
              {editingMinutes ? (
                <div>
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3}
                    className="w-full px-2 py-1.5 border rounded text-[13px]" style={{ borderColor: c.border }} />
                  <div className="flex gap-2 mt-1">
                    <button onClick={() => updateMinutes.mutate()} disabled={updateMinutes.isPending}
                      className="px-2 py-1 rounded text-[12px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>Save</button>
                    <button onClick={() => { setEditingMinutes(false); setDraft(item.itemMinutes); }}
                      className="px-2 py-1 rounded border text-[12px]" style={{ borderColor: c.border }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="text-[12.5px] whitespace-pre-wrap" style={{ color: c.ink }}>
                  {item.itemMinutes || <span style={{ color: c.inkMute }}>—</span>}
                  {canManage && (
                    <button onClick={() => { setEditingMinutes(true); setDraft(item.itemMinutes); }}
                      className="ml-2 text-[11.5px]" style={{ color: c.cobalt, fontWeight: 600 }}>Edit</button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setExpanded((v) => !v)} className="p-1 rounded hover:bg-slate-100" title="Toggle notes">
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {canManage && meeting.status !== "adjourned" && (
            <button onClick={() => { if (confirm("Remove this agenda item?")) remove.mutate(); }} className="p-1 rounded hover:bg-slate-100" style={{ color: "#B8264C" }}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AddAgendaItemModal({ meetingId, onClose, onSaved }: { meetingId: number; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<"discussion" | "motion" | "report" | "break">("discussion");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [presenter, setPresenter] = useState("");
  const [motionId, setMotionId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: motions = [] } = useQuery<MotionListItem[]>({
    queryKey: ["motions-list-for-agenda"],
    queryFn: () => motionsApi.list(),
    enabled: kind === "motion",
  });

  const save = useMutation({
    mutationFn: () => meetingsApi.addAgendaItem(meetingId, {
      kind, title: title.trim(),
      notes: notes.trim() || null,
      presenter: presenter.trim() || null,
      motionId: kind === "motion" ? motionId : null,
    }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: c.border }}>
          <h3 className="text-[15px]" style={{ fontWeight: 700 }}>Add agenda item</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-[11.5px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>Kind</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}
              className="w-full px-2.5 py-2 border rounded-md text-[13px]" style={{ borderColor: c.border }}>
              <option value="discussion">Discussion</option>
              <option value="motion">Motion</option>
              <option value="report">Report</option>
              <option value="break">Break</option>
            </select>
          </div>
          <div>
            <label className="block text-[11.5px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full px-2.5 py-2 border rounded-md text-[13px]" style={{ borderColor: c.border }} />
          </div>
          <div>
            <label className="block text-[11.5px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>Presenter (optional)</label>
            <input value={presenter} onChange={(e) => setPresenter(e.target.value)}
              className="w-full px-2.5 py-2 border rounded-md text-[13px]" style={{ borderColor: c.border }} />
          </div>
          <div>
            <label className="block text-[11.5px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full px-2.5 py-2 border rounded-md text-[13px]" style={{ borderColor: c.border }} />
          </div>
          {kind === "motion" && (
            <div>
              <label className="block text-[11.5px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>Link to motion</label>
              <select value={motionId ?? ""} onChange={(e) => setMotionId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-2.5 py-2 border rounded-md text-[13px]" style={{ borderColor: c.border }}>
                <option value="">— none —</option>
                {motions.filter((m) => m.status === "draft" || m.status === "open").map((m) => (
                  <option key={m.id} value={m.id}>M-{m.id} · {m.title} ({m.status})</option>
                ))}
              </select>
              <div className="text-[11.5px] mt-1" style={{ color: c.inkMute }}>
                Linking sets the motion's meeting and gates finalization on quorum.
              </div>
            </div>
          )}
          {error && <div className="text-[12px]" style={{ color: "#B8264C" }}>{error}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t" style={{ borderColor: c.border }}>
          <button onClick={onClose} className="px-3 py-2 rounded-md border text-[13px]" style={{ borderColor: c.border }}>Cancel</button>
          <button onClick={() => { setError(null); if (!title.trim()) { setError("Title required"); return; } save.mutate(); }} disabled={save.isPending}
            className="px-3 py-2 rounded-md text-[13px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
            {save.isPending ? "Saving…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LifecycleCard({ meeting, canManage, onChanged }: { meeting: MD; canManage: boolean; onChanged: () => void }) {
  const start = useMutation({ mutationFn: () => meetingsApi.start(meeting.id), onSuccess: onChanged });
  const adjourn = useMutation({ mutationFn: () => meetingsApi.adjourn(meeting.id), onSuccess: onChanged });
  return (
    <div className="rounded-xl border bg-white p-4" style={{ borderColor: c.border }}>
      <h3 className="text-[14px] mb-2" style={{ fontWeight: 700 }}>Quorum & lifecycle</h3>
      <div className="text-[12.5px] mb-2" style={{ color: c.inkSoft }}>
        Mode: <strong>{meeting.quorum.mode}</strong>{meeting.quorum.mode === "percent" ? ` (${(meeting.quorum.percentBp / 100).toFixed(1)}%)` : ""}
      </div>
      <div className="rounded-md border p-3 mb-3" style={{ borderColor: c.borderSoft, background: meeting.quorum.met ? "#F1FAF6" : c.canvas }}>
        <div className="text-[20px] font-mono-num" style={{ color: meeting.quorum.met ? "#0E8A6B" : c.ink, fontWeight: 700 }}>
          {meeting.quorum.attending} / {meeting.quorum.required}
        </div>
        <div className="text-[11px] uppercase tracking-wide" style={{ color: c.inkMute, fontWeight: 700 }}>
          {meeting.quorum.met ? "Quorum met" : "Quorum NOT met"} · board size {meeting.quorum.boardSize}
        </div>
      </div>
      {canManage && (
        <div className="flex gap-2">
          {meeting.status === "scheduled" && (
            <button onClick={() => start.mutate()} disabled={start.isPending}
              className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md text-[12.5px]"
              style={{ background: "#0E8A6B", color: "#fff", fontWeight: 600 }}>
              <Play className="h-3.5 w-3.5" /> Start meeting
            </button>
          )}
          {meeting.status === "in_progress" && (
            <button onClick={() => adjourn.mutate()} disabled={adjourn.isPending}
              className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md text-[12.5px]"
              style={{ background: "#5A3FD9", color: "#fff", fontWeight: 600 }}>
              <Square className="h-3.5 w-3.5" /> Adjourn (draft minutes)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AttendanceCard({ meeting, canManage, onChanged }: { meeting: MD; canManage: boolean; onChanged: () => void }) {
  const { data: users = [] } = useListUsers();
  type BoardUser = { id: number; name: string; email: string; pending: boolean; boardMember?: boolean; officerTitle?: string | null };
  const board = (users as BoardUser[]).filter((u) => u.boardMember && !u.pending);
  const setAtt = useMutation({
    mutationFn: ({ userId, status }: { userId: number; status: string }) => meetingsApi.setAttendance(meeting.id, userId, status),
    onSuccess: onChanged,
  });
  const statusFor = (uid: number) => meeting.attendance.find((a) => a.userId === uid)?.status ?? "absent";

  return (
    <div className="rounded-xl border bg-white" style={{ borderColor: c.border }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: c.border }}>
        <h3 className="text-[14px]" style={{ fontWeight: 700 }}>Roll call</h3>
        <span className="text-[11.5px]" style={{ color: c.inkMute }}>{board.length} board members</span>
      </div>
      <div className="divide-y" style={{ borderColor: c.borderSoft }}>
        {board.length === 0 ? (
          <div className="p-4 text-[12.5px]" style={{ color: c.inkMute }}>No board members configured. Mark members in Settings → Members.</div>
        ) : board.map((u) => {
          const cur = statusFor(u.id);
          const opts = ["present", "remote", "absent", "excused"] as const;
          return (
            <div key={u.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] truncate" style={{ color: c.ink, fontWeight: 600 }}>{u.name || u.email}</div>
                {u.officerTitle ? <div className="text-[11px]" style={{ color: c.inkMute }}>{u.officerTitle}</div> : null}
              </div>
              <div className="flex gap-1">
                {opts.map((s) => (
                  <button
                    key={s}
                    disabled={!canManage || setAtt.isPending}
                    onClick={() => setAtt.mutate({ userId: u.id, status: s })}
                    className="px-2 py-1 rounded text-[11px] border"
                    style={{
                      background: cur === s ? attendanceColor(s).bg : "#fff",
                      color: cur === s ? attendanceColor(s).fg : c.inkSoft,
                      borderColor: cur === s ? attendanceColor(s).fg : c.border,
                      fontWeight: cur === s ? 700 : 500,
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function attendanceColor(s: string): { bg: string; fg: string } {
  if (s === "present") return { bg: "#DCF3EC", fg: "#0E8A6B" };
  if (s === "remote") return { bg: "#DCEAFE", fg: "#1A4FBF" };
  if (s === "excused") return { bg: "#FFEFD0", fg: "#9A6500" };
  return { bg: "#FBE3E9", fg: "#B8264C" };
}

function MinutesCard({ meeting, canManage, onChanged }: { meeting: MD; canManage: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(meeting.minutesContent);
  const [showPropose, setShowPropose] = useState(false);
  const save = useMutation({
    mutationFn: () => meetingsApi.update(meeting.id, { minutesContent: draft }),
    onSuccess: () => { setEditing(false); onChanged(); },
  });

  const canPropose = canManage && meeting.minutesStatus === "draft" && meeting.status === "adjourned";
  return (
    <div className="rounded-xl border bg-white" style={{ borderColor: c.border }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: c.border }}>
        <h3 className="text-[14px]" style={{ fontWeight: 700 }}>Minutes</h3>
        <div className="flex items-center gap-2">
          <a href={meetingsApi.minutesPdfUrl(meeting.id)} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border text-[12px]"
             style={{ borderColor: c.border, color: c.ink, fontWeight: 600 }}>
            <FileDown className="h-3.5 w-3.5" /> PDF
          </a>
          {canPropose && (
            <button onClick={() => setShowPropose(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px]"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
              <Send className="h-3.5 w-3.5" /> Propose for adoption
            </button>
          )}
        </div>
      </div>
      <div className="p-4">
        {meeting.minutesStatus === "adopted" && meeting.minutesAdoptedAt && (
          <div className="mb-2 text-[12.5px]" style={{ color: "#0E8A6B", fontWeight: 600 }}>
            ✓ Adopted {new Date(meeting.minutesAdoptedAt).toLocaleString()}
          </div>
        )}
        {editing ? (
          <div>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={14}
              className="w-full px-2.5 py-2 border rounded-md text-[13px] font-mono-num" style={{ borderColor: c.border }} />
            <div className="flex gap-2 mt-2">
              <button onClick={() => save.mutate()} disabled={save.isPending}
                className="px-3 py-1.5 rounded text-[12.5px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>Save draft</button>
              <button onClick={() => { setEditing(false); setDraft(meeting.minutesContent); }}
                className="px-3 py-1.5 rounded border text-[12.5px]" style={{ borderColor: c.border }}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="text-[12.5px] whitespace-pre-wrap rounded-md border p-2.5 max-h-96 overflow-auto"
                 style={{ borderColor: c.borderSoft, background: c.canvas, color: c.ink, minHeight: 80 }}>
              {meeting.minutesContent || <span style={{ color: c.inkMute }}>(No minutes recorded yet. Adjourn the meeting to auto-generate a draft.)</span>}
            </div>
            {canManage && meeting.minutesStatus !== "adopted" && (
              <button onClick={() => { setEditing(true); setDraft(meeting.minutesContent); }}
                className="mt-2 text-[12px]" style={{ color: c.cobalt, fontWeight: 600 }}>Edit minutes</button>
            )}
          </>
        )}
      </div>
      {showPropose && <ProposeMinutesModal meetingId={meeting.id} onClose={() => setShowPropose(false)} onProposed={() => { setShowPropose(false); onChanged(); }} />}
    </div>
  );
}

function ProposeMinutesModal({ meetingId, onClose, onProposed }: { meetingId: number; onClose: () => void; onProposed: () => void }) {
  const { data: meetings = [] } = useQuery({ queryKey: ["meetings-list-future"], queryFn: () => meetingsApi.list("scheduled") });
  const future = meetings.filter((m) => m.id !== meetingId);
  const [adoptionId, setAdoptionId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const propose = useMutation({
    mutationFn: () => meetingsApi.proposeMinutes(meetingId, adoptionId!),
    onSuccess: onProposed,
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md my-12" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: c.border }}>
          <h3 className="text-[15px]" style={{ fontWeight: 700 }}>Propose minutes for adoption</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3 text-[13px]" style={{ color: c.ink }}>
          <p style={{ color: c.inkSoft }}>This creates a majority-vote motion bound to the chosen meeting. When that meeting reaches quorum and the motion is adopted, these minutes become final.</p>
          <div>
            <label className="block text-[11.5px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>Adoption meeting</label>
            <select value={adoptionId ?? ""} onChange={(e) => setAdoptionId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-2.5 py-2 border rounded-md text-[13px]" style={{ borderColor: c.border }}>
              <option value="">— select scheduled meeting —</option>
              {future.map((m) => (
                <option key={m.id} value={m.id}>M-{m.id} · {m.title} ({new Date(m.scheduledAt).toLocaleDateString()})</option>
              ))}
            </select>
          </div>
          {error && <div className="text-[12px]" style={{ color: "#B8264C" }}>{error}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t" style={{ borderColor: c.border }}>
          <button onClick={onClose} className="px-3 py-2 rounded-md border text-[13px]" style={{ borderColor: c.border }}>Cancel</button>
          <button onClick={() => { setError(null); if (!adoptionId) { setError("Pick an adoption meeting"); return; } propose.mutate(); }}
            disabled={propose.isPending}
            className="px-3 py-2 rounded-md text-[13px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
            {propose.isPending ? "Proposing…" : "Propose"}
          </button>
        </div>
      </div>
    </div>
  );
}
