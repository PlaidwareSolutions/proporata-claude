import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "wouter";
import {
  useGetUnit,
  useListWorkOrders,
  useCreateWorkOrder,
  useRequestWorkOrderUploadUrl,
  useCreateWorkOrderAttachment,
  useListAnnouncements,
  getListWorkOrdersQueryKey,
  useListNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  getListNotificationsQueryKey,
} from "@workspace/api-client-react";
import {
  Home, Wrench, CheckCircle2, Clock, AlertCircle, Plus, X,
  BedDouble, Bath, Maximize2, ClipboardList, Bell, CheckCheck, Check, Megaphone, Pin,
} from "lucide-react";
import { MotionsAwaitingVoteWidget } from "@/components/MotionsAwaitingVoteWidget";
import { MyViolationsCard } from "@/components/MyViolationsCard";
import { PhotoStager, uploadPhotoForWorkOrder, type StagedPhoto } from "@/components/PhotoUploader";

const CATEGORIES = ["Plumbing", "Roof", "Electrical", "Structural", "Exterior", "Landscaping", "HVAC"] as const;

type RequestForm = {
  title: string;
  category: string;
  description: string;
};

const statusMeta: Record<string, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  open:        { label: "Open",        color: "#B8264C", bg: "#FBE3E9", Icon: AlertCircle },
  scheduled:   { label: "Scheduled",   color: "#A66C0E", bg: "#FBEFD6", Icon: Clock },
  in_progress: { label: "In Progress", color: "#3245FF", bg: "#E5E8FF", Icon: Wrench },
  done:        { label: "Done",        color: "#0E8A6B", bg: "#DCF3EC", Icon: CheckCircle2 },
};

const priColors: Record<string, { bg: string; fg: string }> = {
  low:    { bg: "#EFF1F8", fg: "#5A6285" },
  med:    { bg: "#E5E8FF", fg: "#3245FF" },
  high:   { bg: "#FBEFD6", fg: "#A66C0E" },
  urgent: { bg: "#FBE3E9", fg: "#B8264C" },
};

export default function ResidentPortal() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const unitId = user?.unitId ?? "";
  const { data: unit } = useGetUnit(unitId || "-");
  const { data: workOrders = [] } = useListWorkOrders();
  const { data: announcements = [] } = useListAnnouncements();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<RequestForm>({ title: "", category: "", description: "" });
  const [errors, setErrors] = useState<Partial<RequestForm>>({});
  const [toast, setToast] = useState(false);

  const createMutation = useCreateWorkOrder();
  const requestUploadUrl = useRequestWorkOrderUploadUrl();
  const createAttachment = useCreateWorkOrderAttachment();
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const set = (k: keyof RequestForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };

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

    setPhotoError(null);
    const created = await createMutation.mutateAsync({
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
    setForm({ title: "", category: "", description: "" });
    setPhotos([]);
    setShowForm(false);
    setToast(true);
    setTimeout(() => setToast(false), 3000);
  }

  const openRequests = workOrders.filter((w) => w.status !== "done");
  const doneRequests = workOrders.filter((w) => w.status === "done");

  // Task #29: surface the resident's own notifications in their portal so
  // they can see and dismiss work-order updates without opening the bell.
  const { data: notifications = [] } = useListNotifications({
    query: { queryKey: getListNotificationsQueryKey(), refetchInterval: 30000 },
  });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const recentNotifs = notifications.slice(0, 8);
  const unreadNotifs = notifications.filter((n) => !n.read).length;

  function notifLink(n: { entityType?: string | null; entityId?: string | null }): string | null {
    if (n.entityType === "work_order" && n.entityId) return `/work-orders/${n.entityId}`;
    return null;
  }
  function timeAgo(iso: string): string {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }
  async function handleMarkRead(id: number) {
    await markRead.mutateAsync({ id });
    queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
  }
  async function handleMarkAllRead() {
    await markAllRead.mutateAsync();
    queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
  }

  return (
    <Layout title="My Portal" subtitle="Your home at a glance">
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border px-5 py-4 shadow-lg"
          style={{ background: c.panel, borderColor: c.emerald, minWidth: 300 }}
        >
          <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: c.emerald }} />
          <div>
            <div className="text-[14px]" style={{ fontWeight: 700 }}>Request Submitted</div>
            <div className="text-[12.5px] mt-0.5" style={{ color: c.inkSoft }}>Your maintenance request has been received.</div>
          </div>
          <button onClick={() => setToast(false)} className="ml-auto rounded-full p-0.5 hover:bg-slate-100" style={{ color: c.inkMute }}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="max-w-4xl space-y-6">
        <MotionsAwaitingVoteWidget variant="compact" />
        <MyViolationsCard />
        {unit ? (
          <section className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: c.cobaltSoft }}>
                  <Home className="h-5 w-5" style={{ color: c.cobalt }} />
                </div>
                <div>
                  <div className="text-[17px]" style={{ fontWeight: 700, color: c.ink }}>{unit.address}</div>
                  <div className="text-[13px]" style={{ color: c.inkSoft }}>Unit {unit.unit}</div>
                </div>
              </div>
              <span
                className="text-[11px] px-2.5 py-1 rounded-full"
                style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}
              >
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
                  <div className="text-[18px] font-mono-num" style={{ fontWeight: 700, color: c.ink }}>{value}</div>
                  <div className="text-[11.5px]" style={{ color: c.inkMute }}>{label}</div>
                </div>
              ))}
            </div>
          </section>
        ) : unitId ? (
          <div className="rounded-xl border p-6 text-center text-[13px]" style={{ borderColor: c.border, color: c.inkMute }}>
            Loading unit details…
          </div>
        ) : (
          <div className="rounded-xl border p-6 text-center" style={{ borderColor: c.border }}>
            <div className="text-[14px]" style={{ fontWeight: 600, color: c.ink }}>No unit assigned</div>
            <div className="text-[13px] mt-1" style={{ color: c.inkMute }}>Contact your property manager to be assigned a unit.</div>
          </div>
        )}

        <section
          className="rounded-xl border p-5"
          style={{ background: c.panel, borderColor: c.border }}
          data-testid="resident-notifications"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <Bell className="h-5 w-5" style={{ color: c.cobalt }} />
              <h2 className="text-[16px]" style={{ fontWeight: 700 }}>Notifications</h2>
              {unreadNotifs > 0 && (
                <span
                  className="font-mono-num text-[11px] px-2 py-0.5 rounded"
                  style={{ background: c.cobalt, color: "#fff", fontWeight: 700 }}
                >
                  {unreadNotifs} new
                </span>
              )}
            </div>
            {unreadNotifs > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="inline-flex items-center gap-1.5 text-[12px] hover:underline"
                style={{ color: c.cobalt, fontWeight: 600 }}
                data-testid="resident-notifications-mark-all"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>
          {recentNotifs.length === 0 ? (
            <div className="text-center py-6" style={{ color: c.inkMute }}>
              <Bell className="h-7 w-7 mx-auto mb-1.5 opacity-30" />
              <div className="text-[13px]">No notifications yet.</div>
              <div className="text-[12px] mt-1">
                You'll be notified here when your maintenance requests are updated.
              </div>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {recentNotifs.map((n) => {
                const href = notifLink(n);
                const body = (
                  <div
                    className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-slate-50"
                    style={{ background: n.read ? "transparent" : c.cobaltSoft }}
                  >
                    <div className="mt-0.5">
                      {!n.read ? (
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ background: c.cobalt }}
                        />
                      ) : (
                        <span className="inline-block h-2 w-2 rounded-full bg-transparent" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-[13px]"
                        style={{ color: c.ink, fontWeight: n.read ? 500 : 600 }}
                      >
                        {n.message}
                      </div>
                      <div className="text-[11.5px] mt-0.5" style={{ color: c.inkMute }}>
                        {timeAgo(n.createdAt)}
                      </div>
                    </div>
                    {!n.read && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleMarkRead(n.id);
                        }}
                        className="rounded-md p-1 hover:bg-white"
                        title="Mark as read"
                        data-testid={`resident-notification-mark-read-${n.id}`}
                      >
                        <Check className="h-3.5 w-3.5" style={{ color: c.cobalt }} />
                      </button>
                    )}
                  </div>
                );
                return (
                  <li key={n.id}>
                    {href ? (
                      <Link
                        href={href}
                        onClick={() => {
                          if (!n.read) handleMarkRead(n.id);
                        }}
                      >
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <ClipboardList className="h-5 w-5" style={{ color: c.cobalt }} />
              <h2 className="text-[16px]" style={{ fontWeight: 700 }}>Maintenance Requests</h2>
              {openRequests.length > 0 && (
                <span className="font-mono-num text-[11px] px-2 py-0.5 rounded" style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}>
                  {openRequests.length} open
                </span>
              )}
            </div>
            {unit && !showForm && (
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] hover:opacity-90"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
              >
                <Plus className="h-3.5 w-3.5" /> Submit Request
              </button>
            )}
          </div>

          {showForm && (
            <form onSubmit={handleSubmit} className="mb-5 rounded-lg border p-4 space-y-3" style={{ borderColor: c.border, background: c.canvas }}>
              <div className="text-[13.5px]" style={{ fontWeight: 700, color: c.ink }}>New Maintenance Request</div>
              <div>
                <label className="block text-[12px] font-semibold mb-1" style={{ color: errors.category ? c.rose : c.inkSoft }}>
                  Issue Type {errors.category && <span className="text-[11px]">({errors.category})</span>}
                </label>
                <select
                  value={form.category}
                  onChange={set("category")}
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
                  onChange={set("title")}
                  placeholder="Brief summary of the issue…"
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
                  onChange={set("description")}
                  rows={3}
                  placeholder="Describe the issue — location, when it started, any visible damage…"
                  className="w-full resize-none rounded-lg border px-3 py-2 text-[13px]"
                  style={{ borderColor: errors.description ? c.rose : c.border, background: "#fff", color: c.ink }}
                />
              </div>
              <div>
                <label className="block text-[12px] font-semibold mb-1" style={{ color: c.inkSoft }}>
                  Photos <span className="text-[11px]" style={{ color: c.inkMute }}>(optional, up to 5)</span>
                </label>
                <PhotoStager photos={photos} onChange={setPhotos} />
                {photoError && <div className="text-[11.5px] mt-1.5" style={{ color: c.rose }}>{photoError}</div>}
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] hover:opacity-90 disabled:opacity-60"
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
            <div className="text-center py-8" style={{ color: c.inkMute }}>
              <ClipboardList className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <div className="text-[13px]">No maintenance requests yet.</div>
              {unit && <div className="text-[12px] mt-1">Use the button above to submit your first request.</div>}
            </div>
          ) : (
            <div className="space-y-3">
              {[...openRequests, ...doneRequests].map((wo) => {
                const meta = statusMeta[wo.status] ?? statusMeta.open;
                const pri = priColors[wo.priority] ?? priColors.med;
                const Icon = meta.Icon;
                return (
                  <Link
                    key={wo.id}
                    href={`/work-orders/${wo.id}`}
                    className="flex items-start gap-3 rounded-lg border p-3.5 hover:bg-slate-50 transition-colors"
                    style={{ borderColor: c.borderSoft }}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md mt-0.5" style={{ background: meta.bg }}>
                      <Icon className="h-4 w-4" style={{ color: meta.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13.5px]" style={{ fontWeight: 600, color: c.ink }}>{wo.title}</span>
                        <span className="text-[10.5px] px-2 py-0.5 rounded-full" style={{ background: meta.bg, color: meta.color, fontWeight: 700 }}>
                          {meta.label}
                        </span>
                        <span className="text-[10.5px] px-2 py-0.5 rounded-full" style={{ background: pri.bg, color: pri.fg, fontWeight: 700 }}>
                          {wo.priority.toUpperCase()}
                        </span>
                      </div>
                      {wo.description && (
                        <div className="text-[12.5px] mt-1 line-clamp-2" style={{ color: c.inkSoft }}>{wo.description}</div>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 text-[11.5px]" style={{ color: c.inkMute }}>
                        <span>{wo.category}</span>
                        <span>·</span>
                        <span>Opened {wo.opened}</span>
                        {wo.vendor && <><span>·</span><span>Assigned: {wo.vendor}</span></>}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="h-2 w-2 rounded-full" style={{ background: "#0E8A6B" }} />
            <h2 className="text-[16px]" style={{ fontWeight: 700 }}>Community Announcements</h2>
          </div>
          {announcements.length === 0 ? (
            <div className="rounded-lg border p-4 text-center" style={{ borderColor: c.borderSoft, background: c.canvas }}>
              <div className="text-[13px]" style={{ color: c.inkMute }}>No announcements at this time.</div>
              <div className="text-[12px] mt-1" style={{ color: c.inkMute }}>Check back later for updates from management.</div>
            </div>
          ) : (
            <div className="space-y-3">
              {announcements.slice(0, 5).map((a) => (
                <div
                  key={a.id}
                  className="rounded-lg border p-3.5"
                  style={{
                    borderColor: a.pinned ? "#F59E0B" : c.borderSoft,
                    background: a.pinned ? "#FFFBEB" : c.canvas,
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md mt-0.5"
                      style={{ background: a.pinned ? "#FEF3C7" : "#DCF3EC" }}
                    >
                      {a.pinned
                        ? <Pin className="h-4 w-4" style={{ color: "#92400E" }} />
                        : <Megaphone className="h-4 w-4" style={{ color: "#0E8A6B" }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {a.pinned && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#FEF3C7", color: "#92400E", fontWeight: 700 }}>
                            <Pin className="h-2.5 w-2.5" /> PINNED
                          </span>
                        )}
                        <div className="text-[13.5px]" style={{ fontWeight: 700, color: c.ink }}>{a.title}</div>
                      </div>
                      <div className="text-[12.5px] mt-1 whitespace-pre-wrap" style={{ color: c.inkSoft }}>{a.body}</div>
                      <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-1.5 text-[11.5px]" style={{ color: c.inkMute }}>
                        <span>{new Date(a.createdAt).toLocaleString()}</span>
                        <span>·</span>
                        <span>{a.buildingId ? `Building ${a.buildingId}` : "All Buildings"}</span>
                        {a.updatedAt && (
                          <>
                            <span>·</span>
                            <span style={{ fontStyle: "italic" }}>
                              Edited {new Date(a.updatedAt).toLocaleString()}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
