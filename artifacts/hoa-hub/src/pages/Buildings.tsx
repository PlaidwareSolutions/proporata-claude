import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { c, statusColor, statusLabel } from "@/lib/theme";
import { Search, ArrowUpDown, Plus, X } from "lucide-react";
import type { Status } from "@/lib/theme";
import {
  useListBuildings,
  useCreateBuilding,
  getListBuildingsQueryKey,
} from "@workspace/api-client-react";
import { InfoPopover } from "@/components/help/InfoPopover";
import type { CreateBuildingBody } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const EMPTY_FORM: Omit<CreateBuildingBody, "num"> & { num: string } = {
  num: "",
  address: "",
  street: "",
  units: 0,
  yearBuilt: new Date().getFullYear(),
  roofYear: new Date().getFullYear(),
  status: "good",
  insuranceStatus: "current",
  notes: "",
};

export default function Buildings() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Status | "all">("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");

  const queryClient = useQueryClient();
  const { data: buildings = [], isLoading } = useListBuildings();
  const createMutation = useCreateBuilding();

  const filtered = useMemo(() => {
    return buildings.filter((b) => {
      if (filter !== "all" && b.status !== filter) return false;
      if (q) {
        const s = q.toLowerCase();
        return (
          b.address.toLowerCase().includes(s) ||
          b.street.toLowerCase().includes(s) ||
          String(b.num).includes(s)
        );
      }
      return true;
    });
  }, [q, filter, buildings]);

  function openForm() {
    setForm(EMPTY_FORM);
    setFormError("");
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setFormError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    const num = parseInt(form.num, 10);
    if (!num || num <= 0) {
      setFormError("Building number must be a positive integer.");
      return;
    }
    if (!form.address.trim()) {
      setFormError("Address is required.");
      return;
    }
    if (!form.street.trim()) {
      setFormError("Street is required.");
      return;
    }
    try {
      await createMutation.mutateAsync({
        data: {
          num,
          address: form.address.trim(),
          street: form.street.trim(),
          units: Number(form.units) || 0,
          yearBuilt: Number(form.yearBuilt),
          roofYear: Number(form.roofYear),
          status: form.status as CreateBuildingBody["status"],
          insuranceStatus: form.insuranceStatus as CreateBuildingBody["insuranceStatus"],
          notes: form.notes?.trim() || undefined,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListBuildingsQueryKey() });
      closeForm();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create building.";
      setFormError(message);
    }
  }

  return (
    <Layout title="Buildings" subtitle={`${buildings.length} buildings · ${buildings.reduce((s, b) => s + b.units, 0)} units`}>
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: c.inkMute }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search building, address, or street…"
            data-testid="input-buildings-search"
            className="w-full rounded-md border pl-9 pr-3 py-2 text-[13.5px] outline-none focus:ring-2"
            style={{ borderColor: c.border, background: c.panel, color: c.ink }}
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border p-1" style={{ borderColor: c.border, background: c.panel }}>
          {(["all", "good", "watch", "urgent"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              data-testid={`filter-${f}`}
              className="rounded px-3 py-1.5 text-[12.5px] transition-colors"
              style={
                filter === f
                  ? { background: c.cobalt, color: "#fff", fontWeight: 600 }
                  : { color: c.inkSoft, fontWeight: 500 }
              }
            >
              {f === "all" ? "All" : statusLabel[f]}
            </button>
          ))}
        </div>
        <span className="text-[12.5px] font-mono-num" style={{ color: c.inkMute, fontWeight: 600 }}>
          {filtered.length} shown
        </span>
        <button
          onClick={openForm}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] hover:opacity-90 transition-opacity"
          style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
        >
          <Plus className="h-4 w-4" /> Add Building
        </button>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
        {isLoading ? (
          <div className="py-16 text-center text-[13px]" style={{ color: c.inkMute }}>Loading buildings…</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead style={{ background: c.canvas }}>
              <tr style={{ color: c.inkMute }} className="text-left text-[11px] uppercase tracking-wider">
                {([
                  ["#", undefined],
                  ["Address", undefined],
                  ["Street", undefined],
                  ["Units", "unit"],
                  ["Year", undefined],
                  ["Roof", "roof-age"],
                  ["Open WO", "work-order"],
                  ["Insurance", "insurance-gap"],
                  ["Status", undefined],
                ] as Array<[string, string | undefined]>).map(([h, termKey]) => (
                  <th key={h} className="px-4 py-3" style={{ fontWeight: 700 }}>
                    <span className="inline-flex items-center gap-1">
                      {h} {h !== "Status" && <ArrowUpDown className="h-3 w-3 opacity-40" />}
                      {termKey ? <InfoPopover termKey={termKey} label={h} /> : null}
                    </span>
                  </th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr
                  key={b.num}
                  className="border-t hover:bg-slate-50 cursor-pointer"
                  style={{ borderColor: c.borderSoft }}
                  data-testid={`row-bldg-${b.num}`}
                >
                  <td className="px-4 py-3 font-mono-num" style={{ fontWeight: 700, color: c.ink }}>
                    {String(b.num).padStart(2, "0")}
                  </td>
                  <td className="px-4 py-3" style={{ fontWeight: 600, color: c.ink }}>{b.address}</td>
                  <td className="px-4 py-3" style={{ color: c.inkSoft }}>{b.street}</td>
                  <td className="px-4 py-3 font-mono-num" style={{ color: c.inkSoft }}>{b.units}</td>
                  <td className="px-4 py-3 font-mono-num" style={{ color: c.inkSoft }}>{b.yearBuilt}</td>
                  <td className="px-4 py-3 font-mono-num" style={{ color: 2026 - b.roofYear >= 12 ? c.amber : c.inkSoft, fontWeight: 2026 - b.roofYear >= 12 ? 700 : 500 }}>
                    {b.roofYear}
                  </td>
                  <td className="px-4 py-3 font-mono-num" style={{ color: b.openWO > 0 ? c.cobalt : c.inkMute, fontWeight: b.openWO > 0 ? 700 : 500 }}>
                    {b.openWO}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px]"
                      style={{
                        background: b.insuranceStatus === "current" ? c.emeraldSoft : b.insuranceStatus === "expiring" ? c.amberSoft : c.roseSoft,
                        color: b.insuranceStatus === "current" ? c.emerald : b.insuranceStatus === "expiring" ? c.amber : c.rose,
                        fontWeight: 700,
                      }}
                    >
                      {b.insuranceStatus.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: statusColor[b.status as Status] }} />
                      <span style={{ color: statusColor[b.status as Status], fontWeight: 600 }}>{statusLabel[b.status as Status]}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/buildings/${b.num}`}
                      className="rounded px-2 py-1 text-[12px] hover:opacity-80 transition-opacity"
                      style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 600 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="w-full max-w-lg rounded-2xl shadow-xl p-6" style={{ background: c.panel }}>
            <div className="flex items-center justify-between mb-5">
              <div className="text-[17px]" style={{ fontWeight: 700 }}>Add Building</div>
              <button onClick={closeForm} className="rounded-full p-1 hover:bg-slate-100">
                <X className="h-5 w-5" style={{ color: c.inkMute }} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Building #</label>
                  <input
                    type="number"
                    value={form.num}
                    onChange={(e) => setForm({ ...form, num: e.target.value })}
                    placeholder="e.g. 10"
                    required
                    className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Street</label>
                  <input
                    value={form.street}
                    onChange={(e) => setForm({ ...form, street: e.target.value })}
                    placeholder="e.g. Oak Lane"
                    required
                    className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
              </div>
              <div>
                <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Address</label>
                <input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="e.g. 400 Oak Lane"
                  required
                  className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                  style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Units</label>
                  <input
                    type="number"
                    min={0}
                    value={form.units}
                    onChange={(e) => setForm({ ...form, units: parseInt(e.target.value) || 0 })}
                    className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Year Built</label>
                  <input
                    type="number"
                    value={form.yearBuilt}
                    onChange={(e) => setForm({ ...form, yearBuilt: parseInt(e.target.value) || new Date().getFullYear() })}
                    className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Roof Year</label>
                  <input
                    type="number"
                    value={form.roofYear}
                    onChange={(e) => setForm({ ...form, roofYear: parseInt(e.target.value) || new Date().getFullYear() })}
                    className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as typeof form.status })}
                    className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                  >
                    <option value="good">Good</option>
                    <option value="watch">Watch</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Insurance</label>
                  <select
                    value={form.insuranceStatus}
                    onChange={(e) => setForm({ ...form, insuranceStatus: e.target.value as typeof form.insuranceStatus })}
                    className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                  >
                    <option value="current">Current</option>
                    <option value="expiring">Expiring</option>
                    <option value="missing">Missing</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Notes (optional)</label>
                <textarea
                  value={form.notes ?? ""}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  placeholder="Any notes or issues…"
                  className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2 resize-none"
                  style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                />
              </div>
              {formError && (
                <div className="rounded-md px-3 py-2 text-[12.5px]" style={{ background: c.roseSoft, color: c.rose }}>
                  {formError}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded-md border px-4 py-2 text-[13px] hover:bg-slate-50 transition-colors"
                  style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="rounded-md px-4 py-2 text-[13px] hover:opacity-90 transition-opacity disabled:opacity-60"
                  style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                >
                  {createMutation.isPending ? "Saving…" : "Add Building"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
