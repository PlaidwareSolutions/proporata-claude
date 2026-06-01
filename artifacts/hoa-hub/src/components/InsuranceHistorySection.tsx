import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListInsurancePolicyHistory,
  useCreateInsurancePolicyHistory,
  useListInsurancePolicyHistoryDocuments,
  useLinkInsurancePolicyHistoryDocument,
  useListDocuments,
  getListInsurancePolicyHistoryQueryKey,
  getListInsurancePolicyHistoryDocumentsQueryKey,
} from "@workspace/api-client-react";
import type {
  CreateInsurancePolicyHistoryBody,
  InsurancePolicyHistory,
} from "@workspace/api-client-react";
import { c } from "@/lib/theme";
import { Clock, Plus, FileText, Link2 } from "lucide-react";

const REASONS = ["renewal", "carrier_change", "manual_backfill", "other"] as const;
const DOC_KINDS = ["declaration", "coi", "renewal", "claim", "other"];

export function InsuranceHistorySection({ building, canEdit = false }: { building: number; canEdit?: boolean }) {
  const queryClient = useQueryClient();
  const { data: history = [], isLoading } = useListInsurancePolicyHistory(building, {
    query: { queryKey: getListInsurancePolicyHistoryQueryKey(building) },
  });
  const createMutation = useCreateInsurancePolicyHistory();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Partial<CreateInsurancePolicyHistoryBody>>({});
  const [openId, setOpenId] = useState<number | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.carrier || !form.policyNo || !form.effectiveFrom || !form.effectiveTo) return;
    await createMutation.mutateAsync({
      id: building,
      data: {
        carrier: form.carrier,
        policyNo: form.policyNo,
        coverage: Number(form.coverage ?? 0),
        premium: Number(form.premium ?? 0),
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo,
        endedReason: form.endedReason ?? null,
        notes: form.notes ?? null,
      },
    });
    await queryClient.invalidateQueries({ queryKey: getListInsurancePolicyHistoryQueryKey(building) });
    setForm({});
    setShowForm(false);
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: c.panel, borderColor: c.border }}>
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: c.border }}>
        <div>
          <div className="text-[15px] flex items-center gap-2" style={{ fontWeight: 700 }}>
            <Clock className="h-4 w-4" style={{ color: c.inkMute }} /> Insurance history
          </div>
          <div className="text-[12.5px] mt-0.5" style={{ color: c.inkMute }}>
            Previous policies — auto-rolled when the current policy is replaced. Click a row to attach declarations, COIs, renewals, or claim files.
          </div>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowForm((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] hover:bg-slate-50"
            style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 600 }}
          >
            <Plus className="h-3.5 w-3.5" /> {showForm ? "Cancel" : "Backfill"}
          </button>
        )}
      </div>

      {showForm && canEdit && (
        <form onSubmit={handleAdd} className="px-5 py-4 border-b grid grid-cols-3 gap-3" style={{ borderColor: c.borderSoft, background: c.canvas }}>
          <Field label="Carrier *" value={form.carrier ?? ""} onChange={(v) => setForm({ ...form, carrier: v })} required />
          <Field label="Policy # *" value={form.policyNo ?? ""} onChange={(v) => setForm({ ...form, policyNo: v })} required />
          <Field label="Coverage ($)" type="number" value={String(form.coverage ?? "")} onChange={(v) => setForm({ ...form, coverage: Number(v) })} />
          <Field label="Premium ($)" type="number" value={String(form.premium ?? "")} onChange={(v) => setForm({ ...form, premium: Number(v) })} />
          <Field label="Effective from *" type="date" value={form.effectiveFrom ?? ""} onChange={(v) => setForm({ ...form, effectiveFrom: v })} required />
          <Field label="Effective to *" type="date" value={form.effectiveTo ?? ""} onChange={(v) => setForm({ ...form, effectiveTo: v })} required />
          <label className="block">
            <div className="text-[11.5px] mb-1 font-semibold uppercase tracking-wider" style={{ color: c.inkMute }}>Reason</div>
            <select value={form.endedReason ?? ""} onChange={(e) => setForm({ ...form, endedReason: e.target.value || null })} className="w-full rounded border px-2 py-1.5 text-[12.5px]" style={{ borderColor: c.border, background: c.panel }}>
              <option value="">—</option>
              {REASONS.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
            </select>
          </label>
          <div className="col-span-3 flex justify-end">
            <button type="submit" disabled={createMutation.isPending} className="rounded-md px-4 py-1.5 text-[13px] disabled:opacity-60" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
              {createMutation.isPending ? "Saving…" : "Save history entry"}
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="py-10 text-center text-[13px]" style={{ color: c.inkMute }}>Loading…</div>
      ) : history.length === 0 ? (
        <div className="py-10 text-center text-[13px]" style={{ color: c.inkMute }}>No previous policies on file.</div>
      ) : (
        <ul className="divide-y" style={{ borderColor: c.borderSoft }}>
          {history.map((h: InsurancePolicyHistory) => {
            const isOpen = openId === h.id;
            return (
              <li key={h.id}>
                <div className="px-5 py-3 flex items-center gap-4 text-[13px] cursor-pointer hover:bg-slate-50" onClick={() => setOpenId(isOpen ? null : h.id)}>
                  <div className="font-mono-num text-[12.5px]" style={{ color: c.inkMute, minWidth: 200 }}>
                    {h.effectiveFrom} → {h.effectiveTo}
                  </div>
                  <div style={{ color: c.ink, fontWeight: 600, minWidth: 160 }}>{h.carrier}</div>
                  <div className="font-mono-num" style={{ color: c.inkSoft }}>{h.policyNo}</div>
                  <div className="font-mono-num" style={{ color: c.inkSoft }}>${h.coverage.toLocaleString()}</div>
                  <div className="font-mono-num" style={{ color: c.inkMute }}>premium ${h.premium.toLocaleString()}</div>
                  {h.endedReason && (
                    <span className="ml-auto rounded-full px-2 py-0.5 text-[11px]" style={{ background: c.canvas, color: c.inkMute, fontWeight: 700 }}>
                      {h.endedReason.replace("_", " ").toUpperCase()}
                    </span>
                  )}
                  <span className="text-[11.5px]" style={{ color: c.cobalt, fontWeight: 600 }}>{isOpen ? "Hide files" : "Files"}</span>
                </div>
                {isOpen && (
                  <div className="px-5 pb-3" style={{ background: c.canvas }}>
                    <HistoryDocuments historyId={h.id} canEdit={canEdit} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function HistoryDocuments({ historyId, canEdit }: { historyId: number; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { data: links = [] } = useListInsurancePolicyHistoryDocuments(historyId, {
    query: { queryKey: getListInsurancePolicyHistoryDocumentsQueryKey(historyId) },
  });
  const { data: allDocs = [] } = useListDocuments();
  const linkMutation = useLinkInsurancePolicyHistoryDocument();
  const [docId, setDocId] = useState("");
  const [kind, setKind] = useState("declaration");

  async function attach(e: React.FormEvent) {
    e.preventDefault();
    if (!docId) return;
    await linkMutation.mutateAsync({ historyId, data: { documentId: docId, kind } });
    await queryClient.invalidateQueries({ queryKey: getListInsurancePolicyHistoryDocumentsQueryKey(historyId) });
    setDocId("");
  }

  return (
    <div className="space-y-2 pt-2">
      <div className="text-[11.5px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>
        <FileText className="h-3.5 w-3.5 inline mr-1" /> Linked files
      </div>
      {links.length === 0 ? (
        <div className="text-[12.5px]" style={{ color: c.inkMute }}>No files linked.</div>
      ) : (
        <ul className="space-y-1">
          {links.map((l) => (
            <li key={l.linkId} className="text-[12.5px] flex gap-3" style={{ color: c.inkSoft }}>
              <span className="rounded-full px-1.5 py-0.5 text-[10.5px] uppercase" style={{ background: c.cobalt + "1F", color: c.cobalt, fontWeight: 700 }}>{l.kind}</span>
              <span style={{ color: c.ink, fontWeight: 600 }}>{l.name ?? l.documentId}</span>
              {l.uploaded && <span className="font-mono-num" style={{ color: c.inkMute }}>{l.uploaded.slice(0,10)}</span>}
              <Link href="/documents" className="ml-auto text-[12px]" style={{ color: c.cobalt }}>Open</Link>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={attach} className="grid grid-cols-4 gap-2 pt-1">
          <select value={docId} onChange={(e) => setDocId(e.target.value)} className="rounded border px-2 py-1 text-[12.5px] col-span-2" style={{ borderColor: c.border }}>
            <option value="">— Select document —</option>
            {allDocs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded border px-2 py-1 text-[12.5px]" style={{ borderColor: c.border }}>
            {DOC_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button type="submit" disabled={linkMutation.isPending || !docId} className="rounded text-[12.5px] disabled:opacity-60" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
            <Link2 className="h-3.5 w-3.5 inline mr-1" /> Attach
          </button>
        </form>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <label className="block">
      <div className="text-[11.5px] mb-1 font-semibold uppercase tracking-wider" style={{ color: c.inkMute }}>{label}</div>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} className="w-full rounded border px-2 py-1.5 text-[12.5px]" style={{ borderColor: c.border, background: c.panel }} />
    </label>
  );
}
