// Task #85: Pet registry compliance helpers.

import { db } from "@workspace/db";
import {
  petsTable,
  petVaccinationsTable,
  petDogparkAgreementsTable,
  petIncidentsTable,
  petAuditTable,
  amenitiesTable,
  dogParkSettingsTable,
  type Pet,
  type PetVaccination,
  type PetStatus,
  type DogParkSettings,
} from "@workspace/db/schema";
import { and, asc, desc, eq, gte } from "drizzle-orm";

export const REQUIRED_DOG_VACCINES = ["rabies", "dhpp"] as const;
export const EXPIRING_SOON_DAYS = 30;

export function nowISO(): string { return new Date().toISOString(); }

export function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysUntil(ymd: string): number {
  const today = new Date(todayYmd() + "T00:00:00Z").getTime();
  const target = new Date(ymd + "T00:00:00Z").getTime();
  return Math.round((target - today) / 86_400_000);
}

export interface VaccinationStatus {
  vaccineType: string;
  expiresOn: string | null;
  state: "current" | "expiring_soon" | "expired" | "missing";
  daysToExpiry: number | null;
}

// Best (latest expiring) per vaccine type for a pet.
export function summarizeVaccinations(vaxs: PetVaccination[]): Map<string, PetVaccination> {
  const byType = new Map<string, PetVaccination>();
  for (const v of vaxs) {
    const cur = byType.get(v.vaccineType);
    if (!cur || cur.expiresOn < v.expiresOn) byType.set(v.vaccineType, v);
  }
  return byType;
}

export function vaccineState(expiresOn: string): "current" | "expiring_soon" | "expired" {
  const d = daysUntil(expiresOn);
  if (d < 0) return "expired";
  if (d <= EXPIRING_SOON_DAYS) return "expiring_soon";
  return "current";
}

export function vaccinationStatusList(pet: Pet, vaxs: PetVaccination[]): VaccinationStatus[] {
  const summary = summarizeVaccinations(vaxs);
  const required = pet.species === "dog" ? Array.from(REQUIRED_DOG_VACCINES) : [];
  const seen = new Set<string>();
  const out: VaccinationStatus[] = [];
  for (const t of required) {
    seen.add(t);
    const v = summary.get(t);
    if (!v) {
      out.push({ vaccineType: t, expiresOn: null, state: "missing", daysToExpiry: null });
    } else {
      out.push({ vaccineType: t, expiresOn: v.expiresOn, state: vaccineState(v.expiresOn), daysToExpiry: daysUntil(v.expiresOn) });
    }
  }
  // Optional vaccines (e.g. bordetella)
  for (const [t, v] of summary) {
    if (seen.has(t)) continue;
    out.push({ vaccineType: t, expiresOn: v.expiresOn, state: vaccineState(v.expiresOn), daysToExpiry: daysUntil(v.expiresOn) });
  }
  return out;
}

export function computePetStatus(pet: Pet, vaxs: PetVaccination[]): PetStatus {
  if (pet.archivedAt) return "non_compliant";
  if (pet.approvalState === "pending") return "pending_approval";
  if (pet.suspendedUntil && pet.suspendedUntil > nowISO()) return "suspended";
  // Cats and "other" species: no vaccine requirement enforced for dog-park,
  // but still record current/expired state for display.
  if (pet.species !== "dog") {
    const vaxStates = vaccinationStatusList(pet, vaxs);
    if (vaxStates.some((s) => s.state === "expired")) return "non_compliant";
    if (vaxStates.some((s) => s.state === "expiring_soon")) return "expiring_soon";
    return "compliant";
  }
  const vaxStates = vaccinationStatusList(pet, vaxs);
  const required = vaxStates.filter((v) => REQUIRED_DOG_VACCINES.includes(v.vaccineType as typeof REQUIRED_DOG_VACCINES[number]));
  if (required.some((v) => v.state === "missing" || v.state === "expired")) return "non_compliant";
  if (required.some((v) => v.state === "expiring_soon")) return "expiring_soon";
  return "compliant";
}

export async function recomputePetStatus(petId: number): Promise<Pet | null> {
  const [pet] = await db.select().from(petsTable).where(eq(petsTable.id, petId));
  if (!pet) return null;
  const vaxs = await db.select().from(petVaccinationsTable).where(eq(petVaccinationsTable.petId, petId));
  const status = computePetStatus(pet, vaxs);
  if (status !== pet.status) {
    const [updated] = await db.update(petsTable).set({ status, updatedAt: nowISO() }).where(eq(petsTable.id, petId)).returning();
    await db.insert(petAuditTable).values({
      petId, unitId: pet.unitId, action: "status_changed",
      actorUserId: null, actorName: "system",
      diff: { from: pet.status, to: status }, createdAt: nowISO(),
    });
    return updated;
  }
  return pet;
}

export async function getDogParkAmenityId(): Promise<number | null> {
  const [a] = await db.select().from(amenitiesTable).where(eq(amenitiesTable.slug, "dog_park"));
  return a?.id ?? null;
}

export async function getDogParkSettings(): Promise<DogParkSettings> {
  const amenityId = await getDogParkAmenityId();
  if (!amenityId) return defaultDogParkSettings();
  const [row] = await db.select().from(dogParkSettingsTable).where(eq(dogParkSettingsTable.amenityId, amenityId));
  return { ...defaultDogParkSettings(), ...(row?.settings ?? {}) };
}

export function defaultDogParkSettings(): DogParkSettings {
  return {
    offLeashByWeekday: [[], [], [], [], [], [], []],
    restrictedBreeds: [],
    enforceBreedRestriction: false,
    maxWeightLbs: 0,
    enforceWeightRestriction: false,
    incidentSuspensionThreshold: 2,
    incidentSuspensionWindowDays: 90,
    incidentSuspensionDurationDays: 30,
    agreementText:
      "I have read and agree to the dog-park rules. My dog is currently vaccinated, healthy, and under my supervision at all times. I accept full liability for my dog's behavior and any harm caused to people, other dogs, or property.",
    ownerApprovalRequiredForTenants: false,
  };
}

export interface EligibilityResult {
  ok: boolean;
  reason?: string;
  eligiblePets: number[];
}

export async function isUnitDogParkEligible(unitId: string): Promise<EligibilityResult> {
  const settings = await getDogParkSettings();

  // 1) Park-rules agreement (annual)
  const [agreement] = await db
    .select()
    .from(petDogparkAgreementsTable)
    .where(eq(petDogparkAgreementsTable.unitId, unitId))
    .orderBy(desc(petDogparkAgreementsTable.signedAt))
    .limit(1);
  if (!agreement) return { ok: false, reason: "Park-rules agreement not signed", eligiblePets: [] };
  if (agreement.expiresAt < nowISO()) return { ok: false, reason: "Park-rules agreement has expired — please re-sign", eligiblePets: [] };

  // 2) At least one Compliant dog
  const dogs = await db
    .select()
    .from(petsTable)
    .where(and(eq(petsTable.unitId, unitId), eq(petsTable.species, "dog")));
  const eligible: number[] = [];
  const reasons: string[] = [];
  for (const d of dogs) {
    if (d.archivedAt) continue;
    if (d.approvalState !== "approved") {
      reasons.push(`${d.name}: pending owner approval`);
      continue;
    }
    if (d.suspendedUntil && d.suspendedUntil > nowISO()) {
      reasons.push(`${d.name}: suspended (${d.suspendedReason || "review pending"})`);
      continue;
    }
    const vaxs = await db.select().from(petVaccinationsTable).where(eq(petVaccinationsTable.petId, d.id));
    const status = computePetStatus(d, vaxs);
    if (status === "non_compliant") {
      reasons.push(`${d.name}: vaccinations not current`);
      continue;
    }
    // Breed/weight gates
    if (settings.enforceBreedRestriction && Array.isArray(settings.restrictedBreeds)) {
      const breedLc = (d.breed || "").toLowerCase();
      const restricted = settings.restrictedBreeds.some((r) => r && breedLc.includes(r.toLowerCase()));
      if (restricted) {
        reasons.push(`${d.name}: breed (${d.breed}) is restricted`);
        continue;
      }
    }
    if (settings.enforceWeightRestriction && (settings.maxWeightLbs ?? 0) > 0 && d.weightLbs > (settings.maxWeightLbs ?? 0)) {
      reasons.push(`${d.name}: exceeds weight limit (${settings.maxWeightLbs} lbs)`);
      continue;
    }
    eligible.push(d.id);
  }
  if (eligible.length === 0) {
    if (dogs.length === 0) return { ok: false, reason: "No registered dogs on file", eligiblePets: [] };
    return { ok: false, reason: reasons[0] ?? "No compliant dogs on file", eligiblePets: [] };
  }
  return { ok: true, eligiblePets: eligible };
}

// Returns {threshold,count} considering open/reviewed incidents in the
// configured window.
export async function petIncidentSuspension(petId: number): Promise<{ shouldSuspend: boolean; threshold: number; recent: number; durationDays: number }> {
  const settings = await getDogParkSettings();
  const threshold = settings.incidentSuspensionThreshold ?? 2;
  const windowDays = settings.incidentSuspensionWindowDays ?? 90;
  const durationDays = settings.incidentSuspensionDurationDays ?? 30;
  const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const rows = await db
    .select()
    .from(petIncidentsTable)
    .where(and(eq(petIncidentsTable.petId, petId), gte(petIncidentsTable.occurredAt, cutoff)));
  const open = rows.filter((r) => r.status !== "dismissed");
  return { shouldSuspend: open.length >= threshold, threshold, recent: open.length, durationDays };
}

export async function audit(args: {
  petId?: number | null;
  unitId?: string | null;
  action: string;
  actorUserId?: number | null;
  actorName?: string | null;
  diff?: unknown;
}): Promise<void> {
  await db.insert(petAuditTable).values({
    petId: args.petId ?? null,
    unitId: args.unitId ?? null,
    action: args.action,
    actorUserId: args.actorUserId ?? null,
    actorName: args.actorName ?? "system",
    diff: (args.diff as object) ?? null,
    createdAt: nowISO(),
  });
}

void asc;
