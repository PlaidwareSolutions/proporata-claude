// Task #100: Thin client wrappers for the /financial/* CRUD endpoints
// (assessment schedules, special assessments, budget cycles, reserve
// projects, collections policy). Each write round-trips through the
// calendar materializer on the server, so saving from the UI is enough
// to make events appear immediately.
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

export interface AssessmentSchedule {
  id: number;
  name: string;
  frequency: "monthly" | "quarterly" | "semiannual" | "annual";
  amountCents: number;
  dueDay: number;
  startDate: string;
  endDate: string | null;
  active: boolean;
  reminderLeadsMinutes: number[] | null;
  notes: string;
  calendarEventId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpecialAssessment {
  id: number;
  title: string;
  description: string;
  amountCents: number;
  status: "draft" | "noticed" | "adopted" | "billed" | "closed";
  noticeDate: string | null;
  hearingDate: string | null;
  hearingLocation: string | null;
  adoptionDate: string | null;
  billingDate: string | null;
  dueDate: string | null;
  motionId: number | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetCycle {
  id: number;
  fiscalYear: number;
  draftDueDate: string | null;
  reviewMeetingDate: string | null;
  ratificationMeetingDate: string | null;
  publicationDate: string | null;
  reserveStudyRefreshDate: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReserveProject {
  id: number;
  name: string;
  category: string;
  estimatedCostCents: number;
  fundingDate: string | null;
  bidWindowStart: string | null;
  bidWindowEnd: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  status: "planned" | "funded" | "in_progress" | "complete" | "deferred";
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionsPolicy {
  id: number;
  reminderDays: number;
  lateNoticeDays: number;
  demandLetterDays: number;
  lienDays: number;
  attorneyDays: number;
  active: boolean;
  updatedAt: string;
}

export const financialApi = {
  // assessment schedules
  listSchedules: () => jfetch<AssessmentSchedule[]>("/financial/assessment-schedules"),
  createSchedule: (b: Partial<AssessmentSchedule>) =>
    jfetch<AssessmentSchedule>("/financial/assessment-schedules", {
      method: "POST", body: JSON.stringify(b),
    }),
  updateSchedule: (id: number, b: Partial<AssessmentSchedule>) =>
    jfetch<AssessmentSchedule>(`/financial/assessment-schedules/${id}`, {
      method: "PATCH", body: JSON.stringify(b),
    }),
  deleteSchedule: (id: number) =>
    jfetch<void>(`/financial/assessment-schedules/${id}`, { method: "DELETE" }),

  // special assessments
  listSpecials: () => jfetch<SpecialAssessment[]>("/financial/special-assessments"),
  createSpecial: (b: Partial<SpecialAssessment>) =>
    jfetch<SpecialAssessment>("/financial/special-assessments", {
      method: "POST", body: JSON.stringify(b),
    }),
  updateSpecial: (id: number, b: Partial<SpecialAssessment>) =>
    jfetch<SpecialAssessment>(`/financial/special-assessments/${id}`, {
      method: "PATCH", body: JSON.stringify(b),
    }),
  deleteSpecial: (id: number) =>
    jfetch<void>(`/financial/special-assessments/${id}`, { method: "DELETE" }),

  // budget cycles
  listBudgets: () => jfetch<BudgetCycle[]>("/financial/budget-cycles"),
  createBudget: (b: Partial<BudgetCycle>) =>
    jfetch<BudgetCycle>("/financial/budget-cycles", {
      method: "POST", body: JSON.stringify(b),
    }),
  updateBudget: (id: number, b: Partial<BudgetCycle>) =>
    jfetch<BudgetCycle>(`/financial/budget-cycles/${id}`, {
      method: "PATCH", body: JSON.stringify(b),
    }),
  deleteBudget: (id: number) =>
    jfetch<void>(`/financial/budget-cycles/${id}`, { method: "DELETE" }),

  // reserve projects
  listReserves: () => jfetch<ReserveProject[]>("/financial/reserve-projects"),
  createReserve: (b: Partial<ReserveProject>) =>
    jfetch<ReserveProject>("/financial/reserve-projects", {
      method: "POST", body: JSON.stringify(b),
    }),
  updateReserve: (id: number, b: Partial<ReserveProject>) =>
    jfetch<ReserveProject>(`/financial/reserve-projects/${id}`, {
      method: "PATCH", body: JSON.stringify(b),
    }),
  deleteReserve: (id: number) =>
    jfetch<void>(`/financial/reserve-projects/${id}`, { method: "DELETE" }),

  // collections policy (singleton)
  getPolicy: () => jfetch<CollectionsPolicy>("/financial/collections-policy"),
  updatePolicy: (b: Partial<CollectionsPolicy>) =>
    jfetch<CollectionsPolicy>("/financial/collections-policy", {
      method: "PUT", body: JSON.stringify(b),
    }),
};
