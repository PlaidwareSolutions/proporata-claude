import { useEffect, useMemo, useState } from "react";
import { loadStripe, type Stripe as StripeJS } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { c } from "@/lib/theme";
import { X, Loader2, CreditCard } from "lucide-react";
import {
  useGetPaymentsConfig,
  useCreateMyPaymentIntent,
} from "@workspace/api-client-react";

function fmtUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const stripePromiseCache = new Map<string, Promise<StripeJS | null>>();
function getStripeJs(pk: string): Promise<StripeJS | null> {
  let p = stripePromiseCache.get(pk);
  if (!p) {
    p = loadStripe(pk);
    stripePromiseCache.set(pk, p);
  }
  return p;
}

type PayNowProps = {
  open: boolean;
  onClose: () => void;
  defaultAmountCents: number;
  onSuccess?: () => void;
};

export default function PayNowDialog(props: PayNowProps) {
  if (!props.open) return null;
  return <PayNowInner {...props} />;
}

function PayNowInner({ open, onClose, defaultAmountCents, onSuccess }: PayNowProps) {
  const { data: config } = useGetPaymentsConfig();
  const createIntent = useCreateMyPaymentIntent();
  const [amountStr, setAmountStr] = useState(((defaultAmountCents || 0) / 100).toFixed(2));
  const [savePm, setSavePm] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [intentInfo, setIntentInfo] = useState<{ amountCents: number; surchargeCents: number; totalCents: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stripePromise = useMemo(() => {
    if (!config?.publishableKey) return null;
    return getStripeJs(config.publishableKey);
  }, [config?.publishableKey]);

  if (!open) return null;

  const surchargeBp = config?.surchargePercentBp ?? 0;
  const surchargeEnabled = !!config?.surchargeEnabled;
  const amountCents = (() => {
    const trimmed = amountStr.trim().replace(/[$,]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return 0;
    const [whole, frac = ""] = trimmed.split(".");
    return parseInt(whole, 10) * 100 + parseInt((frac + "00").slice(0, 2), 10);
  })();
  const surchargeCents = surchargeEnabled ? Math.round((amountCents * surchargeBp) / 10000) : 0;
  const totalCents = amountCents + surchargeCents;

  async function startPayment() {
    setError(null);
    if (amountCents < 100) {
      setError("Minimum payment is $1.00");
      return;
    }
    try {
      const result = await createIntent.mutateAsync({ data: { amountCents, savePaymentMethod: savePm } });
      if (!result.clientSecret) {
        setError("Failed to start payment session");
        return;
      }
      setClientSecret(result.clientSecret);
      setIntentInfo({
        amountCents: result.amountCents,
        surchargeCents: result.surchargeCents,
        totalCents: result.totalCents,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start payment");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl" style={{ borderColor: c.border }}>
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: c.border }}>
          <div className="flex items-center gap-2 text-[14px]" style={{ fontWeight: 700 }}>
            <CreditCard className="h-4 w-4" style={{ color: c.cobalt }} />
            Pay Online
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {!config?.enabled && (
            <div className="rounded-md border p-3 text-[13px]" style={{ borderColor: c.border, background: c.canvas }}>
              Online payments are not currently enabled. Please contact your manager.
            </div>
          )}

          {config?.enabled && !clientSecret && (
            <>
              <div>
                <label className="block text-[12px] mb-1.5 uppercase tracking-wider" style={{ color: c.inkSoft, fontWeight: 700 }}>
                  Amount (USD)
                </label>
                <input
                  type="text"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-[14px]"
                  style={{ borderColor: c.border }}
                />
              </div>
              {surchargeEnabled && surchargeBp > 0 && (
                <div className="rounded-md border p-3 text-[13px]" style={{ borderColor: c.border, background: c.canvas }}>
                  <div className="flex justify-between"><span>Amount</span><span>{fmtUsd(amountCents)}</span></div>
                  <div className="flex justify-between"><span>Processing surcharge ({(surchargeBp / 100).toFixed(2)}%)</span><span>{fmtUsd(surchargeCents)}</span></div>
                  <div className="flex justify-between font-semibold mt-1 pt-1 border-t" style={{ borderColor: c.borderSoft }}><span>Total</span><span>{fmtUsd(totalCents)}</span></div>
                </div>
              )}
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={savePm} onChange={(e) => setSavePm(e.target.checked)} className="accent-blue-600" />
                Save this payment method for future use
              </label>
              {error && <div className="text-[13px]" style={{ color: c.rose }}>{error}</div>}
              <button
                onClick={startPayment}
                disabled={createIntent.isPending || amountCents < 100}
                className="w-full rounded-md px-4 py-2.5 text-[14px] disabled:opacity-50"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
              >
                {createIntent.isPending ? "Starting…" : `Continue with ${fmtUsd(totalCents)}`}
              </button>
            </>
          )}

          {clientSecret && stripePromise && intentInfo && (
            <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
              <PaymentForm
                onSuccess={() => {
                  onSuccess?.();
                  onClose();
                }}
                totalCents={intentInfo.totalCents}
              />
            </Elements>
          )}
        </div>
      </div>
    </div>
  );
}

function PaymentForm({ onSuccess, totalCents }: { onSuccess: () => void; totalCents: number }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });
    if (confirmError) {
      setError(confirmError.message ?? "Payment failed");
      setSubmitting(false);
      return;
    }
    if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
      setTimeout(onSuccess, 600);
    } else {
      setError("Payment did not complete. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {error && <div className="text-[13px]" style={{ color: "#B8264C" }}>{error}</div>}
      <button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full rounded-md px-4 py-2.5 text-[14px] disabled:opacity-50"
        style={{ background: "#3245FF", color: "#fff", fontWeight: 600 }}
      >
        {submitting ? <span className="inline-flex items-center gap-2 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Processing…</span> : `Pay ${(totalCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}`}
      </button>
    </form>
  );
}
