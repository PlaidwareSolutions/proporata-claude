// Task #141: Nightly job — recomputes owner_accounts.ownership_status
// against the configured past-due voting threshold so owners who
// become past-due lose voting rights, and owners who pay back current
// are restored, without waiting for a manager to click the recompute
// button. Manual overrides and "closed" rows are skipped inside
// `recomputeOwnershipStatuses` itself.

import { logger } from "./logger.js";
import { recomputeOwnershipStatuses } from "./membership.js";

const TICK_MS = 24 * 60 * 60 * 1000;

// Run nightly at ~03:15 local time (off-hours). Falls back to a
// 24-hour interval thereafter.
function msUntilNextRun(now: Date = new Date()): number {
  const next = new Date(now);
  next.setHours(3, 15, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export async function membershipTick(): Promise<void> {
  try {
    const result = await recomputeOwnershipStatuses();
    logger.info(
      {
        scanned: result.scanned,
        updated: result.updated,
        flippedToSuspended: result.flippedToSuspended,
        flippedToActive: result.flippedToActive,
      },
      "Membership eligibility recompute completed",
    );
  } catch (err) {
    logger.error({ err }, "Membership eligibility recompute failed");
  }
}

export function startMembershipScheduler(): void {
  const delay = msUntilNextRun();
  setTimeout(() => {
    void membershipTick();
    setInterval(() => {
      void membershipTick();
    }, TICK_MS);
  }, delay);
  logger.info(
    { firstRunInMs: delay },
    "Membership eligibility scheduler started",
  );
}
