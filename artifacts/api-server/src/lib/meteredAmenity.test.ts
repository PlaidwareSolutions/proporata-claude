import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeIdleMinutes, computeSessionCost } from "./meteredAmenity.js";

describe("computeSessionCost", () => {
  it("returns zeros for a zero-kWh, no-idle session", () => {
    const out = computeSessionCost({
      kwh: 0,
      perKwhCents: 35,
      idleMinutes: 0,
      idlePerMinuteCents: 40,
      idleCapCents: 2000,
    });
    assert.deepEqual(out, { energyCostCents: 0, idleCostCents: 0, totalCostCents: 0 });
  });

  it("rounds energy cost to whole cents (banker-agnostic, half-away-from-zero)", () => {
    // 1.234 kWh * 35 c/kWh = 43.19 -> 43
    const a = computeSessionCost({
      kwh: 1.234,
      perKwhCents: 35,
      idleMinutes: 0,
      idlePerMinuteCents: 0,
      idleCapCents: 0,
    });
    assert.equal(a.energyCostCents, 43);
    // 0.015 kWh * 100 c/kWh = 1.5 -> 2 (Math.round)
    const b = computeSessionCost({
      kwh: 0.015,
      perKwhCents: 100,
      idleMinutes: 0,
      idlePerMinuteCents: 0,
      idleCapCents: 0,
    });
    assert.equal(b.energyCostCents, 2);
    // 0.014 kWh * 100 c/kWh = 1.4 -> 1
    const c = computeSessionCost({
      kwh: 0.014,
      perKwhCents: 100,
      idleMinutes: 0,
      idlePerMinuteCents: 0,
      idleCapCents: 0,
    });
    assert.equal(c.energyCostCents, 1);
  });

  it("handles partial kWh below 1 with positive cost", () => {
    const out = computeSessionCost({
      kwh: 0.5,
      perKwhCents: 50,
      idleMinutes: 0,
      idlePerMinuteCents: 0,
      idleCapCents: 0,
    });
    assert.equal(out.energyCostCents, 25);
    assert.equal(out.totalCostCents, 25);
  });

  it("clamps idle fees at the configured cap", () => {
    // 100 minutes * 40c = 4000c, but cap is 2000c
    const out = computeSessionCost({
      kwh: 10,
      perKwhCents: 35,
      idleMinutes: 100,
      idlePerMinuteCents: 40,
      idleCapCents: 2000,
    });
    assert.equal(out.idleCostCents, 2000, "idle fee should saturate at cap");
    assert.equal(out.energyCostCents, 350);
    assert.equal(out.totalCostCents, 2350);
  });

  it("does not apply a cap when idleCapCents is zero (treated as no cap)", () => {
    const out = computeSessionCost({
      kwh: 0,
      perKwhCents: 0,
      idleMinutes: 30,
      idlePerMinuteCents: 25,
      idleCapCents: 0,
    });
    assert.equal(out.idleCostCents, 750);
  });

  it("treats negative kwh as zero", () => {
    const out = computeSessionCost({
      kwh: -5,
      perKwhCents: 40,
      idleMinutes: 0,
      idlePerMinuteCents: 0,
      idleCapCents: 0,
    });
    assert.equal(out.energyCostCents, 0);
  });

  it("treats negative idle minutes/rates as zero", () => {
    const out = computeSessionCost({
      kwh: 1,
      perKwhCents: 30,
      idleMinutes: -5,
      idlePerMinuteCents: -10,
      idleCapCents: 1000,
    });
    assert.equal(out.idleCostCents, 0);
    assert.equal(out.energyCostCents, 30);
  });
});

describe("computeIdleMinutes", () => {
  it("returns 0 when scheduledEndAt or endAt is missing", () => {
    assert.equal(
      computeIdleMinutes({ scheduledEndAt: null, endAt: "2025-01-01T00:00:00Z", idleGraceMinutes: 10 }),
      0,
    );
    assert.equal(
      computeIdleMinutes({ scheduledEndAt: "2025-01-01T00:00:00Z", endAt: null, idleGraceMinutes: 10 }),
      0,
    );
  });

  it("returns 0 when ending before scheduled end (early stop)", () => {
    const out = computeIdleMinutes({
      scheduledEndAt: "2025-01-01T01:00:00Z",
      endAt: "2025-01-01T00:30:00Z",
      idleGraceMinutes: 10,
    });
    assert.equal(out, 0);
  });

  it("returns 0 when overrun is within the grace window", () => {
    const out = computeIdleMinutes({
      scheduledEndAt: "2025-01-01T01:00:00Z",
      endAt: "2025-01-01T01:09:00Z",
      idleGraceMinutes: 10,
    });
    assert.equal(out, 0);
  });

  it("ceils overrun beyond grace to whole minutes", () => {
    // 25 minutes past, grace 10 -> 15 idle minutes
    const a = computeIdleMinutes({
      scheduledEndAt: "2025-01-01T01:00:00Z",
      endAt: "2025-01-01T01:25:00Z",
      idleGraceMinutes: 10,
    });
    assert.equal(a, 15);
    // 25min 30s past, grace 10 -> ceil(15.5) = 16
    const b = computeIdleMinutes({
      scheduledEndAt: "2025-01-01T01:00:00Z",
      endAt: "2025-01-01T01:25:30Z",
      idleGraceMinutes: 10,
    });
    assert.equal(b, 16);
  });

  it("handles a zero grace window correctly", () => {
    const out = computeIdleMinutes({
      scheduledEndAt: "2025-01-01T01:00:00Z",
      endAt: "2025-01-01T01:05:00Z",
      idleGraceMinutes: 0,
    });
    assert.equal(out, 5);
  });

  it("returns 0 for invalid timestamps", () => {
    const out = computeIdleMinutes({
      scheduledEndAt: "not-a-date",
      endAt: "also-bad",
      idleGraceMinutes: 0,
    });
    assert.equal(out, 0);
  });
});
