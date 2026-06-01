// Task #63: Reusable picker for adopted resolutions. Shows a search-as-you-type
// dropdown of adopted resolutions; calls onSelect with the chosen id+number.
//
// Usage:
//   <ResolutionPicker value={id} onChange={setId} placeholder="Link a resolution" />

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { c } from "@/lib/theme";
import { resolutionsApi, type ResolutionListItem } from "@/lib/resolutionsApi";

export function ResolutionPicker({
  value,
  onChange,
  excludeId,
  placeholder = "Search adopted resolutions…",
}: {
  value: number | null;
  onChange: (id: number | null, item: ResolutionListItem | null) => void;
  excludeId?: number;
  placeholder?: string;
}) {
  const [items, setItems] = useState<ResolutionListItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    resolutionsApi.list({ status: "adopted" })
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => i.id !== excludeId)
      .filter((i) => !q || i.title.toLowerCase().includes(q) || (i.number ?? "").toLowerCase().includes(q));
  }, [items, query, excludeId]);

  const selected = items.find((i) => i.id === value) ?? null;

  return (
    <div className="space-y-2">
      {selected && (
        <div
          className="flex items-center justify-between rounded-md border px-3 py-2 text-[13px]"
          style={{ borderColor: c.border, background: "#F8FAFE" }}
        >
          <span>
            <span className="font-mono-num" style={{ fontWeight: 700 }}>
              {selected.number ?? "—"}
            </span>{" "}
            <span style={{ color: c.ink }}>{selected.title}</span>
          </span>
          <button
            type="button"
            onClick={() => onChange(null, null)}
            className="text-[12px]"
            style={{ color: c.cobalt, fontWeight: 600 }}
          >
            Clear
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 rounded-md border px-3 py-2" style={{ borderColor: c.border }}>
        <Search className="h-4 w-4" style={{ color: c.inkMute }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="flex-1 outline-none text-[13px] bg-transparent"
        />
      </div>
      <div className="max-h-56 overflow-y-auto rounded-md border" style={{ borderColor: c.borderSoft }}>
        {loading ? (
          <div className="py-3 text-center text-[12px]" style={{ color: c.inkMute }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-3 text-center text-[12px]" style={{ color: c.inkMute }}>No matches.</div>
        ) : filtered.map((i) => (
          <button
            type="button"
            key={i.id}
            onClick={() => onChange(i.id, i)}
            className="w-full px-3 py-2 text-left text-[13px] hover:bg-slate-50"
          >
            <div className="font-mono-num text-[12px]" style={{ fontWeight: 700, color: c.cobalt }}>
              {i.number ?? `#${i.id}`}
            </div>
            <div className="truncate">{i.title}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
