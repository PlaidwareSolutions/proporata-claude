import { db } from "@workspace/db";
import { insurancePoliciesTable, notificationsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { createInsuranceExpiryNotification } from "./notificationService.js";
import { logger } from "./logger.js";

const EXPIRY_WINDOW_DAYS = 30;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function checkInsuranceExpiry() {
  try {
    const policies = await db.select().from(insurancePoliciesTable);
    const now = new Date();

    for (const policy of policies) {
      const expires = new Date(policy.expires);
      const diffMs = expires.getTime() - now.getTime();
      const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (daysLeft <= 0 || daysLeft > EXPIRY_WINDOW_DAYS) continue;

      const todayStr = now.toISOString().slice(0, 10);
      const existing = await db
        .select()
        .from(notificationsTable)
        .where(
          and(
            eq(notificationsTable.type, "insurance_expiring"),
            eq(notificationsTable.entityId, String(policy.building)),
          ),
        );

      const sentToday = existing.some((n) => n.createdAt.slice(0, 10) === todayStr);
      if (sentToday) continue;

      logger.info({ building: policy.building, daysLeft }, "Sending insurance expiry alert");
      await createInsuranceExpiryNotification({
        building: policy.building,
        carrier: policy.carrier,
        expires: policy.expires,
        daysLeft,
      });
    }
  } catch (err) {
    logger.error({ err }, "Insurance expiry check failed");
  }
}

export function startInsuranceScheduler() {
  checkInsuranceExpiry();
  setInterval(checkInsuranceExpiry, CHECK_INTERVAL_MS);
  logger.info("Insurance expiry scheduler started");
}
