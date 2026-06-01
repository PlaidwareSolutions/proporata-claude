import { db } from "@workspace/db";
import {
  bidRequestsTable,
  bidInvitationsTable,
  organizationSettingsTable,
  vendorsTable,
} from "@workspace/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { logger } from "./logger.js";
import { sendEmail, buildBidReminderEmail } from "./email.js";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function check() {
  try {
    const [settings] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
    const remindDays = settings?.bidReminderDaysBefore ?? 3;

    const bids = await db.select().from(bidRequestsTable);
    const now = Date.now();

    for (const bid of bids) {
      // Auto-close past deadline
      if (bid.status === "open") {
        const deadlineMs = new Date(bid.deadline).getTime();
        if (!isNaN(deadlineMs) && now > deadlineMs) {
          // Mark non-responding invitations
          const invs = await db.select().from(bidInvitationsTable).where(eq(bidInvitationsTable.bidRequestId, bid.id));
          for (const inv of invs) {
            if (inv.status === "invited" || inv.status === "viewed") {
              await db.update(bidInvitationsTable)
                .set({ status: "no_response" })
                .where(eq(bidInvitationsTable.id, inv.id));
            }
          }
          await db.update(bidRequestsTable).set({ status: "closed" }).where(eq(bidRequestsTable.id, bid.id));
          logger.info({ bidId: bid.id }, "Bid auto-closed past deadline");
          continue;
        }
        // Reminders
        if (!isNaN(deadlineMs)) {
          const daysLeft = Math.floor((deadlineMs - now) / (24 * 60 * 60 * 1000));
          if (daysLeft <= remindDays && daysLeft >= 0) {
            const invs = await db.select().from(bidInvitationsTable)
              .where(and(eq(bidInvitationsTable.bidRequestId, bid.id), ne(bidInvitationsTable.status, "submitted")));
            for (const inv of invs) {
              if (inv.reminderSentAt) continue;
              if (inv.status !== "invited" && inv.status !== "viewed") continue;
              const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, inv.vendorId));
              if (!vendor) continue;
              await sendEmail(vendor.email, `Reminder: bid ${bid.title} closes soon`, buildBidReminderEmail({
                orgName: settings?.name ?? "HOA",
                bidTitle: bid.title,
                deadline: bid.deadline,
                daysLeft,
                vendorName: vendor.name,
              }));
              await db.update(bidInvitationsTable).set({ reminderSentAt: new Date().toISOString() })
                .where(eq(bidInvitationsTable.id, inv.id));
            }
          }
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "Bid scheduler failed");
  }
}

export function startBidScheduler() {
  check();
  setInterval(check, CHECK_INTERVAL_MS);
  logger.info("Bid scheduler started");
}
