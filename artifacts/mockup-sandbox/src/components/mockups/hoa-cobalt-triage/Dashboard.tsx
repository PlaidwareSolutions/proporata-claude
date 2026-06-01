import {
  LayoutDashboard, Building2, Home, ClipboardList, FileText, ShieldCheck, BarChart3, Settings,
  Search, Bell, Plus, Inbox, Droplets, Wrench, FileCheck2, Mail, CalendarCheck, Receipt,
  CheckCircle2, Clock, AlertTriangle, ArrowRight, MoreHorizontal, Filter, Zap, Command,
} from "lucide-react";

const fontStyle = `
@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
.font-tight { font-family: 'Inter Tight', system-ui, sans-serif; letter-spacing: -0.01em; }
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

type Priority = "urgent" | "high" | "normal";
type Item = {
  id: string; icon: any; title: string; building: string; meta: string;
  priority: Priority; assignee?: string; due?: string; tags: string[];
};

const inbox: Item[] = [
  { id: "WO-1051", icon: Droplets, title: "Roof leak — active water intrusion", building: "Bldg 9 · 2828 Camelot Lane",
    meta: "Reported by board · needs vendor dispatch", priority: "urgent", due: "Today", tags: ["Roof", "Vendor"] },
  { id: "WO-1050", icon: AlertTriangle, title: "Foundation crack reported in unit 5", building: "Bldg 5 · 2814 Hampshire",
    meta: "Owner submitted with photos", priority: "urgent", due: "Today", tags: ["Structural", "Inspect"] },
  { id: "INS-22", icon: ShieldCheck, title: "Insurance declaration missing", building: "Bldg 14 · 2819 La Quinta",
    meta: "Renewal cycle Q2 — request from owner", priority: "high", due: "Fri", tags: ["Insurance"] },
  { id: "WO-1049", icon: Wrench, title: "Gate motor intermittent failure", building: "Bldg 3 · 2807 Yorktown",
    meta: "Three resident reports this week", priority: "high", due: "Fri", tags: ["Common area"] },
  { id: "DOC-89", icon: FileCheck2, title: "Vendor W-9 missing — Atlas Roofing", building: "Vendor onboarding",
    meta: "Required before next invoice", priority: "high", due: "Mon", tags: ["Vendor"] },
  { id: "WO-1048", icon: Receipt, title: "Quote review — Bldg 22 exterior paint", building: "Bldg 22 · 2841 Princess",
    meta: "$8,450 · Cedar & Stone Painting", priority: "normal", due: "Next wk", tags: ["Approval"] },
];

const inFlight = [
  { id: "WO-1043", icon: Wrench, title: "Roof patch — Bldg 9 unit 4", assignee: "Atlas Roofing", progress: 80 },
  { id: "WO-1041", icon: CalendarCheck, title: "Annual insurance audit", assignee: "L. Hewitt", progress: 55 },
  { id: "WO-1039", icon: Mail, title: "Board notice — assessment update", assignee: "E. Marsh", progress: 30 },
];

const closedToday = [
  { id: "WO-1042", title: "Sprinkler line cap — Bldg 7", who: "Greenline Irrig.", time: "11:42 am" },
  { id: "WO-1040", title: "Mailbox key replacement — Bldg 12", who: "Cardinal PM", time: "9:18 am" },
];

const navSections = [
  { label: "Overview", items: [{ icon: Inbox, label: "Action Queue", active: true, badge: 14 }, { icon: LayoutDashboard, label: "Overview" }, { icon: BarChart3, label: "Reports" }] },
  { label: "Property", items: [{ icon: Building2, label: "Buildings" }, { icon: Home, label: "Units" }] },
  { label: "Operations", items: [{ icon: ClipboardList, label: "Work Orders", badge: 17 }, { icon: ShieldCheck, label: "Insurance", badge: 8 }, { icon: FileText, label: "Documents" }] },
  { label: "Workspace", items: [{ icon: Settings, label: "Settings" }] },
];

const tone: Record<Priority, { dot: string; chip: string; chipBg: string; label: string; bar: string }> = {
  urgent: { dot: c.rose, chip: "#8C1B36", chipBg: c.roseSoft, label: "URGENT", bar: c.rose },
  high:   { dot: c.amber, chip: "#7B5410", chipBg: c.amberSoft, label: "HIGH", bar: c.amber },
  normal: { dot: c.cobalt, chip: c.cobalt, chipBg: c.cobaltSoft, label: "NORMAL", bar: c.cobalt },
};

function ItemCard({ item }: { item: Item }) {
  const t = tone[item.priority];
  const Icon = item.icon;
  return (
    <div
      className="group relative flex items-start gap-3 rounded-xl border bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-sm"
      style={{ borderColor: c.border }}
    >
      <span className="absolute left-0 top-3 bottom-3 w-1 rounded-r" style={{ background: t.bar }} />
      <div className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: t.chipBg, color: t.chip }}>
        <Icon className="h-4 w-4" strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono-num rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: c.borderSoft, color: c.inkSoft }}>{item.id}</span>
          <span className="font-tight rounded px-1.5 py-0.5 text-[9.5px] font-bold tracking-wider" style={{ background: t.chipBg, color: t.chip }}>{t.label}</span>
          {item.tags.map((tag) => (
            <span key={tag} className="font-tight text-[10.5px]" style={{ color: c.inkMute }}>· {tag}</span>
          ))}
        </div>
        <div className="font-tight mt-1 text-[13.5px] leading-snug" style={{ color: c.ink, fontWeight: 600 }}>{item.title}</div>
        <div className="font-tight mt-0.5 text-[11.5px]" style={{ color: c.inkSoft }}>{item.building}</div>
        <div className="font-tight mt-0.5 text-[11px]" style={{ color: c.inkMute }}>{item.meta}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <span className="font-mono-num inline-flex items-center gap-1 text-[10.5px]" style={{ color: c.inkMute }}>
          <Clock className="h-3 w-3" /> {item.due}
        </span>
        <div className="flex items-center gap-1">
          <button className="font-tight rounded-md border px-2 py-1 text-[11px]" style={{ borderColor: c.border, background: c.panel, color: c.inkSoft }}>Assign</button>
          <button className="font-tight inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 500 }}>
            Resolve <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

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
                <div className="flex h-8 w-8 items-center justify-center rounded-md" style={{ background: c.cobalt }}>
                  <Zap className="h-4 w-4 text-white" strokeWidth={2.25} />
                </div>
                <div>
                  <div className="text-[13.5px] text-white" style={{ fontWeight: 600 }}>Quail Valley HOA</div>
                  <div className="font-mono-num text-[10px]">144u · 25b</div>
                </div>
              </div>
            </div>
            <div className="mx-4 mb-4 flex items-center gap-2 rounded-md border px-2.5 py-1.5" style={{ borderColor: "#1A2140", background: "rgba(255,255,255,0.03)" }}>
              <Search className="h-3.5 w-3.5" /> <span className="text-[11.5px]">Search…</span>
              <span className="ml-auto inline-flex items-center gap-0.5"><Command className="h-2.5 w-2.5" /><span className="font-mono-num text-[10px]">K</span></span>
            </div>
            <nav className="flex-1 space-y-4 px-2.5">
              {navSections.map((section) => (
                <div key={section.label}>
                  <div className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wider" style={{ color: "#5C648A" }}>{section.label}</div>
                  {section.items.map((item: any) => {
                    const Icon = item.icon;
                    return (
                      <button key={item.label} className="mb-0.5 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left"
                        style={item.active ? { background: "rgba(50,69,255,0.16)", color: "#fff" } : { color: c.sidebarMute }}>
                        <span className="flex items-center gap-2"><Icon className="h-3.5 w-3.5" strokeWidth={item.active ? 2.25 : 1.75} />
                          <span className="text-[12.5px]" style={{ fontWeight: item.active ? 500 : 400 }}>{item.label}</span></span>
                        {item.badge && <span className="font-mono-num rounded px-1.5 py-0 text-[10px]"
                          style={{ background: item.active ? c.cobalt : "rgba(255,255,255,0.08)", color: "#fff" }}>{item.badge}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
            <div className="px-4 pb-4 pt-3">
              <div className="flex items-center gap-2.5 rounded-lg border p-2.5" style={{ borderColor: "#1A2140", background: "rgba(255,255,255,0.025)" }}>
                <div className="flex h-7 w-7 items-center justify-center rounded-full text-[11px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>EM</div>
                <div className="min-w-0 flex-1"><div className="text-[11.5px] text-white" style={{ fontWeight: 500 }}>Eleanor Marsh</div><div className="text-[10px]">Board · Treasurer</div></div>
              </div>
            </div>
          </aside>

          {/* Main */}
          <main className="min-w-0 flex-1">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b px-7 py-3.5 backdrop-blur" style={{ background: "rgba(246,247,251,0.85)", borderColor: c.border }}>
              <div className="flex items-center gap-3">
                <h1 className="text-[18px]" style={{ fontWeight: 600 }}>Action Queue</h1>
                <span className="font-mono-num rounded-md px-1.5 py-0.5 text-[10px]" style={{ background: c.roseSoft, color: "#8C1B36", fontWeight: 600 }}>2 URGENT</span>
                <span className="font-mono-num rounded-md px-1.5 py-0.5 text-[10px]" style={{ background: c.amberSoft, color: "#7B5410", fontWeight: 600 }}>3 HIGH</span>
                <span className="font-mono-num rounded-md px-1.5 py-0.5 text-[10px]" style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 600 }}>9 NORMAL</span>
              </div>
              <div className="flex items-center gap-2.5">
                <button className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px]" style={{ borderColor: c.border, background: c.panel, color: c.inkSoft }}>
                  <Filter className="h-3.5 w-3.5" /> Mine
                </button>
                <button className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 500 }}>
                  <Plus className="h-3.5 w-3.5" /> New
                </button>
                <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-full border" style={{ borderColor: c.border, background: c.panel, color: c.inkSoft }}>
                  <Bell className="h-3.5 w-3.5" />
                </div>
              </div>
            </header>

            <div className="px-7 py-6">
              <div className="grid grid-cols-3 gap-5">
                {/* Inbox column */}
                <section className="col-span-2 space-y-3">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: c.inkMute }}>Needs Attention · Today</div>
                      <h2 className="mt-0.5 text-[18px]" style={{ fontWeight: 600 }}>14 open items, sorted by impact</h2>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {["All", "Roofs", "Insurance", "Common", "Vendor"].map((t, i) => (
                        <button key={t} className="rounded-full border px-2.5 py-1 text-[11px]"
                          style={i === 0 ? { background: c.ink, color: "#fff", borderColor: c.ink } : { background: c.panel, color: c.inkSoft, borderColor: c.border }}>{t}</button>
                      ))}
                    </div>
                  </div>
                  {inbox.map((it) => <ItemCard key={it.id} item={it} />)}
                </section>

                {/* Right rail */}
                <aside className="space-y-4">
                  <div className="rounded-xl border bg-white p-4" style={{ borderColor: c.border }}>
                    <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: c.inkMute }}>This Week</div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      {[
                        { v: "9", l: "Resolved", color: c.emerald },
                        { v: "14", l: "Open", color: c.cobalt },
                        { v: "3", l: "Urgent", color: c.rose },
                      ].map((s) => (
                        <div key={s.l} className="rounded-lg border py-2.5" style={{ borderColor: c.borderSoft, background: c.canvas }}>
                          <div className="font-mono-num text-[22px]" style={{ color: s.color, fontWeight: 700 }}>{s.v}</div>
                          <div className="text-[10.5px]" style={{ color: c.inkMute }}>{s.l}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border bg-white p-4" style={{ borderColor: c.border }}>
                    <div className="mb-2.5 flex items-center justify-between">
                      <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: c.inkMute }}>In Flight</div>
                      <span className="font-mono-num text-[10.5px]" style={{ color: c.inkMute }}>{inFlight.length} active</span>
                    </div>
                    <ul className="space-y-3">
                      {inFlight.map((f) => {
                        const Icon = f.icon;
                        return (
                          <li key={f.id}>
                            <div className="flex items-center gap-2">
                              <Icon className="h-3.5 w-3.5" style={{ color: c.inkMute }} />
                              <span className="font-mono-num text-[10.5px]" style={{ color: c.inkMute }}>{f.id}</span>
                              <span className="ml-auto text-[10.5px]" style={{ color: c.inkSoft }}>{f.assignee}</span>
                            </div>
                            <div className="mt-1 text-[12px]" style={{ color: c.ink, fontWeight: 500 }}>{f.title}</div>
                            <div className="mt-1.5 h-1.5 w-full rounded-full" style={{ background: c.borderSoft }}>
                              <div className="h-full rounded-full" style={{ width: `${f.progress}%`, background: c.cobalt }} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <div className="rounded-xl border bg-white p-4" style={{ borderColor: c.border }}>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: c.inkMute }}>Closed Today</div>
                      <CheckCircle2 className="h-3.5 w-3.5" style={{ color: c.emerald }} />
                    </div>
                    <ul className="space-y-2.5">
                      {closedToday.map((cl) => (
                        <li key={cl.id} className="flex items-center gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" style={{ color: c.emerald }} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[11.5px]" style={{ color: c.ink, fontWeight: 500 }}>{cl.title}</div>
                            <div className="font-mono-num text-[10px]" style={{ color: c.inkMute }}>{cl.id} · {cl.who} · {cl.time}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <button className="flex w-full items-center justify-center gap-1.5 rounded-md border py-1.5 text-[11.5px]" style={{ borderColor: c.border, color: c.inkSoft }}>
                    <MoreHorizontal className="h-3.5 w-3.5" /> View full activity
                  </button>
                </aside>
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
