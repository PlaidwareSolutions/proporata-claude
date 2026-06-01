import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { KeyRound, Plus, RotateCcw, X } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";

type Fob = {
  id: number; serial: string; label?: string; status: "available" | "assigned" | "lost" | "retired";
  notes?: string; currentAssignmentId?: number | null; currentUnitId?: string | null; currentHolderName?: string;
};

export default function FobInventory() {
  const qc = useQueryClient();
  const { data: fobs = [], isLoading } = useQuery<Fob[]>({
    queryKey: ["/fobs"],
    queryFn: () => apiFetch<Fob[]>({ url: "/fobs", method: "GET" }),
  });
  const [showNew, setShowNew] = useState(false);
  const [serial, setSerial] = useState(""); const [label, setLabel] = useState("");
  const [assignFob, setAssignFob] = useState<Fob | null>(null);
  const [assignUnit, setAssignUnit] = useState(""); const [assignHolder, setAssignHolder] = useState(""); const [assignDeposit, setAssignDeposit] = useState("");

  const create = useMutation({
    mutationFn: () => apiFetch({ url: "/fobs", method: "POST", data: { serial, label } }),
    onSuccess: () => { setSerial(""); setLabel(""); setShowNew(false); qc.invalidateQueries({ queryKey: ["/fobs"] }); },
  });
  const ret = useMutation({
    mutationFn: (id: number) => apiFetch({ url: `/fobs/${id}/return`, method: "POST", data: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/fobs"] }),
  });
  const assign = useMutation({
    mutationFn: () => apiFetch({ url: `/fobs/${assignFob!.id}/assign`, method: "POST", data: {
      unitId: assignUnit, holderName: assignHolder, depositCents: assignDeposit ? Math.round(parseFloat(assignDeposit) * 100) : 0,
    } }),
    onSuccess: () => { setAssignFob(null); setAssignUnit(""); setAssignHolder(""); setAssignDeposit(""); qc.invalidateQueries({ queryKey: ["/fobs"] }); },
  });

  return (
    <Layout title="Fob Inventory" subtitle="Track issued fobs and current holders.">
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <KeyRound size={26} style={{ color: c.cobalt }} />
            <div>
              <h1 className="text-2xl font-semibold">Fob / Key Inventory</h1>
              <p className="text-sm" style={{ color: c.inkMute }}>Track issued fobs, current holders, and deposits.</p>
            </div>
          </div>
          <button onClick={() => setShowNew(true)} className="px-4 py-2 rounded-lg text-white text-sm font-medium flex items-center gap-1" style={{ background: c.cobalt }}>
            <Plus size={16} /> Add Fob
          </button>
        </div>

        {isLoading ? <div className="text-sm" style={{ color: c.inkMute }}>Loading…</div> : (
          <div className="rounded-2xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
            <table className="w-full text-sm">
              <thead style={{ background: "#F6F8FA" }}>
                <tr style={{ color: c.inkMute }}>
                  <th className="text-left font-medium px-4 py-2">Serial</th>
                  <th className="text-left font-medium px-4 py-2">Label</th>
                  <th className="text-left font-medium px-4 py-2">Status</th>
                  <th className="text-left font-medium px-4 py-2">Holder</th>
                  <th className="text-left font-medium px-4 py-2">Unit</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {fobs.map((f) => (
                  <tr key={f.id} className="border-t" style={{ borderColor: c.border }}>
                    <td className="px-4 py-2 font-mono">{f.serial}</td>
                    <td className="px-4 py-2">{f.label || "—"}</td>
                    <td className="px-4 py-2"><span className="text-[11.5px] rounded-full px-2 py-0.5 font-semibold" style={{
                      color: f.status === "available" ? "#0E6F45" : f.status === "assigned" ? "#475569" : "#9A2542",
                      background: f.status === "available" ? "#DCF3EC" : f.status === "assigned" ? "#EEF2F7" : "#FCE5EC",
                    }}>{f.status}</span></td>
                    <td className="px-4 py-2">{f.currentHolderName || "—"}</td>
                    <td className="px-4 py-2">{f.currentUnitId || "—"}</td>
                    <td className="px-4 py-2 text-right">
                      {f.status === "available" && <button onClick={() => setAssignFob(f)} className="text-xs px-2 py-1 rounded border" style={{ borderColor: c.border }}>Assign</button>}
                      {f.status === "assigned" && <button onClick={() => ret.mutate(f.id)} className="text-xs px-2 py-1 rounded border flex items-center gap-1 ml-auto" style={{ borderColor: c.border }}><RotateCcw size={12}/>Return</button>}
                    </td>
                  </tr>
                ))}
                {fobs.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm" style={{ color: c.inkMute }}>No fobs yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {showNew && (
          <Modal onClose={() => setShowNew(false)} title="Add fob">
            <Field label="Serial number"><input value={serial} onChange={(e) => setSerial(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: c.border }} /></Field>
            <Field label="Label (optional)"><input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: c.border }} /></Field>
            <button onClick={() => create.mutate()} disabled={!serial.trim() || create.isPending} className="mt-3 px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ background: c.cobalt }}>Create</button>
          </Modal>
        )}

        {assignFob && (
          <Modal onClose={() => setAssignFob(null)} title={`Assign fob ${assignFob.serial}`}>
            <Field label="Unit ID"><input value={assignUnit} onChange={(e) => setAssignUnit(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: c.border }} /></Field>
            <Field label="Holder name"><input value={assignHolder} onChange={(e) => setAssignHolder(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: c.border }} /></Field>
            <Field label="Deposit (USD)"><input value={assignDeposit} onChange={(e) => setAssignDeposit(e.target.value)} placeholder="0.00" className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: c.border }} /></Field>
            <button onClick={() => assign.mutate()} disabled={!assignUnit.trim() || !assignHolder.trim() || assign.isPending} className="mt-3 px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ background: c.cobalt }}>Assign</button>
          </Modal>
        )}
      </div>
    </Layout>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-5 w-full max-w-md">
        <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1"><X size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="mb-3"><label className="text-sm font-medium block mb-1">{label}</label>{children}</div>;
}
