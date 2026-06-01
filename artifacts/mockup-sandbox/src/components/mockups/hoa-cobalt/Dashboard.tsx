import {
  LayoutDashboard,
  Building2,
  Home,
  ClipboardList,
  FileText,
  ShieldCheck,
  BarChart3,
  Settings,
  Search,
  Bell,
  Plus,
  Upload,
  CalendarClock,
  ArrowUpRight,
  ArrowDownRight,
  Droplets,
  Wrench,
  Mail,
  CalendarCheck,
  FileCheck2,
  Receipt,
  ChevronRight,
  Command,
  Zap,
} from "lucide-react";

const fontStyle = `
@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
.font-sans-tight { font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; letter-spacing: -0.01em; }
.font-mono-num { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.tabular { font-variant-numeric: tabular-nums; }
`;

type HealthStatus = "good" | "watch" | "urgent";

const palette = {
  canvas: "#F6F7FB",
  panel: "#FFFFFF",
  sidebar: "#0B1020",
  sidebarMute: "#A4ACC4",
  sidebarBorder: "#1A2140",
  ink: "#0B1020",
  inkSoft: "#3F4661",
  inkMute: "#7A819B",
  border: "#E5E8F2",
  borderSoft: "#EFF1F8",
  cobalt: "#3245FF",
  cobaltSoft: "#E5E8FF",
  emerald: "#10A37F",
  emeraldSoft: "#DCF3EC",
  amber: "#C8851A",
  amberSoft: "#FBEFD6",
  rose: "#D6315B",
  roseSoft: "#FBE3E9",
};

const statusTone: Record<HealthStatus, { dot: string; bg: string; label: string; text: string; ring: string }> = {
  good: { dot: palette.emerald, bg: palette.emeraldSoft, label: "Healthy", text: "#0A6E55", ring: "rgba(16,163,127,0.25)" },
  watch: { dot: palette.amber, bg: palette.amberSoft, label: "Watch", text: "#7B5410", ring: "rgba(200,133,26,0.25)" },
  urgent: { dot: palette.rose, bg: palette.roseSoft, label: "Urgent", text: "#8C1B36", ring: "rgba(214,49,91,0.25)" },
};

const buildings: { num: number; units: number; status: HealthStatus; openWO: number }[] = [
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
  { icon: Droplets, title: "Roof leak reported · 2828 Camelot Lane", meta: "Building 9 · Reported by board", time: "12m", tone: "urgent" as HealthStatus },
  { icon: FileCheck2, title: "Insurance declaration uploaded · 2803 Cambridge", meta: "Building 18 · Policy 2026", time: "2h", tone: "good" as HealthStatus },
  { icon: Wrench, title: "WO-1043 closed · Building 9", meta: "Roof patch by Atlas Roofing", time: "1d", tone: "good" as HealthStatus },
  { icon: Mail, title: "Correspondence added · 2832 Camelot Lane", meta: "HOA notice acknowledged", time: "1d", tone: "watch" as HealthStatus },
  { icon: CalendarCheck, title: "Roof inspection scheduled · Building 14", meta: "Wed May 7 · Pinnacle Inspections", time: "2d", tone: "watch" as HealthStatus },
  { icon: Receipt, title: "Vendor quote received · Building 22 exterior", meta: "$8,450 · Cedar & Stone Painting", time: "3d", tone: "good" as HealthStatus },
];

const navSections = [
  {
    label: "Overview",
    items: [
      { icon: LayoutDashboard, label: "Dashboard", active: true },
      { icon: BarChart3, label: "Reports" },
    ],
  },
  {
    label: "Property",
    items: [
      { icon: Building2, label: "Buildings" },
      { icon: Home, label: "Units" },
    ],
  },
  {
    label: "Operations",
    items: [
      { icon: ClipboardList, label: "Work Orders", badge: 17 },
      { icon: ShieldCheck, label: "Insurance", badge: 8 },
      { icon: FileText, label: "Documents" },
    ],
  },
  {
    label: "Workspace",
    items: [{ icon: Settings, label: "Settings" }],
  },
];

function Sparkline({ color }: { color: string }) {
  const pts = [12, 9, 14, 11, 16, 10, 8, 12, 7, 9, 6];
  const w = 64, h = 22;
  const max = Math.max(...pts), min = Math.min(...pts);
  const path = pts
    .map((v, i) => {
      const x = (i / (pts.length - 1)) * w;
      const y = h - ((v - min) / (max - min || 1)) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-90">
      <path d={path} stroke={color} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function KpiCard({ label, value, delta, trend, hint }: (typeof kpis)[number]) {
  const trendColor = trend === "up" ? palette.rose : trend === "down" ? palette.emerald : palette.inkMute;
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : ArrowUpRight;
  return (
    <div
      className="group relative overflow-hidden rounded-xl border p-4 transition-all hover:border-opacity-100"
      style={{ background: palette.panel, borderColor: palette.border }}
    >
      <div className="flex items-start justify-between">
        <span className="font-sans-tight text-[11px] font-medium uppercase tracking-wider" style={{ color: palette.inkMute }}>
          {label}
        </span>
        <span
          className="font-mono-num inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
          style={{ background: palette.borderSoft, color: trendColor }}
        >
          {trend !== "flat" && <TrendIcon className="h-2.5 w-2.5" />}
          {delta}
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div className="font-sans-tight tabular text-[32px] leading-none" style={{ color: palette.ink, fontWeight: 700, letterSpacing: "-0.03em" }}>
          {value}
        </div>
        <Sparkline color={trend === "up" ? palette.rose : trend === "down" ? palette.emerald : palette.cobalt} />
      </div>
      <div className="font-sans-tight mt-2 text-[11.5px]" style={{ color: palette.inkSoft }}>
        {hint}
      </div>
    </div>
  );
}

function BuildingTile({ num, units, status, openWO }: (typeof buildings)[number]) {
  const tone = statusTone[status];
  return (
    <button
      className="group relative flex flex-col gap-2 rounded-lg border p-2.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm"
      style={{ background: palette.panel, borderColor: palette.border }}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono-num text-[10.5px] font-medium" style={{ color: palette.inkMute }}>
          B{String(num).padStart(2, "0")}
        </span>
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: tone.dot, boxShadow: `0 0 0 3px ${tone.ring}` }}
        />
      </div>
      <div className="font-sans-tight tabular text-[20px] leading-none" style={{ color: palette.ink, fontWeight: 700, letterSpacing: "-0.02em" }}>
        {num}
      </div>
      <div className="flex items-center justify-between">
        <span className="font-mono-num text-[10px]" style={{ color: palette.inkSoft }}>
          {units}u
        </span>
        {openWO > 0 && (
          <span
            className="font-mono-num inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9.5px] font-medium"
            style={{ background: tone.bg, color: tone.text }}
          >
            {openWO} WO
          </span>
        )}
      </div>
    </button>
  );
}

export function Dashboard() {
  return (
    <>
      <style>{fontStyle}</style>
      <div className="font-sans-tight min-h-screen" style={{ background: palette.canvas, color: palette.ink }}>
        <div className="flex">
          {/* Sidebar */}
          <aside
            className="sticky top-0 flex h-screen w-[236px] shrink-0 flex-col"
            style={{ background: palette.sidebar, color: palette.sidebarMute }}
          >
            <div className="px-4 pt-5 pb-5">
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-md"
                  style={{ background: palette.cobalt }}
                >
                  <Zap className="h-4 w-4 text-white" strokeWidth={2.25} />
                </div>
                <div>
                  <div className="font-sans-tight text-[13.5px] text-white" style={{ fontWeight: 600 }}>
                    Quail Valley HOA
                  </div>
                  <div className="font-mono-num text-[10px]" style={{ color: palette.sidebarMute }}>
                    144u · 25b
                  </div>
                </div>
              </div>
            </div>

            <div
              className="mx-4 mb-4 flex items-center gap-2 rounded-md border px-2.5 py-1.5"
              style={{ borderColor: palette.sidebarBorder, background: "rgba(255,255,255,0.03)" }}
            >
              <Search className="h-3.5 w-3.5" style={{ color: palette.sidebarMute }} />
              <span className="font-sans-tight text-[11.5px]" style={{ color: palette.sidebarMute }}>
                Search…
              </span>
              <span className="ml-auto inline-flex items-center gap-0.5">
                <Command className="h-2.5 w-2.5" style={{ color: palette.sidebarMute }} />
                <span className="font-mono-num text-[10px]" style={{ color: palette.sidebarMute }}>K</span>
              </span>
            </div>

            <nav className="flex-1 space-y-4 px-2.5">
              {navSections.map((section) => (
                <div key={section.label}>
                  <div className="font-sans-tight px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wider" style={{ color: "#5C648A" }}>
                    {section.label}
                  </div>
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.label}
                        className="group mb-0.5 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors"
                        style={
                          item.active
                            ? { background: "rgba(50,69,255,0.16)", color: "#FFFFFF" }
                            : { color: palette.sidebarMute }
                        }
                      >
                        <span className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5" strokeWidth={item.active ? 2.25 : 1.75} />
                          <span className="font-sans-tight text-[12.5px]" style={{ fontWeight: item.active ? 500 : 400 }}>
                            {item.label}
                          </span>
                        </span>
                        {item.badge && (
                          <span
                            className="font-mono-num rounded px-1.5 py-0 text-[10px]"
                            style={{
                              background: item.active ? palette.cobalt : "rgba(255,255,255,0.08)",
                              color: "#FFFFFF",
                            }}
                          >
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>

            <div className="px-4 pb-4 pt-3">
              <div
                className="flex items-center gap-2.5 rounded-lg border p-2.5"
                style={{ borderColor: palette.sidebarBorder, background: "rgba(255,255,255,0.025)" }}
              >
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-full font-sans-tight text-[11px]"
                  style={{ background: palette.cobalt, color: "#fff", fontWeight: 600 }}
                >
                  EM
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-sans-tight truncate text-[11.5px] text-white" style={{ fontWeight: 500 }}>
                    Eleanor Marsh
                  </div>
                  <div className="font-sans-tight truncate text-[10px]" style={{ color: palette.sidebarMute }}>
                    Board · Treasurer
                  </div>
                </div>
              </div>
            </div>
          </aside>

          {/* Main */}
          <main className="min-w-0 flex-1">
            <header
              className="sticky top-0 z-10 flex items-center justify-between border-b px-7 py-3.5 backdrop-blur"
              style={{ background: "rgba(246,247,251,0.85)", borderColor: palette.border }}
            >
              <div className="flex items-center gap-3">
                <h1 className="font-sans-tight text-[18px]" style={{ color: palette.ink, fontWeight: 600, letterSpacing: "-0.02em" }}>
                  Dashboard
                </h1>
                <span
                  className="font-mono-num rounded-md px-1.5 py-0.5 text-[10px]"
                  style={{ background: palette.cobaltSoft, color: palette.cobalt, fontWeight: 500 }}
                >
                  LIVE
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  className="font-sans-tight inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px]"
                  style={{ borderColor: palette.border, background: palette.panel, color: palette.inkSoft }}
                >
                  <Upload className="h-3.5 w-3.5" /> Upload
                </button>
                <button
                  className="font-sans-tight inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px]"
                  style={{ background: palette.cobalt, color: "#fff", fontWeight: 500 }}
                >
                  <Plus className="h-3.5 w-3.5" /> New Work Order
                </button>
                <div
                  className="ml-1 flex h-8 w-8 items-center justify-center rounded-full border"
                  style={{ borderColor: palette.border, background: palette.panel, color: palette.inkSoft }}
                >
                  <Bell className="h-3.5 w-3.5" />
                </div>
              </div>
            </header>

            <div className="px-7 py-6">
              {/* Value strip */}
              <div
                className="mb-5 flex items-center gap-3 rounded-xl border px-4 py-3"
                style={{ background: palette.panel, borderColor: palette.border }}
              >
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-md"
                  style={{ background: palette.cobaltSoft, color: palette.cobalt }}
                >
                  <Zap className="h-3.5 w-3.5" strokeWidth={2.25} />
                </div>
                <p className="font-sans-tight flex-1 text-[13.5px]" style={{ color: palette.ink, fontWeight: 500 }}>
                  Centralized visibility across buildings, units, documents, insurance, and maintenance.
                </p>
                <span className="font-mono-num text-[11px]" style={{ color: palette.inkMute }}>
                  Last sync · 2m ago
                </span>
              </div>

              {/* KPIs */}
              <div className="grid grid-cols-6 gap-3">
                {kpis.map((k) => (
                  <KpiCard key={k.label} {...k} />
                ))}
              </div>

              {/* Health grid + activity */}
              <div className="mt-6 grid grid-cols-3 gap-4">
                <section
                  className="col-span-2 rounded-xl border p-5"
                  style={{ background: palette.panel, borderColor: palette.border }}
                >
                  <div className="mb-4 flex items-end justify-between">
                    <div>
                      <div className="font-sans-tight text-[11px] font-medium uppercase tracking-wider" style={{ color: palette.inkMute }}>
                        Property Health
                      </div>
                      <h2 className="font-sans-tight mt-0.5 text-[16px]" style={{ color: palette.ink, fontWeight: 600, letterSpacing: "-0.02em" }}>
                        25 buildings · live status
                      </h2>
                    </div>
                    <div className="flex items-center gap-3">
                      {(["good", "watch", "urgent"] as HealthStatus[]).map((s) => {
                        const t = statusTone[s];
                        const count = buildings.filter((b) => b.status === s).length;
                        return (
                          <span key={s} className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full" style={{ background: t.dot, boxShadow: `0 0 0 3px ${t.ring}` }} />
                            <span className="font-sans-tight text-[11.5px]" style={{ color: palette.inkSoft }}>
                              {t.label}
                            </span>
                            <span className="font-mono-num text-[11.5px]" style={{ color: palette.ink, fontWeight: 600 }}>
                              {count}
                            </span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {buildings.map((b) => (
                      <BuildingTile key={b.num} {...b} />
                    ))}
                  </div>
                </section>

                <section
                  className="rounded-xl border p-5"
                  style={{ background: palette.panel, borderColor: palette.border }}
                >
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <div className="font-sans-tight text-[11px] font-medium uppercase tracking-wider" style={{ color: palette.inkMute }}>
                        Activity
                      </div>
                      <h2 className="font-sans-tight mt-0.5 text-[16px]" style={{ color: palette.ink, fontWeight: 600, letterSpacing: "-0.02em" }}>
                        Recent events
                      </h2>
                    </div>
                    <button className="font-sans-tight text-[11.5px]" style={{ color: palette.cobalt, fontWeight: 500 }}>
                      View all
                    </button>
                  </div>
                  <ul className="space-y-3">
                    {activity.map((a, i) => {
                      const Icon = a.icon;
                      const tone = statusTone[a.tone];
                      return (
                        <li key={i} className="group flex gap-2.5">
                          <div
                            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                            style={{ background: tone.bg, color: tone.text }}
                          >
                            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-sans-tight text-[12px] leading-snug" style={{ color: palette.ink, fontWeight: 500 }}>
                              {a.title}
                            </div>
                            <div className="font-sans-tight mt-0.5 flex items-center gap-1.5 text-[10.5px]" style={{ color: palette.inkMute }}>
                              <span>{a.meta}</span>
                              <span>·</span>
                              <span className="font-mono-num">{a.time}</span>
                            </div>
                          </div>
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 self-center opacity-0 transition-opacity group-hover:opacity-100" style={{ color: palette.inkMute }} />
                        </li>
                      );
                    })}
                  </ul>
                  <button
                    className="font-sans-tight mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-md border py-1.5 text-[11.5px]"
                    style={{ borderColor: palette.border, color: palette.inkSoft }}
                  >
                    <CalendarClock className="h-3.5 w-3.5" /> Activity log
                  </button>
                </section>
              </div>

              <div className="mt-5 flex items-center justify-between text-[10.5px]" style={{ color: palette.inkMute }}>
                <span className="font-mono-num">v2.1.0 · Production</span>
                <span className="font-sans-tight">Quail Valley · Sugar Land, TX · 144 units · 25 buildings</span>
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
