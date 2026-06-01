// Role visibility rules for the app shell:
//   - admin / manager:    all manager nav sections (Overview, Property,
//                         Operations, Governance, Financials, Community,
//                         Library, Workspace [admin-only]).
//   - resident (tenant):  Home, My Place, Community, Requests.
//   - resident (owner):   Home, My Place (incl. My Account), Community,
//                         Requests.
//   - resident (board):   adds Governance section (Motions, Resolutions,
//                         Board) on top of the resident sections.
// Each item declares a `roles` predicate; the section is hidden when its
// items list is empty for the current role.
import { Link, useLocation } from "wouter";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  LayoutDashboard, Building2, Home, ClipboardList, FileText, ShieldCheck,
  BarChart3, Settings, Search, Bell, Map, Zap, Command as CmdIcon, House, LogOut,
  UserCircle, MessageSquare, Check, CheckCheck, AlertTriangle, RefreshCcw,
  HardHat, Palette, Wallet, Gavel, CreditCard, Vote, Scroll, CalendarDays,
  Calendar, Plus, Car, Package as PackageIcon, ChevronDown, ChevronRight as ChevR,
  Menu, X as XIcon, HelpCircle, BookOpen, Megaphone,
} from "lucide-react";
import { HelpPanel } from "@/components/help/HelpPanel";
import { OnboardingTour } from "@/components/help/OnboardingTour";
import { c } from "@/lib/theme";
import {
  useListWorkOrders, useListInsurance, useListBuildings, useGetSettings,
  useListNotifications, useMarkNotificationRead, useMarkAllNotificationsRead,
  useGetMyAccount, getGetMyAccountQueryKey,
  useGetUnit, getGetUnitQueryKey,
} from "@workspace/api-client-react";
import { getListNotificationsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { useMapLayers, type MapLayers } from "@/contexts/MapLayersContext";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { motionsApi } from "@/lib/motionsApi";
import { CommandPalette, type PaletteNavItem } from "@/components/CommandPalette";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AppFooter } from "@/components/AppFooter";

const fontStyle = `
@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
.font-tight { font-family: 'Inter Tight', system-ui, sans-serif; letter-spacing: -0.01em; }
.font-mono-num { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.tabular { font-variant-numeric: tabular-nums; }
@keyframes pulseRing { 0% { transform: scale(1); opacity: .55; } 70% { transform: scale(2.2); opacity: 0; } 100% { opacity: 0; } }
.pulse-ring { animation: pulseRing 1.8s ease-out infinite; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: #D5D9E8; border-radius: 6px; }
::-webkit-scrollbar-thumb:hover { background: #B8BED4; }
::-webkit-scrollbar-track { background: transparent; }
body { background: ${c.canvas}; }
`;

type LayoutProps = {
  title: string;
  subtitle?: string;
  liveTag?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
};

type NavItem = { icon: React.ElementType; label: string; href: string; badge?: number; testId?: string; matchExact?: boolean };
type NavSection = { label: string; items: NavItem[] };

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function notifIcon(type: string) {
  if (type === "wo_urgent" || type === "wo_high") return <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />;
  if (type === "insurance_expiring") return <ShieldCheck className="h-3.5 w-3.5 text-red-500" />;
  if (type === "glossary_suggestion") return <BookOpen className="h-3.5 w-3.5" style={{ color: c.cobalt }} />;
  return <Bell className="h-3.5 w-3.5" style={{ color: c.cobalt }} />;
}

function notifHref(n: { type: string; entityType?: string | null; entityId?: string | null }): string | null {
  if (n.type === "glossary_suggestion" || n.entityType === "glossary_suggestion") return "/help?tab=suggestions";
  if (n.entityType === "work_order" && n.entityId) return `/work-orders/${n.entityId}`;
  if (n.entityType === "announcement") return "/announcements";
  return null;
}

function sectionSlug(label: string): string {
  return label.toLowerCase().replace(/\s+/g, "-");
}

function itemTestId(item: NavItem): string {
  return item.testId ?? `nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`;
}

export function Layout({ title, subtitle, liveTag, actions, children }: LayoutProps) {
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const isResident = user?.role === "resident";
  const { data: myAccount } = useGetMyAccount({
    query: {
      queryKey: getGetMyAccountQueryKey(),
      enabled: isResident && !!user?.unitId,
      retry: false,
      refetchOnWindowFocus: false,
    },
  });
  const isOwner = !!myAccount && myAccount.occupancy === "owner";
  const residentUnitId = isResident && user?.unitId ? user.unitId : "";
  const { data: residentUnit } = useGetUnit(residentUnitId || "-", {
    query: {
      queryKey: getGetUnitQueryKey(residentUnitId || "-"),
      enabled: !!residentUnitId,
      retry: false,
      refetchOnWindowFocus: false,
    },
  });

  const { layers, setLayer } = useMapLayers();
  const layerItems: Array<{ key: keyof MapLayers; label: string }> = [
    { key: "buildings", label: "Buildings" },
    { key: "openWO", label: "Open work orders" },
    { key: "insuranceGaps", label: "Insurance gaps" },
    { key: "roofStatus", label: "Roof status" },
  ];
  const showLayersPanel = !isResident && location === "/site-map";
  const [bellOpen, setBellOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const quickCreateRef = useRef<HTMLDivElement>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Which top-nav dropdown is currently open (by section label). Only one
  // dropdown is open at a time.
  const [openSection, setOpenSection] = useState<string | null>(null);
  const navBarRef = useRef<HTMLDivElement>(null);
  const sectionTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const dropdownPanelRef = useRef<HTMLDivElement | null>(null);
  // After opening a dropdown via keyboard, focus the first or last item once
  // the panel renders.
  const pendingDropdownFocus = useRef<"first" | "last" | null>(null);

  // Close drawer when route changes.
  useEffect(() => {
    setMobileNavOpen(false);
    setOpenSection(null);
  }, [location]);

  // Lock body scroll when mobile drawer is open.
  useEffect(() => {
    if (mobileNavOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
    return undefined;
  }, [mobileNavOpen]);

  // Cmd/Ctrl+K opens the command palette globally.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const { data: workOrders = [] } = useListWorkOrders();
  const { data: insurance = [] } = useListInsurance();
  const { data: buildings = [] } = useListBuildings();
  const { data: orgSettings } = useGetSettings();
  const { data: notifications = [] } = useListNotifications({
    query: { queryKey: getListNotificationsQueryKey(), refetchInterval: 30000 },
  });
  const canSeeMotions = !isResident || !!user?.boardMember;
  const { data: openMotions = [] } = useQuery({
    queryKey: ["motions-list", "open"],
    queryFn: () => motionsApi.list("open"),
    enabled: canSeeMotions && !!user,
    refetchInterval: 60000,
  });
  const motionsAwaitingMyVote = user?.boardMember
    ? openMotions.filter((m) => !m.myVote).length
    : 0;

  const markReadMutation = useMarkNotificationRead();
  const markAllReadMutation = useMarkAllNotificationsRead();

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
      if (quickCreateRef.current && !quickCreateRef.current.contains(e.target as Node)) {
        setQuickCreateOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
      if (navBarRef.current && !navBarRef.current.contains(e.target as Node)) {
        setOpenSection(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // After a dropdown opens via keyboard (ArrowDown/ArrowUp on a trigger, or
  // Left/Right while another dropdown was open), move focus into the panel.
  useEffect(() => {
    if (!openSection) return;
    const which = pendingDropdownFocus.current;
    if (!which) return;
    pendingDropdownFocus.current = null;
    // Defer one frame so the panel is mounted in the DOM.
    const id = requestAnimationFrame(() => {
      const items = dropdownPanelRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]',
      );
      if (!items || items.length === 0) return;
      const target = which === "last" ? items[items.length - 1] : items[0];
      target.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [openSection]);

  // Escape closes any open dropdown / drawer and returns focus to trigger.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (openSection) {
        const trig = sectionTriggerRefs.current[openSection];
        setOpenSection(null);
        trig?.focus();
        e.stopPropagation();
        return;
      }
      if (bellOpen) { setBellOpen(false); return; }
      if (quickCreateOpen) { setQuickCreateOpen(false); return; }
      if (userMenuOpen) { setUserMenuOpen(false); return; }
      if (mobileNavOpen) { setMobileNavOpen(false); return; }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openSection, bellOpen, quickCreateOpen, userMenuOpen, mobileNavOpen]);

  async function handleMarkRead(id: number) {
    await markReadMutation.mutateAsync({ id });
    queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
  }

  async function handleMarkAllRead() {
    await markAllReadMutation.mutateAsync();
    queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
  }

  const openWO = workOrders.filter((w) => w.status !== "done").length;
  const insuranceGaps = insurance.filter((i) => i.status !== "current").length;
  const totalUnits = buildings.reduce((s, b) => s + b.units, 0);
  const totalBuildings = buildings.length;

  const orgName = orgSettings?.name ?? "Quail Valley HOA";
  const isAdmin = user?.role === "admin";
  const isManager = user?.role === "admin" || user?.role === "manager";

  const canCreateMeetingsResolutions = isManager || (isResident && !!user?.boardMember);
  const canCreateArchRequestAsResident = isResident && !!user?.unitId;
  const quickCreateItems: Array<{ label: string; href: string; icon: typeof Plus; testId: string }> = [
    ...(isManager
      ? [{ label: "New Work Order", href: "/work-orders/new", icon: ClipboardList, testId: "quick-create-work-order" }]
      : []),
    ...(canCreateMeetingsResolutions
      ? [
          { label: "New Meeting", href: "/meetings?new=1", icon: Calendar, testId: "quick-create-meeting" },
          { label: "New Resolution", href: "/resolutions?new=1", icon: Scroll, testId: "quick-create-resolution" },
        ]
      : []),
    ...(canCreateArchRequestAsResident
      ? [{ label: "New Architectural Request", href: "/portal/architectural?new=1", icon: Palette, testId: "quick-create-architectural" }]
      : []),
  ];

  // ----- Build role-aware nav sections -----
  const navSections: NavSection[] = useMemo(() => {
    if (isResident) {
      const sections: NavSection[] = [
        {
          label: "Home",
          items: [
            // Labeled "Dashboard" so the existing data-testid="nav-dashboard"
            // remains stable for residents.
            { icon: House, label: "Dashboard", href: "/" },
            { icon: CalendarDays, label: "Calendar", href: "/calendar" },
          ],
        },
        {
          label: "My Place",
          items: [
            { icon: UserCircle, label: "My Profile", href: "/profile" },
            ...(isOwner ? [{ icon: Wallet, label: "My Account", href: "/portal/account" }] : []),
            { icon: Home, label: "My Pets", href: "/portal/pets" },
            { icon: PackageIcon, label: "My Mail", href: "/portal/mail" },
            { icon: Car, label: "Guest Parking", href: "/portal/parking" },
            { icon: Zap, label: "EV Charging", href: "/portal/ev-charging" },
          ],
        },
        {
          label: "Community",
          items: [
            { icon: Building2, label: "Amenities", href: "/portal/amenities" },
            { icon: FileText, label: "Documents", href: "/portal/documents" },
            { icon: Palette, label: "Architectural", href: "/portal/architectural" },
          ],
        },
        ...(user?.boardMember
          ? [
              {
                label: "Governance",
                items: [
                  { icon: Vote, label: "Board", href: "/portal/board" },
                  { icon: Scroll, label: "Resolutions", href: "/portal/resolutions" },
                  { icon: Gavel, label: "Motions", href: "/motions", badge: motionsAwaitingMyVote },
                  { icon: Wallet, label: "Budgets", href: "/budgets" },
                ] as NavItem[],
              },
            ]
          : []),
        {
          label: "Requests",
          items: [
            // Anchors to the requests card on the home dashboard. Test id
            // preserved from the prior IA.
            {
              icon: ClipboardList,
              label: "My Requests",
              href: "/#my-requests",
              testId: "nav-my-requests",
              matchExact: true,
            },
          ],
        },
      ];
      return sections;
    }
    // Manager / admin
    return [
      {
        label: "Overview",
        items: [
          { icon: House, label: "Home", href: "/" },
          { icon: LayoutDashboard, label: "Dashboard", href: "/overview" },
          { icon: Map, label: "Site Map", href: "/site-map" },
        ],
      },
      {
        label: "Property",
        items: [
          { icon: Building2, label: "Buildings", href: "/buildings" },
          { icon: Home, label: "Units", href: "/units" },
          { icon: UserCircle, label: "Members", href: "/members" },
        ],
      },
      {
        label: "Operations",
        items: [
          { icon: ClipboardList, label: "Work Orders", href: "/work-orders", badge: openWO },
          { icon: ClipboardList, label: "Inspections & Compliance", href: "/operations" },
          { icon: HardHat, label: "Vendors", href: "/vendors" },
          { icon: Gavel, label: "Bids", href: "/bids" },
          { icon: Palette, label: "Architectural", href: "/architectural-requests" },
          { icon: MessageSquare, label: "Communications", href: "/communications" },
          { icon: Megaphone, label: "Announcements", href: "/announcements" },
        ],
      },
      {
        label: "Governance",
        items: [
          { icon: Gavel, label: "Motions", href: "/motions", badge: motionsAwaitingMyVote },
          { icon: Scroll, label: "Resolutions", href: "/resolutions" },
          { icon: Calendar, label: "Meetings", href: "/meetings" },
          { icon: CalendarDays, label: "Calendar", href: "/calendar" },
          { icon: Vote, label: "Board", href: "/boards" },
        ],
      },
      {
        label: "Financials",
        items: [
          { icon: Wallet, label: "Billing", href: "/billing" },
          { icon: CreditCard, label: "Payments", href: "/billing/payments" },
          { icon: CalendarDays, label: "Financial Calendar", href: "/financials" },
          { icon: ShieldCheck, label: "Compliance", href: "/compliance" },
          { icon: ShieldCheck, label: "Insurance", href: "/insurance", badge: insuranceGaps },
          { icon: BarChart3, label: "Reports", href: "/reports" },
          { icon: BarChart3, label: "Amenity Financials", href: "/reports/amenities" },
          { icon: Wallet, label: "Budgets", href: "/budgets" },
        ],
      },
      {
        label: "Community",
        items: [
          { icon: Building2, label: "Amenities", href: "/amenities" },
          { icon: PackageIcon, label: "Mail Room", href: "/mail-room" },
          { icon: Home, label: "Pets", href: "/pets" },
          { icon: Zap, label: "EV Charging", href: "/ev-charging" },
          { icon: Car, label: "Guest Parking", href: "/parking" },
          { icon: Building2, label: "Fobs", href: "/fobs" },
          { icon: Building2, label: "Pool Tags", href: "/pool-tags" },
          { icon: ShieldCheck, label: "Patrol", href: "/patrol" },
        ],
      },
      {
        label: "Library",
        items: [{ icon: FileText, label: "Documents", href: "/documents" }],
      },
      ...(isAdmin
        ? [{ label: "Workspace", items: [{ icon: Settings, label: "Settings", href: "/settings" }] as NavItem[] }]
        : []),
    ];
  }, [isResident, isOwner, isManager, isAdmin, user?.boardMember, openWO, insuranceGaps, motionsAwaitingMyVote]);

  // Compute the single best-matching nav href for the current location, so that
  // only one item highlights even when one href is a prefix of another (e.g.
  // `/reports` vs `/reports/amenities`). Longest match wins.
  const activeHref = useMemo(() => {
    const candidates: string[] = [];
    for (const s of navSections) {
      for (const it of s.items) {
        if (it.href.includes("#")) continue; // anchors never light up
        if (it.href === "/") {
          if (location === "/") candidates.push("/");
          continue;
        }
        if (location === it.href || location.startsWith(it.href + "/")) {
          candidates.push(it.href);
        }
      }
    }
    if (candidates.length === 0) return null;
    return candidates.reduce((a, b) => (b.length > a.length ? b : a));
  }, [navSections, location]);

  const isActive = useCallback((href: string) => href === activeHref, [activeHref]);
  const sectionHasActive = useCallback(
    (s: NavSection) => s.items.some((it) => isActive(it.href)),
    [isActive],
  );
  const sectionBadgeTotal = useCallback(
    (s: NavSection) => s.items.reduce((sum, it) => sum + (it.badge ?? 0), 0),
    [],
  );

  // Mobile-drawer collapsible section state, persisted per user.
  const collapseKey = user ? `sidebar-collapse-${user.id}` : "sidebar-collapse-anon";
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem(collapseKey);
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  function toggleSection(label: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      try { localStorage.setItem(collapseKey, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // Build nav items list for the command palette.
  const paletteNavItems: PaletteNavItem[] = useMemo(() => {
    const items: PaletteNavItem[] = [];
    for (const s of navSections) {
      for (const it of s.items) {
        items.push({ label: it.label, href: it.href, section: s.label });
      }
    }
    return items;
  }, [navSections]);

  const roleLabel = user?.role === "admin" ? "Admin" : user?.role === "manager" ? "Manager" : "Resident";
  const roleColor = user?.role === "admin" ? c.cobalt : user?.role === "manager" ? "#0E8A6B" : "#7B3FE4";
  const roleBg = user?.role === "admin" ? c.cobaltSoft : user?.role === "manager" ? "#DCF3EC" : "#F3EEFF";

  // Ordered labels of multi-item sections (the ones with a real dropdown
  // trigger button). Used for Left/Right arrow navigation across triggers.
  const multiSectionLabels = useMemo(
    () => navSections.filter((s) => s.items.length > 1).map((s) => s.label),
    [navSections],
  );

  function moveTriggerFocus(currentLabel: string, dir: 1 | -1) {
    if (multiSectionLabels.length === 0) return;
    const idx = multiSectionLabels.indexOf(currentLabel);
    if (idx === -1) return;
    const nextLabel =
      multiSectionLabels[
        (idx + dir + multiSectionLabels.length) % multiSectionLabels.length
      ];
    const wasOpen = openSection !== null;
    if (wasOpen) {
      // Open the next section's dropdown and focus its first item.
      pendingDropdownFocus.current = "first";
      setOpenSection(nextLabel);
    } else {
      sectionTriggerRefs.current[nextLabel]?.focus();
    }
  }

  function focusDropdownItem(which: "first" | "last") {
    const items = dropdownPanelRef.current?.querySelectorAll<HTMLElement>(
      '[role="menuitem"]',
    );
    if (!items || items.length === 0) return;
    const target = which === "last" ? items[items.length - 1] : items[0];
    target.focus();
  }

  function handleTriggerKeyDown(
    e: React.KeyboardEvent<HTMLButtonElement>,
    label: string,
  ) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (openSection === label) {
          // Dropdown is already open — focus first item directly since the
          // open-state effect won't fire.
          focusDropdownItem("first");
        } else {
          pendingDropdownFocus.current = "first";
          setOpenSection(label);
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (openSection === label) {
          focusDropdownItem("last");
        } else {
          pendingDropdownFocus.current = "last";
          setOpenSection(label);
        }
        break;
      case "ArrowRight":
        e.preventDefault();
        moveTriggerFocus(label, 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        moveTriggerFocus(label, -1);
        break;
      default:
        break;
    }
  }

  function handleDropdownKeyDown(
    e: React.KeyboardEvent<HTMLDivElement>,
    label: string,
  ) {
    const items = Array.from(
      dropdownPanelRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]',
      ) ?? [],
    );
    if (items.length === 0) return;
    const currentIdx = items.findIndex((el) => el === document.activeElement);
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const next = currentIdx === -1 ? 0 : (currentIdx + 1) % items.length;
        items[next].focus();
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const prev =
          currentIdx === -1
            ? items.length - 1
            : (currentIdx - 1 + items.length) % items.length;
        items[prev].focus();
        break;
      }
      case "Home":
        e.preventDefault();
        items[0].focus();
        break;
      case "End":
        e.preventDefault();
        items[items.length - 1].focus();
        break;
      case "ArrowRight":
        e.preventDefault();
        moveTriggerFocus(label, 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        moveTriggerFocus(label, -1);
        break;
      default:
        break;
    }
  }

  // ----- Render helpers -----
  function renderDropdownPanel(s: NavSection) {
    return (
      <div
        ref={dropdownPanelRef}
        onKeyDown={(e) => handleDropdownKeyDown(e, s.label)}
        className="absolute left-0 top-full mt-1 min-w-[240px] rounded-xl border shadow-xl overflow-hidden"
        style={{ background: "#fff", borderColor: c.border, zIndex: 50 }}
        role="menu"
        aria-label={s.label}
        data-testid={`nav-section-panel-${sectionSlug(s.label)}`}
      >
        <div className="py-1">
          {s.items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.label}
                href={item.href}
                role="menuitem"
                onClick={() => setOpenSection(null)}
                data-testid={itemTestId(item)}
                className="flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-slate-50"
                style={active ? { background: c.cobaltSoft } : undefined}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    className="h-4 w-4 shrink-0"
                    strokeWidth={active ? 2.25 : 1.85}
                    style={{ color: active ? c.cobalt : c.inkSoft }}
                  />
                  <span
                    className="text-[13.5px] truncate"
                    style={{ color: active ? c.cobalt : c.ink, fontWeight: active ? 700 : 500 }}
                  >
                    {item.label}
                  </span>
                </span>
                {typeof item.badge === "number" && item.badge > 0 ? (
                  <span
                    className="font-mono-num rounded px-1.5 py-0.5 text-[11px]"
                    style={{ background: c.cobalt, color: "#fff", fontWeight: 700 }}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  function renderTopNavSection(s: NavSection) {
    if (s.items.length === 0) return null;
    const slug = sectionSlug(s.label);
    const sectionActive = sectionHasActive(s);
    const badge = sectionBadgeTotal(s);

    // Single-item section → render as a direct top-level link. We wrap the
    // link so both the legacy section trigger test id and the item's own
    // test id stay attached to real interactive elements.
    if (s.items.length === 1) {
      const only = s.items[0];
      const Icon = only.icon;
      return (
        <div key={s.label} data-testid={`nav-section-${slug}`}>
          <Link
            href={only.href}
            data-testid={itemTestId(only)}
            aria-current={sectionActive ? "page" : undefined}
            className="relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors hover:bg-slate-100"
            style={{
              color: sectionActive ? c.cobalt : c.inkSoft,
              background: sectionActive ? c.cobaltSoft : undefined,
              fontWeight: sectionActive ? 700 : 600,
            }}
          >
            <Icon className="h-4 w-4" strokeWidth={sectionActive ? 2.25 : 1.85} />
            <span>{s.label}</span>
            {badge > 0 && (
              <span
                className="font-mono-num ml-1 rounded px-1.5 py-0.5 text-[10.5px]"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 700 }}
              >
                {badge}
              </span>
            )}
          </Link>
        </div>
      );
    }

    const isOpen = openSection === s.label;
    return (
      <div key={s.label} className="relative">
        <button
          ref={(el) => { sectionTriggerRefs.current[s.label] = el; }}
          onClick={() => setOpenSection((cur) => (cur === s.label ? null : s.label))}
          onKeyDown={(e) => handleTriggerKeyDown(e, s.label)}
          data-testid={`nav-section-${slug}`}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-current={sectionActive ? "page" : undefined}
          className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors hover:bg-slate-100"
          style={{
            color: sectionActive ? c.cobalt : c.inkSoft,
            background: sectionActive ? c.cobaltSoft : undefined,
            fontWeight: sectionActive ? 700 : 600,
          }}
        >
          <span>{s.label}</span>
          {badge > 0 && (
            <span
              className="font-mono-num ml-1 rounded px-1.5 py-0.5 text-[10.5px]"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 700 }}
            >
              {badge}
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 ml-0.5" />
        </button>
        {isOpen && renderDropdownPanel(s)}
      </div>
    );
  }

  return (
    <>
      <style>{fontStyle}</style>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} navItems={paletteNavItems} />
      <div className="font-tight min-h-screen flex flex-col" style={{ background: c.canvas, color: c.ink }}>
        {/* ---------- Top navigation bar ---------- */}
        <header
          className="sticky top-0 z-30 border-b backdrop-blur"
          style={{ background: "rgba(255,255,255,0.92)", borderColor: c.border }}
          data-testid="app-topbar"
        >
          <div className="px-3 sm:px-4 lg:px-6">
            <div className="flex items-center gap-2 py-2">
              {/* Hamburger (mobile) */}
              <button
                onClick={() => setMobileNavOpen(true)}
                className="lg:hidden flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors hover:bg-slate-100"
                style={{ borderColor: c.border, background: c.panel, color: c.inkSoft }}
                aria-label="Open navigation"
                aria-controls="mobile-nav-drawer"
                aria-expanded={mobileNavOpen}
                data-testid="sidebar-open"
              >
                <Menu className="h-4 w-4" />
              </button>

              {/* Logo + org */}
              <Link
                href="/"
                className="flex items-center gap-2 shrink-0 pr-2 hover:opacity-90 transition-opacity"
                aria-label={`${orgName} home`}
              >
                <img src="/favicon-color.png" alt="" className="h-8 w-8 object-contain" />
                <div className="hidden sm:block leading-tight">
                  <div className="text-[14px]" style={{ color: c.ink, fontWeight: 700 }}>{orgName}</div>
                  {isResident ? (
                    <div className="text-[10.5px]" style={{ color: c.inkMute, fontWeight: 500 }}>Resident Portal</div>
                  ) : (
                    <div className="font-mono-num text-[10.5px]" style={{ color: c.inkMute, fontWeight: 500 }}>
                      {totalUnits}u · {totalBuildings}b
                    </div>
                  )}
                </div>
              </Link>

              {/* Inline section nav (desktop) */}
              <nav
                ref={navBarRef}
                className="hidden lg:flex flex-wrap items-center gap-1 px-2 min-w-0 flex-1"
                aria-label="Primary"
              >
                {navSections.map(renderTopNavSection)}
              </nav>

              {/* Spacer for mobile so right cluster sticks to the right */}
              <div className="flex-1 lg:hidden" />

              {/* Right cluster */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setPaletteOpen(true)}
                  className="hidden sm:flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors hover:bg-slate-100"
                  style={{ borderColor: c.border, background: c.panel }}
                  data-testid="sidebar-search-trigger"
                  aria-label="Open command palette"
                >
                  <Search className="h-4 w-4" style={{ color: c.inkMute }} />
                  <span className="text-[12.5px]" style={{ color: c.inkMute, fontWeight: 500 }}>Search…</span>
                  <span className="ml-1 inline-flex items-center gap-0.5">
                    <CmdIcon className="h-3 w-3" style={{ color: c.inkMute }} />
                    <span className="font-mono-num text-[11px]" style={{ color: c.inkMute, fontWeight: 600 }}>K</span>
                  </span>
                </button>
                <button
                  onClick={() => setPaletteOpen(true)}
                  className="sm:hidden flex h-9 w-9 items-center justify-center rounded-full border transition-colors hover:bg-slate-100"
                  style={{ borderColor: c.border, background: c.panel, color: c.inkSoft }}
                  aria-label="Open command palette"
                  data-testid="sidebar-search-trigger-mobile"
                >
                  <Search className="h-4 w-4" />
                </button>

                {quickCreateItems.length > 0 && (
                  <div ref={quickCreateRef} className="relative">
                    <button
                      onClick={() => setQuickCreateOpen((v) => !v)}
                      className="flex h-9 w-9 items-center justify-center rounded-full border transition-colors hover:bg-slate-100"
                      style={{ borderColor: c.border, background: c.panel, color: c.inkSoft }}
                      aria-label="Quick create"
                      aria-haspopup="menu"
                      aria-expanded={quickCreateOpen}
                      data-testid="button-quick-create"
                    >
                      <Plus className="h-4 w-4" />
                    </button>

                    {quickCreateOpen && (
                      <div
                        className="absolute right-0 top-full mt-2 w-[260px] max-w-[calc(100vw-2rem)] rounded-xl border shadow-xl overflow-hidden"
                        style={{ background: "#fff", borderColor: c.border, zIndex: 50 }}
                        data-testid="quick-create-menu"
                        role="menu"
                      >
                        <div
                          className="px-4 py-2.5 border-b text-[11px] font-semibold uppercase tracking-wider"
                          style={{ borderColor: c.border, color: c.inkMute }}
                        >
                          Quick create
                        </div>
                        <div className="py-1">
                          {quickCreateItems.map((item) => {
                            const Icon = item.icon;
                            return (
                              <Link
                                key={item.label}
                                href={item.href}
                                onClick={() => setQuickCreateOpen(false)}
                                data-testid={item.testId}
                                role="menuitem"
                                className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-slate-50"
                                style={{ color: c.ink }}
                              >
                                <span
                                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                                  style={{ background: c.cobaltSoft, color: c.cobalt }}
                                >
                                  <Icon className="h-3.5 w-3.5" />
                                </span>
                                <span className="text-[13.5px]" style={{ fontWeight: 500 }}>
                                  {item.label}
                                </span>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={() => setHelpOpen(true)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border transition-colors hover:bg-slate-100"
                  style={{ borderColor: c.border, background: c.panel, color: c.inkSoft }}
                  aria-label="Help"
                  data-testid="help-panel-trigger"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>

                <div ref={bellRef} className="relative">
                  <button
                    onClick={() => setBellOpen((v) => !v)}
                    className="relative flex h-9 w-9 items-center justify-center rounded-full border transition-colors hover:bg-slate-100"
                    style={{ borderColor: c.border, background: c.panel, color: c.inkSoft }}
                    aria-label="Notifications"
                    aria-haspopup="menu"
                    aria-expanded={bellOpen}
                  >
                    <Bell className="h-4 w-4" />
                    {unreadCount > 0 && (
                      <span
                        className="absolute -top-1 -right-1 flex h-4.5 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px]"
                        style={{ background: "#E53E3E", color: "#fff", fontWeight: 700, lineHeight: 1, padding: "2px 5px" }}
                      >
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </button>

                  {bellOpen && (
                    <div
                      className="absolute right-0 top-full mt-2 w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border shadow-xl overflow-hidden"
                      style={{ background: "#fff", borderColor: c.border, zIndex: 50 }}
                      role="menu"
                    >
                      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: c.border }}>
                        <div className="flex items-center gap-2">
                          <Bell className="h-4 w-4" style={{ color: c.inkMute }} />
                          <span className="text-[14px]" style={{ fontWeight: 700, color: c.ink }}>Notifications</span>
                          {unreadCount > 0 && (
                            <span
                              className="font-mono-num rounded px-1.5 py-0.5 text-[10px]"
                              style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}
                            >
                              {unreadCount} new
                            </span>
                          )}
                        </div>
                        {unreadCount > 0 && (
                          <button
                            onClick={handleMarkAllRead}
                            className="flex items-center gap-1 text-[11.5px] hover:opacity-70 transition-opacity"
                            style={{ color: c.cobalt, fontWeight: 600 }}
                          >
                            <CheckCheck className="h-3.5 w-3.5" />
                            Mark all read
                          </button>
                        )}
                      </div>

                      <div className="max-h-[380px] overflow-y-auto divide-y" style={{ borderColor: c.borderSoft }}>
                        {notifications.length === 0 ? (
                          <div className="py-10 text-center">
                            <Bell className="mx-auto h-6 w-6 mb-2" style={{ color: c.inkMute, opacity: 0.4 }} />
                            <p className="text-[12.5px]" style={{ color: c.inkMute }}>No notifications yet</p>
                          </div>
                        ) : (
                          notifications.slice(0, 20).map((n) => {
                            const href = notifHref(n);
                            return (
                              <div
                                key={n.id}
                                onClick={() => {
                                  if (href) {
                                    if (!n.read) handleMarkRead(n.id);
                                    setBellOpen(false);
                                    setLocation(href);
                                  }
                                }}
                                className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50 ${href ? "cursor-pointer" : ""}`}
                                style={{ background: n.read ? "transparent" : "rgba(50,69,255,0.03)" }}
                                data-testid={`notification-${n.id}`}
                              >
                                <div
                                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                                  style={{ background: n.read ? c.canvas : c.cobaltSoft }}
                                >
                                  {notifIcon(n.type)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[12.5px] leading-snug" style={{ color: c.ink, fontWeight: n.read ? 400 : 600 }}>
                                    {n.message}
                                  </p>
                                  <p className="text-[11px] mt-0.5" style={{ color: c.inkMute }}>
                                    {timeAgo(n.createdAt)}
                                  </p>
                                </div>
                                {!n.read && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleMarkRead(n.id); }}
                                    className="shrink-0 p-1 rounded hover:bg-slate-100 transition-colors"
                                    style={{ color: c.inkMute }}
                                    title="Mark as read"
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>

                      {notifications.length > 0 && (
                        <div
                          className="border-t px-4 py-2.5 flex items-center justify-center gap-1.5 text-[12px]"
                          style={{ borderColor: c.border, color: c.inkMute }}
                        >
                          <RefreshCcw className="h-3 w-3" />
                          <span>Refreshes every 30s</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* User chip */}
                {user && (
                  <div ref={userMenuRef} className="relative">
                    <button
                      onClick={() => setUserMenuOpen((v) => !v)}
                      className="flex items-center gap-1.5 rounded-full border pl-1 pr-1.5 py-1 transition-colors hover:bg-slate-100"
                      style={{ borderColor: c.border, background: c.panel }}
                      aria-haspopup="menu"
                      aria-expanded={userMenuOpen}
                      aria-label="User menu"
                      data-testid="user-menu-trigger"
                    >
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px]"
                        style={{ background: roleBg, color: roleColor, fontWeight: 700 }}
                      >
                        {user.name ? user.name.charAt(0).toUpperCase() : <UserCircle className="h-4 w-4" />}
                      </span>
                      <span
                        className="hidden md:inline text-[10.5px] px-1.5 py-0.5 rounded-full"
                        style={{ background: roleBg, color: roleColor, fontWeight: 700 }}
                      >
                        {roleLabel}
                      </span>
                    </button>
                    {userMenuOpen && (
                      <div
                        className="absolute right-0 top-full mt-2 w-[240px] rounded-xl border shadow-xl overflow-hidden"
                        style={{ background: "#fff", borderColor: c.border, zIndex: 50 }}
                        role="menu"
                      >
                        <div className="px-3 py-3 border-b" style={{ borderColor: c.border }}>
                          <div className="text-[13px] truncate" style={{ color: c.ink, fontWeight: 700 }}>
                            {user.name || user.email}
                          </div>
                          <div className="text-[11.5px] truncate mt-0.5" style={{ color: c.inkMute }}>
                            {user.email}
                          </div>
                          {isResident && residentUnit && (
                            <div
                              className="text-[11px] truncate mt-1"
                              style={{ color: c.inkMute, fontWeight: 500 }}
                              data-testid="sidebar-user-unit"
                              title={`Unit ${residentUnit.unit} · ${residentUnit.address}`}
                            >
                              Unit {residentUnit.unit} · {residentUnit.address}
                            </div>
                          )}
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full inline-block mt-1.5"
                            style={{ background: roleBg, color: roleColor, fontWeight: 700 }}
                          >
                            {roleLabel}
                          </span>
                        </div>
                        <button
                          onClick={() => { setUserMenuOpen(false); logout(); }}
                          role="menuitem"
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] transition-colors hover:bg-slate-50"
                          style={{ color: c.ink }}
                          data-testid="user-menu-logout"
                        >
                          <LogOut className="h-4 w-4" style={{ color: c.inkMute }} />
                          Sign out
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* ---------- Mobile drawer ---------- */}
        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-40 lg:hidden"
            style={{ background: "rgba(11,16,32,0.55)" }}
            onClick={() => setMobileNavOpen(false)}
            data-testid="sidebar-overlay"
            aria-hidden="true"
          />
        )}
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex h-screen w-[280px] max-w-[85vw] shrink-0 flex-col transform transition-transform duration-200 lg:hidden ${mobileNavOpen ? "translate-x-0" : "-translate-x-full"}`}
          style={{ background: c.sidebar, color: c.sidebarText }}
          data-testid="app-sidebar"
          id="mobile-nav-drawer"
          aria-hidden={!mobileNavOpen ? true : undefined}
          // @ts-expect-error - inert is a valid HTML attribute supported by React 19 / modern browsers
          inert={!mobileNavOpen ? "" : undefined}
        >
          <button
            onClick={() => setMobileNavOpen(false)}
            className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/10 transition-colors"
            style={{ color: c.sidebarText }}
            aria-label="Close navigation"
            data-testid="sidebar-close"
          >
            <XIcon className="h-4 w-4" />
          </button>
          <div className="px-4 pt-5 pb-4">
            <div className="flex items-center gap-2.5">
              <img src="/favicon-color.png" alt="Quail Valley logo" className="h-9 w-9 object-contain" />
              <div>
                <div className="text-[15px] text-white" style={{ fontWeight: 600 }}>{orgName}</div>
                {!isResident ? (
                  <div className="font-mono-num text-[12px]" style={{ color: c.sidebarMute, fontWeight: 500 }}>
                    {totalUnits}u · {totalBuildings}b
                  </div>
                ) : (
                  <div className="text-[12px]" style={{ color: c.sidebarMute, fontWeight: 500 }}>Resident Portal</div>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={() => { setMobileNavOpen(false); setPaletteOpen(true); }}
            className="mx-4 mb-4 flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06]"
            style={{ borderColor: "#1A2140", background: "rgba(255,255,255,0.04)" }}
            aria-label="Open command palette"
          >
            <Search className="h-4 w-4" style={{ color: c.sidebarText }} />
            <span className="text-[13px]" style={{ color: c.sidebarText }}>Search…</span>
            <span className="ml-auto inline-flex items-center gap-0.5">
              <CmdIcon className="h-3 w-3" style={{ color: c.sidebarMute }} />
              <span className="font-mono-num text-[11px]" style={{ color: c.sidebarMute, fontWeight: 600 }}>K</span>
            </span>
          </button>

          <nav className="flex-1 space-y-1 px-2.5 overflow-y-auto" aria-label="Mobile primary">
            {/* Only mount drawer items when open, so legacy `nav-*` test ids
                don't collide with the desktop top-nav (which renders items
                inside dropdown panels on demand). */}
            {mobileNavOpen && navSections.map((s) => {
              if (s.items.length === 0) return null;
              const hasActive = s.items.some((it) => isActive(it.href));
              const isCollapsed = !!collapsed[s.label] && !hasActive;
              return (
                <div key={s.label}>
                  <button
                    onClick={() => toggleSection(s.label)}
                    className="w-full flex items-center justify-between px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider hover:text-white/90 transition-colors"
                    style={{ color: "#7B83A6" }}
                    data-testid={`nav-section-${sectionSlug(s.label)}`}
                    aria-expanded={!isCollapsed}
                  >
                    <span>{s.label}</span>
                    {isCollapsed ? <ChevR className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                  {!isCollapsed && s.items.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.label}
                        href={item.href}
                        data-testid={itemTestId(item)}
                        className="mb-0.5 flex w-full items-center justify-between rounded-md px-2 py-2 transition-colors hover:bg-white/5"
                        style={
                          active
                            ? { background: "rgba(50,69,255,0.20)", color: "#fff" }
                            : { color: c.sidebarText }
                        }
                      >
                        <span className="flex items-center gap-2.5">
                          <Icon className="h-4 w-4" strokeWidth={active ? 2.25 : 1.85} />
                          <span className="text-[14px]" style={{ fontWeight: active ? 600 : 500 }}>
                            {item.label}
                          </span>
                        </span>
                        {typeof item.badge === "number" && item.badge > 0 ? (
                          <span
                            className="font-mono-num rounded px-1.5 py-0.5 text-[11px]"
                            style={{
                              background: active ? c.cobalt : "rgba(255,255,255,0.10)",
                              color: "#fff",
                              fontWeight: 600,
                            }}
                          >
                            {item.badge}
                          </span>
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          {user && (
            <div className="px-4 pb-4 pt-3">
              <div
                className="rounded-lg border p-3 flex items-center gap-2.5"
                style={{ borderColor: "#1A2140", background: "rgba(255,255,255,0.03)" }}
              >
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px]"
                  style={{ background: "rgba(255,255,255,0.12)", color: "#fff", fontWeight: 700 }}
                >
                  {user.name ? user.name.charAt(0).toUpperCase() : <UserCircle className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] text-white truncate" style={{ fontWeight: 600 }}>
                    {user.name || user.email}
                  </div>
                  {isResident && residentUnit && (
                    <div
                      className="text-[11px] truncate"
                      style={{ color: c.sidebarMute, fontWeight: 500 }}
                      title={`Unit ${residentUnit.unit} · ${residentUnit.address}`}
                    >
                      Unit {residentUnit.unit} · {residentUnit.address}
                    </div>
                  )}
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full inline-block mt-0.5"
                    style={{ background: roleBg, color: roleColor, fontWeight: 700 }}
                  >
                    {roleLabel}
                  </span>
                </div>
                <button
                  onClick={() => logout()}
                  className="p-1.5 rounded hover:bg-white/10 transition-colors"
                  style={{ color: c.sidebarMute }}
                  title="Sign out"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </aside>

        {/* ---------- Main content area ---------- */}
        <main className="min-w-0 flex-1 flex flex-col w-full">
          <div
            className="px-4 sm:px-6 lg:px-7 py-3 border-b"
            style={{ background: "rgba(246,247,251,0.85)", borderColor: c.border }}
          >
            <div className="mb-1.5 min-w-0">
              <Breadcrumbs />
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <h1
                  className="text-[18px] sm:text-[20px] lg:text-[22px] truncate"
                  style={{ fontWeight: 700, letterSpacing: "-0.02em" }}
                  data-testid="page-title"
                >
                  {title}
                </h1>
                {liveTag && (
                  <span
                    className="font-mono-num rounded-md px-2 py-0.5 text-[11px] shrink-0"
                    style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}
                  >
                    LIVE
                  </span>
                )}
                {subtitle && (
                  <span
                    className="hidden sm:inline text-[14px] truncate"
                    style={{ color: c.inkSoft, fontWeight: 500 }}
                  >
                    {subtitle}
                  </span>
                )}
              </div>
              {actions && (
                <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">{actions}</div>
              )}
            </div>
          </div>

          {showLayersPanel && (
            <div
              className="px-4 sm:px-6 lg:px-7 py-2 border-b flex flex-wrap items-center gap-x-4 gap-y-1.5"
              style={{ background: c.panel, borderColor: c.border }}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: c.inkMute }}>
                Map Layers
              </span>
              {layerItems.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-1.5 text-[12.5px] cursor-pointer" style={{ color: c.inkSoft }}>
                  <input
                    type="checkbox"
                    checked={layers[key]}
                    onChange={(e) => setLayer(key, e.target.checked)}
                    className="accent-blue-500"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          )}

          <div className="px-4 sm:px-6 lg:px-7 py-4 sm:py-6 flex-1">{children}</div>
          {location !== "/mailroom/kiosk" && <AppFooter />}
        </main>
      </div>
      <HelpPanel open={helpOpen} onOpenChange={setHelpOpen} />
      <OnboardingTour />
    </>
  );
}
