import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "wouter";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { useAuth } from "@/contexts/AuthContext";
import {
  Palette, FileText, Download, Send, ThumbsUp, ThumbsDown, AlertTriangle,
  RefreshCcw, MessageSquare, Check, X, Paperclip,
} from "lucide-react";
import {
  accFetch, ACC_BASE, STATUS_META, uploadAccFile, type AccDetail, type AccStatus,
} from "@/lib/architectural";
import { ResolutionLinkCard } from "@/components/ResolutionLinkCard";

const OPEN_STATUSES: AccStatus[] = ["submitted", "in_review", "more_info_needed"];

export default function ArchitecturalRequestDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? "0", 10);
  const { user } = useAuth();
  const isManager = user?.role === "admin" || user?.role === "manager";
  const [detail, setDetail] = useState<AccDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [decisionText, setDecisionText] = useState("");
  const [conditionsText, setConditionsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [accSettings, setAccSettings] = useState<{ quorumMode: string } | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const d = await accFetch<AccDetail>(`/api/architectural-requests/${id}`);
      setDetail(d);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, [id]);
  useEffect(() => {
    if (!isManager) return;
    accFetch<{ quorumMode: string }>("/api/settings/acc").then((s) => setAccSettings(s)).catch(() => {});
  }, [isManager]);

  const votes = useMemo(() => {
    if (!detail) return { approve: 0, conditions: 0, deny: 0, total: 0, mine: null as string | null };
    const vs = detail.events.filter((e) => e.type === "vote");
    const approve = vs.filter((v) => v.voteValue === "approve").length;
    const conditions = vs.filter((v) => v.voteValue === "conditions").length;
    const deny = vs.filter((v) => v.voteValue === "deny").length;
    const mine = user ? (vs.find((v) => v.authorUserId === user.id)?.voteValue ?? null) : null;
    return { approve, conditions, deny, total: vs.length, mine };
  }, [detail, user]);

  async function transition(action: string, extra?: Record<string, unknown>) {
    setBusy(true);
    try {
      await accFetch(`/api/architectural-requests/${id}/transition`, {
        method: "POST",
        body: JSON.stringify({ action, ...(extra ?? {}) }),
      });
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function postComment() {
    if (!comment.trim()) return;
    setBusy(true);
    try {
      await accFetch(`/api/architectural-requests/${id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: comment.trim() }),
      });
      setComment("");
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to post");
    } finally {
      setBusy(false);
    }
  }

  async function uploadAttachment(file: File) {
    setBusy(true);
    try {
      const a = await uploadAccFile(file);
      await accFetch(`/api/architectural-requests/${id}/attachments`, {
        method: "POST",
        body: JSON.stringify({ name: a.name, storageKey: a.storageKey, size: a.size, contentType: a.contentType }),
      });
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function vote(value: "approve" | "conditions" | "deny") {
    setBusy(true);
    try {
      await accFetch(`/api/architectural-requests/${id}/votes`, {
        method: "POST",
        body: JSON.stringify({ value }),
      });
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to vote");
    } finally {
      setBusy(false);
    }
  }

  async function downloadLetter() {
    const res = await fetch(`${ACC_BASE}/api/architectural-requests/${id}/decision-letter`, { credentials: "include" });
    if (!res.ok) { setError("Could not download decision letter"); return; }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `decision-letter-${id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  if (loading) {
    return <Layout title="Architectural Request"><div className="text-[13px]" style={{ color: c.inkMute }}>Loading…</div></Layout>;
  }
  if (!detail) {
    return <Layout title="Architectural Request"><div className="text-[13px]" style={{ color: c.rose }}>Not found.</div></Layout>;
  }

  const meta = STATUS_META[detail.status];
  const isOwner = user?.id === detail.ownerUserId;
  const isOpen = OPEN_STATUSES.includes(detail.status);
  const isReopenable = ["approved", "approved_with_conditions", "denied"].includes(detail.status);

  return (
    <Layout title={`ACC-${String(detail.id).padStart(4, "0")}`} subtitle={detail.title}>
      <div className="max-w-5xl space-y-5">
        {error && (
          <div className="rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: "#FEF2F2", borderColor: "#FCA5A5", color: "#B91C1C" }}>
            {error}
          </div>
        )}

        {detail.autoApprovalFlagged && isOpen && (
          <div className="rounded-lg border px-3 py-2 flex items-center gap-2" style={{ background: "#FEF3E2", borderColor: "#F4C77B", color: "#7A4A0E" }}>
            <AlertTriangle className="h-4 w-4" />
            <span className="text-[12.5px]" style={{ fontWeight: 600 }}>
              Auto-approval threshold reached on {detail.autoApprovalFlaggedAt?.slice(0, 10)} — board review required.
            </span>
          </div>
        )}

        <section className="rounded-xl border bg-white p-5 space-y-3" style={{ borderColor: c.border }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Palette className="h-4 w-4" style={{ color: c.cobalt }} />
                <span className="text-[12px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>{detail.projectType}</span>
              </div>
              <h2 className="text-[18px]" style={{ fontWeight: 700, color: c.ink }}>{detail.title}</h2>
              <div className="text-[12.5px] mt-1" style={{ color: c.inkSoft }}>
                Submitted by <strong>{detail.ownerName}</strong> on {detail.submittedAt.slice(0, 10)} · Building {detail.building} · Unit {detail.unitId}
              </div>
            </div>
            <span className="text-[11.5px] px-2.5 py-1 rounded-full" style={{ background: meta.bg, color: meta.fg, fontWeight: 700 }}>
              {meta.label}
            </span>
          </div>
          <div className="text-[13.5px] whitespace-pre-wrap" style={{ color: c.ink }}>{detail.description}</div>
          <div className="grid grid-cols-3 gap-3 pt-2 border-t" style={{ borderColor: c.borderSoft }}>
            <Field label="Contractor" value={detail.contractorName ?? "—"} />
            <Field label="Planned Start" value={detail.plannedStart ?? "—"} />
            <Field label="Planned End" value={detail.plannedEnd ?? "—"} />
          </div>
          {detail.acknowledgedGuidelines && (
            <div className="text-[11.5px] inline-flex items-center gap-1" style={{ color: c.emerald, fontWeight: 600 }}>
              <Check className="h-3 w-3" /> Owner acknowledged HOA architectural guidelines
            </div>
          )}
          {detail.decisionLetterStorageKey && (
            <div className="pt-2">
              <button
                onClick={downloadLetter}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] hover:bg-slate-50"
                style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 600 }}
              >
                <Download className="h-3.5 w-3.5" /> Download decision letter (PDF)
              </button>
            </div>
          )}
        </section>

        <ResolutionLinkCard
          resolutionId={detail.resolutionId}
          resolutionNumber={detail.resolutionNumber}
          resolutionTitle={detail.resolutionTitle}
          resolutionStatus={detail.resolutionStatus}
          canEdit={isManager}
          onSave={async (resolutionId) => {
            await accFetch(`/api/architectural-requests/${detail.id}/resolution`, {
              method: "POST",
              body: JSON.stringify({ resolutionId }),
            });
            await reload();
          }}
        />

        {detail.attachments.length > 0 && (
          <section className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
            <h3 className="text-[14px] mb-3 flex items-center gap-2" style={{ fontWeight: 700 }}>
              <Paperclip className="h-4 w-4" style={{ color: c.inkMute }} /> Attachments
            </h3>
            <ul className="space-y-1.5">
              {detail.attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-[13px]">
                  <FileText className="h-3.5 w-3.5" style={{ color: c.inkMute }} />
                  <a
                    href={`${ACC_BASE}/api/architectural-requests/${detail.id}/attachments/${a.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: c.cobalt, fontWeight: 600 }}
                  >
                    {a.name}
                  </a>
                  <span className="text-[11.5px]" style={{ color: c.inkMute }}>
                    {a.kind === "decision_letter" ? "(decision letter)" : ""} · uploaded {a.uploadedAt.slice(0, 10)} by {a.uploadedByName}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {isManager && isOpen && (
          <section className="rounded-xl border bg-white p-5 space-y-4" style={{ borderColor: c.border }}>
            <h3 className="text-[14px]" style={{ fontWeight: 700 }}>Board Actions</h3>

            <div className="flex flex-wrap items-center gap-2">
              {detail.status === "submitted" && (
                <button onClick={() => transition("start_review")} disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px]"
                  style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
                  Start review
                </button>
              )}
              {(detail.status === "in_review" || detail.status === "submitted") && (
                <button onClick={() => transition("request_info", { note: "Please provide additional information." })} disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px]"
                  style={{ borderColor: c.border, color: c.amber, fontWeight: 600 }}>
                  Request more info
                </button>
              )}
            </div>

            <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: c.borderSoft, background: c.canvas }}>
              <div className="text-[12px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>Your vote</div>
              <div className="flex flex-wrap items-center gap-2">
                <VoteBtn label="Approve" Icon={ThumbsUp} active={votes.mine === "approve"} onClick={() => vote("approve")} disabled={busy} colorActive={c.emerald} />
                <VoteBtn label="Conditions" Icon={Check} active={votes.mine === "conditions"} onClick={() => vote("conditions")} disabled={busy} colorActive={c.amber} />
                <VoteBtn label="Deny" Icon={ThumbsDown} active={votes.mine === "deny"} onClick={() => vote("deny")} disabled={busy} colorActive={c.rose} />
                <span className="ml-auto text-[12px]" style={{ color: c.inkMute }}>
                  Tally: {votes.approve}/{votes.conditions}/{votes.deny} (approve/cond/deny) · {votes.total} cast
                  {accSettings?.quorumMode && <> · Quorum mode: <strong>{accSettings.quorumMode}</strong></>}
                </span>
              </div>
            </div>

            <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: c.borderSoft, background: c.canvas }}>
              <div className="text-[12px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>Final decision</div>
              <textarea
                value={decisionText}
                onChange={(e) => setDecisionText(e.target.value)}
                placeholder="Decision rationale or notes (optional, included in PDF letter)"
                rows={3}
                className="w-full rounded-md border px-3 py-2 text-[13px]"
                style={{ borderColor: c.border, color: c.ink, background: "#fff" }}
              />
              <textarea
                value={conditionsText}
                onChange={(e) => setConditionsText(e.target.value)}
                placeholder="Conditions (only when approving with conditions)"
                rows={2}
                className="w-full rounded-md border px-3 py-2 text-[13px]"
                style={{ borderColor: c.border, color: c.ink, background: "#fff" }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => transition("decide_approve", { decisionText })} disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px]"
                  style={{ background: c.emerald, color: "#fff", fontWeight: 600 }}>
                  <ThumbsUp className="h-3.5 w-3.5" /> Approve
                </button>
                <button onClick={() => transition("decide_conditions", { decisionText, conditions: conditionsText })} disabled={busy || !conditionsText.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] disabled:opacity-60"
                  style={{ background: c.amber, color: "#fff", fontWeight: 600 }}>
                  <Check className="h-3.5 w-3.5" /> Approve w/ Conditions
                </button>
                <button onClick={() => transition("decide_deny", { decisionText })} disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px]"
                  style={{ background: c.rose, color: "#fff", fontWeight: 600 }}>
                  <ThumbsDown className="h-3.5 w-3.5" /> Deny
                </button>
              </div>
            </div>
          </section>
        )}

        {isManager && isReopenable && (
          <section className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
            <button onClick={() => transition("reopen")} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px]"
              style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 600 }}>
              <RefreshCcw className="h-3.5 w-3.5" /> Reopen request
            </button>
          </section>
        )}

        {(isOwner || isManager) && isOpen && detail.attachments.length < 10 && (
          <section className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
            <h3 className="text-[14px] mb-2 flex items-center gap-2" style={{ fontWeight: 700 }}>
              <Paperclip className="h-4 w-4" style={{ color: c.inkMute }} /> Add attachment
            </h3>
            <input
              type="file"
              accept="image/*,application/pdf"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAttachment(f);
                e.target.value = "";
              }}
              className="text-[12.5px]"
            />
            <div className="text-[11.5px] mt-1" style={{ color: c.inkMute }}>
              {detail.attachments.length}/10 attachments
            </div>
          </section>
        )}

        {isOwner && isOpen && (
          <section className="rounded-xl border bg-white p-5 flex flex-wrap items-center gap-2" style={{ borderColor: c.border }}>
            {detail.status === "more_info_needed" && (
              <button onClick={() => transition("respond_info")} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px]"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
                Mark info as provided
              </button>
            )}
            <button onClick={() => transition("withdraw")} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px]"
              style={{ borderColor: c.border, color: c.rose, fontWeight: 600 }}>
              <X className="h-3.5 w-3.5" /> Withdraw request
            </button>
          </section>
        )}

        <section className="rounded-xl border bg-white p-5 space-y-3" style={{ borderColor: c.border }}>
          <h3 className="text-[14px] flex items-center gap-2" style={{ fontWeight: 700 }}>
            <MessageSquare className="h-4 w-4" style={{ color: c.inkMute }} /> Activity
          </h3>
          <div className="space-y-2">
            {detail.events.map((e) => (
              <div key={e.id} className="rounded-md border px-3 py-2" style={{ borderColor: c.borderSoft, background: c.canvas }}>
                <div className="flex items-center gap-2 text-[12px]" style={{ color: c.inkMute }}>
                  <strong style={{ color: c.inkSoft }}>{e.authorName || "system"}</strong>
                  <span>· {labelForEvent(e.type)}</span>
                  {e.fromStatus && e.toStatus && <span>· {e.fromStatus} → {e.toStatus}</span>}
                  {e.voteValue && <span>· vote: <strong>{e.voteValue}</strong></span>}
                  <span className="ml-auto">{new Date(e.createdAt).toLocaleString()}</span>
                </div>
                {e.body && <div className="mt-1 text-[13px] whitespace-pre-wrap" style={{ color: c.ink }}>{e.body}</div>}
              </div>
            ))}
          </div>
          <div className="pt-2 border-t" style={{ borderColor: c.borderSoft }}>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="Add a comment…"
              className="w-full rounded-md border px-3 py-2 text-[13px]"
              style={{ borderColor: c.border, color: c.ink, background: "#fff" }}
            />
            <div className="mt-2 flex justify-end">
              <button onClick={postComment} disabled={busy || !comment.trim()}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] disabled:opacity-60"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
                <Send className="h-3.5 w-3.5" /> Post comment
              </button>
            </div>
          </div>
        </section>

        {!isManager && (
          <Link href="/portal/architectural" className="text-[12.5px] inline-block" style={{ color: c.cobalt, fontWeight: 600 }}>
            ← Back to my requests
          </Link>
        )}
      </div>
    </Layout>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>{label}</div>
      <div className="text-[13px] mt-0.5" style={{ color: c.ink }}>{value}</div>
    </div>
  );
}

function VoteBtn({ label, Icon, active, onClick, disabled, colorActive }: {
  label: string; Icon: React.ElementType; active: boolean; onClick: () => void; disabled: boolean; colorActive: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] disabled:opacity-60"
      style={active
        ? { background: colorActive, color: "#fff", borderColor: colorActive, fontWeight: 700 }
        : { borderColor: c.border, color: c.inkSoft, fontWeight: 600 }}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

function labelForEvent(t: string): string {
  switch (t) {
    case "submitted": return "submitted request";
    case "comment": return "commented";
    case "vote": return "voted";
    case "status_change": return "changed status";
    case "request_info": return "requested more info";
    case "info_response": return "provided info";
    case "attachment_added": return "added attachment";
    default: return t;
  }
}
