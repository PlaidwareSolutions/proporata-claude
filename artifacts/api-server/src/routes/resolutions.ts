// Task #63: Board Resolutions Library — REST routes.
//
// Resolutions wrap motions of kind "resolution". Drafting a resolution
// drafts the underlying motion; adopting the motion numbers the
// resolution and generates its PDF (handled in lib/resolutions.ts via
// the motion finalize hook).

import { Router, type IRouter } from "express";
import { Readable } from "stream";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import {
  resolutionsTable,
  motionsTable,
  motionVotesTable,
  usersTable,
  type MotionVotingRule,
} from "@workspace/db/schema";
import { and, asc, desc, eq, inArray, ilike, or } from "drizzle-orm";
import { authenticateJwt, requireManagerOrBoardMember } from "../middleware/auth.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { describeRule } from "../lib/motions.js";
import {
  RESOLUTION_CATEGORIES,
  isResolutionCategory,
  deriveStatus,
  type ResolutionStatus,
} from "../lib/resolutions.js";

const router: IRouter = Router();
const storage = new ObjectStorageService();

function nowISO(): string { return new Date().toISOString(); }

// Owners (plain residents) get a read-only adopted-only view; managers, admins,
// and board members keep full visibility (drafts, rejected, superseded, etc.).
async function isPrivilegedReader(req: Request): Promise<boolean> {
  if (!req.user) return false;
  const [row] = await db
    .select({ role: usersTable.role, pending: usersTable.pending, boardMember: usersTable.boardMember })
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id));
  if (!row || row.pending) return false;
  return row.role === "admin" || row.role === "manager" || row.boardMember === true;
}

async function requireResolutionReader(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [row] = await db
    .select({ pending: usersTable.pending })
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id));
  if (!row || row.pending) { res.status(403).json({ error: "Forbidden" }); return; }
  next();
}
function parseRule(raw: unknown): MotionVotingRule {
  // Resolution default = majority of board, but allow override.
  if (!raw || typeof raw !== "object") return { type: "majority" };
  const r = raw as { type?: string; threshold?: number; quorum?: number };
  if (r.type === "supermajority") return { type: "supermajority", threshold: Math.min(1, Math.max(0.5, r.threshold ?? 2 / 3)) };
  if (r.type === "quorum_only") return { type: "quorum_only", quorum: Math.max(1, Math.floor(r.quorum ?? 1)) };
  if (r.type === "unanimous" || r.type === "single_approver" || r.type === "majority") return { type: r.type };
  return { type: "majority" };
}

interface ResolutionRow {
  id: number;
  motionId: number;
  number: string | null;
  category: string;
  title: string;
  body: string;
  status: ResolutionStatus;
  motionStatus: string;
  votingRule: MotionVotingRule;
  votingRuleDescription: string;
  createdByName: string;
  createdAt: string;
  adoptedAt: string | null;
  closesAt: string | null;
  supersededByResolutionId: number | null;
  rescindedByMotionId: number | null;
  pdfStorageKey: string | null;
  public: boolean;
  tally: { approve: number; reject: number; abstain: number };
}

async function buildRow(resolutionId: number): Promise<ResolutionRow | null> {
  const [r] = await db.select().from(resolutionsTable).where(eq(resolutionsTable.id, resolutionId));
  if (!r) return null;
  const [m] = await db.select().from(motionsTable).where(eq(motionsTable.id, r.motionId));
  if (!m) return null;
  const votes = await db.select().from(motionVotesTable).where(eq(motionVotesTable.motionId, m.id));
  const status = await deriveStatus({
    motionStatus: m.status,
    rescindedByMotionId: r.rescindedByMotionId,
    supersededByResolutionId: r.supersededByResolutionId,
  });
  return {
    id: r.id, motionId: r.motionId, number: r.number, category: r.category,
    title: m.title, body: m.body, status, motionStatus: m.status,
    votingRule: m.votingRule as MotionVotingRule,
    votingRuleDescription: describeRule(m.votingRule as MotionVotingRule),
    createdByName: m.createdByName, createdAt: r.createdAt,
    adoptedAt: r.adoptedAt, closesAt: m.closesAt,
    supersededByResolutionId: r.supersededByResolutionId,
    rescindedByMotionId: r.rescindedByMotionId,
    pdfStorageKey: r.pdfStorageKey,
    public: r.public ?? false,
    tally: {
      approve: votes.filter((v) => v.decision === "approve").length,
      reject: votes.filter((v) => v.decision === "reject").length,
      abstain: votes.filter((v) => v.decision === "abstain").length,
    },
  };
}

// ── List ────────────────────────────────────────────────────────────────────
router.get("/resolutions", authenticateJwt, requireResolutionReader, async (req, res) => {
  const privileged = await isPrivilegedReader(req);
  // Owners always see only the active adopted set.
  const status = privileged
    ? (req.query.status as string | undefined)?.toLowerCase()
    : "active";
  const category = (req.query.category as string | undefined)?.toLowerCase();
  const search = (req.query.search as string | undefined)?.trim();

  const where = [];
  if (category && isResolutionCategory(category)) where.push(eq(resolutionsTable.category, category));
  let rows = await db.select().from(resolutionsTable)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(resolutionsTable.id));

  // Join motion info for filtering by status/search.
  const motionIds = rows.map((r) => r.motionId);
  const motions = motionIds.length
    ? await db.select().from(motionsTable).where(inArray(motionsTable.id, motionIds))
    : [];
  const mById = new Map(motions.map((m) => [m.id, m]));

  let built: ResolutionRow[] = [];
  for (const r of rows) {
    const row = await buildRow(r.id);
    if (row) built.push(row);
  }

  if (status && status !== "all") {
    if (status === "active") {
      built = built.filter((b) => b.status === "adopted");
    } else {
      built = built.filter((b) => b.status === status);
    }
  } else {
    // Default: hide superseded from "all"? Task says "filtered out of Active by default".
    // Leave "all" inclusive; only "active" filter excludes superseded/rescinded.
  }
  if (search) {
    const q = search.toLowerCase();
    built = built.filter((b) =>
      b.title.toLowerCase().includes(q) ||
      (b.number ?? "").toLowerCase().includes(q));
  }
  // Suppress unused warning for `mById` (kept for future denorm).
  void mById;
  res.json(built);
});

// ── Get one ─────────────────────────────────────────────────────────────────
router.get("/resolutions/:id", authenticateJwt, requireResolutionReader, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const row = await buildRow(id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const privileged = await isPrivilegedReader(req);
  if (!privileged && row.status !== "adopted") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Resolve chain (what supersedes me, who I supersede)
  let supersedes: { id: number; number: string | null; title: string } | null = null;
  let supersededBy: { id: number; number: string | null; title: string } | null = null;
  // "supersedes": find any older row whose superseded_by_resolution_id == this.id
  const supRows = await db.select().from(resolutionsTable)
    .where(eq(resolutionsTable.supersededByResolutionId, id));
  if (supRows.length) {
    const m = await db.select().from(motionsTable).where(eq(motionsTable.id, supRows[0]!.motionId));
    supersedes = { id: supRows[0]!.id, number: supRows[0]!.number, title: m[0]?.title ?? "" };
  }
  if (row.supersededByResolutionId) {
    const [other] = await db.select().from(resolutionsTable).where(eq(resolutionsTable.id, row.supersededByResolutionId));
    if (other) {
      const [om] = await db.select().from(motionsTable).where(eq(motionsTable.id, other.motionId));
      supersededBy = { id: other.id, number: other.number, title: om?.title ?? "" };
    }
  }
  res.json({ ...row, supersedes, supersededBy });
});

// ── Create draft ────────────────────────────────────────────────────────────
router.post("/resolutions", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const body = req.body as {
    title?: string; body?: string; category?: string;
    votingRule?: unknown; closesAt?: string | null; supersedesResolutionId?: number;
  };
  const title = body.title?.trim();
  const cat = (body.category ?? "other").toLowerCase();
  if (!title) { res.status(400).json({ error: "title required" }); return; }
  if (!isResolutionCategory(cat)) { res.status(400).json({ error: "category invalid" }); return; }
  const rule = parseRule(body.votingRule);
  const created = nowISO();
  const out = await db.transaction(async (tx) => {
    const [motion] = await tx.insert(motionsTable).values({
      kind: "resolution",
      title,
      body: body.body ?? "",
      votingRule: rule,
      status: "draft",
      createdByUserId: req.user!.id,
      createdByName: req.user!.name || req.user!.email,
      createdAt: created,
      closesAt: body.closesAt ?? null,
      payload: { category: cat },
    }).returning();
    const [r] = await tx.insert(resolutionsTable).values({
      motionId: motion!.id,
      category: cat,
      createdAt: created,
    }).returning();
    return { resolutionId: r!.id, motionId: motion!.id };
  });
  // Link supersedes outside the txn (only if the target exists)
  if (body.supersedesResolutionId) {
    await db.update(resolutionsTable)
      .set({ supersededByResolutionId: out.resolutionId })
      .where(eq(resolutionsTable.id, body.supersedesResolutionId));
  }
  res.status(201).json({ id: out.resolutionId, motionId: out.motionId });
});

// ── Mark another resolution as superseded by this one ───────────────────────
router.post("/resolutions/:id/supersede", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  const targetId = Number((req.body as { targetResolutionId?: number }).targetResolutionId);
  if (!Number.isFinite(id) || !Number.isFinite(targetId)) {
    res.status(400).json({ error: "id and targetResolutionId required" }); return;
  }
  if (id === targetId) { res.status(400).json({ error: "A resolution cannot supersede itself" }); return; }
  const [me] = await db.select().from(resolutionsTable).where(eq(resolutionsTable.id, id));
  const [target] = await db.select().from(resolutionsTable).where(eq(resolutionsTable.id, targetId));
  if (!me || !target) { res.status(404).json({ error: "Not found" }); return; }
  if (!me.number) { res.status(409).json({ error: "Only an adopted resolution can supersede another" }); return; }
  await db.update(resolutionsTable)
    .set({ supersededByResolutionId: id })
    .where(eq(resolutionsTable.id, targetId));
  res.json({ ok: true });
});

// ── Create a follow-up rescind motion ───────────────────────────────────────
router.post("/resolutions/:id/rescind", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [r] = await db.select().from(resolutionsTable).where(eq(resolutionsTable.id, id));
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  if (!r.number) { res.status(409).json({ error: "Only an adopted resolution can be rescinded" }); return; }
  if (r.rescindedByMotionId) { res.status(409).json({ error: "A rescind motion already exists" }); return; }
  const body = req.body as { reason?: string; votingRule?: unknown; closesAt?: string | null };
  const rule = parseRule(body.votingRule);
  const created = nowISO();
  const out = await db.transaction(async (tx) => {
    const [motion] = await tx.insert(motionsTable).values({
      kind: "rescind_resolution",
      title: `Rescind Resolution ${r.number}`,
      body: body.reason ?? "",
      votingRule: rule,
      status: "draft",
      createdByUserId: req.user!.id,
      createdByName: req.user!.name || req.user!.email,
      createdAt: created,
      closesAt: body.closesAt ?? null,
      payload: { targetResolutionId: r.id },
    }).returning();
    await tx.update(resolutionsTable)
      .set({ rescindedByMotionId: motion!.id })
      .where(eq(resolutionsTable.id, r.id));
    return { motionId: motion!.id };
  });
  res.status(201).json(out);
});

// ── Adopted PDF download ────────────────────────────────────────────────────
router.get("/resolutions/:id/pdf", authenticateJwt, requireResolutionReader, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [r] = await db.select().from(resolutionsTable).where(eq(resolutionsTable.id, id));
  if (!r || !r.pdfStorageKey) { res.status(404).json({ error: "No adopted PDF" }); return; }
  // Owners can only download the PDF if the resolution is currently adopted (active).
  const privileged = await isPrivilegedReader(req);
  if (!privileged) {
    const row = await buildRow(id);
    if (!row || row.status !== "adopted") { res.status(404).json({ error: "Not found" }); return; }
  }
  try {
    const file = await storage.getObjectEntityFile(r.pdfStorageKey);
    const response = await storage.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.setHeader("Content-Disposition", `attachment; filename="resolution-${r.number}.pdf"`);
    if (response.body) {
      const node = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      node.pipe(res);
    } else { res.end(); }
  } catch {
    res.status(500).json({ error: "Download failed" });
  }
});

// Task #66: Toggle owner visibility on a resolution. Manager-or-board only.
// `public=true` means owners will see the resolution in their Board section
// once it is adopted; `false` keeps it board-only (e.g. personnel matters).
router.patch("/resolutions/:id/visibility", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as { public?: boolean };
  if (typeof body.public !== "boolean") { res.status(400).json({ error: "public boolean required" }); return; }
  const [r] = await db.select().from(resolutionsTable).where(eq(resolutionsTable.id, id));
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  await db.update(resolutionsTable).set({ public: body.public }).where(eq(resolutionsTable.id, id));
  res.json({ ok: true, public: body.public });
});

// Expose category list to the client.
router.get("/resolutions-meta/categories", authenticateJwt, requireResolutionReader, async (_req, res) => {
  res.json(RESOLUTION_CATEGORIES);
});

export default router;
// Suppress unused-import warning when these helpers are imported only for types.
void asc; void or; void ilike;
