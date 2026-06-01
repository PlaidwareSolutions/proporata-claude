import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { Tag, Plus, Pause, Play, X } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";

type PoolTag = { id: number; unitId: string; tagNumber: string; holderName?: string; status: "active"|"suspended"|"lost"|"retired"; suspendedReason?: string; suspendedAt?: string | null; issuedAt: string };

export default function PoolTagsAdmin() {
  const qc = useQueryClient();
  const { data: tags = [], isLoading } = useQuery<PoolTag[]>({
    queryKey: ["/pool-tags"],
    queryFn: () => apiFetch<PoolTag[]>({ url: "/pool-tags", method: "GET" }),
  });
  const [showNew, setShowNew] = useState(false);
  const [unitId, setUnitId] = useState(""); const [tagNumber, setTagNumber] = useState(""); const [holderName, setHolderName] = useState("");

  const create = useMutation({
    mutationFn: () => apiFetch({ url: "/pool-tags", method: "POST", data: { unitId, tagNumber, holderName } }),
    onSuccess: () => { setShowNew(false); setUnitId(""); setTagNumber(""); setHolderName(""); qc.invalidateQueries({ queryKey: ["/pool-tags"] }); },
  });
  const suspend = useMutation({
    mutationFn: (id: number) => apiFetch({ url: `/pool-tags/${id}/suspend`, method: "POST", data: { reason: "manual" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/pool-tags"] }),
  });
  const restore = useMutation({
    mutationFn: (id: number) => apiFetch({ url: `/pool-tags/${id}/restore`, method: "POST", data: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/pool-tags"] }),
  });

  return (
    <Layout title="Pool Tags" subtitle="Pool tag issuance and delinquency suspensions.">
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Tag size={26} style={{ color: c.cobalt }} />
            <div><h1 className="text-2xl font-semibold">Pool Tags</h1>
              <p className="text-sm" style={{ color: c.inkMute }}>Tags auto-suspend when a unit is past-due 30+ days; restore when cured.</p></div>
          </div>
          <button onClick={() => setShowNew(true)} className="px-4 py-2 rounded-lg text-white text-sm font-medium flex items-center gap-1" style={{ background: c.cobalt }}>
            <Plus size={16} /> Issue Tag
          </button>
        </div>
        {isLoading ? <div className="text-sm" style={{ color: c.inkMute }}>Loading…</div> : (
          <div className="rounded-2xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
            <table className="w-full text-sm">
              <thead style={{ background: "#F6F8FA" }}>
                <tr style={{ color: c.inkMute }}>
                  <th className="text-left font-medium px-4 py-2">Tag</th>
                  <th className="text-left font-medium px-4 py-2">Unit</th>
                  <th className="text-left font-medium px-4 py-2">Holder</th>
                  <th className="text-left font-medium px-4 py-2">Status</th>
                  <th className="text-left font-medium px-4 py-2">Reason</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {tags.map((t) => (
                  <tr key={t.id} className="border-t" style={{ borderColor: c.border }}>
                    <td className="px-4 py-2 font-mono">{t.tagNumber}</td>
                    <td className="px-4 py-2">{t.unitId}</td>
                    <td className="px-4 py-2">{t.holderName || "—"}</td>
                    <td className="px-4 py-2"><span className="text-[11.5px] rounded-full px-2 py-0.5 font-semibold" style={{
                      color: t.status === "active" ? "#0E6F45" : "#9A2542",
                      background: t.status === "active" ? "#DCF3EC" : "#FCE5EC",
                    }}>{t.status}</span></td>
                    <td className="px-4 py-2 text-xs" style={{ color: c.inkMute }}>{t.suspendedReason || "—"}</td>
                    <td className="px-4 py-2 text-right">
                      {t.status === "active" ? (
                        <button onClick={() => suspend.mutate(t.id)} className="text-xs px-2 py-1 rounded border flex items-center gap-1 ml-auto" style={{ borderColor: c.border }}><Pause size={12}/>Suspend</button>
                      ) : (
                        <button onClick={() => restore.mutate(t.id)} className="text-xs px-2 py-1 rounded border flex items-center gap-1 ml-auto" style={{ borderColor: c.border }}><Play size={12}/>Restore</button>
                      )}
                    </td>
                  </tr>
                ))}
                {tags.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm" style={{ color: c.inkMute }}>No pool tags issued.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {showNew && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl p-5 w-full max-w-md">
              <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">Issue pool tag</h3>
                <button onClick={() => setShowNew(false)} className="p-1"><X size={18} /></button></div>
              <Field label="Unit ID"><input value={unitId} onChange={(e) => setUnitId(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: c.border }} /></Field>
              <Field label="Tag number"><input value={tagNumber} onChange={(e) => setTagNumber(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: c.border }} /></Field>
              <Field label="Holder name"><input value={holderName} onChange={(e) => setHolderName(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: c.border }} /></Field>
              <button onClick={() => create.mutate()} disabled={!unitId.trim() || !tagNumber.trim() || create.isPending} className="mt-3 px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ background: c.cobalt }}>Issue</button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="mb-3"><label className="text-sm font-medium block mb-1">{label}</label>{children}</div>;
}
