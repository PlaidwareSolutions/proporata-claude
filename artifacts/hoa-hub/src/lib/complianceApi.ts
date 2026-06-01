// Task #100: Thin client wrappers for the /compliance/* CRUD endpoints
// (compliance items, violations, hearings). Server materializes calendar
// events on every save.
const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

async function jfetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
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

export interface ComplianceItem {
  id: number;
  kind: "tax" | "audit" | "insurance" | "regulatory" | "other";
  title: string;
  description: string;
  dueDate: string;
  recurrence: unknown | null;
  status: "open" | "in_progress" | "done";
  ownerUserId: number | null;
  reminderLeadsMinutes: number[] | null;
  notes: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Violation {
  id: number;
  unitId: string;
  ownerUserId: number | null;
  ownerName: string | null;
  category: string;
  description: string;
  status: "open" | "noticed" | "hearing" | "resolved" | "dismissed";
  observedAt: string;
  firstNoticeDate: string | null;
  cureDeadline: string | null;
  secondNoticeDate: string | null;
  hearingDate: string | null;
  fineCents: number;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Hearing {
  id: number;
  kind: "violation" | "appeal" | "executive_session" | "other";
  refType: string | null;
  refId: number | null;
  title: string;
  scheduledAt: string;
  locationText: string | null;
  locationUrl: string | null;
  noticeDate: string | null;
  status: "scheduled" | "held" | "cancelled" | "rescheduled";
  outcome: string | null;
  createdAt: string;
  updatedAt: string;
}

export const complianceApi = {
  listItems: () => jfetch<ComplianceItem[]>("/compliance/items"),
  createItem: (b: Partial<ComplianceItem>) =>
    jfetch<ComplianceItem>("/compliance/items", { method: "POST", body: JSON.stringify(b) }),
  updateItem: (id: number, b: Partial<ComplianceItem>) =>
    jfetch<ComplianceItem>(`/compliance/items/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteItem: (id: number) => jfetch<void>(`/compliance/items/${id}`, { method: "DELETE" }),

  listViolations: () => jfetch<Violation[]>("/compliance/violations"),
  createViolation: (b: Partial<Violation>) =>
    jfetch<Violation>("/compliance/violations", { method: "POST", body: JSON.stringify(b) }),
  updateViolation: (id: number, b: Partial<Violation>) =>
    jfetch<Violation>(`/compliance/violations/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteViolation: (id: number) =>
    jfetch<void>(`/compliance/violations/${id}`, { method: "DELETE" }),

  listHearings: () => jfetch<Hearing[]>("/compliance/hearings"),
  createHearing: (b: Partial<Hearing>) =>
    jfetch<Hearing>("/compliance/hearings", { method: "POST", body: JSON.stringify(b) }),
  updateHearing: (id: number, b: Partial<Hearing>) =>
    jfetch<Hearing>(`/compliance/hearings/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteHearing: (id: number) =>
    jfetch<void>(`/compliance/hearings/${id}`, { method: "DELETE" }),
};
