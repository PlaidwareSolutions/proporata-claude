import { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { c } from "@/lib/theme";
import type { Vendor } from "@workspace/api-client-react";

const tradeBadgeColors: Record<string, { bg: string; fg: string }> = {
  Plumbing:    { bg: "#E0F2FE", fg: "#0369A1" },
  Roof:        { bg: "#FEF3C7", fg: "#92400E" },
  Electrical:  { bg: "#FEF9C3", fg: "#713F12" },
  Structural:  { bg: "#FCE7F3", fg: "#9D174D" },
  Exterior:    { bg: "#ECFDF5", fg: "#065F46" },
  Landscaping: { bg: "#D1FAE5", fg: "#047857" },
  HVAC:        { bg: "#EDE9FE", fg: "#5B21B6" },
  General:     { bg: "#F3F4F6", fg: "#374151" },
  Other:       { bg: "#F3F4F6", fg: "#374151" },
};

type Props = {
  vendors: Vendor[];
  value: number | null;
  onChange: (vendorId: number | null) => void;
  preferredCategory?: string;
};

export function VendorCombobox({ vendors, value, onChange, preferredCategory }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = vendors.find((v) => v.id === value) ?? null;
  const inactiveCount = vendors.filter((v) => v.status !== "active").length;

  const filtered = vendors
    .filter((v) => showInactive || v.status === "active" || v.id === value)
    .filter((v) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        v.name.toLowerCase().includes(q) ||
        v.tradeCategory.toLowerCase().includes(q) ||
        v.contactName.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (preferredCategory) {
        const aMatch = a.tradeCategory === preferredCategory ? -1 : 0;
        const bMatch = b.tradeCategory === preferredCategory ? -1 : 0;
        if (aMatch !== bMatch) return aMatch - bMatch;
      }
      return a.name.localeCompare(b.name);
    });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(vendor: Vendor | null) {
    onChange(vendor?.id ?? null);
    setOpen(false);
    setQuery("");
  }

  function handleOpen() {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const tc = selected ? (tradeBadgeColors[selected.tradeCategory] ?? tradeBadgeColors.Other!) : null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        className="w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300 text-left"
        style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
      >
        {selected ? (
          <span className="flex items-center gap-2 min-w-0">
            {tc && (
              <span
                className="rounded px-1.5 py-0.5 text-[11px] shrink-0"
                style={{ background: tc.bg, color: tc.fg, fontWeight: 700 }}
              >
                {selected.tradeCategory}
              </span>
            )}
            <span className="truncate" style={{ fontWeight: 600 }}>{selected.name}</span>
            {selected.status !== "active" && (
              <span
                className="rounded px-1.5 py-0.5 text-[11px] shrink-0"
                style={{ background: "#FBE3E9", color: "#B8264C", fontWeight: 700 }}
              >
                Inactive
              </span>
            )}
          </span>
        ) : (
          <span style={{ color: c.inkMute }}>Unassigned</span>
        )}
        <span className="flex items-center gap-1 shrink-0 ml-2">
          {selected && (
            <span
              onClick={(e) => { e.stopPropagation(); handleSelect(null); }}
              className="rounded-full p-0.5 hover:bg-slate-200 cursor-pointer"
              style={{ color: c.inkMute }}
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className="h-4 w-4" style={{ color: c.inkMute }} />
        </span>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full rounded-lg border shadow-lg overflow-hidden"
          style={{ background: c.panel, borderColor: c.border }}
        >
          <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: c.borderSoft }}>
            <Search className="h-3.5 w-3.5 shrink-0" style={{ color: c.inkMute }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search vendors…"
              className="flex-1 bg-transparent text-[13px] outline-none"
              style={{ color: c.ink }}
            />
          </div>
          {inactiveCount > 0 && (
            <div
              className="flex items-center justify-between border-b px-3 py-1.5"
              style={{ borderColor: c.borderSoft, background: c.canvas }}
            >
              <span className="text-[11px]" style={{ color: c.inkMute }}>
                {inactiveCount} inactive vendor{inactiveCount === 1 ? "" : "s"} {showInactive ? "shown" : "hidden"}
              </span>
              <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px]" style={{ color: c.inkSoft, fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="h-3 w-3"
                />
                Show inactive
              </label>
            </div>
          )}
          <div className="max-h-56 overflow-y-auto">
            <button
              type="button"
              onClick={() => handleSelect(null)}
              className="w-full text-left px-3 py-2.5 text-[13px] hover:bg-slate-50 transition-colors"
              style={{ color: c.inkMute }}
            >
              Unassigned
            </button>
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-[13px] text-center" style={{ color: c.inkMute }}>
                No vendors found
              </div>
            )}
            {(() => {
              const matching = preferredCategory
                ? filtered.filter((v) => v.tradeCategory === preferredCategory)
                : [];
              const others = preferredCategory
                ? filtered.filter((v) => v.tradeCategory !== preferredCategory)
                : filtered;
              const showGroups = !!preferredCategory && matching.length > 0;

              const renderRow = (v: Vendor, dim: boolean) => {
                const vtc = tradeBadgeColors[v.tradeCategory] ?? tradeBadgeColors.Other!;
                const isMatch = preferredCategory && v.tradeCategory === preferredCategory;
                const isInactive = v.status !== "active";
                const effectiveDim = dim || isInactive;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => handleSelect(v)}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 transition-colors"
                    style={
                      value === v.id
                        ? { background: "#EEF2FF", opacity: 1 }
                        : { opacity: effectiveDim ? 0.6 : 1 }
                    }
                  >
                    <span
                      className="rounded px-1.5 py-0.5 text-[11px] shrink-0"
                      style={{ background: vtc.bg, color: vtc.fg, fontWeight: 700 }}
                    >
                      {v.tradeCategory}
                    </span>
                    <span className="flex-1 truncate">
                      <span
                        className="text-[13px]"
                        style={{
                          fontWeight: effectiveDim ? 500 : 600,
                          color: effectiveDim ? c.inkSoft : c.ink,
                          textDecoration: isInactive ? "line-through" : "none",
                        }}
                      >
                        {v.name}
                      </span>
                      <span className="text-[12px] ml-1.5" style={{ color: c.inkMute }}>{v.contactName}</span>
                    </span>
                    {isInactive && (
                      <span
                        className="rounded px-1.5 py-0.5 text-[11px] shrink-0"
                        style={{ background: "#FBE3E9", color: "#B8264C", fontWeight: 700 }}
                      >
                        Inactive
                      </span>
                    )}
                    {isMatch && !isInactive && (
                      <span className="text-[11px] shrink-0" style={{ color: c.cobalt, fontWeight: 600 }}>
                        Suggested
                      </span>
                    )}
                  </button>
                );
              };

              if (!showGroups) {
                return others.map((v) => renderRow(v, false));
              }
              return (
                <>
                  <div
                    className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider"
                    style={{ color: c.inkMute, fontWeight: 700 }}
                  >
                    Matching trade — {preferredCategory}
                  </div>
                  {matching.map((v) => renderRow(v, false))}
                  {others.length > 0 && (
                    <>
                      <div
                        className="mt-1 border-t px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider"
                        style={{ color: c.inkMute, fontWeight: 700, borderColor: c.borderSoft }}
                      >
                        Other vendors
                      </div>
                      {others.map((v) => renderRow(v, true))}
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
