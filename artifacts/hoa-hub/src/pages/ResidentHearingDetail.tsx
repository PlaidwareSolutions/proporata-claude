// Task #188: Resident-side hearing detail. Links from the "My Violations"
// card on the resident dashboard. Loads from /compliance/violations (which
// the API already scopes to req.user for residents) and shows the hearing
// metadata for the linked violation.

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import {
  ArrowLeft,
  Calendar as CalIcon,
  MapPin,
  Video,
  AlertTriangle,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { complianceApi, type Violation } from "@/lib/complianceApi";

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const iso = d.length <= 10 ? `${d}T00:00:00` : d;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString();
}

function fmtDateTime(d: string | null | undefined): string {
  if (!d) return "—";
  const iso = d.length <= 10 ? `${d}T00:00:00` : d;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleString();
}

function stages(v: Violation) {
  return [
    { key: "first_notice",  label: "First notice",   date: v.firstNoticeDate },
    { key: "cure_deadline", label: "Cure deadline",  date: v.cureDeadline },
    { key: "second_notice", label: "Second notice",  date: v.secondNoticeDate },
    { key: "hearing",       label: "Hearing",        date: v.hearingDate },
  ];
}

export default function ResidentHearingDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { data = [], isLoading } = useQuery({
    queryKey: ["compliance-violations", "mine"],
    queryFn: complianceApi.listViolations,
  });

  const violation = data.find((v) => v.id === id);
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <Layout title="Hearing details" subtitle="From your open violations">
      <div className="max-w-3xl">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-[12.5px] mb-4"
          style={{ color: c.cobalt, fontWeight: 600 }}
          data-testid="hearing-detail-back"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
        </Link>

        {isLoading ? (
          <div className="rounded-xl border p-6 text-[13px]" style={{ borderColor: c.border, color: c.inkMute }}>
            Loading…
          </div>
        ) : !violation ? (
          <div className="rounded-xl border p-6 text-[13px]" style={{ borderColor: c.border, color: c.inkMute }}>
            We couldn't find that hearing on your account. It may have been
            resolved, dismissed, or it isn't tied to your unit.
          </div>
        ) : (
          <div
            className="rounded-xl border p-5 space-y-4"
            style={{ background: c.panel, borderColor: c.border }}
            data-testid="hearing-detail-card"
          >
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="h-5 w-5" style={{ color: c.amber }} />
              <h1 className="text-[17px]" style={{ fontWeight: 700, color: c.ink }}>
                {violation.category}
              </h1>
              <span
                className="text-[10.5px] px-2 py-0.5 rounded-full capitalize"
                style={{ background: c.amberSoft, color: c.amber, fontWeight: 700 }}
              >
                {violation.status}
              </span>
            </div>

            {violation.description && (
              <div className="text-[13px]" style={{ color: c.inkSoft }}>
                {violation.description}
              </div>
            )}

            <div
              className="rounded-lg border p-4"
              style={{ borderColor: c.border, background: c.cobaltSoft }}
            >
              <div className="flex items-center gap-2 mb-2">
                <CalIcon className="h-4 w-4" style={{ color: c.cobalt }} />
                <div className="text-[13px]" style={{ fontWeight: 700, color: c.cobalt }}>
                  Hearing
                </div>
              </div>
              {violation.hearingDate ? (
                <div className="text-[13.5px]" style={{ color: c.ink, fontWeight: 600 }} data-testid="hearing-detail-when">
                  {fmtDateTime(violation.hearingDate)}
                </div>
              ) : (
                <div className="text-[13px]" style={{ color: c.inkMute }}>
                  No hearing has been scheduled yet.
                </div>
              )}
              <div className="mt-2 flex items-center gap-1.5 text-[12.5px]" style={{ color: c.inkSoft }}>
                <MapPin className="h-3.5 w-3.5" /> Location and call-in details
                will be posted on the community calendar.
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href="/calendar"
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px]"
                  style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                  data-testid="hearing-detail-calendar-link"
                >
                  <CalIcon className="h-3.5 w-3.5" /> Open community calendar
                </Link>
                <a
                  href={`/api/calendar/feed.ics`}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px]"
                  style={{ borderColor: c.border, color: c.ink, fontWeight: 600 }}
                  data-testid="hearing-detail-ics-link"
                >
                  <Video className="h-3.5 w-3.5" /> Subscribe (iCal)
                </a>
              </div>
            </div>

            <div>
              <div className="text-[12px] uppercase tracking-wider mb-2" style={{ color: c.inkMute, fontWeight: 700 }}>
                Stage timeline
              </div>
              <ol className="grid grid-cols-4 gap-2">
                {stages(violation).map((s) => {
                  const hasDate = !!s.date;
                  const past = hasDate && (s.date as string) <= todayIso;
                  const Icon = past ? CheckCircle2 : Circle;
                  const color = !hasDate ? c.inkMute : past ? c.emerald : c.cobalt;
                  return (
                    <li
                      key={s.key}
                      className="rounded-lg border p-3 text-center"
                      style={{ borderColor: c.borderSoft }}
                    >
                      <Icon className="h-4 w-4 mx-auto mb-1" style={{ color }} />
                      <div className="text-[11px]" style={{ color: c.inkSoft, fontWeight: 600 }}>
                        {s.label}
                      </div>
                      <div className="text-[11px] font-mono-num" style={{ color: c.inkMute }}>
                        {hasDate ? fmtDate(s.date) : "—"}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            {violation.fineCents > 0 && (
              <div className="text-[12.5px]" style={{ color: c.rose, fontWeight: 600 }}>
                Fine on record: ${(violation.fineCents / 100).toFixed(2)}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
