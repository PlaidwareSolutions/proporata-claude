import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { ArrowLeft, CheckCircle2, X } from "lucide-react";
import {
  useListBuildings,
  useListUnits,
  useCreateWorkOrder,
  useListVendors,
  useRequestWorkOrderUploadUrl,
  useCreateWorkOrderAttachment,
  useGetSettings,
  getListWorkOrdersQueryKey,
} from "@workspace/api-client-react";
import { Gavel } from "lucide-react";
import { VendorCombobox } from "@/components/VendorCombobox";
import { PhotoStager, uploadPhotoForWorkOrder, type StagedPhoto } from "@/components/PhotoUploader";

// Task #64: gate panel for above-threshold work orders. Lets the manager
// either pick the Adopted expenditure motion that authorizes this work, or
// kick off a new one. The motion id is then sent in the create-WO payload
// so the server can cross-link it as `sourceMotionId`.
function ExpenditureGatePanel({
  title, cents, threshold, motionId, onMotionId,
}: { title: string; cents: number; threshold: number; motionId: string; onMotionId: (v: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function openMotion() {
    if (!title.trim()) { setError("Enter a work order title first"); return; }
    setBusy(true); setError(null);
    try {
      const apiBase = (import.meta as { env: { BASE_URL: string } }).env.BASE_URL;
      const res = await fetch(`${apiBase}api/governance/expenditure-motion`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "work_order",
          targetId: `proposed:${cents}:${title}`,
          amountCents: cents,
          title: `Authorize $${(cents / 100).toFixed(2)} expenditure: ${title}`,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to open motion");
      const m = await res.json() as { id: number };
      onMotionId(String(m.id));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="mt-2 rounded-lg border p-3" style={{ borderColor: "#D63A6033", background: "#FBE3E9" }}>
      <div className="flex items-start gap-2.5">
        <Gavel className="h-4 w-4 mt-0.5" style={{ color: "#B8264C" }} />
        <div className="flex-1">
          <div className="text-[12.5px]" style={{ color: "#7A1733", fontWeight: 700 }}>
            Board approval required: ${(cents / 100).toLocaleString()} ≥ ${(threshold / 100).toLocaleString()} threshold.
          </div>
          <div className="text-[11.5px] mt-0.5" style={{ color: "#7A1733" }}>
            Provide an Adopted expenditure motion id, or open one for board vote.
          </div>
          <div className="flex items-center gap-2 mt-2">
            <input
              type="number" min={0} placeholder="Motion #"
              value={motionId} onChange={(e) => onMotionId(e.target.value)}
              className="w-32 rounded-md border px-2 py-1 text-[12.5px]"
              style={{ borderColor: c.border, background: "#fff" }}
            />
            <button type="button" onClick={openMotion} disabled={busy}
              className="rounded-md px-3 py-1 text-[12px] disabled:opacity-50"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
              {busy ? "Opening…" : "Open expenditure motion"}
            </button>
          </div>
          {error && <div className="text-[11.5px] mt-1" style={{ color: "#7A1733" }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}

const CATEGORIES = ["Plumbing", "Roof", "Electrical", "Structural", "Exterior", "Landscaping", "HVAC"] as const;
const PRIORITIES = ["low", "med", "high", "urgent"] as const;

type FormState = {
  building: string;
  unit: string;
  category: string;
  priority: string;
  title: string;
  description: string;
  vendorId: number | null;
  due: string;
  estCost: string;
  motionId: string;
};

const initial: FormState = {
  building: "",
  unit: "",
  category: "",
  priority: "med",
  title: "",
  description: "",
  vendorId: null,
  due: "",
  estCost: "",
  motionId: "",
};

const priColors = {
  low:    { bg: "#EFF1F8", fg: "#5A6285" },
  med:    { bg: "#E5E8FF", fg: "#3245FF" },
  high:   { bg: "#FBEFD6", fg: "#A66C0E" },
  urgent: { bg: "#FBE3E9", fg: "#B8264C" },
};

export default function CreateWorkOrder() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(initial);
  const [toast, setToast] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  const { data: buildings = [] } = useListBuildings();
  const { data: orgSettings } = useGetSettings();
  const { data: allUnits = [] } = useListUnits();
  const { data: vendors = [] } = useListVendors();
  const createMutation = useCreateWorkOrder();
  const requestUploadUrl = useRequestWorkOrderUploadUrl();
  const createAttachment = useCreateWorkOrderAttachment();
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const set = (k: Exclude<keyof FormState, "vendorId" | "priority">) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };

  const filteredUnits = form.building
    ? allUnits.filter((u) => u.building === Number(form.building))
    : [];

  const activeVendors = vendors.filter((v) => v.status === "active");

  function validate(): boolean {
    const e: typeof errors = {};
    if (!form.building) e.building = "Required";
    if (!form.category) e.category = "Required";
    if (!form.title.trim()) e.title = "Required";
    if (!form.description.trim()) e.description = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;

    const selectedVendor = form.vendorId
      ? vendors.find((v) => v.id === form.vendorId)
      : undefined;

    const created = await createMutation.mutateAsync({
      data: {
        building: Number(form.building),
        unit: form.unit || undefined,
        title: form.title,
        category: form.category as typeof CATEGORIES[number],
        priority: form.priority as typeof PRIORITIES[number],
        status: "open",
        vendor: selectedVendor?.name ?? undefined,
        vendorId: form.vendorId ?? undefined,
        due: form.due || undefined,
        estCost: form.estCost ? Number(form.estCost) : 0,
        description: form.description,
        ...(form.motionId ? { motionId: Number(form.motionId) } : {}),
      } as never,
    });

    if (photos.length > 0 && created?.id) {
      try {
        for (const p of photos) {
          await uploadPhotoForWorkOrder({
            workOrderId: created.id,
            staged: p,
            requestUrl: async (args) => requestUploadUrl.mutateAsync({ id: created.id, data: args }),
            registerAttachment: async (args) =>
              createAttachment.mutateAsync({
                id: args.workOrderId,
                data: {
                  storageKey: args.storageKey,
                  mimeType: args.mimeType,
                  size: args.size,
                  name: args.name,
                },
              }),
          });
        }
      } catch (err) {
        setPhotoError(err instanceof Error ? err.message : "One or more photos failed to upload");
      }
    }

    await queryClient.invalidateQueries({ queryKey: getListWorkOrdersQueryKey() });

    setToast(true);
    setTimeout(() => {
      setToast(false);
      navigate("/work-orders");
    }, 2200);
  }

  const bldg = form.building ? buildings.find((b) => b.num === Number(form.building)) : null;

  return (
    <Layout
      title="New Work Order"
      subtitle="Log a maintenance or repair request"
      actions={
        <Link
          href="/work-orders"
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-[13px] hover:bg-slate-50 transition-colors"
          style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
        >
          <ArrowLeft className="h-4 w-4" /> Work Orders
        </Link>
      }
    >
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border px-5 py-4 shadow-lg"
          style={{ background: c.panel, borderColor: c.emerald, minWidth: 300 }}
        >
          <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: c.emerald }} />
          <div>
            <div className="text-[14px]" style={{ fontWeight: 700 }}>Work Order Created</div>
            <div className="text-[12.5px] mt-0.5" style={{ color: c.inkSoft }}>Redirecting to work orders…</div>
          </div>
          <button
            onClick={() => setToast(false)}
            className="ml-auto rounded-full p-0.5 hover:bg-slate-100"
            style={{ color: c.inkMute }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="max-w-3xl space-y-5">
        <div className="rounded-xl border p-5 space-y-4" style={{ background: c.panel, borderColor: c.border }}>
          <div className="text-[14px] pb-2 border-b" style={{ fontWeight: 700, borderColor: c.borderSoft }}>Location</div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: errors.building ? c.rose : c.inkSoft }}>
                Building {errors.building && <span className="text-[11px] ml-1">({errors.building})</span>}
              </label>
              <select
                value={form.building}
                onChange={set("building")}
                className="w-full rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300"
                style={{ borderColor: errors.building ? c.rose : c.border, background: c.canvas, color: c.ink }}
              >
                <option value="">Select building…</option>
                {buildings.map((b) => (
                  <option key={b.num} value={b.num}>
                    Bldg {String(b.num).padStart(2, "0")} — {b.address}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: c.inkSoft }}>
                Unit <span className="text-[11px]" style={{ color: c.inkMute }}>(optional)</span>
              </label>
              <select
                value={form.unit}
                onChange={set("unit")}
                disabled={!form.building}
                className="w-full rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-50"
                style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
              >
                <option value="">Common area / whole building</option>
                {filteredUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    Unit {u.id} — {u.ownerName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {bldg && (
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px]"
              style={{ background: c.cobaltSoft, color: c.cobalt }}
            >
              <span style={{ fontWeight: 700 }}>Bldg {String(bldg.num).padStart(2, "0")}</span>
              <span style={{ color: c.inkSoft }}>·</span>
              <span>{bldg.address}</span>
              <span style={{ color: c.inkSoft }}>·</span>
              <span>{bldg.units} units · Built {bldg.yearBuilt}</span>
            </div>
          )}
        </div>

        <div className="rounded-xl border p-5 space-y-4" style={{ background: c.panel, borderColor: c.border }}>
          <div className="text-[14px] pb-2 border-b" style={{ fontWeight: 700, borderColor: c.borderSoft }}>Issue Details</div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: errors.category ? c.rose : c.inkSoft }}>
                Issue Type {errors.category && <span className="text-[11px] ml-1">({errors.category})</span>}
              </label>
              <select
                value={form.category}
                onChange={set("category")}
                className="w-full rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300"
                style={{ borderColor: errors.category ? c.rose : c.border, background: c.canvas, color: c.ink }}
              >
                <option value="">Select category…</option>
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[12.5px] font-semibold mb-2" style={{ color: c.inkSoft }}>Priority</label>
              <div className="flex gap-2">
                {PRIORITIES.map((p) => {
                  const pc = priColors[p];
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, priority: p }))}
                      className="flex-1 rounded-lg py-2 text-[12px] font-mono-num transition-all"
                      style={{
                        background: form.priority === p ? pc.bg : c.canvas,
                        color: form.priority === p ? pc.fg : c.inkMute,
                        fontWeight: form.priority === p ? 700 : 500,
                        border: `1.5px solid ${form.priority === p ? pc.fg + "40" : c.border}`,
                      }}
                    >
                      {p.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: errors.title ? c.rose : c.inkSoft }}>
              Title {errors.title && <span className="text-[11px] ml-1">({errors.title})</span>}
            </label>
            <input
              value={form.title}
              onChange={set("title")}
              placeholder="Brief summary of the issue…"
              className="w-full rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300"
              style={{ borderColor: errors.title ? c.rose : c.border, background: c.canvas, color: c.ink }}
            />
          </div>

          <div>
            <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: errors.description ? c.rose : c.inkSoft }}>
              Description {errors.description && <span className="text-[11px] ml-1">({errors.description})</span>}
            </label>
            <textarea
              value={form.description}
              onChange={set("description")}
              rows={4}
              placeholder="Describe the issue in detail — location, when it started, any visible damage…"
              className="w-full resize-none rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300"
              style={{ borderColor: errors.description ? c.rose : c.border, background: c.canvas, color: c.ink }}
            />
          </div>
        </div>

        <div className="rounded-xl border p-5 space-y-4" style={{ background: c.panel, borderColor: c.border }}>
          <div className="text-[14px] pb-2 border-b" style={{ fontWeight: 700, borderColor: c.borderSoft }}>Scheduling & Vendor</div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: c.inkSoft }}>
                Vendor <span className="text-[11px]" style={{ color: c.inkMute }}>(optional)</span>
              </label>
              <VendorCombobox
                vendors={vendors}
                value={form.vendorId}
                onChange={(id) => setForm((f) => ({ ...f, vendorId: id }))}
                preferredCategory={form.category}
              />
            </div>

            <div>
              <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: c.inkSoft }}>
                Due Date <span className="text-[11px]" style={{ color: c.inkMute }}>(optional)</span>
              </label>
              <input
                type="date"
                value={form.due}
                onChange={set("due")}
                className="w-full rounded-lg border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-300"
                style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
              />
            </div>
          </div>

          <div>
            <label className="block text-[12.5px] font-semibold mb-1.5" style={{ color: c.inkSoft }}>
              Estimated Cost <span className="text-[11px]" style={{ color: c.inkMute }}>(optional)</span>
            </label>
            <div className="relative max-w-[200px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style={{ color: c.inkMute }}>$</span>
              <input
                type="number"
                min={0}
                value={form.estCost}
                onChange={set("estCost")}
                placeholder="0"
                className="w-full rounded-lg border pl-7 pr-3 py-2.5 text-[13.5px] font-mono-num outline-none focus:ring-2 focus:ring-blue-300"
                style={{ borderColor: c.border, background: c.canvas, color: c.ink }}
              />
            </div>
            {(() => {
              const bidThreshold = (orgSettings as { bidMinQuotesThresholdCents?: number } | undefined)?.bidMinQuotesThresholdCents ?? 0;
              const expThreshold = (orgSettings as { expenditureThresholdCents?: number } | undefined)?.expenditureThresholdCents ?? 0;
              const cents = form.estCost ? Math.round(Number(form.estCost) * 100) : 0;
              return (
                <>
                  {bidThreshold > 0 && cents >= bidThreshold && (
                    <div className="mt-2 rounded-lg border p-3 flex items-start gap-2.5" style={{ borderColor: "#A66C0E33", background: "#FBEFD6" }}>
                      <Gavel className="h-4 w-4 mt-0.5" style={{ color: "#A66C0E" }} />
                      <div className="flex-1">
                        <div className="text-[12.5px]" style={{ color: "#7A4F0A", fontWeight: 700 }}>
                          Estimated cost meets your competitive-bid threshold (${(bidThreshold / 100).toLocaleString()}).
                        </div>
                        <div className="text-[11.5px] mt-0.5" style={{ color: "#7A4F0A" }}>
                          Consider running a bid to collect at least three vendor quotes before awarding this work.
                        </div>
                        <Link href="/bids">
                          <a className="inline-flex items-center gap-1 mt-1.5 text-[12px]" style={{ color: c.cobalt, fontWeight: 700 }}>
                            Run a bid →
                          </a>
                        </Link>
                      </div>
                    </div>
                  )}
                  {expThreshold > 0 && cents >= expThreshold && (
                    <ExpenditureGatePanel
                      title={form.title}
                      cents={cents}
                      threshold={expThreshold}
                      motionId={form.motionId}
                      onMotionId={(v) => setForm((f) => ({ ...f, motionId: v }))}
                    />
                  )}
                </>
              );
            })()}
          </div>
        </div>

        <div className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
          <div className="text-[14px] pb-2 border-b mb-4" style={{ fontWeight: 700, borderColor: c.borderSoft }}>Photos</div>
          <PhotoStager photos={photos} onChange={setPhotos} />
          {photoError && <div className="text-[11.5px] mt-2" style={{ color: c.rose }}>{photoError}</div>}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-[14px] hover:opacity-90 transition-opacity disabled:opacity-60"
            style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
          >
            {createMutation.isPending ? "Creating…" : "Create Work Order"}
          </button>
          <Link
            href="/work-orders"
            className="inline-flex items-center gap-2 rounded-lg border px-6 py-2.5 text-[14px] hover:bg-slate-50 transition-colors"
            style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
          >
            Cancel
          </Link>
        </div>
      </form>
    </Layout>
  );
}
