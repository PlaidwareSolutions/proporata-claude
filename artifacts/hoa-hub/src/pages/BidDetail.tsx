import { useMemo, useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Send, Award, X, Lock, Unlock, FileText, Trophy, Copy, Check, Upload, Trash2, Plus, Mail,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { bidsApi, BID_STATUS_LABELS, fmtCents, type BidDetail } from "@/lib/bidsApi";
import { useListVendors } from "@workspace/api-client-react";
import { ResolutionLinkCard } from "@/components/ResolutionLinkCard";
import { MotionAuthorizationCard } from "@/components/MotionAuthorizationCard";
import { useAuth } from "@/contexts/AuthContext";

export default function BidDetailPage() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id, 10);
  const qc = useQueryClient();
  const { user } = useAuth();
  const isManager = user?.role === "admin" || user?.role === "manager";
  const [, setLocation] = useLocation();
  const KEY = ["bid-detail", id] as const;
  const { data: bid, isLoading, error } = useQuery({
    queryKey: KEY,
    queryFn: () => bidsApi.get(id),
    enabled: !isNaN(id),
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: ["bids-list"] });
  };

  if (isLoading || !bid) {
    return <Layout title="Loading…"><div /></Layout>;
  }
  if (error) return <Layout title="Bid Request"><div className="text-red-600">{(error as Error).message}</div></Layout>;

  const statusMeta = BID_STATUS_LABELS[bid.status] ?? { label: bid.status, bg: "#EEF1F8", fg: "#5A6280" };
  const isDraft = bid.status === "draft";
  const isOpen = bid.status === "open";
  const isClosed = bid.status === "closed";
  const isAwarded = bid.status === "awarded";
  const isCancelled = bid.status === "cancelled";

  return (
    <Layout
      title={`BR-${bid.id} · ${bid.title}`}
      subtitle={`${bid.tradeCategory}${bid.buildingNum ? ` · Building ${bid.buildingNum}` : ""}`}
      actions={
        <Link href="/bids">
          <a className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] border" style={{ borderColor: c.border }}>
            <ArrowLeft className="h-4 w-4" /> Back to bids
          </a>
        </Link>
      }
    >
      <div className="flex items-center gap-2 mb-4">
        <span className="rounded px-2 py-0.5 text-[12px]" style={{ background: statusMeta.bg, color: statusMeta.fg, fontWeight: 700 }}>
          {statusMeta.label}
        </span>
        {bid.sealedBids && (
          <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11.5px]"
            style={{ background: bid.sealedActive ? "#FFEFD0" : "#DCF3EC", color: bid.sealedActive ? "#9A6500" : "#0E8A6B", fontWeight: 700 }}>
            {bid.sealedActive ? <><Lock className="h-3 w-3" /> Sealed</> : <><Unlock className="h-3 w-3" /> Opened</>}
          </span>
        )}
        <span className="text-[12.5px]" style={{ color: c.inkMute }}>
          Deadline: {bid.deadline.slice(0, 10)} · Created {bid.createdAt.slice(0, 10)} by {bid.createdByName}
        </span>
        <div className="flex-1" />
        {isDraft && <SendBidButton bidId={bid.id} canSend={bid.scopeItems.length > 0 && bid.invitations.length > 0} onDone={invalidate} />}
        {(isOpen || isClosed) && (
          <CancelButton bidId={bid.id} onDone={() => { invalidate(); setLocation("/bids"); }} />
        )}
        {isOpen && bid.sealedBids && bid.sealedActive && (
          <button onClick={async () => { await bidsApi.openSealedEarly(bid.id); invalidate(); }}
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-[12.5px]" style={{ borderColor: c.border }}>
            <Unlock className="h-3.5 w-3.5" /> Open sealed early
          </button>
        )}
        {isAwarded && bid.awardMemoStorageKey && (
          <a href={bidsApi.awardMemoUrl(bid.id)} target="_blank" rel="noopener"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px]" style={{ borderColor: c.border }}>
            <FileText className="h-3.5 w-3.5" /> Download award memo
          </a>
        )}
      </div>

      {isAwarded && bid.awardedWorkOrderId && (
        <div className="rounded-xl border p-4 mb-4" style={{ borderColor: "#0E8A6B33", background: "#DCF3EC" }}>
          <div className="flex items-center gap-2 text-[14px]" style={{ fontWeight: 700, color: "#0E8A6B" }}>
            <Trophy className="h-4 w-4" /> Awarded
          </div>
          <div className="text-[13px] mt-1" style={{ color: c.ink }}>
            Awarded to <strong>{bid.quotes.find((q) => q.vendorId === bid.awardedVendorId)?.vendorName ?? "—"}</strong>.{" "}
            <Link href={`/work-orders/${bid.awardedWorkOrderId}`}>
              <a style={{ color: c.cobalt, fontWeight: 600 }}>View work order {bid.awardedWorkOrderId} →</a>
            </Link>
          </div>
          {bid.awardRationale && (
            <div className="text-[12.5px] mt-2" style={{ color: c.inkSoft }}>
              <strong>Rationale:</strong> {bid.awardRationale}
            </div>
          )}
          {(bid.awardMotionId || bid.awardEmergencyBypassId) && (
            <div className="mt-3">
              <MotionAuthorizationCard
                motionId={bid.awardMotionId}
                bypassId={bid.awardEmergencyBypassId}
                label="Award Authorization"
              />
            </div>
          )}
        </div>
      )}
      {isCancelled && (
        <div className="rounded-xl border p-4 mb-4" style={{ borderColor: "#9A2A2A33", background: "#F7E5E5" }}>
          <div className="text-[13.5px]" style={{ color: "#9A2A2A", fontWeight: 700 }}>This bid was cancelled.</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <div className="space-y-4">
          {bid.scope && (
            <Section title="Project Description">
              <p className="text-[13.5px] whitespace-pre-wrap" style={{ color: c.ink }}>{bid.scope}</p>
            </Section>
          )}

          <ResolutionLinkCard
            resolutionId={bid.resolutionId}
            resolutionNumber={bid.resolutionNumber}
            resolutionTitle={bid.resolutionTitle}
            resolutionStatus={bid.resolutionStatus}
            canEdit={isManager}
            onSave={async (resolutionId) => {
              await bidsApi.patch(bid.id, { resolutionId });
              invalidate();
            }}
          />

          <ScopeItemsCard bid={bid} editable={isDraft} onChange={invalidate} />

          <ComparisonCard bid={bid} onAward={invalidate} />

          <AttachmentsCard bid={bid} onChange={invalidate} />
        </div>

        <div className="space-y-4">
          <InvitationsCard bid={bid} onChange={invalidate} />
        </div>
      </div>
    </Layout>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px]" style={{ fontWeight: 700 }}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function SendBidButton({ bidId, canSend, onDone }: { bidId: number; canSend: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        if (!canSend) return;
        setBusy(true);
        try { await bidsApi.send(bidId); onDone(); } catch (e) { alert((e as Error).message); }
        setBusy(false);
      }}
      disabled={!canSend || busy}
      title={canSend ? "Send invitations" : "Add scope items and invite vendors first"}
      className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] disabled:opacity-50"
      style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
      data-testid="button-send-bid"
    >
      <Send className="h-3.5 w-3.5" /> {busy ? "Sending…" : "Send to vendors"}
    </button>
  );
}

function CancelButton({ bidId, onDone }: { bidId: number; onDone: () => void }) {
  return (
    <button onClick={async () => {
      if (!confirm("Cancel this bid? Vendor links will stop working.")) return;
      await bidsApi.cancel(bidId); onDone();
    }} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px]" style={{ borderColor: c.border, color: "#9A2A2A" }}>
      Cancel bid
    </button>
  );
}

function ScopeItemsCard({ bid, editable, onChange }: { bid: BidDetail; editable: boolean; onChange: () => void }) {
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <Section title={`Scope Items (${bid.scopeItems.length})`}>
      {bid.scopeItems.length === 0 && (
        <div className="text-[13px] mb-2" style={{ color: c.inkMute }}>No scope items yet.</div>
      )}
      <ol className="space-y-1.5 mb-3">
        {bid.scopeItems.map((it, i) => (
          <li key={it.id} className="flex items-start gap-2 text-[13px]">
            <span className="font-mono-num text-[12px] mt-0.5" style={{ color: c.inkMute, minWidth: 16 }}>{i + 1}.</span>
            <span className="flex-1">
              <span style={{ fontWeight: 600 }}>{it.label}</span>
              {it.notes && <span style={{ color: c.inkMute }}> — {it.notes}</span>}
            </span>
            {editable && (
              <button onClick={async () => {
                await bidsApi.removeScopeItem(it.id); onChange();
              }} className="opacity-50 hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
            )}
          </li>
        ))}
      </ol>
      {editable && (
        <div className="flex gap-2 pt-3 border-t" style={{ borderColor: c.borderSoft }}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Item label" className="flex-1 rounded-md border px-3 py-1.5 text-[13px]" style={{ borderColor: c.border }} />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" className="flex-1 rounded-md border px-3 py-1.5 text-[13px]" style={{ borderColor: c.border }} />
          <button onClick={async () => {
            if (!label.trim()) return;
            await bidsApi.addScopeItem(bid.id, { label: label.trim(), notes: notes.trim() || null });
            setLabel(""); setNotes(""); onChange();
          }} className="rounded-md px-3 py-1.5 text-[12.5px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
            <Plus className="h-3.5 w-3.5 inline" /> Add
          </button>
        </div>
      )}
    </Section>
  );
}

function InvitationsCard({ bid, onChange }: { bid: BidDetail; onChange: () => void }) {
  const { data: vendors = [] } = useListVendors();
  const tradeVendors = vendors.filter((v) =>
    v.tradeCategory === bid.tradeCategory &&
    !bid.invitations.some((i) => i.vendorId === v.id)
  );
  const editable = bid.status !== "awarded" && bid.status !== "cancelled";
  const [showAdd, setShowAdd] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [copied, setCopied] = useState<number | null>(null);
  const [links, setLinks] = useState<Record<number, string>>({});

  return (
    <Section title={`Invited Vendors (${bid.invitations.length})`}
      action={editable && tradeVendors.length > 0 ? (
        <button onClick={() => setShowAdd((v) => !v)}
          className="text-[12.5px] inline-flex items-center gap-1" style={{ color: c.cobalt, fontWeight: 600 }}>
          <Plus className="h-3.5 w-3.5" /> Invite
        </button>
      ) : null}>
      {bid.invitations.length === 0 && (
        <div className="text-[12.5px]" style={{ color: c.inkMute }}>No vendors invited yet.</div>
      )}
      <div className="space-y-2">
        {bid.invitations.map((inv) => {
          const link = links[inv.id];
          const sm = invitationStatus(inv.status);
          return (
            <div key={inv.id} className="rounded-md border p-2.5" style={{ borderColor: c.borderSoft }}>
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-[13px] truncate" style={{ fontWeight: 600 }}>{inv.vendorName}</div>
                  <div className="text-[11.5px]" style={{ color: c.inkMute }}>{inv.vendorEmail}</div>
                </div>
                <span className="rounded px-2 py-0.5 text-[10.5px]" style={{ background: sm.bg, color: sm.fg, fontWeight: 700 }}>
                  {sm.label}
                </span>
              </div>
              {link && (
                <div className="mt-2 flex items-center gap-1.5">
                  <input readOnly value={link} className="flex-1 rounded border px-2 py-1 text-[11px] font-mono" style={{ borderColor: c.borderSoft }} />
                  <button onClick={() => { navigator.clipboard.writeText(link); setCopied(inv.id); setTimeout(() => setCopied(null), 1500); }}
                    className="p-1 rounded hover:bg-slate-100">
                    {copied === inv.id ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {showAdd && editable && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: c.borderSoft }}>
          <div className="text-[11px] mb-2" style={{ color: c.inkMute, fontWeight: 600 }}>SELECT VENDORS</div>
          <div className="border rounded-md max-h-40 overflow-y-auto" style={{ borderColor: c.border }}>
            {tradeVendors.map((v) => (
              <label key={v.id} className="flex items-center gap-2 px-2 py-1.5 text-[12.5px] hover:bg-slate-50">
                <input type="checkbox" checked={picked.includes(v.id)} onChange={(e) => {
                  setPicked(e.target.checked ? [...picked, v.id] : picked.filter((x) => x !== v.id));
                }} />
                {v.name}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => { setShowAdd(false); setPicked([]); }} className="px-3 py-1 rounded text-[12px] border" style={{ borderColor: c.border }}>Close</button>
            <button onClick={async () => {
              if (picked.length === 0) return;
              const r = await bidsApi.invite(bid.id, picked);
              const next: Record<number, string> = {};
              for (const i of r.invitations) next[i.vendorId] = i.magicLink;
              setLinks((prev) => ({ ...prev, ...next }));
              setPicked([]); setShowAdd(false); onChange();
            }} className="px-3 py-1 rounded text-[12px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
              <Mail className="h-3.5 w-3.5 inline" /> Invite
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

function invitationStatus(s: string): { label: string; bg: string; fg: string } {
  if (s === "submitted") return { label: "Submitted", bg: "#DCF3EC", fg: "#0E8A6B" };
  if (s === "viewed") return { label: "Viewed", bg: "#DCEAFE", fg: "#1A4FBF" };
  if (s === "declined") return { label: "Declined", bg: "#F3D6D6", fg: "#9A2A2A" };
  if (s === "no_response") return { label: "No response", bg: "#EEF1F8", fg: "#5A6280" };
  return { label: "Invited", bg: "#FFEFD0", fg: "#9A6500" };
}

function ComparisonCard({ bid, onAward }: { bid: BidDetail; onAward: () => void }) {
  const sealed = bid.sealedActive;
  const items = bid.scopeItems;
  const quotes = bid.quotes;
  const [awardingId, setAwardingId] = useState<number | null>(null);
  const [motionId, setMotionId] = useState("");
  const [rationale, setRationale] = useState("");
  const [awarding, setAwarding] = useState(false);
  const [showManager, setShowManager] = useState(false);

  // A quote only counts as "complete" (eligible for lowest highlighting and
  // total comparison) if it has a numeric amount for every scope item. This
  // prevents an incomplete quote from appearing artificially cheapest.
  const completeQuoteIds = useMemo(() => {
    const set = new Set<number>();
    for (const q of quotes) {
      const has = (id: number) => {
        const ln = q.lines.find((l) => l.scopeItemId === id);
        return ln && typeof ln.amountCents === "number";
      };
      if (items.length > 0 && items.every((it) => has(it.id))) set.add(q.id);
    }
    return set;
  }, [items, quotes]);

  const lowestTotalId = useMemo(() => {
    if (sealed) return null;
    let best: { id: number; total: number } | null = null;
    for (const q of quotes) {
      // Only complete quotes are eligible to be flagged "lowest total".
      if (typeof q.totalCents !== "number") continue;
      if (!completeQuoteIds.has(q.id)) continue;
      if (!best || q.totalCents < best.total) best = { id: q.id, total: q.totalCents };
    }
    return best?.id ?? null;
  }, [quotes, sealed, completeQuoteIds]);

  // Lowest amount per scope-item row (per-cell highlight) — null when sealed.
  // Considers all submitted lines, not just complete quotes — the lowest cell
  // is meaningful per row even if the quote is incomplete elsewhere.
  const lowestPerRow = useMemo(() => {
    const out = new Map<number, number>();
    if (sealed) return out;
    for (const it of items) {
      let bestQid: number | null = null;
      let bestAmount = Number.POSITIVE_INFINITY;
      for (const q of quotes) {
        const line = q.lines.find((l) => l.scopeItemId === it.id);
        if (line && typeof line.amountCents === "number" && line.amountCents < bestAmount) {
          bestAmount = line.amountCents;
          bestQid = q.id;
        }
      }
      if (bestQid !== null) out.set(it.id, bestQid);
    }
    return out;
  }, [items, quotes, sealed]);

  const canAward = (bid.status === "open" || bid.status === "closed") && quotes.length > 0;

  return (
    <Section title={`Quote Comparison (${quotes.length})`}
      action={(bid.status === "open" || bid.status === "closed" || bid.status === "draft") ? (
        <button onClick={() => setShowManager(true)}
          className="text-[12.5px] inline-flex items-center gap-1" style={{ color: c.cobalt, fontWeight: 600 }}>
          <Plus className="h-3.5 w-3.5" /> Enter quote on behalf
        </button>
      ) : null}>
      {quotes.length === 0 ? (
        <div className="text-[13px]" style={{ color: c.inkMute }}>
          No quotes submitted yet. Vendors will receive a unique link when you send the bid.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr style={{ background: "#F7F8FC" }}>
                <th className="text-left px-2 py-2 border-b" style={{ borderColor: c.border, fontWeight: 700, color: c.inkMute }}>Scope item</th>
                {quotes.map((q) => (
                  <th key={q.id} className="text-right px-2 py-2 border-b" style={{ borderColor: c.border, fontWeight: 700 }}>
                    {q.vendorName}
                    {q.enteredByManager && <span className="block text-[10px]" style={{ color: c.inkMute, fontWeight: 500 }}>(manager-entered)</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="px-2 py-1.5 border-b" style={{ borderColor: c.borderSoft }}>{it.label}</td>
                  {quotes.map((q) => {
                    const line = q.lines.find((l) => l.scopeItemId === it.id);
                    const hasAmount = line && typeof line.amountCents === "number";
                    const isLow = !sealed && hasAmount && lowestPerRow.get(it.id) === q.id;
                    return (
                      <td key={q.id} className="px-2 py-1.5 text-right font-mono-num border-b"
                        style={{
                          borderColor: c.borderSoft,
                          background: isLow ? "#DCF3EC" : undefined,
                          color: isLow ? "#0E8A6B" : (!sealed && !hasAmount) ? "#9A2A2A" : c.ink,
                          fontWeight: isLow || (!sealed && !hasAmount) ? 700 : 400,
                        }}>
                        {sealed ? "•••" : hasAmount ? fmtCents(line!.amountCents) : "missing"}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr style={{ background: "#F7F8FC" }}>
                <td className="px-2 py-2" style={{ fontWeight: 700 }}>Total {!sealed && <span className="text-[10px] font-normal" style={{ color: c.inkMute }}>(complete quotes only)</span>}</td>
                {quotes.map((q) => (
                  <td key={q.id} className="px-2 py-2 text-right font-mono-num"
                    style={{ fontWeight: 700, color: lowestTotalId === q.id ? "#0E8A6B" : c.ink }}>
                    {sealed ? "•••" : fmtCents(q.totalCents)}
                    {lowestTotalId === q.id && !sealed && <div className="text-[10px]" style={{ color: "#0E8A6B" }}>LOWEST</div>}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-2 py-1.5 text-[11.5px]" style={{ color: c.inkMute }}>Lead time</td>
                {quotes.map((q) => (
                  <td key={q.id} className="px-2 py-1.5 text-right text-[11.5px]" style={{ color: c.inkMute }}>
                    {q.leadTimeDays ? `${q.leadTimeDays}d` : "—"}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-2 py-1.5 text-[11.5px]" style={{ color: c.inkMute }}>Payment terms</td>
                {quotes.map((q) => (
                  <td key={q.id} className="px-2 py-1.5 text-right text-[11.5px]" style={{ color: c.inkMute }}>{q.paymentTerms ?? "—"}</td>
                ))}
              </tr>
              <tr>
                <td className="px-2 py-1.5 text-[11.5px]" style={{ color: c.inkMute }}>Warranty</td>
                {quotes.map((q) => (
                  <td key={q.id} className="px-2 py-1.5 text-right text-[11.5px]" style={{ color: c.inkMute }}>{q.warrantyText ?? "—"}</td>
                ))}
              </tr>
              <tr>
                <td className="px-2 py-1.5 text-[11.5px]" style={{ color: c.inkMute }}>Submitted</td>
                {quotes.map((q) => (
                  <td key={q.id} className="px-2 py-1.5 text-right text-[11.5px]" style={{ color: c.inkMute }}>
                    {q.submittedAt ? q.submittedAt.slice(0, 10) : "—"}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-2 py-1.5 text-[11.5px]" style={{ color: c.inkMute }}>Documents</td>
                {quotes.map((q) => (
                  <td key={q.id} className="px-2 py-1.5 text-right text-[11.5px]">
                    <div className="flex justify-end gap-1.5 flex-wrap">
                      {q.quotePdfStorageKey ? (
                        <a href={bidsApi.quoteDocUrl(q.id, "quote")} target="_blank" rel="noopener" className="underline" style={{ color: c.cobalt }}>Quote PDF</a>
                      ) : <span style={{ color: c.inkMute }}>no quote</span>}
                    </div>
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-2 py-1.5 text-[11.5px]" style={{ color: c.inkMute }}>License / COI</td>
                {quotes.map((q) => {
                  const missingLicense = !q.licenseStorageKey;
                  const missingCoi = !q.coiStorageKey;
                  return (
                    <td key={q.id} className="px-2 py-1.5 text-right text-[11.5px]">
                      <div className="flex justify-end gap-1.5 flex-wrap">
                        {q.licenseStorageKey
                          ? <a href={bidsApi.quoteDocUrl(q.id, "license")} target="_blank" rel="noopener" className="underline" style={{ color: c.cobalt }}>License</a>
                          : <span title="No contractor license on file" style={{ color: "#9A2A2A", fontWeight: 700 }}>⚠ License</span>}
                        {q.coiStorageKey
                          ? <a href={bidsApi.quoteDocUrl(q.id, "coi")} target="_blank" rel="noopener" className="underline" style={{ color: c.cobalt }}>COI</a>
                          : <span title="No certificate of insurance on file" style={{ color: "#9A2A2A", fontWeight: 700 }}>⚠ COI</span>}
                        {(missingLicense || missingCoi) && q.id === lowestTotalId && (
                          <span className="block w-full text-[10px] text-right" style={{ color: "#9A2A2A" }}>
                            Lowest bid is missing required docs
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
              {canAward && (
                <tr>
                  <td className="px-2 py-2"></td>
                  {quotes.map((q) => (
                    <td key={q.id} className="px-2 py-2 text-right">
                      <button onClick={() => { setAwardingId(q.vendorId); setRationale(""); }}
                        className="rounded px-2 py-1 text-[11px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
                        Award →
                      </button>
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {awardingId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAwardingId(null)}>
          <div className="bg-white rounded-xl border max-w-md w-full p-5" onClick={(e) => e.stopPropagation()} style={{ borderColor: c.border }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[16px]" style={{ fontWeight: 700 }}>
                <Award className="inline h-4 w-4 mr-1" /> Confirm Award
              </h3>
              <button onClick={() => setAwardingId(null)}><X className="h-4 w-4" /></button>
            </div>
            <div className="text-[13px] mb-3">
              Award this bid to <strong>{quotes.find((q) => q.vendorId === awardingId)?.vendorName}</strong> for{" "}
              <strong className="font-mono-num">{fmtCents(quotes.find((q) => q.vendorId === awardingId)?.totalCents ?? 0)}</strong>.
              A work order will be created automatically.
            </div>
            <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3}
              placeholder="Rationale for the board (required)"
              className="w-full rounded-md border px-3 py-2 text-[13px] mb-3" style={{ borderColor: c.border }} />
            <label className="block text-[11.5px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>
              Adopted motion # (required if award amount ≥ board expenditure threshold)
            </label>
            <input type="number" min={0} value={motionId} onChange={(e) => setMotionId(e.target.value)}
              placeholder="e.g. 42"
              className="w-full rounded-md border px-3 py-2 text-[13px] mb-3" style={{ borderColor: c.border }} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setAwardingId(null)} className="rounded border px-3 py-1.5 text-[12.5px]" style={{ borderColor: c.border }}>Cancel</button>
              <button disabled={awarding || !rationale.trim()} onClick={async () => {
                setAwarding(true);
                try {
                  const payload: { vendorId: number; rationale: string; motionId?: number } = {
                    vendorId: awardingId, rationale: rationale.trim(),
                  };
                  if (motionId.trim()) payload.motionId = Number(motionId);
                  await bidsApi.award(bid.id, payload as never);
                  setAwardingId(null); setAwarding(false); onAward();
                } catch (e) { alert((e as Error).message); setAwarding(false); }
              }} className="rounded px-3 py-1.5 text-[12.5px] disabled:opacity-50" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                data-testid="button-confirm-award">
                {awarding ? "Awarding…" : "Award & create WO"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showManager && (
        <ManagerQuoteModal bid={bid} onClose={() => setShowManager(false)} onDone={() => { setShowManager(false); onAward(); }} />
      )}
    </Section>
  );
}

function ManagerQuoteModal({ bid, onClose, onDone }: { bid: BidDetail; onClose: () => void; onDone: () => void }) {
  const { data: vendors = [] } = useListVendors();
  const tradeVendors = vendors.filter((v) => v.tradeCategory === bid.tradeCategory);
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [leadTime, setLeadTime] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [warranty, setWarranty] = useState("");
  const [notes, setNotes] = useState("");
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl border max-w-lg w-full max-h-[90vh] overflow-y-auto" style={{ borderColor: c.border }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: c.border }}>
          <h3 className="text-[16px]" style={{ fontWeight: 700 }}>Enter Quote on Behalf</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <div className="text-[11px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>VENDOR</div>
            <select value={vendorId ?? ""} onChange={(e) => setVendorId(e.target.value ? Number(e.target.value) : null)}
              className="w-full rounded-md border px-3 py-2 text-[13px]" style={{ borderColor: c.border }}>
              <option value="">— Select —</option>
              {tradeVendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <div>
            <div className="text-[11px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>LINE ITEM PRICES</div>
            {bid.scopeItems.map((it) => (
              <div key={it.id} className="flex items-center gap-2 mb-1.5">
                <div className="flex-1 text-[12.5px]">{it.label}</div>
                <span className="text-[12px]">$</span>
                <input type="number" min="0" step="0.01" value={amounts[it.id] ?? ""}
                  onChange={(e) => setAmounts({ ...amounts, [it.id]: e.target.value })}
                  className="w-28 rounded border px-2 py-1 text-[12.5px] font-mono-num" style={{ borderColor: c.border }} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <div className="text-[11px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>LEAD TIME (DAYS)</div>
              <input type="number" min="0" value={leadTime} onChange={(e) => setLeadTime(e.target.value)}
                className="w-full rounded-md border px-3 py-1.5 text-[13px]" style={{ borderColor: c.border }} />
            </label>
            <label className="block">
              <div className="text-[11px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>PAYMENT TERMS</div>
              <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder="e.g. 50% deposit, balance on completion"
                className="w-full rounded-md border px-3 py-1.5 text-[13px]" style={{ borderColor: c.border }} />
            </label>
          </div>
          <label className="block">
            <div className="text-[11px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>WARRANTY</div>
            <input value={warranty} onChange={(e) => setWarranty(e.target.value)}
              className="w-full rounded-md border px-3 py-1.5 text-[13px]" style={{ borderColor: c.border }} />
          </label>
          <label className="block">
            <div className="text-[11px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>NOTES</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full rounded-md border px-3 py-1.5 text-[13px]" style={{ borderColor: c.border }} />
          </label>
        </div>
        <div className="border-t flex justify-end gap-2 px-5 py-3" style={{ borderColor: c.border }}>
          <button onClick={onClose} className="px-3 py-1.5 rounded border text-[12.5px]" style={{ borderColor: c.border }}>Cancel</button>
          <button disabled={!vendorId || busy} onClick={async () => {
            if (!vendorId) return;
            setBusy(true);
            try {
              const lines = bid.scopeItems
                .filter((it) => amounts[it.id])
                .map((it) => ({ scopeItemId: it.id, amountCents: Math.round(parseFloat(amounts[it.id]!) * 100) }));
              await bidsApi.managerQuote(bid.id, {
                vendorId,
                leadTimeDays: leadTime ? Number(leadTime) : undefined,
                paymentTerms: paymentTerms || undefined,
                warrantyText: warranty || undefined,
                notes: notes || undefined,
                lines,
              });
              onDone();
            } catch (e) { alert((e as Error).message); }
            setBusy(false);
          }} className="px-3 py-1.5 rounded text-[12.5px] disabled:opacity-50" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
            {busy ? "Saving…" : "Save quote"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AttachmentsCard({ bid, onChange }: { bid: BidDetail; onChange: () => void }) {
  const editable = bid.status !== "awarded" && bid.status !== "cancelled";
  const [busy, setBusy] = useState(false);
  async function upload(file: File) {
    setBusy(true);
    try {
      const { uploadURL, objectPath } = await bidsApi.uploadUrl();
      const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!put.ok) throw new Error("Upload failed");
      await bidsApi.addAttachment(bid.id, { name: file.name, storageKey: objectPath, size: file.size, contentType: file.type, kind: "spec" });
      onChange();
    } catch (e) { alert((e as Error).message); }
    setBusy(false);
  }
  return (
    <Section title={`Attachments (${bid.attachments.length})`} action={editable ? (
      <label className="text-[12.5px] inline-flex items-center gap-1 cursor-pointer" style={{ color: c.cobalt, fontWeight: 600 }}>
        <Upload className="h-3.5 w-3.5" /> {busy ? "Uploading…" : "Upload"}
        <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
      </label>
    ) : null}>
      {bid.attachments.length === 0 ? (
        <div className="text-[13px]" style={{ color: c.inkMute }}>No attachments. Upload spec sheets, photos, or drawings here.</div>
      ) : (
        <ul className="space-y-1.5">
          {bid.attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-[13px]">
              <FileText className="h-3.5 w-3.5" style={{ color: c.inkMute }} />
              <a href={bidsApi.attachmentUrl(bid.id, a.id)} target="_blank" rel="noopener" style={{ color: c.cobalt, fontWeight: 600 }}>{a.name}</a>
              <span className="text-[11px]" style={{ color: c.inkMute }}>· {(a.size / 1024).toFixed(0)} KB · {a.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
