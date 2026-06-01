// Pure aggregation helper for the unified per-vendor "Files" room.
// Combines: certificates (COI/W9/license), contracts, work-order
// attachments, bid quote PDFs (license/COI/quote), and free-form
// documents tagged with vendor_id. The route layer is responsible for
// loading rows from the DB; this file only normalizes & sorts.

export type VendorFileSource =
  | "certificate"
  | "contract"
  | "work_order"
  | "bid_quote"
  | "document";

export interface VendorFile {
  id: string;
  source: VendorFileSource;
  // Free-form bucket label (COI, Contract, WO attachment, Quote PDF, etc.)
  kind: string;
  name: string;
  storageKey: string | null;
  uploadedAt: string;
  // Cross-link target so the UI can deep-link back to the source record.
  linkedEntityType: VendorFileSource;
  linkedEntityId: string;
}

export interface CertificateInput {
  id: number;
  kind: string;
  documentStorageKey: string | null;
  expiresOn: string;
  createdAt: string;
}

export interface ContractInput {
  id: number;
  title: string;
  contractDocStorageKey: string | null;
  createdAt: string;
}

export interface WorkOrderAttachmentInput {
  id: number;
  workOrderId: string;
  name: string | null;
  storageKey: string;
  uploadedAt: string;
}

export interface BidQuoteFilesInput {
  id: number;
  bidRequestId: number;
  licenseStorageKey: string | null;
  coiStorageKey: string | null;
  quotePdfStorageKey: string | null;
  submittedAt: string;
}

export interface DocumentInput {
  id: string;
  name: string;
  category: string;
  storageKey: string | null;
  uploaded: string;
}

export interface VendorFilesAggregateInput {
  certificates: CertificateInput[];
  contracts: ContractInput[];
  workOrderAttachments: WorkOrderAttachmentInput[];
  bidQuotes: BidQuoteFilesInput[];
  documents: DocumentInput[];
}

export function aggregateVendorFiles(
  input: VendorFilesAggregateInput,
): VendorFile[] {
  const out: VendorFile[] = [];

  for (const c of input.certificates) {
    if (!c.documentStorageKey) continue;
    out.push({
      id: `cert-${c.id}`,
      source: "certificate",
      kind: c.kind.toUpperCase(),
      name: `${c.kind.toUpperCase()} (expires ${c.expiresOn})`,
      storageKey: c.documentStorageKey,
      uploadedAt: c.createdAt,
      linkedEntityType: "certificate",
      linkedEntityId: String(c.id),
    });
  }

  for (const k of input.contracts) {
    if (!k.contractDocStorageKey) continue;
    out.push({
      id: `contract-${k.id}`,
      source: "contract",
      kind: "Contract",
      name: k.title,
      storageKey: k.contractDocStorageKey,
      uploadedAt: k.createdAt,
      linkedEntityType: "contract",
      linkedEntityId: String(k.id),
    });
  }

  for (const a of input.workOrderAttachments) {
    out.push({
      id: `woa-${a.id}`,
      source: "work_order",
      kind: "WO attachment",
      name: a.name ?? `Attachment for ${a.workOrderId}`,
      storageKey: a.storageKey,
      uploadedAt: a.uploadedAt,
      linkedEntityType: "work_order",
      linkedEntityId: a.workOrderId,
    });
  }

  for (const q of input.bidQuotes) {
    if (q.licenseStorageKey) {
      out.push({
        id: `quote-${q.id}-license`,
        source: "bid_quote",
        kind: "License (bid)",
        name: `License — bid #${q.bidRequestId}`,
        storageKey: q.licenseStorageKey,
        uploadedAt: q.submittedAt,
        linkedEntityType: "bid_quote",
        linkedEntityId: String(q.id),
      });
    }
    if (q.coiStorageKey) {
      out.push({
        id: `quote-${q.id}-coi`,
        source: "bid_quote",
        kind: "COI (bid)",
        name: `COI — bid #${q.bidRequestId}`,
        storageKey: q.coiStorageKey,
        uploadedAt: q.submittedAt,
        linkedEntityType: "bid_quote",
        linkedEntityId: String(q.id),
      });
    }
    if (q.quotePdfStorageKey) {
      out.push({
        id: `quote-${q.id}-pdf`,
        source: "bid_quote",
        kind: "Quote PDF",
        name: `Quote PDF — bid #${q.bidRequestId}`,
        storageKey: q.quotePdfStorageKey,
        uploadedAt: q.submittedAt,
        linkedEntityType: "bid_quote",
        linkedEntityId: String(q.id),
      });
    }
  }

  for (const d of input.documents) {
    out.push({
      id: `doc-${d.id}`,
      source: "document",
      kind: d.category,
      name: d.name,
      storageKey: d.storageKey,
      uploadedAt: d.uploaded,
      linkedEntityType: "document",
      linkedEntityId: d.id,
    });
  }

  // Newest first — that is the timeline most managers want.
  out.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : a.uploadedAt > b.uploadedAt ? -1 : 0));
  return out;
}

export interface VendorFileFilters {
  source?: VendorFileSource;
  year?: number;
  q?: string;
}

export function filterVendorFiles(
  files: readonly VendorFile[],
  filters: VendorFileFilters,
): VendorFile[] {
  const q = filters.q?.trim().toLowerCase() ?? "";
  return files.filter((f) => {
    if (filters.source && f.source !== filters.source) return false;
    if (filters.year != null) {
      const y = Number(f.uploadedAt.slice(0, 4));
      if (y !== filters.year) return false;
    }
    if (q) {
      const hay = `${f.name} ${f.kind}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
