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
  ArrowUpRight,
  ArrowDownRight,
  Droplets,
  Wrench,
  Mail,
  CalendarCheck,
  FileCheck2,
  Receipt,
  ChevronRight,
  Leaf,
} from "lucide-react";

const fontStyle = `
@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap');
.font-display { font-family: 'DM Serif Display', 'Playfair Display', Georgia, serif; }
.font-body { font-family: 'DM Sans', system-ui, sans-serif; }
.tabular { font-variant-numeric: tabular-nums; }
.eyebrow { font-family: 'DM Sans', system-ui, sans-serif; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; }
`;

type HealthStatus = "good" | "watch" | "urgent";

const palette = {
  bg: "#F5F1E8",
  panel: "#FBF8F1",
  card: "#FFFFFF",
  forest: "#1F3A2C",
  ivory: "#FBF8F1",
  ink: "#142219",
  inkSoft: "#3F4A42",
  inkMute: "#7E8A82",
  border: "#E1DAC6",
  borderSoft: "#EDE7D6",
  gold: "#B98A2A",
  goodBg: "#E2EBDF",
  goodInk: "#22432C",
  watchBg: "#F1E5C2",
  watchInk: "#7A5A14",
  urgentBg: "#EFD9CD",
  urgentInk: "#7A2E1A",
};

const statusTone: Record<HealthStatus, { dot: string; bg: string; label: string; text: string }> = {
  good: { dot: "#3D6B4C", bg: palette.goodBg, label: "Sound", text: palette.goodInk },
  watch: { dot: palette.gold, bg: palette.watchBg, label: "Caution", text: palette.watchInk },
  urgent: { dot: "#A53A1F", bg: palette.urgentBg, label: "Urgent", text: palette.urgentInk },
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
  { label: "Total Units", value: "144", delta: "Stable", trend: "flat" as const, hint: "across 25 buildings" },
  { label: "Buildings", value: "25", delta: "—", trend: "flat" as const, hint: "fully tracked" },
  { label: "Open Work Orders", value: "17", delta: "−4", trend: "down" as const, hint: "vs last week" },
  { label: "Urgent Issues", value: "3", delta: "+1", trend: "up" as const, hint: "needs board review" },
  { label: "Missing Insurance", value: "8", delta: "−2", trend: "down" as const, hint: "declarations due" },
  { label: "Roofs Needing Care", value: "6", delta: "+1", trend: "up" as const, hint: "inspection flagged" },
];

const activity = [
  { icon: Droplets, title: "Roof leak reported for 2828 Camelot Lane", meta: "Building 9 · Reported by board member", time: "12 min ago", tone: "urgent" as HealthStatus },
  { icon: FileCheck2, title: "Insurance declaration uploaded for 2803 Cambridge", meta: "Building 18 · Policy 2026", time: "2 hr ago", tone: "good" as HealthStatus },
  { icon: Wrench, title: "Work Order #WO-1043 closed for Building 9", meta: "Roof patch completed by Atlas Roofing", time: "Yesterday", tone: "good" as HealthStatus },
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
  const trendColor = trend === "up" ? "#A53A1F" : trend === "down" ? "#3D6B4C" : palette.inkMute;
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : ArrowUpRight;
  return (
    <div
      className="rounded-2xl border p-5 transition-all duration-300 hover:-translate-y-0.5"
      style={{
        background: palette.card,
        borderColor: palette.border,
        boxShadow: "0 1px 0 rgba(20,34,25,0.02), 0 12px 32px -20px rgba(20,34,25,0.22)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="eyebrow text-[10px]" style={{ color: palette.inkMute }}>
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
      <div className="font-display tabular mt-3 text-[40px] leading-none" style={{ color: palette.forest }}>
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
      className="group relative flex flex-col items-start gap-2 rounded-2xl border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
      style={{ background: palette.card, borderColor: palette.border }}
    >
      <div className="flex w-full items-center justify-between">
        <span className="eyebrow text-[9px]" style={{ color: palette.inkMute }}>
          Bldg
        </span>
        <span className="h-2 w-2 rounded-full" style={{ background: tone.dot }} />
      </div>
      <div className="font-display tabular text-[28px] leading-none" style={{ color: palette.forest }}>
        {String(num).padStart(2, "0")}
      </div>
      <div className="flex w-full items-center justify-between">
        <span className="font-body text-[10.5px]" style={{ color: palette.inkSoft }}>
          {units} units
        </span>
        {openWO > 0 && (
          <span
            className="font-body inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular"
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
            className="sticky top-0 flex h-screen w-[252px] shrink-0 flex-col"
            style={{ background: palette.forest, color: "rgba(251,248,241,0.78)" }}
          >
            <div className="px-6 pt-7 pb-6">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-xl"
                  style={{ background: palette.gold, color: palette.forest }}
                >
                  <Leaf className="h-5 w-5" strokeWidth={2} />
                </div>
                <div>
                  <div className="eyebrow text-[9.5px]" style={{ color: palette.gold }}>
                    The Town Homes
                  </div>
                  <div className="font-display text-[18px] leading-tight text-white">
                    Quail Valley
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 pb-3">
              <div className="eyebrow text-[9.5px]" style={{ color: "rgba(251,248,241,0.45)" }}>
                Operations
              </div>
            </div>

            <nav className="flex-1 px-3">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    className="group mb-1 flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left transition-colors"
                    style={
                      item.active
                        ? { background: "rgba(185,138,42,0.18)", color: "#FFFFFF" }
                        : { color: "rgba(251,248,241,0.78)" }
                    }
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="h-4 w-4" strokeWidth={item.active ? 2 : 1.6} />
                      <span className="font-body text-[13.5px]" style={{ fontWeight: item.active ? 600 : 400 }}>
                        {item.label}
                      </span>
                    </span>
                    {item.badge && (
                      <span
                        className="font-body tabular rounded-full px-2 py-0.5 text-[10px]"
                        style={{ background: palette.gold, color: palette.forest, fontWeight: 600 }}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            <div className="px-5 pb-6 pt-4">
              <div
                className="rounded-xl border p-4"
                style={{ borderColor: "rgba(251,248,241,0.12)", background: "rgba(251,248,241,0.04)" }}
              >
                <div className="eyebrow text-[9px]" style={{ color: palette.gold }}>
                  Property Manager
                </div>
                <div className="font-display mt-1 text-[15px] leading-tight text-white">
                  Cardinal Property
                </div>
                <div className="font-body mt-1 text-[11.5px]" style={{ color: "rgba(251,248,241,0.65)" }}>
                  Linda Hewitt · on call
                </div>
              </div>
            </div>
          </aside>

          {/* Main */}
          <main className="min-w-0 flex-1">
            <header
              className="sticky top-0 z-10 flex items-center justify-between border-b px-9 py-5 backdrop-blur"
              style={{ background: "rgba(245,241,232,0.88)", borderColor: palette.border }}
            >
              <div>
                <div className="eyebrow text-[10px]" style={{ color: palette.gold }}>
                  Spring Reporting Period · 2026
                </div>
                <h1 className="font-display mt-1 text-[26px] leading-tight" style={{ color: palette.forest }}>
                  Community Dashboard
                </h1>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="flex w-72 items-center gap-2 rounded-full border px-4 py-2"
                  style={{ background: palette.card, borderColor: palette.border }}
                >
                  <Search className="h-3.5 w-3.5" style={{ color: palette.inkMute }} />
                  <input
                    placeholder="Search buildings, units, work orders…"
                    className="font-body w-full bg-transparent text-[12.5px] outline-none placeholder:opacity-60"
                    style={{ color: palette.ink }}
                  />
                </div>
                <button
                  className="relative flex h-10 w-10 items-center justify-center rounded-full border"
                  style={{ background: palette.card, borderColor: palette.border, color: palette.inkSoft }}
                >
                  <Bell className="h-4 w-4" />
                  <span
                    className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full"
                    style={{ background: "#A53A1F" }}
                  />
                </button>
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full font-display text-[13px]"
                  style={{ background: palette.gold, color: palette.forest }}
                >
                  EM
                </div>
              </div>
            </header>

            <div className="px-9 py-8">
              {/* Value strip */}
              <div
                className="mb-7 overflow-hidden rounded-3xl border"
                style={{ borderColor: palette.border, background: palette.card }}
              >
                <div className="flex items-center justify-between gap-6 px-7 py-6">
                  <div className="max-w-xl">
                    <div className="eyebrow text-[10px]" style={{ color: palette.gold }}>
                      HOA Operations Hub
                    </div>
                    <p className="font-display mt-2 text-[22px] leading-snug" style={{ color: palette.forest }}>
                      Centralized visibility across buildings, units, documents, insurance, and maintenance.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <button
                      className="font-body inline-flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-[12.5px]"
                      style={{ borderColor: palette.border, background: palette.bg, color: palette.forest, fontWeight: 500 }}
                    >
                      <Upload className="h-3.5 w-3.5" /> Upload Document
                    </button>
                    <button
                      className="font-body inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[12.5px]"
                      style={{ background: palette.forest, color: palette.ivory, fontWeight: 500 }}
                    >
                      <Plus className="h-3.5 w-3.5" /> New Work Order
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-3 border-t" style={{ borderColor: palette.borderSoft }}>
                  {[
                    { k: "On schedule", v: "92%", t: "Maintenance program" },
                    { k: "Compliance", v: "94%", t: "Insurance & docs" },
                    { k: "Vendor SLA", v: "4.6", t: "Avg response · 5.0 scale" },
                  ].map((s) => (
                    <div key={s.k} className="flex items-center justify-between gap-4 border-r px-7 py-4 last:border-r-0" style={{ borderColor: palette.borderSoft }}>
                      <div>
                        <div className="eyebrow text-[9.5px]" style={{ color: palette.inkMute }}>
                          {s.k}
                        </div>
                        <div className="font-body mt-1 text-[11px]" style={{ color: palette.inkSoft }}>
                          {s.t}
                        </div>
                      </div>
                      <div className="font-display tabular text-[28px]" style={{ color: palette.forest }}>
                        {s.v}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* KPIs */}
              <div className="mb-7">
                <div className="mb-3 flex items-end justify-between">
                  <div>
                    <div className="eyebrow text-[10px]" style={{ color: palette.inkMute }}>
                      Snapshot
                    </div>
                    <h2 className="font-display mt-1 text-[20px]" style={{ color: palette.forest }}>
                      This Week's Numbers
                    </h2>
                  </div>
                </div>
                <div className="grid grid-cols-6 gap-4">
                  {kpis.map((k) => (
                    <KpiCard key={k.label} {...k} />
                  ))}
                </div>
              </div>

              {/* Health grid + activity */}
              <div className="grid grid-cols-3 gap-5">
                <section
                  className="col-span-2 rounded-3xl border p-7"
                  style={{ background: palette.panel, borderColor: palette.border }}
                >
                  <div className="mb-5 flex items-end justify-between">
                    <div>
                      <div className="eyebrow text-[10px]" style={{ color: palette.gold }}>
                        Property Health
                      </div>
                      <h2 className="font-display mt-1 text-[22px] leading-tight" style={{ color: palette.forest }}>
                        25 Buildings, At a Glance
                      </h2>
                    </div>
                    <div className="flex items-center gap-4">
                      {(["good", "watch", "urgent"] as HealthStatus[]).map((s) => {
                        const t = statusTone[s];
                        const count = buildings.filter((b) => b.status === s).length;
                        return (
                          <span key={s} className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full" style={{ background: t.dot }} />
                            <span className="font-body text-[12px]" style={{ color: palette.inkSoft }}>
                              {t.label}
                            </span>
                            <span className="font-display tabular text-[14px]" style={{ color: palette.forest }}>
                              {count}
                            </span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-3">
                    {buildings.map((b) => (
                      <BuildingTile key={b.num} {...b} />
                    ))}
                  </div>
                </section>

                <section
                  className="rounded-3xl border p-6"
                  style={{ background: palette.card, borderColor: palette.border }}
                >
                  <div className="mb-5">
                    <div className="eyebrow text-[10px]" style={{ color: palette.gold }}>
                      Around the Community
                    </div>
                    <h2 className="font-display mt-1 text-[20px] leading-tight" style={{ color: palette.forest }}>
                      Recent Activity
                    </h2>
                  </div>
                  <ul className="space-y-4">
                    {activity.map((a, i) => {
                      const Icon = a.icon;
                      const tone = statusTone[a.tone];
                      return (
                        <li key={i} className="flex gap-3">
                          <div
                            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                            style={{ background: tone.bg, color: tone.text }}
                          >
                            <Icon className="h-4 w-4" strokeWidth={1.75} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-body text-[12.5px] leading-snug" style={{ color: palette.ink, fontWeight: 500 }}>
                              {a.title}
                            </div>
                            <div className="font-body mt-0.5 flex items-center gap-1.5 text-[11px]" style={{ color: palette.inkMute }}>
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
                </section>
              </div>

              <div className="mt-8 flex items-center justify-between text-[11px]" style={{ color: palette.inkMute }}>
                <span className="eyebrow text-[9px]">Last sync · 2 minutes ago</span>
                <span className="font-body">Quail Valley · Sugar Land, TX · 144 units · 25 buildings</span>
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
