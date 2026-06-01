const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface MeetingListItem {
  id: number;
  kind: "open" | "executive" | "annual";
  title: string;
  scheduledAt: string;
  status: "scheduled" | "in_progress" | "adjourned" | "cancelled";
  minutesStatus: "none" | "draft" | "proposed" | "adopted";
  durationMinutes: number;
  locationPhysical: string | null;
  locationVideoLink: string | null;
  noticePostedAt: string | null;
  quorum: { required: number; attending: number; met: boolean; boardSize: number; mode: string; percentBp: number };
  createdByName: string;
  createdAt: string;
}

export interface MeetingAgendaItem {
  id: number;
  sortOrder: number;
  kind: "discussion" | "motion" | "report" | "break";
  title: string;
  notes: string | null;
  motionId: number | null;
  presenter: string | null;
  itemMinutes: string;
  closedSession: boolean;
  motion: null | {
    id: number; kind: string; title: string; status: string; outcome: string | null;
    votingRule: unknown; votingRuleDescription: string;
    tally: { approve: number; reject: number; abstain: number };
    needed: number | null; finalizable: boolean;
  };
}

export interface MeetingAttendance {
  id: number; userId: number; userName: string;
  status: "present" | "remote" | "absent" | "excused";
  isBoardMember: boolean; recordedAt: string;
}

export interface MeetingDetail extends MeetingListItem {
  noticeText: string;
  noticeRequiredDays: number;
  noticeOk: boolean;
  startedAt: string | null;
  adjournedAt: string | null;
  minutesContent: string;
  minutesAdoptionMotionId: number | null;
  minutesAdoptedAt: string | null;
  agenda: MeetingAgendaItem[];
  attendance: MeetingAttendance[];
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

export const meetingsApi = {
  list: (status?: string) =>
    jfetch<MeetingListItem[]>(`/api/meetings${status && status !== "all" ? `?status=${encodeURIComponent(status)}` : ""}`),
  get: (id: number) => jfetch<MeetingDetail>(`/api/meetings/${id}`),
  create: (body: { kind: string; title: string; scheduledAt: string; durationMinutes?: number; locationPhysical?: string | null; locationVideoLink?: string | null; noticeText?: string }) =>
    jfetch<{ id: number }>(`/api/meetings`, { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, body: Record<string, unknown>) =>
    jfetch<MeetingDetail>(`/api/meetings/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  remove: (id: number) => jfetch<void>(`/api/meetings/${id}`, { method: "DELETE" }),
  postNotice: (id: number) => jfetch<MeetingDetail>(`/api/meetings/${id}/notice`, { method: "POST" }),
  start: (id: number) => jfetch<{ ok: true }>(`/api/meetings/${id}/start`, { method: "POST" }),
  adjourn: (id: number) => jfetch<{ ok: true }>(`/api/meetings/${id}/adjourn`, { method: "POST" }),
  addAgendaItem: (id: number, body: { kind?: string; title: string; notes?: string | null; motionId?: number | null; presenter?: string | null }) =>
    jfetch<{ id: number }>(`/api/meetings/${id}/agenda`, { method: "POST", body: JSON.stringify(body) }),
  updateAgendaItem: (id: number, itemId: number, body: Record<string, unknown>) =>
    jfetch<{ ok: true }>(`/api/meetings/${id}/agenda/${itemId}`, { method: "PATCH", body: JSON.stringify(body) }),
  removeAgendaItem: (id: number, itemId: number) =>
    jfetch<void>(`/api/meetings/${id}/agenda/${itemId}`, { method: "DELETE" }),
  reorderAgenda: (id: number, itemIds: number[]) =>
    jfetch<{ ok: true }>(`/api/meetings/${id}/agenda/reorder`, { method: "POST", body: JSON.stringify({ itemIds }) }),
  setAttendance: (id: number, userId: number, status: string) =>
    jfetch<{ ok: true; quorum: MeetingListItem["quorum"] }>(`/api/meetings/${id}/attendance`,
      { method: "POST", body: JSON.stringify({ userId, status }) }),
  proposeMinutes: (id: number, adoptionMeetingId: number) =>
    jfetch<{ ok: true; motionId: number }>(`/api/meetings/${id}/minutes/propose`,
      { method: "POST", body: JSON.stringify({ adoptionMeetingId }) }),
  agendaPacketUrl: (id: number) => `${BASE}/api/meetings/${id}/agenda-packet.pdf`,
  minutesPdfUrl: (id: number) => `${BASE}/api/meetings/${id}/minutes.pdf`,
  icsUrl: (id: number) => `${BASE}/api/meetings/${id}/ics`,
  getIcalToken: (rotate?: boolean) =>
    jfetch<{ token: string; url: string }>(`/api/me/ical-token`, { method: "POST", body: JSON.stringify({ rotate: !!rotate }) }),
};

export const MEETING_KIND_LABELS: Record<string, { label: string; bg: string; fg: string }> = {
  open:      { label: "Open",      bg: "#DCEAFE", fg: "#1A4FBF" },
  executive: { label: "Executive", bg: "#F3EEFF", fg: "#5A3FD9" },
  annual:    { label: "Annual",    bg: "#FFF4D0", fg: "#9A6500" },
};

export const MEETING_STATUS_LABELS: Record<string, { label: string; bg: string; fg: string }> = {
  scheduled:   { label: "Scheduled",   bg: "#EEF1F8", fg: "#5A6280" },
  in_progress: { label: "In Progress", bg: "#DCF3EC", fg: "#0E8A6B" },
  adjourned:   { label: "Adjourned",   bg: "#E5E8FF", fg: "#3245FF" },
  cancelled:   { label: "Cancelled",   bg: "#FBE3E9", fg: "#B8264C" },
};

export const MINUTES_STATUS_LABELS: Record<string, { label: string; bg: string; fg: string }> = {
  none:     { label: "—",        bg: "#F3F4F6", fg: "#64748B" },
  draft:    { label: "Draft",    bg: "#EEF1F8", fg: "#5A6280" },
  proposed: { label: "Proposed", bg: "#FFEFD0", fg: "#9A6500" },
  adopted:  { label: "Adopted",  bg: "#DCF3EC", fg: "#0E8A6B" },
};
