import { useState, useRef, useEffect, useMemo } from "react";
import { X, Upload, Archive, AlertTriangle, CheckCircle, Sparkles, Loader2 } from "lucide-react";
import { c } from "@/lib/theme";
import {
  useRequestUploadUrl,
  usePreviewDocumentImportBatch,
  useCommitDocumentImportBatch,
  useListVendors,
  getListDocumentsQueryKey,
  getListDocumentImportBatchesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

type Props = {
  buildings: Array<{ num: number; address: string }>;
  onClose: () => void;
};

const CATEGORIES = ["Bylaws", "Insurance", "Inspection", "Financial", "Vendor", "Meeting"];
const SOURCES = [
  { value: "imported", label: "Imported" },
  { value: "scanned", label: "Scanned" },
  { value: "prior_mgmt", label: "Prior management" },
  { value: "vendor", label: "Vendor" },
];

type StagedFile = { name: string; size: string; storageKey: string; contentType: string };

type OcrSuggestion = {
  value: string | number;
  confidence: number;
  snippet: string;
  name?: string;
  applied?: boolean;
};
type OcrSuggestions = {
  category?: OcrSuggestion | null;
  documentDate?: OcrSuggestion | null;
  vendor?: OcrSuggestion | null;
  building?: OcrSuggestion | null;
  unit?: OcrSuggestion | null;
};
type OcrRowState = {
  status: "queued" | "processing" | "completed" | "failed" | "skipped";
  attempts: number;
  lastError: string | null;
  suggestions: OcrSuggestions | null;
};
type PreviewRow = {
  index: number;
  name: string;
  size: string;
  storageKey: string;
  category: string;
  building: number | null;
  unit: string | null;
  documentDate: string | null;
  source: string;
  isHistorical: boolean;
  notes: string | null;
  warnings: string[];
  errors: string[];
  ocr?: OcrRowState | null;
};
type PreviewResponse = {
  rows: PreviewRow[];
  validRowCount: number;
  errorRowCount: number;
  ocrEnabled?: boolean;
};

// Per-file overrides the manager has explicitly typed/picked in the preview
// table. These take priority over both the batch defaults and any OCR
// suggestion auto-apply on the next preview round-trip and at commit. A
// `vendorId` of `null` is an explicit clear (kills any OCR vendor
// suggestion); `undefined` means "no override, let OCR auto-apply".
type FileOverride = {
  category?: string;
  building?: number | null;
  unit?: string | null;
  documentDate?: string | null;
  vendorId?: number | null;
};

export function BulkImportDialog({ buildings, onClose }: Props) {
  const qc = useQueryClient();
  const requestUrl = useRequestUploadUrl();
  const previewMut = usePreviewDocumentImportBatch();
  const commitMut = useCommitDocumentImportBatch();
  const { data: vendors = [] } = useListVendors();
  const fileRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<StagedFile[]>([]);
  const [overrides, setOverrides] = useState<Record<string, FileOverride>>({});
  const [defaultCategory, setDefaultCategory] = useState("");
  const [defaultBuilding, setDefaultBuilding] = useState<number | "">("");
  const [defaultSource, setDefaultSource] = useState("imported");
  const [label, setLabel] = useState("");
  const [skipOcr, setSkipOcr] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [committing, setCommitting] = useState(false);
  const [done, setDone] = useState<{ batchId: string; fileCount: number } | null>(null);

  const pendingOcr = useMemo(
    () => preview?.rows.filter((r) => r.ocr && (r.ocr.status === "queued" || r.ocr.status === "processing")).length ?? 0,
    [preview],
  );

  // Poll preview every 2s while OCR jobs are still working — completed
  // suggestions get auto-applied server-side, so the row defaults will
  // refresh on each tick. We re-send current overrides each time so any
  // manual edits stick across polls.
  useEffect(() => {
    if (!preview || pendingOcr === 0 || done) return;
    const t = setTimeout(() => { runPreview(true).catch(() => {}); }, 2000);
    return () => clearTimeout(t);
  }, [preview, pendingOcr, done]);

  function setOverride(key: string, patch: FileOverride) {
    setOverrides((prev) => ({ ...prev, [key]: { ...(prev[key] ?? {}), ...patch } }));
  }

  async function handlePickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const next: StagedFile[] = [];
      for (const f of list) {
        const ct = f.type || "application/octet-stream";
        const { uploadURL } = await requestUrl.mutateAsync({
          data: { name: f.name, size: f.size, contentType: ct },
        });
        const putRes = await fetch(uploadURL, { method: "PUT", body: f });
        if (!putRes.ok) throw new Error(`Upload failed for ${f.name}`);
        const u = new URL(uploadURL);
        const path = u.pathname;
        const idx = path.lastIndexOf("/uploads/");
        const objectId = idx >= 0 ? path.slice(idx + "/uploads/".length) : path.split("/").pop()!;
        next.push({
          name: f.name,
          size: `${(f.size / 1024).toFixed(0)} KB`,
          storageKey: `/objects/uploads/${objectId}`,
          contentType: ct,
        });
      }
      setFiles((prev) => [...prev, ...next]);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setError(msg);
    } finally {
      setUploading(false);
    }
  }

  function previewBody() {
    return {
      defaultCategory: defaultCategory || undefined,
      defaultBuilding: defaultBuilding === "" ? null : defaultBuilding,
      defaultSource,
      defaultIsHistorical: true,
      skipOcr,
      // contentType is critical for the server-side OCR scheduler so it can
      // dispatch text passthrough vs. pdf-parse vs. vision OCR. Per-file
      // overrides ride along on each `files[]` entry so the manager's
      // manual edits survive preview round-trips and the commit.
      files: files.map((f) => {
        const ov = overrides[f.storageKey] ?? {};
        return {
          name: f.name,
          size: f.size,
          storageKey: f.storageKey,
          contentType: f.contentType,
          category: ov.category,
          building: ov.building === undefined ? undefined : ov.building,
          unit: ov.unit === undefined ? undefined : ov.unit,
          documentDate: ov.documentDate === undefined ? undefined : ov.documentDate,
          // Explicit `null` clears any OCR vendor suggestion; `undefined`
          // (not sent) lets the server auto-apply a high-confidence vendor.
          vendorId: ov.vendorId === undefined ? undefined : ov.vendorId,
        };
      }),
    };
  }

  async function runPreview(silent = false) {
    if (!silent) { setError(null); setPreview(null); }
    if (files.length === 0) { setError("Add at least one file first"); return; }
    try {
      const res = (await previewMut.mutateAsync({ data: previewBody() as never })) as PreviewResponse;
      setPreview(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Preview failed";
      if (!silent) setError(msg);
    }
  }

  async function commit() {
    if (!preview || preview.errorRowCount > 0) return;
    setCommitting(true);
    setError(null);
    try {
      const res = (await commitMut.mutateAsync({
        data: { ...previewBody(), label: label || null } as never,
      })) as { id: string; fileCount: number };
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() }),
        qc.invalidateQueries({ queryKey: getListDocumentImportBatchesQueryKey() }),
      ]);
      setDone({ batchId: res.id, fileCount: res.fileCount });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Commit failed";
      setError(msg);
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-4xl max-h-[90vh] overflow-auto rounded-2xl shadow-xl p-6" style={{ background: c.panel }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Archive className="h-5 w-5" style={{ color: c.cobalt }} />
            <h3 className="text-[16px]" style={{ fontWeight: 700 }}>Bulk import historical documents</h3>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="rounded-md p-4 flex items-start gap-3"
              style={{ background: "#DCF3EC", color: "#0E8A6B" }}>
              <CheckCircle className="h-5 w-5 mt-0.5" />
              <div>
                <div style={{ fontWeight: 700 }}>Imported {done.fileCount} file{done.fileCount === 1 ? "" : "s"}</div>
                <div className="text-[12.5px] mt-1">Batch <span className="font-mono-num">{done.batchId}</span> can be undone within 24 hours.</div>
              </div>
            </div>
            <div className="flex justify-end">
              <button onClick={onClose}
                className="rounded-md px-4 py-2 text-[13px]"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <Field label="Default category">
                <select value={defaultCategory} onChange={(e) => setDefaultCategory(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-[13px] bg-white" style={{ borderColor: c.border }}>
                  <option value="">Auto-detect from OCR</option>
                  {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </Field>
              <Field label="Default building">
                <select value={defaultBuilding} onChange={(e) => setDefaultBuilding(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full rounded-md border px-3 py-2 text-[13px] bg-white" style={{ borderColor: c.border }}>
                  <option value="">Auto-detect from OCR</option>
                  {buildings.map((b) => <option key={b.num} value={b.num}>Bldg {String(b.num).padStart(2, "0")}</option>)}
                </select>
              </Field>
              <Field label="Source">
                <select value={defaultSource} onChange={(e) => setDefaultSource(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-[13px] bg-white" style={{ borderColor: c.border }}>
                  {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Batch label (optional)">
                <input value={label} onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. 2018–2022 prior mgmt"
                  className="w-full rounded-md border px-3 py-2 text-[13px] bg-white" style={{ borderColor: c.border }} />
              </Field>
            </div>

            <label className="flex items-center gap-2 mb-4 text-[12.5px]" style={{ color: c.inkSoft }}>
              <input type="checkbox" checked={skipOcr} onChange={(e) => setSkipOcr(e.target.checked)} />
              <span>Skip OCR auto-tag suggestions for this batch</span>
            </label>

            <div className="rounded-lg border p-3 mb-4" style={{ borderColor: c.border }}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[13px]" style={{ fontWeight: 600 }}>Files ({files.length})</div>
                <label
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] cursor-pointer hover:opacity-90"
                  style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 600 }}
                >
                  <Upload className="h-3.5 w-3.5" /> {uploading ? "Uploading…" : "Add files"}
                  <input ref={fileRef} type="file" multiple className="hidden" onChange={handlePickFiles} disabled={uploading} />
                </label>
              </div>
              {files.length === 0 ? (
                <div className="py-4 text-center text-[12.5px]" style={{ color: c.inkMute }}>No files staged yet.</div>
              ) : (
                <ul className="text-[12.5px] divide-y" style={{ color: c.inkSoft }}>
                  {files.map((f, i) => (
                    <li key={i} className="flex items-center justify-between py-1.5">
                      <span className="truncate">{f.name}</span>
                      <span style={{ color: c.inkMute }}>{f.size}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {preview && (
              <div className="rounded-lg border p-3 mb-4" style={{ borderColor: c.border }}>
                <div className="flex items-center gap-2 mb-2 text-[13px]" style={{ fontWeight: 600 }}>
                  Preview: {preview.validRowCount} ready
                  {preview.errorRowCount > 0 && (
                    <span className="rounded-full px-2 py-0.5 text-[11px]"
                      style={{ background: c.roseSoft, color: c.rose, fontWeight: 700 }}>
                      {preview.errorRowCount} error{preview.errorRowCount === 1 ? "" : "s"}
                    </span>
                  )}
                  {preview.ocrEnabled && pendingOcr > 0 && (
                    <span className="rounded-full px-2 py-0.5 text-[11px] inline-flex items-center gap-1"
                      style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}>
                      <Loader2 className="h-3 w-3 animate-spin" /> Reading {pendingOcr}…
                    </span>
                  )}
                </div>
                <ul className="text-[12px] divide-y max-h-[26rem] overflow-auto">
                  {preview.rows.map((r) => (
                    <PreviewRowItem
                      key={r.index}
                      row={r}
                      buildings={buildings}
                      vendors={vendors}
                      override={overrides[r.storageKey] ?? {}}
                      onChange={(patch) => setOverride(r.storageKey, patch)}
                    />
                  ))}
                </ul>
              </div>
            )}

            {error && (
              <div className="rounded-md px-3 py-2 mb-3 text-[12.5px]"
                style={{ background: c.roseSoft, color: c.rose }}>{error}</div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={onClose}
                className="rounded-md border px-4 py-2 text-[13px] hover:bg-slate-50"
                style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}>Cancel</button>
              {!preview ? (
                <button onClick={() => runPreview(false)} disabled={files.length === 0 || uploading}
                  className="rounded-md px-4 py-2 text-[13px] hover:opacity-90 disabled:opacity-60"
                  style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 600 }}>Preview</button>
              ) : (
                <>
                  <button onClick={() => runPreview(false)} disabled={committing}
                    className="rounded-md border px-4 py-2 text-[13px] hover:bg-slate-50 disabled:opacity-60"
                    style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}>Re-validate</button>
                  <button onClick={commit} disabled={committing || preview.errorRowCount > 0}
                    className="rounded-md px-4 py-2 text-[13px] hover:opacity-90 disabled:opacity-60"
                    style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
                    {committing ? "Importing…" : `Commit ${preview.validRowCount} files`}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Per-row review item ---------------------------------------------------

function PreviewRowItem({
  row,
  buildings,
  vendors,
  override,
  onChange,
}: {
  row: PreviewRow;
  buildings: Array<{ num: number; address: string }>;
  vendors: Array<{ id: number; name: string }>;
  override: FileOverride;
  onChange: (patch: FileOverride) => void;
}) {
  const ocr = row.ocr;
  // Selected display values: prefer the manager's override, then whatever the
  // server settled on (default or OCR-applied), then null.
  const category = override.category ?? row.category ?? "";
  const building = override.building !== undefined ? override.building : row.building;
  const unit = override.unit !== undefined ? override.unit : row.unit;
  const documentDate = override.documentDate !== undefined ? override.documentDate : row.documentDate;
  const vendorSug = ocr?.suggestions?.vendor ?? null;
  const vendorAutoId =
    vendorSug && typeof vendorSug.value === "number" && vendorSug.applied ? vendorSug.value : null;
  // Vendor isn't on `PreviewRow` directly today (the server stores it via the
  // OCR suggestion). Selected vendor: explicit override wins; else the
  // auto-applied OCR vendor; else nothing.
  const vendorId = override.vendorId !== undefined ? override.vendorId : vendorAutoId;

  return (
    <li className="py-2.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="truncate" style={{ color: c.ink, fontWeight: 600 }}>{row.name}</span>
        <span className="text-[11px] shrink-0" style={{ color: c.inkMute }}>{row.size}</span>
      </div>

      <div className="grid grid-cols-5 gap-2">
        <RowField label="Category" autoTagged={!!ocr?.suggestions?.category?.applied && override.category === undefined}>
          <select
            value={category}
            onChange={(e) => onChange({ category: e.target.value || undefined })}
            className="w-full rounded-md border px-2 py-1 text-[12px] bg-white"
            style={{ borderColor: c.border }}
          >
            <option value="">—</option>
            {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </RowField>
        <RowField label="Building" autoTagged={!!ocr?.suggestions?.building?.applied && override.building === undefined}>
          <select
            value={building == null ? "" : String(building)}
            onChange={(e) => onChange({ building: e.target.value === "" ? null : Number(e.target.value) })}
            className="w-full rounded-md border px-2 py-1 text-[12px] bg-white"
            style={{ borderColor: c.border }}
          >
            <option value="">—</option>
            {buildings.map((b) => <option key={b.num} value={b.num}>Bldg {String(b.num).padStart(2, "0")}</option>)}
          </select>
        </RowField>
        <RowField label="Unit" autoTagged={!!ocr?.suggestions?.unit?.applied && override.unit === undefined}>
          <input
            type="text"
            value={unit ?? ""}
            placeholder="e.g. 12B"
            onChange={(e) => onChange({ unit: e.target.value || null })}
            className="w-full rounded-md border px-2 py-1 text-[12px] bg-white"
            style={{ borderColor: c.border }}
          />
        </RowField>
        <RowField label="Document date" autoTagged={!!ocr?.suggestions?.documentDate?.applied && override.documentDate === undefined}>
          <input
            type="date"
            value={documentDate ?? ""}
            onChange={(e) => onChange({ documentDate: e.target.value || null })}
            className="w-full rounded-md border px-2 py-1 text-[12px] bg-white"
            style={{ borderColor: c.border }}
          />
        </RowField>
        <RowField label="Vendor" autoTagged={!!vendorSug?.applied && override.vendorId === undefined}>
          <select
            value={vendorId == null ? "" : String(vendorId)}
            onChange={(e) =>
              onChange({ vendorId: e.target.value === "" ? null : Number(e.target.value) })
            }
            className="w-full rounded-md border px-2 py-1 text-[12px] bg-white"
            style={{ borderColor: c.border }}
          >
            <option value="">— None</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </RowField>
      </div>

      {row.errors.length > 0 && (
        <div className="flex items-start gap-1 mt-1.5 text-[11.5px]" style={{ color: c.rose }}>
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{row.errors.join("; ")}</span>
        </div>
      )}

      <OcrEvidence ocr={ocr ?? null} override={override} />
    </li>
  );
}

function RowField({
  label,
  children,
  autoTagged,
}: {
  label: string;
  children: React.ReactNode;
  autoTagged: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10.5px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>{label}</span>
        {autoTagged && (
          <span className="inline-flex items-center gap-0.5 text-[10px]" style={{ color: c.cobalt, fontWeight: 600 }}>
            <Sparkles className="h-2.5 w-2.5" /> auto
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function OcrEvidence({ ocr, override }: { ocr: OcrRowState | null; override: FileOverride }) {
  if (!ocr) return null;
  if (ocr.status === "queued" || ocr.status === "processing") {
    return (
      <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: c.inkMute }}>
        <Loader2 className="h-3 w-3 animate-spin" /> Reading file…
      </div>
    );
  }
  if (ocr.status === "skipped") return null;
  if (ocr.status === "failed") {
    return (
      <div className="mt-1.5 text-[11.5px]" style={{ color: c.inkMute }}>
        OCR failed{ocr.lastError ? `: ${ocr.lastError}` : ""}.
      </div>
    );
  }
  const s = ocr.suggestions;
  if (!s) return null;
  const items: Array<{
    field: string;
    label: string;
    sug: OcrSuggestion;
    overridden: boolean;
  }> = [];
  if (s.category) items.push({ field: "category", label: "Category", sug: s.category, overridden: override.category !== undefined });
  if (s.documentDate) items.push({ field: "documentDate", label: "Date", sug: s.documentDate, overridden: override.documentDate !== undefined });
  if (s.vendor) items.push({ field: "vendor", label: "Vendor", sug: s.vendor, overridden: false });
  if (s.building) items.push({ field: "building", label: "Building", sug: s.building, overridden: override.building !== undefined });
  if (s.unit) items.push({ field: "unit", label: "Unit", sug: s.unit, overridden: override.unit !== undefined });
  if (items.length === 0) return null;
  return (
    <div className="mt-2 rounded-md p-2 text-[11.5px]" style={{ background: c.cobaltSoft, color: c.cobalt }}>
      <div className="flex items-start gap-1.5">
        <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div style={{ fontWeight: 600 }}>OCR evidence</div>
          <ul className="mt-1 space-y-1">
            {items.map((it) => (
              <li key={it.field} className="flex items-baseline gap-1.5">
                <span style={{ fontWeight: 600 }}>{it.label}:</span>
                <span>{it.sug.name ?? String(it.sug.value)}</span>
                <ConfidencePill confidence={it.sug.confidence} />
                {it.overridden && (
                  <span className="text-[10px]" style={{ color: c.inkSoft, fontStyle: "italic" }}>(manually overridden)</span>
                )}
                {it.sug.applied && !it.overridden && (
                  <span className="text-[10px]" style={{ color: c.cobalt, fontWeight: 600 }}>(applied)</span>
                )}
                {it.sug.snippet && (
                  <span className="truncate italic" style={{ color: c.inkSoft }}>“{it.sug.snippet}”</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ConfidencePill({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const tier = confidence >= 0.75 ? "high" : confidence >= 0.5 ? "med" : "low";
  const styles =
    tier === "high"
      ? { bg: "#DCF3EC", fg: "#0E8A6B" }
      : tier === "med"
        ? { bg: c.cobaltSoft, fg: c.cobalt }
        : { bg: "#FFF3E0", fg: "#A05A00" };
  return (
    <span
      className="rounded-full px-1.5 py-px text-[10px] tabular-nums"
      style={{ background: styles.bg, color: styles.fg, fontWeight: 700 }}
      title={`Heuristic confidence: ${pct}%`}
    >
      {pct}%
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11.5px] uppercase tracking-wider mb-1"
        style={{ color: c.inkSoft, fontWeight: 700 }}>{label}</label>
      {children}
    </div>
  );
}
