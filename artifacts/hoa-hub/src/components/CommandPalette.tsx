import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Search, X, Building2, Home as HomeIcon, ClipboardList, HardHat, Users,
  ArrowRight,
} from "lucide-react";
import { c } from "@/lib/theme";
import {
  useListBuildings, useListUnits, useListWorkOrders, useListVendors, useListUsers,
  getListBuildingsQueryKey, getListUnitsQueryKey, getListWorkOrdersQueryKey,
  getListVendorsQueryKey, getListUsersQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";

export type PaletteNavItem = { label: string; href: string; section?: string };

type Item = {
  id: string;
  label: string;
  sub?: string;
  href: string;
  group: string;
  Icon: React.ElementType;
};

export function CommandPalette({
  open, onClose, navItems,
}: {
  open: boolean;
  onClose: () => void;
  navItems: PaletteNavItem[];
}) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isManager = user?.role === "manager" || user?.role === "admin";

  const { data: buildings = [] } = useListBuildings({
    query: { enabled: open && isManager, queryKey: getListBuildingsQueryKey() },
  });
  const { data: units = [] } = useListUnits(undefined, {
    query: { enabled: open && isManager, queryKey: getListUnitsQueryKey() },
  });
  const { data: vendors = [] } = useListVendors(undefined, {
    query: { enabled: open && isManager, queryKey: getListVendorsQueryKey() },
  });
  const { data: workOrders = [] } = useListWorkOrders(undefined, {
    query: { enabled: open && isManager, queryKey: getListWorkOrdersQueryKey() },
  });
  const { data: usersList = [] } = useListUsers({
    query: { enabled: open && isManager, queryKey: getListUsersQueryKey() },
  });

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [];
    for (const n of navItems) {
      list.push({
        id: `nav-${n.href}-${n.label}`,
        label: n.label,
        sub: n.section,
        href: n.href,
        group: "Navigation",
        Icon: ArrowRight,
      });
    }
    if (isManager) {
      for (const b of buildings) {
        list.push({
          id: `b-${b.num}`,
          label: `Building ${b.num} — ${b.address}`,
          sub: b.street,
          href: `/buildings/${b.num}`,
          group: "Buildings",
          Icon: Building2,
        });
      }
      for (const u of units) {
        list.push({
          id: `u-${u.id}`,
          label: `Unit ${u.unit}`,
          sub: u.address,
          href: `/units/${u.id}`,
          group: "Units",
          Icon: HomeIcon,
        });
      }
      for (const v of vendors) {
        list.push({
          id: `v-${v.id}`,
          label: v.name,
          sub: v.tradeCategory,
          href: `/vendors/${v.id}`,
          group: "Vendors",
          Icon: HardHat,
        });
      }
      for (const r of usersList.filter((u) => u.role === "resident" && u.unitId)) {
        list.push({
          id: `r-${r.id}`,
          label: r.name || r.email,
          sub: r.email,
          href: `/units/${r.unitId}`,
          group: "Residents",
          Icon: Users,
        });
      }
      for (const w of workOrders) {
        list.push({
          id: `w-${w.id}`,
          label: `${w.id} — ${w.title}`,
          sub: w.category,
          href: `/work-orders/${w.id}`,
          group: "Work Orders",
          Icon: ClipboardList,
        });
      }
    }
    return list;
  }, [navItems, buildings, units, vendors, workOrders, usersList, isManager]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items.slice(0, 50);
    return items
      .filter(
        (i) =>
          i.label.toLowerCase().includes(term) ||
          (i.sub ?? "").toLowerCase().includes(term),
      )
      .slice(0, 80);
  }, [items, q]);

  useEffect(() => { setActive(0); }, [q]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const it = filtered[active];
      if (it) {
        onClose();
        navigate(it.href);
      }
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[6vh] sm:pt-[10vh] px-3 sm:px-4 pb-4"
      style={{ background: "rgba(11,16,32,0.55)" }}
      onMouseDown={onClose}
      data-testid="command-palette-overlay"
    >
      <div
        className="w-full max-w-[640px] max-h-[88vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
        style={{ background: "#fff", borderColor: c.border }}
        onMouseDown={(e) => e.stopPropagation()}
        data-testid="command-palette"
      >
        <div className="flex items-center gap-2.5 px-4 border-b" style={{ borderColor: c.border }}>
          <Search className="h-4 w-4" style={{ color: c.inkMute }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search pages, buildings, units, vendors, work orders…"
            className="flex-1 py-3.5 text-[14px] bg-transparent outline-none"
            style={{ color: c.ink, fontWeight: 500 }}
            data-testid="command-palette-input"
          />
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100"
            style={{ color: c.inkMute }}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div ref={listRef} className="flex-1 min-h-0 max-h-[400px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px]" style={{ color: c.inkMute }}>
              No matches
            </div>
          ) : (
            (() => {
              const out: React.ReactNode[] = [];
              let lastGroup = "";
              filtered.forEach((it, idx) => {
                if (it.group !== lastGroup) {
                  out.push(
                    <div
                      key={`g-${it.group}-${idx}`}
                      className="px-4 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wider"
                      style={{ color: c.inkMute }}
                    >
                      {it.group}
                    </div>,
                  );
                  lastGroup = it.group;
                }
                const Icon = it.Icon;
                const isActive = idx === active;
                out.push(
                  <button
                    key={it.id}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => { onClose(); navigate(it.href); }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-left"
                    style={{ background: isActive ? c.cobaltSoft : "transparent" }}
                    data-testid={`palette-item-${it.id}`}
                  >
                    <Icon className="h-4 w-4 shrink-0" style={{ color: isActive ? c.cobalt : c.inkMute }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] truncate" style={{ color: c.ink, fontWeight: 600 }}>
                        {it.label}
                      </div>
                      {it.sub && (
                        <div className="text-[11.5px] truncate" style={{ color: c.inkMute }}>
                          {it.sub}
                        </div>
                      )}
                    </div>
                  </button>,
                );
              });
              return out;
            })()
          )}
        </div>
        <div
          className="border-t px-4 py-2 text-[11px] flex items-center gap-4"
          style={{ borderColor: c.border, color: c.inkMute }}
        >
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
