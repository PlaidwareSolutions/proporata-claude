import { useState, useMemo } from "react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import {
  useListPaymentAttempts,
  useRefundPaymentAttempt,
  useGetPaymentReceipt,
  useResendPaymentReceipt,
  getListPaymentAttemptsQueryKey,
  type PaymentAttempt,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, RotateCcw, ExternalLink, Receipt, AlertCircle, Mail, Check } from "lucide-react";

function fmtUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  pending: { bg: "#FEF3E2", fg: "#E37400", label: "Pending" },
  processing: { bg: "#FEF3E2", fg: "#E37400", label: "Processing" },
  succeeded: { bg: "#DCF3EC", fg: "#0E8A6B", label: "Succeeded" },
  failed: { bg: "#FBE3E9", fg: "#B8264C", label: "Failed" },
  refunded: { bg: "#EFF1F8", fg: "#2A3050", label: "Refunded" },
  partially_refunded: { bg: "#EFF1F8", fg: "#2A3050", label: "Partial Refund" },
};

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "succeeded", label: "Succeeded" },
  { value: "processing", label: "Processing" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded" },
  { value: "disputed", label: "Disputed" },
];

export default function Payments() {
  const { data: attempts = [], isLoading } = useListPaymentAttempts();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [refundTarget, setRefundTarget] = useState<PaymentAttempt | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<PaymentAttempt | null>(null);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return attempts;
    if (statusFilter === "disputed") return attempts.filter((a) => a.disputeStatus);
    if (statusFilter === "refunded")
      return attempts.filter((a) => a.status === "refunded" || a.status === "partially_refunded");
    return attempts.filter((a) => a.status === statusFilter);
  }, [attempts, statusFilter]);

  return (
    <Layout title="Online Payments" subtitle="Stripe payments and refunds">
      <div className="rounded-xl border" style={{ background: c.panel, borderColor: c.border }}>
        <div
          className="px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap"
          style={{ borderColor: c.border }}
        >
          <div className="text-[14px] flex items-center gap-2" style={{ fontWeight: 700 }}>
            <CreditCard className="h-4 w-4" style={{ color: c.cobalt }} />
            Payment Attempts ({filtered.length})
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className="text-[12px] rounded-md px-2.5 py-1"
                style={{
                  background: statusFilter === f.value ? c.cobalt : c.canvas,
                  color: statusFilter === f.value ? "#fff" : c.inkSoft,
                  fontWeight: 600,
                  border: `1px solid ${statusFilter === f.value ? c.cobalt : c.border}`,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead style={{ background: c.canvas, color: c.inkSoft }}>
              <tr>
                <th className="px-4 py-2.5 text-left text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Date</th>
                <th className="px-4 py-2.5 text-left text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Unit</th>
                <th className="px-4 py-2.5 text-left text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Owner</th>
                <th className="px-4 py-2.5 text-right text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Amount</th>
                <th className="px-4 py-2.5 text-right text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Surcharge</th>
                <th className="px-4 py-2.5 text-right text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Refunded</th>
                <th className="px-4 py-2.5 text-left text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Kind</th>
                <th className="px-4 py-2.5 text-left text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Status</th>
                <th className="px-4 py-2.5 text-right text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={9} className="text-center py-8" style={{ color: c.inkMute }}>Loading…</td></tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={9} className="text-center py-8" style={{ color: c.inkMute }}>No payment attempts yet.</td></tr>
              )}
              {filtered.map((a) => {
                const s = STATUS_STYLE[a.status] ?? { bg: c.canvas, fg: c.ink, label: a.status };
                const remaining = a.amountCents + a.surchargeCents - (a.refundedAmountCents ?? 0);
                const canRefund = (a.status === "succeeded" || a.status === "partially_refunded") && remaining > 0;
                return (
                  <tr key={a.id} className="border-t" style={{ borderColor: c.borderSoft }}>
                    <td className="px-4 py-2.5 font-mono-num">{a.createdAt.slice(0, 10)}</td>
                    <td className="px-4 py-2.5">{a.unitLabel ?? "—"}</td>
                    <td className="px-4 py-2.5">{a.ownerName ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono-num">{fmtUsd(a.amountCents)}</td>
                    <td className="px-4 py-2.5 text-right font-mono-num">{a.surchargeCents > 0 ? fmtUsd(a.surchargeCents) : "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono-num">{(a.refundedAmountCents ?? 0) > 0 ? fmtUsd(a.refundedAmountCents ?? 0) : "—"}</td>
                    <td className="px-4 py-2.5">{a.kind === "auto_pay" ? "Auto-pay" : a.kind === "owner_initiated" ? "Owner" : a.kind}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-[11.5px] px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.fg, fontWeight: 700 }}>
                        {s.label}
                      </span>
                      {a.disputeStatus && (
                        <div className="text-[11.5px] mt-0.5 inline-flex items-center gap-1" style={{ color: c.rose, fontWeight: 700 }}>
                          <AlertCircle className="h-3 w-3" /> Disputed: {a.disputeStatus}
                        </div>
                      )}
                      {a.errorMessage && <div className="text-[11.5px] mt-0.5" style={{ color: c.inkMute }}>{a.errorMessage}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {canRefund && (
                        <button
                          onClick={() => setRefundTarget(a)}
                          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] hover:bg-slate-50"
                          style={{ borderColor: c.border }}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Refund
                        </button>
                      )}
                      {a.status === "succeeded" && (
                        <button
                          onClick={() => setReceiptTarget(a)}
                          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] hover:bg-slate-50 ml-2"
                          style={{ borderColor: c.border }}
                          title="View receipt"
                        >
                          <Receipt className="h-3.5 w-3.5" /> Receipt
                        </button>
                      )}
                      {a.stripePaymentIntentId && (
                        <a
                          href={`https://dashboard.stripe.com/payments/${a.stripePaymentIntentId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 ml-2 text-[12px]"
                          style={{ color: c.cobalt }}
                        >
                          <ExternalLink className="h-3 w-3" /> Stripe
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {refundTarget && (
        <RefundDialog attempt={refundTarget} onClose={() => setRefundTarget(null)} />
      )}
      {receiptTarget && (
        <ReceiptDialog attempt={receiptTarget} onClose={() => setReceiptTarget(null)} />
      )}
    </Layout>
  );
}

function RefundDialog({ attempt, onClose }: { attempt: PaymentAttempt; onClose: () => void }) {
  const queryClient = useQueryClient();
  const refund = useRefundPaymentAttempt();
  const remaining = attempt.amountCents + attempt.surchargeCents - (attempt.refundedAmountCents ?? 0);
  const [amountStr, setAmountStr] = useState((remaining / 100).toFixed(2));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const parsed = Math.round(parseFloat(amountStr) * 100);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > remaining) {
      setError(`Enter a positive amount up to ${fmtUsd(remaining)}.`);
      return;
    }
    try {
      await refund.mutateAsync({
        id: attempt.id,
        data: { amountCents: parsed, reason: reason.trim() || undefined },
      });
      await queryClient.invalidateQueries({ queryKey: getListPaymentAttemptsQueryKey() });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refund failed");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: c.border }}>
          <div className="text-[14px]" style={{ fontWeight: 700 }}>Issue refund</div>
          <button onClick={onClose} className="text-[14px]" style={{ color: c.inkMute }}>✕</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="text-[13px]" style={{ color: c.inkSoft }}>
            Refund payment from <strong>{attempt.ownerName ?? "owner"}</strong> ({attempt.unitLabel ?? "—"}).
            Original: <strong>{fmtUsd(attempt.amountCents)}</strong>. Remaining refundable:{" "}
            <strong>{fmtUsd(remaining)}</strong>.
          </div>
          <label className="block text-[12.5px]" style={{ color: c.inkSoft }}>
            Refund amount (USD)
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={(remaining / 100).toFixed(2)}
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-2 text-[13px] font-mono-num"
              style={{ borderColor: c.border }}
            />
          </label>
          <label className="block text-[12.5px]" style={{ color: c.inkSoft }}>
            Reason (optional)
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Duplicate payment"
              className="mt-1 w-full rounded-md border px-3 py-2 text-[13px]"
              style={{ borderColor: c.border }}
            />
          </label>
          <div className="text-[12px]" style={{ color: c.inkMute }}>
            Stripe processes the refund and confirms via webhook. Until that
            confirmation lands (usually a few seconds), this payment will keep
            its current status — the refund will be reflected in the ledger
            and the row's "Refunded" column once Stripe confirms.
          </div>
          {error && <div className="text-[13px]" style={{ color: c.rose }}>{error}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="rounded-md border px-3 py-1.5 text-[13px]"
              style={{ borderColor: c.border, color: c.inkSoft }}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={refund.isPending}
              className="rounded-md px-3 py-1.5 text-[13px] disabled:opacity-60"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
            >
              {refund.isPending ? "Refunding…" : "Issue refund"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReceiptDialog({ attempt, onClose }: { attempt: PaymentAttempt; onClose: () => void }) {
  const { data, isLoading, error } = useGetPaymentReceipt(attempt.id);
  const resend = useResendPaymentReceipt();
  const [resendOk, setResendOk] = useState(false);
  const [resendErr, setResendErr] = useState<string | null>(null);

  async function doResend() {
    setResendErr(null);
    setResendOk(false);
    try {
      await resend.mutateAsync({ id: attempt.id });
      setResendOk(true);
    } catch (e) {
      setResendErr(e instanceof Error ? e.message : "Failed to re-send receipt");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: c.border }}>
          <div className="text-[14px]" style={{ fontWeight: 700 }}>Receipt</div>
          <button onClick={onClose} className="text-[14px]" style={{ color: c.inkMute }}>✕</button>
        </div>
        <div className="p-5 space-y-3 text-[13px]" style={{ color: c.inkSoft }}>
          {isLoading && <div>Loading…</div>}
          {error && <div style={{ color: c.rose }}>Could not load receipt.</div>}
          {data && (
            <>
              <div>
                <div style={{ color: c.inkMute, fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700 }}>Amount</div>
                <div className="font-mono-num text-[16px]" style={{ color: c.ink, fontWeight: 700 }}>
                  {fmtUsd(data.amountCents + data.surchargeCents)}
                </div>
              </div>
              {data.receiptUrl ? (
                <a
                  href={data.receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px]"
                  style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                >
                  <ExternalLink className="h-4 w-4" /> Open Stripe receipt
                </a>
              ) : (
                <div style={{ color: c.inkMute }}>No Stripe receipt URL is available for this payment.</div>
              )}
              <div className="pt-3 border-t" style={{ borderColor: c.borderSoft }}>
                <div className="text-[12.5px] mb-2" style={{ color: c.inkMute }}>
                  Re-send the receipt email to the unit owner on file.
                </div>
                <button
                  onClick={doResend}
                  disabled={resend.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] disabled:opacity-60"
                  style={{ borderColor: c.border, color: c.ink }}
                >
                  {resendOk ? <Check className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                  {resend.isPending ? "Sending…" : resendOk ? "Sent" : "Re-send receipt email"}
                </button>
                {resendErr && (
                  <div className="text-[12.5px] mt-2" style={{ color: c.rose }}>{resendErr}</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
