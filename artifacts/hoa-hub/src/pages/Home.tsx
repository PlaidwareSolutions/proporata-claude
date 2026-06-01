import { Link } from "wouter";
import { useState, type ComponentType, type SVGProps } from "react";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import {
  Building2, Home as HomeIcon, ClipboardList, ShieldCheck, FileText,
  BarChart3, ArrowRight, MapPin, Phone, Globe, CheckCircle2, AlertTriangle,
  Wallet, Gavel, Scroll, Calendar as CalIcon, Palette, MessageSquare,
  HardHat, Vote, Package as PackageIcon, Zap, Car, CreditCard, UserCircle,
  Plus, BedDouble, Bath, Maximize2,
} from "lucide-react";
import {
  useListBuildings, useListWorkOrders, useListInsurance,
  useGetMyAccount, getGetMyAccountQueryKey, useGetUnit, getGetUnitQueryKey,
  useCreateWorkOrder, useListMeetings,
  getListWorkOrdersQueryKey,
} from "@workspace/api-client-react";
import type { MeetingListItem, OwnerAccountDetail } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { motionsApi } from "@/lib/motionsApi";
import { useAuth } from "@/contexts/AuthContext";
import { MotionsAwaitingVoteWidget } from "@/components/MotionsAwaitingVoteWidget";
import UpcomingEventsWidget from "@/components/calendar/UpcomingEventsWidget";
import { MyViolationsCard } from "@/components/MyViolationsCard";

const COMMUNITY = {
  name: "Quail Valley Townhome Association",
  address: "2807 Yorktown Ln, Stafford, TX 77477",
  phone: "(832) 987-1728",
  website: "quailvalleyhoa.org",
  managed: "The Town Homes of Quail Valley",
  streets: ["Cambridge Ln", "Camelot Ln", "Hampshire Ln", "La Quinta Ln", "Nottingham Ln", "Princeton Ln", "W Hampton Ln", "Yorktown Ln", "Princess Ln"],
};

const pillars = [
  { icon: ClipboardList, title: "Work Order History", body: "Track every repair from report to resolution — with vendor details, timelines, and lessons learned." },
  { icon: ShieldCheck, title: "Insurance Compliance", body: "See which buildings have current declarations, which are expiring, and which need follow-up — at a glance." },
  { icon: Building2, title: "Building & Roof Health", body: "Per-building roof ages, inspection records, and status indicators so the board can plan proactively." },
  { icon: FileText, title: "Document Organization", body: "Auto-generated folder structures for every unit — no more hunting through email threads or paper binders." },
];

export default function Home() {
  const { user } = useAuth();
  const isResident = user?.role === "resident";
  const isBoard = isResident && !!user?.boardMember;

  // Owners get balance/payment info; tenants don't.
  const accountEnabled = isResident && !!user?.unitId;
  const { data: myAccount, isLoading: accountLoading } = useGetMyAccount({
    query: {
      queryKey: getGetMyAccountQueryKey(),
      enabled: accountEnabled,
      retry: false,
      refetchOnWindowFocus: false,
    },
  });
  const isOwner = !!myAccount && myAccount.occupancy === "owner";

  if (!isResident) return <ManagerHome />;
  if (isBoard) return <BoardHome />;
  // Wait for the account query before deciding owner vs tenant so owners
  // don't briefly flash the tenant dashboard.
  if (accountEnabled && accountLoading) {
    return (
      <Layout title="Welcome home" subtitle="Loading…">
        <div className="text-[13px]" style={{ color: c.inkMute }}>Loading your dashboard…</div>
      </Layout>
    );
  }
  if (isOwner) return <OwnerHome account={myAccount} />;
  return <TenantHome />;
}

// ---------- Manager / Admin ----------

function ManagerHome() {
  const { data: buildings = [] } = useListBuildings();
  const { data: workOrders = [] } = useListWorkOrders();
  const { data: insurance = [] } = useListInsurance();
  const { data: openMotions = [] } = useQuery({
    queryKey: ["motions-list", "open"],
    queryFn: () => motionsApi.list("open"),
    refetchInterval: 60000,
  });

  const totalUnits = buildings.reduce((s, b) => s + b.units, 0);
  const totalBuildings = buildings.length;
  const openWO = workOrders.filter((w) => w.status !== "done").length;
  const urgent = workOrders.filter((w) => w.priority === "urgent" && w.status !== "done").length;
  const insuranceGaps = insurance.filter((i) => i.status !== "current").length;
  const roofAttention = buildings.filter((b) => 2026 - b.roofYear >= 12).length;

  const groups: Array<{ label: string; items: Array<{ label: string; desc: string; href: string; icon: IconType; accent: string; bg: string }> }> = [
    {
      label: "Operations",
      items: [
        { label: "Work Orders", desc: `${openWO} open tickets`, href: "/work-orders", icon: ClipboardList, accent: c.rose, bg: c.roseSoft },
        { label: "Vendors", desc: "Trade contacts and history", href: "/vendors", icon: HardHat, accent: c.cobalt, bg: c.cobaltSoft },
        { label: "Bids", desc: "Open bid requests", href: "/bids", icon: Gavel, accent: c.amber, bg: c.amberSoft },
        { label: "Architectural", desc: "ACC requests under review", href: "/architectural-requests", icon: Palette, accent: c.cobalt, bg: c.cobaltSoft },
        { label: "Communications", desc: "Notices and broadcasts", href: "/communications", icon: MessageSquare, accent: c.emerald, bg: c.emeraldSoft },
      ],
    },
    {
      label: "Governance",
      items: [
        { label: "Motions", desc: "Open motions and voting", href: "/motions", icon: Gavel, accent: c.cobalt, bg: c.cobaltSoft },
        { label: "Resolutions", desc: "Adopted policies", href: "/resolutions", icon: Scroll, accent: c.emerald, bg: c.emeraldSoft },
        { label: "Meetings", desc: "Agendas and minutes", href: "/meetings", icon: CalIcon, accent: c.amber, bg: c.amberSoft },
        { label: "Calendar", desc: "Community calendar", href: "/calendar", icon: CalIcon, accent: c.cobalt, bg: c.cobaltSoft },
        { label: "Board", desc: "Officers and history", href: "/boards", icon: Vote, accent: c.cobalt, bg: c.cobaltSoft },
      ],
    },
    {
      label: "Financials",
      items: [
        { label: "Billing", desc: "Owner accounts and ledger", href: "/billing", icon: Wallet, accent: c.emerald, bg: c.emeraldSoft },
        { label: "Payments", desc: "Stripe payments and refunds", href: "/billing/payments", icon: CreditCard, accent: c.cobalt, bg: c.cobaltSoft },
        { label: "Insurance", desc: `${insuranceGaps} items need attention`, href: "/insurance", icon: ShieldCheck, accent: c.amber, bg: c.amberSoft },
      ],
    },
    {
      label: "Community",
      items: [
        { label: "Amenities", desc: "Reservations and inspections", href: "/amenities", icon: Building2, accent: c.cobalt, bg: c.cobaltSoft },
        { label: "Mail Room", desc: "Packages and lockers", href: "/mail-room", icon: PackageIcon, accent: c.amber, bg: c.amberSoft },
        { label: "EV Charging", desc: "Ports and sessions", href: "/ev-charging", icon: Zap, accent: c.emerald, bg: c.emeraldSoft },
        { label: "Guest Parking", desc: "Visitor permits", href: "/parking", icon: Car, accent: c.cobalt, bg: c.cobaltSoft },
        { label: "Pets", desc: "Pet registry", href: "/pets", icon: HomeIcon, accent: c.emerald, bg: c.emeraldSoft },
        { label: "Patrol", desc: "Compliance lookups", href: "/patrol", icon: ShieldCheck, accent: c.rose, bg: c.roseSoft },
      ],
    },
    {
      label: "Library",
      items: [
        { label: "Documents", desc: "Bylaws, policies, reports", href: "/documents", icon: FileText, accent: c.cobalt, bg: c.cobaltSoft },
        { label: "Reports", desc: "Spend trends and health", href: "/reports", icon: BarChart3, accent: c.emerald, bg: c.emeraldSoft },
      ],
    },
  ];

  const recentEvents = workOrders.slice(0, 5).map((w) => {
    const b = buildings.find((bb) => bb.num === w.building);
    return {
      text: `${w.title} — ${b?.address ?? `Bldg ${w.building}`}`,
      sub: `${w.category} · ${w.status.replace("_", " ")}`,
      urgent: w.priority === "urgent",
      date: w.opened,
    };
  });

  const attentionItems = [
    ...workOrders
      .filter((w) => w.priority === "urgent" && w.status !== "done")
      .slice(0, 3)
      .map((w) => ({
        kind: "Urgent work order",
        label: `${w.id} — ${w.title}`,
        href: `/work-orders/${w.id}`,
        Icon: AlertTriangle,
        color: c.rose,
        bg: c.roseSoft,
      })),
    ...insurance
      .filter((i) => i.status !== "current")
      .slice(0, 3)
      .map((i) => ({
        kind: "Insurance",
        label: `Policy ${i.status}`,
        href: "/insurance",
        Icon: ShieldCheck,
        color: c.amber,
        bg: c.amberSoft,
      })),
    ...openMotions
      .slice(0, 3)
      .map((m) => ({
        kind: "Motion awaiting vote",
        label: m.title,
        href: `/motions/${m.id}`,
        Icon: Gavel,
        color: c.cobalt,
        bg: c.cobaltSoft,
      })),
  ];

  return (
    <Layout title="Home" subtitle={COMMUNITY.managed}>
      <MotionsAwaitingVoteWidget />
      <div
        className="relative overflow-hidden rounded-2xl mb-6 px-8 py-10"
        style={{ background: c.sidebar }}
      >
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: "repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 0, transparent 50%)",
          backgroundSize: "20px 20px",
        }} />
        <div className="relative flex items-start justify-between gap-6">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2.5 mb-4">
              <img src="/favicon-color.png" alt="" className="h-12 w-12 object-contain" />
              <div>
                <div className="text-white text-[18px]" style={{ fontWeight: 700, letterSpacing: "-0.01em" }}>
                  {COMMUNITY.name}
                </div>
                <div className="text-[13px] mt-0.5" style={{ color: "#8E96B4", fontWeight: 500 }}>
                  HOA Operations Hub
                </div>
              </div>
            </div>
            <p className="text-[17px] leading-relaxed mb-6" style={{ color: "#E0E4F2", fontWeight: 500 }}>
              Centralized visibility across buildings, units, documents, insurance, and maintenance.
            </p>
            <div className="flex items-center gap-4 flex-wrap text-[13px]" style={{ color: "#8E96B4", fontWeight: 500 }}>
              <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {COMMUNITY.address}</span>
              <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {COMMUNITY.phone}</span>
              <span className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> {COMMUNITY.website}</span>
            </div>
          </div>
          <div className="hidden lg:flex flex-col gap-2 shrink-0">
            {[
              { v: totalUnits, l: "Units" },
              { v: totalBuildings, l: "Buildings" },
              { v: COMMUNITY.streets.length, l: "Streets" },
            ].map((k) => (
              <div key={k.l} className="rounded-xl px-5 py-3 text-center" style={{ background: "rgba(255,255,255,0.07)" }}>
                <div className="font-mono-num text-[26px] text-white" style={{ fontWeight: 700, letterSpacing: "-0.03em" }}>{k.v}</div>
                <div className="text-[11px] mt-0.5" style={{ color: "#8E96B4", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{k.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { l: "Open work orders", v: openWO, color: openWO > 0 ? c.cobalt : c.emerald },
          { l: "Urgent issues", v: urgent, color: urgent > 0 ? c.rose : c.emerald },
          { l: "Insurance gaps", v: insuranceGaps, color: insuranceGaps > 0 ? c.amber : c.emerald },
          { l: "Roof attention", v: roofAttention, color: roofAttention > 0 ? c.amber : c.emerald },
        ].map((k) => (
          <div key={k.l} className="rounded-xl border bg-white px-5 py-4" style={{ borderColor: c.border }}>
            <div className="text-[12px] font-semibold uppercase tracking-wider mb-1" style={{ color: c.inkSoft }}>{k.l}</div>
            <div className="font-mono-num text-[28px] leading-none" style={{ color: k.color, fontWeight: 700, letterSpacing: "-0.02em" }}>{k.v}</div>
            <div className="mt-1.5 text-[12px]" style={{ color: k.v === 0 ? c.emerald : c.inkMute, fontWeight: 500 }}>
              {k.v === 0 ? "All clear" : "Needs attention"}
            </div>
          </div>
        ))}
      </div>

      {attentionItems.length > 0 && (
        <section
          className="rounded-xl border bg-white p-4 mb-6"
          style={{ borderColor: c.border }}
          data-testid="attention-strip"
        >
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4" style={{ color: c.amber }} />
            <h2 className="text-[14px]" style={{ fontWeight: 700, color: c.ink }}>Attention needed</h2>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
            {attentionItems.map((a, i) => {
              const Icon = a.Icon;
              return (
                <Link
                  key={i}
                  href={a.href}
                  className="flex items-center gap-2.5 rounded-lg border px-3 py-2 hover:bg-slate-50"
                  style={{ borderColor: c.borderSoft }}
                >
                  <span className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md" style={{ background: a.bg, color: a.color }}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[10.5px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>{a.kind}</div>
                    <div className="text-[12.5px] truncate" style={{ color: c.ink, fontWeight: 600 }}>{a.label}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid grid-cols-3 gap-5 mb-5">
        <UpcomingEventsWidget />
        <section className="rounded-xl border bg-white p-5 col-span-2" style={{ borderColor: c.border }}>
          <h2 className="text-[15px] mb-3" style={{ fontWeight: 700, color: c.ink }}>Recent activity</h2>
          <ul className="space-y-3">
            {recentEvents.map((e, i) => (
              <li key={i} className="flex items-start gap-2.5 border-b pb-3 last:border-0 last:pb-0" style={{ borderColor: c.borderSoft }}>
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ background: e.urgent ? c.roseSoft : c.cobaltSoft }}>
                  {e.urgent
                    ? <AlertTriangle className="h-3 w-3" style={{ color: c.rose }} />
                    : <CheckCircle2 className="h-3 w-3" style={{ color: c.cobalt }} />}
                </div>
                <div className="min-w-0">
                  <div className="text-[12.5px] leading-snug" style={{ fontWeight: 600, color: c.ink }}>{e.text}</div>
                  <div className="text-[11.5px] mt-0.5" style={{ color: c.inkMute, fontWeight: 500 }}>{e.sub} · {e.date}</div>
                </div>
              </li>
            ))}
          </ul>
          <Link href="/work-orders" className="mt-3 inline-flex items-center gap-1 text-[12.5px]" style={{ color: c.cobalt, fontWeight: 600 }}>
            All work orders <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      </div>

      <section className="space-y-5 mb-6">
        {groups.map((g) => (
          <div key={g.label}>
            <h2 className="text-[15px] mb-3" style={{ fontWeight: 700, color: c.ink }}>{g.label}</h2>
            <div className="grid grid-cols-3 lg:grid-cols-4 gap-3">
              {g.items.map((l) => {
                const Icon = l.icon;
                return (
                  <Link
                    key={l.label}
                    href={l.href}
                    className="rounded-xl border bg-white p-4 flex flex-col gap-3 hover:shadow-sm transition-shadow group"
                    style={{ borderColor: c.border }}
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: l.bg, color: l.accent }}>
                      <Icon className="h-4.5 w-4.5" style={{ height: 18, width: 18 }} />
                    </div>
                    <div>
                      <div className="text-[13.5px] flex items-center gap-1" style={{ fontWeight: 700, color: c.ink }}>
                        {l.label}
                        <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: l.accent }} />
                      </div>
                      <div className="text-[12px] mt-0.5" style={{ color: c.inkSoft, fontWeight: 500 }}>{l.desc}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section>
        <h2 className="text-[15px] mb-3" style={{ fontWeight: 700, color: c.ink }}>What HOA Hub solves</h2>
        <div className="grid grid-cols-4 gap-4">
          {pillars.map((p) => {
            const Icon = p.icon;
            return (
              <div key={p.title} className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg mb-3" style={{ background: c.cobaltSoft, color: c.cobalt }}>
                  <Icon className="h-4.5 w-4.5" style={{ height: 18, width: 18 }} />
                </div>
                <div className="text-[13.5px] mb-1.5" style={{ fontWeight: 700, color: c.ink }}>{p.title}</div>
                <div className="text-[12.5px] leading-relaxed" style={{ color: c.inkSoft, fontWeight: 500 }}>{p.body}</div>
              </div>
            );
          })}
        </div>
      </section>
    </Layout>
  );
}

// ---------- Resident shared bits ----------

function fmtUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const CATEGORIES = ["Plumbing", "Roof", "Electrical", "Structural", "Exterior", "Landscaping", "HVAC"] as const;

const statusMeta: Record<string, { label: string; color: string; bg: string }> = {
  open:        { label: "Open",        color: "#B8264C", bg: "#FBE3E9" },
  scheduled:   { label: "Scheduled",   color: "#A66C0E", bg: "#FBEFD6" },
  in_progress: { label: "In Progress", color: "#3245FF", bg: "#E5E8FF" },
  done:        { label: "Done",        color: "#0E8A6B", bg: "#DCF3EC" },
};

function ResidentRequestsCard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const unitId = user?.unitId ?? "";
  const { data: unit } = useGetUnit(unitId || "-", { query: { enabled: !!unitId, queryKey: getGetUnitQueryKey(unitId || "-") } });
  const { data: workOrders = [] } = useListWorkOrders();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", category: "", description: "" });
  const [errors, setErrors] = useState<{ title?: string; category?: string; description?: string }>({});
  const createMutation = useCreateWorkOrder();

  const open = workOrders.filter((w) => w.status !== "done");
  const done = workOrders.filter((w) => w.status === "done");
  const ordered = [...open, ...done].slice(0, 6);

  function validate(): boolean {
    const e: typeof errors = {};
    if (!form.title.trim()) e.title = "Required";
    if (!form.category) e.category = "Required";
    if (!form.description.trim()) e.description = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate() || !unit) return;
    await createMutation.mutateAsync({
      data: {
        building: unit.building,
        unit: unit.id,
        title: form.title,
        category: form.category as typeof CATEGORIES[number],
        priority: "med",
        status: "open",
        description: form.description,
        estCost: 0,
      },
    });
    await queryClient.invalidateQueries({ queryKey: getListWorkOrdersQueryKey() });
    setForm({ title: "", category: "", description: "" });
    setShowForm(false);
  }

  return (
    <section id="my-requests" className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <ClipboardList className="h-5 w-5" style={{ color: c.cobalt }} />
          <h2 className="text-[16px]" style={{ fontWeight: 700 }}>My Requests</h2>
          {open.length > 0 && (
            <span className="font-mono-num text-[11px] px-2 py-0.5 rounded" style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}>
              {open.length} open
            </span>
          )}
        </div>
        {unit && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] hover:opacity-90"
            style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
            data-testid="resident-new-request"
          >
            <Plus className="h-3.5 w-3.5" /> Submit Request
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-5 rounded-lg border p-4 space-y-3" style={{ borderColor: c.border, background: c.canvas }}>
          <div>
            <label className="block text-[12px] font-semibold mb-1" style={{ color: errors.category ? c.rose : c.inkSoft }}>
              Issue Type {errors.category && <span className="text-[11px]">({errors.category})</span>}
            </label>
            <select
              value={form.category}
              onChange={(e) => { setForm((f) => ({ ...f, category: e.target.value })); setErrors((er) => ({ ...er, category: undefined })); }}
              className="w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: errors.category ? c.rose : c.border, background: "#fff", color: c.ink }}
            >
              <option value="">Select category…</option>
              {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-semibold mb-1" style={{ color: errors.title ? c.rose : c.inkSoft }}>
              Title {errors.title && <span className="text-[11px]">({errors.title})</span>}
            </label>
            <input
              value={form.title}
              onChange={(e) => { setForm((f) => ({ ...f, title: e.target.value })); setErrors((er) => ({ ...er, title: undefined })); }}
              placeholder="Brief summary…"
              className="w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: errors.title ? c.rose : c.border, background: "#fff", color: c.ink }}
            />
          </div>
          <div>
            <label className="block text-[12px] font-semibold mb-1" style={{ color: errors.description ? c.rose : c.inkSoft }}>
              Description {errors.description && <span className="text-[11px]">({errors.description})</span>}
            </label>
            <textarea
              value={form.description}
              onChange={(e) => { setForm((f) => ({ ...f, description: e.target.value })); setErrors((er) => ({ ...er, description: undefined })); }}
              rows={3}
              className="w-full resize-none rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: errors.description ? c.rose : c.border, background: "#fff", color: c.ink }}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-lg px-4 py-2 text-[13px] hover:opacity-90 disabled:opacity-60"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
            >
              {createMutation.isPending ? "Submitting…" : "Submit Request"}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setForm({ title: "", category: "", description: "" }); setErrors({}); }}
              className="rounded-lg border px-4 py-2 text-[13px] hover:bg-slate-50"
              style={{ borderColor: c.border, color: c.inkSoft }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {workOrders.length === 0 ? (
        <div className="text-center py-6" style={{ color: c.inkMute }}>
          <ClipboardList className="h-7 w-7 mx-auto mb-2 opacity-30" />
          <div className="text-[13px]">No maintenance requests yet.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {ordered.map((wo) => {
            const meta = statusMeta[wo.status] ?? statusMeta.open;
            return (
              <Link
                key={wo.id}
                href={`/work-orders/${wo.id}`}
                className="flex items-start gap-3 rounded-lg border p-3 hover:bg-slate-50 transition-colors"
                style={{ borderColor: c.borderSoft }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px]" style={{ fontWeight: 600, color: c.ink }}>{wo.title}</span>
                    <span className="text-[10.5px] px-2 py-0.5 rounded-full" style={{ background: meta.bg, color: meta.color, fontWeight: 700 }}>
                      {meta.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[11.5px]" style={{ color: c.inkMute }}>
                    <span>{wo.category}</span><span>·</span><span>{wo.opened}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ResidentUnitCard() {
  const { user } = useAuth();
  const uid = user?.unitId ?? "-";
  const { data: unit } = useGetUnit(uid, { query: { enabled: !!user?.unitId, queryKey: getGetUnitQueryKey(uid) } });
  if (!unit) return null;
  return (
    <section className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: c.cobaltSoft }}>
            <HomeIcon className="h-5 w-5" style={{ color: c.cobalt }} />
          </div>
          <div>
            <div className="text-[16px]" style={{ fontWeight: 700, color: c.ink }}>{unit.address}</div>
            <div className="text-[12.5px]" style={{ color: c.inkSoft }}>Unit {unit.unit}</div>
          </div>
        </div>
        <span className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}>
          {unit.occupancy === "owner" ? "Owner" : unit.occupancy === "tenant" ? "Tenant" : "Resident"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          { Icon: BedDouble, label: "Bedrooms",  value: String(unit.beds) },
          { Icon: Bath,      label: "Bathrooms", value: String(unit.baths) },
          { Icon: Maximize2, label: "Sq Ft",     value: unit.sqft.toLocaleString() },
        ].map(({ Icon, label, value }) => (
          <div key={label} className="rounded-lg border p-3 text-center" style={{ borderColor: c.borderSoft }}>
            <Icon className="h-4 w-4 mx-auto mb-1" style={{ color: c.inkMute }} />
            <div className="text-[16px] font-mono-num" style={{ fontWeight: 700, color: c.ink }}>{value}</div>
            <div className="text-[11px]" style={{ color: c.inkMute }}>{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

type QuickLink = { label: string; href: string; icon: IconType; accent: string; bg: string };

function ResidentQuickLinks({ links }: { links: QuickLink[] }) {
  return (
    <section className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
      <h2 className="text-[15px] mb-3" style={{ fontWeight: 700, color: c.ink }}>Quick links</h2>
      <div className="grid grid-cols-2 gap-2.5">
        {links.map((l) => {
          const Icon = l.icon;
          return (
            <Link
              key={l.label}
              href={l.href}
              className="flex items-center gap-2.5 rounded-lg border p-3 hover:bg-slate-50 transition-colors"
              style={{ borderColor: c.borderSoft }}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ background: l.bg, color: l.accent }}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-[13px]" style={{ fontWeight: 600, color: c.ink }}>{l.label}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ---------- Board Member ----------

function BoardHome() {
  const { data: meetings = [] } = useListMeetings();
  const { data: openMotions = [] } = useQuery({
    queryKey: ["motions-list", "open"],
    queryFn: () => motionsApi.list("open"),
    refetchInterval: 60000,
  });
  const upcomingMeetings = meetings
    .filter((m: MeetingListItem) => new Date(m.scheduledAt).getTime() > Date.now() - 86400000)
    .slice(0, 3);

  return (
    <Layout title="Board Dashboard" subtitle="Governance at a glance">
      <MotionsAwaitingVoteWidget />

      <div className="grid grid-cols-3 gap-5 mb-5">
        <section className="col-span-2 rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px]" style={{ fontWeight: 700, color: c.ink }}>Open motions</h2>
            <Link href="/motions" className="text-[12px] inline-flex items-center gap-1" style={{ color: c.cobalt, fontWeight: 600 }}>
              All motions <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {openMotions.length === 0 ? (
            <div className="text-[13px]" style={{ color: c.inkMute }}>No open motions.</div>
          ) : (
            <ul className="space-y-2">
              {openMotions.slice(0, 6).map((m) => (
                <li key={m.id}>
                  <Link href={`/motions?open=${m.id}`} className="flex items-center gap-3 rounded-md border px-3 py-2.5 hover:bg-slate-50" style={{ borderColor: c.borderSoft }}>
                    <span className="font-mono-num text-[12px] rounded px-1.5 py-0.5" style={{ background: "#F1F3FA", color: c.inkSoft, fontWeight: 700 }}>M-{m.id}</span>
                    <span className="text-[13px] flex-1 truncate" style={{ fontWeight: 600, color: c.ink }}>{m.title}</span>
                    {!m.myVote && <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: c.amberSoft, color: c.amber, fontWeight: 700 }}>Awaiting your vote</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <UpcomingEventsWidget />
      </div>

      <div className="grid grid-cols-2 gap-5 mb-5">
        <section className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px]" style={{ fontWeight: 700, color: c.ink }}>Upcoming meetings</h2>
            <Link href="/meetings" className="text-[12px] inline-flex items-center gap-1" style={{ color: c.cobalt, fontWeight: 600 }}>
              All meetings <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {upcomingMeetings.length === 0 ? (
            <div className="text-[13px]" style={{ color: c.inkMute }}>No meetings scheduled.</div>
          ) : (
            <ul className="space-y-2">
              {upcomingMeetings.map((m) => (
                <li key={m.id}>
                  <Link href={`/meetings/${m.id}`} className="flex items-start gap-3 rounded-md border px-3 py-2.5 hover:bg-slate-50" style={{ borderColor: c.borderSoft }}>
                    <CalIcon className="h-4 w-4 mt-0.5" style={{ color: c.cobalt }} />
                    <div className="min-w-0">
                      <div className="text-[13px]" style={{ fontWeight: 600, color: c.ink }}>{m.title}</div>
                      <div className="text-[11.5px]" style={{ color: c.inkMute }}>{new Date(m.scheduledAt).toLocaleString()}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <ResidentQuickLinks links={[
          { label: "Resolutions", href: "/portal/resolutions", icon: Scroll, accent: c.cobalt, bg: c.cobaltSoft },
          { label: "Board", href: "/portal/board", icon: Vote, accent: c.cobalt, bg: c.cobaltSoft },
          { label: "Documents", href: "/portal/documents", icon: FileText, accent: c.emerald, bg: c.emeraldSoft },
          { label: "Calendar", href: "/calendar", icon: CalIcon, accent: c.amber, bg: c.amberSoft },
          { label: "Amenities", href: "/portal/amenities", icon: Building2, accent: c.cobalt, bg: c.cobaltSoft },
          { label: "Architectural", href: "/portal/architectural", icon: Palette, accent: c.cobalt, bg: c.cobaltSoft },
        ]} />
      </div>

      <ResidentRequestsCard />
    </Layout>
  );
}

// ---------- Owner ----------

function OwnerHome({ account }: { account: OwnerAccountDetail | undefined }) {
  const balance = account?.balanceCents ?? 0;
  const balanceColor = balance > 0 ? c.rose : balance < 0 ? c.cobalt : c.ink;
  const status = account?.status ?? "current";
  const statusLabel = status === "past_due" ? "Past Due" : status === "credit" ? "Credit" : "Current";
  const statusBg = status === "past_due" ? c.roseSoft : status === "credit" ? c.cobaltSoft : c.emeraldSoft;
  const statusFg = status === "past_due" ? c.rose : status === "credit" ? c.cobalt : c.emerald;

  return (
    <Layout title="Welcome home" subtitle="Your unit, requests, and account">
      <MotionsAwaitingVoteWidget variant="compact" />
      <div className="grid grid-cols-3 gap-5 mb-5">
        <div className="col-span-2 space-y-5">
          <ResidentUnitCard />

          <MyViolationsCard />

          <section className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[15px] inline-flex items-center gap-2" style={{ fontWeight: 700, color: c.ink }}>
                <Wallet className="h-4 w-4" style={{ color: c.emerald }} /> My Account
              </h2>
              <Link href="/portal/account" className="text-[12px] inline-flex items-center gap-1" style={{ color: c.cobalt, fontWeight: 600 }}>
                Open account <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {account ? (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>Current balance</div>
                    <div className="font-mono-num text-[28px]" style={{ color: balanceColor, fontWeight: 700 }}>{fmtUsd(balance)}</div>
                  </div>
                  <span className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: statusBg, color: statusFg, fontWeight: 700 }}>{statusLabel}</span>
                </div>
                {account.lastPayment && (
                  <div className="text-[12px] mt-2" style={{ color: c.inkMute }}>Last payment: {account.lastPayment}</div>
                )}
              </>
            ) : (
              <div className="text-[13px]" style={{ color: c.inkMute }}>Account info loading…</div>
            )}
          </section>

          <ResidentRequestsCard />
        </div>

        <div className="space-y-5">
          <UpcomingEventsWidget />
          <ResidentQuickLinks links={[
            { label: "My Mail", href: "/portal/mail", icon: PackageIcon, accent: c.amber, bg: c.amberSoft },
            { label: "My Pets", href: "/portal/pets", icon: HomeIcon, accent: c.emerald, bg: c.emeraldSoft },
            { label: "Guest Parking", href: "/portal/parking", icon: Car, accent: c.cobalt, bg: c.cobaltSoft },
            { label: "EV Charging", href: "/portal/ev-charging", icon: Zap, accent: c.emerald, bg: c.emeraldSoft },
            { label: "Amenities", href: "/portal/amenities", icon: Building2, accent: c.cobalt, bg: c.cobaltSoft },
            { label: "Architectural", href: "/portal/architectural", icon: Palette, accent: c.cobalt, bg: c.cobaltSoft },
            { label: "Documents", href: "/portal/documents", icon: FileText, accent: c.cobalt, bg: c.cobaltSoft },
            { label: "My Profile", href: "/profile", icon: UserCircle, accent: c.inkSoft, bg: c.borderSoft },
          ]} />
        </div>
      </div>
    </Layout>
  );
}

// ---------- Tenant ----------

function TenantHome() {
  return (
    <Layout title="Welcome home" subtitle="Your requests and community">
      <MotionsAwaitingVoteWidget variant="compact" />
      <div className="grid grid-cols-3 gap-5 mb-5">
        <div className="col-span-2 space-y-5">
          <ResidentUnitCard />
          <MyViolationsCard />
          <ResidentRequestsCard />
        </div>
        <div className="space-y-5">
          <UpcomingEventsWidget />
          <ResidentQuickLinks links={[
            { label: "My Mail", href: "/portal/mail", icon: PackageIcon, accent: c.amber, bg: c.amberSoft },
            { label: "My Pets", href: "/portal/pets", icon: HomeIcon, accent: c.emerald, bg: c.emeraldSoft },
            { label: "Amenities", href: "/portal/amenities", icon: Building2, accent: c.cobalt, bg: c.cobaltSoft },
            { label: "EV Charging", href: "/portal/ev-charging", icon: Zap, accent: c.emerald, bg: c.emeraldSoft },
            { label: "Calendar", href: "/calendar", icon: CalIcon, accent: c.cobalt, bg: c.cobaltSoft },
            { label: "Documents", href: "/portal/documents", icon: FileText, accent: c.cobalt, bg: c.cobaltSoft },
            { label: "My Profile", href: "/profile", icon: UserCircle, accent: c.inkSoft, bg: c.borderSoft },
          ]} />
        </div>
      </div>
    </Layout>
  );
}
