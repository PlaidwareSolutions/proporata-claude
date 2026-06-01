// Task #87: Aging job — packages that linger in the mail room transition to
// "stale" after a configurable threshold (default 7 days) and to
// "return_to_sender" after a second threshold (default 30 days).
// Also fires a daily digest summary for vacation-hold packages.

import { db } from "@workspace/db";
import {
  packagesTable,
  packageLockersTable,
  packageAuditTable,
  organizationSettingsTable,
} from "@workspace/db/schema";
import { and, eq, lt, isNull, inArray } from "drizzle-orm";
import { logger } from "./logger.js";
import { notifyStale, notifyReturnToSender, notifyPackageDigest } from "./packagesNotify.js";

const TICK_MS = 60 * 60 * 1000; // hourly

function nowISO(): string { return new Date().toISOString(); }

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function tick(): Promise<void> {
  const staleDays = envInt("PACKAGE_STALE_DAYS", 7);
  const rtsDays = envInt("PACKAGE_RTS_DAYS", 30);
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - staleDays * 24 * 60 * 60 * 1000).toISOString();
  const rtsCutoff = new Date(now.getTime() - rtsDays * 24 * 60 * 60 * 1000).toISOString();

  // Promote received/in_locker → stale.
  const stale = await db
    .update(packagesTable)
    .set({ status: "stale", staleAt: nowISO(), updatedAt: nowISO() })
    .where(and(
      inArray(packagesTable.status, ["received", "in_locker", "ready_for_pickup"]),
      lt(packagesTable.createdAt, staleCutoff),
    ))
    .returning();
  for (const p of stale) {
    await db.insert(packageAuditTable).values({
      packageId: p.id, action: "auto_stale", actorUserId: null, actorName: "system",
      diff: { staleDays }, createdAt: nowISO(),
    });
    try {
      await notifyStale({
        id: p.id, carrier: p.carrier, trackingNumber: p.trackingNumber, size: p.size,
        pickupCode: p.pickupCode, lockerBay: null, lockerPin: p.lockerPin,
        recipientUserId: p.recipientUserId, recipientName: p.recipientName,
        unitId: p.unitId, heldUntil: p.heldUntil,
      });
    } catch (err) { logger.warn({ err, packageId: p.id }, "stale notify failed"); }
  }

  // Promote stale → return_to_sender.
  const rts = await db
    .update(packagesTable)
    .set({ status: "return_to_sender", rtsAt: nowISO(), updatedAt: nowISO() })
    .where(and(
      eq(packagesTable.status, "stale"),
      lt(packagesTable.createdAt, rtsCutoff),
    ))
    .returning();
  for (const p of rts) {
    await db.insert(packageAuditTable).values({
      packageId: p.id, action: "auto_rts", actorUserId: null, actorName: "system",
      diff: { rtsDays }, createdAt: nowISO(),
    });
    try {
      await notifyReturnToSender({
        id: p.id, carrier: p.carrier, trackingNumber: p.trackingNumber, size: p.size,
        pickupCode: p.pickupCode, lockerBay: null, lockerPin: p.lockerPin,
        recipientUserId: p.recipientUserId, recipientName: p.recipientName,
        unitId: p.unitId, heldUntil: p.heldUntil,
      });
    } catch (err) { logger.warn({ err, packageId: p.id }, "rts notify failed"); }
  }

  if (stale.length || rts.length) {
    logger.info({ stale: stale.length, rts: rts.length }, "package aging job ran");
  }
}

let lastDigestKey = "";

// Daily digest for vacation-hold packages logged in the last 24h.
async function dailyDigest(): Promise<void> {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const hourCT = parseInt(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", hour: "numeric", hour12: false,
  }).format(now), 10);
  // Send once per day around 8am Central.
  if (hourCT !== 8) return;
  if (lastDigestKey === todayKey) return;
  lastDigestKey = todayKey;

  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const held = await db.select().from(packagesTable);
  const lockers = await db.select().from(packageLockersTable);
  const lockerById = new Map<number, { bay: string }>(lockers.map((l) => [l.id, { bay: l.bay }]));
  const byUnit = new Map<string, typeof held>();
  for (const p of held) {
    if (!p.heldUntil) continue;
    if (p.createdAt < since) continue;
    if (p.status === "picked_up" || p.status === "returned") continue;
    const list = byUnit.get(p.unitId) ?? [];
    list.push(p);
    byUnit.set(p.unitId, list);
  }
  for (const [unitId, pkgs] of byUnit) {
    try {
      await notifyPackageDigest(unitId, pkgs.map((p) => ({
        id: p.id, carrier: p.carrier, trackingNumber: p.trackingNumber, size: p.size,
        pickupCode: p.pickupCode,
        lockerBay: p.lockerId ? lockerById.get(p.lockerId)?.bay ?? null : null,
        lockerPin: p.lockerPin,
        recipientUserId: p.recipientUserId, recipientName: p.recipientName,
        unitId, heldUntil: p.heldUntil,
      })));
    } catch (err) {
      logger.warn({ err, unitId }, "package daily digest failed");
    }
  }
}

export function startPackagesAgingScheduler(): void {
  const run = async () => {
    try { await tick(); } catch (err) { logger.error({ err }, "package aging tick failed"); }
    try { await dailyDigest(); } catch (err) { logger.error({ err }, "package digest tick failed"); }
  };
  void run();
  setInterval(() => { void run(); }, TICK_MS);
}

// Exported for tests / manual runs.
export const _internal = { tick, dailyDigest };
