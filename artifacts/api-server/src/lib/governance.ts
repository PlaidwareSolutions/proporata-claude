// Task #66: Owner-facing governance transparency — shared helpers.
// Owner detection (resolves residents whose login email matches their unit's
// ownerEmail), notice publication, and notifications fan-out to owners on
// meeting-scheduled, agenda-published, minutes-adopted, and resolution-adopted.

import { db } from "@workspace/db";
import {
  usersTable,
  unitsTable,
  notificationsTable,
  noticesTable,
  organizationSettingsTable,
  meetingsTable,
  resolutionsTable,
  motionsTable,
  userNotificationPreferencesTable,
} from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { sendEmail, buildGovernanceEmail } from "./email.js";
import { logger } from "./logger.js";

export interface OwnerResident {
  userId: number;
  email: string;
  name: string;
  unitId: string;
}

/**
 * Resolve all residents who are unit owners of record. We match the user's
 * login email to the unit's ownerEmail (case-insensitive). Skips pending
 * users. Used to fan-out governance notifications to the right audience.
 */
export async function listOwnerResidents(): Promise<OwnerResident[]> {
  const users = await db
    .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, role: usersTable.role, pending: usersTable.pending })
    .from(usersTable)
    .where(and(eq(usersTable.role, "resident"), eq(usersTable.pending, false)));
  if (users.length === 0) return [];
  const units = await db.select({ id: unitsTable.id, ownerEmail: unitsTable.ownerEmail }).from(unitsTable);
  const out: OwnerResident[] = [];
  for (const u of users) {
    const me = u.email.trim().toLowerCase();
    const unit = units.find((un) => (un.ownerEmail ?? "").trim().toLowerCase() === me);
    if (unit) out.push({ userId: u.id, email: u.email, name: u.name || u.email, unitId: unit.id });
  }
  return out;
}

/** True if the given user's email matches a unit's ownerEmail. */
export async function userIsOwner(userId: number): Promise<{ isOwner: boolean; unitId: string | null }> {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!u) return { isOwner: false, unitId: null };
  const me = u.email.trim().toLowerCase();
  const [unit] = await db
    .select({ id: unitsTable.id })
    .from(unitsTable)
    .where(sql`LOWER(TRIM(${unitsTable.ownerEmail})) = ${me}`);
  return { isOwner: !!unit, unitId: unit?.id ?? null };
}

async function getOrgName(): Promise<string> {
  const [row] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  return row?.name?.trim() || "HOA";
}

/**
 * Insert a notice row (idempotent on (kind, sourceType, sourceId)). Used so
 * the owner Notices tab is auto-populated when a meeting is scheduled, an
 * agenda is published, minutes are adopted, or a resolution is adopted.
 */
export type NoticeKind =
  | "meeting_scheduled"
  | "agenda_published"
  | "minutes_adopted"
  | "resolution_adopted"
  // Task #78: extended notice kinds for the owner Notices feed
  | "annual_meeting"
  | "dues_change"
  | "special_assessment"
  | "rule_change"
  | "acc_rule_change"
  | "acc_application_pending";

export async function publishNotice(opts: {
  kind: NoticeKind;
  title: string;
  body?: string;
  sourceType: "meeting" | "resolution" | "rule" | "acc_request" | "assessment_change";
  sourceId: number;
  meetingId?: number | null;
  requiredWindowDays?: number | null;
  postedAt?: string;
}): Promise<void> {
  const postedAt = opts.postedAt ?? new Date().toISOString();
  try {
    await db.insert(noticesTable).values({
      kind: opts.kind,
      title: opts.title,
      body: opts.body ?? "",
      sourceType: opts.sourceType,
      sourceId: opts.sourceId,
      meetingId: opts.meetingId ?? null,
      postedAt,
      requiredWindowDays: opts.requiredWindowDays ?? null,
    }).onConflictDoNothing();
  } catch (err) {
    logger.warn({ err, kind: opts.kind, sourceId: opts.sourceId }, "publishNotice failed");
  }
}

/**
 * Fan-out governance event to all owner residents: in-app notification + email.
 * Email delivery failures are logged but not surfaced.
 */
export async function notifyOwners(opts: {
  type: "meeting_scheduled" | "agenda_published" | "minutes_adopted" | "resolution_adopted";
  title: string;
  message: string;
  entityType: "meeting" | "resolution";
  entityId: number;
  emailHeadline?: string;
  emailIntro?: string;
  emailDetail?: string;
}): Promise<void> {
  // Cast type to string union — notification.type column is text
  void 0;
  const owners = await listOwnerResidents();
  if (owners.length === 0) return;
  const orgName = await getOrgName();
  const now = new Date().toISOString();
  for (const o of owners) {
    try {
      await db.insert(notificationsTable).values({
        userId: o.userId,
        type: opts.type,
        message: opts.message,
        entityType: opts.entityType,
        entityId: String(opts.entityId),
        read: false,
        createdAt: now,
      });
    } catch (err) {
      logger.warn({ err, userId: o.userId }, "owner notification insert failed");
    }
    try {
      // Task #108: respect the owner's per-user "governance email" preference.
      // In-app notification above is unconditional; only email is gated.
      const [prefs] = await db
        .select({ governanceEmail: userNotificationPreferencesTable.governanceEmail })
        .from(userNotificationPreferencesTable)
        .where(eq(userNotificationPreferencesTable.userId, String(o.userId)));
      if (prefs && prefs.governanceEmail === 0) continue;
      const html = buildGovernanceEmail({
        orgName,
        headline: opts.emailHeadline ?? opts.title,
        intro: opts.emailIntro ?? opts.message,
        detail: opts.emailDetail,
      });
      await sendEmail(o.email, `[${orgName}] ${opts.title}`, html);
    } catch (err) {
      logger.warn({ err, userId: o.userId }, "owner notification email failed");
    }
  }
}

/**
 * Called when a resolution is adopted. Creates a "resolution_adopted"
 * notice and notifies owners — but only if the resolution is flagged
 * `public`. Owners never see resolutions that are still board-private.
 */
export async function onResolutionAdoptedForOwners(resolutionId: number): Promise<void> {
  const [r] = await db.select().from(resolutionsTable).where(eq(resolutionsTable.id, resolutionId));
  if (!r || !r.public || !r.number) return;
  const [m] = await db.select().from(motionsTable).where(eq(motionsTable.id, r.motionId));
  if (!m) return;
  await publishNotice({
    kind: "resolution_adopted",
    title: `Resolution ${r.number}: ${m.title}`,
    body: m.body || "",
    sourceType: "resolution",
    sourceId: r.id,
  });
  await notifyOwners({
    type: "resolution_adopted",
    title: `Resolution ${r.number} adopted`,
    message: `Board adopted Resolution ${r.number}: ${m.title}`,
    entityType: "resolution",
    entityId: r.id,
    emailIntro: `The Board has adopted Resolution ${r.number}: ${m.title}.`,
    emailDetail: m.body || undefined,
  });
}

/**
 * Called when a meeting's minutes are adopted (post-vote). Creates a
 * "minutes_adopted" notice and notifies owners.
 */
export async function onMinutesAdoptedForOwners(meetingId: number): Promise<void> {
  const [m] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, meetingId));
  if (!m) return;
  await publishNotice({
    kind: "minutes_adopted",
    title: `Minutes adopted: ${m.title}`,
    body: "",
    sourceType: "meeting",
    sourceId: m.id,
    meetingId: m.id,
  });
  await notifyOwners({
    type: "minutes_adopted",
    title: `Minutes adopted: ${m.title}`,
    message: `Minutes for "${m.title}" have been adopted by the Board.`,
    entityType: "meeting",
    entityId: m.id,
    emailIntro: `Minutes for "${m.title}" have been adopted and are now available in the resident portal.`,
  });
}
