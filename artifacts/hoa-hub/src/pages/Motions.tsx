import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Gavel, Plus, X, Calendar, FileDown, ChevronRight } from "lucide-react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { useAuth } from "@/contexts/AuthContext";
import {
  useListMotions,
  useGetMotion,
  useCreateMotion,
  useOpenMotion,
  useCastMotionVote,
  useWithdrawMotion,
  getGetMotionQueryKey,
  getGetMotionPdfUrl,
} from "@workspace/api-client-react";
import type {
  MotionListItem,
  MotionListItemAudience,
  MotionVotingRule,
} from "@workspace/api-client-react";
import { MOTION_TEMPLATES, findTemplate, type MotionTemplate, type PayloadField } from "@/lib/motionTemplates";
import { InfoPopover } from "@/components/help/InfoPopover";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const MOTION_STATUS_LABELS: Record<string, { label: string; bg: string; fg: string }> = {
  draft:     { label: "Draft",     bg: "#EEF1F8", fg: "#5A6280" },
  open:      { label: "Open",      bg: "#DCEAFE", fg: "#1A4FBF" },
  adopted:   { label: "Adopted",   bg: "#DCF3EC", fg: "#0E8A6B" },
  rejected:  { label: "Rejected",  bg: "#FBE3E9", fg: "#B8264C" },
  withdrawn: { label: "Withdrawn", bg: "#EFF1F8", fg: "#5B6478" },
  expired:   { label: "Expired",   bg: "#FFEFD0", fg: "#9A6500" },
};

export default function Motions() {
  const [filter, setFilter] = useState<string>("all");
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const qc = useQueryClient();

  const params = filter === "all" ? undefined : { status: filter };
  const { data: motions = [], isLoading } = useListMotions(params);

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const raw = qs.get("open");
    const id = raw ? Number(raw) : NaN;
    if (Number.isFinite(id) && id > 0) setOpenId(id);
  }, []);

  function closeDetail() {
    setOpenId(null);
    if (window.location.search.includes("open=")) {
      const qs = new URLSearchParams(window.location.search);
      qs.delete("open");
      const s = qs.toString();
      const url = window.location.pathname + (s ? `?${s}` : "") + window.location.hash;
      window.history.replaceState({}, "", url);
    }
  }

  const tabs = [
    { key: "all", label: "All" },
    { key: "draft", label: "Drafts" },
    { key: "open", label: "Open" },
    { key: "adopted", label: "Adopted" },
    { key: "rejected", label: "Rejected" },
    { key: "expired", label: "Expired" },
  ];

  const invalidateList = () =>
    qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "/api/motions" });

  return (
    <Layout
      title="Board Motions"
      subtitle="Propose, vote on, and adopt board resolutions"
      actions={
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] hover:opacity-90"
          style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
          data-testid="button-new-motion"
        >
          <Plus className="h-4 w-4" /> New Motion
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
      </div>

      <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
        <div className="grid grid-cols-[60px_1fr_140px_140px_120px_140px_24px] items-center gap-3 px-4 py-2.5 border-b text-[11px] uppercase tracking-wider"
          style={{ borderColor: c.border, color: c.inkMute, fontWeight: 700 }}>
          <div>ID</div><div>Title</div><div>Kind</div><div>Status</div>
          <div className="inline-flex items-center gap-0.5">Tally <InfoPopover termKey="tally" label="Tally" /></div>
          <div>Closes</div><div></div>
        </div>
        {isLoading ? (
          <div className="p-8 text-center" style={{ color: c.inkMute }}>Loading…</div>
        ) : motions.length === 0 ? (
          <div className="p-8 text-center" style={{ color: c.inkMute }}>
            <Gavel className="inline h-5 w-5 mr-2" /> No motions yet.
          </div>
        ) : motions.map((m) => (
          <MotionRow key={m.id} m={m} onOpen={() => setOpenId(m.id)} />
        ))}
      </div>

      {showNew && (
        <NewMotionModal onClose={() => setShowNew(false)} onCreated={(id) => {
          invalidateList();
          setShowNew(false);
          setOpenId(id);
        }} />
      )}
      {openId !== null && (
        <MotionDetailModal id={openId} onClose={closeDetail} onChanged={() => {
          invalidateList();
          qc.invalidateQueries({ queryKey: ["motions-list", "open"] });
        }} />
      )}
    </Layout>
  );
}

function MotionRow({ m, onOpen }: { m: MotionListItem; onOpen: () => void }) {
  const s = MOTION_STATUS_LABELS[m.status] ?? { label: m.status, bg: "#EEF1F8", fg: "#5A6280" };
  return (
    <button onClick={onOpen}
      className="w-full grid grid-cols-[60px_1fr_140px_140px_120px_140px_24px] items-center gap-3 px-4 py-3 border-b hover:bg-slate-50 cursor-pointer text-left"
      style={{ borderColor: c.borderSoft }} data-testid={`motion-row-${m.id}`}>
      <div className="font-mono-num text-[12px]" style={{ color: c.inkMute }}>M-{m.id}</div>
      <div className="min-w-0">
        <div className="text-[14px] truncate" style={{ fontWeight: 600 }}>{m.title}</div>
        <div className="text-[11.5px]" style={{ color: c.inkMute }}>
          {m.createdByName} · {m.votingRuleDescription}
        </div>
      </div>
      <div className="text-[12.5px]" style={{ color: c.ink }}>{m.kind}</div>
      <div>
        <span className="rounded px-2 py-0.5 text-[11px]" style={{ background: s.bg, color: s.fg, fontWeight: 700 }}>
          {s.label}
        </span>
      </div>
      <div className="text-[12px]" style={{ color: c.ink }}>
        <span style={{ color: "#0E8A6B" }}>{m.tally.approve}✓</span>{" "}
        <span style={{ color: "#B8264C" }}>{m.tally.reject}✗</span>{" "}
        <span style={{ color: c.inkMute }}>{m.tally.abstain}–</span>
        {m.needed !== null && (
          <span className="ml-1" style={{ color: c.inkMute }}>/ {m.needed}</span>
        )}
      </div>
      <div className="text-[12.5px]" style={{ color: c.ink }}>
        {m.closesAt ? <><Calendar className="inline h-3 w-3 mr-1" />{m.closesAt.slice(0, 10)}</> : "—"}
      </div>
      <ChevronRight className="h-4 w-4" style={{ color: c.inkMute }} />
    </button>
  );
}

function NewMotionModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [templateId, setTemplateId] = useState<string>("blank");
  const [kind, setKind] = useState<string>("general");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [ruleType, setRuleType] = useState<MotionVotingRule["type"]>("majority");
  const [threshold, setThreshold] = useState(0.667);
  const [quorum, setQuorum] = useState(3);
  const [audience, setAudience] = useState<MotionListItemAudience>("board");
  const [closesAt, setClosesAt] = useState<string>("");
  const [openImmediately, setOpenImmediately] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payloadValues, setPayloadValues] = useState<Record<string, string>>({});

  const template: MotionTemplate = findTemplate(templateId) ?? MOTION_TEMPLATES[0];

  function applyTemplate(t: MotionTemplate) {
    setTemplateId(t.id);
    setKind(t.kind);
    setBody(t.bodySkeleton);
    if (t.titlePrefix && !title.startsWith(t.titlePrefix)) {
      setTitle(t.titlePrefix);
    }
    setRuleType(t.votingRule.type);
    if (t.votingRule.type === "supermajority") setThreshold(t.votingRule.threshold);
    if (t.votingRule.type === "quorum_only") setQuorum(t.votingRule.quorum);
    setPayloadValues({});
  }

  function buildPayload(): Record<string, unknown> | null {
    if (!template.payloadFields || template.payloadFields.length === 0) return null;
    const out: Record<string, unknown> = {};
    let hasAny = false;
    for (const f of template.payloadFields) {
      const raw = (payloadValues[f.key] ?? "").trim();
      if (!raw) continue;
      hasAny = true;
      out[f.key] = f.type === "number" ? Number(raw) : raw;
    }
    return hasAny ? out : null;
  }

  const createMut = useCreateMotion();
  const openMut = useOpenMotion();
  const submitting = createMut.isPending || openMut.isPending;

  async function submit() {
    if (!title.trim()) { setError("Title is required"); return; }
    if (template.payloadFields) {
      for (const f of template.payloadFields) {
        if (f.required && !(payloadValues[f.key] ?? "").trim()) {
          setError(`"${f.label}" is required for this template`);
          return;
        }
      }
    }
    const rule: MotionVotingRule =
      ruleType === "supermajority" ? { type: "supermajority", threshold }
      : ruleType === "quorum_only" ? { type: "quorum_only", quorum }
      : { type: ruleType };
    setError(null);
    try {
      const closesAtIso = closesAt ? new Date(closesAt).toISOString() : null;
      const created = await createMut.mutateAsync({
        data: {
          kind,
          title: title.trim(),
          body: body.trim(),
          votingRule: rule,
          audience,
          closesAt: closesAtIso,
          payload: buildPayload(),
        },
      });
      if (openImmediately) {
        await openMut.mutateAsync({ id: created.id, data: { closesAt: closesAtIso } });
      }
      onCreated(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <Modal title="Propose a new motion" onClose={onClose}>
      {error && <div className="mb-3 rounded-md px-3 py-2 text-[12.5px]" style={{ background: "#FBE3E9", color: "#B8264C" }}>{error}</div>}
      <div className="space-y-3">
        <Field label="Template">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {MOTION_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t)}
                className="text-left rounded-md border px-3 py-2 hover:bg-slate-50"
                style={{
                  borderColor: templateId === t.id ? c.cobalt : c.border,
                  background: templateId === t.id ? "#EEF3FF" : "#fff",
                  borderWidth: templateId === t.id ? 2 : 1,
                }}
                data-testid={`template-${t.id}`}
              >
                <div className="text-[13px]" style={{ fontWeight: 600, color: c.ink }}>{t.label}</div>
                <div className="text-[11.5px] mt-0.5" style={{ color: c.inkMute }}>{t.description}</div>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-[13.5px]" style={{ borderColor: c.border }}
            data-testid="input-motion-title" />
        </Field>
        <Field label="Description / motion body (frozen on first vote)">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7}
            className="w-full rounded-md border px-3 py-2 text-[13.5px] font-mono-num" style={{ borderColor: c.border }}
            data-testid="input-motion-body" />
        </Field>
        {template.payloadFields && template.payloadFields.length > 0 && (
          <div className="rounded-md border p-3" style={{ borderColor: c.borderSoft, background: "#FAFAFB" }}>
            <div className="text-[11.5px] mb-2" style={{ color: c.inkMute, fontWeight: 700 }}>
              {template.label.toUpperCase()} — STRUCTURED DETAILS
            </div>
            <div className="space-y-3">
              {template.payloadFields.map((f) => (
                <PayloadFieldInput
                  key={f.key}
                  field={f}
                  value={payloadValues[f.key] ?? ""}
                  onChange={(v) => setPayloadValues((p) => ({ ...p, [f.key]: v }))}
                />
              ))}
            </div>
          </div>
        )}
        <Field label="Eligible voters">
          <select value={audience} onChange={(e) => setAudience(e.target.value as MotionListItemAudience)}
            className="w-full rounded-md border px-3 py-2 text-[13.5px] bg-white" style={{ borderColor: c.border }}
            data-testid="select-motion-audience">
            <option value="board">Board members only (default)</option>
            <option value="members">All owners in good standing</option>
          </select>
          <div className="text-[11px] mt-1" style={{ color: c.inkMute }}>
            Member-class motions (dues changes, rule ratifications, etc.) should be voted on by all owners. Quorum is computed against owners currently in good standing.
          </div>
        </Field>
        <Field label="Voting rule" termKey="voting-rule">
          <select value={ruleType} onChange={(e) => setRuleType(e.target.value as MotionVotingRule["type"])}
            className="w-full rounded-md border px-3 py-2 text-[13.5px] bg-white" style={{ borderColor: c.border }}>
            <option value="unanimous">Unanimous (every board member must approve)</option>
            <option value="majority">Majority (more than half of the board)</option>
            <option value="supermajority">Supermajority (custom threshold)</option>
            <option value="single_approver">Single approver (any one board member)</option>
            <option value="quorum_only">Quorum-only (decides once N have voted)</option>
          </select>
        </Field>
        {ruleType === "supermajority" && (
          <Field label="Threshold (fraction of board)" termKey="supermajority">
            <input type="number" min={0.5} max={1} step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(Math.max(0.5, Math.min(1, parseFloat(e.target.value) || 0.667)))}
              className="w-32 rounded-md border px-3 py-2 text-[13.5px]" style={{ borderColor: c.border }} />
          </Field>
        )}
        {ruleType === "quorum_only" && (
          <Field label="Quorum (number of votes that decide)" termKey="quorum">
            <input type="number" min={1}
              value={quorum}
              onChange={(e) => setQuorum(Math.max(1, parseInt(e.target.value || "1", 10)))}
              className="w-32 rounded-md border px-3 py-2 text-[13.5px]" style={{ borderColor: c.border }} />
          </Field>
        )}
        <Field label="Closes at (optional)">
          <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-[13.5px]" style={{ borderColor: c.border }} />
        </Field>
        <label className="flex items-center gap-2 text-[12.5px]">
          <input type="checkbox" checked={openImmediately} onChange={(e) => setOpenImmediately(e.target.checked)} />
          Open for voting immediately
        </label>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 rounded-md text-[12.5px]" style={{ color: c.ink, fontWeight: 600 }}>Cancel</button>
        <button onClick={submit} disabled={submitting}
          className="px-3 py-1.5 rounded-md text-[12.5px] disabled:opacity-50"
          style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
          data-testid="button-submit-motion">
          {submitting ? "Submitting…" : openImmediately ? "Submit and open" : "Save draft"}
        </button>
      </div>
    </Modal>
  );
}

function MotionDetailModal({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: motion, isLoading } = useGetMotion(id);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refetchDetail = () => qc.invalidateQueries({ queryKey: getGetMotionQueryKey(id) });

  const myVote = motion?.votes.find((v) => v.userId === user?.id);
  const isProposer = motion?.createdByUserId === user?.id;
  const isAdmin = user?.role === "admin";
  // The API computes eligibility (audience + role + good-standing) and
  // returns it as `canVote`; trust the server for gating the UI.
  const canVote = !!motion?.canVote;
  const canWithdraw = motion && motion.status !== "adopted" && motion.status !== "rejected" && motion.status !== "withdrawn" && motion.status !== "expired" && (isProposer || isAdmin);
  const canOpen = motion?.status === "draft" && (isProposer || isAdmin || user?.role === "manager");

  const voteMut = useCastMotionVote({
    mutation: {
      onSuccess: async () => { await refetchDetail(); onChanged(); },
      onError: (e: Error) => setError(e.message),
    },
  });
  const openMut = useOpenMotion({
    mutation: {
      onSuccess: async () => { await refetchDetail(); onChanged(); },
      onError: (e: Error) => setError(e.message),
    },
  });
  const withdrawMut = useWithdrawMotion({
    mutation: {
      onSuccess: async () => { await refetchDetail(); onChanged(); },
      onError: (e: Error) => setError(e.message),
    },
  });

  return (
    <Modal title={motion ? `Motion M-${motion.id}` : "Loading motion…"} onClose={onClose} wide>
      {isLoading || !motion ? (
        <div className="p-6 text-center" style={{ color: c.inkMute }}>Loading…</div>
      ) : (
        <div className="space-y-4">
          {error && <div className="rounded-md px-3 py-2 text-[12.5px]" style={{ background: "#FBE3E9", color: "#B8264C" }}>{error}</div>}
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[16px]" style={{ fontWeight: 700 }}>{motion.title}</div>
              <div className="text-[12px]" style={{ color: c.inkMute }}>
                {motion.kind} · proposed by {motion.createdByName} on {motion.createdAt.slice(0, 10)}
              </div>
              <div className="text-[12px]" style={{ color: c.inkMute }}>
                Voting rule: {motion.votingRuleDescription}
              </div>
              <div className="text-[12px]" style={{ color: c.inkMute }}>
                Eligible voters: {motion.audience === "members"
                  ? `All owners in good standing (${motion.memberInGoodStandingCount} of ${motion.memberCount})`
                  : `Board members (${motion.boardMemberCount})`}
              </div>
            </div>
            <StatusBadge status={motion.status} />
          </div>
          {motion.body && (
            <div className="rounded-md border p-3 text-[13px] whitespace-pre-wrap" style={{ borderColor: c.borderSoft, background: "#FAFAFB" }}>
              {motion.body}
            </div>
          )}
          {motion.bodyHash && (
            <div className="text-[11px] font-mono" style={{ color: c.inkMute }}>
              Body hash (frozen): {motion.bodyHash.slice(0, 32)}…
            </div>
          )}
          <div className="rounded-md border p-3" style={{ borderColor: c.borderSoft }}>
            <div className="text-[12px] mb-2" style={{ color: c.inkMute, fontWeight: 600 }}>
              TALLY ({motion.tally.approve} approve · {motion.tally.reject} reject · {motion.tally.abstain} abstain · board size {motion.boardMemberCount}
              {typeof motion.memberCount === "number" && (
                <> · {motion.memberInGoodStandingCount} of {motion.memberCount} owners eligible to vote</>
              )})
            </div>
            {motion.votes.length === 0 ? (
              <div className="text-[12px]" style={{ color: c.inkMute }}>No votes yet.</div>
            ) : (
              <ul className="space-y-1">
                {motion.votes.map((v) => (
                  <li key={v.id} className="flex items-center justify-between text-[12.5px]">
                    <span>{v.userName} <span style={{ color: c.inkMute }}>· {v.createdAt.slice(0, 10)}</span></span>
                    <span className="rounded-full px-2 py-0.5 text-[11px]" style={{
                      background: v.decision === "approve" ? "#DCF3EC" : v.decision === "reject" ? "#FBE3E9" : "#EFF1F8",
                      color:      v.decision === "approve" ? "#0E8A6B" : v.decision === "reject" ? "#B8264C" : "#5B6478",
                      fontWeight: 600,
                    }}>{v.decision}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {canVote && (
            <div className="rounded-md border p-3" style={{ borderColor: c.borderSoft }}>
              <div className="text-[12px] mb-2" style={{ color: c.inkMute, fontWeight: 600 }}>
                YOUR VOTE {myVote ? `· current: ${myVote.decision} (you can change it)` : ""}
              </div>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
                placeholder="Optional comment recorded with your vote"
                className="w-full rounded-md border px-3 py-2 text-[13px] mb-2" style={{ borderColor: c.border }}
                data-testid="input-vote-comment" />
              <div className="flex flex-wrap gap-2">
                <button onClick={() => voteMut.mutate({ id, data: { decision: "approve", comment: comment || null } })}
                  disabled={voteMut.isPending}
                  className="px-3 py-1.5 rounded-md text-[12.5px]" style={{ background: "#0E8A6B", color: "#fff", fontWeight: 600 }}
                  data-testid="button-vote-approve">Approve</button>
                <button onClick={() => voteMut.mutate({ id, data: { decision: "reject", comment: comment || null } })}
                  disabled={voteMut.isPending}
                  className="px-3 py-1.5 rounded-md text-[12.5px]" style={{ background: "#B8264C", color: "#fff", fontWeight: 600 }}
                  data-testid="button-vote-reject">Reject</button>
                <button onClick={() => voteMut.mutate({ id, data: { decision: "abstain", comment: comment || null } })}
                  disabled={voteMut.isPending}
                  className="px-3 py-1.5 rounded-md text-[12.5px] border" style={{ borderColor: c.border, color: c.ink, fontWeight: 600 }}
                  data-testid="button-vote-abstain">Abstain</button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {canOpen && (
              <button onClick={() => openMut.mutate({ id, data: { closesAt: null } })} disabled={openMut.isPending}
                className="px-3 py-1.5 rounded-md text-[12.5px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
                Open for voting
              </button>
            )}
            {canWithdraw && (
              <button onClick={() => withdrawMut.mutate({ id })} disabled={withdrawMut.isPending}
                className="px-3 py-1.5 rounded-md text-[12.5px] border" style={{ borderColor: c.border, color: c.ink, fontWeight: 600 }}>
                Withdraw
              </button>
            )}
            <a href={`${BASE}${getGetMotionPdfUrl(motion.id)}`} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12.5px] border"
              style={{ borderColor: c.border, color: c.ink, fontWeight: 600 }}
              data-testid="link-motion-pdf">
              <FileDown className="h-3.5 w-3.5" /> Resolution PDF
            </a>
          </div>
        </div>
      )}
    </Modal>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = MOTION_STATUS_LABELS[status] ?? { label: status, bg: "#EEF1F8", fg: "#5A6280" };
  return <span className="rounded px-2 py-1 text-[11px]" style={{ background: s.bg, color: s.fg, fontWeight: 700 }}>{s.label}</span>;
}

function PayloadFieldInput({ field, value, onChange }: { field: PayloadField; value: string; onChange: (v: string) => void }) {
  const common = {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    placeholder: field.placeholder,
    className: "w-full rounded-md border px-3 py-2 text-[13.5px]",
    style: { borderColor: c.border },
    "data-testid": `payload-${field.key}`,
  };
  return (
    <label className="block">
      <div className="text-[11.5px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>
        {field.label.toUpperCase()}{field.required ? " *" : ""}
      </div>
      {field.type === "textarea" ? (
        <textarea rows={3} {...common} />
      ) : field.type === "number" ? (
        <input type="number" {...common} />
      ) : (
        <input type="text" {...common} />
      )}
      {field.help && <div className="text-[11px] mt-1" style={{ color: c.inkMute }}>{field.help}</div>}
    </label>
  );
}

function Field({ label, children, termKey }: { label: string; children: React.ReactNode; termKey?: string }) {
  return (
    <label className="block">
      <div className="text-[11.5px] mb-1 inline-flex items-center gap-0.5" style={{ color: c.inkMute, fontWeight: 600 }}>
        {label.toUpperCase()}
        {termKey ? <InfoPopover termKey={termKey} label={label} /> : null}
      </div>
      {children}
    </label>
  );
}

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
      <div className={`w-full ${wide ? "max-w-3xl" : "max-w-xl"} max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl`}>
        <div className="sticky top-0 flex items-center justify-between border-b px-4 py-3 bg-white" style={{ borderColor: c.border }}>
          <div className="text-[14px]" style={{ fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
