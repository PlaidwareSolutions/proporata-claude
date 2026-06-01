import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideInsuranceRollover } from "./insuranceRollover.js";

const baseExisting = {
  building: 5,
  carrier: "Travelers",
  policyNo: "TX-123",
  coverage: 1_000_000,
  premium: 12_000,
  effectiveFrom: "2025-01-01",
  expires: "2026-01-01",
};

describe("decideInsuranceRollover", () => {
  it("does not rollover for premium-only edits", () => {
    const out = decideInsuranceRollover(baseExisting, { premium: 13_000 }, "2026-05-03");
    assert.equal(out.shouldRollover, false);
    assert.equal(out.historyRow, null);
  });

  it("does not rollover when patch values match existing", () => {
    const out = decideInsuranceRollover(
      baseExisting,
      { carrier: "Travelers", policyNo: "TX-123" },
      "2026-05-03",
    );
    assert.equal(out.shouldRollover, false);
  });

  it("rolls over when carrier changes and tags reason as carrier_change", () => {
    const out = decideInsuranceRollover(
      baseExisting,
      { carrier: "Allstate", policyNo: "AL-9" },
      "2026-05-03",
    );
    assert.equal(out.shouldRollover, true);
    assert.ok(out.historyRow);
    assert.equal(out.historyRow!.endedReason, "carrier_change");
    assert.equal(out.historyRow!.effectiveFrom, "2025-01-01");
    // Replacement entered 2026-05-03 but existing policy expired earlier
    // on 2026-01-01 — closing period uses the actual coverage end.
    assert.equal(out.historyRow!.effectiveTo, "2026-01-01");
    assert.equal(out.historyRow!.carrier, "Travelers");
    assert.equal(out.historyRow!.policyNo, "TX-123");
    assert.equal(out.newEffectiveFrom, "2026-05-03");
  });

  it("rolls over with reason renewal when only policyNo changes", () => {
    const out = decideInsuranceRollover(
      baseExisting,
      { policyNo: "TX-456" },
      "2026-05-03",
    );
    assert.equal(out.shouldRollover, true);
    assert.equal(out.historyRow!.endedReason, "renewal");
  });

  it("falls back to expires when existing has no effectiveFrom", () => {
    const out = decideInsuranceRollover(
      { ...baseExisting, effectiveFrom: null },
      { carrier: "Allstate" },
      "2026-05-03",
    );
    assert.equal(out.historyRow!.effectiveFrom, baseExisting.expires);
  });

  it("caps effectiveTo at today when replacement happens mid-term (before expires)", () => {
    const out = decideInsuranceRollover(
      { ...baseExisting, expires: "2027-01-01" },
      { carrier: "Allstate" },
      "2026-05-03",
    );
    assert.equal(out.historyRow!.effectiveTo, "2026-05-03");
  });
});
