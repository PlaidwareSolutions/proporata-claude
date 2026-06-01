// Task #88 — Amenity financials & reporting dashboard.
// Tabs: Revenue · Utilization · Deposits · P&L · Expenses · Alerts
import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { apiFetch } from "@/lib/apiFetch";
import { useListAmenities } from "@workspace/api-client-react";
import { Download, Printer, AlertTriangle, RefreshCcw } from "lucide-react";

type Range = { from: string; to: string };
type Preset = "30d" | "90d" | "ytd" | "12m" | "custom";

function fmtUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function shiftIso(s: string, deltaDays: number): string {
  const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}
function presetRange(p: Preset): Range {
  const to = todayIso();
  if (p === "30d") return { from: shiftIso(to, -30), to };
  if (p === "90d") return { from: shiftIso(to, -90), to };
  if (p === "12m") return { from: shiftIso(to, -365), to };
  if (p === "ytd") {
    const y = new Date().getUTCFullYear();
    return { from: `${y}-01-01`, to };
  }
  return { from: "", to: "" };
}

interface RevenueResponse {
  range: { from: string | null; to: string | null };
  kpis: { grossCents: number; refundCents: number; netCents: number; heldBalanceCents: number; eventCount: number; refundRate: number };
  byKind: Record<string, number>;
  byAmenity: Array<{ amenityId: number; amenitySlug: string; amenityName: string; grossCents: number; refundCents: number; netCents: number; events: number }>;
  byMonth: Array<{ month: string; grossCents: number; refundCents: number; netCents: number }>;
  priorPeriod: { grossCents: number; refundCents: number; netCents: number; byMonth: Array<{ month: string; netCents: number }> } | null;
  priorYear: { grossCents: number; refundCents: number; netCents: number; byMonth: Array<{ month: string; netCents: number }> } | null;
}

interface UtilizationResponse {
  range: Range;
  cells: Array<{ weekday: number; hour: number; bookings: number; minutes: number }>;
  totalBookings: number;
  totalMinutes: number;
  peak: { weekday: number; hour: number; bookings: number } | null;
}

interface DepositsResponse {
  ledger: Array<{ id: number; createdAt: string; bookingId: number; amenityName: string; unitId: string | null; ownerName: string; kind: string; amountCents: number; balanceCents: number; reason: string; actorName: string; }>;
  held: Array<{ bookingId: number; amenityName: string; unitId: string | null; ownerName: string; depositCents: number; paidAt: string; ageDays: number; status: string; hasDamageReport: boolean; }>;
  heldBalanceCents: number;
  releasedCents: number;
  forfeitedCents: number;
  refundedCents: number;
  stuckCount: number;
}

interface PnlResponse {
  rows: Array<{ amenityId: number; amenityName: string; revenueGrossCents: number; revenueRefundCents: number; revenueNetCents: number; expenseCents: number; netCents: number; eventCount: number }>;
  totals: { revenueGrossCents: number; revenueRefundCents: number; revenueNetCents: number; expenseCents: number; netCents: number };
}

interface AlertsResponse {
  alerts: Array<{ severity: "info" | "warn" | "critical"; code: string; amenityName?: string; message: string; valueCents?: number; ratioBp?: number }>;
  thresholds: { refundRateBp: number; forfeitThresholdCents: number; utilizationFloorBp: number };
}

interface ExpensesResponse {
  rows: Array<{ id: number; amenityId: number; occurredOn: string; kind: string; vendor: string; description: string; amountCents: number; createdByName: string }>;
  totalCents: number;
}

const KIND_LABELS: Record<string, string> = {
  booking_fee: "Booking fees",
  deposit_forfeiture: "Deposit forfeitures",
  ev_energy: "EV energy",
  ev_idle: "EV idle fees",
  ev_no_show: "EV no-show fees",
  guest_parking: "Guest parking",
  refund: "Refunds",
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function AmenityFinancials() {
  const [tab, setTab] = useState<"revenue" | "utilization" | "deposits" | "pnl" | "expenses" | "alerts">("revenue");
  const [preset, setPreset] = useState<Preset>("90d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [amenityId, setAmenityId] = useState<string>("");
  const [compare, setCompare] = useState<"none" | "prior_period" | "prior_year" | "both">("none");

  const range: Range = useMemo(() => {
    if (preset === "custom") return { from: customFrom, to: customTo };
    return presetRange(preset);
  }, [preset, customFrom, customTo]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (range.from) p.set("from", range.from);
    if (range.to) p.set("to", range.to);
    if (amenityId) p.set("amenityId", amenityId);
    if (compare !== "none") p.set("compare", compare);
    return p.toString();
  }, [range, amenityId, compare]);

  const { data: amenities = [] } = useListAmenities();

  const [revenue, setRevenue] = useState<RevenueResponse | null>(null);
  const [utilization, setUtilization] = useState<UtilizationResponse | null>(null);
  const [deposits, setDeposits] = useState<DepositsResponse | null>(null);
  const [pnl, setPnl] = useState<PnlResponse | null>(null);
  const [expenses, setExpenses] = useState<ExpensesResponse | null>(null);
  const [alerts, setAlerts] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refundOpen, setRefundOpen] = useState<null | { source: "booking" | "charging_session"; sourceId: number; max: number; label: string }>(null);
  const [expenseOpen, setExpenseOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        if (tab === "revenue") {
          const r = await apiFetch<RevenueResponse>({ url: `/reports/amenities/revenue?${qs}`, method: "GET" });
          if (!cancelled) setRevenue(r);
        } else if (tab === "utilization") {
          const r = await apiFetch<UtilizationResponse>({ url: `/reports/amenities/utilization?${qs}`, method: "GET" });
          if (!cancelled) setUtilization(r);
        } else if (tab === "deposits") {
          const r = await apiFetch<DepositsResponse>({ url: `/reports/amenities/deposits?${qs}`, method: "GET" });
          if (!cancelled) setDeposits(r);
        } else if (tab === "pnl") {
          const r = await apiFetch<PnlResponse>({ url: `/reports/amenities/pnl?${qs}`, method: "GET" });
          if (!cancelled) setPnl(r);
        } else if (tab === "expenses") {
          const r = await apiFetch<ExpensesResponse>({ url: `/reports/amenities/expenses?${qs}`, method: "GET" });
          if (!cancelled) setExpenses(r);
        } else if (tab === "alerts") {
          const r = await apiFetch<AlertsResponse>({ url: `/reports/amenities/alerts?${qs}`, method: "GET" });
          if (!cancelled) setAlerts(r);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, qs]);

  const reload = () => { setLoading((l) => l); /* trigger via state churn */ setTab((t) => t); };

  return (
    <Layout title="Amenity Financials" subtitle="Revenue, utilization, deposits, and P&L">
      {/* Filters */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {(["30d", "90d", "ytd", "12m", "custom"] as Preset[]).map((p) => (
          <button key={p} onClick={() => setPreset(p)} className="px-3 py-1.5 rounded-lg text-[13px] font-semibold border"
            style={{ background: preset === p ? c.cobalt : "white", color: preset === p ? "white" : c.inkSoft, borderColor: preset === p ? c.cobalt : c.border }}>
            {p === "30d" ? "30d" : p === "90d" ? "90d" : p === "ytd" ? "YTD" : p === "12m" ? "12m" : "Custom"}
          </button>
        ))}
        {preset === "custom" && (
          <>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="border rounded-lg px-2 py-1 text-[13px]" style={{ borderColor: c.border, color: c.ink }} />
            <span className="text-[13px]" style={{ color: c.inkMute }}>to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="border rounded-lg px-2 py-1 text-[13px]" style={{ borderColor: c.border, color: c.ink }} />
          </>
        )}
        <select value={amenityId} onChange={(e) => setAmenityId(e.target.value)} className="border rounded-lg px-2 py-1 text-[13px]" style={{ borderColor: c.border, color: c.ink }}>
          <option value="">All amenities</option>
          {amenities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {tab === "revenue" && (
          <select value={compare} onChange={(e) => setCompare(e.target.value as typeof compare)} className="border rounded-lg px-2 py-1 text-[13px]" style={{ borderColor: c.border, color: c.ink }}>
            <option value="none">No compare</option>
            <option value="prior_period">vs prior period</option>
            <option value="prior_year">vs prior year</option>
            <option value="both">Both</option>
          </select>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={reload} className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border text-[12.5px]" style={{ borderColor: c.border, color: c.inkSoft }}>
            <RefreshCcw className="h-3.5 w-3.5" /> Refresh
          </button>
          {loading && <span className="text-[12px]" style={{ color: c.inkMute }}>Loading…</span>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b" style={{ borderColor: c.border }}>
        {(["revenue", "utilization", "deposits", "pnl", "expenses", "alerts"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className="px-3 py-2 text-[13px] font-semibold border-b-2 -mb-px"
            style={{ color: tab === t ? c.cobalt : c.inkSoft, borderColor: tab === t ? c.cobalt : "transparent" }}>
            {t === "revenue" ? "Revenue" : t === "utilization" ? "Utilization" : t === "deposits" ? "Deposits" : t === "pnl" ? "P&L" : t === "expenses" ? "Expenses" : "Alerts"}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          {tab === "revenue" && (
            <a href={`/api/reports/amenities/revenue.csv?${qs}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12.5px]" style={{ background: c.panel, color: c.inkSoft }}>
              <Download className="h-3.5 w-3.5" /> CSV
            </a>
          )}
          {tab === "deposits" && (
            <a href={`/api/reports/amenities/deposits.csv?${qs}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12.5px]" style={{ background: c.panel, color: c.inkSoft }}>
              <Download className="h-3.5 w-3.5" /> CSV
            </a>
          )}
          <a href={`/api/reports/amenities/monthly-summary?month=${(range.to || todayIso()).slice(0, 7)}`} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12.5px]" style={{ background: c.panel, color: c.inkSoft }}>
            <Printer className="h-3.5 w-3.5" /> Month-end PDF
          </a>
        </div>
      </div>

      {tab === "revenue" && revenue && <RevenueTab data={revenue} />}
      {tab === "utilization" && utilization && <UtilizationTab data={utilization} />}
      {tab === "deposits" && deposits && <DepositsTab data={deposits} onRefund={(b) => setRefundOpen(b)} />}
      {tab === "pnl" && pnl && <PnlTab data={pnl} />}
      {tab === "expenses" && expenses && <ExpensesTab data={expenses} amenities={amenities.map((a) => ({ id: a.id, name: a.name }))} onAdd={() => setExpenseOpen(true)} onChanged={reload} />}
      {tab === "alerts" && alerts && <AlertsTab data={alerts} />}

      {refundOpen && (
        <RefundDialog
          source={refundOpen.source}
          sourceId={refundOpen.sourceId}
          maxCents={refundOpen.max}
          label={refundOpen.label}
          onClose={() => setRefundOpen(null)}
          onDone={() => { setRefundOpen(null); reload(); }}
        />
      )}
      {expenseOpen && (
        <ExpenseDialog
          amenities={amenities.map((a) => ({ id: a.id, name: a.name }))}
          onClose={() => setExpenseOpen(false)}
          onDone={() => { setExpenseOpen(false); reload(); }}
        />
      )}
    </Layout>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
      <div className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: c.inkSoft }}>{label}</div>
      <div className="font-mono-num mt-2 text-[24px]" style={{ color: c.ink, fontWeight: 700, letterSpacing: "-0.02em" }}>{value}</div>
      {hint && <div className="text-[12px] mt-1" style={{ color: c.inkMute, fontWeight: 500 }}>{hint}</div>}
    </div>
  );
}

function RevenueTab({ data }: { data: RevenueResponse }) {
  const maxMonth = Math.max(...data.byMonth.map((m) => Math.abs(m.netCents)), 1);
  const priorMap = new Map((data.priorYear?.byMonth ?? []).map((m) => [m.month.slice(5), m.netCents]));
  return (
    <>
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Kpi label="Gross collected" value={fmtUsd(data.kpis.grossCents)} hint={`${data.kpis.eventCount} events`} />
        <Kpi label="Refunds" value={fmtUsd(data.kpis.refundCents)} hint={`${(data.kpis.refundRate * 100).toFixed(1)}% of gross`} />
        <Kpi label="Net" value={fmtUsd(data.kpis.netCents)} hint={data.priorPeriod ? `vs ${fmtUsd(data.priorPeriod.netCents)} prior` : undefined} />
        <Kpi label="Held deposits" value={fmtUsd(data.kpis.heldBalanceCents)} hint="Currently in escrow" />
      </div>

      <div className="grid grid-cols-2 gap-5 mb-5">
        <section className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
          <h3 className="text-[15px] mb-4" style={{ fontWeight: 700 }}>Revenue mix</h3>
          {Object.entries(data.byKind).map(([k, v]) => v > 0 && (
            <div key={k} className="mb-3">
              <div className="flex justify-between text-[13px] mb-1">
                <span style={{ color: c.inkSoft }}>{KIND_LABELS[k] ?? k}</span>
                <span className="font-mono-num" style={{ fontWeight: 700 }}>{fmtUsd(v)}</span>
              </div>
              <div className="h-2.5 rounded-full overflow-hidden" style={{ background: c.borderSoft }}>
                <div className="h-full" style={{ width: `${Math.min(100, (v / Math.max(data.kpis.grossCents, 1)) * 100)}%`, background: k === "refund" ? c.rose : c.cobalt }} />
              </div>
            </div>
          ))}
        </section>

        <section className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
          <h3 className="text-[15px] mb-4" style={{ fontWeight: 700 }}>Net by month {data.priorYear ? "(YoY)" : ""}</h3>
          {data.byMonth.length === 0 ? <div className="text-[13px]" style={{ color: c.inkMute }}>No data</div> : (
            <div className="flex items-end justify-between gap-1" style={{ height: 192 }}>
              {data.byMonth.map((m) => {
                const h = Math.max(4, Math.round((Math.abs(m.netCents) / maxMonth) * 140));
                const prior = priorMap.get(m.month.slice(5));
                const ph = prior != null ? Math.max(4, Math.round((Math.abs(prior) / maxMonth) * 140)) : 0;
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center justify-end gap-1">
                    <div className="font-mono-num text-[10px]" style={{ color: c.inkMute, fontWeight: 600 }}>{fmtUsd(m.netCents)}</div>
                    <div className="flex items-end gap-1">
                      <div style={{ background: c.cobalt, height: h, width: 18, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
                      {prior != null && <div style={{ background: c.borderSoft, height: ph, width: 12, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />}
                    </div>
                    <div className="text-[10px]" style={{ color: c.inkSoft }}>{m.month.slice(5)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
        <h3 className="text-[15px] mb-4" style={{ fontWeight: 700 }}>By amenity</h3>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left" style={{ color: c.inkSoft }}>
              <th className="py-1">Amenity</th>
              <th className="py-1 text-right">Gross</th>
              <th className="py-1 text-right">Refund</th>
              <th className="py-1 text-right">Net</th>
              <th className="py-1 text-right">Events</th>
            </tr>
          </thead>
          <tbody>
            {data.byAmenity.map((a) => (
              <tr key={a.amenityId} className="border-t" style={{ borderColor: c.borderSoft }}>
                <td className="py-1.5">{a.amenityName}</td>
                <td className="py-1.5 text-right font-mono-num">{fmtUsd(a.grossCents)}</td>
                <td className="py-1.5 text-right font-mono-num" style={{ color: a.refundCents > 0 ? c.rose : c.inkMute }}>{fmtUsd(a.refundCents)}</td>
                <td className="py-1.5 text-right font-mono-num" style={{ fontWeight: 700 }}>{fmtUsd(a.netCents)}</td>
                <td className="py-1.5 text-right">{a.events}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function UtilizationTab({ data }: { data: UtilizationResponse }) {
  const max = Math.max(...data.cells.map((c) => c.bookings), 1);
  const grid = new Map<string, number>(data.cells.map((c) => [`${c.weekday}-${c.hour}`, c.bookings]));
  return (
    <>
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Kpi label="Total bookings" value={data.totalBookings.toLocaleString()} />
        <Kpi label="Total minutes" value={Math.round(data.totalMinutes).toLocaleString()} hint={`${(data.totalMinutes / 60).toFixed(0)} hours`} />
        <Kpi label="Peak slot" value={data.peak ? `${WEEKDAY_LABELS[data.peak.weekday]} ${data.peak.hour}:00` : "—"} hint={data.peak ? `${data.peak.bookings} bookings` : ""} />
      </div>
      <section className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
        <h3 className="text-[15px] mb-4" style={{ fontWeight: 700 }}>Heat-map (UTC)</h3>
        <div className="overflow-x-auto">
          <table className="text-[11px]" style={{ borderCollapse: "separate", borderSpacing: 1 }}>
            <thead>
              <tr>
                <th></th>
                {Array.from({ length: 24 }).map((_, h) => (
                  <th key={h} className="px-1" style={{ color: c.inkMute, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEKDAY_LABELS.map((label, wd) => (
                <tr key={wd}>
                  <td className="pr-2" style={{ color: c.inkSoft, fontWeight: 600 }}>{label}</td>
                  {Array.from({ length: 24 }).map((_, h) => {
                    const v = grid.get(`${wd}-${h}`) ?? 0;
                    const intensity = max ? v / max : 0;
                    const bg = v === 0 ? c.borderSoft : `rgba(50, 69, 255, ${0.15 + intensity * 0.85})`;
                    return <td key={h} title={`${label} ${h}:00 — ${v} bookings`} style={{ background: bg, color: intensity > 0.5 ? "#fff" : c.inkSoft, width: 22, height: 22, textAlign: "center" }}>{v || ""}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function DepositsTab({ data, onRefund }: { data: DepositsResponse; onRefund: (b: { source: "booking"; sourceId: number; max: number; label: string }) => void }) {
  return (
    <>
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Kpi label="Held balance" value={fmtUsd(data.heldBalanceCents)} hint={`${data.held.length} active`} />
        <Kpi label="Released" value={fmtUsd(data.releasedCents)} />
        <Kpi label="Forfeited" value={fmtUsd(data.forfeitedCents)} />
        <Kpi label="Refunded" value={fmtUsd(data.refundedCents)} />
      </div>

      {data.stuckCount > 0 && (
        <div className="rounded-lg border-l-4 px-4 py-3 mb-4 flex items-center gap-2" style={{ background: c.amberSoft, borderColor: c.amber }}>
          <AlertTriangle className="h-4 w-4" style={{ color: c.amber }} />
          <span className="text-[13px]" style={{ color: c.ink }}>{data.stuckCount} deposit(s) held more than 30 days without a release or charge.</span>
        </div>
      )}

      <section className="rounded-xl border bg-white p-5 mb-5" style={{ borderColor: c.border }}>
        <h3 className="text-[15px] mb-3" style={{ fontWeight: 700 }}>Held deposits</h3>
        {data.held.length === 0 ? <div className="text-[13px]" style={{ color: c.inkMute }}>None</div> : (
          <table className="w-full text-[13px]">
            <thead><tr style={{ color: c.inkSoft }}>
              <th className="text-left py-1">Booking</th>
              <th className="text-left py-1">Amenity</th>
              <th className="text-left py-1">Owner</th>
              <th className="text-right py-1">Held</th>
              <th className="text-right py-1">Age</th>
              <th className="text-right py-1"></th>
            </tr></thead>
            <tbody>
              {data.held.map((h) => (
                <tr key={h.bookingId} className="border-t" style={{ borderColor: c.borderSoft }}>
                  <td className="py-1.5 font-mono-num">#{h.bookingId}</td>
                  <td className="py-1.5">{h.amenityName}</td>
                  <td className="py-1.5">{h.ownerName} {h.unitId ? <span style={{ color: c.inkMute }}>· {h.unitId}</span> : null}</td>
                  <td className="py-1.5 text-right font-mono-num">{fmtUsd(h.depositCents)}</td>
                  <td className="py-1.5 text-right" style={{ color: h.ageDays > 30 ? c.rose : c.inkSoft }}>{h.ageDays}d</td>
                  <td className="py-1.5 text-right">
                    <button onClick={() => onRefund({ source: "booking", sourceId: h.bookingId, max: h.depositCents, label: `Booking #${h.bookingId} — ${h.ownerName}` })}
                      className="text-[12px] px-2 py-1 rounded border" style={{ borderColor: c.border, color: c.cobalt, fontWeight: 600 }}>
                      Refund
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
        <h3 className="text-[15px] mb-3" style={{ fontWeight: 700 }}>Recent ledger entries</h3>
        {data.ledger.length === 0 ? <div className="text-[13px]" style={{ color: c.inkMute }}>None</div> : (
          <table className="w-full text-[13px]">
            <thead><tr style={{ color: c.inkSoft }}>
              <th className="text-left py-1">When</th>
              <th className="text-left py-1">Booking</th>
              <th className="text-left py-1">Amenity</th>
              <th className="text-left py-1">Kind</th>
              <th className="text-right py-1">Amount</th>
              <th className="text-left py-1">Reason</th>
              <th className="text-left py-1">Actor</th>
            </tr></thead>
            <tbody>
              {data.ledger.slice().reverse().slice(0, 100).map((r) => (
                <tr key={r.id} className="border-t" style={{ borderColor: c.borderSoft }}>
                  <td className="py-1 font-mono-num text-[12px]" style={{ color: c.inkMute }}>{r.createdAt.slice(0, 16).replace("T", " ")}</td>
                  <td className="py-1 font-mono-num">#{r.bookingId}</td>
                  <td className="py-1">{r.amenityName}</td>
                  <td className="py-1"><span className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: r.kind === "charged" ? c.roseSoft : r.kind === "refunded" ? c.cobaltSoft : c.borderSoft, color: r.kind === "charged" ? c.rose : r.kind === "refunded" ? c.cobalt : c.inkSoft, fontWeight: 600 }}>{r.kind}</span></td>
                  <td className="py-1 text-right font-mono-num">{fmtUsd(r.amountCents)}</td>
                  <td className="py-1 text-[12px]" style={{ color: c.inkSoft }}>{r.reason}</td>
                  <td className="py-1 text-[12px]" style={{ color: c.inkMute }}>{r.actorName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function PnlTab({ data }: { data: PnlResponse }) {
  return (
    <>
      <div className="grid grid-cols-4 gap-4 mb-5">
        <Kpi label="Net revenue" value={fmtUsd(data.totals.revenueNetCents)} />
        <Kpi label="Expenses" value={fmtUsd(data.totals.expenseCents)} />
        <Kpi label="Contribution" value={fmtUsd(data.totals.netCents)} />
        <Kpi label="Refunds" value={fmtUsd(data.totals.revenueRefundCents)} />
      </div>
      <section className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
        <h3 className="text-[15px] mb-3" style={{ fontWeight: 700 }}>Per-amenity P&L</h3>
        <table className="w-full text-[13px]">
          <thead><tr style={{ color: c.inkSoft }}>
            <th className="text-left py-1">Amenity</th>
            <th className="text-right py-1">Gross</th>
            <th className="text-right py-1">Refund</th>
            <th className="text-right py-1">Net rev</th>
            <th className="text-right py-1">Expenses</th>
            <th className="text-right py-1">Contribution</th>
          </tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.amenityId} className="border-t" style={{ borderColor: c.borderSoft }}>
                <td className="py-1.5">{r.amenityName}</td>
                <td className="py-1.5 text-right font-mono-num">{fmtUsd(r.revenueGrossCents)}</td>
                <td className="py-1.5 text-right font-mono-num" style={{ color: r.revenueRefundCents > 0 ? c.rose : c.inkMute }}>{fmtUsd(r.revenueRefundCents)}</td>
                <td className="py-1.5 text-right font-mono-num">{fmtUsd(r.revenueNetCents)}</td>
                <td className="py-1.5 text-right font-mono-num" style={{ color: c.inkSoft }}>{fmtUsd(r.expenseCents)}</td>
                <td className="py-1.5 text-right font-mono-num" style={{ fontWeight: 700, color: r.netCents < 0 ? c.rose : c.emerald }}>{fmtUsd(r.netCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function ExpensesTab({ data, amenities, onAdd, onChanged }: { data: ExpensesResponse; amenities: Array<{ id: number; name: string }>; onAdd: () => void; onChanged: () => void }) {
  const amName = (id: number) => amenities.find((a) => a.id === id)?.name ?? `#${id}`;
  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[14px]" style={{ color: c.inkSoft }}>{data.rows.length} entries · total {fmtUsd(data.totalCents)}</div>
        <button onClick={onAdd} className="px-3 py-1.5 rounded-md text-[13px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>+ Log expense</button>
      </div>
      <section className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
        {data.rows.length === 0 ? <div className="text-[13px]" style={{ color: c.inkMute }}>No expenses logged in this range.</div> : (
          <table className="w-full text-[13px]">
            <thead><tr style={{ color: c.inkSoft }}>
              <th className="text-left py-1">Date</th>
              <th className="text-left py-1">Amenity</th>
              <th className="text-left py-1">Vendor</th>
              <th className="text-left py-1">Kind</th>
              <th className="text-left py-1">Description</th>
              <th className="text-right py-1">Amount</th>
              <th className="text-left py-1">By</th>
              <th></th>
            </tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t" style={{ borderColor: c.borderSoft }}>
                  <td className="py-1.5 font-mono-num">{r.occurredOn}</td>
                  <td className="py-1.5">{amName(r.amenityId)}</td>
                  <td className="py-1.5">{r.vendor || <span style={{ color: c.inkMute }}>—</span>}</td>
                  <td className="py-1.5">{r.kind}</td>
                  <td className="py-1.5">{r.description}</td>
                  <td className="py-1.5 text-right font-mono-num">{fmtUsd(r.amountCents)}</td>
                  <td className="py-1.5 text-[12px]" style={{ color: c.inkMute }}>{r.createdByName}</td>
                  <td className="py-1.5 text-right">
                    <button onClick={async () => {
                      if (!confirm("Delete expense?")) return;
                      await apiFetch({ url: `/reports/amenities/expenses/${r.id}`, method: "DELETE" });
                      onChanged();
                    }} className="text-[12px]" style={{ color: c.rose, fontWeight: 600 }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function AlertsTab({ data }: { data: AlertsResponse }) {
  if (data.alerts.length === 0) return <div className="rounded-xl border bg-white p-8 text-center text-[14px]" style={{ borderColor: c.border, color: c.inkSoft }}>No active alerts. Everything looks healthy.</div>;
  return (
    <div className="space-y-2">
      {data.alerts.map((a, i) => {
        const bg = a.severity === "critical" ? c.roseSoft : a.severity === "warn" ? c.amberSoft : c.cobaltSoft;
        const fg = a.severity === "critical" ? c.rose : a.severity === "warn" ? c.amber : c.cobalt;
        return (
          <div key={i} className="rounded-lg border-l-4 px-4 py-3" style={{ background: bg, borderColor: fg }}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" style={{ color: fg }} />
              <div className="text-[13px]" style={{ fontWeight: 600 }}>{a.message}</div>
            </div>
            <div className="text-[12px] mt-1" style={{ color: c.inkMute }}>{a.code}{a.amenityName ? ` · ${a.amenityName}` : ""}</div>
          </div>
        );
      })}
    </div>
  );
}

function RefundDialog({ source, sourceId, maxCents, label, onClose, onDone }: { source: "booking" | "charging_session"; sourceId: number; maxCents: number; label: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState((maxCents / 100).toFixed(2));
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(null);
    setBusy(true);
    const cents = Math.round(Number(amount) * 100);
    try {
      const r = await apiFetch<{ ok: boolean; error?: string; approvalRequired?: boolean; thresholdCents?: number }>({
        url: `/reports/amenities/refunds`, method: "POST",
        data: { source, sourceId, amountCents: cents, reason, approveAboveThreshold: override },
      });
      if (!r.ok) { setErr(r.error ?? "Refund failed"); return; }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Refund failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-[440px]" onClick={(e) => e.stopPropagation()}>
        <div className="text-[16px] mb-1" style={{ fontWeight: 700 }}>Issue refund</div>
        <div className="text-[13px] mb-4" style={{ color: c.inkMute }}>{label}</div>
        <label className="block text-[12px] mb-1" style={{ color: c.inkSoft, fontWeight: 600 }}>Amount (USD)</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} className="border rounded-md px-2 py-1.5 w-full text-[14px] mb-3" style={{ borderColor: c.border }} />
        <label className="block text-[12px] mb-1" style={{ color: c.inkSoft, fontWeight: 600 }}>Reason (required)</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="border rounded-md px-2 py-1.5 w-full text-[13px] mb-3" style={{ borderColor: c.border }} />
        <label className="flex items-center gap-2 text-[12.5px] mb-3" style={{ color: c.inkSoft }}>
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
          Approve over threshold (admin override)
        </label>
        {err && <div className="text-[12.5px] mb-3" style={{ color: c.rose }}>{err}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-[13px] border" style={{ borderColor: c.border, color: c.inkSoft }}>Cancel</button>
          <button onClick={submit} disabled={busy || !reason.trim()} className="px-3 py-1.5 rounded-md text-[13px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 600, opacity: busy || !reason.trim() ? 0.6 : 1 }}>
            {busy ? "Processing…" : "Issue refund"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ExpenseDialog({ amenities, onClose, onDone }: { amenities: Array<{ id: number; name: string }>; onClose: () => void; onDone: () => void }) {
  const [amenityId, setAmenityId] = useState<number | "">(amenities[0]?.id ?? "");
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [kind, setKind] = useState("maintenance");
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      await apiFetch({
        url: `/reports/amenities/expenses`, method: "POST",
        data: {
          amenityId: Number(amenityId), occurredOn, kind, vendor, description,
          amountCents: Math.round(Number(amount) * 100),
        },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to log expense");
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-[480px]" onClick={(e) => e.stopPropagation()}>
        <div className="text-[16px] mb-4" style={{ fontWeight: 700 }}>Log amenity expense</div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-[12px] mb-1" style={{ color: c.inkSoft, fontWeight: 600 }}>Amenity</label>
            <select value={amenityId} onChange={(e) => setAmenityId(Number(e.target.value))} className="border rounded-md px-2 py-1.5 w-full text-[13px]" style={{ borderColor: c.border }}>
              {amenities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] mb-1" style={{ color: c.inkSoft, fontWeight: 600 }}>Date</label>
            <input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} className="border rounded-md px-2 py-1.5 w-full text-[13px]" style={{ borderColor: c.border }} />
          </div>
          <div>
            <label className="block text-[12px] mb-1" style={{ color: c.inkSoft, fontWeight: 600 }}>Kind</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="border rounded-md px-2 py-1.5 w-full text-[13px]" style={{ borderColor: c.border }}>
              {["cleaning", "lifeguard", "supplies", "maintenance", "utilities", "permits", "other"].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] mb-1" style={{ color: c.inkSoft, fontWeight: 600 }}>Amount (USD)</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="border rounded-md px-2 py-1.5 w-full text-[13px]" style={{ borderColor: c.border }} />
          </div>
        </div>
        <label className="block text-[12px] mb-1" style={{ color: c.inkSoft, fontWeight: 600 }}>Vendor</label>
        <input value={vendor} onChange={(e) => setVendor(e.target.value)} className="border rounded-md px-2 py-1.5 w-full text-[13px] mb-3" style={{ borderColor: c.border }} />
        <label className="block text-[12px] mb-1" style={{ color: c.inkSoft, fontWeight: 600 }}>Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="border rounded-md px-2 py-1.5 w-full text-[13px] mb-3" style={{ borderColor: c.border }} />
        {err && <div className="text-[12.5px] mb-3" style={{ color: c.rose }}>{err}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-[13px] border" style={{ borderColor: c.border, color: c.inkSoft }}>Cancel</button>
          <button onClick={submit} disabled={busy || !amenityId || !amount} className="px-3 py-1.5 rounded-md text-[13px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 600, opacity: busy || !amenityId || !amount ? 0.6 : 1 }}>
            {busy ? "Saving…" : "Save expense"}
          </button>
        </div>
      </div>
    </div>
  );
}
