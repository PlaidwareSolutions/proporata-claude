// Task #66: Owner-facing Board section.
// Three tabs: Resolutions (public+adopted), Meetings (open/annual only,
// closed-session items hidden), Notices (auto-published feed). Owners can
// post comments on open agenda items until a meeting starts.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Vote, Calendar as CalendarIcon, Megaphone, FileDown, X, ChevronRight,
  MessageSquare, Trash2, Pencil,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import {
  boardApi,
  NOTICE_KIND_LABELS,
  type BoardResolution,
  type BoardMeetingListItem,
  type BoardMeetingDetail,
  type BoardAgendaItem,
  type BoardComment,
  type BoardNotice,
} from "@/lib/boardApi";

type Tab = "resolutions" | "meetings" | "notices";

export default function ResidentBoard() {
  const [tab, setTab] = useState<Tab>("resolutions");
  return (
    <Layout
      title="Board"
      subtitle="Decisions, meetings, and notices from your Board"
    >
      <div
        className="flex gap-1 mb-4 border-b"
        style={{ borderColor: c.border }}
      >
        <TabButton active={tab === "resolutions"} onClick={() => setTab("resolutions")} icon={Vote} label="Resolutions" testid="tab-resolutions" />
        <TabButton active={tab === "meetings"} onClick={() => setTab("meetings")} icon={CalendarIcon} label="Meetings" testid="tab-meetings" />
        <TabButton active={tab === "notices"} onClick={() => setTab("notices")} icon={Megaphone} label="Notices" testid="tab-notices" />
      </div>

      {tab === "resolutions" && <ResolutionsTab />}
      {tab === "meetings" && <MeetingsTab />}
      {tab === "notices" && <NoticesTab />}
    </Layout>
  );
}

function TabButton({
  active, onClick, icon: Icon, label, testid,
}: {
  active: boolean; onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string; testid: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className="inline-flex items-center gap-1.5 px-3 py-2 text-[13px] -mb-[1px]"
      style={{
        color: active ? c.cobalt : c.inkMute,
        fontWeight: active ? 700 : 500,
        borderBottom: active ? `2px solid ${c.cobalt}` : "2px solid transparent",
      }}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

// ── Resolutions tab ─────────────────────────────────────────────────────────
function ResolutionsTab() {
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["board-resolutions"],
    queryFn: () => boardApi.listResolutions(),
  });
  return (
    <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
      <div
        className="grid grid-cols-[110px_1fr_140px_120px_24px] items-center gap-3 px-4 py-2.5 border-b text-[11px] uppercase tracking-wider"
        style={{ borderColor: c.border, color: c.inkMute, fontWeight: 700 }}
      >
        <div>Number</div><div>Title</div><div>Category</div><div>Adopted</div><div></div>
      </div>
      {isLoading ? (
        <div className="p-8 text-center" style={{ color: c.inkMute }}>Loading…</div>
      ) : items.length === 0 ? (
        <div className="p-8 text-center" style={{ color: c.inkMute }}>
          No public resolutions have been adopted yet.
        </div>
      ) : items.map((r) => <ResolutionRow key={r.id} r={r} />)}
    </div>
  );
}

function ResolutionRow({ r }: { r: BoardResolution }) {
  const [open, setOpen] = useState(false);
  const statusBg = r.status === "adopted" ? "#DCF3EC" : r.status === "superseded" ? "#FFEFD0" : "#FBE3E9";
  const statusFg = r.status === "adopted" ? "#0E8A6B" : r.status === "superseded" ? "#9A6500" : "#B8264C";
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full grid grid-cols-[110px_1fr_140px_120px_24px] items-center gap-3 px-4 py-3 border-b hover:bg-slate-50 cursor-pointer text-left"
        style={{ borderColor: c.borderSoft }}
        data-testid={`board-resolution-row-${r.id}`}
      >
        <div className="font-mono-num text-[12.5px]" style={{ fontWeight: 700, color: c.cobalt }}>
          {r.number ?? "—"}
        </div>
        <div className="min-w-0 flex items-center gap-2">
          <div className="text-[14px] truncate" style={{ fontWeight: 600 }}>{r.title}</div>
          {r.status !== "adopted" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: statusBg, color: statusFg, fontWeight: 700 }}>
              {r.status}
            </span>
          )}
        </div>
        <div className="text-[12.5px] capitalize" style={{ color: c.ink }}>{r.category}</div>
        <div className="text-[12.5px] font-mono-num" style={{ color: c.ink }}>
          {r.adoptedAt ? r.adoptedAt.slice(0, 10) : "—"}
        </div>
        <ChevronRight className="h-4 w-4" style={{ color: c.inkMute }} />
      </button>
      {open && (
        <Modal title={`Resolution ${r.number ?? `#${r.id}`}`} onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <div className="text-[15px]" style={{ fontWeight: 700 }}>{r.title}</div>
            <div className="text-[12px]" style={{ color: c.inkMute }}>
              <span className="capitalize">{r.category}</span>
              {r.adoptedAt ? ` · Adopted ${r.adoptedAt.slice(0, 10)}` : ""}
              {` · ${r.votingRuleDescription}`}
            </div>
            {r.body && (
              <div
                className="rounded-md border p-3 text-[13px] whitespace-pre-wrap"
                style={{ borderColor: c.borderSoft, background: "#FAFAFB" }}
              >
                {r.body}
              </div>
            )}
            {r.pdfAvailable && (
              <a
                href={boardApi.resolutionPdfUrl(r.id)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12.5px] border"
                style={{ borderColor: c.border, color: c.ink, fontWeight: 600 }}
                data-testid={`link-board-resolution-pdf-${r.id}`}
              >
                <FileDown className="h-3.5 w-3.5" /> Download adopted PDF
              </a>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

// ── Meetings tab ────────────────────────────────────────────────────────────
function MeetingsTab() {
  const [range, setRange] = useState<"upcoming" | "past">("upcoming");
  const [openId, setOpenId] = useState<number | null>(null);
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["board-meetings", range],
    queryFn: () => boardApi.listMeetings(range),
  });
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <SegmentedButton active={range === "upcoming"} onClick={() => setRange("upcoming")}>Upcoming</SegmentedButton>
        <SegmentedButton active={range === "past"} onClick={() => setRange("past")}>Past</SegmentedButton>
      </div>
      <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
        {isLoading ? (
          <div className="p-8 text-center" style={{ color: c.inkMute }}>Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center" style={{ color: c.inkMute }}>
            No {range} meetings.
          </div>
        ) : items.map((m) => <MeetingRow key={m.id} m={m} onOpen={() => setOpenId(m.id)} />)}
      </div>
      {openId !== null && (
        <MeetingDetailModal id={openId} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

function SegmentedButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 text-[12.5px] rounded-md border"
      style={{
        borderColor: active ? c.cobalt : c.border,
        background: active ? c.cobaltSoft : "#fff",
        color: active ? c.cobalt : c.ink,
        fontWeight: active ? 700 : 500,
      }}
    >
      {children}
    </button>
  );
}

function MeetingRow({ m, onOpen }: { m: BoardMeetingListItem; onOpen: () => void }) {
  const when = new Date(m.scheduledAt);
  const dateStr = when.toLocaleDateString();
  const timeStr = when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <button
      onClick={onOpen}
      className="w-full grid grid-cols-[160px_1fr_120px_120px_24px] items-center gap-3 px-4 py-3 border-b hover:bg-slate-50 cursor-pointer text-left"
      style={{ borderColor: c.borderSoft }}
      data-testid={`board-meeting-row-${m.id}`}
    >
      <div>
        <div className="text-[12.5px] font-mono-num" style={{ fontWeight: 700, color: c.ink }}>{dateStr}</div>
        <div className="text-[11.5px]" style={{ color: c.inkMute }}>{timeStr}</div>
      </div>
      <div className="min-w-0">
        <div className="text-[14px] truncate" style={{ fontWeight: 600 }}>{m.title}</div>
        <div className="text-[11.5px]" style={{ color: c.inkMute }}>
          {m.kind === "annual" ? "Annual meeting" : "Open meeting"}
          {m.locationPhysical ? ` · ${m.locationPhysical}` : m.locationVideoLink ? " · Video" : ""}
        </div>
      </div>
      <div className="text-[12px]">
        <StatusPill status={m.status} />
      </div>
      <div className="text-[12px]" style={{ color: c.inkMute }}>
        {m.minutesStatus === "adopted" ? "Minutes adopted" : m.noticePostedAt ? "Notice posted" : "Pending"}
      </div>
      <ChevronRight className="h-4 w-4" style={{ color: c.inkMute }} />
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    scheduled: { bg: "#EEF1F8", fg: "#5A6280", label: "Scheduled" },
    in_progress: { bg: "#DCF3EC", fg: "#0E8A6B", label: "In progress" },
    adjourned: { bg: "#EEF1F8", fg: "#5A6280", label: "Adjourned" },
    cancelled: { bg: "#FBE3E9", fg: "#B8264C", label: "Cancelled" },
  };
  const s = map[status] ?? { bg: "#EEF1F8", fg: "#5A6280", label: status };
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: s.bg, color: s.fg, fontWeight: 700 }}>
      {s.label}
    </span>
  );
}

function MeetingDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: m, isLoading } = useQuery({
    queryKey: ["board-meeting", id],
    queryFn: () => boardApi.getMeeting(id),
  });
  return (
    <Modal title={m ? m.title : "Loading…"} onClose={onClose}>
      {isLoading || !m ? (
        <div className="p-6 text-center" style={{ color: c.inkMute }}>Loading…</div>
      ) : (
        <MeetingDetailBody m={m} />
      )}
    </Modal>
  );
}

function MeetingDetailBody({ m }: { m: BoardMeetingDetail }) {
  const when = new Date(m.scheduledAt);
  const canComment = m.status === "scheduled";
  return (
    <div className="space-y-4">
      <div className="text-[12px]" style={{ color: c.inkMute }}>
        {when.toLocaleString()} · {m.kind === "annual" ? "Annual meeting" : "Open meeting"}
        {m.locationPhysical ? ` · ${m.locationPhysical}` : ""}
        {m.locationVideoLink ? ` · ${m.locationVideoLink}` : ""}
      </div>
      {m.noticeText && (
        <div className="rounded-md border p-3 text-[13px] whitespace-pre-wrap" style={{ borderColor: c.borderSoft, background: "#FAFAFB" }}>
          <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: c.inkMute, fontWeight: 700 }}>Notice</div>
          {m.noticeText}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {m.agendaPacketAvailable && (
          <a
            href={boardApi.meetingAgendaPacketUrl(m.id)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12.5px] border"
            style={{ borderColor: c.border, color: c.ink, fontWeight: 600 }}
            data-testid={`link-agenda-packet-${m.id}`}
          >
            <FileDown className="h-3.5 w-3.5" /> Agenda packet
          </a>
        )}
        {m.minutesPdfAvailable && (
          <a
            href={boardApi.meetingMinutesUrl(m.id)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12.5px] border"
            style={{ borderColor: c.border, color: c.ink, fontWeight: 600 }}
            data-testid={`link-meeting-minutes-${m.id}`}
          >
            <FileDown className="h-3.5 w-3.5" /> Adopted minutes
          </a>
        )}
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: c.inkMute, fontWeight: 700 }}>Agenda</div>
        {m.agenda.length === 0 ? (
          <div className="text-[12.5px]" style={{ color: c.inkMute }}>No agenda items have been published yet.</div>
        ) : (
          <div className="space-y-3">
            {m.agenda.map((it, i) => (
              <AgendaItemView key={it.id} meetingId={m.id} item={it} index={i + 1} canComment={canComment} />
            ))}
          </div>
        )}
        {!canComment && m.status === "scheduled" === false && (
          <div className="text-[11.5px] mt-2" style={{ color: c.inkMute }}>
            The comment window has closed for this meeting.
          </div>
        )}
      </div>
    </div>
  );
}

function AgendaItemView({
  meetingId, item, index, canComment,
}: {
  meetingId: number; item: BoardAgendaItem; index: number; canComment: boolean;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["board-meeting", meetingId] });

  const post = useMutation({
    mutationFn: (text: string) => boardApi.postComment(meetingId, item.id, text),
    onSuccess: () => { setBody(""); invalidate(); },
  });
  const edit = useMutation({
    mutationFn: (args: { id: number; text: string }) => boardApi.editComment(meetingId, item.id, args.id, args.text),
    onSuccess: () => { setEditingId(null); invalidate(); },
  });
  const del = useMutation({
    mutationFn: (id: number) => boardApi.deleteComment(meetingId, item.id, id),
    onSuccess: invalidate,
  });

  return (
    <div className="rounded-md border p-3" style={{ borderColor: c.borderSoft }}>
      <div className="text-[13.5px]" style={{ fontWeight: 700 }}>
        {index}. {item.title}
        {item.presenter && (
          <span className="ml-2 text-[11.5px]" style={{ color: c.inkMute, fontWeight: 500 }}>
            — {item.presenter}
          </span>
        )}
      </div>
      {item.notes && (
        <div className="mt-1 text-[12.5px] whitespace-pre-wrap" style={{ color: c.inkSoft }}>{item.notes}</div>
      )}
      {item.itemMinutes && (
        <div className="mt-2 rounded border p-2 text-[12.5px] whitespace-pre-wrap" style={{ borderColor: c.borderSoft, background: "#FAFAFB" }}>
          <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: c.inkMute, fontWeight: 700 }}>Minutes</div>
          {item.itemMinutes}
        </div>
      )}

      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-wider mb-1.5 inline-flex items-center gap-1" style={{ color: c.inkMute, fontWeight: 700 }}>
          <MessageSquare className="h-3 w-3" /> Owner comments ({item.comments.length})
        </div>
        {item.comments.length === 0 && (
          <div className="text-[12px]" style={{ color: c.inkMute }}>No comments yet.</div>
        )}
        <div className="space-y-2">
          {item.comments.map((cm) => (
            <CommentRow
              key={cm.id}
              c={cm}
              isEditing={editingId === cm.id}
              editBody={editBody}
              onStartEdit={() => { setEditingId(cm.id); setEditBody(cm.body); }}
              onCancelEdit={() => setEditingId(null)}
              onChangeEdit={setEditBody}
              onSaveEdit={() => editBody.trim() && edit.mutate({ id: cm.id, text: editBody.trim() })}
              onDelete={() => { if (confirm("Delete your comment?")) del.mutate(cm.id); }}
              canEdit={canComment}
            />
          ))}
        </div>
        {canComment && (
          <div className="mt-2 flex flex-col gap-1.5">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Share a comment with the Board…"
              rows={2}
              className="rounded-md border p-2 text-[13px] resize-y"
              style={{ borderColor: c.borderSoft }}
              data-testid={`textarea-comment-${item.id}`}
            />
            <div className="flex justify-end">
              <button
                onClick={() => body.trim() && post.mutate(body.trim())}
                disabled={!body.trim() || post.isPending}
                className="px-3 py-1.5 text-[12.5px] rounded-md"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 600, opacity: !body.trim() ? 0.5 : 1 }}
                data-testid={`button-post-comment-${item.id}`}
              >
                Post comment
              </button>
            </div>
            {post.isError && (
              <div className="text-[11.5px]" style={{ color: "#B8264C" }}>{(post.error as Error).message}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CommentRow({
  c: cm, isEditing, editBody, canEdit,
  onStartEdit, onCancelEdit, onChangeEdit, onSaveEdit, onDelete,
}: {
  c: BoardComment;
  isEditing: boolean;
  editBody: string;
  canEdit: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onChangeEdit: (s: string) => void;
  onSaveEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="rounded border p-2"
      style={{ borderColor: c.borderSoft, background: cm.mine ? "#F4F6FF" : "#fff" }}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11.5px]" style={{ color: c.inkMute }}>
          <span style={{ fontWeight: 700, color: c.ink }}>{cm.ownerName}</span>
          {cm.unitId ? ` · Unit ${cm.unitId}` : ""}
          {` · ${cm.createdAt.slice(0, 10)}`}
          {cm.editedAt ? " (edited)" : ""}
          {cm.mine ? " · you" : ""}
        </div>
        {cm.mine && canEdit && !isEditing && (
          <div className="flex gap-1">
            <button
              onClick={onStartEdit}
              className="p-1 rounded hover:bg-slate-100"
              title="Edit"
              data-testid={`button-edit-comment-${cm.id}`}
            >
              <Pencil className="h-3 w-3" style={{ color: c.inkMute }} />
            </button>
            <button
              onClick={onDelete}
              className="p-1 rounded hover:bg-slate-100"
              title="Delete"
              data-testid={`button-delete-comment-${cm.id}`}
            >
              <Trash2 className="h-3 w-3" style={{ color: c.inkMute }} />
            </button>
          </div>
        )}
      </div>
      {isEditing ? (
        <div className="space-y-1.5">
          <textarea
            value={editBody}
            onChange={(e) => onChangeEdit(e.target.value)}
            rows={2}
            className="w-full rounded-md border p-2 text-[13px] resize-y"
            style={{ borderColor: c.borderSoft }}
          />
          <div className="flex gap-2 justify-end">
            <button onClick={onCancelEdit} className="px-2 py-1 text-[11.5px] rounded border" style={{ borderColor: c.border }}>
              Cancel
            </button>
            <button
              onClick={onSaveEdit}
              className="px-2 py-1 text-[11.5px] rounded"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="text-[13px] whitespace-pre-wrap">{cm.body}</div>
      )}
    </div>
  );
}

// ── Notices tab ─────────────────────────────────────────────────────────────
function NoticesTab() {
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["board-notices"],
    queryFn: () => boardApi.listNotices(),
  });
  return (
    <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
      {isLoading ? (
        <div className="p-8 text-center" style={{ color: c.inkMute }}>Loading…</div>
      ) : items.length === 0 ? (
        <div className="p-8 text-center" style={{ color: c.inkMute }}>No notices have been posted yet.</div>
      ) : items.map((n) => <NoticeRow key={n.id} n={n} />)}
    </div>
  );
}

function NoticeRow({ n }: { n: BoardNotice }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-start gap-3 px-4 py-3 border-b hover:bg-slate-50 cursor-pointer text-left"
        style={{ borderColor: c.borderSoft }}
        data-testid={`board-notice-row-${n.id}`}
      >
        <div className="mt-0.5"><Megaphone className="h-4 w-4" style={{ color: c.cobalt }} /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}
            >
              {NOTICE_KIND_LABELS[n.kind]}
            </span>
            <span className="text-[11px]" style={{ color: c.inkMute }}>
              {n.postedAt.slice(0, 10)}
            </span>
          </div>
          <div className="text-[14px] truncate" style={{ fontWeight: 600 }}>{n.title}</div>
          {n.body && (
            <div className="text-[12px] truncate" style={{ color: c.inkMute }}>{n.body}</div>
          )}
        </div>
        <ChevronRight className="h-4 w-4 mt-1" style={{ color: c.inkMute }} />
      </button>
      {open && (
        <Modal title={n.title} onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <div className="text-[12px]" style={{ color: c.inkMute }}>
              {NOTICE_KIND_LABELS[n.kind]} · Posted {n.postedAt.slice(0, 10)}
              {n.requiredWindowDays ? ` · Notice window: ${n.requiredWindowDays} days` : ""}
            </div>
            {n.body && (
              <div className="rounded-md border p-3 text-[13px] whitespace-pre-wrap" style={{ borderColor: c.borderSoft, background: "#FAFAFB" }}>
                {n.body}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

// ── Modal helper ────────────────────────────────────────────────────────────
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b px-4 py-3 bg-white" style={{ borderColor: c.border }}>
          <div className="text-[14px]" style={{ fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
