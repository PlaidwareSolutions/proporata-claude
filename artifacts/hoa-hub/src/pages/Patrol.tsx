import { useState } from "react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { ShieldCheck, Search, Loader2, Car } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";

type ParkingPermit = {
  id: number; permitNumber: string; plate: string; plateState: string;
  vehicleMake: string; vehicleModel: string; vehicleColor: string;
  startsOn: string; endsOn: string; nights: number; status: string;
  unitId: string; ownerName?: string | null; qrToken: string;
};
type ParkingResult = {
  query: string; plate: string;
  result: "permitted" | "expired" | "cancelled" | "registered_resident" | "unregistered" | "empty";
  permits: ParkingPermit[];
  registeredVehicles: Array<{ id: number; unitId: string; plate: string; state?: string }>;
};

type LookupResult = {
  query: string;
  vehicles: Array<{ id: number; unitId: string; plate: string; state?: string; make?: string; model?: string; color?: string; permitNumber?: string }>;
  guestPasses: Array<{ id: number; bookingId: number; guestName: string; guestVehiclePlate?: string; checkedInAt?: string | null }>;
  poolTags: Array<{ id: number; unitId: string; tagNumber: string; status: string; holderName?: string }>;
  bookings: Array<{ id: number; amenityId: number; ownerUserId: number; unitId: string; startsAt: string; endsAt: string; status: string }>;
};

type ValidateResult = {
  ok: boolean;
  reason: string;
  bookingId?: number | null;
  amenityId?: number | null;
  amenityName?: string;
  ownerName?: string;
  unitId?: string | null;
  validFrom?: string;
  validUntil?: string;
  guestCount?: number;
};

export default function Patrol() {
  const [q, setQ] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [valid, setValid] = useState<ValidateResult | null>(null);
  const [parkingQ, setParkingQ] = useState("");
  const [parking, setParking] = useState<ParkingResult | null>(null);

  async function doLookup(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    try {
      const data = await apiFetch<LookupResult>({ url: `/patrol/lookup?q=${encodeURIComponent(q.trim())}`, method: "GET" });
      setResult(data);
    } finally {
      setLoading(false);
    }
  }

  async function doParking(e: React.FormEvent) {
    e.preventDefault();
    if (!parkingQ.trim()) return;
    setLoading(true);
    try {
      const data = await apiFetch<ParkingResult>({ url: `/patrol/parking?q=${encodeURIComponent(parkingQ.trim())}`, method: "GET" });
      setParking(data);
    } finally { setLoading(false); }
  }

  async function doValidate(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    try {
      const data = await apiFetch<ValidateResult>({ url: `/amenity-access/validate`, method: "POST", data: { code: code.trim() } });
      setValid(data);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout title="Patrol Lookup" subtitle="Verify plates, tags, passes, and access codes.">
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <ShieldCheck size={26} style={{ color: c.cobalt }} />
          <div>
            <h1 className="text-2xl font-semibold">Patrol Lookup</h1>
            <p className="text-sm" style={{ color: c.inkMute }}>
              Look up plates, pool tags, guest passes, and active bookings; validate access codes.
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <form onSubmit={doLookup} className="rounded-2xl border p-4 bg-white" style={{ borderColor: c.border }}>
            <label className="text-sm font-medium block mb-2">Plate / tag / guest name</label>
            <div className="flex gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ABC-123 or PT-042 or Jane"
                className="flex-1 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: c.border }}
              />
              <button type="submit" disabled={loading} className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ background: c.cobalt }}>
                {loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
              </button>
            </div>
          </form>

          <form onSubmit={doValidate} className="rounded-2xl border p-4 bg-white" style={{ borderColor: c.border }}>
            <label className="text-sm font-medium block mb-2">Validate access code</label>
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="XXXX-XXXX-XXXX"
                className="flex-1 rounded-lg border px-3 py-2 text-sm font-mono"
                style={{ borderColor: c.border }}
              />
              <button type="submit" disabled={loading} className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ background: c.cobalt }}>
                Check
              </button>
            </div>
          </form>
        </div>

        {valid && (
          <div className="rounded-2xl border p-4 mb-6" style={{ borderColor: c.border, background: valid.ok ? "#DCF3EC" : "#FCE5EC" }}>
            <div className="font-semibold text-base mb-1">
              {valid.ok ? "✓ Access granted" : "✗ Access denied"}
            </div>
            <div className="text-sm" style={{ color: c.inkMute }}>{valid.reason}</div>
            {valid.ok && (
              <div className="mt-2 text-sm grid grid-cols-2 gap-2">
                <div><span style={{ color: c.inkMute }}>Amenity:</span> {valid.amenityName}</div>
                <div><span style={{ color: c.inkMute }}>Owner:</span> {valid.ownerName} ({valid.unitId})</div>
                <div><span style={{ color: c.inkMute }}>Window:</span> {valid.validFrom && new Date(valid.validFrom).toLocaleString()} — {valid.validUntil && new Date(valid.validUntil).toLocaleString()}</div>
                <div><span style={{ color: c.inkMute }}>Guests:</span> {valid.guestCount ?? 0}</div>
              </div>
            )}
          </div>
        )}

        <form onSubmit={doParking} className="rounded-2xl border p-4 bg-white mb-6" style={{ borderColor: c.border }}>
          <label className="text-sm font-medium block mb-2 flex items-center gap-2"><Car size={14} /> Guest-parking lookup</label>
          <div className="flex gap-2">
            <input
              value={parkingQ}
              onChange={(e) => setParkingQ(e.target.value)}
              placeholder="Plate or permit number (e.g. ABC123 or GP-2026-0001)"
              className="flex-1 rounded-lg border px-3 py-2 text-sm font-mono"
              style={{ borderColor: c.border }}
              data-testid="patrol-parking-q"
            />
            <button type="submit" disabled={loading} className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ background: c.cobalt }}>
              {loading ? <Loader2 className="animate-spin" size={16} /> : "Check"}
            </button>
          </div>
        </form>

        {parking && parking.result !== "empty" && (
          <div className="rounded-2xl border p-4 mb-6"
            style={{
              borderColor: c.border,
              background: parking.result === "permitted" ? "#DCF3EC"
                : parking.result === "registered_resident" ? "#EEF1FF"
                : "#FCE5EC",
            }}>
            <div className="font-semibold text-base mb-1">
              {parking.result === "permitted" && "✓ Valid guest-parking permit"}
              {parking.result === "registered_resident" && "↺ Resident-registered vehicle (do not tow)"}
              {parking.result === "expired" && "✗ Permit expired"}
              {parking.result === "cancelled" && "✗ Permit cancelled"}
              {parking.result === "unregistered" && "✗ No permit on file — towable"}
            </div>
            <div className="text-sm" style={{ color: c.inkMute }}>
              {parking.plate ? `Plate ${parking.plate}` : `Query: ${parking.query}`}
            </div>
            {parking.permits.length > 0 && (
              <Table head={["Permit #", "Plate", "Vehicle", "Unit", "Owner", "Window", "Status"]}>
                {parking.permits.map((p) => (
                  <tr key={p.id}>
                    <Td mono>{p.permitNumber}</Td>
                    <Td mono>{p.plate}{p.plateState ? ` (${p.plateState})` : ""}</Td>
                    <Td>{[p.vehicleColor, p.vehicleMake, p.vehicleModel].filter(Boolean).join(" ") || "—"}</Td>
                    <Td>{p.unitId}</Td>
                    <Td>{p.ownerName ?? "—"}</Td>
                    <Td>{p.startsOn} → {p.endsOn}</Td>
                    <Td><StatusPill v={p.status} /></Td>
                  </tr>
                ))}
              </Table>
            )}
            {parking.registeredVehicles.length > 0 && (
              <div className="mt-3 text-xs" style={{ color: c.inkMute }}>
                Registered to: {parking.registeredVehicles.map((v) => v.unitId).join(", ")}
              </div>
            )}
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <Section title={`Vehicles (${result.vehicles.length})`}>
              {result.vehicles.length === 0 ? <Empty /> : (
                <Table head={["Plate", "State", "Make/Model", "Color", "Unit", "Permit"]}>
                  {result.vehicles.map((v) => (
                    <tr key={v.id}>
                      <Td mono>{v.plate}</Td><Td>{v.state ?? "—"}</Td>
                      <Td>{[v.make, v.model].filter(Boolean).join(" ") || "—"}</Td>
                      <Td>{v.color ?? "—"}</Td><Td>{v.unitId}</Td>
                      <Td>{v.permitNumber ?? "—"}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>

            <Section title={`Pool Tags (${result.poolTags.length})`}>
              {result.poolTags.length === 0 ? <Empty /> : (
                <Table head={["Tag", "Unit", "Holder", "Status"]}>
                  {result.poolTags.map((t) => (
                    <tr key={t.id}>
                      <Td mono>{t.tagNumber}</Td><Td>{t.unitId}</Td>
                      <Td>{t.holderName ?? "—"}</Td>
                      <Td><StatusPill v={t.status} /></Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>

            <Section title={`Guest Passes (${result.guestPasses.length})`}>
              {result.guestPasses.length === 0 ? <Empty /> : (
                <Table head={["Guest", "Plate", "Booking #", "Checked In"]}>
                  {result.guestPasses.map((g) => (
                    <tr key={g.id}>
                      <Td>{g.guestName}</Td><Td mono>{g.guestVehiclePlate ?? "—"}</Td>
                      <Td>#{g.bookingId}</Td>
                      <Td>{g.checkedInAt ? new Date(g.checkedInAt).toLocaleString() : "—"}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>

            <Section title={`Active Bookings (${result.bookings.length})`}>
              {result.bookings.length === 0 ? <Empty /> : (
                <Table head={["Booking", "Unit", "Window", "Status"]}>
                  {result.bookings.map((b) => (
                    <tr key={b.id}>
                      <Td>#{b.id}</Td><Td>{b.unitId}</Td>
                      <Td>{new Date(b.startsAt).toLocaleString()} — {new Date(b.endsAt).toLocaleString()}</Td>
                      <Td><StatusPill v={b.status} /></Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>
          </div>
        )}
      </div>
    </Layout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-white" style={{ borderColor: c.border }}>
      <div className="px-4 py-3 border-b font-medium text-sm" style={{ borderColor: c.border }}>{title}</div>
      <div className="p-4">{children}</div>
    </div>
  );
}
function Empty() { return <div className="text-sm" style={{ color: c.inkMute }}>No matches.</div>; }
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full text-sm">
      <thead><tr style={{ color: c.inkMute }}>{head.map((h) => <th key={h} className="text-left font-medium pb-2">{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  );
}
function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`py-1.5 ${mono ? "font-mono" : ""}`}>{children}</td>;
}
function StatusPill({ v }: { v: string }) {
  const ok = v === "active" || v === "confirmed" || v === "used";
  return <span className="text-[11.5px] rounded-full px-2 py-0.5 font-semibold" style={{ color: ok ? "#0E6F45" : "#9A2542", background: ok ? "#DCF3EC" : "#FCE5EC" }}>{v}</span>;
}
