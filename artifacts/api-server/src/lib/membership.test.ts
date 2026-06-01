// Eligibility helpers. We unit-test the pieces that don't require a
// live Postgres: FIFO past-due derivation, the pure
// `classifyEligibility` decision (every owner/tenant/manager/unitless
// branch), and aging math. The DB-backed wrapper
// `isMemberInGoodStanding` and the /api/members routes are exercised
// at the route-level test layer.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyEligibility,
  computeAging,
  hasAgedUnpaidCharge,
} from "./membership.js";

const NOW = new Date("2025-04-01T00:00:00Z");

describe("hasAgedUnpaidCharge", () => {
  it("returns false when there are no entries", () => {
    assert.equal(hasAgedUnpaidCharge([], 60, NOW), false);
  });

  it("returns false when a charge is fully paid even if it's old", () => {
    const entries = [
      { kind: "charge", occurredOn: "2024-01-01", amountCents: 25000 },
      { kind: "payment", occurredOn: "2024-01-05", amountCents: 25000 },
    ];
    assert.equal(hasAgedUnpaidCharge(entries, 60, NOW), false);
  });

  it("returns true when an unpaid charge is older than the threshold", () => {
    // 90 days before NOW, threshold 60 → aged.
    const entries = [
      { kind: "charge", occurredOn: "2025-01-01", amountCents: 25000 },
    ];
    assert.equal(hasAgedUnpaidCharge(entries, 60, NOW), true);
  });

  it("returns false when the only unpaid charge is within the threshold", () => {
    // 20 days before NOW, threshold 60 → still in window.
    const entries = [
      { kind: "charge", occurredOn: "2025-03-12", amountCents: 25000 },
    ];
    assert.equal(hasAgedUnpaidCharge(entries, 60, NOW), false);
  });

  it("applies payments FIFO so the oldest charge clears first", () => {
    const entries = [
      { kind: "charge", occurredOn: "2025-01-01", amountCents: 25000 }, // aged
      { kind: "charge", occurredOn: "2025-03-25", amountCents: 25000 }, // recent
      { kind: "payment", occurredOn: "2025-03-26", amountCents: 25000 },
    ];
    // Payment clears the OLD charge (FIFO), so the remaining unpaid
    // charge is recent and we are NOT aged-out.
    assert.equal(hasAgedUnpaidCharge(entries, 60, NOW), false);
  });

  it("treats credit balances as available for future charges", () => {
    const entries = [
      { kind: "payment", occurredOn: "2024-12-01", amountCents: 50000 }, // overpay/credit
      { kind: "charge", occurredOn: "2025-01-01", amountCents: 25000 }, // consumed by credit
    ];
    assert.equal(hasAgedUnpaidCharge(entries, 60, NOW), false);
  });

  it("respects the configured threshold (180 days)", () => {
    const entries = [
      { kind: "charge", occurredOn: "2025-01-01", amountCents: 25000 },
    ];
    // 90 days < 180-day threshold
    assert.equal(hasAgedUnpaidCharge(entries, 180, NOW), false);
  });

  it("the boundary day flips the result", () => {
    const entries = [
      // exactly 60 days before NOW → boundary. <= cutoff means aged.
      { kind: "charge", occurredOn: "2025-01-31", amountCents: 25000 },
    ];
    assert.equal(hasAgedUnpaidCharge(entries, 60, NOW), true);
  });
});

describe("classifyEligibility", () => {
  const user = { id: 7, email: "owner@example.com", role: "user" };

  it("rejects anonymous (no user) as not-a-member, not-good-standing", () => {
    const r = classifyEligibility({
      user: null,
      userEmail: null,
      ownedUnitId: null,
      ownershipStatus: null,
      hasOwnerAccount: false,
    });
    assert.equal(r.isMember, false);
    assert.equal(r.inGoodStanding, false);
  });

  it("owner with ownership_status=active is a member in good standing", () => {
    const r = classifyEligibility({
      user,
      userEmail: "owner@example.com",
      ownedUnitId: "B1-101",
      ownershipStatus: "active",
      hasOwnerAccount: true,
    });
    assert.equal(r.isMember, true);
    assert.equal(r.inGoodStanding, true);
    assert.equal(r.reason, "ok");
    assert.equal(r.unitId, "B1-101");
  });

  it("owner with ownership_status=suspended_voting is a member but NOT in good standing", () => {
    const r = classifyEligibility({
      user,
      userEmail: "owner@example.com",
      ownedUnitId: "B1-101",
      ownershipStatus: "suspended_voting",
      hasOwnerAccount: true,
    });
    assert.equal(r.isMember, true);
    assert.equal(r.inGoodStanding, false);
    assert.equal(r.reason, "suspended_voting");
  });

  it("owner with ownership_status=closed is NOT a member", () => {
    const r = classifyEligibility({
      user,
      userEmail: "owner@example.com",
      ownedUnitId: "B1-101",
      ownershipStatus: "closed",
      hasOwnerAccount: true,
    });
    assert.equal(r.isMember, false);
    assert.equal(r.inGoodStanding, false);
    assert.equal(r.reason, "closed");
  });

  it("tenant (no owned unit) is rejected with reason=not_owner", () => {
    const r = classifyEligibility({
      user: { id: 22, email: "tenant@example.com" },
      userEmail: "tenant@example.com",
      ownedUnitId: null,
      ownershipStatus: null,
      hasOwnerAccount: false,
    });
    assert.equal(r.isMember, false);
    assert.equal(r.inGoodStanding, false);
    assert.equal(r.reason, "not_owner");
  });

  it("manager/admin without an owned unit is NOT a member", () => {
    const r = classifyEligibility({
      user: { id: 9, email: "mgr@example.com", role: "manager" },
      userEmail: "mgr@example.com",
      ownedUnitId: null,
      ownershipStatus: null,
      hasOwnerAccount: false,
    });
    assert.equal(r.isMember, false);
    assert.equal(r.inGoodStanding, false);
    assert.equal(r.reason, "not_owner");
  });

  it("user with no email is rejected with reason=not_owner", () => {
    const r = classifyEligibility({
      user,
      userEmail: null,
      ownedUnitId: null,
      ownershipStatus: null,
      hasOwnerAccount: false,
    });
    assert.equal(r.isMember, false);
    assert.equal(r.inGoodStanding, false);
    assert.equal(r.reason, "not_owner");
  });

  it("owner whose unit has NO owner_account row is NOT in good standing", () => {
    const r = classifyEligibility({
      user,
      userEmail: "owner@example.com",
      ownedUnitId: "B1-101",
      ownershipStatus: null,
      hasOwnerAccount: false,
    });
    assert.equal(r.isMember, false);
    assert.equal(r.inGoodStanding, false);
    assert.equal(r.reason, "no_owner_account");
  });

  it("owner with missing ownership_status defaults to active+good-standing (legacy rows)", () => {
    const r = classifyEligibility({
      user,
      userEmail: "owner@example.com",
      ownedUnitId: "B1-101",
      ownershipStatus: null,
      hasOwnerAccount: true,
    });
    assert.equal(r.isMember, true);
    assert.equal(r.inGoodStanding, true);
  });
});

describe("computeAging", () => {
  it("reports zero balance and zero days past due on an empty ledger", () => {
    const a = computeAging([], NOW);
    assert.equal(a.balanceCents, 0);
    assert.equal(a.daysPastDue, 0);
    assert.equal(a.oldestUnpaidChargeAt, null);
  });

  it("computes oldest unpaid charge and days past due", () => {
    const a = computeAging(
      [{ kind: "charge", occurredOn: "2025-01-01", amountCents: 25000 }],
      NOW,
    );
    assert.equal(a.balanceCents, 25000);
    assert.equal(a.oldestUnpaidChargeAt, "2025-01-01");
    assert.equal(a.daysPastDue, 90);
  });

  it("zeroes out aging when payments cover all charges and leaves a credit", () => {
    const a = computeAging(
      [
        { kind: "charge", occurredOn: "2025-01-01", amountCents: 25000 },
        { kind: "payment", occurredOn: "2025-01-05", amountCents: 30000 },
      ],
      NOW,
    );
    assert.equal(a.balanceCents, -5000);
    assert.equal(a.oldestUnpaidChargeAt, null);
    assert.equal(a.daysPastDue, 0);
  });
});
