import { useState } from "react";
import { X, Clock } from "lucide-react";
import { c } from "@/lib/theme";
import { useCreateWorkOrder, getListWorkOrdersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

type Props = {
  building: number;
  unit?: string | null;
  onClose: () => void;
  onCreated?: () => void;
};

const CATEGORIES = ["Roof", "Plumbing", "HVAC", "Electrical", "Landscape", "Pest", "General"];

export function LogPastJobDialog({ building, unit, onClose, onCreated }: Props) {
  const qc = useQueryClient();
  const createMutation = useCreateWorkOrder();

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("General");
  const [completedOn, setCompletedOn] = useState("");
  const [actualCost, setActualCost] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    if (!title.trim()) { setError("Title is required"); return; }
    if (!completedOn || !/^\d{4}-\d{2}-\d{2}$/.test(completedOn)) {
      setError("Completed date is required (YYYY-MM-DD)");
      return;
    }
    setSubmitting(true);
    try {
      const cost = actualCost.trim() === "" ? null : Math.round(Number(actualCost) * 100);
      await createMutation.mutateAsync({
        data: {
          building,
          unit: unit ?? null,
          title: title.trim(),
          category,
          priority: "low",
          status: "done",
          historical: true,
          completedOn,
          actualCost: cost,
          historicalVendorName: vendorName.trim() || null,
          historicalNotes: notes.trim() || null,
        } as any,
      });
      await qc.invalidateQueries({ queryKey: getListWorkOrdersQueryKey({ building }) });
      onCreated?.();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to log past job");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-2xl shadow-xl p-6" style={{ background: c.panel }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5" style={{ color: c.cobalt }} />
            <h3 className="text-[16px]" style={{ fontWeight: 700 }}>Log past job</h3>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-[12.5px] mb-4" style={{ color: c.inkMute }}>
          Record completed work for the lifetime history. These entries are excluded from operational reports and KPIs.
        </p>
        <div className="space-y-3">
          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-[13px] bg-white"
              style={{ borderColor: c.border }} placeholder="e.g. Roof patch on west slope" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-[13px] bg-white"
                style={{ borderColor: c.border }}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Completed on">
              <input type="date" value={completedOn} onChange={(e) => setCompletedOn(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-[13px] bg-white"
                style={{ borderColor: c.border }} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Actual cost ($)">
              <input value={actualCost} onChange={(e) => setActualCost(e.target.value)}
                inputMode="decimal" placeholder="0.00"
                className="w-full rounded-md border px-3 py-2 text-[13px] bg-white"
                style={{ borderColor: c.border }} />
            </Field>
            <Field label="Vendor name">
              <input value={vendorName} onChange={(e) => setVendorName(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-md border px-3 py-2 text-[13px] bg-white"
                style={{ borderColor: c.border }} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              className="w-full rounded-md border px-3 py-2 text-[13px] bg-white"
              style={{ borderColor: c.border }} placeholder="Context, scope, follow-ups…" />
          </Field>
          {error && (
            <div className="rounded-md px-3 py-2 text-[12.5px]"
              style={{ background: c.roseSoft, color: c.rose }}>{error}</div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose}
            className="rounded-md border px-4 py-2 text-[13px] hover:bg-slate-50"
            style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}>Cancel</button>
          <button onClick={handleSubmit} disabled={submitting}
            className="rounded-md px-4 py-2 text-[13px] hover:opacity-90 disabled:opacity-60"
            style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
            {submitting ? "Logging…" : "Log past job"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11.5px] uppercase tracking-wider mb-1"
        style={{ color: c.inkSoft, fontWeight: 700 }}>{label}</label>
      {children}
    </div>
  );
}
