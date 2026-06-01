import { useState, useRef } from "react";
import { useParams, Link } from "wouter";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import type { WOStatus } from "@/lib/data";
import {
  ArrowLeft, ClipboardList, CheckCircle2, Clock, AlertCircle,
  Wrench, CircleDot, TrendingUp, MessageSquare, Camera, Trash2,
  ArrowRightLeft, UserPlus, Image as ImageIcon, Send, Loader2,
  Pencil, X, Phone, Mail, User, ExternalLink, DollarSign,
} from "lucide-react";
import type { WorkOrder, WorkOrderEvent, WorkOrderAttachment, Document } from "@workspace/api-client-react";
import {
  useGetWorkOrder, useGetBuilding, useGetUnit, useListVendors, useGetVendor,
  useUpdateWorkOrder, useListWorkOrderEvents, useCreateWorkOrderComment,
  useDeleteWorkOrderAttachment,
  useUpdateWorkOrderComment, useDeleteWorkOrderComment,
  useListDocuments, useCreateDocument, useDeleteDocument, useRequestUploadUrl,
  getGetWorkOrderQueryKey, getListWorkOrdersQueryKey,
  getGetBuildingQueryKey, getGetUnitQueryKey, getListWorkOrderEventsQueryKey,
  getListVendorsQueryKey, getListDocumentsQueryKey, getGetVendorQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { VendorCombobox } from "@/components/VendorCombobox";
import { LivePhotoUploader } from "@/components/PhotoUploader";
import { useAuth } from "@/contexts/AuthContext";
import { ResolutionLinkCard } from "@/components/ResolutionLinkCard";
import { MotionAuthorizationCard } from "@/components/MotionAuthorizationCard";

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

type TimelineStep = {
  key: string;
  label: string;
  date?: string;
  icon: React.ReactNode;
  done: boolean;
  active: boolean;
};

function buildTimeline(wo: WorkOrder): TimelineStep[] {
  const steps: { key: string; label: string; icon: React.ReactNode }[] = [
    { key: "reported",    label: "Reported",         icon: <AlertCircle className="h-4 w-4" /> },
    { key: "scheduled",   label: "Vendor Assigned",  icon: <Wrench className="h-4 w-4" /> },
    { key: "in_progress", label: "Work In Progress", icon: <Clock className="h-4 w-4" /> },
    { key: "inspection",  label: "Inspection",        icon: <CircleDot className="h-4 w-4" /> },
    { key: "done",        label: "Closed",            icon: <CheckCircle2 className="h-4 w-4" /> },
  ];

  const order = ["reported", "scheduled", "in_progress", "inspection", "done"];
  const currentIdx = order.indexOf(wo.status === "open" ? "reported" : wo.status);

  return steps.map((s, i) => ({
    ...s,
    date: i === 0 ? wo.opened : i <= currentIdx && wo.due ? wo.due : undefined,
    done: i < currentIdx,
    active: i === currentIdx,
  }));
}

export default function WorkOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isResident = user?.role === "resident";
  const isManager = user?.role === "manager" || user?.role === "admin";
  const { data: wo, isLoading } = useGetWorkOrder(id ?? "");
  const { data: vendors = [] } = useListVendors(undefined, {
    query: { enabled: !isResident, queryKey: getListVendorsQueryKey() },
  });
  const updateMutation = useUpdateWorkOrder();
  const { data: activity } = useListWorkOrderEvents(id ?? "", {
    query: { enabled: !!id, queryKey: getListWorkOrderEventsQueryKey(id ?? "") },
  });
  const createComment = useCreateWorkOrderComment();
  const updateComment = useUpdateWorkOrderComment();
  const deleteComment = useDeleteWorkOrderComment();
  const deleteAttachment = useDeleteWorkOrderAttachment();
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<WorkOrderAttachment | null>(null);

  async function editComment(eventId: number, text: string) {
    if (!id) return;
    await updateComment.mutateAsync({ id, eventId, data: { text } });
    await refreshActivity();
  }

  async function removeComment(eventId: number) {
    if (!id) return;
    if (!confirm("Delete this comment?")) return;
    await deleteComment.mutateAsync({ id, eventId });
    await refreshActivity();
  }

  const events: WorkOrderEvent[] = activity?.events ?? [];
  const attachments: WorkOrderAttachment[] = activity?.attachments ?? [];

  const docsParams = { workOrderId: id ?? "" };
  const { data: woDocuments = [], queryKey: woDocsQueryKey } = useListDocuments(
    docsParams,
    { query: { enabled: !!id, queryKey: getListDocumentsQueryKey(docsParams) } },
  );
  const createDocument = useCreateDocument();
  const deleteDocument = useDeleteDocument();
  const requestUploadUrl = useRequestUploadUrl();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [docUploading, setDocUploading] = useState(false);
  const [docUploadError, setDocUploadError] = useState<string | null>(null);

  async function handleDocUpload(file: File) {
    if (!wo) return;
    setDocUploading(true);
    setDocUploadError(null);
    try {
      const contentType = file.type || "application/octet-stream";
      const urlRes = await requestUploadUrl.mutateAsync({
        data: { name: file.name, size: file.size, contentType },
      });
      const putRes = await fetch(urlRes.uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": contentType },
      });
      if (!putRes.ok) throw new Error("Upload failed");
      const sizeStr = file.size > 1_000_000
        ? `${(file.size / 1_000_000).toFixed(1)} MB`
        : `${Math.max(1, Math.round(file.size / 1_000))} KB`;
      await createDocument.mutateAsync({
        data: {
          name: file.name,
          category: "Vendor",
          building: wo.building,
          unit: wo.unit ?? undefined,
          uploadedBy: user?.name ?? "Manager",
          size: sizeStr,
          storageKey: urlRes.objectPath,
          vendorId: wo.vendorId ?? undefined,
          workOrderId: wo.id,
        },
      });
      await queryClient.invalidateQueries({ queryKey: woDocsQueryKey });
    } catch (err) {
      setDocUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setDocUploading(false);
    }
  }

  async function removeDocument(doc: Document) {
    if (!confirm(`Delete "${doc.name}"?`)) return;
    await deleteDocument.mutateAsync({ id: doc.id });
    await queryClient.invalidateQueries({ queryKey: woDocsQueryKey });
  }

  async function downloadDocument(doc: Document) {
    try {
      const res = await fetch(`/api/documents/${doc.id}/download`);
      if (!res.ok) throw new Error("Download failed");
      const ct = res.headers.get("Content-Type") ?? "";
      if (ct.includes("application/json")) {
        const { url } = await res.json();
        window.open(url, "_blank");
      } else {
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement("a"), { href: blobUrl, download: doc.name });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function refreshActivity() {
    if (!id) return;
    await queryClient.invalidateQueries({ queryKey: getListWorkOrderEventsQueryKey(id) });
  }

  async function postComment(ev: React.FormEvent) {
    ev.preventDefault();
    if (!comment.trim() || !id) return;
    setCommentError(null);
    try {
      await createComment.mutateAsync({ id, data: { text: comment.trim() } });
      setComment("");
      await refreshActivity();
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : "Failed to post comment");
    }
  }

  async function removeAttachment(att: WorkOrderAttachment) {
    if (!id) return;
    if (!confirm("Delete this photo?")) return;
    await deleteAttachment.mutateAsync({ id, attId: att.id });
    await refreshActivity();
    if (lightbox?.id === att.id) setLightbox(null);
  }

  const [pendingVendorId, setPendingVendorId] = useState<number | null | undefined>(undefined);
  const [vendorSaving, setVendorSaving] = useState(false);
  const [vendorSaved, setVendorSaved] = useState(false);

  const currentVendorId: number | null = wo?.vendorId ?? null;
  const displayVendorId = pendingVendorId !== undefined ? pendingVendorId : currentVendorId;
  const vendorDirty = pendingVendorId !== undefined && pendingVendorId !== currentVendorId;
  const [vendorPickerOpen, setVendorPickerOpen] = useState(false);

  const { data: assignedVendor, isLoading: assignedVendorLoading } = useGetVendor(
    currentVendorId ?? 0,
    {
      query: {
        enabled: !!currentVendorId,
        queryKey: getGetVendorQueryKey(currentVendorId ?? 0),
      },
    },
  );

  async function saveVendor() {
    if (!wo || !vendorDirty) return;
    const chosen = vendors.find((v) => v.id === pendingVendorId);
    if (chosen && chosen.status !== "active") {
      const ok = confirm(
        `${chosen.name} is marked Inactive (e.g. license expired or removed from the approved list). Assign them to this work order anyway?`,
      );
      if (!ok) return;
    }
    setVendorSaving(true);
    await updateMutation.mutateAsync({
      id: wo.id,
      data: {
        vendorId: pendingVendorId ?? undefined,
        vendor: chosen?.name ?? undefined,
      },
    });
    await queryClient.invalidateQueries({ queryKey: getGetWorkOrderQueryKey(wo.id) });
    await queryClient.invalidateQueries({ queryKey: getListWorkOrdersQueryKey() });
    setPendingVendorId(undefined);
    setVendorSaving(false);
    setVendorSaved(true);
    setVendorPickerOpen(false);
    setTimeout(() => setVendorSaved(false), 2500);
  }

  const { data: building } = useGetBuilding(
    wo?.building ?? 0,
    { query: { enabled: !!wo, queryKey: getGetBuildingQueryKey(wo?.building ?? 0) } },
  );
  const { data: unit } = useGetUnit(
    wo?.unit ?? "",
    { query: { enabled: !!(wo && wo.unit), queryKey: getGetUnitQueryKey(wo?.unit ?? "") } },
  );

  if (isLoading) {
    return (
      <Layout title="Work Order">
        <div className="py-16 text-center text-[13px]" style={{ color: c.inkMute }}>Loading…</div>
      </Layout>
    );
  }

  if (!wo) {
    return (
      <Layout title="Work Order Not Found">
        <Link href="/work-orders" className="inline-flex items-center gap-1.5 text-[13px] hover:underline" style={{ color: c.cobalt }}>
          <ArrowLeft className="h-4 w-4" /> Back to Work Orders
        </Link>
      </Layout>
    );
  }

  const timeline = buildTimeline(wo);
  const sc = woStatusColors[wo.status as WOStatus];
  const pc = priColors[wo.priority as keyof typeof priColors];

  return (
    <Layout
      title={wo.id}
      subtitle={wo.title}
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/work-orders"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-[13px] hover:bg-slate-50 transition-colors"
            style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
          >
            <ArrowLeft className="h-4 w-4" /> Work Orders
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl shrink-0" style={{ background: c.cobaltSoft }}>
                <ClipboardList className="h-6 w-6" style={{ color: c.cobalt }} />
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="font-mono-num text-[20px]" style={{ fontWeight: 700, color: c.cobalt }}>{wo.id}</span>
                  <span className="rounded-full px-2.5 py-0.5 text-[11px]" style={{ background: sc.bg, color: sc.fg, fontWeight: 700 }}>{sc.label}</span>
                  <span className="rounded px-1.5 py-0.5 text-[11px] font-mono-num" style={{ background: pc.bg, color: pc.fg, fontWeight: 700 }}>{wo.priority.toUpperCase()}</span>
                </div>
                <div className="mt-1 text-[15px]" style={{ fontWeight: 600, color: c.ink }}>{wo.title}</div>
                <div className="mt-0.5 text-[13px]" style={{ color: c.inkSoft }}>
                  {wo.category} ·{" "}
                  <Link href={`/buildings/${wo.building}`} className="hover:underline" style={{ color: c.cobalt }}>
                    Building {String(wo.building).padStart(2, "0")}{building ? ` — ${building.address}` : ""}
                  </Link>
                  {unit && (
                    <>
                      {" · "}
                      <Link href={`/units/${unit.id}`} className="hover:underline" style={{ color: c.cobalt }}>
                        Unit {unit.id}
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-4 gap-3">
            {[
              { label: "Opened", value: wo.opened },
              { label: "Due Date", value: wo.due ?? "—" },
              { label: "Category", value: wo.category },
              { label: "Est. Cost", value: `$${wo.estCost.toLocaleString()}` },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border p-3" style={{ borderColor: c.borderSoft }}>
                <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: c.inkMute, fontWeight: 700 }}>{s.label}</div>
                <div className="text-[14px] font-mono-num" style={{ fontWeight: 700, color: c.ink }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div
          className="rounded-xl border p-5"
          style={{ background: c.panel, borderColor: vendorDirty ? c.cobalt : c.border }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: c.inkMute }}>
              Assigned Vendor
            </div>
            {vendorSaved && (
              <span className="text-[11px]" style={{ color: c.emerald, fontWeight: 700 }}>Saved ✓</span>
            )}
          </div>

          {assignedVendor && !vendorPickerOpen ? (
            <>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0"
                  style={{ background: c.cobaltSoft }}
                >
                  <Wrench className="h-5 w-5" style={{ color: c.cobalt }} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/vendors/${assignedVendor.id}`}
                      className="text-[15px] hover:underline"
                      style={{ fontWeight: 700, color: c.cobalt }}
                    >
                      {assignedVendor.name}
                    </Link>
                    <span
                      className="rounded px-1.5 py-0.5 text-[11px]"
                      style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}
                    >
                      {assignedVendor.tradeCategory}
                    </span>
                    {assignedVendor.status !== "active" && (
                      <span
                        className="rounded px-1.5 py-0.5 text-[11px] inline-flex items-center gap-1"
                        style={{ background: "#FBE3E9", color: "#B8264C", fontWeight: 700 }}
                        title="This vendor is marked Inactive (e.g. license expired or removed from the approved list)."
                      >
                        <AlertCircle className="h-3 w-3" />
                        Inactive
                      </span>
                    )}
                  </div>
                  {assignedVendor.status !== "active" && (
                    <div
                      className="mt-2 rounded-md border px-2.5 py-1.5 text-[12px]"
                      style={{ background: "#FFF5F7", borderColor: "#F5C2CE", color: "#8A1E3F" }}
                    >
                      This vendor is currently inactive. Verify their status before dispatching new work.
                    </div>
                  )}
                  <div className="mt-1.5 flex items-center gap-4 flex-wrap text-[12.5px]" style={{ color: c.inkSoft }}>
                    <span className="inline-flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5" style={{ color: c.inkMute }} />
                      {assignedVendor.contactName}
                    </span>
                    <a
                      href={`tel:${assignedVendor.phone}`}
                      className="inline-flex items-center gap-1.5 hover:underline font-mono-num"
                    >
                      <Phone className="h-3.5 w-3.5" style={{ color: c.inkMute }} />
                      {assignedVendor.phone}
                    </a>
                    {assignedVendor.email && (
                      <a
                        href={`mailto:${assignedVendor.email}`}
                        className="inline-flex items-center gap-1.5 hover:underline truncate"
                      >
                        <Mail className="h-3.5 w-3.5 shrink-0" style={{ color: c.inkMute }} />
                        <span className="truncate">{assignedVendor.email}</span>
                      </a>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  href={`/vendors/${assignedVendor.id}`}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] hover:bg-slate-50"
                  style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View Vendor
                </Link>
                {!isResident && (
                  <button
                    type="button"
                    onClick={() => setVendorPickerOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] hover:bg-slate-50"
                    style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Change
                  </button>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3" style={{ borderColor: c.borderSoft }}>
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider mb-1" style={{ color: c.inkMute, fontWeight: 700 }}>
                  <ClipboardList className="h-3.5 w-3.5" />
                  Active Work Orders
                </div>
                <div className="text-[18px] font-mono-num" style={{ fontWeight: 800, color: "#A66C0E" }}>
                  {assignedVendor.activeWoCount}
                </div>
              </div>
              <div className="rounded-lg border p-3" style={{ borderColor: c.borderSoft }}>
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider mb-1" style={{ color: c.inkMute, fontWeight: 700 }}>
                  <DollarSign className="h-3.5 w-3.5" />
                  Total Spend (Est.)
                </div>
                <div className="text-[18px] font-mono-num" style={{ fontWeight: 800, color: c.emerald }}>
                  ${assignedVendor.totalSpend.toLocaleString()}
                </div>
              </div>
            </div>

            {(() => {
              const recent = (assignedVendor.workOrders ?? [])
                .filter((w) => w.id !== wo.id)
                .slice()
                .sort((a, b) => {
                  const ad = a.opened ?? "";
                  const bd = b.opened ?? "";
                  if (ad !== bd) return bd.localeCompare(ad);
                  return b.id.localeCompare(a.id);
                })
                .slice(0, 5);
              if (recent.length === 0) return null;
              return (
                <div className="mt-4 rounded-lg border" style={{ borderColor: c.borderSoft }}>
                  <div
                    className="flex items-center justify-between border-b px-3 py-2"
                    style={{ borderColor: c.borderSoft }}
                  >
                    <div className="text-[11px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>
                      Recent Work Orders
                    </div>
                    <Link
                      href={`/vendors/${assignedVendor.id}`}
                      className="text-[11px] hover:underline"
                      style={{ color: c.cobalt, fontWeight: 600 }}
                    >
                      View all
                    </Link>
                  </div>
                  <ul>
                    {recent.map((w) => {
                      const rsc = woStatusColors[w.status as WOStatus];
                      return (
                        <li
                          key={w.id}
                          className="flex items-center gap-3 border-t px-3 py-2 hover:bg-slate-50"
                          style={{ borderColor: c.borderSoft }}
                        >
                          <Link
                            href={`/work-orders/${w.id}`}
                            className="font-mono-num text-[12.5px] hover:underline shrink-0"
                            style={{ color: c.cobalt, fontWeight: 700 }}
                          >
                            {w.id}
                          </Link>
                          <Link
                            href={`/work-orders/${w.id}`}
                            className="min-w-0 flex-1 truncate text-[13px] hover:underline"
                            style={{ color: c.ink, fontWeight: 600 }}
                          >
                            {w.title}
                          </Link>
                          <span
                            className="font-mono-num text-[11.5px] shrink-0"
                            style={{ color: c.inkMute }}
                          >
                            {w.opened}
                          </span>
                          {rsc && (
                            <span
                              className="rounded-full px-2 py-0.5 text-[11px] shrink-0"
                              style={{ background: rsc.bg, color: rsc.fg, fontWeight: 700 }}
                            >
                              {rsc.label}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })()}
            </>
          ) : !isResident && vendorPickerOpen ? (
            <div>
              <div className="max-w-md">
                <VendorCombobox
                  vendors={vendors}
                  value={displayVendorId}
                  onChange={setPendingVendorId}
                  preferredCategory={wo.category}
                />
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={saveVendor}
                  disabled={vendorSaving || !vendorDirty}
                  className="rounded px-4 py-1.5 text-[12.5px] hover:opacity-90 disabled:opacity-50"
                  style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                >
                  {vendorSaving ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => {
                    setPendingVendorId(undefined);
                    setVendorPickerOpen(false);
                  }}
                  className="rounded border px-4 py-1.5 text-[12.5px] hover:bg-slate-50"
                  style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : currentVendorId && (assignedVendorLoading || !assignedVendor) ? (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: c.inkMute }}>
              {assignedVendorLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading vendor…
                </>
              ) : (
                <span style={{ fontWeight: 600, color: c.ink }}>
                  {wo.vendor ?? `Vendor #${currentVendorId}`}
                </span>
              )}
            </div>
          ) : !currentVendorId && !isResident ? (
            <button
              type="button"
              onClick={() => setVendorPickerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-[13px] hover:opacity-90"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
            >
              <UserPlus className="h-4 w-4" />
              Assign Vendor
            </button>
          ) : (
            <div className="text-[13px]" style={{ color: c.inkMute }}>
              No vendor assigned yet.
            </div>
          )}
        </div>

        <div className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
          <div className="text-[13px] font-semibold uppercase tracking-wider mb-5" style={{ color: c.inkMute }}>Progress Timeline</div>
          <div className="relative">
            <div className="absolute top-5 left-5 right-5 h-0.5" style={{ background: c.borderSoft }} />
            <div className="flex items-start justify-between relative">
              {timeline.map((step) => (
                <div key={step.key} className="flex flex-col items-center gap-2 flex-1">
                  <div
                    className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2"
                    style={{
                      background: step.done ? c.emerald : step.active ? c.cobalt : c.panel,
                      borderColor: step.done ? c.emerald : step.active ? c.cobalt : c.border,
                      color: step.done || step.active ? "#fff" : c.inkMute,
                    }}
                  >
                    {step.icon}
                  </div>
                  <div className="text-center max-w-[80px]">
                    <div className="text-[12px]" style={{ fontWeight: step.active ? 700 : 600, color: step.done ? c.emerald : step.active ? c.cobalt : c.inkMute }}>
                      {step.label}
                    </div>
                    {step.date && (
                      <div className="text-[11px] font-mono-num mt-0.5" style={{ color: c.inkMute }}>{step.date}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <MotionAuthorizationCard
          motionId={wo.sourceMotionId ?? null}
          bypassId={wo.emergencyBypassId ?? null}
          label="Expenditure Authorization"
        />

        <ResolutionLinkCard
          resolutionId={wo.resolutionId ?? null}
          resolutionNumber={wo.resolutionNumber ?? null}
          resolutionTitle={wo.resolutionTitle ?? null}
          resolutionStatus={(wo.resolutionStatus ?? null) as "adopted" | "superseded" | "rescinded" | null}
          canEdit={isManager}
          onSave={async (resolutionId) => {
            await updateMutation.mutateAsync({ id: wo.id, data: { resolutionId } });
            await queryClient.invalidateQueries({ queryKey: getGetWorkOrderQueryKey(wo.id) });
          }}
        />

        {!isResident && <div className="grid grid-cols-2 gap-5">
          <div className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
            <div className="text-[13px] font-semibold uppercase tracking-wider mb-3" style={{ color: c.inkMute }}>Resolution Notes</div>
            {wo.status === "done" ? (
              <div className="rounded-lg p-3 text-[13.5px]" style={{ background: c.emeraldSoft, color: c.emerald }}>
                <CheckCircle2 className="h-4 w-4 inline mr-1.5 -mt-0.5" />
                Work order successfully completed. All repairs confirmed and signed off.
              </div>
            ) : (
              <textarea
                placeholder="Add resolution notes…"
                rows={4}
                className="w-full resize-none rounded-lg border p-3 text-[13px] outline-none focus:ring-2 focus:ring-blue-300"
                style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
              />
            )}
          </div>

          <div className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
            <div className="text-[13px] font-semibold uppercase tracking-wider mb-3" style={{ color: c.inkMute }}>Lessons Learned</div>
            <textarea
              placeholder="What should the board know for future budgeting or preventive maintenance?"
              rows={4}
              className="w-full resize-none rounded-lg border p-3 text-[13px] outline-none focus:ring-2 focus:ring-blue-300"
              style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
            />
          </div>
        </div>}

        <div className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
          <div className="flex items-center justify-between mb-4">
            <div className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: c.inkMute }}>
              Photos {attachments.length > 0 && (
                <span className="ml-1.5 font-mono-num" style={{ color: c.cobalt }}>
                  {attachments.length}
                </span>
              )}
            </div>
            {wo && <LivePhotoUploader workOrderId={wo.id} onUploaded={refreshActivity} />}
          </div>
          {attachments.length === 0 ? (
            <div
              className="rounded-lg p-6 text-center text-[12.5px]"
              style={{ background: c.canvas, border: `1.5px dashed ${c.border}`, color: c.inkMute }}
            >
              <ImageIcon className="h-5 w-5 mx-auto mb-1.5 opacity-50" />
              No photos yet — use the Add photo button to attach images.
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {attachments.map((a) => (
                <div
                  key={a.id}
                  className="relative aspect-square rounded-lg overflow-hidden border group cursor-pointer"
                  style={{ borderColor: c.border, background: c.canvas }}
                  onClick={() => setLightbox(a)}
                >
                  <img
                    src={`/api/storage/objects/${encodeURI(a.storageKey).replace(/^%2F/, "")}`}
                    alt={a.name ?? "Attachment"}
                    className="h-full w-full object-cover"
                  />
                  {isManager && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeAttachment(a); }}
                      className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100 hover:bg-black/80"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
          <div className="flex items-center justify-between mb-4">
            <div className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: c.inkMute }}>
              Files {woDocuments.length > 0 && (
                <span className="ml-1.5 font-mono-num" style={{ color: c.cobalt }}>
                  {woDocuments.length}
                </span>
              )}
            </div>
            {isManager && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) await handleDocUpload(f);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={docUploading}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] hover:bg-slate-50 disabled:opacity-60"
                  style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
                >
                  {docUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardList className="h-3.5 w-3.5" />}
                  {docUploading ? "Uploading…" : "Add file"}
                </button>
              </>
            )}
          </div>
          {docUploadError && (
            <div className="mb-3 rounded p-2 text-[12px]" style={{ background: "#FBE3E9", color: "#B8264C" }}>
              {docUploadError}
            </div>
          )}
          {woDocuments.length === 0 ? (
            <div
              className="rounded-lg p-6 text-center text-[12.5px]"
              style={{ background: c.canvas, border: `1.5px dashed ${c.border}`, color: c.inkMute }}
            >
              No files attached. {isManager && wo.vendorId
                ? "Uploads will be tagged to the assigned vendor automatically."
                : isManager
                ? "Assign a vendor to auto-tag uploads."
                : ""}
            </div>
          ) : (
            <div className="space-y-2">
              {Object.entries(
                woDocuments.reduce<Record<string, Document[]>>((acc, d) => {
                  const k = d.category ?? "Other";
                  (acc[k] ??= []).push(d);
                  return acc;
                }, {}),
              ).map(([kind, docs]) => (
                <div key={kind}>
                  <div className="text-[11px] uppercase tracking-wider mb-1.5" style={{ color: c.inkMute, fontWeight: 700 }}>
                    {kind} <span className="font-mono-num" style={{ color: c.inkMute }}>({docs.length})</span>
                  </div>
                  <ul className="space-y-1.5">
                    {docs.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                        style={{ borderColor: c.borderSoft, background: c.canvas }}
                      >
                        <button
                          type="button"
                          onClick={() => downloadDocument(d)}
                          className="flex items-center gap-2 min-w-0 text-left hover:underline"
                          style={{ color: c.cobalt }}
                        >
                          <ClipboardList className="h-4 w-4 shrink-0" />
                          <span className="truncate text-[13px]" style={{ fontWeight: 600 }}>{d.name}</span>
                        </button>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-[11px] font-mono-num" style={{ color: c.inkMute }}>{d.size}</span>
                          <span className="text-[11px] font-mono-num" style={{ color: c.inkMute }}>{d.uploaded}</span>
                          {isManager && (
                            <button
                              type="button"
                              onClick={() => removeDocument(d)}
                              className="rounded p-1 hover:bg-rose-50"
                              style={{ color: "#B8264C" }}
                              aria-label="Delete file"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <ActivityPanel
          events={events}
          attachments={attachments}
          comment={comment}
          setComment={setComment}
          onSubmit={postComment}
          isPending={createComment.isPending}
          commentError={commentError}
          currentUserId={user?.id ?? null}
          isManager={isManager}
          onEditComment={editComment}
          onDeleteComment={removeComment}
        />

        <div
          className="rounded-xl border p-5 flex items-start gap-4"
          style={{ background: "#F0F4FF", borderColor: "#C5CFFF" }}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0" style={{ background: c.cobaltSoft }}>
            <TrendingUp className="h-5 w-5" style={{ color: c.cobalt }} />
          </div>
          <div>
            <div className="text-[14px] mb-1" style={{ fontWeight: 700, color: c.cobalt }}>Why This Record Matters</div>
            <p className="text-[13px] leading-relaxed" style={{ color: c.inkSoft }}>
              Historical work order data helps the board make <strong>proactive repair and budgeting decisions</strong>.
              Tracking vendors, costs, and outcomes over time reveals recurring issues, informs reserve fund planning,
              and supports insurance claims when needed.
            </p>
          </div>
        </div>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
        >
          <img
            src={`/api/storage/objects/${encodeURI(lightbox.storageKey).replace(/^%2F/, "")}`}
            alt={lightbox.name ?? "Attachment"}
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label="Close"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        </div>
      )}
    </Layout>
  );
}

type ActivityItem =
  | { kind: "event"; at: string; event: WorkOrderEvent }
  | { kind: "attachment"; at: string; attachment: WorkOrderAttachment };

function ActivityPanel({
  events,
  attachments,
  comment,
  setComment,
  onSubmit,
  isPending,
  commentError,
  currentUserId,
  isManager,
  onEditComment,
  onDeleteComment,
}: {
  events: WorkOrderEvent[];
  attachments: WorkOrderAttachment[];
  comment: string;
  setComment: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isPending: boolean;
  commentError: string | null;
  currentUserId: number | null;
  isManager: boolean;
  onEditComment: (eventId: number, text: string) => Promise<void>;
  onDeleteComment: (eventId: number) => Promise<void>;
}) {
  const eventAttachmentIds = new Set<number>();
  for (const ev of events) {
    if (ev.kind === "photo_added" && ev.payload && typeof ev.payload === "object") {
      const aId = (ev.payload as Record<string, unknown>).attachmentId;
      if (typeof aId === "number") eventAttachmentIds.add(aId);
    }
  }
  const orphanAttachments = attachments.filter((a) => !eventAttachmentIds.has(a.id));

  const items: ActivityItem[] = [
    ...events.map<ActivityItem>((event) => ({ kind: "event", at: event.createdAt, event })),
    ...orphanAttachments.map<ActivityItem>((attachment) => ({
      kind: "attachment",
      at: attachment.uploadedAt,
      attachment,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <div className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
      <div className="text-[13px] font-semibold uppercase tracking-wider mb-4" style={{ color: c.inkMute }}>
        Activity & Comments
      </div>

      <form onSubmit={onSubmit} className="mb-5">
        <div className="rounded-lg border p-3" style={{ borderColor: c.border, background: c.canvas }}>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment…"
            rows={2}
            className="w-full resize-none bg-transparent text-[13px] outline-none"
            style={{ color: c.ink }}
          />
          <div className="flex items-center justify-between mt-2">
            <div className="text-[11px]" style={{ color: c.inkMute }}>
              Both residents and managers can comment.
            </div>
            <button
              type="submit"
              disabled={!comment.trim() || isPending}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] hover:opacity-90 disabled:opacity-50"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {isPending ? "Posting…" : "Post"}
            </button>
          </div>
          {commentError && (
            <div className="text-[11.5px] mt-1.5" style={{ color: c.rose }}>{commentError}</div>
          )}
        </div>
      </form>

      {items.length === 0 ? (
        <div className="text-[12.5px] text-center py-6" style={{ color: c.inkMute }}>
          No activity yet.
        </div>
      ) : (
        <ol className="relative space-y-3">
          {items.map((item, idx) => (
            <ActivityRow
              key={`${item.kind}-${idx}`}
              item={item}
              currentUserId={currentUserId}
              isManager={isManager}
              onEditComment={onEditComment}
              onDeleteComment={onDeleteComment}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function eventIcon(kind: string) {
  switch (kind) {
    case "comment":         return <MessageSquare className="h-3.5 w-3.5" />;
    case "status_changed":  return <ArrowRightLeft className="h-3.5 w-3.5" />;
    case "priority_changed":return <AlertCircle className="h-3.5 w-3.5" />;
    case "vendor_assigned": return <UserPlus className="h-3.5 w-3.5" />;
    case "photo_added":     return <Camera className="h-3.5 w-3.5" />;
    default:                return <CircleDot className="h-3.5 w-3.5" />;
  }
}

function formatDate(ts: string): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function ActivityRow({
  item,
  currentUserId,
  isManager,
  onEditComment,
  onDeleteComment,
}: {
  item: ActivityItem;
  currentUserId: number | null;
  isManager: boolean;
  onEditComment: (eventId: number, text: string) => Promise<void>;
  onDeleteComment: (eventId: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  if (item.kind === "attachment") {
    const a = item.attachment;
    return (
      <li className="flex items-start gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full shrink-0 mt-0.5" style={{ background: c.cobaltSoft, color: c.cobalt }}>
          <Camera className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px]" style={{ color: c.ink }}>
            <strong>Photo added</strong> {a.name ? `· ${a.name}` : ""}
          </div>
          <div className="text-[11px] font-mono-num" style={{ color: c.inkMute }}>{formatDate(a.uploadedAt)}</div>
        </div>
      </li>
    );
  }

  const ev = item.event;
  const actor = ev.actorName ?? "System";
  let body: React.ReactNode = null;
  const payload = (ev.payload as Record<string, unknown> | null) ?? null;
  const isDeleted = !!ev.deletedAt;
  const isEdited = !!ev.editedAt && !isDeleted;
  const canEdit =
    ev.kind === "comment" &&
    !isDeleted &&
    ((currentUserId !== null && ev.actorUserId === currentUserId) || isManager);
  const canDelete =
    ev.kind === "comment" &&
    !isDeleted &&
    (canEdit || isManager);

  if (ev.kind === "comment") {
    const text = (payload?.text as string | undefined) ?? "";
    if (isDeleted) {
      body = (
        <div
          className="rounded-lg border p-2.5 mt-1 italic"
          style={{ borderColor: c.borderSoft, background: c.canvas, color: c.inkMute }}
        >
          <div className="text-[12.5px]">
            <Trash2 className="h-3 w-3 inline -mt-0.5 mr-1" />
            This comment was deleted
            {ev.deletedAt ? <> · {formatDate(ev.deletedAt)}</> : null}
          </div>
        </div>
      );
    } else if (editing) {
      body = (
        <div className="rounded-lg border p-2.5 mt-1" style={{ borderColor: c.cobalt, background: c.canvas }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="w-full resize-none bg-transparent text-[13px] outline-none"
            style={{ color: c.ink }}
            autoFocus
          />
          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => { setEditing(false); setDraft(""); }}
              className="rounded border px-2.5 py-1 text-[11.5px] hover:bg-slate-50"
              style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!draft.trim() || saving || draft.trim() === text}
              onClick={async () => {
                setSaving(true);
                try {
                  await onEditComment(ev.id, draft.trim());
                  setEditing(false);
                } finally {
                  setSaving(false);
                }
              }}
              className="rounded px-2.5 py-1 text-[11.5px] hover:opacity-90 disabled:opacity-50"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      );
    } else {
      body = (
        <div className="rounded-lg border p-2.5 mt-1" style={{ borderColor: c.borderSoft, background: c.canvas }}>
          <div className="text-[13px] whitespace-pre-wrap" style={{ color: c.ink }}>{text}</div>
        </div>
      );
    }
  } else if (ev.kind === "status_changed") {
    body = <span className="text-[12.5px]" style={{ color: c.inkSoft }}>changed status from <strong>{String(payload?.from ?? "")}</strong> to <strong>{String(payload?.to ?? "")}</strong></span>;
  } else if (ev.kind === "priority_changed") {
    body = <span className="text-[12.5px]" style={{ color: c.inkSoft }}>set priority to <strong>{String(payload?.to ?? "")}</strong> (was <strong>{String(payload?.from ?? "")}</strong>)</span>;
  } else if (ev.kind === "vendor_assigned") {
    const vname = payload?.vendorName ?? payload?.vendor ?? "a vendor";
    body = <span className="text-[12.5px]" style={{ color: c.inkSoft }}>assigned vendor <strong>{String(vname)}</strong></span>;
  } else if (ev.kind === "photo_added") {
    const name = payload?.name ?? "a photo";
    body = <span className="text-[12.5px]" style={{ color: c.inkSoft }}>added a photo <em>{String(name)}</em></span>;
  }

  const showActions = !editing && (canEdit || canDelete);

  return (
    <li className="flex items-start gap-3 group">
      <div className="flex h-7 w-7 items-center justify-center rounded-full shrink-0 mt-0.5" style={{ background: c.cobaltSoft, color: c.cobalt }}>
        {eventIcon(ev.kind)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="text-[12.5px]" style={{ color: c.ink }}>
            <strong>{actor}</strong>{" "}
            {ev.kind === "comment" ? (
              <span style={{ color: c.inkSoft }}>
                {isDeleted ? "deleted a comment" : "commented"}
              </span>
            ) : body}
          </div>
          {showActions && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft((payload?.text as string | undefined) ?? "");
                    setEditing(true);
                  }}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-slate-100"
                  style={{ color: c.inkSoft }}
                  aria-label="Edit comment"
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => onDeleteComment(ev.id)}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-rose-50"
                  style={{ color: c.rose }}
                  aria-label="Delete comment"
                >
                  <X className="h-3 w-3" /> Delete
                </button>
              )}
            </div>
          )}
        </div>
        {ev.kind === "comment" && body}
        <div className="text-[11px] font-mono-num mt-0.5 flex items-center gap-1.5" style={{ color: c.inkMute }}>
          <span>{formatDate(ev.createdAt)}</span>
          {isEdited && (
            <span className="italic" title={`Edited ${formatDate(ev.editedAt!)}`}>
              · edited
            </span>
          )}
          {isDeleted && (
            <span className="italic">· deleted</span>
          )}
        </div>
      </div>
    </li>
  );
}
