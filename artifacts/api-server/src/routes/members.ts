// Membership roster endpoint.
//
// Manager-only listing of one row per unit. The shape comes straight
// from `lib/membership.ts` so the legal-vs-portal distinction stays in
// one place. Tenants are NOT listed here — they are residents but not
// members.

import { Router, type IRouter } from "express";
import {
  authenticateJwt,
  requireAdmin,
  requireManager,
} from "../middleware/auth.js";
import {
  countMembersInGoodStanding,
  listMembers,
  recomputeOwnershipStatuses,
  setOwnershipStatus,
  type OwnershipStatus,
} from "../lib/membership.js";

const router: IRouter = Router();

router.get("/members", authenticateJwt, requireManager, async (_req, res) => {
  try {
    const rows = await listMembers();
    const counts = {
      total: rows.length,
      inGoodStanding: rows.filter((r) => r.inGoodStanding).length,
      notInGoodStanding: rows.filter((r) => !r.inGoodStanding).length,
    };
    res.json({ members: rows, counts });
  } catch (err) {
    console.error("GET /members error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/members/recompute",
  authenticateJwt,
  requireManager,
  async (_req, res) => {
    try {
      const result = await recomputeOwnershipStatuses();
      const counts = await countMembersInGoodStanding();
      res.json({ ...result, ...counts });
    } catch (err) {
      console.error("POST /members/recompute error", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

const VALID_STATUSES = new Set<OwnershipStatus>([
  "active",
  "suspended_voting",
  "closed",
]);

router.patch(
  "/members/:unitId/status",
  authenticateJwt,
  requireAdmin,
  async (req, res) => {
    const unitId = String(req.params.unitId ?? "");
    const body = (req.body ?? {}) as { status?: string; reason?: string };
    if (!body.status || !VALID_STATUSES.has(body.status as OwnershipStatus)) {
      res.status(400).json({
        error: "status must be one of: active, suspended_voting, closed",
      });
      return;
    }
    if (!body.reason || typeof body.reason !== "string" || !body.reason.trim()) {
      res.status(400).json({ error: "reason is required" });
      return;
    }
    const result = await setOwnershipStatus({
      unitId,
      status: body.status as OwnershipStatus,
      reason: body.reason.trim(),
      actorUserId: req.user!.id,
    });
    if (!result.ok) {
      res.status(404).json(result);
      return;
    }
    res.json({ ok: true });
  },
);

export default router;
