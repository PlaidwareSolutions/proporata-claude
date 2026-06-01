// Pure helpers for deriving the live status of a building-system record
// (roof, HVAC, etc) from its warranty expiry, retirement state, and
// inspection cadence. Kept dependency-free so it is unit-testable.

export type DerivedStatus = "good" | "watch" | "action";

export interface BuildingSystemStatusInput {
  warrantyExpiresOn?: string | null;
  retiredOn?: string | null;
  lastInspectedOn?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// `now` is injected so tests do not depend on wall-clock time.
export function deriveBuildingSystemStatus(
  input: BuildingSystemStatusInput,
  now: Date = new Date(),
): DerivedStatus {
  // Retired systems never report Good — the user needs to know they are
  // out of service. We surface them as "action" so they show up in
  // remediation queues (e.g. confirm replacement landed).
  if (input.retiredOn) return "action";

  const todayMs = now.getTime();

  // Warranty: action if expired, watch if expiring within 90 days.
  if (input.warrantyExpiresOn) {
    const wMs = Date.parse(input.warrantyExpiresOn + "T00:00:00Z");
    if (!Number.isNaN(wMs)) {
      if (wMs < todayMs) return "action";
      if (wMs - todayMs < 90 * DAY_MS) return "watch";
    }
  }

  // Inspection cadence: watch when last inspection >18 months ago,
  // action when >24 months. (Only downgrades; never upgrades.)
  if (input.lastInspectedOn) {
    const iMs = Date.parse(input.lastInspectedOn + "T00:00:00Z");
    if (!Number.isNaN(iMs)) {
      const ageDays = (todayMs - iMs) / DAY_MS;
      if (ageDays > 730) return "action";
      if (ageDays > 547) return "watch";
    }
  }

  return "good";
}
