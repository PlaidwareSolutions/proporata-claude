// Task #87: Resident mail tab — package history + vacation holds + pickup-proxy.
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { apiFetch } from "@/lib/apiFetch";
import { Package as PackageIcon, Plus, Trash2, ShieldCheck, X } from "lucide-react";

type Pkg = {
  id: number; recipientName: string; carrier: string; trackingNumber: string;
  size: string; pickupCode: string; lockerBay: string | null; lockerPin: string | null;
  status: string; heldUntil: string | null;
  pickedUpAt: string | null; pickedUpByName: string; createdAt: string;
};
type Hold = { id: number; startsOn: string; endsOn: string; note: string };
type Authz = { id: number; authorizedName: string; note: string; createdAt: string };

const STATUS_LABEL: Record<string, string> = {
  received: "Received", in_locker: "In locker", ready_for_pickup: "Ready",
  picked_up: "Picked up", stale: "Awaiting pickup", return_to_sender: "Return to sender", returned: "Returned",
};

function fmt(iso: string | null): string { return iso ? new Date(iso).toLocaleString() : "—"; }

export default function ResidentMail() {
  const qc = useQueryClient();
  const { data: pkgs = [] } = useQuery<Pkg[]>({
    queryKey: ["/packages/me"],
    queryFn: () => apiFetch({ url: "/packages/me", method: "GET" }),
  });
  const { data: holds = [] } = useQuery<Hold[]>({
    queryKey: ["/units/me/mail-holds"],
    queryFn: () => apiFetch({ url: "/units/me/mail-holds", method: "GET" }),
  });

  const open = useMemo(() => pkgs.filter((p) => p.status !== "picked_up" && p.status !== "returned"), [pkgs]);
  const past = useMemo(() => pkgs.filter((p) => p.status === "picked_up" || p.status === "returned"), [pkgs]);

  const [authFor, setAuthFor] = useState<Pkg | null>(null);
  const [showQrFor, setShowQrFor] = useState<Pkg | null>(null);
  const [startsOn, setStartsOn] = useState(""); const [endsOn, setEndsOn] = useState(""); const [holdNote, setHoldNote] = useState("");

  const addHold = useMutation({
    mutationFn: () => apiFetch({ url: "/units/me/mail-holds", method: "POST", data: { startsOn, endsOn, note: holdNote } }),
    onSuccess: () => { setStartsOn(""); setEndsOn(""); setHoldNote(""); qc.invalidateQueries({ queryKey: ["/units/me/mail-holds"] }); },
  });
  const delHold = useMutation({
    mutationFn: (id: number) => apiFetch({ url: `/units/me/mail-holds/${id}`, method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/units/me/mail-holds"] }),
  });

  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

  return (
    <Layout title="My Mail" subtitle="Packages held in the management office and your vacation holds.">
      <div className="space-y-5">
        <div>
          <h3 className="text-[14px] mb-2" style={{ fontWeight: 700 }}>Awaiting pickup ({open.length})</h3>
          {open.length === 0 ? (
            <div className="rounded-xl border p-4 text-center text-[13px]" style={{ background: c.panel, borderColor: c.border, color: c.inkMute }}>
              No packages waiting.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {open.map((p) => (
                <div key={p.id} className="rounded-xl border p-4" style={{ background: c.panel, borderColor: c.border }}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-[13px]" style={{ fontWeight: 600 }}>
                        <PackageIcon className="h-4 w-4 inline mr-1" style={{ color: c.cobalt }} />
                        {p.carrier} · {p.size}
                      </div>
                      <div className="text-[12px]" style={{ color: c.inkMute }}>
                        {p.recipientName} · Logged {fmt(p.createdAt)}
                      </div>
                      {p.trackingNumber && <div className="text-[12px]" style={{ color: c.inkMute }}>Tracking: {p.trackingNumber}</div>}
                    </div>
                    <span className="text-[11px] rounded-full px-2 py-0.5"
                      style={{ background: p.status === "stale" ? c.roseSoft : c.cobaltSoft,
                        color: p.status === "stale" ? c.rose : c.cobalt, fontWeight: 600 }}>
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </div>
                  <div className="mt-2 rounded-md p-2 text-[13px]" style={{ background: c.cobaltSoft }}>
                    Pickup code: <strong className="font-mono">{p.pickupCode}</strong>
                    {p.lockerBay && <> · Locker <strong>{p.lockerBay}</strong>{p.lockerPin ? ` · PIN ${p.lockerPin}` : ""}</>}
                  </div>
                  {p.heldUntil && <div className="text-[12px] mt-1" style={{ color: c.rose }}>On hold until {p.heldUntil}</div>}
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => setShowQrFor(p)} className="text-[12px]" style={{ color: c.cobalt, fontWeight: 600 }}>Show QR</button>
                    <button onClick={() => setAuthFor(p)} className="text-[12px]" style={{ color: c.cobalt, fontWeight: 600 }}>
                      <ShieldCheck className="h-3.5 w-3.5 inline" /> Authorize pickup
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h3 className="text-[14px] mb-2" style={{ fontWeight: 700 }}>Vacation holds</h3>
          <div className="rounded-xl border p-4" style={{ background: c.panel, borderColor: c.border }}>
            <div className="flex flex-wrap gap-2 items-end">
              <Field label="From"><input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)}
                className="rounded-md border px-2 py-1.5 text-[13px]" style={{ borderColor: c.border, background: c.panel }} /></Field>
              <Field label="To"><input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)}
                className="rounded-md border px-2 py-1.5 text-[13px]" style={{ borderColor: c.border, background: c.panel }} /></Field>
              <Field label="Note (optional)"><input value={holdNote} onChange={(e) => setHoldNote(e.target.value)}
                className="rounded-md border px-2 py-1.5 text-[13px]" style={{ borderColor: c.border, background: c.panel }} /></Field>
              <button onClick={() => addHold.mutate()} disabled={!startsOn || !endsOn}
                className="rounded-md px-3 py-1.5 text-[13px]" style={{ background: c.emerald, color: "#fff", fontWeight: 600 }}>
                <Plus className="h-3.5 w-3.5 inline mr-1" /> Add hold
              </button>
            </div>
            <ul className="mt-3 space-y-1 text-[13px]">
              {holds.map((h) => (
                <li key={h.id} className="flex items-center justify-between rounded-md px-2 py-1" style={{ background: c.cobaltSoft }}>
                  <span>{h.startsOn} → {h.endsOn}{h.note ? ` · ${h.note}` : ""}</span>
                  <button onClick={() => delHold.mutate(h.id)} title="Cancel hold"><Trash2 className="h-3.5 w-3.5" style={{ color: c.rose }} /></button>
                </li>
              ))}
              {holds.length === 0 && <li style={{ color: c.inkMute }}>No upcoming holds.</li>}
            </ul>
          </div>
        </div>

        <div>
          <h3 className="text-[14px] mb-2" style={{ fontWeight: 700 }}>History</h3>
          <div className="rounded-xl border overflow-hidden" style={{ background: c.panel, borderColor: c.border }}>
            <table className="w-full text-[13px]">
              <thead style={{ background: c.cobaltSoft }}>
                <tr>
                  <th className="text-left px-3 py-2">Carrier / Size</th>
                  <th className="text-left px-3 py-2">Tracking</th>
                  <th className="text-left px-3 py-2">Picked up by</th>
                  <th className="text-left px-3 py-2">When</th>
                </tr>
              </thead>
              <tbody>
                {past.map((p) => (
                  <tr key={p.id} style={{ borderTop: `1px solid ${c.border}` }}>
                    <td className="px-3 py-2">{p.carrier} · {p.size}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">{p.trackingNumber || "—"}</td>
                    <td className="px-3 py-2">{p.pickedUpByName || "—"}</td>
                    <td className="px-3 py-2" style={{ color: c.inkMute }}>{fmt(p.pickedUpAt)}</td>
                  </tr>
                ))}
                {past.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center" style={{ color: c.inkMute }}>No prior packages.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showQrFor && (
        <Modal onClose={() => setShowQrFor(null)} title={`Pickup ${showQrFor.pickupCode}`}>
          <div className="text-center">
            <img src={`${base}/api/packages/${showQrFor.id}/qr.svg`} alt="Pickup QR" style={{ maxWidth: 280, margin: "0 auto" }} />
            <div className="mt-2 font-mono">{showQrFor.pickupCode}</div>
          </div>
        </Modal>
      )}
      {authFor && <AuthorizeModal pkg={authFor} onClose={() => setAuthFor(null)} />}
    </Layout>
  );
}

function AuthorizeModal({ pkg, onClose }: { pkg: Pkg; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(""); const [note, setNote] = useState("");
  const { data: existing = [] } = useQuery<Authz[]>({
    queryKey: ["/packages", pkg.id, "auth"],
    queryFn: () => apiFetch({ url: `/packages/${pkg.id}/authorizations`, method: "GET" }),
  });
  const create = useMutation({
    mutationFn: () => apiFetch({ url: `/packages/${pkg.id}/authorize-proxy`, method: "POST", data: { authorizedName: name, note } }),
    onSuccess: () => { setName(""); setNote(""); qc.invalidateQueries({ queryKey: ["/packages", pkg.id, "auth"] }); },
  });
  return (
    <Modal onClose={onClose} title={`Authorize someone to pick up ${pkg.pickupCode}`}>
      <div className="space-y-3 text-[13px]">
        <Field label="Authorized name (must match ID at pickup)"><input value={name} onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border px-2 py-1.5" style={{ borderColor: c.border, background: c.panel }} /></Field>
        <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-md border px-2 py-1.5" style={{ borderColor: c.border, background: c.panel }} /></Field>
        <button onClick={() => create.mutate()} disabled={!name}
          className="rounded-md px-3 py-1.5" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>Authorize</button>
        <div>
          <strong className="block mt-2 text-[12.5px]">Current authorizations:</strong>
          <ul className="text-[12.5px] mt-1 space-y-1">
            {existing.length === 0 && <li style={{ color: c.inkMute }}>None.</li>}
            {existing.map((a) => <li key={a.id}>{a.authorizedName}{a.note ? ` — ${a.note}` : ""}</li>)}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="w-full max-w-md rounded-xl border shadow-xl" style={{ background: c.panel, borderColor: c.border }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${c.border}` }}>
          <strong className="text-[14px]">{title}</strong>
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
