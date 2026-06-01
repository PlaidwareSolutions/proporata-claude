// Pure logic helpers extracted from `ocrScheduler.ts` so they can be unit
// tested without spinning up the database. The runtime scheduler in
// `ocrScheduler.ts` composes these with side-effecting DB calls.

export type GateResult = "ok" | "disabled" | "cap_reached";

export interface OrgOcrSettings { enabled: boolean; dailyPageCap: number }

export function applyOrgGate(s: OrgOcrSettings, pagesUsedToday: number): GateResult {
  if (!s.enabled) return "disabled";
  if (pagesUsedToday >= s.dailyPageCap) return "cap_reached";
  return "ok";
}

export function pickNextWithCap<T extends { id: number }>(
  queued: T[],
  ctx: { used: number; cap: number },
): T | null {
  if (ctx.used >= ctx.cap) return null;
  return queued[0] ?? null;
}

export function shouldRetryOrFail(attemptsSoFar: number, maxAttempts: number): "queued" | "failed" {
  return attemptsSoFar >= maxAttempts ? "failed" : "queued";
}

// Pure helper for scheduler retry backoff. `backoffMs[attempts-1]` is the
// minimum wait between the previous attempt's `startedAt` and "now" before
// the job is eligible to be re-claimed. Returns `true` when the job is ready
// to retry.
export function isReadyForRetry(args: {
  attempts: number;
  startedAtMs: number | null;
  nowMs: number;
  backoffMs: number[];
}): boolean {
  if (args.attempts <= 0 || args.startedAtMs == null) return true;
  const idx = Math.min(args.attempts, args.backoffMs.length) - 1;
  const wait = args.backoffMs[idx] ?? 0;
  return args.nowMs - args.startedAtMs >= wait;
}

// Pure helper for mid-flight cap enforcement. Given the running total of
// pages processed and the cap, returns `true` when the scheduler should stop
// claiming new work for this tick.
export function isCapExhausted(pagesUsed: number, cap: number): boolean {
  return pagesUsed >= cap;
}
