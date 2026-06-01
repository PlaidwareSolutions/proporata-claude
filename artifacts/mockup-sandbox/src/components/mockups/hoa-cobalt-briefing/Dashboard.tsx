import {
  LayoutDashboard, Building2, Home, ClipboardList, FileText, ShieldCheck, BarChart3, Settings,
  Search, Bell, Plus, Sparkles, ArrowRight, ArrowUpRight, ArrowDownRight, Zap, Command,
  Quote, Download,
} from "lucide-react";

const fontStyle = `
@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&family=JetBrains+Mono:wght@400;500&display=swap');
.font-tight { font-family: 'Inter Tight', system-ui, sans-serif; letter-spacing: -0.01em; }
.font-serif { font-family: 'Source Serif 4', Georgia, serif; }
.font-mono-num { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.tabular { font-variant-numeric: tabular-nums; }
`;

const c = {
  canvas: "#F6F7FB", panel: "#FFFFFF", sidebar: "#0B1020", sidebarMute: "#A4ACC4",
  ink: "#0B1020", inkSoft: "#3F4661", inkMute: "#7A819B",
  border: "#E5E8F2", borderSoft: "#EFF1F8",
  cobalt: "#3245FF", cobaltSoft: "#E5E8FF",
  emerald: "#10A37F", emeraldSoft: "#DCF3EC",
  amber: "#C8851A", amberSoft: "#FBEFD6",
  rose: "#D6315B", roseSoft: "#FBE3E9",
};

const navSections = [
  { label: "Overview", items: [{ icon: Sparkles, label: "Briefing", active: true }, { icon: LayoutDashboard, label: "Operational" }, { icon: BarChart3, label: "Reports" }] },
  { label: "Property", items: [{ icon: Building2, label: "Buildings" }, { icon: Home, label: "Units" }] },
  { label: "Operations", items: [{ icon: ClipboardList, label: "Work Orders", badge: 17 }, { icon: ShieldCheck, label: "Insurance", badge: 8 }, { icon: FileText, label: "Documents" }] },
  { label: "Workspace", items: [{ icon: Settings, label: "Settings" }] },
];

const headlines = [
  {
    kicker: "URGENT",
    kickerColor: c.rose,
    title: "Three buildings need urgent attention this week.",
    body: "Buildings 5, 9, and 14 each have an active issue that should be reviewed by the board before Friday — a foundation crack reported on Hampshire, a roof leak with active water intrusion on Camelot, and an insurance declaration gap on La Quinta.",
    cta: "Review urgent items",
  },
  {
    kicker: "INSURANCE",
    kickerColor: c.amber,
    title: "Eight insurance declarations are still outstanding.",
    body: "We are 92% complete on the spring declaration cycle. Six of the remaining eight owners have been contacted in the last seven days; two have not responded since April 18.",
    cta: "See outstanding owners",
  },
  {
    kicker: "MAINTENANCE",
    kickerColor: c.emerald,
    title: "The roof program is on schedule and under budget.",
    body: "The 25-building roof inspection sweep is 92% complete with five buildings remaining. Vendor spend is tracking 6% under the approved $148K reserve allocation. Six buildings flagged for follow-up work, none structural.",
    cta: "Open roof program",
  },
];

const numbers = [
  { l: "Open Work Orders", v: "17", d: "−4 this week", color: c.emerald, dir: "down" as const },
  { l: "Urgent", v: "3", d: "+1 vs last week", color: c.rose, dir: "up" as const },
  { l: "Insurance gaps", v: "8", d: "−2 this week", color: c.emerald, dir: "down" as const },
  { l: "Roof attention", v: "6", d: "+1 vs last week", color: c.amber, dir: "up" as const },
  { l: "Vendor spend MTD", v: "$23.4K", d: "of $32K planned", color: c.cobalt, dir: "flat" as const },
  { l: "Reserve health", v: "94%", d: "of target", color: c.emerald, dir: "flat" as const },
];

const decisions = [
  { id: "DEC-31", title: "Approve $8,450 quote — Bldg 22 exterior paint", deadline: "Mon May 12", who: "Treasurer signoff" },
  { id: "DEC-30", title: "Authorize Pinnacle Inspections for full plat roof survey", deadline: "Wed May 14", who: "Board majority" },
  { id: "DEC-29", title: "Adopt revised insurance compliance policy v3", deadline: "Mon May 19", who: "Board vote" },
];

export function Dashboard() {
  return (
    <>
      <style>{fontStyle}</style>
      <div className="font-tight min-h-screen" style={{ background: c.canvas, color: c.ink }}>
        <div className="flex">
          {/* Sidebar */}
          <aside className="sticky top-0 flex h-screen w-[236px] shrink-0 flex-col" style={{ background: c.sidebar, color: c.sidebarMute }}>
            <div className="px-4 pt-5 pb-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-md" style={{ background: c.cobalt }}><Zap className="h-4 w-4 text-white" strokeWidth={2.25} /></div>
                <div><div className="text-[13.5px] text-white" style={{ fontWeight: 600 }}>Quail Valley HOA</div><div className="font-mono-num text-[10px]">144u · 25b</div></div>
              </div>
            </div>
            <div className="mx-4 mb-4 flex items-center gap-2 rounded-md border px-2.5 py-1.5" style={{ borderColor: "#1A2140", background: "rgba(255,255,255,0.03)" }}>
              <Search className="h-3.5 w-3.5" /> <span className="text-[11.5px]">Search…</span>
              <span className="ml-auto inline-flex items-center gap-0.5"><Command className="h-2.5 w-2.5" /><span className="font-mono-num text-[10px]">K</span></span>
            </div>
            <nav className="flex-1 space-y-4 px-2.5">
              {navSections.map((s) => (
                <div key={s.label}>
                  <div className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wider" style={{ color: "#5C648A" }}>{s.label}</div>
                  {s.items.map((item: any) => {
                    const Icon = item.icon;
                    return (
                      <button key={item.label} className="mb-0.5 flex w-full items-center justify-between rounded-md px-2 py-1.5"
                        style={item.active ? { background: "rgba(50,69,255,0.16)", color: "#fff" } : { color: c.sidebarMute }}>
                        <span className="flex items-center gap-2"><Icon className="h-3.5 w-3.5" strokeWidth={item.active ? 2.25 : 1.75} /><span className="text-[12.5px]" style={{ fontWeight: item.active ? 500 : 400 }}>{item.label}</span></span>
                        {item.badge && <span className="font-mono-num rounded px-1.5 py-0 text-[10px]" style={{ background: item.active ? c.cobalt : "rgba(255,255,255,0.08)", color: "#fff" }}>{item.badge}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
            <div className="px-4 pb-4 pt-3">
              <div className="rounded-lg border p-2.5" style={{ borderColor: "#1A2140", background: "rgba(255,255,255,0.025)" }}>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "#5C648A" }}>Drafted by</div>
                <div className="mt-1 text-[12px] text-white" style={{ fontWeight: 500 }}>Cardinal Property Mgmt.</div>
                <div className="text-[10.5px]">Friday, May 2 · 7:42 am</div>
              </div>
            </div>
          </aside>

          {/* Main */}
          <main className="min-w-0 flex-1">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b px-7 py-3.5 backdrop-blur" style={{ background: "rgba(246,247,251,0.85)", borderColor: c.border }}>
              <div className="flex items-center gap-3">
                <h1 className="text-[18px]" style={{ fontWeight: 600 }}>Weekly Briefing</h1>
                <span className="font-mono-num rounded-md px-1.5 py-0.5 text-[10px]" style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 500 }}>Issue 18 · May 2026</span>
              </div>
              <div className="flex items-center gap-2.5">
                <button className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px]" style={{ borderColor: c.border, background: c.panel, color: c.inkSoft }}><Download className="h-3.5 w-3.5" /> Export PDF</button>
                <button className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 500 }}><Plus className="h-3.5 w-3.5" /> New Item</button>
                <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-full border" style={{ borderColor: c.border, background: c.panel, color: c.inkSoft }}><Bell className="h-3.5 w-3.5" /></div>
              </div>
            </header>

            <div className="px-10 py-8">
              {/* Hero */}
              <div className="mb-8">
                <div className="flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-[0.18em]" style={{ color: c.cobalt }}>
                  <Sparkles className="h-3.5 w-3.5" /> The Town Homes of Quail Valley · Week of May 5
                </div>
                <h2 className="font-serif mt-3 text-[40px] leading-[1.05]" style={{ color: c.ink, fontWeight: 600, letterSpacing: "-0.02em" }}>
                  A steady week with three items needing the board's attention.
                </h2>
                <p className="font-serif mt-3 max-w-3xl text-[16px] leading-relaxed" style={{ color: c.inkSoft }}>
                  Across 25 buildings and 144 units, operations are running on plan. Three buildings have urgent issues, eight insurance declarations remain outstanding, and the roof program is tracking ahead of schedule. Below is a summary of what's happening, what needs deciding, and where the numbers stand.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-7">
                {/* Headlines */}
                <section className="col-span-2 space-y-5">
                  {headlines.map((h, i) => (
                    <article key={i} className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
                      <div className="font-tight text-[10.5px] font-bold uppercase tracking-[0.18em]" style={{ color: h.kickerColor }}>
                        {h.kicker}
                      </div>
                      <h3 className="font-serif mt-2 text-[22px] leading-snug" style={{ color: c.ink, fontWeight: 600, letterSpacing: "-0.015em" }}>
                        {h.title}
                      </h3>
                      <p className="font-serif mt-2 text-[14.5px] leading-relaxed" style={{ color: c.inkSoft }}>
                        {h.body}
                      </p>
                      <button className="mt-3 inline-flex items-center gap-1 text-[12.5px]" style={{ color: c.cobalt, fontWeight: 600 }}>
                        {h.cta} <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </article>
                  ))}

                  {/* Pull quote */}
                  <article className="rounded-xl border p-6" style={{ borderColor: c.border, background: `linear-gradient(135deg, ${c.cobaltSoft} 0%, #fff 100%)` }}>
                    <Quote className="h-5 w-5" style={{ color: c.cobalt }} />
                    <p className="font-serif mt-2 text-[19px] leading-snug" style={{ color: c.ink, fontWeight: 500, fontStyle: "italic" }}>
                      "Atlas Roofing completed the Building 9 patch ahead of schedule. We expect the affected unit to be fully dry by Wednesday, with no further escalation."
                    </p>
                    <div className="mt-3 text-[11.5px]" style={{ color: c.inkSoft }}>
                      Linda Hewitt · Property Manager · noted in WO-1043
                    </div>
                  </article>
                </section>

                {/* Right rail */}
                <aside className="space-y-5">
                  <div className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
                    <div className="text-[10.5px] font-bold uppercase tracking-[0.18em]" style={{ color: c.inkMute }}>By the numbers</div>
                    <div className="mt-3 divide-y" style={{ borderColor: c.borderSoft }}>
                      {numbers.map((n) => {
                        const TrendIcon = n.dir === "up" ? ArrowUpRight : n.dir === "down" ? ArrowDownRight : ArrowRight;
                        return (
                          <div key={n.l} className="flex items-baseline justify-between border-t py-2.5 first:border-t-0" style={{ borderColor: c.borderSoft }}>
                            <div>
                              <div className="text-[11.5px]" style={{ color: c.inkSoft }}>{n.l}</div>
                              <div className="mt-0.5 inline-flex items-center gap-1 text-[10.5px]" style={{ color: n.color }}>
                                <TrendIcon className="h-3 w-3" /> {n.d}
                              </div>
                            </div>
                            <div className="font-mono-num text-[20px]" style={{ color: c.ink, fontWeight: 700 }}>{n.v}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
                    <div className="text-[10.5px] font-bold uppercase tracking-[0.18em]" style={{ color: c.inkMute }}>Decisions needed</div>
                    <ul className="mt-3 space-y-3">
                      {decisions.map((d) => (
                        <li key={d.id} className="rounded-lg border p-3" style={{ borderColor: c.borderSoft }}>
                          <div className="flex items-center justify-between">
                            <span className="font-mono-num text-[10.5px]" style={{ color: c.inkMute }}>{d.id}</span>
                            <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: c.amberSoft, color: "#7B5410", fontWeight: 600 }}>{d.deadline}</span>
                          </div>
                          <div className="font-serif mt-1.5 text-[13.5px] leading-snug" style={{ color: c.ink, fontWeight: 500 }}>{d.title}</div>
                          <div className="mt-1 text-[11px]" style={{ color: c.inkMute }}>{d.who}</div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-xl border p-5" style={{ borderColor: c.border, background: c.ink, color: "#fff" }}>
                    <div className="text-[10.5px] font-bold uppercase tracking-[0.18em]" style={{ color: c.cobaltSoft }}>Health score</div>
                    <div className="font-mono-num mt-2 text-[44px] leading-none" style={{ fontWeight: 700, letterSpacing: "-0.03em" }}>
                      87<span className="text-[18px]" style={{ color: "rgba(255,255,255,0.5)" }}>/100</span>
                    </div>
                    <div className="mt-2 text-[12px]" style={{ color: "rgba(255,255,255,0.7)" }}>
                      Holding steady. The community is in good standing across maintenance, insurance, and reserves.
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10.5px]">
                      <div><div className="font-mono-num text-[14px] text-white" style={{ fontWeight: 600 }}>92%</div><div style={{ color: "rgba(255,255,255,0.6)" }}>Maint.</div></div>
                      <div><div className="font-mono-num text-[14px] text-white" style={{ fontWeight: 600 }}>94%</div><div style={{ color: "rgba(255,255,255,0.6)" }}>Compl.</div></div>
                      <div><div className="font-mono-num text-[14px] text-white" style={{ fontWeight: 600 }}>76%</div><div style={{ color: "rgba(255,255,255,0.6)" }}>Engage</div></div>
                    </div>
                  </div>
                </aside>
              </div>

              <div className="mt-8 flex items-center justify-between border-t pt-5 text-[10.5px]" style={{ color: c.inkMute, borderColor: c.border }}>
                <span>Quail Valley · Sugar Land, TX · 144 units · 25 buildings</span>
                <span>Briefing #18 · Drafted Friday May 2 · Distributed to board</span>
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
