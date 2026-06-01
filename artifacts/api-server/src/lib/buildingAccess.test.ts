import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canSeeBuilding, isUnrestricted } from "./buildingAccess.js";

describe("buildingAccess", () => {
  it("treats null buildingIds as unrestricted", () => {
    const a = { buildingIds: null };
    assert.equal(isUnrestricted(a), true);
    assert.equal(canSeeBuilding(a, 1), true);
    assert.equal(canSeeBuilding(a, 99), true);
  });
  it("denies all buildings when array is empty", () => {
    const a = { buildingIds: [] };
    assert.equal(isUnrestricted(a), false);
    assert.equal(canSeeBuilding(a, 1), false);
  });
  it("only allows listed buildings", () => {
    const a = { buildingIds: [3] };
    assert.equal(canSeeBuilding(a, 3), true);
    assert.equal(canSeeBuilding(a, 4), false);
  });
});
