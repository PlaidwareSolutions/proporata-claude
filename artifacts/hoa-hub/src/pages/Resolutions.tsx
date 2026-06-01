// Task #63: Board Resolutions library page.
// Shows the list with status/category filters + search, a "New resolution"
// wizard that drafts the underlying motion, and a detail drawer showing the
// chain (supersedes/supersededBy) plus rescind action.

import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Scroll, Plus, X, FileDown, ChevronRight, AlertTriangle, Search, Lock, Globe,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { ResolutionPicker } from "@/components/ResolutionPicker";
import { c } from "@/lib/theme";
import {
  resolutionsApi,
  RESOLUTION_CATEGORIES,
  RESOLUTION_STATUS_LABELS,
  RESOLUTION_CATEGORY_LABELS,
  type ResolutionListItem,
  type ResolutionDetail,
  type ResolutionCategory,
  type VotingRule,
} from "@/lib/resolutionsApi";
import { InfoPopover } from "@/components/help/InfoPopover";

const LIST_KEY = ["resolutions-list"] as const;

export default function Resolutions() {
  const [status, setStatus] = useState("active");
  const [category, setCategory] = useState<"all" | ResolutionCategory>("all");
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const qc = useQueryClient();
  const queryString = useSearch();
  // Auto-open the New Resolution modal when arriving via the global
  // quick-create menu (e.g. /resolutions?new=1).
  useEffect(() => {
    if (new URLSearchParams(queryString).get("new") === "1") {
      setShowNew(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [queryString]);

  const { data: items = [], isLoading } = useQuery({
    queryKey: [...LIST_KEY, status, category, search],
    queryFn: () => resolutionsApi.list({ status, category, search }),
  });

  const statusTabs: Array<{ key: string; label: string }> = [
    { key: "active",     label: "Active" },
    { key: "all",        label: "All" },
    { key: "draft",      label: "Drafts" },
    { key: "adopted",    label: "Adopted" },
    { key: "superseded", label: "Superseded" },
    { key: "rescinded",  label: "Rescinded" },
  ];

  return (
    <Layout
      title="Board Resolutions"
      subtitle="Adopted decisions of the Board, numbered and on file"
      actions={
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] hover:opacity-90"
          style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
          data-testid="button-new-resolution"
        >
          <Plus className="h-4 w-4" /> New Resolution
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {statusTabs.map((t) => (
          <button
            key={t.key} onClick={() => setStatus(t.key)}
            className="px-3 py-1.5 rounded-md text-[12.5px] border"
            style={{
              background: status === t.key ? c.cobalt : "#fff",
              color: status === t.key ? "#fff" : c.ink,
              borderColor: status === t.key ? c.cobalt : c.border,
              fontWeight: 600,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as "all" | ResolutionCategory)}
          className="rounded-md border px-2.5 py-1.5 text-[12.5px] bg-white"
          style={{ borderColor: c.border }}
        >
          <option value="all">All categories</option>
          {RESOLUTION_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>{RESOLUTION_CATEGORY_LABELS[cat]}</option>
          ))}
        </select>
        <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
          style={{ borderColor: c.border, background: "#fff" }}>
          <Search className="h-3.5 w-3.5" style={{ color: c.inkMute }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or number"
            className="text-[12.5px] outline-none w-56"
          />
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
        <div className="grid grid-cols-[110px_1fr_140px_140px_120px_120px_24px] items-center gap-3 px-4 py-2.5 border-b text-[11px] uppercase tracking-wider"
          style={{ borderColor: c.border, color: c.inkMute, fontWeight: 700 }}>
          <div>Number</div><div>Title</div><div>Category</div><div>Status</div>
          <div className="inline-flex items-center gap-0.5">Adopted <InfoPopover termKey="adopted" label="Adopted" /></div>
          <div className="inline-flex items-center gap-0.5">Tally <InfoPopover termKey="tally" label="Tally" /></div>
          <div></div>
        </div>
        {isLoading ? (
          <div className="p-8 text-center" style={{ color: c.inkMute }}>Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center" style={{ color: c.inkMute }}>
            <Scroll className="inline h-5 w-5 mr-2" /> No resolutions match these filters.
          </div>
        ) : items.map((r) => (
          <Row key={r.id} r={r} onOpen={() => setOpenId(r.id)} />
        ))}
      </div>

      {showNew && (
        <NewResolutionModal
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            qc.invalidateQueries({ queryKey: LIST_KEY });
            setShowNew(false);
            setOpenId(id);
          }}
        />
      )}
      {openId !== null && (
        <DetailModal
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => qc.invalidateQueries({ queryKey: LIST_KEY })}
        />
      )}
    </Layout>
  );
}

function Row({ r, onOpen }: { r: ResolutionListItem; onOpen: () => void }) {
  const s = RESOLUTION_STATUS_LABELS[r.status] ?? { label: r.status, bg: "#EEF1F8", fg: "#5A6280" };
  return (
    <button onClick={onOpen}
      className="w-full grid grid-cols-[110px_1fr_140px_140px_120px_120px_24px] items-center gap-3 px-4 py-3 border-b hover:bg-slate-50 cursor-pointer text-left"
      style={{ borderColor: c.borderSoft }}
      data-testid={`resolution-row-${r.id}`}>
      <div className="font-mono-num text-[12.5px]" style={{ fontWeight: 700, color: c.cobalt }}>
        {r.number ?? "—"}
      </div>
      <div className="min-w-0">
        <div className="text-[14px] truncate" style={{ fontWeight: 600 }}>{r.title}</div>
        <div className="text-[11.5px]" style={{ color: c.inkMute }}>
          {r.createdByName} · {r.votingRuleDescription}
        </div>
      </div>
      <div className="text-[12.5px]" style={{ color: c.ink }}>
        {RESOLUTION_CATEGORY_LABELS[r.category as ResolutionCategory] ?? r.category}
      </div>
      <div>
        <span className="rounded px-2 py-0.5 text-[11px]" style={{ background: s.bg, color: s.fg, fontWeight: 700 }}>
          {s.label}
        </span>
      </div>
      <div className="text-[12.5px] font-mono-num" style={{ color: c.ink }}>
        {r.adoptedAt ? r.adoptedAt.slice(0, 10) : "—"}
      </div>
      <div className="text-[12px]" style={{ color: c.ink }}>
        <span style={{ color: "#0E8A6B" }}>{r.tally.approve}✓</span>{" "}
        <span style={{ color: "#B8264C" }}>{r.tally.reject}✗</span>{" "}
        <span style={{ color: c.inkMute }}>{r.tally.abstain}–</span>
        {!r.public && (
          <span
            className="ml-2 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10.5px]"
            style={{ background: "#EEF1F8", color: "#5A6280", fontWeight: 700 }}
            title="Private — not visible to owners"
            data-testid={`resolution-row-private-${r.id}`}
          >
            <Lock className="h-3 w-3" /> Private
          </span>
        )}
      </div>
      <ChevronRight className="h-4 w-4" style={{ color: c.inkMute }} />
    </button>
  );
}

function NewResolutionModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<ResolutionCategory>("rules");
  const [ruleType, setRuleType] = useState<VotingRule["type"]>("majority");
  const [threshold, setThreshold] = useState(0.667);
  const [quorum, setQuorum] = useState(3);
  const [closesAt, setClosesAt] = useState("");
  const [supersedesId, setSupersedesId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!title.trim()) { setError("Title is required"); return; }
    const rule: VotingRule =
      ruleType === "supermajority" ? { type: "supermajority", threshold }
      : ruleType === "quorum_only" ? { type: "quorum_only", quorum }
      : { type: ruleType };
    setSubmitting(true); setError(null);
    try {
      const { id } = await resolutionsApi.create({
        title: title.trim(),
        body: body.trim(),
        category,
        votingRule: rule,
        closesAt: closesAt ? new Date(closesAt).toISOString() : null,
        supersedesResolutionId: supersedesId ?? undefined,
      });
      onCreated(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New resolution" onClose={onClose} wide>
      {error && <div className="mb-3 rounded-md px-3 py-2 text-[12.5px]" style={{ background: "#FBE3E9", color: "#B8264C" }}>{error}</div>}
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-[13.5px]" style={{ borderColor: c.border }}
            data-testid="input-resolution-title" />
        </Field>
        <Field label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value as ResolutionCategory)}
            className="w-full rounded-md border px-3 py-2 text-[13.5px] bg-white" style={{ borderColor: c.border }}>
            {RESOLUTION_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{RESOLUTION_CATEGORY_LABELS[cat]}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Body (the “Resolved that…” text)">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6}
            className="w-full rounded-md border px-3 py-2 text-[13.5px]" style={{ borderColor: c.border }}
            data-testid="input-resolution-body" />
        </Field>
      </div>
      <div className="grid md:grid-cols-2 gap-3 mt-3">
        <Field label="Voting rule" termKey="voting-rule">
          <select value={ruleType} onChange={(e) => setRuleType(e.target.value as VotingRule["type"])}
            className="w-full rounded-md border px-3 py-2 text-[13.5px] bg-white" style={{ borderColor: c.border }}>
            <option value="majority">Majority of board (default)</option>
            <option value="unanimous">Unanimous</option>
            <option value="supermajority">Supermajority</option>
            <option value="single_approver">Single approver</option>
            <option value="quorum_only">Quorum-only</option>
          </select>
        </Field>
        <Field label="Voting deadline (optional)">
          <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-[13.5px]" style={{ borderColor: c.border }} />
        </Field>
        {ruleType === "supermajority" && (
          <Field label="Threshold (fraction of board)" termKey="supermajority">
            <input type="number" min={0.5} max={1} step={0.01} value={threshold}
              onChange={(e) => setThreshold(Math.max(0.5, Math.min(1, parseFloat(e.target.value) || 0.667)))}
              className="w-32 rounded-md border px-3 py-2 text-[13.5px]" style={{ borderColor: c.border }} />
          </Field>
        )}
        {ruleType === "quorum_only" && (
          <Field label="Quorum (votes that decide)" termKey="quorum">
            <input type="number" min={1} value={quorum}
              onChange={(e) => setQuorum(Math.max(1, parseInt(e.target.value || "1", 10)))}
              className="w-32 rounded-md border px-3 py-2 text-[13.5px]" style={{ borderColor: c.border }} />
          </Field>
        )}
      </div>
      <div className="mt-3">
        <Field label="Optional: this supersedes an existing resolution">
          <ResolutionPicker
            value={supersedesId}
            onChange={(id) => setSupersedesId(id)}
            placeholder="Search by title or number"
          />
        </Field>
      </div>
      <div className="mt-2 text-[11.5px]" style={{ color: c.inkMute }}>
        Drafting only creates the underlying motion. Open it from the Motions page (or the
        detail view) to begin voting; the official number is assigned the moment it’s adopted.
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 rounded-md text-[12.5px]" style={{ color: c.ink, fontWeight: 600 }}>Cancel</button>
        <button onClick={submit} disabled={submitting}
          className="px-3 py-1.5 rounded-md text-[12.5px] disabled:opacity-50"
          style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
          data-testid="button-submit-resolution">
          {submitting ? "Creating…" : "Create draft"}
        </button>
      </div>
    </Modal>
  );
}

function DetailModal({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const { data: r, isLoading, refetch } = useQuery({
    queryKey: ["resolution", id],
    queryFn: () => resolutionsApi.get(id),
  });
  const [showRescind, setShowRescind] = useState(false);
  const [showSupersede, setShowSupersede] = useState(false);

  const rescindMut = useMutation({
    mutationFn: (reason: string) => resolutionsApi.rescind(id, { reason }),
    onSuccess: async () => {
      await refetch(); onChanged();
      setShowRescind(false);
      qc.invalidateQueries({ queryKey: ["motions-list"] });
    },
  });
  const supersedeMut = useMutation({
    mutationFn: (target: number) => resolutionsApi.supersede(id, target),
    onSuccess: async () => { await refetch(); onChanged(); setShowSupersede(false); },
  });
  const visibilityMut = useMutation({
    mutationFn: (isPublic: boolean) => resolutionsApi.setVisibility(id, isPublic),
    // Optimistic update on the cached detail.
    onMutate: async (isPublic) => {
      await qc.cancelQueries({ queryKey: ["resolution", id] });
      const prev = qc.getQueryData<ResolutionDetail>(["resolution", id]);
      if (prev) qc.setQueryData<ResolutionDetail>(["resolution", id], { ...prev, public: isPublic });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["resolution", id], ctx.prev);
    },
    onSettled: () => { onChanged(); refetch(); },
  });

  return (
    <Modal title={r ? `Resolution ${r.number ?? `(draft #${r.id})`}` : "Loading…"} onClose={onClose} wide>
      {isLoading || !r ? (
        <div className="p-6 text-center" style={{ color: c.inkMute }}>Loading…</div>
      ) : (
        <div className="space-y-4">
          {r.status === "superseded" && r.supersededBy && (
            <Banner color="#9A6500" bg="#FFEFD0">
              <AlertTriangle className="h-4 w-4 inline mr-1" />
              Superseded by Resolution{" "}
              <strong>{r.supersededBy.number ?? `#${r.supersededBy.id}`}</strong> — {r.supersededBy.title}.
            </Banner>
          )}
          {r.status === "rescinded" && (
            <Banner color="#B8264C" bg="#FBE3E9">
              <AlertTriangle className="h-4 w-4 inline mr-1" />
              This resolution has been rescinded by a follow-up motion.
            </Banner>
          )}
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[16px]" style={{ fontWeight: 700 }}>{r.title}</div>
              <div className="text-[12px]" style={{ color: c.inkMute }}>
                {RESOLUTION_CATEGORY_LABELS[r.category as ResolutionCategory] ?? r.category} ·
                Voting rule: {r.votingRuleDescription} · Proposed by {r.createdByName} on {r.createdAt.slice(0, 10)}
              </div>
            </div>
            <StatusBadge status={r.status} />
          </div>
          <div
            className="rounded-md border p-3 flex items-center justify-between gap-3"
            style={{ borderColor: c.borderSoft, background: r.public ? "#F1FAF6" : "#FAFAFB" }}
          >
            <div className="flex items-start gap-2 min-w-0">
              {r.public
                ? <Globe className="h-4 w-4 mt-0.5" style={{ color: "#0E8A6B" }} />
                : <Lock className="h-4 w-4 mt-0.5" style={{ color: "#5A6280" }} />}
              <div className="min-w-0">
                <div className="text-[12.5px]" style={{ color: c.ink, fontWeight: 700 }}>
                  Owner visibility: {r.public ? "Public" : "Private"}
                </div>
                <div className="text-[11.5px]" style={{ color: c.inkMute }}>
                  {r.public
                    ? "Owners can see this resolution in their Board section."
                    : "Hidden from owners. Only managers and board members can see it."}
                </div>
              </div>
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer text-[12px]" style={{ color: c.ink, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={r.public}
                disabled={visibilityMut.isPending}
                onChange={(e) => visibilityMut.mutate(e.target.checked)}
                data-testid="toggle-resolution-public"
              />
              Public to owners
            </label>
          </div>
          {r.body && (
            <div className="rounded-md border p-3 text-[13px] whitespace-pre-wrap"
              style={{ borderColor: c.borderSoft, background: "#FAFAFB" }}>
              {r.body}
            </div>
          )}
          <div className="rounded-md border p-3" style={{ borderColor: c.borderSoft }}>
            <div className="text-[11.5px] mb-2 inline-flex items-center gap-0.5" style={{ color: c.inkMute, fontWeight: 700 }}>
              VOTE OF RECORD
              <InfoPopover termKey="tally" label="Vote of record" />
            </div>
            <div className="text-[12.5px]">
              <span style={{ color: "#0E8A6B" }}>{r.tally.approve} approve</span> ·{" "}
              <span style={{ color: "#B8264C" }}>{r.tally.reject} reject</span> ·{" "}
              <span style={{ color: c.inkMute }}>{r.tally.abstain} abstain</span>
            </div>
            <div className="text-[11.5px] mt-1" style={{ color: c.inkMute }}>
              Underlying motion: M-{r.motionId} (status: {r.motionStatus})
            </div>
          </div>

          {r.supersedes && (
            <div className="rounded-md border p-3 text-[12.5px]" style={{ borderColor: c.borderSoft }}>
              <strong>Supersedes:</strong> Resolution {r.supersedes.number ?? `#${r.supersedes.id}`} — {r.supersedes.title}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {r.pdfStorageKey && (
              <a href={resolutionsApi.pdfUrl(r.id)} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12.5px] border"
                style={{ borderColor: c.border, color: c.ink, fontWeight: 600 }}
                data-testid="link-resolution-pdf">
                <FileDown className="h-3.5 w-3.5" /> Adopted PDF
              </a>
            )}
            {r.status === "adopted" && (
              <>
                <button
                  onClick={() => setShowSupersede(true)}
                  className="px-3 py-1.5 rounded-md text-[12.5px] border"
                  style={{ borderColor: c.border, color: c.ink, fontWeight: 600 }}
                  data-testid="button-supersede"
                >
                  Mark another as superseded by this one
                </button>
                {!r.rescindedByMotionId && (
                  <button
                    onClick={() => setShowRescind(true)}
                    className="px-3 py-1.5 rounded-md text-[12.5px]"
                    style={{ background: "#B8264C", color: "#fff", fontWeight: 600 }}
                    data-testid="button-rescind"
                  >
                    Start rescind motion
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {showSupersede && r && (
        <SupersedeDialog
          excludeId={r.id}
          onClose={() => setShowSupersede(false)}
          onConfirm={(target) => supersedeMut.mutate(target)}
          busy={supersedeMut.isPending}
        />
      )}
      {showRescind && r && (
        <RescindDialog
          onClose={() => setShowRescind(false)}
          onConfirm={(reason) => rescindMut.mutate(reason)}
          busy={rescindMut.isPending}
        />
      )}
    </Modal>
  );
}

function SupersedeDialog({
  excludeId, onClose, onConfirm, busy,
}: { excludeId: number; onClose: () => void; onConfirm: (target: number) => void; busy: boolean }) {
  const [target, setTarget] = useState<number | null>(null);
  return (
    <Modal title="Mark a resolution as superseded by this one" onClose={onClose}>
      <div className="text-[12.5px] mb-2" style={{ color: c.inkMute }}>
        Pick the older resolution that this one replaces. The selected resolution will be moved
        to the Superseded view.
      </div>
      <ResolutionPicker value={target} onChange={(id) => setTarget(id)} excludeId={excludeId} />
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 rounded-md text-[12.5px]" style={{ color: c.ink, fontWeight: 600 }}>Cancel</button>
        <button
          onClick={() => target && onConfirm(target)}
          disabled={!target || busy}
          className="px-3 py-1.5 rounded-md text-[12.5px] disabled:opacity-50"
          style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
        >
          {busy ? "Saving…" : "Confirm"}
        </button>
      </div>
    </Modal>
  );
}

function RescindDialog({
  onClose, onConfirm, busy,
}: { onClose: () => void; onConfirm: (reason: string) => void; busy: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <Modal title="Start a rescind motion" onClose={onClose}>
      <div className="text-[12.5px] mb-2" style={{ color: c.inkMute }}>
        Rescinding requires a follow-up motion. We’ll draft it for you; the resolution becomes
        Rescinded only when that motion is adopted.
      </div>
      <Field label="Reason for rescinding (becomes the motion body)">
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4}
          className="w-full rounded-md border px-3 py-2 text-[13.5px]" style={{ borderColor: c.border }} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 rounded-md text-[12.5px]" style={{ color: c.ink, fontWeight: 600 }}>Cancel</button>
        <button
          onClick={() => onConfirm(reason)} disabled={busy}
          className="px-3 py-1.5 rounded-md text-[12.5px] disabled:opacity-50"
          style={{ background: "#B8264C", color: "#fff", fontWeight: 600 }}
        >
          {busy ? "Drafting…" : "Draft rescind motion"}
        </button>
      </div>
    </Modal>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = RESOLUTION_STATUS_LABELS[status] ?? { label: status, bg: "#EEF1F8", fg: "#5A6280" };
  return <span className="rounded px-2 py-1 text-[11px]" style={{ background: s.bg, color: s.fg, fontWeight: 700 }}>{s.label}</span>;
}

function Banner({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return (
    <div className="rounded-md px-3 py-2 text-[12.5px]" style={{ background: bg, color, fontWeight: 600 }}>
      {children}
    </div>
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

// Suppress unused imports (`useMemo` retained for future work).
void useMemo;
