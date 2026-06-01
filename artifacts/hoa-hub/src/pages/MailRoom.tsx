// Task #87: Manager Mail & Package Room.
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { apiFetch } from "@/lib/apiFetch";
import {
  Package as PackageIcon,
  Plus,
  Search,
  CheckCircle2,
  Upload,
  Camera,
  X,
  History,
  ShieldCheck,
} from "lucide-react";

type Pkg = {
  id: number; unitId: string; recipientUserId: number | null; recipientName: string;
  carrier: string; trackingNumber: string; size: string; notes: string;
  intakePhotoStorageKey: string | null; pickupPhotoStorageKey: string | null;
  pickupCode: string; qrPayload: string;
  lockerId: number | null; lockerBay: string | null; lockerPin: string | null;
  status: string; heldUntil: string | null;
  staleAt: string | null; rtsAt: string | null;
  pickedUpAt: string | null; pickedUpByName: string;
  intakeByName: string; createdAt: string; updatedAt: string;
};
type Locker = { id: number; bankSlug: string; bay: string; size: string; notes: string; outOfService: boolean };
type Unit = { id: string; label: string; address: string };
type AuditEntry = { id: number; action: string; actorName: string; diff: Record<string, unknown> | null; createdAt: string };
type Authz = { id: number; authorizedName: string; note: string; createdAt: string };

const CARRIERS = ["USPS", "UPS", "FedEx", "Amazon", "DHL", "Other"];
const SIZES = ["letter", "small", "medium", "large", "oversized"];
const STATUSES = [
  { v: "received", label: "Received" },
  { v: "in_locker", label: "In locker" },
  { v: "ready_for_pickup", label: "Ready" },
  { v: "picked_up", label: "Picked up" },
  { v: "stale", label: "Stale" },
  { v: "return_to_sender", label: "Return to sender" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function MailRoom() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"queue" | "lockers" | "holds" | "history">("queue");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [carrierFilter, setCarrierFilter] = useState<string>("");
  const [showIntake, setShowIntake] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [auditFor, setAuditFor] = useState<Pkg | null>(null);

  const filterParams = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (statusFilter) p.set("status", statusFilter);
    if (carrierFilter) p.set("carrier", carrierFilter);
    return p.toString();
  }, [q, statusFilter, carrierFilter]);

  const { data: packages = [], isLoading } = useQuery<Pkg[]>({
    queryKey: ["/packages", filterParams],
    queryFn: () => apiFetch({ url: `/packages${filterParams ? `?${filterParams}` : ""}`, method: "GET" }),
  });
  const { data: lockers = [] } = useQuery<Locker[]>({
    queryKey: ["/package-lockers"],
    queryFn: () => apiFetch({ url: "/package-lockers", method: "GET" }),
  });
  const { data: units = [] } = useQuery<Unit[]>({
    queryKey: ["/units"],
    queryFn: () => apiFetch({ url: "/units", method: "GET" }),
  });
  const { data: holds = [] } = useQuery<Array<{ id: number; unitId: string; startsOn: string; endsOn: string; note: string }>>({
    queryKey: ["/mail-holds"],
    queryFn: () => apiFetch({ url: "/mail-holds", method: "GET" }),
  });

  const queueRows = useMemo(
    () => packages.filter((p) => p.status !== "picked_up" && p.status !== "returned"),
    [packages],
  );
  const historyRows = useMemo(
    () => packages.filter((p) => p.status === "picked_up" || p.status === "returned"),
    [packages],
  );

  const pickupMut = useMutation({
    mutationFn: (vars: { id: number; pickedUpByName: string }) =>
      apiFetch({ url: `/packages/${vars.id}/pickup`, method: "POST", data: { pickedUpByName: vars.pickedUpByName } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/packages"] }),
  });

  return (
    <Layout title="Mail & Package Room" subtitle="Intake, lockers, pickup audit, vacation holds, and aging.">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          {(["queue", "lockers", "holds", "history"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="rounded-md px-3 py-1.5 text-[13px]"
              style={tab === t
                ? { background: c.cobaltSoft, color: c.cobalt, fontWeight: 600 }
                : { color: c.inkSoft }}
            >
              {t === "queue" ? "Queue" : t === "lockers" ? "Lockers" : t === "holds" ? "Vacation holds" : "History"}
            </button>
          ))}
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => setShowIntake(true)}
              className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[13px]"
              style={{ background: c.emerald, color: "#fff", fontWeight: 600 }}>
              <Plus className="h-4 w-4" /> Intake
            </button>
            <button
              onClick={() => setShowBulk(true)}
              className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[13px]"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
              <Upload className="h-4 w-4" /> Bulk CSV
            </button>
          </div>
        </div>

        {tab === "queue" && (
          <>
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: c.inkMute }} />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search recipient, tracking, code"
                  className="rounded-md border pl-8 pr-3 py-1.5 text-[13px]"
                  style={{ borderColor: c.border, background: c.panel }}
                />
              </div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-md border px-2 py-1.5 text-[13px]" style={{ borderColor: c.border, background: c.panel }}>
                <option value="">All statuses</option>
                {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
              <select value={carrierFilter} onChange={(e) => setCarrierFilter(e.target.value)}
                className="rounded-md border px-2 py-1.5 text-[13px]" style={{ borderColor: c.border, background: c.panel }}>
                <option value="">All carriers</option>
                {CARRIERS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div className="rounded-xl border overflow-hidden" style={{ borderColor: c.border, background: c.panel }}>
              <table className="w-full text-[13px]">
                <thead style={{ background: c.cobaltSoft }}>
                  <tr>
                    <th className="text-left px-3 py-2">Code</th>
                    <th className="text-left px-3 py-2">Unit</th>
                    <th className="text-left px-3 py-2">Recipient</th>
                    <th className="text-left px-3 py-2">Carrier / Size</th>
                    <th className="text-left px-3 py-2">Locker</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">Logged</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && <tr><td colSpan={8} className="px-3 py-3" style={{ color: c.inkMute }}>Loading…</td></tr>}
                  {!isLoading && queueRows.length === 0 && (
                    <tr><td colSpan={8} className="px-3 py-6 text-center" style={{ color: c.inkMute }}>
                      Mail room is clear — no pending packages.</td></tr>
                  )}
                  {queueRows.map((p) => (
                    <tr key={p.id} style={{ borderTop: `1px solid ${c.border}` }}>
                      <td className="px-3 py-2 font-mono text-[12px]">{p.pickupCode}</td>
                      <td className="px-3 py-2">{p.unitId}</td>
                      <td className="px-3 py-2">{p.recipientName}</td>
                      <td className="px-3 py-2">{p.carrier} · {p.size}</td>
                      <td className="px-3 py-2">
                        {p.lockerBay ? `${p.lockerBay}${p.lockerPin ? ` (PIN ${p.lockerPin})` : ""}` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-block rounded-full px-2 py-0.5 text-[11px]"
                          style={{
                            background: p.status === "stale" ? c.roseSoft : p.status === "return_to_sender" ? c.roseSoft : c.cobaltSoft,
                            color: p.status === "stale" || p.status === "return_to_sender" ? c.rose : c.cobalt,
                            fontWeight: 600,
                          }}>
                          {STATUSES.find((s) => s.v === p.status)?.label ?? p.status}
                          {p.heldUntil ? " · on hold" : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2" style={{ color: c.inkMute }}>{fmtDate(p.createdAt)}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => {
                            const name = window.prompt("Picked up by (full name)?", p.recipientName);
                            if (!name) return;
                            pickupMut.mutate({ id: p.id, pickedUpByName: name });
                          }}
                          className="text-[12px] mr-2 inline-flex items-center gap-1"
                          style={{ color: c.emerald, fontWeight: 600 }}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Mark picked up
                        </button>
                        <button onClick={() => setAuditFor(p)}
                          className="text-[12px] inline-flex items-center gap-1" style={{ color: c.cobalt, fontWeight: 600 }}>
                          <History className="h-3.5 w-3.5" /> Audit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "lockers" && <LockersTab lockers={lockers} />}
        {tab === "holds" && <HoldsTab holds={holds} units={units} />}
        {tab === "history" && (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: c.border, background: c.panel }}>
            <table className="w-full text-[13px]">
              <thead style={{ background: c.cobaltSoft }}>
                <tr>
                  <th className="text-left px-3 py-2">Code</th>
                  <th className="text-left px-3 py-2">Unit</th>
                  <th className="text-left px-3 py-2">Recipient</th>
                  <th className="text-left px-3 py-2">Picked up by</th>
                  <th className="text-left px-3 py-2">Picked up at</th>
                  <th className="text-left px-3 py-2">Pickup photo</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((p) => (
                  <tr key={p.id} style={{ borderTop: `1px solid ${c.border}` }}>
                    <td className="px-3 py-2 font-mono text-[12px]">{p.pickupCode}</td>
                    <td className="px-3 py-2">{p.unitId}</td>
                    <td className="px-3 py-2">{p.recipientName}</td>
                    <td className="px-3 py-2">{p.pickedUpByName || "—"}</td>
                    <td className="px-3 py-2" style={{ color: c.inkMute }}>{fmtDate(p.pickedUpAt)}</td>
                    <td className="px-3 py-2">{p.pickupPhotoStorageKey ? <Camera className="h-4 w-4" style={{ color: c.emerald }} /> : "—"}</td>
                  </tr>
                ))}
                {historyRows.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center" style={{ color: c.inkMute }}>No history yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {showIntake && <IntakeModal units={units} lockers={lockers} onClose={() => setShowIntake(false)} />}
        {showBulk && <BulkModal onClose={() => setShowBulk(false)} />}
        {auditFor && <AuditModal pkg={auditFor} onClose={() => setAuditFor(null)} />}
      </div>
    </Layout>
  );
}

function IntakeModal({ units, lockers, onClose }: { units: Unit[]; lockers: Locker[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [unitId, setUnitId] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [carrier, setCarrier] = useState("USPS");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [size, setSize] = useState("medium");
  const [notes, setNotes] = useState("");
  const [lockerId, setLockerId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Pkg | null>(null);

  const create = useMutation({
    mutationFn: () => apiFetch<Pkg>({
      url: "/packages", method: "POST",
      data: {
        unitId, recipientName, carrier, trackingNumber, size, notes,
        lockerId: lockerId ? Number(lockerId) : null,
      },
    }),
    onSuccess: (p) => {
      setCreated(p);
      qc.invalidateQueries({ queryKey: ["/packages"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  if (created) {
    return (
      <Modal onClose={onClose} title="Package logged">
        <div className="space-y-3 text-[13px]">
          <p>Logged for <strong>{created.recipientName}</strong> (Unit {created.unitId}).</p>
          <div className="rounded-md p-3" style={{ background: c.cobaltSoft }}>
            <div>Pickup code: <strong className="font-mono">{created.pickupCode}</strong></div>
            {created.lockerBay && <div>Locker: <strong>{created.lockerBay}</strong>{created.lockerPin ? ` · PIN ${created.lockerPin}` : ""}</div>}
            {created.heldUntil && <div style={{ color: c.rose }}>Held until {created.heldUntil} (vacation hold).</div>}
          </div>
          <div className="rounded-md border p-2 text-center" style={{ borderColor: c.border }}>
            <img src={`${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/api/packages/${created.id}/qr.svg`}
              alt="Pickup QR" style={{ maxWidth: 240, margin: "0 auto" }} />
          </div>
          <div className="text-right">
            <button onClick={onClose} className="rounded-md px-3 py-1.5 text-[13px]"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>Done</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title="Log package intake">
      <div className="space-y-2 text-[13px]">
        <Field label="Unit">
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className="w-full rounded-md border px-2 py-1.5"
            style={{ borderColor: c.border, background: c.panel }}>
            <option value="">— Select —</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.label} · {u.address}</option>)}
          </select>
        </Field>
        <Field label="Recipient name (optional)">
          <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} className="w-full rounded-md border px-2 py-1.5"
            style={{ borderColor: c.border, background: c.panel }} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Carrier">
            <select value={carrier} onChange={(e) => setCarrier(e.target.value)} className="w-full rounded-md border px-2 py-1.5"
              style={{ borderColor: c.border, background: c.panel }}>
              {CARRIERS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Size">
            <select value={size} onChange={(e) => setSize(e.target.value)} className="w-full rounded-md border px-2 py-1.5"
              style={{ borderColor: c.border, background: c.panel }}>
              {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Tracking number">
          <input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} className="w-full rounded-md border px-2 py-1.5"
            style={{ borderColor: c.border, background: c.panel }} />
        </Field>
        <Field label="Locker (optional)">
          <select value={lockerId} onChange={(e) => setLockerId(e.target.value)} className="w-full rounded-md border px-2 py-1.5"
            style={{ borderColor: c.border, background: c.panel }}>
            <option value="">— No locker —</option>
            {lockers.filter((l) => !l.outOfService).map((l) => <option key={l.id} value={l.id}>{l.bay} ({l.size})</option>)}
          </select>
        </Field>
        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-md border px-2 py-1.5"
            rows={2} style={{ borderColor: c.border, background: c.panel }} />
        </Field>
        {error && <div className="text-[12px]" style={{ color: c.rose }}>{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5" style={{ color: c.inkSoft }}>Cancel</button>
          <button onClick={() => { setError(null); create.mutate(); }} disabled={!unitId || create.isPending}
            className="rounded-md px-3 py-1.5"
            style={{ background: c.emerald, color: "#fff", fontWeight: 600 }}>
            {create.isPending ? "Logging…" : "Log package"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function BulkModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState("unitId,recipientName,carrier,size,trackingNumber\n");
  const [result, setResult] = useState<{ created: number; errors: { index: number; error: string }[] } | null>(null);

  const submit = useMutation({
    mutationFn: () => {
      const lines = csv.trim().split(/\r?\n/);
      const header = lines[0].split(",").map((s) => s.trim());
      const items = lines.slice(1).map((line) => {
        const cols = line.split(",").map((s) => s.trim());
        const obj: Record<string, string> = {};
        header.forEach((h, i) => { obj[h] = cols[i] ?? ""; });
        return obj;
      }).filter((o) => o.unitId);
      return apiFetch<{ created: number; errors: { index: number; error: string }[] }>({
        url: "/packages/bulk", method: "POST", data: { items },
      });
    },
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["/packages"] });
    },
  });

  return (
    <Modal onClose={onClose} title="Bulk intake (CSV)">
      <div className="space-y-2 text-[13px]">
        <p style={{ color: c.inkMute }}>
          Paste CSV with header row. Columns: <code>unitId,recipientName,carrier,size,trackingNumber,notes</code>.
        </p>
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={10}
          className="w-full rounded-md border px-2 py-1.5 font-mono text-[12px]"
          style={{ borderColor: c.border, background: c.panel }} />
        {result && (
          <div className="rounded-md p-2" style={{ background: c.emeraldSoft, color: c.emerald }}>
            Created {result.created}.{result.errors.length > 0 && (
              <ul className="mt-1 ml-4 list-disc text-[12px]" style={{ color: c.rose }}>
                {result.errors.map((e) => <li key={e.index}>Row {e.index + 1}: {e.error}</li>)}
              </ul>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5" style={{ color: c.inkSoft }}>Close</button>
          <button onClick={() => submit.mutate()} disabled={submit.isPending}
            className="rounded-md px-3 py-1.5"
            style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
            {submit.isPending ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function LockersTab({ lockers }: { lockers: Locker[] }) {
  const qc = useQueryClient();
  const [bay, setBay] = useState(""); const [size, setSize] = useState("medium");
  const create = useMutation({
    mutationFn: () => apiFetch({ url: "/package-lockers", method: "POST", data: { bay, size } }),
    onSuccess: () => { setBay(""); qc.invalidateQueries({ queryKey: ["/package-lockers"] }); },
  });
  const toggleOos = useMutation({
    mutationFn: (l: Locker) => apiFetch({ url: `/package-lockers/${l.id}`, method: "PATCH", data: { outOfService: !l.outOfService } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/package-lockers"] }),
  });
  return (
    <div className="space-y-3">
      <div className="rounded-xl border p-3 flex items-end gap-2" style={{ borderColor: c.border, background: c.panel }}>
        <Field label="Bay">
          <input value={bay} onChange={(e) => setBay(e.target.value)} className="rounded-md border px-2 py-1.5 text-[13px]"
            style={{ borderColor: c.border, background: c.panel }} />
        </Field>
        <Field label="Size">
          <select value={size} onChange={(e) => setSize(e.target.value)} className="rounded-md border px-2 py-1.5 text-[13px]"
            style={{ borderColor: c.border, background: c.panel }}>
            {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <button onClick={() => create.mutate()} disabled={!bay}
          className="rounded-md px-3 py-1.5 text-[13px]" style={{ background: c.emerald, color: "#fff", fontWeight: 600 }}>
          <Plus className="h-3.5 w-3.5 inline mr-1" /> Add bay
        </button>
      </div>
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: c.border, background: c.panel }}>
        <table className="w-full text-[13px]">
          <thead style={{ background: c.cobaltSoft }}>
            <tr><th className="text-left px-3 py-2">Bay</th><th className="text-left px-3 py-2">Size</th>
              <th className="text-left px-3 py-2">Status</th><th></th></tr>
          </thead>
          <tbody>
            {lockers.map((l) => (
              <tr key={l.id} style={{ borderTop: `1px solid ${c.border}` }}>
                <td className="px-3 py-2 font-mono">{l.bay}</td>
                <td className="px-3 py-2">{l.size}</td>
                <td className="px-3 py-2">{l.outOfService ? "Out of service" : "Available"}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => toggleOos.mutate(l)} className="text-[12px]" style={{ color: c.cobalt, fontWeight: 600 }}>
                    {l.outOfService ? "Restore" : "Mark OOS"}
                  </button>
                </td>
              </tr>
            ))}
            {lockers.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center" style={{ color: c.inkMute }}>No lockers configured.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HoldsTab({ holds, units }: { holds: Array<{ id: number; unitId: string; startsOn: string; endsOn: string; note: string }>; units: Unit[] }) {
  const labelByUnit = new Map(units.map((u) => [u.id, u.label]));
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: c.border, background: c.panel }}>
      <table className="w-full text-[13px]">
        <thead style={{ background: c.cobaltSoft }}>
          <tr><th className="text-left px-3 py-2">Unit</th>
            <th className="text-left px-3 py-2">From</th><th className="text-left px-3 py-2">To</th>
            <th className="text-left px-3 py-2">Note</th></tr>
        </thead>
        <tbody>
          {holds.map((h) => (
            <tr key={h.id} style={{ borderTop: `1px solid ${c.border}` }}>
              <td className="px-3 py-2">{labelByUnit.get(h.unitId) ?? h.unitId}</td>
              <td className="px-3 py-2">{h.startsOn}</td>
              <td className="px-3 py-2">{h.endsOn}</td>
              <td className="px-3 py-2" style={{ color: c.inkMute }}>{h.note || "—"}</td>
            </tr>
          ))}
          {holds.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center" style={{ color: c.inkMute }}>No active or upcoming holds.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function AuditModal({ pkg, onClose }: { pkg: Pkg; onClose: () => void }) {
  const { data: entries = [] } = useQuery<AuditEntry[]>({
    queryKey: ["/packages", pkg.id, "audit"],
    queryFn: () => apiFetch({ url: `/packages/${pkg.id}/audit`, method: "GET" }),
  });
  const { data: auths = [] } = useQuery<Authz[]>({
    queryKey: ["/packages", pkg.id, "auth"],
    queryFn: () => apiFetch({ url: `/packages/${pkg.id}/authorizations`, method: "GET" }),
  });
  return (
    <Modal onClose={onClose} title={`Package ${pkg.pickupCode} — audit`}>
      <div className="space-y-3 text-[12.5px]">
        <div>
          <h4 className="text-[13px] mb-1" style={{ fontWeight: 600 }}>Pickup-proxy authorizations</h4>
          {auths.length === 0 ? <div style={{ color: c.inkMute }}>None.</div> : (
            <ul className="space-y-1">{auths.map((a) => (
              <li key={a.id} className="rounded p-1.5" style={{ background: c.cobaltSoft }}>
                <ShieldCheck className="h-3.5 w-3.5 inline mr-1" style={{ color: c.cobalt }} />
                <strong>{a.authorizedName}</strong> — {a.note || "no note"} ({fmtDate(a.createdAt)})
              </li>
            ))}</ul>
          )}
        </div>
        <div>
          <h4 className="text-[13px] mb-1" style={{ fontWeight: 600 }}>Audit trail</h4>
          <ul className="space-y-1">
            {entries.map((e) => (
              <li key={e.id} className="border-l-2 pl-2" style={{ borderColor: c.cobalt }}>
                <strong>{e.action}</strong> by {e.actorName} <span style={{ color: c.inkMute }}>· {fmtDate(e.createdAt)}</span>
                {e.diff && <div className="font-mono text-[11px]" style={{ color: c.inkMute }}>{JSON.stringify(e.diff)}</div>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="w-full max-w-lg rounded-xl border shadow-xl" style={{ background: c.panel, borderColor: c.border }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${c.border}` }}>
          <div className="flex items-center gap-2"><PackageIcon className="h-4 w-4" style={{ color: c.cobalt }} />
            <strong className="text-[14px]">{title}</strong></div>
          <button onClick={onClose}><X className="h-4 w-4" style={{ color: c.inkMute }} /></button>
        </div>
        <div className="p-4 max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11.5px] uppercase tracking-wider mb-0.5" style={{ color: c.inkMute, fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}
