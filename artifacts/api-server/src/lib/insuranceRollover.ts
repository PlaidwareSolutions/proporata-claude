// Pure helper that decides whether a PATCH /insurance/:id update
// represents a *new policy period* (carrier or policyNo changed),
// in which case the previous row is rolled into history.
//
// Kept dependency-free so it can be unit tested without touching the DB.

export interface ExistingPolicySnapshot {
  building: number;
  carrier: string;
  policyNo: string;
  coverage: number;
  premium: number;
  effectiveFrom: string | null;
  expires: string;
}

export interface PolicyPatch {
  carrier?: string;
  policyNo?: string;
  coverage?: number;
  premium?: number;
  expires?: string;
  status?: string;
}

export interface RolloverHistoryRow {
  building: number;
  carrier: string;
  policyNo: string;
  coverage: number;
  premium: number;
  effectiveFrom: string;
  effectiveTo: string;
  endedReason: string;
  notes: string | null;
}

export interface RolloverDecision {
  shouldRollover: boolean;
  // The history row to insert (only set when shouldRollover is true).
  historyRow: RolloverHistoryRow | null;
  // The new effectiveFrom date for the now-current policy.
  newEffectiveFrom: string | null;
}

// Decide whether the patch flips us to a new policy. We treat a change
// to either `carrier` or `policyNo` as a replacement; coverage/premium
// edits alone are mid-term corrections and never rollover.
export function decideInsuranceRollover(
  existing: ExistingPolicySnapshot,
  patch: PolicyPatch,
  today: string,
): RolloverDecision {
  const newCarrier = patch.carrier !== undefined && patch.carrier !== existing.carrier;
  const newPolicyNo = patch.policyNo !== undefined && patch.policyNo !== existing.policyNo;

  if (!newCarrier && !newPolicyNo) {
    return { shouldRollover: false, historyRow: null, newEffectiveFrom: null };
  }

  // Closing period: uses the existing policy's actual coverage window —
  // effectiveFrom..expires — so the timeline reflects the real policy
  // period, not the date the replacement was entered. If the replacement
  // is recorded before the existing policy expires (mid-term carrier
  // change), we cap effectiveTo at `today` so the period doesn't extend
  // past when coverage actually ended.
  const effectiveFrom = existing.effectiveFrom ?? existing.expires;
  const effectiveTo = today < existing.expires ? today : existing.expires;
  const endedReason = newCarrier ? "carrier_change" : "renewal";

  return {
    shouldRollover: true,
    historyRow: {
      building: existing.building,
      carrier: existing.carrier,
      policyNo: existing.policyNo,
      coverage: existing.coverage,
      premium: existing.premium,
      effectiveFrom,
      effectiveTo,
      endedReason,
      notes: null,
    },
    newEffectiveFrom: today,
  };
}
