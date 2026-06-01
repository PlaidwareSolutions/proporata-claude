// Unit tests for the pure OCR scheduler decision helpers (org gate, queue
// pick + cap, and retry/fail). The full runtime tick is exercised end-to-end
// from `routes/documents.ts` integration; the heuristics live in
// `ocrHeuristics.test.ts`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pickNextWithCap,
  shouldRetryOrFail,
  applyOrgGate,
  isReadyForRetry,
  isCapExhausted,
} from "./ocrSchedulerLogic.js";

describe("pickNextWithCap", () => {
  it("returns the next queued job when under cap", () => {
    const jobs = [{ id: 1 }, { id: 2 }];
    const out = pickNextWithCap(jobs, { used: 100, cap: 1000 });
    assert.deepEqual(out, { id: 1 });
  });

  it("returns null when at or over cap", () => {
    assert.equal(pickNextWithCap([{ id: 1 }], { used: 1000, cap: 1000 }), null);
    assert.equal(pickNextWithCap([{ id: 1 }], { used: 2000, cap: 1000 }), null);
  });

  it("returns null when there are no queued jobs", () => {
    assert.equal(pickNextWithCap([], { used: 0, cap: 1000 }), null);
  });
});

describe("shouldRetryOrFail", () => {
  it("re-queues below max attempts", () => {
    assert.equal(shouldRetryOrFail(1, 3), "queued");
    assert.equal(shouldRetryOrFail(2, 3), "queued");
  });
  it("fails at or above max attempts", () => {
    assert.equal(shouldRetryOrFail(3, 3), "failed");
    assert.equal(shouldRetryOrFail(4, 3), "failed");
  });
});

describe("applyOrgGate", () => {
  it("blocks when ocr disabled at org level", () => {
    assert.equal(applyOrgGate({ enabled: false, dailyPageCap: 1000 }, 0), "disabled");
  });
  it("blocks when daily cap reached", () => {
    assert.equal(applyOrgGate({ enabled: true, dailyPageCap: 1000 }, 1000), "cap_reached");
  });
  it("permits processing when enabled and under cap", () => {
    assert.equal(applyOrgGate({ enabled: true, dailyPageCap: 1000 }, 999), "ok");
  });
});

describe("isReadyForRetry", () => {
  const backoffMs = [30_000, 120_000];
  it("fresh jobs (no prior attempt) are always ready", () => {
    assert.equal(isReadyForRetry({ attempts: 0, startedAtMs: null, nowMs: 0, backoffMs }), true);
  });
  it("first retry waits 30s before becoming ready", () => {
    const now = 1_000_000;
    assert.equal(isReadyForRetry({ attempts: 1, startedAtMs: now - 10_000, nowMs: now, backoffMs }), false);
    assert.equal(isReadyForRetry({ attempts: 1, startedAtMs: now - 30_000, nowMs: now, backoffMs }), true);
  });
  it("second retry waits 2 minutes before becoming ready", () => {
    const now = 1_000_000;
    assert.equal(isReadyForRetry({ attempts: 2, startedAtMs: now - 60_000, nowMs: now, backoffMs }), false);
    assert.equal(isReadyForRetry({ attempts: 2, startedAtMs: now - 120_000, nowMs: now, backoffMs }), true);
  });
});

describe("isCapExhausted", () => {
  it("returns false when under cap", () => {
    assert.equal(isCapExhausted(50, 1000), false);
  });
  it("returns true at and above cap", () => {
    assert.equal(isCapExhausted(1000, 1000), true);
    assert.equal(isCapExhausted(1500, 1000), true);
  });
});
