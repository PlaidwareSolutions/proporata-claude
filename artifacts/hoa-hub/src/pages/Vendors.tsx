import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { Search, Plus, Phone, Mail, X, AlertCircle, ChevronUp, ChevronDown as ChevronDownIcon } from "lucide-react";
import { useListVendors, useCreateVendor, getListVendorsQueryKey } from "@workspace/api-client-react";
import { InfoPopover } from "@/components/help/InfoPopover";
import { useQueryClient } from "@tanstack/react-query";
import type { Vendor } from "@workspace/api-client-react";
import { isValidEmail, isValidPhone } from "@/lib/validation";

const TRADE_CATEGORIES = [
  "Plumbing", "Roof", "Electrical", "Structural", "Exterior",
  "Landscaping", "HVAC", "General", "Other",
] as const;

const tradeBadgeColors: Record<string, { bg: string; fg: string }> = {
  Plumbing:   { bg: "#E0F2FE", fg: "#0369A1" },
  Roof:       { bg: "#FEF3C7", fg: "#92400E" },
  Electrical: { bg: "#FEF9C3", fg: "#713F12" },
  Structural: { bg: "#FCE7F3", fg: "#9D174D" },
  Exterior:   { bg: "#ECFDF5", fg: "#065F46" },
  Landscaping:{ bg: "#D1FAE5", fg: "#047857" },
  HVAC:       { bg: "#EDE9FE", fg: "#5B21B6" },
  General:    { bg: "#F3F4F6", fg: "#374151" },
  Other:      { bg: "#F3F4F6", fg: "#374151" },
};

type FormState = {
  name: string;
  tradeCategory: string;
  contactName: string;
  phone: string;
  email: string;
  licenseNumber: string;
  notes: string;
};

const emptyForm: FormState = {
  name: "", tradeCategory: "", contactName: "", phone: "", email: "",
  licenseNumber: "", notes: "",
};

type SortKey = "name" | "tradeCategory" | "activeWoCount" | "totalSpend";
type SortDir = "asc" | "desc";

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <span className="ml-1 opacity-0 group-hover:opacity-40"><ChevronUp className="inline h-3 w-3" /></span>;
  return sortDir === "asc"
    ? <ChevronUp className="inline ml-1 h-3 w-3" />
    : <ChevronDownIcon className="inline ml-1 h-3 w-3" />;
}

export default function Vendors() {
  const [q, setQ] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const queryClient = useQueryClient();
  const { data: vendors = [], isLoading } = useListVendors();
  const createMutation = useCreateVendor();

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const filtered = useMemo(() => {
    const base = vendors.filter((v) => {
      if (filterStatus !== "all" && v.status !== filterStatus) return false;
      if (!q) return true;
      const s = q.toLowerCase();
      return (
        v.name.toLowerCase().includes(s) ||
        v.tradeCategory.toLowerCase().includes(s) ||
        v.contactName.toLowerCase().includes(s) ||
        v.email.toLowerCase().includes(s)
      );
    });

    return [...base].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "tradeCategory") cmp = a.tradeCategory.localeCompare(b.tradeCategory);
      else if (sortKey === "activeWoCount") cmp = a.activeWoCount - b.activeWoCount;
      else if (sortKey === "totalSpend") cmp = a.totalSpend - b.totalSpend;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [vendors, q, filterStatus, sortKey, sortDir]);

  const set = (k: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };

  function validate() {
    const e: typeof errors = {};
    if (!form.name.trim()) e.name = "Required";
    if (!form.tradeCategory) e.tradeCategory = "Required";
    if (!form.contactName.trim()) e.contactName = "Required";
    if (!form.phone.trim()) e.phone = "Required";
    else if (!isValidPhone(form.phone)) e.phone = "Invalid phone number";
    if (!form.email.trim()) e.email = "Required";
    else if (!isValidEmail(form.email)) e.email = "Invalid email address";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    await createMutation.mutateAsync({
      data: {
        name: form.name,
        tradeCategory: form.tradeCategory,
        contactName: form.contactName,
        phone: form.phone,
        email: form.email,
        licenseNumber: form.licenseNumber || undefined,
        notes: form.notes || undefined,
        status: "active",
      },
    });
    await queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() });
    setForm(emptyForm);
    setShowModal(false);
  }

  const colHeader = (label: string, key: SortKey) => (
    <th
      key={label}
      className="px-4 py-3 cursor-pointer select-none group"
      style={{ fontWeight: 700 }}
      onClick={() => handleSort(key)}
    >
      {label}
      <SortIcon col={key} sortKey={sortKey} sortDir={sortDir} />
    </th>
  );

  return (
    <Layout
      title="Vendors"
      subtitle="Contractors and service providers"
      actions={
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] hover:opacity-90"
          style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
        >
          <Plus className="h-4 w-4" /> Add Vendor
        </button>
      }
    >
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: c.inkMute }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, trade, contact…"
            className="w-full rounded-md border pl-9 pr-3 py-2 text-[13.5px] outline-none focus:ring-2"
            style={{ borderColor: c.border, background: c.panel, color: c.ink }}
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border p-1" style={{ borderColor: c.border, background: c.panel }}>
          {(["all", "active", "inactive"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilterStatus(f)}
              className="rounded px-3 py-1.5 text-[12.5px] capitalize"
              style={
                filterStatus === f
                  ? { background: c.cobalt, color: "#fff", fontWeight: 600 }
                  : { color: c.inkSoft, fontWeight: 500 }
              }
            >
              {f}
              <span className="ml-1.5 font-mono-num text-[11px] opacity-70">
                {f === "all" ? vendors.length : vendors.filter((v) => v.status === f).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
        {isLoading ? (
          <div className="py-16 text-center text-[13px]" style={{ color: c.inkMute }}>Loading vendors…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center" style={{ color: c.inkMute }}>
            <div className="text-[14px]" style={{ fontWeight: 600 }}>No vendors found</div>
            <div className="text-[13px] mt-1">Add your first vendor using the button above.</div>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead style={{ background: c.canvas }}>
              <tr style={{ color: c.inkMute }} className="text-left text-[11px] uppercase tracking-wider">
                <th className="px-4 py-3 select-none group" style={{ fontWeight: 700 }}>
                  <span className="inline-flex items-center gap-0.5">
                    <span className="cursor-pointer" onClick={() => handleSort("name")}>
                      Vendor <SortIcon col="name" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                    <span onClick={(e) => e.stopPropagation()}>
                      <InfoPopover termKey="vendor" label="Vendor" />
                    </span>
                  </span>
                </th>
                <th className="px-4 py-3 select-none group" style={{ fontWeight: 700 }}>
                  <span className="inline-flex items-center gap-0.5">
                    <span className="cursor-pointer" onClick={() => handleSort("tradeCategory")}>
                      Trade <SortIcon col="tradeCategory" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                    <span onClick={(e) => e.stopPropagation()}>
                      <InfoPopover termKey="trade" label="Trade" />
                    </span>
                  </span>
                </th>
                <th className="px-4 py-3" style={{ fontWeight: 700 }}>Contact</th>
                <th className="px-4 py-3" style={{ fontWeight: 700 }}>Phone</th>
                <th className="px-4 py-3" style={{ fontWeight: 700 }}>Email</th>
                {colHeader("Active WOs", "activeWoCount")}
                {colHeader("Total Spend", "totalSpend")}
                <th className="px-4 py-3" style={{ fontWeight: 700 }}>Status</th>
                <th className="px-4 py-3" style={{ fontWeight: 700 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => {
                const tc = tradeBadgeColors[v.tradeCategory] ?? tradeBadgeColors.Other!;
                return (
                  <tr key={v.id} className="border-t hover:bg-slate-50" style={{ borderColor: c.borderSoft }}>
                    <td className="px-4 py-3">
                      <div style={{ fontWeight: 700, color: c.ink }}>{v.name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="rounded px-1.5 py-0.5 text-[11px]"
                        style={{ background: tc.bg, color: tc.fg, fontWeight: 700 }}
                      >
                        {v.tradeCategory}
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ color: c.inkSoft }}>{v.contactName}</td>
                    <td className="px-4 py-3">
                      <a
                        href={`tel:${v.phone}`}
                        className="inline-flex items-center gap-1 hover:underline"
                        style={{ color: c.cobalt, fontWeight: 500 }}
                      >
                        <Phone className="h-3 w-3" /> {v.phone}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`mailto:${v.email}`}
                        className="inline-flex items-center gap-1 hover:underline"
                        style={{ color: c.cobalt, fontWeight: 500 }}
                      >
                        <Mail className="h-3 w-3" /> {v.email}
                      </a>
                    </td>
                    <td className="px-4 py-3 font-mono-num text-center" style={{ fontWeight: 700, color: v.activeWoCount > 0 ? c.cobalt : c.inkMute }}>
                      {v.activeWoCount}
                    </td>
                    <td className="px-4 py-3 font-mono-num" style={{ fontWeight: 700, color: c.ink }}>
                      ${v.totalSpend.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px]"
                        style={
                          v.status === "active"
                            ? { background: "#DCF3EC", color: "#0E8A6B", fontWeight: 700 }
                            : { background: "#F3F4F6", color: "#6B7280", fontWeight: 700 }
                        }
                      >
                        {v.status === "active" ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/vendors/${v.id}`}
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
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="w-full max-w-lg rounded-2xl border shadow-2xl" style={{ background: c.panel, borderColor: c.border }}>
            <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: c.borderSoft }}>
              <div className="text-[16px]" style={{ fontWeight: 700 }}>Add Vendor</div>
              <button onClick={() => setShowModal(false)} className="rounded-full p-1 hover:bg-slate-100" style={{ color: c.inkMute }}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: errors.name ? c.rose : c.inkSoft }}>
                    Company Name {errors.name && <span className="text-[11px] ml-1">({errors.name})</span>}
                  </label>
                  <input
                    value={form.name}
                    onChange={set("name")}
                    placeholder="e.g. Apex Roofing"
                    className="w-full rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300"
                    style={{ borderColor: errors.name ? c.rose : c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
                <div>
                  <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: errors.tradeCategory ? c.rose : c.inkSoft }}>
                    Trade Category {errors.tradeCategory && <span className="text-[11px] ml-1">({errors.tradeCategory})</span>}
                  </label>
                  <select
                    value={form.tradeCategory}
                    onChange={set("tradeCategory")}
                    className="w-full rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300"
                    style={{ borderColor: errors.tradeCategory ? c.rose : c.border, background: c.canvas, color: c.ink }}
                  >
                    <option value="">Select trade…</option>
                    {TRADE_CATEGORIES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: errors.contactName ? c.rose : c.inkSoft }}>
                    Contact Name {errors.contactName && <span className="text-[11px] ml-1">({errors.contactName})</span>}
                  </label>
                  <input
                    value={form.contactName}
                    onChange={set("contactName")}
                    placeholder="e.g. John Smith"
                    className="w-full rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300"
                    style={{ borderColor: errors.contactName ? c.rose : c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
                <div>
                  <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: errors.phone ? c.rose : c.inkSoft }}>
                    Phone {errors.phone && <span className="text-[11px] ml-1">({errors.phone})</span>}
                  </label>
                  <input
                    value={form.phone}
                    onChange={set("phone")}
                    placeholder="(512) 555-0000"
                    className="w-full rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300"
                    style={{ borderColor: errors.phone ? c.rose : c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
                <div>
                  <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: errors.email ? c.rose : c.inkSoft }}>
                    Email {errors.email && <span className="text-[11px] ml-1">({errors.email})</span>}
                  </label>
                  <input
                    value={form.email}
                    onChange={set("email")}
                    type="email"
                    placeholder="vendor@example.com"
                    className="w-full rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300"
                    style={{ borderColor: errors.email ? c.rose : c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: c.inkSoft }}>
                    License Number <span className="text-[11px]" style={{ color: c.inkMute }}>(optional)</span>
                  </label>
                  <input
                    value={form.licenseNumber}
                    onChange={set("licenseNumber")}
                    placeholder="e.g. TX-PL-44821"
                    className="w-full rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300"
                    style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: c.inkSoft }}>
                    Notes <span className="text-[11px]" style={{ color: c.inkMute }}>(optional)</span>
                  </label>
                  <textarea
                    value={form.notes}
                    onChange={set("notes")}
                    rows={2}
                    placeholder="Any additional notes about this vendor…"
                    className="w-full resize-none rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300"
                    style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
                  />
                </div>
              </div>

              {createMutation.isError && (
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]" style={{ background: "#FBE3E9", color: c.rose }}>
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  Failed to create vendor. Please try again.
                </div>
              )}

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-[13.5px] hover:opacity-90 transition-opacity disabled:opacity-60"
                  style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                >
                  {createMutation.isPending ? "Saving…" : "Add Vendor"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setForm(emptyForm); setErrors({}); }}
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
    </Layout>
  );
}
