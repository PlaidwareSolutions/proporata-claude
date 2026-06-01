import { db } from "@workspace/db";
import {
  notificationsTable,
  usersTable,
  organizationSettingsTable,
  userNotificationPreferencesTable,
} from "@workspace/db/schema";
import { and, eq, ne } from "drizzle-orm";
import jwt from "jsonwebtoken";
import {
  sendEmail,
  buildWorkOrderEmail,
  buildInsuranceExpiryEmail,
  buildMeetingNoticeEmail,
  buildMinutesAdoptedEmail,
} from "./email.js";
import { logger } from "./logger.js";

export interface MeetingDocTokenClaims {
  scope: "meeting_doc";
  meetingId: number;
  doc: "agenda" | "minutes";
  userId: number;
}

function signMeetingDocToken(claims: MeetingDocTokenClaims, expiresInSeconds: number): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  return jwt.sign(claims, secret, { expiresIn: expiresInSeconds });
}

const DAY_SECONDS = 24 * 60 * 60;

export function verifyMeetingDocToken(token: string): MeetingDocTokenClaims | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const payload = jwt.verify(token, secret) as MeetingDocTokenClaims & { exp?: number };
    if (payload.scope !== "meeting_doc") return null;
    if (payload.doc !== "agenda" && payload.doc !== "minutes") return null;
    if (typeof payload.meetingId !== "number" || typeof payload.userId !== "number") return null;
    return {
      scope: payload.scope,
      meetingId: payload.meetingId,
      doc: payload.doc,
      userId: payload.userId,
    };
  } catch {
    return null;
  }
}

async function getOrgName(): Promise<string> {
  const [row] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  return row?.name ?? "HOA Hub";
}

async function getManagersAndAdmins() {
  const users = await db
    .select()
    .from(usersTable)
    .where(ne(usersTable.role, "resident"));
  return users.filter((u) => !u.pending);
}

async function userWantsEmail(userId: string, pref: "urgent" | "expiring"): Promise<boolean> {
  const [row] = await db
    .select()
    .from(userNotificationPreferencesTable)
    .where(eq(userNotificationPreferencesTable.userId, userId));
  if (!row) return true;
  return pref === "urgent" ? row.urgent !== 0 : row.expiring !== 0;
}

export async function createWorkOrderNotification(wo: {
  id: string;
  title: string;
  priority: string;
  building: number;
}) {
  if (wo.priority !== "urgent" && wo.priority !== "high") return;

  const now = new Date().toISOString();
  const type = wo.priority === "urgent" ? "wo_urgent" : "wo_high";
  const label = wo.priority === "urgent" ? "Urgent" : "High priority";
  const message = `${label} work order created: "${wo.title}" (Building ${wo.building})`;

  const managers = await getManagersAndAdmins();
  const orgName = await getOrgName();

  for (const user of managers) {
    await db.insert(notificationsTable).values({
      userId: user.id,
      type,
      message,
      entityType: "work_order",
      entityId: wo.id,
      read: false,
      createdAt: now,
    });

    const wantsEmail = await userWantsEmail(String(user.id), "urgent");
    if (wantsEmail && user.email) {
      const html = buildWorkOrderEmail({
        orgName,
        title: wo.title,
        priority: wo.priority,
        building: wo.building,
        id: wo.id,
      });
      await sendEmail(user.email, `${label} Work Order: ${wo.title}`, html);
    }
  }
}

export async function createWorkOrderStatusNotification(wo: {
  id: string;
  title: string;
  status: string;
  building: number;
  unit?: string | null;
}) {
  const now = new Date().toISOString();
  const statusLabel: Record<string, string> = {
    open: "Open",
    scheduled: "Scheduled",
    in_progress: "In Progress",
    done: "Done",
  };
  const label = statusLabel[wo.status] ?? wo.status;
  const managerMessage = `Work order "${wo.title}" (Building ${wo.building}) status changed to ${label}`;
  const residentMessage = `Your maintenance request "${wo.title}" is now ${label}`;

  const managers = await getManagersAndAdmins();

  for (const user of managers) {
    await db.insert(notificationsTable).values({
      userId: user.id,
      type: "wo_status",
      message: managerMessage,
      entityType: "work_order",
      entityId: wo.id,
      read: false,
      createdAt: now,
    });
  }

  // Task #29: also notify residents (owners + tenants) of the unit so they
  // see status changes for their own work orders in the bell and portal.
  if (wo.unit) {
    const residents = await db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.unitId, wo.unit), eq(usersTable.role, "resident")));
    for (const r of residents) {
      if (r.pending) continue;
      try {
        await db.insert(notificationsTable).values({
          userId: r.id,
          type: "wo_status",
          message: residentMessage,
          entityType: "work_order",
          entityId: wo.id,
          read: false,
          createdAt: now,
        });
      } catch (err) {
        logger.warn({ err, userId: r.id }, "wo_status resident notification insert failed");
      }
    }
  }
}

// ── Meeting notifications ─────────────────────────────────────────────────
//
// Email channel honors existing user notification preferences, matching the
// pattern used by calendarScheduler:
//   • announcementsEmail = 0 → no email at all
//   • weekly = 1            → suppress immediate email (digest preference)
//   • 10pm–7am America/Chicago quiet hours → suppress immediate email
// In-app notifications are always recorded so the user still sees the alert
// in the app regardless of the email channel decision.
function inQuietHours(now: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    hour12: false,
  });
  const hour = parseInt(fmt.format(now), 10);
  return hour >= 22 || hour < 7;
}

function publicBaseUrl(): string | null {
  const base =
    process.env.PUBLIC_APP_URL ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
  return base || null;
}

async function loadMembers() {
  const users = await db.select().from(usersTable);
  return users.filter((u) => !u.pending && !!u.email);
}

async function userPrefs(userId: string) {
  const [row] = await db
    .select()
    .from(userNotificationPreferencesTable)
    .where(eq(userNotificationPreferencesTable.userId, userId));
  return row;
}

// Audience for a meeting kind. Executive sessions are board-only — mirrors
// the iCal feed which already hides executive meetings from non-board users.
function isAudienceFor(kind: string, user: typeof usersTable.$inferSelect): boolean {
  if (kind === "executive") return !!user.boardMember;
  return true;
}

export async function notifyMeetingNotice(meeting: {
  id: number;
  title: string;
  kind: string;
  scheduledAt: string;
  locationPhysical: string | null;
  locationVideoLink: string | null;
  noticeText: string;
}): Promise<void> {
  const now = new Date();
  const quiet = inQuietHours(now);
  const orgName = await getOrgName();
  const base = publicBaseUrl();
  if (!base) {
    logger.warn(
      { meetingId: meeting.id },
      "PUBLIC_APP_URL/REPLIT_DEV_DOMAIN unset — emailed meeting links would be unusable; sending in-app only",
    );
  }
  const members = (await loadMembers()).filter((u) => isAudienceFor(meeting.kind, u));
  const whenLabel = new Date(meeting.scheduledAt).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "full",
    timeStyle: "short",
  });
  const location = meeting.locationPhysical || meeting.locationVideoLink || null;
  const subject = `[${orgName}] Meeting notice: ${meeting.title}`;

  for (const u of members) {
    try {
      await db.insert(notificationsTable).values({
        userId: u.id,
        type: "meeting_notice",
        message: `Meeting notice: "${meeting.title}" — ${whenLabel}`,
        entityType: "meeting",
        entityId: String(meeting.id),
        read: false,
        createdAt: now.toISOString(),
      });
    } catch (err) {
      logger.warn({ err, userId: u.id }, "meeting_notice in-app insert failed");
    }
    if (!base) continue; // can't build a usable email link → in-app only
    const prefs = await userPrefs(String(u.id));
    const wantsEmail = !prefs || prefs.announcementsEmail !== 0;
    if (!wantsEmail) continue;
    if (quiet) continue; // suppress immediate email during quiet hours
    if (prefs && prefs.weekly !== 0) continue; // user opted into weekly digest
    try {
      const token = signMeetingDocToken(
        { scope: "meeting_doc", meetingId: meeting.id, doc: "agenda", userId: u.id },
        30 * DAY_SECONDS,
      );
      const agendaPacketUrl = `${base}/api/meetings/${meeting.id}/agenda-packet.pdf?token=${encodeURIComponent(token)}`;
      const html = buildMeetingNoticeEmail({
        orgName,
        title: meeting.title,
        kind: meeting.kind,
        whenLabel,
        location,
        noticeText: meeting.noticeText,
        agendaPacketUrl,
      });
      await sendEmail(u.email, subject, html);
    } catch (err) {
      logger.warn({ err, userId: u.id }, "meeting_notice email failed");
    }
  }
}

export async function notifyMinutesAdopted(meeting: {
  id: number;
  title: string;
  kind: string;
  scheduledAt: string;
  adoptedAt: string;
}): Promise<void> {
  const now = new Date();
  const quiet = inQuietHours(now);
  const orgName = await getOrgName();
  const base = publicBaseUrl();
  if (!base) {
    logger.warn(
      { meetingId: meeting.id },
      "PUBLIC_APP_URL/REPLIT_DEV_DOMAIN unset — emailed minutes links would be unusable; sending in-app only",
    );
  }
  const members = (await loadMembers()).filter((u) => isAudienceFor(meeting.kind, u));
  const meetingDateLabel = new Date(meeting.scheduledAt).toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "long",
  });
  const adoptedAtLabel = new Date(meeting.adoptedAt).toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "long",
  });
  const subject = `[${orgName}] Minutes adopted: ${meeting.title}`;

  for (const u of members) {
    try {
      await db.insert(notificationsTable).values({
        userId: u.id,
        type: "minutes_adopted",
        message: `Minutes adopted: "${meeting.title}" (${meetingDateLabel})`,
        entityType: "meeting",
        entityId: String(meeting.id),
        read: false,
        createdAt: now.toISOString(),
      });
    } catch (err) {
      logger.warn({ err, userId: u.id }, "minutes_adopted in-app insert failed");
    }
    if (!base) continue;
    const prefs = await userPrefs(String(u.id));
    const wantsEmail = !prefs || prefs.announcementsEmail !== 0;
    if (!wantsEmail) continue;
    if (quiet) continue;
    if (prefs && prefs.weekly !== 0) continue;
    try {
      const token = signMeetingDocToken(
        { scope: "meeting_doc", meetingId: meeting.id, doc: "minutes", userId: u.id },
        180 * DAY_SECONDS,
      );
      const minutesUrl = `${base}/api/meetings/${meeting.id}/minutes.pdf?token=${encodeURIComponent(token)}`;
      const html = buildMinutesAdoptedEmail({
        orgName,
        title: meeting.title,
        meetingDateLabel,
        adoptedAtLabel,
        minutesUrl,
      });
      await sendEmail(u.email, subject, html);
    } catch (err) {
      logger.warn({ err, userId: u.id }, "minutes_adopted email failed");
    }
  }
}

export async function notifyGlossarySuggestion(s: {
  suggestionId: number;
  termTitle: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const message = `New glossary suggestion: ${s.termTitle}`;
  const managers = await getManagersAndAdmins();
  for (const user of managers) {
    try {
      await db.insert(notificationsTable).values({
        userId: user.id,
        type: "glossary_suggestion",
        message,
        entityType: "glossary_suggestion",
        entityId: String(s.suggestionId),
        read: false,
        createdAt: now,
      });
    } catch (err) {
      logger.warn({ err, userId: user.id }, "glossary_suggestion in-app insert failed");
    }
  }
}

export async function createInsuranceExpiryNotification(policy: {
  building: number;
  carrier: string;
  expires: string;
  daysLeft: number;
}) {
  const now = new Date().toISOString();
  const message = `Insurance for Building ${policy.building} (${policy.carrier}) expires in ${policy.daysLeft} day${policy.daysLeft === 1 ? "" : "s"}`;

  const managers = await getManagersAndAdmins();
  const orgName = await getOrgName();

  for (const user of managers) {
    await db.insert(notificationsTable).values({
      userId: user.id,
      type: "insurance_expiring",
      message,
      entityType: "insurance",
      entityId: String(policy.building),
      read: false,
      createdAt: now,
    });

    const wantsEmail = await userWantsEmail(String(user.id), "expiring");
    if (wantsEmail && user.email) {
      const html = buildInsuranceExpiryEmail({ orgName, ...policy });
      await sendEmail(user.email, `Insurance Expiring: Building ${policy.building}`, html);
    }
  }
}
