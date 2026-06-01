import {
  LayoutDashboard, Building2, Home, ClipboardList, FileText, ShieldCheck, BarChart3, Settings,
  Search, Bell, Plus, Map, Layers, Maximize2, Wrench, Droplets, ShieldAlert, ArrowRight, Zap, Command,
} from "lucide-react";

const fontStyle = `
@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
.font-tight { font-family: 'Inter Tight', system-ui, sans-serif; letter-spacing: -0.01em; }
.font-mono-num { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.tabular { font-variant-numeric: tabular-nums; }
@keyframes pulseRing { 0% { transform: scale(1); opacity: .55; } 70% { transform: scale(2.2); opacity: 0; } 100% { opacity: 0; } }
.pulse-ring { animation: pulseRing 1.8s ease-out infinite; }
`;

const c = {
  canvas: "#F6F7FB", panel: "#FFFFFF",
  sidebar: "#0B1020",
  sidebarText: "#D6DAEA",
  sidebarMute: "#8E96B4",
  ink: "#0B1020",
  inkSoft: "#2A3050",
  inkMute: "#5A6285",
  border: "#E0E4F0", borderSoft: "#EFF1F8",
  cobalt: "#3245FF", cobaltSoft: "#E5E8FF",
  emerald: "#0E8A6B", emeraldSoft: "#DCF3EC",
  amber: "#A66C0E", amberSoft: "#FBEFD6",
  rose: "#B8264C", roseSoft: "#FBE3E9",
  mapBg: "#0F1530", mapGrid: "#1B2342", mapGreen: "#1F2A4D",
};

type Status = "good" | "watch" | "urgent";
type B = { num: number; x: number; y: number; w: number; h: number; status: Status; openWO: number; address: string };

const buildings: B[] = [
  { num: 1,  x: 80,  y: 80,  w: 70, h: 36, status: "good",   openWO: 0, address: "2801 Cambridge" },
  { num: 2,  x: 165, y: 80,  w: 70, h: 36, status: "good",   openWO: 1, address: "2803 Cambridge" },
  { num: 3,  x: 250, y: 80,  w: 70, h: 36, status: "watch",  openWO: 2, address: "2807 Yorktown" },
  { num: 4,  x: 335, y: 80,  w: 70, h: 36, status: "good",   openWO: 0, address: "2811 Yorktown" },
  { num: 5,  x: 420, y: 80,  w: 70, h: 36, status: "urgent", openWO: 3, address: "2814 Hampshire" },
  { num: 6,  x: 80,  y: 145, w: 70, h: 36, status: "good",   openWO: 1, address: "2818 Hampshire" },
  { num: 7,  x: 165, y: 145, w: 70, h: 36, status: "good",   openWO: 0, address: "2820 Nottingham" },
  { num: 8,  x: 250, y: 145, w: 70, h: 36, status: "watch",  openWO: 1, address: "2823 Nottingham" },
  { num: 9,  x: 335, y: 145, w: 70, h: 36, status: "urgent", openWO: 4, address: "2828 Camelot" },
  { num: 10, x: 420, y: 145, w: 70, h: 36, status: "good",   openWO: 0, address: "2832 Camelot" },
  { num: 11, x: 80,  y: 230, w: 70, h: 36, status: "good",   openWO: 1, address: "2835 Princeton" },
  { num: 12, x: 165, y: 230, w: 70, h: 36, status: "watch",  openWO: 2, address: "2838 Princeton" },
  { num: 13, x: 250, y: 230, w: 70, h: 36, status: "good",   openWO: 0, address: "2841 Princess" },
  { num: 14, x: 335, y: 230, w: 70, h: 36, status: "urgent", openWO: 2, address: "2819 La Quinta" },
  { num: 15, x: 420, y: 230, w: 70, h: 36, status: "good",   openWO: 0, address: "2822 La Quinta" },
  { num: 16, x: 80,  y: 295, w: 70, h: 36, status: "good",   openWO: 1, address: "2826 La Quinta" },
  { num: 17, x: 165, y: 295, w: 70, h: 36, status: "watch",  openWO: 1, address: "2830 W Hampton" },
  { num: 18, x: 250, y: 295, w: 70, h: 36, status: "good",   openWO: 0, address: "2834 W Hampton" },
  { num: 19, x: 335, y: 295, w: 70, h: 36, status: "good",   openWO: 0, address: "2838 W Hampton" },
  { num: 20, x: 420, y: 295, w: 70, h: 36, status: "watch",  openWO: 1, address: "2842 Cambridge" },
  { num: 21, x: 80,  y: 360, w: 70, h: 36, status: "good",   openWO: 0, address: "2846 Cambridge" },
  { num: 22, x: 165, y: 360, w: 70, h: 36, status: "watch",  openWO: 1, address: "2841 Princess" },
  { num: 23, x: 250, y: 360, w: 70, h: 36, status: "good",   openWO: 0, address: "2845 Princess" },
  { num: 24, x: 335, y: 360, w: 70, h: 36, status: "good",   openWO: 1, address: "2849 Camelot" },
  { num: 25, x: 420, y: 360, w: 70, h: 36, status: "good",   openWO: 0, address: "2853 Camelot" },
];

const dot: Record<Status, string> = { good: c.emerald, watch: c.amber, urgent: c.rose };

const pins = [
  { num: 5, type: "Urgent: foundation", icon: ShieldAlert, status: "urgent" as Status },
  { num: 9, type: "Active leak", icon: Droplets, status: "urgent" as Status },
  { num: 14, type: "Inspection req", icon: Wrench, status: "urgent" as Status },
];

const navSections = [
  { label: "Overview", items: [{ icon: Map, label: "Site Map", active: true }, { icon: LayoutDashboard, label: "Overview" }, { icon: BarChart3, label: "Reports" }] },
  { label: "Property", items: [{ icon: Building2, label: "Buildings" }, { icon: Home, label: "Units" }] },
  { label: "Operations", items: [{ icon: ClipboardList, label: "Work Orders", badge: 17 }, { icon: ShieldCheck, label: "Insurance", badge: 8 }, { icon: FileText, label: "Documents" }] },
  { label: "Workspace", items: [{ icon: Settings, label: "Settings" }] },
];

const selected = buildings.find((b) => b.num === 9)!;

export function Dashboard() {
  return (
    <>
      <style>{fontStyle}</style>
      <div className="font-tight min-h-screen" style={{ background: c.canvas, color: c.ink }}>
        <div className="flex">
          {/* Sidebar */}
          <aside className="sticky top-0 flex h-screen w-[252px] shrink-0 flex-col" style={{ background: c.sidebar, color: c.sidebarText }}>
            <div className="px-4 pt-5 pb-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-md" style={{ background: c.cobalt }}><Zap className="h-5 w-5 text-white" strokeWidth={2.25} /></div>
                <div>
                  <div className="text-[15px] text-white" style={{ fontWeight: 600 }}>Quail Valley HOA</div>
                  <div className="font-mono-num text-[12px]" style={{ color: c.sidebarMute, fontWeight: 500 }}>144u · 25b</div>
                </div>
              </div>
            </div>
            <div className="mx-4 mb-4 flex items-center gap-2 rounded-md border px-2.5 py-2" style={{ borderColor: "#1A2140", background: "rgba(255,255,255,0.04)" }}>
              <Search className="h-4 w-4" style={{ color: c.sidebarText }} />
              <span className="text-[13px]" style={{ color: c.sidebarText }}>Find building or address…</span>
              <span className="ml-auto inline-flex items-center gap-0.5"><Command className="h-3 w-3" style={{ color: c.sidebarMute }} /><span className="font-mono-num text-[11px]" style={{ color: c.sidebarMute, fontWeight: 600 }}>K</span></span>
            </div>
            <nav className="flex-1 space-y-4 px-2.5">
              {navSections.map((s) => (
                <div key={s.label}>
                  <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#7B83A6" }}>{s.label}</div>
                  {s.items.map((item: any) => {
                    const Icon = item.icon;
                    return (
                      <button key={item.label} className="mb-0.5 flex w-full items-center justify-between rounded-md px-2 py-2"
                        style={item.active ? { background: "rgba(50,69,255,0.20)", color: "#fff" } : { color: c.sidebarText }}>
                        <span className="flex items-center gap-2.5"><Icon className="h-4 w-4" strokeWidth={item.active ? 2.25 : 1.85} /><span className="text-[14px]" style={{ fontWeight: item.active ? 600 : 500 }}>{item.label}</span></span>
                        {item.badge && <span className="font-mono-num rounded px-1.5 py-0.5 text-[11px]" style={{ background: item.active ? c.cobalt : "rgba(255,255,255,0.10)", color: "#fff", fontWeight: 600 }}>{item.badge}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
            <div className="px-4 pb-4 pt-3">
              <div className="rounded-lg border p-3" style={{ borderColor: "#1A2140", background: "rgba(255,255,255,0.03)" }}>
                <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#7B83A6" }}>Map Layers</div>
                {["Buildings", "Open work orders", "Insurance gaps", "Roof status"].map((l, i) => (
                  <label key={l} className="mt-2 flex items-center gap-2 text-[13px]" style={{ color: c.sidebarText }}>
                    <input type="checkbox" defaultChecked={i < 3} className="accent-blue-500" />
                    <span>{l}</span>
                  </label>
                ))}
              </div>
            </div>
          </aside>

          {/* Main */}
          <main className="min-w-0 flex-1">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b px-7 py-3.5 backdrop-blur" style={{ background: "rgba(246,247,251,0.85)", borderColor: c.border }}>
              <div className="flex items-center gap-3">
                <h1 className="text-[22px]" style={{ fontWeight: 700, letterSpacing: "-0.02em" }}>Site Map</h1>
                <span className="font-mono-num rounded-md px-2 py-0.5 text-[11px]" style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}>LIVE</span>
                <span className="text-[14px]" style={{ color: c.inkSoft, fontWeight: 500 }}>The Town Homes of Quail Valley · 25 buildings · 144 units</span>
              </div>
              <div className="flex items-center gap-2.5">
                <button className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-[13px]" style={{ borderColor: c.border, background: c.panel, color: c.inkSoft, fontWeight: 500 }}><Layers className="h-4 w-4" /> Layers</button>
                <button className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}><Plus className="h-4 w-4" /> New Work Order</button>
                <div className="ml-1 flex h-9 w-9 items-center justify-center rounded-full border" style={{ borderColor: c.border, background: c.panel, color: c.inkSoft }}><Bell className="h-4 w-4" /></div>
              </div>
            </header>

            <div className="px-7 py-6">
              {/* KPI strip */}
              <div className="mb-5 grid grid-cols-6 overflow-hidden rounded-xl border bg-white" style={{ borderColor: c.border }}>
                {[
                  { l: "Total Units", v: "144" },
                  { l: "Buildings", v: "25" },
                  { l: "Open WO", v: "17", a: c.cobalt },
                  { l: "Urgent", v: "3", a: c.rose },
                  { l: "Insurance gaps", v: "8", a: c.amber },
                  { l: "Roof attention", v: "6", a: c.amber },
                ].map((k, i) => (
                  <div key={k.l} className="flex items-center justify-between px-4 py-3.5" style={{ borderRight: i < 5 ? `1px solid ${c.border}` : "none" }}>
                    <div>
                      <div className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: c.inkSoft }}>{k.l}</div>
                      <div className="font-mono-num mt-1 text-[26px] leading-none" style={{ color: k.a || c.ink, fontWeight: 700, letterSpacing: "-0.02em" }}>{k.v}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-5">
                {/* Map */}
                <section className="col-span-2 rounded-xl border p-3 shadow-sm" style={{ borderColor: c.border, background: c.mapBg }}>
                  <div className="mb-2 flex items-center justify-between px-2 py-1">
                    <div className="flex items-center gap-2">
                      <Map className="h-4.5 w-4.5 text-white" />
                      <span className="text-[14px] text-white" style={{ fontWeight: 600 }}>Plat Map · interactive</span>
                    </div>
                    <div className="flex items-center gap-3.5 text-[12.5px] text-white/85" style={{ fontWeight: 500 }}>
                      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c.emerald }} /> Healthy <span className="font-mono-num font-semibold">16</span></span>
                      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c.amber }} /> Watch <span className="font-mono-num font-semibold">6</span></span>
                      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c.rose }} /> Urgent <span className="font-mono-num font-semibold">3</span></span>
                      <Maximize2 className="h-4 w-4 ml-1.5 opacity-80" />
                    </div>
                  </div>
                  <div className="relative overflow-hidden rounded-lg" style={{ background: c.mapBg, height: 480 }}>
                    <svg viewBox="0 0 600 460" className="absolute inset-0 h-full w-full">
                      <defs>
                        <pattern id="grid-cv2" width="40" height="40" patternUnits="userSpaceOnUse">
                          <path d="M 40 0 L 0 0 0 40" fill="none" stroke={c.mapGrid} strokeWidth="0.5" />
                        </pattern>
                      </defs>
                      <rect width="600" height="460" fill="url(#grid-cv2)" />
                      <ellipse cx="540" cy="80" rx="50" ry="40" fill={c.mapGreen} opacity="0.7" />
                      <ellipse cx="540" cy="380" rx="60" ry="50" fill={c.mapGreen} opacity="0.7" />
                      <ellipse cx="40" cy="420" rx="50" ry="35" fill={c.mapGreen} opacity="0.7" />
                      <path d="M 0 122 L 600 122" stroke="#2A3460" strokeWidth="14" strokeLinecap="round" />
                      <path d="M 0 207 L 600 207" stroke="#2A3460" strokeWidth="14" strokeLinecap="round" />
                      <path d="M 0 272 L 600 272" stroke="#2A3460" strokeWidth="14" strokeLinecap="round" />
                      <path d="M 0 337 L 600 337" stroke="#2A3460" strokeWidth="14" strokeLinecap="round" />
                      <path d="M 510 0 Q 530 230 510 460" stroke="#2A3460" strokeWidth="12" fill="none" />
                      {[
                        { y: 116, t: "CAMBRIDGE LN" }, { y: 201, t: "HAMPSHIRE LN" },
                        { y: 266, t: "PRINCETON LN" }, { y: 331, t: "W HAMPTON LN" },
                      ].map((l) => (
                        <text key={l.t} x="10" y={l.y - 4} fontSize="10" fontWeight="600" fill="#9098B8" fontFamily="Inter Tight" letterSpacing="0.5">{l.t}</text>
                      ))}
                      {buildings.map((b) => {
                        const isSel = b.num === selected.num;
                        return (
                          <g key={b.num}>
                            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="4"
                              fill={isSel ? c.cobalt : "#FFFFFF"}
                              fillOpacity={isSel ? 1 : 0.95}
                              stroke={dot[b.status]} strokeWidth={isSel ? 2.5 : 1.6} />
                            <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 5} textAnchor="middle"
                              fontSize="16" fontFamily="Inter Tight" fontWeight="800"
                              fill={isSel ? "#fff" : c.ink} letterSpacing="-0.02em">{b.num}</text>
                            <circle cx={b.x + b.w - 7} cy={b.y + 7} r="3.5" fill={dot[b.status]} />
                            {b.openWO > 0 && (
                              <g>
                                <rect x={b.x + 4} y={b.y + b.h - 13} width="16" height="10" rx="2.5" fill={dot[b.status]} fillOpacity="0.22" />
                                <text x={b.x + 12} y={b.y + b.h - 5} textAnchor="middle" fontSize="9" fontFamily="JetBrains Mono" fontWeight="700" fill={dot[b.status]}>{b.openWO}</text>
                              </g>
                            )}
                          </g>
                        );
                      })}
                      {pins.map((p) => {
                        const b = buildings.find((bb) => bb.num === p.num)!;
                        return (
                          <g key={p.num}>
                            <circle cx={b.x + b.w / 2} cy={b.y + b.h / 2} r="6" fill={c.rose} className="pulse-ring" style={{ transformOrigin: `${b.x + b.w / 2}px ${b.y + b.h / 2}px` }} />
                          </g>
                        );
                      })}
                      <g transform="translate(560, 30)">
                        <circle r="16" fill="#1A2140" stroke="#2A3460" />
                        <text y="-3" textAnchor="middle" fontSize="9" fontWeight="700" fill="#C8CDE3" fontFamily="Inter Tight">N</text>
                        <path d="M 0 -9 L 4 5 L 0 1 L -4 5 Z" fill={c.cobalt} />
                      </g>
                    </svg>
                  </div>
                </section>

                {/* Inspector */}
                <aside className="space-y-4">
                  <div className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
                    <div className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: c.inkSoft }}>Selected building</div>
                    <div className="mt-2.5 flex items-baseline justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono-num text-[12.5px]" style={{ color: c.inkMute, fontWeight: 600 }}>BLDG {String(selected.num).padStart(2, "0")}</div>
                        <div className="text-[22px] mt-0.5" style={{ fontWeight: 700, letterSpacing: "-0.02em", color: c.ink }}>{selected.address} Lane</div>
                      </div>
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wider shrink-0" style={{ background: c.roseSoft, color: c.rose }}>URGENT</span>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg border py-2.5" style={{ borderColor: c.borderSoft, background: c.canvas }}>
                        <div className="font-mono-num text-[22px] leading-none" style={{ fontWeight: 700, color: c.ink }}>6</div>
                        <div className="text-[12px] mt-1" style={{ color: c.inkSoft, fontWeight: 500 }}>Units</div>
                      </div>
                      <div className="rounded-lg border py-2.5" style={{ borderColor: c.borderSoft, background: c.canvas }}>
                        <div className="font-mono-num text-[22px] leading-none" style={{ color: c.rose, fontWeight: 700 }}>4</div>
                        <div className="text-[12px] mt-1" style={{ color: c.inkSoft, fontWeight: 500 }}>Open WO</div>
                      </div>
                      <div className="rounded-lg border py-2.5" style={{ borderColor: c.borderSoft, background: c.canvas }}>
                        <div className="font-mono-num text-[22px] leading-none" style={{ color: c.amber, fontWeight: 700 }}>2</div>
                        <div className="text-[12px] mt-1" style={{ color: c.inkSoft, fontWeight: 500 }}>Insurance</div>
                      </div>
                    </div>
                    <div className="mt-4 space-y-2">
                      {[
                        { k: "Roof", v: "Inspection due", color: c.amber },
                        { k: "Insurance", v: "Declaration missing", color: c.amber },
                        { k: "Active alert", v: "Water intrusion · 12m ago", color: c.rose },
                      ].map((r) => (
                        <div key={r.k} className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: c.borderSoft }}>
                          <span className="text-[13px]" style={{ color: c.inkSoft, fontWeight: 500 }}>{r.k}</span>
                          <span className="text-[13px]" style={{ color: r.color, fontWeight: 600 }}>{r.v}</span>
                        </div>
                      ))}
                    </div>
                    <button className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-md py-2.5 text-[13.5px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
                      Open Building 09 <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
                    <div className="mb-3 text-[12px] font-semibold uppercase tracking-wider" style={{ color: c.inkSoft }}>Live alerts on map</div>
                    <ul className="space-y-3">
                      {pins.map((p) => {
                        const b = buildings.find((bb) => bb.num === p.num)!;
                        const Icon = p.icon;
                        return (
                          <li key={p.num} className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-md" style={{ background: c.roseSoft, color: c.rose }}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[13.5px]" style={{ fontWeight: 600, color: c.ink }}>Bldg {b.num} · {b.address}</div>
                              <div className="text-[12px] mt-0.5" style={{ color: c.inkSoft, fontWeight: 500 }}>{p.type}</div>
                            </div>
                            <ArrowRight className="h-4 w-4" style={{ color: c.inkMute }} />
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </aside>
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
