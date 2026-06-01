import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  notificationLogTable,
  usersTable,
  unitsTable,
  organizationSettingsTable,
} from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { authenticateJwt, requireManager } from "../middleware/auth.js";
import { sendEmail, buildBroadcastEmail } from "../lib/email.js";

const router: IRouter = Router();

router.get("/communications/log", authenticateJwt, requireManager, async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(notificationLogTable)
      .orderBy(desc(notificationLogTable.sentAt))
      .limit(100);
    res.json(rows.map(toLog));
  } catch (err) {
    console.error("GET /communications/log error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/communications/broadcast", authenticateJwt, requireManager, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const recipientGroup = body.recipientGroup as string | undefined;
  const buildingId = body.buildingId as number | undefined;
  const subject = body.subject as string | undefined;
  const messageBody = body.body as string | undefined;

  if (!recipientGroup || !subject?.trim() || !messageBody?.trim()) {
    res.status(400).json({ error: "recipientGroup, subject, and body are required" });
    return;
  }

  const validGroups = ["all_owners", "all_tenants", "specific_building"];
  if (!validGroups.includes(recipientGroup)) {
    res.status(400).json({ error: "Invalid recipientGroup" });
    return;
  }

  if (recipientGroup === "specific_building" && !buildingId) {
    res.status(400).json({ error: "buildingId is required for specific_building group" });
    return;
  }

  try {
    const [orgRow] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
    const orgName = orgRow?.name ?? "HOA Hub";

    let recipientEmails: string[] = [];

    if (recipientGroup === "all_owners" || recipientGroup === "all_tenants") {
      const occupancy = recipientGroup === "all_owners" ? "owner" : "tenant";
      const units = await db.select().from(unitsTable).where(eq(unitsTable.occupancy, occupancy));
      const unitIds = units.map((u) => u.id);
      if (unitIds.length > 0) {
        const users = await db.select().from(usersTable).where(eq(usersTable.role, "resident"));
        const unitSet = new Set(unitIds);
        recipientEmails = users
          .filter((u) => u.unitId && unitSet.has(u.unitId))
          .map((u) => u.email);
      }
      if (recipientEmails.length === 0) {
        const managers = await db.select().from(usersTable).where(eq(usersTable.role, "manager"));
        const adminUsers = await db.select().from(usersTable).where(eq(usersTable.role, "admin"));
        recipientEmails = [...managers, ...adminUsers].map((u) => u.email).slice(0, 5);
      }
    } else if (recipientGroup === "specific_building" && buildingId) {
      const units = await db.select().from(unitsTable).where(eq(unitsTable.building, buildingId));
      const unitIds = new Set(units.map((u) => u.id));
      const users = await db.select().from(usersTable);
      recipientEmails = users.filter((u) => u.unitId && unitIds.has(u.unitId)).map((u) => u.email);
      if (recipientEmails.length === 0) {
        const managers = await db.select().from(usersTable).where(eq(usersTable.role, "manager"));
        recipientEmails = managers.map((u) => u.email).slice(0, 5);
      }
    }

    const html = buildBroadcastEmail({ orgName, subject: subject.trim(), body: messageBody.trim() });

    let sentCount = 0;
    for (const email of recipientEmails) {
      const result = await sendEmail(email, subject.trim(), html);
      if (result.ok) sentCount++;
    }

    const now = new Date().toISOString();
    const [logged] = await db
      .insert(notificationLogTable)
      .values({
        recipientGroup,
        buildingId: buildingId ?? null,
        subject: subject.trim(),
        body: messageBody.trim(),
        sentAt: now,
        sentBy: req.user!.email,
        recipientCount: sentCount,
      })
      .returning();

    res.status(201).json(toLog(logged!));
  } catch (err) {
    console.error("POST /communications/broadcast error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

function toLog(row: typeof notificationLogTable.$inferSelect) {
  return {
    id: row.id,
    recipientGroup: row.recipientGroup,
    buildingId: row.buildingId ?? null,
    subject: row.subject,
    body: row.body,
    sentAt: row.sentAt,
    sentBy: row.sentBy,
    recipientCount: row.recipientCount,
  };
}

export default router;
