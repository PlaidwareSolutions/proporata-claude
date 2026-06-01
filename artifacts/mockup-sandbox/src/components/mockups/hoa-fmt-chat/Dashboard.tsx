import {
  Search, Send, Sparkles, Plus, Paperclip, Mic, ChevronRight, ArrowUpRight,
  Building2, Droplets, Wrench, ShieldCheck, FileText, MessagesSquare, Zap,
  Bookmark, History, Settings, Command, Home,
} from "lucide-react";

const fontStyle = `
@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
.font-tight { font-family: 'Inter Tight', system-ui, sans-serif; letter-spacing: -0.01em; }
.font-mono-num { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.tabular { font-variant-numeric: tabular-nums; }
@keyframes blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
.cursor-blink { animation: blink 1s steps(1) infinite; }
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

const threads = [
  { title: "What needs my attention this week?", time: "Now", active: true },
  { title: "Insurance gaps by building", time: "Today" },
  { title: "Roof program status", time: "Yesterday" },
  { title: "Vendor spend vs budget — Q2", time: "Apr 28" },
  { title: "Approve quote for Bldg 22 paint", time: "Apr 25" },
  { title: "Draft board notice on assessments", time: "Apr 21" },
];

const suggested = [
  "Which buildings are urgent?",
  "How much have we spent on roofs this year?",
  "Draft a note to owners with insurance gaps",
  "Show open work orders for Cardinal PM",
  "What did Pinnacle Inspections find at Bldg 14?",
];

export function Dashboard() {
  return (
    <>
      <style>{fontStyle}</style>
      <div className="font-tight min-h-screen" style={{ background: c.canvas, color: c.ink }}>
        <div className="flex">
          {/* Sidebar */}
          <aside className="sticky top-0 flex h-screen w-[260px] shrink-0 flex-col" style={{ background: c.sidebar, color: c.sidebarMute }}>
            <div className="px-4 pt-5 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-md" style={{ background: c.cobalt }}>
                  <Zap className="h-4 w-4 text-white" strokeWidth={2.25} />
                </div>
                <div>
                  <div className="text-[13.5px] text-white" style={{ fontWeight: 600 }}>Quail Valley HOA</div>
                  <div className="font-mono-num text-[10px]">Ask anything · 144u · 25b</div>
                </div>
              </div>
            </div>
            <div className="px-3">
              <button className="flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-[12px]"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 500 }}>
                <Plus className="h-3.5 w-3.5" /> New conversation
              </button>
            </div>
            <div className="mx-3 mt-4 mb-2 flex items-center gap-2 rounded-md border px-2.5 py-1.5"
              style={{ borderColor: "#1A2140", background: "rgba(255,255,255,0.03)" }}>
              <Search className="h-3.5 w-3.5" />
              <span className="text-[11.5px]">Search threads…</span>
              <span className="ml-auto inline-flex items-center gap-0.5">
                <Command className="h-2.5 w-2.5" /><span className="font-mono-num text-[10px]">K</span>
              </span>
            </div>
            <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider" style={{ color: "#5C648A" }}>Today</div>
            <nav className="flex-1 overflow-auto px-2">
              {threads.map((t, i) => (
                <button key={i} className="mb-0.5 flex w-full items-start gap-2 rounded-md px-2 py-2 text-left"
                  style={t.active ? { background: "rgba(50,69,255,0.16)", color: "#fff" } : { color: c.sidebarMute }}>
                  <MessagesSquare className="h-3.5 w-3.5 mt-0.5 shrink-0" strokeWidth={t.active ? 2.25 : 1.75} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px]" style={{ fontWeight: t.active ? 500 : 400 }}>{t.title}</div>
                    <div className="font-mono-num mt-0.5 text-[9.5px]" style={{ color: t.active ? "rgba(255,255,255,0.55)" : "#5C648A" }}>{t.time}</div>
                  </div>
                </button>
              ))}
            </nav>
            <div className="space-y-0.5 px-2 pb-3 pt-2 border-t" style={{ borderColor: "#1A2140" }}>
              {[
                { icon: Home, label: "Operational view" },
                { icon: Bookmark, label: "Saved answers" },
                { icon: History, label: "Activity log" },
                { icon: Settings, label: "Settings" },
              ].map((it) => {
                const Icon = it.icon;
                return (
                  <button key={it.label} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5">
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                    <span className="text-[12px]">{it.label}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Main */}
          <main className="min-w-0 flex-1">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b px-7 py-3.5 backdrop-blur"
              style={{ background: "rgba(246,247,251,0.85)", borderColor: c.border }}>
              <div className="flex items-center gap-2.5">
                <Sparkles className="h-4 w-4" style={{ color: c.cobalt }} strokeWidth={2.25} />
                <h1 className="text-[15px]" style={{ fontWeight: 600 }}>HOA Assistant</h1>
                <span className="font-mono-num rounded-md px-1.5 py-0.5 text-[10px]" style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 600 }}>
                  GROUNDED IN YOUR DATA
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button className="rounded-md border px-2.5 py-1 text-[11px]" style={{ borderColor: c.border, background: c.panel, color: c.inkSoft }}>Share</button>
                <button className="rounded-md border px-2.5 py-1 text-[11px]" style={{ borderColor: c.border, background: c.panel, color: c.inkSoft }}>Export answer</button>
              </div>
            </header>

            <div className="mx-auto max-w-[820px] px-8 pt-8 pb-32">
              {/* User question */}
              <div className="mb-6 flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px]" style={{ background: c.ink, color: "#fff", fontWeight: 600 }}>EM</div>
                <div className="rounded-2xl rounded-tl-sm px-4 py-2.5" style={{ background: c.panel, border: `1px solid ${c.border}` }}>
                  <div className="text-[14px]" style={{ fontWeight: 500 }}>What needs my attention this week?</div>
                  <div className="font-mono-num mt-1 text-[10px]" style={{ color: c.inkMute }}>Eleanor · 9:42 am</div>
                </div>
              </div>

              {/* Assistant answer */}
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: c.cobalt }}>
                  <Sparkles className="h-4 w-4 text-white" strokeWidth={2.25} />
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="rounded-2xl rounded-tl-sm border bg-white px-5 py-4" style={{ borderColor: c.border }}>
                    <p className="text-[14.5px] leading-relaxed" style={{ color: c.ink }}>
                      Three buildings need a decision this week, and there are <span style={{ color: c.cobalt, fontWeight: 600 }}>17 open work orders</span> overall.
                      The most pressing items are an active roof leak at <span style={{ fontWeight: 600 }}>Building 9 (2828 Camelot Lane)</span>,
                      a foundation crack reported at <span style={{ fontWeight: 600 }}>Building 5 (Hampshire)</span>, and a missing insurance declaration on <span style={{ fontWeight: 600 }}>Building 14 (La Quinta)</span>.
                      Eight insurance declarations are still outstanding overall — six owners have been contacted, two have not responded since April 18.
                    </p>

                    {/* Inline cards */}
                    <div className="mt-4 grid grid-cols-3 gap-2.5">
                      {[
                        { num: 9,  addr: "2828 Camelot",   issue: "Active roof leak",   icon: Droplets,    color: c.rose,  bg: c.roseSoft,  pri: "URGENT" },
                        { num: 5,  addr: "2814 Hampshire", issue: "Foundation crack",   icon: Wrench,      color: c.rose,  bg: c.roseSoft,  pri: "URGENT" },
                        { num: 14, addr: "2819 La Quinta", issue: "Insurance gap",      icon: ShieldCheck, color: c.amber, bg: c.amberSoft, pri: "HIGH" },
                      ].map((b) => {
                        const Icon = b.icon;
                        return (
                          <div key={b.num} className="rounded-xl border p-3" style={{ borderColor: c.border, background: c.canvas }}>
                            <div className="flex items-center justify-between">
                              <span className="font-mono-num text-[10px]" style={{ color: c.inkMute }}>BLDG {String(b.num).padStart(2, "0")}</span>
                              <span className="font-mono-num rounded px-1.5 py-0 text-[9.5px]" style={{ background: b.bg, color: b.color, fontWeight: 700 }}>{b.pri}</span>
                            </div>
                            <div className="mt-1.5 text-[13px]" style={{ fontWeight: 600 }}>{b.addr}</div>
                            <div className="mt-1 inline-flex items-center gap-1 text-[11.5px]" style={{ color: b.color }}>
                              <Icon className="h-3 w-3" /> {b.issue}
                            </div>
                            <button className="mt-2.5 inline-flex w-full items-center justify-between rounded-md border px-2 py-1 text-[11px]" style={{ borderColor: c.border, background: c.panel, color: c.inkSoft }}>
                              Open building <ChevronRight className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {/* Inline metric chips */}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]" style={{ borderColor: c.border, background: c.canvas, color: c.inkSoft }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.cobalt }} /> 17 open work orders
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]" style={{ borderColor: c.border, background: c.canvas, color: c.inkSoft }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.amber }} /> 8 insurance gaps
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]" style={{ borderColor: c.border, background: c.canvas, color: c.inkSoft }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.emerald }} /> 92% roof program complete
                      </span>
                    </div>

                    {/* Sources */}
                    <div className="mt-4 border-t pt-3 text-[11px]" style={{ borderColor: c.borderSoft, color: c.inkMute }}>
                      <span className="font-medium" style={{ color: c.inkSoft }}>Sources: </span>
                      <a className="underline-offset-2 hover:underline" style={{ color: c.cobalt }}>WO-1051</a>,{" "}
                      <a className="underline-offset-2 hover:underline" style={{ color: c.cobalt }}>WO-1050</a>,{" "}
                      <a className="underline-offset-2 hover:underline" style={{ color: c.cobalt }}>INS-22</a>,{" "}
                      <a className="underline-offset-2 hover:underline" style={{ color: c.cobalt }}>Buildings 5, 9, 14</a>{" "}
                      · grounded in HOA records as of 9:42 am today
                    </div>
                  </div>

                  {/* Suggested follow-ups */}
                  <div>
                    <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wider" style={{ color: c.inkMute }}>Suggested follow-ups</div>
                    <div className="flex flex-wrap gap-1.5">
                      {suggested.map((s, i) => (
                        <button key={i} className="inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1.5 text-[11.5px] transition-colors hover:border-[#3245FF]/40"
                          style={{ borderColor: c.border, color: c.inkSoft }}>
                          {s} <ArrowUpRight className="h-3 w-3" style={{ color: c.cobalt }} />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Composer */}
            <div className="fixed bottom-0 right-0 left-[260px] border-t px-8 py-4" style={{ background: "rgba(246,247,251,0.92)", borderColor: c.border, backdropFilter: "blur(8px)" }}>
              <div className="mx-auto max-w-[820px]">
                <div className="flex items-end gap-2 rounded-2xl border bg-white p-2.5 shadow-sm" style={{ borderColor: c.border }}>
                  <button className="rounded-md p-1.5" style={{ color: c.inkMute }}><Paperclip className="h-4 w-4" /></button>
                  <div className="min-w-0 flex-1 px-1 py-1 text-[13.5px]" style={{ color: c.ink }}>
                    Ask about buildings, work orders, insurance, vendors…
                    <span className="cursor-blink ml-0.5" style={{ color: c.cobalt }}>|</span>
                  </div>
                  <button className="rounded-md p-1.5" style={{ color: c.inkMute }}><Mic className="h-4 w-4" /></button>
                  <button className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 500 }}>
                    Ask <Send className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10.5px]" style={{ color: c.inkMute }}>
                  <span>Replies are grounded in your HOA records · always cited</span>
                  <span className="font-mono-num">⏎ to send · ⇧⏎ for newline</span>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
