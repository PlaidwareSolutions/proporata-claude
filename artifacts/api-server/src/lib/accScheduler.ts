import { db } from "@workspace/db";
import {
  architecturalRequestsTable,
  organizationSettingsTable,
  notificationsTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, ne } from "drizzle-orm";
import { logger } from "./logger.js";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function checkAutoApproval() {
  try {
    const [settings] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
    if (!settings) return;
    const days = settings.accAutoApprovalDays ?? 0;
    if (!days || days <= 0) return;

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = await db.select().from(architecturalRequestsTable);

    const managers = await db.select().from(usersTable).where(ne(usersTable.role, "resident"));
    const activeManagers = managers.filter((m) => !m.pending);

    for (const r of rows) {
      if (r.autoApprovalFlagged) continue;
      if (r.status !== "submitted" && r.status !== "in_review") continue;
      const submitted = new Date(r.submittedAt).getTime();
      if (isNaN(submitted) || submitted > cutoff) continue;

      logger.info({ requestId: r.id, days }, "ACC auto-approval threshold reached — flagging for review");

      await db.update(architecturalRequestsTable)
        .set({ autoApprovalFlagged: true, autoApprovalFlaggedAt: new Date().toISOString() })
        .where(eq(architecturalRequestsTable.id, r.id));

      const message = `Architectural request "${r.title}" (Building ${r.building}) has been pending ${days}+ days — review required (auto-approval threshold reached).`;
      const created = new Date().toISOString();
      for (const u of activeManagers) {
        await db.insert(notificationsTable).values({
          userId: u.id,
          type: "acc_auto_approval_flag",
          message,
          entityType: "architectural_request",
          entityId: String(r.id),
          read: false,
          createdAt: created,
        });
      }
    }
  } catch (err) {
    logger.error({ err }, "ACC auto-approval scheduler failed");
  }
}

export function startAccScheduler() {
  checkAutoApproval();
  setInterval(checkAutoApproval, CHECK_INTERVAL_MS);
  logger.info("ACC auto-approval scheduler started");
}
