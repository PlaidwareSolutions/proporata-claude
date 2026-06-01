import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Gavel, Calendar, ArrowRight } from "lucide-react";
import { c } from "@/lib/theme";
import { useAuth } from "@/contexts/AuthContext";
import { motionsApi } from "@/lib/motionsApi";

type Variant = "compact" | "detailed";

export function MotionsAwaitingVoteWidget({ variant = "detailed" }: { variant?: Variant }) {
  const { user } = useAuth();
  // Task #142: load every motion the API will return for this user.
  // Board members and managers see board-audience motions; owners (in
  // good standing or not — the server filters write access) see open
  // member-audience motions. We surface any motion the user has not
  // yet voted on regardless of audience.
  const { data: openMotions = [] } = useQuery({
    queryKey: ["motions-list", "open"],
    queryFn: () => motionsApi.list("open"),
    enabled: !!user,
    refetchInterval: 60000,
  });

  if (!user) return null;
  // Only surface motions the API says this user is currently allowed to
  // vote on (Task #142: gate by audience + good standing). Without this
  // filter, suspended owners would see member motions in their portal
  // that they cannot actually vote on.
  const awaiting = openMotions.filter((m) => m.canVote && !m.myVote);
  if (awaiting.length === 0) return null;

  return (
    <section
      className="rounded-xl border bg-white p-5 mb-5"
      style={{ borderColor: c.border }}
      data-testid="motions-awaiting-vote"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ background: c.cobaltSoft, color: c.cobalt }}
          >
            <Gavel className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-[15px]" style={{ fontWeight: 700, color: c.ink }}>
              Motions awaiting your vote
            </h3>
            <div className="text-[12px]" style={{ color: c.inkMute, fontWeight: 500 }}>
              {awaiting.length} open {awaiting.length === 1 ? "motion needs" : "motions need"} your decision
            </div>
          </div>
        </div>
        <Link
          href="/motions"
          className="text-[13px] inline-flex items-center gap-1"
          style={{ color: c.cobalt, fontWeight: 600 }}
        >
          All motions <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <ul className="space-y-2">
        {awaiting.slice(0, 5).map((m) => (
          <li key={m.id}>
            <Link
              href={`/motions?open=${m.id}`}
              className="flex items-center gap-3 rounded-md border px-3 py-2.5 hover:bg-slate-50 transition-colors"
              style={{ borderColor: c.borderSoft }}
              data-testid={`motion-awaiting-${m.id}`}
            >
              <div
                className="font-mono-num text-[12px] rounded px-1.5 py-0.5"
                style={{ background: "#F1F3FA", color: c.inkSoft, fontWeight: 700 }}
              >
                M-{m.id}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] truncate" style={{ fontWeight: 600, color: c.ink }}>{m.title}</div>
                <div className="text-[11.5px]" style={{ color: c.inkMute, fontWeight: 500 }}>
                  {m.kind} · {m.votingRuleDescription}
                  {variant === "detailed" && (
                    <>
                      {" · "}
                      <span style={{ color: "#0E8A6B" }}>{m.tally.approve}✓</span>{" "}
                      <span style={{ color: "#B8264C" }}>{m.tally.reject}✗</span>{" "}
                      <span>{m.tally.abstain}–</span>
                      {m.needed !== null && <span> / {m.needed}</span>}
                    </>
                  )}
                </div>
              </div>
              {m.closesAt && (
                <div
                  className="text-[11.5px] flex items-center gap-1 shrink-0"
                  style={{ color: c.inkMute, fontWeight: 500 }}
                >
                  <Calendar className="h-3 w-3" />
                  Closes {m.closesAt.slice(0, 10)}
                </div>
              )}
              <ArrowRight className="h-4 w-4 shrink-0" style={{ color: c.inkMute }} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
