import { Link } from "wouter";
import { Gavel, ShieldAlert } from "lucide-react";
import { useGetMotion } from "@workspace/api-client-react";
import { c } from "@/lib/theme";
import { MOTION_STATUS_LABELS } from "@/pages/Motions";

interface Props {
  motionId: number | null;
  bypassId: number | null;
  label?: string;
}

export function MotionAuthorizationCard({ motionId, bypassId, label = "Authorization" }: Props) {
  if (!motionId && !bypassId) return null;
  return (
    <section className="rounded-xl border bg-white p-4" style={{ borderColor: c.border }}>
      <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: c.inkMute, fontWeight: 700 }}>
        {label}
      </div>
      {motionId ? <MotionLine motionId={motionId} /> : null}
      {bypassId ? <BypassLine bypassId={bypassId} /> : null}
    </section>
  );
}

function MotionLine({ motionId }: { motionId: number }) {
  const { data: motion, isLoading, error } = useGetMotion(motionId);
  const statusKey = motion?.status ?? "adopted";
  const sm = MOTION_STATUS_LABELS[statusKey] ?? { label: statusKey, bg: "#EEF1F8", fg: "#5A6280" };
  return (
    <div className="flex items-center gap-2 flex-wrap text-[13px]" style={{ color: c.ink }}>
      <Gavel className="h-4 w-4" style={{ color: c.cobalt }} />
      <span>Authorized by</span>
      <Link href={`/motions?open=${motionId}`}>
        <a className="font-mono-num hover:underline" style={{ color: c.cobalt, fontWeight: 700 }}>
          Motion M-{motionId}
        </a>
      </Link>
      {motion ? (
        <>
          <span className="truncate max-w-[420px]" style={{ color: c.inkSoft }} title={motion.title}>
            — {motion.title}
          </span>
          <span className="rounded px-2 py-0.5 text-[11px]" style={{ background: sm.bg, color: sm.fg, fontWeight: 700 }}>
            {sm.label}
          </span>
        </>
      ) : isLoading ? (
        <span style={{ color: c.inkMute }}>Loading…</span>
      ) : error ? (
        <span style={{ color: c.inkMute }}>(motion details unavailable)</span>
      ) : null}
    </div>
  );
}

function BypassLine({ bypassId }: { bypassId: number }) {
  return (
    <div className="mt-1.5 flex items-center gap-2 text-[12.5px]" style={{ color: "#9A6500" }}>
      <ShieldAlert className="h-4 w-4" />
      <span>
        Authorized via Emergency Bypass <span className="font-mono-num" style={{ fontWeight: 700 }}>#{bypassId}</span>
        {" — pending board ratification"}
      </span>
    </div>
  );
}
