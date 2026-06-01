// Task #77: Resident-facing amenities page. Owners browse the catalog,
// pick an amenity, see availability, sign the agreement, and book.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import {
  CalendarDays, ChevronLeft, Building2, Check, Loader2, FileSignature, AlertTriangle, Printer, Download, X, ShieldCheck, Phone, Siren,
} from "lucide-react";
import {
  useListAmenities,
  useGetAmenityAvailability,
  useListMyAmenityBookings,
  useCreateAmenityBooking,
  useCancelAmenityBooking,
  useListAmenityBookingInspections,
  useCreateAmenityBookingInspection,
  useUpdateAmenityInspection,
  useSubmitAmenityInspection,
  useListAmenityBookingDamageReports,
  useListAmenityDamageDisputes,
  useFileAmenityDamageDispute,
  useListAmenityBookingDepositLedger,
  useGetAmenityCompliance,
  getListMyAmenityBookingsQueryKey,
  getGetAmenityAvailabilityQueryKey,
  getListAmenityBookingInspectionsQueryKey,
  getListAmenityDamageDisputesQueryKey,
  type Amenity,
  type AmenityBooking,
  type AmenityInspectionItemResult,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";

function fmtCents(n: number) {
  return n === 0 ? "Free" : `$${(n / 100).toFixed(2)}`;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function bookingUnitLabel(u: Amenity["bookingUnit"]) {
  if (u === "whole_day") return "Whole-day reservation";
  if (u === "hourly") return "Hourly (30 min – 4 hr)";
  if (u === "block") return "Time-block reservation";
  return "Overnight";
}

function statusPill(s: AmenityBooking["status"]) {
  const map: Record<string, { fg: string; bg: string; label: string }> = {
    pending_payment: { fg: "#9A6500", bg: "#FFF6D6", label: "Awaiting deposit" },
    confirmed: { fg: "#0E6F45", bg: "#DCF3EC", label: "Confirmed" },
    used_pending_inspection: { fg: "#7A5200", bg: "#FFF6D6", label: "Pending inspection" },
    used: { fg: "#475569", bg: "#EEF2F7", label: "Completed" },
    cancelled: { fg: "#9A2542", bg: "#FCE5EC", label: "Cancelled" },
    forfeited: { fg: "#9A2542", bg: "#FCE5EC", label: "Forfeited" },
    refunded: { fg: "#475569", bg: "#EEF2F7", label: "Refunded" },
  };
  const s2 = map[s] ?? { fg: "#475569", bg: "#EEF2F7", label: s };
  return (
    <span className="text-[11.5px] rounded-full px-2 py-0.5" style={{ color: s2.fg, background: s2.bg, fontWeight: 600 }}>
      {s2.label}
    </span>
  );
}

export default function ResidentAmenities() {
  const [selected, setSelected] = useState<string | null>(null);
  const { data: amenities = [], isLoading } = useListAmenities();
  const enabled = amenities.filter((a) => a.enabled);

  return (
    <Layout title="Amenities" subtitle="Reserve community amenities">
      {selected ? (
        <AmenityDetail slug={selected} onBack={() => setSelected(null)} />
      ) : (
        <div className="space-y-6">
          <MyBookings />
          <MyRecentBookings />
          <section>
            <h3 className="text-[15px] mb-3" style={{ fontWeight: 700 }}>Available amenities</h3>
            {isLoading ? (
              <div className="text-[13px]" style={{ color: c.inkMute }}>Loading…</div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {enabled.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setSelected(a.slug)}
                    data-testid={`button-amenity-${a.slug}`}
                    className="text-left rounded-xl border bg-white p-5 hover:shadow-md transition-shadow"
                    style={{ borderColor: c.border }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-[15px]" style={{ fontWeight: 700 }}>{a.name}</h4>
                        <p className="text-[12.5px] mt-1" style={{ color: c.inkMute }}>{a.description}</p>
                      </div>
                      <Building2 className="h-5 w-5 mt-1" style={{ color: c.inkMute }} />
                    </div>
                    <div className="flex items-center gap-3 mt-3 text-[12px]" style={{ color: c.inkSoft }}>
                      <span>{bookingUnitLabel(a.bookingUnit)}</span>
                      <span>•</span>
                      <span>Capacity {a.capacity || "—"}</span>
                      <span>•</span>
                      <span>Deposit {fmtCents(a.depositCents)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Layout>
  );
}

function MyBookings() {
  const { data: bookings = [], isLoading } = useListMyAmenityBookings();
  const queryClient = useQueryClient();
  const cancel = useCancelAmenityBooking({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMyAmenityBookingsQueryKey() }),
    },
  });
  const upcoming = bookings.filter((b) =>
    b.status === "pending_payment" || b.status === "confirmed" || b.status === "used_pending_inspection"
  );
  if (isLoading) return null;
  if (upcoming.length === 0) return null;
  return (
    <section>
      <h3 className="text-[15px] mb-3" style={{ fontWeight: 700 }}>My upcoming reservations</h3>
      <div className="space-y-2">
        {upcoming.map((b) => (
          <div key={b.id} className="rounded-lg border bg-white p-4 flex items-center justify-between" style={{ borderColor: c.border }}>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[14px]" style={{ fontWeight: 600 }}>{b.amenityName}</span>
                {statusPill(b.status)}
              </div>
              <div className="text-[12.5px] mt-0.5" style={{ color: c.inkMute }}>
                {fmtDateTime(b.startsAt)} — {fmtDateTime(b.endsAt)}
              </div>
              {b.permitNumber && (
                <div className="text-[12px] mt-1" style={{ color: c.inkSoft }}>
                  Permit #: <span className="font-mono">{b.permitNumber}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {b.permitNumber && (
                <a
                  href={`/api/amenity-bookings/${b.id}/permit`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12.5px] rounded-md border px-2.5 py-1.5 inline-flex items-center gap-1.5"
                  style={{ borderColor: c.border, color: c.inkSoft }}
                  data-testid={`link-permit-${b.id}`}
                >
                  <Printer className="h-3.5 w-3.5" /> Permit
                </a>
              )}
              <a
                href={`/api/amenity-bookings/${b.id}/ical`}
                className="text-[12.5px] rounded-md border px-2.5 py-1.5 inline-flex items-center gap-1.5"
                style={{ borderColor: c.border, color: c.inkSoft }}
              >
                <Download className="h-3.5 w-3.5" /> .ics
              </a>
              <button
                onClick={() => {
                  if (!confirm("Cancel this reservation?")) return;
                  cancel.mutate({ id: b.id, data: { reason: "" } });
                }}
                disabled={cancel.isPending}
                className="text-[12.5px] rounded-md border px-2.5 py-1.5 inline-flex items-center gap-1.5"
                style={{ borderColor: c.border, color: "#9A2542" }}
                data-testid={`button-cancel-${b.id}`}
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AmenityDetail({ slug, onBack }: { slug: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("14:00");
  const [guestCount, setGuestCount] = useState(0);
  const [purpose, setPurpose] = useState("");
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [signedName, setSignedName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<AmenityBooking | null>(null);

  const fromIso = `${date}T00:00:00.000Z`;
  const toIso = `${date}T23:59:59.999Z`;
  const { data: avail, isLoading } = useGetAmenityAvailability(slug, { from: fromIso, to: toIso });
  const create = useCreateAmenityBooking({
    mutation: {
      onSuccess: (b) => {
        setSuccess(b);
        setAgreementOpen(false);
        queryClient.invalidateQueries({ queryKey: getListMyAmenityBookingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAmenityAvailabilityQueryKey(slug, { from: fromIso, to: toIso }) });
      },
      onError: (err: unknown) => {
        const msg = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "Could not book";
        setError(msg);
      },
    },
  });

  if (isLoading || !avail) {
    return (
      <div className="flex items-center gap-2 text-[13px]" style={{ color: c.inkMute }}>
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const a = avail.amenity;
  const startsAt = new Date(`${date}T${startTime}:00.000Z`).toISOString();
  const endsAt = new Date(`${date}T${endTime}:00.000Z`).toISOString();

  const submit = () => {
    setError(null);
    if (!signedName.trim()) { setError("Please sign with your full name."); return; }
    create.mutate({
      slug: a.slug,
      data: {
        startsAt, endsAt,
        guestCount,
        purpose,
        agreementSigned: true,
        agreementSignedName: signedName.trim(),
        lifeguardRequested: a.rules.requiresLifeguard ?? false,
      },
    });
  };

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: c.inkSoft }}>
        <ChevronLeft className="h-4 w-4" /> All amenities
      </button>

      <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[18px]" style={{ fontWeight: 700 }}>{a.name}</h3>
            <p className="text-[13.5px] mt-1" style={{ color: c.inkMute }}>{a.description}</p>
          </div>
          <CalendarDays className="h-5 w-5" style={{ color: c.inkMute }} />
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4 text-[12.5px]">
          <Stat label="Booking unit" value={bookingUnitLabel(a.bookingUnit)} />
          <Stat label="Capacity" value={String(a.capacity || "—")} />
          <Stat label="Deposit" value={fmtCents(a.depositCents)} />
        </div>
      </section>

      <SafetyPanel slug={a.slug} />

      {success ? (
        <section className="rounded-xl border bg-white p-6" style={{ borderColor: "#0E8A6B" }}>
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5" style={{ color: "#0E8A6B" }} />
            <h3 className="text-[15px]" style={{ fontWeight: 700, color: "#0E6F45" }}>Reservation submitted</h3>
          </div>
          <p className="text-[13px] mt-2" style={{ color: c.inkMute }}>
            {success.status === "pending_payment"
              ? "Your reservation is pending the deposit. The manager will mark it paid after receiving payment."
              : "Your reservation is confirmed. Add it to your calendar with the buttons below."}
          </p>
          {success.permitNumber && (
            <p className="text-[13px] mt-1" style={{ color: c.inkSoft }}>
              Permit #: <span className="font-mono">{success.permitNumber}</span>
            </p>
          )}
          <div className="flex items-center gap-2 mt-4">
            <button onClick={() => { setSuccess(null); }} className="text-[12.5px] rounded-md border px-3 py-1.5" style={{ borderColor: c.border }}>
              Make another reservation
            </button>
            <Link href="/calendar" className="text-[12.5px] rounded-md px-3 py-1.5" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
              View on calendar
            </Link>
          </div>
        </section>
      ) : (
        <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
          <h4 className="text-[14px] mb-3" style={{ fontWeight: 700 }}>Reserve a time</h4>
          {!user?.unitId && (
            <div className="rounded-md border px-3 py-2 mb-4 text-[12.5px] inline-flex items-center gap-2" style={{ borderColor: "#FAD16B", background: "#FFF6D6", color: "#7A5200" }}>
              <AlertTriangle className="h-3.5 w-3.5" />
              Only owners with an assigned unit can book. Contact the manager.
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-md border px-2.5 py-1.5 text-[13px]" style={{ borderColor: c.border }} data-testid="input-amenity-date" />
            </Field>
            <Field label="Start">
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full rounded-md border px-2.5 py-1.5 text-[13px]" style={{ borderColor: c.border }} data-testid="input-amenity-start" />
            </Field>
            <Field label="End">
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full rounded-md border px-2.5 py-1.5 text-[13px]" style={{ borderColor: c.border }} data-testid="input-amenity-end" />
            </Field>
            <Field label="Guests">
              <input type="number" min={0} value={guestCount} onChange={(e) => setGuestCount(parseInt(e.target.value, 10) || 0)} className="w-full rounded-md border px-2.5 py-1.5 text-[13px]" style={{ borderColor: c.border }} />
            </Field>
            <Field label="Purpose (optional)">
              <input type="text" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Birthday party, swim lessons, …" className="w-full rounded-md border px-2.5 py-1.5 text-[13px]" style={{ borderColor: c.border }} />
            </Field>
          </div>

          <div className="mt-5">
            <h5 className="text-[12.5px] mb-2" style={{ fontWeight: 600, color: c.inkSoft }}>What's already booked on {new Date(date + "T00:00:00").toLocaleDateString()}</h5>
            {avail.bookings.length === 0 && avail.blackouts.length === 0 ? (
              <div className="text-[12.5px]" style={{ color: c.inkMute }}>No conflicts on this day.</div>
            ) : (
              <ul className="space-y-1.5">
                {avail.bookings.map((b) => (
                  <li key={b.id} className="text-[12.5px] flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: b.mine ? c.cobalt : "#9CA3AF" }} />
                    <span style={{ color: c.inkSoft }}>{fmtDateTime(b.startsAt)} – {fmtDateTime(b.endsAt)}</span>
                    <span style={{ color: c.inkMute }}>· {b.label ?? (b.mine ? "Your reservation" : "Reserved")}</span>
                  </li>
                ))}
                {avail.blackouts.map((bo) => (
                  <li key={`bo-${bo.id}`} className="text-[12.5px] flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#B8264C" }} />
                    <span style={{ color: c.inkSoft }}>{fmtDateTime(bo.startsAt)} – {fmtDateTime(bo.endsAt)}</span>
                    <span style={{ color: c.inkMute }}>· Closed: {bo.reason || "maintenance"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <div className="mt-4 rounded-md border px-3 py-2 text-[12.5px]" style={{ borderColor: "#FCA5A5", background: "#FEF2F2", color: "#991B1B" }}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 mt-5">
            <button
              onClick={() => setAgreementOpen(true)}
              disabled={!user?.unitId}
              className="text-[13px] rounded-md px-3.5 py-2 inline-flex items-center gap-1.5"
              style={{ background: user?.unitId ? c.cobalt : "#9CA3AF", color: "#fff", fontWeight: 600 }}
              data-testid="button-review-agreement"
            >
              <FileSignature className="h-4 w-4" /> Review &amp; sign agreement
            </button>
          </div>
        </section>
      )}

      {agreementOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: c.border }}>
              <h3 className="text-[15px]" style={{ fontWeight: 700 }}>Reservation agreement — {a.name}</h3>
              <button onClick={() => setAgreementOpen(false)}><X className="h-4 w-4" style={{ color: c.inkMute }} /></button>
            </div>
            <div className="px-5 py-4 max-h-[55vh] overflow-y-auto whitespace-pre-wrap text-[12.5px]" style={{ color: c.inkSoft }}>
              {a.agreementText || "By reserving this amenity you agree to abide by all community rules."}
            </div>
            <div className="px-5 py-4 border-t space-y-3" style={{ borderColor: c.border }}>
              <Field label="Sign with your full legal name">
                <input
                  value={signedName}
                  onChange={(e) => setSignedName(e.target.value)}
                  placeholder="Type your name"
                  className="w-full rounded-md border px-2.5 py-1.5 text-[13px]"
                  style={{ borderColor: c.border }}
                  data-testid="input-signed-name"
                />
              </Field>
              {error && (
                <div className="text-[12.5px]" style={{ color: "#991B1B" }}>{error}</div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setAgreementOpen(false)} className="text-[12.5px] rounded-md border px-3 py-1.5" style={{ borderColor: c.border }}>Cancel</button>
                <button
                  onClick={submit}
                  disabled={create.isPending}
                  className="text-[12.5px] rounded-md px-3 py-1.5 inline-flex items-center gap-1.5"
                  style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                  data-testid="button-confirm-booking"
                >
                  {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Sign &amp; reserve
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SafetyPanel({ slug }: { slug: string }) {
  const { data } = useGetAmenityCompliance(slug);
  if (!data) return null;
  const d = data as {
    overall?: "green" | "amber" | "red";
    postings?: { title: string; kind: string; color: "green" | "amber" | "red" }[];
    inspection?: { passedOn: string | null; color: "green" | "amber" | "red" };
    emergency?: {
      emergencyContact?: string;
      managerOnCallName?: string;
      managerOnCallPhone?: string;
      evacuationRoute?: string;
      shelterLocation?: string;
      hazardNotes?: string;
      steps?: string[];
    } | null;
    pins?: { kind: string; label: string; locationDescription: string }[];
  };
  const overall = d.overall ?? "amber";
  const overallFg = overall === "green" ? "#0E6F45" : overall === "amber" ? "#9A6500" : "#9A2542";
  const overallBg = overall === "green" ? "#DCF3EC" : overall === "amber" ? "#FFF6D6" : "#FCE5EC";
  return (
    <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" style={{ color: c.inkSoft }} />
          <h4 className="text-[14px]" style={{ fontWeight: 700 }}>Safety & compliance</h4>
        </div>
        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: overallBg, color: overallFg }}>
          {overall === "green" ? "All good" : overall === "amber" ? "Attention" : "Action needed"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-[12.5px]">
        <div>
          <div className="font-semibold mb-1" style={{ color: c.ink }}>Postings on file</div>
          {d.postings?.length ? (
            <ul className="space-y-0.5" style={{ color: c.inkSoft }}>
              {d.postings.map((p, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color === "green" ? "#0E8A6B" : p.color === "amber" ? "#C68A00" : "#C2406A" }} />
                  {p.title}
                </li>
              ))}
            </ul>
          ) : <div style={{ color: c.inkMute }}>—</div>}
          {d.inspection && (
            <div className="mt-2" style={{ color: c.inkSoft }}>
              Last inspection: {d.inspection.passedOn ?? "—"}
            </div>
          )}
        </div>
        <div>
          <div className="font-semibold mb-1" style={{ color: c.ink }}>In an emergency</div>
          {d.emergency ? (
            <div className="space-y-0.5" style={{ color: c.inkSoft }}>
              {d.emergency.emergencyContact && (
                <div className="inline-flex items-center gap-1.5"><Siren className="h-3.5 w-3.5" /> {d.emergency.emergencyContact}</div>
              )}
              {d.emergency.managerOnCallName && (
                <div className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {d.emergency.managerOnCallName} {d.emergency.managerOnCallPhone ? `· ${d.emergency.managerOnCallPhone}` : ""}</div>
              )}
              {d.emergency.evacuationRoute && <div>Evac: {d.emergency.evacuationRoute}</div>}
              {d.emergency.shelterLocation && <div>Shelter: {d.emergency.shelterLocation}</div>}
            </div>
          ) : <div style={{ color: c.inkMute }}>No emergency procedure posted yet.</div>}
          {d.pins && d.pins.length > 0 && (
            <div className="mt-2">
              <div className="font-semibold mb-0.5" style={{ color: c.ink }}>On-site safety equipment</div>
              <ul style={{ color: c.inkSoft }}>
                {d.pins.map((p, i) => (
                  <li key={i}>{p.label} — {p.locationDescription || p.kind}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11.5px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>{label}</div>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2" style={{ borderColor: c.border }}>
      <div className="text-[11px]" style={{ color: c.inkMute }}>{label}</div>
      <div className="text-[13px] mt-0.5" style={{ color: c.ink, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

// Task #83: completed bookings — owner self-inspection + dispute portal.
function MyRecentBookings() {
  const { data: bookings = [] } = useListMyAmenityBookings();
  const recent = bookings.filter((b) =>
    b.status === "used" || b.status === "used_pending_inspection",
  ).slice(0, 8);
  const [openId, setOpenId] = useState<number | null>(null);
  if (recent.length === 0) return null;
  return (
    <section>
      <h3 className="text-[15px] mb-3" style={{ fontWeight: 700 }}>Recent reservations</h3>
      <div className="space-y-2">
        {recent.map((b) => (
          <div key={b.id} className="rounded-lg border bg-white" style={{ borderColor: c.border }}>
            <div className="p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[14px]" style={{ fontWeight: 600 }}>{b.amenityName}</span>
                  {statusPill(b.status)}
                </div>
                <div className="text-[12.5px] mt-0.5" style={{ color: c.inkMute }}>
                  {fmtDateTime(b.startsAt)} — {fmtDateTime(b.endsAt)}
                </div>
              </div>
              <button
                onClick={() => setOpenId(openId === b.id ? null : b.id)}
                className="text-[12.5px] rounded-md border px-2.5 py-1.5"
                style={{ borderColor: c.border, color: c.inkSoft }}
                data-testid={`button-toggle-recent-${b.id}`}
              >
                {openId === b.id ? "Hide details" : "Inspect / dispute"}
              </button>
            </div>
            {openId === b.id && (
              <div className="border-t p-4 space-y-4" style={{ borderColor: c.border }}>
                <ResidentSelfInspection bookingId={b.id} />
                <ResidentDamageView bookingId={b.id} ownerName={b.ownerName ?? ""} />
                <ResidentDepositView bookingId={b.id} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function ResidentSelfInspection({ bookingId }: { bookingId: number }) {
  const queryClient = useQueryClient();
  const { data: inspections = [] } = useListAmenityBookingInspections(bookingId);
  const ownerSelf = inspections.find((i) => i.kind === "owner_self");
  const create = useCreateAmenityBookingInspection({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAmenityBookingInspectionsQueryKey(bookingId) }) },
  });
  const update = useUpdateAmenityInspection();
  const submit = useSubmitAmenityInspection({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAmenityBookingInspectionsQueryKey(bookingId) }) },
  });
  const [items, setItems] = useState<AmenityInspectionItemResult[]>(ownerSelf?.items ?? []);
  const [notes, setNotes] = useState(ownerSelf?.notes ?? "");
  if (!ownerSelf) {
    return (
      <div>
        <h4 className="text-[13px] mb-1" style={{ fontWeight: 700 }}>Owner self-inspection</h4>
        <p className="text-[12.5px] mb-2" style={{ color: c.inkMute }}>
          Walk through the space and note any issues you saw or caused. Honest reports help avoid disputes.
        </p>
        <button
          onClick={() => create.mutate({ id: bookingId, data: { kind: "owner_self" } })}
          disabled={create.isPending}
          className="text-[12.5px] rounded-md border px-3 py-1.5"
          style={{ borderColor: c.border, color: c.cobalt }}
          data-testid={`button-start-self-inspection-${bookingId}`}
        >
          Start self-inspection
        </button>
      </div>
    );
  }
  const submitted = ownerSelf.status === "submitted";
  const liveItems = items.length > 0 ? items : ownerSelf.items;
  const setItem = (id: number, patch: Partial<AmenityInspectionItemResult>) => {
    setItems(liveItems.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };
  return (
    <div>
      <h4 className="text-[13px] mb-2" style={{ fontWeight: 700 }}>Owner self-inspection · {ownerSelf.status}</h4>
      <div className="space-y-2">
        {liveItems.map((it) => (
          <div key={it.id} className="rounded border p-2 text-[12.5px]" style={{ borderColor: c.border }}>
            <div className="flex items-center justify-between gap-2">
              <span>{it.label}</span>
              <select
                value={it.status}
                disabled={submitted}
                onChange={(e) => setItem(it.id, { status: e.target.value as AmenityInspectionItemResult["status"] })}
                className="rounded border px-1.5 py-0.5 text-[12px]"
                style={{ borderColor: c.border }}
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
      </div>
      {!submitted && (
        <>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes for the manager"
            rows={2}
            className="mt-2 w-full rounded-md border px-2.5 py-1.5 text-[12.5px]"
            style={{ borderColor: c.border }}
          />
          <div className="flex gap-2 justify-end mt-2">
            <button
              onClick={async () => {
                update.mutate({
                  id: ownerSelf.id,
                  data: {
                    notes,
                    items: liveItems.map((i) => ({ id: i.id, status: i.status, note: i.note })),
                  },
                }, {
                  onSuccess: () => submit.mutate({ id: ownerSelf.id }),
                });
              }}
              disabled={update.isPending || submit.isPending}
              className="text-[12.5px] rounded-md px-3 py-1.5"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
              data-testid={`button-submit-self-${bookingId}`}
            >
              Submit
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ResidentDamageView({ bookingId, ownerName }: { bookingId: number; ownerName: string }) {
  const { data: damages = [] } = useListAmenityBookingDamageReports(bookingId);
  if (damages.length === 0) return null;
  return (
    <div>
      <h4 className="text-[13px] mb-2" style={{ fontWeight: 700 }}>Damage reports filed against this reservation</h4>
      <div className="space-y-2">
        {damages.map((d) => (
          <div key={d.id} className="rounded-lg border bg-white p-3" style={{ borderColor: c.border }}>
            <div className="text-[13px]" style={{ fontWeight: 600 }}>{d.summary}</div>
            {d.details && <div className="text-[12px] mt-1" style={{ color: c.inkMute }}>{d.details}</div>}
            <div className="text-[11.5px] mt-1" style={{ color: c.inkSoft }}>
              Status: <strong>{d.status}</strong>
              {d.depositChargedCents > 0 && ` · Charged ${fmtCents(d.depositChargedCents)}`}
            </div>
            <ResidentDisputeBlock damageReportId={d.id} disabled={d.status === "waived" || d.status === "resolved"} ownerName={ownerName} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ResidentDisputeBlock({ damageReportId, disabled, ownerName }: { damageReportId: number; disabled: boolean; ownerName: string }) {
  const queryClient = useQueryClient();
  const { data: disputes = [] } = useListAmenityDamageDisputes(damageReportId);
  const file = useFileAmenityDamageDispute({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAmenityDamageDisputesQueryKey(damageReportId) }) },
  });
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <div className="mt-2">
      {disputes.length > 0 && (
        <div className="space-y-1.5">
          {disputes.map((di) => (
            <div key={di.id} className="rounded border p-2 text-[12px]" style={{ borderColor: c.border, background: "#F8FAFC" }}>
              <div style={{ fontWeight: 600 }}>Your dispute · {di.status}</div>
              <div className="whitespace-pre-wrap mt-1" style={{ color: c.inkMute }}>{di.message}</div>
              {di.managerResponse && (
                <div className="mt-1 pt-1 border-t" style={{ borderColor: c.border }}>
                  <span style={{ fontWeight: 600 }}>Manager response:</span>{" "}
                  <span style={{ color: c.inkSoft }}>{di.managerResponse}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {disabled || disputes.some((d) => d.status === "open" || d.status === "under_review") ? null : (
        <>
          {open ? (
            <div className="mt-2 space-y-2">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Explain why you disagree with this damage report"
                rows={3}
                className="w-full rounded-md border px-2.5 py-1.5 text-[12.5px]"
                style={{ borderColor: c.border }}
                data-testid={`textarea-dispute-${damageReportId}`}
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setOpen(false)} className="text-[12px] rounded-md border px-3 py-1.5" style={{ borderColor: c.border }}>Cancel</button>
                <button
                  onClick={() => {
                    if (!message.trim()) return;
                    file.mutate({ id: damageReportId, data: { message } }, {
                      onSuccess: () => { setMessage(""); setOpen(false); },
                    });
                  }}
                  disabled={file.isPending || !message.trim()}
                  className="text-[12px] rounded-md px-3 py-1.5"
                  style={{ background: "#9A2542", color: "#fff", fontWeight: 600 }}
                  data-testid={`button-submit-dispute-${damageReportId}`}
                >
                  Submit dispute
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setOpen(true)}
              className="mt-2 text-[12px] rounded-md border px-3 py-1.5"
              style={{ borderColor: c.border, color: "#9A2542" }}
              data-testid={`button-open-dispute-${damageReportId}`}
            >
              Dispute this charge
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ResidentDepositView({ bookingId }: { bookingId: number }) {
  const { data: ledger = [] } = useListAmenityBookingDepositLedger(bookingId);
  if (ledger.length === 0) return null;
  return (
    <div>
      <h4 className="text-[13px] mb-2" style={{ fontWeight: 700 }}>Deposit activity</h4>
      <ul className="space-y-1 text-[12px]" style={{ color: c.inkSoft }}>
        {ledger.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-2">
            <span>{fmtDateTime(e.createdAt)} · {e.kind}{e.reason ? ` — ${e.reason}` : ""}</span>
            <span style={{ fontWeight: 600 }}>{fmtCents(e.amountCents)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
