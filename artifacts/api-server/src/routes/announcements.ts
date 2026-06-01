import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  announcementsTable,
  unitsTable,
  usersTable,
  notificationsTable,
  userNotificationPreferencesTable,
  organizationSettingsTable,
} from "@workspace/db/schema";
import { desc, eq, or, isNull } from "drizzle-orm";
import { authenticateJwt, requireManager } from "../middleware/auth.js";
import { sendEmail, buildBroadcastEmail } from "../lib/email.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/announcements", authenticateJwt, async (req, res) => {
  try {
    const user = req.user!;
    let rows;
    if (user.role === "resident") {
      let buildingNum: number | null = null;
      if (user.unitId) {
        const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, user.unitId));
        buildingNum = unit?.building ?? null;
      }
      const cond = buildingNum != null
        ? or(isNull(announcementsTable.buildingId), eq(announcementsTable.buildingId, buildingNum))
        : isNull(announcementsTable.buildingId);
      rows = await db
        .select()
        .from(announcementsTable)
        .where(cond)
        .orderBy(desc(announcementsTable.pinned), desc(announcementsTable.createdAt))
        .limit(50);
    } else {
      rows = await db
        .select()
        .from(announcementsTable)
        .orderBy(desc(announcementsTable.pinned), desc(announcementsTable.createdAt))
        .limit(100);
    }
    res.json(rows.map(toAnnouncement));
  } catch (err) {
    console.error("GET /announcements error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/announcements", authenticateJwt, requireManager, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const messageBody = typeof body.body === "string" ? body.body.trim() : "";
  const buildingId =
    typeof body.buildingId === "number"
      ? body.buildingId
      : body.buildingId == null
        ? null
        : Number(body.buildingId);
  const pinned = body.pinned === true ? 1 : 0;

  if (!title || !messageBody) {
    res.status(400).json({ error: "title and body are required" });
    return;
  }
  if (buildingId != null && Number.isNaN(buildingId)) {
    res.status(400).json({ error: "buildingId must be a number" });
    return;
  }

  try {
    const [created] = await db
      .insert(announcementsTable)
      .values({
        title,
        body: messageBody,
        buildingId: buildingId ?? null,
        pinned,
        createdAt: new Date().toISOString(),
        createdBy: req.user!.email,
      })
      .returning();

    // Task #177: fan-out an in-app notification (and optionally email) to
    // residents in the targeted audience so they actually find out about the
    // new announcement instead of relying on them visiting the portal.
    try {
      await fanOutAnnouncementNotifications(created!);
    } catch (err) {
      logger.warn(
        { err, announcementId: created?.id },
        "announcement fan-out failed (announcement still created)",
      );
    }

    res.status(201).json(toAnnouncement(created!));
  } catch (err) {
    console.error("POST /announcements error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/announcements/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const updates: Partial<typeof announcementsTable.$inferInsert> = {};

  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      res.status(400).json({ error: "title cannot be empty" });
      return;
    }
    updates.title = title;
  }
  if (body.body !== undefined) {
    const messageBody = typeof body.body === "string" ? body.body.trim() : "";
    if (!messageBody) {
      res.status(400).json({ error: "body cannot be empty" });
      return;
    }
    updates.body = messageBody;
  }
  if (body.buildingId !== undefined) {
    if (body.buildingId === null) {
      updates.buildingId = null;
    } else {
      const bid = typeof body.buildingId === "number" ? body.buildingId : Number(body.buildingId);
      if (Number.isNaN(bid)) {
        res.status(400).json({ error: "buildingId must be a number" });
        return;
      }
      updates.buildingId = bid;
    }
  }
  if (body.pinned !== undefined) {
    updates.pinned = body.pinned === true ? 1 : 0;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No updatable fields provided" });
    return;
  }

  updates.updatedAt = new Date().toISOString();
  updates.updatedBy = req.user!.email;

  try {
    const [updated] = await db
      .update(announcementsTable)
      .set(updates)
      .where(eq(announcementsTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Announcement not found" });
      return;
    }
    res.json(toAnnouncement(updated));
  } catch (err) {
    console.error("PATCH /announcements/:id error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/announcements/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const deleted = await db
      .delete(announcementsTable)
      .where(eq(announcementsTable.id, id))
      .returning();
    if (deleted.length === 0) {
      res.status(404).json({ error: "Announcement not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /announcements/:id error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Task #177: shared fan-out helper. For an announcement targeted at all
// buildings (buildingId == null), every active resident gets notified. For an
// announcement targeted at a specific building, only residents whose unit lives
// in that building get notified. We always insert an in-app notification so
// the bell shows the alert; email is sent only when the user's preferences
// allow it (announcementsEmail !== 0) and an email address is on file.
async function fanOutAnnouncementNotifications(
  ann: typeof announcementsTable.$inferSelect,
): Promise<void> {
  const residents = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.role, "resident"));

  let targets = residents.filter((u) => !u.pending && !!u.unitId);

  if (ann.buildingId != null) {
    const units = await db
      .select()
      .from(unitsTable)
      .where(eq(unitsTable.building, ann.buildingId));
    const unitIds = new Set(units.map((u) => u.id));
    targets = targets.filter((u) => u.unitId && unitIds.has(u.unitId));
  }

  if (targets.length === 0) return;

  const now = new Date().toISOString();
  const buildingScope =
    ann.buildingId != null ? ` (Building ${ann.buildingId})` : "";
  const message = `New announcement: "${ann.title}"${buildingScope}`;

  const [orgRow] = await db
    .select()
    .from(organizationSettingsTable)
    .where(eq(organizationSettingsTable.id, 1));
  const orgName = orgRow?.name ?? "HOA Hub";
  const subject = `[${orgName}] ${ann.title}`;
  const html = buildBroadcastEmail({ orgName, subject: ann.title, body: ann.body });

  for (const u of targets) {
    try {
      await db.insert(notificationsTable).values({
        userId: u.id,
        type: "announcement",
        message,
        entityType: "announcement",
        entityId: String(ann.id),
        read: false,
        createdAt: now,
      });
    } catch (err) {
      logger.warn(
        { err, userId: u.id, announcementId: ann.id },
        "announcement in-app notification insert failed",
      );
    }

    if (!u.email) continue;
    const [prefs] = await db
      .select()
      .from(userNotificationPreferencesTable)
      .where(eq(userNotificationPreferencesTable.userId, String(u.id)));
    const wantsEmail = !prefs || prefs.announcementsEmail !== 0;
    if (!wantsEmail) continue;

    try {
      await sendEmail(u.email, subject, html);
    } catch (err) {
      logger.warn(
        { err, userId: u.id, announcementId: ann.id },
        "announcement email send failed",
      );
    }
  }
}

function toAnnouncement(row: typeof announcementsTable.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    buildingId: row.buildingId ?? null,
    pinned: (row.pinned ?? 0) === 1,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt ?? null,
    updatedBy: row.updatedBy ?? null,
  };
}

export default router;
