export const ACC_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type AccStatus =
  | "submitted"
  | "in_review"
  | "more_info_needed"
  | "approved"
  | "approved_with_conditions"
  | "denied"
  | "withdrawn";

export interface AccRequest {
  id: number;
  unitId: string;
  building: number;
  ownerUserId: number;
  ownerName: string;
  projectType: string;
  title: string;
  description: string;
  contractorName: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  acknowledgedGuidelines: boolean;
  status: AccStatus;
  submittedAt: string;
  decidedAt: string | null;
  decisionText: string | null;
  conditionsText: string | null;
  decisionLetterStorageKey: string | null;
  autoApprovalFlagged: boolean;
  autoApprovalFlaggedAt: string | null;
  resolutionId: number | null;
  resolutionNumber: string | null;
  resolutionTitle: string | null;
  resolutionStatus: "adopted" | "superseded" | "rescinded" | null;
}

export interface AccEvent {
  id: number;
  requestId: number;
  type: string;
  authorUserId: number | null;
  authorName: string;
  authorRole: string | null;
  body: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  voteValue: string | null;
  createdAt: string;
}

export interface AccAttachment {
  id: number;
  requestId: number;
  name: string;
  size: number;
  contentType: string | null;
  storageKey: string;
  kind: string;
  uploadedByUserId: number;
  uploadedByName: string;
  uploadedAt: string;
}

export interface AccDetail extends AccRequest {
  events: AccEvent[];
  attachments: AccAttachment[];
}

export async function accFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ACC_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${errBody}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const PROJECT_TYPES = [
  "Paint / Exterior color",
  "Fence",
  "Roof / Roofing material",
  "Landscaping / Hardscape",
  "Patio / Deck",
  "Window / Door replacement",
  "Solar panels",
  "Pool / Spa",
  "Other exterior modification",
] as const;

export async function uploadAccFile(file: File): Promise<{ name: string; storageKey: string; size: number; contentType: string }> {
  const reqRes = await fetch(`${ACC_BASE}/api/architectural-requests/upload-url`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
  });
  if (!reqRes.ok) throw new Error("Upload URL request failed");
  const { uploadURL, objectPath } = await reqRes.json() as { uploadURL: string; objectPath: string };
  const put = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
  if (!put.ok) throw new Error("Upload failed");
  return { name: file.name, storageKey: objectPath, size: file.size, contentType: file.type };
}

export const STATUS_META: Record<AccStatus, { label: string; bg: string; fg: string }> = {
  submitted:               { label: "Submitted",        bg: "#E5E8FF", fg: "#3245FF" },
  in_review:               { label: "In Review",        bg: "#FBEFD6", fg: "#A66C0E" },
  more_info_needed:        { label: "More Info Needed", bg: "#FBE3E9", fg: "#B8264C" },
  approved:                { label: "Approved",         bg: "#DCF3EC", fg: "#0E8A6B" },
  approved_with_conditions:{ label: "Approved (Cond.)", bg: "#DCF3EC", fg: "#0E8A6B" },
  denied:                  { label: "Denied",           bg: "#FBE3E9", fg: "#B8264C" },
  withdrawn:               { label: "Withdrawn",        bg: "#EFF1F8", fg: "#5A6285" },
};
