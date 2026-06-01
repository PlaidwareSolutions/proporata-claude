import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import type { WOStatus } from "@/lib/data";
import {
  ArrowLeft, Home, ClipboardList, ShieldCheck, FileText, HardHat,
  LayoutGrid, Plus, Upload, CheckCircle2, AlertTriangle, Pencil, Trash2,
  User, Phone, Mail, UserCheck, Clock,
} from "lucide-react";
import { LogPastJobDialog } from "@/components/LogPastJobDialog";
import {
  useGetUnit, useGetBuilding, useListWorkOrders, useGetInsurance,
  useUpdateUnit, useDeleteUnit,
  getGetBuildingQueryKey, getListWorkOrdersQueryKey, getGetInsuranceQueryKey,
  getGetUnitQueryKey, getListUnitsQueryKey,
} from "@workspace/api-client-react";
import type { UpdateUnitBody } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const priColors = {
  urgent: { bg: "#FBE3E9", fg: "#B8264C" },
  high:   { bg: "#FBEFD6", fg: "#A66C0E" },
  med:    { bg: "#E5E8FF", fg: "#3245FF" },
  low:    { bg: "#EFF1F8", fg: "#5A6285" },
};

const woStatusColors: Record<WOStatus, { bg: string; fg: string; label: string }> = {
  open:        { bg: "#FBE3E9", fg: "#B8264C", label: "Open" },
  scheduled:   { bg: "#FBEFD6", fg: "#A66C0E", label: "Scheduled" },
  in_progress: { bg: "#E5E8FF", fg: "#3245FF", label: "In Progress" },
  done:        { bg: "#DCF3EC", fg: "#0E8A6B", label: "Done" },
};

const occColor = {
  owner:  { bg: "#E5E8FF", fg: "#3245FF" },
  tenant: { bg: "#FBEFD6", fg: "#A66C0E" },
  vacant: { bg: "#EFF1F8", fg: "#5A6285" },
};

const TABS = ["Overview", "Work Orders", "Insurance", "Correspondence", "Roof Documents"] as const;
type Tab = typeof TABS[number];

const tabIcons: Record<Tab, React.ReactNode> = {
  "Overview":       <LayoutGrid className="h-3.5 w-3.5" />,
  "Work Orders":    <ClipboardList className="h-3.5 w-3.5" />,
  "Insurance":      <ShieldCheck className="h-3.5 w-3.5" />,
  "Correspondence": <FileText className="h-3.5 w-3.5" />,
  "Roof Documents": <HardHat className="h-3.5 w-3.5" />,
};

const timelineEvents = [
  { date: "2026-04-29", label: "Work order WO-1042 opened", status: "urgent" },
  { date: "2026-04-10", label: "Annual smoke detector check completed", status: "done" },
  { date: "2026-03-18", label: "Insurance renewal notice sent", status: "info" },
  { date: "2026-01-05", label: "Winter inspection — no issues found", status: "done" },
];

export default function UnitDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [showEditForm, setShowEditForm] = useState(false);
  const [editForm, setEditForm] = useState<UpdateUnitBody>({});
  const [editError, setEditError] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [showLogPast, setShowLogPast] = useState(false);

  const queryClient = useQueryClient();
  const { data: unit, isLoading } = useGetUnit(id ?? "");
  const { data: building } = useGetBuilding(
    unit?.building ?? 0,
    { query: { enabled: !!unit, queryKey: getGetBuildingQueryKey(unit?.building ?? 0) } },
  );
  const { data: allWOs = [] } = useListWorkOrders(
    { building: unit?.building },
    { query: { enabled: !!unit, queryKey: getListWorkOrdersQueryKey({ building: unit?.building }) } },
  );
  const { data: histAllWOs = [] } = useListWorkOrders(
    { building: unit?.building, historical: "true" } as any,
    { query: { enabled: !!unit, queryKey: getListWorkOrdersQueryKey({ building: unit?.building, historical: "true" } as any) } },
  );
  const histUnitWOs = histAllWOs.filter((w: any) => w.unit === unit?.id);
  const { data: bldgInsurance } = useGetInsurance(
    unit?.building ?? 0,
    { query: { enabled: !!unit, queryKey: getGetInsuranceQueryKey(unit?.building ?? 0) } },
  );

  const updateMutation = useUpdateUnit();
  const deleteMutation = useDeleteUnit();

  if (isLoading) {
    return (
      <Layout title="Unit">
        <div className="py-16 text-center text-[13px]" style={{ color: c.inkMute }}>Loading…</div>
      </Layout>
    );
  }

  if (!unit) {
    return (
      <Layout title="Unit Not Found">
        <Link href="/units" className="inline-flex items-center gap-1.5 text-[13px] hover:underline" style={{ color: c.cobalt }}>
          <ArrowLeft className="h-4 w-4" /> Back to Units
        </Link>
      </Layout>
    );
  }

  const unitWOs = allWOs.filter((w) => w.unit === unit!.id);
  const oc = occColor[unit!.occupancy as keyof typeof occColor];

  function openEditForm() {
    setEditForm({
      address: unit!.address,
      beds: unit!.beds,
      baths: unit!.baths,
      sqft: unit!.sqft,
      occupancy: unit!.occupancy as UpdateUnitBody["occupancy"],
      ownerName: unit!.ownerName,
      ownerPhone: unit!.ownerPhone ?? "",
      ownerEmail: unit!.ownerEmail ?? "",
      tenantName: unit!.tenantName ?? "",
      tenantPhone: unit!.tenantPhone ?? "",
      tenantEmail: unit!.tenantEmail ?? "",
    });
    setEditError("");
    setShowEditForm(true);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    setEditError("");
    try {
      await updateMutation.mutateAsync({ id: unit!.id, data: editForm });
      await queryClient.invalidateQueries({ queryKey: getGetUnitQueryKey(unit!.id) });
      await queryClient.invalidateQueries({ queryKey: getListUnitsQueryKey({ building: unit!.building }) });
      setShowEditForm(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update unit.";
      setEditError(message);
    }
  }

  async function handleDelete() {
    setDeleteError("");
    try {
      await deleteMutation.mutateAsync({ id: unit!.id });
      await queryClient.invalidateQueries({ queryKey: getListUnitsQueryKey({ building: unit!.building }) });
      navigate(`/buildings/${unit!.building}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to delete unit.";
      setDeleteError(message);
    }
  }

  return (
    <Layout
      title={`Unit ${unit.id}`}
      subtitle={unit.address}
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/units"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-[13px] hover:bg-slate-50 transition-colors"
            style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
          >
            <ArrowLeft className="h-4 w-4" /> Units
          </Link>
          <button
            onClick={openEditForm}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-[13px] hover:bg-slate-50 transition-colors"
            style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
          >
            <Pencil className="h-4 w-4" /> Edit Unit
          </button>
          <button
            onClick={() => { setDeleteError(""); setShowDeleteDialog(true); }}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-[13px] hover:bg-red-50 transition-colors"
            style={{ borderColor: c.rose, color: c.rose, fontWeight: 500 }}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
          <Link
            href="/work-orders/new"
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] hover:opacity-90"
            style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
          >
            <Plus className="h-4 w-4" /> New Work Order
          </Link>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl" style={{ background: c.cobaltSoft }}>
              <Home className="h-7 w-7" style={{ color: c.cobalt }} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-[20px]" style={{ fontWeight: 700, letterSpacing: "-0.02em" }}>Unit {unit.id}</span>
                <span className="rounded-full px-2.5 py-0.5 text-[11px] capitalize" style={{ background: oc.bg, color: oc.fg, fontWeight: 700 }}>
                  {unit.occupancy}
                </span>
              </div>
              <div className="mt-0.5 text-[14px]" style={{ color: c.inkSoft }}>{unit.address}</div>
            </div>
            <div className="text-right">
              <div className="text-[13px]" style={{ color: c.inkMute }}>Owner of Record</div>
              <div className="text-[16px] mt-0.5" style={{ fontWeight: 700 }}>{unit.ownerName || "—"}</div>
            </div>
          </div>

          <div className={`mt-4 grid gap-3 ${unit.occupancy === "tenant" ? "grid-cols-2" : "grid-cols-1"}`}>
            <div className="rounded-lg border p-3" style={{ borderColor: c.borderSoft, background: c.canvas }}>
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider mb-2" style={{ color: c.inkMute, fontWeight: 700 }}>
                <User className="h-3 w-3" /> Owner Contact
              </div>
              <div className="space-y-1.5">
                <div className="text-[13.5px]" style={{ fontWeight: 600, color: c.ink }}>{unit.ownerName || "—"}</div>
                <div className="flex items-center gap-1.5 text-[12.5px]" style={{ color: c.inkSoft }}>
                  <Phone className="h-3 w-3" style={{ color: c.inkMute }} />
                  {unit.ownerPhone || <span style={{ color: c.inkMute }}>No phone on file</span>}
                </div>
                <div className="flex items-center gap-1.5 text-[12.5px]" style={{ color: c.inkSoft }}>
                  <Mail className="h-3 w-3" style={{ color: c.inkMute }} />
                  {unit.ownerEmail || <span style={{ color: c.inkMute }}>No email on file</span>}
                </div>
              </div>
            </div>
            {unit.occupancy === "tenant" && (
              <div className="rounded-lg border p-3" style={{ borderColor: c.borderSoft, background: c.canvas }}>
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider mb-2" style={{ color: c.amber, fontWeight: 700 }}>
                  <UserCheck className="h-3 w-3" /> Tenant Contact
                </div>
                <div className="space-y-1.5">
                  <div className="text-[13.5px]" style={{ fontWeight: 600, color: c.ink }}>{unit.tenantName || <span style={{ color: c.inkMute, fontWeight: 500 }}>No tenant name on file</span>}</div>
                  <div className="flex items-center gap-1.5 text-[12.5px]" style={{ color: c.inkSoft }}>
                    <Phone className="h-3 w-3" style={{ color: c.inkMute }} />
                    {unit.tenantPhone || <span style={{ color: c.inkMute }}>No phone on file</span>}
                  </div>
                  <div className="flex items-center gap-1.5 text-[12.5px]" style={{ color: c.inkSoft }}>
                    <Mail className="h-3 w-3" style={{ color: c.inkMute }} />
                    {unit.tenantEmail || <span style={{ color: c.inkMute }}>No email on file</span>}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-5 gap-3">
            {[
              { label: "Building", value: `Bldg ${String(unit.building).padStart(2, "0")}` },
              { label: "Bedrooms", value: unit.beds },
              { label: "Bathrooms", value: unit.baths },
              { label: "Sq Ft", value: unit.sqft.toLocaleString() },
              { label: "Open WOs", value: unitWOs.filter(w => w.status !== "done").length, highlight: true },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border p-3" style={{ borderColor: c.borderSoft }}>
                <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: c.inkMute, fontWeight: 700 }}>{s.label}</div>
                <div
                  className="text-[18px] font-mono-num"
                  style={{
                    fontWeight: 700,
                    color: s.highlight && Number(s.value) > 0 ? c.cobalt : c.ink,
                  }}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border overflow-hidden" style={{ background: c.panel, borderColor: c.border }}>
          <div className="flex gap-0.5 border-b px-2 pt-2" style={{ borderColor: c.border }}>
            {TABS.map((tab) => {
              const isActive = tab === activeTab;
              const count = tab === "Work Orders" ? unitWOs.length : null;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="inline-flex items-center gap-1.5 rounded-t-md px-4 py-2.5 text-[13px] transition-colors border-b-2"
                  style={{
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? c.cobalt : c.inkSoft,
                    borderBottomColor: isActive ? c.cobalt : "transparent",
                    background: isActive ? c.cobaltSoft : "transparent",
                  }}
                >
                  {tabIcons[tab]}
                  {tab}
                  {count !== null && count > 0 && (
                    <span className="font-mono-num rounded px-1 py-0.5 text-[11px]" style={{ background: c.cobalt, color: "#fff", fontWeight: 700 }}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="p-5">
            {activeTab === "Overview" && (
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="text-[13px] font-semibold uppercase tracking-wider mb-3" style={{ color: c.inkMute }}>Summary</div>
                  <div className="space-y-2.5">
                    {[
                      { label: "Building", value: building ? `${building.address} (Bldg ${unit.building})` : `Bldg ${unit.building}` },
                      { label: "Street", value: building?.street ?? "—" },
                      { label: "Year Built", value: building?.yearBuilt ?? "—" },
                      { label: "Roof Year", value: building?.roofYear ?? "—", warning: building ? 2026 - building.roofYear >= 12 : false },
                      { label: "Building Status", value: building ? (building.status === "good" ? "Healthy" : building.status === "watch" ? "Watch" : "Urgent") : "—" },
                    ].map((row) => (
                      <div key={row.label} className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: c.borderSoft }}>
                        <span className="text-[13px]" style={{ color: c.inkMute }}>{row.label}</span>
                        <span
                          className="text-[13px]"
                          style={{ fontWeight: 600, color: "warning" in row && row.warning ? c.amber : c.ink }}
                        >
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[13px] font-semibold uppercase tracking-wider mb-3" style={{ color: c.inkMute }}>Activity Timeline</div>
                  <div className="relative pl-4 space-y-3">
                    <div className="absolute left-1.5 top-0 bottom-0 w-px" style={{ background: c.borderSoft }} />
                    {timelineEvents.map((ev, i) => (
                      <div key={i} className="relative flex items-start gap-3">
                        <div
                          className="absolute -left-3 mt-1.5 h-2 w-2 rounded-full"
                          style={{ background: ev.status === "urgent" ? c.rose : ev.status === "done" ? c.emerald : c.cobalt }}
                        />
                        <div>
                          <div className="text-[13px]" style={{ fontWeight: 600, color: c.ink }}>{ev.label}</div>
                          <div className="text-[12px] font-mono-num mt-0.5" style={{ color: c.inkMute }}>{ev.date}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "Work Orders" && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="text-[13.5px]" style={{ color: c.inkSoft }}>
                    {unitWOs.filter(w => w.status !== "done").length} open, {unitWOs.length} total
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowLogPast(true)}
                      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] hover:bg-slate-50"
                      style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 600 }}
                    >
                      <Clock className="h-3.5 w-3.5" /> Log past job
                    </button>
                    <Link
                      href="/work-orders/new"
                      className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] hover:opacity-90"
                      style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                    >
                      <Plus className="h-3.5 w-3.5" /> Create Work Order
                    </Link>
                  </div>
                </div>
                {unitWOs.length === 0 && histUnitWOs.length === 0 ? (
                  <div className="flex items-center gap-2 py-8 justify-center text-[13.5px]" style={{ color: c.inkMute }}>
                    <CheckCircle2 className="h-4 w-4" /> No work orders for this unit.
                  </div>
                ) : unitWOs.length === 0 ? null : (
                  <div className="space-y-2">
                    {unitWOs.map((w) => {
                      const sc = woStatusColors[w.status as WOStatus];
                      const pc = priColors[w.priority as keyof typeof priColors];
                      return (
                        <div
                          key={w.id}
                          className="flex items-center justify-between rounded-lg border p-3 hover:bg-slate-50 transition-colors"
                          style={{ borderColor: c.borderSoft }}
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-mono-num text-[13px]" style={{ fontWeight: 700, color: c.cobalt }}>{w.id}</span>
                            <div>
                              <div className="text-[13px]" style={{ fontWeight: 600, color: c.ink }}>{w.title}</div>
                              <div className="text-[11.5px] mt-0.5" style={{ color: c.inkMute }}>{w.category} · Opened {w.opened}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="rounded px-1.5 py-0.5 text-[11px] font-mono-num" style={{ background: pc.bg, color: pc.fg, fontWeight: 700 }}>
                              {w.priority.toUpperCase()}
                            </span>
                            <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: sc.bg, color: sc.fg, fontWeight: 700 }}>
                              {sc.label}
                            </span>
                            <Link
                              href={`/work-orders/${w.id}`}
                              className="ml-1 rounded px-2 py-1 text-[12px] hover:opacity-80"
                              style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 600 }}
                            >
                              View
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {histUnitWOs.length > 0 && (
                  <div className="mt-6">
                    <div className="flex items-center gap-2 mb-2 text-[13px]" style={{ color: c.inkMute, fontWeight: 700 }}>
                      <Clock className="h-3.5 w-3.5" /> Historical work ({histUnitWOs.length})
                    </div>
                    <div className="space-y-1.5">
                      {histUnitWOs.map((w: any) => (
                        <div key={w.id}
                          className="flex items-center justify-between rounded-lg border p-2.5"
                          style={{ borderColor: c.borderSoft, background: c.canvas }}>
                          <div className="flex items-center gap-3">
                            <span className="font-mono-num text-[12.5px]" style={{ fontWeight: 700, color: c.inkSoft }}>{w.id}</span>
                            <div>
                              <div className="text-[12.5px]" style={{ fontWeight: 600, color: c.ink }}>{w.title}</div>
                              <div className="text-[11px] mt-0.5" style={{ color: c.inkMute }}>
                                {w.category} · Completed {w.completedOn ?? "—"}{w.historicalVendorName ? ` · ${w.historicalVendorName}` : ""}
                              </div>
                            </div>
                          </div>
                          <span className="text-[12px] font-mono-num" style={{ color: c.inkSoft }}>
                            {w.actualCost != null ? `$${(w.actualCost / 100).toFixed(2)}` : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {showLogPast && unit && (
              <LogPastJobDialog
                building={unit.building}
                unit={unit.id}
                onClose={() => setShowLogPast(false)}
              />
            )}

            {activeTab === "Insurance" && (
              <div className="space-y-4">
                {bldgInsurance ? (
                  <div className="rounded-lg border p-4" style={{ borderColor: c.border }}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="text-[14px]" style={{ fontWeight: 700 }}>Building Insurance Policy</div>
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px]"
                        style={{
                          background: bldgInsurance.status === "current" ? c.emeraldSoft : bldgInsurance.status === "expiring" ? c.amberSoft : c.roseSoft,
                          color: bldgInsurance.status === "current" ? c.emerald : bldgInsurance.status === "expiring" ? c.amber : c.rose,
                          fontWeight: 700,
                        }}
                      >
                        {bldgInsurance.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: "Carrier", value: bldgInsurance.carrier },
                        { label: "Policy No.", value: bldgInsurance.policyNo },
                        { label: "Coverage", value: `$${bldgInsurance.coverage.toLocaleString()}` },
                        { label: "Annual Premium", value: `$${bldgInsurance.premium.toLocaleString()}` },
                        { label: "Expires", value: bldgInsurance.expires },
                      ].map((r) => (
                        <div key={r.label} className="rounded-md p-3" style={{ background: c.canvas }}>
                          <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: c.inkMute, fontWeight: 700 }}>{r.label}</div>
                          <div className="text-[14px] font-mono-num" style={{ fontWeight: 700 }}>{r.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 py-6 text-[13.5px]" style={{ color: c.inkMute }}>
                    <AlertTriangle className="h-4 w-4" style={{ color: c.rose }} />
                    No insurance policy on record for this building.
                  </div>
                )}
                <div
                  className="flex items-center gap-3 rounded-lg border-2 border-dashed p-5 cursor-pointer hover:bg-slate-50 transition-colors"
                  style={{ borderColor: c.border }}
                >
                  <Upload className="h-5 w-5" style={{ color: c.inkMute }} />
                  <div>
                    <div className="text-[13px]" style={{ fontWeight: 600 }}>Upload Insurance Document</div>
                    <div className="text-[12px] mt-0.5" style={{ color: c.inkMute }}>PDF, PNG or JPG up to 20MB</div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "Correspondence" && (
              <div className="space-y-3">
                <div className="text-[13px] mb-3" style={{ color: c.inkSoft }}>Letters and notices sent to this unit.</div>
                {[
                  { date: "2026-04-15", title: "Work Order Notification — WO-1042", type: "Notice" },
                  { date: "2026-03-01", title: "Annual HOA Fee Statement", type: "Statement" },
                  { date: "2026-01-10", title: "Community Update — Winter 2026", type: "Newsletter" },
                ].map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg border p-3 hover:bg-slate-50 cursor-pointer transition-colors"
                    style={{ borderColor: c.borderSoft }}
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="h-4 w-4 shrink-0" style={{ color: c.inkMute }} />
                      <div>
                        <div className="text-[13px]" style={{ fontWeight: 600, color: c.ink }}>{item.title}</div>
                        <div className="text-[11.5px] mt-0.5" style={{ color: c.inkMute }}>{item.type} · {item.date}</div>
                      </div>
                    </div>
                    <span className="text-[12px] px-2 py-0.5 rounded" style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 600 }}>
                      View
                    </span>
                  </div>
                ))}
                <div
                  className="flex items-center gap-3 rounded-lg border-2 border-dashed p-5 cursor-pointer hover:bg-slate-50 transition-colors"
                  style={{ borderColor: c.border }}
                >
                  <Upload className="h-5 w-5" style={{ color: c.inkMute }} />
                  <div>
                    <div className="text-[13px]" style={{ fontWeight: 600 }}>Upload Correspondence</div>
                    <div className="text-[12px] mt-0.5" style={{ color: c.inkMute }}>PDF up to 20MB</div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "Roof Documents" && building && (
              <div className="space-y-4">
                <div>
                  <div className="text-[13px] font-semibold uppercase tracking-wider mb-3" style={{ color: c.inkMute }}>Inspection History</div>
                  <div className="space-y-2.5">
                    {[
                      { date: building.roofYear.toString(), label: "Roof replacement completed", notes: "Full tear-off and re-sheet. 30-yr architectural shingles." },
                      { date: "2024", label: "Annual roof inspection", notes: "No issues. Flashing intact." },
                      { date: "2023", label: "Wind event follow-up", notes: "Minor granule loss on SE slope. Monitored." },
                    ].map((ev, i) => (
                      <div key={i} className="flex items-start gap-3 rounded-lg border p-3" style={{ borderColor: c.borderSoft }}>
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0 font-mono-num text-[13px]" style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}>
                          {ev.date}
                        </div>
                        <div>
                          <div className="text-[13px]" style={{ fontWeight: 600, color: c.ink }}>{ev.label}</div>
                          <div className="text-[12px] mt-0.5" style={{ color: c.inkMute }}>{ev.notes}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div
                  className="flex items-center gap-3 rounded-lg border-2 border-dashed p-5 cursor-pointer hover:bg-slate-50 transition-colors"
                  style={{ borderColor: c.border }}
                >
                  <Upload className="h-5 w-5" style={{ color: c.inkMute }} />
                  <div>
                    <div className="text-[13px]" style={{ fontWeight: 600 }}>Upload Roof Photo or Document</div>
                    <div className="text-[12px] mt-0.5" style={{ color: c.inkMute }}>PDF, PNG or JPG up to 20MB</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showEditForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="w-full max-w-2xl rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-y-auto" style={{ background: c.panel }}>
            <div className="flex items-center justify-between mb-5">
              <div className="text-[17px]" style={{ fontWeight: 700 }}>Edit Unit {unit.id}</div>
            </div>
            <form onSubmit={handleEdit} className="space-y-5">
              <div>
                <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Address</label>
                <input
                  value={editForm.address ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                  required
                  className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                  style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                />
              </div>
              <div>
                <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Occupancy</label>
                <select
                  value={editForm.occupancy ?? "owner"}
                  onChange={(e) => setEditForm({ ...editForm, occupancy: e.target.value as UpdateUnitBody["occupancy"] })}
                  className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                  style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                >
                  <option value="owner">Owner Occupied</option>
                  <option value="tenant">Tenant Occupied</option>
                  <option value="vacant">Vacant</option>
                </select>
              </div>

              <div className="rounded-lg border p-4 space-y-4" style={{ borderColor: c.borderSoft, background: c.canvas }}>
                <div className="flex items-center gap-1.5 text-[12px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>
                  <User className="h-3.5 w-3.5" /> Owner Information (Required)
                </div>
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Owner Name</label>
                  <input
                    value={editForm.ownerName ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, ownerName: e.target.value })}
                    required
                    className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, background: c.panel, color: c.ink }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Owner Phone</label>
                    <input
                      type="tel"
                      value={editForm.ownerPhone ?? ""}
                      onChange={(e) => setEditForm({ ...editForm, ownerPhone: e.target.value })}
                      placeholder="(555) 123-4567"
                      required
                      className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                      style={{ borderColor: c.border, background: c.panel, color: c.ink }}
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Owner Email</label>
                    <input
                      type="email"
                      value={editForm.ownerEmail ?? ""}
                      onChange={(e) => setEditForm({ ...editForm, ownerEmail: e.target.value })}
                      placeholder="owner@example.com"
                      required
                      className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                      style={{ borderColor: c.border, background: c.panel, color: c.ink }}
                    />
                  </div>
                </div>
              </div>

              {editForm.occupancy === "tenant" && (
                <div className="rounded-lg border p-4 space-y-4" style={{ borderColor: c.amber, background: "#FFFBEB" }}>
                  <div className="flex items-center gap-1.5 text-[12px] uppercase tracking-wider" style={{ color: c.amber, fontWeight: 700 }}>
                    <UserCheck className="h-3.5 w-3.5" /> Tenant Information
                  </div>
                  <div>
                    <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Tenant Name</label>
                    <input
                      value={editForm.tenantName ?? ""}
                      onChange={(e) => setEditForm({ ...editForm, tenantName: e.target.value })}
                      className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                      style={{ borderColor: c.border, background: c.panel, color: c.ink }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Tenant Phone</label>
                      <input
                        type="tel"
                        value={editForm.tenantPhone ?? ""}
                        onChange={(e) => setEditForm({ ...editForm, tenantPhone: e.target.value })}
                        placeholder="(555) 123-4567"
                        className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                        style={{ borderColor: c.border, background: c.panel, color: c.ink }}
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Tenant Email</label>
                      <input
                        type="email"
                        value={editForm.tenantEmail ?? ""}
                        onChange={(e) => setEditForm({ ...editForm, tenantEmail: e.target.value })}
                        placeholder="tenant@example.com"
                        className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                        style={{ borderColor: c.border, background: c.panel, color: c.ink }}
                      />
                    </div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Beds</label>
                  <input
                    type="number"
                    min={0}
                    value={editForm.beds ?? 0}
                    onChange={(e) => setEditForm({ ...editForm, beds: parseInt(e.target.value) || 0 })}
                    className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Baths</label>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={editForm.baths ?? 0}
                    onChange={(e) => setEditForm({ ...editForm, baths: parseFloat(e.target.value) || 0 })}
                    className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Sq Ft</label>
                  <input
                    type="number"
                    min={1}
                    value={editForm.sqft ?? 0}
                    onChange={(e) => setEditForm({ ...editForm, sqft: parseInt(e.target.value) || 0 })}
                    className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
              </div>
              {editError && (
                <div className="rounded-md px-3 py-2 text-[12.5px]" style={{ background: c.roseSoft, color: c.rose }}>
                  {editError}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowEditForm(false)}
                  className="rounded-md border px-4 py-2 text-[13px] hover:bg-slate-50 transition-colors"
                  style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="rounded-md px-4 py-2 text-[13px] hover:opacity-90 transition-opacity disabled:opacity-60"
                  style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                >
                  {updateMutation.isPending ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="w-full max-w-sm rounded-2xl shadow-xl p-6" style={{ background: c.panel }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: c.roseSoft }}>
                <Trash2 className="h-5 w-5" style={{ color: c.rose }} />
              </div>
              <div>
                <div className="text-[15px]" style={{ fontWeight: 700 }}>Delete Unit</div>
                <div className="text-[13px]" style={{ color: c.inkSoft }}>Unit {unit.id}</div>
              </div>
            </div>
            <p className="text-[13.5px] mb-5" style={{ color: c.inkSoft }}>
              This will permanently delete this unit and all associated data. This action cannot be undone.
            </p>
            {deleteError && (
              <div className="rounded-md px-3 py-2 mb-4 text-[12.5px]" style={{ background: c.roseSoft, color: c.rose }}>
                {deleteError}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="rounded-md border px-4 py-2 text-[13px] hover:bg-slate-50 transition-colors"
                style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="rounded-md px-4 py-2 text-[13px] hover:opacity-90 transition-opacity disabled:opacity-60"
                style={{ background: c.rose, color: "#fff", fontWeight: 600 }}
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete Unit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
