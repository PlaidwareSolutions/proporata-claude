import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  glossaryTermsTable,
  glossaryRouteMappingsTable,
  glossaryEditHistoryTable,
  glossarySuggestionsTable,
  userOnboardingTable,
  organizationSettingsTable,
  type GlossaryTerm,
  type GlossarySuggestion,
} from "@workspace/db/schema";
import { eq, and, desc, ilike, or, inArray } from "drizzle-orm";
import { authenticateJwt, requireManager } from "../middleware/auth.js";
import { notifyGlossarySuggestion } from "../lib/notificationService.js";

const router: IRouter = Router();

const VALID_CATEGORIES = [
  "governance", "maintenance", "property", "compliance", "financials", "community",
] as const;

// Known app routes (used by coverage). Keep aligned with App.tsx.
const KNOWN_ROUTES = [
  "/", "/site-map", "/overview", "/buildings", "/units", "/work-orders",
  "/insurance", "/documents", "/reports", "/reports/amenities", "/settings",
  "/boards", "/communications", "/architectural-requests", "/billing",
  "/billing/payments", "/vendors", "/bids", "/motions", "/resolutions",
  "/amenities", "/mail-room", "/pets", "/ev-charging", "/patrol", "/parking",
  "/fobs", "/pool-tags", "/calendar", "/meetings",
  "/portal/account", "/portal/architectural", "/portal/documents",
  "/portal/board", "/portal/resolutions", "/portal/amenities", "/portal/pets",
  "/portal/mail", "/portal/ev-charging", "/portal/parking",
  "/profile",
];

function nowIso(): string {
  return new Date().toISOString();
}

async function fetchRoutesByTerm(termIds: number[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (termIds.length === 0) return map;
  const rows = await db
    .select()
    .from(glossaryRouteMappingsTable)
    .where(inArray(glossaryRouteMappingsTable.termId, termIds));
  for (const r of rows) {
    const list = map.get(r.termId) ?? [];
    list.push(r.route);
    map.set(r.termId, list);
  }
  return map;
}

function shapeTerm(row: GlossaryTerm, routes: string[]) {
  return {
    id: row.id,
    termKey: row.termKey,
    title: row.title,
    category: row.category,
    shortDef: row.shortDef,
    longDef: row.longDef,
    seeAlsoRoute: row.seeAlsoRoute ?? null,
    published: row.published,
    sortOrder: row.sortOrder,
    routes: routes.slice().sort(),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function shapeTerms(rows: GlossaryTerm[]) {
  const routesByTerm = await fetchRoutesByTerm(rows.map((r) => r.id));
  return rows.map((r) => shapeTerm(r, routesByTerm.get(r.id) ?? []));
}

async function shapeSuggestion(s: GlossarySuggestion) {
  const [term] = await db
    .select({ termKey: glossaryTermsTable.termKey, title: glossaryTermsTable.title })
    .from(glossaryTermsTable)
    .where(eq(glossaryTermsTable.id, s.termId));
  return {
    id: s.id,
    termId: s.termId,
    termKey: term?.termKey ?? "",
    termTitle: term?.title ?? "",
    proposedTitle: s.proposedTitle,
    proposedShortDef: s.proposedShortDef,
    proposedLongDef: s.proposedLongDef,
    reason: s.reason,
    status: s.status,
    submittedByUserId: s.submittedByUserId ?? null,
    submittedByName: s.submittedByName,
    reviewedByUserId: s.reviewedByUserId ?? null,
    reviewedByName: s.reviewedByName,
    reviewNote: s.reviewNote,
    createdAt: s.createdAt,
    reviewedAt: s.reviewedAt ?? null,
  };
}

async function logHistory(termId: number, termKey: string, action: string, actor: { id?: number; name: string }, diff: unknown) {
  await db.insert(glossaryEditHistoryTable).values({
    termId,
    termKey,
    action,
    actorUserId: actor.id ?? null,
    actorName: actor.name,
    diff: (diff ?? null) as never,
    createdAt: nowIso(),
  });
}

// ─── List / search ───────────────────────────────────────────────────────
router.get("/glossary", authenticateJwt, async (req, res) => {
  try {
    const isManager = req.user?.role === "admin" || req.user?.role === "manager";
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const route = typeof req.query.route === "string" ? req.query.route.trim() : "";
    const includeUnpublished = req.query.includeUnpublished === "true";

    const wheres = [] as ReturnType<typeof eq>[];
    if (category && (VALID_CATEGORIES as readonly string[]).includes(category)) {
      wheres.push(eq(glossaryTermsTable.category, category as (typeof VALID_CATEGORIES)[number]));
    }
    if (!isManager || !includeUnpublished) {
      wheres.push(eq(glossaryTermsTable.published, true));
    }
    if (q) {
      const like = `%${q}%`;
      wheres.push(or(
        ilike(glossaryTermsTable.title, like),
        ilike(glossaryTermsTable.shortDef, like),
        ilike(glossaryTermsTable.longDef, like),
        ilike(glossaryTermsTable.termKey, like),
      )!);
    }

    let termRows: GlossaryTerm[];
    if (route) {
      const mapped = await db
        .select({ termId: glossaryRouteMappingsTable.termId })
        .from(glossaryRouteMappingsTable)
        .where(eq(glossaryRouteMappingsTable.route, route));
      const ids = mapped.map((m) => m.termId);
      if (ids.length === 0) {
        res.json([]);
        return;
      }
      wheres.push(inArray(glossaryTermsTable.id, ids));
    }

    termRows = await db
      .select()
      .from(glossaryTermsTable)
      .where(wheres.length ? and(...wheres) : undefined)
      .orderBy(glossaryTermsTable.sortOrder, glossaryTermsTable.title);

    res.json(await shapeTerms(termRows));
  } catch (err) {
    console.error("GET /glossary", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Coverage (manager+) ─────────────────────────────────────────────────
router.get("/glossary/coverage", authenticateJwt, requireManager, async (_req, res) => {
  try {
    const allTerms = await db
      .select({ id: glossaryTermsTable.id, termKey: glossaryTermsTable.termKey, title: glossaryTermsTable.title })
      .from(glossaryTermsTable)
      .where(eq(glossaryTermsTable.published, true));
    const allMappings = await db.select().from(glossaryRouteMappingsTable);

    const routeSet = new Set(allMappings.map((m) => m.route));
    const termIdsWithRoutes = new Set(allMappings.map((m) => m.termId));
    const pagesWithoutTerms = KNOWN_ROUTES.filter((r) => !routeSet.has(r));
    const termsWithoutPages = allTerms
      .filter((t) => !termIdsWithRoutes.has(t.id))
      .map((t) => ({ termKey: t.termKey, title: t.title }));

    res.json({
      pagesWithoutTerms,
      termsWithoutPages,
      knownPages: KNOWN_ROUTES,
    });
  } catch (err) {
    console.error("GET /glossary/coverage", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Suggestions ─────────────────────────────────────────────────────────
router.get("/glossary/suggestions", authenticateJwt, requireManager, async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const wheres = [] as ReturnType<typeof eq>[];
    if (status === "pending" || status === "accepted" || status === "rejected") {
      wheres.push(eq(glossarySuggestionsTable.status, status));
    }
    const rows = await db
      .select()
      .from(glossarySuggestionsTable)
      .where(wheres.length ? and(...wheres) : undefined)
      .orderBy(desc(glossarySuggestionsTable.createdAt));
    const out = await Promise.all(rows.map(shapeSuggestion));
    res.json(out);
  } catch (err) {
    console.error("GET /glossary/suggestions", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/glossary/suggestions/:id/accept", authenticateJwt, requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [s] = await db.select().from(glossarySuggestionsTable).where(eq(glossarySuggestionsTable.id, id));
    if (!s) { res.status(404).json({ error: "Not found" }); return; }
    if (s.status !== "pending") { res.status(400).json({ error: "Already reviewed" }); return; }

    const [term] = await db.select().from(glossaryTermsTable).where(eq(glossaryTermsTable.id, s.termId));
    if (!term) { res.status(404).json({ error: "Term gone" }); return; }

    const updates: Partial<typeof glossaryTermsTable.$inferInsert> = { updatedAt: nowIso() };
    const diff: Record<string, { from: string; to: string }> = {};
    if (s.proposedTitle && s.proposedTitle !== term.title) { updates.title = s.proposedTitle; diff.title = { from: term.title, to: s.proposedTitle }; }
    if (s.proposedShortDef && s.proposedShortDef !== term.shortDef) { updates.shortDef = s.proposedShortDef; diff.shortDef = { from: term.shortDef, to: s.proposedShortDef }; }
    if (s.proposedLongDef && s.proposedLongDef !== term.longDef) { updates.longDef = s.proposedLongDef; diff.longDef = { from: term.longDef, to: s.proposedLongDef }; }

    if (Object.keys(diff).length > 0) {
      await db.update(glossaryTermsTable).set(updates).where(eq(glossaryTermsTable.id, term.id));
      await logHistory(term.id, term.termKey, "accept_suggestion", { id: req.user!.id, name: req.user!.name }, diff);
    }

    const [updated] = await db
      .update(glossarySuggestionsTable)
      .set({
        status: "accepted",
        reviewedByUserId: req.user!.id,
        reviewedByName: req.user!.name,
        reviewNote: typeof req.body?.reviewNote === "string" ? req.body.reviewNote : "",
        reviewedAt: nowIso(),
      })
      .where(eq(glossarySuggestionsTable.id, id))
      .returning();
    res.json(await shapeSuggestion(updated));
  } catch (err) {
    console.error("POST /glossary/suggestions/:id/accept", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/glossary/suggestions/:id/reject", authenticateJwt, requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [updated] = await db
      .update(glossarySuggestionsTable)
      .set({
        status: "rejected",
        reviewedByUserId: req.user!.id,
        reviewedByName: req.user!.name,
        reviewNote: typeof req.body?.reviewNote === "string" ? req.body.reviewNote : "",
        reviewedAt: nowIso(),
      })
      .where(and(eq(glossarySuggestionsTable.id, id), eq(glossarySuggestionsTable.status, "pending")))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found or already reviewed" }); return; }
    res.json(await shapeSuggestion(updated));
  } catch (err) {
    console.error("POST /glossary/suggestions/:id/reject", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Create ──────────────────────────────────────────────────────────────
router.post("/glossary", authenticateJwt, requireManager, async (req, res) => {
  try {
    const b = req.body ?? {};
    const termKey = String(b.termKey ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    const title = String(b.title ?? "").trim();
    const category = String(b.category ?? "").trim();
    const shortDef = String(b.shortDef ?? "").trim();
    if (!termKey || !title || !shortDef) { res.status(400).json({ error: "termKey, title, shortDef required" }); return; }
    if (!(VALID_CATEGORIES as readonly string[]).includes(category)) { res.status(400).json({ error: "Invalid category" }); return; }

    const [existing] = await db.select().from(glossaryTermsTable).where(eq(glossaryTermsTable.termKey, termKey));
    if (existing) { res.status(409).json({ error: "termKey already exists" }); return; }

    const now = nowIso();
    const [created] = await db.insert(glossaryTermsTable).values({
      termKey,
      title,
      category: category as (typeof VALID_CATEGORIES)[number],
      shortDef,
      longDef: typeof b.longDef === "string" ? b.longDef : "",
      seeAlsoRoute: typeof b.seeAlsoRoute === "string" && b.seeAlsoRoute ? b.seeAlsoRoute : null,
      published: b.published !== false,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    }).returning();

    const routes: string[] = Array.isArray(b.routes) ? b.routes.filter((r: unknown) => typeof r === "string" && r) : [];
    if (routes.length > 0) {
      await db.insert(glossaryRouteMappingsTable).values(
        routes.map((route, i) => ({ termId: created.id, route, sortOrder: i })),
      );
    }
    await logHistory(created.id, created.termKey, "create", { id: req.user!.id, name: req.user!.name }, { title, category, shortDef, routes });
    res.status(201).json(shapeTerm(created, routes));
  } catch (err) {
    console.error("POST /glossary", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Get / Update / Delete by key ────────────────────────────────────────
router.get("/glossary/:key", authenticateJwt, async (req, res) => {
  try {
    const key = String(req.params.key);
    const [row] = await db.select().from(glossaryTermsTable).where(eq(glossaryTermsTable.termKey, key));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    const isManager = req.user?.role === "admin" || req.user?.role === "manager";
    if (!row.published && !isManager) { res.status(404).json({ error: "Not found" }); return; }
    const routesByTerm = await fetchRoutesByTerm([row.id]);
    res.json(shapeTerm(row, routesByTerm.get(row.id) ?? []));
  } catch (err) {
    console.error("GET /glossary/:key", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/glossary/:key", authenticateJwt, requireManager, async (req, res) => {
  try {
    const key = String(req.params.key);
    const [existing] = await db.select().from(glossaryTermsTable).where(eq(glossaryTermsTable.termKey, key));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    const b = req.body ?? {};
    const updates: Partial<typeof glossaryTermsTable.$inferInsert> = { updatedAt: nowIso() };
    const diff: Record<string, unknown> = {};
    if (typeof b.title === "string" && b.title !== existing.title) { updates.title = b.title; diff.title = { from: existing.title, to: b.title }; }
    if (typeof b.shortDef === "string" && b.shortDef !== existing.shortDef) { updates.shortDef = b.shortDef; diff.shortDef = { from: existing.shortDef, to: b.shortDef }; }
    if (typeof b.longDef === "string" && b.longDef !== existing.longDef) { updates.longDef = b.longDef; diff.longDef = { from: existing.longDef, to: b.longDef }; }
    if (typeof b.category === "string" && (VALID_CATEGORIES as readonly string[]).includes(b.category) && b.category !== existing.category) {
      updates.category = b.category as (typeof VALID_CATEGORIES)[number];
      diff.category = { from: existing.category, to: b.category };
    }
    if ("seeAlsoRoute" in b) {
      const v = typeof b.seeAlsoRoute === "string" && b.seeAlsoRoute ? b.seeAlsoRoute : null;
      if (v !== existing.seeAlsoRoute) { updates.seeAlsoRoute = v; diff.seeAlsoRoute = { from: existing.seeAlsoRoute, to: v }; }
    }
    if (typeof b.published === "boolean" && b.published !== existing.published) { updates.published = b.published; diff.published = { from: existing.published, to: b.published }; }

    if (Object.keys(updates).length > 1) {
      await db.update(glossaryTermsTable).set(updates).where(eq(glossaryTermsTable.id, existing.id));
    }

    if (Array.isArray(b.routes)) {
      const routes: string[] = b.routes.filter((r: unknown) => typeof r === "string" && r);
      const oldMappings = await db.select().from(glossaryRouteMappingsTable).where(eq(glossaryRouteMappingsTable.termId, existing.id));
      const oldRoutes = oldMappings.map((m) => m.route).sort();
      const newRoutes = routes.slice().sort();
      if (JSON.stringify(oldRoutes) !== JSON.stringify(newRoutes)) {
        await db.delete(glossaryRouteMappingsTable).where(eq(glossaryRouteMappingsTable.termId, existing.id));
        if (routes.length > 0) {
          await db.insert(glossaryRouteMappingsTable).values(
            routes.map((route, i) => ({ termId: existing.id, route, sortOrder: i })),
          );
        }
        diff.routes = { from: oldRoutes, to: newRoutes };
      }
    }

    if (Object.keys(diff).length > 0) {
      await logHistory(existing.id, existing.termKey, "update", { id: req.user!.id, name: req.user!.name }, diff);
    }

    const [refreshed] = await db.select().from(glossaryTermsTable).where(eq(glossaryTermsTable.id, existing.id));
    const routesByTerm = await fetchRoutesByTerm([existing.id]);
    res.json(shapeTerm(refreshed, routesByTerm.get(existing.id) ?? []));
  } catch (err) {
    console.error("PATCH /glossary/:key", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/glossary/:key", authenticateJwt, requireManager, async (req, res) => {
  try {
    const key = String(req.params.key);
    const [existing] = await db.select().from(glossaryTermsTable).where(eq(glossaryTermsTable.termKey, key));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    await logHistory(existing.id, existing.termKey, "delete", { id: req.user!.id, name: req.user!.name }, { title: existing.title });
    await db.delete(glossaryTermsTable).where(eq(glossaryTermsTable.id, existing.id));
    res.status(204).end();
  } catch (err) {
    console.error("DELETE /glossary/:key", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/glossary/:key/history", authenticateJwt, requireManager, async (req, res) => {
  try {
    const key = String(req.params.key);
    const [existing] = await db.select().from(glossaryTermsTable).where(eq(glossaryTermsTable.termKey, key));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    const rows = await db
      .select()
      .from(glossaryEditHistoryTable)
      .where(eq(glossaryEditHistoryTable.termId, existing.id))
      .orderBy(desc(glossaryEditHistoryTable.createdAt));
    res.json(rows.map((r) => ({
      id: r.id,
      termId: r.termId,
      termKey: r.termKey,
      action: r.action,
      actorUserId: r.actorUserId ?? null,
      actorName: r.actorName,
      diff: r.diff ?? null,
      createdAt: r.createdAt,
    })));
  } catch (err) {
    console.error("GET /glossary/:key/history", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/glossary/:key/suggest", authenticateJwt, async (req, res) => {
  try {
    const key = String(req.params.key);
    const [existing] = await db.select().from(glossaryTermsTable).where(eq(glossaryTermsTable.termKey, key));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    const b = req.body ?? {};
    const proposedTitle = typeof b.proposedTitle === "string" ? b.proposedTitle : "";
    const proposedShortDef = typeof b.proposedShortDef === "string" ? b.proposedShortDef : "";
    const proposedLongDef = typeof b.proposedLongDef === "string" ? b.proposedLongDef : "";
    const reason = typeof b.reason === "string" ? b.reason : "";
    if (!proposedTitle && !proposedShortDef && !proposedLongDef && !reason) {
      res.status(400).json({ error: "Provide at least one suggested field or a reason" });
      return;
    }
    const [created] = await db.insert(glossarySuggestionsTable).values({
      termId: existing.id,
      proposedTitle,
      proposedShortDef,
      proposedLongDef,
      reason,
      submittedByUserId: req.user!.id,
      submittedByName: req.user!.name,
      createdAt: nowIso(),
    }).returning();
    try {
      await notifyGlossarySuggestion({
        suggestionId: created.id,
        termTitle: existing.title,
      });
    } catch (e) {
      console.error("notifyGlossarySuggestion failed", e);
    }
    res.status(201).json(await shapeSuggestion(created));
  } catch (err) {
    console.error("POST /glossary/:key/suggest", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Onboarding state ───────────────────────────────────────────────────

// Task #146: org-wide welcome-tour version. We mirror it onto the GET response
// so the client can compare against the user's `tourVersionSeen` without a
// second round-trip. Defaults to 1 if no org-settings row has been created
// yet (e.g. fresh seeded environment).
async function getCurrentTourVersion(): Promise<number> {
  const [row] = await db
    .select({ v: organizationSettingsTable.currentTourVersion })
    .from(organizationSettingsTable)
    .where(eq(organizationSettingsTable.id, 1));
  return row?.v ?? 1;
}

router.get("/me/onboarding", authenticateJwt, async (req, res) => {
  try {
    const userId = req.user!.id;
    const currentTourVersion = await getCurrentTourVersion();
    const [row] = await db.select().from(userOnboardingTable).where(eq(userOnboardingTable.userId, userId));
    if (!row) {
      res.json({
        userId,
        tourCompleted: false,
        tourCompletedAt: null,
        tourReplayedAt: null,
        tourVersionSeen: null,
        currentTourVersion,
        updatedAt: nowIso(),
      });
      return;
    }
    res.json({
      userId: row.userId,
      tourCompleted: row.tourCompleted,
      tourCompletedAt: row.tourCompletedAt ?? null,
      tourReplayedAt: row.tourReplayedAt ?? null,
      tourVersionSeen: row.tourVersionSeen ?? null,
      currentTourVersion,
      updatedAt: row.updatedAt,
    });
  } catch (err) {
    console.error("GET /me/onboarding", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/me/onboarding", authenticateJwt, async (req, res) => {
  try {
    const userId = req.user!.id;
    const action = String(req.body?.action ?? "");
    const now = nowIso();
    const currentTourVersion = await getCurrentTourVersion();
    const [existing] = await db.select().from(userOnboardingTable).where(eq(userOnboardingTable.userId, userId));
    let next: typeof userOnboardingTable.$inferSelect;
    if (!existing) {
      const [created] = await db.insert(userOnboardingTable).values({
        userId,
        tourCompleted: action === "complete",
        tourCompletedAt: action === "complete" ? now : null,
        tourReplayedAt: action === "replay" ? now : null,
        // Stamp the current org-wide tour version on completion so the user
        // is not re-prompted until the admin bumps it again.
        tourVersionSeen: action === "complete" ? currentTourVersion : null,
        updatedAt: now,
      }).returning();
      next = created;
    } else {
      const updates: Partial<typeof userOnboardingTable.$inferInsert> = { updatedAt: now };
      if (action === "complete") {
        updates.tourCompleted = true;
        updates.tourCompletedAt = now;
        updates.tourVersionSeen = currentTourVersion;
      }
      else if (action === "replay") { updates.tourReplayedAt = now; }
      else if (action === "reset") {
        updates.tourCompleted = false;
        updates.tourCompletedAt = null;
        updates.tourVersionSeen = null;
      }
      else { res.status(400).json({ error: "Invalid action" }); return; }
      const [updated] = await db.update(userOnboardingTable).set(updates).where(eq(userOnboardingTable.userId, userId)).returning();
      next = updated;
    }
    res.json({
      userId: next.userId,
      tourCompleted: next.tourCompleted,
      tourCompletedAt: next.tourCompletedAt ?? null,
      tourReplayedAt: next.tourReplayedAt ?? null,
      tourVersionSeen: next.tourVersionSeen ?? null,
      currentTourVersion,
      updatedAt: next.updatedAt,
    });
  } catch (err) {
    console.error("POST /me/onboarding", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
