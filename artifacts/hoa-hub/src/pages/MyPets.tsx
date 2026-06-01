// Task #85: Resident-facing pet registry & dog-park module.
// Lets owners/tenants list, add, edit, archive pets; upload vaccination
// proof; view dog-park eligibility; sign the annual park agreement.

import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { apiFetch } from "@/lib/apiFetch";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Plus, Trash2, FileSignature, AlertTriangle, CheckCircle2, Clock, X, Upload } from "lucide-react";

type VaxStatus = "ok" | "expiring_soon" | "expired" | "missing";
interface VaxSummary { vaccineType: string; expiresOn: string | null; status: VaxStatus }
interface Vaccination {
  id: number; petId: number; vaccineType: string;
  administeredOn: string; expiresOn: string;
  certificateStorageKey: string | null; notes: string;
}
interface Pet {
  id: number; unitId: string; name: string; species: "dog" | "cat" | "other";
  breed: string; weightLbs: number; sex: "male" | "female" | "unknown";
  spayedNeutered: boolean; color: string;
  microchipNumber: string; vetName: string; vetPhone: string; notes: string;
  status: "compliant" | "expiring_soon" | "non_compliant" | "pending_approval" | "suspended";
  approvalState: "pending" | "approved" | "rejected";
  suspendedUntil: string | null; suspendedReason: string;
  createdAt: string;
  vaccinations?: Vaccination[];
  vaccinationSummary?: VaxSummary[];
}
interface Eligibility {
  ok: boolean;
  reason: string;
  eligiblePets: { id: number; name: string }[];
  ineligiblePets?: { id: number; name: string; reason: string }[];
  agreementValid?: boolean;
}
interface DogParkSettings {
  agreementText: string;
  bannedBreeds: string[];
  weightLimitLbs: number | null;
  vaccinationsRequired: string[];
  agreementRequired: boolean;
  ownerApprovalRequiredForTenants: boolean;
  incidentsToSuspend: number;
  incidentWindowDays: number;
  suspensionDurationDays: number;
}
interface Agreement {
  id: number; unitId: string; signedByName: string;
  signedAt: string; expiresAt: string;
}

function statusPill(s: Pet["status"]) {
  const map: Record<Pet["status"], { fg: string; bg: string; label: string; Icon: typeof CheckCircle2 }> = {
    compliant: { fg: "#0E6F45", bg: "#DCF3EC", label: "Compliant", Icon: CheckCircle2 },
    expiring_soon: { fg: "#9A6500", bg: "#FFF6D6", label: "Expiring soon", Icon: Clock },
    non_compliant: { fg: "#9A2542", bg: "#FCE5EC", label: "Non-compliant", Icon: AlertTriangle },
    pending_approval: { fg: "#475569", bg: "#EEF2F7", label: "Pending approval", Icon: Clock },
    suspended: { fg: "#9A2542", bg: "#FCE5EC", label: "Suspended", Icon: AlertTriangle },
  };
  const m = map[s] ?? map.non_compliant;
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] rounded-full px-2 py-0.5"
      style={{ color: m.fg, background: m.bg, fontWeight: 600 }}>
      <m.Icon className="h-3 w-3" /> {m.label}
    </span>
  );
}

export default function MyPets() {
  const { user } = useAuth();
  const [pets, setPets] = useState<Pet[] | null>(null);
  const [settings, setSettings] = useState<DogParkSettings | null>(null);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const [p, s, e, a] = await Promise.all([
        apiFetch<Pet[]>({ url: "/pets/me", method: "GET" }),
        apiFetch<DogParkSettings>({ url: "/pets/dogpark/settings", method: "GET" }),
        apiFetch<Eligibility>({ url: "/pets/dogpark/eligibility/me", method: "GET" }),
        apiFetch<Agreement | null>({ url: "/pets/dogpark/agreement/me", method: "GET" }),
      ]);
      setPets(p);
      setSettings(s);
      setEligibility(e);
      setAgreement(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void reload(); }, []);

  if (!user?.unitId && user?.role === "resident") {
    return (
      <Layout title="My Pets" subtitle="Pet registry & dog-park access">
        <div className="rounded-xl border bg-white p-8 text-center text-[13px]" style={{ borderColor: c.border, color: c.inkMute }}>
          You don't have a unit assigned. Contact your property manager.
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="My Pets" subtitle="Pet registry & dog-park access">
      {error && (
        <div className="mb-4 rounded-lg border p-3 text-[13px]"
          style={{ borderColor: "#F1A1B0", background: "#FCE5EC", color: "#9A2542" }}>
          {error}
        </div>
      )}
      {loading || !pets || !settings ? (
        <div className="text-[13px] flex items-center gap-2" style={{ color: c.inkMute }}>
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-6">
          <DogParkPanel
            eligibility={eligibility}
            agreement={agreement}
            settings={settings}
            onSign={() => setSigning(true)}
          />
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[15px]" style={{ fontWeight: 700 }}>Registered pets</h3>
              <button
                onClick={() => setShowNew(true)}
                data-testid="button-add-pet"
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] hover:bg-slate-50"
                style={{ borderColor: c.border, color: c.ink, fontWeight: 600 }}>
                <Plus className="h-4 w-4" /> Register pet
              </button>
            </div>
            {pets.length === 0 ? (
              <div className="rounded-xl border bg-white p-6 text-[13px] text-center"
                style={{ borderColor: c.border, color: c.inkMute }}>
                No pets registered. Click "Register pet" to add one.
              </div>
            ) : (
              <div className="grid gap-3">
                {pets.map((p) => (
                  <PetCard key={p.id} pet={p} onEdit={() => setEditingId(p.id)} onChanged={reload} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {showNew && (
        <PetFormModal
          settings={settings!}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); void reload(); }}
        />
      )}
      {editingId !== null && (
        <PetFormModal
          settings={settings!}
          existing={pets?.find((p) => p.id === editingId) ?? null}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); void reload(); }}
        />
      )}
      {signing && settings && (
        <AgreementModal
          settings={settings}
          onClose={() => setSigning(false)}
          onSigned={() => { setSigning(false); void reload(); }}
        />
      )}
    </Layout>
  );
}

function DogParkPanel({
  eligibility, agreement, settings, onSign,
}: {
  eligibility: Eligibility | null;
  agreement: Agreement | null;
  settings: DogParkSettings;
  onSign: () => void;
}) {
  const agreementValid = agreement && new Date(agreement.expiresAt).getTime() > Date.now();
  return (
    <section className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[15px]" style={{ fontWeight: 700 }}>Dog park access</h3>
          <p className="text-[12.5px] mt-1" style={{ color: c.inkMute }}>
            Reservations require an annual signed agreement and at least one
            registered, vaccination-current dog.
          </p>
        </div>
        {eligibility && (
          eligibility.ok
            ? <span className="text-[12px] rounded-full px-2.5 py-1"
                style={{ color: "#0E6F45", background: "#DCF3EC", fontWeight: 600 }}>Eligible</span>
            : <span className="text-[12px] rounded-full px-2.5 py-1"
                style={{ color: "#9A6500", background: "#FFF6D6", fontWeight: 600 }}>Not yet eligible</span>
        )}
      </div>
      {eligibility && !eligibility.ok && (
        <div className="mt-3 text-[12.5px]" style={{ color: c.inkSoft }}>
          <strong style={{ color: c.ink }}>Why:</strong> {eligibility.reason}
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-4 text-[12.5px]">
        <div>
          <div style={{ color: c.inkMute, fontWeight: 600 }}>Annual agreement</div>
          <div className="mt-1">
            {agreementValid
              ? <span style={{ color: "#0E6F45" }}>
                  Signed by {agreement!.signedByName} · expires {new Date(agreement!.expiresAt).toLocaleDateString()}
                </span>
              : <span style={{ color: "#9A6500" }}>Not signed{agreement ? " (expired)" : ""}</span>}
          </div>
          {!agreementValid && settings.agreementRequired && (
            <button onClick={onSign} data-testid="button-sign-agreement"
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] hover:bg-slate-50"
              style={{ borderColor: c.border, color: c.ink, fontWeight: 600 }}>
              <FileSignature className="h-3.5 w-3.5" /> Review & sign
            </button>
          )}
        </div>
        <div>
          <div style={{ color: c.inkMute, fontWeight: 600 }}>Park rules</div>
          <ul className="mt-1 space-y-0.5" style={{ color: c.inkSoft }}>
            {settings.weightLimitLbs ? <li>Weight limit: {settings.weightLimitLbs} lbs</li> : null}
            {settings.bannedBreeds.length > 0
              ? <li>Restricted breeds: {settings.bannedBreeds.join(", ")}</li>
              : null}
            <li>Vaccinations required: {settings.vaccinationsRequired.join(", ") || "none"}</li>
          </ul>
        </div>
      </div>
      {eligibility && eligibility.eligiblePets.length > 0 && (
        <div className="mt-3 text-[12.5px]" style={{ color: c.inkSoft }}>
          <strong style={{ color: c.ink }}>Eligible dogs:</strong>{" "}
          {eligibility.eligiblePets.map((p) => p.name).join(", ")}
        </div>
      )}
    </section>
  );
}

function PetCard({ pet, onEdit, onChanged }: { pet: Pet; onEdit: () => void; onChanged: () => void }) {
  const [showVax, setShowVax] = useState(false);
  async function archive() {
    if (!confirm(`Archive ${pet.name}? You can restore later by contacting your manager.`)) return;
    await apiFetch({ url: `/pets/${pet.id}`, method: "DELETE" });
    onChanged();
  }
  return (
    <div className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-[15px]" style={{ fontWeight: 700 }}>{pet.name}</h4>
            {statusPill(pet.status)}
          </div>
          <div className="text-[12px] mt-1" style={{ color: c.inkMute }}>
            {pet.species}
            {pet.breed ? ` · ${pet.breed}` : ""}
            {pet.weightLbs ? ` · ${pet.weightLbs} lbs` : ""}
            {pet.sex !== "unknown" ? ` · ${pet.sex}` : ""}
            {pet.spayedNeutered ? " · spayed/neutered" : ""}
          </div>
          {pet.suspendedReason && (
            <div className="mt-2 text-[12px]" style={{ color: "#9A2542" }}>
              Suspended: {pet.suspendedReason}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onEdit} data-testid={`button-edit-pet-${pet.id}`}
            className="rounded-lg border px-2.5 py-1 text-[12px] hover:bg-slate-50"
            style={{ borderColor: c.border, color: c.ink }}>Edit</button>
          <button onClick={archive} data-testid={`button-archive-pet-${pet.id}`}
            className="rounded-lg border px-2.5 py-1 text-[12px] hover:bg-slate-50"
            style={{ borderColor: c.border, color: "#9A2542" }}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {pet.vaccinationSummary && pet.vaccinationSummary.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {pet.vaccinationSummary.map((v) => {
            const cl = v.status === "ok" ? { fg: "#0E6F45", bg: "#DCF3EC" }
              : v.status === "expiring_soon" ? { fg: "#9A6500", bg: "#FFF6D6" }
              : { fg: "#9A2542", bg: "#FCE5EC" };
            return (
              <span key={v.vaccineType} className="text-[11px] rounded-full px-2 py-0.5"
                style={{ color: cl.fg, background: cl.bg, fontWeight: 600 }}>
                {v.vaccineType}{v.expiresOn ? ` · exp ${v.expiresOn}` : " · missing"}
              </span>
            );
          })}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between">
        <button onClick={() => setShowVax((s) => !s)} className="text-[12px] underline" style={{ color: c.ink }}>
          {showVax ? "Hide vaccinations" : "Manage vaccinations"}
        </button>
      </div>
      {showVax && <VaxEditor pet={pet} onChanged={onChanged} />}
    </div>
  );
}

function VaxEditor({ pet, onChanged }: { pet: Pet; onChanged: () => void }) {
  const [vaxs, setVaxs] = useState<Vaccination[]>(pet.vaccinations ?? []);
  const [type, setType] = useState("rabies");
  const [admin, setAdmin] = useState("");
  const [exp, setExp] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Vaccination[]>({ url: `/pets/${pet.id}/vaccinations`, method: "GET" })
      .then(setVaxs).catch(() => undefined);
  }, [pet.id]);

  async function add() {
    setErr(null);
    if (!admin || !exp) { setErr("Both dates required"); return; }
    setBusy(true);
    try {
      await apiFetch({
        url: `/pets/${pet.id}/vaccinations`, method: "POST",
        data: { vaccineType: type, administeredOn: admin, expiresOn: exp },
      });
      setAdmin(""); setExp("");
      const updated = await apiFetch<Vaccination[]>({ url: `/pets/${pet.id}/vaccinations`, method: "GET" });
      setVaxs(updated);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: number) {
    if (!confirm("Remove this vaccination record?")) return;
    await apiFetch({ url: `/pets/vaccinations/${id}`, method: "DELETE" });
    setVaxs(vaxs.filter((v) => v.id !== id));
    onChanged();
  }

  return (
    <div className="mt-3 rounded-lg border p-3" style={{ borderColor: c.border, background: "#F8FAFC" }}>
      <div className="text-[12.5px] mb-2" style={{ fontWeight: 600 }}>Vaccinations on file</div>
      {vaxs.length === 0 ? (
        <div className="text-[12px]" style={{ color: c.inkMute }}>No records yet.</div>
      ) : (
        <ul className="space-y-1.5 mb-3">
          {vaxs.map((v) => (
            <li key={v.id} className="flex items-center justify-between text-[12px]">
              <span>
                <span style={{ fontWeight: 600 }}>{v.vaccineType}</span>
                {" · administered "}{v.administeredOn}{" · expires "}{v.expiresOn}
              </span>
              <button onClick={() => remove(v.id)} data-testid={`button-delete-vax-${v.id}`}
                className="text-[11px]" style={{ color: "#9A2542" }}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-4 gap-2 text-[12px]">
        <select value={type} onChange={(e) => setType(e.target.value)}
          className="rounded border px-2 py-1.5" style={{ borderColor: c.border }}>
          <option value="rabies">Rabies</option>
          <option value="dhpp">DHPP</option>
          <option value="bordetella">Bordetella</option>
          <option value="lepto">Leptospirosis</option>
        </select>
        <input type="date" value={admin} onChange={(e) => setAdmin(e.target.value)}
          aria-label="Administered" className="rounded border px-2 py-1.5" style={{ borderColor: c.border }} />
        <input type="date" value={exp} onChange={(e) => setExp(e.target.value)}
          aria-label="Expires" className="rounded border px-2 py-1.5" style={{ borderColor: c.border }} />
        <button onClick={add} disabled={busy} data-testid="button-add-vax"
          className="rounded border px-2 py-1.5 hover:bg-slate-50"
          style={{ borderColor: c.border, fontWeight: 600 }}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : <><Upload className="h-3.5 w-3.5 inline mr-1" />Add</>}
        </button>
      </div>
      {err && <div className="mt-2 text-[12px]" style={{ color: "#9A2542" }}>{err}</div>}
    </div>
  );
}

function PetFormModal({
  settings, existing, onClose, onSaved,
}: {
  settings: DogParkSettings;
  existing?: Pet | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  void settings;
  const [name, setName] = useState(existing?.name ?? "");
  const [species, setSpecies] = useState<Pet["species"]>(existing?.species ?? "dog");
  const [breed, setBreed] = useState(existing?.breed ?? "");
  const [weightLbs, setWeight] = useState<number>(existing?.weightLbs ?? 0);
  const [sex, setSex] = useState<Pet["sex"]>(existing?.sex ?? "unknown");
  const [spayedNeutered, setSpayed] = useState(existing?.spayedNeutered ?? false);
  const [color, setColor] = useState(existing?.color ?? "");
  const [microchipNumber, setChip] = useState(existing?.microchipNumber ?? "");
  const [vetName, setVetName] = useState(existing?.vetName ?? "");
  const [vetPhone, setVetPhone] = useState(existing?.vetPhone ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!name.trim()) { setErr("Name is required"); return; }
    setBusy(true);
    try {
      const data = {
        name, species, breed, weightLbs: Number(weightLbs) || 0,
        sex, spayedNeutered, color, microchipNumber, vetName, vetPhone, notes,
      };
      if (existing) {
        await apiFetch({ url: `/pets/${existing.id}`, method: "PATCH", data });
      } else {
        await apiFetch({ url: "/pets/me", method: "POST", data });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl" style={{ borderColor: c.border }}>
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: c.border }}>
          <h3 className="text-[15px]" style={{ fontWeight: 700 }}>{existing ? "Edit pet" : "Register a pet"}</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 grid grid-cols-2 gap-3 text-[12.5px]">
          <Field label="Name *">
            <input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-pet-name"
              className="w-full rounded border px-2 py-1.5" style={{ borderColor: c.border }} />
          </Field>
          <Field label="Species">
            <select value={species} onChange={(e) => setSpecies(e.target.value as Pet["species"])}
              className="w-full rounded border px-2 py-1.5" style={{ borderColor: c.border }}>
              <option value="dog">Dog</option>
              <option value="cat">Cat</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Breed"><input value={breed} onChange={(e) => setBreed(e.target.value)}
            className="w-full rounded border px-2 py-1.5" style={{ borderColor: c.border }} /></Field>
          <Field label="Weight (lbs)">
            <input type="number" value={weightLbs} onChange={(e) => setWeight(parseInt(e.target.value, 10) || 0)}
              className="w-full rounded border px-2 py-1.5" style={{ borderColor: c.border }} />
          </Field>
          <Field label="Sex">
            <select value={sex} onChange={(e) => setSex(e.target.value as Pet["sex"])}
              className="w-full rounded border px-2 py-1.5" style={{ borderColor: c.border }}>
              <option value="unknown">Unknown</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </Field>
          <Field label="Spayed/Neutered">
            <label className="flex items-center gap-2 mt-1.5">
              <input type="checkbox" checked={spayedNeutered} onChange={(e) => setSpayed(e.target.checked)} />
              <span>Yes</span>
            </label>
          </Field>
          <Field label="Color"><input value={color} onChange={(e) => setColor(e.target.value)}
            className="w-full rounded border px-2 py-1.5" style={{ borderColor: c.border }} /></Field>
          <Field label="Microchip #"><input value={microchipNumber} onChange={(e) => setChip(e.target.value)}
            className="w-full rounded border px-2 py-1.5" style={{ borderColor: c.border }} /></Field>
          <Field label="Vet name"><input value={vetName} onChange={(e) => setVetName(e.target.value)}
            className="w-full rounded border px-2 py-1.5" style={{ borderColor: c.border }} /></Field>
          <Field label="Vet phone"><input value={vetPhone} onChange={(e) => setVetPhone(e.target.value)}
            className="w-full rounded border px-2 py-1.5" style={{ borderColor: c.border }} /></Field>
          <Field label="Notes" full>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full rounded border px-2 py-1.5" style={{ borderColor: c.border }} />
          </Field>
          {err && <div className="col-span-2 text-[12px]" style={{ color: "#9A2542" }}>{err}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: c.border }}>
          <button onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[12.5px] hover:bg-slate-50"
            style={{ borderColor: c.border }}>Cancel</button>
          <button onClick={save} disabled={busy} data-testid="button-save-pet"
            className="rounded-lg px-4 py-1.5 text-[12.5px] text-white"
            style={{ background: c.ink, fontWeight: 600 }}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : existing ? "Save changes" : "Register"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <div className="mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>{label}</div>
      {children}
    </div>
  );
}

function AgreementModal({
  settings, onClose, onSigned,
}: { settings: DogParkSettings; onClose: () => void; onSigned: () => void }) {
  const { user } = useAuth();
  const [signedByName, setName] = useState(user?.name ?? "");
  const [acked, setAcked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function sign() {
    setErr(null);
    if (!signedByName.trim()) { setErr("Type your full name"); return; }
    if (!acked) { setErr("You must acknowledge the rules"); return; }
    setBusy(true);
    try {
      await apiFetch({ url: "/pets/dogpark/agreement", method: "POST", data: { signedByName } });
      onSigned();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: c.border }}>
          <h3 className="text-[15px]" style={{ fontWeight: 700 }}>Dog park agreement</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4">
          <div className="rounded-lg border p-3 max-h-72 overflow-y-auto whitespace-pre-wrap text-[12.5px]"
            style={{ borderColor: c.border, background: "#F8FAFC", color: c.inkSoft }}>
            {settings.agreementText || "By using the dog park, I agree to abide by all posted rules and accept responsibility for my pet's behavior."}
          </div>
          <label className="flex items-start gap-2 mt-3 text-[12.5px]">
            <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)}
              data-testid="checkbox-agreement-ack" className="mt-0.5" />
            <span>I have read and agree to abide by the dog-park rules. I understand this agreement renews annually.</span>
          </label>
          <div className="mt-3 text-[12.5px]">
            <div style={{ color: c.inkMute, fontWeight: 600 }}>Type your full name to sign</div>
            <input value={signedByName} onChange={(e) => setName(e.target.value)} data-testid="input-signed-by"
              className="mt-1 w-full rounded border px-2 py-1.5" style={{ borderColor: c.border }} />
          </div>
          {err && <div className="mt-2 text-[12px]" style={{ color: "#9A2542" }}>{err}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: c.border }}>
          <button onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[12.5px] hover:bg-slate-50"
            style={{ borderColor: c.border }}>Cancel</button>
          <button onClick={sign} disabled={busy} data-testid="button-confirm-sign"
            className="rounded-lg px-4 py-1.5 text-[12.5px] text-white"
            style={{ background: c.ink, fontWeight: 600 }}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : "Sign agreement"}
          </button>
        </div>
      </div>
    </div>
  );
}
