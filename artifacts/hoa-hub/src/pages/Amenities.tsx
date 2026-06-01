// Task #77: Manager-facing Amenities admin page.
// Task #83: Adds Inspections and Pool chemistry tabs.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import {
  Building2, Check, X, RotateCcw, Loader2, ClipboardCheck, AlertTriangle,
  ShieldAlert, Droplets, Plus, Settings as SettingsIcon, Upload, Save,
} from "lucide-react";
import {
  useListAmenities,
  useUpdateAmenity,
  useRequestUploadUrl,
  useListAmenityBookings,
  useMarkAmenityBookingPaid,
  useCancelAmenityBooking,
  useRefundAmenityBooking,
  useListAmenityBookingInspections,
  useCreateAmenityBookingInspection,
  useUpdateAmenityInspection,
  useSubmitAmenityInspection,
  useListAmenityBookingDamageReports,
  useCreateAmenityDamageReport,
  useChargeAmenityDamageReport,
  useWaiveAmenityDamageReport,
  useCreateAmenityDamageWorkOrder,
  useListAmenityBookingDepositLedger,
  useListPoolChemistryLogs,
  useCreatePoolChemistryLog,
  getListAmenityBookingsQueryKey,
  getListAmenitiesQueryKey,
  getListAmenityBookingInspectionsQueryKey,
  getListAmenityBookingDamageReportsQueryKey,
  getListAmenityBookingDepositLedgerQueryKey,
  getListPoolChemistryLogsQueryKey,
  type Amenity,
  type AmenityRules,
  type AmenityBookingStatus,
  type AmenityInspection,
  type AmenityInspectionItemResult,
} from "@workspace/api-client-react";

const STATUS_OPTIONS: Array<{ value: AmenityBookingStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending_payment", label: "Awaiting deposit" },
  { value: "confirmed", label: "Confirmed" },
  { value: "used_pending_inspection", label: "Pending inspection" },
  { value: "used", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "forfeited", label: "Forfeited" },
  { value: "refunded", label: "Refunded" },
];

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
function fmtCents(n: number) { return n === 0 ? "—" : `$${(n / 100).toFixed(2)}`; }

export default function Amenities() {
  const [tab, setTab] = useState<"reservations" | "inspections" | "chemistry" | "settings">("reservations");

  return (
    <Layout title="Amenities" subtitle="Reservations, inspections, and pool log">
      <div className="mb-4 flex gap-1 border-b" style={{ borderColor: c.border }}>
        <TabBtn active={tab === "reservations"} onClick={() => setTab("reservations")} icon={<Building2 className="h-3.5 w-3.5" />} label="Reservations" testId="tab-reservations" />
        <TabBtn active={tab === "inspections"} onClick={() => setTab("inspections")} icon={<ClipboardCheck className="h-3.5 w-3.5" />} label="Inspections" testId="tab-inspections" />
        <TabBtn active={tab === "chemistry"} onClick={() => setTab("chemistry")} icon={<Droplets className="h-3.5 w-3.5" />} label="Pool chemistry" testId="tab-chemistry" />
        <TabBtn active={tab === "settings"} onClick={() => setTab("settings")} icon={<SettingsIcon className="h-3.5 w-3.5" />} label="Settings" testId="tab-settings" />
      </div>
      {tab === "reservations" && <ReservationsTab />}
      {tab === "inspections" && <InspectionsTab />}
      {tab === "chemistry" && <ChemistryTab />}
      {tab === "settings" && <SettingsTab />}
    </Layout>
  );
}

function TabBtn({ active, onClick, icon, label, testId }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; testId: string }) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className="px-3 py-2 text-[13px] inline-flex items-center gap-1.5 -mb-px border-b-2"
      style={{
        borderColor: active ? c.cobalt : "transparent",
        color: active ? c.cobalt : c.inkSoft,
        fontWeight: active ? 700 : 500,
      }}
    >
      {icon}{label}
    </button>
  );
}

function ReservationsTab() {
  const [status, setStatus] = useState<AmenityBookingStatus | "all">("all");
  const [activeBookingId, setActiveBookingId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const params = status === "all" ? undefined : { status };
  const { data: bookings = [], isLoading } = useListAmenityBookings(params);
  const { data: amenities = [] } = useListAmenities();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAmenityBookingsQueryKey(params) });
  const markPaid = useMarkAmenityBookingPaid({ mutation: { onSuccess: invalidate } });
  const cancel = useCancelAmenityBooking({ mutation: { onSuccess: invalidate } });
  const refund = useRefundAmenityBooking({ mutation: { onSuccess: invalidate } });

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[15px]" style={{ fontWeight: 700 }}>Reservations</h3>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as AmenityBookingStatus | "all")}
            className="rounded-md border px-2.5 py-1.5 text-[12.5px] bg-white"
            style={{ borderColor: c.border }}
            data-testid="select-amenity-status-filter"
          >
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 text-[13px]" style={{ color: c.inkMute }}>
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : bookings.length === 0 ? (
          <div className="rounded-xl border bg-white p-6 text-[13px]" style={{ borderColor: c.border, color: c.inkMute }}>
            No reservations yet.
          </div>
        ) : (
          <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
            <table className="w-full text-[12.5px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-3 py-2" style={{ color: c.inkSoft }}>Amenity</th>
                  <th className="text-left px-3 py-2" style={{ color: c.inkSoft }}>Owner</th>
                  <th className="text-left px-3 py-2" style={{ color: c.inkSoft }}>When</th>
                  <th className="text-left px-3 py-2" style={{ color: c.inkSoft }}>Status</th>
                  <th className="text-left px-3 py-2" style={{ color: c.inkSoft }}>Deposit</th>
                  <th className="text-right px-3 py-2" style={{ color: c.inkSoft }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-t" style={{ borderColor: c.border }}>
                    <td className="px-3 py-2">{b.amenityName}</td>
                    <td className="px-3 py-2">
                      <div>{b.ownerName}</div>
                      {b.unitId && <div className="text-[11px]" style={{ color: c.inkMute }}>Unit {b.unitId}</div>}
                    </td>
                    <td className="px-3 py-2">{fmtDateTime(b.startsAt)} – {fmtDateTime(b.endsAt)}</td>
                    <td className="px-3 py-2">{b.status}</td>
                    <td className="px-3 py-2">
                      {fmtCents(b.depositCents)}
                      {b.depositPaidAt && <div className="text-[11px]" style={{ color: "#0E6F45" }}>Paid</div>}
                      {b.depositRefundedAt && <div className="text-[11px]" style={{ color: c.inkMute }}>Refunded</div>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        <button
                          onClick={() => setActiveBookingId(b.id)}
                          className="rounded-md border px-2 py-1 text-[11.5px] inline-flex items-center gap-1"
                          style={{ borderColor: c.border, color: c.cobalt }}
                          data-testid={`button-inspect-${b.id}`}
                        >
                          <ClipboardCheck className="h-3 w-3" /> Inspect
                        </button>
                        {b.status === "pending_payment" && (
                          <button
                            onClick={() => markPaid.mutate({ id: b.id })}
                            disabled={markPaid.isPending}
                            className="rounded-md border px-2 py-1 text-[11.5px] inline-flex items-center gap-1"
                            style={{ borderColor: c.border, color: "#0E6F45" }}
                            data-testid={`button-mark-paid-${b.id}`}
                          >
                            <Check className="h-3 w-3" /> Mark paid
                          </button>
                        )}
                        {(b.status === "confirmed" || b.status === "pending_payment") && (
                          <button
                            onClick={() => {
                              const reason = prompt("Cancellation reason (optional)") ?? "";
                              cancel.mutate({ id: b.id, data: { reason } });
                            }}
                            disabled={cancel.isPending}
                            className="rounded-md border px-2 py-1 text-[11.5px] inline-flex items-center gap-1"
                            style={{ borderColor: c.border, color: "#9A2542" }}
                            data-testid={`button-cancel-${b.id}`}
                          >
                            <X className="h-3 w-3" /> Cancel
                          </button>
                        )}
                        {b.depositPaidAt && !b.depositRefundedAt && (
                          <button
                            onClick={() => {
                              const note = prompt("Refund note (optional)") ?? "";
                              refund.mutate({ id: b.id, data: { note } });
                            }}
                            disabled={refund.isPending}
                            className="rounded-md border px-2 py-1 text-[11.5px] inline-flex items-center gap-1"
                            style={{ borderColor: c.border, color: c.inkSoft }}
                            data-testid={`button-refund-${b.id}`}
                          >
                            <RotateCcw className="h-3 w-3" /> Refund
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="text-[15px] mb-3" style={{ fontWeight: 700 }}>Amenity catalog</h3>
        <div className="grid grid-cols-2 gap-3">
          {amenities.map((a) => (
            <div key={a.id} className="rounded-xl border bg-white p-4" style={{ borderColor: c.border }}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-[14px]" style={{ fontWeight: 700 }}>{a.name}</h4>
                  <p className="text-[12px] mt-0.5" style={{ color: c.inkMute }}>{a.description}</p>
                </div>
                <Building2 className="h-4 w-4 mt-1" style={{ color: c.inkMute }} />
              </div>
              <div className="mt-2 text-[11.5px] flex flex-wrap gap-2" style={{ color: c.inkSoft }}>
                <span>{a.bookingUnit}</span>
                <span>·</span>
                <span>Capacity {a.capacity || "—"}</span>
                <span>·</span>
                <span>Deposit {fmtCents(a.depositCents)}</span>
                <span>·</span>
                <span style={{ color: a.enabled ? "#0E6F45" : "#9A2542" }}>{a.enabled ? "Enabled" : "Disabled"}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {activeBookingId !== null && (
        <BookingInspectionDrawer bookingId={activeBookingId} onClose={() => setActiveBookingId(null)} />
      )}
    </div>
  );
}

function InspectionsTab() {
  const [filter, setFilter] = useState<"all" | "pending" | "flagged">("pending");
  const params = filter === "pending" ? { status: "used_pending_inspection" as AmenityBookingStatus } : undefined;
  const { data: bookings = [], isLoading } = useListAmenityBookings(params);
  const [activeBookingId, setActiveBookingId] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px]" style={{ fontWeight: 700 }}>Inspections</h3>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as "all" | "pending" | "flagged")}
          className="rounded-md border px-2.5 py-1.5 text-[12.5px] bg-white"
          style={{ borderColor: c.border }}
        >
          <option value="pending">Pending post-inspection</option>
          <option value="all">All bookings</option>
        </select>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: c.inkMute }}><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : bookings.length === 0 ? (
        <div className="rounded-xl border bg-white p-6 text-[13px]" style={{ borderColor: c.border, color: c.inkMute }}>
          Nothing waiting on inspection.
        </div>
      ) : (
        <div className="space-y-2">
          {bookings.map((b) => (
            <div key={b.id} className="rounded-lg border bg-white p-4 flex items-center justify-between" style={{ borderColor: c.border }}>
              <div>
                <div className="text-[13.5px]" style={{ fontWeight: 600 }}>{b.amenityName} — {b.ownerName}</div>
                <div className="text-[12px]" style={{ color: c.inkMute }}>{fmtDateTime(b.startsAt)} – {fmtDateTime(b.endsAt)}</div>
                <div className="text-[11.5px] mt-1" style={{ color: c.inkSoft }}>Status: {b.status} · Deposit {fmtCents(b.depositCents)}</div>
              </div>
              <button
                onClick={() => setActiveBookingId(b.id)}
                className="rounded-md px-3 py-1.5 text-[12.5px] inline-flex items-center gap-1.5"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                data-testid={`button-open-inspection-${b.id}`}
              >
                <ClipboardCheck className="h-3.5 w-3.5" /> Open
              </button>
            </div>
          ))}
        </div>
      )}
      {activeBookingId !== null && (
        <BookingInspectionDrawer bookingId={activeBookingId} onClose={() => setActiveBookingId(null)} />
      )}
    </div>
  );
}

function BookingInspectionDrawer({ bookingId, onClose }: { bookingId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: inspections = [] } = useListAmenityBookingInspections(bookingId);
  const { data: damages = [] } = useListAmenityBookingDamageReports(bookingId);
  const { data: ledger = [] } = useListAmenityBookingDepositLedger(bookingId);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListAmenityBookingInspectionsQueryKey(bookingId) });
    queryClient.invalidateQueries({ queryKey: getListAmenityBookingDamageReportsQueryKey(bookingId) });
    queryClient.invalidateQueries({ queryKey: getListAmenityBookingDepositLedgerQueryKey(bookingId) });
    queryClient.invalidateQueries({ queryKey: getListAmenityBookingsQueryKey() });
  };

  const createInspection = useCreateAmenityBookingInspection({ mutation: { onSuccess: invalidateAll } });
  const createDamage = useCreateAmenityDamageReport({ mutation: { onSuccess: invalidateAll } });
  const charge = useChargeAmenityDamageReport({ mutation: { onSuccess: invalidateAll } });
  const waive = useWaiveAmenityDamageReport({ mutation: { onSuccess: invalidateAll } });
  const createWO = useCreateAmenityDamageWorkOrder({ mutation: { onSuccess: invalidateAll } });

  const [damageOpen, setDamageOpen] = useState(false);
  const [damageSummary, setDamageSummary] = useState("");
  const [damageDetails, setDamageDetails] = useState("");
  const [damageEstimate, setDamageEstimate] = useState(0);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end">
      <div className="bg-white w-full max-w-2xl h-full overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: c.border }}>
          <h3 className="text-[15px]" style={{ fontWeight: 700 }}>Booking #{bookingId} — inspection &amp; damage</h3>
          <button onClick={onClose}><X className="h-4 w-4" style={{ color: c.inkMute }} /></button>
        </div>
        <div className="p-5 space-y-6">
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[14px]" style={{ fontWeight: 700 }}>Inspections</h4>
              <div className="flex gap-1.5">
                {(["pre", "post"] as const).map((kind) => (
                  <button
                    key={kind}
                    onClick={() => createInspection.mutate({ id: bookingId, data: { kind } })}
                    disabled={createInspection.isPending}
                    className="text-[11.5px] rounded-md border px-2 py-1 inline-flex items-center gap-1"
                    style={{ borderColor: c.border, color: c.cobalt }}
                    data-testid={`button-create-${kind}-inspection`}
                  >
                    <Plus className="h-3 w-3" /> {kind === "pre" ? "Pre-use" : "Post-use"}
                  </button>
                ))}
              </div>
            </div>
            {inspections.length === 0 ? (
              <div className="text-[12.5px]" style={{ color: c.inkMute }}>No inspections yet.</div>
            ) : (
              <div className="space-y-3">
                {inspections.map((insp) => (
                  <InspectionCard key={insp.id} inspection={insp} bookingId={bookingId} onChange={invalidateAll} />
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[14px]" style={{ fontWeight: 700 }}>Damage reports</h4>
              <button
                onClick={() => setDamageOpen((v) => !v)}
                className="text-[11.5px] rounded-md border px-2 py-1 inline-flex items-center gap-1"
                style={{ borderColor: c.border, color: "#9A2542" }}
                data-testid="button-toggle-damage-form"
              >
                <ShieldAlert className="h-3 w-3" /> {damageOpen ? "Cancel" : "File damage"}
              </button>
            </div>
            {damageOpen && (
              <div className="rounded-lg border p-3 mb-3 space-y-2" style={{ borderColor: c.border, background: "#FFFBEA" }}>
                <input
                  value={damageSummary}
                  onChange={(e) => setDamageSummary(e.target.value)}
                  placeholder="Short summary (e.g. Wall scratched in main hall)"
                  className="w-full rounded-md border px-2.5 py-1.5 text-[13px]"
                  style={{ borderColor: c.border }}
                  data-testid="input-damage-summary"
                />
                <textarea
                  value={damageDetails}
                  onChange={(e) => setDamageDetails(e.target.value)}
                  placeholder="Details"
                  rows={3}
                  className="w-full rounded-md border px-2.5 py-1.5 text-[13px]"
                  style={{ borderColor: c.border }}
                />
                <div className="flex items-center gap-2">
                  <span className="text-[12px]" style={{ color: c.inkMute }}>Estimated cost (¢):</span>
                  <input
                    type="number"
                    min={0}
                    value={damageEstimate}
                    onChange={(e) => setDamageEstimate(parseInt(e.target.value, 10) || 0)}
                    className="w-32 rounded-md border px-2.5 py-1.5 text-[13px]"
                    style={{ borderColor: c.border }}
                  />
                  <button
                    onClick={() => {
                      if (!damageSummary.trim()) return;
                      createDamage.mutate({
                        id: bookingId,
                        data: { summary: damageSummary, details: damageDetails, estimatedCostCents: damageEstimate },
                      }, {
                        onSuccess: () => {
                          setDamageOpen(false);
                          setDamageSummary("");
                          setDamageDetails("");
                          setDamageEstimate(0);
                        },
                      });
                    }}
                    disabled={createDamage.isPending || !damageSummary.trim()}
                    className="ml-auto text-[12.5px] rounded-md px-3 py-1.5"
                    style={{ background: "#9A2542", color: "#fff", fontWeight: 600 }}
                    data-testid="button-submit-damage"
                  >
                    File report
                  </button>
                </div>
              </div>
            )}
            {damages.length === 0 ? (
              <div className="text-[12.5px]" style={{ color: c.inkMute }}>No damage reports.</div>
            ) : (
              <div className="space-y-2">
                {damages.map((d) => (
                  <div key={d.id} className="rounded-lg border bg-white p-3" style={{ borderColor: c.border }}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[13px]" style={{ fontWeight: 600 }}>
                          <AlertTriangle className="inline h-3.5 w-3.5 mr-1" style={{ color: "#9A2542" }} />
                          {d.summary}
                        </div>
                        {d.details && <div className="text-[12px] mt-1" style={{ color: c.inkMute }}>{d.details}</div>}
                        <div className="text-[11.5px] mt-1" style={{ color: c.inkSoft }}>
                          Status: <strong>{d.status}</strong> · Estimate {fmtCents(d.estimatedCostCents)}
                          {d.depositChargedCents > 0 && ` · Charged ${fmtCents(d.depositChargedCents)}`}
                          {d.workOrderId && ` · WO ${d.workOrderId}`}
                        </div>
                      </div>
                      <div className="flex gap-1.5 flex-wrap justify-end">
                        {(d.status === "open" || d.status === "disputed") && (
                          <>
                            <button
                              onClick={() => charge.mutate({ id: d.id, data: { amountCents: d.estimatedCostCents } })}
                              disabled={charge.isPending}
                              className="text-[11.5px] rounded-md border px-2 py-1"
                              style={{ borderColor: c.border, color: "#9A2542" }}
                              data-testid={`button-charge-damage-${d.id}`}
                            >
                              Charge deposit
                            </button>
                            <button
                              onClick={() => waive.mutate({ id: d.id, data: { managerNotes: "" } })}
                              disabled={waive.isPending}
                              className="text-[11.5px] rounded-md border px-2 py-1"
                              style={{ borderColor: c.border, color: "#0E6F45" }}
                              data-testid={`button-waive-damage-${d.id}`}
                            >
                              Waive
                            </button>
                          </>
                        )}
                        {!d.workOrderId && (
                          <button
                            onClick={() => createWO.mutate({ id: d.id, data: { building: 1, priority: "high" } })}
                            disabled={createWO.isPending}
                            className="text-[11.5px] rounded-md border px-2 py-1"
                            style={{ borderColor: c.border, color: c.cobalt }}
                            data-testid={`button-damage-wo-${d.id}`}
                          >
                            Create WO
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h4 className="text-[14px] mb-2" style={{ fontWeight: 700 }}>Deposit ledger</h4>
            {ledger.length === 0 ? (
              <div className="text-[12.5px]" style={{ color: c.inkMute }}>No ledger entries.</div>
            ) : (
              <div className="rounded-lg border bg-white overflow-hidden" style={{ borderColor: c.border }}>
                <table className="w-full text-[12.5px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-3 py-2" style={{ color: c.inkSoft }}>When</th>
                      <th className="text-left px-3 py-2" style={{ color: c.inkSoft }}>Kind</th>
                      <th className="text-right px-3 py-2" style={{ color: c.inkSoft }}>Amount</th>
                      <th className="text-right px-3 py-2" style={{ color: c.inkSoft }}>Balance</th>
                      <th className="text-left px-3 py-2" style={{ color: c.inkSoft }}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((e) => (
                      <tr key={e.id} className="border-t" style={{ borderColor: c.border }}>
                        <td className="px-3 py-1.5">{fmtDateTime(e.createdAt)}</td>
                        <td className="px-3 py-1.5">{e.kind}</td>
                        <td className="px-3 py-1.5 text-right">{fmtCents(e.amountCents)}</td>
                        <td className="px-3 py-1.5 text-right">{fmtCents(e.balanceCents)}</td>
                        <td className="px-3 py-1.5">{e.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function InspectionCard({ inspection, bookingId, onChange }: { inspection: AmenityInspection; bookingId: number; onChange: () => void }) {
  const update = useUpdateAmenityInspection();
  const submit = useSubmitAmenityInspection({ mutation: { onSuccess: () => onChange() } });
  const [items, setItems] = useState<AmenityInspectionItemResult[]>(inspection.items);
  const [notes, setNotes] = useState(inspection.notes);
  const [signature, setSignature] = useState(inspection.signature);
  const submitted = inspection.status === "submitted";

  const setItem = (id: number, patch: Partial<AmenityInspectionItemResult>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  const save = () => {
    update.mutate({
      id: inspection.id,
      data: {
        notes, signature,
        items: items.map((i) => ({ id: i.id, status: i.status, note: i.note, photoStorageKey: i.photoStorageKey })),
      },
    }, { onSuccess: () => onChange() });
  };

  return (
    <div className="rounded-lg border bg-white" style={{ borderColor: c.border }}>
      <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: c.border }}>
        <div className="text-[12.5px]" style={{ fontWeight: 600 }}>
          {inspection.kind === "pre" ? "Pre-use" : inspection.kind === "post" ? "Post-use" : "Owner self"} ·
          {" "}<span style={{ color: submitted ? "#0E6F45" : c.inkMute, fontWeight: 600 }}>{inspection.status}</span>
        </div>
        <div className="text-[11px]" style={{ color: c.inkMute }}>
          by {inspection.inspectorName} {inspection.performedAt ? `· ${fmtDateTime(inspection.performedAt)}` : ""}
        </div>
      </div>
      <div className="p-3 space-y-2">
        {items.length === 0 ? (
          <div className="text-[12px]" style={{ color: c.inkMute }}>No checklist items associated.</div>
        ) : items.map((it) => (
          <div key={it.id} className="rounded border p-2 text-[12.5px]" style={{ borderColor: c.border }}>
            <div className="flex items-center justify-between gap-2">
              <span>{it.label}</span>
              <select
                value={it.status}
                disabled={submitted}
                onChange={(e) => setItem(it.id, { status: e.target.value as AmenityInspectionItemResult["status"] })}
                className="rounded border px-1.5 py-0.5 text-[12px]"
                style={{ borderColor: c.border }}
                data-testid={`select-item-${it.id}`}
              >
                <option value="ok">OK</option>
                <option value="flagged">Flagged</option>
                <option value="na">N/A</option>
              </select>
            </div>
            {it.status === "flagged" && !submitted && (
              <input
                value={it.note}
                onChange={(e) => setItem(it.id, { note: e.target.value })}
                placeholder="Note"
                className="mt-1 w-full rounded border px-2 py-1 text-[12px]"
                style={{ borderColor: c.border }}
              />
            )}
            {submitted && it.note && <div className="text-[11.5px] mt-0.5" style={{ color: c.inkMute }}>{it.note}</div>}
          </div>
        ))}
        <textarea
          value={notes}
          disabled={submitted}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="General notes"
          rows={2}
          className="w-full rounded-md border px-2.5 py-1.5 text-[12.5px]"
          style={{ borderColor: c.border }}
        />
        <input
          value={signature}
          disabled={submitted}
          onChange={(e) => setSignature(e.target.value)}
          placeholder="Inspector signature"
          className="w-full rounded-md border px-2.5 py-1.5 text-[12.5px]"
          style={{ borderColor: c.border }}
        />
        {!submitted && (
          <div className="flex gap-2 justify-end">
            <button
              onClick={save}
              disabled={update.isPending}
              className="text-[12px] rounded-md border px-3 py-1.5"
              style={{ borderColor: c.border }}
              data-testid={`button-save-inspection-${inspection.id}`}
            >
              Save draft
            </button>
            <button
              onClick={async () => { save(); setTimeout(() => submit.mutate({ id: inspection.id }), 200); }}
              disabled={submit.isPending}
              className="text-[12px] rounded-md px-3 py-1.5"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
              data-testid={`button-submit-inspection-${inspection.id}`}
            >
              Submit
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ChemistryTab() {
  const queryClient = useQueryClient();
  const { data: logs = [], isLoading } = useListPoolChemistryLogs();
  const create = useCreatePoolChemistryLog({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListPoolChemistryLogsQueryKey() }),
    },
  });

  const [form, setForm] = useState({
    freeChlorinePpm: "" as string | number,
    ph: "" as string | number,
    alkalinityPpm: "" as string | number,
    cyanuricAcidPpm: "" as string | number,
    notes: "",
  });

  const numField = (v: string | number): number | undefined =>
    v === "" || Number.isNaN(Number(v)) ? undefined : Number(v);

  const submit = () => {
    create.mutate({
      data: {
        recordedAt: new Date().toISOString(),
        freeChlorinePpm: numField(form.freeChlorinePpm),
        ph: numField(form.ph),
        alkalinityPpm: numField(form.alkalinityPpm),
        cyanuricAcidPpm: numField(form.cyanuricAcidPpm),
        notes: form.notes,
      },
    }, {
      onSuccess: () => setForm({ freeChlorinePpm: "", ph: "", alkalinityPpm: "", cyanuricAcidPpm: "", notes: "" }),
    });
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-4" style={{ borderColor: c.border }}>
        <h3 className="text-[14px] mb-3" style={{ fontWeight: 700 }}>Record reading</h3>
        <div className="grid grid-cols-4 gap-3 mb-3">
          <ChemField label="Free chlorine (ppm) · 1-4" value={form.freeChlorinePpm} onChange={(v) => setForm({ ...form, freeChlorinePpm: v })} testId="input-chem-fc" />
          <ChemField label="pH · 7.2-7.8" value={form.ph} onChange={(v) => setForm({ ...form, ph: v })} testId="input-chem-ph" />
          <ChemField label="Alkalinity (ppm) · 80-120" value={form.alkalinityPpm} onChange={(v) => setForm({ ...form, alkalinityPpm: v })} testId="input-chem-alk" />
          <ChemField label="Cyanuric (ppm) · 30-50" value={form.cyanuricAcidPpm} onChange={(v) => setForm({ ...form, cyanuricAcidPpm: v })} testId="input-chem-cya" />
        </div>
        <textarea
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Notes"
          rows={2}
          className="w-full rounded-md border px-2.5 py-1.5 text-[12.5px]"
          style={{ borderColor: c.border }}
        />
        <div className="flex justify-end mt-3">
          <button
            onClick={submit}
            disabled={create.isPending}
            className="text-[12.5px] rounded-md px-3 py-1.5 inline-flex items-center gap-1.5"
            style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
            data-testid="button-submit-chemistry"
          >
            <Droplets className="h-3.5 w-3.5" /> Save reading
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-[14px] mb-3" style={{ fontWeight: 700 }}>Recent readings</h3>
        {isLoading ? (
          <div className="text-[13px]" style={{ color: c.inkMute }}>Loading…</div>
        ) : logs.length === 0 ? (
          <div className="rounded-xl border bg-white p-6 text-[13px]" style={{ borderColor: c.border, color: c.inkMute }}>
            No readings yet.
          </div>
        ) : (
          <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
            <table className="w-full text-[12.5px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-3 py-2" style={{ color: c.inkSoft }}>When</th>
                  <th className="text-left px-3 py-2" style={{ color: c.inkSoft }}>FC</th>
                  <th className="text-left px-3 py-2" style={{ color: c.inkSoft }}>pH</th>
                  <th className="text-left px-3 py-2" style={{ color: c.inkSoft }}>Alk</th>
                  <th className="text-left px-3 py-2" style={{ color: c.inkSoft }}>CYA</th>
                  <th className="text-left px-3 py-2" style={{ color: c.inkSoft }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t align-top" style={{ borderColor: c.border, background: l.flagged ? "#FFF1F2" : undefined }}>
                    <td className="px-3 py-1.5">{fmtDateTime(l.recordedAt)}</td>
                    <td className="px-3 py-1.5">{l.freeChlorinePpm ?? "—"}</td>
                    <td className="px-3 py-1.5">{l.ph ?? "—"}</td>
                    <td className="px-3 py-1.5">{l.alkalinityPpm ?? "—"}</td>
                    <td className="px-3 py-1.5">{l.cyanuricAcidPpm ?? "—"}</td>
                    <td className="px-3 py-1.5">
                      {l.flagged ? (
                        <div>
                          <div className="inline-flex items-center gap-1" style={{ color: "#9A2542", fontWeight: 600 }}>
                            <AlertTriangle className="h-3 w-3" /> Out of range
                          </div>
                          {l.workOrderId && <div className="text-[11px]" style={{ color: c.inkSoft }}>WO {l.workOrderId}</div>}
                          {(l.flagReasons ?? []).map((r, i) => <div key={i} className="text-[11px]" style={{ color: c.inkMute }}>{r}</div>)}
                        </div>
                      ) : (
                        <span style={{ color: "#0E6F45", fontWeight: 600 }}>OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ChemField({ label, value, onChange, testId }: { label: string; value: string | number; onChange: (v: string) => void; testId?: string }) {
  return (
    <label className="block">
      <div className="text-[11px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>{label}</div>
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        className="w-full rounded-md border px-2.5 py-1.5 text-[13px]"
        style={{ borderColor: c.border }}
      />
    </label>
  );
}

// Task #103: Manager-editable amenity settings (rules, photos, deposit, etc.)

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Resolve a stored amenity photoUrl (which is typically an object-storage
// path like "/objects/uploads/...") into something <img> can load. Private
// objects are served via the API at /api/storage/objects/<key>; absolute
// http(s) URLs are passed through.
function resolvePhotoSrc(stored: string): string {
  if (!stored) return "";
  if (/^https?:\/\//i.test(stored)) return stored;
  const trimmed = stored.replace(/^\/+/, "");
  const key = trimmed.startsWith("objects/") ? trimmed.slice("objects/".length) : trimmed;
  return `/api/storage/objects/${encodeURI(key).replace(/^%2F/, "")}`;
}
const BOOKING_UNITS: Array<{ value: string; label: string }> = [
  { value: "whole_day", label: "Whole day" },
  { value: "hourly", label: "Hourly" },
  { value: "block", label: "Fixed block" },
  { value: "overnight", label: "Overnight" },
];

function SettingsTab() {
  const { data: amenities = [], isLoading } = useListAmenities();
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  useEffect(() => {
    if (!activeSlug && amenities.length > 0) setActiveSlug(amenities[0].slug);
  }, [amenities, activeSlug]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[13px]" style={{ color: c.inkMute }}>
        <Loader2 className="h-4 w-4 animate-spin" /> Loading amenities…
      </div>
    );
  }
  if (amenities.length === 0) {
    return (
      <div className="rounded-xl border bg-white p-6 text-[13px]" style={{ borderColor: c.border, color: c.inkMute }}>
        No amenities configured.
      </div>
    );
  }

  const active = amenities.find((a) => a.slug === activeSlug) ?? amenities[0];

  return (
    <div className="grid grid-cols-[220px_1fr] gap-4">
      <aside className="rounded-xl border bg-white overflow-hidden h-fit" style={{ borderColor: c.border }}>
        {amenities.map((a) => {
          const isActive = a.slug === active.slug;
          return (
            <button
              key={a.id}
              onClick={() => setActiveSlug(a.slug)}
              data-testid={`button-settings-amenity-${a.slug}`}
              className="w-full text-left px-3 py-2 text-[12.5px] border-b flex items-center justify-between"
              style={{
                borderColor: c.border,
                background: isActive ? "#F1F4FF" : undefined,
                color: isActive ? c.cobalt : c.inkSoft,
                fontWeight: isActive ? 700 : 500,
              }}
            >
              <span className="truncate">{a.name}</span>
              <span
                className="text-[10px] rounded-full px-1.5 py-0.5"
                style={{
                  background: a.enabled ? "#E6F5EE" : "#FBE3E9",
                  color: a.enabled ? "#0E6F45" : "#9A2542",
                  fontWeight: 600,
                }}
              >
                {a.enabled ? "On" : "Off"}
              </span>
            </button>
          );
        })}
      </aside>
      <AmenitySettingsForm key={active.slug} amenity={active} />
    </div>
  );
}

type FormState = {
  name: string;
  description: string;
  photoUrl: string;
  capacity: number;
  bookingUnit: string;
  depositCents: number;
  agreementText: string;
  enabled: boolean;
  hours: Array<{ enabled: boolean; open: string; close: string }>;
  blockHours: number;
  minLeadMinutes: number;
  maxLeadDays: number;
  monthlyCapPerOwner: number;
  cancelWindowHours: number;
  guestParkingNightlyCap: number;
  requiresLifeguard: boolean;
};

function amenityToForm(a: Amenity): FormState {
  const r = a.rules ?? {};
  const hours = WEEKDAYS.map((_, i) => {
    const w = r.hoursByWeekday?.[i];
    return w && w.open && w.close
      ? { enabled: true, open: w.open, close: w.close }
      : { enabled: false, open: "08:00", close: "20:00" };
  });
  return {
    name: a.name,
    description: a.description,
    photoUrl: a.photoUrl ?? "",
    capacity: a.capacity,
    bookingUnit: a.bookingUnit,
    depositCents: a.depositCents,
    agreementText: a.agreementText,
    enabled: a.enabled,
    hours,
    blockHours: r.blockHours ?? 0,
    minLeadMinutes: r.minLeadMinutes ?? 0,
    maxLeadDays: r.maxLeadDays ?? 0,
    monthlyCapPerOwner: r.monthlyCapPerOwner ?? 0,
    cancelWindowHours: r.cancelWindowHours ?? 0,
    guestParkingNightlyCap: r.guestParkingNightlyCap ?? 0,
    requiresLifeguard: r.requiresLifeguard ?? false,
  };
}

function formToRules(f: FormState): AmenityRules {
  return {
    hoursByWeekday: f.hours.map((h) => (h.enabled ? { open: h.open, close: h.close } : null)),
    blockHours: f.blockHours || undefined,
    minLeadMinutes: f.minLeadMinutes || undefined,
    maxLeadDays: f.maxLeadDays || undefined,
    monthlyCapPerOwner: f.monthlyCapPerOwner || undefined,
    cancelWindowHours: f.cancelWindowHours || undefined,
    guestParkingNightlyCap: f.guestParkingNightlyCap || undefined,
    requiresLifeguard: f.requiresLifeguard || undefined,
  };
}

function AmenitySettingsForm({ amenity }: { amenity: Amenity }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => amenityToForm(amenity));
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestUploadUrl = useRequestUploadUrl();
  const update = useUpdateAmenity({
    mutation: {
      onSuccess: (updated) => {
        queryClient.invalidateQueries({ queryKey: getListAmenitiesQueryKey() });
        setForm(amenityToForm(updated));
        setSavedAt(Date.now());
        setError(null);
      },
      onError: (e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to save");
      },
    },
  });
  // Separate mutation for the enabled toggle so flipping it does not
  // clobber other unsaved edits in the form when the PATCH responds.
  const toggleEnabled = useUpdateAmenity({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAmenitiesQueryKey() });
        setError(null);
      },
      onError: (e: unknown, _vars, _ctx) => {
        // Roll back optimistic flip
        setForm((prev) => ({ ...prev, enabled: !prev.enabled }));
        setError(e instanceof Error ? e.message : "Failed to update");
      },
    },
  });

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
  };

  const setHour = (idx: number, patch: Partial<FormState["hours"][number]>) => {
    setForm((prev) => ({
      ...prev,
      hours: prev.hours.map((h, i) => (i === idx ? { ...h, ...patch } : h)),
    }));
    setSavedAt(null);
  };

  const handleSave = () => {
    setError(null);
    update.mutate({
      slug: amenity.slug,
      data: {
        name: form.name,
        description: form.description,
        photoUrl: form.photoUrl ? form.photoUrl : null,
        capacity: form.capacity,
        bookingUnit: form.bookingUnit,
        depositCents: form.depositCents,
        rules: formToRules(form),
        agreementText: form.agreementText,
        enabled: form.enabled,
      },
    });
  };

  const handleToggleEnabled = (next: boolean) => {
    // Optimistic local flip; toggleEnabled mutation rolls back on error.
    setForm((prev) => ({ ...prev, enabled: next }));
    toggleEnabled.mutate({
      slug: amenity.slug,
      data: { enabled: next },
    });
  };

  async function handlePhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Image must be under 10 MB");
      return;
    }
    setUploading(true);
    try {
      const contentType = file.type || "image/jpeg";
      const urlRes = await requestUploadUrl.mutateAsync({
        data: { name: file.name, size: file.size, contentType },
      });
      const putRes = await fetch(urlRes.uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": contentType },
      });
      if (!putRes.ok) throw new Error("Upload failed");
      setField("photoUrl", urlRes.objectPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="rounded-xl border bg-white p-5 space-y-6" style={{ borderColor: c.border }}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px]" style={{ fontWeight: 700 }}>{amenity.name}</h3>
          <p className="text-[12px]" style={{ color: c.inkMute }}>Slug: {amenity.slug}</p>
        </div>
        <label className="inline-flex items-center gap-2 text-[12.5px]" style={{ color: c.inkSoft }}>
          <span>{form.enabled ? "Enabled" : "Disabled"}</span>
          <button
            type="button"
            onClick={() => handleToggleEnabled(!form.enabled)}
            disabled={toggleEnabled.isPending}
            data-testid="toggle-amenity-enabled"
            className="relative inline-flex h-5 w-9 items-center rounded-full transition"
            style={{ background: form.enabled ? c.cobalt : "#CBD0E0" }}
          >
            <span
              className="inline-block h-4 w-4 transform rounded-full bg-white transition"
              style={{ transform: `translateX(${form.enabled ? "18px" : "2px"})` }}
            />
          </button>
        </label>
      </header>

      <section className="grid grid-cols-2 gap-4">
        <Field label="Name">
          <input
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            data-testid="input-amenity-name"
            className="w-full rounded-md border px-2.5 py-1.5 text-[13px]"
            style={{ borderColor: c.border }}
          />
        </Field>
        <Field label="Booking unit">
          <select
            value={form.bookingUnit}
            onChange={(e) => setField("bookingUnit", e.target.value)}
            data-testid="select-amenity-booking-unit"
            className="w-full rounded-md border px-2.5 py-1.5 text-[13px] bg-white"
            style={{ borderColor: c.border }}
          >
            {BOOKING_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </Field>
        <Field label="Description" full>
          <textarea
            value={form.description}
            onChange={(e) => setField("description", e.target.value)}
            rows={2}
            data-testid="input-amenity-description"
            className="w-full rounded-md border px-2.5 py-1.5 text-[13px]"
            style={{ borderColor: c.border }}
          />
        </Field>
        <Field label="Capacity">
          <input
            type="number"
            min={0}
            value={form.capacity}
            onChange={(e) => setField("capacity", Math.max(0, parseInt(e.target.value, 10) || 0))}
            data-testid="input-amenity-capacity"
            className="w-full rounded-md border px-2.5 py-1.5 text-[13px]"
            style={{ borderColor: c.border }}
          />
        </Field>
        <Field label="Deposit (USD)">
          <input
            type="number"
            min={0}
            step="0.01"
            value={(form.depositCents / 100).toFixed(2)}
            onChange={(e) => {
              const dollars = parseFloat(e.target.value);
              const cents = Number.isFinite(dollars) ? Math.max(0, Math.round(dollars * 100)) : 0;
              setField("depositCents", cents);
            }}
            data-testid="input-amenity-deposit"
            className="w-full rounded-md border px-2.5 py-1.5 text-[13px]"
            style={{ borderColor: c.border }}
          />
        </Field>
      </section>

      <section>
        <h4 className="text-[13px] mb-2" style={{ fontWeight: 700 }}>Photo</h4>
        <div className="flex items-start gap-3">
          <div
            className="h-24 w-32 rounded-lg border overflow-hidden bg-slate-50 flex items-center justify-center"
            style={{ borderColor: c.border, color: c.inkMute }}
          >
            {form.photoUrl ? (
              <img src={resolvePhotoSrc(form.photoUrl)} alt={form.name} className="h-full w-full object-cover" />
            ) : (
              <span className="text-[11px]">No photo</span>
            )}
          </div>
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              data-testid="button-upload-amenity-photo"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px]"
              style={{ borderColor: c.border, color: c.inkSoft }}
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {uploading ? "Uploading…" : "Upload new photo"}
            </button>
            {form.photoUrl && (
              <button
                type="button"
                onClick={() => setField("photoUrl", "")}
                data-testid="button-remove-amenity-photo"
                className="block text-[11.5px]"
                style={{ color: c.rose }}
              >
                Remove photo
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoPick}
              className="hidden"
            />
          </div>
        </div>
      </section>

      <section>
        <h4 className="text-[13px] mb-2" style={{ fontWeight: 700 }}>Open hours</h4>
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: c.border }}>
          {form.hours.map((h, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-3 py-2 border-b last:border-b-0 text-[12.5px]"
              style={{ borderColor: c.border }}
            >
              <label className="inline-flex items-center gap-1.5 w-20">
                <input
                  type="checkbox"
                  checked={h.enabled}
                  onChange={(e) => setHour(i, { enabled: e.target.checked })}
                  data-testid={`check-day-${i}`}
                />
                <span style={{ fontWeight: 600 }}>{WEEKDAYS[i]}</span>
              </label>
              {h.enabled ? (
                <>
                  <input
                    type="time"
                    value={h.open}
                    onChange={(e) => setHour(i, { open: e.target.value })}
                    data-testid={`input-day-${i}-open`}
                    className="rounded-md border px-2 py-1 text-[12.5px]"
                    style={{ borderColor: c.border }}
                  />
                  <span style={{ color: c.inkMute }}>to</span>
                  <input
                    type="time"
                    value={h.close}
                    onChange={(e) => setHour(i, { close: e.target.value })}
                    data-testid={`input-day-${i}-close`}
                    className="rounded-md border px-2 py-1 text-[12.5px]"
                    style={{ borderColor: c.border }}
                  />
                </>
              ) : (
                <span style={{ color: c.inkMute }}>Closed</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h4 className="text-[13px] mb-2" style={{ fontWeight: 700 }}>Booking rules</h4>
        <div className="grid grid-cols-3 gap-3">
          <NumField
            label="Min lead (minutes)"
            value={form.minLeadMinutes}
            onChange={(v) => setField("minLeadMinutes", v)}
            testId="input-min-lead"
          />
          <NumField
            label="Max lead (days)"
            value={form.maxLeadDays}
            onChange={(v) => setField("maxLeadDays", v)}
            testId="input-max-lead"
          />
          <NumField
            label="Monthly cap per owner"
            value={form.monthlyCapPerOwner}
            onChange={(v) => setField("monthlyCapPerOwner", v)}
            testId="input-monthly-cap"
          />
          <NumField
            label="Cancel window (hours)"
            value={form.cancelWindowHours}
            onChange={(v) => setField("cancelWindowHours", v)}
            testId="input-cancel-window"
          />
          {form.bookingUnit === "block" && (
            <NumField
              label="Block size (hours)"
              value={form.blockHours}
              onChange={(v) => setField("blockHours", v)}
              testId="input-block-hours"
            />
          )}
          <NumField
            label="Guest-parking nightly cap (per 30d)"
            value={form.guestParkingNightlyCap}
            onChange={(v) => setField("guestParkingNightlyCap", v)}
            testId="input-guest-parking-cap"
          />
        </div>
        <label className="inline-flex items-center gap-2 mt-3 text-[12.5px]" style={{ color: c.inkSoft }}>
          <input
            type="checkbox"
            checked={form.requiresLifeguard}
            onChange={(e) => setField("requiresLifeguard", e.target.checked)}
            data-testid="check-requires-lifeguard"
          />
          Requires lifeguard window
        </label>
      </section>

      <section>
        <h4 className="text-[13px] mb-2" style={{ fontWeight: 700 }}>Agreement text</h4>
        <textarea
          value={form.agreementText}
          onChange={(e) => setField("agreementText", e.target.value)}
          rows={6}
          data-testid="input-amenity-agreement"
          placeholder="Terms residents must accept when booking"
          className="w-full rounded-md border px-2.5 py-1.5 text-[12.5px] font-mono"
          style={{ borderColor: c.border }}
        />
      </section>

      <footer className="flex items-center justify-end gap-3 pt-2 border-t" style={{ borderColor: c.border }}>
        {error && <span className="text-[12px] mr-auto" style={{ color: c.rose }}>{error}</span>}
        {savedAt !== null && !update.isPending && (
          <span className="text-[12px] inline-flex items-center gap-1" style={{ color: "#0E6F45" }}>
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={update.isPending}
          data-testid="button-save-amenity-settings"
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px]"
          style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
        >
          {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save changes
        </button>
      </footer>
    </div>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${full ? "col-span-2" : ""}`}>
      <div className="text-[11px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>{label}</div>
      {children}
    </label>
  );
}

function NumField({ label, value, onChange, testId }: { label: string; value: number; onChange: (v: number) => void; testId?: string }) {
  return (
    <label className="block">
      <div className="text-[11px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>{label}</div>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
        data-testid={testId}
        className="w-full rounded-md border px-2.5 py-1.5 text-[13px]"
        style={{ borderColor: c.border }}
      />
    </label>
  );
}
