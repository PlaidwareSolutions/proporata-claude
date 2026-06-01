import {
  LayoutDashboard, Building2, Home, ClipboardList, FileText, ShieldCheck, BarChart3, Settings,
  Search, Bell, Plus, Upload, ArrowUpRight, ArrowDownRight,
  Droplets, Wrench, Mail, CalendarCheck, FileCheck2, Receipt, ChevronRight, Terminal, Command,
} from "lucide-react";

const fontStyle = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
.font-d { font-family: 'IBM Plex Sans', system-ui, sans-serif; }
.font-mono-num { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.tabular { font-variant-numeric: tabular-nums; }
`;

type S = "good" | "watch" | "urgent";

const c = {
  canvas: "#0A0E14",
  panel: "#10151E",
  panel2: "#0E131B",
  sidebar: "#080B11",
  border: "#1C2433",
  borderSoft: "#161D29",
  ink: "#E6EAF2",
  inkSoft: "#9AA5B8",
  inkMute: "#5C6675",
  amber: "#F0B040",
  amberSoft: "#3A2E14",
  green: "#3FCF8E",
  greenSoft: "#0F2A1F",
  red: "#F0566E",
  redSoft: "#3A1822",
  blue: "#5B8DEF",
  blueSoft: "#152138",
};

const tone: Record<S, { dot: string; bg: string; text: string; label: string }> = {
  good: { dot: c.green, bg: c.greenSoft, text: c.green, label: "OK" },
  watch: { dot: c.amber, bg: c.amberSoft, text: c.amber, label: "WARN" },
  urgent: { dot: c.red, bg: c.redSoft, text: c.red, label: "CRIT" },
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
  { label: "TOTAL_UNITS", value: "144", delta: "100.0%", trend: "flat" as const, hint: "tracked" },
  { label: "BUILDINGS", value: "025", delta: "—", trend: "flat" as const, hint: "all_mapped" },
  { label: "OPEN_WO", value: "017", delta: "−4", trend: "down" as const, hint: "Δ 7d" },
  { label: "URGENT", value: "003", delta: "+1", trend: "up" as const, hint: "Δ 7d" },
  { label: "INS_GAPS", value: "008", delta: "−2", trend: "down" as const, hint: "Δ 7d" },
  { label: "ROOF_FLAG", value: "006", delta: "+1", trend: "up" as const, hint: "Δ 7d" },
];

const activity = [
  { icon: Droplets, code: "WO-1051", title: "roof_leak.reported", target: "BLDG09 · 2828 Camelot Lane", time: "00:12", tone: "urgent" as S },
  { icon: FileCheck2, code: "INS-220", title: "declaration.uploaded", target: "BLDG18 · 2803 Cambridge", time: "02:04", tone: "good" as S },
  { icon: Wrench, code: "WO-1043", title: "work_order.closed", target: "BLDG09 · Atlas Roofing", time: "1d", tone: "good" as S },
  { icon: Mail, code: "MSG-088", title: "correspondence.added", target: "BLDG10 · 2832 Camelot", time: "1d", tone: "watch" as S },
  { icon: CalendarCheck, code: "INS-198", title: "inspection.scheduled", target: "BLDG14 · Wed May 7", time: "2d", tone: "watch" as S },
  { icon: Receipt, code: "QUO-031", title: "vendor_quote.received", target: "BLDG22 · $8,450", time: "3d", tone: "good" as S },
];

const navSections = [
  { label: "[ overview ]", items: [{ icon: LayoutDashboard, label: "dashboard", active: true }, { icon: BarChart3, label: "reports" }] },
  { label: "[ property ]", items: [{ icon: Building2, label: "buildings" }, { icon: Home, label: "units" }] },
  { label: "[ ops ]", items: [{ icon: ClipboardList, label: "work_orders", badge: 17 }, { icon: ShieldCheck, label: "insurance", badge: 8 }, { icon: FileText, label: "documents" }] },
  { label: "[ system ]", items: [{ icon: Settings, label: "settings" }] },
];

function Sparkline({ color }: { color: string }) {
  const pts = [12, 9, 14, 11, 16, 10, 8, 12, 7, 9, 6];
  const w = 64, h = 18;
  const max = Math.max(...pts), min = Math.min(...pts);
  const path = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = h - ((v - min) / (max - min || 1)) * h;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}><path d={path} stroke={color} strokeWidth={1} fill="none" strokeLinecap="square" strokeLinejoin="miter" /></svg>;
}

function KpiCard({ label, value, delta, trend, hint }: (typeof kpis)[number]) {
  const tcolor = trend === "up" ? c.red : trend === "down" ? c.green : c.inkMute;
  const TrendIcon = trend === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="border p-3" style={{ background: c.panel, borderColor: c.border }}>
      <div className="flex items-center justify-between">
        <span className="font-mono-num text-[10px]" style={{ color: c.inkMute }}>{label}</span>
        <span className="font-mono-num inline-flex items-center gap-0.5 text-[10px]" style={{ color: tcolor }}>
          {trend !== "flat" && <TrendIcon className="h-2.5 w-2.5" />}{delta}
        </span>
      </div>
      <div className="mt-2 flex items-end justify-between">
        <span className="font-mono-num tabular text-[26px] leading-none" style={{ color: c.ink, fontWeight: 600 }}>{value}</span>
        <Sparkline color={trend === "up" ? c.red : trend === "down" ? c.green : c.amber} />
      </div>
      <div className="font-mono-num mt-1 text-[10px]" style={{ color: c.inkSoft }}>{hint}</div>
    </div>
  );
}

function BuildingTile({ num, units, status, openWO }: (typeof buildings)[number]) {
  const t = tone[status];
  return (
    <button className="group relative flex flex-col gap-1 border p-2 text-left transition-colors hover:bg-white/[0.02]"
      style={{ background: c.panel2, borderColor: c.border, borderLeft: `2px solid ${t.dot}` }}>
      <div className="flex items-center justify-between">
        <span className="font-mono-num text-[9.5px]" style={{ color: c.inkMute }}>BLDG_{String(num).padStart(2, "0")}</span>
        <span className="font-mono-num text-[8px] px-1 py-0" style={{ background: t.bg, color: t.text }}>{t.label}</span>
      </div>
      <div className="font-mono-num tabular text-[20px] leading-none" style={{ color: c.ink, fontWeight: 600 }}>{String(num).padStart(2, "0")}</div>
      <div className="flex items-center justify-between">
        <span className="font-mono-num text-[9.5px]" style={{ color: c.inkSoft }}>{units}u</span>
        {openWO > 0 ? (
          <span className="font-mono-num text-[9.5px]" style={{ color: t.text }}>{openWO} WO</span>
        ) : (
          <span className="font-mono-num text-[9.5px]" style={{ color: c.inkMute }}>0 WO</span>
        )}
      </div>
    </button>
  );
}

export function Dashboard() {
  return (
    <>
      <style>{fontStyle}</style>
      <div className="font-d min-h-screen" style={{ background: c.canvas, color: c.ink }}>
        <div className="flex">
          <aside className="sticky top-0 flex h-screen w-[220px] shrink-0 flex-col border-r" style={{ background: c.sidebar, borderColor: c.border }}>
            <div className="border-b px-3 py-3" style={{ borderColor: c.border }}>
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4" style={{ color: c.amber }} strokeWidth={2} />
                <div>
                  <div className="font-mono-num text-[12px]" style={{ color: c.ink, fontWeight: 600 }}>QV_HOA.ops</div>
                  <div className="font-mono-num text-[9.5px]" style={{ color: c.inkMute }}>v2.1.0 · 144u/25b</div>
                </div>
              </div>
            </div>
            <div className="border-b px-3 py-2" style={{ borderColor: c.border }}>
              <div className="flex items-center gap-2 border px-2 py-1" style={{ borderColor: c.border, background: c.panel }}>
                <Search className="h-3 w-3" style={{ color: c.inkMute }} />
                <span className="font-mono-num text-[10.5px]" style={{ color: c.inkMute }}>./search</span>
                <span className="ml-auto font-mono-num text-[9.5px]" style={{ color: c.inkMute }}>⌘K</span>
              </div>
            </div>
            <nav className="flex-1 space-y-3 px-2 py-3">
              {navSections.map((s) => (
                <div key={s.label}>
                  <div className="px-1.5 pb-1 font-mono-num text-[9.5px]" style={{ color: c.inkMute }}>{s.label}</div>
                  {s.items.map((item: any) => {
                    const Icon = item.icon;
                    return (
                      <button key={item.label} className="mb-0 flex w-full items-center justify-between px-1.5 py-1 text-left"
                        style={item.active ? { background: c.amberSoft, color: c.amber, borderLeft: `2px solid ${c.amber}` } : { color: c.inkSoft, borderLeft: "2px solid transparent" }}>
                        <span className="flex items-center gap-2">
                          <Icon className="h-3 w-3" strokeWidth={item.active ? 2 : 1.5} />
                          <span className="font-mono-num text-[11px]">{item.label}</span>
                        </span>
                        {item.badge && (
                          <span className="font-mono-num text-[9.5px] px-1" style={{ background: item.active ? c.amber : c.borderSoft, color: item.active ? c.canvas : c.inkSoft, fontWeight: 600 }}>
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
            <div className="border-t px-3 py-3" style={{ borderColor: c.border }}>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: c.green, boxShadow: `0 0 6px ${c.green}` }} />
                <div className="min-w-0 flex-1">
                  <div className="font-mono-num text-[10.5px]" style={{ color: c.ink, fontWeight: 600 }}>eleanor.marsh</div>
                  <div className="font-mono-num text-[9.5px]" style={{ color: c.inkMute }}>treasurer · online</div>
                </div>
              </div>
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b px-6 py-2.5" style={{ background: c.canvas, borderColor: c.border }}>
              <div className="flex items-center gap-3">
                <span className="font-mono-num text-[11px]" style={{ color: c.amber }}>~/dashboard</span>
                <span className="font-mono-num text-[10px]" style={{ color: c.inkMute }}>·</span>
                <span className="font-mono-num inline-flex items-center gap-1 text-[10px]" style={{ color: c.green }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.green, boxShadow: `0 0 6px ${c.green}` }} />LIVE
                </span>
                <span className="font-mono-num text-[10px]" style={{ color: c.inkMute }}>last_sync=2m_ago</span>
              </div>
              <div className="flex items-center gap-2">
                <button className="font-mono-num inline-flex items-center gap-1.5 border px-2.5 py-1 text-[11px]" style={{ borderColor: c.border, background: c.panel, color: c.inkSoft }}>
                  <Upload className="h-3 w-3" /> upload
                </button>
                <button className="font-mono-num inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px]" style={{ background: c.amber, color: c.canvas, fontWeight: 600 }}>
                  <Plus className="h-3 w-3" /> new_wo
                </button>
                <div className="ml-1 flex h-7 w-7 items-center justify-center border" style={{ borderColor: c.border, background: c.panel, color: c.inkSoft }}>
                  <Bell className="h-3 w-3" />
                </div>
              </div>
            </header>

            <div className="px-6 py-5">
              <div className="mb-4 flex items-center gap-3 border px-3 py-2" style={{ background: c.panel, borderColor: c.border, borderLeft: `2px solid ${c.amber}` }}>
                <span className="font-mono-num text-[10px]" style={{ color: c.amber }}>$</span>
                <p className="font-mono-num flex-1 text-[11.5px]" style={{ color: c.ink }}>
                  hoa-ops --status="centralized visibility across buildings, units, documents, insurance, maintenance"
                </p>
                <span className="font-mono-num text-[10px]" style={{ color: c.green }}>OK</span>
              </div>

              <div className="grid grid-cols-6 gap-2">
                {kpis.map((k) => <KpiCard key={k.label} {...k} />)}
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3">
                <section className="col-span-2 border p-4" style={{ background: c.panel, borderColor: c.border }}>
                  <div className="mb-3 flex items-center justify-between border-b pb-2" style={{ borderColor: c.borderSoft }}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono-num text-[10px]" style={{ color: c.amber }}>›</span>
                      <span className="font-mono-num text-[12px]" style={{ color: c.ink, fontWeight: 600 }}>property_health.list</span>
                      <span className="font-mono-num text-[10px]" style={{ color: c.inkMute }}>n=25</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {(["good", "watch", "urgent"] as S[]).map((s) => {
                        const t = tone[s];
                        const count = buildings.filter((b) => b.status === s).length;
                        return (
                          <span key={s} className="flex items-center gap-1">
                            <span className="h-2 w-2" style={{ background: t.dot }} />
                            <span className="font-mono-num text-[10px]" style={{ color: c.inkSoft }}>{t.label}</span>
                            <span className="font-mono-num text-[10px]" style={{ color: c.ink, fontWeight: 600 }}>{count}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {buildings.map((b) => <BuildingTile key={b.num} {...b} />)}
                  </div>
                </section>

                <section className="border p-4" style={{ background: c.panel, borderColor: c.border }}>
                  <div className="mb-3 flex items-center justify-between border-b pb-2" style={{ borderColor: c.borderSoft }}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono-num text-[10px]" style={{ color: c.amber }}>›</span>
                      <span className="font-mono-num text-[12px]" style={{ color: c.ink, fontWeight: 600 }}>activity.tail</span>
                    </div>
                    <span className="font-mono-num text-[10px]" style={{ color: c.green }}>● live</span>
                  </div>
                  <ul className="space-y-1.5">
                    {activity.map((a, i) => {
                      const t = tone[a.tone];
                      return (
                        <li key={i} className="group flex items-start gap-2 border-l-2 px-2 py-1.5" style={{ borderColor: t.dot, background: c.panel2 }}>
                          <span className="font-mono-num text-[9.5px]" style={{ color: c.inkMute, width: 32 }}>{a.time}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono-num text-[9.5px] px-1" style={{ background: t.bg, color: t.text, fontWeight: 600 }}>{a.code}</span>
                              <span className="font-mono-num text-[10.5px]" style={{ color: c.ink, fontWeight: 500 }}>{a.title}</span>
                            </div>
                            <div className="font-mono-num mt-0.5 text-[10px]" style={{ color: c.inkSoft }}>{a.target}</div>
                          </div>
                          <ChevronRight className="h-3 w-3 shrink-0 self-center opacity-0 group-hover:opacity-100" style={{ color: c.inkMute }} />
                        </li>
                      );
                    })}
                  </ul>
                  <button className="font-mono-num mt-3 inline-flex w-full items-center justify-center gap-1.5 border py-1 text-[10.5px]" style={{ borderColor: c.border, color: c.inkSoft, background: c.panel2 }}>
                    cat activity.log | less
                  </button>
                </section>
              </div>

              <div className="mt-4 flex items-center justify-between border-t pt-2 font-mono-num text-[10px]" style={{ color: c.inkMute, borderColor: c.border }}>
                <span>$ uptime · 99.98% · last 30d</span>
                <span>quail_valley.tx · 144u · 25b · region=us-south</span>
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
