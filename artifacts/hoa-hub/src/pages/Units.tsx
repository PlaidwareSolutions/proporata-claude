import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { Search, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { useListUnits, useListBuildings } from "@workspace/api-client-react";

const occColor = {
  owner: { bg: "#E5E8FF", fg: "#3245FF" },
  tenant: { bg: "#FBEFD6", fg: "#A66C0E" },
  vacant: { bg: "#EFF1F8", fg: "#5A6285" },
};

type SortKey = "id" | "address" | "ownerName" | "beds" | "baths" | "sqft" | "occupancy";
type SortDir = "asc" | "desc";

const COLUMNS: Array<{ key: SortKey | null; label: string; numeric?: boolean }> = [
  { key: "id", label: "Unit", numeric: true },
  { key: "address", label: "Address" },
  { key: "ownerName", label: "Owner" },
  { key: "beds", label: "Beds", numeric: true },
  { key: "baths", label: "Baths", numeric: true },
  { key: "sqft", label: "SqFt", numeric: true },
  { key: "occupancy", label: "Occupancy" },
  { key: null, label: "" },
];

export default function Units() {
  const [q, setQ] = useState("");
  const [occ, setOcc] = useState<"all" | "owner" | "tenant" | "vacant">("all");
  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const { data: units = [], isLoading } = useListUnits();
  const { data: buildings = [] } = useListBuildings();

  const onSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    const list = units.filter((u) => {
      if (occ !== "all" && u.occupancy !== occ) return false;
      if (q) {
        const s = q.toLowerCase();
        return (
          u.address.toLowerCase().includes(s) ||
          (u.ownerName ?? "").toLowerCase().includes(s) ||
          u.id.toLowerCase().includes(s)
        );
      }
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    const sorted = [...list].sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * dir;
    });
    return sorted;
  }, [q, occ, units, sortKey, sortDir]);

  return (
    <Layout title="Units" subtitle={`${units.length} units across ${buildings.length} buildings`}>
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: c.inkMute }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search address or owner…"
            data-testid="input-units-search"
            className="w-full rounded-md border pl-9 pr-3 py-2 text-[13.5px] outline-none focus:ring-2"
            style={{ borderColor: c.border, background: c.panel, color: c.ink }}
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border p-1" style={{ borderColor: c.border, background: c.panel }}>
          {(["all", "owner", "tenant", "vacant"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setOcc(f)}
              data-testid={`occ-${f}`}
              className="rounded px-3 py-1.5 text-[12.5px] capitalize"
              style={
                occ === f
                  ? { background: c.cobalt, color: "#fff", fontWeight: 600 }
                  : { color: c.inkSoft, fontWeight: 500 }
              }
            >
              {f}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[12.5px] font-mono-num" style={{ color: c.inkMute, fontWeight: 600 }}>
          {filtered.length} shown
        </span>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
        {isLoading ? (
          <div className="py-16 text-center text-[13px]" style={{ color: c.inkMute }}>Loading units…</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead style={{ background: c.canvas }}>
              <tr style={{ color: c.inkMute }} className="text-left text-[11px] uppercase tracking-wider">
                {COLUMNS.map((col, i) => {
                  if (!col.key) {
                    return <th key={`empty-${i}`} className="px-4 py-3" style={{ fontWeight: 700 }}>{col.label}</th>;
                  }
                  const active = sortKey === col.key;
                  const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                  return (
                    <th key={col.key} className="px-4 py-3" style={{ fontWeight: 700 }}>
                      <button
                        type="button"
                        onClick={() => onSort(col.key as SortKey)}
                        data-testid={`sort-${col.key}`}
                        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                        className="inline-flex items-center gap-1 uppercase tracking-wider hover:opacity-80"
                        style={{ color: active ? c.cobalt : c.inkMute, fontWeight: 700, fontSize: "11px" }}
                      >
                        {col.label}
                        <Icon className="h-3 w-3" style={{ opacity: active ? 1 : 0.5 }} />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const oc = occColor[u.occupancy];
                return (
                  <tr key={u.id} className="border-t hover:bg-slate-50" style={{ borderColor: c.borderSoft }}>
                    <td className="px-4 py-2.5 font-mono-num" style={{ fontWeight: 700 }}>{u.id}</td>
                    <td className="px-4 py-2.5" style={{ color: c.inkSoft, fontWeight: 500 }}>{u.address}</td>
                    <td className="px-4 py-2.5" style={{ color: c.ink, fontWeight: 600 }}>{u.ownerName}</td>
                    <td className="px-4 py-2.5 font-mono-num" style={{ color: c.inkSoft }}>{u.beds}</td>
                    <td className="px-4 py-2.5 font-mono-num" style={{ color: c.inkSoft }}>{u.baths}</td>
                    <td className="px-4 py-2.5 font-mono-num" style={{ color: c.inkSoft }}>{u.sqft.toLocaleString()}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-full px-2 py-0.5 text-[11px] capitalize" style={{ background: oc.bg, color: oc.fg, fontWeight: 700 }}>
                        {u.occupancy}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/units/${u.id}`}
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
