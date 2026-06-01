// Task #62: Board Motions scheduler.
// Sweeps open motions once a day to:
//   * send a single reminder email to non-voters when within 48h of close,
//   * auto-expire motions whose `closes_at` has passed without resolution.
// Mirrors the bid scheduler's posture: best-effort, never throws, logs only.

import { db } from "@workspace/db";
import {
  motionsTable,
  motionVotesTable,
  usersTable,
  notificationsTable,
  organizationSettingsTable,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger.js";
import { sendEmail } from "./email.js";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REMINDER_WINDOW_MS = 48 * 60 * 60 * 1000;

async function loadBoard() {
  const rows = await db.select().from(usersTable).where(eq(usersTable.boardMember, true));
  return rows.filter((u) => !u.pending);
}

async function getOrgName(): Promise<string> {
  const [row] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  return row?.name ?? "HOA Hub";
}

async function check() {
  try {
    const open = await db.select().from(motionsTable).where(eq(motionsTable.status, "open"));
    if (open.length === 0) return;
    const orgName = await getOrgName();
    const board = await loadBoard();
    const now = Date.now();

    for (const m of open) {
      // Auto-expire when past closesAt with no terminal outcome reached.
      if (m.closesAt) {
        const t = new Date(m.closesAt).getTime();
        if (!Number.isNaN(t) && now > t) {
          await db.update(motionsTable).set({
            status: "expired", outcome: "expired", resolvedAt: new Date().toISOString(),
          }).where(eq(motionsTable.id, m.id));
          for (const u of board) {
            await db.insert(notificationsTable).values({
              userId: u.id,
              type: "motion_expired",
              message: `Motion "${m.title}" expired without resolution`,
              entityType: "motion",
              entityId: String(m.id),
              read: false,
              createdAt: new Date().toISOString(),
            });
          }
          logger.info({ motionId: m.id }, "Motion auto-expired past closesAt");
          continue;
        }
        // Reminder window: 48h before close, once per motion.
        if (!m.reminderSentAt && t - now <= REMINDER_WINDOW_MS && t > now) {
          const votes = await db.select().from(motionVotesTable).where(eq(motionVotesTable.motionId, m.id));
          const voted = new Set(votes.map((v) => v.userId));
          for (const u of board) {
            if (voted.has(u.id)) continue;
            try {
              await sendEmail(u.email, `[${orgName}] Reminder: motion "${m.title}" closes soon`,
                `<p>You have not yet voted on this motion. It closes at ${m.closesAt}.</p>` +
                `<p>Open the HOA Hub Motions page to vote.</p>`);
            } catch (err) { logger.warn({ err, userId: u.id }, "Motion reminder email failed"); }
          }
          await db.update(motionsTable)
            .set({ reminderSentAt: new Date().toISOString() })
            .where(and(eq(motionsTable.id, m.id), eq(motionsTable.status, "open")));
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "motionScheduler check failed");
  }
}

export function startMotionScheduler(): void {
  // Stagger the first run a few seconds after boot to avoid stampedes when
  // the API restarts; subsequent runs are interval-based.
  setTimeout(() => { void check(); }, 5_000);
  setInterval(() => { void check(); }, CHECK_INTERVAL_MS);
  logger.info("motionScheduler started");
}
