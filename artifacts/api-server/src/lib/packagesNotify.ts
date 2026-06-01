// Task #87: package-related notifications.
import { db } from "@workspace/db";
import { notificationsTable, usersTable, organizationSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { sendEmail } from "./email.js";
import { logger } from "./logger.js";

async function getOrgName(): Promise<string> {
  const [row] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  return row?.name ?? "HOA Hub";
}

interface PkgInfo {
  id: number;
  carrier: string;
  trackingNumber: string;
  size: string;
  pickupCode: string;
  lockerBay?: string | null;
  lockerPin?: string | null;
  recipientUserId: number | null;
  recipientName: string;
  unitId: string;
  heldUntil: string | null;
}

export async function notifyPackageIntake(pkg: PkgInfo, options: { digest?: boolean } = {}): Promise<void> {
  const orgName = await getOrgName();
  const recipientName = pkg.recipientName || `Unit ${pkg.unitId}`;
  const lockerLine = pkg.lockerBay
    ? `Locker ${pkg.lockerBay}${pkg.lockerPin ? ` (PIN ${pkg.lockerPin})` : ""}`
    : "Pick up at the management office";
  const message = options.digest
    ? `Package received during your hold (${pkg.carrier} ${pkg.size}). Code ${pkg.pickupCode}.`
    : `New package for ${recipientName}: ${pkg.carrier} ${pkg.size}. Pickup code: ${pkg.pickupCode}. ${lockerLine}.`;

  // Find target users — recipient (if known) plus all owners on the unit.
  const owners = await db.select().from(usersTable).where(eq(usersTable.unitId, pkg.unitId));
  const targets = new Map<number, typeof usersTable.$inferSelect>();
  for (const u of owners) if (!u.pending) targets.set(u.id, u);
  if (pkg.recipientUserId) {
    const [r] = await db.select().from(usersTable).where(eq(usersTable.id, pkg.recipientUserId));
    if (r && !r.pending) targets.set(r.id, r);
  }

  const now = new Date().toISOString();
  for (const u of targets.values()) {
    try {
      await db.insert(notificationsTable).values({
        userId: u.id,
        type: "package_received",
        message,
        entityType: "package",
        entityId: String(pkg.id),
        read: false,
        createdAt: now,
      });
      if (u.email && !options.digest) {
        const subject = `[${orgName}] Package received — ${pkg.carrier} ${pkg.size}`;
        const html = `<p>Hi ${u.name ?? "neighbor"},</p>
          <p>A package was logged in the mail room for <strong>${recipientName}</strong>.</p>
          <ul>
            <li>Carrier: ${pkg.carrier}</li>
            <li>Size: ${pkg.size}</li>
            ${pkg.trackingNumber ? `<li>Tracking: ${pkg.trackingNumber}</li>` : ""}
            <li>Pickup code: <strong>${pkg.pickupCode}</strong></li>
            <li>${lockerLine}</li>
          </ul>
          <p>Show this code to the manager or scan the QR in the resident portal to pick up.</p>`;
        await sendEmail(u.email, subject, html);
      }
    } catch (err) {
      logger.warn({ err, userId: u.id }, "package intake notify failed");
    }
  }
}

export async function notifyPackageDigest(unitId: string, packages: PkgInfo[]): Promise<void> {
  if (packages.length === 0) return;
  const orgName = await getOrgName();
  const owners = await db.select().from(usersTable).where(eq(usersTable.unitId, unitId));
  const now = new Date().toISOString();
  const lines = packages.map((p) =>
    `${p.carrier} ${p.size} — code ${p.pickupCode}${p.lockerBay ? ` (locker ${p.lockerBay})` : ""}`,
  );
  const summary = `Package digest — ${packages.length} package(s) held during your vacation.`;
  for (const u of owners) {
    if (u.pending) continue;
    await db.insert(notificationsTable).values({
      userId: u.id,
      type: "package_digest",
      message: summary,
      entityType: "package",
      entityId: String(packages[0].id),
      read: false,
      createdAt: now,
    });
    if (u.email) {
      const html = `<p>Hi ${u.name ?? "neighbor"},</p><p>${summary}</p><ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>`;
      await sendEmail(u.email, `[${orgName}] Package digest`, html);
    }
  }
}

export async function notifyStale(pkg: PkgInfo): Promise<void> {
  const orgName = await getOrgName();
  const owners = await db.select().from(usersTable).where(eq(usersTable.unitId, pkg.unitId));
  const now = new Date().toISOString();
  const message = `Reminder: package ${pkg.carrier} ${pkg.size} (code ${pkg.pickupCode}) is still waiting in the mail room.`;
  for (const u of owners) {
    if (u.pending) continue;
    await db.insert(notificationsTable).values({
      userId: u.id, type: "package_stale", message,
      entityType: "package", entityId: String(pkg.id), read: false, createdAt: now,
    });
    if (u.email) {
      await sendEmail(u.email, `[${orgName}] Unclaimed package reminder`,
        `<p>${message}</p><p>Please visit the mail room to claim it before it is flagged for return-to-sender.</p>`);
    }
  }
}

export async function notifyReturnToSender(pkg: PkgInfo): Promise<void> {
  const orgName = await getOrgName();
  const owners = await db.select().from(usersTable).where(eq(usersTable.unitId, pkg.unitId));
  const now = new Date().toISOString();
  const message = `Package ${pkg.carrier} ${pkg.size} (code ${pkg.pickupCode}) flagged for return-to-sender.`;
  for (const u of owners) {
    if (u.pending) continue;
    await db.insert(notificationsTable).values({
      userId: u.id, type: "package_rts", message,
      entityType: "package", entityId: String(pkg.id), read: false, createdAt: now,
    });
    if (u.email) {
      await sendEmail(u.email, `[${orgName}] Package flagged for return-to-sender`,
        `<p>${message}</p><p>Please contact the management office immediately if you wish to claim it.</p>`);
    }
  }
}
