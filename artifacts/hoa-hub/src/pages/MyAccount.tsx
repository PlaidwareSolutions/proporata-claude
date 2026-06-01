import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import {
  useGetMyAccount,
  getGetMyAccountStatementUrl,
  useGetPaymentsConfig,
  useListMyPaymentMethods,
  useDeleteMyPaymentMethod,
  useSetMyAutoPay,
  useCreateMySetupIntent,
  getGetMyAccountQueryKey,
  getListMyPaymentMethodsQueryKey,
} from "@workspace/api-client-react";
import { Download, Wallet, CreditCard, Trash2, CheckCircle2, CalendarClock, Lock } from "lucide-react";
import PayNowDialog from "@/components/PayNowDialog";
import { apiFetch } from "@/lib/apiFetch";
import { EvSessionDrawer, evSessionIdFromBatchRef } from "@/components/EvSessionDrawer";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe as StripeJS } from "@stripe/stripe-js";

const stripePromiseCache = new Map<string, Promise<StripeJS | null>>();
function getStripeJs(pk: string): Promise<StripeJS | null> {
  let p = stripePromiseCache.get(pk);
  if (!p) {
    p = loadStripe(pk);
    stripePromiseCache.set(pk, p);
  }
  return p;
}

function fmtUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const CHARGE_LABELS: Record<string, string> = {
  monthly_assessment: "Monthly Assessment",
  late_fee: "Late Fee",
  special_assessment: "Special Assessment",
  fine: "Fine",
  ev_charging: "EV Charging",
  other: "Other",
};

const PAYMENT_LABELS: Record<string, string> = {
  check: "Check",
  ach_manual: "ACH",
  cash: "Cash",
  other: "Payment",
};

function fmtSettlementDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default function MyAccount() {
  const { data, isLoading, error } = useGetMyAccount();
  const { data: payConfig } = useGetPaymentsConfig();
  const [payOpen, setPayOpen] = useState(false);
  const [retryAmountCents, setRetryAmountCents] = useState<number | null>(null);
  const [showAddPm, setShowAddPm] = useState(false);
  const [evSessionId, setEvSessionId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  if (isLoading) {
    return (
      <Layout title="My Account" subtitle="Assessments & ledger">
        <div className="text-center py-12 text-[13px]" style={{ color: c.inkMute }}>Loading…</div>
      </Layout>
    );
  }

  if (error || !data) {
    return (
      <Layout title="My Account" subtitle="Assessments & ledger">
        <div className="rounded-xl border p-8 text-center" style={{ background: c.panel, borderColor: c.border }}>
          <Wallet className="mx-auto h-8 w-8 mb-3" style={{ color: c.inkMute, opacity: 0.5 }} />
          <div className="text-[14px]" style={{ fontWeight: 600 }}>No account available</div>
          <div className="text-[12.5px] mt-1" style={{ color: c.inkMute }}>
            Owner ledgers are only available to unit owners. Please contact your manager if you believe this is in error.
          </div>
        </div>
      </Layout>
    );
  }

  const balanceColor = data.balanceCents > 0 ? c.rose : data.balanceCents < 0 ? c.cobalt : c.ink;
  const status = data.status;
  const statusLabel = status === "past_due" ? "Past Due" : status === "credit" ? "Credit" : "Current";
  const statusBg = status === "past_due" ? c.roseSoft : status === "credit" ? c.cobaltSoft : c.emeraldSoft;
  const statusFg = status === "past_due" ? c.rose : status === "credit" ? c.cobalt : c.emerald;

  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const statementUrl = getGetMyAccountStatementUrl({ period });

  const onlineEnabled = !!payConfig?.enabled;
  const balanceDue = data.balanceCents > 0 ? data.balanceCents : 0;

  return (
    <Layout
      title="My Account"
      subtitle={`Unit ${data.unitLabel} · ${data.address}`}
      actions={
        <div className="flex items-center gap-2">
          {onlineEnabled && (
            <button
              onClick={() => setPayOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] hover:opacity-90"
              style={{ background: c.emerald, color: "#fff", fontWeight: 600 }}
            >
              <CreditCard className="h-4 w-4" /> {balanceDue > 0 ? "Pay now" : "Make a payment"}
            </button>
          )}
          <a
            href={statementUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] hover:opacity-90"
            style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
          >
            <Download className="h-4 w-4" /> Download statement (PDF)
          </a>
          <a
            href={`${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/portal/mail`}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] hover:opacity-90"
            style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 600 }}
          >
            My Mail
          </a>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11.5px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>
                Current Balance
              </div>
              <div className="text-[36px] mt-1 font-mono-num" style={{ fontWeight: 700, color: balanceColor }}>
                {fmtUsd(data.balanceCents)}
              </div>
              <div className="text-[12.5px] mt-1" style={{ color: c.inkMute }}>
                {data.balanceCents > 0
                  ? "Amount due. Please remit payment to the management office."
                  : data.balanceCents < 0
                    ? "Credit on file — will apply to upcoming assessments."
                    : "Your account is paid in full. Thank you!"}
              </div>
            </div>
            <span className="text-[11.5px] px-2.5 py-1 rounded-full" style={{ background: statusBg, color: statusFg, fontWeight: 700 }}>
              {statusLabel}
            </span>
          </div>
        </div>

        <div className="rounded-xl border" style={{ background: c.panel, borderColor: c.border }}>
          <div className="px-4 py-3 border-b text-[14px]" style={{ borderColor: c.border, fontWeight: 700 }}>
            Activity ({data.entries.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead style={{ background: c.canvas, color: c.inkSoft }}>
                <tr>
                  <th className="px-4 py-2.5 text-left text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Date</th>
                  <th className="px-4 py-2.5 text-left text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Description</th>
                  <th className="px-4 py-2.5 text-right text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Charge</th>
                  <th className="px-4 py-2.5 text-right text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Payment</th>
                  <th className="px-4 py-2.5 text-right text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.length === 0 && (data.pendingAttempts ?? []).length === 0 && (
                  <tr><td colSpan={5} className="text-center py-8" style={{ color: c.inkMute }}>No activity yet.</td></tr>
                )}
                {(data.pendingAttempts ?? []).map((a) => {
                  const isFailed = a.status === "failed";
                  const isProcessing = a.status === "processing";
                  const isPending = a.status === "pending";
                  const labelBg = isFailed ? c.roseSoft : isProcessing ? c.cobaltSoft : c.canvas;
                  const labelFg = isFailed ? c.rose : isProcessing ? c.cobalt : c.inkSoft;
                  const label = isFailed
                    ? "Failed"
                    : isProcessing
                      ? a.paymentMethodKind === "us_bank_account"
                        ? "ACH transfer in progress"
                        : "Processing"
                      : isPending
                        ? "Submitted"
                        : a.status;
                  return (
                    <tr key={`pa-${a.id}`} className="border-t" style={{ borderColor: c.borderSoft, background: c.canvas, opacity: 0.95 }}>
                      <td className="px-4 py-2.5 font-mono-num">{a.createdAt.slice(0, 10)}</td>
                      <td className="px-4 py-2.5">
                        Online payment {a.kind === "auto_pay" ? "(auto-pay)" : ""}
                        <span className="ml-2 text-[11.5px] px-2 py-0.5 rounded-full" style={{ background: labelBg, color: labelFg, fontWeight: 700 }}>
                          {label}
                        </span>
                        {isProcessing && a.expectedSettlementAt && (
                          <div className="text-[11.5px] mt-0.5" style={{ color: c.inkMute }}>
                            Funds expected to settle by {fmtSettlementDate(a.expectedSettlementAt)}
                          </div>
                        )}
                        {isFailed && a.errorMessage && (
                          <div className="text-[11.5px] mt-0.5" style={{ color: c.inkMute }}>{a.errorMessage}</div>
                        )}
                        {isFailed && onlineEnabled && (
                          <button
                            onClick={() => {
                              setRetryAmountCents(a.amountCents);
                              setPayOpen(true);
                            }}
                            className="mt-1 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] hover:opacity-90"
                            style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                          >
                            Retry payment
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono-num">—</td>
                      <td className="px-4 py-2.5 text-right font-mono-num" style={{ color: c.inkMute }}>
                        {fmtUsd(a.amountCents + a.surchargeCents)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono-num" style={{ color: c.inkMute }}>—</td>
                    </tr>
                  );
                })}
                {data.entries.map((e) => {
                  const isCharge = e.kind === "charge" && !e.voidedAt;
                  const isPayment = e.kind === "payment" && !e.voidedAt;
                  const isRefund = e.kind === "refund";
                  const isVoid = e.kind === "void" || isRefund;
                  const isEv = e.chargeType === "ev_charging";
                  const evSidFromEntry = isEv ? evSessionIdFromBatchRef(e.batchRef ?? null) : null;
                  let desc: string;
                  if (isRefund) {
                    desc = `Refund${e.memo ? ` — ${e.memo}` : ""}`;
                  } else if (e.kind === "void") {
                    desc = `Adjustment${e.memo ? ` — ${e.memo}` : ""}`;
                  } else if (e.kind === "charge") {
                    desc = `${CHARGE_LABELS[e.chargeType ?? ""] ?? "Charge"}${e.memo ? ` — ${e.memo}` : ""}${e.voidedAt ? "  (Voided)" : ""}`;
                  } else {
                    desc = `Payment received — ${PAYMENT_LABELS[e.paymentMethod ?? ""] ?? ""}${e.memo ? ` (${e.memo})` : ""}${e.voidedAt ? "  (Voided)" : ""}`;
                  }
                  return (
                    <tr key={e.id} className="border-t" style={{ borderColor: c.borderSoft, opacity: e.voidedAt ? 0.55 : 1 }}>
                      <td className="px-4 py-2.5 font-mono-num">{e.occurredOn}</td>
                      <td className="px-4 py-2.5">
                        {evSidFromEntry != null ? (
                          <button
                            type="button"
                            onClick={() => setEvSessionId(evSidFromEntry)}
                            className="text-left hover:underline"
                            style={{ color: c.cobalt, fontWeight: 600 }}
                            title="View EV charging session details"
                          >
                            {desc}
                          </button>
                        ) : (
                          desc
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono-num">
                        {isCharge ? fmtUsd(e.amountCents) : isVoid && e.amountCents > 0 ? fmtUsd(e.amountCents) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono-num">
                        {isPayment ? fmtUsd(e.amountCents) : isVoid && e.amountCents < 0 ? fmtUsd(-e.amountCents) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono-num" style={{ fontWeight: 600 }}>
                        {fmtUsd(e.runningBalanceCents ?? 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {onlineEnabled && (
          <PaymentMethodsSection onAdd={() => setShowAddPm(true)} />
        )}
        <MyTimelineSection />
      </div>
      <PayNowDialog
        open={payOpen}
        onClose={() => {
          setPayOpen(false);
          setRetryAmountCents(null);
        }}
        defaultAmountCents={retryAmountCents ?? balanceDue}
        onSuccess={async () => {
          setRetryAmountCents(null);
          await queryClient.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
          await queryClient.invalidateQueries({ queryKey: getListMyPaymentMethodsQueryKey() });
        }}
      />
      <MyAmenityUsage />
      {evSessionId != null && (
        <EvSessionDrawer
          sessionId={evSessionId}
          onClose={() => setEvSessionId(null)}
        />
      )}
      {showAddPm && payConfig?.publishableKey && (
        <AddPaymentMethodDialog
          publishableKey={payConfig.publishableKey}
          onClose={() => setShowAddPm(false)}
        />
      )}
    </Layout>
  );
}

function PaymentMethodsSection({ onAdd }: { onAdd: () => void }) {
  const { data: methods = [], isLoading } = useListMyPaymentMethods();
  const queryClient = useQueryClient();
  const del = useDeleteMyPaymentMethod();
  const setAutoPay = useSetMyAutoPay();

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: getListMyPaymentMethodsQueryKey() });
  }

  return (
    <div className="rounded-xl border" style={{ background: c.panel, borderColor: c.border }}>
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: c.border }}>
        <div className="text-[14px]" style={{ fontWeight: 700 }}>Saved payment methods</div>
        <button
          onClick={onAdd}
          className="text-[12.5px] rounded-md px-2.5 py-1 hover:opacity-90"
          style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
        >
          + Add method
        </button>
      </div>
      {isLoading ? (
        <div className="p-4 text-[13px]" style={{ color: c.inkMute }}>Loading…</div>
      ) : methods.length === 0 ? (
        <div className="p-4 text-[13px]" style={{ color: c.inkMute }}>
          No saved methods. Add one to enable auto-pay or speed up future payments.
        </div>
      ) : (
        <ul className="divide-y" style={{ borderColor: c.borderSoft }}>
          {methods.map((m) => (
            <li key={m.id} className="px-4 py-3 flex items-center gap-3">
              <CreditCard className="h-4 w-4" style={{ color: c.cobalt }} />
              <div className="flex-1 text-[13px]">
                <div style={{ fontWeight: 600 }}>
                  {m.brand ?? (m.kind === "us_bank_account" ? "Bank account" : "Card")} •••• {m.last4 ?? "----"}
                </div>
                {m.isAutoPay && (
                  <div className="text-[11.5px] mt-0.5 inline-flex items-center gap-1" style={{ color: c.emerald, fontWeight: 600 }}>
                    <CheckCircle2 className="h-3 w-3" /> Auto-pay enabled
                  </div>
                )}
              </div>
              <label className="text-[12px] inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={m.isAutoPay}
                  onChange={async (e) => {
                    await setAutoPay.mutateAsync({ id: m.id, data: { enabled: e.target.checked } });
                    refresh();
                  }}
                  className="accent-blue-600"
                />
                Auto-pay
              </label>
              <button
                onClick={async () => {
                  if (!confirm("Remove this payment method?")) return;
                  await del.mutateAsync({ id: m.id });
                  refresh();
                }}
                className="rounded p-1.5 hover:bg-slate-100"
                title="Remove"
              >
                <Trash2 className="h-4 w-4" style={{ color: c.rose }} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddPaymentMethodDialog({ publishableKey, onClose }: { publishableKey: string; onClose: () => void }) {
  const setupIntent = useCreateMySetupIntent();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stripePromise = getStripeJs(publishableKey);

  async function start() {
    setError(null);
    try {
      const r = await setupIntent.mutateAsync();
      if (!r.clientSecret) throw new Error("Could not start setup");
      setClientSecret(r.clientSecret);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: c.border }}>
          <div className="text-[14px]" style={{ fontWeight: 700 }}>Add payment method</div>
          <button onClick={onClose} className="text-[14px]" style={{ color: c.inkMute }}>✕</button>
        </div>
        <div className="p-5 space-y-4">
          {!clientSecret ? (
            <>
              <div className="text-[13px]" style={{ color: c.inkSoft }}>
                Save a card or bank account for future payments. You may opt-in to auto-pay after saving.
              </div>
              {error && <div className="text-[13px]" style={{ color: c.rose }}>{error}</div>}
              <button
                onClick={start}
                disabled={setupIntent.isPending}
                className="w-full rounded-md px-4 py-2.5 text-[14px]"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
              >
                {setupIntent.isPending ? "Starting…" : "Continue"}
              </button>
            </>
          ) : (
            <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
              <AddPmForm onDone={onClose} />
            </Elements>
          )}
        </div>
      </div>
    </div>
  );
}

function AddPmForm({ onDone }: { onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    const { error: confirmError } = await stripe.confirmSetup({ elements, redirect: "if_required" });
    if (confirmError) {
      setError(confirmError.message ?? "Setup failed");
      setSubmitting(false);
      return;
    }
    // Webhook records the saved method; invalidate after a short delay.
    setTimeout(async () => {
      await queryClient.invalidateQueries({ queryKey: getListMyPaymentMethodsQueryKey() });
      onDone();
    }, 800);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <PaymentElement />
      {error && <div className="text-[13px]" style={{ color: "#B8264C" }}>{error}</div>}
      <button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full rounded-md px-4 py-2.5 text-[14px]"
        style={{ background: "#3245FF", color: "#fff", fontWeight: 600 }}
      >
        {submitting ? "Saving…" : "Save payment method"}
      </button>
    </form>
  );
}

interface MyAmenityUsageRow {
  bookingId: number;
  amenityName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  feeCents: number;
  depositCents: number;
  refundCents: number;
  netCents: number;
  depositStatus: string;
}
interface MyAmenityUsageResponse {
  rows: MyAmenityUsageRow[];
  totals: { feeCents: number; depositCents: number; refundCents: number; netCents: number; bookings: number };
}

function MyAmenityUsage() {
  const [data, setData] = useState<MyAmenityUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch<MyAmenityUsageResponse>({ url: "/me/amenity-usage", method: "GET" });
        if (!cancelled) setData(r);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  if (loading) return null;
  if (error) return null;
  if (!data || data.rows.length === 0) return null;
  return (
    <div className="rounded-xl border" style={{ background: c.panel, borderColor: c.border }}>
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: c.border }}>
        <div className="text-[14px]" style={{ fontWeight: 700 }}>
          Amenity usage ({data.totals.bookings})
        </div>
        <a href="/api/me/amenity-usage.csv" className="text-[12.5px] inline-flex items-center gap-1" style={{ color: c.cobalt, fontWeight: 600 }}>
          <Download className="h-3.5 w-3.5" /> Download CSV
        </a>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead style={{ background: c.canvas, color: c.inkSoft }}>
            <tr>
              <th className="px-4 py-2.5 text-left text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>When</th>
              <th className="px-4 py-2.5 text-left text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Amenity</th>
              <th className="px-4 py-2.5 text-left text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Status</th>
              <th className="px-4 py-2.5 text-right text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Fee</th>
              <th className="px-4 py-2.5 text-right text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Deposit</th>
              <th className="px-4 py-2.5 text-right text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Refund</th>
              <th className="px-4 py-2.5 text-right text-[11.5px] uppercase tracking-wider" style={{ fontWeight: 700 }}>Net</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.bookingId} className="border-t" style={{ borderColor: c.borderSoft }}>
                <td className="px-4 py-2 font-mono-num text-[12px]" style={{ color: c.inkSoft }}>{r.startsAt.slice(0, 16).replace("T", " ")}</td>
                <td className="px-4 py-2">{r.amenityName}</td>
                <td className="px-4 py-2 text-[12px]" style={{ color: c.inkMute }}>
                  {r.status}
                  {r.depositStatus !== "none" && (
                    <span className="ml-1 px-1.5 py-0.5 rounded text-[10.5px]" style={{ background: c.borderSoft, color: c.inkSoft, fontWeight: 600 }}>
                      deposit {r.depositStatus}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right font-mono-num">{fmtUsd(r.feeCents)}</td>
                <td className="px-4 py-2 text-right font-mono-num" style={{ color: c.inkMute }}>{fmtUsd(r.depositCents)}</td>
                <td className="px-4 py-2 text-right font-mono-num" style={{ color: r.refundCents > 0 ? c.cobalt : c.inkMute }}>{r.refundCents > 0 ? fmtUsd(r.refundCents) : "—"}</td>
                <td className="px-4 py-2 text-right font-mono-num" style={{ fontWeight: 700 }}>{fmtUsd(r.netCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: c.canvas }}>
              <td colSpan={3} className="px-4 py-2 text-[12px] text-right" style={{ color: c.inkSoft, fontWeight: 700 }}>Totals</td>
              <td className="px-4 py-2 text-right font-mono-num" style={{ fontWeight: 700 }}>{fmtUsd(data.totals.feeCents)}</td>
              <td className="px-4 py-2 text-right font-mono-num" style={{ fontWeight: 700, color: c.inkSoft }}>{fmtUsd(data.totals.depositCents)}</td>
              <td className="px-4 py-2 text-right font-mono-num" style={{ fontWeight: 700, color: c.cobalt }}>{fmtUsd(data.totals.refundCents)}</td>
              <td className="px-4 py-2 text-right font-mono-num" style={{ fontWeight: 700 }}>{fmtUsd(data.totals.netCents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

interface MyTimelineItem {
  id: number;
  instanceId: string;
  occurrenceKey: string;
  subCalendarId: number;
  subCalendarSlug: string;
  color: string;
  title: string;
  body: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  locationText: string | null;
  ownerUserId: number | null;
  isPrivate: boolean;
}

const SUB_LABEL: Record<string, string> = {
  billing: "Billing",
  compliance: "Compliance",
  architectural: "Architectural",
  meetings: "Meetings",
  community: "Community",
};

function fmtTimelineDate(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (allDay) {
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function MyTimelineSection() {
  const [items, setItems] = useState<MyTimelineItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const from = new Date();
        const to = new Date();
        to.setDate(to.getDate() + 90);
        const r = await apiFetch<MyTimelineItem[]>({
          url: `/calendar/me/timeline?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
          method: "GET",
        });
        if (!cancelled) setItems(r);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return null;
  if (error) {
    return (
      <div className="rounded-xl border" style={{ background: c.panel, borderColor: c.border }}>
        <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: c.border }}>
          <CalendarClock className="h-4 w-4" style={{ color: c.cobalt }} />
          <div className="text-[14px]" style={{ fontWeight: 700 }}>Upcoming for you</div>
        </div>
        <div className="p-6 text-center text-[13px]" style={{ color: c.inkMute }}>
          Couldn't load your timeline right now. Please refresh to try again.
        </div>
      </div>
    );
  }
  const upcoming = (items ?? [])
    .filter((i) => new Date(i.endsAt).getTime() >= Date.now() - 6 * 60 * 60 * 1000)
    .slice(0, 12);

  return (
    <div className="rounded-xl border" style={{ background: c.panel, borderColor: c.border }}>
      <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: c.border }}>
        <CalendarClock className="h-4 w-4" style={{ color: c.cobalt }} />
        <div className="text-[14px]" style={{ fontWeight: 700 }}>Upcoming for you</div>
        <div className="text-[12px]" style={{ color: c.inkMute }}>
          Dues, violations, ACC milestones, and community events for the next 90 days
        </div>
      </div>
      {upcoming.length === 0 ? (
        <div className="p-6 text-center text-[13px]" style={{ color: c.inkMute }}>
          Nothing scheduled in the next 90 days. You're all caught up.
        </div>
      ) : (
        <ul className="divide-y" style={{ borderColor: c.borderSoft }}>
          {upcoming.map((it) => {
            const label = SUB_LABEL[it.subCalendarSlug] ?? it.subCalendarSlug;
            return (
              <li
                key={it.instanceId}
                className="px-4 py-3 flex items-start gap-3"
                data-testid={`timeline-item-${it.id}`}
              >
                <span
                  className="mt-1 h-8 w-1 rounded-sm flex-shrink-0"
                  style={{ background: it.color || c.cobalt }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-[13.5px]" style={{ color: c.ink, fontWeight: 600 }}>
                      {it.title}
                    </div>
                    {it.isPrivate && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px]"
                        style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}
                        title="Private to you"
                      >
                        <Lock className="h-3 w-3" /> Private
                      </span>
                    )}
                    <span
                      className="px-1.5 py-0.5 rounded text-[10.5px]"
                      style={{ background: (it.color || "#888") + "22", color: c.inkSoft, fontWeight: 700 }}
                    >
                      {label}
                    </span>
                  </div>
                  <div className="text-[12px] mt-0.5" style={{ color: c.inkMute }}>
                    {fmtTimelineDate(it.startsAt, it.allDay)}
                    {it.locationText ? ` · ${it.locationText}` : ""}
                  </div>
                  {it.body && (
                    <div className="text-[12.5px] mt-1" style={{ color: c.inkSoft }}>{it.body}</div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
