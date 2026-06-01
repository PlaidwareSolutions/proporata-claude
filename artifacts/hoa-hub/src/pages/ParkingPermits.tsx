import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { Car, Loader2, Plus, Printer, X, ExternalLink } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { useAuth } from "@/contexts/AuthContext";

type Permit = {
  id: number;
  unitId: string;
  ownerUserId: number;
  ownerName?: string | null;
  permitNumber: string;
  startsOn: string;
  endsOn: string;
  nights: number;
  guestName: string;
  plate: string;
  plateState: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleColor: string;
  vehicleDesc: string;
  notes: string;
  status: "active" | "cancelled" | "expired";
  qrToken: string;
  cancelledAt: string | null;
  cancellationReason: string;
  createdAt: string;
};

type Settings = {
  perUnitNightlyCap: number;
  rollingWindowDays: number;
  maxConsecutiveNights: number;
  maxAdvanceDays: number;
  agreementText: string;
  excludeRegisteredVehicles: boolean;
  requireAccountCurrent: boolean;
  requireNoOpenViolations: boolean;
};

type Issue = { code: string; message: string };

type EligibilityPreview = {
  ok: boolean;
  issues: Issue[];
  settings: Settings;
  used: number;
  remaining: number;
};

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};

export default function ParkingPermits() {
  const { user } = useAuth();
  const isManager = user?.role === "admin" || user?.role === "manager";

  const [permits, setPermits] = useState<Permit[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);

  const [draft, setDraft] = useState({
    startsOn: today(),
    endsOn: today(),
    plate: "",
    plateState: "",
    vehicleMake: "",
    vehicleModel: "",
    vehicleColor: "",
    guestName: "",
    notes: "",
    agreementSignedName: "",
  });
  const [preview, setPreview] = useState<EligibilityPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "expired" | "cancelled">("all");

  useEffect(() => { void load(); }, [isManager, statusFilter]);

  async function load() {
    setLoading(true);
    try {
      const url = isManager
        ? `/guest-parking/permits${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`
        : `/guest-parking/permits/me`;
      const data = await apiFetch<Permit[]>({ url, method: "GET" });
      setPermits(data);
    } finally { setLoading(false); }
  }

  // Live eligibility preview as the user edits dates / plate.
  useEffect(() => {
    let cancelled = false;
    if (!showNew || !draft.startsOn || !draft.endsOn || !draft.plate) { setPreview(null); return; }
    setPreviewLoading(true);
    const t = setTimeout(async () => {
      try {
        const data = await apiFetch<EligibilityPreview>({
          url: `/guest-parking/eligibility-preview`,
          method: "POST",
          data: { startsOn: draft.startsOn, endsOn: draft.endsOn, plate: draft.plate },
        });
        if (!cancelled) { setPreview(data); setSettings(data.settings); }
      } catch { /* ignore */ }
      finally { if (!cancelled) setPreviewLoading(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [showNew, draft.startsOn, draft.endsOn, draft.plate]);

  async function submitNew() {
    setSubmitError(null);
    setCreating(true);
    try {
      await apiFetch<Permit>({
        url: "/guest-parking/permits",
        method: "POST",
        data: {
          ...draft,
          plate: draft.plate.toUpperCase(),
          plateState: draft.plateState.toUpperCase(),
        },
      });
      setShowNew(false);
      setDraft({ startsOn: today(), endsOn: today(), plate: "", plateState: "", vehicleMake: "", vehicleModel: "", vehicleColor: "", guestName: "", notes: "", agreementSignedName: "" });
      setPreview(null);
      await load();
    } catch (err: unknown) {
      const e = err as { data?: { error?: string; issues?: Issue[] }; message?: string };
      const issues = e.data?.issues?.map((i) => i.message).join(" • ");
      setSubmitError(issues ?? e.data?.error ?? e.message ?? "Failed to create permit");
    } finally { setCreating(false); }
  }

  async function cancelPermit(p: Permit) {
    const reason = window.prompt(`Cancel permit ${p.permitNumber}? Optional reason:`);
    if (reason === null) return;
    await apiFetch({ url: `/guest-parking/permits/${p.id}/cancel`, method: "POST", data: { reason } });
    await load();
  }

  const reqNights = useMemo(() => {
    if (!draft.startsOn || !draft.endsOn) return 0;
    const ms = new Date(`${draft.endsOn}T00:00:00Z`).getTime() - new Date(`${draft.startsOn}T00:00:00Z`).getTime();
    return Math.max(1, Math.round(ms / 86400000) + 1);
  }, [draft.startsOn, draft.endsOn]);

  return (
    <Layout title="Guest Parking" subtitle="Permits for visitor vehicles">
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6 gap-4">
          <div className="flex items-center gap-3">
            <Car size={26} style={{ color: c.cobalt }} />
            <div>
              <h1 className="text-2xl font-semibold">Guest Parking Permits</h1>
              <p className="text-sm" style={{ color: c.inkMute }}>
                {isManager
                  ? "All guest-parking permits across the property."
                  : "Issue and manage parking permits for your visitors."}
              </p>
            </div>
          </div>
          {!isManager && (
            <button
              onClick={() => { setShowNew(true); setSubmitError(null); }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium"
              style={{ background: c.cobalt }}
              data-testid="new-permit"
            >
              <Plus size={16} /> Request permit
            </button>
          )}
        </div>

        {isManager && (
          <div className="mb-4 flex gap-2 text-sm">
            {(["all", "active", "expired", "cancelled"] as const).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg border ${statusFilter === s ? "font-semibold" : ""}`}
                style={{ borderColor: c.border, background: statusFilter === s ? "#EEF1FF" : "white" }}>
                {s}
              </button>
            ))}
            <a className="ml-auto text-sm underline" href="/api/guest-parking/towable.csv" target="_blank" rel="noreferrer">Export towable CSV</a>
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border bg-white p-8 text-center" style={{ borderColor: c.border }}>
            <Loader2 className="animate-spin inline" size={20} />
          </div>
        ) : permits.length === 0 ? (
          <div className="rounded-2xl border bg-white p-8 text-center text-sm" style={{ borderColor: c.border, color: c.inkMute }}>
            No permits yet.
          </div>
        ) : (
          <div className="rounded-2xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
            <table className="w-full text-sm">
              <thead style={{ background: "#F7F8FA", color: c.inkMute }}>
                <tr>
                  <th className="text-left font-medium p-3">Permit #</th>
                  <th className="text-left font-medium p-3">Plate</th>
                  <th className="text-left font-medium p-3">Vehicle</th>
                  {isManager && <th className="text-left font-medium p-3">Unit</th>}
                  <th className="text-left font-medium p-3">Dates</th>
                  <th className="text-left font-medium p-3">Status</th>
                  <th className="text-right font-medium p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {permits.map((p) => (
                  <tr key={p.id} className="border-t" style={{ borderColor: c.border }}>
                    <td className="p-3 font-mono text-xs">{p.permitNumber}</td>
                    <td className="p-3 font-mono">{p.plate}{p.plateState ? ` (${p.plateState})` : ""}</td>
                    <td className="p-3">{[p.vehicleColor, p.vehicleMake, p.vehicleModel].filter(Boolean).join(" ") || "—"}</td>
                    {isManager && <td className="p-3">{p.unitId}</td>}
                    <td className="p-3">{p.startsOn} → {p.endsOn} <span style={{ color: c.inkMute }}>({p.nights}n)</span></td>
                    <td className="p-3"><StatusPill v={p.status} /></td>
                    <td className="p-3 text-right space-x-2">
                      <a className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border" style={{ borderColor: c.border }}
                         href={`/api/guest-parking/permits/${p.id}/permit.html`} target="_blank" rel="noreferrer">
                        <Printer size={12} /> Print
                      </a>
                      <a className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border" style={{ borderColor: c.border }}
                         href={`/permit/${p.qrToken}`} target="_blank" rel="noreferrer">
                        <ExternalLink size={12} /> Pass
                      </a>
                      {p.status === "active" && (
                        <button onClick={() => cancelPermit(p)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border" style={{ borderColor: c.border, color: "#9A2542" }}>
                          <X size={12} /> Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && (
        <Modal onClose={() => setShowNew(false)} title="Request guest parking permit">
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First night">
                <input type="date" value={draft.startsOn} min={today()}
                  onChange={(e) => setDraft({ ...draft, startsOn: e.target.value, endsOn: draft.endsOn < e.target.value ? e.target.value : draft.endsOn })}
                  className="w-full rounded-lg border px-3 py-2" style={{ borderColor: c.border }} />
              </Field>
              <Field label="Last night">
                <input type="date" value={draft.endsOn} min={draft.startsOn}
                  onChange={(e) => setDraft({ ...draft, endsOn: e.target.value })}
                  className="w-full rounded-lg border px-3 py-2" style={{ borderColor: c.border }} />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Plate" hint="required">
                <input value={draft.plate} onChange={(e) => setDraft({ ...draft, plate: e.target.value.toUpperCase() })}
                  className="w-full rounded-lg border px-3 py-2 font-mono" style={{ borderColor: c.border }} />
              </Field>
              <Field label="State">
                <input value={draft.plateState} onChange={(e) => setDraft({ ...draft, plateState: e.target.value.toUpperCase().slice(0, 3) })}
                  className="w-full rounded-lg border px-3 py-2 font-mono" style={{ borderColor: c.border }} placeholder="CA" />
              </Field>
              <Field label="Color">
                <input value={draft.vehicleColor} onChange={(e) => setDraft({ ...draft, vehicleColor: e.target.value })}
                  className="w-full rounded-lg border px-3 py-2" style={{ borderColor: c.border }} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Make"><input value={draft.vehicleMake} onChange={(e) => setDraft({ ...draft, vehicleMake: e.target.value })} className="w-full rounded-lg border px-3 py-2" style={{ borderColor: c.border }} /></Field>
              <Field label="Model"><input value={draft.vehicleModel} onChange={(e) => setDraft({ ...draft, vehicleModel: e.target.value })} className="w-full rounded-lg border px-3 py-2" style={{ borderColor: c.border }} /></Field>
            </div>
            <Field label="Guest name">
              <input value={draft.guestName} onChange={(e) => setDraft({ ...draft, guestName: e.target.value })} className="w-full rounded-lg border px-3 py-2" style={{ borderColor: c.border }} />
            </Field>
            <Field label="Notes (optional)">
              <input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className="w-full rounded-lg border px-3 py-2" style={{ borderColor: c.border }} />
            </Field>

            {(preview || previewLoading) && (
              <div className="rounded-lg border p-3" style={{ borderColor: c.border, background: preview && preview.ok ? "#DCF3EC" : preview ? "#FCE5EC" : "#F7F8FA" }}>
                {previewLoading ? <span className="text-xs">Checking eligibility…</span> : preview && (
                  <>
                    <div className="text-xs font-medium mb-1">
                      {preview.ok
                        ? `OK · ${reqNights} night${reqNights === 1 ? "" : "s"} · ${preview.remaining} remaining of ${preview.settings.perUnitNightlyCap}`
                        : `${preview.issues.length} issue${preview.issues.length === 1 ? "" : "s"}`}
                    </div>
                    {!preview.ok && (
                      <ul className="text-xs list-disc pl-5 space-y-0.5">
                        {preview.issues.map((i, idx) => <li key={idx}>{i.message}</li>)}
                      </ul>
                    )}
                  </>
                )}
              </div>
            )}

            {settings && (
              <details className="rounded-lg border p-3 text-xs" style={{ borderColor: c.border }}>
                <summary className="cursor-pointer font-medium">Permit agreement (required)</summary>
                <p className="mt-2 whitespace-pre-line" style={{ color: c.inkMute }}>{settings.agreementText}</p>
              </details>
            )}
            <Field label="Type your full name to sign the agreement">
              <input value={draft.agreementSignedName} onChange={(e) => setDraft({ ...draft, agreementSignedName: e.target.value })}
                placeholder={user?.name ?? ""} className="w-full rounded-lg border px-3 py-2" style={{ borderColor: c.border }} />
            </Field>

            {submitError && (
              <div className="rounded-lg border p-3 text-xs" style={{ borderColor: c.border, background: "#FCE5EC", color: "#9A2542" }}>
                {submitError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 rounded-lg border text-sm" style={{ borderColor: c.border }}>Cancel</button>
              <button
                disabled={creating || !draft.plate || !draft.agreementSignedName || (preview ? !preview.ok : false)}
                onClick={submitNew}
                className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50"
                style={{ background: c.cobalt }}
                data-testid="submit-permit"
              >
                {creating ? <Loader2 className="animate-spin" size={14} /> : "Issue permit"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium block mb-1" style={{ color: c.inkMute }}>{label}{hint ? <span className="ml-1 italic">({hint})</span> : null}</span>
      {children}
    </label>
  );
}

function StatusPill({ v }: { v: string }) {
  const ok = v === "active";
  return <span className="text-[11.5px] rounded-full px-2 py-0.5 font-semibold" style={{ color: ok ? "#0E6F45" : "#9A2542", background: ok ? "#DCF3EC" : "#FCE5EC" }}>{v}</span>;
}

function Modal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: c.border }}>
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

void addDays;
