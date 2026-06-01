import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  suggestCategory,
  suggestDocumentDate,
  suggestVendor,
  suggestBuildingAndUnit,
  runSuggestions,
} from "./ocrHeuristics.js";

describe("suggestCategory", () => {
  it("identifies an insurance declaration page", () => {
    const out = suggestCategory(
      "DECLARATIONS PAGE\nPolicy Number: ABC-123\nCarrier: Travelers\nPremium: $12,000",
    );
    assert.equal(out?.value, "Insurance");
    assert.ok((out?.confidence ?? 0) >= 0.5);
  });

  it("identifies inspection reports", () => {
    const out = suggestCategory(
      "Roof inspection report\nInspected by: ACME Roofing\nFindings: flashing damaged near unit 12.",
    );
    assert.equal(out?.value, "Inspection");
  });

  it("identifies meeting minutes", () => {
    const out = suggestCategory(
      "BOARD OF DIRECTORS — MEETING MINUTES\nCalled to order at 7:00pm. Quorum present. Motion carried 5-0.",
    );
    assert.equal(out?.value, "Meeting");
  });

  it("identifies bylaws / CC&Rs", () => {
    const out = suggestCategory(
      "BYLAWS of Quail Valley HOA — Article I — Covenants, Conditions and Restrictions",
    );
    assert.equal(out?.value, "Bylaws");
  });

  it("returns null for unscored text", () => {
    assert.equal(suggestCategory("nothing matching here"), null);
  });
});

describe("suggestDocumentDate", () => {
  it("picks the keyword-adjacent date", () => {
    const text = "Random 2014-01-01 mention.\nEffective Date: 03/15/2018\nFooter 12/31/2099.";
    const out = suggestDocumentDate(text, new Date("2026-05-03"));
    assert.equal(out?.value, "2018-03-15");
  });

  it("parses 'January 5, 2018'", () => {
    const out = suggestDocumentDate("Adopted on January 5, 2018 by the board.", new Date("2026-05-03"));
    assert.equal(out?.value, "2018-01-05");
  });

  it("parses ISO dates", () => {
    const out = suggestDocumentDate("Date: 2014-07-21", new Date("2026-05-03"));
    assert.equal(out?.value, "2014-07-21");
  });

  it("rejects future-far dates", () => {
    const out = suggestDocumentDate("12/31/2099", new Date("2026-05-03"));
    assert.equal(out, null);
  });

  it("returns null when no date found", () => {
    assert.equal(suggestDocumentDate("no dates here", new Date("2026-05-03")), null);
  });
});

describe("suggestVendor", () => {
  const vendors = [
    { id: 1, name: "ACME Roofing" },
    { id: 2, name: "Allstate Insurance" },
    { id: 3, name: "Bob" }, // too short — should not match alone
  ];

  it("matches a vendor by exact substring", () => {
    const out = suggestVendor("Invoice from ACME Roofing dated 2018-01-01", vendors);
    assert.equal(out?.value, 1);
    assert.equal(out?.name, "ACME Roofing");
  });

  it("falls back to multi-token overlap", () => {
    const out = suggestVendor("Provided by Allstate North America Insurance Group, LLC.", vendors);
    assert.equal(out?.value, 2);
  });

  it("returns null when no vendor matches", () => {
    assert.equal(suggestVendor("nothing here", vendors), null);
  });
});

describe("suggestBuildingAndUnit", () => {
  const buildings = [
    { num: 1, address: "100 Quail Ridge Dr", street: "Quail Ridge Dr" },
    { num: 12, address: "1200 Mockingbird Ln", street: "Mockingbird Ln" },
  ];
  const units = [
    { id: "U-1-A", building: 1, unit: "A", address: "100 Quail Ridge Dr Apt A" },
    { id: "U-12-B", building: 12, unit: "B", address: "1200 Mockingbird Ln Apt B" },
  ];

  it("detects 'Bldg 12' style references", () => {
    const out = suggestBuildingAndUnit("Roof repair scheduled for Bldg 12 next month.", buildings, units);
    assert.equal(out.building?.value, 12);
  });

  it("matches a unit by 'Unit B' near building 12", () => {
    const out = suggestBuildingAndUnit("Building 12, Unit B — interior leak.", buildings, units);
    assert.equal(out.building?.value, 12);
    assert.equal(out.unit?.value, "U-12-B");
  });

  it("matches a building by street fallback", () => {
    const out = suggestBuildingAndUnit("Located on Mockingbird Ln near the pool.", buildings, units);
    assert.equal(out.building?.value, 12);
  });

  it("returns null on no match", () => {
    const out = suggestBuildingAndUnit("nothing relevant here", buildings, units);
    assert.equal(out.building, null);
    assert.equal(out.unit, null);
  });
});

describe("runSuggestions", () => {
  it("combines all heuristics", () => {
    const out = runSuggestions({
      text: "Roof inspection report dated March 15, 2018 for Bldg 12, performed by ACME Roofing.",
      vendors: [{ id: 1, name: "ACME Roofing" }],
      buildings: [{ num: 12, address: "1200 Mockingbird Ln", street: "Mockingbird Ln" }],
      units: [],
      today: new Date("2026-05-03"),
    });
    assert.equal(out.category?.value, "Inspection");
    assert.equal(out.documentDate?.value, "2018-03-15");
    assert.equal(out.vendor?.value, 1);
    assert.equal(out.building?.value, 12);
  });
});
