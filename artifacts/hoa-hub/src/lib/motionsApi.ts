const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type VotingRule =
  | { type: "unanimous" }
  | { type: "majority" }
  | { type: "supermajority"; threshold: number }
  | { type: "single_approver" }
  | { type: "quorum_only"; quorum: number };

export interface MotionListItem {
  id: number;
  kind: string;
  title: string;
  status: string;
  outcome: string | null;
  createdByName: string;
  createdAt: string;
  openedAt: string | null;
  closesAt: string | null;
  resolvedAt: string | null;
  votingRule: VotingRule;
  votingRuleDescription: string;
  tally: { approve: number; reject: number; abstain: number; total: number };
  needed: number | null;
  boardMemberCount: number;
  memberCount: number;
  memberInGoodStandingCount: number;
  audience: "board" | "members";
  canVote: boolean;
  myVote?: string | null;
}

export interface MotionDetail extends MotionListItem {
  body: string;
  bodyHash: string | null;
  createdByUserId: number | null;
  payload: unknown;
  finalizable: boolean;
  canVote: boolean;
  votes: Array<{
    id: number; userId: number; userName: string; decision: string;
    comment: string | null; createdAt: string; bodyHashAtVote: string | null;
  }>;
  attachments: Array<{
    id: number; name: string; size: number; contentType: string | null;
    storageKey: string; uploadedByName: string; uploadedAt: string;
  }>;
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

export const motionsApi = {
  list: (status?: string) =>
    jfetch<MotionListItem[]>(`/api/motions${status && status !== "all" ? `?status=${encodeURIComponent(status)}` : ""}`),
  get: (id: number) => jfetch<MotionDetail>(`/api/motions/${id}`),
  create: (body: { kind?: string; title: string; body?: string; votingRule: VotingRule; closesAt?: string | null }) =>
    jfetch<{ id: number }>(`/api/motions`, { method: "POST", body: JSON.stringify(body) }),
  open: (id: number, closesAt?: string | null) =>
    jfetch<{ ok: true }>(`/api/motions/${id}/open`, { method: "POST", body: JSON.stringify({ closesAt: closesAt ?? null }) }),
  vote: (id: number, decision: "approve" | "reject" | "abstain", comment?: string | null) =>
    jfetch<{ ok: true; finalized: boolean; outcome: string | null }>(
      `/api/motions/${id}/votes`, { method: "POST", body: JSON.stringify({ decision, comment: comment ?? null }) }),
  withdraw: (id: number) =>
    jfetch<{ ok: true }>(`/api/motions/${id}/withdraw`, { method: "POST" }),
  pdfUrl: (id: number) => `${BASE}/api/motions/${id}/pdf`,
};

export const MOTION_STATUS_LABELS: Record<string, { label: string; bg: string; fg: string }> = {
  draft:     { label: "Draft",     bg: "#EEF1F8", fg: "#5A6280" },
  open:      { label: "Open",      bg: "#DCEAFE", fg: "#1A4FBF" },
  adopted:   { label: "Adopted",   bg: "#DCF3EC", fg: "#0E8A6B" },
  rejected:  { label: "Rejected",  bg: "#FBE3E9", fg: "#B8264C" },
  withdrawn: { label: "Withdrawn", bg: "#EFF1F8", fg: "#5B6478" },
  expired:   { label: "Expired",   bg: "#FFEFD0", fg: "#9A6500" },
};
