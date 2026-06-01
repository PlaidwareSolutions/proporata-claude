import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { useState } from "react";
import { Megaphone, Plus, Trash2, Loader2, CheckCircle2, Building2, Pencil, Pin, PinOff, X } from "lucide-react";
import {
  useListAnnouncements,
  useCreateAnnouncement,
  useUpdateAnnouncement,
  useDeleteAnnouncement,
  useListBuildings,
  getListAnnouncementsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export default function Announcements() {
  const queryClient = useQueryClient();
  // Task #177: residents land here from announcement notifications, so the
  // page is now reachable for any authenticated user. Manager-only controls
  // (compose form, delete, building filter dropdown) are hidden for residents.
  const { user } = useAuth();
  const isResident = user?.role === "resident";
  const { data: announcements = [], isLoading } = useListAnnouncements();
  const { data: buildings = [] } = useListBuildings({ query: { enabled: !isResident } });
  const createMutation = useCreateAnnouncement();
  const updateMutation = useUpdateAnnouncement();
  const deleteMutation = useDeleteAnnouncement();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [buildingId, setBuildingId] = useState<number | "">("");
  const [pinned, setPinned] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  function buildingLabel(id: number | null) {
    if (id == null) return "All Buildings";
    const b = buildings.find((b) => b.num === id);
    return b ? `Building ${b.num} — ${b.street}` : `Building ${id}`;
  }

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setBody("");
    setBuildingId("");
    setPinned(false);
    setShowForm(false);
  }

  function startEdit(a: {
    id: number;
    title: string;
    body: string;
    buildingId: number | null;
    pinned: boolean;
  }) {
    setEditingId(a.id);
    setTitle(a.title);
    setBody(a.body);
    setBuildingId(a.buildingId ?? "");
    setPinned(a.pinned);
    setShowForm(true);
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setState("saving");
    setErrorMsg("");
    try {
      if (editingId != null) {
        await updateMutation.mutateAsync({
          id: editingId,
          data: {
            title: title.trim(),
            body: body.trim(),
            buildingId: buildingId === "" ? null : Number(buildingId),
            pinned,
          },
        });
      } else {
        await createMutation.mutateAsync({
          data: {
            title: title.trim(),
            body: body.trim(),
            buildingId: buildingId === "" ? null : Number(buildingId),
            pinned,
          },
        });
      }
      await queryClient.invalidateQueries({ queryKey: getListAnnouncementsQueryKey() });
      resetForm();
      setState("saved");
      setTimeout(() => setState("idle"), 2500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save announcement");
      setState("error");
      setTimeout(() => setState("idle"), 4000);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this announcement?")) return;
    try {
      await deleteMutation.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: getListAnnouncementsQueryKey() });
    } catch (err) {
      console.error(err);
    }
  }

  async function handleTogglePin(a: { id: number; pinned: boolean }) {
    try {
      await updateMutation.mutateAsync({ id: a.id, data: { pinned: !a.pinned } });
      await queryClient.invalidateQueries({ queryKey: getListAnnouncementsQueryKey() });
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <Layout
      title="Announcements"
      subtitle={isResident ? "Latest community announcements" : "Post community announcements visible to residents"}
      actions={
        !isResident && !showForm ? (
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] hover:opacity-90"
            style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
          >
            <Plus className="h-3.5 w-3.5" /> New Announcement
          </button>
        ) : null
      }
    >
      <div className="max-w-3xl space-y-5">
        {state === "saved" && (
          <div className="flex items-center gap-2 rounded-md px-3 py-2 text-[12.5px]" style={{ background: "#ECFDF5", color: "#059669" }}>
            <CheckCircle2 className="h-4 w-4" /> Announcement saved.
          </div>
        )}
        {state === "error" && (
          <div className="rounded-md px-3 py-2 text-[12.5px]" style={{ background: "#FEF2F2", color: "#B91C1C" }}>
            {errorMsg || "Failed to save announcement."}
          </div>
        )}

        {!isResident && showForm && (
          <form onSubmit={handleSubmit} className="rounded-xl border bg-white p-5 space-y-3" style={{ borderColor: c.border }}>
            <div className="text-[14px]" style={{ fontWeight: 700, color: c.ink }}>
              {editingId != null ? "Edit Announcement" : "New Announcement"}
            </div>
            <div>
              <label className="block text-[12px] font-semibold mb-1" style={{ color: c.inkSoft }}>Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Pool closure this weekend"
                className="w-full rounded-md border px-3 py-2 text-[13.5px]"
                style={{ borderColor: c.border, color: c.ink }}
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold mb-1" style={{ color: c.inkSoft }}>Message</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                placeholder="Write the full announcement here…"
                className="w-full rounded-md border px-3 py-2 text-[13.5px] resize-none"
                style={{ borderColor: c.border, color: c.ink }}
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold mb-1" style={{ color: c.inkSoft }}>Audience</label>
              <select
                value={buildingId === "" ? "" : String(buildingId)}
                onChange={(e) => setBuildingId(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-full rounded-md border px-3 py-2 text-[13px] bg-white"
                style={{ borderColor: c.border, color: c.ink }}
              >
                <option value="">All Buildings</option>
                {buildings.map((b) => (
                  <option key={b.num} value={b.num}>Building {b.num} — {b.street}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-[13px]" style={{ color: c.ink }}>
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
              />
              <Pin className="h-3.5 w-3.5" style={{ color: c.cobalt }} />
              Pin to top of resident dashboard
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={state === "saving" || !title.trim() || !body.trim()}
                className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-[13px] hover:opacity-90 disabled:opacity-50"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
              >
                {state === "saving"
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
                  : editingId != null ? "Save Changes" : "Post Announcement"}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="rounded-md border px-4 py-2 text-[13px] hover:bg-slate-50"
                style={{ borderColor: c.border, color: c.inkSoft }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <section className="rounded-xl border bg-white" style={{ borderColor: c.border }}>
          <div className="flex items-center gap-2 border-b px-5 py-4" style={{ borderColor: c.border }}>
            <Megaphone className="h-4 w-4" style={{ color: c.inkMute }} />
            <h3 className="text-[15px]" style={{ fontWeight: 700, color: c.ink }}>Posted Announcements</h3>
            <span className="ml-auto font-mono-num rounded px-2 py-0.5 text-[11px]" style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}>
              {announcements.length}
            </span>
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 gap-2" style={{ color: c.inkMute }}>
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-[13px]">Loading…</span>
            </div>
          ) : announcements.length === 0 ? (
            <div className="py-12 text-center">
              <Megaphone className="mx-auto h-8 w-8 mb-3" style={{ color: c.inkMute, opacity: 0.4 }} />
              <p className="text-[13px]" style={{ color: c.inkMute }}>No announcements yet.</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: c.border }}>
              {announcements.map((a) => (
                <div key={a.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      {a.pinned && (
                        <span className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded" style={{ background: "#FEF3C7", color: "#92400E", fontWeight: 700 }}>
                          <Pin className="h-3 w-3" /> PINNED
                        </span>
                      )}
                      <div className="text-[13.5px] truncate" style={{ fontWeight: 700, color: c.ink }}>{a.title}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!isResident && (
                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full" style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 600 }}>
                          <Building2 className="h-3 w-3" />
                          {buildingLabel(a.buildingId ?? null)}
                        </span>
                      )}
                      {!isResident && (
                        <button
                          onClick={() => handleTogglePin({ id: a.id, pinned: a.pinned })}
                          className="rounded p-1 hover:bg-slate-100"
                          title={a.pinned ? "Unpin" : "Pin to top"}
                          style={{ color: a.pinned ? c.cobalt : c.inkMute }}
                        >
                          {a.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      {!isResident && (
                        <button
                          onClick={() => startEdit({
                            id: a.id,
                            title: a.title,
                            body: a.body,
                            buildingId: a.buildingId ?? null,
                            pinned: a.pinned,
                          })}
                          className="rounded p-1 hover:bg-slate-100"
                          title="Edit"
                          style={{ color: c.inkMute }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {!isResident && (
                        <button
                          onClick={() => handleDelete(a.id)}
                          className="rounded p-1 hover:bg-slate-100"
                          title="Delete"
                          style={{ color: c.inkMute }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-[12.5px] whitespace-pre-wrap mb-2" style={{ color: c.inkSoft }}>{a.body}</p>
                  <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[11.5px]" style={{ color: c.inkMute }}>
                    <span>{new Date(a.createdAt).toLocaleString()}</span>
                    <span>·</span>
                    <span>By {a.createdBy}</span>
                    {a.updatedAt && (
                      <>
                        <span>·</span>
                        <span style={{ fontStyle: "italic" }}>
                          Edited {new Date(a.updatedAt).toLocaleString()}
                          {a.updatedBy ? ` by ${a.updatedBy}` : ""}
                        </span>
                      </>
                    )}
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
