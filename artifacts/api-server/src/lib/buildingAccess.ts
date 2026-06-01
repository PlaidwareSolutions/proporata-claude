import { db } from "@workspace/db";
import { unitsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { AuthUser } from "../middleware/auth.js";

export interface BuildingAccess {
  // null = unrestricted (admin / manager).
  // [] = authenticated but has no building affiliation -> deny everything.
  // [n,...] = limited to these building numbers.
  buildingIds: number[] | null;
}

export function isUnrestricted(access: BuildingAccess): boolean {
  return access.buildingIds === null;
}

export function canSeeBuilding(access: BuildingAccess, building: number): boolean {
  if (access.buildingIds === null) return true;
  return access.buildingIds.includes(building);
}

export async function buildingAccessFor(user: AuthUser): Promise<BuildingAccess> {
  if (user.role === "admin" || user.role === "manager") {
    return { buildingIds: null };
  }
  if (!user.unitId) return { buildingIds: [] };
  const [u] = await db
    .select({ building: unitsTable.building })
    .from(unitsTable)
    .where(eq(unitsTable.id, user.unitId));
  return { buildingIds: u ? [u.building] : [] };
}
