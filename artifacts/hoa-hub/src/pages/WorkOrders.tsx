import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { Search, Plus } from "lucide-react";
import type { WOStatus } from "@/lib/data";
import { useListWorkOrders, useListBuildings } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";

const statusColors: Record<WOStatus, { bg: string; fg: string; label: string }> = {
  open:         { bg: "#FBE3E9", fg: "#B8264C", label: "Open" },
  scheduled:    { bg: "#FBEFD6", fg: "#A66C0E", label: "Scheduled" },
  in_progress:  { bg: "#E5E8FF", fg: "#3245FF", label: "In Progress" },
  done:         { bg: "#DCF3EC", fg: "#0E8A6B", label: "Done" },
};

const priColors = {
  urgent: { bg: "#FBE3E9", fg: "#B8264C" },
  high:   { bg: "#FBEFD6", fg: "#A66C0E" },
  med:    { bg: "#E5E8FF", fg: "#3245FF" },
  low:    { bg: "#EFF1F8", fg: "#5A6285" },
};

export default function WorkOrders() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<WOStatus | "all">("all");
  const { data: workOrders = [], isLoading } = useListWorkOrders();
  const { data: buildings = [] } = useListBuildings();
  const { user } = useAuth();
  const isManager = user?.role === "admin" || user?.role === "manager";

  const filtered = useMemo(() => {
    return workOrders.filter((w) => {
      if (status !== "all" && w.status !== status) return false;
      if (q) {
        const s = q.toLowerCase();
        return (
          w.title.toLowerCase().includes(s) ||
          w.id.toLowerCase().includes(s) ||
          w.category.toLowerCase().includes(s) ||
          (w.vendor || "").toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [q, status, workOrders]);

  const counts = useMemo(() => ({
    all: workOrders.length,
    open: workOrders.filter(w => w.status === "open").length,
    scheduled: workOrders.filter(w => w.status === "scheduled").length,
    in_progress: workOrders.filter(w => w.status === "in_progress").length,
    done: workOrders.filter(w => w.status === "done").length,
  }), [workOrders]);

  return (
    <Layout
      title="Work Orders"
      subtitle="All maintenance and repair tickets"
      actions={
        isManager ? (
          <Link
            href="/work-orders/new"
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] hover:opacity-90"
            style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
            data-testid="button-new-wo"
          >
            <Plus className="h-4 w-4" /> New Work Order
          </Link>
        ) : null
      }
    >
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: c.inkMute }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search WO, title, vendor…"
            data-testid="input-wo-search"
            className="w-full rounded-md border pl-9 pr-3 py-2 text-[13.5px] outline-none focus:ring-2"
            style={{ borderColor: c.border, background: c.panel, color: c.ink }}
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border p-1" style={{ borderColor: c.border, background: c.panel }}>
          {(["all", "open", "scheduled", "in_progress", "done"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatus(f)}
              data-testid={`status-${f}`}
              className="rounded px-3 py-1.5 text-[12.5px]"
              style={
                status === f
                  ? { background: c.cobalt, color: "#fff", fontWeight: 600 }
                  : { color: c.inkSoft, fontWeight: 500 }
              }
            >
              {f === "all" ? "All" : statusColors[f].label}
              <span className="ml-1.5 font-mono-num text-[11px] opacity-70">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
        {isLoading ? (
          <div className="py-16 text-center text-[13px]" style={{ color: c.inkMute }}>Loading work orders…</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead style={{ background: c.canvas }}>
              <tr style={{ color: c.inkMute }} className="text-left text-[11px] uppercase tracking-wider">
                {["WO #", "Bldg", "Title", "Category", "Vendor", "Opened", "Due", "Est $", "Priority", "Status", ""].map((h) => (
                  <th key={h} className="px-4 py-3" style={{ fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => {
                const b = buildings.find((bb) => bb.num === w.building);
                const sc = statusColors[w.status as WOStatus];
                const pc = priColors[w.priority as keyof typeof priColors];
                return (
                  <tr key={w.id} className="border-t hover:bg-slate-50" style={{ borderColor: c.borderSoft }} data-testid={`row-wo-${w.id}`}>
                    <td className="px-4 py-2.5 font-mono-num" style={{ fontWeight: 700, color: c.cobalt }}>{w.id}</td>
                    <td className="px-4 py-2.5 font-mono-num" style={{ fontWeight: 700 }}>
                      {String(w.building).padStart(2,"0")}{w.unit ? `·${w.unit.split("-")[1] ?? w.unit}` : ""}
                    </td>
                    <td className="px-4 py-2.5 max-w-md">
                      <div className="truncate" style={{ color: c.ink, fontWeight: 600 }}>{w.title}</div>
                      {b && <div className="text-[11.5px] truncate" style={{ color: c.inkMute, fontWeight: 500 }}>{b.address}</div>}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: c.inkSoft }}>{w.category}</td>
                    <td className="px-4 py-2.5" style={{ color: c.inkSoft }}>{w.vendor || <span style={{ color: c.inkMute }}>—</span>}</td>
                    <td className="px-4 py-2.5 font-mono-num" style={{ color: c.inkSoft }}>{w.opened}</td>
                    <td className="px-4 py-2.5 font-mono-num" style={{ color: c.inkSoft }}>{w.due || <span style={{ color: c.inkMute }}>—</span>}</td>
                    <td className="px-4 py-2.5 font-mono-num text-right" style={{ color: c.ink, fontWeight: 600 }}>
                      ${w.estCost.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded px-1.5 py-0.5 text-[11px] font-mono-num" style={{ background: pc.bg, color: pc.fg, fontWeight: 700 }}>
                        {w.priority.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: sc.bg, color: sc.fg, fontWeight: 700 }}>
                        {sc.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/work-orders/${w.id}`}
                        className="rounded px-2 py-1 text-[12px] hover:opacity-80 transition-opacity"
                        style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 600 }}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
