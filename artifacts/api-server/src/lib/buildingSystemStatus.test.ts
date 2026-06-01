import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveBuildingSystemStatus } from "./buildingSystemStatus.js";

const NOW = new Date("2026-05-03T00:00:00Z");

describe("deriveBuildingSystemStatus", () => {
  it("returns good when nothing is overdue", () => {
    assert.equal(
      deriveBuildingSystemStatus(
        { warrantyExpiresOn: "2030-01-01", lastInspectedOn: "2026-01-01" },
        NOW,
      ),
      "good",
    );
  });

  it("returns watch when warranty expires within 90 days", () => {
    assert.equal(
      deriveBuildingSystemStatus({ warrantyExpiresOn: "2026-06-15" }, NOW),
      "watch",
    );
  });

  it("returns action when warranty has already expired", () => {
    assert.equal(
      deriveBuildingSystemStatus({ warrantyExpiresOn: "2025-01-01" }, NOW),
      "action",
    );
  });

  it("returns action for retired systems regardless of warranty", () => {
    assert.equal(
      deriveBuildingSystemStatus(
        { warrantyExpiresOn: "2030-01-01", retiredOn: "2026-04-01" },
        NOW,
      ),
      "action",
    );
  });

  it("returns watch when last inspection is between 18 and 24 months old", () => {
    assert.equal(
      deriveBuildingSystemStatus({ lastInspectedOn: "2024-09-01" }, NOW),
      "watch",
    );
  });

  it("returns action when last inspection is over 24 months old", () => {
    assert.equal(
      deriveBuildingSystemStatus({ lastInspectedOn: "2024-01-01" }, NOW),
      "action",
    );
  });

  it("returns good with empty input", () => {
    assert.equal(deriveBuildingSystemStatus({}, NOW), "good");
  });

  it("escalates warranty over inspection (warranty expired beats fresh inspection)", () => {
    assert.equal(
      deriveBuildingSystemStatus(
        { warrantyExpiresOn: "2025-01-01", lastInspectedOn: "2026-04-01" },
        NOW,
      ),
      "action",
    );
  });
});
