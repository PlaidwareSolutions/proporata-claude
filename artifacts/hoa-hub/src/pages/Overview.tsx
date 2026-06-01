import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { c, statusColor } from "@/lib/theme";
import { TrendingUp, AlertTriangle, ClipboardList, ShieldCheck, ArrowRight, Plus } from "lucide-react";
import { useListBuildings, useListWorkOrders, useListInsurance } from "@workspace/api-client-react";
import { MotionsAwaitingVoteWidget } from "@/components/MotionsAwaitingVoteWidget";
import { useAuth } from "@/contexts/AuthContext";

export default function Overview() {
  const { data: buildings = [] } = useListBuildings();
  const { data: workOrders = [] } = useListWorkOrders();
  const { data: insurance = [] } = useListInsurance();
  const { user } = useAuth();
  const isManager = user?.role === "admin" || user?.role === "manager";

  const recent = workOrders.slice(0, 6);
  const upcomingExpiry = insurance
    .filter((i) => i.status !== "current" && i.expires !== "—")
    .sort((a, b) => a.expires.localeCompare(b.expires))
    .slice(0, 5);

  const woByCategory = workOrders
    .filter((w) => w.status !== "done")
    .reduce<Record<string, number>>((acc, w) => {
      acc[w.category] = (acc[w.category] || 0) + 1;
      return acc;
    }, {});

  const maxCat = Math.max(...Object.values(woByCategory), 1);

  const openWO = workOrders.filter((w) => w.status !== "done").length;
  const urgent = workOrders.filter((w) => w.priority === "urgent" && w.status !== "done").length;
  const insuranceGaps = insurance.filter((i) => i.status !== "current").length;
  const resolved = workOrders.filter((w) => w.status === "done").length;

  return (
    <Layout
      title="Overview"
      subtitle="Operational health, last 30 days"
      actions={
        isManager ? (
          <Link
            href="/work-orders/new"
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] hover:opacity-90"
            style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
            data-testid="button-new-wo"
          >
            <Plus className="h-4 w-4" /> New Work Order
          </Link>
        ) : null
      }
    >
      <MotionsAwaitingVoteWidget />
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Stat label="Open work orders" value={openWO} icon={ClipboardList} accent={c.cobalt} />
        <Stat label="Urgent items" value={urgent} icon={AlertTriangle} accent={c.rose} />
        <Stat label="Insurance gaps" value={insuranceGaps} icon={ShieldCheck} accent={c.amber} />
        <Stat label="Resolved this month" value={resolved} icon={TrendingUp} accent={c.emerald} />
      </div>

      <div className="grid grid-cols-3 gap-5">
        <section className="col-span-2 rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[15px]" style={{ fontWeight: 700 }}>Recent activity</h3>
            <span className="text-[12px]" style={{ color: c.inkMute, fontWeight: 500 }}>Last 7 days</span>
          </div>
          <ul className="space-y-3">
            {recent.map((w) => {
              const b = buildings.find((bb) => bb.num === w.building);
              const pri =
                w.priority === "urgent" ? c.rose
                : w.priority === "high" ? c.amber
                : w.priority === "med" ? c.cobalt
                : c.inkMute;
              return (
                <li key={w.id} className="flex items-center gap-3 border-b pb-3 last:border-0 last:pb-0" style={{ borderColor: c.borderSoft }}>
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-md font-mono-num text-[12px]"
                    style={{ background: "#F1F3FA", color: c.inkSoft, fontWeight: 700 }}
                  >
                    {String(w.building).padStart(2, "0")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] truncate" style={{ fontWeight: 600 }}>{w.title}</div>
                    <div className="text-[12px] mt-0.5" style={{ color: c.inkSoft, fontWeight: 500 }}>
                      {b?.address ?? "—"} · {w.category} · {w.status.replace("_", " ")}
                    </div>
                  </div>
                  <span className="font-mono-num text-[11px] rounded px-1.5 py-0.5" style={{ background: pri + "1F", color: pri, fontWeight: 700 }}>
                    {w.priority.toUpperCase()}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
          <h3 className="text-[15px] mb-4" style={{ fontWeight: 700 }}>Open WO by category</h3>
          <div className="space-y-3">
            {Object.entries(woByCategory).sort((a, b) => b[1] - a[1]).map(([cat, n]) => (
              <div key={cat}>
                <div className="flex items-center justify-between text-[13px] mb-1">
                  <span style={{ color: c.inkSoft, fontWeight: 500 }}>{cat}</span>
                  <span className="font-mono-num" style={{ fontWeight: 700 }}>{n}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: c.borderSoft }}>
                  <div className="h-full rounded-full" style={{ width: `${(n / maxCat) * 100}%`, background: c.cobalt }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="mt-5 rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px]" style={{ fontWeight: 700 }}>Insurance attention queue</h3>
          <a href="/insurance" className="text-[13px] inline-flex items-center gap-1" style={{ color: c.cobalt, fontWeight: 600 }}>
            View all <ArrowRight className="h-4 w-4" />
          </a>
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ color: c.inkMute }} className="text-left text-[11px] uppercase tracking-wider">
              <th className="py-2" style={{ fontWeight: 700 }}>Bldg</th>
              <th style={{ fontWeight: 700 }}>Address</th>
              <th style={{ fontWeight: 700 }}>Carrier</th>
              <th style={{ fontWeight: 700 }}>Policy</th>
              <th style={{ fontWeight: 700 }}>Expires</th>
              <th style={{ fontWeight: 700 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {upcomingExpiry.map((p) => {
              const b = buildings.find((bb) => bb.num === p.building);
              const color = p.status === "missing" ? c.rose : c.amber;
              const bg = p.status === "missing" ? c.roseSoft : c.amberSoft;
              return (
                <tr key={p.policyNo} className="border-t" style={{ borderColor: c.borderSoft }}>
                  <td className="py-2.5 font-mono-num" style={{ fontWeight: 700 }}>{String(p.building).padStart(2,"0")}</td>
                  <td style={{ color: c.inkSoft }}>{b?.address ?? "—"}</td>
                  <td style={{ color: c.inkSoft }}>{p.carrier}</td>
                  <td className="font-mono-num" style={{ color: c.inkSoft }}>{p.policyNo}</td>
                  <td className="font-mono-num" style={{ color: c.inkSoft }}>{p.expires}</td>
                  <td>
                    <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: bg, color, fontWeight: 700 }}>
                      {p.status.toUpperCase()}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </Layout>
  );
}

function Stat({ label, value, icon: Icon, accent }: { label: string; value: number; icon: any; accent: string }) {
  return (
    <div className="rounded-xl border bg-white p-4" style={{ borderColor: c.border }}>
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: c.inkSoft }}>{label}</div>
        <div className="flex h-7 w-7 items-center justify-center rounded-md" style={{ background: accent + "1F", color: accent }}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="font-mono-num mt-2 text-[28px] leading-none" style={{ color: accent, fontWeight: 700, letterSpacing: "-0.02em" }}>
        {value}
      </div>
    </div>
  );
}
