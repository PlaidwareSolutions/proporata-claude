import { Droplets, Wrench, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";

const fontStyle = `
@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
.font-tight { font-family: 'Inter Tight', system-ui, sans-serif; letter-spacing: -0.015em; }
.font-mono-num { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.tabular { font-variant-numeric: tabular-nums; }
@keyframes blinkDot { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.25; } }
.blink-dot { animation: blinkDot 1.4s ease-in-out infinite; }
@keyframes scrollX { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.ticker { animation: scrollX 50s linear infinite; }
`;

const c = {
  bg: "#05070D",
  panel: "#0B0F1A",
  panel2: "#0E1424",
  border: "#1B2342",
  borderSoft: "#13192C",
  ink: "#F4F6FB",
  inkSoft: "#A4ACC4",
  inkMute: "#5C648A",
  cobalt: "#5B73FF",
  emerald: "#3FCF8E",
  amber: "#F0B040",
  rose: "#FF5C7A",
};

type S = "good" | "watch" | "urgent";
const tone: Record<S, string> = { good: c.emerald, watch: c.amber, urgent: c.rose };

const buildings: { num: number; status: S; openWO: number }[] = [
  { num: 1, status: "good", openWO: 0 }, { num: 2, status: "good", openWO: 1 }, { num: 3, status: "watch", openWO: 2 },
  { num: 4, status: "good", openWO: 0 }, { num: 5, status: "urgent", openWO: 3 }, { num: 6, status: "good", openWO: 1 },
  { num: 7, status: "good", openWO: 0 }, { num: 8, status: "watch", openWO: 1 }, { num: 9, status: "urgent", openWO: 4 },
  { num: 10, status: "good", openWO: 0 }, { num: 11, status: "good", openWO: 1 }, { num: 12, status: "watch", openWO: 2 },
  { num: 13, status: "good", openWO: 0 }, { num: 14, status: "urgent", openWO: 2 }, { num: 15, status: "good", openWO: 0 },
  { num: 16, status: "good", openWO: 1 }, { num: 17, status: "watch", openWO: 1 }, { num: 18, status: "good", openWO: 0 },
  { num: 19, status: "good", openWO: 0 }, { num: 20, status: "watch", openWO: 1 }, { num: 21, status: "good", openWO: 0 },
  { num: 22, status: "watch", openWO: 1 }, { num: 23, status: "good", openWO: 0 }, { num: 24, status: "good", openWO: 1 },
  { num: 25, status: "good", openWO: 0 },
];

const counts = {
  good: buildings.filter((b) => b.status === "good").length,
  watch: buildings.filter((b) => b.status === "watch").length,
  urgent: buildings.filter((b) => b.status === "urgent").length,
};

const focus = [
  { num: 9, addr: "2828 CAMELOT LN",   issue: "ACTIVE ROOF LEAK · ATLAS DISPATCHED 09:50",   status: "urgent" as S, icon: Droplets },
  { num: 5, addr: "2814 HAMPSHIRE",    issue: "FOUNDATION INSPECTION · WED MAY 7 · 13:30",   status: "urgent" as S, icon: Wrench },
  { num: 14, addr: "2819 LA QUINTA",   issue: "INS. DECLARATION OUTSTANDING · 17 DAYS",       status: "urgent" as S, icon: ShieldCheck },
];

const ticker = [
  "WO-1051 OPEN · ROOF LEAK · BLDG 09",
  "WO-1043 CLOSED · ATLAS ROOFING · BLDG 09",
  "INS-22 PENDING · DECLARATION · BLDG 14",
  "WO-1050 OPEN · FOUNDATION · BLDG 05",
  "QUO-031 RECEIVED · $8,450 · BLDG 22 PAINT",
  "INSP SCHEDULED · WED MAY 7 · BLDG 14 · PINNACLE",
  "WO-1042 CLOSED · GREENLINE IRRIG. · BLDG 07",
  "MSG-088 LOGGED · NOTICE ACK · BLDG 10",
];

const tickerLoop = [...ticker, ...ticker];

export function Dashboard() {
  return (
    <>
      <style>{fontStyle}</style>
      <div className="font-tight flex h-screen min-h-[900px] flex-col" style={{ background: c.bg, color: c.ink, padding: 24 }}>
        {/* Title bar */}
        <header className="flex items-end justify-between border-b pb-4" style={{ borderColor: c.border }}>
          <div className="flex items-baseline gap-5">
            <div>
              <div className="font-mono-num text-[12px] tracking-[0.18em]" style={{ color: c.cobalt, fontWeight: 600 }}>QUAIL VALLEY · OPERATIONS BOARD</div>
              <div className="font-tight mt-1 text-[40px] leading-none" style={{ fontWeight: 700, letterSpacing: "-0.025em" }}>
                THE TOWN HOMES OF QUAIL VALLEY
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono-num inline-flex items-center gap-2 text-[12px]" style={{ color: c.emerald, fontWeight: 600 }}>
              <span className="blink-dot h-2.5 w-2.5 rounded-full" style={{ background: c.emerald, boxShadow: `0 0 14px ${c.emerald}` }} />
              LIVE · SYS OK · UPLINK 99.98%
            </div>
            <div className="font-mono-num mt-1 tabular text-[34px] leading-none" style={{ fontWeight: 700, letterSpacing: "-0.02em" }}>09:42:18 CST</div>
            <div className="font-mono-num mt-1 text-[12px]" style={{ color: c.inkSoft }}>TUE · 05 MAY 2026</div>
          </div>
        </header>

        {/* Mega KPI strip */}
        <section className="grid grid-cols-6 gap-3 py-4">
          {[
            { l: "TOTAL UNITS", v: "144", a: c.ink },
            { l: "BUILDINGS",   v: "25",  a: c.ink },
            { l: "OPEN WO",     v: "17",  a: c.cobalt, sub: "−4 vs 7d" },
            { l: "URGENT",      v: "03",  a: c.rose,   sub: "+1 vs 7d" },
            { l: "INS. GAPS",   v: "08",  a: c.amber,  sub: "−2 vs 7d" },
            { l: "ROOF FLAG",   v: "06",  a: c.amber,  sub: "+1 vs 7d" },
          ].map((k) => (
            <div key={k.l} className="rounded-md border px-4 py-3" style={{ background: c.panel, borderColor: c.border }}>
              <div className="font-mono-num text-[11px] tracking-[0.14em]" style={{ color: c.inkMute, fontWeight: 600 }}>{k.l}</div>
              <div className="font-mono-num mt-1 tabular text-[44px] leading-none" style={{ color: k.a, fontWeight: 700, letterSpacing: "-0.02em" }}>{k.v}</div>
              {k.sub && <div className="font-mono-num mt-1 text-[10.5px]" style={{ color: c.inkSoft }}>{k.sub}</div>}
            </div>
          ))}
        </section>

        {/* Main grid */}
        <section className="grid flex-1 grid-cols-12 gap-3 pb-3">
          {/* Building grid */}
          <div className="col-span-7 rounded-md border p-4" style={{ background: c.panel, borderColor: c.border }}>
            <div className="mb-3 flex items-center justify-between">
              <div className="font-mono-num text-[12px] tracking-[0.14em]" style={{ color: c.inkMute, fontWeight: 600 }}>
                ▌ PROPERTY HEALTH · 25 BUILDINGS
              </div>
              <div className="flex items-center gap-4 text-[12px]">
                <span className="font-mono-num inline-flex items-center gap-1.5" style={{ color: c.emerald }}>
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.emerald }} /> HEALTHY {counts.good}
                </span>
                <span className="font-mono-num inline-flex items-center gap-1.5" style={{ color: c.amber }}>
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.amber }} /> WATCH {counts.watch}
                </span>
                <span className="font-mono-num inline-flex items-center gap-1.5" style={{ color: c.rose }}>
                  <span className="h-2.5 w-2.5 rounded-sm blink-dot" style={{ background: c.rose, boxShadow: `0 0 10px ${c.rose}` }} /> URGENT {counts.urgent}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-2.5">
              {buildings.map((b) => {
                const t = tone[b.status];
                const isUrgent = b.status === "urgent";
                return (
                  <div key={b.num} className="relative flex flex-col items-center justify-center rounded-md border py-3"
                    style={{
                      background: isUrgent ? `rgba(255,92,122,0.08)` : c.panel2,
                      borderColor: t,
                      boxShadow: isUrgent ? `0 0 18px -8px ${t}` : "none",
                    }}>
                    <div className="font-mono-num text-[10.5px]" style={{ color: c.inkMute, fontWeight: 600 }}>BLDG {String(b.num).padStart(2, "0")}</div>
                    <div className="font-mono-num tabular text-[34px] leading-none my-1" style={{ color: t, fontWeight: 700, letterSpacing: "-0.02em" }}>{String(b.num).padStart(2, "0")}</div>
                    <div className="font-mono-num text-[10.5px]" style={{ color: c.inkSoft }}>
                      {b.openWO > 0 ? `${b.openWO} WO` : "OK"}
                    </div>
                    {isUrgent && (
                      <span className="blink-dot absolute top-2 right-2 h-2 w-2 rounded-full" style={{ background: t, boxShadow: `0 0 8px ${t}` }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Today's focus */}
          <div className="col-span-5 flex flex-col gap-3">
            <div className="rounded-md border p-4 flex-1" style={{ background: c.panel, borderColor: c.border }}>
              <div className="mb-3 flex items-center justify-between">
                <div className="font-mono-num text-[12px] tracking-[0.14em]" style={{ color: c.inkMute, fontWeight: 600 }}>
                  ▌ TODAY'S FOCUS
                </div>
                <div className="font-mono-num inline-flex items-center gap-1.5 text-[11px]" style={{ color: c.rose }}>
                  <AlertTriangle className="h-3.5 w-3.5" /> 3 URGENT ITEMS
                </div>
              </div>
              <ul className="space-y-2.5">
                {focus.map((f) => {
                  const Icon = f.icon;
                  return (
                    <li key={f.num} className="flex items-center gap-3 rounded-md border p-3" style={{ background: c.panel2, borderColor: c.border, borderLeft: `3px solid ${c.rose}` }}>
                      <div className="flex h-10 w-10 items-center justify-center rounded-md" style={{ background: "rgba(255,92,122,0.12)", color: c.rose }}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-mono-num text-[11px]" style={{ color: c.inkMute, fontWeight: 600 }}>BLDG {String(f.num).padStart(2, "0")} · {f.addr}</div>
                        <div className="font-mono-num text-[13px]" style={{ color: c.ink, fontWeight: 600 }}>{f.issue}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border p-4" style={{ background: c.panel, borderColor: c.border }}>
                <div className="font-mono-num text-[11px] tracking-[0.14em]" style={{ color: c.inkMute, fontWeight: 600 }}>VENDOR ON-SITE</div>
                <div className="font-mono-num mt-2 text-[18px]" style={{ color: c.ink, fontWeight: 700 }}>ATLAS ROOFING</div>
                <div className="font-mono-num text-[12px]" style={{ color: c.emerald }}>● BLDG 09 · ETA 09:50</div>
              </div>
              <div className="rounded-md border p-4" style={{ background: c.panel, borderColor: c.border }}>
                <div className="font-mono-num text-[11px] tracking-[0.14em]" style={{ color: c.inkMute, fontWeight: 600 }}>NEXT BOARD MEETING</div>
                <div className="font-mono-num mt-2 text-[18px]" style={{ color: c.ink, fontWeight: 700 }}>MON · MAY 12</div>
                <div className="font-mono-num text-[12px]" style={{ color: c.cobalt }}>● 6:30 PM · COMMUNITY HALL</div>
              </div>
            </div>
          </div>
        </section>

        {/* Live ticker */}
        <footer className="flex items-center gap-4 rounded-md border px-4 py-2.5" style={{ background: c.panel, borderColor: c.border }}>
          <div className="font-mono-num shrink-0 text-[11px] tracking-[0.18em]" style={{ color: c.cobalt, fontWeight: 700 }}>
            ▌ EVENT FEED · LIVE
          </div>
          <div className="relative flex-1 overflow-hidden">
            <div className="ticker flex w-max items-center gap-8 whitespace-nowrap">
              {tickerLoop.map((t, i) => {
                const isOpen = t.includes("OPEN");
                const isClosed = t.includes("CLOSED");
                const Icon = isClosed ? CheckCircle2 : AlertTriangle;
                return (
                  <span key={i} className="font-mono-num inline-flex items-center gap-2 text-[12px]" style={{ color: c.inkSoft }}>
                    <Icon className="h-3.5 w-3.5" style={{ color: isOpen ? c.amber : isClosed ? c.emerald : c.cobalt }} />
                    {t}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="font-mono-num shrink-0 text-[11px]" style={{ color: c.inkMute }}>QV-OPS-BOARD · v2.1.0</div>
        </footer>
      </div>
    </>
  );
}
