import { useState } from "react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { ShieldCheck, ShieldAlert, ShieldOff, ChevronDown, ChevronRight } from "lucide-react";
import { useListInsurance, useListBuildings } from "@workspace/api-client-react";
import { InsuranceHistorySection } from "@/components/InsuranceHistorySection";
import { useAuth } from "@/contexts/AuthContext";
import { InfoPopover } from "@/components/help/InfoPopover";

export default function Insurance() {
  const { data: insurance = [], isLoading } = useListInsurance();
  const { data: buildings = [] } = useListBuildings();
  const [expanded, setExpanded] = useState<number | null>(null);
  const { user } = useAuth();
  const canEditHistorical = user?.role === "admin" || user?.role === "manager";

  const totalCoverage = insurance.reduce((s, p) => s + p.coverage, 0);
  const totalPremium = insurance.reduce((s, p) => s + p.premium, 0);
  const expiring = insurance.filter((p) => p.status === "expiring").length;
  const missing = insurance.filter((p) => p.status === "missing").length;

  return (
    <Layout title="Insurance" subtitle="Master & per-building policies">
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Stat label="Total coverage" value={`$${(totalCoverage/1_000_000).toFixed(1)}M`} icon={ShieldCheck} accent={c.cobalt} />
        <Stat label="Annual premium" value={`$${totalPremium.toLocaleString()}`} icon={ShieldCheck} accent={c.ink} />
        <Stat label="Expiring soon" value={String(expiring)} icon={ShieldAlert} accent={c.amber} />
        <Stat label="Missing" value={String(missing)} icon={ShieldOff} accent={c.rose} termKey="insurance-gap" />
      </div>

      <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
        {isLoading ? (
          <div className="py-16 text-center text-[13px]" style={{ color: c.inkMute }}>Loading policies…</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead style={{ background: c.canvas }}>
              <tr style={{ color: c.inkMute }} className="text-left text-[11px] uppercase tracking-wider">
                <th className="px-4 py-3" style={{ fontWeight: 700 }}>Bldg</th>
                <th className="px-4 py-3" style={{ fontWeight: 700 }}>Address</th>
                <th className="px-4 py-3" style={{ fontWeight: 700 }}>Carrier</th>
                <th className="px-4 py-3" style={{ fontWeight: 700 }}>Policy #</th>
                <th className="px-4 py-3" style={{ fontWeight: 700 }}>
                  <span className="inline-flex items-center gap-0.5">Coverage <InfoPopover termKey="declaration-page" label="Coverage" /></span>
                </th>
                <th className="px-4 py-3" style={{ fontWeight: 700 }}>Premium</th>
                <th className="px-4 py-3" style={{ fontWeight: 700 }}>Expires</th>
                <th className="px-4 py-3" style={{ fontWeight: 700 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {insurance.map((p) => {
                const b = buildings.find((bb) => bb.num === p.building);
                const color = p.status === "current" ? c.emerald : p.status === "expiring" ? c.amber : c.rose;
                const bg = p.status === "current" ? c.emeraldSoft : p.status === "expiring" ? c.amberSoft : c.roseSoft;
                const isOpen = expanded === p.building;
                return (
                  <>
                    <tr key={p.policyNo} className="border-t hover:bg-slate-50 cursor-pointer" style={{ borderColor: c.borderSoft }} onClick={() => setExpanded(isOpen ? null : p.building)}>
                      <td className="px-4 py-2.5 font-mono-num" style={{ fontWeight: 700 }}>
                        <span className="inline-flex items-center gap-1">
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          {String(p.building).padStart(2,"0")}
                        </span>
                      </td>
                      <td className="px-4 py-2.5" style={{ color: c.ink, fontWeight: 500 }}>{b?.address ?? "—"}</td>
                      <td className="px-4 py-2.5" style={{ color: c.inkSoft }}>{p.carrier}</td>
                      <td className="px-4 py-2.5 font-mono-num" style={{ color: c.inkSoft }}>{p.policyNo}</td>
                      <td className="px-4 py-2.5 font-mono-num text-right" style={{ color: c.ink, fontWeight: 600 }}>${p.coverage.toLocaleString()}</td>
                      <td className="px-4 py-2.5 font-mono-num text-right" style={{ color: c.inkSoft }}>${p.premium.toLocaleString()}</td>
                      <td className="px-4 py-2.5 font-mono-num" style={{ color, fontWeight: p.status !== "current" ? 700 : 500 }}>{p.expires}</td>
                      <td className="px-4 py-2.5">
                        <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: bg, color, fontWeight: 700 }}>
                          {p.status.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr style={{ background: c.canvas }}>
                        <td colSpan={8} className="px-4 py-3 border-t" style={{ borderColor: c.borderSoft }}>
                          <InsuranceHistorySection building={p.building} canEdit={canEditHistorical} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}

function Stat({ label, value, icon: Icon, accent, termKey }: { label: string; value: string; icon: any; accent: string; termKey?: string }) {
  return (
    <div className="rounded-xl border bg-white p-4" style={{ borderColor: c.border }}>
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold uppercase tracking-wider inline-flex items-center gap-0.5" style={{ color: c.inkSoft }}>
          {label}
          {termKey ? <InfoPopover termKey={termKey} label={label} /> : null}
        </div>
        <div className="flex h-7 w-7 items-center justify-center rounded-md" style={{ background: accent + "1F", color: accent }}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="font-mono-num mt-2 text-[24px] leading-none" style={{ color: accent, fontWeight: 700, letterSpacing: "-0.02em" }}>
        {value}
      </div>
    </div>
  );
}
