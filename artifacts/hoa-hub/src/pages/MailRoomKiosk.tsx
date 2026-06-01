// Task #87: Mail-room kiosk — code/QR scan → reveal pickup details and confirm.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { apiFetch } from "@/lib/apiFetch";
import { Package as PackageIcon, CheckCircle2, AlertCircle } from "lucide-react";

type Pkg = {
  id: number; unitId: string; recipientName: string;
  carrier: string; trackingNumber: string; size: string;
  pickupCode: string; lockerBay: string | null; lockerPin: string | null;
  status: string; heldUntil: string | null;
};

export default function MailRoomKiosk() {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [pkg, setPkg] = useState<Pkg | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const lookup = useMutation({
    mutationFn: () => apiFetch<Pkg>({ url: "/packages/lookup", method: "POST", data: { code } }),
    onSuccess: (p) => { setPkg(p); setErr(null); setName(p.recipientName); },
    onError: (e: Error) => { setErr(e.message); setPkg(null); },
  });
  const pickup = useMutation({
    mutationFn: () => apiFetch<Pkg>({
      url: `/packages/${pkg!.id}/pickup`, method: "POST",
      data: { code: pkg!.pickupCode, pickedUpByName: name },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/packages"] }); setCode(""); setPkg(null); setName(""); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Layout title="Mail Room — Kiosk" subtitle="Scan or enter pickup code.">
      <div className="max-w-md mx-auto space-y-4">
        {!pkg && (
          <div className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
            <label className="block text-[12px] uppercase tracking-wider mb-1" style={{ color: c.inkMute, fontWeight: 700 }}>
              Pickup code
            </label>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="PKG-XXXX-XXXX" autoFocus
              className="w-full rounded-md border px-3 py-3 text-[18px] font-mono"
              style={{ borderColor: c.border, background: c.panel }} />
            <button onClick={() => { setErr(null); lookup.mutate(); }} disabled={!code || lookup.isPending}
              className="mt-3 w-full rounded-md py-3 text-[14px]"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
              {lookup.isPending ? "Looking up…" : "Look up package"}
            </button>
            {err && <div className="mt-2 text-[13px]" style={{ color: c.rose }}>
              <AlertCircle className="h-4 w-4 inline mr-1" /> {err}</div>}
          </div>
        )}

        {pkg && (
          <div className="rounded-xl border p-5 space-y-3" style={{ background: c.panel, borderColor: c.border }}>
            <div className="flex items-center gap-2">
              <PackageIcon className="h-5 w-5" style={{ color: c.cobalt }} />
              <strong className="text-[16px]">{pkg.recipientName} · Unit {pkg.unitId}</strong>
            </div>
            <div className="text-[13px]" style={{ color: c.inkSoft }}>
              {pkg.carrier} · {pkg.size}{pkg.trackingNumber ? ` · ${pkg.trackingNumber}` : ""}
            </div>
            {pkg.lockerBay && (
              <div className="rounded-md p-3" style={{ background: c.cobaltSoft }}>
                Locker <strong>{pkg.lockerBay}</strong>{pkg.lockerPin ? ` · PIN ${pkg.lockerPin}` : ""}
              </div>
            )}
            <label className="block text-[12px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>
              Picked up by (sign your name)
            </label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-[14px]"
              style={{ borderColor: c.border, background: c.panel }} />
            {err && <div className="text-[13px]" style={{ color: c.rose }}>{err}</div>}
            <div className="flex gap-2">
              <button onClick={() => { setPkg(null); setErr(null); }} className="rounded-md px-4 py-2 text-[13px]"
                style={{ color: c.inkSoft }}>Cancel</button>
              <button onClick={() => pickup.mutate()} disabled={!name || pickup.isPending}
                className="ml-auto rounded-md px-4 py-2 text-[13px]"
                style={{ background: c.emerald, color: "#fff", fontWeight: 600 }}>
                <CheckCircle2 className="h-4 w-4 inline mr-1" />
                {pickup.isPending ? "Releasing…" : "Confirm pickup"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
