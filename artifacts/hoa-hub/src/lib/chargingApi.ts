const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function jfetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type ChargingPort = {
  id: number; amenityId: number; name: string; location: string;
  connectorType: "J1772" | "CCS" | "NACS" | "CHAdeMO";
  maxKw: number;
  mode: "reserved" | "fcfs" | "reserved_fcfs";
  provider: "manual" | "stub_http" | "ocpp16";
  providerConfig?: Record<string, string | boolean | number> | null;
  perKwhCents: number; idlePerMinuteCents: number; idleGraceMinutes: number;
  idleCapCents: number; noShowFeeCents: number; noShowGraceMinutes: number;
  enabled: boolean; sortOrder: number;
  createdAt: string; updatedAt: string;
};

export type ChargingReservation = {
  id: number; portId: number; ownerUserId: number; unitId: string | null;
  startsAt: string; endsAt: string;
  status: "pending" | "active" | "completed" | "cancelled" | "no_show";
  sessionId: number | null; cancelledAt: string | null;
  createdAt: string; updatedAt: string;
};

export type ChargingSession = {
  id: number; portId: number; reservationId: number | null;
  ownerUserId: number; unitId: string | null;
  startAt: string; endAt: string | null; scheduledEndAt: string | null;
  kwh: number; meterStartKwh: number | null; meterEndKwh: number | null;
  energyCostCents: number; idleMinutes: number; idleCostCents: number; costCents: number;
  status: "active" | "stopped" | "billed" | "refunded" | "cancelled";
  providerSessionRef: string | null;
  ledgerEntryId: number | null; refundLedgerEntryId: number | null; refundReason: string | null;
  createdAt: string; updatedAt: string;
};

export type PortStatus = {
  port: ChargingPort;
  liveStatus: "available" | "in_use" | "reserved_soon";
  activeSession: ChargingSession | null;
  nextReservation: ChargingReservation | null;
};

export type PortStats = {
  portId: number; totalSessions: number; totalKwh: number;
  totalRevenueCents: number; averageIdleMinutes: number;
  sessionsByDay: Array<{ date: string; count: number }>;
};

export const chargingApi = {
  listPorts: () => jfetch<ChargingPort[]>(`/api/charging/ports`),
  createPort: (body: Partial<ChargingPort>) =>
    jfetch<ChargingPort>(`/api/charging/ports`, { method: "POST", body: JSON.stringify(body) }),
  updatePort: (id: number, body: Partial<ChargingPort>) =>
    jfetch<ChargingPort>(`/api/charging/ports/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deletePort: (id: number) =>
    jfetch<void>(`/api/charging/ports/${id}`, { method: "DELETE" }),
  portStatus: (id: number) => jfetch<PortStatus>(`/api/charging/ports/${id}/status`),
  portStats: (id: number) => jfetch<PortStats>(`/api/charging/ports/${id}/stats`),
  availability: (id: number, from: string, to: string) =>
    jfetch<{ portId: number; reservations: ChargingReservation[] }>(
      `/api/charging/ports/${id}/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  createReservation: (portId: number, body: { startsAt: string; endsAt: string; ownerUserId?: number; unitId?: string }) =>
    jfetch<ChargingReservation>(`/api/charging/ports/${portId}/reservations`, {
      method: "POST", body: JSON.stringify(body),
    }),
  cancelReservation: (id: number) =>
    jfetch<ChargingReservation>(`/api/charging/reservations/${id}/cancel`, { method: "POST" }),
  myReservations: () => jfetch<ChargingReservation[]>(`/api/charging/reservations/me`),
  startSession: (portId: number, body?: { ownerUserId?: number; unitId?: string; scheduledEndAt?: string }) =>
    jfetch<ChargingSession>(`/api/charging/ports/${portId}/sessions`, {
      method: "POST", body: JSON.stringify(body ?? {}),
    }),
  stopSession: (id: number) =>
    jfetch<ChargingSession>(`/api/charging/sessions/${id}/stop`, { method: "POST" }),
  manualReadings: (id: number, body: { kwh?: number; meterEndKwh?: number; endAt?: string }) =>
    jfetch<ChargingSession>(`/api/charging/sessions/${id}/manual-readings`, {
      method: "POST", body: JSON.stringify(body),
    }),
  refundSession: (id: number, body: { amountCents?: number; reason?: string }) =>
    jfetch<ChargingSession>(`/api/charging/sessions/${id}/refund`, {
      method: "POST", body: JSON.stringify(body),
    }),
  mySessions: () => jfetch<ChargingSession[]>(`/api/charging/sessions/me`),
  listSessions: (status?: string) =>
    jfetch<ChargingSession[]>(`/api/charging/sessions${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  getSession: (id: number) =>
    jfetch<{ session: ChargingSession; samples: Array<{ id: number; sampledAt: string; kwh: number; powerKw: number | null }> }>(
      `/api/charging/sessions/${id}`,
    ),
  csvUrl: () => `${BASE}/api/charging/sessions/me/csv`,
};
