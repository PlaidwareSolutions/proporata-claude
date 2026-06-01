import { useState, useMemo } from "react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { useGetSpendReport } from "@workspace/api-client-react";

type Preset = "6m" | "12m" | "ytd" | "custom";

const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function getPresetRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);

  if (preset === "6m") {
    const from = new Date(now);
    from.setMonth(from.getMonth() - 6);
    return { from: from.toISOString().slice(0, 10), to };
  }
  if (preset === "12m") {
    const from = new Date(now);
    from.setFullYear(from.getFullYear() - 1);
    return { from: from.toISOString().slice(0, 10), to };
  }
  if (preset === "ytd") {
    return { from: `${now.getFullYear()}-01-01`, to };
  }
  return { from: "", to: "" };
}

function csvEscape(value: string | number): string {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function fmtMonth(ym: string) {
  const [year, month] = ym.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleString("default", { month: "short", year: "2-digit" });
}

function monthLabel(yyyyMm: string): string {
  const [year, mm] = yyyyMm.split("-");
  const abbr = MONTH_LABELS[parseInt(mm, 10) - 1] ?? mm;
  return `${abbr} ${year}`;
}

export default function Reports() {
  const [preset, setPreset] = useState<Preset>("12m");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const range = useMemo(() => {
    if (preset === "custom") return { from: customFrom || undefined, to: customTo || undefined };
    const { from, to } = getPresetRange(preset);
    return { from, to };
  }, [preset, customFrom, customTo]);

  const { data, isLoading } = useGetSpendReport(
    { from: range.from, to: range.to },
    { query: { staleTime: 30_000 } as never }
  );

  const spend = data?.totalSpend ?? 0;
  const totalOrders = data?.totalOrders ?? 0;
  const monthlySpend = data?.monthlySpend ?? [];
  const monthlyVolume = data?.monthlyVolume ?? [];
  const spendByBuilding = data?.spendByBuilding ?? [];
  const spendByCategory = data?.spendByCategory ?? [];
  const budgetByCategory = data?.budgetByCategory ?? [];
  const budgetFiscalYear = data?.budgetFiscalYear;
  const spendByCategoryInBudgetYear = data?.spendByCategoryInBudgetYear ?? [];

  const budgetByCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of budgetByCategory) m[b.category] = b.amount;
    return m;
  }, [budgetByCategory]);

  const fyTotalByCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of spendByCategoryInBudgetYear) m[c.category] = c.total;
    return m;
  }, [spendByCategoryInBudgetYear]);

  // Detect whether the report range fits inside the single budget fiscal
  // year. When it doesn't, the user-range spend bar isn't directly
  // comparable to the annual budget, so we suppress the user-range
  // "% of budget" callout and rely on the FY-scoped figure instead.
  const rangeMatchesBudgetYear = useMemo(() => {
    if (budgetFiscalYear === undefined) return false;
    const fromYear = range.from ? Number(range.from.slice(0, 4)) : undefined;
    const toYear = range.to ? Number(range.to.slice(0, 4)) : undefined;
    if (fromYear !== undefined && fromYear !== budgetFiscalYear) return false;
    if (toYear !== undefined && toYear !== budgetFiscalYear) return false;
    return true;
  }, [budgetFiscalYear, range.from, range.to]);

  // Include both spent categories and budgeted-only categories so the board
  // can see categories where they planned to spend but haven't yet.
  // `total` is for the user's selected range; `fyTotal` is fiscal-year scoped
  // and is what we compare against the annual budget.
  const categoryRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: { category: string; total: number; budget: number; fyTotal: number }[] = [];
    for (const c of spendByCategory) {
      seen.add(c.category);
      rows.push({
        category: c.category,
        total: c.total,
        budget: budgetByCat[c.category] ?? 0,
        fyTotal: fyTotalByCat[c.category] ?? 0,
      });
    }
    for (const b of budgetByCategory) {
      if (!seen.has(b.category)) {
        rows.push({
          category: b.category,
          total: 0,
          budget: b.amount,
          fyTotal: fyTotalByCat[b.category] ?? 0,
        });
      }
    }
    return rows.sort((a, b) => b.total - a.total);
  }, [spendByCategory, budgetByCategory, budgetByCat, fyTotalByCat]);

  const maxMonthSpend = Math.max(...monthlySpend.map((m) => m.total), 1);
  const maxMonthVolume = Math.max(...monthlyVolume.map((m) => m.count), 1);
  const maxBuildingSpend = Math.max(...spendByBuilding.map((b) => b.total), 1);
  const maxCatSpend = Math.max(
    ...categoryRows.map((c) => Math.max(c.total, c.budget)),
    1,
  );

  const presets: { key: Preset; label: string }[] = [
    { key: "6m", label: "Last 6 months" },
    { key: "12m", label: "Last 12 months" },
    { key: "ytd", label: "This Year" },
    { key: "custom", label: "Custom" },
  ];

  const rangeLabel = `${range.from || "all"}_to_${range.to || "now"}`;

  const handleExportCsv = () => {
    const rows: (string | number)[][] = [];
    rows.push(["HOA Operations Hub — Spend Report"]);
    rows.push(["Date range", range.from || "(all)", range.to || "(now)"]);
    rows.push(["Total spend", spend]);
    rows.push(["Total work orders", totalOrders]);
    rows.push([]);

    rows.push(["Monthly spend"]);
    rows.push(["Month", "Total spend"]);
    monthlySpend.forEach((m) => rows.push([m.month, m.total]));
    rows.push([]);

    rows.push(["Monthly work order volume"]);
    rows.push(["Month", "Work orders opened"]);
    monthlyVolume.forEach((m) => rows.push([m.month, m.count]));
    rows.push([]);

    rows.push(["Spend by category"]);
    rows.push(["Category", "Total spend"]);
    spendByCategory.forEach((row) => rows.push([row.category, row.total]));
    rows.push([]);

    rows.push(["Spend by building"]);
    rows.push(["Building #", "Address", "Total spend"]);
    spendByBuilding.forEach((b) => rows.push([b.building, b.address, b.total]));

    downloadCsv(`spend-report_${rangeLabel}.csv`, rows);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <Layout title="Reports" subtitle="Spend, trends, and per-building breakdown">
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {presets.map((p) => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className="px-3 py-1.5 rounded-lg text-[13px] font-semibold border transition-colors"
            style={{
              background: preset === p.key ? c.cobalt : "white",
              color: preset === p.key ? "white" : c.inkSoft,
              borderColor: preset === p.key ? c.cobalt : c.border,
            }}
          >
            {p.label}
          </button>
        ))}
        {preset === "custom" && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="border rounded-lg px-2 py-1 text-[13px]"
              style={{ borderColor: c.border, color: c.ink }}
            />
            <span className="text-[13px]" style={{ color: c.inkMute }}>to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="border rounded-lg px-2 py-1 text-[13px]"
              style={{ borderColor: c.border, color: c.ink }}
            />
          </div>
        )}
        {isLoading && (
          <span className="text-[12px] ml-2" style={{ color: c.inkMute }}>Loading…</span>
        )}
        <div className="ml-auto flex items-center gap-2 no-print">
          <button
            onClick={handleExportCsv}
            disabled={isLoading || !data}
            className="px-3 py-1.5 rounded-lg text-[13px] font-semibold border transition-colors disabled:opacity-50"
            style={{ background: "white", color: c.inkSoft, borderColor: c.border }}
          >
            Export CSV
          </button>
          <button
            onClick={handlePrint}
            disabled={isLoading || !data}
            className="px-3 py-1.5 rounded-lg text-[13px] font-semibold border transition-colors disabled:opacity-50"
            style={{ background: c.cobalt, color: "white", borderColor: c.cobalt }}
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
          <div className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: c.inkSoft }}>Total spend</div>
          <div className="font-mono-num mt-2 text-[28px]" style={{ color: c.cobalt, fontWeight: 700, letterSpacing: "-0.02em" }}>
            ${spend.toLocaleString()}
          </div>
          <div className="text-[12px] mt-1" style={{ color: c.inkMute, fontWeight: 500 }}>across {totalOrders} work orders</div>
        </div>
        <div className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
          <div className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: c.inkSoft }}>Avg per WO</div>
          <div className="font-mono-num mt-2 text-[28px]" style={{ color: c.ink, fontWeight: 700, letterSpacing: "-0.02em" }}>
            ${totalOrders ? Math.round(spend / totalOrders).toLocaleString() : "—"}
          </div>
          <div className="text-[12px] mt-1" style={{ color: c.inkMute, fontWeight: 500 }}>est. cost</div>
        </div>
        <div className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
          <div className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: c.inkSoft }}>Work orders</div>
          <div className="font-mono-num mt-2 text-[28px]" style={{ color: c.ink, fontWeight: 700, letterSpacing: "-0.02em" }}>
            {totalOrders.toLocaleString()}
          </div>
          <div className="text-[12px] mt-1" style={{ color: c.inkMute, fontWeight: 500 }}>in selected range</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5 mb-5">
        <section className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-[15px]" style={{ fontWeight: 700 }}>Spend by category</h3>
            {budgetFiscalYear !== undefined && (
              <span className="text-[11px]" style={{ color: c.inkMute, fontWeight: 600 }}>
                vs FY{budgetFiscalYear} budget
              </span>
            )}
          </div>
          {categoryRows.length === 0 ? (
            <div className="text-[13px]" style={{ color: c.inkMute }}>No data for this range</div>
          ) : (
            <div className="space-y-3">
              {categoryRows.map(({ category, total, budget, fyTotal }) => {
                // Overspend is determined against the full budget fiscal year
                // total — not the user-selected range — so a 12-month range
                // that crosses years can't produce a misleading "over" flag.
                const overBudget = budget > 0 && fyTotal > budget;
                const barColor = overBudget ? "#dc2626" : c.cobalt;
                const spentPct = (total / maxCatSpend) * 100;
                const budgetPct = budget > 0 ? (budget / maxCatSpend) * 100 : null;
                const pctOfBudget = budget > 0 ? Math.round((fyTotal / budget) * 100) : null;
                return (
                  <div key={category}>
                    <div className="flex items-center justify-between text-[13px] mb-1">
                      <span style={{ color: overBudget ? "#dc2626" : c.inkSoft, fontWeight: overBudget ? 700 : 500 }}>
                        {category}
                        {overBudget && (
                          <span className="ml-1.5 text-[10px] uppercase tracking-wider" style={{ color: "#dc2626", fontWeight: 700 }}>
                            over
                          </span>
                        )}
                      </span>
                      <span className="font-mono-num" style={{ fontWeight: 700, color: overBudget ? "#dc2626" : c.ink }}>
                        ${total.toLocaleString()}
                        {budget > 0 && (
                          <span style={{ color: c.inkMute, fontWeight: 500 }}> / ${budget.toLocaleString()}</span>
                        )}
                      </span>
                    </div>
                    <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: c.borderSoft }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.min(spentPct, 100)}%`, background: barColor }}
                      />
                      {budgetPct !== null && (
                        <div
                          className="absolute top-[-2px] bottom-[-2px] w-px"
                          style={{
                            left: `${Math.min(budgetPct, 100)}%`,
                            background: c.ink,
                            opacity: 0.55,
                          }}
                          aria-label={`Budget target for ${category}`}
                          title={`Budget: $${budget.toLocaleString()}`}
                        />
                      )}
                    </div>
                    {pctOfBudget !== null && (
                      <div className="text-[10px] mt-1" style={{ color: overBudget ? "#dc2626" : c.inkMute, fontWeight: 600 }}>
                        {pctOfBudget}% of FY{budgetFiscalYear} budget
                        {!rangeMatchesBudgetYear && (
                          <span style={{ color: c.inkMute, fontWeight: 500 }}>
                            {" "}(${fyTotal.toLocaleString()} spent in FY{budgetFiscalYear})
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="flex items-center gap-3 pt-2 text-[10px]" style={{ color: c.inkMute, fontWeight: 600 }}>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-3 rounded-sm" style={{ background: c.cobalt }} />
                  Spent (selected range)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-px" style={{ background: c.ink, opacity: 0.55 }} />
                  Budget target
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-3 rounded-sm" style={{ background: "#dc2626" }} />
                  Over FY budget
                </span>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
          <h3 className="text-[15px] mb-4" style={{ fontWeight: 700 }}>Monthly spend trend</h3>
          {monthlySpend.length === 0 ? (
            <div className="text-[13px]" style={{ color: c.inkMute }}>No data for this range</div>
          ) : (
            <div className="flex items-end justify-between gap-1" style={{ height: 192 }}>
              {monthlySpend.map((m) => {
                const h = Math.round((m.total / maxMonthSpend) * 140);
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center justify-end gap-2">
                    <div className="font-mono-num text-[10px]" style={{ color: c.inkMute, fontWeight: 600 }}>
                      ${(m.total / 1000).toFixed(1)}k
                    </div>
                    <div className="w-full rounded-t-md" style={{ background: c.cobalt, height: h, minHeight: 4 }} />
                    <div className="text-[10px]" style={{ color: c.inkSoft, fontWeight: 600 }}>{fmtMonth(m.month)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-xl border bg-white p-5 mb-5" style={{ borderColor: c.border }}>
        <h3 className="text-[15px] mb-4" style={{ fontWeight: 700 }}>Work orders opened per month</h3>
        {monthlyVolume.length === 0 ? (
          <div className="text-[13px]" style={{ color: c.inkMute }}>No data for this range</div>
        ) : (
          <div className="relative" style={{ height: 120 }}>
            <svg width="100%" height="100%" viewBox={`0 0 ${Math.max(monthlyVolume.length * 60, 400)} 100`} preserveAspectRatio="none">
              {monthlyVolume.map((m, i) => {
                const x = (i / (monthlyVolume.length - 1 || 1)) * (Math.max(monthlyVolume.length * 60, 400) - 20) + 10;
                const y = 90 - Math.round((m.count / maxMonthVolume) * 80);
                return (
                  <g key={m.month}>
                    {i > 0 && (() => {
                      const prev = monthlyVolume[i - 1];
                      const prevX = ((i - 1) / (monthlyVolume.length - 1 || 1)) * (Math.max(monthlyVolume.length * 60, 400) - 20) + 10;
                      const prevY = 90 - Math.round((prev.count / maxMonthVolume) * 80);
                      return <line x1={prevX} y1={prevY} x2={x} y2={y} stroke={c.cobalt} strokeWidth="2" />;
                    })()}
                    <circle cx={x} cy={y} r="4" fill={c.cobalt} />
                  </g>
                );
              })}
            </svg>
            <div className="flex justify-between mt-1 px-1">
              {monthlyVolume.map((m) => (
                <div key={m.month} className="flex flex-col items-center" style={{ minWidth: 0 }}>
                  <div className="font-mono-num text-[10px]" style={{ color: c.ink, fontWeight: 700 }}>{m.count}</div>
                  <div className="text-[10px]" style={{ color: c.inkMute, fontWeight: 500 }}>{fmtMonth(m.month)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
        <h3 className="text-[15px] mb-4" style={{ fontWeight: 700 }}>Top 10 buildings by spend</h3>
        {spendByBuilding.length === 0 ? (
          <div className="text-[13px]" style={{ color: c.inkMute }}>No data for this range</div>
        ) : (
          <div className="space-y-2.5">
            {spendByBuilding.map(({ building, address, total }) => (
              <div key={building} className="flex items-center gap-3">
                <div className="font-mono-num text-[12px] w-12 text-right" style={{ color: c.inkMute, fontWeight: 700 }}>
                  #{String(building).padStart(2, "0")}
                </div>
                <div className="text-[13px] w-44 truncate" style={{ color: c.inkSoft, fontWeight: 500 }}>{address}</div>
                <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: c.borderSoft }}>
                  <div className="h-full rounded-full" style={{ width: `${(total / maxBuildingSpend) * 100}%`, background: c.cobalt }} />
                </div>
                <div className="font-mono-num text-[13px] w-16 text-right" style={{ fontWeight: 700 }}>${total.toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </Layout>
  );
}
