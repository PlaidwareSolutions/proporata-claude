import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Gavel, Plus, X, Calendar, Lock, ChevronRight } from "lucide-react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { bidsApi, BID_STATUS_LABELS, TRADE_CATEGORIES, type BidListItem } from "@/lib/bidsApi";
import { useListVendors, useListBuildings } from "@workspace/api-client-react";
import { InfoPopover } from "@/components/help/InfoPopover";

const LIST_KEY = ["bids-list"] as const;

export default function Bids() {
  const [filter, setFilter] = useState<string>("all");
  const qc = useQueryClient();
  const { data: bids = [], isLoading } = useQuery({
    queryKey: [...LIST_KEY, filter],
    queryFn: () => bidsApi.list(filter === "all" ? undefined : filter),
  });
  const [showNew, setShowNew] = useState(false);

  const counts = bids.reduce<Record<string, number>>((m, b) => {
    m[b.status] = (m[b.status] ?? 0) + 1; return m;
  }, {});
  const tabs = [
    { key: "all", label: "All" },
    { key: "draft", label: "Drafts" },
    { key: "open", label: "Open" },
    { key: "closed", label: "Closed" },
    { key: "awarded", label: "Awarded" },
  ];

  return (
    <Layout
      title="Bid Requests"
      subtitle="Solicit, compare, and award multi-vendor quotes"
      actions={
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] hover:opacity-90"
          style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
          data-testid="button-new-bid"
        >
          <Plus className="h-4 w-4" /> New Bid
        </button>
      }
    >
      <div className="flex gap-2 mb-4">
        {tabs.map((t) => {
          const active = filter === t.key;
          const n = t.key === "all" ? bids.length : counts[t.key] ?? 0;
          return (
            <button key={t.key} onClick={() => setFilter(t.key)}
              className="px-3 py-1.5 rounded-md text-[13px] border"
              style={{
                background: active ? c.cobalt : "#fff",
                color: active ? "#fff" : c.ink,
                borderColor: active ? c.cobalt : c.border,
                fontWeight: 600,
              }}>
              {t.label} <span style={{ opacity: 0.7 }}>({n})</span>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
        <div className="grid grid-cols-[60px_1fr_140px_120px_140px_120px_24px] items-center gap-3 px-4 py-2.5 border-b text-[11px] uppercase tracking-wider"
          style={{ borderColor: c.border, color: c.inkMute, fontWeight: 700 }}>
          <div>ID</div><div>Title</div>
          <div className="inline-flex items-center gap-0.5">Trade <InfoPopover termKey="trade" label="Trade" /></div>
          <div>Status</div><div>Deadline</div>
          <div className="inline-flex items-center gap-0.5">Quotes <InfoPopover termKey="quote" label="Quotes" /></div>
          <div></div>
        </div>
        {isLoading ? (
          <div className="p-8 text-center" style={{ color: c.inkMute }}>Loading…</div>
        ) : bids.length === 0 ? (
          <EmptyState onNew={() => setShowNew(true)} />
        ) : bids.map((b) => <BidRow key={b.id} bid={b} />)}
      </div>

      {showNew && (
        <NewBidModal onClose={() => setShowNew(false)} onCreated={() => {
          qc.invalidateQueries({ queryKey: LIST_KEY });
          setShowNew(false);
        }} />
      )}
    </Layout>
  );
}

function BidRow({ bid }: { bid: BidListItem }) {
  const s = BID_STATUS_LABELS[bid.status] ?? { label: bid.status, bg: "#EEF1F8", fg: "#5A6280" };
  const dl = new Date(bid.deadline);
  const overdue = bid.status === "open" && dl.getTime() < Date.now();
  return (
    <Link href={`/bids/${bid.id}`}>
      <a className="grid grid-cols-[60px_1fr_140px_120px_140px_120px_24px] items-center gap-3 px-4 py-3 border-b hover:bg-slate-50 cursor-pointer"
        style={{ borderColor: c.borderSoft }} data-testid={`bid-row-${bid.id}`}>
        <div className="font-mono-num text-[12px]" style={{ color: c.inkMute }}>BR-{bid.id}</div>
        <div className="min-w-0">
          <div className="text-[14px] truncate" style={{ fontWeight: 600 }}>
            {bid.sealedBids && <Lock className="inline h-3.5 w-3.5 mr-1" style={{ color: c.inkMute }} />}
            {bid.title}
          </div>
          <div className="text-[11.5px]" style={{ color: c.inkMute }}>
            {bid.buildingNum ? `Bldg ${bid.buildingNum} · ` : ""}{bid.createdByName}
          </div>
        </div>
        <div className="text-[12.5px]" style={{ color: c.ink }}>{bid.tradeCategory}</div>
        <div>
          <span className="rounded px-2 py-0.5 text-[11px]" style={{ background: s.bg, color: s.fg, fontWeight: 700 }}>
            {s.label}
          </span>
        </div>
        <div className="text-[12.5px]" style={{ color: overdue ? "#9A2A2A" : c.ink }}>
          <Calendar className="inline h-3 w-3 mr-1" />
          {bid.deadline.slice(0, 10)}
        </div>
        <div className="font-mono-num text-[12.5px]">
          {bid.submittedCount}/{bid.invitedCount}
        </div>
        <ChevronRight className="h-4 w-4" style={{ color: c.inkMute }} />
      </a>
    </Link>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="p-12 text-center">
      <Gavel className="mx-auto h-8 w-8 mb-2" style={{ color: c.inkMute, opacity: 0.5 }} />
      <p className="text-[14px] mb-3" style={{ color: c.inkMute }}>No bid requests yet.</p>
      <button onClick={onNew} className="rounded-md px-3 py-2 text-[13px]"
        style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
        Create your first bid
      </button>
    </div>
  );
}

function NewBidModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data: vendors = [] } = useListVendors();
  const { data: buildings = [] } = useListBuildings();
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [tradeCategory, setTradeCategory] = useState<string>("Roofing");
  const [buildingNum, setBuildingNum] = useState<string>("");
  const [deadline, setDeadline] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10);
  });
  const [sealed, setSealed] = useState(false);
  const [items, setItems] = useState<Array<{ label: string; notes: string }>>([{ label: "", notes: "" }]);
  const [vendorIds, setVendorIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const tradeVendors = vendors.filter((v) => !tradeCategory || v.tradeCategory === tradeCategory);

  const create = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Title is required");
      if (!deadline) throw new Error("Deadline is required");
      const cleanItems = items.filter((i) => i.label.trim()).map((i) => ({ label: i.label.trim(), notes: i.notes.trim() || null }));
      if (cleanItems.length === 0) throw new Error("Add at least one scope item");
      const created = await bidsApi.create({
        title: title.trim(),
        scope: scope.trim(),
        tradeCategory,
        buildingNum: buildingNum ? Number(buildingNum) : null,
        deadline: new Date(deadline).toISOString(),
        sealedBids: sealed,
        scopeItems: cleanItems,
      });
      if (vendorIds.length > 0) {
        await bidsApi.invite(created.id, vendorIds);
      }
      return created;
    },
    onError: (e: Error) => setError(e.message),
    onSuccess: () => onCreated(),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl border shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        style={{ borderColor: c.border }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: c.border }}>
          <h2 className="text-[18px]" style={{ fontWeight: 700 }}>New Bid Request</h2>
          <button onClick={onClose}><X className="h-5 w-5" style={{ color: c.inkMute }} /></button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-[12.5px] text-red-700">{error}</div>}
          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls()} data-testid="input-title" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Trade Category" termKey="trade">
              <select value={tradeCategory} onChange={(e) => setTradeCategory(e.target.value)} className={inputCls()}>
                {TRADE_CATEGORIES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Building (optional)">
              <select value={buildingNum} onChange={(e) => setBuildingNum(e.target.value)} className={inputCls()}>
                <option value="">— Common area / community-wide —</option>
                {buildings.map((b) => <option key={b.num} value={b.num}>Building {b.num}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Project Description">
            <textarea value={scope} onChange={(e) => setScope(e.target.value)} rows={3} className={inputCls()} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Deadline">
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputCls()} />
            </Field>
            <div className="flex flex-col justify-end pb-1.5">
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={sealed} onChange={(e) => setSealed(e.target.checked)} className="accent-blue-600" />
                <Lock className="h-3.5 w-3.5" /> Sealed bids (hide totals until close)
                <InfoPopover termKey="sealed-bid" label="Sealed bids" />
              </label>
            </div>
          </div>
          <div>
            <div className="text-[12px] mb-1 inline-flex items-center gap-0.5" style={{ color: c.inkMute, fontWeight: 600 }}>
              SCOPE ITEMS (LINE ITEMS VENDORS WILL PRICE)
              <InfoPopover termKey="scope-item" label="Scope items" />
            </div>
            {items.map((it, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input value={it.label} onChange={(e) => {
                  const next = [...items]; next[i] = { ...next[i]!, label: e.target.value }; setItems(next);
                }} placeholder={`Item ${i + 1} (e.g. "Tear-off existing shingles")`} className={inputCls()} />
                <input value={it.notes} onChange={(e) => {
                  const next = [...items]; next[i] = { ...next[i]!, notes: e.target.value }; setItems(next);
                }} placeholder="Notes (optional)" className={inputCls()} />
                <button onClick={() => setItems(items.filter((_, j) => j !== i))} className="px-2"><X className="h-4 w-4" /></button>
              </div>
            ))}
            <button onClick={() => setItems([...items, { label: "", notes: "" }])}
              className="text-[12.5px]" style={{ color: c.cobalt, fontWeight: 600 }}>+ Add scope item</button>
          </div>
          <div>
            <div className="text-[12px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>INVITE VENDORS ({tradeCategory})</div>
            <div className="border rounded-md max-h-48 overflow-y-auto" style={{ borderColor: c.border }}>
              {tradeVendors.length === 0 ? (
                <div className="p-3 text-[12.5px]" style={{ color: c.inkMute }}>No vendors in this trade — add some on the Vendors page.</div>
              ) : tradeVendors.map((v) => (
                <label key={v.id} className="flex items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" checked={vendorIds.includes(v.id)} onChange={(e) => {
                    setVendorIds(e.target.checked ? [...vendorIds, v.id] : vendorIds.filter((x) => x !== v.id));
                  }} className="accent-blue-600" />
                  <span style={{ fontWeight: 600 }}>{v.name}</span>
                  <span className="text-[11.5px]" style={{ color: c.inkMute }}>{v.email}</span>
                </label>
              ))}
            </div>
            <div className="text-[11.5px] mt-1" style={{ color: c.inkMute }}>
              The bid will be saved as a draft. Send it from the detail page to email vendors.
            </div>
          </div>
        </div>
        <div className="border-t flex justify-end gap-2 px-5 py-3" style={{ borderColor: c.border }}>
          <button onClick={onClose} className="px-3 py-1.5 rounded-md border text-[13px]" style={{ borderColor: c.border }}>Cancel</button>
          <button onClick={() => create.mutate()} disabled={create.isPending}
            className="px-3 py-1.5 rounded-md text-[13px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
            data-testid="button-create-bid">
            {create.isPending ? "Creating…" : "Create Draft"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, termKey }: { label: string; children: React.ReactNode; termKey?: string }) {
  return (
    <label className="block">
      <div className="text-[12px] mb-1 inline-flex items-center gap-0.5" style={{ color: c.inkMute, fontWeight: 600 }}>
        {label.toUpperCase()}
        {termKey ? <InfoPopover termKey={termKey} label={label} /> : null}
      </div>
      {children}
    </label>
  );
}
function inputCls() {
  return "w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:border-[var(--c-cobalt)]";
}
