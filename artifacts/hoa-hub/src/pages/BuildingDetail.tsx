import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { c, statusColor, statusLabel, statusSoft } from "@/lib/theme";
import type { Status } from "@/lib/theme";
import type { WOStatus } from "@/lib/data";
import {
  ArrowLeft, Building2, Home, ClipboardList, ShieldCheck,
  FileText, MessageSquare, HardHat, AlertTriangle, CheckCircle2, Trash2, Pencil, Clock,
} from "lucide-react";
import { LogPastJobDialog } from "@/components/LogPastJobDialog";
import { BuildingSystemsSection } from "@/components/BuildingSystemsSection";
import { InsuranceHistorySection } from "@/components/InsuranceHistorySection";
import { useAuth } from "@/contexts/AuthContext";
import {
  useGetBuilding,
  useListUnits,
  useListWorkOrders,
  useGetInsurance,
  useListDocuments,
  useDeleteBuilding,
  useUpdateBuilding,
  useCreateUnit,
  getListUnitsQueryKey,
  getListWorkOrdersQueryKey,
  getGetInsuranceQueryKey,
  getListDocumentsQueryKey,
  getListBuildingsQueryKey,
  getGetBuildingQueryKey,
} from "@workspace/api-client-react";
import type { UpdateBuildingBody, CreateUnitBody } from "@workspace/api-client-react";
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

const insColors = {
  current:  { bg: "#DCF3EC", fg: "#0E8A6B" },
  expiring: { bg: "#FBEFD6", fg: "#A66C0E" },
  missing:  { bg: "#FBE3E9", fg: "#B8264C" },
};

export default function BuildingDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const buildingNum = Number(id);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canEditHistorical = user?.role === "admin" || user?.role === "manager";

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [showEditForm, setShowEditForm] = useState(false);
  const [editForm, setEditForm] = useState<Partial<UpdateBuildingBody>>({});
  const [editError, setEditError] = useState("");
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [addUnitForm, setAddUnitForm] = useState<Partial<CreateUnitBody>>({});
  const [addUnitError, setAddUnitError] = useState("");

  const { data: building, isLoading } = useGetBuilding(buildingNum);
  const { data: bldgUnits = [] } = useListUnits(
    { building: buildingNum },
    { query: { enabled: !!buildingNum, queryKey: getListUnitsQueryKey({ building: buildingNum }) } },
  );
  const { data: bldgWOs = [] } = useListWorkOrders(
    { building: buildingNum },
    { query: { enabled: !!buildingNum, queryKey: getListWorkOrdersQueryKey({ building: buildingNum }) } },
  );
  const { data: histWOs = [] } = useListWorkOrders(
    { building: buildingNum, historical: "true" } as any,
    { query: { enabled: !!buildingNum, queryKey: getListWorkOrdersQueryKey({ building: buildingNum, historical: "true" } as any) } },
  );
  const [showLogPast, setShowLogPast] = useState(false);
  const { data: bldgInsurance } = useGetInsurance(
    buildingNum,
    { query: { enabled: !!buildingNum, queryKey: getGetInsuranceQueryKey(buildingNum) } },
  );
  const { data: bldgDocs = [] } = useListDocuments(
    { building: buildingNum },
    { query: { enabled: !!buildingNum, queryKey: getListDocumentsQueryKey({ building: buildingNum }) } },
  );

  const deleteMutation = useDeleteBuilding();
  const updateMutation = useUpdateBuilding();
  const createUnitMutation = useCreateUnit();

  if (isLoading) {
    return (
      <Layout title="Building">
        <div className="py-16 text-center text-[13px]" style={{ color: c.inkMute }}>Loading…</div>
      </Layout>
    );
  }

  if (!building) {
    return (
      <Layout title="Building Not Found">
        <Link href="/buildings" className="inline-flex items-center gap-1.5 text-[13px] hover:underline" style={{ color: c.cobalt }}>
          <ArrowLeft className="h-4 w-4" /> Back to Buildings
        </Link>
      </Layout>
    );
  }

  const roofAge = 2026 - building.roofYear;
  const roofWarning = roofAge >= 12;

  const docCategories = [
    { label: "Work Orders", icon: ClipboardList, count: bldgWOs.length },
    { label: "Insurance", icon: ShieldCheck, count: bldgInsurance ? 1 : 0 },
    { label: "Correspondence", icon: MessageSquare, count: 2 },
    { label: "Roof Documents", icon: HardHat, count: bldgDocs.filter(d => d.category === "Inspection").length + 1 },
  ];

  const ic = insColors[building.insuranceStatus as keyof typeof insColors];

  async function handleDelete() {
    setDeleteError("");
    try {
      await deleteMutation.mutateAsync({ id: buildingNum });
      await queryClient.invalidateQueries({ queryKey: getListBuildingsQueryKey() });
      navigate("/buildings");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to delete building.";
      setDeleteError(message);
    }
  }

  function openEditForm() {
    setEditForm({
      address: building!.address,
      street: building!.street,
      units: building!.units,
      yearBuilt: building!.yearBuilt,
      roofYear: building!.roofYear,
      status: building!.status as UpdateBuildingBody["status"],
      insuranceStatus: building!.insuranceStatus as UpdateBuildingBody["insuranceStatus"],
      notes: building!.notes ?? "",
    });
    setEditError("");
    setShowEditForm(true);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    setEditError("");
    try {
      await updateMutation.mutateAsync({ id: buildingNum, data: editForm });
      await queryClient.invalidateQueries({ queryKey: getGetBuildingQueryKey(buildingNum) });
      await queryClient.invalidateQueries({ queryKey: getListBuildingsQueryKey() });
      setShowEditForm(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update building.";
      setEditError(message);
    }
  }

  async function handleAddUnit(e: React.FormEvent) {
    e.preventDefault();
    setAddUnitError("");
    if (!addUnitForm.unit || !addUnitForm.address || !addUnitForm.occupancy || !addUnitForm.ownerName || !addUnitForm.ownerPhone || !addUnitForm.ownerEmail) {
      setAddUnitError("Please fill in all required fields, including owner contact details.");
      return;
    }
    try {
      await createUnitMutation.mutateAsync({
        data: {
          building: buildingNum,
          unit: addUnitForm.unit,
          address: addUnitForm.address,
          beds: Number(addUnitForm.beds) || 0,
          baths: Number(addUnitForm.baths) || 0,
          sqft: Number(addUnitForm.sqft) || 0,
          occupancy: addUnitForm.occupancy as CreateUnitBody["occupancy"],
          ownerName: addUnitForm.ownerName,
          ownerPhone: addUnitForm.ownerPhone,
          ownerEmail: addUnitForm.ownerEmail,
          tenantName: addUnitForm.tenantName || null,
          tenantPhone: addUnitForm.tenantPhone || null,
          tenantEmail: addUnitForm.tenantEmail || null,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListUnitsQueryKey({ building: buildingNum }) });
      await queryClient.invalidateQueries({ queryKey: getGetBuildingQueryKey(buildingNum) });
      setAddUnitForm({});
      setShowAddUnit(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create unit.";
      setAddUnitError(message);
    }
  }

  return (
    <Layout
      title={`Building ${String(building.num).padStart(2, "0")}`}
      subtitle={building.address}
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/buildings"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-[13px] hover:bg-slate-50 transition-colors"
            style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
          >
            <ArrowLeft className="h-4 w-4" /> Buildings
          </Link>
          <button
            onClick={openEditForm}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-[13px] hover:bg-slate-50 transition-colors"
            style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
          >
            <Pencil className="h-4 w-4" /> Edit
          </button>
          <button
            onClick={() => { setDeleteError(""); setShowDeleteDialog(true); }}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-[13px] hover:bg-red-50 transition-colors"
            style={{ borderColor: c.rose, color: c.rose, fontWeight: 500 }}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl" style={{ background: statusSoft[building.status as Status] }}>
                <Building2 className="h-7 w-7" style={{ color: statusColor[building.status as Status] }} />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="text-[22px]" style={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
                    Building {String(building.num).padStart(2, "0")}
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]"
                    style={{ background: statusSoft[building.status as Status], color: statusColor[building.status as Status], fontWeight: 700 }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor[building.status as Status] }} />
                    {statusLabel[building.status as Status]}
                  </span>
                </div>
                <div className="mt-0.5 text-[14px]" style={{ color: c.inkSoft }}>{building.address} · {building.street}</div>
              </div>
            </div>
            {building.notes && (
              <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-[13px] max-w-xs" style={{ background: c.roseSoft, color: c.rose }}>
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span style={{ fontWeight: 500 }}>{building.notes}</span>
              </div>
            )}
          </div>

          <div className="mt-5 grid grid-cols-6 gap-3">
            {[
              { label: "Units", value: building.units, icon: Home },
              { label: "Year Built", value: building.yearBuilt, icon: null },
              { label: "Roof Year", value: building.roofYear, warning: roofWarning, icon: null },
              { label: "Roof Age", value: `${roofAge}y`, warning: roofWarning, icon: null },
              { label: "Open WOs", value: building.openWO, highlight: building.openWO > 0, icon: null },
              { label: "Insurance", value: building.insuranceStatus.toUpperCase(), statusBg: ic.bg, statusFg: ic.fg, icon: null },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border p-3" style={{ borderColor: c.borderSoft }}>
                <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: c.inkMute, fontWeight: 700 }}>{s.label}</div>
                {"statusBg" in s && s.statusBg ? (
                  <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: s.statusBg, color: s.statusFg, fontWeight: 700 }}>
                    {s.value}
                  </span>
                ) : (
                  <div
                    className="text-[18px] font-mono-num"
                    style={{
                      fontWeight: 700,
                      color: "warning" in s && s.warning ? c.amber : "highlight" in s && s.highlight ? c.cobalt : c.ink,
                    }}
                  >
                    {s.value}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {docCategories.map((cat) => {
            const Icon = cat.icon;
            return (
              <div
                key={cat.label}
                className="rounded-xl border p-4 cursor-pointer hover:shadow-sm transition-shadow"
                style={{ background: c.panel, borderColor: c.border }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: c.cobaltSoft }}>
                    <Icon className="h-4.5 w-4.5" style={{ color: c.cobalt }} />
                  </div>
                  <span className="font-mono-num text-[18px]" style={{ fontWeight: 700, color: c.ink }}>{cat.count}</span>
                </div>
                <div className="text-[13px]" style={{ fontWeight: 600, color: c.ink }}>{cat.label}</div>
                <div className="text-[12px] mt-0.5" style={{ color: c.inkMute }}>
                  {cat.count === 0 ? "No records" : `${cat.count} file${cat.count !== 1 ? "s" : ""}`}
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-xl border overflow-hidden" style={{ background: c.panel, borderColor: c.border }}>
          <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: c.border }}>
            <div>
              <div className="text-[15px]" style={{ fontWeight: 700 }}>Units</div>
              <div className="text-[12.5px] mt-0.5" style={{ color: c.inkMute }}>{bldgUnits.length} units in this building</div>
            </div>
            <button
              onClick={() => { setAddUnitForm({}); setAddUnitError(""); setShowAddUnit(true); }}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] hover:opacity-90 transition-opacity"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
            >
              + Add Unit
            </button>
          </div>
          <table className="w-full text-[13px]">
            <thead style={{ background: c.canvas }}>
              <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: c.inkMute }}>
                {["Unit", "Address", "Owner", "Beds/Baths", "SqFt", "Occupancy", "Roof", "Insurance", "WOs", ""].map((h) => (
                  <th key={h} className="px-4 py-3" style={{ fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bldgUnits.map((u) => {
                const unitWOs = bldgWOs.filter((w) => w.unit === u.id && w.status !== "done");
                const occC = u.occupancy === "owner"
                  ? { bg: "#E5E8FF", fg: "#3245FF" }
                  : u.occupancy === "tenant"
                  ? { bg: "#FBEFD6", fg: "#A66C0E" }
                  : { bg: "#EFF1F8", fg: "#5A6285" };
                return (
                  <tr key={u.id} className="border-t hover:bg-slate-50" style={{ borderColor: c.borderSoft }}>
                    <td className="px-4 py-2.5 font-mono-num" style={{ fontWeight: 700, color: c.ink }}>{u.id}</td>
                    <td className="px-4 py-2.5" style={{ color: c.inkSoft }}>{u.address}</td>
                    <td className="px-4 py-2.5" style={{ fontWeight: 600, color: c.ink }}>{u.ownerName}</td>
                    <td className="px-4 py-2.5 font-mono-num" style={{ color: c.inkSoft }}>{u.beds}bd / {u.baths}ba</td>
                    <td className="px-4 py-2.5 font-mono-num" style={{ color: c.inkSoft }}>{u.sqft.toLocaleString()}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-full px-2 py-0.5 text-[11px] capitalize" style={{ background: occC.bg, color: occC.fg, fontWeight: 700 }}>
                        {u.occupancy}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono-num" style={{ color: roofWarning ? c.amber : c.inkSoft, fontWeight: roofWarning ? 700 : 500 }}>
                      {building.roofYear}
                      <span className="ml-1 text-[11px]" style={{ color: roofWarning ? c.amber : c.inkMute }}>({roofAge}y)</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px]"
                        style={{
                          background: building.insuranceStatus === "current" ? c.emeraldSoft : building.insuranceStatus === "expiring" ? c.amberSoft : c.roseSoft,
                          color: building.insuranceStatus === "current" ? c.emerald : building.insuranceStatus === "expiring" ? c.amber : c.rose,
                          fontWeight: 700,
                        }}
                      >
                        {building.insuranceStatus.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono-num" style={{ color: unitWOs.length > 0 ? c.cobalt : c.inkMute, fontWeight: unitWOs.length > 0 ? 700 : 500 }}>
                      {unitWOs.length > 0 ? unitWOs.length : "—"}
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
        </div>

        {bldgWOs.length > 0 && (
          <div className="rounded-xl border overflow-hidden" style={{ background: c.panel, borderColor: c.border }}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: c.border }}>
              <div>
                <div className="text-[15px]" style={{ fontWeight: 700 }}>Work Orders</div>
                <div className="text-[12.5px] mt-0.5" style={{ color: c.inkMute }}>{bldgWOs.filter(w => w.status !== "done").length} open · {bldgWOs.length} total</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowLogPast(true)}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] hover:bg-slate-50"
                  style={{ background: c.canvas, color: c.inkSoft, border: `1px solid ${c.border}`, fontWeight: 600 }}
                >
                  <Clock className="h-3.5 w-3.5" /> Log past job
                </button>
                <Link
                  href="/work-orders/new"
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] hover:opacity-90"
                  style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                >
                  + New
                </Link>
              </div>
            </div>
            <table className="w-full text-[13px]">
              <thead style={{ background: c.canvas }}>
                <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: c.inkMute }}>
                  {["WO #", "Title", "Category", "Priority", "Status", ""].map((h) => (
                    <th key={h} className="px-4 py-3" style={{ fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bldgWOs.map((w) => {
                  const sc = woStatusColors[w.status as WOStatus];
                  const pc = priColors[w.priority as keyof typeof priColors];
                  return (
                    <tr key={w.id} className="border-t hover:bg-slate-50" style={{ borderColor: c.borderSoft }}>
                      <td className="px-4 py-2.5 font-mono-num" style={{ fontWeight: 700, color: c.cobalt }}>{w.id}</td>
                      <td className="px-4 py-2.5 max-w-xs">
                        <div className="truncate" style={{ fontWeight: 600, color: c.ink }}>{w.title}</div>
                        {w.unit && <div className="text-[11.5px]" style={{ color: c.inkMute }}>Unit {w.unit.split("-")[1] ?? w.unit}</div>}
                      </td>
                      <td className="px-4 py-2.5" style={{ color: c.inkSoft }}>{w.category}</td>
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
                          className="rounded px-2 py-1 text-[12px] hover:opacity-80"
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
          </div>
        )}

        {histWOs.length > 0 && (
          <div className="rounded-xl border overflow-hidden" style={{ background: c.panel, borderColor: c.border }}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: c.border }}>
              <div>
                <div className="text-[15px] flex items-center gap-2" style={{ fontWeight: 700 }}>
                  <Clock className="h-4 w-4" style={{ color: c.inkMute }} /> Historical work
                </div>
                <div className="text-[12.5px] mt-0.5" style={{ color: c.inkMute }}>
                  {histWOs.length} backfilled job{histWOs.length === 1 ? "" : "s"} · excluded from current spend reports
                </div>
              </div>
            </div>
            <table className="w-full text-[13px]">
              <thead style={{ background: c.canvas }}>
                <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: c.inkMute }}>
                  {["WO #", "Title", "Category", "Completed", "Cost", "Vendor"].map((h) => (
                    <th key={h} className="px-4 py-3" style={{ fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {histWOs.map((w: any) => (
                  <tr key={w.id} className="border-t" style={{ borderColor: c.borderSoft }}>
                    <td className="px-4 py-2.5 font-mono-num" style={{ fontWeight: 700, color: c.cobalt }}>{w.id}</td>
                    <td className="px-4 py-2.5" style={{ fontWeight: 600, color: c.ink }}>{w.title}</td>
                    <td className="px-4 py-2.5" style={{ color: c.inkSoft }}>{w.category}</td>
                    <td className="px-4 py-2.5 font-mono-num" style={{ color: c.inkSoft }}>{w.completedOn ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono-num" style={{ color: c.inkSoft }}>
                      {w.actualCost != null ? `$${(w.actualCost / 100).toFixed(2)}` : "—"}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: c.inkSoft }}>{w.historicalVendorName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showLogPast && (
          <LogPastJobDialog
            building={buildingNum}
            onClose={() => setShowLogPast(false)}
          />
        )}

        <BuildingSystemsSection building={buildingNum} canEdit={canEditHistorical} />
        <InsuranceHistorySection building={buildingNum} canEdit={canEditHistorical} />

        {building.notes ? (
          <div className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
            <div className="text-[13px] font-semibold uppercase tracking-wider mb-3" style={{ color: c.inkMute }}>Notes</div>
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" style={{ color: c.rose }} />
              <p className="text-[14px]" style={{ color: c.ink, fontWeight: 500 }}>{building.notes}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
            <div className="text-[13px] font-semibold uppercase tracking-wider mb-3" style={{ color: c.inkMute }}>Notes</div>
            <div className="flex items-center gap-2 py-4 text-[13.5px]" style={{ color: c.inkMute }}>
              <CheckCircle2 className="h-4 w-4" />
              No notes for this building.
            </div>
          </div>
        )}
      </div>

      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="w-full max-w-sm rounded-2xl shadow-xl p-6" style={{ background: c.panel }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: c.roseSoft }}>
                <Trash2 className="h-5 w-5" style={{ color: c.rose }} />
              </div>
              <div>
                <div className="text-[15px]" style={{ fontWeight: 700 }}>Delete Building</div>
                <div className="text-[13px]" style={{ color: c.inkSoft }}>Building {String(building.num).padStart(2, "0")}</div>
              </div>
            </div>
            <p className="text-[13.5px] mb-5" style={{ color: c.inkSoft }}>
              This will permanently delete this building and all associated data. This action cannot be undone.
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
                {deleteMutation.isPending ? "Deleting…" : "Delete Building"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddUnit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="w-full max-w-2xl rounded-2xl shadow-xl p-6 overflow-y-auto max-h-[90vh]" style={{ background: c.panel }}>
            <div className="flex items-center justify-between mb-5">
              <div className="text-[17px]" style={{ fontWeight: 700 }}>Add Unit to Building {String(building.num).padStart(2, "0")}</div>
            </div>
            <form onSubmit={handleAddUnit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Unit Number *</label>
                  <input
                    value={addUnitForm.unit ?? ""}
                    onChange={(e) => setAddUnitForm({ ...addUnitForm, unit: e.target.value })}
                    placeholder="e.g. 101"
                    required
                    className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, color: c.ink }}
                  />
                  <div className="text-[11px] mt-1" style={{ color: c.inkMute }}>ID will be: {buildingNum}-{addUnitForm.unit || "…"}</div>
                </div>
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Address *</label>
                  <input
                    value={addUnitForm.address ?? ""}
                    onChange={(e) => setAddUnitForm({ ...addUnitForm, address: e.target.value })}
                    placeholder="Unit address"
                    required
                    className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, color: c.ink }}
                  />
                </div>
              </div>
              <div className="rounded-lg border p-3" style={{ borderColor: c.border, background: "#f8fafc" }}>
                <div className="text-[12px] mb-3" style={{ color: c.inkSoft, fontWeight: 700, letterSpacing: "0.02em", textTransform: "uppercase" }}>Owner Information</div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Owner Name *</label>
                    <input
                      value={addUnitForm.ownerName ?? ""}
                      onChange={(e) => setAddUnitForm({ ...addUnitForm, ownerName: e.target.value })}
                      placeholder="Owner full name"
                      required
                      className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2"
                      style={{ borderColor: c.border, color: c.ink }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Owner Phone *</label>
                      <input
                        type="tel"
                        value={addUnitForm.ownerPhone ?? ""}
                        onChange={(e) => setAddUnitForm({ ...addUnitForm, ownerPhone: e.target.value })}
                        placeholder="(555) 123-4567"
                        required
                        className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2"
                        style={{ borderColor: c.border, color: c.ink }}
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Owner Email *</label>
                      <input
                        type="email"
                        value={addUnitForm.ownerEmail ?? ""}
                        onChange={(e) => setAddUnitForm({ ...addUnitForm, ownerEmail: e.target.value })}
                        placeholder="owner@example.com"
                        required
                        className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2"
                        style={{ borderColor: c.border, color: c.ink }}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Occupancy *</label>
                <select
                  value={addUnitForm.occupancy ?? ""}
                  onChange={(e) => setAddUnitForm({ ...addUnitForm, occupancy: e.target.value as CreateUnitBody["occupancy"] })}
                  required
                  className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2"
                  style={{ borderColor: c.border, color: c.ink }}
                >
                  <option value="">Select…</option>
                  <option value="owner">Owner</option>
                  <option value="tenant">Tenant</option>
                  <option value="vacant">Vacant</option>
                </select>
              </div>
              {addUnitForm.occupancy === "tenant" && (
                <div className="rounded-lg border p-3" style={{ borderColor: "#fbbf24", background: "#fffbeb" }}>
                  <div className="text-[12px] mb-3" style={{ color: "#92400e", fontWeight: 700, letterSpacing: "0.02em", textTransform: "uppercase" }}>Tenant Information</div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Tenant Name</label>
                      <input
                        value={addUnitForm.tenantName ?? ""}
                        onChange={(e) => setAddUnitForm({ ...addUnitForm, tenantName: e.target.value })}
                        placeholder="Tenant full name"
                        className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2"
                        style={{ borderColor: c.border, color: c.ink }}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Tenant Phone</label>
                        <input
                          type="tel"
                          value={addUnitForm.tenantPhone ?? ""}
                          onChange={(e) => setAddUnitForm({ ...addUnitForm, tenantPhone: e.target.value })}
                          placeholder="(555) 123-4567"
                          className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2"
                          style={{ borderColor: c.border, color: c.ink }}
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Tenant Email</label>
                        <input
                          type="email"
                          value={addUnitForm.tenantEmail ?? ""}
                          onChange={(e) => setAddUnitForm({ ...addUnitForm, tenantEmail: e.target.value })}
                          placeholder="tenant@example.com"
                          className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2"
                          style={{ borderColor: c.border, color: c.ink }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Bedrooms *</label>
                  <input
                    type="number" min={0} required
                    value={addUnitForm.beds ?? ""}
                    onChange={(e) => setAddUnitForm({ ...addUnitForm, beds: Number(e.target.value) })}
                    className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, color: c.ink }}
                  />
                </div>
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Bathrooms *</label>
                  <input
                    type="number" min={0} step={0.5} required
                    value={addUnitForm.baths ?? ""}
                    onChange={(e) => setAddUnitForm({ ...addUnitForm, baths: Number(e.target.value) })}
                    className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, color: c.ink }}
                  />
                </div>
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Sq Ft *</label>
                  <input
                    type="number" min={1} required
                    value={addUnitForm.sqft ?? ""}
                    onChange={(e) => setAddUnitForm({ ...addUnitForm, sqft: Number(e.target.value) })}
                    className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, color: c.ink }}
                  />
                </div>
              </div>
              {addUnitError && (
                <div className="rounded-md px-3 py-2 text-[12.5px]" style={{ background: c.roseSoft, color: c.rose }}>
                  {addUnitError}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddUnit(false)}
                  className="rounded-md border px-4 py-2 text-[13px] hover:bg-slate-50 transition-colors"
                  style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createUnitMutation.isPending}
                  className="rounded-md px-4 py-2 text-[13px] hover:opacity-90 transition-opacity disabled:opacity-60"
                  style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                >
                  {createUnitMutation.isPending ? "Adding…" : "Add Unit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="w-full max-w-lg rounded-2xl shadow-xl p-6 overflow-y-auto max-h-[90vh]" style={{ background: c.panel }}>
            <div className="flex items-center justify-between mb-5">
              <div className="text-[17px]" style={{ fontWeight: 700 }}>Edit Building {String(building.num).padStart(2, "0")}</div>
              <button onClick={() => setShowEditForm(false)} className="rounded-full p-1 hover:bg-slate-100">
                <FileText className="h-5 w-5 opacity-0 pointer-events-none" />
              </button>
            </div>
            <form onSubmit={handleEdit} className="space-y-4">
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
                <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Street</label>
                <input
                  value={editForm.street ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, street: e.target.value })}
                  required
                  className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                  style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Units</label>
                  <input
                    type="number"
                    min={0}
                    value={editForm.units ?? 0}
                    onChange={(e) => setEditForm({ ...editForm, units: parseInt(e.target.value) || 0 })}
                    className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Year Built</label>
                  <input
                    type="number"
                    value={editForm.yearBuilt ?? new Date().getFullYear()}
                    onChange={(e) => setEditForm({ ...editForm, yearBuilt: parseInt(e.target.value) || new Date().getFullYear() })}
                    className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Roof Year</label>
                  <input
                    type="number"
                    value={editForm.roofYear ?? new Date().getFullYear()}
                    onChange={(e) => setEditForm({ ...editForm, roofYear: parseInt(e.target.value) || new Date().getFullYear() })}
                    className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Status</label>
                  <select
                    value={editForm.status ?? "good"}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value as UpdateBuildingBody["status"] })}
                    className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                  >
                    <option value="good">Good</option>
                    <option value="watch">Watch</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Insurance</label>
                  <select
                    value={editForm.insuranceStatus ?? "current"}
                    onChange={(e) => setEditForm({ ...editForm, insuranceStatus: e.target.value as UpdateBuildingBody["insuranceStatus"] })}
                    className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                  >
                    <option value="current">Current</option>
                    <option value="expiring">Expiring</option>
                    <option value="missing">Missing</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>Notes (optional)</label>
                <textarea
                  value={editForm.notes ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value || null })}
                  rows={2}
                  className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2 resize-none"
                  style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                />
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
    </Layout>
  );
}
