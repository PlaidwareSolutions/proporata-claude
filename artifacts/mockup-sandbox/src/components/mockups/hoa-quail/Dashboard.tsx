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
} from "lucide-react";

const fontStyle = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap');
.font-display { font-family: 'Fraunces', 'Source Serif 4', Georgia, serif; font-optical-sizing: auto; }
.font-body { font-family: 'Inter', system-ui, sans-serif; }
.tabular { font-variant-numeric: tabular-nums; }
`;

type HealthStatus = "good" | "watch" | "urgent";

const palette = {
  bg: "#F4EFE6",
  panel: "#FBF7EE",
  card: "#FFFFFF",
  ink: "#1F1B16",
  inkSoft: "#5C5346",
  inkMute: "#8A7E6C",
  border: "#E6DECF",
  borderSoft: "#EFE8DA",
  sage: "#5E7A60",
  sageSoft: "#E5ECDF",
  clay: "#B0593F",
  claySoft: "#F4DDD2",
  amber: "#B5872B",
  amberSoft: "#F4E6C2",
  brass: "#9C7A35",
};

const statusTone: Record<HealthStatus, { dot: string; bg: string; label: string; text: string }> = {
  good: { dot: palette.sage, bg: palette.sageSoft, label: "Good", text: "#33502F" },
  watch: { dot: palette.amber, bg: palette.amberSoft, label: "Watch", text: "#7A5A14" },
  urgent: { dot: palette.clay, bg: palette.claySoft, label: "Urgent", text: "#7A2E1A" },
};

const buildings: { num: number; units: number; status: HealthStatus; openWO: number }[] = [
  { num: 1, units: 6, status: "good", openWO: 0 },
  { num: 2, units: 6, status: "good", openWO: 1 },
  { num: 3, units: 6, status: "watch", openWO: 2 },
  { num: 4, units: 5, status: "good", openWO: 0 },
  { num: 5, units: 5, status: "urgent", openWO: 3 },
  { num: 6, units: 6, status: "good", openWO: 1 },
  { num: 7, units: 6, status: "good", openWO: 0 },
  { num: 8, units: 5, status: "watch", openWO: 1 },
  { num: 9, units: 6, status: "urgent", openWO: 4 },
  { num: 10, units: 6, status: "good", openWO: 0 },
  { num: 11, units: 5, status: "good", openWO: 1 },
  { num: 12, units: 6, status: "watch", openWO: 2 },
  { num: 13, units: 5, status: "good", openWO: 0 },
  { num: 14, units: 6, status: "urgent", openWO: 2 },
  { num: 15, units: 5, status: "good", openWO: 0 },
  { num: 16, units: 6, status: "good", openWO: 1 },
  { num: 17, units: 5, status: "watch", openWO: 1 },
  { num: 18, units: 6, status: "good", openWO: 0 },
  { num: 19, units: 5, status: "good", openWO: 0 },
  { num: 20, units: 6, status: "watch", openWO: 1 },
  { num: 21, units: 5, status: "good", openWO: 0 },
  { num: 22, units: 6, status: "watch", openWO: 1 },
  { num: 23, units: 5, status: "good", openWO: 0 },
  { num: 24, units: 6, status: "good", openWO: 1 },
  { num: 25, units: 6, status: "good", openWO: 0 },
];

const kpis = [
  { label: "Total Units", value: "144", delta: "+0", trend: "flat" as const, hint: "across 25 buildings" },
  { label: "Buildings", value: "25", delta: "—", trend: "flat" as const, hint: "fully tracked" },
  { label: "Open Work Orders", value: "17", delta: "−4", trend: "down" as const, hint: "vs last week" },
  { label: "Urgent Issues", value: "3", delta: "+1", trend: "up" as const, hint: "needs board review" },
  { label: "Missing Insurance", value: "8", delta: "−2", trend: "down" as const, hint: "declarations due" },
  { label: "Roofs Needing Care", value: "6", delta: "+1", trend: "up" as const, hint: "inspection flagged" },
];

const activity = [
  { icon: Droplets, title: "Roof leak reported for 2828 Camelot Lane", meta: "Building 9 · Reported by board", time: "12 min ago", tone: "urgent" as HealthStatus },
  { icon: FileCheck2, title: "Insurance declaration uploaded for 2803 Cambridge", meta: "Building 18 · Policy 2026", time: "2 hr ago", tone: "good" as HealthStatus },
  { icon: Wrench, title: "Work order #WO-1043 closed for Building 9", meta: "Roof patch completed by Atlas Roofing", time: "Yesterday", tone: "good" as HealthStatus },
  { icon: Mail, title: "Correspondence added for 2832 Camelot Lane", meta: "HOA notice acknowledged", time: "Yesterday", tone: "watch" as HealthStatus },
  { icon: CalendarCheck, title: "Roof inspection scheduled for Building 14", meta: "Wed, May 7 · Pinnacle Inspections", time: "2 days ago", tone: "watch" as HealthStatus },
  { icon: Receipt, title: "Vendor quote received for Building 22 exterior", meta: "$8,450 · Cedar & Stone Painting", time: "3 days ago", tone: "good" as HealthStatus },
];

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: Building2, label: "Buildings" },
  { icon: Home, label: "Units" },
  { icon: ClipboardList, label: "Work Orders", badge: 17 },
  { icon: FileText, label: "Documents" },
  { icon: ShieldCheck, label: "Insurance", badge: 8 },
  { icon: BarChart3, label: "Reports" },
  { icon: Settings, label: "Settings" },
];

function KpiCard({ label, value, delta, trend, hint }: (typeof kpis)[number]) {
  const trendColor = trend === "up" ? palette.clay : trend === "down" ? palette.sage : palette.inkMute;
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : ArrowUpRight;
  return (
    <div
      className="group rounded-2xl border p-5 transition-all duration-300 hover:-translate-y-0.5"
      style={{
        background: palette.card,
        borderColor: palette.border,
        boxShadow: "0 1px 0 rgba(31,27,22,0.02), 0 8px 24px -16px rgba(31,27,22,0.18)",
      }}
    >
      <div className="flex items-start justify-between">
        <span className="font-body text-[11px] uppercase tracking-[0.14em]" style={{ color: palette.inkMute }}>
          {label}
        </span>
        <span
          className="font-body inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ background: palette.borderSoft, color: trendColor }}
        >
          {trend !== "flat" && <TrendIcon className="h-3 w-3" />}
          {delta}
        </span>
      </div>
      <div className="font-display tabular mt-3 text-[34px] leading-none" style={{ color: palette.ink, fontWeight: 500 }}>
        {value}
      </div>
      <div className="font-body mt-2 text-[12px]" style={{ color: palette.inkSoft }}>
        {hint}
      </div>
    </div>
  );
}

function BuildingTile({ num, units, status, openWO }: (typeof buildings)[number]) {
  const tone = statusTone[status];
  return (
    <button
      className="group relative flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm"
      style={{ background: palette.card, borderColor: palette.border }}
    >
      <div className="flex w-full items-center justify-between">
        <span className="font-display text-[13px]" style={{ color: palette.inkMute, letterSpacing: "0.08em" }}>
          BLDG
        </span>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.dot }} />
      </div>
      <div className="font-display tabular text-[26px] leading-none" style={{ color: palette.ink, fontWeight: 500 }}>
        {String(num).padStart(2, "0")}
      </div>
      <div className="flex w-full items-center justify-between">
        <span className="font-body text-[11px]" style={{ color: palette.inkSoft }}>
          {units} units
        </span>
        {openWO > 0 && (
          <span
            className="font-body inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular"
            style={{ background: tone.bg, color: tone.text }}
          >
            <Wrench className="h-2.5 w-2.5" />
            {openWO}
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
      <div className="font-body min-h-screen" style={{ background: palette.bg, color: palette.ink }}>
        <div className="flex">
          {/* Sidebar */}
          <aside
            className="sticky top-0 flex h-screen w-[244px] shrink-0 flex-col border-r"
            style={{ background: palette.panel, borderColor: palette.border }}
          >
            <div className="px-5 pt-6 pb-5">
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-lg"
                  style={{ background: palette.ink, color: palette.panel }}
                >
                  <span className="font-display text-[15px]" style={{ fontWeight: 600 }}>Q</span>
                </div>
                <div>
                  <div className="font-display text-[14px] leading-tight" style={{ color: palette.ink, fontWeight: 600 }}>
                    Quail Valley
                  </div>
                  <div className="font-body text-[10.5px] uppercase tracking-[0.14em]" style={{ color: palette.inkMute }}>
                    Town Homes HOA
                  </div>
                </div>
              </div>
            </div>

            <nav className="flex-1 px-2.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    className="group mb-0.5 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors"
                    style={
                      item.active
                        ? { background: palette.ink, color: palette.panel }
                        : { color: palette.inkSoft }
                    }
                    onMouseEnter={(e) => {
                      if (!item.active) (e.currentTarget.style.background = palette.borderSoft);
                    }}
                    onMouseLeave={(e) => {
                      if (!item.active) (e.currentTarget.style.background = "transparent");
                    }}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="h-4 w-4" strokeWidth={1.75} />
                      <span className="font-body text-[13px]" style={{ fontWeight: item.active ? 500 : 400 }}>
                        {item.label}
                      </span>
                    </span>
                    {item.badge && (
                      <span
                        className="font-body tabular rounded-full px-1.5 py-0.5 text-[10px]"
                        style={{
                          background: item.active ? "rgba(244,239,230,0.15)" : palette.borderSoft,
                          color: item.active ? palette.panel : palette.inkSoft,
                        }}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            <div className="px-4 pb-5 pt-3">
              <div
                className="rounded-xl border p-3"
                style={{ background: palette.card, borderColor: palette.border }}
              >
                <div className="font-body text-[10.5px] uppercase tracking-[0.14em]" style={{ color: palette.inkMute }}>
                  Property Manager
                </div>
                <div className="font-display mt-1 text-[13px]" style={{ color: palette.ink, fontWeight: 500 }}>
                  Cardinal Property Mgmt.
                </div>
                <div className="font-body mt-0.5 text-[11px]" style={{ color: palette.inkSoft }}>
                  Linda Hewitt · on call
                </div>
              </div>
            </div>
          </aside>

          {/* Main */}
          <main className="min-w-0 flex-1">
            {/* Header */}
            <header
              className="sticky top-0 z-10 flex items-center justify-between border-b px-8 py-4 backdrop-blur"
              style={{
                background: "rgba(244,239,230,0.85)",
                borderColor: palette.border,
              }}
            >
              <div>
                <div className="font-body text-[10.5px] uppercase tracking-[0.16em]" style={{ color: palette.inkMute }}>
                  Overview
                </div>
                <h1 className="font-display text-[22px] leading-tight" style={{ color: palette.ink, fontWeight: 500 }}>
                  Dashboard
                </h1>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="flex w-72 items-center gap-2 rounded-full border px-3.5 py-1.5"
                  style={{ background: palette.card, borderColor: palette.border }}
                >
                  <Search className="h-3.5 w-3.5" style={{ color: palette.inkMute }} />
                  <input
                    placeholder="Search buildings, units, work orders…"
                    className="font-body w-full bg-transparent text-[12.5px] outline-none placeholder:opacity-60"
                    style={{ color: palette.ink }}
                  />
                  <kbd
                    className="font-body rounded border px-1.5 text-[10px]"
                    style={{ borderColor: palette.border, color: palette.inkMute }}
                  >
                    ⌘K
                  </kbd>
                </div>
                <button
                  className="relative flex h-9 w-9 items-center justify-center rounded-full border"
                  style={{ background: palette.card, borderColor: palette.border, color: palette.inkSoft }}
                >
                  <Bell className="h-4 w-4" />
                  <span
                    className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full"
                    style={{ background: palette.clay }}
                  />
                </button>
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full font-display text-[12.5px]"
                  style={{ background: palette.sage, color: palette.panel, fontWeight: 600 }}
                >
                  EM
                </div>
              </div>
            </header>

            <div className="px-8 py-7">
              {/* Value strip */}
              <div
                className="mb-6 flex items-center justify-between gap-4 rounded-2xl border px-5 py-4"
                style={{
                  background: `linear-gradient(135deg, ${palette.panel} 0%, ${palette.sageSoft} 120%)`,
                  borderColor: palette.border,
                }}
              >
                <div>
                  <div className="font-body text-[10.5px] uppercase tracking-[0.16em]" style={{ color: palette.brass }}>
                    HOA Operations Hub
                  </div>
                  <p className="font-display mt-1 text-[18px] leading-snug" style={{ color: palette.ink, fontWeight: 500 }}>
                    Centralized visibility across buildings, units, documents, insurance, and maintenance.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    className="font-body inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[12.5px]"
                    style={{ borderColor: palette.border, background: palette.card, color: palette.ink }}
                  >
                    <Upload className="h-3.5 w-3.5" /> Upload Document
                  </button>
                  <button
                    className="font-body inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px]"
                    style={{ background: palette.ink, color: palette.panel }}
                  >
                    <Plus className="h-3.5 w-3.5" /> New Work Order
                  </button>
                </div>
              </div>

              {/* KPIs */}
              <div className="grid grid-cols-6 gap-3.5">
                {kpis.map((k) => (
                  <KpiCard key={k.label} {...k} />
                ))}
              </div>

              {/* Health grid + activity */}
              <div className="mt-7 grid grid-cols-3 gap-5">
                <section
                  className="col-span-2 rounded-2xl border p-6"
                  style={{ background: palette.panel, borderColor: palette.border }}
                >
                  <div className="mb-5 flex items-end justify-between">
                    <div>
                      <div className="font-body text-[10.5px] uppercase tracking-[0.16em]" style={{ color: palette.inkMute }}>
                        Property Health
                      </div>
                      <h2 className="font-display mt-1 text-[18px] leading-tight" style={{ color: palette.ink, fontWeight: 500 }}>
                        25 Buildings · At a glance
                      </h2>
                    </div>
                    <div className="flex items-center gap-3.5">
                      {(["good", "watch", "urgent"] as HealthStatus[]).map((s) => {
                        const t = statusTone[s];
                        const count = buildings.filter((b) => b.status === s).length;
                        return (
                          <span key={s} className="flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.dot }} />
                            <span className="font-body text-[11.5px]" style={{ color: palette.inkSoft }}>
                              {t.label} <span className="tabular" style={{ color: palette.ink }}>{count}</span>
                            </span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-2.5">
                    {buildings.map((b) => (
                      <BuildingTile key={b.num} {...b} />
                    ))}
                  </div>
                </section>

                <section
                  className="rounded-2xl border p-6"
                  style={{ background: palette.card, borderColor: palette.border }}
                >
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <div className="font-body text-[10.5px] uppercase tracking-[0.16em]" style={{ color: palette.inkMute }}>
                        Recent Activity
                      </div>
                      <h2 className="font-display mt-1 text-[18px] leading-tight" style={{ color: palette.ink, fontWeight: 500 }}>
                        Around the community
                      </h2>
                    </div>
                  </div>
                  <ul className="space-y-3.5">
                    {activity.map((a, i) => {
                      const Icon = a.icon;
                      const tone = statusTone[a.tone];
                      return (
                        <li key={i} className="flex gap-3">
                          <div
                            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                            style={{ background: tone.bg, color: tone.text }}
                          >
                            <Icon className="h-4 w-4" strokeWidth={1.75} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-body text-[12.5px] leading-snug" style={{ color: palette.ink }}>
                              {a.title}
                            </div>
                            <div className="font-body mt-0.5 flex items-center gap-2 text-[11px]" style={{ color: palette.inkMute }}>
                              <span>{a.meta}</span>
                              <span>·</span>
                              <span>{a.time}</span>
                            </div>
                          </div>
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 self-center" style={{ color: palette.inkMute }} />
                        </li>
                      );
                    })}
                  </ul>
                  <button
                    className="font-body mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-full border py-2 text-[12px]"
                    style={{ borderColor: palette.border, color: palette.inkSoft }}
                  >
                    <CalendarClock className="h-3.5 w-3.5" /> View full activity log
                  </button>
                </section>
              </div>

              <div className="mt-6 mb-2 flex items-center justify-between text-[11px]" style={{ color: palette.inkMute }}>
                <span className="font-body">Last sync · 2 minutes ago</span>
                <span className="font-body">Quail Valley · Sugar Land, TX · 144 units · 25 buildings</span>
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
