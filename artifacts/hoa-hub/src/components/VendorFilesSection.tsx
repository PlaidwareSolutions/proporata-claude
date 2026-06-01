import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListVendorFiles,
  useCreateDocument,
  getListVendorFilesQueryKey,
  getListDocumentsQueryKey,
} from "@workspace/api-client-react";
import type { VendorFile, CreateDocumentBody } from "@workspace/api-client-react";
import { c } from "@/lib/theme";
import { FileText, BadgeCheck, FileSignature, ClipboardList, Receipt, File, Search, Plus } from "lucide-react";

const sourceMeta: Record<VendorFile["source"], { label: string; icon: any; color: string }> = {
  certificate: { label: "Certificate", icon: BadgeCheck,    color: c.emerald },
  contract:    { label: "Contract",    icon: FileSignature, color: c.cobalt },
  work_order:  { label: "Work order",  icon: ClipboardList, color: c.amber },
  bid_quote:   { label: "Bid quote",   icon: Receipt,       color: c.ink },
  document:    { label: "Document",    icon: File,          color: c.inkSoft },
};

const SOURCES: VendorFile["source"][] = ["certificate", "contract", "work_order", "bid_quote", "document"];

export function VendorFilesSection({ vendorId, canEdit = false }: { vendorId: number; canEdit?: boolean }) {
  const queryClient = useQueryClient();
  const [source, setSource] = useState<VendorFile["source"] | "">("");
  const [year, setYear] = useState("");
  const [q, setQ] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const { data: files = [], isLoading } = useListVendorFiles(vendorId, {
    query: { queryKey: getListVendorFilesQueryKey(vendorId) },
  });

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return files.filter((f) => {
      if (source && f.source !== source) return false;
      if (year && f.uploadedAt.slice(0, 4) !== year) return false;
      if (ql && !`${f.name} ${f.kind}`.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [files, source, year, q]);

  const years = useMemo(() => {
    const ys = new Set(files.map((f) => f.uploadedAt.slice(0, 4)));
    return Array.from(ys).sort().reverse();
  }, [files]);

  function deepLink(f: VendorFile): string | null {
    switch (f.linkedEntityType) {
      case "work_order": return `/work-orders/${f.linkedEntityId}`;
      case "document":   return `/documents`;
      case "contract":   return `/vendors/${vendorId}`;
      case "certificate":return `/vendors/${vendorId}`;
      case "bid_quote":  return `/bids`;
      default:           return null;
    }
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: c.panel, borderColor: c.border }}>
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: c.border }}>
        <div>
          <div className="text-[15px] flex items-center gap-2" style={{ fontWeight: 700 }}>
            <FileText className="h-4 w-4" style={{ color: c.inkMute }} /> Vendor files
          </div>
          <div className="text-[12.5px] mt-0.5" style={{ color: c.inkMute }}>
            Certificates, contracts, work-order attachments, bids and free-form documents — all in one place
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px]" style={{ color: c.inkMute, fontWeight: 600 }}>
            {filtered.length} of {files.length}
          </span>
          {canEdit && (
            <button onClick={() => setShowAdd((s) => !s)} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] hover:bg-slate-50" style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 600 }}>
              <Plus className="h-3.5 w-3.5" /> {showAdd ? "Cancel" : "Add file"}
            </button>
          )}
        </div>
      </div>

      <div className="px-5 py-3 border-b grid grid-cols-4 gap-3" style={{ borderColor: c.borderSoft, background: c.canvas }}>
        <label className="flex items-center gap-2 rounded border px-2 py-1.5 text-[12.5px]" style={{ borderColor: c.border, background: c.panel }}>
          <Search className="h-3.5 w-3.5" style={{ color: c.inkMute }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or kind…" className="flex-1 outline-none bg-transparent" />
        </label>
        <select value={source} onChange={(e) => setSource(e.target.value as VendorFile["source"] | "")} className="rounded border px-2 py-1.5 text-[12.5px]" style={{ borderColor: c.border, background: c.panel }}>
          <option value="">All sources</option>
          {SOURCES.map((s) => <option key={s} value={s}>{sourceMeta[s].label}</option>)}
        </select>
        <select value={year} onChange={(e) => setYear(e.target.value)} className="rounded border px-2 py-1.5 text-[12.5px]" style={{ borderColor: c.border, background: c.panel }}>
          <option value="">All years</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={() => { setSource(""); setYear(""); setQ(""); }} className="rounded border px-2 py-1.5 text-[12.5px] hover:bg-slate-50" style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 600 }}>
          Reset filters
        </button>
      </div>

      {showAdd && canEdit && (
        <AddFreeFormFile
          vendorId={vendorId}
          onDone={async () => {
            await queryClient.invalidateQueries({ queryKey: getListVendorFilesQueryKey(vendorId) });
            await queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
            setShowAdd(false);
          }}
        />
      )}

      {isLoading ? (
        <div className="py-10 text-center text-[13px]" style={{ color: c.inkMute }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center text-[13px]" style={{ color: c.inkMute }}>
          {files.length === 0 ? "No files for this vendor yet." : "No files match your filters."}
        </div>
      ) : (
        <table className="w-full text-[13px]">
          <thead style={{ background: c.canvas }}>
            <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: c.inkMute }}>
              {["Source", "Name", "Kind", "Linked to", "Uploaded"].map((h) => (
                <th key={h} className="px-4 py-3" style={{ fontWeight: 700 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => {
              const m = sourceMeta[f.source];
              const Icon = m.icon;
              const href = deepLink(f);
              return (
                <tr key={`${f.source}:${f.id}`} className="border-t hover:bg-slate-50" style={{ borderColor: c.borderSoft }}>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]" style={{ background: m.color + "1F", color: m.color, fontWeight: 700 }}>
                      <Icon className="h-3 w-3" /> {m.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5" style={{ color: c.ink, fontWeight: 600 }}>{f.name}</td>
                  <td className="px-4 py-2.5" style={{ color: c.inkSoft }}>{f.kind || "—"}</td>
                  <td className="px-4 py-2.5 font-mono-num text-[12px]" style={{ color: c.inkMute }}>
                    {href ? <Link href={href} style={{ color: c.cobalt, fontWeight: 600 }}>{f.linkedEntityType}:{f.linkedEntityId}</Link> : <>{f.linkedEntityType}:{f.linkedEntityId}</>}
                  </td>
                  <td className="px-4 py-2.5 font-mono-num" style={{ color: c.inkSoft }}>{f.uploadedAt.slice(0, 10)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AddFreeFormFile({ vendorId, onDone }: { vendorId: number; onDone: () => Promise<void> | void }) {
  const createDoc = useCreateDocument();
  const [name, setName] = useState("");
  const [storageKey, setStorageKey] = useState("");
  const [notes, setNotes] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !storageKey) return;
    const body: CreateDocumentBody = {
      name,
      category: "Vendor",
      storageKey,
      uploadedBy: "manager",
      size: "0",
      vendorId,
      isHistorical: false,
      source: "vendor",
      notes: notes || null,
    };
    await createDoc.mutateAsync({ data: body });
    setName(""); setStorageKey(""); setNotes("");
    await onDone();
  }

  return (
    <form onSubmit={submit} className="px-5 py-4 border-b grid grid-cols-4 gap-3" style={{ borderColor: c.borderSoft, background: c.canvas }}>
      <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="File name" className="rounded border px-2 py-1.5 text-[12.5px] col-span-2" style={{ borderColor: c.border, background: c.panel }} />
      <input value={storageKey} onChange={(e) => setStorageKey(e.target.value)} required placeholder="Storage key (uploaded path)" className="rounded border px-2 py-1.5 text-[12.5px]" style={{ borderColor: c.border, background: c.panel }} />
      <button type="submit" disabled={createDoc.isPending} className="rounded text-[12.5px] disabled:opacity-60" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
        {createDoc.isPending ? "Saving…" : "Attach to vendor"}
      </button>
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="rounded border px-2 py-1.5 text-[12.5px] col-span-4" style={{ borderColor: c.border, background: c.panel }} />
    </form>
  );
}
