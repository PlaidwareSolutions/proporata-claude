import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { useState } from "react";
import {
  Send, Clock, Users, Building2, Home, CheckCircle2, Loader2,
} from "lucide-react";
import {
  useListCommunicationLog,
  useSendBroadcast,
  useListBuildings,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListCommunicationLogQueryKey } from "@workspace/api-client-react";

type RecipientGroup = "all_owners" | "all_tenants" | "specific_building";

const GROUPS: { value: RecipientGroup; label: string; icon: React.ElementType; desc: string }[] = [
  { value: "all_owners", label: "All Owners", icon: Home, desc: "All unit owner residents" },
  { value: "all_tenants", label: "All Tenants", icon: Users, desc: "All tenant residents" },
  { value: "specific_building", label: "Specific Building", icon: Building2, desc: "Residents of one building" },
];

const GROUP_LABELS: Record<string, string> = {
  all_owners: "All Owners",
  all_tenants: "All Tenants",
  specific_building: "Building",
};

export default function Communications() {
  const queryClient = useQueryClient();
  const { data: log = [], isLoading: logLoading } = useListCommunicationLog();
  const { data: buildings = [] } = useListBuildings();
  const sendMutation = useSendBroadcast();

  const [group, setGroup] = useState<RecipientGroup>("all_owners");
  const [buildingId, setBuildingId] = useState<number | undefined>();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSend() {
    if (!subject.trim() || !body.trim()) return;
    if (group === "specific_building" && !buildingId) return;
    setSendState("sending");
    setErrorMsg("");
    try {
      await sendMutation.mutateAsync({
        data: {
          recipientGroup: group,
          buildingId: group === "specific_building" ? buildingId : undefined,
          subject: subject.trim(),
          body: body.trim(),
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListCommunicationLogQueryKey() });
      setSendState("sent");
      setSubject("");
      setBody("");
      setTimeout(() => setSendState("idle"), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to send message");
      setSendState("error");
      setTimeout(() => setSendState("idle"), 4000);
    }
  }

  return (
    <Layout
      title="Communications"
      subtitle="Broadcast messages to owners, tenants, or buildings"
    >
      <div className="grid grid-cols-5 gap-6">
        <div className="col-span-2 space-y-5">
          <section className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
            <h3 className="text-[15px] mb-4" style={{ fontWeight: 700, color: c.ink }}>
              Compose Message
            </h3>

            <div className="mb-4">
              <div className="text-[12px] mb-2" style={{ color: c.inkMute, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Recipients
              </div>
              <div className="space-y-2">
                {GROUPS.map((g) => {
                  const Icon = g.icon;
                  const active = group === g.value;
                  return (
                    <button
                      key={g.value}
                      onClick={() => { setGroup(g.value); setBuildingId(undefined); }}
                      className="w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors"
                      style={{
                        borderColor: active ? c.cobalt : c.borderSoft,
                        background: active ? c.cobaltSoft : "white",
                      }}
                    >
                      <div
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                        style={{ background: active ? c.cobalt : c.canvas }}
                      >
                        <Icon className="h-3.5 w-3.5" style={{ color: active ? "white" : c.inkMute }} />
                      </div>
                      <div>
                        <div className="text-[13px]" style={{ fontWeight: 600, color: active ? c.cobalt : c.ink }}>
                          {g.label}
                        </div>
                        <div className="text-[11.5px]" style={{ color: c.inkMute }}>{g.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {group === "specific_building" && (
              <div className="mb-4">
                <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Building
                </label>
                <select
                  value={buildingId ?? ""}
                  onChange={(e) => setBuildingId(e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full rounded-md border px-3 py-2 text-[13px] bg-white"
                  style={{ borderColor: c.border, color: c.ink }}
                >
                  <option value="">Select building…</option>
                  {buildings.map((b) => (
                    <option key={b.num} value={b.num}>
                      Building {b.num} — {b.street}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mb-3">
              <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Subject
              </label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Annual Meeting Reminder"
                className="w-full rounded-md border px-3 py-2 text-[13.5px]"
                style={{ borderColor: c.border, color: c.ink }}
              />
            </div>

            <div className="mb-4">
              <label className="block text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Message
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                placeholder="Write your message here…"
                className="w-full rounded-md border px-3 py-2 text-[13.5px] resize-none"
                style={{ borderColor: c.border, color: c.ink }}
              />
            </div>

            {sendState === "error" && (
              <div className="mb-3 rounded-md px-3 py-2 text-[12.5px]" style={{ background: "#FEF2F2", color: "#B91C1C" }}>
                {errorMsg || "Failed to send. Please try again."}
              </div>
            )}

            {sendState === "sent" && (
              <div className="mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-[12.5px]" style={{ background: "#ECFDF5", color: "#059669" }}>
                <CheckCircle2 className="h-4 w-4" />
                Message sent successfully!
              </div>
            )}

            <button
              onClick={handleSend}
              disabled={!subject.trim() || !body.trim() || (group === "specific_building" && !buildingId) || sendState === "sending"}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-[13.5px] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              style={{ background: c.cobalt, color: "white", fontWeight: 600 }}
            >
              {sendState === "sending" ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
              ) : (
                <><Send className="h-4 w-4" /> Send Message</>
              )}
            </button>
          </section>
        </div>

        <div className="col-span-3">
          <section className="rounded-xl border bg-white" style={{ borderColor: c.border }}>
            <div className="flex items-center gap-2 border-b px-5 py-4" style={{ borderColor: c.border }}>
              <Clock className="h-4 w-4" style={{ color: c.inkMute }} />
              <h3 className="text-[15px]" style={{ fontWeight: 700, color: c.ink }}>Sent Messages</h3>
              <span
                className="ml-auto font-mono-num rounded px-2 py-0.5 text-[11px]"
                style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}
              >
                {log.length}
              </span>
            </div>

            {logLoading ? (
              <div className="flex items-center justify-center py-12 gap-2" style={{ color: c.inkMute }}>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-[13px]">Loading…</span>
              </div>
            ) : log.length === 0 ? (
              <div className="py-12 text-center">
                <Send className="mx-auto h-8 w-8 mb-3" style={{ color: c.inkMute, opacity: 0.4 }} />
                <p className="text-[13px]" style={{ color: c.inkMute }}>No messages sent yet.</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: c.border }}>
                {log.map((entry) => {
                  const groupLabel =
                    entry.recipientGroup === "specific_building" && entry.buildingId
                      ? `Building ${entry.buildingId}`
                      : GROUP_LABELS[entry.recipientGroup] ?? entry.recipientGroup;

                  return (
                    <div key={entry.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-3 mb-1">
                        <div className="text-[13.5px]" style={{ fontWeight: 600, color: c.ink }}>
                          {entry.subject}
                        </div>
                        <div className="shrink-0">
                          <span
                            className="text-[11px] px-2 py-0.5 rounded-full"
                            style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 600 }}
                          >
                            {groupLabel}
                          </span>
                        </div>
                      </div>
                      <p className="text-[12.5px] line-clamp-2 mb-2" style={{ color: c.inkSoft }}>
                        {entry.body}
                      </p>
                      <div className="flex items-center gap-3 text-[11.5px]" style={{ color: c.inkMute }}>
                        <span>{new Date(entry.sentAt).toLocaleString()}</span>
                        <span>·</span>
                        <span>By {entry.sentBy}</span>
                        <span>·</span>
                        <span>{entry.recipientCount} recipient{entry.recipientCount !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </Layout>
  );
}
