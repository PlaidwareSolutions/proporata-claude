import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import {
  useListBillingAccounts,
  useGetBillingAccount,
  usePostLedgerEntry,
  useBatchPostCharge,
  useVoidLedgerEntry,
  useUpdateLedgerEntry,
  getListBillingAccountsQueryKey,
  getGetBillingAccountQueryKey,
} from "@workspace/api-client-react";
import { Search, X, Layers, RotateCcw, Pencil, Zap, Gavel, ShieldAlert } from "lucide-react";
import { EvSessionDrawer, evSessionIdFromBatchRef } from "@/components/EvSessionDrawer";
import { InfoPopover } from "@/components/help/InfoPopover";

const CHARGE_TYPES = [
  { value: "monthly_assessment", label: "Monthly Assessment" },
  { value: "late_fee", label: "Late Fee" },
  { value: "special_assessment", label: "Special Assessment" },
  { value: "fine", label: "Fine" },
  { value: "ev_charging", label: "EV Charging" },
  { value: "other", label: "Other" },
] as const;

const PAYMENT_METHODS = [
  { value: "check", label: "Check" },
  { value: "ach_manual", label: "ACH (manual)" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
] as const;

function fmtUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dollarsToCents(s: string): number | null {
  const trimmed = s.trim().replace(/[$,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  return parseInt(whole, 10) * 100 + parseInt((frac + "00").slice(0, 2), 10);
}

function statusBadge(status: string): { label: string; bg: string; fg: string } {
  if (status === "past_due") return { label: "Past Due", bg: c.roseSoft, fg: c.rose };
  if (status === "credit") return { label: "Credit", bg: c.cobaltSoft, fg: c.cobalt };
  return { label: "Current", bg: c.emeraldSoft, fg: c.emerald };
}

export default function Billing() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [showBatch, setShowBatch] = useState(false);

  const { data: accounts = [], isLoading } = useListBillingAccounts();

  const filtered = useMemo(() => {
    if (!q) return accounts;
    const s = q.toLowerCase();
    return accounts.filter(
      (a) =>
        a.unitId.toLowerCase().includes(s) ||
        a.address.toLowerCase().includes(s) ||
        a.ownerName.toLowerCase().includes(s),
    );
  }, [accounts, q]);

  const totalDue = accounts.reduce((s, a) => s + Math.max(a.balanceCents, 0), 0);
  const pastDueCount = accounts.filter((a) => a.status === "past_due").length;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListBillingAccountsQueryKey() });
    if (selectedUnit) {
      queryClient.invalidateQueries({ queryKey: getGetBillingAccountQueryKey(selectedUnit) });
    }
  };

  return (
    <Layout title="Billing" subtitle="Owner accounts & ledger" actions={
      <button
        onClick={() => setShowBatch(true)}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] hover:opacity-90"
        style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
      >
        <Layers className="h-4 w-4" /> Bulk Post
      </button>
    }>
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Units" value={accounts.length.toString()} />
          <Stat label="Total Outstanding" value={fmtUsd(totalDue)} accent={c.rose} />
          <Stat label="Past Due Units" value={String(pastDueCount)} accent={pastDueCount > 0 ? c.rose : c.emerald} />
        </div>

        <div
          className="rounded-xl border"
          style={{ background: c.panel, borderColor: c.border }}
        >
          <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: c.border }}>
            <Search className="h-4 w-4" style={{ color: c.inkMute }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by unit, address, or owner…"
              className="flex-1 bg-transparent outline-none text-[13px]"
              style={{ color: c.ink }}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead style={{ background: c.canvas, color: c.inkSoft }}>
                <tr>
                  <Th>Unit</Th>
                  <Th>Address</Th>
                  <Th>Owner</Th>
                  <Th>Status</Th>
                  <Th align="right">
                    <span className="inline-flex items-center gap-0.5">Balance <InfoPopover termKey="balance" label="Balance" /></span>
                  </Th>
                  <Th>Last Activity</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={7} className="text-center py-8" style={{ color: c.inkMute }}>Loading…</td></tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-8" style={{ color: c.inkMute }}>No accounts.</td></tr>
                )}
                {filtered.map((a) => {
                  const sb = statusBadge(a.status);
                  return (
                    <tr key={a.unitId} className="border-t hover:bg-slate-50" style={{ borderColor: c.borderSoft }}>
                      <td className="px-4 py-2.5 font-mono-num" style={{ fontWeight: 600 }}>{a.unitId}</td>
                      <td className="px-4 py-2.5">{a.address}</td>
                      <td className="px-4 py-2.5">{a.ownerName}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-[10.5px] px-2 py-0.5 rounded-full" style={{ background: sb.bg, color: sb.fg, fontWeight: 700 }}>
                          {sb.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono-num" style={{ fontWeight: 600, color: a.balanceCents > 0 ? c.rose : a.balanceCents < 0 ? c.cobalt : c.ink }}>
                        {fmtUsd(a.balanceCents)}
                      </td>
                      <td className="px-4 py-2.5" style={{ color: c.inkMute }}>{a.lastActivity ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="inline-flex items-center gap-0.5">
                          <button
                            onClick={() => setSelectedUnit(a.unitId)}
                            className="text-[12px] hover:underline"
                            style={{ color: c.cobalt, fontWeight: 600 }}
                          >
                            Open ledger
                          </button>
                          <InfoPopover termKey="ledger" label="Ledger" />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selectedUnit && (
        <UnitLedgerDrawer
          unitId={selectedUnit}
          onClose={() => setSelectedUnit(null)}
          onChange={refresh}
        />
      )}

      {showBatch && (
        <BatchPostModal
          onClose={() => setShowBatch(false)}
          onPosted={() => {
            setShowBatch(false);
            refresh();
          }}
        />
      )}
    </Layout>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: c.panel, borderColor: c.border }}>
      <div className="text-[11.5px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>{label}</div>
      <div className="text-[22px] mt-1 font-mono-num" style={{ fontWeight: 700, color: accent ?? c.ink }}>{value}</div>
    </div>
  );
}

function Th({ children, align }: { children?: React.ReactNode; align?: "right" }) {
  return (
    <th
      className="px-4 py-2.5 text-[11.5px] uppercase tracking-wider"
      style={{ fontWeight: 700, textAlign: align ?? "left" }}
    >
      {children}
    </th>
  );
}

function UnitLedgerDrawer({
  unitId,
  onClose,
  onChange,
}: {
  unitId: string;
  onClose: () => void;
  onChange: () => void;
}) {
  const { data, isLoading } = useGetBillingAccount(unitId);
  const postEntry = usePostLedgerEntry();
  const voidEntry = useVoidLedgerEntry();
  const updateEntry = useUpdateLedgerEntry();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingMemo, setEditingMemo] = useState("");
  const [evOnly, setEvOnly] = useState(false);
  const [evSessionId, setEvSessionId] = useState<number | null>(null);

  const [mode, setMode] = useState<"charge" | "payment">("charge");
  const [chargeType, setChargeType] = useState<string>("monthly_assessment");
  const [paymentMethod, setPaymentMethod] = useState<string>("check");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [occurredOn, setOccurredOn] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = dollarsToCents(amount);
    if (!cents || cents <= 0) {
      setError("Enter a valid positive amount");
      return;
    }
    try {
      await postEntry.mutateAsync({
        unitId,
        data: {
          kind: mode,
          amountCents: cents,
          occurredOn,
          memo: memo || undefined,
          chargeType: mode === "charge" ? (chargeType as "monthly_assessment") : undefined,
          paymentMethod: mode === "payment" ? (paymentMethod as "check") : undefined,
        },
      });
      setAmount("");
      setMemo("");
      onChange();
    } catch (err: any) {
      setError(err?.message ?? "Failed to post entry");
    }
  }

  async function saveMemo(id: number) {
    try {
      await updateEntry.mutateAsync({ id, data: { memo: editingMemo } });
      setEditingId(null);
      setEditingMemo("");
      onChange();
    } catch (err: any) {
      alert(err?.message ?? "Failed to update memo");
    }
  }

  async function handleVoid(id: number) {
    if (!confirm("Void this entry? This action posts a reversing void and cannot be undone.")) return;
    try {
      await voidEntry.mutateAsync({ id });
      onChange();
    } catch (err: any) {
      alert(err?.message ?? "Failed to void");
    }
  }

  const sb = data ? statusBadge(data.status) : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(15,21,48,0.4)" }}>
      <div className="h-full w-full max-w-2xl overflow-y-auto" style={{ background: c.panel }}>
        <div className="sticky top-0 flex items-center justify-between px-5 py-4 border-b" style={{ background: c.panel, borderColor: c.border }}>
          <div>
            <div className="text-[16px]" style={{ fontWeight: 700 }}>
              {data ? `Unit ${data.unitLabel} — ${data.address}` : `Unit ${unitId}`}
            </div>
            {data && (
              <div className="text-[12.5px] mt-0.5" style={{ color: c.inkSoft }}>
                Owner: {data.ownerName} · Occupancy: {data.occupancy}
              </div>
            )}
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        {isLoading || !data ? (
          <div className="p-8 text-center text-[13px]" style={{ color: c.inkMute }}>Loading ledger…</div>
        ) : (
          <div className="p-5 space-y-5">
            <div className="rounded-xl border p-4" style={{ borderColor: c.border, background: c.canvas }}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11.5px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>
                    Current Balance
                  </div>
                  <div className="text-[28px] mt-1 font-mono-num" style={{ fontWeight: 700, color: data.balanceCents > 0 ? c.rose : data.balanceCents < 0 ? c.cobalt : c.ink }}>
                    {fmtUsd(data.balanceCents)}
                  </div>
                </div>
                {sb && (
                  <span className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: sb.bg, color: sb.fg, fontWeight: 700 }}>
                    {sb.label}
                  </span>
                )}
              </div>
            </div>

            <form onSubmit={submit} className="rounded-xl border p-4 space-y-3" style={{ borderColor: c.border }}>
              <div className="text-[13.5px]" style={{ fontWeight: 700 }}>Post a new entry</div>
              <div className="flex gap-2">
                {(["charge", "payment"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className="rounded-md border px-3 py-1.5 text-[12.5px]"
                    style={{
                      background: mode === m ? c.cobalt : "#fff",
                      borderColor: mode === m ? c.cobalt : c.border,
                      color: mode === m ? "#fff" : c.inkSoft,
                      fontWeight: 600,
                    }}
                  >
                    {m === "charge" ? "Charge" : "Payment"}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {mode === "charge" ? (
                  <label className="inline-flex items-center gap-1">
                    <select value={chargeType} onChange={(e) => setChargeType(e.target.value)} className="rounded-lg border px-3 py-2 text-[13px] flex-1" style={{ borderColor: c.border, background: "#fff" }}>
                      {CHARGE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <InfoPopover termKey="assessment" label="Assessment" />
                  </label>
                ) : (
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: c.border, background: "#fff" }}>
                    {PAYMENT_METHODS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                )}
                <input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} className="rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: c.border, background: "#fff" }} />
              </div>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (e.g. 250.00)" className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: c.border }} />
              <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Memo (optional)" className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: c.border }} />
              {error && <div className="text-[12px]" style={{ color: c.rose }}>{error}</div>}
              <button type="submit" disabled={postEntry.isPending} className="rounded-lg px-4 py-2 text-[13px] disabled:opacity-60" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
                {postEntry.isPending ? "Posting…" : `Post ${mode === "charge" ? "Charge" : "Payment"}`}
              </button>
            </form>

            {(() => {
              const evEntries = data.entries.filter((e) => e.chargeType === "ev_charging");
              const evNet = evEntries.reduce((s, e) => {
                if (e.voidedAt) return s;
                if (e.kind === "charge") return s + e.amountCents;
                if (e.kind === "refund") return s + e.amountCents; // amountCents is negative for refunds
                return s;
              }, 0);
              if (evEntries.length === 0) return null;
              return (
                <div className="rounded-xl border p-4 flex items-center gap-3" style={{ borderColor: c.border, background: c.cobaltSoft }}>
                  <Zap className="h-5 w-5" style={{ color: c.cobalt }} />
                  <div className="flex-1">
                    <div className="text-[12.5px]" style={{ fontWeight: 700, color: c.cobalt }}>
                      EV charging summary
                    </div>
                    <div className="text-[11.5px]" style={{ color: c.inkSoft }}>
                      {evEntries.length} {evEntries.length === 1 ? "entry" : "entries"} · net {fmtUsd(evNet)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEvOnly((v) => !v)}
                    className="text-[12px] rounded-md px-2.5 py-1 hover:opacity-90"
                    style={{
                      background: evOnly ? c.cobalt : "#fff",
                      color: evOnly ? "#fff" : c.cobalt,
                      border: `1px solid ${c.cobalt}`,
                      fontWeight: 600,
                    }}
                  >
                    {evOnly ? "Show all" : "EV only"}
                  </button>
                </div>
              );
            })()}

            <div className="rounded-xl border" style={{ borderColor: c.border }}>
              <div className="px-4 py-3 border-b text-[13.5px] flex items-center justify-between" style={{ borderColor: c.border, fontWeight: 700 }}>
                <span>Ledger ({(evOnly ? data.entries.filter((e) => e.chargeType === "ev_charging") : data.entries).length}{evOnly ? ` of ${data.entries.length}` : ""})</span>
                {evOnly && (
                  <button
                    type="button"
                    onClick={() => setEvOnly(false)}
                    className="text-[11.5px] hover:underline"
                    style={{ color: c.cobalt, fontWeight: 600 }}
                  >
                    Clear EV-only filter
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead style={{ background: c.canvas, color: c.inkSoft }}>
                    <tr>
                      <Th>Date</Th>
                      <Th>Description</Th>
                      <Th align="right">Charge</Th>
                      <Th align="right">Payment</Th>
                      <Th align="right">Balance</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const visible = evOnly
                        ? data.entries.filter((e) => e.chargeType === "ev_charging")
                        : data.entries;
                      if (visible.length === 0) {
                        return (
                          <tr><td colSpan={6} className="text-center py-6" style={{ color: c.inkMute }}>
                            {evOnly ? "No EV charging entries." : "No entries yet."}
                          </td></tr>
                        );
                      }
                      return visible.map((e) => {
                      const isCharge = e.kind === "charge" && !e.voidedAt;
                      const isPayment = e.kind === "payment" && !e.voidedAt;
                      const isVoidEntry = e.kind === "void" || e.kind === "refund";
                      const ageDays = (Date.now() - new Date(e.postedAt).getTime()) / 86400000;
                      const editable = !e.voidedAt && !isVoidEntry && ageDays <= 30;
                      const isEditing = editingId === e.id;
                      const isEv = e.chargeType === "ev_charging";
                      const evSidFromEntry = isEv ? evSessionIdFromBatchRef(e.batchRef ?? null) : null;
                      const baseLabel = e.kind === "refund"
                        ? `Refund${e.voidsEntryId ? ` of #${e.voidsEntryId}` : ""}`
                        : isVoidEntry
                          ? `Void of #${e.voidsEntryId ?? ""}`
                          : `${labelFor(e)}${e.voidedAt ? "  (VOIDED)" : ""}`;
                      return (
                        <tr key={e.id} className="border-t" style={{ borderColor: c.borderSoft, opacity: e.voidedAt ? 0.55 : 1 }}>
                          <td className="px-4 py-2 font-mono-num">{e.occurredOn}</td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              {e.sourceMotionId ? (
                                <a
                                  href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/motions?open=${e.sourceMotionId}`}
                                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10.5px] hover:underline"
                                  style={{ background: "#E5E8FF", color: "#3245FF", fontWeight: 700 }}
                                  title={`Authorized by Motion M-${e.sourceMotionId}. Click to open motion.`}
                                >
                                  <Gavel className="h-3 w-3" /> M-{e.sourceMotionId}
                                </a>
                              ) : null}
                              {e.emergencyBypassId ? (
                                <span
                                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10.5px]"
                                  style={{ background: "#FFEFD0", color: "#9A6500", fontWeight: 700 }}
                                  title={`Authorized via Emergency Bypass #${e.emergencyBypassId} (pending board ratification).`}
                                >
                                  <ShieldAlert className="h-3 w-3" /> Bypass #{e.emergencyBypassId}
                                </span>
                              ) : null}
                              {evSidFromEntry != null ? (
                                <button
                                  type="button"
                                  onClick={() => setEvSessionId(evSidFromEntry)}
                                  className="hover:underline inline-flex items-center gap-1"
                                  style={{ color: c.cobalt, fontWeight: 600 }}
                                  title="View EV charging session details"
                                >
                                  <Zap className="h-3 w-3" /> {baseLabel}
                                </button>
                              ) : (
                                <span>{baseLabel}</span>
                              )}
                              {e.stripePaymentIntentId && (
                                <a
                                  href={`https://dashboard.stripe.com/payments/${e.stripePaymentIntentId}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11.5px] inline-flex items-center gap-0.5"
                                  style={{ color: c.cobalt }}
                                  title="Open in Stripe"
                                >
                                  Stripe ↗
                                </a>
                              )}
                            </div>
                            {isEditing ? (
                              <div className="flex items-center gap-1.5 mt-1">
                                <input
                                  value={editingMemo}
                                  onChange={(ev) => setEditingMemo(ev.target.value)}
                                  className="flex-1 rounded border px-2 py-1 text-[12px]"
                                  style={{ borderColor: c.border }}
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  onClick={() => saveMemo(e.id)}
                                  disabled={updateEntry.isPending}
                                  className="text-[11.5px] px-2 py-1 rounded"
                                  style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setEditingId(null); setEditingMemo(""); }}
                                  className="text-[11.5px] px-2 py-1 rounded border"
                                  style={{ borderColor: c.border }}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              e.memo && <div className="text-[11.5px] mt-0.5" style={{ color: c.inkMute }}>{e.memo}</div>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right font-mono-num">{isCharge ? fmtUsd(e.amountCents) : isVoidEntry && e.amountCents > 0 ? fmtUsd(e.amountCents) : "—"}</td>
                          <td className="px-4 py-2 text-right font-mono-num">{isPayment ? fmtUsd(e.amountCents) : isVoidEntry && e.amountCents < 0 ? fmtUsd(-e.amountCents) : "—"}</td>
                          <td className="px-4 py-2 text-right font-mono-num" style={{ fontWeight: 600 }}>{fmtUsd(e.runningBalanceCents ?? 0)}</td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            {editable && !isEditing && (
                              <button
                                onClick={() => { setEditingId(e.id); setEditingMemo(e.memo ?? ""); }}
                                className="text-[11.5px] hover:underline mr-2"
                                style={{ color: c.cobalt, fontWeight: 600 }}
                                title="Edit memo (within 30 days)"
                              >
                                <Pencil className="inline h-3 w-3 mr-0.5" /> Memo
                              </button>
                            )}
                            {editable && !isEditing && (
                              <button onClick={() => handleVoid(e.id)} className="text-[11.5px] hover:underline" style={{ color: c.rose, fontWeight: 600 }}>
                                <RotateCcw className="inline h-3 w-3 mr-0.5" /> Void
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
      {evSessionId != null && (
        <EvSessionDrawer
          sessionId={evSessionId}
          isManager
          onClose={() => setEvSessionId(null)}
        />
      )}
    </div>
  );
}

function labelFor(e: { kind: string; chargeType?: string | null; paymentMethod?: string | null }): string {
  if (e.kind === "charge") {
    return CHARGE_TYPES.find((t) => t.value === e.chargeType)?.label ?? "Charge";
  }
  if (e.kind === "payment") {
    return `Payment — ${PAYMENT_METHODS.find((t) => t.value === e.paymentMethod)?.label ?? "Payment"}`;
  }
  if (e.kind === "refund") return "Refund";
  return "Void";
}

function BatchPostModal({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const batch = useBatchPostCharge();
  const [chargeType, setChargeType] = useState("monthly_assessment");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = dollarsToCents(amount);
    if (!cents || cents <= 0) {
      setError("Enter a valid positive amount");
      return;
    }
    try {
      const res = await batch.mutateAsync({
        data: {
          chargeType: chargeType as "monthly_assessment",
          amountCents: cents,
          occurredOn,
          memo: memo || undefined,
        },
      });
      setResult(`Posted ${res.count} entries (batch ${res.batchRef}).`);
      setTimeout(() => onPosted(), 1200);
    } catch (err: any) {
      setError(err?.message ?? "Batch post failed");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,21,48,0.5)" }}>
      <div className="w-full max-w-md rounded-xl p-5 space-y-4" style={{ background: c.panel }}>
        <div className="flex items-center justify-between">
          <div className="text-[16px]" style={{ fontWeight: 700 }}>Bulk post charge</div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <select value={chargeType} onChange={(e) => setChargeType(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: c.border }}>
            {CHARGE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount per unit (e.g. 250.00)" className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: c.border }} />
          <input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: c.border }} />
          <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Memo (optional)" className="w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: c.border }} />
          <div className="text-[12px]" style={{ color: c.inkMute }}>
            Will apply to all units in the community. Each unit gets its own ledger entry tied to a shared batch reference.
          </div>
          {error && <div className="text-[12px]" style={{ color: c.rose }}>{error}</div>}
          {result && <div className="text-[12px]" style={{ color: c.emerald }}>{result}</div>}
          <button type="submit" disabled={batch.isPending} className="w-full rounded-lg px-4 py-2 text-[13px] disabled:opacity-60" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
            {batch.isPending ? "Posting…" : "Post to all units"}
          </button>
        </form>
      </div>
    </div>
  );
}
