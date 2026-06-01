import { useState, useMemo, useRef, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import type { Document } from "@/lib/data";
import { Search, FileText, Upload, Download, Folder, FolderOpen, ChevronRight, ChevronDown, Info, Trash2, Cloud, HardDrive, X, CheckCircle, Archive, Calendar, Square, CheckSquare, FolderInput, ExternalLink, Clock, Undo2 } from "lucide-react";
import {
  useListDocuments,
  useListBuildings,
  useListUnits,
  useCreateDocument,
  useDeleteDocument,
  useUpdateDocument,
  useDownloadDocument,
  useRequestUploadUrl,
  useListDocumentImportBatches,
  useUndoDocumentImportBatch,
  getListDocumentImportBatchesQueryKey,
  getListDocumentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { BulkImportDialog } from "@/components/BulkImportDialog";

const categoryColors: Record<Document["category"], { bg: string; fg: string }> = {
  Bylaws:     { bg: "#E5E8FF", fg: "#3245FF" },
  Insurance:  { bg: "#DCF3EC", fg: "#0E8A6B" },
  Inspection: { bg: "#FBEFD6", fg: "#A66C0E" },
  Financial:  { bg: "#EFF1F8", fg: "#2A3050" },
  Vendor:     { bg: "#FBE3E9", fg: "#B8264C" },
  Meeting:    { bg: "#E5E8FF", fg: "#3245FF" },
};

type FolderSelection =
  | { type: "all" }
  | { type: "building"; building: number }
  | { type: "building-shared"; building: number }
  | { type: "building-cat"; building: number; subKey: string }
  | { type: "unit"; building: number; unit: string }
  | { type: "unit-cat"; building: number; unit: string; subKey: string };

const SUB_FOLDERS: Array<{ key: string; label: string; category: Document["category"] | null }> = [
  { key: "WorkOrders",     label: "Work Orders",    category: null },
  { key: "Insurance",      label: "Insurance",      category: "Insurance" },
  { key: "Inspection",     label: "Roof Documents", category: "Inspection" },
  { key: "Correspondence", label: "Correspondence", category: "Meeting" },
  { key: "Financial",      label: "Financial",      category: "Financial" },
  { key: "Vendor",         label: "Vendor Docs",    category: "Vendor" },
  { key: "Bylaws",         label: "Bylaws",         category: "Bylaws" },
];

function matchesSelection(d: Document, sel: FolderSelection): boolean {
  if (sel.type === "all") return true;
  if (sel.type === "building") return d.building === sel.building;
  if (sel.type === "building-shared") {
    return d.building === sel.building && (d.unit == null || d.unit === "");
  }
  if (sel.type === "building-cat") {
    if (d.building !== sel.building) return false;
    if (d.unit != null && d.unit !== "") return false;
    const sub = SUB_FOLDERS.find((f) => f.key === sel.subKey);
    if (!sub || sub.category === null) return false;
    return d.category === sub.category;
  }
  if (sel.type === "unit") {
    return d.building === sel.building && d.unit === sel.unit;
  }
  if (sel.type === "unit-cat") {
    if (d.building !== sel.building) return false;
    if (d.unit !== sel.unit) return false;
    const sub = SUB_FOLDERS.find((f) => f.key === sel.subKey);
    if (!sub || sub.category === null) return false;
    return d.category === sub.category;
  }
  return true;
}

function selectionLabel(
  sel: FolderSelection,
  buildings: Array<{ num: number; address: string }>,
  unitsById: Map<string, { unit: string; address: string }>
): string {
  if (sel.type === "all") return "01 Master Index";
  const b = buildings.find((x) => x.num === sel.building);
  const prefix = `Building ${String(sel.building).padStart(2, "0")} — ${b?.address ?? ""}`;
  if (sel.type === "building") return prefix;
  if (sel.type === "building-shared") return `${prefix} / Building (shared)`;
  if (sel.type === "building-cat") {
    const sub = SUB_FOLDERS.find((f) => f.key === sel.subKey);
    return `${prefix} / Building (shared) / ${sub?.label ?? ""}`;
  }
  const u = unitsById.get(sel.unit);
  const unitPrefix = `${prefix} / Unit ${u?.unit ?? sel.unit}${u?.address ? ` ${u.address}` : ""}`;
  if (sel.type === "unit") return unitPrefix;
  const sub = SUB_FOLDERS.find((f) => f.key === sel.subKey);
  return `${unitPrefix} / ${sub?.label ?? ""}`;
}

const CATEGORIES: Document["category"][] = ["Bylaws", "Insurance", "Inspection", "Financial", "Vendor", "Meeting"];

const FOLDERS_WIDTH_KEY = "documents.foldersWidth";
const FOLDERS_WIDTH_MIN = 180;
const FOLDERS_WIDTH_MAX = 480;
const FOLDERS_WIDTH_DEFAULT = 224;
const FOLDERS_WIDTH_STEP = 8;

function clampFoldersWidth(n: number): number {
  if (!Number.isFinite(n)) return FOLDERS_WIDTH_DEFAULT;
  return Math.min(FOLDERS_WIDTH_MAX, Math.max(FOLDERS_WIDTH_MIN, Math.round(n)));
}

function readSavedFoldersWidth(): number {
  if (typeof window === "undefined") return FOLDERS_WIDTH_DEFAULT;
  try {
    const raw = window.localStorage.getItem(FOLDERS_WIDTH_KEY);
    if (raw == null) return FOLDERS_WIDTH_DEFAULT;
    return clampFoldersWidth(parseInt(raw, 10));
  } catch {
    return FOLDERS_WIDTH_DEFAULT;
  }
}

export default function Documents() {
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sel, setSel] = useState<FolderSelection>({ type: "all" });
  const [expandedBuildings, setExpandedBuildings] = useState<Set<number>>(new Set([1]));
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());
  const [expandedShared, setExpandedShared] = useState<Set<number>>(new Set());
  const [treeExpanded, setTreeExpanded] = useState(true);
  const [unitsByBuildingExpanded, setUnitsByBuildingExpanded] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const { data: batches = [] } = useListDocumentImportBatches();
  const undoBatch = useUndoDocumentImportBatch();
  const recentUndoableBatch = (batches as any[]).find((b) => b.canUndo);
  async function handleUndoBatch(id: string) {
    try {
      await undoBatch.mutateAsync({ id });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListDocumentImportBatchesQueryKey() }),
      ]);
      showToast("Import batch undone", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Undo failed", "error");
    }
  }
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState<Document["category"]>("Inspection");
  const [uploadBy, setUploadBy] = useState("M. Hayes");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [moveTargets, setMoveTargets] = useState<string[] | null>(null);
  const [moveBuilding, setMoveBuilding] = useState<number | "">("");
  const [moveUnit, setMoveUnit] = useState<string>("");
  const [moving, setMoving] = useState(false);
  const [foldersWidth, setFoldersWidth] = useState<number>(() => readSavedFoldersWidth());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const asideRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(FOLDERS_WIDTH_KEY, String(foldersWidth));
    } catch {
      // ignore quota / privacy-mode errors
    }
  }, [foldersWidth]);

  function startFoldersResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const aside = asideRef.current;
    if (!aside) return;
    const left = aside.getBoundingClientRect().left;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);

    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      setFoldersWidth(clampFoldersWidth(ev.clientX - left));
    };
    const onUp = (ev: PointerEvent) => {
      try { handle.releasePointerCapture(ev.pointerId); } catch {}
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  function onFoldersResizeKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setFoldersWidth((w) => clampFoldersWidth(w - FOLDERS_WIDTH_STEP));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setFoldersWidth((w) => clampFoldersWidth(w + FOLDERS_WIDTH_STEP));
    } else if (e.key === "Home") {
      e.preventDefault();
      setFoldersWidth(FOLDERS_WIDTH_MIN);
    } else if (e.key === "End") {
      e.preventDefault();
      setFoldersWidth(FOLDERS_WIDTH_MAX);
    }
  }

  const queryClient = useQueryClient();

  const { data: documents = [], isLoading, queryKey: docsQueryKey } = useListDocuments() as any;
  const { data: buildings = [] } = useListBuildings();
  const { data: units = [] } = useListUnits();

  const unitsByBuilding = useMemo(() => {
    const map = new Map<number, Array<{ id: string; unit: string; address: string }>>();
    for (const u of units) {
      const arr = map.get(u.building) ?? [];
      arr.push({ id: u.id, unit: u.unit, address: u.address });
      map.set(u.building, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.unit.localeCompare(b.unit));
    }
    return map;
  }, [units]);

  const unitsById = useMemo(() => {
    const map = new Map<string, { unit: string; address: string }>();
    for (const u of units) map.set(u.id, { unit: u.unit, address: u.address });
    return map;
  }, [units]);
  const createDocument = useCreateDocument();
  const deleteDocument = useDeleteDocument();
  const updateDocument = useUpdateDocument();
  const requestUploadUrl = useRequestUploadUrl();

  function showToast(msg: string, type: "success" | "error") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  function toggleBuilding(num: number) {
    setExpandedBuildings((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });
  }

  function toggleUnit(id: string) {
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleShared(num: number) {
    setExpandedShared((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });
  }

  const filtered = useMemo(() => {
    return documents.filter((d: any) => {
      if (!matchesSelection(d as Document, sel)) return false;
      if (q) {
        const s = q.toLowerCase();
        const bldgStr = d.building != null ? `building ${String(d.building).padStart(2, "0")} ${d.building}` : "";
        const matchesSearch =
          d.name.toLowerCase().includes(s) ||
          d.uploadedBy.toLowerCase().includes(s) ||
          d.category.toLowerCase().includes(s) ||
          bldgStr.includes(s);
        if (!matchesSearch) return false;
      }
      if (dateFrom && d.uploaded < dateFrom) return false;
      if (dateTo && d.uploaded > dateTo) return false;
      return true;
    });
  }, [q, sel, documents, dateFrom, dateTo]);

  const selectableIds = useMemo(
    () => filtered.filter((d: any) => !!d.storageKey).map((d: any) => d.id as string),
    [filtered]
  );

  const allSelected = selectableIds.length > 0 && selectableIds.every((id: string) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableIds));
    }
  }

  function toggleSelectDoc(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function isNodeActive(node: FolderSelection): boolean {
    return JSON.stringify(node) === JSON.stringify(sel);
  }

  const currentBuilding =
    sel.type === "building" || sel.type === "building-shared" || sel.type === "building-cat"
      ? sel.building
      : sel.type === "unit" || sel.type === "unit-cat"
      ? sel.building
      : null;
  const currentUnit =
    sel.type === "unit" || sel.type === "unit-cat" ? sel.unit : null;

  async function handleUpload() {
    if (!uploadFile) return;
    setUploading(true);
    setUploadError(null);
    try {
      const urlRes = await requestUploadUrl.mutateAsync({
        data: {
          name: uploadFile.name,
          size: uploadFile.size,
          contentType: uploadFile.type || "application/pdf",
        },
      });

      await fetch(urlRes.uploadURL, {
        method: "PUT",
        body: uploadFile,
        headers: { "Content-Type": uploadFile.type || "application/pdf" },
      });

      const sizeStr = uploadFile.size > 1_000_000
        ? `${(uploadFile.size / 1_000_000).toFixed(1)} MB`
        : `${Math.round(uploadFile.size / 1_000)} KB`;

      await createDocument.mutateAsync({
        data: {
          name: uploadFile.name,
          category: uploadCategory,
          building: currentBuilding ?? undefined,
          unit: currentUnit ?? undefined,
          uploadedBy: uploadBy,
          size: sizeStr,
          storageKey: urlRes.objectPath,
        },
      });

      await queryClient.invalidateQueries({ queryKey: docsQueryKey });
      setUploadSuccess(true);
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setTimeout(() => {
        setUploadOpen(false);
        setUploadSuccess(false);
      }, 1500);
      showToast("File uploaded successfully", "success");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc: any) {
    try {
      const res = await fetch(`/api/documents/${doc.id}/download`);
      if (!res.ok) throw new Error("Failed to get download URL");
      const contentType = res.headers.get("Content-Type") ?? "";
      if (contentType.includes("application/pdf")) {
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = Object.assign(document.createElement("a"), { href: blobUrl, download: doc.name });
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
      } else {
        const { url } = await res.json();
        const fullUrl = url.startsWith("http") ? url : `${window.location.origin}${url}`;
        const link = Object.assign(document.createElement("a"), { href: fullUrl, download: doc.name });
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch {
      showToast("Download failed", "error");
    }
  }

  async function handleDelete(docId: string) {
    if (!confirm("Delete this document? This cannot be undone.")) return;
    setDeletingId(docId);
    try {
      await deleteDocument.mutateAsync({ id: docId });
      await queryClient.invalidateQueries({ queryKey: docsQueryKey });
      showToast("Document deleted", "success");
    } catch {
      showToast("Delete failed", "error");
    } finally {
      setDeletingId(null);
    }
  }

  function openMove(ids: string[]) {
    setMoveTargets(ids);
    if (ids.length === 1) {
      const d = documents.find((x: any) => x.id === ids[0]);
      setMoveBuilding(d?.building ?? "");
      setMoveUnit(d?.unit ?? "");
    } else {
      setMoveBuilding("");
      setMoveUnit("");
    }
  }

  async function handleMoveSubmit() {
    if (!moveTargets || moveTargets.length === 0) return;
    if (moveBuilding === "") {
      showToast("Please select a building", "error");
      return;
    }
    setMoving(true);
    try {
      const data = {
        building: moveBuilding as number,
        unit: moveUnit ? moveUnit : null,
      };
      await Promise.all(
        moveTargets.map((id) => updateDocument.mutateAsync({ id, data }))
      );
      await queryClient.invalidateQueries({ queryKey: docsQueryKey });
      const n = moveTargets.length;
      showToast(`Moved ${n} document${n !== 1 ? "s" : ""}`, "success");
      setMoveTargets(null);
      if (n > 1) setSelectedIds(new Set());
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Move failed", "error");
    } finally {
      setMoving(false);
    }
  }

  async function handleExportSelected() {
    if (selectedIds.size === 0) return;
    setExporting(true);
    try {
      const res = await fetch("/api/documents/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        throw new Error(err.error ?? "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().slice(0, 10);
      const link = Object.assign(document.createElement("a"), {
        href: url,
        download: `documents-export-${date}.zip`,
      });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(`Exported ${selectedIds.size} document${selectedIds.size !== 1 ? "s" : ""} as ZIP`, "success");
      setSelectedIds(new Set());
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Export failed", "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Layout
      title="Documents"
      subtitle={`${documents.length} files in archive`}
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => setBulkOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-[13px] hover:bg-slate-50"
            style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 600 }}
          >
            <Archive className="h-4 w-4" /> Bulk import
          </button>
          <button
            onClick={() => { setUploadOpen(true); setUploadError(null); setUploadSuccess(false); }}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] hover:opacity-90"
            style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
          >
            <Upload className="h-4 w-4" /> Upload
          </button>
        </div>
      }
    >
      {bulkOpen && (
        <BulkImportDialog buildings={buildings as any} onClose={() => setBulkOpen(false)} />
      )}

      {recentUndoableBatch && (
        <div className="mb-3 flex items-center justify-between rounded-lg border px-4 py-2.5 text-[13px]"
          style={{ background: c.canvas, borderColor: c.border }}>
          <div className="flex items-center gap-2" style={{ color: c.inkSoft }}>
            <Clock className="h-4 w-4" style={{ color: c.cobalt }} />
            <span>
              Imported <strong style={{ fontWeight: 700 }}>{recentUndoableBatch.fileCount} file{recentUndoableBatch.fileCount === 1 ? "" : "s"}</strong>
              {recentUndoableBatch.label ? ` — ${recentUndoableBatch.label}` : ""}
              {" · "}
              <span className="font-mono-num" style={{ color: c.inkMute }}>{recentUndoableBatch.id}</span>
              {" · undo available within 24h"}
            </span>
          </div>
          <button
            onClick={() => handleUndoBatch(recentUndoableBatch.id)}
            disabled={undoBatch.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] hover:bg-slate-50 disabled:opacity-60"
            style={{ borderColor: c.border, color: c.rose, fontWeight: 600 }}
          >
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </button>
        </div>
      )}

      {toast && (
        <div
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-[13px] shadow-lg"
          style={{ background: toast.type === "success" ? "#DCF3EC" : "#FBE3E9", color: toast.type === "success" ? "#0E8A6B" : "#B8264C", fontWeight: 600 }}
        >
          {toast.type === "success" ? <CheckCircle className="h-4 w-4" /> : <X className="h-4 w-4" />}
          {toast.msg}
        </div>
      )}

      {moveTargets && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-xl" style={{ borderColor: c.border }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px]" style={{ fontWeight: 700 }}>
                Move {moveTargets.length === 1 ? "document" : `${moveTargets.length} documents`}
              </h3>
              <button onClick={() => setMoveTargets(null)} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] mb-1.5 uppercase tracking-wider" style={{ color: c.inkSoft, fontWeight: 700 }}>Building</label>
                <select
                  value={moveBuilding}
                  onChange={(e) => {
                    const v = e.target.value;
                    setMoveBuilding(v === "" ? "" : Number(v));
                    setMoveUnit("");
                  }}
                  className="w-full rounded-md border px-3 py-2 text-[13px] bg-white"
                  style={{ borderColor: c.border, color: c.ink }}
                >
                  <option value="">Select a building…</option>
                  {buildings.map((b: any) => (
                    <option key={b.num} value={b.num}>
                      Bldg {String(b.num).padStart(2, "0")} — {b.address}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[12px] mb-1.5 uppercase tracking-wider" style={{ color: c.inkSoft, fontWeight: 700 }}>Unit</label>
                <select
                  value={moveUnit}
                  onChange={(e) => setMoveUnit(e.target.value)}
                  disabled={moveBuilding === ""}
                  className="w-full rounded-md border px-3 py-2 text-[13px] bg-white disabled:opacity-50"
                  style={{ borderColor: c.border, color: c.ink }}
                >
                  <option value="">Building (shared)</option>
                  {moveBuilding !== "" &&
                    (unitsByBuilding.get(moveBuilding as number) ?? []).map((u) => (
                      <option key={u.id} value={u.id}>
                        Unit {u.unit} — {u.address}
                      </option>
                    ))}
                </select>
                <div className="text-[11.5px] mt-1" style={{ color: c.inkMute }}>
                  Leave blank to file under "Building (shared)".
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setMoveTargets(null)} className="rounded-md border px-3 py-1.5 text-[13px] hover:bg-slate-50" style={{ borderColor: c.border, color: c.inkSoft }}>Cancel</button>
                <button
                  onClick={handleMoveSubmit}
                  disabled={moving || moveBuilding === ""}
                  className="inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-[13px] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                >
                  {moving ? "Moving…" : <><FolderInput className="h-4 w-4" /> Move</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {uploadOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-xl" style={{ borderColor: c.border }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px]" style={{ fontWeight: 700 }}>Upload Document</h3>
              <button onClick={() => setUploadOpen(false)} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            {uploadSuccess ? (
              <div className="py-8 text-center">
                <CheckCircle className="h-10 w-10 mx-auto mb-2" style={{ color: "#0E8A6B" }} />
                <div className="text-[14px]" style={{ fontWeight: 600, color: "#0E8A6B" }}>Upload complete!</div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-[12px] mb-1.5 uppercase tracking-wider" style={{ color: c.inkSoft, fontWeight: 700 }}>File</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                    onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-[13px] rounded-md border px-3 py-2 cursor-pointer"
                    style={{ borderColor: c.border, color: c.ink }}
                  />
                </div>
                <div>
                  <label className="block text-[12px] mb-1.5 uppercase tracking-wider" style={{ color: c.inkSoft, fontWeight: 700 }}>Category</label>
                  <select
                    value={uploadCategory}
                    onChange={(e) => setUploadCategory(e.target.value as Document["category"])}
                    className="w-full rounded-md border px-3 py-2 text-[13px] bg-white"
                    style={{ borderColor: c.border, color: c.ink }}
                  >
                    {CATEGORIES.map((cat) => <option key={cat}>{cat}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] mb-1.5 uppercase tracking-wider" style={{ color: c.inkSoft, fontWeight: 700 }}>Uploaded By</label>
                  <input
                    value={uploadBy}
                    onChange={(e) => setUploadBy(e.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-[13px]"
                    style={{ borderColor: c.border, color: c.ink }}
                  />
                </div>
                {currentBuilding && (
                  <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: c.cobaltSoft, color: c.cobalt }}>
                    <span style={{ fontWeight: 600 }}>Building {currentBuilding}</span>
                    {currentUnit && (
                      <>
                        {" · "}
                        <span style={{ fontWeight: 600 }}>
                          Unit {unitsById.get(currentUnit)?.unit ?? currentUnit}
                        </span>
                      </>
                    )}
                    {" — "}file will be associated with this {currentUnit ? "unit" : "building"}
                  </div>
                )}
                {uploadError && (
                  <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "#FBE3E9", color: "#B8264C", fontWeight: 500 }}>{uploadError}</div>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setUploadOpen(false)} className="rounded-md border px-3 py-1.5 text-[13px] hover:bg-slate-50" style={{ borderColor: c.border, color: c.inkSoft }}>Cancel</button>
                  <button
                    onClick={handleUpload}
                    disabled={!uploadFile || uploading}
                    className="inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-[13px] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                  >
                    {uploading ? "Uploading…" : <><Upload className="h-4 w-4" /> Upload</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-4 min-h-0">
        <aside
          ref={asideRef}
          className="shrink-0 rounded-xl border bg-white overflow-y-auto relative"
          style={{
            width: foldersWidth,
            borderColor: c.border,
            maxHeight: "calc(100vh - 180px)",
          }}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize folders panel"
            aria-valuenow={foldersWidth}
            aria-valuemin={FOLDERS_WIDTH_MIN}
            aria-valuemax={FOLDERS_WIDTH_MAX}
            tabIndex={0}
            onPointerDown={startFoldersResize}
            onDoubleClick={() => setFoldersWidth(FOLDERS_WIDTH_DEFAULT)}
            onKeyDown={onFoldersResizeKey}
            className="absolute top-0 right-0 h-full z-10 group"
            style={{ width: 6, cursor: "col-resize", touchAction: "none" }}
            title="Drag to resize · double-click to reset"
          >
            <div
              className="absolute top-0 bottom-0 transition-colors group-hover:opacity-100 group-focus:opacity-100 opacity-0"
              style={{ right: 2, width: 2, background: c.cobalt }}
            />
          </div>
          <div
            className="flex items-center justify-between px-3 py-2.5 border-b cursor-pointer select-none"
            style={{ borderColor: c.border }}
            onClick={() => setTreeExpanded((v) => !v)}
          >
            <span className="text-[11.5px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>
              Folders
            </span>
            {treeExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" style={{ color: c.inkMute }} />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" style={{ color: c.inkMute }} />
            )}
          </div>

          {treeExpanded && (
            <div className="py-1">
              <TreeNode
                icon={isNodeActive({ type: "all" }) ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
                label="01 Master Index"
                active={isNodeActive({ type: "all" })}
                count={documents.length}
                onClick={() => setSel({ type: "all" })}
              />

              <div className="mt-0.5">
                <div
                  className="flex items-center gap-1 px-2 py-1 mx-1 rounded cursor-pointer select-none hover:bg-slate-50"
                  onClick={() => setUnitsByBuildingExpanded((v) => !v)}
                >
                  <button
                    className="flex-shrink-0 p-0.5 rounded hover:bg-slate-100"
                    onClick={(e) => { e.stopPropagation(); setUnitsByBuildingExpanded((v) => !v); }}
                    aria-label={unitsByBuildingExpanded ? "Collapse Units by Building" : "Expand Units by Building"}
                  >
                    {unitsByBuildingExpanded ? (
                      <ChevronDown className="h-3 w-3" style={{ color: c.inkMute }} />
                    ) : (
                      <ChevronRight className="h-3 w-3" style={{ color: c.inkMute }} />
                    )}
                  </button>
                  {unitsByBuildingExpanded ? (
                    <FolderOpen className="h-4 w-4 flex-shrink-0" style={{ color: c.inkSoft }} />
                  ) : (
                    <Folder className="h-4 w-4 flex-shrink-0" style={{ color: c.inkSoft }} />
                  )}
                  <span className="text-[13px] truncate flex-1" style={{ color: c.ink, fontWeight: 600 }}>
                    02 Units by Building
                  </span>
                </div>
                <div hidden={!unitsByBuildingExpanded}>
                  {buildings.map((b: any) => {
                    const expanded = expandedBuildings.has(b.num);
                    const bNode: FolderSelection = { type: "building", building: b.num };
                    const bActive = isNodeActive(bNode);
                    const bDocs = documents.filter((d: any) => d.building === b.num);
                    return (
                      <div key={b.num}>
                        <div
                          className="flex items-center gap-1 px-2 py-1 mx-1 rounded cursor-pointer group"
                          style={bActive ? { background: c.cobaltSoft } : undefined}
                          onClick={() => {
                            setSel(bNode);
                            toggleBuilding(b.num);
                          }}
                        >
                          <button
                            className="flex-shrink-0 p-0.5 rounded hover:bg-slate-100"
                            onClick={(e) => { e.stopPropagation(); toggleBuilding(b.num); }}
                          >
                            {expanded ? (
                              <ChevronDown className="h-3 w-3" style={{ color: c.inkMute }} />
                            ) : (
                              <ChevronRight className="h-3 w-3" style={{ color: c.inkMute }} />
                            )}
                          </button>
                          {expanded ? (
                            <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" style={{ color: bActive ? c.cobalt : c.inkSoft }} />
                          ) : (
                            <Folder className="h-3.5 w-3.5 flex-shrink-0" style={{ color: bActive ? c.cobalt : c.inkSoft }} />
                          )}
                          <span
                            className="text-[12px] truncate flex-1"
                            style={{ color: bActive ? c.cobalt : c.ink, fontWeight: bActive ? 600 : 500 }}
                          >
                            Bldg {String(b.num).padStart(2, "0")} — {b.address}
                          </span>
                          {bDocs.length > 0 && (
                            <span className="text-[10px] rounded-full px-1.5 py-0.5 ml-1" style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}>
                              {bDocs.length}
                            </span>
                          )}
                        </div>

                        {expanded && (
                          <div className="ml-6">
                            {(() => {
                              const sharedNode: FolderSelection = { type: "building-shared", building: b.num };
                              const sharedExpanded = expandedShared.has(b.num) ||
                                (sel.type === "building-cat" && sel.building === b.num);
                              const sharedActive = isNodeActive(sharedNode);
                              const sharedCount = documents.filter((d: any) =>
                                d.building === b.num && (d.unit == null || d.unit === "")
                              ).length;
                              return (
                                <div>
                                  <div
                                    className="flex items-center gap-1 px-2 py-0.5 mx-1 my-0.5 rounded cursor-pointer"
                                    style={sharedActive ? { background: c.cobaltSoft } : undefined}
                                    onClick={() => {
                                      setSel(sharedNode);
                                      toggleShared(b.num);
                                    }}
                                  >
                                    <button
                                      className="flex-shrink-0 p-0.5 rounded hover:bg-slate-100"
                                      onClick={(e) => { e.stopPropagation(); toggleShared(b.num); }}
                                    >
                                      {sharedExpanded ? (
                                        <ChevronDown className="h-3 w-3" style={{ color: c.inkMute }} />
                                      ) : (
                                        <ChevronRight className="h-3 w-3" style={{ color: c.inkMute }} />
                                      )}
                                    </button>
                                    {sharedExpanded ? (
                                      <FolderOpen className="h-3 w-3 flex-shrink-0" style={{ color: sharedActive ? c.cobalt : c.inkSoft }} />
                                    ) : (
                                      <Folder className="h-3 w-3 flex-shrink-0" style={{ color: sharedActive ? c.cobalt : c.inkSoft }} />
                                    )}
                                    <span
                                      className="text-[11.5px] truncate flex-1"
                                      style={{ color: sharedActive ? c.cobalt : c.ink, fontWeight: sharedActive ? 600 : 500 }}
                                    >
                                      Building (shared)
                                    </span>
                                    {sharedCount > 0 && (
                                      <span className="text-[10px] rounded-full px-1 ml-auto" style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}>
                                        {sharedCount}
                                      </span>
                                    )}
                                  </div>
                                  {sharedExpanded && (
                                    <div className="ml-4">
                                      {SUB_FOLDERS.map((sf) => {
                                        const subNode: FolderSelection = { type: "building-cat", building: b.num, subKey: sf.key };
                                        const subActive = isNodeActive(subNode);
                                        const subCount = documents.filter((d: any) => {
                                          if (d.building !== b.num) return false;
                                          if (d.unit != null && d.unit !== "") return false;
                                          if (sf.category === null) return false;
                                          return d.category === sf.category;
                                        }).length;
                                        return (
                                          <div
                                            key={sf.key}
                                            className="flex items-center gap-1.5 px-2 py-0.5 mx-1 my-0.5 rounded cursor-pointer"
                                            style={subActive ? { background: c.cobaltSoft } : undefined}
                                            onClick={() => setSel(subNode)}
                                          >
                                            <FileText className="h-3 w-3 flex-shrink-0" style={{ color: subActive ? c.cobalt : c.inkMute }} />
                                            <span
                                              className="text-[11.5px] truncate"
                                              style={{ color: subActive ? c.cobalt : c.inkSoft, fontWeight: subActive ? 600 : 400 }}
                                            >
                                              {sf.label}
                                            </span>
                                            {subCount > 0 && (
                                              <span className="text-[10px] rounded-full px-1 ml-auto" style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}>
                                                {subCount}
                                              </span>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}

                            {(unitsByBuilding.get(b.num) ?? []).map((u) => {
                              const unitNode: FolderSelection = { type: "unit", building: b.num, unit: u.id };
                              const unitActive = isNodeActive(unitNode);
                              const unitExpanded = expandedUnits.has(u.id) ||
                                (sel.type === "unit-cat" && sel.unit === u.id);
                              const unitCount = documents.filter((d: any) =>
                                d.building === b.num && d.unit === u.id
                              ).length;
                              return (
                                <div key={u.id}>
                                  <div
                                    className="flex items-center gap-1 px-2 py-0.5 mx-1 my-0.5 rounded cursor-pointer"
                                    style={unitActive ? { background: c.cobaltSoft } : undefined}
                                    onClick={() => {
                                      setSel(unitNode);
                                      toggleUnit(u.id);
                                    }}
                                  >
                                    <button
                                      className="flex-shrink-0 p-0.5 rounded hover:bg-slate-100"
                                      onClick={(e) => { e.stopPropagation(); toggleUnit(u.id); }}
                                    >
                                      {unitExpanded ? (
                                        <ChevronDown className="h-3 w-3" style={{ color: c.inkMute }} />
                                      ) : (
                                        <ChevronRight className="h-3 w-3" style={{ color: c.inkMute }} />
                                      )}
                                    </button>
                                    {unitExpanded ? (
                                      <FolderOpen className="h-3 w-3 flex-shrink-0" style={{ color: unitActive ? c.cobalt : c.inkSoft }} />
                                    ) : (
                                      <Folder className="h-3 w-3 flex-shrink-0" style={{ color: unitActive ? c.cobalt : c.inkSoft }} />
                                    )}
                                    <span
                                      className="text-[11.5px] truncate flex-1"
                                      style={{ color: unitActive ? c.cobalt : c.ink, fontWeight: unitActive ? 600 : 500 }}
                                    >
                                      Unit {u.unit} {u.address}
                                    </span>
                                    {unitCount > 0 && (
                                      <span className="text-[10px] rounded-full px-1 ml-auto" style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}>
                                        {unitCount}
                                      </span>
                                    )}
                                  </div>
                                  {unitExpanded && (
                                    <div className="ml-6">
                                      {SUB_FOLDERS.map((sf) => {
                                        const subNode: FolderSelection = { type: "unit-cat", building: b.num, unit: u.id, subKey: sf.key };
                                        const subActive = isNodeActive(subNode);
                                        const subCount = documents.filter((d: any) => {
                                          if (d.building !== b.num) return false;
                                          if (d.unit !== u.id) return false;
                                          if (sf.category === null) return false;
                                          return d.category === sf.category;
                                        }).length;
                                        return (
                                          <div
                                            key={sf.key}
                                            className="flex items-center gap-1.5 px-2 py-0.5 mx-1 my-0.5 rounded cursor-pointer"
                                            style={subActive ? { background: c.cobaltSoft } : undefined}
                                            onClick={() => setSel(subNode)}
                                          >
                                            <FileText className="h-3 w-3 flex-shrink-0" style={{ color: subActive ? c.cobalt : c.inkMute }} />
                                            <span
                                              className="text-[11.5px] truncate"
                                              style={{ color: subActive ? c.cobalt : c.inkSoft, fontWeight: subActive ? 600 : 400 }}
                                            >
                                              {sf.label}
                                            </span>
                                            {subCount > 0 && (
                                              <span className="text-[10px] rounded-full px-1 ml-auto" style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}>
                                                {subCount}
                                              </span>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </aside>

        <div className="flex-1 min-w-0 space-y-3">
          <div
            className="flex items-start gap-2.5 rounded-lg border px-4 py-3 text-[12.5px]"
            style={{ borderColor: "#B6D0FF", background: "#EFF5FF", color: "#1A4DA0" }}
          >
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span style={{ fontWeight: 500 }}>
              <strong style={{ fontWeight: 700 }}>Auto-generate folder structures</strong> — Folder structures can be automatically generated from the HOA master unit index, eliminating manual setup.
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[12.5px] flex items-center gap-1 flex-wrap" style={{ color: c.inkSoft }}>
              <span style={{ fontWeight: 600, color: c.ink }}>{selectionLabel(sel, buildings, unitsById)}</span>
              <span className="text-[11px]" style={{ color: c.inkMute }}>· {filtered.length} file{filtered.length !== 1 ? "s" : ""}</span>
            </div>

            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: c.inkMute }} />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search name, category, uploader…"
                  className="w-56 rounded-md border pl-9 pr-3 py-2 text-[13px] outline-none focus:ring-2"
                  style={{ borderColor: c.border, background: c.panel, color: c.ink }}
                />
              </div>

              <div className="flex items-center gap-1.5 rounded-md border px-2 py-1.5" style={{ borderColor: c.border, background: c.panel }}>
                <Calendar className="h-3.5 w-3.5 flex-shrink-0" style={{ color: c.inkMute }} />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="text-[12px] bg-transparent outline-none"
                  style={{ color: dateFrom ? c.ink : c.inkMute, width: 120 }}
                  title="From date"
                />
                <span className="text-[11px]" style={{ color: c.inkMute }}>–</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="text-[12px] bg-transparent outline-none"
                  style={{ color: dateTo ? c.ink : c.inkMute, width: 120 }}
                  title="To date"
                />
                {(dateFrom || dateTo) && (
                  <button
                    onClick={() => { setDateFrom(""); setDateTo(""); }}
                    className="rounded p-0.5 hover:bg-slate-100"
                  >
                    <X className="h-3 w-3" style={{ color: c.inkMute }} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {someSelected && (
            <div
              className="flex items-center justify-between rounded-lg px-4 py-2.5"
              style={{ background: c.cobaltSoft, border: `1px solid ${c.cobalt}20` }}
            >
              <span className="text-[13px]" style={{ color: c.cobalt, fontWeight: 600 }}>
                {selectedIds.size} document{selectedIds.size !== 1 ? "s" : ""} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-[12px] rounded-md border px-2.5 py-1 hover:bg-white"
                  style={{ borderColor: `${c.cobalt}40`, color: c.cobalt }}
                >
                  Clear
                </button>
                <button
                  onClick={() => openMove(Array.from(selectedIds))}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-[13px] bg-white hover:bg-slate-50"
                  style={{ borderColor: `${c.cobalt}40`, color: c.cobalt, fontWeight: 600 }}
                >
                  <FolderInput className="h-3.5 w-3.5" />
                  Move to…
                </button>
                <button
                  onClick={handleExportSelected}
                  disabled={exporting}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[13px] hover:opacity-90 disabled:opacity-60"
                  style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                >
                  <Archive className="h-3.5 w-3.5" />
                  {exporting ? "Exporting…" : "Export as ZIP"}
                </button>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="py-16 text-center text-[13px]" style={{ color: c.inkMute }}>Loading documents…</div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border bg-white p-10 text-center" style={{ borderColor: c.border }}>
              <FileText className="h-8 w-8 mx-auto mb-3" style={{ color: c.inkMute }} />
              <div className="text-[14px]" style={{ color: c.inkSoft, fontWeight: 500 }}>No documents in this folder</div>
              <div className="text-[12.5px] mt-1" style={{ color: c.inkMute }}>Upload files or select a different folder.</div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-1">
                <button
                  onClick={toggleSelectAll}
                  className="flex items-center gap-1.5 text-[12px] hover:opacity-80"
                  style={{ color: c.inkSoft }}
                  title={allSelected ? "Deselect all" : "Select all downloadable files"}
                >
                  {allSelected ? (
                    <CheckSquare className="h-4 w-4" style={{ color: c.cobalt }} />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                  <span style={{ fontWeight: 500, color: allSelected ? c.cobalt : c.inkSoft }}>
                    {allSelected ? "Deselect all" : "Select all"}
                  </span>
                </button>
                {selectableIds.length < filtered.length && (
                  <span className="text-[11px]" style={{ color: c.inkMute }}>
                    ({selectableIds.length} of {filtered.length} have downloadable files)
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {filtered.map((d: any) => {
                  const cc = categoryColors[d.category as Document["category"]];
                  const inStorage = !!d.storageKey;
                  const inDrive = !!d.driveFileId;
                  const isChecked = selectedIds.has(d.id);
                  return (
                    <div
                      key={d.id}
                      className="rounded-xl border bg-white p-4 flex items-center gap-3 hover:shadow-sm transition-shadow"
                      style={{ borderColor: isChecked ? c.cobalt : c.border }}
                    >
                      {inStorage ? (
                        <button
                          onClick={() => toggleSelectDoc(d.id)}
                          className="flex-shrink-0 rounded hover:opacity-80"
                          title={isChecked ? "Deselect" : "Select for export"}
                        >
                          {isChecked ? (
                            <CheckSquare className="h-5 w-5" style={{ color: c.cobalt }} />
                          ) : (
                            <Square className="h-5 w-5" style={{ color: c.inkMute }} />
                          )}
                        </button>
                      ) : (
                        <div className="flex h-11 w-11 items-center justify-center rounded-md flex-shrink-0" style={{ background: cc.bg, color: cc.fg }}>
                          <FileText className="h-5 w-5" />
                        </div>
                      )}
                      {inStorage && (
                        <div className="flex h-11 w-11 items-center justify-center rounded-md flex-shrink-0" style={{ background: cc.bg, color: cc.fg }}>
                          <FileText className="h-5 w-5" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] truncate" style={{ fontWeight: 600, color: c.ink }}>{d.name}</div>
                        <div className="text-[12px] mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: c.inkSoft }}>
                          <span className="rounded-full px-1.5 py-0.5" style={{ background: cc.bg, color: cc.fg, fontWeight: 700, fontSize: 10 }}>
                            {d.category.toUpperCase()}
                          </span>
                          <span>{d.uploadedBy}</span>
                          <span className="font-mono-num">· {d.uploaded}</span>
                          <span className="font-mono-num">· {d.size}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          {inStorage && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] rounded-full px-1.5 py-0.5" style={{ background: "#EFF1F8", color: "#2A3050", fontWeight: 600 }}>
                              <HardDrive className="h-2.5 w-2.5" /> Replit
                            </span>
                          )}
                          {inDrive && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] rounded-full px-1.5 py-0.5" style={{ background: "#E8F0FE", color: "#1A73E8", fontWeight: 600 }}>
                              <Cloud className="h-2.5 w-2.5" /> Drive
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleDownload(d)}
                          disabled={!inStorage}
                          title={inStorage ? "Download" : "No file in storage"}
                          className="flex h-8 w-8 items-center justify-center rounded-md border hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ borderColor: c.border, color: c.inkSoft }}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        {inDrive && (
                          <a
                            href={`https://drive.google.com/file/d/${d.driveFileId}/view`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open in Google Drive"
                            className="flex h-8 w-8 items-center justify-center rounded-md border hover:bg-slate-50"
                            style={{ borderColor: c.border, color: "#1A73E8" }}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <button
                          onClick={() => openMove([d.id])}
                          title="Move to building or unit"
                          className="flex h-8 w-8 items-center justify-center rounded-md border hover:bg-slate-50"
                          style={{ borderColor: c.border, color: c.inkSoft }}
                        >
                          <FolderInput className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(d.id)}
                          disabled={deletingId === d.id}
                          title="Delete document"
                          className="flex h-8 w-8 items-center justify-center rounded-md border hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ borderColor: c.border, color: "#B8264C" }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}

function TreeNode({
  icon, label, active, count, onClick, bold, noHover,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
  bold?: boolean;
  noHover?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 mx-1 rounded cursor-pointer ${noHover ? "cursor-default" : "hover:bg-slate-50"}`}
      style={active ? { background: c.cobaltSoft } : undefined}
      onClick={onClick}
    >
      <span style={{ color: active ? c.cobalt : c.inkSoft }}>{icon}</span>
      <span
        className="text-[12.5px] flex-1 truncate"
        style={{ color: active ? c.cobalt : c.ink, fontWeight: bold ? 700 : active ? 600 : 500 }}
      >
        {label}
      </span>
      {count !== undefined && (
        <span className="text-[10px] rounded-full px-1.5 py-0.5" style={{ background: active ? c.cobalt : c.cobaltSoft, color: active ? "#fff" : c.cobalt, fontWeight: 700 }}>
          {count}
        </span>
      )}
    </div>
  );
}
