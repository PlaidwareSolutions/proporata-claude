// Task #188: Resident-side surface for open violations and any upcoming
// hearings the owner is expected to attend. Reads from the existing
// /compliance/violations endpoint, which the API already scopes to the
// authenticated resident's own violations.

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, Calendar as CalIcon, CheckCircle2, Circle } from "lucide-react";
import { c } from "@/lib/theme";
import { complianceApi, type Violation } from "@/lib/complianceApi";

const OPEN_STATUSES: Violation["status"][] = ["open", "noticed", "hearing"];

type Stage = { key: string; label: string; date: string | null };

function stages(v: Violation): Stage[] {
  return [
    { key: "first_notice",  label: "First notice",   date: v.firstNoticeDate },
    { key: "cure_deadline", label: "Cure deadline",  date: v.cureDeadline },
    { key: "second_notice", label: "Second notice",  date: v.secondNoticeDate },
    { key: "hearing",       label: "Hearing",        date: v.hearingDate },
  ];
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const iso = d.length <= 10 ? `${d}T00:00:00` : d;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString();
}

export function MyViolationsCard() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["compliance-violations", "mine"],
    queryFn: complianceApi.listViolations,
    refetchOnWindowFocus: false,
  });

  if (isLoading) return null;
  const openViolations = data.filter((v) => OPEN_STATUSES.includes(v.status));
  if (openViolations.length === 0) return null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const upcomingHearings = openViolations
    .filter((v) => v.hearingDate && v.hearingDate >= todayIso)
    .sort((a, b) => (a.hearingDate ?? "").localeCompare(b.hearingDate ?? ""));

  return (
    <section
      className="rounded-xl border p-5"
      style={{ background: c.panel, borderColor: c.border }}
      data-testid="my-violations-card"
    >
      <div className="flex items-center gap-2.5 mb-3">
        <AlertTriangle className="h-5 w-5" style={{ color: c.amber }} />
        <h2 className="text-[16px]" style={{ fontWeight: 700 }}>My Violations</h2>
        <span
          className="font-mono-num text-[11px] px-2 py-0.5 rounded"
          style={{ background: c.amberSoft, color: c.amber, fontWeight: 700 }}
        >
          {openViolations.length} open
        </span>
      </div>

      {upcomingHearings.length > 0 && (
        <div
          className="mb-3 rounded-lg border p-3"
          style={{ borderColor: c.border, background: c.cobaltSoft }}
          data-testid="my-violations-hearings"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <CalIcon className="h-4 w-4" style={{ color: c.cobalt }} />
            <div className="text-[12.5px]" style={{ fontWeight: 700, color: c.cobalt }}>
              {upcomingHearings.length === 1
                ? "You have a hearing on the calendar"
                : "You have hearings on the calendar"}
            </div>
          </div>
          <ul className="space-y-1">
            {upcomingHearings.map((v) => (
              <li
                key={`h-${v.id}`}
                className="text-[12.5px]"
                style={{ color: c.ink }}
                data-testid={`my-violation-hearing-${v.id}`}
              >
                <Link
                  href={`/portal/hearings/${v.id}`}
                  className="hover:underline"
                  data-testid={`my-violation-hearing-link-${v.id}`}
                >
                  <span style={{ fontWeight: 600 }}>{v.category}</span>
                  {" — "}
                  {fmtDate(v.hearingDate)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="space-y-3">
        {openViolations.map((v) => {
          const allStages = stages(v);
          return (
            <li
              key={v.id}
              className="rounded-lg border p-3.5"
              style={{ borderColor: c.borderSoft }}
              data-testid={`my-violation-${v.id}`}
            >
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="text-[13.5px]" style={{ fontWeight: 600, color: c.ink }}>
                  {v.category}
                </span>
                <span
                  className="text-[10.5px] px-2 py-0.5 rounded-full capitalize"
                  style={{ background: c.amberSoft, color: c.amber, fontWeight: 700 }}
                >
                  {v.status}
                </span>
                <span className="text-[11.5px]" style={{ color: c.inkMute }}>
                  · Observed {fmtDate(v.observedAt.slice(0, 10))}
                </span>
              </div>
              {v.description && (
                <div className="text-[12.5px] mb-2" style={{ color: c.inkSoft }}>
                  {v.description}
                </div>
              )}
              <ol className="grid grid-cols-4 gap-2">
                {allStages.map((s) => {
                  const hasDate = !!s.date;
                  const past = hasDate && (s.date as string) <= todayIso;
                  const Icon = past ? CheckCircle2 : Circle;
                  const color = !hasDate ? c.inkMute : past ? c.emerald : c.cobalt;
                  return (
                    <li key={s.key} className="text-center">
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
              {v.fineCents > 0 && (
                <div className="mt-2 text-[11.5px]" style={{ color: c.rose, fontWeight: 600 }}>
                  Fine: ${(v.fineCents / 100).toFixed(2)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
