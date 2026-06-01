// OCPP 1.6-J adapter for commercial EV chargers (JuiceBox, ChargePoint, EVBox,
// etc). Implements the CSMS side of the OCPP-J 1.6 wire protocol over a
// WebSocket the platform opens out to a per-port endpoint URL configured by
// the admin.
//
// Wire framing (OCPP-J):
//   CALL        [2, "<msgId>", "<Action>",      <payload>]
//   CALLRESULT  [3, "<msgId>", <payload>]
//   CALLERROR   [4, "<msgId>", "<errorCode>", "<errorDescription>", {<details>}]
//
// We act as the Central System: charger-initiated CALLs (BootNotification,
// Heartbeat, StatusNotification, Authorize, StartTransaction, MeterValues,
// StopTransaction) are answered automatically; we initiate
// RemoteStartTransaction / RemoteStopTransaction for session control.
//
// MeterValues' Energy.Active.Import.Register is read as the cumulative meter
// (Wh by default) and the per-session kWh delivered is computed as
// (current - meterStart) / 1000.

import WebSocket from "ws";
import type { ChargingPort } from "@workspace/db/schema";
import type { MeteredAmenityProvider, ProviderStartContext, ProviderUsageSnapshot } from "./meteredAmenity.js";
import { logger } from "./logger.js";

interface OcppPortConfig {
  endpointUrl: string;
  chargePointId: string;
  username?: string;
  password?: string;
  connectorId: number;
}

interface SessionState {
  idTag: string;
  connectorId: number;
  transactionId: number | null;
  meterStartWh: number | null;
  meterCurrentWh: number | null;
  powerKw: number | null;
  status: "active" | "stopped";
  endedAt: string | null;
  startedAt: number;
}

interface PortConnection {
  port: ChargingPort;
  cfg: OcppPortConfig;
  ws: WebSocket | null;
  connecting: Promise<void> | null;
  pending: Map<string, { resolve: (payload: unknown) => void; reject: (err: Error) => void; timeout: NodeJS.Timeout }>;
  sessionsByIdTag: Map<string, SessionState>;
  sessionsByTxnId: Map<number, SessionState>;
  reconnectTimer: NodeJS.Timeout | null;
  closed: boolean;
  lastBootAt: number | null;
}

function readConfig(port: ChargingPort): OcppPortConfig | null {
  const raw = (port.providerConfig ?? {}) as Record<string, unknown>;
  const endpointUrl = typeof raw.endpointUrl === "string" ? raw.endpointUrl.trim() : "";
  const chargePointId = typeof raw.chargePointId === "string" ? raw.chargePointId.trim() : "";
  if (!endpointUrl || !chargePointId) return null;
  const username = typeof raw.username === "string" && raw.username ? raw.username : undefined;
  const password = typeof raw.password === "string" && raw.password ? raw.password : undefined;
  const connectorIdNum = Number(raw.connectorId);
  const connectorId = Number.isFinite(connectorIdNum) && connectorIdNum > 0 ? Math.floor(connectorIdNum) : 1;
  return { endpointUrl, chargePointId, username, password, connectorId };
}

function buildUrl(cfg: OcppPortConfig): string {
  const base = cfg.endpointUrl.replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(cfg.chargePointId)}`;
}

function authHeader(cfg: OcppPortConfig): Record<string, string> | undefined {
  if (!cfg.username && !cfg.password) return undefined;
  const token = Buffer.from(`${cfg.username ?? ""}:${cfg.password ?? ""}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

const connections = new Map<number, PortConnection>();
let msgCounter = 0;
function nextMsgId(): string {
  msgCounter = (msgCounter + 1) & 0x7fffffff;
  return `m${Date.now().toString(36)}-${msgCounter.toString(36)}`;
}

function getOrCreateConn(port: ChargingPort): PortConnection | null {
  const cfg = readConfig(port);
  if (!cfg) return null;
  const existing = connections.get(port.id);
  if (existing) {
    existing.port = port;
    existing.cfg = cfg;
    return existing;
  }
  const conn: PortConnection = {
    port,
    cfg,
    ws: null,
    connecting: null,
    pending: new Map(),
    sessionsByIdTag: new Map(),
    sessionsByTxnId: new Map(),
    reconnectTimer: null,
    closed: false,
    lastBootAt: null,
  };
  connections.set(port.id, conn);
  return conn;
}

async function ensureConnected(conn: PortConnection): Promise<void> {
  if (conn.ws && conn.ws.readyState === WebSocket.OPEN) return;
  if (conn.connecting) return conn.connecting;
  const url = buildUrl(conn.cfg);
  const headers = authHeader(conn.cfg);
  conn.connecting = new Promise<void>((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(url, ["ocpp1.6"], headers ? { headers } : undefined);
    conn.ws = ws;
    const onOpen = () => {
      if (settled) return;
      settled = true;
      conn.connecting = null;
      logger.info({ portId: conn.port.id, endpoint: conn.cfg.endpointUrl }, "OCPP WS connected");
      resolve();
    };
    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      conn.connecting = null;
      logger.error({ portId: conn.port.id, err: err.message }, "OCPP WS connect failed");
      reject(err);
    };
    ws.on("open", onOpen);
    ws.on("error", onError);
    ws.on("message", (data) => handleMessage(conn, data.toString()));
    ws.on("close", (code, reason) => {
      logger.warn({ portId: conn.port.id, code, reason: reason.toString() }, "OCPP WS closed");
      conn.ws = null;
      // Reject any in-flight calls so callers don't hang.
      for (const [, p] of conn.pending) {
        clearTimeout(p.timeout);
        p.reject(new Error("OCPP connection closed"));
      }
      conn.pending.clear();
      if (!conn.closed) scheduleReconnect(conn);
    });
  });
  return conn.connecting;
}

function scheduleReconnect(conn: PortConnection): void {
  if (conn.reconnectTimer || conn.closed) return;
  conn.reconnectTimer = setTimeout(() => {
    conn.reconnectTimer = null;
    ensureConnected(conn).catch(() => {/* will retry on next call */});
  }, 15_000);
}

function sendCall(conn: PortConnection, action: string, payload: unknown, timeoutMs = 30_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = conn.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error("OCPP not connected"));
      return;
    }
    const msgId = nextMsgId();
    const timeout = setTimeout(() => {
      conn.pending.delete(msgId);
      reject(new Error(`OCPP ${action} timed out`));
    }, timeoutMs);
    conn.pending.set(msgId, { resolve, reject, timeout });
    const frame = JSON.stringify([2, msgId, action, payload]);
    ws.send(frame, (err) => {
      if (err) {
        clearTimeout(timeout);
        conn.pending.delete(msgId);
        reject(err);
      }
    });
  });
}

function sendResult(conn: PortConnection, msgId: string, payload: unknown): void {
  const ws = conn.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify([3, msgId, payload]));
}

function sendError(conn: PortConnection, msgId: string, code: string, description: string): void {
  const ws = conn.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify([4, msgId, code, description, {}]));
}

function handleMessage(conn: PortConnection, raw: string): void {
  let frame: unknown;
  try { frame = JSON.parse(raw); } catch {
    logger.warn({ portId: conn.port.id, raw }, "OCPP non-JSON frame");
    return;
  }
  if (!Array.isArray(frame) || frame.length < 3) return;
  const [type, msgId, ...rest] = frame as [number, string, ...unknown[]];
  if (type === 2) {
    const action = rest[0] as string;
    const payload = (rest[1] ?? {}) as Record<string, unknown>;
    handleIncomingCall(conn, msgId, action, payload);
  } else if (type === 3) {
    const pending = conn.pending.get(msgId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    conn.pending.delete(msgId);
    pending.resolve(rest[0]);
  } else if (type === 4) {
    const pending = conn.pending.get(msgId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    conn.pending.delete(msgId);
    pending.reject(new Error(`OCPP error ${String(rest[0])}: ${String(rest[1])}`));
  }
}

function nowIso(): string { return new Date().toISOString(); }

function handleIncomingCall(
  conn: PortConnection,
  msgId: string,
  action: string,
  payload: Record<string, unknown>,
): void {
  switch (action) {
    case "BootNotification": {
      conn.lastBootAt = Date.now();
      sendResult(conn, msgId, { status: "Accepted", currentTime: nowIso(), interval: 300 });
      return;
    }
    case "Heartbeat": {
      sendResult(conn, msgId, { currentTime: nowIso() });
      return;
    }
    case "StatusNotification": {
      sendResult(conn, msgId, {});
      return;
    }
    case "Authorize": {
      const idTag = String(payload.idTag ?? "");
      const accepted = conn.sessionsByIdTag.has(idTag);
      sendResult(conn, msgId, { idTagInfo: { status: accepted ? "Accepted" : "Invalid" } });
      return;
    }
    case "StartTransaction": {
      const idTag = String(payload.idTag ?? "");
      const meterStartWh = Number(payload.meterStart ?? 0);
      const transactionId = Math.floor(Date.now() / 1000) & 0x7fffffff;
      const sess = conn.sessionsByIdTag.get(idTag);
      if (sess) {
        sess.transactionId = transactionId;
        sess.meterStartWh = Number.isFinite(meterStartWh) ? meterStartWh : 0;
        sess.meterCurrentWh = sess.meterStartWh;
        conn.sessionsByTxnId.set(transactionId, sess);
      }
      sendResult(conn, msgId, { transactionId, idTagInfo: { status: "Accepted" } });
      return;
    }
    case "MeterValues": {
      const txnId = Number(payload.transactionId ?? NaN);
      const sess = Number.isFinite(txnId) ? conn.sessionsByTxnId.get(txnId) : undefined;
      if (sess) {
        const mvs = (payload.meterValue as Array<Record<string, unknown>> | undefined) ?? [];
        for (const mv of mvs) {
          const samples = (mv.sampledValue as Array<Record<string, unknown>> | undefined) ?? [];
          for (const s of samples) {
            const measurand = String(s.measurand ?? "Energy.Active.Import.Register");
            const unit = String(s.unit ?? "Wh");
            const value = Number(s.value);
            if (!Number.isFinite(value)) continue;
            if (measurand === "Energy.Active.Import.Register") {
              const wh = unit === "kWh" ? value * 1000 : value;
              sess.meterCurrentWh = wh;
            } else if (measurand === "Power.Active.Import") {
              sess.powerKw = unit === "W" ? value / 1000 : value;
            }
          }
        }
      }
      sendResult(conn, msgId, {});
      return;
    }
    case "StopTransaction": {
      const txnId = Number(payload.transactionId ?? NaN);
      const meterStop = Number(payload.meterStop ?? NaN);
      const sess = Number.isFinite(txnId) ? conn.sessionsByTxnId.get(txnId) : undefined;
      if (sess) {
        if (Number.isFinite(meterStop)) sess.meterCurrentWh = meterStop;
        sess.status = "stopped";
        sess.endedAt = nowIso();
      }
      sendResult(conn, msgId, { idTagInfo: { status: "Accepted" } });
      return;
    }
    case "DataTransfer": {
      sendResult(conn, msgId, { status: "Accepted" });
      return;
    }
    default:
      sendError(conn, msgId, "NotImplemented", `Action ${action} not implemented`);
      return;
  }
}

function snapshotFor(sess: SessionState): ProviderUsageSnapshot {
  const start = sess.meterStartWh ?? 0;
  const cur = sess.meterCurrentWh ?? start;
  const kwh = Math.max(0, +(((cur - start) / 1000)).toFixed(4));
  return {
    kwh,
    powerKw: sess.powerKw,
    status: sess.status,
    finalKwh: sess.status === "stopped" ? kwh : null,
    endedAt: sess.endedAt,
  };
}

class Ocpp16Provider implements MeteredAmenityProvider {
  readonly id = "ocpp16";

  async startSession(ctx: ProviderStartContext): Promise<{ providerSessionRef: string | null; meterStartKwh: number | null }> {
    const conn = getOrCreateConn(ctx.port);
    if (!conn) throw new Error("OCPP provider is not configured (need endpointUrl + chargePointId)");
    const idTag = `hoa-${ctx.port.id}-${Date.now()}`;
    const sess: SessionState = {
      idTag,
      connectorId: conn.cfg.connectorId,
      transactionId: null,
      meterStartWh: null,
      meterCurrentWh: null,
      powerKw: null,
      status: "active",
      endedAt: null,
      startedAt: Date.now(),
    };
    conn.sessionsByIdTag.set(idTag, sess);
    try {
      await ensureConnected(conn);
      const result = await sendCall(conn, "RemoteStartTransaction", {
        connectorId: conn.cfg.connectorId,
        idTag,
      }) as { status?: string };
      if (!result || result.status !== "Accepted") {
        conn.sessionsByIdTag.delete(idTag);
        throw new Error(`Charger rejected RemoteStartTransaction: ${result?.status ?? "unknown"}`);
      }
    } catch (err) {
      conn.sessionsByIdTag.delete(idTag);
      throw err;
    }
    return { providerSessionRef: idTag, meterStartKwh: 0 };
  }

  async pollUsage(providerSessionRef: string | null, port: ChargingPort): Promise<ProviderUsageSnapshot> {
    if (!providerSessionRef) return { kwh: 0, powerKw: null, status: "active" };
    const conn = getOrCreateConn(port);
    if (!conn) return { kwh: 0, powerKw: null, status: "active" };
    // Make sure the WS is healthy so the charger can keep pushing MeterValues.
    ensureConnected(conn).catch(() => {/* logged in caller */});
    const sess = conn.sessionsByIdTag.get(providerSessionRef);
    if (!sess) return { kwh: 0, powerKw: null, status: "active" };
    return snapshotFor(sess);
  }

  async stopSession(providerSessionRef: string | null, port: ChargingPort): Promise<{ finalKwh: number | null; endedAt: string }> {
    const conn = providerSessionRef ? getOrCreateConn(port) : null;
    if (!conn || !providerSessionRef) return { finalKwh: null, endedAt: nowIso() };
    const sess = conn.sessionsByIdTag.get(providerSessionRef);
    if (!sess) return { finalKwh: null, endedAt: nowIso() };
    if (sess.transactionId != null && sess.status !== "stopped") {
      try {
        await ensureConnected(conn);
        await sendCall(conn, "RemoteStopTransaction", { transactionId: sess.transactionId });
      } catch (err) {
        logger.error({ portId: port.id, err: err instanceof Error ? err.message : String(err) }, "RemoteStopTransaction failed");
      }
    }
    // Give the charger a brief window to send StopTransaction with final meter.
    const deadline = Date.now() + 5_000;
    while (sess.status !== "stopped" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
    sess.status = "stopped";
    sess.endedAt = sess.endedAt ?? nowIso();
    const snap = snapshotFor(sess);
    // Clean up local maps so a reused idTag/transactionId doesn't ghost state.
    conn.sessionsByIdTag.delete(sess.idTag);
    if (sess.transactionId != null) conn.sessionsByTxnId.delete(sess.transactionId);
    return { finalKwh: snap.kwh, endedAt: sess.endedAt };
  }
}

export const ocpp16Provider: MeteredAmenityProvider = new Ocpp16Provider();

// Test-only / shutdown helper.
export function shutdownAllOcppConnections(): void {
  for (const conn of connections.values()) {
    conn.closed = true;
    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
    if (conn.ws) try { conn.ws.close(); } catch { /* ignore */ }
  }
  connections.clear();
}
