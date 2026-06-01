import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { useState, useEffect, useRef } from "react";
import {
  HardDrive, Sheet, Building2, Mail, Users, Tv2,
  Plus, X, Check, Server, Database, Cloud, Cpu, BarChart3, Globe,
  Map, Satellite, Navigation, Loader2, Trash2, ChevronDown, ChevronUp, CheckCircle2, Link2Off,
  ShieldCheck, Briefcase, Home, Key, AlertTriangle, Vote, History,
} from "lucide-react";
import { ImageMapEditor } from "@/components/ImageMapEditor";
import {
  loadPositions, mergeServerMarkers, resetView,
  defaultPositions, type ViewKey, type AllPositions,
} from "@/lib/markerPositions";
import {
  useListBuildings,
  useGetSettings,
  useUpdateSettings,
  useListCategories,
  useCreateCategory,
  useDeleteCategory,
  useListMarkers,
  useUpsertMarker,
  getGetSettingsQueryKey,
  useGetNotificationPreferences,
  useUpdateNotificationPreferences,
  useListUsers,
  useInviteUser,
  useResendInvite,
  useUpdateUserRole,
  useUpdateUserBoardMember,
  useListUserBoardMemberHistory,
  getListUserBoardMemberHistoryQueryKey,
  useUpdateUserOfficer,
  useDeleteUser,
  useListCommunicationLog,
  useListUnits,
  useAssignUserUnit,
  useUpdateUnit,
  getListUnitsQueryKey,
  getGetUnitQueryKey,
  useGetGoogleDriveStatus,
  useDisconnectGoogleDrive,
  useResyncGoogleDrive,
  getGetGoogleDriveStatusQueryKey,
  useListCalendarResources,
  useCreateCalendarResource,
  useUpdateCalendarResource,
  useDeleteCalendarResource,
  getListCalendarResourcesQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { chargingApi, type ChargingPort } from "@/lib/chargingApi";
import { AmenityComplianceSettings } from "@/components/AmenityComplianceSettings";

type Section = "Organization" | "Notifications" | "Members" | "Architectural" | "Bids" | "Committees" | "Integrations" | "Plat Map" | "Billing" | "Governance" | "Calendar" | "EV Chargers" | "Mail Room" | "Amenity Compliance";

const INTEGRATIONS = [
  { key: "gsheets",       label: "Google Sheets",             icon: Sheet,     iconBg: "#E6F4EA", iconFg: "#1E8E3E", badge: "Planned",    desc: "Export financials, work-order logs, and unit rosters to Google Sheets for custom reporting and board review." },
  { key: "portal",        label: "Property Manager Portal",   icon: Building2, iconBg: "#FEF3E2", iconFg: "#E37400", badge: "Planned",    desc: "Connect to your property management platform to pull work orders, vendor invoices, and ledger data automatically." },
  { key: "email",         label: "Email Notifications",       icon: Mail,      iconBg: "#FCE8E6", iconFg: "#C5221F", badge: "Coming Soon", desc: "Send automated alerts to board members and residents for urgent work orders, meeting reminders, and policy expirations." },
  { key: "resident",      label: "Resident Portal",           icon: Users,     iconBg: "#E8F0FE", iconFg: "#3245FF", badge: "Coming Soon", desc: "Give residents a self-service portal to submit maintenance requests, view announcements, and access community documents." },
  { key: "digital-board", label: "Digital Board / QR Notices",icon: Tv2,       iconBg: "#EFF1F8", iconFg: "#2A3050", badge: "Coming Soon", desc: "Display live community notices on lobby screens and generate QR codes that link residents to the latest board updates." },
] as const;

const ARCH_LAYERS = [
  { icon: Globe,    label: "Frontend",          desc: "HOA dashboard and resident portal",                          color: "#3245FF", bg: "#E5E8FF" },
  { icon: Database, label: "Database",          desc: "PostgreSQL — units, work orders, statuses, metadata",        color: "#0E8A6B", bg: "#DCF3EC" },
  { icon: Cloud,    label: "Document Storage",  desc: "Google Drive or cloud document storage",                     color: "#1A73E8", bg: "#E8F0FE" },
  { icon: Server,   label: "Integration Layer", desc: "Community management portal sync",                           color: "#E37400", bg: "#FEF3E2" },
  { icon: Cpu,      label: "Automation",        desc: "Scheduled imports, document routing, reminders",             color: "#7B3FE4", bg: "#F3EEFF" },
  { icon: BarChart3,label: "Analytics",         desc: "Maintenance trends and property health reporting",           color: "#B8264C", bg: "#FBE3E9" },
];

const MAP_VIEW_OPTS: { key: ViewKey; label: string; Icon: React.ElementType }[] = [
  { key: "plat",      label: "Plat",  Icon: Map },
  { key: "satellite", label: "Satellite", Icon: Satellite },
  { key: "roadmap",   label: "RoadMap",  Icon: Navigation },
];

const ROLE_OPTS = ["admin", "manager", "resident"] as const;
type UserRole = (typeof ROLE_OPTS)[number];

function BoardMemberHistory({ userId }: { userId: number }) {
  const { data: entries = [], isLoading, isError } = useListUserBoardMemberHistory(userId);
  if (isLoading) {
    return (
      <div className="rounded-md border px-3 py-2 text-[12px] inline-flex items-center gap-2" style={{ borderColor: c.borderSoft, color: c.inkMute }}>
        <Loader2 className="h-3 w-3 animate-spin" /> Loading history…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-md border px-3 py-2 text-[12px]" style={{ borderColor: c.borderSoft, color: "#B91C1C" }}>
        Failed to load history.
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="rounded-md border px-3 py-2 text-[12px]" style={{ borderColor: c.borderSoft, color: c.inkMute }}>
        No board-flag changes recorded yet.
      </div>
    );
  }
  return (
    <div className="rounded-md border" style={{ borderColor: c.borderSoft, background: c.canvas }}>
      <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide border-b" style={{ borderColor: c.borderSoft, color: c.inkMute, fontWeight: 600 }}>
        Board-flag history
      </div>
      <ul className="divide-y" style={{ borderColor: c.borderSoft }}>
        {entries.map((e) => {
          const when = new Date(e.createdAt);
          const whenStr = isNaN(when.getTime()) ? e.createdAt : when.toLocaleString();
          const actor = e.changedByName || e.changedByEmail || (e.changedByUserId ? `User #${e.changedByUserId}` : "Unknown admin");
          return (
            <li key={e.id} className="px-3 py-2 text-[12px] flex items-center gap-2 flex-wrap" style={{ color: c.inkSoft }}>
              <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: e.newValue ? "#EDE7FF" : "#F3F4F6", color: e.newValue ? "#5A3FD9" : "#475569", fontWeight: 600 }}>
                {e.oldValue ? "On" : "Off"} → {e.newValue ? "On" : "Off"}
              </span>
              <span style={{ color: c.ink, fontWeight: 500 }}>{actor}</span>
              <span style={{ color: c.inkMute }}>· {whenStr}</span>
              {e.changedByEmail && e.changedByEmail !== actor && (
                <span style={{ color: c.inkMute }}>· {e.changedByEmail}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NotificationsSection({
  notif,
  setNotif,
  notifSaveState,
  handleSaveNotif,
}: {
  notif: { urgent: boolean; expiring: boolean; weekly: boolean };
  setNotif: (v: { urgent: boolean; expiring: boolean; weekly: boolean }) => void;
  notifSaveState: "idle" | "saving" | "saved" | "error";
  handleSaveNotif: () => void;
}) {
  const { data: log = [], isLoading: logLoading } = useListCommunicationLog();

  const LOG_GROUP_LABELS: Record<string, string> = {
    all_owners: "All Owners",
    all_tenants: "All Tenants",
    specific_building: "Building",
    system: "System",
  };

  return (
    <>
      <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
        <h3 className="text-[16px] mb-1" style={{ fontWeight: 700 }}>Email Alerts</h3>
        <p className="text-[13px] mb-5" style={{ color: c.inkMute, fontWeight: 500 }}>
          Email alerts sent to the manager address.
        </p>
        <div className="space-y-3">
          {([
            { k: "urgent" as const,   l: "Urgent work orders", d: "Sent immediately when an urgent WO is opened." },
            { k: "expiring" as const, l: "Expiring insurance",  d: "30 days before policy expiration." },
            { k: "weekly" as const,   l: "Weekly digest",       d: "Mondays at 8am, summary of activity." },
          ] as const).map((n) => (
            <label key={n.k} className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-slate-50" style={{ borderColor: c.borderSoft }}>
              <input
                type="checkbox"
                checked={notif[n.k]}
                onChange={(e) => setNotif({ ...notif, [n.k]: e.target.checked })}
                className="mt-0.5 accent-blue-600"
              />
              <div>
                <div className="text-[13.5px]" style={{ fontWeight: 600 }}>{n.l}</div>
                <div className="text-[12.5px] mt-0.5" style={{ color: c.inkMute, fontWeight: 500 }}>{n.d}</div>
              </div>
            </label>
          ))}
        </div>
      </section>

      <div className="flex items-center justify-end gap-3">
        {notifSaveState === "error" && (
          <span className="text-[12.5px]" style={{ color: "#B8264C" }}>Failed to save. Please try again.</span>
        )}
        <SaveButton state={notifSaveState} onClick={handleSaveNotif} />
      </div>

      <section className="rounded-xl border bg-white" style={{ borderColor: c.border }}>
        <div className="flex items-center gap-2 border-b px-6 py-4" style={{ borderColor: c.border }}>
          <Mail className="h-4 w-4" style={{ color: c.inkMute }} />
          <h3 className="text-[15px]" style={{ fontWeight: 700 }}>Notification History</h3>
          <span
            className="ml-auto font-mono-num rounded px-2 py-0.5 text-[11px]"
            style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 700 }}
          >
            {log.length} sent
          </span>
        </div>

        {logLoading ? (
          <div className="flex items-center justify-center py-10 gap-2" style={{ color: c.inkMute }}>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-[13px]">Loading…</span>
          </div>
        ) : log.length === 0 ? (
          <div className="py-10 text-center">
            <Mail className="mx-auto h-7 w-7 mb-2" style={{ color: c.inkMute, opacity: 0.35 }} />
            <p className="text-[12.5px]" style={{ color: c.inkMute }}>No emails sent yet.</p>
            <p className="text-[11.5px] mt-1" style={{ color: c.inkMute, opacity: 0.7 }}>
              Emails triggered by work orders, insurance expiry, or broadcast messages will appear here.
            </p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: c.borderSoft }}>
            {log.map((entry) => {
              const groupLabel =
                entry.recipientGroup === "specific_building" && entry.buildingId
                  ? `Building ${entry.buildingId}`
                  : LOG_GROUP_LABELS[entry.recipientGroup] ?? entry.recipientGroup;
              return (
                <div key={entry.id} className="px-6 py-3.5 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[13px]" style={{ fontWeight: 600, color: c.ink }}>
                        {entry.subject}
                      </span>
                      <span
                        className="shrink-0 text-[10.5px] px-1.5 py-0.5 rounded"
                        style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 600 }}
                      >
                        {groupLabel}
                      </span>
                    </div>
                    <p className="text-[12px] truncate" style={{ color: c.inkSoft }}>{entry.body}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[11.5px]" style={{ color: c.inkMute }}>
                      {new Date(entry.sentAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                    <div className="text-[11px]" style={{ color: c.inkMute }}>
                      {new Date(entry.sentAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div className="text-[10.5px] mt-0.5" style={{ color: c.inkMute, opacity: 0.7 }}>
                      {entry.recipientCount} recipient{entry.recipientCount !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

const roleLabel: Record<UserRole, string> = { admin: "Admin", manager: "Manager", resident: "Resident" };
const roleColor: Record<UserRole, string> = { admin: c.cobalt, manager: "#0E8A6B", resident: "#7B3FE4" };
const roleBg: Record<UserRole, string> = { admin: c.cobaltSoft, manager: "#DCF3EC", resident: "#F3EEFF" };

type OccupancyRole = "owner" | "tenant" | "unmatched" | "none";

const occupancyMeta: Record<OccupancyRole, { label: string; bg: string; fg: string }> = {
  owner:     { label: "Owner",     bg: "#DCF3EC", fg: "#0E8A6B" },
  tenant:    { label: "Tenant",    bg: "#FBEFD6", fg: "#A66C0E" },
  unmatched: { label: "Unmatched", bg: "#FBE3E9", fg: "#B8264C" },
  none:      { label: "No unit",   bg: "#EFF1F8", fg: "#5A6285" },
};

function resolveOccupancyForRow(
  email: string,
  unit: { ownerEmail?: string | null; tenantEmail?: string | null } | null | undefined,
  hasUnit: boolean,
): OccupancyRole {
  if (!hasUnit) return "none";
  if (!unit) return "unmatched";
  const me = (email ?? "").trim().toLowerCase();
  const owner = (unit.ownerEmail ?? "").trim().toLowerCase();
  const tenant = (unit.tenantEmail ?? "").trim().toLowerCase();
  if (me && me === owner) return "owner";
  if (me && me === tenant) return "tenant";
  return "unmatched";
}

type Persona = {
  key: string;
  title: string;
  subtitle: string;
  icon: React.ElementType;
  iconBg: string;
  iconFg: string;
  summary: string;
  description: string;
  canDo: string[];
  cannotDo: string[];
};

const PERSONAS: Persona[] = [
  {
    key: "admin",
    title: "Admin",
    subtitle: "Full system access — multiple Admins supported",
    icon: ShieldCheck,
    iconBg: c.cobaltSoft,
    iconFg: c.cobalt,
    summary: "Full access — invite users, configure the system, and see every record",
    description:
      "Owns the workspace. Configures the system, invites users, and decides who has access to what. Multiple users can hold the Admin role simultaneously, and the system always keeps at least one Admin — the last remaining Admin cannot be demoted. Only existing Admins can promote another user to Admin (or to Manager). Being an Admin does not automatically make you a board member — that is a separate flag, also Admin-controlled.",
    canDo: [
      "Invite, remove, and change roles for any member",
      "Promote another user to Admin (only Admins can do this) and grant or revoke the Board member flag",
      "Assign residents to units",
      "Configure organization, notifications, integrations, and policies",
      "Access every page and every record in the system",
    ],
    cannotDo: [
      "Demote the last remaining Admin (blocked — promote another Admin first)",
      "Vote on Stripe key changes unless the Board member flag is also set",
    ],
  },
  {
    key: "manager",
    title: "Manager",
    subtitle: "Operational staff — runs the community day-to-day",
    icon: Briefcase,
    iconBg: "#DCF3EC",
    iconFg: "#0E8A6B",
    summary: "Operational access — work orders, vendors, ACC, communications",
    description:
      "Day-to-day operational role used by property managers and other staff. Runs the community but doesn't manage user access. Managers are not automatically board members; an Admin must set the Board member flag explicitly if a manager has been elected to the board.",
    canDo: [
      "Open, assign, and close work orders",
      "Run vendor bids and award work",
      "Review architectural (ACC) requests",
      "Send community communications and view financials and reports",
      "Vote on Stripe key changes if (and only if) an Admin has flagged them as a board member",
    ],
    cannotDo: [
      "Invite new users or change anyone's role (only Admins can promote to Admin or Manager)",
      "Grant or revoke the Board member flag (Admin-only)",
      "Delete members or reassign them to different units",
      "Edit system-wide configuration locked to admins",
    ],
  },
  {
    key: "owner",
    title: "Resident — Owner",
    subtitle: "Login email matches the unit's owner email",
    icon: Home,
    iconBg: "#DCF3EC",
    iconFg: "#0E8A6B",
    summary: "Owner of record — manages their unit's owner info, ledger, and requests",
    description:
      "A resident whose login email matches the owner email recorded on their unit. Treated as the owner of record. An elected owner can additionally be flagged as a board member by an Admin — the flag is independent of the Resident role.",
    canDo: [
      "Edit owner contact info and the mailing address on their unit",
      "View their owner ledger and payment history",
      "Submit work orders and ACC requests for their unit",
      "Update their own profile and notification preferences",
      "Vote on Stripe key changes if an Admin has flagged them as a board member",
    ],
    cannotDo: [
      "See or edit any other unit",
      "Edit tenant-only contact fields on their unit",
      "Change their role, permissions, or unit assignment",
      "Grant or revoke the Board member flag on themselves or anyone else (Admin-only)",
    ],
  },
  {
    key: "tenant",
    title: "Resident — Tenant",
    subtitle: "Login email matches the unit's tenant email",
    icon: Key,
    iconBg: "#FBEFD6",
    iconFg: "#A66C0E",
    summary: "Tenant access — manages their unit's tenant info and submits requests",
    description:
      "A resident whose login email matches the tenant email on their unit. Has resident access but is gated out of owner-only fields. A tenant can technically be flagged as a board member, but the flag is unusual for tenants and only an Admin can set it.",
    canDo: [
      "Edit tenant contact and emergency contact info on their unit",
      "Submit work orders and ACC requests for their unit",
      "Update their own profile and notification preferences",
      "Vote on Stripe key changes only if an Admin has flagged them as a board member",
    ],
    cannotDo: [
      "Edit owner-only fields, including the mailing address",
      "View the owner ledger or payment history",
      "See or interact with other units",
      "Grant or revoke the Board member flag (Admin-only)",
    ],
  },
  {
    key: "unmatched",
    title: "Resident — Unmatched",
    subtitle: "Email matches neither owner nor tenant",
    icon: AlertTriangle,
    iconBg: "#FBE3E9",
    iconFg: "#B8264C",
    summary: "Unmatched resident — limited access until owner/tenant email is reconciled",
    description:
      "A resident attached to a unit, but their login email doesn't match the recorded owner or tenant. They're in a permission gray zone — review and either correct the unit's emails, reassign the resident, or remove them. The Board member flag should not be set on an unmatched resident; resolve the match first.",
    canDo: [
      "Sign in and view their basic profile",
      "View the unit they were attached to",
    ],
    cannotDo: [
      "Edit owner-only fields (mailing address, owner contact, owner ledger)",
      "Edit tenant-only fields",
      "Be trusted as either owner or tenant of record until matched",
      "Grant or revoke the Board member flag (Admin-only, and not recommended for unmatched residents)",
    ],
  },
  {
    key: "board",
    title: "Board member",
    subtitle: "A flag — independent of role, Admin-assigned",
    icon: Vote,
    iconBg: "#EDE7FF",
    iconFg: "#5A3FD9",
    summary: "Governance flag — votes on Stripe key changes; not a role",
    description:
      "Board member is an additional flag on a user, not a role. Anyone — Admin, Manager, Owner, or Tenant — can be flagged as a board member, and being on the board does not by itself grant any operational access; their role still controls what they can do day-to-day. Only Admins can grant or revoke the flag. The system always keeps at least one board member so the Stripe approval flow stays approvable. A board member may also hold an officer title (President, Vice President, Treasurer, Secretary, or Member-at-Large) and an optional term window — those are set in the Officers panel below.",
    canDo: [
      "Vote (approve or reject) on Stripe API key change requests",
      "Be listed in the Stripe settings card as part of the voter roster",
      "Optionally hold an officer title and term dates so they appear on the Board page and on signed governance PDFs",
    ],
    cannotDo: [
      "Use the flag to gain any other operational permission — the user's role still decides what they can see and do",
      "Be the last remaining board member and then be un-flagged (blocked with a clear error)",
      "Grant the flag to anyone else (only Admins can)",
      "Hold the President, Vice President, Treasurer, or Secretary title at the same time as another board member — those four are unique. Member-at-Large can be held by multiple people.",
      "Hold an officer title or term while not flagged as a board member — un-flagging clears officer state automatically",
    ],
  },
];

const personaByKey = (key: string): Persona | undefined => PERSONAS.find((p) => p.key === key);
const residentRoleSummary = (): string => {
  const owner = personaByKey("owner")?.summary;
  const tenant = personaByKey("tenant")?.summary;
  const unmatched = personaByKey("unmatched")?.summary;
  const parts = [owner, tenant, unmatched].filter((s): s is string => Boolean(s));
  return `Resident access — exact permissions depend on email match: ${parts.join(" / ")}`;
};
const roleSummary: Record<UserRole, string> = {
  admin: personaByKey("admin")?.summary ?? "",
  manager: personaByKey("manager")?.summary ?? "",
  resident: residentRoleSummary(),
};

function PersonaCard({ p, expanded, onToggle }: { p: Persona; expanded: boolean; onToggle: () => void }) {
  const Icon = p.icon;
  return (
    <div className="rounded-lg border" style={{ borderColor: c.borderSoft, background: "#fff" }}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-50 rounded-lg"
        aria-expanded={expanded}
      >
        <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: p.iconBg, color: p.iconFg }}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px]" style={{ fontWeight: 700, color: c.ink }}>{p.title}</div>
          <div className="text-[12px] mt-0.5" style={{ color: c.inkMute, fontWeight: 500 }}>{p.subtitle}</div>
        </div>
        <ChevronDown
          className="h-4 w-4 shrink-0 transition-transform"
          style={{ color: c.inkMute, transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-0 ml-12">
          <p className="text-[12.5px] mb-3 leading-relaxed" style={{ color: c.inkSoft }}>{p.description}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide mb-1.5" style={{ color: "#0E8A6B", fontWeight: 700 }}>Can do</div>
              <ul className="space-y-1">
                {p.canDo.map((item) => (
                  <li key={item} className="flex items-start gap-1.5 text-[12px]" style={{ color: c.inkSoft }}>
                    <Check className="h-3 w-3 mt-0.5 shrink-0" style={{ color: "#0E8A6B" }} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide mb-1.5" style={{ color: "#B8264C", fontWeight: 700 }}>Cannot do</div>
              <ul className="space-y-1">
                {p.cannotDo.map((item) => (
                  <li key={item} className="flex items-start gap-1.5 text-[12px]" style={{ color: c.inkSoft }}>
                    <X className="h-3 w-3 mt-0.5 shrink-0" style={{ color: "#B8264C" }} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const [section, setSection] = useState<Section>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("drive_connected") === "1") return "Integrations";
    }
    return "Organization";
  });
  const [driveJustConnected, setDriveJustConnected] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return params.get("drive_connected") === "1";
    }
    return false;
  });

  useEffect(() => {
    if (driveJustConnected) {
      const url = new URL(window.location.href);
      url.searchParams.delete("drive_connected");
      window.history.replaceState({}, "", url.toString());
      const t = setTimeout(() => setDriveJustConnected(false), 5000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [driveJustConnected]);

  const queryClient = useQueryClient();
  const { user: settingsUser } = useAuth();
  const isAdmin = settingsUser?.role === "admin";
  const { data: orgSettings, isLoading: orgLoading } = useGetSettings();
  const updateSettingsMutation = useUpdateSettings();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [tz, setTz] = useState("America/Chicago");
  const [ocrEnabled, setOcrEnabled] = useState(true);
  const [ocrDailyPageCap, setOcrDailyPageCap] = useState(1000);
  const [ocrSaveState, setOcrSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [orgSaveState, setOrgSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // Task #146 — admins can bump the org-wide welcome-tour version after major
  // releases so every user whose `tourVersionSeen` is below the new number
  // sees the welcome tour again on next load. Replay state is preserved per
  // user (the server stamps each user's seen version when they dismiss it).
  const [currentTourVersion, setCurrentTourVersion] = useState(1);
  const [tourSaveState, setTourSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const [notif, setNotif] = useState({ urgent: true, expiring: true, weekly: false });
  const [notifSaveState, setNotifSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const { data: notifPrefs } = useGetNotificationPreferences();
  const updateNotifPrefsMutation = useUpdateNotificationPreferences();

  useEffect(() => {
    if (orgSettings) {
      setName(orgSettings.name ?? "");
      setEmail(orgSettings.contactEmail ?? "");
      setTz(orgSettings.timezone ?? "America/Chicago");
      setOcrEnabled((orgSettings as { ocrEnabled?: boolean }).ocrEnabled ?? true);
      setOcrDailyPageCap((orgSettings as { ocrDailyPageCap?: number }).ocrDailyPageCap ?? 1000);
      setCurrentTourVersion((orgSettings as { currentTourVersion?: number }).currentTourVersion ?? 1);
    }
  }, [orgSettings]);

  useEffect(() => {
    if (notifPrefs) {
      setNotif({
        urgent: notifPrefs.urgent,
        expiring: notifPrefs.expiring,
        weekly: notifPrefs.weekly,
      });
    }
  }, [notifPrefs]);

  const { data: categories = [], refetch: refetchCategories } = useListCategories();
  const createCategoryMutation = useCreateCategory();
  const deleteCategoryMutation = useDeleteCategory();
  const [newCat, setNewCat] = useState("");
  const [catError, setCatError] = useState("");

  const { data: markers = [], isLoading: markersLoading } = useListMarkers();
  const upsertMarkerMutation = useUpsertMarker();


  const [mapView, setMapView] = useState<ViewKey>("plat");
  const [positions, setPositions] = useState<AllPositions>(loadPositions);
  const [savedView, setSavedView] = useState<ViewKey | null>(null);
  const [mapSaving, setMapSaving] = useState(false);

  useEffect(() => {
    if (markers.length > 0) {
      setPositions(mergeServerMarkers(markers));
    }
  }, [markers]);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("manager");
  const [inviteUnitId, setInviteUnitId] = useState<string>("");
  const [inviteBoardMember, setInviteBoardMember] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<{ email: string; url: string; expiresAt: string } | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [boardMemberError, setBoardMemberError] = useState<{ userId: number; msg: string } | null>(null);
  const [historyUserId, setHistoryUserId] = useState<number | null>(null);
  const [officerError, setOfficerError] = useState<{ userId: number; msg: string } | null>(null);
  const [rolesPanelOpen, setRolesPanelOpen] = useState(true);
  const [expandedPersona, setExpandedPersona] = useState<string | null>("admin");
  const [resolveUserId, setResolveUserId] = useState<number | null>(null);
  const [resolveMode, setResolveMode] = useState<"choice" | "reassign">("choice");
  const [resolveUnitId, setResolveUnitId] = useState<string>("");
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolveBusy, setResolveBusy] = useState(false);

  const { data: driveStatus, isLoading: driveLoading } = useGetGoogleDriveStatus({
    query: {
      queryKey: getGetGoogleDriveStatusQueryKey(),
      // Poll every second while a sync is in progress so the live counter
      // updates in the UI; stop polling once the server clears the flag.
      refetchInterval: (q) => (q.state.data?.syncInProgress ? 1000 : false),
      refetchIntervalInBackground: false,
    },
  });
  const disconnectDriveMutation = useDisconnectGoogleDrive();
  const resyncDriveMutation = useResyncGoogleDrive();
  const [driveSyncToast, setDriveSyncToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const wasSyncingRef = useRef(false);
  useEffect(() => {
    const isSyncing = !!driveStatus?.syncInProgress;
    if (wasSyncingRef.current && !isSyncing) {
      const count = driveStatus?.lastSyncCount ?? 0;
      const failures = driveStatus?.lastSyncFailures ?? 0;
      const base = `${count} file${count === 1 ? "" : "s"} mirrored to Drive`;
      if (failures > 0) {
        setDriveSyncToast({
          msg: `Sync finished with issues — ${base} · ${failures} failed`,
          type: "error",
        });
      } else {
        setDriveSyncToast({ msg: `Sync complete — ${base}`, type: "success" });
      }
      setTimeout(() => setDriveSyncToast(null), 5000);
    }
    wasSyncingRef.current = isSyncing;
  }, [driveStatus?.syncInProgress, driveStatus?.lastSyncCount, driveStatus?.lastSyncFailures]);

  async function handleDriveConnect() {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    window.location.href = `${base}/api/integrations/google-drive/connect`;
  }

  async function handleDriveDisconnect() {
    if (!confirm("Disconnect Google Drive? Documents will no longer sync automatically.")) return;
    await disconnectDriveMutation.mutateAsync(undefined);
    await queryClient.invalidateQueries({ queryKey: getGetGoogleDriveStatusQueryKey() });
  }

  async function handleDriveResync() {
    setDriveSyncToast(null);
    try {
      await resyncDriveMutation.mutateAsync(undefined);
      // Server runs the sync in the background. Refresh status now so the
      // poller picks up `syncInProgress=true` and shows live progress.
      await queryClient.invalidateQueries({ queryKey: getGetGoogleDriveStatusQueryKey() });
    } catch {
      setDriveSyncToast({ msg: "Sync failed to start — check server logs", type: "error" });
      setTimeout(() => setDriveSyncToast(null), 4000);
    }
  }

  const { user: currentUser } = useAuth();
  const { data: buildings = [] } = useListBuildings();
  const { data: users = [], refetch: refetchUsers } = useListUsers();
  const { data: allUnits = [] } = useListUnits();

  // Mirror the Stripe key-change request status into the members list so admins
  // managing the board roster can see, at a glance, who has and hasn't voted on
  // a pending change. Polled while the page is open so badges update as votes
  // come in without requiring the admin to navigate to the Stripe card.
  const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null);
  useEffect(() => {
    const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${apiBase}/api/settings/stripe`, { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as StripeStatus;
        if (!cancelled) setStripeStatus(data);
      } catch {/* ignore */}
    }
    load();
    const t = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  // Use the latest request (pending or recently-rejected) so the per-member
  // badges remain visible after a rejection finalizes the request — admins
  // need to see who rejected before re-proposing. Applied/cancelled requests
  // are filtered out by the API.
  const latestStripeRequest = stripeStatus?.latestRequest ?? null;
  const stripeRequestStatus = latestStripeRequest?.status ?? null;
  const showStripeApprovalBadges =
    stripeRequestStatus === "pending" || stripeRequestStatus === "rejected";
  const stripeApprovalByUserId: Record<number, "approve" | "reject" | null> = {};
  if (latestStripeRequest) {
    for (const a of latestStripeRequest.boardApprovals) {
      stripeApprovalByUserId[a.userId] = a.decision;
    }
  }

  const inviteMutation = useInviteUser();
  const resendInviteMutation = useResendInvite();
  const updateRoleMutation = useUpdateUserRole();
  const updateBoardMemberMutation = useUpdateUserBoardMember();
  const updateOfficerMutation = useUpdateUserOfficer();
  const deleteUserMutation = useDeleteUser();
  const assignUnitMutation = useAssignUserUnit();
  const updateUnitMutation = useUpdateUnit();

  function openResolve(userId: number) {
    setResolveUserId(userId);
    setResolveMode("choice");
    setResolveUnitId("");
    setResolveError(null);
  }

  function closeResolve() {
    setResolveUserId(null);
    setResolveMode("choice");
    setResolveUnitId("");
    setResolveError(null);
    setResolveBusy(false);
  }

  async function handleResolveSetEmail(member: { id: number; email: string; unitId?: string | null }, field: "ownerEmail" | "tenantEmail") {
    if (!member.unitId) return;
    setResolveError(null);
    setResolveBusy(true);
    try {
      await updateUnitMutation.mutateAsync({
        id: member.unitId,
        data: { [field]: member.email },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetUnitQueryKey(member.unitId) }),
        queryClient.invalidateQueries({ queryKey: getListUnitsQueryKey() }),
      ]);
      closeResolve();
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : "Failed to update unit.");
      setResolveBusy(false);
    }
  }

  async function handleResolveReassign(userId: number) {
    if (!resolveUnitId) {
      setResolveError("Select a unit to reassign.");
      return;
    }
    setResolveError(null);
    setResolveBusy(true);
    try {
      await assignUnitMutation.mutateAsync({ id: userId, data: { unitId: resolveUnitId } });
      await refetchUsers();
      closeResolve();
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : "Failed to reassign resident.");
      setResolveBusy(false);
    }
  }

  async function handleSaveOrg() {
    setOrgSaveState("saving");
    try {
      await updateSettingsMutation.mutateAsync({
        data: { name, contactEmail: email || null, timezone: tz },
      });
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      setOrgSaveState("saved");
      setTimeout(() => setOrgSaveState("idle"), 2500);
    } catch {
      setOrgSaveState("error");
      setTimeout(() => setOrgSaveState("idle"), 3000);
    }
  }

  async function handleSaveNotif() {
    setNotifSaveState("saving");
    try {
      await updateNotifPrefsMutation.mutateAsync({
        data: { urgent: notif.urgent, expiring: notif.expiring, weekly: notif.weekly },
      });
      setNotifSaveState("saved");
      setTimeout(() => setNotifSaveState("idle"), 2500);
    } catch {
      setNotifSaveState("error");
      setTimeout(() => setNotifSaveState("idle"), 3000);
    }
  }

  async function addCat() {
    const v = newCat.trim();
    if (!v) return;
    setCatError("");
    try {
      await createCategoryMutation.mutateAsync({ data: { name: v } });
      setNewCat("");
      refetchCategories();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCatError(msg.includes("409") || msg.toLowerCase().includes("already") ? "Category already exists." : "Failed to add category.");
    }
  }

  async function removeCat(id: number) {
    try {
      await deleteCategoryMutation.mutateAsync({ id });
      refetchCategories();
    } catch {}
  }

  async function handleSaveMarkers() {
    setMapSaving(true);
    try {
      const viewPos = positions[mapView];
      const promises = Object.entries(viewPos).map(([num, pos]) =>
        upsertMarkerMutation.mutateAsync({
          buildingNum: parseInt(num, 10),
          view: mapView,
          data: { left: pos.left, top: pos.top },
        }),
      );
      await Promise.all(promises);
      setSavedView(mapView);
      setTimeout(() => setSavedView(null), 2000);
    } catch {}
    setMapSaving(false);
  }

  function handleReset() {
    setPositions((prev) => resetView(prev, mapView));
  }

  async function handleInvite() {
    setInviteError(null);
    setInviteResult(null);
    setInviteCopied(false);
    if (!inviteEmail.trim()) return;
    try {
      const res = await inviteMutation.mutateAsync({
        data: {
          email: inviteEmail.trim(),
          role: inviteRole,
          name: inviteName.trim(),
          unitId: inviteRole === "resident" && inviteUnitId ? inviteUnitId : null,
          boardMember: inviteBoardMember,
        },
      });
      const url = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/accept-invite/${res.inviteToken}`;
      setInviteResult({ email: res.user.email, url, expiresAt: res.inviteTokenExpiresAt });
      setInviteEmail("");
      setInviteName("");
      setInviteRole("manager");
      setInviteUnitId("");
      setInviteBoardMember(false);
      refetchUsers();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Failed to invite user");
    }
  }

  async function handleResendInvite(userId: number, email: string) {
    setInviteError(null);
    setInviteCopied(false);
    try {
      const res = await resendInviteMutation.mutateAsync({ id: userId });
      const url = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/accept-invite/${res.inviteToken}`;
      setInviteResult({ email, url, expiresAt: res.inviteTokenExpiresAt });
      refetchUsers();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Failed to regenerate invite link");
    }
  }

  async function copyInviteUrl() {
    if (!inviteResult) return;
    try {
      await navigator.clipboard.writeText(inviteResult.url);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 1800);
    } catch {
      // Clipboard may be unavailable in some browsers — admin can still
      // select the URL manually from the displayed input.
    }
  }

  async function handleAssignUnit(userId: number, unitId: string | null) {
    await assignUnitMutation.mutateAsync({ id: userId, data: { unitId: unitId ?? null } });
    refetchUsers();
  }

  async function handleRoleChange(userId: number, role: UserRole) {
    await updateRoleMutation.mutateAsync({ id: userId, data: { role } });
    refetchUsers();
  }

  async function handleOfficerUpdate(
    userId: number,
    patch: { officerTitle?: string | null; termStart?: string | null; termEnd?: string | null },
  ) {
    setOfficerError(null);
    try {
      await updateOfficerMutation.mutateAsync({ id: userId, data: patch });
      refetchUsers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const match = msg.match(/"error":"([^"]+)"/);
      setOfficerError({
        userId,
        msg: match?.[1] ?? "Failed to update officer details.",
      });
      setTimeout(() => setOfficerError((prev) => (prev?.userId === userId ? null : prev)), 6000);
    }
  }

  async function handleBoardMemberToggle(userId: number, boardMember: boolean) {
    setBoardMemberError(null);
    try {
      await updateBoardMemberMutation.mutateAsync({ id: userId, data: { boardMember } });
      refetchUsers();
      // Refresh the history panel for this user if it's currently open
      // (or just cached) so the new audit entry shows up immediately.
      queryClient.invalidateQueries({ queryKey: getListUserBoardMemberHistoryQueryKey(userId) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const match = msg.match(/"error":"([^"]+)"/);
      setBoardMemberError({
        userId,
        msg: match?.[1] ?? "Failed to update board member flag.",
      });
      // Clear after a short delay so it doesn't stick around forever.
      setTimeout(() => setBoardMemberError((prev) => (prev?.userId === userId ? null : prev)), 6000);
    }
  }

  async function handleDelete(userId: number) {
    if (!confirm("Remove this member?")) return;
    await deleteUserMutation.mutateAsync({ id: userId });
    refetchUsers();
  }

  const navItems: Section[] = ["Organization", "Notifications", "Members", "Architectural", "Bids", "Committees", "Calendar", "EV Chargers", "Mail Room", "Amenity Compliance", "Integrations", "Plat Map", "Billing", "Governance"];

  // Resident board members reach this page only to vote on Stripe key changes.
  // Render a minimal Stripe-only surface — they have no access to operational
  // or member-management settings.
  const isStaff = currentUser?.role === "admin" || currentUser?.role === "manager";
  if (!isStaff) {
    return (
      <Layout title="Stripe approvals" subtitle="Vote on pending Stripe API key changes">
        <div className="max-w-3xl">
          <StripeKeysCard />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Settings" subtitle="Workspace and notification preferences">
      <div className="grid grid-cols-3 gap-5">
        <aside className="space-y-1">
          {navItems.map((s) => (
            <button key={s} onClick={() => setSection(s)}
              className="w-full text-left rounded-md px-3 py-2 text-[13.5px] transition-colors hover:bg-slate-50"
              style={section === s ? { background: c.cobaltSoft, color: c.cobalt, fontWeight: 600 } : { color: c.inkSoft, fontWeight: 500 }}
            >{s}</button>
          ))}
        </aside>

        <div className="col-span-2 space-y-5">

          {/* ── Organization ── */}
          {section === "Organization" && (
            <>
              <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
                <h3 className="text-[16px] mb-1" style={{ fontWeight: 700 }}>Organization</h3>
                <p className="text-[13px] mb-5" style={{ color: c.inkMute, fontWeight: 500 }}>Public profile and contact information.</p>
                {orgLoading ? (
                  <div className="flex items-center gap-2 text-[13px]" style={{ color: c.inkMute }}>
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                  </div>
                ) : (
                  <div className="space-y-4">
                    <Field label="Association name">
                      <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border px-3 py-2 text-[13.5px]" style={{ borderColor: c.border, color: c.ink }} />
                    </Field>
                    <Field label="Manager email">
                      <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-md border px-3 py-2 text-[13.5px]" style={{ borderColor: c.border, color: c.ink }} />
                    </Field>
                    <Field label="Timezone">
                      <select value={tz} onChange={(e) => setTz(e.target.value)} className="w-full rounded-md border px-3 py-2 text-[13.5px] bg-white" style={{ borderColor: c.border, color: c.ink }}>
                        <option>America/Chicago</option>
                        <option>America/New_York</option>
                        <option>America/Denver</option>
                        <option>America/Los_Angeles</option>
                      </select>
                    </Field>
                    {/* OCR auto-tag suggestions — admin-only mutation. */}
                    <div className="rounded-lg border p-4" style={{ borderColor: c.border, background: "#FAFBFF" }}>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-[13.5px]" style={{ fontWeight: 700, color: c.ink }}>OCR auto-tag suggestions</div>
                          <p className="text-[12.5px] mt-0.5" style={{ color: c.inkMute }}>
                            When enabled, the bulk historical-document importer reads each uploaded file and
                            pre-fills category, date, vendor, building and unit tags on the import preview.
                            Managers can still override per-batch in the importer. Admin only.
                          </p>
                        </div>
                        <label className="inline-flex items-center gap-2 shrink-0" style={{ opacity: isAdmin ? 1 : 0.5 }}>
                          <input type="checkbox" checked={ocrEnabled} disabled={!isAdmin}
                            onChange={(e) => setOcrEnabled(e.target.checked)} />
                          <span className="text-[13px]" style={{ fontWeight: 600 }}>{ocrEnabled ? "On" : "Off"}</span>
                        </label>
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-[11.5px] uppercase tracking-wider"
                          style={{ color: c.inkMute, fontWeight: 700 }}>Daily page cap</span>
                        <input type="number" min={0} value={ocrDailyPageCap}
                          onChange={(e) => setOcrDailyPageCap(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                          disabled={!isAdmin || !ocrEnabled}
                          className="w-28 rounded-md border px-2 py-1 text-[13px]"
                          style={{ borderColor: c.border, color: c.ink, opacity: isAdmin && ocrEnabled ? 1 : 0.5 }} />
                        <span className="text-[12px]" style={{ color: c.inkMute }}>
                          pages/day — the scheduler stops once the cap is hit until the next UTC day.
                        </span>
                      </div>
                      {isAdmin && (
                        <div className="mt-3 flex items-center justify-end gap-2">
                          {ocrSaveState === "saved" && (
                            <span className="text-[12px]" style={{ color: "#0E8A6B" }}>Saved.</span>
                          )}
                          {ocrSaveState === "error" && (
                            <span className="text-[12px]" style={{ color: c.rose }}>Could not save.</span>
                          )}
                          <button
                            disabled={ocrSaveState === "saving"}
                            onClick={async () => {
                              setOcrSaveState("saving");
                              try {
                                const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
                                const r = await fetch(`${base}/api/settings/ocr`, {
                                  method: "PATCH",
                                  headers: { "content-type": "application/json" },
                                  credentials: "include",
                                  body: JSON.stringify({ ocrEnabled, ocrDailyPageCap }),
                                });
                                if (!r.ok) throw new Error(await r.text());
                                await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
                                setOcrSaveState("saved");
                                setTimeout(() => setOcrSaveState("idle"), 2500);
                              } catch {
                                setOcrSaveState("error");
                                setTimeout(() => setOcrSaveState("idle"), 3000);
                              }
                            }}
                            className="rounded-md px-3 py-1.5 text-[12.5px] hover:opacity-90 disabled:opacity-60"
                            style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                          >
                            {ocrSaveState === "saving" ? "Saving…" : "Save OCR settings"}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Task #146 — welcome-tour version. Admins bump this after a
                        major release to opt the whole community into the tour
                        again. The server stamps each user's `tourVersionSeen`
                        when they dismiss it, so users who already completed
                        the new version are not re-prompted. */}
                    <div className="rounded-lg border p-4" style={{ borderColor: c.border, background: "#FAFBFF" }}>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-[13.5px]" style={{ fontWeight: 700, color: c.ink }}>Welcome tour version</div>
                          <p className="text-[12.5px] mt-0.5" style={{ color: c.inkMute }}>
                            Bump this after a major release to re-run the welcome tour for every user
                            whose last-seen version is older. Replay state is preserved per user — anyone
                            who has already dismissed this version will not see it again.
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[11px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>Current</div>
                          <div className="text-[18px] font-mono" style={{ color: c.ink, fontWeight: 700 }}>v{currentTourVersion}</div>
                        </div>
                      </div>
                      {isAdmin ? (
                        <div className="mt-3 flex items-center justify-end gap-2">
                          {tourSaveState === "saved" && (
                            <span className="text-[12px]" style={{ color: "#0E8A6B" }}>Tour bumped — users will see it on next load.</span>
                          )}
                          {tourSaveState === "error" && (
                            <span className="text-[12px]" style={{ color: c.rose }}>Could not save.</span>
                          )}
                          <button
                            disabled={tourSaveState === "saving"}
                            onClick={async () => {
                              if (!window.confirm(
                                `Re-run the welcome tour for the whole community?\n\n` +
                                `This bumps the org-wide tour version to v${currentTourVersion + 1}. ` +
                                `Anyone whose last-seen version is below v${currentTourVersion + 1} will see the tour ` +
                                `the next time they load the app. Users who dismiss it will not be re-prompted.`,
                              )) return;
                              setTourSaveState("saving");
                              try {
                                const next = currentTourVersion + 1;
                                await updateSettingsMutation.mutateAsync({
                                  data: { currentTourVersion: next } as Parameters<typeof updateSettingsMutation.mutateAsync>[0]["data"],
                                });
                                await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
                                setCurrentTourVersion(next);
                                setTourSaveState("saved");
                                setTimeout(() => setTourSaveState("idle"), 3000);
                              } catch {
                                setTourSaveState("error");
                                setTimeout(() => setTourSaveState("idle"), 3000);
                              }
                            }}
                            className="rounded-md px-3 py-1.5 text-[12.5px] hover:opacity-90 disabled:opacity-60"
                            style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                            data-testid="settings-bump-tour-version"
                          >
                            {tourSaveState === "saving" ? "Bumping…" : `Bump to v${currentTourVersion + 1} & re-run tour`}
                          </button>
                        </div>
                      ) : (
                        <div className="mt-3 text-[12px]" style={{ color: c.inkMute }}>
                          Only admins can bump the welcome-tour version.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
              <div className="flex items-center justify-end gap-3">
                {orgSaveState === "error" && (
                  <span className="text-[12.5px]" style={{ color: "#B8264C" }}>Failed to save. Please try again.</span>
                )}
                <SaveButton state={orgSaveState} onClick={handleSaveOrg} />
              </div>
            </>
          )}

          {/* ── Notifications ── */}
          {section === "Notifications" && (
            <NotificationsSection
              notif={notif}
              setNotif={setNotif}
              notifSaveState={notifSaveState}
              handleSaveNotif={handleSaveNotif}
            />
          )}

          {/* ── Architectural ── */}
          {section === "Architectural" && <AccSection />}
          {section === "Bids" && <BidPolicySection />}
          {section === "Calendar" && <CalendarResourcesSection />}
          {section === "Committees" && <CommitteesSection />}
          {section === "EV Chargers" && <EvChargersSection />}
          {section === "Mail Room" && <MailRoomSettingsSection />}

          {section === "Amenity Compliance" && <AmenityComplianceSettings />}

          {/* ── Members ── */}
          {section === "Members" && (
            <>
            <section className="rounded-xl border bg-white" style={{ borderColor: c.border }}>
              <button
                onClick={() => setRolesPanelOpen((v) => !v)}
                className="w-full flex items-center gap-3 p-5 text-left hover:bg-slate-50 rounded-xl"
                aria-expanded={rolesPanelOpen}
              >
                <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: c.cobaltSoft, color: c.cobalt }}>
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[15px]" style={{ fontWeight: 700, color: c.ink }}>Roles &amp; permissions</h3>
                  <p className="text-[12.5px] mt-0.5" style={{ color: c.inkMute, fontWeight: 500 }}>
                    A reference for who each persona is and what they can do. Click a persona to expand its details.
                  </p>
                </div>
                {rolesPanelOpen ? (
                  <ChevronUp className="h-4 w-4 shrink-0" style={{ color: c.inkMute }} />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0" style={{ color: c.inkMute }} />
                )}
              </button>
              {rolesPanelOpen && (
                <div className="px-5 pb-5 space-y-2">
                  <div className="rounded-md px-3 py-2 text-[12px] mb-1" style={{ background: c.canvas, color: c.inkSoft, fontWeight: 500 }}>
                    Whether a resident is treated as <strong>Owner</strong>, <strong>Tenant</strong>, or <strong>Unmatched</strong> is decided by matching their login email against the unit's recorded owner email and tenant email.
                  </div>
                  <div className="rounded-md px-3 py-2 text-[12px] mb-1" style={{ background: c.canvas, color: c.inkSoft, fontWeight: 500 }}>
                    <strong>Board member</strong> is a flag, not a role — anyone (Admin, Manager, Owner, or Tenant) can be flagged, and only Admins can grant or revoke it. Today the flag exclusively grants the right to vote on Stripe API key changes; their underlying role still controls everything else.
                  </div>
                  {PERSONAS.map((p) => (
                    <PersonaCard
                      key={p.key}
                      p={p}
                      expanded={expandedPersona === p.key}
                      onToggle={() => setExpandedPersona((cur) => (cur === p.key ? null : p.key))}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
              <h3 className="text-[16px] mb-1" style={{ fontWeight: 700 }}>Members</h3>
              <p className="text-[13px] mb-6" style={{ color: c.inkMute, fontWeight: 500 }}>Manage staff and residents who have access to this workspace. The Board member flag — independent of role and Admin-only — is shown beneath each row.</p>
              <div className="space-y-3">
                {users.map((m) => {
                  const role = m.role as UserRole;
                  const initials = m.name
                    ? m.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
                    : m.email.slice(0, 2).toUpperCase();
                  const isSelf = currentUser?.id === m.id;
                  const assignedUnit = m.unitId ? allUnits.find((u) => u.id === m.unitId) : null;
                  const occupancy: OccupancyRole | null = role === "resident"
                    ? resolveOccupancyForRow(m.email, assignedUnit, !!m.unitId)
                    : null;
                  const occMeta = occupancy ? occupancyMeta[occupancy] : null;
                  return (
                    <div key={m.id} className="rounded-lg border p-3" style={{ borderColor: c.borderSoft }}>
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full flex items-center justify-center text-[12px] shrink-0" style={{ background: roleBg[role] ?? c.cobaltSoft, color: roleColor[role] ?? c.cobalt, fontWeight: 700 }}>{initials}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13.5px] flex items-center gap-1.5 flex-wrap" style={{ fontWeight: 600, color: c.ink }}>
                            {m.name || <span style={{ color: c.inkMute, fontStyle: "italic" }}>No name</span>}
                            {isSelf && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "#EFF5FF", color: "#1A4DA0", fontWeight: 600 }}>You</span>}
                            {m.pending && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "#FEF3E2", color: "#E37400", fontWeight: 600 }}>Pending</span>}
                            {m.boardMember && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded-full inline-flex items-center gap-1"
                                style={{ background: "#EDE7FF", color: "#5A3FD9", fontWeight: 600 }}
                                title="Flagged as a board member — votes on Stripe key changes"
                              >
                                <Vote className="h-2.5 w-2.5" /> Board
                              </span>
                            )}
                            {m.boardMember && showStripeApprovalBadges && (() => {
                              const decision = stripeApprovalByUserId[m.id] ?? null;
                              const requestRejected = stripeRequestStatus === "rejected";
                              const label = decision === "approve"
                                ? "Approved"
                                : decision === "reject"
                                ? "Rejected"
                                : requestRejected
                                ? "No vote"
                                : "Pending vote";
                              const bg = decision === "approve" ? "#DCF3EC" : decision === "reject" ? "#FBE3E9" : "#FEF3E2";
                              const fg = decision === "approve" ? "#0E8A6B" : decision === "reject" ? "#B8264C" : "#E37400";
                              const title = decision === "approve"
                                ? "Approved the latest Stripe key change"
                                : decision === "reject"
                                ? "Rejected the latest Stripe key change"
                                : requestRejected
                                ? "Did not vote before the latest Stripe key change was rejected"
                                : "Has not yet voted on the pending Stripe key change";
                              return (
                                <span
                                  className="text-[10px] px-1.5 py-0.5 rounded-full"
                                  style={{ background: bg, color: fg, fontWeight: 600 }}
                                  title={title}
                                >
                                  {label}
                                </span>
                              );
                            })()}
                            {occMeta && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded-full"
                                style={{ background: occMeta.bg, color: occMeta.fg, fontWeight: 600 }}
                                title={
                                  occupancy === "owner" ? "Login email matches the unit's owner email"
                                  : occupancy === "tenant" ? "Login email matches the unit's tenant email"
                                  : occupancy === "unmatched" ? "Email matches neither owner nor tenant on the assigned unit — review"
                                  : "Resident has no unit assigned"
                                }
                              >
                                {occMeta.label}
                              </span>
                            )}
                          </div>
                          <div className="text-[12px]" style={{ color: c.inkMute }}>{m.email}</div>
                        </div>
                        {currentUser?.role === "admin" ? (
                          <>
                            <div className="relative">
                              <select
                                value={role}
                                disabled={isSelf}
                                onChange={(e) => handleRoleChange(m.id, e.target.value as UserRole)}
                                title={roleSummary[role]}
                                aria-label={`Role: ${roleLabel[role]}. ${roleSummary[role]}`}
                                className="appearance-none text-[11px] px-2.5 py-1 pr-6 rounded-full border-0 cursor-pointer disabled:cursor-default"
                                style={{ background: roleBg[role] ?? c.cobaltSoft, color: roleColor[role] ?? c.cobalt, fontWeight: 600 }}
                              >
                                {ROLE_OPTS.map((r) => (
                                  <option key={r} value={r}>{roleLabel[r]}</option>
                                ))}
                              </select>
                              {!isSelf && <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3" style={{ color: roleColor[role] }} />}
                            </div>
                            {!isSelf && (
                              <button
                                onClick={() => handleDelete(m.id)}
                                className="ml-1 p-1.5 rounded hover:bg-red-50 transition-colors"
                                style={{ color: c.inkMute }}
                                title="Remove member"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </>
                        ) : (
                          // Read-only role badge for non-admins. Role changes,
                          // deletes, and unit reassignment are admin-only and
                          // the API rejects them, so the controls are hidden.
                          <span
                            className="text-[11px] px-2.5 py-1 rounded-full"
                            title={roleSummary[role]}
                            style={{ background: roleBg[role] ?? c.cobaltSoft, color: roleColor[role] ?? c.cobalt, fontWeight: 600 }}
                          >
                            {roleLabel[role]}
                          </span>
                        )}
                      </div>
                      {currentUser?.role === "admin" && (
                        <div className="mt-2 ml-12 flex items-center gap-2 flex-wrap">
                          <label className="inline-flex items-center gap-2 cursor-pointer text-[12px]" style={{ color: c.inkSoft, fontWeight: 500 }}>
                            <input
                              type="checkbox"
                              checked={!!m.boardMember}
                              disabled={updateBoardMemberMutation.isPending}
                              onChange={(e) => handleBoardMemberToggle(m.id, e.target.checked)}
                              className="accent-violet-600"
                            />
                            <Vote className="h-3.5 w-3.5" style={{ color: "#5A3FD9" }} />
                            <span>Board member</span>
                            <span className="text-[11px]" style={{ color: c.inkMute, fontWeight: 400 }}>
                              — votes on Stripe key changes
                            </span>
                          </label>
                          <button
                            type="button"
                            onClick={() => setHistoryUserId((cur) => (cur === m.id ? null : m.id))}
                            className="inline-flex items-center gap-1 text-[11.5px] px-2 py-0.5 rounded-md hover:bg-slate-100"
                            style={{ color: c.inkSoft, fontWeight: 500 }}
                            title="View board-flag change history"
                          >
                            <History className="h-3 w-3" />
                            {historyUserId === m.id ? "Hide history" : "History"}
                          </button>
                          {boardMemberError?.userId === m.id && (
                            <span className="text-[11.5px] rounded-md px-2 py-0.5" style={{ background: "#FEF2F2", color: "#B91C1C", fontWeight: 500 }}>
                              {boardMemberError.msg}
                            </span>
                          )}
                        </div>
                      )}
                      {currentUser?.role === "admin" && historyUserId === m.id && (
                        <div className="mt-2 ml-12">
                          <BoardMemberHistory userId={m.id} />
                        </div>
                      )}
                      {currentUser?.role === "admin" && m.boardMember && (
                        <div className="mt-2 ml-12 rounded-md p-2.5" style={{ background: "#F8F6FF", border: `1px solid ${c.borderSoft}` }}>
                          <div className="text-[11.5px] mb-2" style={{ color: c.inkSoft, fontWeight: 600 }}>
                            Officer title &amp; term
                            <span className="text-[11px] ml-1" style={{ color: c.inkMute, fontWeight: 400 }}>
                              — President, VP, Treasurer, and Secretary are unique; Member-at-Large can be held by multiple people.
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={m.officerTitle ?? ""}
                              disabled={updateOfficerMutation.isPending}
                              onChange={(e) => handleOfficerUpdate(m.id, { officerTitle: e.target.value || null })}
                              className="rounded-md border px-2 py-1 text-[12px] bg-white"
                              style={{ borderColor: c.borderSoft }}
                            >
                              <option value="">— No title —</option>
                              <option value="President">President</option>
                              <option value="Vice President">Vice President</option>
                              <option value="Treasurer">Treasurer</option>
                              <option value="Secretary">Secretary</option>
                              <option value="Member-at-Large">Member-at-Large</option>
                            </select>
                            <label className="inline-flex items-center gap-1 text-[11.5px]" style={{ color: c.inkMute }}>
                              Start
                              <input
                                type="date"
                                value={m.termStart ?? ""}
                                disabled={updateOfficerMutation.isPending}
                                onChange={(e) => handleOfficerUpdate(m.id, { termStart: e.target.value || null })}
                                className="rounded-md border px-2 py-1 text-[12px] bg-white"
                                style={{ borderColor: c.borderSoft }}
                              />
                            </label>
                            <label className="inline-flex items-center gap-1 text-[11.5px]" style={{ color: c.inkMute }}>
                              End
                              <input
                                type="date"
                                value={m.termEnd ?? ""}
                                disabled={updateOfficerMutation.isPending}
                                onChange={(e) => handleOfficerUpdate(m.id, { termEnd: e.target.value || null })}
                                className="rounded-md border px-2 py-1 text-[12px] bg-white"
                                style={{ borderColor: c.borderSoft }}
                              />
                            </label>
                            {officerError?.userId === m.id && (
                              <span className="text-[11.5px] rounded-md px-2 py-0.5" style={{ background: "#FEF2F2", color: "#B91C1C", fontWeight: 500 }}>
                                {officerError.msg}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                      {role === "resident" && !isSelf && currentUser?.role === "admin" && (
                        <div className="mt-2.5 ml-12 flex items-center gap-2">
                          <span className="text-[11.5px] shrink-0" style={{ color: c.inkMute, fontWeight: 500 }}>Assigned unit:</span>
                          <select
                            value={m.unitId ?? ""}
                            onChange={(e) => handleAssignUnit(m.id, e.target.value || null)}
                            className="flex-1 rounded-md border px-2 py-1 text-[12px] bg-white"
                            style={{ borderColor: c.border, color: c.ink }}
                          >
                            <option value="">No unit assigned</option>
                            {allUnits.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.address} — Unit {u.unit}
                              </option>
                            ))}
                          </select>
                          {assignedUnit && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full shrink-0" style={{ background: "#F3EEFF", color: "#7B3FE4", fontWeight: 600 }}>
                              Bldg {assignedUnit.building}
                            </span>
                          )}
                          {occupancy === "unmatched" && resolveUserId !== m.id && (
                            <button
                              onClick={() => openResolve(m.id)}
                              className="text-[11.5px] px-2.5 py-1 rounded-md shrink-0 hover:opacity-90"
                              style={{ background: "#B8264C", color: "#fff", fontWeight: 600 }}
                              title="Resolve unmatched permission"
                            >
                              Resolve
                            </button>
                          )}
                        </div>
                      )}
                      {role === "resident" && !isSelf && occupancy === "unmatched" && resolveUserId === m.id && (
                        <div className="mt-2.5 ml-12 rounded-md border p-3" style={{ borderColor: c.border, background: c.canvas }}>
                          <div className="flex items-start gap-2 mb-2.5">
                            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "#B8264C" }} />
                            <div className="flex-1 min-w-0">
                              <div className="text-[12.5px]" style={{ color: c.ink, fontWeight: 600 }}>
                                Resolve unmatched permission
                              </div>
                              <div className="text-[11.5px] mt-0.5" style={{ color: c.inkMute, fontWeight: 500 }}>
                                {m.email}
                                {assignedUnit && <> is on <strong>{assignedUnit.address} — Unit {assignedUnit.unit}</strong> but doesn&rsquo;t match its owner ({assignedUnit.ownerEmail || "—"}) or tenant ({assignedUnit.tenantEmail || "—"}) email.</>}
                              </div>
                            </div>
                            <button
                              onClick={closeResolve}
                              className="p-1 rounded hover:bg-slate-100"
                              style={{ color: c.inkMute }}
                              title="Cancel"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {resolveMode === "choice" ? (
                            <div className="grid grid-cols-1 gap-2">
                              <button
                                disabled={resolveBusy || !assignedUnit}
                                onClick={() => handleResolveSetEmail(m, "ownerEmail")}
                                className="text-left rounded-md border p-2.5 hover:bg-white disabled:opacity-60"
                                style={{ borderColor: c.borderSoft, background: "#fff" }}
                              >
                                <div className="flex items-center gap-2">
                                  <Home className="h-3.5 w-3.5 shrink-0" style={{ color: "#0E8A6B" }} />
                                  <div className="text-[12.5px]" style={{ color: c.ink, fontWeight: 600 }}>Mark as owner of record</div>
                                </div>
                                <div className="text-[11.5px] mt-0.5 ml-5" style={{ color: c.inkMute }}>
                                  Sets the unit&rsquo;s owner email to <strong>{m.email}</strong>{assignedUnit?.ownerEmail ? <> (was {assignedUnit.ownerEmail})</> : null}.
                                </div>
                              </button>
                              <button
                                disabled={resolveBusy || !assignedUnit}
                                onClick={() => handleResolveSetEmail(m, "tenantEmail")}
                                className="text-left rounded-md border p-2.5 hover:bg-white disabled:opacity-60"
                                style={{ borderColor: c.borderSoft, background: "#fff" }}
                              >
                                <div className="flex items-center gap-2">
                                  <Key className="h-3.5 w-3.5 shrink-0" style={{ color: "#A66C0E" }} />
                                  <div className="text-[12.5px]" style={{ color: c.ink, fontWeight: 600 }}>Mark as tenant of record</div>
                                </div>
                                <div className="text-[11.5px] mt-0.5 ml-5" style={{ color: c.inkMute }}>
                                  Sets the unit&rsquo;s tenant email to <strong>{m.email}</strong>{assignedUnit?.tenantEmail ? <> (was {assignedUnit.tenantEmail})</> : null}.
                                </div>
                              </button>
                              <button
                                disabled={resolveBusy}
                                onClick={() => { setResolveMode("reassign"); setResolveUnitId(""); setResolveError(null); }}
                                className="text-left rounded-md border p-2.5 hover:bg-white disabled:opacity-60"
                                style={{ borderColor: c.borderSoft, background: "#fff" }}
                              >
                                <div className="flex items-center gap-2">
                                  <Building2 className="h-3.5 w-3.5 shrink-0" style={{ color: c.cobalt }} />
                                  <div className="text-[12.5px]" style={{ color: c.ink, fontWeight: 600 }}>Reassign to another unit</div>
                                </div>
                                <div className="text-[11.5px] mt-0.5 ml-5" style={{ color: c.inkMute }}>
                                  Pick a different unit where this resident&rsquo;s email matches owner or tenant.
                                </div>
                              </button>
                            </div>
                          ) : (() => {
                            const me = m.email.trim().toLowerCase();
                            const matchingUnits = allUnits.filter((u) => {
                              if (u.id === m.unitId) return false;
                              const o = (u.ownerEmail ?? "").trim().toLowerCase();
                              const t = (u.tenantEmail ?? "").trim().toLowerCase();
                              return !!me && (me === o || me === t);
                            });
                            return (
                              <div className="space-y-2">
                                {matchingUnits.length === 0 ? (
                                  <div className="text-[11.5px] rounded-md px-2 py-2" style={{ background: "#FBE3E9", color: "#B8264C", fontWeight: 500 }}>
                                    No other unit has <strong>{m.email}</strong> recorded as owner or tenant. Update a unit&rsquo;s emails first, or pick one of the other actions.
                                  </div>
                                ) : (
                                  <select
                                    value={resolveUnitId}
                                    onChange={(e) => setResolveUnitId(e.target.value)}
                                    className="w-full rounded-md border px-2 py-1.5 text-[12.5px] bg-white"
                                    style={{ borderColor: c.border, color: c.ink }}
                                  >
                                    <option value="">Select a unit…</option>
                                    {matchingUnits.map((u) => {
                                      const o = (u.ownerEmail ?? "").trim().toLowerCase();
                                      const role = me === o ? "owner" : "tenant";
                                      return (
                                        <option key={u.id} value={u.id}>
                                          {u.address} — Unit {u.unit}  (matches {role})
                                        </option>
                                      );
                                    })}
                                  </select>
                                )}
                                <div className="flex items-center gap-2">
                                  <button
                                    disabled={resolveBusy}
                                    onClick={() => { setResolveMode("choice"); setResolveError(null); }}
                                    className="text-[12px] px-2.5 py-1 rounded-md border hover:bg-white disabled:opacity-60"
                                    style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
                                  >
                                    Back
                                  </button>
                                  <button
                                    disabled={resolveBusy || !resolveUnitId || matchingUnits.length === 0}
                                    onClick={() => handleResolveReassign(m.id)}
                                    className="text-[12px] px-2.5 py-1 rounded-md hover:opacity-90 disabled:opacity-60"
                                    style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                                  >
                                    {resolveBusy ? "Reassigning…" : "Reassign"}
                                  </button>
                                </div>
                              </div>
                            );
                          })()}
                          {resolveError && (
                            <div className="mt-2 text-[11.5px] rounded-md px-2 py-1.5" style={{ background: "#FEF2F2", color: "#B91C1C" }}>
                              {resolveError}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {showInviteForm ? (
                <div className="mt-4 rounded-lg border p-4 space-y-3" style={{ borderColor: c.border, background: c.canvas }}>
                  <h4 className="text-[13.5px]" style={{ fontWeight: 700, color: c.ink }}>Invite member</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Email">
                      <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="user@example.com" className="w-full rounded-md border px-3 py-2 text-[13px]" style={{ borderColor: c.border, color: c.ink }} />
                    </Field>
                    <Field label="Name (optional)">
                      <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Full name" className="w-full rounded-md border px-3 py-2 text-[13px]" style={{ borderColor: c.border, color: c.ink }} />
                    </Field>
                  </div>
                  <Field label="Role">
                    <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as UserRole)} className="w-full rounded-md border px-3 py-2 text-[13px] bg-white" style={{ borderColor: c.border, color: c.ink }}>
                      {ROLE_OPTS.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                    </select>
                    <div className="mt-1 text-[12px]" style={{ color: c.inkMute }}>
                      {roleSummary[inviteRole]}
                    </div>
                  </Field>
                  {inviteRole === "resident" && (
                    <Field label="Assign unit (optional)">
                      <select
                        value={inviteUnitId}
                        onChange={(e) => setInviteUnitId(e.target.value)}
                        className="w-full rounded-md border px-3 py-2 text-[13px] bg-white"
                        style={{ borderColor: c.border, color: c.ink }}
                      >
                        <option value="">No unit assigned</option>
                        {allUnits.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.address} — Unit {u.unit}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {currentUser?.role === "admin" && (
                    <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-white" style={{ borderColor: c.borderSoft, background: "#fff" }}>
                      <input
                        type="checkbox"
                        checked={inviteBoardMember}
                        onChange={(e) => setInviteBoardMember(e.target.checked)}
                        className="mt-0.5 accent-violet-600"
                      />
                      <div className="flex-1">
                        <div className="text-[13px] inline-flex items-center gap-1.5" style={{ fontWeight: 600, color: c.ink }}>
                          <Vote className="h-3.5 w-3.5" style={{ color: "#5A3FD9" }} />
                          Flag as board member
                        </div>
                        <div className="text-[12px] mt-0.5" style={{ color: c.inkMute, fontWeight: 500 }}>
                          Independent of role — currently grants the right to vote on Stripe key changes. Only Admins can toggle this.
                        </div>
                      </div>
                    </label>
                  )}
                  {inviteError && <div className="text-[12.5px] rounded-md px-3 py-2" style={{ background: "#FEF2F2", color: "#B91C1C" }}>{inviteError}</div>}
                  <div className="flex items-center gap-2">
                    <button onClick={handleInvite} disabled={inviteMutation.isPending} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] hover:opacity-90 disabled:opacity-60" style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
                      {inviteMutation.isPending ? "Inviting…" : "Send invite"}
                    </button>
                    <button onClick={() => { setShowInviteForm(false); setInviteError(null); setInviteUnitId(""); }} className="rounded-md border px-3 py-1.5 text-[13px] hover:bg-slate-50" style={{ borderColor: c.border, color: c.inkSoft }}>Cancel</button>
                  </div>
                </div>
              ) : currentUser?.role === "admin" ? (
                <button
                  onClick={() => setShowInviteForm(true)}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] hover:bg-slate-50"
                  style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
                >
                  <Plus className="h-3.5 w-3.5" /> Invite member
                </button>
              ) : null}
              {inviteResult && (
                <div className="mt-4 rounded-lg border p-4" style={{ background: "#F0FDF7", borderColor: "#A7F3D0" }}>
                  <div className="text-[13px] mb-1" style={{ fontWeight: 700, color: "#065F46" }}>
                    Invite link for {inviteResult.email}
                  </div>
                  <div className="text-[12px] mb-2" style={{ color: "#047857" }}>
                    Share this single-use link with the user. It expires {new Date(inviteResult.expiresAt).toLocaleString()}.
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={inviteResult.url}
                      onFocus={(e) => e.currentTarget.select()}
                      className="flex-1 rounded-md border px-2 py-1.5 text-[12px] bg-white"
                      style={{ borderColor: c.border, color: c.ink, fontFamily: "ui-monospace, monospace" }}
                    />
                    <button
                      onClick={copyInviteUrl}
                      className="rounded-md px-3 py-1.5 text-[12px] hover:opacity-90 whitespace-nowrap"
                      style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                    >
                      {inviteCopied ? "Copied!" : "Copy"}
                    </button>
                    <button
                      onClick={() => setInviteResult(null)}
                      className="rounded-md border px-3 py-1.5 text-[12px] hover:bg-white"
                      style={{ borderColor: c.border, color: c.inkSoft }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </section>
            </>
          )}

          {/* ── Integrations ── */}
          {section === "Integrations" && (
            <>
              {driveJustConnected && (
                <div className="flex items-center gap-2.5 rounded-xl border px-4 py-3" style={{ background: "#F0FDF7", borderColor: "#A7F3D0" }}>
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" style={{ color: "#059669" }} />
                  <span className="text-[13px]" style={{ color: "#065F46", fontWeight: 600 }}>Google Drive connected successfully. Documents will now sync automatically.</span>
                </div>
              )}

              <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
                <h3 className="text-[16px] mb-1" style={{ fontWeight: 700 }}>Google Drive</h3>
                <p className="text-[13px] mb-5" style={{ color: c.inkMute, fontWeight: 500 }}>
                  Sync HOA documents to a shared Google Drive folder automatically whenever files are uploaded.
                </p>

                {driveLoading ? (
                  <div className="flex items-center gap-2 text-[13px]" style={{ color: c.inkMute }}>
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking connection…
                  </div>
                ) : driveStatus?.connected ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 rounded-xl border p-4" style={{ borderColor: "#A7F3D0", background: "#F0FDF7" }}>
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0" style={{ background: "#E8F0FE" }}>
                        <HardDrive className="h-5 w-5" style={{ color: "#1A73E8" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13.5px]" style={{ fontWeight: 700, color: c.ink }}>Connected</span>
                          <span className="text-[10.5px] px-2 py-0.5 rounded-full" style={{ background: "#D1FAE5", color: "#065F46", fontWeight: 700 }}>Active</span>
                        </div>
                        <div className="text-[12.5px] mt-0.5" style={{ color: c.inkSoft }}>
                          {driveStatus.accountEmail}
                        </div>
                        {driveStatus.connectedAt && (
                          <div className="text-[11.5px] mt-0.5" style={{ color: c.inkMute }}>
                            Connected {new Date(driveStatus.connectedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={handleDriveDisconnect}
                        disabled={disconnectDriveMutation.isPending}
                        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] hover:bg-red-50 transition-colors disabled:opacity-60"
                        style={{ borderColor: c.border, color: "#B8264C", fontWeight: 600 }}
                      >
                        {disconnectDriveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2Off className="h-3.5 w-3.5" />}
                        Disconnect
                      </button>
                    </div>
                    <p className="text-[12px]" style={{ color: c.inkMute }}>
                      New documents uploaded to HOA Hub are automatically mirrored to the <strong style={{ color: c.inkSoft }}>Quail Valley HOA Documents</strong> folder in Google Drive, matching the on-screen folder tree exactly.
                    </p>

                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        onClick={handleDriveResync}
                        disabled={resyncDriveMutation.isPending || driveStatus.syncInProgress}
                        className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] hover:opacity-90 disabled:opacity-60"
                        style={{ background: "#1A73E8", color: "#fff", fontWeight: 600 }}
                      >
                        {(resyncDriveMutation.isPending || driveStatus.syncInProgress) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
                        {driveStatus.syncInProgress
                          ? `Syncing ${driveStatus.syncProgressDone}/${driveStatus.syncProgressTotal}…`
                          : resyncDriveMutation.isPending
                            ? "Starting…"
                            : "Sync now"}
                      </button>
                      <div className="text-[11.5px]" style={{ color: c.inkMute }}>
                        {driveStatus.lastSyncAt
                          ? `Last sync ${new Date(driveStatus.lastSyncAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${driveStatus.lastSyncCount ?? 0} file${driveStatus.lastSyncCount === 1 ? "" : "s"} synced${driveStatus.lastSyncFailures > 0 ? ` · ${driveStatus.lastSyncFailures} failed` : ""}`
                          : "Never synced"}
                      </div>
                      {driveSyncToast && (
                        <div
                          className="text-[11.5px] rounded-md px-2 py-1"
                          style={{
                            background: driveSyncToast.type === "success" ? "#DCF3EC" : "#FBE3E9",
                            color: driveSyncToast.type === "success" ? "#0E8A6B" : "#B8264C",
                            fontWeight: 600,
                          }}
                        >
                          {driveSyncToast.msg}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-start gap-3 rounded-xl border p-4" style={{ borderColor: c.border, background: c.canvas }}>
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0" style={{ background: "#E8F0FE" }}>
                        <HardDrive className="h-5 w-5" style={{ color: "#1A73E8" }} />
                      </div>
                      <div className="flex-1">
                        <div className="text-[13.5px]" style={{ fontWeight: 700, color: c.ink }}>Not connected</div>
                        <div className="text-[12px] mt-1 leading-relaxed" style={{ color: c.inkMute }}>
                          Connect a Google account to start syncing documents. You'll be redirected to Google to authorize access.
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={handleDriveConnect}
                      className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-[13.5px] hover:opacity-90 transition-opacity"
                      style={{ background: "#1A73E8", color: "#fff", fontWeight: 600 }}
                    >
                      <HardDrive className="h-4 w-4" />
                      Connect Google Drive
                    </button>
                  </div>
                )}
              </section>

              <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
                <h3 className="text-[16px] mb-1" style={{ fontWeight: 700 }}>More Integrations</h3>
                <p className="text-[13px] mb-5" style={{ color: c.inkMute, fontWeight: 500 }}>Connect HOA Hub to the tools your team already uses.</p>
                <div className="grid grid-cols-2 gap-3">
                  {INTEGRATIONS.map((intg) => {
                    const Icon = intg.icon;
                    const isPlanned = intg.badge === "Planned";
                    return (
                      <div key={intg.key} className="rounded-xl border p-4 flex flex-col gap-3" style={{ borderColor: c.border }}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0" style={{ background: intg.iconBg }}>
                            <Icon className="h-5 w-5" style={{ color: intg.iconFg }} />
                          </div>
                          <span className="text-[10.5px] px-2 py-0.5 rounded-full mt-0.5" style={isPlanned ? { background: "#EFF5FF", color: "#1A4DA0", fontWeight: 700 } : { background: "#F5F0FF", color: "#5B21B6", fontWeight: 700 }}>
                            {intg.badge}
                          </span>
                        </div>
                        <div>
                          <div className="text-[13.5px]" style={{ fontWeight: 700, color: c.ink }}>{intg.label}</div>
                          <div className="text-[12px] mt-1 leading-relaxed" style={{ color: c.inkMute }}>{intg.desc}</div>
                        </div>
                        <button className="mt-auto inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-[12px] opacity-60 cursor-not-allowed" style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }} disabled>
                          {isPlanned ? "Configure" : "Notify me"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
                <h3 className="text-[16px] mb-1" style={{ fontWeight: 700 }}>Document Folder Structure</h3>
                <p className="text-[13px] mb-5" style={{ color: c.inkMute, fontWeight: 500 }}>Default sub-folder categories created for each building when auto-generating folder structures.</p>
                <div className="space-y-2 mb-4">
                  {categories.map((cat) => (
                    <div key={cat.id} className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: c.borderSoft }}>
                      <Check className="h-3.5 w-3.5 flex-shrink-0" style={{ color: c.cobalt }} />
                      <span className="flex-1 text-[13.5px]" style={{ color: c.ink, fontWeight: 500 }}>{cat.name}</span>
                      <button
                        onClick={() => removeCat(cat.id)}
                        disabled={deleteCategoryMutation.isPending}
                        className="rounded p-0.5 hover:bg-red-50"
                        style={{ color: c.inkMute }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                {catError && (
                  <p className="text-[12px] mb-2" style={{ color: "#B8264C" }}>{catError}</p>
                )}
                <div className="flex items-center gap-2">
                  <input
                    value={newCat}
                    onChange={(e) => { setNewCat(e.target.value); setCatError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && addCat()}
                    placeholder="Add folder category…"
                    className="flex-1 rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ borderColor: c.border, color: c.ink }}
                  />
                  <button
                    onClick={addCat}
                    disabled={createCategoryMutation.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] hover:opacity-90 disabled:opacity-60"
                    style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                  >
                    {createCategoryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add
                  </button>
                </div>
              </section>

              <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
                <h3 className="text-[16px] mb-1" style={{ fontWeight: 700 }}>System Architecture</h3>
                <p className="text-[13px] mb-5" style={{ color: c.inkMute, fontWeight: 500 }}>
                  How HOA Hub is designed to scale from a simple dashboard to a fully integrated community platform.
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {ARCH_LAYERS.map((layer) => {
                    const Icon = layer.icon;
                    return (
                      <div key={layer.label} className="rounded-xl border p-4" style={{ borderColor: c.borderSoft, background: c.canvas }}>
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg mb-2.5" style={{ background: layer.bg, color: layer.color }}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="text-[13px]" style={{ fontWeight: 700, color: c.ink }}>{layer.label}</div>
                        <div className="text-[11.5px] mt-1 leading-relaxed" style={{ color: c.inkMute, fontWeight: 500 }}>{layer.desc}</div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}

          {/* ── Plat Map ── */}
          {section === "Plat Map" && (
            <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
              <h3 className="text-[16px] mb-1" style={{ fontWeight: 700 }}>Building Marker Editor</h3>
              <p className="text-[13px] mb-5" style={{ color: c.inkMute, fontWeight: 500 }}>
                Drag any building number to adjust its position on each map view. Saved positions update the Site Map page immediately.
              </p>

              <div className="flex items-center gap-1 mb-4 rounded-lg p-1 self-start" style={{ background: c.canvas, border: `1px solid ${c.border}`, width: "fit-content" }}>
                {MAP_VIEW_OPTS.map(({ key, label, Icon }) => {
                  const active = mapView === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setMapView(key)}
                      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] transition-colors"
                      style={
                        active
                          ? { background: "#fff", color: c.cobalt, fontWeight: 700, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
                          : { color: c.inkSoft, fontWeight: 500 }
                      }
                    >
                      <Icon style={{ height: 13, width: 13 }} />
                      {label}
                    </button>
                  );
                })}
              </div>

              {markersLoading ? (
                <div className="flex items-center justify-center" style={{ height: 460 }}>
                  <Loader2 className="h-6 w-6 animate-spin" style={{ color: c.inkMute }} />
                </div>
              ) : (
                <ImageMapEditor
                  key={mapView}
                  view={mapView}
                  positions={positions[mapView]}
                  onChange={(updated) => setPositions((prev) => ({ ...prev, [mapView]: updated }))}
                  height={460}
                  buildings={buildings}
                />
              )}

              <div className="mt-4 flex items-center justify-between">
                <p className="text-[12.5px]" style={{ color: c.inkMute, fontWeight: 500 }}>
                  Changes to each view are saved independently.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleReset}
                    className="rounded-md border px-3 py-1.5 text-[13px] hover:bg-slate-50"
                    style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
                  >
                    Reset {mapView === "plat" ? "Plat Doc" : mapView === "satellite" ? "Satellite" : "Road Map"}
                  </button>
                  <button
                    onClick={handleSaveMarkers}
                    disabled={mapSaving}
                    className="rounded-md px-4 py-1.5 text-[13px] hover:opacity-90 disabled:opacity-70 inline-flex items-center gap-1.5"
                    style={{
                      background: savedView === mapView ? c.emerald : c.cobalt,
                      color: "#fff", fontWeight: 600, transition: "background 0.2s",
                    }}
                  >
                    {mapSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {savedView === mapView ? "Saved ✓" : "Save positions"}
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* ── Billing ── */}
          {section === "Billing" && <PaymentsSettingsSection />}
          {section === "Governance" && (
            <>
              <NoticeQuorumSection />
              <GovernanceSection />
            </>
          )}

        </div>
      </div>
    </Layout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] mb-1.5 uppercase tracking-wider" style={{ color: c.inkSoft, fontWeight: 700 }}>{label}</label>
      {children}
    </div>
  );
}

function SaveButton({ state, onClick }: { state: "idle" | "saving" | "saved" | "error"; onClick: () => void }) {
  const isSaved = state === "saved";
  const isSaving = state === "saving";
  return (
    <button
      onClick={onClick}
      disabled={isSaving}
      className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-[13.5px] hover:opacity-90 disabled:opacity-70"
      style={{
        background: isSaved ? "#0E8A6B" : "#3245FF",
        color: "#fff", fontWeight: 600, transition: "background 0.2s",
      }}
    >
      {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {isSaved ? "Saved ✓" : "Save changes"}
    </button>
  );
}
function BidPolicySection() {
  const [thresholdDollars, setThresholdDollars] = useState("");
  const [defaultSealed, setDefaultSealed] = useState(false);
  const [reminderDays, setReminderDays] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  useEffect(() => {
    fetch(`${base}/api/settings`, { credentials: "include" })
      .then((r) => r.json())
      .then((d: { minQuotesThresholdCents: number | null; bidDefaultSealed: boolean; bidReminderDaysBefore: number }) => {
        setThresholdDollars(d.minQuotesThresholdCents ? (d.minQuotesThresholdCents / 100).toString() : "");
        setDefaultSealed(!!d.bidDefaultSealed);
        setReminderDays(d.bidReminderDaysBefore || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [base]);

  async function save() {
    setSaveState("saving");
    try {
      const cents = thresholdDollars ? Math.round(parseFloat(thresholdDollars) * 100) : 0;
      const res = await fetch(`${base}/api/settings/bids`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minQuotesThresholdCents: cents, defaultSealed, reminderDaysBefore: reminderDays }),
      });
      if (!res.ok) throw new Error();
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch {
      setSaveState("error");
    }
  }

  if (loading) return <div className="text-[13px]" style={{ color: c.inkMute }}>Loading…</div>;

  return (
    <>
      <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
        <h3 className="text-[16px] mb-1" style={{ fontWeight: 700 }}>Bid Policy</h3>
        <p className="text-[13px] mb-5" style={{ color: c.inkMute, fontWeight: 500 }}>
          Configure thresholds and defaults for multi-vendor bid requests.
        </p>
        <div className="space-y-4">
          <Field label="Competitive-bid threshold (USD)">
            <div className="relative max-w-[220px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px]" style={{ color: c.inkMute }}>$</span>
              <input type="number" min={0} value={thresholdDollars}
                onChange={(e) => setThresholdDollars(e.target.value)}
                placeholder="0"
                className="w-full rounded-md border pl-7 pr-3 py-2 text-[13.5px] font-mono-num"
                style={{ borderColor: c.border, color: c.ink }} />
            </div>
            <div className="text-[11.5px] mt-1" style={{ color: c.inkMute }}>
              When a work order's estimated cost meets or exceeds this amount, managers see a soft warning to run a bid. Leave blank to disable.
            </div>
          </Field>

          <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-slate-50" style={{ borderColor: c.borderSoft }}>
            <input type="checkbox" checked={defaultSealed} onChange={(e) => setDefaultSealed(e.target.checked)} className="mt-0.5 accent-blue-600" />
            <div>
              <div className="text-[13.5px]" style={{ fontWeight: 600 }}>Default new bids to sealed</div>
              <div className="text-[12.5px] mt-0.5" style={{ color: c.inkMute, fontWeight: 500 }}>
                Sealed bids hide totals from managers and other vendors until the deadline (or until opened early).
              </div>
            </div>
          </label>

          <Field label="Reminder window (days before deadline)">
            <input type="number" min={0} max={30} value={reminderDays}
              onChange={(e) => setReminderDays(Math.max(0, parseInt(e.target.value || "0", 10)))}
              className="w-full max-w-[120px] rounded-md border px-3 py-2 text-[13.5px]"
              style={{ borderColor: c.border, color: c.ink }} />
            <div className="text-[11.5px] mt-1" style={{ color: c.inkMute }}>
              Vendors who haven't submitted will receive a reminder email when the bid is within this many days of closing.
            </div>
          </Field>
        </div>
      </section>
      <div className="flex items-center justify-end gap-3">
        {saveState === "error" && <span className="text-[12.5px]" style={{ color: "#B8264C" }}>Failed to save. Please try again.</span>}
        <SaveButton state={saveState} onClick={save} />
      </div>
    </>
  );
}

type StripeBoardMember = { id: number; name: string; role: string };
type StripeBoardApproval = { userId: number; name: string; role: string; decision: "approve" | "reject" | null };
type StripePendingRequest = {
  id: number;
  proposedByUserId: number;
  proposedByName: string;
  reason: string | null;
  createdAt: string;
  status: string;
  fields: { secretKey: boolean; publishableKey: boolean; webhookSecret: boolean };
  proposedPublishablePreview: string | null;
  proposedSecretLast4: string | null;
  proposedWebhookSecretLast4: string | null;
  boardApprovals: StripeBoardApproval[];
  approvalsCount: number;
  rejectionsCount: number;
  boardMemberCount: number;
};
type StripeStatus = {
  configured: boolean;
  secretKeyLast4: string | null;
  publishableKeyPreview: string | null;
  webhookSecretConfigured: boolean;
  lastUpdatedAt: string | null;
  lastUpdatedByName: string | null;
  boardMembers: StripeBoardMember[];
  pendingRequest: StripePendingRequest | null;
  latestRequest: StripePendingRequest | null;
};

function StripeKeysCard() {
  const { user } = useAuth();
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [status, setStatus] = useState<StripeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [secretKey, setSecretKey] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const res = await fetch(`${base}/api/settings/stripe`, { credentials: "include" });
      if (res.ok) setStatus((await res.json()) as StripeStatus);
    } catch {/* ignore */}
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function submitProposal() {
    setError(null); setInfo(null);
    if (!secretKey && !publishableKey && !webhookSecret) {
      setError("Provide at least one key to change.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${base}/api/settings/stripe/requests`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secretKey: secretKey || undefined,
          publishableKey: publishableKey || undefined,
          webhookSecret: webhookSecret || undefined,
          reason: reason || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(data.error ?? "Could not submit"); return; }
      setSecretKey(""); setPublishableKey(""); setWebhookSecret(""); setReason("");
      setShowForm(false);
      setInfo("Proposal submitted. Waiting on board approval.");
      await reload();
    } finally { setSubmitting(false); }
  }

  async function decide(requestId: number, decision: "approve" | "reject") {
    setError(null); setInfo(null);
    const res = await fetch(`${base}/api/settings/stripe/requests/${requestId}/decisions`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; applied?: boolean };
    if (!res.ok) { setError(data.error ?? "Could not record vote"); return; }
    if (data.applied) setInfo("All board members approved — keys applied.");
    else if (decision === "reject") setInfo("Request rejected.");
    else setInfo("Vote recorded. Waiting on the remaining board members.");
    await reload();
  }

  async function cancel(requestId: number) {
    const res = await fetch(`${base}/api/settings/stripe/requests/${requestId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) { setInfo("Proposal cancelled."); await reload(); }
  }

  if (loading || !status) {
    return <div className="text-[13px]" style={{ color: c.inkMute }}>Loading Stripe key status…</div>;
  }

  const pending = status.pendingRequest;
  const isOnBoard = !!user && status.boardMembers.some((m) => m.id === user.id);
  const myDecision = pending?.boardApprovals.find((a) => a.userId === user?.id)?.decision ?? null;
  const isProposer = !!pending && !!user && pending.proposedByUserId === user.id;

  return (
    <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
      <div className="flex items-start justify-between gap-4 mb-1">
        <h3 className="text-[16px]" style={{ fontWeight: 700 }}>Stripe API Keys</h3>
        <span
          className="text-[11.5px] px-2 py-0.5 rounded-full"
          style={{
            background: status.configured ? "#DCF3EC" : "#FBE3E9",
            color: status.configured ? "#0E8A6B" : "#B8264C",
            fontWeight: 600,
          }}
        >
          {status.configured ? "Connected" : "Not connected"}
        </span>
      </div>
      <p className="text-[13px] mb-4" style={{ color: c.inkMute, fontWeight: 500 }}>
        Stripe credentials power online payments and webhooks. Any change must be approved by <strong>every user flagged as a board member</strong> (regardless of role) before it takes effect — no server restart required. Admins manage the board roster from the members list.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <KeyTile label="Secret key" value={status.configured ? "Configured" : "Not set"} ok={status.configured} />
        <KeyTile label="Publishable key" value={status.publishableKeyPreview ?? "Not set"} ok={!!status.publishableKeyPreview} />
        <KeyTile label="Webhook secret" value={status.webhookSecretConfigured ? "Configured" : "Not set"} ok={status.webhookSecretConfigured} />
      </div>
      {status.lastUpdatedAt && (
        <div className="text-[12px] mb-4" style={{ color: c.inkMute }}>
          Last updated {new Date(status.lastUpdatedAt).toLocaleString()} by {status.lastUpdatedByName ?? "unknown"}.
        </div>
      )}

      <div className="mb-4 rounded-lg border p-3" style={{ borderColor: c.borderSoft, background: "#FAFAFB" }}>
        <div className="text-[12px] mb-1.5" style={{ color: c.inkMute, fontWeight: 600 }}>
          Board voter roster ({status.boardMembers.length})
        </div>
        {status.boardMembers.length === 0 ? (
          <div className="text-[12.5px]" style={{ color: c.inkMute }}>No users are currently flagged as board members.</div>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {status.boardMembers.map((m) => (
              <li key={m.id} className="rounded-md border px-2 py-0.5 text-[12px]" style={{ borderColor: c.border, color: c.inkSoft }}>
                {m.name} <span style={{ color: c.inkMute }}>· {m.role}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <div className="mb-3 text-[12.5px] rounded-md px-3 py-2" style={{ background: "#FBE3E9", color: "#B8264C" }}>{error}</div>}
      {info && <div className="mb-3 text-[12.5px] rounded-md px-3 py-2" style={{ background: "#E5E8FF", color: "#3245FF" }}>{info}</div>}

      {pending ? (
        <div className="rounded-lg border p-4" style={{ borderColor: c.borderSoft, background: "#FAFAFB" }}>
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <div className="text-[13.5px]" style={{ fontWeight: 700 }}>
                Pending key change — proposed by {pending.proposedByName}
              </div>
              <div className="text-[12px]" style={{ color: c.inkMute }}>
                {new Date(pending.createdAt).toLocaleString()} ·{" "}
                {pending.approvalsCount}/{pending.boardMemberCount} approved
                {pending.rejectionsCount > 0 ? ` · ${pending.rejectionsCount} rejected` : ""}
              </div>
            </div>
            {(isProposer || user?.role === "admin") && (
              <button
                onClick={() => cancel(pending.id)}
                className="text-[12px] underline"
                style={{ color: c.inkMute }}
              >
                Cancel proposal
              </button>
            )}
          </div>
          {pending.reason && (
            <div className="text-[12.5px] mb-3" style={{ color: c.ink }}><em>"{pending.reason}"</em></div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
            <ProposedField label="Secret key" present={pending.fields.secretKey} value={pending.proposedSecretLast4 ?? "(unchanged)"} />
            <ProposedField label="Publishable key" present={pending.fields.publishableKey} value={pending.proposedPublishablePreview ?? "(unchanged)"} />
            <ProposedField label="Webhook secret" present={pending.fields.webhookSecret} value={pending.proposedWebhookSecretLast4 ?? "(unchanged)"} />
          </div>
          <div className="rounded-md border bg-white p-3 mb-3" style={{ borderColor: c.borderSoft }}>
            <div className="text-[12px] mb-2" style={{ color: c.inkMute, fontWeight: 600 }}>BOARD APPROVAL</div>
            <ul className="space-y-1.5">
              {pending.boardApprovals.map((m) => (
                <li key={m.userId} className="flex items-center justify-between text-[12.5px]">
                  <span>
                    {m.name} <span style={{ color: c.inkMute }}>· {m.role}</span>
                  </span>
                  <span
                    className="text-[11.5px] px-2 py-0.5 rounded-full"
                    style={{
                      background: m.decision === "approve" ? "#DCF3EC" : m.decision === "reject" ? "#FBE3E9" : "#EFF1F8",
                      color: m.decision === "approve" ? "#0E8A6B" : m.decision === "reject" ? "#B8264C" : "#5B6478",
                      fontWeight: 600,
                    }}
                  >
                    {m.decision === "approve" ? "Approved" : m.decision === "reject" ? "Rejected" : "Pending"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {isOnBoard && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => decide(pending.id, "approve")}
                disabled={myDecision === "approve"}
                className="px-3 py-1.5 rounded-md text-[12.5px] disabled:opacity-50"
                style={{ background: "#0E8A6B", color: "#fff", fontWeight: 600 }}
              >
                {myDecision === "approve" ? "You approved" : "Approve"}
              </button>
              <button
                onClick={() => decide(pending.id, "reject")}
                disabled={myDecision === "reject"}
                className="px-3 py-1.5 rounded-md text-[12.5px] disabled:opacity-50"
                style={{ background: "#B8264C", color: "#fff", fontWeight: 600 }}
              >
                {myDecision === "reject" ? "You rejected" : "Reject"}
              </button>
              {myDecision && (
                <span className="text-[12px]" style={{ color: c.inkMute }}>
                  You can change your vote until the proposal is resolved.
                </span>
              )}
            </div>
          )}
          {!isOnBoard && (
            <div className="text-[12px]" style={{ color: c.inkMute }}>
              Only board members may vote on this proposal.
            </div>
          )}
        </div>
      ) : (
        <>
          {!showForm && (user?.role === "admin" || user?.role === "manager") && (
            <button
              onClick={() => setShowForm(true)}
              className="px-3 py-2 rounded-md text-[13px]"
              style={{ background: "#3245FF", color: "#fff", fontWeight: 600 }}
            >
              {status.configured ? "Propose key change" : "Connect Stripe"}
            </button>
          )}
          {showForm && (
            <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: c.borderSoft, background: "#FAFAFB" }}>
              <div className="text-[12.5px]" style={{ color: c.inkMute }}>
                Leave a field blank to leave that key unchanged. Once submitted, all {status.boardMembers.length} user{status.boardMembers.length === 1 ? "" : "s"} flagged as board {status.boardMembers.length === 1 ? "member" : "members"} must approve before the change is applied.
              </div>
              <Field label="Secret key (sk_test_… or sk_live_…)">
                <input
                  type="password"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  placeholder="sk_live_…"
                  className="w-full rounded-md border px-3 py-2 text-[13.5px] font-mono"
                  style={{ borderColor: c.border }}
                />
              </Field>
              <Field label="Publishable key (pk_test_… or pk_live_…)">
                <input
                  type="text"
                  value={publishableKey}
                  onChange={(e) => setPublishableKey(e.target.value)}
                  placeholder="pk_live_…"
                  className="w-full rounded-md border px-3 py-2 text-[13.5px] font-mono"
                  style={{ borderColor: c.border }}
                />
              </Field>
              <Field label="Webhook signing secret (whsec_…)">
                <input
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder="whsec_…"
                  className="w-full rounded-md border px-3 py-2 text-[13.5px] font-mono"
                  style={{ borderColor: c.border }}
                />
              </Field>
              <Field label="Reason for change (shown to board members)">
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border px-3 py-2 text-[13.5px]"
                  style={{ borderColor: c.border }}
                />
              </Field>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => { setShowForm(false); setError(null); }}
                  className="px-3 py-1.5 rounded-md text-[12.5px]"
                  style={{ color: c.ink, fontWeight: 600 }}
                >
                  Cancel
                </button>
                <button
                  onClick={submitProposal}
                  disabled={submitting}
                  className="px-3 py-1.5 rounded-md text-[12.5px] disabled:opacity-50"
                  style={{ background: "#3245FF", color: "#fff", fontWeight: 600 }}
                >
                  {submitting ? "Submitting…" : "Submit for board approval"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function KeyTile({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: c.borderSoft }}>
      <div className="text-[11.5px]" style={{ color: c.inkMute, fontWeight: 600 }}>{label.toUpperCase()}</div>
      <div className="text-[13px] mt-1 font-mono" style={{ color: ok ? c.ink : "#B8264C", fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
}

function ProposedField({ label, present, value }: { label: string; present: boolean; value: string }) {
  return (
    <div className="rounded-md border p-2 bg-white" style={{ borderColor: c.borderSoft }}>
      <div className="text-[11px]" style={{ color: c.inkMute, fontWeight: 600 }}>{label.toUpperCase()}</div>
      <div className="text-[12.5px] mt-0.5 font-mono" style={{ color: present ? c.ink : c.inkMute, fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
}

function PaymentsSettingsSection() {
  const { data: settings, isLoading } = useGetSettings();
  const update = useUpdateSettings();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [surchargeEnabled, setSurchargeEnabled] = useState(false);
  const [surchargePct, setSurchargePct] = useState("0.00");
  const [autoPayLag, setAutoPayLag] = useState(3);
  const [pastDueThreshold, setPastDueThreshold] = useState(60);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    if (settings) {
      setEnabled(!!settings.paymentsEnabled);
      setSurchargeEnabled(!!settings.paymentsSurchargeEnabled);
      setSurchargePct(((settings.paymentsSurchargePercentBp ?? 0) / 100).toFixed(2));
      setAutoPayLag(settings.paymentsAutoPayLagDays ?? 3);
      const s = settings as unknown as { pastDueVotingThresholdDays?: number };
      setPastDueThreshold(s.pastDueVotingThresholdDays ?? 60);
    }
  }, [settings]);

  async function save() {
    setSaveState("saving");
    try {
      const pct = Math.max(0, Math.round(parseFloat(surchargePct || "0") * 100));
      await update.mutateAsync({
        data: {
          paymentsEnabled: enabled,
          paymentsSurchargeEnabled: surchargeEnabled,
          paymentsSurchargePercentBp: pct,
          paymentsAutoPayLagDays: autoPayLag,
          pastDueVotingThresholdDays: pastDueThreshold,
        } as Parameters<typeof update.mutateAsync>[0]["data"],
      });
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch {
      setSaveState("error");
    }
  }

  if (isLoading) return <div className="text-[13px]" style={{ color: c.inkMute }}>Loading…</div>;

  return (
    <>
    <StripeKeysCard />
    <section className="rounded-xl border bg-white p-6 mt-5" style={{ borderColor: c.border }}>
      <h3 className="text-[16px] mb-1" style={{ fontWeight: 700 }}>Online Payments (Stripe)</h3>
      <p className="text-[13px] mb-5" style={{ color: c.inkMute, fontWeight: 500 }}>
        Allow owners to pay assessments online via card or bank transfer (ACH). Requires Stripe API keys configured on the server.
      </p>
      <div className="space-y-4">
        <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-slate-50" style={{ borderColor: c.borderSoft }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-0.5 accent-blue-600" />
          <div>
            <div className="text-[13.5px]" style={{ fontWeight: 600 }}>Enable online payments</div>
            <div className="text-[12.5px] mt-0.5" style={{ color: c.inkMute, fontWeight: 500 }}>
              When enabled, owners see a "Pay Now" button on their account page.
            </div>
          </div>
        </label>

        <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-slate-50" style={{ borderColor: c.borderSoft }}>
          <input type="checkbox" checked={surchargeEnabled} onChange={(e) => setSurchargeEnabled(e.target.checked)} className="mt-0.5 accent-blue-600" />
          <div className="flex-1">
            <div className="text-[13.5px]" style={{ fontWeight: 600 }}>Pass card-processing surcharge to owners</div>
            <div className="text-[12.5px] mt-0.5" style={{ color: c.inkMute, fontWeight: 500 }}>
              The owner is shown a surcharge on top of the amount due. Disabled by default.
            </div>
          </div>
        </label>

        <Field label="Surcharge percentage (e.g. 2.90 for 2.9%)">
          <input
            type="text"
            value={surchargePct}
            onChange={(e) => setSurchargePct(e.target.value)}
            disabled={!surchargeEnabled}
            className="w-40 rounded-md border px-3 py-2 text-[13.5px] disabled:opacity-50"
            style={{ borderColor: c.border }}
          />
        </Field>

        <Field label="Auto-pay charge lag (days after charge date)">
          <input
            type="number"
            min={0}
            value={autoPayLag}
            onChange={(e) => setAutoPayLag(Math.max(0, parseInt(e.target.value || "0", 10)))}
            className="w-40 rounded-md border px-3 py-2 text-[13.5px]"
            style={{ borderColor: c.border }}
          />
        </Field>

        <Field label="Past-due voting suspension threshold (days)">
          <input
            type="number"
            min={0}
            value={pastDueThreshold}
            onChange={(e) => setPastDueThreshold(Math.max(0, parseInt(e.target.value || "0", 10)))}
            className="w-40 rounded-md border px-3 py-2 text-[13.5px]"
            style={{ borderColor: c.border }}
            data-testid="settings-past-due-threshold"
          />
          <div className="text-[11.5px] mt-1" style={{ color: c.inkMute }}>
            Owners whose oldest unpaid charge is older than this many days have
            their voting rights suspended automatically (Texas HOA convention; default 60).
          </div>
        </Field>

        <div className="pt-2 flex items-center justify-end gap-3">
          {saveState === "error" && <span className="text-[12.5px]" style={{ color: "#B8264C" }}>Failed to save. Please try again.</span>}
          <SaveButton state={saveState} onClick={save} />
        </div>
      </div>
    </section>
    </>
  );
}
function NoticeQuorumSection() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [loading, setLoading] = useState(true);
  const [noticeOpenDays, setNoticeOpenDays] = useState(3);
  const [noticeExecutiveDays, setNoticeExecutiveDays] = useState(2);
  const [noticeAnnualDays, setNoticeAnnualDays] = useState(30);
  const [quorumMode, setQuorumMode] = useState<"majority" | "percent" | "all">("majority");
  const [quorumPercent, setQuorumPercent] = useState(50);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${base}/api/settings/governance`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        return r.json() as Promise<{ noticeOpenDays: number; noticeExecutiveDays: number; noticeAnnualDays: number; quorumMode: "majority" | "percent" | "all"; quorumPercentBp: number }>;
      })
      .then((d) => {
        setNoticeOpenDays(d.noticeOpenDays);
        setNoticeExecutiveDays(d.noticeExecutiveDays);
        setNoticeAnnualDays(d.noticeAnnualDays);
        setQuorumMode(d.quorumMode);
        setQuorumPercent(Math.round((d.quorumPercentBp ?? 5000) / 100));
      })
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : "Failed to load governance settings");
      })
      .finally(() => setLoading(false));
  }, [base]);

  async function save() {
    setSaveState("saving");
    setErrorMsg(null);
    try {
      const body = {
        noticeOpenDays,
        noticeExecutiveDays,
        noticeAnnualDays,
        quorumMode,
        quorumPercentBp: Math.max(0, Math.min(10000, Math.round(quorumPercent * 100))),
      };
      const res = await fetch(`${base}/api/settings/governance`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let msg = "Save failed";
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
        throw new Error(msg);
      }
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Save failed");
      setSaveState("error");
    }
  }

  if (loading) return <div className="text-[13px]" style={{ color: c.inkMute }}>Loading…</div>;

  return (
    <>
      <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
        <h3 className="text-[16px] mb-1" style={{ fontWeight: 700 }}>Meeting Notice & Quorum</h3>
        <p className="text-[13px] mb-5" style={{ color: c.inkMute, fontWeight: 500 }}>
          Minimum advance-notice days for each meeting kind, and how the required quorum is computed from the board roster.
        </p>
        {loadError && (
          <div className="mb-4 rounded-md border px-3 py-2 text-[12.5px]" style={{ borderColor: "#F4C7CF", background: "#FBE3E9", color: "#B8264C" }}>
            Couldn't load current settings ({loadError}). The values shown below are defaults — saving will overwrite stored values.
          </div>
        )}
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Open meeting notice (days)">
              <input
                type="number" min={0} value={noticeOpenDays}
                onChange={(e) => setNoticeOpenDays(Math.max(0, parseInt(e.target.value || "0", 10)))}
                className="w-full rounded-md border px-3 py-2 text-[13.5px]"
                style={{ borderColor: c.border, color: c.ink }} />
            </Field>
            <Field label="Executive meeting notice (days)">
              <input
                type="number" min={0} value={noticeExecutiveDays}
                onChange={(e) => setNoticeExecutiveDays(Math.max(0, parseInt(e.target.value || "0", 10)))}
                className="w-full rounded-md border px-3 py-2 text-[13.5px]"
                style={{ borderColor: c.border, color: c.ink }} />
            </Field>
            <Field label="Annual meeting notice (days)">
              <input
                type="number" min={0} value={noticeAnnualDays}
                onChange={(e) => setNoticeAnnualDays(Math.max(0, parseInt(e.target.value || "0", 10)))}
                className="w-full rounded-md border px-3 py-2 text-[13.5px]"
                style={{ borderColor: c.border, color: c.ink }} />
            </Field>
          </div>

          <Field label="Quorum mode">
            <select value={quorumMode} onChange={(e) => setQuorumMode(e.target.value as "majority" | "percent" | "all")}
              className="w-full rounded-md border px-3 py-2 text-[13.5px] bg-white"
              style={{ borderColor: c.border, color: c.ink }}>
              <option value="majority">Majority of board members</option>
              <option value="percent">Percentage of board members</option>
              <option value="all">All board members</option>
            </select>
          </Field>

          {quorumMode === "percent" && (
            <Field label="Quorum percent (%)">
              <input
                type="number" min={0} max={100} value={quorumPercent}
                onChange={(e) => setQuorumPercent(Math.max(0, Math.min(100, parseInt(e.target.value || "0", 10))))}
                className="w-40 rounded-md border px-3 py-2 text-[13.5px]"
                style={{ borderColor: c.border, color: c.ink }} />
              <div className="text-[11.5px] mt-1" style={{ color: c.inkMute }}>
                Quorum is met when this percentage of the board is present.
              </div>
            </Field>
          )}
        </div>
      </section>
      <div className="flex items-center justify-end gap-3">
        {saveState === "error" && (
          <span className="text-[12.5px]" style={{ color: "#B8264C" }}>{errorMsg ?? "Failed to save. Please try again."}</span>
        )}
        {saveState === "saved" && (
          <span className="text-[12.5px]" style={{ color: "#0E8A6B" }}>Saved.</span>
        )}
        <SaveButton state={saveState} onClick={save} />
      </div>
    </>
  );
}

// Task #64: Governance gates configuration. Lets the board set the
// expenditure threshold, list which org-settings keys are gated behind a
// policy_change motion, and toggle whether admins may issue emergency bypasses.
const GATEABLE_KEYS = [
  "bidMinQuotesThresholdCents",
  "bidDefaultSealed",
  "bidReminderDaysBefore",
  "accEnabled",
  "accQuorumMode",
  "accAutoApprovalDays",
  "paymentsEnabled",
  "paymentsSurchargeEnabled",
  "paymentsSurchargePercentBp",
  "paymentsAutoPayLagDays",
];

function GovernanceSection() {
  const { data: settings, isLoading } = useGetSettings();
  const update = useUpdateSettings();
  const queryClient = useQueryClient();
  const [thresholdDollars, setThresholdDollars] = useState("0");
  const [gated, setGated] = useState<string[]>([]);
  const [bypassEnabled, setBypassEnabled] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    if (settings) {
      const s = settings as unknown as { expenditureThresholdCents?: number; gatedPolicies?: string[]; emergencyBypassEnabled?: boolean };
      setThresholdDollars(((s.expenditureThresholdCents ?? 0) / 100).toFixed(2));
      setGated(s.gatedPolicies ?? []);
      setBypassEnabled(!!s.emergencyBypassEnabled);
    }
  }, [settings]);

  async function save() {
    setSaveState("saving");
    try {
      const cents = Math.max(0, Math.round(parseFloat(thresholdDollars || "0") * 100));
      await update.mutateAsync({
        data: {
          expenditureThresholdCents: cents,
          gatedPolicies: gated,
          emergencyBypassEnabled: bypassEnabled,
        } as never,
      });
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch {
      setSaveState("error");
    }
  }

  if (isLoading) return <div className="text-[13px]" style={{ color: c.inkMute }}>Loading…</div>;

  return (
    <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
      <h3 className="text-[16px] mb-1" style={{ fontWeight: 700 }}>Board Governance Gates</h3>
      <p className="text-[13px] mb-5" style={{ color: c.inkMute, fontWeight: 500 }}>
        Require a board-Adopted motion before sensitive actions (large expenditures, special assessments,
        gated policy edits) can be executed. Admins may issue an emergency bypass when enabled, which
        auto-creates a ratification motion.
      </p>
      <div className="space-y-4">
        <Field label="Expenditure threshold (motion required at or above)">
          <div className="flex items-center gap-1">
            <span style={{ color: c.inkMute }}>$</span>
            <input
              type="text"
              value={thresholdDollars}
              onChange={(e) => setThresholdDollars(e.target.value)}
              className="w-40 rounded-md border px-3 py-2 text-[13.5px]"
              style={{ borderColor: c.border }}
            />
          </div>
        </Field>

        <div>
          <div className="text-[12.5px] mb-2" style={{ color: c.inkSoft, fontWeight: 600 }}>Gated policy keys</div>
          <div className="grid grid-cols-2 gap-2">
            {GATEABLE_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-[12.5px]">
                <input
                  type="checkbox"
                  checked={gated.includes(k)}
                  onChange={(e) => setGated(e.target.checked ? [...gated, k] : gated.filter((x) => x !== k))}
                />
                <code>{k}</code>
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-slate-50" style={{ borderColor: c.borderSoft }}>
          <input type="checkbox" checked={bypassEnabled} onChange={(e) => setBypassEnabled(e.target.checked)} className="mt-0.5 accent-blue-600" />
          <div>
            <div className="text-[13.5px]" style={{ fontWeight: 600 }}>Allow emergency bypass</div>
            <div className="text-[12.5px] mt-0.5" style={{ color: c.inkMute, fontWeight: 500 }}>
              Admins may bypass a gate in an emergency. A ratification motion is auto-created.
            </div>
          </div>
        </label>

        <div className="pt-2 flex items-center justify-end gap-3">
          {saveState === "error" && <span className="text-[12.5px]" style={{ color: "#B8264C" }}>Failed to save. Please try again.</span>}
          <SaveButton state={saveState} onClick={save} />
        </div>
      </div>
    </section>
  );
}

function AccSection() {
  const [enabled, setEnabled] = useState(true);
  const [quorumMode, setQuorumMode] = useState<"any" | "majority">("any");
  const [autoApprovalDays, setAutoApprovalDays] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  useEffect(() => {
    fetch(`${base}/api/settings/acc`, { credentials: "include" })
      .then((r) => r.json())
      .then((d: { enabled: boolean; quorumMode: "any" | "majority"; autoApprovalDays: number }) => {
        setEnabled(d.enabled);
        setQuorumMode(d.quorumMode);
        setAutoApprovalDays(d.autoApprovalDays);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [base]);

  async function save() {
    setSaveState("saving");
    try {
      const res = await fetch(`${base}/api/settings/acc`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, quorumMode, autoApprovalDays }),
      });
      if (!res.ok) throw new Error("save failed");
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch {
      setSaveState("error");
    }
  }

  if (loading) return <div className="text-[13px]" style={{ color: c.inkMute }}>Loading…</div>;

  return (
    <>
      <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
        <h3 className="text-[16px] mb-1" style={{ fontWeight: 700 }}>Architectural Change Requests</h3>
        <p className="text-[13px] mb-5" style={{ color: c.inkMute, fontWeight: 500 }}>
          Configure how owner change requests are reviewed by the board.
        </p>
        <div className="space-y-4">
          <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-slate-50" style={{ borderColor: c.borderSoft }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-0.5 accent-blue-600" />
            <div>
              <div className="text-[13.5px]" style={{ fontWeight: 600 }}>Allow residents to submit architectural requests</div>
              <div className="text-[12.5px] mt-0.5" style={{ color: c.inkMute, fontWeight: 500 }}>
                When disabled, the resident submission form is hidden and the API rejects new submissions.
              </div>
            </div>
          </label>

          <Field label="Quorum mode">
            <select value={quorumMode} onChange={(e) => setQuorumMode(e.target.value as "any" | "majority")}
              className="w-full rounded-md border px-3 py-2 text-[13.5px] bg-white"
              style={{ borderColor: c.border, color: c.ink }}>
              <option value="any">Any board member may decide</option>
              <option value="majority">Majority of cast votes required for final decision</option>
            </select>
          </Field>

          <Field label="Auto-approval threshold (days)">
            <input
              type="number" min={0} value={autoApprovalDays}
              onChange={(e) => setAutoApprovalDays(Math.max(0, parseInt(e.target.value || "0", 10)))}
              className="w-full rounded-md border px-3 py-2 text-[13.5px]"
              style={{ borderColor: c.border, color: c.ink }} />
            <div className="text-[11.5px] mt-1" style={{ color: c.inkMute }}>
              When &gt; 0, pending requests older than this many days are <strong>flagged for board review</strong> (managers receive a notification). Requests are never auto-decided silently.
            </div>
          </Field>
        </div>
      </section>
      <div className="flex items-center justify-end gap-3">
        {saveState === "error" && <span className="text-[12.5px]" style={{ color: "#B8264C" }}>Failed to save. Please try again.</span>}
        <SaveButton state={saveState} onClick={save} />
      </div>
    </>
  );
}


function CalendarResourcesSection() {
  const qc = useQueryClient();
  const { data: resources = [] } = useListCalendarResources();
  const create = useCreateCalendarResource();
  const update = useUpdateCalendarResource();
  const remove = useDeleteCalendarResource();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState("");
  const [error, setError] = useState<string | null>(null);

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListCalendarResourcesQueryKey() });
  }

  async function add() {
    setError(null);
    if (!name.trim()) return;
    const cap = capacity.trim() === "" ? null : Math.max(0, parseInt(capacity, 10) || 0);
    try {
      await create.mutateAsync({ data: { name: name.trim(), description, capacity: cap, sortOrder: resources.length, active: true } });
      setName(""); setDescription(""); setCapacity("");
      invalidate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const m = msg.match(/"error":"([^"]+)"/);
      setError(m?.[1] ?? "Failed to add resource.");
    }
  }

  async function toggleActive(id: number, active: boolean) {
    await update.mutateAsync({ id, data: { active: !active } });
    invalidate();
  }

  async function rename(id: number, current: string) {
    const next = prompt("Resource name", current);
    if (next === null || next.trim() === "" || next === current) return;
    await update.mutateAsync({ id, data: { name: next.trim() } });
    invalidate();
  }

  async function setCap(id: number, current: number | null) {
    const next = prompt("Capacity (blank for unlimited)", current == null ? "" : String(current));
    if (next === null) return;
    const cap = next.trim() === "" ? null : Math.max(0, parseInt(next, 10) || 0);
    await update.mutateAsync({ id, data: { capacity: cap } });
    invalidate();
  }

  async function deleteResource(id: number, n: string) {
    if (!confirm(`Delete resource "${n}"? Existing events that reference it will be cleared.`)) return;
    await remove.mutateAsync({ id });
    invalidate();
  }

  return (
    <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
      <h3 className="text-[16px] mb-1" style={{ fontWeight: 700 }}>Bookable resources</h3>
      <p className="text-[13px] mb-5" style={{ color: c.inkMute, fontWeight: 500 }}>
        Configure clubhouse rooms, pool deck, grills, and other amenities residents and managers can book on the calendar.
        Conflict detection prevents double-booking the same resource for overlapping times.
      </p>

      <div className="rounded border mb-4 overflow-hidden" style={{ borderColor: c.border }}>
        <table className="w-full text-[13px]">
          <thead style={{ background: c.cobaltSoft }}>
            <tr>
              <th className="text-left px-3 py-2" style={{ color: c.inkSoft, fontWeight: 600 }}>Name</th>
              <th className="text-left px-3 py-2" style={{ color: c.inkSoft, fontWeight: 600 }}>Capacity</th>
              <th className="text-left px-3 py-2" style={{ color: c.inkSoft, fontWeight: 600 }}>Status</th>
              <th className="text-right px-3 py-2" style={{ color: c.inkSoft, fontWeight: 600 }}></th>
            </tr>
          </thead>
          <tbody>
            {resources.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-4 text-center" style={{ color: c.inkMute }}>No bookable resources yet.</td></tr>
            )}
            {resources.map((r) => (
              <tr key={r.id} className="border-t" style={{ borderColor: c.border }}>
                <td className="px-3 py-2">
                  <button onClick={() => rename(r.id, r.name)} className="text-left" style={{ color: c.ink, fontWeight: 600 }}>
                    {r.name}
                  </button>
                  {r.description && <div className="text-[11.5px]" style={{ color: c.inkMute }}>{r.description}</div>}
                </td>
                <td className="px-3 py-2">
                  <button onClick={() => setCap(r.id, r.capacity ?? null)} style={{ color: c.cobalt }}>
                    {r.capacity == null ? "—" : r.capacity}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <button onClick={() => toggleActive(r.id, r.active)}
                    className="rounded px-2 py-0.5 text-[11.5px]"
                    style={{
                      background: r.active ? "#ECFDF3" : "#F2F4F7",
                      color: r.active ? "#067647" : c.inkMute,
                      fontWeight: 600,
                    }}>
                    {r.active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => deleteResource(r.id, r.name)} className="text-[12px]" style={{ color: "#B42318", fontWeight: 600 }}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded border p-4" style={{ borderColor: c.border, background: "#FAFBFD" }}>
        <div className="text-[12px] uppercase tracking-wider mb-2" style={{ color: c.inkMute, fontWeight: 700 }}>Add resource</div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_120px_auto] gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Pavilion)"
            className="rounded border px-3 py-2 text-[13.5px]" style={{ borderColor: c.border }} />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)"
            className="rounded border px-3 py-2 text-[13.5px]" style={{ borderColor: c.border }} />
          <input type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Capacity"
            className="rounded border px-3 py-2 text-[13.5px]" style={{ borderColor: c.border }} />
          <button onClick={add} disabled={!name.trim()}
            className="rounded px-3 py-2 text-[13px]"
            style={{ background: c.cobalt, color: "#fff", fontWeight: 600, opacity: name.trim() ? 1 : 0.5 }}>
            Add
          </button>
        </div>
        {error && <div className="mt-2 text-[12px]" style={{ color: "#B42318" }}>{error}</div>}
      </div>
    </section>
  );
}

// ── Committees admin (Task #75) ──────────────────────────────────────────
type CommitteeRow = {
  id: number; slug: string; name: string; description: string;
  active: boolean; subCalendarId: number | null; createdAt: string;
};

function CommitteesSection() {
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [rows, setRows] = useState<CommitteeRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await fetch(`${BASE}/api/committees`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setRows(await r.json());
      setErr(null);
    } catch (e) { setErr(String(e)); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    if (!name.trim() || !slug.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`${BASE}/api/committees`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-"),
          description: description.trim(),
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      setName(""); setSlug(""); setDescription("");
      await load();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }
  async function toggleActive(row: CommitteeRow) {
    try {
      await fetch(`${BASE}/api/committees/${row.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !row.active }),
      });
      await load();
    } catch (e) { setErr(String(e)); }
  }

  return (
    <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
      <h3 className="text-[16px] mb-1" style={{ fontWeight: 700 }}>Committees</h3>
      <p className="text-[13px] mb-5" style={{ color: c.inkMute, fontWeight: 500 }}>
        Create committees (ACC, Landscaping, Pool, etc.). Each gets a calendar sub-feed so committee meetings, deadlines, and tasks roll up into the central calendar.
      </p>
      {err && <div className="text-[12.5px] mb-3" style={{ color: "#B8264C" }}>{err}</div>}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <label className="text-[12px]" style={{ color: c.inkSoft }}>
          Name
          <input className="mt-1 w-full rounded-md border px-3 py-2 text-[13.5px]" style={{ borderColor: c.border }}
            value={name} onChange={(e) => setName(e.target.value)} placeholder="Landscaping Committee" />
        </label>
        <label className="text-[12px]" style={{ color: c.inkSoft }}>
          Slug
          <input className="mt-1 w-full rounded-md border px-3 py-2 text-[13.5px]" style={{ borderColor: c.border }}
            value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="landscaping" />
        </label>
        <label className="text-[12px]" style={{ color: c.inkSoft }}>
          Description
          <input className="mt-1 w-full rounded-md border px-3 py-2 text-[13.5px]" style={{ borderColor: c.border }}
            value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        </label>
      </div>
      <div className="flex justify-end mb-5">
        <button disabled={busy || !name.trim() || !slug.trim()} onClick={create}
          className="px-4 py-2 rounded-md text-[13px]"
          style={{ background: c.cobalt, color: "white", opacity: busy || !name.trim() || !slug.trim() ? 0.5 : 1 }}>
          {busy ? "Creating…" : "Create committee"}
        </button>
      </div>
      <div className="rounded-lg border" style={{ borderColor: c.border }}>
        <table className="w-full text-[13px]">
          <thead style={{ background: "#F8FAFD" }}>
            <tr>
              <th className="text-left px-3 py-2" style={{ color: c.inkSoft, fontWeight: 600 }}>Name</th>
              <th className="text-left px-3 py-2" style={{ color: c.inkSoft, fontWeight: 600 }}>Slug</th>
              <th className="text-left px-3 py-2" style={{ color: c.inkSoft, fontWeight: 600 }}>Sub-calendar</th>
              <th className="text-left px-3 py-2" style={{ color: c.inkSoft, fontWeight: 600 }}>Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows == null ? (
              <tr><td colSpan={5} className="px-3 py-4 text-center" style={{ color: c.inkMute }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-4 text-center" style={{ color: c.inkMute }}>No committees yet.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.id} style={{ borderTop: `1px solid ${c.border}` }}>
                <td className="px-3 py-2" style={{ color: c.ink, fontWeight: 600 }}>{row.name}</td>
                <td className="px-3 py-2" style={{ color: c.inkSoft }}>{row.slug}</td>
                <td className="px-3 py-2" style={{ color: c.inkSoft }}>{row.subCalendarId ? `#${row.subCalendarId}` : <span style={{ color: c.inkMute }}>—</span>}</td>
                <td className="px-3 py-2" style={{ color: row.active ? "#1E8E3E" : c.inkMute }}>{row.active ? "Active" : "Archived"}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => toggleActive(row)} className="text-[12.5px] underline" style={{ color: c.cobalt }}>
                    {row.active ? "Archive" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── EV Chargers admin section (Task #86) ────────────────────────────────
function EvChargersSection() {
  return (
    <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
      <h3 className="text-[16px] mb-1" style={{ fontWeight: 700 }}>EV Chargers</h3>
      <p className="text-[13px] mb-5" style={{ color: c.inkMute, fontWeight: 500 }}>
        Add charging ports, set per-kWh and idle pricing, and review sessions.
      </p>
      <EvPortsManager />
      <div className="mt-8 border-t pt-6" style={{ borderColor: c.border }}>
        <EvSessionsAdmin />
      </div>
    </section>
  );
}

function EvPortsManager() {
  const queryClient = useQueryClient();
  const { data: ports = [], isLoading } = useQuery({
    queryKey: ["charging", "ports", "all"],
    queryFn: () => chargingApi.listPorts(),
  });
  const create = useMutation({
    mutationFn: (body: Partial<ChargingPort>) => chargingApi.createPort(body),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<ChargingPort> }) => chargingApi.updatePort(id, body),
  });
  const remove = useMutation({
    mutationFn: (id: number) => chargingApi.deletePort(id),
  });
  const [adding, setAdding] = useState(false);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["charging", "ports", "all"] });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[14px]" style={{ fontWeight: 700 }}>Ports</h4>
        <button
          onClick={() => setAdding(true)}
          className="text-[12.5px] rounded-md px-3 py-1.5 inline-flex items-center gap-1.5"
          style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
          data-testid="button-add-ev-port"
        >
          <Plus className="h-3.5 w-3.5" /> Add port
        </button>
      </div>
      {isLoading ? (
        <div className="text-[12.5px]" style={{ color: c.inkMute }}>Loading…</div>
      ) : ports.length === 0 && !adding ? (
        <div className="text-[12.5px]" style={{ color: c.inkMute }}>
          No ports yet. Add your first port to start offering EV charging.
        </div>
      ) : (
        <div className="space-y-2">
          {ports.map((p) => (
            <PortRow
              key={p.id}
              port={p}
              onSave={(patch) => update.mutateAsync({ id: p.id, body: patch }).then(invalidate)}
              onDelete={() => {
                if (!confirm("Delete this port?")) return;
                remove.mutateAsync(p.id).then(invalidate).catch((err: Error) => alert(err.message));
              }}
            />
          ))}
        </div>
      )}
      {adding && (
        <PortRow
          port={null}
          onSave={(patch) => create.mutateAsync(patch).then(() => { setAdding(false); invalidate(); })}
          onDelete={() => setAdding(false)}
        />
      )}
    </div>
  );
}

function PortRow({
  port, onSave, onDelete,
}: {
  port: ChargingPort | null;
  onSave: (patch: Partial<ChargingPort>) => Promise<unknown>;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(port == null);
  const initialCfg = (port?.providerConfig ?? {}) as Record<string, unknown>;
  const [form, setForm] = useState({
    name: port?.name ?? "",
    location: port?.location ?? "",
    connectorType: port?.connectorType ?? "J1772",
    maxKw: port?.maxKw ?? 7,
    mode: port?.mode ?? "reserved",
    provider: port?.provider ?? "manual",
    perKwhCents: port?.perKwhCents ?? 35,
    idlePerMinuteCents: port?.idlePerMinuteCents ?? 40,
    idleGraceMinutes: port?.idleGraceMinutes ?? 10,
    idleCapCents: port?.idleCapCents ?? 2000,
    noShowFeeCents: port?.noShowFeeCents ?? 0,
    noShowGraceMinutes: port?.noShowGraceMinutes ?? 15,
    enabled: port?.enabled ?? true,
    ocppEndpointUrl: typeof initialCfg.endpointUrl === "string" ? initialCfg.endpointUrl : "",
    ocppChargePointId: typeof initialCfg.chargePointId === "string" ? initialCfg.chargePointId : "",
    ocppUsername: typeof initialCfg.username === "string" ? initialCfg.username : "",
    // Server returns "********" when a password is set so the field can show
    // "saved" without leaking it. Treat that sentinel as "leave unchanged".
    ocppPassword: "",
    ocppPasswordSet: initialCfg.passwordSet === true,
    ocppConnectorId: typeof initialCfg.connectorId === "number" ? initialCfg.connectorId
      : typeof initialCfg.connectorId === "string" && initialCfg.connectorId ? Number(initialCfg.connectorId) : 1,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const {
        ocppEndpointUrl, ocppChargePointId, ocppUsername, ocppPassword,
        ocppConnectorId, ocppPasswordSet: _pwSet, ...rest
      } = form;
      void _pwSet;
      const patch: Partial<ChargingPort> = { ...rest };
      if (form.provider === "ocpp16") {
        const cfg: Record<string, string | number> = {
          endpointUrl: ocppEndpointUrl.trim(),
          chargePointId: ocppChargePointId.trim(),
          connectorId: Number.isFinite(ocppConnectorId) && ocppConnectorId > 0 ? Math.floor(ocppConnectorId) : 1,
        };
        if (ocppUsername) cfg.username = ocppUsername;
        // Only send password if user typed a new one; empty string preserves
        // the existing stored secret on the server.
        if (ocppPassword) cfg.password = ocppPassword;
        patch.providerConfig = cfg;
      } else {
        patch.providerConfig = {};
      }
      await onSave(patch);
      if (port) setOpen(false);
    }
    catch (e) { setErr(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-md border p-3" style={{ borderColor: c.border }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[13px]" style={{ fontWeight: 600 }}>
            {port ? port.name : "New port"}
            {port && !port.enabled && <span className="ml-2 text-[11px]" style={{ color: c.inkMute }}>(disabled)</span>}
          </div>
          {port && (
            <div className="text-[11.5px]" style={{ color: c.inkMute }}>
              {port.connectorType} · {port.maxKw} kW · {port.mode} · ${(port.perKwhCents/100).toFixed(2)}/kWh
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {port && (
            <button onClick={() => setOpen((v) => !v)} className="text-[12.5px] rounded-md border px-2.5 py-1" style={{ borderColor: c.border }}>
              {open ? "Close" : "Edit"}
            </button>
          )}
          {port && (
            <button onClick={onDelete} className="text-[12.5px] rounded-md border px-2.5 py-1" style={{ borderColor: c.border, color: "#9A2542" }}>
              <Trash2 className="h-3.5 w-3.5 inline" />
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="grid grid-cols-3 gap-3 mt-3 text-[12.5px]">
          <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-md border px-2 py-1" style={{ borderColor: c.border }} /></Field>
          <Field label="Location"><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="w-full rounded-md border px-2 py-1" style={{ borderColor: c.border }} /></Field>
          <Field label="Connector">
            <select value={form.connectorType} onChange={(e) => setForm({ ...form, connectorType: e.target.value as typeof form.connectorType })} className="w-full rounded-md border px-2 py-1" style={{ borderColor: c.border }}>
              <option>J1772</option><option>CCS</option><option>NACS</option><option>CHAdeMO</option>
            </select>
          </Field>
          <Field label="Max kW"><input type="number" value={form.maxKw} onChange={(e) => setForm({ ...form, maxKw: Number(e.target.value) })} className="w-full rounded-md border px-2 py-1" style={{ borderColor: c.border }} /></Field>
          <Field label="Mode">
            <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as typeof form.mode })} className="w-full rounded-md border px-2 py-1" style={{ borderColor: c.border }}>
              <option value="reserved">Reservation only</option>
              <option value="fcfs">First-come-first-served</option>
              <option value="reserved_fcfs">Reservation + FCFS</option>
            </select>
          </Field>
          <Field label="Provider">
            <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as typeof form.provider })} className="w-full rounded-md border px-2 py-1" style={{ borderColor: c.border }}>
              <option value="manual">Manual readings</option>
              <option value="stub_http">Stub OCPP (simulated)</option>
              <option value="ocpp16">OCPP 1.6 (real charger)</option>
            </select>
          </Field>
          {form.provider === "ocpp16" && (
            <>
              <Field label="OCPP endpoint URL">
                <input value={form.ocppEndpointUrl}
                  onChange={(e) => setForm({ ...form, ocppEndpointUrl: e.target.value })}
                  placeholder="wss://csms.example.com/ocpp"
                  className="w-full rounded-md border px-2 py-1" style={{ borderColor: c.border }} />
              </Field>
              <Field label="Charge point ID">
                <input value={form.ocppChargePointId}
                  onChange={(e) => setForm({ ...form, ocppChargePointId: e.target.value })}
                  placeholder="CP-001"
                  className="w-full rounded-md border px-2 py-1" style={{ borderColor: c.border }} />
              </Field>
              <Field label="Connector #">
                <input type="number" min={1} value={form.ocppConnectorId}
                  onChange={(e) => setForm({ ...form, ocppConnectorId: Number(e.target.value) })}
                  className="w-full rounded-md border px-2 py-1" style={{ borderColor: c.border }} />
              </Field>
              <Field label="Username (optional)">
                <input value={form.ocppUsername}
                  onChange={(e) => setForm({ ...form, ocppUsername: e.target.value })}
                  className="w-full rounded-md border px-2 py-1" style={{ borderColor: c.border }} />
              </Field>
              <Field label={form.ocppPasswordSet ? "Password (saved — type to replace)" : "Password (optional)"}>
                <input type="password" value={form.ocppPassword}
                  onChange={(e) => setForm({ ...form, ocppPassword: e.target.value })}
                  placeholder={form.ocppPasswordSet ? "••••••••" : ""}
                  className="w-full rounded-md border px-2 py-1" style={{ borderColor: c.border }} />
              </Field>
            </>
          )}
          <Field label="Per kWh ¢"><input type="number" value={form.perKwhCents} onChange={(e) => setForm({ ...form, perKwhCents: Number(e.target.value) })} className="w-full rounded-md border px-2 py-1" style={{ borderColor: c.border }} /></Field>
          <Field label="Idle ¢/min"><input type="number" value={form.idlePerMinuteCents} onChange={(e) => setForm({ ...form, idlePerMinuteCents: Number(e.target.value) })} className="w-full rounded-md border px-2 py-1" style={{ borderColor: c.border }} /></Field>
          <Field label="Idle grace min"><input type="number" value={form.idleGraceMinutes} onChange={(e) => setForm({ ...form, idleGraceMinutes: Number(e.target.value) })} className="w-full rounded-md border px-2 py-1" style={{ borderColor: c.border }} /></Field>
          <Field label="Idle cap ¢"><input type="number" value={form.idleCapCents} onChange={(e) => setForm({ ...form, idleCapCents: Number(e.target.value) })} className="w-full rounded-md border px-2 py-1" style={{ borderColor: c.border }} /></Field>
          <Field label="No-show fee ¢"><input type="number" value={form.noShowFeeCents} onChange={(e) => setForm({ ...form, noShowFeeCents: Number(e.target.value) })} className="w-full rounded-md border px-2 py-1" style={{ borderColor: c.border }} /></Field>
          <Field label="No-show grace min"><input type="number" value={form.noShowGraceMinutes} onChange={(e) => setForm({ ...form, noShowGraceMinutes: Number(e.target.value) })} className="w-full rounded-md border px-2 py-1" style={{ borderColor: c.border }} /></Field>
          <label className="col-span-3 inline-flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            Enabled (visible to owners)
          </label>
          {err && <div className="col-span-3 text-[12px]" style={{ color: "#B42318" }}>{err}</div>}
          <div className="col-span-3 flex justify-end gap-2 mt-1">
            <button onClick={submit} disabled={busy}
              className="text-[12.5px] rounded-md px-3 py-1.5"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}>
              {busy ? "Saving…" : port ? "Save changes" : "Create port"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EvSessionsAdmin() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"active" | "billed" | "all">("active");
  const { data: sessions = [] } = useQuery({
    queryKey: ["charging", "sessions", tab],
    queryFn: () => chargingApi.listSessions(tab === "all" ? undefined : tab),
    refetchInterval: tab === "active" ? 15_000 : false,
  });
  const refundM = useMutation({
    mutationFn: ({ id, amountCents, reason }: { id: number; amountCents?: number; reason?: string }) =>
      chargingApi.refundSession(id, { amountCents, reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["charging", "sessions"] }),
  });
  const readingsM = useMutation({
    mutationFn: ({ id, kwh }: { id: number; kwh: number }) => chargingApi.manualReadings(id, { kwh }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["charging", "sessions"] }),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[14px]" style={{ fontWeight: 700 }}>Sessions</h4>
        <div className="inline-flex rounded-md border" style={{ borderColor: c.border }}>
          {(["active", "billed", "all"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className="text-[12px] px-2.5 py-1"
              style={tab === t ? { background: c.cobaltSoft, color: c.cobalt, fontWeight: 600 } : { color: c.inkSoft }}
              data-testid={`tab-ev-${t}`}
            >{t}</button>
          ))}
        </div>
      </div>
      {sessions.length === 0 ? (
        <div className="text-[12.5px]" style={{ color: c.inkMute }}>No sessions to display.</div>
      ) : (
        <div className="rounded-md border overflow-hidden" style={{ borderColor: c.border }}>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr style={{ color: c.inkMute, background: "#F8FAFC" }}>
                <th className="text-left px-3 py-2" style={{ fontWeight: 600 }}>#</th>
                <th className="text-left px-3 py-2" style={{ fontWeight: 600 }}>Started</th>
                <th className="text-right px-3 py-2" style={{ fontWeight: 600 }}>kWh</th>
                <th className="text-right px-3 py-2" style={{ fontWeight: 600 }}>Idle</th>
                <th className="text-right px-3 py-2" style={{ fontWeight: 600 }}>Total</th>
                <th className="text-left px-3 py-2" style={{ fontWeight: 600 }}>Status</th>
                <th className="text-right px-3 py-2" style={{ fontWeight: 600 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-t" style={{ borderColor: c.border }}>
                  <td className="px-3 py-2">{s.id}</td>
                  <td className="px-3 py-2">{new Date(s.startAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{Number(s.kwh).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{s.idleMinutes}m</td>
                  <td className="px-3 py-2 text-right">${(s.costCents/100).toFixed(2)}</td>
                  <td className="px-3 py-2">{s.status}</td>
                  <td className="px-3 py-2 text-right">
                    {s.status === "active" && (
                      <button
                        onClick={() => {
                          const v = prompt("Final kWh delivered (manual reading)?");
                          const n = v ? Number(v) : NaN;
                          if (Number.isFinite(n) && n >= 0) readingsM.mutate({ id: s.id, kwh: n });
                        }}
                        className="text-[11.5px] rounded-md border px-2 py-0.5 mr-1" style={{ borderColor: c.border }}
                      >Record</button>
                    )}
                    {s.status === "billed" && (
                      <button
                        onClick={() => {
                          const reason = prompt("Refund reason?") ?? "";
                          const v = prompt(`Refund amount in cents (max ${s.costCents})?`, String(s.costCents));
                          const n = v ? Number(v) : NaN;
                          if (Number.isFinite(n) && n > 0) refundM.mutate({ id: s.id, amountCents: n, reason });
                        }}
                        className="text-[11.5px] rounded-md border px-2 py-0.5" style={{ borderColor: c.border, color: "#9A2542" }}
                      >Refund</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MailRoomSettingsSection() {
  type Locker = { id: number; bankSlug: string; bay: string; size: string; outOfService: boolean; notes: string };
  const qc = useQueryClient();
  const { data: lockers = [] } = useQuery<Locker[]>({
    queryKey: ["/package-lockers"],
    queryFn: async () => {
      const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
      const r = await fetch(`${base}/api/package-lockers`);
      return r.json();
    },
  });
  const [bay, setBay] = useState(""); const [size, setSize] = useState("medium");
  const create = useMutation({
    mutationFn: async () => {
      const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
      const r = await fetch(`${base}/api/package-lockers`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ bay, size }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => { setBay(""); qc.invalidateQueries({ queryKey: ["/package-lockers"] }); },
  });
  const SIZES = ["letter", "small", "medium", "large", "oversized"];
  return (
    <div className="rounded-xl border p-5 space-y-3" style={{ background: c.panel, borderColor: c.border }}>
      <div>
        <h3 className="text-[14px] mb-1" style={{ fontWeight: 700 }}>Mail & Package Room</h3>
        <p className="text-[12.5px]" style={{ color: c.inkMute }}>
          Configure parcel locker bays. Aging thresholds (Stale 7 days, Return-to-Sender 30 days) are environment-tunable
          via <code>PACKAGE_STALE_DAYS</code> and <code>PACKAGE_RTS_DAYS</code>.
          Day-to-day operations live on the <a href={`${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/mail-room`}
          style={{ color: c.cobalt, fontWeight: 600 }}>Mail Room page</a>.
        </p>
      </div>
      <div className="flex items-end gap-2 text-[13px]">
        <label className="flex flex-col">
          <span className="text-[11.5px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 600 }}>Bay</span>
          <input value={bay} onChange={(e) => setBay(e.target.value)} className="rounded-md border px-2 py-1.5"
            style={{ borderColor: c.border, background: c.panel }} />
        </label>
        <label className="flex flex-col">
          <span className="text-[11.5px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 600 }}>Size</span>
          <select value={size} onChange={(e) => setSize(e.target.value)} className="rounded-md border px-2 py-1.5"
            style={{ borderColor: c.border, background: c.panel }}>
            {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button onClick={() => create.mutate()} disabled={!bay}
          className="rounded-md px-3 py-1.5" style={{ background: c.emerald, color: "#fff", fontWeight: 600 }}>
          Add bay
        </button>
      </div>
      <table className="w-full text-[13px]">
        <thead><tr><th className="text-left py-1">Bay</th><th className="text-left py-1">Size</th><th className="text-left py-1">Status</th></tr></thead>
        <tbody>
          {lockers.map((l) => (
            <tr key={l.id} style={{ borderTop: `1px solid ${c.border}` }}>
              <td className="py-1 font-mono">{l.bay}</td>
              <td className="py-1">{l.size}</td>
              <td className="py-1">{l.outOfService ? "Out of service" : "Available"}</td>
            </tr>
          ))}
          {lockers.length === 0 && <tr><td colSpan={3} className="py-2" style={{ color: c.inkMute }}>No lockers yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
