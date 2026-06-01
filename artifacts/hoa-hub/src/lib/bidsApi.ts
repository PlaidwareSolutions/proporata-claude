const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface BidListItem {
  id: number;
  title: string;
  scope: string;
  buildingNum: number | null;
  unitId: string | null;
  tradeCategory: string;
  status: string;
  deadline: string;
  sealedBids: boolean;
  notifyNonAwarded: boolean;
  createdByName: string;
  createdAt: string;
  awardedVendorId: number | null;
  awardedAt: string | null;
  awardedWorkOrderId: string | null;
  invitedCount: number;
  submittedCount: number;
  resolutionId: number | null;
  resolutionNumber: string | null;
  resolutionTitle: string | null;
  resolutionStatus: "adopted" | "superseded" | "rescinded" | null;
  awardMotionId: number | null;
  awardEmergencyBypassId: number | null;
}

export interface BidScopeItem { id: number; sortOrder: number; label: string; notes: string | null; }
export interface BidInvitation {
  id: number; vendorId: number; vendorName: string; vendorEmail: string | null;
  status: string; invitedAt: string;
  viewedAt: string | null; submittedAt: string | null; declinedAt: string | null; tokenExpiresAt: string;
}
export interface BidQuote {
  id: number; bidRequestId: number; vendorId: number; vendorName: string; invitationId: number | null;
  leadTimeDays: number | null; paymentTerms: string | null; warrantyText: string | null; notes: string | null;
  licenseStorageKey: string | null; coiStorageKey: string | null; quotePdfStorageKey: string | null;
  enteredByManager: boolean; firmConfirmation: boolean;
  totalCents: number | null; submittedAt: string;
  lines: Array<{ scopeItemId: number; amountCents: number | null }>;
}
export interface BidAttachment {
  id: number; name: string; size: number; contentType: string | null;
  storageKey: string; kind: string; uploadedByName: string; uploadedAt: string;
}
export interface BidDetail extends BidListItem {
  sealedActive: boolean;
  scope: string;
  awardRationale: string | null;
  awardMemoStorageKey: string | null;
  sourceWorkOrderId: string | null;
  sealedOpenedAt: string | null;
  scopeItems: BidScopeItem[];
  invitations: BidInvitation[];
  quotes: BidQuote[];
  attachments: BidAttachment[];
}

async function jfetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const bidsApi = {
  list: (status?: string) =>
    jfetch<BidListItem[]>(`/api/bids${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  get: (id: number) => jfetch<BidDetail>(`/api/bids/${id}`),
  create: (body: {
    title: string; scope?: string; buildingNum?: number | null; unitId?: string | null;
    tradeCategory: string; deadline: string; sealedBids?: boolean; notifyNonAwarded?: boolean;
    sourceWorkOrderId?: string | null;
    resolutionId?: number | null;
    scopeItems?: Array<{ label: string; notes?: string | null }>;
  }) => jfetch<{ id: number }>(`/api/bids`, { method: "POST", body: JSON.stringify(body) }),
  patch: (id: number, body: Record<string, unknown>) =>
    jfetch<unknown>(`/api/bids/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  addScopeItem: (id: number, body: { label: string; notes?: string | null }) =>
    jfetch<BidScopeItem>(`/api/bids/${id}/scope-items`, { method: "POST", body: JSON.stringify(body) }),
  removeScopeItem: (itemId: number) =>
    jfetch<void>(`/api/bids/scope-items/${itemId}`, { method: "DELETE" }),
  invite: (id: number, vendorIds: number[]) =>
    jfetch<{ invitations: Array<{ vendorId: number; magicLink: string }> }>(
      `/api/bids/${id}/invitations`, { method: "POST", body: JSON.stringify({ vendorIds }) }),
  send: (id: number) =>
    jfetch<{ links: Array<{ vendorId: number; magicLink: string }> }>(`/api/bids/${id}/send`, { method: "POST" }),
  managerQuote: (id: number, body: {
    vendorId: number; leadTimeDays?: number; paymentTerms?: string; warrantyText?: string; notes?: string;
    quotePdfStorageKey?: string; licenseStorageKey?: string; coiStorageKey?: string;
    lines: Array<{ scopeItemId: number; amountCents: number }>;
  }) => jfetch<{ ok: true }>(`/api/bids/${id}/manager-quote`, { method: "POST", body: JSON.stringify(body) }),
  award: (id: number, body: { vendorId: number; rationale: string }) =>
    jfetch<{ workOrderId: string; awardMemoStorageKey: string | null }>(
      `/api/bids/${id}/award`, { method: "POST", body: JSON.stringify(body) }),
  cancel: (id: number) => jfetch<{ ok: true }>(`/api/bids/${id}/cancel`, { method: "POST" }),
  openSealedEarly: (id: number) =>
    jfetch<{ ok: true }>(`/api/bids/${id}/open-sealed-early`, { method: "POST" }),
  uploadUrl: () => jfetch<{ uploadURL: string; objectPath: string }>(`/api/bids/upload-url`, { method: "POST" }),
  addAttachment: (id: number, body: { name: string; storageKey: string; size?: number; contentType?: string; kind?: string }) =>
    jfetch<{ id: number }>(`/api/bids/${id}/attachments`, { method: "POST", body: JSON.stringify(body) }),
  attachmentUrl: (bidId: number, attId: number) => `${BASE}/api/bids/${bidId}/attachments/${attId}`,
  awardMemoUrl: (bidId: number) => `${BASE}/api/bids/${bidId}/award-memo`,
  quoteDocUrl: (quoteId: number, kind: "quote" | "license" | "coi") =>
    `${BASE}/api/bids/quotes/${quoteId}/doc/${kind}`,
};

export interface QuotePublicView {
  orgName: string;
  bid: {
    id: number; title: string; scope: string; tradeCategory: string;
    buildingNum: number | null; deadline: string; sealedBids: boolean;
  };
  vendor: { id: number; name: string; email: string } | null;
  scopeItems: Array<{ id: number; label: string; notes: string | null; sortOrder: number }>;
  attachments: Array<{ id: number; name: string; size: number; contentType: string | null; downloadUrl: string }>;
  existingQuote: {
    leadTimeDays: number | null; paymentTerms: string | null; warrantyText: string | null;
    notes: string | null; firmConfirmation: boolean;
    lines: Array<{ scopeItemId: number; amountCents: number }>;
  } | null;
}

export const quotePublicApi = {
  view: (token: string) => jfetch<QuotePublicView>(`/api/quote/${encodeURIComponent(token)}`),
  submit: (token: string, body: {
    leadTimeDays?: number; paymentTerms?: string; warrantyText?: string; notes?: string;
    firmConfirmation: boolean;
    quotePdfStorageKey?: string; licenseStorageKey?: string; coiStorageKey?: string;
    lines: Array<{ scopeItemId: number; amountCents: number }>;
  }) => jfetch<{ ok: true }>(`/api/quote/${encodeURIComponent(token)}`, {
    method: "POST", body: JSON.stringify(body),
  }),
  decline: (token: string) =>
    jfetch<{ ok: true }>(`/api/quote/${encodeURIComponent(token)}/decline`, { method: "POST" }),
  uploadUrl: (token: string) =>
    jfetch<{ uploadURL: string; objectPath: string }>(
      `/api/quote/${encodeURIComponent(token)}/upload-url`, { method: "POST" }),
};

export function fmtCents(c: number | null | undefined): string {
  if (c === null || c === undefined) return "—";
  return `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const TRADE_CATEGORIES = [
  "Roofing","Plumbing","Electrical","HVAC","Landscaping","Painting","General","Pest Control","Cleaning","Other",
] as const;

export const BID_STATUS_LABELS: Record<string, { label: string; bg: string; fg: string }> = {
  draft:     { label: "Draft",     bg: "#EEF1F8", fg: "#5A6280" },
  open:      { label: "Open",      bg: "#DCEAFE", fg: "#1A4FBF" },
  closed:    { label: "Closed",    bg: "#FFEFD0", fg: "#9A6500" },
  awarded:   { label: "Awarded",   bg: "#DCF3EC", fg: "#0E8A6B" },
  cancelled: { label: "Cancelled", bg: "#F3D6D6", fg: "#9A2A2A" },
};
