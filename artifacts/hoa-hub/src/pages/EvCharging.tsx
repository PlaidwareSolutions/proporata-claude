// Task #86: Resident-facing EV charging page.
// Browse ports, see live status, reserve a slot, start/stop sessions, view history.

import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { useAuth } from "@/contexts/AuthContext";
import {
  Zap, Loader2, Play, StopCircle, X, Download, AlertTriangle, Check, BatteryCharging,
} from "lucide-react";
import { chargingApi, type ChargingPort, type ChargingReservation, type ChargingSession } from "@/lib/chargingApi";

function fmtCents(n: number) { return `$${(n / 100).toFixed(2)}`; }
function fmtKwh(n: number) { return `${n.toFixed(2)} kWh`; }
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

const SLOT_OPTIONS = [
  { label: "30 min", minutes: 30 },
  { label: "1 hr", minutes: 60 },
  { label: "1.5 hr", minutes: 90 },
  { label: "2 hr", minutes: 120 },
];

function liveBadge(status: "available" | "in_use" | "reserved_soon") {
  const map = {
    available: { fg: "#0E6F45", bg: "#DCF3EC", label: "Available now" },
    in_use: { fg: "#7A5200", bg: "#FFF6D6", label: "In use" },
    reserved_soon: { fg: "#475569", bg: "#EEF2F7", label: "Reserved soon" },
  } as const;
  const m = map[status];
  return (
    <span className="text-[11.5px] rounded-full px-2 py-0.5" style={{ color: m.fg, background: m.bg, fontWeight: 600 }}>
      {m.label}
    </span>
  );
}

function sessionStatusPill(s: ChargingSession["status"]) {
  const map: Record<string, { fg: string; bg: string; label: string }> = {
    active: { fg: "#0E6F45", bg: "#DCF3EC", label: "Charging" },
    stopped: { fg: "#475569", bg: "#EEF2F7", label: "Stopped" },
    billed: { fg: "#1A56DB", bg: "#E1ECFE", label: "Billed" },
    refunded: { fg: "#475569", bg: "#EEF2F7", label: "Refunded" },
    cancelled: { fg: "#9A2542", bg: "#FCE5EC", label: "Cancelled" },
  };
  const m = map[s] ?? { fg: "#475569", bg: "#EEF2F7", label: s };
  return (
    <span className="text-[11.5px] rounded-full px-2 py-0.5" style={{ color: m.fg, background: m.bg, fontWeight: 600 }}>
      {m.label}
    </span>
  );
}

function reservationPill(s: ChargingReservation["status"]) {
  const map: Record<string, { fg: string; bg: string; label: string }> = {
    pending: { fg: "#9A6500", bg: "#FFF6D6", label: "Reserved" },
    active: { fg: "#0E6F45", bg: "#DCF3EC", label: "Charging now" },
    completed: { fg: "#475569", bg: "#EEF2F7", label: "Completed" },
    cancelled: { fg: "#9A2542", bg: "#FCE5EC", label: "Cancelled" },
    no_show: { fg: "#9A2542", bg: "#FCE5EC", label: "No-show" },
  };
  const m = map[s] ?? { fg: "#475569", bg: "#EEF2F7", label: s };
  return (
    <span className="text-[11.5px] rounded-full px-2 py-0.5" style={{ color: m.fg, background: m.bg, fontWeight: 600 }}>
      {m.label}
    </span>
  );
}

export default function EvChargingPage() {
  const { data: ports = [], isLoading } = useQuery({
    queryKey: ["charging", "ports"],
    queryFn: () => chargingApi.listPorts(),
  });
  const enabled = ports.filter((p) => p.enabled);

  return (
    <Layout title="EV Charging" subtitle="Reserve a port, charge, and view your sessions">
      <div className="space-y-6">
        <ActiveSessionCard />
        <MyReservations />
        <section>
          <h3 className="text-[15px] mb-3" style={{ fontWeight: 700 }}>Charging ports</h3>
          {isLoading ? (
            <div className="text-[13px]" style={{ color: c.inkMute }}>Loading…</div>
          ) : enabled.length === 0 ? (
            <div className="text-[13px]" style={{ color: c.inkMute }}>
              No EV chargers are currently configured. Ask your manager to add ports in Settings.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {enabled.map((p) => <PortCard key={p.id} port={p} />)}
            </div>
          )}
        </section>
        <SessionHistory />
      </div>
    </Layout>
  );
}

function ActiveSessionCard() {
  const queryClient = useQueryClient();
  const { data: sessions = [] } = useQuery({
    queryKey: ["charging", "sessions", "me"],
    queryFn: () => chargingApi.mySessions(),
    refetchInterval: 15_000,
  });
  const active = sessions.find((s) => s.status === "active");
  const stop = useMutation({
    mutationFn: (id: number) => chargingApi.stopSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["charging", "sessions", "me"] });
      queryClient.invalidateQueries({ queryKey: ["charging", "ports"] });
    },
  });
  if (!active) return null;
  return (
    <section className="rounded-xl border bg-white p-5" style={{ borderColor: "#0E8A6B" }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BatteryCharging className="h-6 w-6" style={{ color: "#0E8A6B" }} />
          <div>
            <h3 className="text-[15px]" style={{ fontWeight: 700 }}>Active charging session</h3>
            <p className="text-[12.5px] mt-0.5" style={{ color: c.inkMute }}>
              Started {fmtDateTime(active.startAt)}
              {active.scheduledEndAt ? ` · scheduled to end ${fmtDateTime(active.scheduledEndAt)}` : ""}
            </p>
          </div>
        </div>
        <button
          onClick={() => stop.mutate(active.id)}
          disabled={stop.isPending}
          className="text-[12.5px] rounded-md px-3 py-1.5 inline-flex items-center gap-1.5"
          style={{ background: "#9A2542", color: "#fff", fontWeight: 600 }}
          data-testid="button-stop-session"
        >
          {stop.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <StopCircle className="h-3.5 w-3.5" />}
          Stop charging
        </button>
      </div>
      <div className="grid grid-cols-3 gap-4 mt-4 text-[12.5px]">
        <Stat label="Energy" value={fmtKwh(Number(active.kwh))} />
        <Stat label="Energy cost" value={fmtCents(active.energyCostCents)} />
        <Stat label="Idle minutes" value={String(active.idleMinutes)} />
      </div>
    </section>
  );
}

function MyReservations() {
  const queryClient = useQueryClient();
  const { data: reservations = [] } = useQuery({
    queryKey: ["charging", "reservations", "me"],
    queryFn: () => chargingApi.myReservations(),
  });
  const upcoming = reservations.filter((r) => r.status === "pending" || r.status === "active");
  const cancel = useMutation({
    mutationFn: (id: number) => chargingApi.cancelReservation(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["charging", "reservations", "me"] }),
  });
  if (upcoming.length === 0) return null;
  return (
    <section>
      <h3 className="text-[15px] mb-3" style={{ fontWeight: 700 }}>My upcoming reservations</h3>
      <div className="space-y-2">
        {upcoming.map((r) => (
          <div key={r.id} className="rounded-lg border bg-white p-4 flex items-center justify-between" style={{ borderColor: c.border }}>
            <div>
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4" style={{ color: c.inkMute }} />
                <span className="text-[14px]" style={{ fontWeight: 600 }}>Port #{r.portId}</span>
                {reservationPill(r.status)}
              </div>
              <div className="text-[12.5px] mt-0.5" style={{ color: c.inkMute }}>
                {fmtDateTime(r.startsAt)} — {fmtDateTime(r.endsAt)}
              </div>
            </div>
            {r.status === "pending" && (
              <button
                onClick={() => { if (confirm("Cancel this reservation?")) cancel.mutate(r.id); }}
                disabled={cancel.isPending}
                className="text-[12.5px] rounded-md border px-2.5 py-1.5 inline-flex items-center gap-1.5"
                style={{ borderColor: c.border, color: "#9A2542" }}
                data-testid={`button-cancel-reservation-${r.id}`}
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function PortCard({ port }: { port: ChargingPort }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("18:00");
  const [minutes, setMinutes] = useState(60);
  const [signedName, setSignedName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ["charging", "port", port.id, "status"],
    queryFn: () => chargingApi.portStatus(port.id),
    refetchInterval: 30_000,
  });

  const reserve = useMutation({
    mutationFn: (body: { startsAt: string; endsAt: string }) =>
      chargingApi.createReservation(port.id, body),
    onSuccess: () => {
      setOpen(false); setError(null); setSignedName("");
      queryClient.invalidateQueries({ queryKey: ["charging", "reservations", "me"] });
      queryClient.invalidateQueries({ queryKey: ["charging", "port", port.id, "status"] });
    },
    onError: (err: Error) => setError(err.message || "Could not reserve"),
  });

  const start = useMutation({
    mutationFn: () => chargingApi.startSession(port.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["charging", "sessions", "me"] });
      queryClient.invalidateQueries({ queryKey: ["charging", "port", port.id, "status"] });
    },
    onError: (err: Error) => alert(err.message || "Could not start session"),
  });

  const submit = () => {
    setError(null);
    if (!signedName.trim()) { setError("Please sign with your full name."); return; }
    const startsAt = new Date(`${date}T${time}:00`).toISOString();
    const endsAt = new Date(new Date(startsAt).getTime() + minutes * 60 * 1000).toISOString();
    reserve.mutate({ startsAt, endsAt });
  };

  const live = status?.liveStatus ?? "available";
  const canFcfs = (port.mode === "fcfs" || port.mode === "reserved_fcfs") && live === "available";

  return (
    <div className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5" style={{ color: c.inkMute }} />
            <h4 className="text-[15px]" style={{ fontWeight: 700 }}>{port.name}</h4>
          </div>
          {port.location && (
            <p className="text-[12.5px] mt-1" style={{ color: c.inkMute }}>{port.location}</p>
          )}
        </div>
        {liveBadge(live)}
      </div>
      <div className="grid grid-cols-3 gap-3 mt-3 text-[12px]" style={{ color: c.inkSoft }}>
        <Stat label="Connector" value={port.connectorType} />
        <Stat label="Max" value={`${port.maxKw} kW`} />
        <Stat label="Rate" value={`${fmtCents(port.perKwhCents)}/kWh`} />
      </div>
      <div className="text-[11.5px] mt-3" style={{ color: c.inkMute }}>
        Idle fee {fmtCents(port.idlePerMinuteCents)}/min after {port.idleGraceMinutes} min grace,
        capped at {fmtCents(port.idleCapCents)}.
        {port.noShowFeeCents > 0 ? ` No-show fee ${fmtCents(port.noShowFeeCents)}.` : ""}
      </div>
      <div className="flex items-center gap-2 mt-4">
        {port.mode !== "fcfs" && (
          <button
            onClick={() => setOpen(true)}
            disabled={!user?.unitId}
            className="text-[12.5px] rounded-md px-3 py-1.5 inline-flex items-center gap-1.5"
            style={{ background: user?.unitId ? c.cobalt : "#9CA3AF", color: "#fff", fontWeight: 600 }}
            data-testid={`button-reserve-port-${port.id}`}
          >
            Reserve a slot
          </button>
        )}
        {canFcfs && (
          <button
            onClick={() => { if (confirm("Start a charging session now?")) start.mutate(); }}
            disabled={!user?.unitId || start.isPending}
            className="text-[12.5px] rounded-md border px-3 py-1.5 inline-flex items-center gap-1.5"
            style={{ borderColor: c.border, color: c.ink }}
            data-testid={`button-start-port-${port.id}`}
          >
            {start.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Start now
          </button>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: c.border }}>
              <h3 className="text-[15px]" style={{ fontWeight: 700 }}>Reserve {port.name}</h3>
              <button onClick={() => setOpen(false)}><X className="h-4 w-4" style={{ color: c.inkMute }} /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Date">
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-md border px-2.5 py-1.5 text-[13px]" style={{ borderColor: c.border }} />
                </Field>
                <Field label="Start">
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full rounded-md border px-2.5 py-1.5 text-[13px]" style={{ borderColor: c.border }} />
                </Field>
                <Field label="Duration">
                  <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="w-full rounded-md border px-2.5 py-1.5 text-[13px]" style={{ borderColor: c.border }}>
                    {SLOT_OPTIONS.map((o) => <option key={o.minutes} value={o.minutes}>{o.label}</option>)}
                  </select>
                </Field>
              </div>
              <div className="text-[11.5px] rounded-md border px-3 py-2" style={{ borderColor: c.border, background: "#F8FAFC", color: c.inkMute }}>
                You agree to be billed for the energy delivered during your session at the posted per-kWh rate
                ({fmtCents(port.perKwhCents)}/kWh), and to accept any idle or no-show fees if you overstay or
                miss your reservation.
              </div>
              <Field label="Sign with your full legal name">
                <input
                  value={signedName} onChange={(e) => setSignedName(e.target.value)}
                  placeholder="Type your name"
                  className="w-full rounded-md border px-2.5 py-1.5 text-[13px]"
                  style={{ borderColor: c.border }}
                  data-testid="input-ev-signed-name"
                />
              </Field>
              {error && (
                <div className="rounded-md border px-3 py-2 text-[12.5px]" style={{ borderColor: "#FCA5A5", background: "#FEF2F2", color: "#991B1B" }}>
                  <AlertTriangle className="h-3.5 w-3.5 inline mr-1" /> {error}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t flex items-center justify-end gap-2" style={{ borderColor: c.border }}>
              <button onClick={() => setOpen(false)} className="text-[12.5px] rounded-md border px-3 py-1.5" style={{ borderColor: c.border }}>Cancel</button>
              <button
                onClick={submit}
                disabled={reserve.isPending}
                className="text-[12.5px] rounded-md px-3 py-1.5 inline-flex items-center gap-1.5"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                data-testid="button-confirm-reservation"
              >
                {reserve.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Sign &amp; reserve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SessionHistory() {
  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ["charging", "sessions", "me"],
    queryFn: () => chargingApi.mySessions(),
  });
  const past = sessions.filter((s) => s.status !== "active");
  if (isLoading) return null;
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px]" style={{ fontWeight: 700 }}>Session history</h3>
        {past.length > 0 && (
          <a href={chargingApi.csvUrl()} className="text-[12.5px] rounded-md border px-2.5 py-1.5 inline-flex items-center gap-1.5"
             style={{ borderColor: c.border, color: c.inkSoft }}>
            <Download className="h-3.5 w-3.5" /> Download CSV
          </a>
        )}
      </div>
      {past.length === 0 ? (
        <div className="text-[13px]" style={{ color: c.inkMute }}>No prior sessions yet.</div>
      ) : (
        <div className="rounded-xl border bg-white" style={{ borderColor: c.border }}>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr style={{ color: c.inkMute, background: "#F8FAFC" }}>
                <th className="text-left px-3 py-2" style={{ fontWeight: 600 }}>Started</th>
                <th className="text-left px-3 py-2" style={{ fontWeight: 600 }}>Ended</th>
                <th className="text-right px-3 py-2" style={{ fontWeight: 600 }}>Energy</th>
                <th className="text-right px-3 py-2" style={{ fontWeight: 600 }}>Idle</th>
                <th className="text-right px-3 py-2" style={{ fontWeight: 600 }}>Total</th>
                <th className="text-right px-3 py-2" style={{ fontWeight: 600 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {past.map((s) => (
                <tr key={s.id} className="border-t" style={{ borderColor: c.border }}>
                  <td className="px-3 py-2">{fmtDateTime(s.startAt)}</td>
                  <td className="px-3 py-2">{s.endAt ? fmtDateTime(s.endAt) : "—"}</td>
                  <td className="px-3 py-2 text-right">{fmtKwh(Number(s.kwh))}</td>
                  <td className="px-3 py-2 text-right">{s.idleMinutes} min</td>
                  <td className="px-3 py-2 text-right">{fmtCents(s.costCents)}</td>
                  <td className="px-3 py-2 text-right">{sessionStatusPill(s.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
