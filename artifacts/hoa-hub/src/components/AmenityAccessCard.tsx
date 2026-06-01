import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/apiFetch";
import { c } from "@/lib/theme";
import { QrCode, RotateCcw, Loader2 } from "lucide-react";

type AccessCode = { id: number; bookingId: number; code: string; token: string; qrSvg?: string; validFrom: string; validUntil: string; revokedAt?: string | null; providerKind?: string };
type GuestPass = { id: number; bookingId: number; guestName: string; guestVehiclePlate?: string; checkedInAt?: string | null };

export function AmenityAccessCard({ bookingId, canManage }: { bookingId: number; canManage: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<AccessCode | null>({
    queryKey: ["/amenity-bookings", bookingId, "access-code"],
    queryFn: async () => {
      try { return await apiFetch<AccessCode>({ url: `/amenity-bookings/${bookingId}/access-code`, method: "GET" }); }
      catch { return null; }
    },
  });
  const reissue = useMutation({
    mutationFn: () => apiFetch<AccessCode>({ url: `/amenity-bookings/${bookingId}/access-code/reissue`, method: "POST", data: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/amenity-bookings", bookingId, "access-code"] }),
  });

  const { data: guests = [] } = useQuery<GuestPass[]>({
    queryKey: ["/amenity-bookings", bookingId, "guests"],
    queryFn: () => apiFetch<GuestPass[]>({ url: `/amenity-bookings/${bookingId}/guests`, method: "GET" }),
  });

  if (isLoading) return <div className="text-sm" style={{ color: c.inkMute }}>Loading access code…</div>;
  if (!data) return <div className="text-sm" style={{ color: c.inkMute }}>No access code yet (booking must be confirmed).</div>;

  const revoked = !!data.revokedAt;

  return (
    <div className="rounded-2xl border p-4 bg-white" style={{ borderColor: c.border }}>
      <div className="flex items-center gap-2 mb-3"><QrCode size={18} style={{ color: c.cobalt }} /><h4 className="font-semibold">Access code</h4>
        {revoked && <span className="text-[11.5px] rounded-full px-2 py-0.5 font-semibold" style={{ color: "#9A2542", background: "#FCE5EC" }}>revoked</span>}
      </div>
      <div className="grid sm:grid-cols-[auto_1fr] gap-4 items-start">
        {data.qrSvg ? (
          <div className="w-40 h-40 border rounded-lg p-2 flex items-center justify-center" style={{ borderColor: c.border }} dangerouslySetInnerHTML={{ __html: data.qrSvg }} />
        ) : (
          <div className="w-40 h-40 border rounded-lg flex items-center justify-center" style={{ borderColor: c.border, color: c.inkMute }}>QR unavailable</div>
        )}
        <div className="space-y-1.5 text-sm">
          <div><span style={{ color: c.inkMute }}>Code:</span> <span className="font-mono text-base font-semibold tracking-wider">{data.code}</span></div>
          <div><span style={{ color: c.inkMute }}>Valid:</span> {new Date(data.validFrom).toLocaleString()} → {new Date(data.validUntil).toLocaleString()}</div>
          <div><span style={{ color: c.inkMute }}>Provider:</span> {data.providerKind || "virtual_lock"}</div>
          {canManage && (
            <button onClick={() => reissue.mutate()} disabled={reissue.isPending} className="mt-2 px-3 py-1.5 rounded-lg text-xs border flex items-center gap-1" style={{ borderColor: c.border }}>
              {reissue.isPending ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Reissue
            </button>
          )}
        </div>
      </div>

      <GuestPassEditor bookingId={bookingId} canManage={canManage} guests={guests} />
    </div>
  );
}

function GuestPassEditor({ bookingId, canManage, guests }: { bookingId: number; canManage: boolean; guests: GuestPass[] }) {
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: (data: { guestName: string; guestVehiclePlate?: string }) => apiFetch({ url: `/amenity-bookings/${bookingId}/guests`, method: "POST", data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/amenity-bookings", bookingId, "guests"] }),
  });
  const del = useMutation({
    mutationFn: (id: number) => apiFetch({ url: `/amenity-bookings/${bookingId}/guests/${id}`, method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/amenity-bookings", bookingId, "guests"] }),
  });
  return (
    <div className="mt-4 pt-4 border-t" style={{ borderColor: c.border }}>
      <div className="text-sm font-semibold mb-2">Guest passes ({guests.length})</div>
      <ul className="space-y-1 mb-2">
        {guests.map((g) => (
          <li key={g.id} className="flex items-center justify-between text-sm">
            <span>{g.guestName}{g.guestVehiclePlate ? ` · ${g.guestVehiclePlate}` : ""}{g.checkedInAt ? " · checked in" : ""}</span>
            {canManage && <button onClick={() => del.mutate(g.id)} className="text-xs" style={{ color: "#9A2542" }}>Remove</button>}
          </li>
        ))}
      </ul>
      {canManage && (
        <form onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const guestName = String(fd.get("name") || "").trim();
          const guestVehiclePlate = String(fd.get("plate") || "").trim();
          if (!guestName) return;
          add.mutate({ guestName, guestVehiclePlate });
          (e.currentTarget as HTMLFormElement).reset();
        }} className="flex gap-2">
          <input name="name" placeholder="Guest name" className="flex-1 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: c.border }} />
          <input name="plate" placeholder="Plate (optional)" className="w-32 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: c.border }} />
          <button type="submit" className="px-3 py-1.5 rounded-lg text-white text-sm" style={{ background: c.cobalt }}>Add</button>
        </form>
      )}
    </div>
  );
}
