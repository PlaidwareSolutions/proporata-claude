import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetChargingSession,
  useGetChargingSessionAudit,
  useRefundChargingSession,
  getGetChargingSessionQueryKey,
  getGetChargingSessionAuditQueryKey,
} from "@workspace/api-client-react";
import { c } from "@/lib/theme";
import { X, Zap, Clock, DollarSign, RotateCcw, Activity } from "lucide-react";

function fmtUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function durationLabel(startAt: string, endAt: string | null | undefined): string {
  if (!endAt) return "in progress";
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  ended: "Ended",
  billed: "Billed",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

const ACTION_LABELS: Record<string, string> = {
  started: "Session started",
  stopped: "Session stopped",
  billed: "Posted to ledger",
  refunded: "Refunded",
  meter_start_recorded: "Meter start recorded",
  meter_end_recorded: "Meter end recorded",
};

export interface EvSessionDrawerProps {
  sessionId: number;
  /** Whether the viewer is a manager — controls whether sensitive admin links/actions are shown. */
  isManager?: boolean;
  onClose: () => void;
}

export function EvSessionDrawer({ sessionId, isManager, onClose }: EvSessionDrawerProps) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useGetChargingSession(sessionId);
  const { data: audit = [], isLoading: auditLoading } = useGetChargingSessionAudit(sessionId);
  const session = data?.session;
  const refundMut = useRefundChargingSession();
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundError, setRefundError] = useState<string | null>(null);

  async function submitRefund() {
    if (!session) return;
    setRefundError(null);
    try {
      await refundMut.mutateAsync({
        id: sessionId,
        data: { amountCents: session.costCents, reason: refundReason || undefined },
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetChargingSessionQueryKey(sessionId) }),
        qc.invalidateQueries({ queryKey: getGetChargingSessionAuditQueryKey(sessionId) }),
      ]);
      setRefundOpen(false);
      setRefundReason("");
    } catch (e) {
      setRefundError(e instanceof Error ? e.message : "Refund failed");
    }
  }

  const statusBg = session?.status === "refunded"
    ? c.cobaltSoft
    : session?.status === "billed"
      ? c.emeraldSoft
      : session?.status === "active"
        ? c.canvas
        : c.canvas;
  const statusFg = session?.status === "refunded"
    ? c.cobalt
    : session?.status === "billed"
      ? c.emerald
      : c.inkSoft;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" style={{ background: "rgba(15,21,48,0.4)" }} onClick={onClose}>
      <div
        className="h-full w-full max-w-xl overflow-y-auto"
        style={{ background: c.panel }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between px-5 py-4 border-b" style={{ background: c.panel, borderColor: c.border }}>
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4" style={{ color: c.cobalt }} />
            <div className="text-[15px]" style={{ fontWeight: 700 }}>EV charging session #{sessionId}</div>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        {isLoading && (
          <div className="p-8 text-center text-[13px]" style={{ color: c.inkMute }}>Loading session…</div>
        )}
        {error && (
          <div className="p-8 text-center text-[13px]" style={{ color: c.rose }}>
            Could not load session details.
          </div>
        )}

        {session && (
          <div className="p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11.5px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>
                  Total billed
                </div>
                <div className="text-[28px] mt-1 font-mono-num" style={{ fontWeight: 700, color: c.ink }}>
                  {fmtUsd(session.costCents)}
                </div>
              </div>
              <span
                className="text-[11px] px-2.5 py-1 rounded-full"
                style={{ background: statusBg, color: statusFg, fontWeight: 700 }}
              >
                {STATUS_LABELS[session.status] ?? session.status}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Stat icon={<Zap className="h-3.5 w-3.5" />} label="Energy delivered" value={`${session.kwh.toFixed(3)} kWh`} sub={fmtUsd(session.energyCostCents)} />
              <Stat
                icon={<Clock className="h-3.5 w-3.5" />}
                label="Idle time"
                value={`${session.idleMinutes} min`}
                sub={session.idleCostCents > 0 ? fmtUsd(session.idleCostCents) : "No idle fee"}
              />
              <Stat icon={<Activity className="h-3.5 w-3.5" />} label="Duration" value={durationLabel(session.startAt, session.endAt)} />
              <Stat icon={<DollarSign className="h-3.5 w-3.5" />} label="Total" value={fmtUsd(session.costCents)} sub={session.refundLedgerEntryId ? "Refunded" : undefined} />
            </div>

            <div className="rounded-xl border" style={{ borderColor: c.border }}>
              <div className="px-4 py-2.5 border-b text-[12.5px]" style={{ borderColor: c.border, fontWeight: 700 }}>
                Session details
              </div>
              <dl className="text-[12.5px] divide-y" style={{ borderColor: c.borderSoft }}>
                <Row label="Started" value={fmtDateTime(session.startAt)} />
                <Row label="Ended" value={fmtDateTime(session.endAt)} />
                {session.scheduledEndAt && <Row label="Scheduled end" value={fmtDateTime(session.scheduledEndAt)} />}
                {session.meterStartKwh != null && (
                  <Row label="Meter start" value={`${session.meterStartKwh.toFixed(3)} kWh`} />
                )}
                {session.meterEndKwh != null && (
                  <Row label="Meter end" value={`${session.meterEndKwh.toFixed(3)} kWh`} />
                )}
                <Row label="Port" value={`#${session.portId}`} />
                {session.unitId && <Row label="Unit" value={session.unitId} />}
              </dl>
            </div>

            {session.refundLedgerEntryId != null && (
              <div className="rounded-xl border p-3" style={{ borderColor: c.cobalt, background: c.cobaltSoft }}>
                <div className="flex items-center gap-1.5 text-[12.5px]" style={{ color: c.cobalt, fontWeight: 700 }}>
                  <RotateCcw className="h-3.5 w-3.5" /> Refunded
                </div>
                {session.refundReason && (
                  <div className="text-[12px] mt-1" style={{ color: c.inkSoft }}>
                    Reason: {session.refundReason}
                  </div>
                )}
                <div className="text-[11.5px] mt-1" style={{ color: c.inkMute }}>
                  Refund posted as ledger entry #{session.refundLedgerEntryId}.
                </div>
              </div>
            )}

            {isManager && session.status === "billed" && session.refundLedgerEntryId == null && (
              <div className="rounded-xl border p-3" style={{ borderColor: c.border }}>
                {!refundOpen ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[12.5px]" style={{ fontWeight: 700, color: c.ink }}>
                        Issue refund
                      </div>
                      <div className="text-[11.5px]" style={{ color: c.inkMute }}>
                        Reverses {fmtUsd(session.costCents)} on the owner's ledger.
                      </div>
                    </div>
                    <button
                      onClick={() => setRefundOpen(true)}
                      className="text-[12px] px-3 py-1.5 rounded-md border"
                      style={{ borderColor: c.cobalt, color: c.cobalt, fontWeight: 700 }}
                    >
                      <RotateCcw className="inline h-3 w-3 mr-1" /> Refund session
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-[12.5px]" style={{ fontWeight: 700, color: c.ink }}>
                      Refund {fmtUsd(session.costCents)}
                    </div>
                    <input
                      type="text"
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                      placeholder="Reason (optional)"
                      className="w-full text-[12.5px] px-2.5 py-1.5 rounded-md border"
                      style={{ borderColor: c.border }}
                    />
                    {refundError && (
                      <div className="text-[11.5px]" style={{ color: c.rose }}>{refundError}</div>
                    )}
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => { setRefundOpen(false); setRefundReason(""); setRefundError(null); }}
                        className="text-[12px] px-3 py-1.5 rounded-md"
                        style={{ color: c.inkSoft }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={submitRefund}
                        disabled={refundMut.isPending}
                        className="text-[12px] px-3 py-1.5 rounded-md"
                        style={{ background: c.cobalt, color: "white", fontWeight: 700, opacity: refundMut.isPending ? 0.6 : 1 }}
                      >
                        {refundMut.isPending ? "Refunding…" : "Confirm refund"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {data && data.samples.length > 0 && (
              <div className="rounded-xl border" style={{ borderColor: c.border }}>
                <div className="px-4 py-2.5 border-b text-[12.5px]" style={{ borderColor: c.border, fontWeight: 700 }}>
                  Usage samples ({data.samples.length})
                </div>
                <div className="max-h-40 overflow-y-auto">
                  <table className="w-full text-[12px]">
                    <thead style={{ background: c.canvas, color: c.inkSoft }}>
                      <tr>
                        <th className="px-3 py-1.5 text-left text-[10.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Time</th>
                        <th className="px-3 py-1.5 text-right text-[10.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>kWh</th>
                        <th className="px-3 py-1.5 text-right text-[10.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Power</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.samples.map((s) => (
                        <tr key={s.id} className="border-t" style={{ borderColor: c.borderSoft }}>
                          <td className="px-3 py-1.5 font-mono-num">{fmtDateTime(s.sampledAt)}</td>
                          <td className="px-3 py-1.5 text-right font-mono-num">{s.kwh.toFixed(3)}</td>
                          <td className="px-3 py-1.5 text-right font-mono-num">{s.powerKw != null ? `${s.powerKw.toFixed(1)} kW` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="rounded-xl border" style={{ borderColor: c.border }}>
              <div className="px-4 py-2.5 border-b text-[12.5px]" style={{ borderColor: c.border, fontWeight: 700 }}>
                Audit log
              </div>
              {auditLoading ? (
                <div className="px-4 py-3 text-[12px]" style={{ color: c.inkMute }}>Loading…</div>
              ) : audit.length === 0 ? (
                <div className="px-4 py-3 text-[12px]" style={{ color: c.inkMute }}>No audit entries.</div>
              ) : (
                <ul className="divide-y" style={{ borderColor: c.borderSoft }}>
                  {audit.map((a) => (
                    <li key={a.id} className="px-4 py-2 text-[12px]">
                      <div className="flex items-center justify-between">
                        <span style={{ fontWeight: 600 }}>{ACTION_LABELS[a.action] ?? a.action}</span>
                        <span className="font-mono-num" style={{ color: c.inkMute }}>{fmtDateTime(a.createdAt)}</span>
                      </div>
                      {isManager && a.details && Object.keys(a.details).length > 0 && (
                        <pre className="mt-1 text-[11px] whitespace-pre-wrap break-all rounded p-1.5" style={{ background: c.canvas, color: c.inkSoft }}>
                          {JSON.stringify(a.details, null, 2)}
                        </pre>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: c.border, background: c.canvas }}>
      <div className="flex items-center gap-1 text-[10.5px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>
        {icon}
        {label}
      </div>
      <div className="text-[16px] mt-1 font-mono-num" style={{ fontWeight: 700, color: c.ink }}>{value}</div>
      {sub && <div className="text-[11.5px]" style={{ color: c.inkMute }}>{sub}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2">
      <span style={{ color: c.inkMute }}>{label}</span>
      <span className="font-mono-num" style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

/** Parse the ledger entry's batchRef to extract the EV charging session id. */
export function evSessionIdFromBatchRef(batchRef: string | null | undefined): number | null {
  if (!batchRef) return null;
  const m = batchRef.match(/^ev-(?:session|refund)-(\d+)$/);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) ? id : null;
}
