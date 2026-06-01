// Task #85: Manager-side pet registry & dog-park admin dashboard.
// Provides counts, expiring vaccinations, recent incidents, and quick
// actions to suspend/restore pets and file new incidents.

import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { apiFetch } from "@/lib/apiFetch";
import { AlertTriangle, CheckCircle2, Clock, Download, Loader2, X } from "lucide-react";

interface Counts {
  total: number; compliant: number; expiringSoon: number;
  nonCompliant: number; pendingApproval: number; suspended: number;
}
interface ExpiringVax {
  id: number; petId: number; petName: string;
  unitId: string; vaccineType: string; expiresOn: string;
}
interface Incident {
  id: number; petId: number; unitId: string; occurredAt: string;
  kind: string; severity: string; description: string;
  status: "open" | "reviewed" | "dismissed";
  reportedByName: string;
}
interface Dashboard { counts: Counts; expiringVaccinations: ExpiringVax[]; recentIncidents: Incident[] }
interface PetRow {
  id: number; unitId: string; name: string; species: string; breed: string;
  weightLbs: number; status: string; approvalState: string;
  suspendedUntil: string | null;
  vaccinationSummary: { vaccineType: string; status: string; expiresOn: string | null }[];
}

export default function PetsAdmin() {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [pets, setPets] = useState<PetRow[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [incidentForPet, setIncidentForPet] = useState<PetRow | null>(null);

  async function reload() {
    setBusy(true);
    try {
      const [d, p] = await Promise.all([
        apiFetch<Dashboard>({ url: "/pets/dashboard", method: "GET" }),
        apiFetch<PetRow[]>({ url: "/pets" + (filter ? `?status=${filter}` : ""), method: "GET" }),
      ]);
      setDash(d);
      setPets(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { void reload(); }, [filter]);

  async function suspendPet(pet: PetRow) {
    const reason = prompt(`Suspend ${pet.name}. Reason?`, "Manual suspension");
    if (!reason) return;
    const days = parseInt(prompt("Duration (days)?", "30") ?? "0", 10);
    if (!days) return;
    await apiFetch({ url: `/pets/${pet.id}/suspend`, method: "POST", data: { reason, durationDays: days } });
    void reload();
  }
  async function restorePet(pet: PetRow) {
    if (!confirm(`Restore ${pet.name}?`)) return;
    await apiFetch({ url: `/pets/${pet.id}/restore`, method: "POST" });
    void reload();
  }

  return (
    <Layout title="Pet Registry" subtitle="Pet compliance, dog park access, incidents">
      {error && (
        <div className="mb-4 rounded-lg border p-3 text-[13px]"
          style={{ borderColor: "#F1A1B0", background: "#FCE5EC", color: "#9A2542" }}>
          {error}
        </div>
      )}
      {!dash || busy ? (
        <div className="text-[13px] flex items-center gap-2" style={{ color: c.inkMute }}>
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-6">
          <section className="grid grid-cols-6 gap-3">
            <Stat label="Total" value={dash.counts.total} tone="default" />
            <Stat label="Compliant" value={dash.counts.compliant} tone="ok" />
            <Stat label="Expiring soon" value={dash.counts.expiringSoon} tone="warn" />
            <Stat label="Non-compliant" value={dash.counts.nonCompliant} tone="bad" />
            <Stat label="Pending approval" value={dash.counts.pendingApproval} tone="default" />
            <Stat label="Suspended" value={dash.counts.suspended} tone="bad" />
          </section>

          <section className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
              <h3 className="text-[14px] mb-2" style={{ fontWeight: 700 }}>Vaccinations expiring soon</h3>
              {dash.expiringVaccinations.length === 0
                ? <div className="text-[12.5px]" style={{ color: c.inkMute }}>None within 30 days.</div>
                : <ul className="space-y-1.5">
                    {dash.expiringVaccinations.map((v) => (
                      <li key={v.id} className="text-[12.5px] flex items-center justify-between">
                        <span>
                          <span style={{ fontWeight: 600 }}>{v.petName}</span>{" "}
                          <span style={{ color: c.inkMute }}>· Unit {v.unitId} · {v.vaccineType}</span>
                        </span>
                        <span style={{ color: "#9A6500", fontWeight: 600 }}>exp {v.expiresOn}</span>
                      </li>
                    ))}
                  </ul>}
            </div>
            <div className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
              <h3 className="text-[14px] mb-2" style={{ fontWeight: 700 }}>Recent incidents</h3>
              {dash.recentIncidents.length === 0
                ? <div className="text-[12.5px]" style={{ color: c.inkMute }}>No incidents in the last 14 days.</div>
                : <ul className="space-y-1.5">
                    {dash.recentIncidents.map((i) => (
                      <li key={i.id} className="text-[12.5px]">
                        <span style={{ fontWeight: 600 }}>{i.kind}</span>{" "}
                        <span style={{ color: c.inkMute }}>
                          · Unit {i.unitId} · {new Date(i.occurredAt).toLocaleDateString()} · {i.severity} · {i.status}
                        </span>
                      </li>
                    ))}
                  </ul>}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[15px]" style={{ fontWeight: 700 }}>All pets</h3>
              <div className="flex items-center gap-2">
                <select value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="select-status-filter"
                  className="rounded border px-2 py-1.5 text-[12.5px]" style={{ borderColor: c.border }}>
                  <option value="">All statuses</option>
                  <option value="compliant">Compliant</option>
                  <option value="expiring_soon">Expiring soon</option>
                  <option value="non_compliant">Non-compliant</option>
                  <option value="pending_approval">Pending approval</option>
                  <option value="suspended">Suspended</option>
                </select>
                <a href="api/pets/export.csv" download data-testid="link-export-csv"
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] hover:bg-slate-50"
                  style={{ borderColor: c.border, color: c.ink, fontWeight: 600 }}>
                  <Download className="h-4 w-4" /> Export CSV
                </a>
              </div>
            </div>
            <div className="rounded-xl border bg-white overflow-x-auto" style={{ borderColor: c.border }}>
              <table className="w-full text-[12.5px]">
                <thead style={{ background: "#F8FAFC" }}>
                  <tr style={{ color: c.inkMute }}>
                    <Th>Pet</Th><Th>Unit</Th><Th>Species</Th><Th>Breed / Weight</Th>
                    <Th>Status</Th><Th>Vaccinations</Th><Th>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {pets.map((p) => (
                    <tr key={p.id} className="border-t" style={{ borderColor: c.border }}
                      data-testid={`row-pet-${p.id}`}>
                      <Td><span style={{ fontWeight: 600 }}>{p.name}</span></Td>
                      <Td>{p.unitId}</Td>
                      <Td>{p.species}</Td>
                      <Td>{p.breed} {p.weightLbs ? `· ${p.weightLbs}lb` : ""}</Td>
                      <Td>
                        <span className="text-[11.5px] rounded-full px-2 py-0.5"
                          style={{
                            color: p.status === "compliant" ? "#0E6F45"
                              : p.status === "expiring_soon" ? "#9A6500"
                              : "#9A2542",
                            background: p.status === "compliant" ? "#DCF3EC"
                              : p.status === "expiring_soon" ? "#FFF6D6"
                              : "#FCE5EC",
                            fontWeight: 600,
                          }}>
                          {p.status}
                        </span>
                      </Td>
                      <Td>
                        <span style={{ color: c.inkSoft }}>
                          {p.vaccinationSummary.map((v) => `${v.vaccineType}:${v.status}`).join(", ") || "—"}
                        </span>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setIncidentForPet(p)} data-testid={`button-incident-${p.id}`}
                            className="rounded border px-2 py-1 text-[11.5px] hover:bg-slate-50"
                            style={{ borderColor: c.border }}>
                            Incident
                          </button>
                          {p.suspendedUntil
                            ? <button onClick={() => restorePet(p)} data-testid={`button-restore-${p.id}`}
                                className="rounded border px-2 py-1 text-[11.5px] hover:bg-slate-50"
                                style={{ borderColor: c.border, color: "#0E6F45" }}>
                                Restore
                              </button>
                            : <button onClick={() => suspendPet(p)} data-testid={`button-suspend-${p.id}`}
                                className="rounded border px-2 py-1 text-[11.5px] hover:bg-slate-50"
                                style={{ borderColor: c.border, color: "#9A2542" }}>
                                Suspend
                              </button>}
                        </div>
                      </Td>
                    </tr>
                  ))}
                  {pets.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-6 text-center" style={{ color: c.inkMute }}>
                      No pets match this filter.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {incidentForPet && (
        <IncidentModal pet={incidentForPet} onClose={() => setIncidentForPet(null)}
          onFiled={() => { setIncidentForPet(null); void reload(); }} />
      )}
    </Layout>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "default" | "ok" | "warn" | "bad" }) {
  const map = {
    default: { fg: c.ink, bg: "#FFF" },
    ok: { fg: "#0E6F45", bg: "#FFF" },
    warn: { fg: "#9A6500", bg: "#FFF" },
    bad: { fg: "#9A2542", bg: "#FFF" },
  } as const;
  const t = map[tone];
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: c.border, background: t.bg }}>
      <div className="text-[11.5px]" style={{ color: c.inkMute, fontWeight: 600 }}>{label}</div>
      <div className="text-[22px] mt-1" style={{ color: t.fg, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left text-[11.5px]" style={{ fontWeight: 600 }}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2">{children}</td>;
}

function IncidentModal({
  pet, onClose, onFiled,
}: { pet: PetRow; onClose: () => void; onFiled: () => void }) {
  const [kind, setKind] = useState("aggression");
  const [severity, setSeverity] = useState("minor");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setErr(null);
    if (!description.trim()) { setErr("Describe the incident"); return; }
    setBusy(true);
    try {
      await apiFetch({
        url: `/pets/${pet.id}/incidents`, method: "POST",
        data: { kind, severity, description, occurredAt: new Date().toISOString() },
      });
      onFiled();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: c.border }}>
          <h3 className="text-[15px]" style={{ fontWeight: 700 }}>File incident — {pet.name}</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 grid grid-cols-2 gap-3 text-[12.5px]">
          <div>
            <div style={{ color: c.inkMute, fontWeight: 600 }}>Kind</div>
            <select value={kind} onChange={(e) => setKind(e.target.value)} data-testid="select-incident-kind"
              className="w-full rounded border px-2 py-1.5 mt-1" style={{ borderColor: c.border }}>
              <option value="aggression">Aggression</option>
              <option value="bite">Bite</option>
              <option value="off_leash">Off-leash</option>
              <option value="waste">Waste not picked up</option>
              <option value="noise">Noise</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <div style={{ color: c.inkMute, fontWeight: 600 }}>Severity</div>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} data-testid="select-incident-severity"
              className="w-full rounded border px-2 py-1.5 mt-1" style={{ borderColor: c.border }}>
              <option value="minor">Minor</option>
              <option value="major">Major</option>
              <option value="severe">Severe</option>
            </select>
          </div>
          <div className="col-span-2">
            <div style={{ color: c.inkMute, fontWeight: 600 }}>Description</div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
              data-testid="textarea-incident-description"
              className="w-full rounded border px-2 py-1.5 mt-1" style={{ borderColor: c.border }} />
          </div>
          {err && <div className="col-span-2 text-[12px]" style={{ color: "#9A2542" }}>{err}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: c.border }}>
          <button onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[12.5px] hover:bg-slate-50"
            style={{ borderColor: c.border }}>Cancel</button>
          <button onClick={submit} disabled={busy} data-testid="button-file-incident"
            className="rounded-lg px-4 py-1.5 text-[12.5px] text-white"
            style={{ background: c.ink, fontWeight: 600 }}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : "File incident"}
          </button>
        </div>
      </div>
    </div>
  );
}
