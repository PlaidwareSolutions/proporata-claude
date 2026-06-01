import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { Palette, Plus, X, CheckCircle2, AlertCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  accFetch, PROJECT_TYPES, STATUS_META, uploadAccFile, type AccRequest,
} from "@/lib/architectural";

interface FormState {
  projectType: string;
  title: string;
  description: string;
  contractorName: string;
  plannedStart: string;
  plannedEnd: string;
  acknowledgedGuidelines: boolean;
}

const empty: FormState = {
  projectType: "",
  title: "",
  description: "",
  contractorName: "",
  plannedStart: "",
  plannedEnd: "",
  acknowledgedGuidelines: false,
};

export default function ResidentArchitectural() {
  const { user } = useAuth();
  const [items, setItems] = useState<AccRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ name: string; storageKey: string; size: number; contentType: string }>>([]);

  async function reload() {
    setLoading(true);
    try {
      const r = await accFetch<AccRequest[]>("/api/architectural-requests");
      setItems(r);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, []);

  // Auto-open the submission form when arriving via the global
  // quick-create menu (e.g. /portal/architectural?new=1). Only if the
  // resident actually has a unit assigned, since the form requires it.
  const search = useSearch();
  useEffect(() => {
    if (new URLSearchParams(search).get("new") === "1" && user?.unitId) {
      setShowForm(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [search, user?.unitId]);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  }

  function validate() {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.projectType) e.projectType = "Required";
    if (!form.title.trim()) e.title = "Required";
    if (!form.description.trim()) e.description = "Required";
    if (!form.acknowledgedGuidelines) e.acknowledgedGuidelines = "You must acknowledge the HOA architectural guidelines.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleAttach(ev: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(ev.target.files ?? []);
    for (const f of files) {
      if (attachments.length >= 10) {
        alert("At most 10 attachments allowed.");
        break;
      }
      try {
        const a = await uploadAccFile(f);
        setAttachments((p) => [...p, a]);
      } catch (e) {
        console.error(e);
      }
    }
    ev.target.value = "";
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await accFetch("/api/architectural-requests", {
        method: "POST",
        body: JSON.stringify({
          projectType: form.projectType,
          title: form.title.trim(),
          description: form.description.trim(),
          contractorName: form.contractorName.trim() || null,
          plannedStart: form.plannedStart || null,
          plannedEnd: form.plannedEnd || null,
          acknowledgedGuidelines: form.acknowledgedGuidelines,
          attachments,
        }),
      });
      setForm(empty);
      setAttachments([]);
      setShowForm(false);
      setToast(true);
      setTimeout(() => setToast(false), 3500);
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Layout title="Architectural Requests" subtitle="Request approval for exterior changes">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border px-5 py-4 shadow-lg" style={{ background: c.panel, borderColor: c.emerald, minWidth: 300 }}>
          <CheckCircle2 className="h-5 w-5" style={{ color: c.emerald }} />
          <div>
            <div className="text-[14px]" style={{ fontWeight: 700 }}>Request submitted</div>
            <div className="text-[12.5px] mt-0.5" style={{ color: c.inkSoft }}>The board will review your request shortly.</div>
          </div>
        </div>
      )}

      <div className="max-w-4xl space-y-5">
        <section className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <Palette className="h-5 w-5" style={{ color: c.cobalt }} />
              <h2 className="text-[16px]" style={{ fontWeight: 700 }}>My Architectural Requests</h2>
            </div>
            {!showForm && user?.unitId && (
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] hover:opacity-90"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
              >
                <Plus className="h-3.5 w-3.5" /> Submit request
              </button>
            )}
          </div>

          {!user?.unitId && (
            <div className="rounded-lg border p-4 text-center" style={{ borderColor: c.border, color: c.inkMute }}>
              <AlertCircle className="h-5 w-5 mx-auto mb-1" />
              <div className="text-[13px]">Contact your property manager to be assigned a unit before submitting.</div>
            </div>
          )}

          {showForm && (
            <form onSubmit={handleSubmit} className="rounded-lg border p-4 space-y-3 mb-4" style={{ borderColor: c.border, background: c.canvas }}>
              <div className="text-[13.5px]" style={{ fontWeight: 700, color: c.ink }}>New architectural change request</div>

              <Field label="Project type" error={errors.projectType}>
                <select value={form.projectType} onChange={(e) => set("projectType", e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-[13px] bg-white"
                  style={{ borderColor: errors.projectType ? c.rose : c.border, color: c.ink }}>
                  <option value="">Select project type…</option>
                  {PROJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>

              <Field label="Title" error={errors.title}>
                <input value={form.title} onChange={(e) => set("title", e.target.value)}
                  placeholder="e.g. Repaint exterior trim"
                  className="w-full rounded-md border px-3 py-2 text-[13px] bg-white"
                  style={{ borderColor: errors.title ? c.rose : c.border, color: c.ink }} />
              </Field>

              <Field label="Description" error={errors.description}>
                <textarea value={form.description} onChange={(e) => set("description", e.target.value)}
                  rows={4} placeholder="Describe materials, colors, dimensions, scope, and any contractor info."
                  className="w-full rounded-md border px-3 py-2 text-[13px] bg-white"
                  style={{ borderColor: errors.description ? c.rose : c.border, color: c.ink }} />
              </Field>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Contractor (optional)">
                  <input value={form.contractorName} onChange={(e) => set("contractorName", e.target.value)}
                    placeholder="Contractor name"
                    className="w-full rounded-md border px-3 py-2 text-[13px] bg-white"
                    style={{ borderColor: c.border, color: c.ink }} />
                </Field>
                <Field label="Planned start">
                  <input type="date" value={form.plannedStart} onChange={(e) => set("plannedStart", e.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-[13px] bg-white"
                    style={{ borderColor: c.border, color: c.ink }} />
                </Field>
                <Field label="Planned end">
                  <input type="date" value={form.plannedEnd} onChange={(e) => set("plannedEnd", e.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-[13px] bg-white"
                    style={{ borderColor: c.border, color: c.ink }} />
                </Field>
              </div>

              <Field label="Photos / drawings (optional)">
                <input type="file" multiple accept="image/*,application/pdf" onChange={handleAttach}
                  className="w-full text-[12px]" />
                {attachments.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {attachments.map((a, i) => (
                      <li key={i} className="text-[12px] flex items-center gap-2" style={{ color: c.inkSoft }}>
                        <span>{a.name}</span>
                        <button type="button" onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))} style={{ color: c.rose }}>
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Field>

              <label className="flex items-start gap-2 text-[12.5px]" style={{ color: errors.acknowledgedGuidelines ? c.rose : c.inkSoft }}>
                <input type="checkbox" checked={form.acknowledgedGuidelines} onChange={(e) => set("acknowledgedGuidelines", e.target.checked)} className="mt-0.5" />
                <span>I have read and will comply with the HOA architectural guidelines, and I understand that work begun without approval may be subject to remediation.</span>
              </label>
              {errors.acknowledgedGuidelines && (
                <div className="text-[11.5px]" style={{ color: c.rose }}>{errors.acknowledgedGuidelines}</div>
              )}

              <div className="flex items-center gap-2">
                <button type="submit" disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] disabled:opacity-60"
                  style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
                  {submitting ? "Submitting…" : "Submit request"}
                </button>
                <button type="button" onClick={() => { setShowForm(false); setForm(empty); setAttachments([]); }}
                  className="rounded-md border px-3 py-1.5 text-[13px]"
                  style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="text-[13px] text-center py-6" style={{ color: c.inkMute }}>Loading…</div>
          ) : items.length === 0 ? (
            <div className="text-[13px] text-center py-6" style={{ color: c.inkMute }}>No requests yet.</div>
          ) : (
            <ul className="space-y-2">
              {items.map((r) => {
                const meta = STATUS_META[r.status];
                return (
                  <li key={r.id}>
                    <Link href={`/portal/architectural/${r.id}`}
                      className="flex items-center gap-3 rounded-lg border px-3 py-2.5 hover:bg-slate-50"
                      style={{ borderColor: c.borderSoft }}>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] truncate" style={{ color: c.ink, fontWeight: 600 }}>{r.title}</div>
                        <div className="text-[11.5px]" style={{ color: c.inkMute }}>
                          {r.projectType} · submitted {r.submittedAt.slice(0, 10)}
                        </div>
                      </div>
                      <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: meta.bg, color: meta.fg, fontWeight: 700 }}>
                        {meta.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Layout>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] mb-1" style={{ color: error ? c.rose : c.inkSoft, fontWeight: 600 }}>
        {label} {error && <span className="text-[11px]">({error})</span>}
      </label>
      {children}
    </div>
  );
}
