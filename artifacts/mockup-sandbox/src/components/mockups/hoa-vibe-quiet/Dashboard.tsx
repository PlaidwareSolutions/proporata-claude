import {
  LayoutDashboard, Building2, Home, ClipboardList, FileText, ShieldCheck, BarChart3, Settings,
  Search, Bell, Plus, Upload, CalendarClock, ArrowUpRight, ArrowDownRight,
  Droplets, Wrench, Mail, CalendarCheck, FileCheck2, Receipt, ChevronRight, Command,
} from "lucide-react";

const fontStyle = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
.font-q { font-family: 'Inter', system-ui, sans-serif; letter-spacing: -0.005em; }
.font-mono-num { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.tabular { font-variant-numeric: tabular-nums; }
`;

type S = "good" | "watch" | "urgent";

const c = {
  canvas: "#FAFAF9",
  panel: "#FFFFFF",
  sidebar: "#FFFFFF",
  ink: "#1A1A1A",
  inkSoft: "#52525B",
  inkMute: "#A1A1AA",
  border: "#EFEFEC",
  borderSoft: "#F4F4F1",
  hair: "#E8E8E4",
  accent: "#1A1A1A",
  accentSoft: "#F4F4F1",
  good: "#5C6B5A",
  watch: "#9E8855",
  urgent: "#9C5347",
};

const tone: Record<S, { dot: string; label: string }> = {
  good: { dot: c.good, label: "Healthy" },
  watch: { dot: c.watch, label: "Watch" },
  urgent: { dot: c.urgent, label: "Urgent" },
};

const buildings: { num: number; units: number; status: S; openWO: number }[] = [
  { num: 1, units: 6, status: "good", openWO: 0 }, { num: 2, units: 6, status: "good", openWO: 1 },
  { num: 3, units: 6, status: "watch", openWO: 2 }, { num: 4, units: 5, status: "good", openWO: 0 },
  { num: 5, units: 5, status: "urgent", openWO: 3 }, { num: 6, units: 6, status: "good", openWO: 1 },
  { num: 7, units: 6, status: "good", openWO: 0 }, { num: 8, units: 5, status: "watch", openWO: 1 },
  { num: 9, units: 6, status: "urgent", openWO: 4 }, { num: 10, units: 6, status: "good", openWO: 0 },
  { num: 11, units: 5, status: "good", openWO: 1 }, { num: 12, units: 6, status: "watch", openWO: 2 },
  { num: 13, units: 5, status: "good", openWO: 0 }, { num: 14, units: 6, status: "urgent", openWO: 2 },
  { num: 15, units: 5, status: "good", openWO: 0 }, { num: 16, units: 6, status: "good", openWO: 1 },
  { num: 17, units: 5, status: "watch", openWO: 1 }, { num: 18, units: 6, status: "good", openWO: 0 },
  { num: 19, units: 5, status: "good", openWO: 0 }, { num: 20, units: 6, status: "watch", openWO: 1 },
  { num: 21, units: 5, status: "good", openWO: 0 }, { num: 22, units: 6, status: "watch", openWO: 1 },
  { num: 23, units: 5, status: "good", openWO: 0 }, { num: 24, units: 6, status: "good", openWO: 1 },
  { num: 25, units: 6, status: "good", openWO: 0 },
];

const kpis = [
  { label: "Total Units", value: "144", delta: "100%", trend: "flat" as const, hint: "Tracked" },
  { label: "Buildings", value: "25", delta: "—", trend: "flat" as const, hint: "All mapped" },
  { label: "Open Work Orders", value: "17", delta: "−4", trend: "down" as const, hint: "vs last 7d" },
  { label: "Urgent Issues", value: "3", delta: "+1", trend: "up" as const, hint: "Board review" },
  { label: "Missing Insurance", value: "8", delta: "−2", trend: "down" as const, hint: "Declarations" },
  { label: "Roof Attention", value: "6", delta: "+1", trend: "up" as const, hint: "Inspection flag" },
];

const activity = [
  { icon: Droplets, title: "Roof leak reported · 2828 Camelot Lane", meta: "Building 9", time: "12m", tone: "urgent" as S },
  { icon: FileCheck2, title: "Insurance declaration uploaded · 2803 Cambridge", meta: "Building 18", time: "2h", tone: "good" as S },
  { icon: Wrench, title: "WO-1043 closed · Building 9", meta: "Atlas Roofing", time: "1d", tone: "good" as S },
  { icon: Mail, title: "Correspondence added · 2832 Camelot Lane", meta: "Notice", time: "1d", tone: "watch" as S },
  { icon: CalendarCheck, title: "Roof inspection scheduled · Building 14", meta: "Wed May 7", time: "2d", tone: "watch" as S },
  { icon: Receipt, title: "Vendor quote received · Building 22 exterior", meta: "$8,450", time: "3d", tone: "good" as S },
];

const navSections = [
  { label: "Overview", items: [{ icon: LayoutDashboard, label: "Dashboard", active: true }, { icon: BarChart3, label: "Reports" }] },
  { label: "Property", items: [{ icon: Building2, label: "Buildings" }, { icon: Home, label: "Units" }] },
  { label: "Operations", items: [{ icon: ClipboardList, label: "Work Orders", badge: 17 }, { icon: ShieldCheck, label: "Insurance", badge: 8 }, { icon: FileText, label: "Documents" }] },
  { label: "Workspace", items: [{ icon: Settings, label: "Settings" }] },
];

function Sparkline({ color }: { color: string }) {
  const pts = [12, 9, 14, 11, 16, 10, 8, 12, 7, 9, 6];
  const w = 64, h = 22;
  const max = Math.max(...pts), min = Math.min(...pts);
  const path = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = h - ((v - min) / (max - min || 1)) * h;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}><path d={path} stroke={color} strokeWidth={1} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.55} /></svg>;
}

function KpiCard({ label, value, delta, trend, hint }: (typeof kpis)[number]) {
  const trendColor = trend === "up" ? c.urgent : trend === "down" ? c.good : c.inkMute;
  const TrendIcon = trend === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="rounded-md border bg-white p-5" style={{ borderColor: c.hair }}>
      <div className="flex items-start justify-between">
        <span className="font-q text-[11px]" style={{ color: c.inkMute }}>{label}</span>
        <span className="font-mono-num inline-flex items-center gap-1 text-[10.5px]" style={{ color: trendColor }}>
          {trend !== "flat" && <TrendIcon className="h-2.5 w-2.5" strokeWidth={1.5} />}{delta}
        </span>
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div className="font-q tabular text-[34px] leading-none" style={{ color: c.ink, fontWeight: 400, letterSpacing: "-0.025em" }}>{value}</div>
        <Sparkline color={trend === "up" ? c.urgent : trend === "down" ? c.good : c.inkMute} />
      </div>
      <div className="font-q mt-3 text-[11.5px]" style={{ color: c.inkSoft }}>{hint}</div>
    </div>
  );
}

function BuildingTile({ num, units, status, openWO }: (typeof buildings)[number]) {
  const t = tone[status];
  return (
    <button className="group relative flex flex-col gap-2 rounded-md border p-3 text-left transition-colors hover:bg-[#FAFAF9]"
      style={{ background: c.panel, borderColor: c.hair }}>
      <div className="flex items-center justify-between">
        <span className="font-mono-num text-[10px]" style={{ color: c.inkMute }}>B{String(num).padStart(2, "0")}</span>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.dot }} />
      </div>
      <div className="font-q tabular text-[20px] leading-none" style={{ color: c.ink, fontWeight: 500, letterSpacing: "-0.02em" }}>{num}</div>
      <div className="flex items-center justify-between">
        <span className="font-mono-num text-[10px]" style={{ color: c.inkMute }}>{units}u</span>
        {openWO > 0 && (
          <span className="font-mono-num text-[10px]" style={{ color: c.inkSoft }}>{openWO} open</span>
        )}
      </div>
    </button>
  );
}

export function Dashboard() {
  return (
    <>
      <style>{fontStyle}</style>
      <div className="font-q min-h-screen" style={{ background: c.canvas, color: c.ink }}>
        <div className="flex">
          <aside className="sticky top-0 flex h-screen w-[236px] shrink-0 flex-col border-r" style={{ background: c.sidebar, borderColor: c.hair }}>
            <div className="px-5 pt-6 pb-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-md border" style={{ borderColor: c.hair }}>
                  <span className="font-q text-[12px]" style={{ fontWeight: 500 }}>QV</span>
                </div>
                <div>
                  <div className="text-[13px]" style={{ fontWeight: 500 }}>Quail Valley HOA</div>
                  <div className="font-mono-num text-[10px]" style={{ color: c.inkMute }}>144 units · 25 bldgs</div>
                </div>
              </div>
            </div>
            <div className="mx-4 mb-5 flex items-center gap-2 rounded-md border px-2.5 py-1.5" style={{ borderColor: c.hair }}>
              <Search className="h-3.5 w-3.5" style={{ color: c.inkMute }} />
              <span className="font-q text-[11.5px]" style={{ color: c.inkMute }}>Search</span>
              <span className="ml-auto inline-flex items-center gap-0.5">
                <Command className="h-2.5 w-2.5" style={{ color: c.inkMute }} />
                <span className="font-mono-num text-[10px]" style={{ color: c.inkMute }}>K</span>
              </span>
            </div>
            <nav className="flex-1 space-y-5 px-3">
              {navSections.map((s) => (
                <div key={s.label}>
                  <div className="px-2 pb-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: c.inkMute }}>{s.label}</div>
                  {s.items.map((item: any) => {
                    const Icon = item.icon;
                    return (
                      <button key={item.label} className="mb-0.5 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left"
                        style={item.active ? { background: c.accentSoft, color: c.ink } : { color: c.inkSoft }}>
                        <span className="flex items-center gap-2.5">
                          <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                          <span className="font-q text-[12.5px]" style={{ fontWeight: item.active ? 500 : 400 }}>{item.label}</span>
                        </span>
                        {item.badge && <span className="font-mono-num text-[10px]" style={{ color: c.inkMute }}>{item.badge}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
            <div className="border-t px-5 py-4" style={{ borderColor: c.hair }}>
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-full border font-q text-[11px]" style={{ borderColor: c.hair, color: c.ink, fontWeight: 500 }}>EM</div>
                <div className="min-w-0 flex-1">
                  <div className="font-q truncate text-[12px]" style={{ color: c.ink, fontWeight: 500 }}>Eleanor Marsh</div>
                  <div className="font-q truncate text-[10.5px]" style={{ color: c.inkMute }}>Treasurer</div>
                </div>
              </div>
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b px-8 py-4" style={{ background: c.canvas, borderColor: c.hair }}>
              <div className="flex items-center gap-3">
                <h1 className="font-q text-[17px]" style={{ color: c.ink, fontWeight: 500, letterSpacing: "-0.015em" }}>Dashboard</h1>
                <span className="font-mono-num text-[10.5px]" style={{ color: c.inkMute }}>Live · synced 2m ago</span>
              </div>
              <div className="flex items-center gap-2.5">
                <button className="font-q inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px]" style={{ borderColor: c.hair, background: c.panel, color: c.inkSoft }}>
                  <Upload className="h-3.5 w-3.5" strokeWidth={1.5} /> Upload
                </button>
                <button className="font-q inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px]" style={{ background: c.ink, color: "#fff", fontWeight: 500 }}>
                  <Plus className="h-3.5 w-3.5" /> New Work Order
                </button>
                <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-full border" style={{ borderColor: c.hair, background: c.panel, color: c.inkSoft }}>
                  <Bell className="h-3.5 w-3.5" strokeWidth={1.5} />
                </div>
              </div>
            </header>

            <div className="px-8 py-7">
              <div className="mb-6 flex items-center gap-3 rounded-md border px-5 py-3.5" style={{ background: c.panel, borderColor: c.hair }}>
                <div className="h-1.5 w-1.5 rounded-full" style={{ background: c.good }} />
                <p className="font-q flex-1 text-[13px]" style={{ color: c.ink }}>
                  Centralized visibility across buildings, units, documents, insurance, and maintenance.
                </p>
                <span className="font-mono-num text-[10.5px]" style={{ color: c.inkMute }}>Last sync · 2m ago</span>
              </div>

              <div className="grid grid-cols-6 gap-4">
                {kpis.map((k) => <KpiCard key={k.label} {...k} />)}
              </div>

              <div className="mt-7 grid grid-cols-3 gap-5">
                <section className="col-span-2 rounded-md border p-6" style={{ background: c.panel, borderColor: c.hair }}>
                  <div className="mb-5 flex items-end justify-between">
                    <div>
                      <div className="font-q text-[11px]" style={{ color: c.inkMute }}>Property Health</div>
                      <h2 className="font-q mt-1 text-[16px]" style={{ color: c.ink, fontWeight: 500, letterSpacing: "-0.015em" }}>25 buildings</h2>
                    </div>
                    <div className="flex items-center gap-4">
                      {(["good", "watch", "urgent"] as S[]).map((s) => {
                        const t = tone[s];
                        const count = buildings.filter((b) => b.status === s).length;
                        return (
                          <span key={s} className="flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.dot }} />
                            <span className="font-q text-[11.5px]" style={{ color: c.inkSoft }}>{t.label}</span>
                            <span className="font-mono-num text-[11.5px]" style={{ color: c.ink, fontWeight: 500 }}>{count}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-2.5">
                    {buildings.map((b) => <BuildingTile key={b.num} {...b} />)}
                  </div>
                </section>

                <section className="rounded-md border p-6" style={{ background: c.panel, borderColor: c.hair }}>
                  <div className="mb-4 flex items-baseline justify-between">
                    <div>
                      <div className="font-q text-[11px]" style={{ color: c.inkMute }}>Recent activity</div>
                      <h2 className="font-q mt-1 text-[16px]" style={{ color: c.ink, fontWeight: 500, letterSpacing: "-0.015em" }}>Today & this week</h2>
                    </div>
                    <button className="font-q text-[11.5px]" style={{ color: c.ink, fontWeight: 500 }}>View all</button>
                  </div>
                  <ul className="divide-y" style={{ borderColor: c.hair }}>
                    {activity.map((a, i) => {
                      const Icon = a.icon;
                      return (
                        <li key={i} className="flex gap-3 border-t py-3 first:border-t-0 first:pt-0" style={{ borderColor: c.hair }}>
                          <Icon className="h-4 w-4 mt-0.5 shrink-0" strokeWidth={1.4} style={{ color: c.inkMute }} />
                          <div className="min-w-0 flex-1">
                            <div className="font-q text-[12px] leading-snug" style={{ color: c.ink }}>{a.title}</div>
                            <div className="font-q mt-0.5 text-[10.5px]" style={{ color: c.inkMute }}>{a.meta} · {a.time}</div>
                          </div>
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 self-center" style={{ color: c.inkMute }} />
                        </li>
                      );
                    })}
                  </ul>
                  <button className="font-q mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-md border py-1.5 text-[11.5px]" style={{ borderColor: c.hair, color: c.inkSoft }}>
                    <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.5} /> Activity log
                  </button>
                </section>
              </div>

              <div className="mt-7 flex items-center justify-between text-[10.5px]" style={{ color: c.inkMute }}>
                <span className="font-mono-num">v2.1.0</span>
                <span className="font-q">Quail Valley · Sugar Land, TX · 144 units · 25 buildings</span>
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
