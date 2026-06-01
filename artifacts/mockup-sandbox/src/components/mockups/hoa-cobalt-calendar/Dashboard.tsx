import {
  LayoutDashboard, Building2, Home, ClipboardList, FileText, ShieldCheck, BarChart3, Settings,
  Search, Bell, Plus, ChevronLeft, ChevronRight, CalendarDays, Filter, Zap, Command,
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
  violet: "#7C5BFF", violetSoft: "#ECE6FF",
};

type Cat = "roof" | "insurance" | "vendor" | "inspection" | "meeting";
const catColor: Record<Cat, { bg: string; text: string; bar: string; label: string }> = {
  roof:       { bg: c.roseSoft,    text: "#8C1B36", bar: c.rose,    label: "Roof" },
  insurance:  { bg: c.cobaltSoft,  text: c.cobalt,  bar: c.cobalt,  label: "Insurance" },
  vendor:     { bg: c.amberSoft,   text: "#7B5410", bar: c.amber,   label: "Vendor" },
  inspection: { bg: c.emeraldSoft, text: "#0A6E55", bar: c.emerald, label: "Inspection" },
  meeting:    { bg: c.violetSoft,  text: "#5740C2", bar: c.violet,  label: "Meeting" },
};

type Event = { row: number; startDay: number; len: number; cat: Cat; title: string };
// 14-day window. Day index 0..13. Row index = building or program lane.
const lanes = [
  "Bldg 5 — Hampshire",
  "Bldg 9 — Camelot",
  "Bldg 14 — La Quinta",
  "Bldg 22 — Princess",
  "Insurance · all bldgs",
  "Reserve study",
  "Board",
];

const events: Event[] = [
  { row: 0, startDay: 1, len: 1, cat: "inspection", title: "Foundation inspection" },
  { row: 0, startDay: 4, len: 2, cat: "vendor", title: "Foundation repair window" },
  { row: 1, startDay: 0, len: 1, cat: "roof", title: "Emergency tarp" },
  { row: 1, startDay: 2, len: 3, cat: "roof", title: "Roof patch — Atlas" },
  { row: 1, startDay: 8, len: 1, cat: "inspection", title: "Post-repair inspection" },
  { row: 2, startDay: 3, len: 1, cat: "inspection", title: "Roof inspection" },
  { row: 2, startDay: 5, len: 2, cat: "insurance", title: "Declaration filing" },
  { row: 3, startDay: 6, len: 4, cat: "vendor", title: "Exterior paint — Cedar & Stone" },
  { row: 4, startDay: 0, len: 5, cat: "insurance", title: "Q2 declaration sweep · 8 outstanding" },
  { row: 4, startDay: 9, len: 3, cat: "insurance", title: "Renewal review window" },
  { row: 5, startDay: 5, len: 6, cat: "vendor", title: "Reserve study site visits" },
  { row: 6, startDay: 7, len: 1, cat: "meeting", title: "Board · monthly" },
  { row: 6, startDay: 13, len: 1, cat: "meeting", title: "Finance committee" },
];

const days = [
  "Mon 5", "Tue 6", "Wed 7", "Thu 8", "Fri 9", "Sat 10", "Sun 11",
  "Mon 12", "Tue 13", "Wed 14", "Thu 15", "Fri 16", "Sat 17", "Sun 18",
];

const today = 2;

const navSections = [
  { label: "Overview", items: [{ icon: CalendarDays, label: "Schedule", active: true }, { icon: LayoutDashboard, label: "Overview" }, { icon: BarChart3, label: "Reports" }] },
  { label: "Property", items: [{ icon: Building2, label: "Buildings" }, { icon: Home, label: "Units" }] },
  { label: "Operations", items: [{ icon: ClipboardList, label: "Work Orders", badge: 17 }, { icon: ShieldCheck, label: "Insurance", badge: 8 }, { icon: FileText, label: "Documents" }] },
  { label: "Workspace", items: [{ icon: Settings, label: "Settings" }] },
];

const dayWidth = 64;
const rowHeight = 44;

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
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "#5C648A" }}>Categories</div>
                {(Object.keys(catColor) as Cat[]).map((k) => (
                  <label key={k} className="mt-2 flex items-center gap-2 text-[11.5px]">
                    <input type="checkbox" defaultChecked className="accent-blue-500" />
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: catColor[k].bar }} />
                    <span>{catColor[k].label}</span>
                  </label>
                ))}
              </div>
            </div>
          </aside>

          {/* Main */}
          <main className="min-w-0 flex-1">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b px-7 py-3.5 backdrop-blur" style={{ background: "rgba(246,247,251,0.85)", borderColor: c.border }}>
              <div className="flex items-center gap-3">
                <h1 className="text-[18px]" style={{ fontWeight: 600 }}>Operations Schedule</h1>
                <div className="flex items-center gap-1 rounded-md border bg-white px-1 py-0.5" style={{ borderColor: c.border }}>
                  <button className="rounded px-2 py-1 text-[11px]" style={{ color: c.inkSoft }}><ChevronLeft className="h-3.5 w-3.5" /></button>
                  <span className="font-mono-num px-2 text-[11.5px]" style={{ color: c.ink, fontWeight: 600 }}>May 5 — May 18, 2026</span>
                  <button className="rounded px-2 py-1 text-[11px]" style={{ color: c.inkSoft }}><ChevronRight className="h-3.5 w-3.5" /></button>
                </div>
                <div className="flex items-center gap-1 rounded-md border p-0.5" style={{ borderColor: c.border, background: c.panel }}>
                  {["Day", "Week", "2 Weeks", "Month"].map((v, i) => (
                    <button key={v} className="rounded px-2 py-0.5 text-[11px]"
                      style={i === 2 ? { background: c.ink, color: "#fff", fontWeight: 500 } : { color: c.inkSoft }}>{v}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <button className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px]" style={{ borderColor: c.border, background: c.panel, color: c.inkSoft }}><Filter className="h-3.5 w-3.5" /> Filter</button>
                <button className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 500 }}><Plus className="h-3.5 w-3.5" /> Schedule</button>
                <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-full border" style={{ borderColor: c.border, background: c.panel, color: c.inkSoft }}><Bell className="h-3.5 w-3.5" /></div>
              </div>
            </header>

            <div className="px-7 py-6">
              {/* Stat strip */}
              <div className="mb-5 grid grid-cols-4 gap-3">
                {[
                  { l: "Scheduled this week", v: "12", s: "events", a: c.cobalt },
                  { l: "Vendor visits", v: "5", s: "Atlas, Cedar, Pinnacle…", a: c.amber },
                  { l: "Insurance deadlines", v: "3", s: "due Fri & Mon", a: c.cobalt },
                  { l: "Conflicts", v: "1", s: "Bldg 9 · roof + insp.", a: c.rose },
                ].map((s) => (
                  <div key={s.l} className="rounded-xl border bg-white p-4" style={{ borderColor: c.border }}>
                    <div className="text-[10.5px] font-medium uppercase tracking-wider" style={{ color: c.inkMute }}>{s.l}</div>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="font-mono-num text-[26px]" style={{ color: s.a, fontWeight: 700 }}>{s.v}</span>
                      <span className="text-[11.5px]" style={{ color: c.inkSoft }}>{s.s}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Timeline */}
              <section className="rounded-xl border bg-white p-4" style={{ borderColor: c.border }}>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-[10.5px] font-medium uppercase tracking-wider" style={{ color: c.inkMute }}>Timeline</div>
                    <h2 className="mt-0.5 text-[16px]" style={{ fontWeight: 600 }}>Programs & buildings · next 14 days</h2>
                  </div>
                  <div className="flex items-center gap-3 text-[10.5px]" style={{ color: c.inkMute }}>
                    {(Object.keys(catColor) as Cat[]).map((k) => (
                      <span key={k} className="flex items-center gap-1">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: catColor[k].bar }} /> {catColor[k].label}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="overflow-hidden rounded-lg border" style={{ borderColor: c.border }}>
                  {/* Day header */}
                  <div className="flex border-b" style={{ borderColor: c.border, background: c.borderSoft }}>
                    <div className="shrink-0 px-3 py-2 text-[10.5px] font-medium uppercase tracking-wider" style={{ width: 180, color: c.inkMute }}>Lane</div>
                    <div className="flex flex-1">
                      {days.map((d, i) => (
                        <div key={d} className="border-l px-2 py-2 text-center" style={{ width: dayWidth, borderColor: c.border, background: i === today ? c.cobaltSoft : "transparent" }}>
                          <div className="font-mono-num text-[10.5px]" style={{ color: i === today ? c.cobalt : c.inkMute, fontWeight: i === today ? 700 : 500 }}>{d}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Rows */}
                  <div className="relative">
                    {lanes.map((lane, ri) => (
                      <div key={lane} className="flex border-t" style={{ borderColor: c.border, background: ri % 2 ? c.canvas : c.panel }}>
                        <div className="flex shrink-0 items-center px-3 text-[12px]" style={{ width: 180, height: rowHeight, color: c.ink, fontWeight: 500 }}>
                          {lane}
                        </div>
                        <div className="relative flex flex-1" style={{ height: rowHeight }}>
                          {days.map((_, di) => (
                            <div key={di} className="border-l" style={{ width: dayWidth, borderColor: c.borderSoft, background: di === today ? "rgba(50,69,255,0.04)" : "transparent" }} />
                          ))}
                          {/* events on this row */}
                          {events.filter((e) => e.row === ri).map((e, ei) => {
                            const ct = catColor[e.cat];
                            return (
                              <div key={ei} className="absolute flex items-center gap-1.5 overflow-hidden rounded-md border px-2 py-1 text-[11px]"
                                style={{
                                  left: e.startDay * dayWidth + 4,
                                  width: e.len * dayWidth - 8,
                                  top: 6, height: rowHeight - 12,
                                  background: ct.bg, borderColor: ct.bar, color: ct.text,
                                  borderLeftWidth: 3,
                                }}>
                                <span style={{ fontWeight: 600 }} className="truncate">{e.title}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    {/* today line */}
                    <div className="pointer-events-none absolute top-0 bottom-0" style={{ left: 180 + today * dayWidth + dayWidth / 2, width: 1, background: c.cobalt, opacity: 0.5 }} />
                  </div>
                </div>
              </section>

              {/* Upcoming list */}
              <section className="mt-5 grid grid-cols-2 gap-4">
                <div className="rounded-xl border bg-white p-4" style={{ borderColor: c.border }}>
                  <div className="mb-3 text-[10.5px] font-medium uppercase tracking-wider" style={{ color: c.inkMute }}>Today</div>
                  {[
                    { t: "10:00", title: "Roof tarp install — Bldg 9", who: "Atlas Roofing", cat: "roof" as Cat },
                    { t: "13:30", title: "Foundation walk-through — Bldg 5", who: "Pinnacle Inspections", cat: "inspection" as Cat },
                  ].map((r, i) => {
                    const ct = catColor[r.cat];
                    return (
                      <div key={i} className="mb-2 flex items-center gap-3 rounded-lg border p-2.5" style={{ borderColor: c.borderSoft }}>
                        <span className="font-mono-num w-12 text-[12px]" style={{ color: c.inkMute }}>{r.t}</span>
                        <span className="h-6 w-1 rounded" style={{ background: ct.bar }} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px]" style={{ fontWeight: 500 }}>{r.title}</div>
                          <div className="text-[10.5px]" style={{ color: c.inkMute }}>{r.who}</div>
                        </div>
                        <span className="rounded-md px-1.5 py-0.5 text-[10px]" style={{ background: ct.bg, color: ct.text, fontWeight: 600 }}>{ct.label}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="rounded-xl border bg-white p-4" style={{ borderColor: c.border }}>
                  <div className="mb-3 text-[10.5px] font-medium uppercase tracking-wider" style={{ color: c.inkMute }}>Coming up</div>
                  {[
                    { t: "Wed 7", title: "Roof inspection — Bldg 14", cat: "inspection" as Cat },
                    { t: "Fri 9", title: "Insurance declarations due (3)", cat: "insurance" as Cat },
                    { t: "Mon 12", title: "Board meeting · monthly", cat: "meeting" as Cat },
                  ].map((r, i) => {
                    const ct = catColor[r.cat];
                    return (
                      <div key={i} className="mb-2 flex items-center gap-3 rounded-lg border p-2.5" style={{ borderColor: c.borderSoft }}>
                        <span className="font-mono-num w-12 text-[11.5px]" style={{ color: c.inkMute }}>{r.t}</span>
                        <span className="h-6 w-1 rounded" style={{ background: ct.bar }} />
                        <div className="min-w-0 flex-1 text-[12.5px]" style={{ fontWeight: 500 }}>{r.title}</div>
                        <span className="rounded-md px-1.5 py-0.5 text-[10px]" style={{ background: ct.bg, color: ct.text, fontWeight: 600 }}>{ct.label}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
