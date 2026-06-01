import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { Search, Palette, AlertTriangle } from "lucide-react";
import { accFetch, STATUS_META, type AccRequest, type AccStatus } from "@/lib/architectural";
import { InfoPopover } from "@/components/help/InfoPopover";

const FILTERS: Array<{ key: AccStatus | "all" | "open"; label: string }> = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "submitted", label: "Submitted" },
  { key: "in_review", label: "In Review" },
  { key: "more_info_needed", label: "More Info Needed" },
  { key: "approved", label: "Approved" },
  { key: "approved_with_conditions", label: "Approved w/ Conditions" },
  { key: "denied", label: "Denied" },
  { key: "withdrawn", label: "Withdrawn" },
];

const OPEN_STATUSES: AccStatus[] = ["submitted", "in_review", "more_info_needed"];

export default function ArchitecturalRequests() {
  const [items, setItems] = useState<AccRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<AccStatus | "all" | "open">("open");
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    accFetch<AccRequest[]>("/api/architectural-requests")
      .then((r) => { if (alive) setItems(r); })
      .catch(() => { if (alive) setItems([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    return items.filter((r) => {
      if (filter === "open" && !OPEN_STATUSES.includes(r.status)) return false;
      if (filter !== "all" && filter !== "open" && r.status !== filter) return false;
      if (q) {
        const s = q.toLowerCase();
        if (!(
          r.title.toLowerCase().includes(s) ||
          r.ownerName.toLowerCase().includes(s) ||
          r.projectType.toLowerCase().includes(s) ||
          String(r.id).includes(s) ||
          r.unitId.toLowerCase().includes(s)
        )) return false;
      }
      return true;
    });
  }, [items, filter, q]);

  const counts = useMemo(() => ({
    all: items.length,
    open: items.filter((r) => OPEN_STATUSES.includes(r.status)).length,
    flagged: items.filter((r) => r.autoApprovalFlagged && OPEN_STATUSES.includes(r.status)).length,
  }), [items]);

  return (
    <Layout title="Architectural Requests" subtitle="Owner change requests and board review">
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: c.inkMute }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search owner, title, type…"
            className="w-full rounded-md border pl-9 pr-3 py-2 text-[13.5px] outline-none focus:ring-2"
            style={{ borderColor: c.border, background: c.panel, color: c.ink }}
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border p-1 flex-wrap" style={{ borderColor: c.border, background: c.panel }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="rounded px-3 py-1.5 text-[12.5px]"
              style={
                filter === f.key
                  ? { background: c.cobalt, color: "#fff", fontWeight: 600 }
                  : { color: c.inkSoft, fontWeight: 500 }
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {counts.flagged > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border px-3 py-2" style={{ background: "#FEF3E2", borderColor: "#F4C77B", color: "#7A4A0E" }}>
          <AlertTriangle className="h-4 w-4" />
          <span className="text-[12.5px]" style={{ fontWeight: 600 }}>
            {counts.flagged} request{counts.flagged === 1 ? "" : "s"} flagged for review (auto-approval threshold reached).
          </span>
        </div>
      )}

      <section className="rounded-xl border bg-white" style={{ borderColor: c.border }}>
        <div className="grid grid-cols-12 gap-3 px-4 py-2.5 border-b text-[11px] uppercase tracking-wider" style={{ borderColor: c.border, color: c.inkMute, fontWeight: 700 }}>
          <div className="col-span-1 inline-flex items-center gap-0.5">ACC <InfoPopover termKey="acc" label="ACC" /></div>
          <div className="col-span-4 inline-flex items-center gap-0.5">Title <InfoPopover termKey="architectural-request" label="Architectural request" /></div>
          <div className="col-span-2">Owner</div>
          <div className="col-span-1">Bldg/Unit</div>
          <div className="col-span-2">Type</div>
          <div className="col-span-2 text-right">Status / Submitted</div>
        </div>
        {loading ? (
          <div className="px-4 py-8 text-center text-[13px]" style={{ color: c.inkMute }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Palette className="mx-auto h-7 w-7 mb-2" style={{ color: c.inkMute, opacity: 0.4 }} />
            <p className="text-[13px]" style={{ color: c.inkMute }}>No requests match your filters.</p>
          </div>
        ) : (
          filtered.map((r) => {
            const meta = STATUS_META[r.status];
            return (
              <Link
                key={r.id}
                href={`/architectural-requests/${r.id}`}
                className="grid grid-cols-12 gap-3 px-4 py-3 border-b hover:bg-slate-50 transition-colors"
                style={{ borderColor: c.borderSoft }}
              >
                <div className="col-span-1 text-[13px] font-mono-num" style={{ color: c.inkSoft, fontWeight: 600 }}>
                  ACC-{String(r.id).padStart(4, "0")}
                </div>
                <div className="col-span-4">
                  <div className="text-[13.5px]" style={{ color: c.ink, fontWeight: 600 }}>{r.title}</div>
                  {r.autoApprovalFlagged && OPEN_STATUSES.includes(r.status) && (
                    <span className="mt-0.5 inline-flex items-center gap-1 text-[11px]" style={{ color: "#A66C0E", fontWeight: 600 }}>
                      <AlertTriangle className="h-3 w-3" /> Auto-approval threshold reached
                    </span>
                  )}
                </div>
                <div className="col-span-2 text-[12.5px]" style={{ color: c.inkSoft }}>{r.ownerName}</div>
                <div className="col-span-1 text-[12.5px]" style={{ color: c.inkSoft }}>B{r.building} / {r.unitId}</div>
                <div className="col-span-2 text-[12.5px]" style={{ color: c.inkSoft }}>{r.projectType}</div>
                <div className="col-span-2 text-right">
                  <span className="inline-flex text-[11px] px-2 py-0.5 rounded-full" style={{ background: meta.bg, color: meta.fg, fontWeight: 700 }}>
                    {meta.label}
                  </span>
                  <div className="text-[11px] mt-0.5" style={{ color: c.inkMute }}>{r.submittedAt.slice(0, 10)}</div>
                </div>
              </Link>
            );
          })
        )}
      </section>
    </Layout>
  );
}
