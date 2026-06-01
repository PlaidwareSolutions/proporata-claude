import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aggregateVendorFiles, filterVendorFiles } from "./vendorFiles.js";

describe("aggregateVendorFiles", () => {
  it("returns empty array when no inputs", () => {
    const out = aggregateVendorFiles({
      certificates: [],
      contracts: [],
      workOrderAttachments: [],
      bidQuotes: [],
      documents: [],
    });
    assert.deepEqual(out, []);
  });

  it("skips certificates without storage keys", () => {
    const out = aggregateVendorFiles({
      certificates: [
        { id: 1, kind: "coi", documentStorageKey: null, expiresOn: "2027-01-01", createdAt: "2026-01-01" },
      ],
      contracts: [],
      workOrderAttachments: [],
      bidQuotes: [],
      documents: [],
    });
    assert.equal(out.length, 0);
  });

  it("emits up to three rows per bid quote", () => {
    const out = aggregateVendorFiles({
      certificates: [],
      contracts: [],
      workOrderAttachments: [],
      bidQuotes: [
        {
          id: 9,
          bidRequestId: 4,
          licenseStorageKey: "k/lic",
          coiStorageKey: "k/coi",
          quotePdfStorageKey: "k/quote",
          submittedAt: "2026-03-01",
        },
      ],
      documents: [],
    });
    assert.equal(out.length, 3);
    assert.deepEqual(
      out.map((f) => f.kind).sort(),
      ["COI (bid)", "License (bid)", "Quote PDF"],
    );
  });

  it("sorts the unified list newest first across sources", () => {
    const out = aggregateVendorFiles({
      certificates: [
        { id: 1, kind: "coi", documentStorageKey: "k1", expiresOn: "2027-01-01", createdAt: "2026-01-01" },
      ],
      contracts: [
        { id: 2, title: "Annual landscaping", contractDocStorageKey: "k2", createdAt: "2026-04-01" },
      ],
      workOrderAttachments: [
        { id: 3, workOrderId: "WO-1", name: "photo.jpg", storageKey: "k3", uploadedAt: "2026-02-15" },
      ],
      bidQuotes: [],
      documents: [
        { id: "D-1", name: "Old quote", category: "Vendor", storageKey: "k4", uploaded: "2025-11-01" },
      ],
    });
    assert.deepEqual(
      out.map((f) => f.id),
      ["contract-2", "woa-3", "cert-1", "doc-D-1"],
    );
  });

  it("preserves cross-link ids for deep linking", () => {
    const out = aggregateVendorFiles({
      certificates: [],
      contracts: [],
      workOrderAttachments: [
        { id: 7, workOrderId: "WO-42", name: "invoice.pdf", storageKey: "k", uploadedAt: "2026-04-01" },
      ],
      bidQuotes: [],
      documents: [],
    });
    assert.equal(out[0]!.linkedEntityType, "work_order");
    assert.equal(out[0]!.linkedEntityId, "WO-42");
  });
});

describe("filterVendorFiles", () => {
  const files = [
    { id: "a", source: "certificate" as const, kind: "COI", name: "COI 2025", storageKey: "k", uploadedAt: "2025-08-01", linkedEntityType: "certificate" as const, linkedEntityId: "1" },
    { id: "b", source: "contract" as const, kind: "Contract", name: "Master MSA", storageKey: "k", uploadedAt: "2024-01-15", linkedEntityType: "contract" as const, linkedEntityId: "2" },
    { id: "c", source: "work_order" as const, kind: "WO attachment", name: "Invoice WO-42", storageKey: "k", uploadedAt: "2025-03-12", linkedEntityType: "work_order" as const, linkedEntityId: "WO-42" },
  ];

  it("filters by source", () => {
    assert.deepEqual(filterVendorFiles(files, { source: "contract" }).map((f) => f.id), ["b"]);
  });
  it("filters by year", () => {
    assert.deepEqual(filterVendorFiles(files, { year: 2025 }).map((f) => f.id).sort(), ["a", "c"]);
  });
  it("filters by case-insensitive query against name and kind", () => {
    assert.deepEqual(filterVendorFiles(files, { q: "msa" }).map((f) => f.id), ["b"]);
    assert.deepEqual(filterVendorFiles(files, { q: "COI" }).map((f) => f.id), ["a"]);
  });
  it("combines filters", () => {
    assert.deepEqual(filterVendorFiles(files, { year: 2025, source: "certificate" }).map((f) => f.id), ["a"]);
  });
});
