// Task #85: Nightly job — recomputes pet statuses, sends vaccination
// reminders, and revokes active dog-park access codes for newly
// non-compliant units.

import { db } from "@workspace/db";
import {
  petsTable,
  petVaccinationsTable,
  amenityAccessCodesTable,
  amenityBookingsTable,
  amenitiesTable,
  usersTable,
  unitsTable,
  organizationSettingsTable,
} from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "./logger.js";
import { recomputePetStatus, daysUntil, nowISO, isUnitDogParkEligible } from "./petsCompliance.js";
import { sendEmail, buildVaccinationReminderEmail, buildPetSuspensionEmail } from "./email.js";
import { recordAudit } from "./amenityAccess.js";

const REMINDER_DAYS = [30, 14, 1, 0] as const;

async function loadOrgName(): Promise<string> {
  const [s] = await db.select().from(organizationSettingsTable);
  return s?.name ?? "HOA";
}

async function unitContactEmails(unitId: string): Promise<string[]> {
  const [u] = await db.select().from(unitsTable).where(eq(unitsTable.id, unitId));
  if (!u) return [];
  const out: string[] = [];
  if (u.ownerEmail) out.push(u.ownerEmail);
  if (u.tenantEmail) out.push(u.tenantEmail);
  return out;
}

async function sendVaccinationReminders(): Promise<void> {
  const orgName = await loadOrgName();
  const pets = await db.select().from(petsTable);
  const petMap = new Map(pets.map((p) => [p.id, p] as const));
  const vaxs = await db.select().from(petVaccinationsTable);
  for (const v of vaxs) {
    const days = daysUntil(v.expiresOn);
    const pet = petMap.get(v.petId);
    if (!pet || pet.archivedAt) continue;
    let target: number | null = null;
    for (const d of REMINDER_DAYS) {
      if (days === d) { target = d; break; }
    }
    if (target === null) continue;
    const key = target === 0 ? "day_of" : String(target);
    if ((v.remindersSent ?? []).includes(key)) continue;
    const recipients = await unitContactEmails(pet.unitId);
    if (recipients.length === 0) continue;
    const html = buildVaccinationReminderEmail({
      orgName, petName: pet.name, vaccineType: v.vaccineType,
      expiresOn: v.expiresOn, daysUntil: target,
    });
    const subject = target === 0
      ? `Vaccination expired today: ${pet.name}`
      : `Vaccination expiring in ${target} day${target === 1 ? "" : "s"}: ${pet.name}`;
    await sendEmail(recipients, subject, html).catch((err) => logger.warn({ err }, "vaccination email failed"));
    await db.update(petVaccinationsTable).set({
      remindersSent: [...(v.remindersSent ?? []), key],
    }).where(eq(petVaccinationsTable.id, v.id));
  }
}

async function recomputeAllPetStatuses(): Promise<Set<string>> {
  const pets = await db.select().from(petsTable);
  const changedUnits = new Set<string>();
  for (const p of pets) {
    const before = p.status;
    const after = await recomputePetStatus(p.id);
    if (after && after.status !== before) changedUnits.add(p.unitId);
  }
  return changedUnits;
}

async function revokeDogParkForIneligibleUnits(changedUnits: Set<string>): Promise<void> {
  if (changedUnits.size === 0) return;
  const [dogPark] = await db.select().from(amenitiesTable).where(eq(amenitiesTable.slug, "dog_park"));
  if (!dogPark) return;
  const now = nowISO();
  for (const unitId of changedUnits) {
    const eligibility = await isUnitDogParkEligible(unitId);
    if (eligibility.ok) continue;
    // Revoke active dog-park access codes for this unit's bookings.
    const bookings = await db.select().from(amenityBookingsTable).where(and(
      eq(amenityBookingsTable.amenityId, dogPark.id),
      eq(amenityBookingsTable.unitId, unitId),
    ));
    if (bookings.length === 0) continue;
    const bookingIds = bookings.map((b) => b.id);
    const codes = await db.select().from(amenityAccessCodesTable).where(and(
      inArray(amenityAccessCodesTable.bookingId, bookingIds),
      eq(amenityAccessCodesTable.status, "active"),
    ));
    for (const c of codes) {
      // Only revoke codes that are still in the future.
      if (c.validTo < now) continue;
      await db.update(amenityAccessCodesTable).set({ status: "revoked", revokedAt: now }).where(eq(amenityAccessCodesTable.id, c.id));
      await recordAudit({
        bookingId: c.bookingId, amenityId: c.amenityId, accessCodeId: c.id,
        providerKind: c.providerKind, action: "revoke", success: true,
        actorName: "system", message: `auto-revoke: ${eligibility.reason ?? "no longer eligible"}`,
      });
    }
    // Notify owner/tenant.
    const recipients = await unitContactEmails(unitId);
    if (recipients.length > 0) {
      const orgName = await loadOrgName();
      void sendEmail(
        recipients,
        `Dog-park access suspended — ${orgName}`,
        buildPetSuspensionEmail({ orgName, unitId, reason: eligibility.reason ?? "Eligibility lost" }),
      ).catch((err) => logger.warn({ err }, "suspension email failed"));
    }
  }
  void usersTable;
}

export async function petsTick(): Promise<void> {
  try {
    const changedUnits = await recomputeAllPetStatuses();
    await revokeDogParkForIneligibleUnits(changedUnits);
    await sendVaccinationReminders();
  } catch (err) {
    logger.error({ err }, "Pets scheduler tick failed");
  }
}

const TICK_MS = 60 * 60 * 1000; // hourly

export function startPetScheduler(): void {
  setTimeout(() => { void petsTick(); }, 45_000);
  setInterval(() => { void petsTick(); }, TICK_MS);
}
