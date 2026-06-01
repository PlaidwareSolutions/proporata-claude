// Task #62: Board Motions & Voting Engine — pure logic helpers.
//
// The engine is intentionally side-effect-free: callers fetch the motion,
// votes, and active board roster, then ask `evaluateMotion` whether the motion
// is finalizable and what the outcome would be. Routes apply the resulting
// status change in a transaction so the audit trail and downstream actions
// (e.g. applying Stripe keys) stay consistent.

import { createHash } from "crypto";
import type { MotionVotingRule, MotionAttachment } from "@workspace/db/schema";

export type Decision = "approve" | "reject" | "abstain";

export interface VoteCount {
  approve: number;
  reject: number;
  abstain: number;
  total: number;
}

export function tallyVotes(votes: { decision: string }[]): VoteCount {
  const c: VoteCount = { approve: 0, reject: 0, abstain: 0, total: votes.length };
  for (const v of votes) {
    if (v.decision === "approve") c.approve++;
    else if (v.decision === "reject") c.reject++;
    else if (v.decision === "abstain") c.abstain++;
  }
  return c;
}

export interface Evaluation {
  /** Whether the motion can be resolved right now. */
  finalizable: boolean;
  /** When finalizable, the outcome to record. */
  outcome: "adopted" | "rejected" | null;
  /** Counts used to make the call (handy for the UI). */
  tally: VoteCount;
  /** How many board members are required to approve under this rule. */
  needed: number | null;
}

/**
 * Decide whether a motion under `rule` is finalizable given the current
 * `votes` and the active `boardSize`. Always considers two outcomes:
 *  - the motion has gathered enough approvals to pass, or
 *  - even with every uncast vote turning to "approve", it cannot pass.
 */
export function evaluateMotion(
  rule: MotionVotingRule,
  votes: { decision: string }[],
  boardSize: number,
): Evaluation {
  const tally = tallyVotes(votes);
  const cast = tally.approve + tally.reject + tally.abstain;
  const remaining = Math.max(0, boardSize - cast);

  switch (rule.type) {
    case "unanimous": {
      // Every active board member must approve. A single rejection finalizes
      // the motion as rejected immediately.
      if (tally.reject > 0) return { finalizable: true, outcome: "rejected", tally, needed: boardSize };
      if (boardSize > 0 && tally.approve >= boardSize) {
        return { finalizable: true, outcome: "adopted", tally, needed: boardSize };
      }
      return { finalizable: false, outcome: null, tally, needed: boardSize };
    }
    case "majority": {
      const need = Math.floor(boardSize / 2) + 1;
      if (tally.approve >= need) return { finalizable: true, outcome: "adopted", tally, needed: need };
      if (tally.reject >= need) return { finalizable: true, outcome: "rejected", tally, needed: need };
      // If approves can't reach `need` even if every remaining vote is yes,
      // the motion is mathematically rejected.
      if (tally.approve + remaining < need) {
        return { finalizable: true, outcome: "rejected", tally, needed: need };
      }
      return { finalizable: false, outcome: null, tally, needed: need };
    }
    case "supermajority": {
      const threshold = Math.min(1, Math.max(0.5, rule.threshold || 2 / 3));
      const need = Math.ceil(boardSize * threshold);
      if (tally.approve >= need) return { finalizable: true, outcome: "adopted", tally, needed: need };
      if (tally.approve + remaining < need) {
        return { finalizable: true, outcome: "rejected", tally, needed: need };
      }
      return { finalizable: false, outcome: null, tally, needed: need };
    }
    case "single_approver": {
      // A single approve adopts; only finalize as rejected when every active
      // board member has rejected (otherwise an outstanding approver could
      // still flip the outcome).
      if (tally.approve >= 1) return { finalizable: true, outcome: "adopted", tally, needed: 1 };
      if (boardSize > 0 && tally.reject >= boardSize) {
        return { finalizable: true, outcome: "rejected", tally, needed: 1 };
      }
      return { finalizable: false, outcome: null, tally, needed: 1 };
    }
    case "quorum_only": {
      // Once N votes (any flavor) are cast the motion is decided by simple
      // majority of cast votes; ties reject.
      const N = Math.max(1, rule.quorum);
      if (cast >= N) {
        return {
          finalizable: true,
          outcome: tally.approve > tally.reject ? "adopted" : "rejected",
          tally,
          needed: N,
        };
      }
      return { finalizable: false, outcome: null, tally, needed: N };
    }
  }
}

/**
 * Stable content hash used to freeze the body once the first vote is cast.
 * Includes title, body, and any attachment storage keys so swapping a PDF
 * after the vote is also detected.
 */
export function computeBodyHash(opts: {
  title: string;
  body: string;
  attachments?: Array<Pick<MotionAttachment, "storageKey" | "name">>;
}): string {
  const h = createHash("sha256");
  h.update("title:");
  h.update(opts.title ?? "");
  h.update("\nbody:");
  h.update(opts.body ?? "");
  if (opts.attachments && opts.attachments.length) {
    const sorted = [...opts.attachments].sort((a, b) => a.storageKey.localeCompare(b.storageKey));
    for (const a of sorted) {
      h.update("\natt:");
      h.update(a.storageKey);
      h.update(":");
      h.update(a.name ?? "");
    }
  }
  return h.digest("hex");
}

/** Human-readable summary of a voting rule for UI/PDF display. */
export function describeRule(rule: MotionVotingRule): string {
  switch (rule.type) {
    case "unanimous": return "Unanimous (every board member must approve)";
    case "majority": return "Majority (more than half of the board)";
    case "supermajority": return `Supermajority (≥ ${(rule.threshold * 100).toFixed(0)}%)`;
    case "single_approver": return "Single approver (any one board member)";
    case "quorum_only": return `Quorum-only (decides once ${rule.quorum} have voted)`;
  }
}

export function isTerminal(status: string): boolean {
  return status === "adopted" || status === "rejected" || status === "withdrawn" || status === "expired";
}
