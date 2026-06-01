// Task #63: Board Resolutions Library — minimal client.
// Mirrors motionsApi.ts; we use direct fetch instead of the OpenAPI codegen
// to keep the change self-contained.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type VotingRule =
  | { type: "unanimous" }
  | { type: "majority" }
  | { type: "supermajority"; threshold: number }
  | { type: "single_approver" }
  | { type: "quorum_only"; quorum: number };

export const RESOLUTION_CATEGORIES = [
  "architectural", "financial", "rules", "personnel", "emergency", "other",
] as const;
export type ResolutionCategory = typeof RESOLUTION_CATEGORIES[number];

export interface ResolutionListItem {
  id: number;
  motionId: number;
  number: string | null;
  category: ResolutionCategory;
  title: string;
  body: string;
  status: "draft" | "adopted" | "superseded" | "rescinded" | "rejected";
  motionStatus: string;
  votingRule: VotingRule;
  votingRuleDescription: string;
  createdByName: string;
  createdAt: string;
  adoptedAt: string | null;
  closesAt: string | null;
  supersededByResolutionId: number | null;
  rescindedByMotionId: number | null;
  pdfStorageKey: string | null;
  public: boolean;
  tally: { approve: number; reject: number; abstain: number };
}

export interface ResolutionDetail extends ResolutionListItem {
  supersedes: { id: number; number: string | null; title: string } | null;
  supersededBy: { id: number; number: string | null; title: string } | null;
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

export const resolutionsApi = {
  list: (filters: { status?: string; category?: string; search?: string } = {}) => {
    const q = new URLSearchParams();
    if (filters.status && filters.status !== "all") q.set("status", filters.status);
    if (filters.category && filters.category !== "all") q.set("category", filters.category);
    if (filters.search) q.set("search", filters.search);
    const qs = q.toString();
    return jfetch<ResolutionListItem[]>(`/api/resolutions${qs ? `?${qs}` : ""}`);
  },
  get: (id: number) => jfetch<ResolutionDetail>(`/api/resolutions/${id}`),
  create: (body: {
    title: string; body?: string; category: ResolutionCategory;
    votingRule?: VotingRule; closesAt?: string | null;
    supersedesResolutionId?: number;
  }) => jfetch<{ id: number; motionId: number }>(`/api/resolutions`, {
    method: "POST", body: JSON.stringify(body),
  }),
  supersede: (id: number, targetResolutionId: number) =>
    jfetch<{ ok: true }>(`/api/resolutions/${id}/supersede`, {
      method: "POST", body: JSON.stringify({ targetResolutionId }),
    }),
  rescind: (id: number, body: { reason: string; votingRule?: VotingRule; closesAt?: string | null }) =>
    jfetch<{ motionId: number }>(`/api/resolutions/${id}/rescind`, {
      method: "POST", body: JSON.stringify(body),
    }),
  setVisibility: (id: number, isPublic: boolean) =>
    jfetch<{ ok: true; public: boolean }>(`/api/resolutions/${id}/visibility`, {
      method: "PATCH", body: JSON.stringify({ public: isPublic }),
    }),
  pdfUrl: (id: number) => `${BASE}/api/resolutions/${id}/pdf`,
};

export const RESOLUTION_STATUS_LABELS: Record<string, { label: string; bg: string; fg: string }> = {
  draft:      { label: "Draft",      bg: "#EEF1F8", fg: "#5A6280" },
  adopted:    { label: "Adopted",    bg: "#DCF3EC", fg: "#0E8A6B" },
  superseded: { label: "Superseded", bg: "#FFEFD0", fg: "#9A6500" },
  rescinded:  { label: "Rescinded",  bg: "#FBE3E9", fg: "#B8264C" },
  rejected:   { label: "Rejected",   bg: "#EFF1F8", fg: "#5B6478" },
};

export const RESOLUTION_CATEGORY_LABELS: Record<ResolutionCategory, string> = {
  architectural: "Architectural",
  financial: "Financial",
  rules: "Rules",
  personnel: "Personnel",
  emergency: "Emergency",
  other: "Other",
};
