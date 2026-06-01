import { useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListBuildingSystems,
  useCreateBuildingSystem,
  useUpdateBuildingSystem,
  useListBuildingSystemInspections,
  useCreateBuildingSystemInspection,
  useListBuildingSystemDocuments,
  useLinkBuildingSystemDocument,
  useListBuildingSystemRepairs,
  useLinkBuildingSystemRepair,
  useListDocuments,
  useCreateDocument,
  useRequestUploadUrl,
  getListBuildingSystemsQueryKey,
  getListBuildingSystemInspectionsQueryKey,
  getListBuildingSystemDocumentsQueryKey,
  getListBuildingSystemRepairsQueryKey,
  getListDocumentsQueryKey,
  getGetBuildingSystemQueryKey,
} from "@workspace/api-client-react";
import type {
  BuildingSystem,
  CreateBuildingSystemBody,
  UpdateBuildingSystemBody,
} from "@workspace/api-client-react";
import { c } from "@/lib/theme";
import { HardHat, Plus, Calendar, Wrench, Pencil, Archive, FileText, Link2, Upload } from "lucide-react";

const KINDS: CreateBuildingSystemBody["kind"][] = [
  "roof", "hvac", "plumbing", "electrical", "foundation",
  "exterior", "fire_safety", "elevator", "other",
];

const DOC_KINDS = ["install", "warranty", "manual", "inspection", "repair", "other"];

async function openDocument(documentId: string, fallbackName?: string) {
  const res = await fetch(`/api/documents/${documentId}/download`);
  if (!res.ok) throw new Error("Failed to get download URL");
  const contentType = res.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/pdf")) {
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), {
      href: blobUrl,
      download: fallbackName ?? `${documentId}.pdf`,
    });
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
  } else {
    const { url } = (await res.json()) as { url: string };
    const fullUrl = url.startsWith("http") ? url : `${window.location.origin}${url}`;
    window.open(fullUrl, "_blank", "noopener,noreferrer");
  }
}

const statusStyle = {
  good:   { bg: c.emeraldSoft, fg: c.emerald, label: "GOOD" },
  watch:  { bg: c.amberSoft,   fg: c.amber,   label: "WATCH" },
  action: { bg: c.roseSoft,    fg: c.rose,    label: "ACTION" },
} as const;

export function BuildingSystemsSection({ building, canEdit = false }: { building: number; canEdit?: boolean }) {
  const queryClient = useQueryClient();
  const { data: systems = [], isLoading } = useListBuildingSystems(
    { building },
    { query: { queryKey: getListBuildingSystemsQueryKey({ building }) } },
  );
  const createMutation = useCreateBuildingSystem();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Partial<CreateBuildingSystemBody>>({ kind: "roof" });
  const [expanded, setExpanded] = useState<number | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.label || !form.kind) return;
    await createMutation.mutateAsync({
      data: {
        building,
        kind: form.kind,
        label: form.label,
        installedOn: form.installedOn || null,
        warrantyExpiresOn: form.warrantyExpiresOn || null,
        manufacturer: form.manufacturer || null,
        model: form.model || null,
        serialNo: form.serialNo || null,
        notes: form.notes || null,
      },
    });
    await queryClient.invalidateQueries({ queryKey: getListBuildingSystemsQueryKey({ building }) });
    setForm({ kind: "roof" });
    setShowForm(false);
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: c.panel, borderColor: c.border }}>
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: c.border }}>
        <div>
          <div className="text-[15px] flex items-center gap-2" style={{ fontWeight: 700 }}>
            <HardHat className="h-4 w-4" style={{ color: c.inkMute }} /> Building Systems
          </div>
          <div className="text-[12.5px] mt-0.5" style={{ color: c.inkMute }}>
            Roof, HVAC, plumbing & other major components — install, warranty, inspections, repairs, documents
          </div>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowForm((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] hover:bg-slate-50"
            style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 600 }}
          >
            <Plus className="h-3.5 w-3.5" /> {showForm ? "Cancel" : "Add system"}
          </button>
        )}
      </div>

      {showForm && canEdit && (
        <form onSubmit={handleAdd} className="px-5 py-4 border-b grid grid-cols-3 gap-3" style={{ borderColor: c.borderSoft, background: c.canvas }}>
          <SelectField label="Kind" value={form.kind ?? "roof"} onChange={(v) => setForm({ ...form, kind: v as CreateBuildingSystemBody["kind"] })} options={KINDS} />
          <TextField label="Label *" value={form.label ?? ""} onChange={(v) => setForm({ ...form, label: v })} required />
          <TextField label="Installed on" type="date" value={form.installedOn ?? ""} onChange={(v) => setForm({ ...form, installedOn: v })} />
          <TextField label="Warranty expires" type="date" value={form.warrantyExpiresOn ?? ""} onChange={(v) => setForm({ ...form, warrantyExpiresOn: v })} />
          <TextField label="Manufacturer" value={form.manufacturer ?? ""} onChange={(v) => setForm({ ...form, manufacturer: v })} />
          <TextField label="Model" value={form.model ?? ""} onChange={(v) => setForm({ ...form, model: v })} />
          <div className="col-span-3 flex justify-end">
            <button type="submit" disabled={createMutation.isPending} className="rounded-md px-4 py-1.5 text-[13px] disabled:opacity-60" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
              {createMutation.isPending ? "Saving…" : "Save system"}
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="py-10 text-center text-[13px]" style={{ color: c.inkMute }}>Loading…</div>
      ) : systems.length === 0 ? (
        <div className="py-10 text-center text-[13px]" style={{ color: c.inkMute }}>No systems tracked yet.</div>
      ) : (
        <table className="w-full text-[13px]">
          <thead style={{ background: c.canvas }}>
            <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: c.inkMute }}>
              {["Kind", "Label", "Installed", "Warranty", "Last inspected", "Status", ""].map((h) => (
                <th key={h} className="px-4 py-3" style={{ fontWeight: 700 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {systems.map((s: BuildingSystem) => {
              const st = statusStyle[s.derivedStatus];
              const isOpen = expanded === s.id;
              const retired = !!s.retiredOn;
              return (
                <>
                  <tr key={s.id} className="border-t hover:bg-slate-50 cursor-pointer" style={{ borderColor: c.borderSoft, opacity: retired ? 0.6 : 1 }} onClick={() => setExpanded(isOpen ? null : s.id)}>
                    <td className="px-4 py-2.5 font-mono-num uppercase" style={{ color: c.inkSoft }}>{s.kind.replace("_", " ")}</td>
                    <td className="px-4 py-2.5" style={{ color: c.ink, fontWeight: 600 }}>
                      {s.label}
                      {retired && <span className="ml-2 text-[11px] uppercase" style={{ color: c.inkMute, fontWeight: 700 }}>retired {s.retiredOn}</span>}
                    </td>
                    <td className="px-4 py-2.5 font-mono-num" style={{ color: c.inkSoft }}>{s.installedOn ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono-num" style={{ color: c.inkSoft }}>{s.warrantyExpiresOn ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono-num" style={{ color: c.inkSoft }}>{s.lastInspectedOn ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: st.bg, color: st.fg, fontWeight: 700 }}>{st.label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-[12px]" style={{ color: c.cobalt, fontWeight: 600 }}>{isOpen ? "Hide" : "Details"}</td>
                  </tr>
                  {isOpen && (
                    <tr style={{ background: c.canvas }}>
                      <td colSpan={7} className="px-4 py-3 border-t" style={{ borderColor: c.borderSoft }}>
                        <SystemDetail system={s} canEdit={canEdit} />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SystemDetail({ system, canEdit }: { system: BuildingSystem; canEdit: boolean }) {
  const [tab, setTab] = useState<"inspections" | "documents" | "repairs" | "edit">("inspections");
  const tabs = [
    { id: "inspections", label: "Inspections", icon: Calendar },
    { id: "documents",   label: "Documents",   icon: FileText },
    { id: "repairs",     label: "Repairs",     icon: Wrench },
    ...(canEdit ? [{ id: "edit", label: "Edit / Retire", icon: Pencil }] : []),
  ] as const;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 border-b" style={{ borderColor: c.borderSoft }}>
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id as typeof tab)} className="px-3 py-1.5 text-[12.5px] inline-flex items-center gap-1.5" style={{ color: active ? c.cobalt : c.inkMute, fontWeight: 700, borderBottom: `2px solid ${active ? c.cobalt : "transparent"}` }}>
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>
      {tab === "inspections" && <SystemInspections systemId={system.id} canEdit={canEdit} />}
      {tab === "documents"   && <SystemDocuments systemId={system.id} canEdit={canEdit} />}
      {tab === "repairs"     && <SystemRepairs systemId={system.id} canEdit={canEdit} />}
      {tab === "edit" && canEdit && <SystemEdit system={system} />}
    </div>
  );
}

function SystemEdit({ system }: { system: BuildingSystem }) {
  const queryClient = useQueryClient();
  const updateMutation = useUpdateBuildingSystem();
  const [form, setForm] = useState<UpdateBuildingSystemBody>({
    label: system.label,
    installedOn: system.installedOn,
    warrantyExpiresOn: system.warrantyExpiresOn,
    manufacturer: system.manufacturer,
    model: system.model,
    serialNo: system.serialNo,
    retiredOn: system.retiredOn,
    notes: system.notes,
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await updateMutation.mutateAsync({ id: system.id, data: form });
    await queryClient.invalidateQueries({ queryKey: getListBuildingSystemsQueryKey({ building: system.building }) });
    await queryClient.invalidateQueries({ queryKey: getGetBuildingSystemQueryKey(system.id) });
  }

  async function retire() {
    const today = new Date().toISOString().slice(0, 10);
    await updateMutation.mutateAsync({ id: system.id, data: { retiredOn: today } });
    await queryClient.invalidateQueries({ queryKey: getListBuildingSystemsQueryKey({ building: system.building }) });
  }

  return (
    <form onSubmit={save} className="grid grid-cols-3 gap-3">
      <TextField label="Label" value={form.label ?? ""} onChange={(v) => setForm({ ...form, label: v })} />
      <TextField label="Installed" type="date" value={form.installedOn ?? ""} onChange={(v) => setForm({ ...form, installedOn: v })} />
      <TextField label="Warranty exp" type="date" value={form.warrantyExpiresOn ?? ""} onChange={(v) => setForm({ ...form, warrantyExpiresOn: v })} />
      <TextField label="Manufacturer" value={form.manufacturer ?? ""} onChange={(v) => setForm({ ...form, manufacturer: v })} />
      <TextField label="Model" value={form.model ?? ""} onChange={(v) => setForm({ ...form, model: v })} />
      <TextField label="Serial #" value={form.serialNo ?? ""} onChange={(v) => setForm({ ...form, serialNo: v })} />
      <div className="col-span-3 flex items-center justify-between gap-2">
        <button type="button" onClick={retire} disabled={updateMutation.isPending || !!system.retiredOn} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] hover:bg-rose-50 disabled:opacity-50" style={{ borderColor: c.rose, color: c.rose, fontWeight: 600 }}>
          <Archive className="h-3.5 w-3.5" /> {system.retiredOn ? `Retired ${system.retiredOn}` : "Retire system"}
        </button>
        <button type="submit" disabled={updateMutation.isPending} className="rounded-md px-4 py-1.5 text-[13px] disabled:opacity-60" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
          {updateMutation.isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function SystemInspections({ systemId, canEdit }: { systemId: number; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { data: inspections = [] } = useListBuildingSystemInspections(systemId, {
    query: { queryKey: getListBuildingSystemInspectionsQueryKey(systemId) },
  });
  const { data: allDocs = [] } = useListDocuments();
  const docNameById = new Map(allDocs.map((d) => [d.id, d.name] as const));
  const createInsp = useCreateBuildingSystemInspection();
  const [date, setDate] = useState("");
  const [inspector, setInspector] = useState("");
  const [summary, setSummary] = useState("");

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!date) return;
    await createInsp.mutateAsync({
      id: systemId,
      data: { inspectedOn: date, inspector: inspector || null, summary: summary || null },
    });
    await queryClient.invalidateQueries({ queryKey: getListBuildingSystemInspectionsQueryKey(systemId) });
    await queryClient.invalidateQueries({ queryKey: getListBuildingSystemsQueryKey({}) });
    setDate(""); setInspector(""); setSummary("");
  }

  return (
    <div className="space-y-3">
      {inspections.length === 0 ? (
        <div className="text-[12.5px]" style={{ color: c.inkMute }}>No inspections recorded.</div>
      ) : (
        <ul className="space-y-1.5">
          {inspections.map((i) => (
            <li key={i.id} className="text-[12.5px] flex gap-3 items-center" style={{ color: c.inkSoft }}>
              <span className="font-mono-num" style={{ color: c.ink, fontWeight: 600 }}>{i.inspectedOn}</span>
              <span>{i.inspector ?? "—"}</span>
              {i.summary && <span style={{ color: c.inkMute }}>· {i.summary}</span>}
              {i.documentId && (
                <button
                  type="button"
                  onClick={() => openDocument(i.documentId!, docNameById.get(i.documentId!))}
                  className="ml-auto inline-flex items-center gap-1 text-[12px]"
                  style={{ color: c.cobalt, fontWeight: 600 }}
                >
                  <FileText className="h-3.5 w-3.5" />
                  {docNameById.get(i.documentId) ?? "Report"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={handleAdd} className="grid grid-cols-4 gap-2 pt-2 border-t" style={{ borderColor: c.borderSoft }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="rounded border px-2 py-1 text-[12.5px]" style={{ borderColor: c.border }} />
          <input placeholder="Inspector" value={inspector} onChange={(e) => setInspector(e.target.value)} className="rounded border px-2 py-1 text-[12.5px]" style={{ borderColor: c.border }} />
          <input placeholder="Summary" value={summary} onChange={(e) => setSummary(e.target.value)} className="rounded border px-2 py-1 text-[12.5px]" style={{ borderColor: c.border }} />
          <button type="submit" disabled={createInsp.isPending} className="rounded text-[12.5px] disabled:opacity-60" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
            <Wrench className="h-3.5 w-3.5 inline mr-1" /> Log inspection
          </button>
        </form>
      )}
    </div>
  );
}

function SystemDocuments({ systemId, canEdit }: { systemId: number; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { data: links = [] } = useListBuildingSystemDocuments(systemId, {
    query: { queryKey: getListBuildingSystemDocumentsQueryKey(systemId) },
  });
  const { data: allDocs = [] } = useListDocuments();
  const linkMutation = useLinkBuildingSystemDocument();
  const createDocument = useCreateDocument();
  const requestUploadUrl = useRequestUploadUrl();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<"existing" | "upload">("existing");
  const [docId, setDocId] = useState("");
  const [kind, setKind] = useState("install");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function refreshAll() {
    await queryClient.invalidateQueries({ queryKey: getListBuildingSystemDocumentsQueryKey(systemId) });
    await queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
  }

  async function attachExisting(e: React.FormEvent) {
    e.preventDefault();
    if (!docId) return;
    await linkMutation.mutateAsync({ id: systemId, data: { documentId: docId, kind } });
    await refreshAll();
    setDocId("");
  }

  async function uploadAndAttach(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const urlRes = await requestUploadUrl.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: file.type || "application/pdf",
        },
      });
      const putRes = await fetch(urlRes.uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/pdf" },
      });
      if (!putRes.ok) {
        throw new Error(`Upload failed (${putRes.status})`);
      }
      const sizeStr =
        file.size > 1_000_000
          ? `${(file.size / 1_000_000).toFixed(1)} MB`
          : `${Math.max(1, Math.round(file.size / 1_000))} KB`;
      const created = await createDocument.mutateAsync({
        data: {
          name: file.name,
          category: "Inspection",
          uploadedBy: "manager",
          size: sizeStr,
          storageKey: urlRes.objectPath,
        },
      });
      await linkMutation.mutateAsync({ id: systemId, data: { documentId: created.id, kind } });
      await refreshAll();
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const linkedDocIds = new Set((links as Array<{ documentId: string }>).map((l) => l.documentId));
  const availableDocs = allDocs.filter((d) => !linkedDocIds.has(d.id));

  return (
    <div className="space-y-3">
      {links.length === 0 ? (
        <div className="text-[12.5px]" style={{ color: c.inkMute }}>No documents linked.</div>
      ) : (
        <ul className="space-y-1.5">
          {links.map((l) => (
            <li key={l.linkId} className="text-[12.5px] flex gap-3 items-center" style={{ color: c.inkSoft }}>
              <span className="rounded-full px-1.5 py-0.5 text-[10.5px] uppercase" style={{ background: c.cobalt + "1F", color: c.cobalt, fontWeight: 700 }}>{l.kind}</span>
              <span style={{ color: c.ink, fontWeight: 600 }}>{l.name ?? l.documentId}</span>
              {l.uploaded && <span className="font-mono-num" style={{ color: c.inkMute }}>{l.uploaded.slice(0, 10)}</span>}
              <button
                type="button"
                onClick={() => openDocument(l.documentId, l.name ?? undefined)}
                className="ml-auto inline-flex items-center gap-1 text-[12px]"
                style={{ color: c.cobalt, fontWeight: 600 }}
              >
                <FileText className="h-3.5 w-3.5" /> Download
              </button>
              <Link href="/documents" className="text-[12px]" style={{ color: c.inkMute }}>Open in Docs</Link>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="pt-2 border-t space-y-2" style={{ borderColor: c.borderSoft }}>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMode("existing")}
              className="px-2.5 py-1 text-[11.5px] rounded"
              style={{
                background: mode === "existing" ? c.cobalt + "1F" : "transparent",
                color: mode === "existing" ? c.cobalt : c.inkMute,
                fontWeight: 700,
              }}
            >
              <Link2 className="h-3 w-3 inline mr-1" /> Attach existing
            </button>
            <button
              type="button"
              onClick={() => setMode("upload")}
              className="px-2.5 py-1 text-[11.5px] rounded"
              style={{
                background: mode === "upload" ? c.cobalt + "1F" : "transparent",
                color: mode === "upload" ? c.cobalt : c.inkMute,
                fontWeight: 700,
              }}
            >
              <Upload className="h-3 w-3 inline mr-1" /> Upload new
            </button>
          </div>
          {mode === "existing" ? (
            <form onSubmit={attachExisting} className="grid grid-cols-4 gap-2">
              <select value={docId} onChange={(e) => setDocId(e.target.value)} className="rounded border px-2 py-1 text-[12.5px] col-span-2" style={{ borderColor: c.border }}>
                <option value="">— Select document —</option>
                {availableDocs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded border px-2 py-1 text-[12.5px]" style={{ borderColor: c.border }}>
                {DOC_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <button type="submit" disabled={linkMutation.isPending || !docId} className="rounded text-[12.5px] disabled:opacity-60" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
                <Link2 className="h-3.5 w-3.5 inline mr-1" /> Attach
              </button>
            </form>
          ) : (
            <form onSubmit={uploadAndAttach} className="grid grid-cols-4 gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="rounded border px-2 py-1 text-[12.5px] col-span-2"
                style={{ borderColor: c.border }}
              />
              <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded border px-2 py-1 text-[12.5px]" style={{ borderColor: c.border }}>
                {DOC_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <button type="submit" disabled={uploading || !file} className="rounded text-[12.5px] disabled:opacity-60" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
                <Upload className="h-3.5 w-3.5 inline mr-1" /> {uploading ? "Uploading…" : "Upload & attach"}
              </button>
              {uploadError && (
                <div className="col-span-4 text-[12px]" style={{ color: c.rose }}>{uploadError}</div>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function SystemRepairs({ systemId, canEdit }: { systemId: number; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { data: repairs = [] } = useListBuildingSystemRepairs(systemId, {
    query: { queryKey: getListBuildingSystemRepairsQueryKey(systemId) },
  });
  const linkMutation = useLinkBuildingSystemRepair();
  const [woId, setWoId] = useState("");

  async function attach(e: React.FormEvent) {
    e.preventDefault();
    if (!woId) return;
    await linkMutation.mutateAsync({ id: systemId, data: { workOrderId: woId } });
    await queryClient.invalidateQueries({ queryKey: getListBuildingSystemRepairsQueryKey(systemId) });
    setWoId("");
  }

  return (
    <div className="space-y-3">
      {repairs.length === 0 ? (
        <div className="text-[12.5px]" style={{ color: c.inkMute }}>No repairs linked.</div>
      ) : (
        <ul className="space-y-1.5">
          {repairs.map((r) => (
            <li key={r.linkId} className="text-[12.5px] flex gap-3" style={{ color: c.inkSoft }}>
              <Link href={`/work-orders/${r.workOrderId}`} className="font-mono-num" style={{ color: c.cobalt, fontWeight: 700 }}>{r.workOrderId}</Link>
              <span style={{ color: c.ink, fontWeight: 600 }}>{r.title ?? "—"}</span>
              {r.opened && <span className="font-mono-num" style={{ color: c.inkMute }}>{r.opened}</span>}
              {r.actualCost != null && <span className="font-mono-num ml-auto" style={{ color: c.inkSoft }}>${(r.actualCost / 100).toFixed(2)}</span>}
              {r.historical && <span className="rounded-full px-1.5 py-0.5 text-[10.5px]" style={{ background: c.canvas, color: c.inkMute, fontWeight: 700 }}>HISTORICAL</span>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={attach} className="grid grid-cols-3 gap-2 pt-2 border-t" style={{ borderColor: c.borderSoft }}>
          <input value={woId} onChange={(e) => setWoId(e.target.value)} placeholder="Work order id (e.g. WO-1042)" className="rounded border px-2 py-1 text-[12.5px] col-span-2" style={{ borderColor: c.border }} />
          <button type="submit" disabled={linkMutation.isPending || !woId} className="rounded text-[12.5px] disabled:opacity-60" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
            <Link2 className="h-3.5 w-3.5 inline mr-1" /> Link work order
          </button>
        </form>
      )}
    </div>
  );
}

function TextField({ label, value, onChange, type = "text", required }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <label className="block">
      <div className="text-[11.5px] mb-1 font-semibold uppercase tracking-wider" style={{ color: c.inkMute }}>{label}</div>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} className="w-full rounded border px-2 py-1.5 text-[12.5px]" style={{ borderColor: c.border, background: c.panel }} />
    </label>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: readonly string[] }) {
  return (
    <label className="block">
      <div className="text-[11.5px] mb-1 font-semibold uppercase tracking-wider" style={{ color: c.inkMute }}>{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded border px-2 py-1.5 text-[12.5px]" style={{ borderColor: c.border, background: c.panel }}>
        {options.map((o) => <option key={o} value={o}>{o.replace("_", " ")}</option>)}
      </select>
    </label>
  );
}
