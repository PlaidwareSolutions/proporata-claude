// Task #66: Owner-facing Board section API client.
// Mirrors resolutionsApi.ts (direct fetch, no codegen).

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function jfetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface BoardResolution {
  id: number;
  number: string | null;
  category: string;
  title: string;
  body: string;
  adoptedAt: string | null;
  status: "adopted" | "superseded" | "rescinded";
  pdfAvailable: boolean;
  votingRuleDescription: string;
}

export interface BoardMeetingListItem {
  id: number;
  kind: "open" | "annual" | "executive";
  title: string;
  scheduledAt: string;
  durationMinutes: number;
  locationPhysical: string | null;
  locationVideoLink: string | null;
  status: string;
  noticePostedAt: string | null;
  minutesStatus: string;
  minutesAdoptedAt: string | null;
}

export interface BoardComment {
  id: number;
  ownerName: string;
  unitId: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  mine: boolean;
}

export interface BoardAgendaItem {
  id: number;
  sortOrder: number;
  kind: string;
  title: string;
  notes: string | null;
  presenter: string | null;
  itemMinutes: string | null;
  comments: BoardComment[];
}

export interface BoardMeetingDetail {
  id: number;
  kind: "open" | "annual" | "executive";
  title: string;
  scheduledAt: string;
  durationMinutes: number;
  locationPhysical: string | null;
  locationVideoLink: string | null;
  noticeText: string;
  noticePostedAt: string | null;
  status: string;
  startedAt: string | null;
  adjournedAt: string | null;
  minutesStatus: string;
  minutesAdoptedAt: string | null;
  agendaPacketAvailable: boolean;
  minutesPdfAvailable: boolean;
  agenda: BoardAgendaItem[];
}

export interface BoardNotice {
  id: number;
  kind: "meeting_scheduled" | "agenda_published" | "minutes_adopted" | "resolution_adopted";
  title: string;
  body: string;
  sourceType: "meeting" | "resolution";
  sourceId: number;
  meetingId: number | null;
  postedAt: string;
  requiredWindowDays: number | null;
}

export const boardApi = {
  listResolutions: () => jfetch<BoardResolution[]>("/api/me/board/resolutions"),
  resolutionPdfUrl: (id: number) => `${BASE}/api/me/board/resolutions/${id}/pdf`,
  listMeetings: (range: "all" | "upcoming" | "past" = "all") =>
    jfetch<BoardMeetingListItem[]>(`/api/me/board/meetings?range=${range}`),
  getMeeting: (id: number) => jfetch<BoardMeetingDetail>(`/api/me/board/meetings/${id}`),
  meetingAgendaPacketUrl: (id: number) => `${BASE}/api/me/board/meetings/${id}/agenda-packet.pdf`,
  meetingMinutesUrl: (id: number) => `${BASE}/api/me/board/meetings/${id}/minutes.pdf`,
  postComment: (meetingId: number, itemId: number, body: string) =>
    jfetch<BoardComment>(`/api/me/board/meetings/${meetingId}/agenda/${itemId}/comments`, {
      method: "POST", body: JSON.stringify({ body }),
    }),
  editComment: (meetingId: number, itemId: number, commentId: number, body: string) =>
    jfetch<{ ok: true }>(`/api/me/board/meetings/${meetingId}/agenda/${itemId}/comments/${commentId}`, {
      method: "PATCH", body: JSON.stringify({ body }),
    }),
  deleteComment: (meetingId: number, itemId: number, commentId: number) =>
    jfetch<void>(`/api/me/board/meetings/${meetingId}/agenda/${itemId}/comments/${commentId}`, {
      method: "DELETE",
    }),
  listNotices: () => jfetch<BoardNotice[]>("/api/me/board/notices"),
};

export const NOTICE_KIND_LABELS: Record<BoardNotice["kind"], string> = {
  meeting_scheduled: "Meeting scheduled",
  agenda_published: "Agenda published",
  minutes_adopted: "Minutes adopted",
  resolution_adopted: "Resolution adopted",
};
