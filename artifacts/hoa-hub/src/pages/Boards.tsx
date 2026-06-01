import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { useEffect, useState } from "react";
import { Vote, Calendar, History, User as UserIcon, FileText, Gavel, Download } from "lucide-react";
import {
  useGetBoardAtDate,
  useListBoardHistory,
} from "@workspace/api-client-react";
import { resolutionsApi, type ResolutionListItem } from "@/lib/resolutionsApi";
import { meetingsApi, type MeetingListItem } from "@/lib/meetingsApi";

const OFFICER_ORDER: Record<string, number> = {
  "President": 0,
  "Vice President": 1,
  "Secretary": 2,
  "Treasurer": 3,
  "Member-at-Large": 4,
};

function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  return s.slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function actionLabel(action: string): string {
  switch (action) {
    case "board_member_added": return "Added to board";
    case "board_member_removed": return "Removed from board";
    case "officer_title_assigned": return "Officer title assigned";
    case "officer_title_changed": return "Officer title changed";
    case "officer_title_cleared": return "Officer title cleared";
    case "officer_term_updated": return "Term dates updated";
    default: return action;
  }
}

export default function Boards() {
  const [date, setDate] = useState<string>(todayIso());
  const { data: roster } = useGetBoardAtDate({ date });
  const { data: history = [] } = useListBoardHistory();

  const [resolutions, setResolutions] = useState<ResolutionListItem[]>([]);
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [docsError, setDocsError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rs, ms] = await Promise.all([
          resolutionsApi.list({ status: "active" }),
          meetingsApi.list("adjourned"),
        ]);
        if (cancelled) return;
        setResolutions(rs);
        setMeetings(ms.filter((m) => m.minutesStatus === "adopted"));
      } catch (err) {
        if (!cancelled) setDocsError(err instanceof Error ? err.message : "Failed to load governance documents");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const members = [...(roster?.members ?? [])].sort((a, b) => {
    const ai = a.officerTitle ? (OFFICER_ORDER[a.officerTitle] ?? 99) : 99;
    const bi = b.officerTitle ? (OFFICER_ORDER[b.officerTitle] ?? 99) : 99;
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });

  return (
    <Layout
      title="Board of Directors"
      subtitle="Current officers and term dates, plus the historical record of board membership and officer changes."
    >
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Vote className="h-4 w-4" style={{ color: "#5A3FD9" }} />
              <h2 className="text-[15px]" style={{ fontWeight: 700 }}>
                {date === todayIso() ? "Current roster" : `Roster on ${date}`}
              </h2>
              <span className="text-[12px]" style={{ color: c.inkMute }}>
                ({members.length} member{members.length === 1 ? "" : "s"})
              </span>
            </div>
            <label className="inline-flex items-center gap-2 text-[12px]" style={{ color: c.inkSoft, fontWeight: 500 }}>
              <Calendar className="h-3.5 w-3.5" style={{ color: c.inkMute }} />
              <span>As of:</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value || todayIso())}
                className="rounded-md border px-2 py-1 text-[12px] bg-white"
                style={{ borderColor: c.borderSoft }}
              />
              {date !== todayIso() && (
                <button
                  type="button"
                  onClick={() => setDate(todayIso())}
                  className="text-[11.5px] underline"
                  style={{ color: c.cobalt }}
                >
                  Today
                </button>
              )}
            </label>
          </div>

          {members.length === 0 ? (
            <div className="text-[13px] py-6 text-center" style={{ color: c.inkMute }}>
              No board members were active on this date.
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.id} className="rounded-lg border p-3 flex items-center gap-3" style={{ borderColor: c.borderSoft }}>
                  <div className="h-8 w-8 rounded-full flex items-center justify-center" style={{ background: c.cobaltSoft, color: c.cobalt }}>
                    <UserIcon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] flex items-center gap-2 flex-wrap" style={{ fontWeight: 600, color: c.ink }}>
                      <span>{m.name || <span style={{ color: c.inkMute, fontStyle: "italic" }}>No name</span>}</span>
                      {m.officerTitle && (
                        <span
                          className="text-[10.5px] px-1.5 py-0.5 rounded-full"
                          style={{ background: "#EDE7FF", color: "#5A3FD9", fontWeight: 600 }}
                        >
                          {m.officerTitle}
                        </span>
                      )}
                    </div>
                    {m.email && (
                      <div className="text-[12px]" style={{ color: c.inkMute }}>{m.email}</div>
                    )}
                  </div>
                  <div className="text-[11.5px] text-right" style={{ color: c.inkMute }}>
                    <div>Term: {formatDate(m.termStart)} → {formatDate(m.termEnd)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
          <div className="flex items-center gap-2 mb-4">
            <History className="h-4 w-4" style={{ color: c.inkMute }} />
            <h2 className="text-[15px]" style={{ fontWeight: 700 }}>Change history</h2>
            <span className="text-[12px]" style={{ color: c.inkMute }}>
              ({history.length} entr{history.length === 1 ? "y" : "ies"})
            </span>
          </div>
          {history.length === 0 ? (
            <div className="text-[13px] py-6 text-center" style={{ color: c.inkMute }}>
              No changes recorded yet.
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="rounded-md border px-3 py-2 text-[12.5px]"
                  style={{ borderColor: c.borderSoft }}
                >
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <div style={{ fontWeight: 600, color: c.ink }}>{actionLabel(h.action)}</div>
                    <div style={{ color: c.inkMute, fontSize: 11 }}>{h.createdAt.slice(0, 16).replace("T", " ")}</div>
                  </div>
                  <div className="mt-1" style={{ color: c.inkSoft }}>
                    <strong>{h.userName || `User #${h.userId}`}</strong>
                    {h.oldOfficerTitle !== h.newOfficerTitle && (
                      <span> — title: <strong>{h.oldOfficerTitle ?? "—"}</strong> → <strong>{h.newOfficerTitle ?? "—"}</strong></span>
                    )}
                    {(h.oldTermStart !== h.newTermStart || h.oldTermEnd !== h.newTermEnd) && (
                      <span> — term: {formatDate(h.oldTermStart)}–{formatDate(h.oldTermEnd)} → {formatDate(h.newTermStart)}–{formatDate(h.newTermEnd)}</span>
                    )}
                    {h.oldBoardMember !== h.newBoardMember && (
                      <span> — board flag: {h.oldBoardMember ? "yes" : "no"} → {h.newBoardMember ? "yes" : "no"}</span>
                    )}
                  </div>
                  <div className="mt-0.5" style={{ color: c.inkMute, fontSize: 11 }}>
                    by {h.actorName || "(system)"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }} data-testid="section-board-resolutions">
          <div className="flex items-center gap-2 mb-4">
            <Gavel className="h-4 w-4" style={{ color: "#5A3FD9" }} />
            <h2 className="text-[15px]" style={{ fontWeight: 700 }}>Adopted resolutions</h2>
            <span className="text-[12px]" style={{ color: c.inkMute }}>
              ({resolutions.length})
            </span>
          </div>
          {docsError ? (
            <div className="text-[13px] py-3" style={{ color: "#B8264C" }}>{docsError}</div>
          ) : resolutions.length === 0 ? (
            <div className="text-[13px] py-6 text-center" style={{ color: c.inkMute }}>
              No adopted resolutions yet.
            </div>
          ) : (
            <div className="space-y-2">
              {resolutions.map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg border p-3 flex items-center gap-3"
                  style={{ borderColor: c.borderSoft }}
                  data-testid={`row-board-resolution-${r.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] flex items-center gap-2 flex-wrap" style={{ fontWeight: 600, color: c.ink }}>
                      <span>{r.number ? `Resolution ${r.number}` : "Draft resolution"}</span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: "#EDE7FF", color: "#5A3FD9", fontWeight: 600 }}>
                        {r.category}
                      </span>
                    </div>
                    <div className="text-[12.5px] mt-0.5" style={{ color: c.inkSoft }}>{r.title}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: c.inkMute }}>
                      Adopted {formatDate(r.adoptedAt)}
                    </div>
                  </div>
                  {r.pdfStorageKey && (
                    <a
                      href={resolutionsApi.pdfUrl(r.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-md border"
                      style={{ borderColor: c.borderSoft, color: c.cobalt }}
                      data-testid={`link-board-resolution-pdf-${r.id}`}
                    >
                      <Download className="h-3.5 w-3.5" />
                      PDF
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }} data-testid="section-board-minutes">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="h-4 w-4" style={{ color: "#0E8A6B" }} />
            <h2 className="text-[15px]" style={{ fontWeight: 700 }}>Meeting minutes</h2>
            <span className="text-[12px]" style={{ color: c.inkMute }}>
              ({meetings.length} adopted)
            </span>
          </div>
          {docsError ? (
            <div className="text-[13px] py-3" style={{ color: "#B8264C" }}>{docsError}</div>
          ) : meetings.length === 0 ? (
            <div className="text-[13px] py-6 text-center" style={{ color: c.inkMute }}>
              No adopted meeting minutes yet.
            </div>
          ) : (
            <div className="space-y-2">
              {meetings.map((m) => (
                <div
                  key={m.id}
                  className="rounded-lg border p-3 flex items-center gap-3"
                  style={{ borderColor: c.borderSoft }}
                  data-testid={`row-board-minutes-${m.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] flex items-center gap-2 flex-wrap" style={{ fontWeight: 600, color: c.ink }}>
                      <span>{m.title}</span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: "#DCF3EC", color: "#0E8A6B", fontWeight: 600 }}>
                        {m.kind}
                      </span>
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: c.inkMute }}>
                      Met on {m.scheduledAt.slice(0, 10)}
                    </div>
                  </div>
                  <a
                    href={meetingsApi.minutesPdfUrl(m.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-md border"
                    style={{ borderColor: c.borderSoft, color: c.cobalt }}
                    data-testid={`link-board-minutes-pdf-${m.id}`}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Minutes PDF
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
