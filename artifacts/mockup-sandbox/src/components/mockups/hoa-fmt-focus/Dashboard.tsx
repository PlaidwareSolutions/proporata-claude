import {
  Droplets, Wrench, ShieldCheck, ArrowRight, Check, X, Calendar, Search,
  ChevronDown, Sparkles, Clock,
} from "lucide-react";

const fontStyle = `
@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=JetBrains+Mono:wght@400;500&display=swap');
.font-tight { font-family: 'Inter Tight', system-ui, sans-serif; letter-spacing: -0.01em; }
.font-display { font-family: 'Fraunces', Georgia, serif; }
.font-mono-num { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.tabular { font-variant-numeric: tabular-nums; }
`;

const c = {
  canvas: "#FAFAF9",
  ink: "#0B1020",
  inkSoft: "#3F4661",
  inkMute: "#9098AD",
  border: "#EFEFEC",
  cobalt: "#3245FF",
  cobaltSoft: "#E5E8FF",
  emerald: "#10A37F",
  amber: "#C8851A",
  rose: "#D6315B",
  roseSoft: "#FBE3E9",
  amberSoft: "#FBEFD6",
};

const decisions = [
  {
    num: 9, address: "2828 Camelot Lane", priority: "URGENT", color: c.rose, bg: c.roseSoft,
    icon: Droplets, headline: "Approve emergency tarp & roof repair",
    body: "Active water intrusion reported by the board. Atlas Roofing can be on-site by 10 am with a $2,400 emergency quote.",
    primary: "Approve & dispatch", secondary: "Get a second quote",
  },
  {
    num: 5, address: "2814 Hampshire", priority: "URGENT", color: c.rose, bg: c.roseSoft,
    icon: Wrench, headline: "Schedule structural inspection",
    body: "Owner reported a foundation crack with photos. Pinnacle Inspections has Wed May 7 open at 1:30 pm.",
    primary: "Schedule for Wed 1:30 pm", secondary: "See owner photos",
  },
  {
    num: 14, address: "2819 La Quinta", priority: "HIGH", color: c.amber, bg: c.amberSoft,
    icon: ShieldCheck, headline: "Send insurance declaration request",
    body: "Q2 declaration is missing for this unit. The owner has been quiet since April 18 — a follow-up is overdue.",
    primary: "Send follow-up email", secondary: "Mark waiting on owner",
  },
];

export function Dashboard() {
  return (
    <>
      <style>{fontStyle}</style>
      <div className="font-tight min-h-screen" style={{ background: c.canvas, color: c.ink }}>
        {/* Whisper-thin top bar */}
        <header className="flex items-center justify-between px-12 pt-5">
          <div className="flex items-center gap-2.5 text-[11px]" style={{ color: c.inkMute }}>
            <span className="font-mono-num">QV · HOA</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: c.emerald }} /> Live · synced 2 min ago</span>
            <span>·</span>
            <span className="font-mono-num">Tue May 5, 2026</span>
          </div>
          <div className="flex items-center gap-3 text-[11px]" style={{ color: c.inkMute }}>
            <button className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1" style={{ borderColor: c.border, background: "#fff", color: c.inkSoft }}>
              <Search className="h-3 w-3" /> Search
            </button>
            <button className="inline-flex items-center gap-1 rounded-md px-2 py-1" style={{ color: c.inkSoft }}>
              See full operations <ChevronDown className="h-3 w-3" />
            </button>
            <div className="flex h-7 w-7 items-center justify-center rounded-full text-[10px]" style={{ background: c.ink, color: "#fff", fontWeight: 600 }}>EM</div>
          </div>
        </header>

        {/* Hero question */}
        <section className="px-12 pt-20 pb-10">
          <div className="mx-auto max-w-[1100px]">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em]" style={{ color: c.cobalt }}>
              <Sparkles className="h-3.5 w-3.5" /> Today, 9:42 am
            </div>
            <h1 className="font-display mt-3 text-[68px] leading-[1.02]"
              style={{ color: c.ink, fontWeight: 600, letterSpacing: "-0.025em" }}>
              Three buildings need you today.
            </h1>
            <p className="font-display mt-4 max-w-3xl text-[19px] leading-relaxed" style={{ color: c.inkSoft, fontWeight: 500 }}>
              The rest of the property is in good shape. Make these three calls and the day is done.
            </p>
          </div>
        </section>

        {/* Decision cards */}
        <section className="px-12 pb-12">
          <div className="mx-auto grid max-w-[1100px] grid-cols-3 gap-4">
            {decisions.map((d) => {
              const Icon = d.icon;
              return (
                <article key={d.num} className="flex flex-col rounded-2xl border bg-white p-6 transition-all hover:-translate-y-0.5"
                  style={{ borderColor: c.border, boxShadow: "0 1px 0 rgba(11,16,32,0.02), 0 24px 60px -40px rgba(11,16,32,0.18)" }}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono-num text-[10.5px]" style={{ color: c.inkMute }}>BLDG {String(d.num).padStart(2, "0")}</span>
                    <span className="font-mono-num rounded-full px-2 py-0.5 text-[9.5px] font-bold tracking-wider" style={{ background: d.bg, color: d.color }}>
                      {d.priority}
                    </span>
                  </div>
                  <div className="font-display mt-3 text-[22px] leading-tight" style={{ color: c.ink, fontWeight: 600, letterSpacing: "-0.015em" }}>
                    {d.address}
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: d.bg, color: d.color }}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-[13px]" style={{ fontWeight: 600, color: c.ink }}>{d.headline}</span>
                  </div>
                  <p className="mt-3 flex-1 text-[13px] leading-relaxed" style={{ color: c.inkSoft }}>
                    {d.body}
                  </p>
                  <div className="mt-5 space-y-2">
                    <button className="inline-flex w-full items-center justify-between rounded-xl px-4 py-2.5 text-[13px]" style={{ background: c.ink, color: "#fff", fontWeight: 500 }}>
                      <span className="inline-flex items-center gap-2"><Check className="h-3.5 w-3.5" /> {d.primary}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                    <div className="flex items-center justify-between text-[11.5px]">
                      <button className="text-left" style={{ color: c.inkSoft }}>{d.secondary}</button>
                      <button className="inline-flex items-center gap-1" style={{ color: c.inkMute }}>
                        <X className="h-3 w-3" /> Not today
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* Calm footer strip — everything else is fine */}
        <section className="px-12 pb-12">
          <div className="mx-auto max-w-[1100px] rounded-2xl border bg-white px-6 py-5" style={{ borderColor: c.border }}>
            <div className="flex flex-wrap items-center justify-between gap-y-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: "#E8F4EE" }}>
                  <Check className="h-3.5 w-3.5" style={{ color: c.emerald }} />
                </span>
                <div>
                  <div className="text-[12.5px]" style={{ fontWeight: 600 }}>Everything else is on track.</div>
                  <div className="text-[11px]" style={{ color: c.inkMute }}>22 of 25 buildings healthy · roof program 92% complete · reserve 94% of target</div>
                </div>
              </div>
              <div className="flex items-center gap-5 text-[11.5px]" style={{ color: c.inkSoft }}>
                <span className="inline-flex items-center gap-1.5"><span className="font-mono-num text-[15px]" style={{ color: c.ink, fontWeight: 700 }}>17</span> open work orders</span>
                <span className="inline-flex items-center gap-1.5"><span className="font-mono-num text-[15px]" style={{ color: c.ink, fontWeight: 700 }}>8</span> insurance gaps</span>
                <span className="inline-flex items-center gap-1.5"><span className="font-mono-num text-[15px]" style={{ color: c.ink, fontWeight: 700 }}>5</span> vendor visits this week</span>
                <button className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px]" style={{ color: c.cobalt, fontWeight: 600 }}>
                  Switch to operations view <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>

          <div className="mx-auto mt-4 flex max-w-[1100px] items-center justify-between text-[10.5px]" style={{ color: c.inkMute }}>
            <span className="inline-flex items-center gap-1.5"><Clock className="h-3 w-3" /> Updated 9:42 am · This view refreshes every morning at 7</span>
            <span className="inline-flex items-center gap-1.5"><Calendar className="h-3 w-3" /> Tue May 5, 2026 · Quail Valley · Sugar Land, TX</span>
          </div>
        </section>
      </div>
    </>
  );
}
