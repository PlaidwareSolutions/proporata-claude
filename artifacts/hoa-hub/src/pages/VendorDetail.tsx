import { useState } from "react";
import { Link, useParams } from "wouter";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import {
  ArrowLeft, Phone, Mail, BadgeCheck, Wrench, DollarSign,
  ClipboardList, X, AlertCircle, CheckCircle2, Edit2,
} from "lucide-react";
import {
  useGetVendor,
  useUpdateVendor,
  useDeleteVendor,
  getListVendorsQueryKey,
  getGetVendorQueryKey,
} from "@workspace/api-client-react";
import { VendorFilesSection } from "@/components/VendorFilesSection";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { isValidEmail, isValidPhone } from "@/lib/validation";

const statusColors = {
  open:        { bg: "#FBE3E9", fg: "#B8264C", label: "Open" },
  scheduled:   { bg: "#FBEFD6", fg: "#A66C0E", label: "Scheduled" },
  in_progress: { bg: "#E5E8FF", fg: "#3245FF", label: "In Progress" },
  done:        { bg: "#DCF3EC", fg: "#0E8A6B", label: "Done" },
};

const priColors = {
  urgent: { bg: "#FBE3E9", fg: "#B8264C" },
  high:   { bg: "#FBEFD6", fg: "#A66C0E" },
  med:    { bg: "#E5E8FF", fg: "#3245FF" },
  low:    { bg: "#EFF1F8", fg: "#5A6285" },
};

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

const TRADE_CATEGORIES = [
  "Plumbing", "Roof", "Electrical", "Structural", "Exterior",
  "Landscaping", "HVAC", "General", "Other",
] as const;

type EditForm = {
  name: string;
  tradeCategory: string;
  contactName: string;
  phone: string;
  email: string;
  licenseNumber: string;
  notes: string;
};

export default function VendorDetail() {
  const params = useParams<{ id: string }>();
  const vendorId = Number(params.id);
  const { user } = useAuth();
  const canEditFiles = user?.role === "admin" || user?.role === "manager";
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editErrors, setEditErrors] = useState<Partial<Record<keyof EditForm, string>>>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const { data: vendor, isLoading, isError } = useGetVendor(vendorId);
  const updateMutation = useUpdateVendor();
  const deleteMutation = useDeleteVendor();

  function openEditModal() {
    if (!vendor) return;
    setEditForm({
      name: vendor.name,
      tradeCategory: vendor.tradeCategory,
      contactName: vendor.contactName,
      phone: vendor.phone,
      email: vendor.email,
      licenseNumber: vendor.licenseNumber ?? "",
      notes: vendor.notes ?? "",
    });
    setEditErrors({});
    setShowEditModal(true);
  }

  const setField = (k: keyof EditForm) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    setEditForm((f) => f ? { ...f, [k]: e.target.value } : f);
    setEditErrors((er) => ({ ...er, [k]: undefined }));
  };

  function validateEdit() {
    const e: typeof editErrors = {};
    if (!editForm?.name.trim()) e.name = "Required";
    if (!editForm?.tradeCategory) e.tradeCategory = "Required";
    if (!editForm?.contactName.trim()) e.contactName = "Required";
    if (!editForm?.phone.trim()) e.phone = "Required";
    else if (!isValidPhone(editForm.phone)) e.phone = "Invalid phone number";
    if (!editForm?.email.trim()) e.email = "Required";
    else if (!isValidEmail(editForm.email)) e.email = "Invalid email address";
    setEditErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleEditSave(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validateEdit() || !editForm) return;
    await updateMutation.mutateAsync({
      id: vendorId,
      data: {
        name: editForm.name,
        tradeCategory: editForm.tradeCategory,
        contactName: editForm.contactName,
        phone: editForm.phone,
        email: editForm.email,
        licenseNumber: editForm.licenseNumber || undefined,
        notes: editForm.notes || undefined,
      },
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetVendorQueryKey(vendorId) }),
    ]);
    setShowEditModal(false);
    setToastMsg("Vendor profile updated");
    setTimeout(() => setToastMsg(null), 3000);
  }

  async function handleToggleStatus() {
    if (!vendor) return;
    const newStatus = vendor.status === "active" ? "inactive" : "active";
    await updateMutation.mutateAsync({ id: vendorId, data: { status: newStatus } });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetVendorQueryKey(vendorId) }),
    ]);
    setToastMsg(newStatus === "inactive" ? "Vendor marked inactive" : "Vendor reactivated");
    setTimeout(() => setToastMsg(null), 3000);
  }

  async function handleDelete() {
    await deleteMutation.mutateAsync({ id: vendorId });
    await queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() });
    navigate("/vendors");
  }

  if (isLoading) {
    return (
      <Layout title="Vendor" actions={<BackButton />}>
        <div className="py-16 text-center text-[13px]" style={{ color: c.inkMute }}>Loading vendor…</div>
      </Layout>
    );
  }

  if (isError || !vendor) {
    return (
      <Layout title="Vendor Not Found" actions={<BackButton />}>
        <div className="py-16 text-center" style={{ color: c.inkMute }}>
          <AlertCircle className="mx-auto h-8 w-8 mb-3" />
          <div className="text-[14px]" style={{ fontWeight: 600 }}>Vendor not found</div>
        </div>
      </Layout>
    );
  }

  const tc = tradeBadgeColors[vendor.tradeCategory] ?? tradeBadgeColors.Other!;
  const workOrders = vendor.workOrders ?? [];

  return (
    <Layout
      title={vendor.name}
      subtitle={vendor.tradeCategory}
      actions={<BackButton />}
    >
      {toastMsg && (
        <div
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border px-5 py-4 shadow-lg"
          style={{ background: c.panel, borderColor: c.emerald, minWidth: 260 }}
        >
          <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: c.emerald }} />
          <span className="text-[14px]" style={{ fontWeight: 600 }}>{toastMsg}</span>
          <button onClick={() => setToastMsg(null)} className="ml-auto rounded-full p-0.5 hover:bg-slate-100" style={{ color: c.inkMute }}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="max-w-5xl space-y-5">
        <div className="rounded-xl border p-6" style={{ background: c.panel, borderColor: c.border }}>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-5">
              <div
                className="flex h-14 w-14 items-center justify-center rounded-xl shrink-0"
                style={{ background: tc.bg }}
              >
                <Wrench className="h-7 w-7" style={{ color: tc.fg }} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[20px]" style={{ fontWeight: 800 }}>{vendor.name}</h2>
                  <span
                    className="rounded px-1.5 py-0.5 text-[11px]"
                    style={{ background: tc.bg, color: tc.fg, fontWeight: 700 }}
                  >
                    {vendor.tradeCategory}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px]"
                    style={
                      vendor.status === "active"
                        ? { background: "#DCF3EC", color: "#0E8A6B", fontWeight: 700 }
                        : { background: "#F3F4F6", color: "#6B7280", fontWeight: 700 }
                    }
                  >
                    {vendor.status === "active" ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-4 text-[13px]" style={{ color: c.inkSoft }}>
                  <span>{vendor.contactName}</span>
                  <a href={`tel:${vendor.phone}`} className="inline-flex items-center gap-1 hover:underline" style={{ color: c.cobalt }}>
                    <Phone className="h-3.5 w-3.5" /> {vendor.phone}
                  </a>
                  <a href={`mailto:${vendor.email}`} className="inline-flex items-center gap-1 hover:underline" style={{ color: c.cobalt }}>
                    <Mail className="h-3.5 w-3.5" /> {vendor.email}
                  </a>
                </div>
                {vendor.licenseNumber && (
                  <div className="mt-1 flex items-center gap-1 text-[12.5px]" style={{ color: c.inkMute }}>
                    <BadgeCheck className="h-3.5 w-3.5" />
                    License: {vendor.licenseNumber}
                  </div>
                )}
                {vendor.notes && (
                  <div className="mt-2 text-[13px]" style={{ color: c.inkSoft }}>{vendor.notes}</div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={openEditModal}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-[13px] hover:bg-slate-50 transition-colors"
                style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
              >
                <Edit2 className="h-3.5 w-3.5" /> Edit
              </button>
              <button
                onClick={handleToggleStatus}
                disabled={updateMutation.isPending}
                className="rounded-md border px-3 py-2 text-[13px] hover:bg-slate-50 transition-colors disabled:opacity-60"
                style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
              >
                {vendor.status === "active" ? "Mark Inactive" : "Reactivate"}
              </button>
              <button
                onClick={() => setShowArchiveConfirm(true)}
                className="rounded-md border px-3 py-2 text-[13px] hover:bg-red-50 transition-colors"
                style={{ borderColor: "#FCA5A5", color: "#B91C1C", fontWeight: 500 }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {[
            { icon: ClipboardList, label: "Total Work Orders", value: workOrders.length, color: c.cobalt },
            { icon: ClipboardList, label: "Active Work Orders", value: vendor.activeWoCount, color: "#A66C0E" },
            { icon: DollarSign, label: "Total Spend (Est.)", value: `$${vendor.totalSpend.toLocaleString()}`, color: "#0E8A6B" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border p-4" style={{ background: c.panel, borderColor: c.border }}>
              <div className="text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: c.inkMute }}>{stat.label}</div>
              <div className="font-mono-num text-[26px]" style={{ fontWeight: 800, color: stat.color }}>{stat.value}</div>
            </div>
          ))}
        </div>

        <VendorFilesSection vendorId={vendorId} canEdit={canEditFiles} />

        {workOrders.length > 0 && (
          <div className="rounded-xl border overflow-hidden" style={{ background: c.panel, borderColor: c.border }}>
            <div className="border-b px-5 py-3.5" style={{ borderColor: c.borderSoft }}>
              <div className="text-[14px]" style={{ fontWeight: 700 }}>Work Order History</div>
            </div>
            <table className="w-full text-[13px]">
              <thead style={{ background: c.canvas }}>
                <tr style={{ color: c.inkMute }} className="text-left text-[11px] uppercase tracking-wider">
                  {["WO #", "Title", "Category", "Opened", "Est $", "Priority", "Status"].map((h) => (
                    <th key={h} className="px-4 py-3" style={{ fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workOrders.map((w) => {
                  const sc = statusColors[w.status as keyof typeof statusColors];
                  const pc = priColors[w.priority as keyof typeof priColors];
                  return (
                    <tr key={w.id} className="border-t hover:bg-slate-50" style={{ borderColor: c.borderSoft }}>
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/work-orders/${w.id}`}
                          className="font-mono-num hover:underline"
                          style={{ fontWeight: 700, color: c.cobalt }}
                        >
                          {w.id}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 max-w-xs">
                        <div className="truncate" style={{ color: c.ink, fontWeight: 600 }}>{w.title}</div>
                      </td>
                      <td className="px-4 py-2.5" style={{ color: c.inkSoft }}>{w.category}</td>
                      <td className="px-4 py-2.5 font-mono-num" style={{ color: c.inkSoft }}>{w.opened}</td>
                      <td className="px-4 py-2.5 font-mono-num" style={{ fontWeight: 700, color: c.ink }}>
                        ${w.estCost.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5">
                        {pc && (
                          <span className="rounded px-1.5 py-0.5 text-[11px] font-mono-num" style={{ background: pc.bg, color: pc.fg, fontWeight: 700 }}>
                            {w.priority.toUpperCase()}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {sc && (
                          <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: sc.bg, color: sc.fg, fontWeight: 700 }}>
                            {sc.label}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showEditModal && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="w-full max-w-lg rounded-2xl border shadow-2xl" style={{ background: c.panel, borderColor: c.border }}>
            <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: c.borderSoft }}>
              <div className="text-[16px]" style={{ fontWeight: 700 }}>Edit Vendor</div>
              <button onClick={() => setShowEditModal(false)} className="rounded-full p-1 hover:bg-slate-100" style={{ color: c.inkMute }}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleEditSave} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: editErrors.name ? c.rose : c.inkSoft }}>
                    Company Name {editErrors.name && <span className="text-[11px] ml-1">({editErrors.name})</span>}
                  </label>
                  <input
                    value={editForm.name}
                    onChange={setField("name")}
                    className="w-full rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300"
                    style={{ borderColor: editErrors.name ? c.rose : c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
                <div>
                  <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: editErrors.tradeCategory ? c.rose : c.inkSoft }}>
                    Trade Category {editErrors.tradeCategory && <span className="text-[11px] ml-1">({editErrors.tradeCategory})</span>}
                  </label>
                  <select
                    value={editForm.tradeCategory}
                    onChange={setField("tradeCategory")}
                    className="w-full rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300"
                    style={{ borderColor: editErrors.tradeCategory ? c.rose : c.border, background: c.canvas, color: c.ink }}
                  >
                    {TRADE_CATEGORIES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: editErrors.contactName ? c.rose : c.inkSoft }}>
                    Contact Name {editErrors.contactName && <span className="text-[11px] ml-1">({editErrors.contactName})</span>}
                  </label>
                  <input
                    value={editForm.contactName}
                    onChange={setField("contactName")}
                    className="w-full rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300"
                    style={{ borderColor: editErrors.contactName ? c.rose : c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
                <div>
                  <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: editErrors.phone ? c.rose : c.inkSoft }}>
                    Phone {editErrors.phone && <span className="text-[11px] ml-1">({editErrors.phone})</span>}
                  </label>
                  <input
                    value={editForm.phone}
                    onChange={setField("phone")}
                    className="w-full rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300"
                    style={{ borderColor: editErrors.phone ? c.rose : c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
                <div>
                  <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: editErrors.email ? c.rose : c.inkSoft }}>
                    Email {editErrors.email && <span className="text-[11px] ml-1">({editErrors.email})</span>}
                  </label>
                  <input
                    value={editForm.email}
                    onChange={setField("email")}
                    type="email"
                    className="w-full rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300"
                    style={{ borderColor: editErrors.email ? c.rose : c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: c.inkSoft }}>
                    License Number <span className="text-[11px]" style={{ color: c.inkMute }}>(optional)</span>
                  </label>
                  <input
                    value={editForm.licenseNumber}
                    onChange={setField("licenseNumber")}
                    className="w-full rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300"
                    style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: c.inkSoft }}>
                    Notes <span className="text-[11px]" style={{ color: c.inkMute }}>(optional)</span>
                  </label>
                  <textarea
                    value={editForm.notes}
                    onChange={setField("notes")}
                    rows={2}
                    className="w-full resize-none rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300"
                    style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-[13.5px] hover:opacity-90 transition-opacity disabled:opacity-60"
                  style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                >
                  {updateMutation.isPending ? "Saving…" : "Save Changes"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="inline-flex items-center rounded-lg border px-5 py-2.5 text-[13.5px] hover:bg-slate-50"
                  style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showArchiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="w-full max-w-sm rounded-2xl border shadow-2xl p-6" style={{ background: c.panel, borderColor: c.border }}>
            <div className="text-[16px] mb-2" style={{ fontWeight: 700 }}>Delete Vendor?</div>
            <div className="text-[13px] mb-5" style={{ color: c.inkSoft }}>
              This will permanently delete <strong>{vendor.name}</strong>. Work orders linked to this vendor will keep their vendor name but lose the link.
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="flex-1 rounded-lg py-2.5 text-[13.5px] hover:opacity-90 disabled:opacity-60"
                style={{ background: "#B91C1C", color: "#fff", fontWeight: 600 }}
              >
                {deleteMutation.isPending ? "Deleting…" : "Yes, Delete"}
              </button>
              <button
                onClick={() => setShowArchiveConfirm(false)}
                className="flex-1 rounded-lg border py-2.5 text-[13.5px] hover:bg-slate-50"
                style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

function BackButton() {
  return (
    <Link
      href="/vendors"
      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-[13px] hover:bg-slate-50 transition-colors"
      style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
    >
      <ArrowLeft className="h-4 w-4" /> Vendors
    </Link>
  );
}
