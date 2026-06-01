import {
  LayoutDashboard, Building2, Home, ClipboardList, FileText, ShieldCheck, BarChart3, Settings,
  Search, Bell, Plus, Upload, CalendarClock, ArrowUpRight, ArrowDownRight,
  Droplets, Wrench, Mail, CalendarCheck, FileCheck2, Receipt, ChevronRight, Sparkles, Command,
} from "lucide-react";

const fontStyle = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap');
.font-s { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; letter-spacing: -0.005em; }
.font-display { font-family: 'Fraunces', Georgia, serif; }
.tabular { font-variant-numeric: tabular-nums; }
`;

type S = "good" | "watch" | "urgent";

const c = {
  canvas: "#FBF6F0",
  panel: "#FFFFFF",
  sidebar: "#EDE7F5",
  sidebarInk: "#3D2F5C",
  sidebarMute: "#7A6BA0",
  ink: "#2A2235",
  inkSoft: "#5C5269",
  inkMute: "#9990A8",
  border: "#F1E4D8",
  borderSoft: "#F8EFE6",
  lavender: "#9C7BD9",
  lavenderSoft: "#EAE0F7",
  peach: "#F4A88A",
  peachSoft: "#FBE4D9",
  mint: "#7DBFA1",
  mintSoft: "#DEF0E7",
  butter: "#E5B95C",
  butterSoft: "#F8E9C4",
  rose: "#E07B8E",
  roseSoft: "#F8DDE3",
};

const tone: Record<S, { dot: string; bg: string; label: string; text: string; ring: string }> = {
  good: { dot: c.mint, bg: c.mintSoft, label: "Healthy", text: "#3D7A5F", ring: "rgba(125,191,161,0.32)" },
  watch: { dot: c.butter, bg: c.butterSoft, label: "Watch", text: "#8C6A1F", ring: "rgba(229,185,92,0.32)" },
  urgent: { dot: c.rose, bg: c.roseSoft, label: "Urgent", text: "#9C3D52", ring: "rgba(224,123,142,0.32)" },
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
  { label: "Total Units", value: "144", delta: "100%", trend: "flat" as const, hint: "tracked", color: c.lavender },
  { label: "Buildings", value: "25", delta: "—", trend: "flat" as const, hint: "all mapped", color: c.lavender },
  { label: "Open Work Orders", value: "17", delta: "−4", trend: "down" as const, hint: "vs last week", color: c.peach },
  { label: "Urgent Issues", value: "3", delta: "+1", trend: "up" as const, hint: "board review", color: c.rose },
  { label: "Missing Insurance", value: "8", delta: "−2", trend: "down" as const, hint: "declarations", color: c.butter },
  { label: "Roof Attention", value: "6", delta: "+1", trend: "up" as const, hint: "inspection flag", color: c.peach },
];

const activity = [
  { icon: Droplets, title: "Roof leak reported · 2828 Camelot Lane", meta: "Building 9 · reported by board", time: "12 min ago", tone: "urgent" as S },
  { icon: FileCheck2, title: "Insurance declaration uploaded · 2803 Cambridge", meta: "Building 18 · Policy 2026", time: "2 hr ago", tone: "good" as S },
  { icon: Wrench, title: "WO-1043 closed · Building 9", meta: "Roof patch by Atlas Roofing", time: "Yesterday", tone: "good" as S },
  { icon: Mail, title: "Correspondence added · 2832 Camelot Lane", meta: "Notice acknowledged", time: "Yesterday", tone: "watch" as S },
  { icon: CalendarCheck, title: "Roof inspection scheduled · Building 14", meta: "Wed May 7 · Pinnacle", time: "2 days ago", tone: "watch" as S },
  { icon: Receipt, title: "Vendor quote received · Building 22 exterior", meta: "$8,450 · Cedar & Stone", time: "3 days ago", tone: "good" as S },
];

const navSections = [
  { label: "Overview", items: [{ icon: LayoutDashboard, label: "Dashboard", active: true }, { icon: BarChart3, label: "Reports" }] },
  { label: "Property", items: [{ icon: Building2, label: "Buildings" }, { icon: Home, label: "Units" }] },
  { label: "Operations", items: [{ icon: ClipboardList, label: "Work Orders", badge: 17 }, { icon: ShieldCheck, label: "Insurance", badge: 8 }, { icon: FileText, label: "Documents" }] },
  { label: "Workspace", items: [{ icon: Settings, label: "Settings" }] },
];

function Sparkline({ color }: { color: string }) {
  const pts = [12, 9, 14, 11, 16, 10, 8, 12, 7, 9, 6];
  const w = 70, h = 24;
  const max = Math.max(...pts), min = Math.min(...pts);
  const path = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = h - ((v - min) / (max - min || 1)) * h;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const fillPath = `${path} L ${w},${h} L 0,${h} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <path d={fillPath} fill={color} opacity={0.18} />
      <path d={path} stroke={color} strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function KpiCard({ label, value, delta, trend, hint, color }: (typeof kpis)[number]) {
  const trendColor = trend === "up" ? c.rose : trend === "down" ? c.mint : c.inkMute;
  const TrendIcon = trend === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="rounded-3xl border p-5 transition-all hover:-translate-y-0.5"
      style={{ background: c.panel, borderColor: c.border, boxShadow: "0 2px 0 rgba(232,210,184,0.4), 0 18px 40px -28px rgba(156,123,217,0.35)" }}>
      <div className="flex items-start justify-between">
        <span className="font-s text-[11px] uppercase tracking-[0.08em]" style={{ color: c.inkMute, fontWeight: 600 }}>{label}</span>
        <span className="font-s inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ background: c.borderSoft, color: trendColor }}>
          {trend !== "flat" && <TrendIcon className="h-3 w-3" />}{delta}
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div className="font-display tabular text-[34px] leading-none" style={{ color: c.ink, fontWeight: 600, letterSpacing: "-0.02em" }}>{value}</div>
        <Sparkline color={color} />
      </div>
      <div className="font-s mt-2 text-[12px]" style={{ color: c.inkSoft }}>{hint}</div>
    </div>
  );
}

function BuildingTile({ num, units, status, openWO }: (typeof buildings)[number]) {
  const t = tone[status];
  return (
    <button className="group relative flex flex-col gap-2 rounded-2xl border p-3 text-left transition-all hover:-translate-y-0.5"
      style={{ background: c.panel, borderColor: c.border }}>
      <div className="flex items-center justify-between">
        <span className="font-s text-[10px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 600 }}>Bldg</span>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.dot, boxShadow: `0 0 0 4px ${t.ring}` }} />
      </div>
      <div className="font-display tabular text-[24px] leading-none" style={{ color: c.ink, fontWeight: 600 }}>{String(num).padStart(2, "0")}</div>
      <div className="flex items-center justify-between">
        <span className="font-s text-[10.5px]" style={{ color: c.inkSoft }}>{units} units</span>
        {openWO > 0 && (
          <span className="font-s inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular"
            style={{ background: t.bg, color: t.text }}>{openWO}</span>
        )}
      </div>
    </button>
  );
}

export function Dashboard() {
  return (
    <>
      <style>{fontStyle}</style>
      <div className="font-s min-h-screen" style={{ background: c.canvas, color: c.ink }}>
        <div className="flex">
          <aside className="sticky top-0 flex h-screen w-[244px] shrink-0 flex-col" style={{ background: c.sidebar, color: c.sidebarInk }}>
            <div className="px-5 pt-6 pb-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl" style={{ background: c.lavender }}>
                  <Sparkles className="h-4.5 w-4.5 text-white" strokeWidth={2.25} />
                </div>
                <div>
                  <div className="font-display text-[15px]" style={{ color: c.sidebarInk, fontWeight: 600 }}>Quail Valley</div>
                  <div className="font-s text-[10.5px]" style={{ color: c.sidebarMute, fontWeight: 500 }}>Town Homes HOA · 144 units</div>
                </div>
              </div>
            </div>
            <div className="mx-4 mb-5 flex items-center gap-2 rounded-full border px-3 py-1.5" style={{ background: c.panel, borderColor: "transparent", boxShadow: "0 2px 0 rgba(60,40,90,0.04)" }}>
              <Search className="h-3.5 w-3.5" style={{ color: c.inkMute }} />
              <span className="font-s text-[11.5px]" style={{ color: c.inkMute }}>Search the community</span>
              <span className="ml-auto inline-flex items-center gap-0.5">
                <Command className="h-2.5 w-2.5" style={{ color: c.inkMute }} />
                <span className="font-s text-[10px]" style={{ color: c.inkMute }}>K</span>
              </span>
            </div>
            <nav className="flex-1 space-y-4 px-3">
              {navSections.map((s) => (
                <div key={s.label}>
                  <div className="px-2 pb-1.5 text-[10px] uppercase tracking-[0.12em]" style={{ color: c.sidebarMute, fontWeight: 600 }}>{s.label}</div>
                  {s.items.map((item: any) => {
                    const Icon = item.icon;
                    return (
                      <button key={item.label} className="mb-0.5 flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left transition-colors"
                        style={item.active ? { background: c.panel, color: c.lavender, boxShadow: "0 2px 0 rgba(60,40,90,0.06)" } : { color: c.sidebarInk }}>
                        <span className="flex items-center gap-2.5">
                          <Icon className="h-4 w-4" strokeWidth={item.active ? 2.25 : 1.75} />
                          <span className="font-s text-[12.5px]" style={{ fontWeight: item.active ? 600 : 500 }}>{item.label}</span>
                        </span>
                        {item.badge && (
                          <span className="font-s tabular rounded-full px-2 py-0.5 text-[10px]"
                            style={{ background: item.active ? c.lavender : c.lavenderSoft, color: item.active ? "#fff" : c.lavender, fontWeight: 600 }}>
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
            <div className="px-4 pb-5 pt-4">
              <div className="rounded-3xl p-4" style={{ background: `linear-gradient(140deg, ${c.peachSoft} 0%, ${c.lavenderSoft} 100%)` }}>
                <div className="font-s text-[10px] uppercase tracking-[0.1em]" style={{ color: c.sidebarInk, fontWeight: 700 }}>Property Manager</div>
                <div className="font-display mt-1 text-[14px]" style={{ color: c.sidebarInk, fontWeight: 600 }}>Cardinal Property</div>
                <div className="font-s mt-0.5 text-[11px]" style={{ color: c.sidebarMute, fontWeight: 500 }}>Linda Hewitt · on call today</div>
              </div>
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b px-8 py-4 backdrop-blur" style={{ background: "rgba(251,246,240,0.85)", borderColor: c.border }}>
              <div className="flex items-center gap-3">
                <h1 className="font-display text-[22px]" style={{ color: c.ink, fontWeight: 600, letterSpacing: "-0.015em" }}>Dashboard</h1>
                <span className="font-s rounded-full px-2 py-0.5 text-[10px]" style={{ background: c.mintSoft, color: "#3D7A5F", fontWeight: 600 }}>● Live</span>
              </div>
              <div className="flex items-center gap-2.5">
                <button className="font-s inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-[12px]" style={{ borderColor: c.border, background: c.panel, color: c.inkSoft, fontWeight: 500 }}>
                  <Upload className="h-3.5 w-3.5" /> Upload
                </button>
                <button className="font-s inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px]" style={{ background: c.lavender, color: "#fff", fontWeight: 600, boxShadow: "0 4px 14px -4px rgba(156,123,217,0.5)" }}>
                  <Plus className="h-3.5 w-3.5" /> New Work Order
                </button>
                <div className="ml-1 flex h-9 w-9 items-center justify-center rounded-full border" style={{ borderColor: c.border, background: c.panel, color: c.inkSoft }}>
                  <Bell className="h-3.5 w-3.5" />
                </div>
              </div>
            </header>

            <div className="px-8 py-7">
              <div className="mb-6 flex items-center gap-3 rounded-3xl border px-5 py-4"
                style={{ background: `linear-gradient(120deg, ${c.peachSoft} 0%, ${c.lavenderSoft} 100%)`, borderColor: c.border }}>
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white" style={{ color: c.lavender }}>
                  <Sparkles className="h-4 w-4" strokeWidth={2.25} />
                </div>
                <p className="font-display flex-1 text-[16px] leading-snug" style={{ color: c.ink, fontWeight: 500, letterSpacing: "-0.01em" }}>
                  Centralized visibility across buildings, units, documents, insurance, and maintenance.
                </p>
                <span className="font-s text-[11px]" style={{ color: c.inkSoft, fontWeight: 500 }}>Last sync · 2 min ago</span>
              </div>

              <div className="grid grid-cols-6 gap-3">
                {kpis.map((k) => <KpiCard key={k.label} {...k} />)}
              </div>

              <div className="mt-7 grid grid-cols-3 gap-5">
                <section className="col-span-2 rounded-3xl border p-6" style={{ background: c.panel, borderColor: c.border, boxShadow: "0 18px 40px -32px rgba(156,123,217,0.3)" }}>
                  <div className="mb-5 flex items-end justify-between">
                    <div>
                      <div className="font-s text-[11px] uppercase tracking-[0.08em]" style={{ color: c.inkMute, fontWeight: 600 }}>Property Health</div>
                      <h2 className="font-display mt-1 text-[20px] leading-tight" style={{ color: c.ink, fontWeight: 600, letterSpacing: "-0.015em" }}>25 buildings, today</h2>
                    </div>
                    <div className="flex items-center gap-3">
                      {(["good", "watch", "urgent"] as S[]).map((s) => {
                        const t = tone[s];
                        const count = buildings.filter((b) => b.status === s).length;
                        return (
                          <span key={s} className="flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: t.bg }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.dot }} />
                            <span className="font-s text-[11px]" style={{ color: t.text, fontWeight: 600 }}>{t.label}</span>
                            <span className="font-display tabular text-[12px]" style={{ color: t.text, fontWeight: 600 }}>{count}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-2.5">
                    {buildings.map((b) => <BuildingTile key={b.num} {...b} />)}
                  </div>
                </section>

                <section className="rounded-3xl border p-6" style={{ background: c.panel, borderColor: c.border, boxShadow: "0 18px 40px -32px rgba(156,123,217,0.3)" }}>
                  <div className="mb-4 flex items-end justify-between">
                    <div>
                      <div className="font-s text-[11px] uppercase tracking-[0.08em]" style={{ color: c.inkMute, fontWeight: 600 }}>Around the community</div>
                      <h2 className="font-display mt-1 text-[20px] leading-tight" style={{ color: c.ink, fontWeight: 600, letterSpacing: "-0.015em" }}>Recent activity</h2>
                    </div>
                    <button className="font-s text-[11.5px]" style={{ color: c.lavender, fontWeight: 600 }}>View all</button>
                  </div>
                  <ul className="space-y-3">
                    {activity.map((a, i) => {
                      const Icon = a.icon;
                      const t = tone[a.tone];
                      return (
                        <li key={i} className="group flex gap-3">
                          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl" style={{ background: t.bg, color: t.text }}>
                            <Icon className="h-4 w-4" strokeWidth={1.75} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-s text-[12.5px] leading-snug" style={{ color: c.ink, fontWeight: 600 }}>{a.title}</div>
                            <div className="font-s mt-0.5 text-[11px]" style={{ color: c.inkMute }}>{a.meta} · {a.time}</div>
                          </div>
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 self-center opacity-0 transition-opacity group-hover:opacity-100" style={{ color: c.inkMute }} />
                        </li>
                      );
                    })}
                  </ul>
                  <button className="font-s mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-full border py-2 text-[11.5px]" style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}>
                    <CalendarClock className="h-3.5 w-3.5" /> Activity log
                  </button>
                </section>
              </div>

              <div className="mt-7 flex items-center justify-between text-[11px]" style={{ color: c.inkMute }}>
                <span className="font-s" style={{ fontWeight: 500 }}>Made with care for our neighbors</span>
                <span className="font-s" style={{ fontWeight: 500 }}>Quail Valley · Sugar Land, TX · 144 units · 25 buildings</span>
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
