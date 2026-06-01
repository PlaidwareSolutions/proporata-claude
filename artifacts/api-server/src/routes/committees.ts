// Task #75: Committees CRUD + roster.
//
// On create, a per-committee sub-calendar is provisioned under the
// "committees-<slug>" namespace so committee meetings/events can be filtered
// independently. Roster-only edits do not touch the calendar.

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  committeesTable, committeeMembersTable, usersTable,
  calendarSubCalendarsTable,
} from "@workspace/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authenticateJwt, requireManager } from "../middleware/auth.js";
import { getOrCreateCommitteeSub } from "../lib/calendarMaterialize.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
function nowISO(): string { return new Date().toISOString(); }

function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "committee";
}

router.get("/committees", authenticateJwt, async (_req, res) => {
  const rows = await db.select().from(committeesTable).orderBy(asc(committeesTable.name));
  const ids = rows.map((r) => r.id);
  const members = ids.length
    ? await db.select().from(committeeMembersTable)
    : [];
  const userIds = Array.from(new Set(members.map((m) => m.userId)));
  const users = userIds.length ? await db.select().from(usersTable) : [];
  const userMap = new Map(users.map((u) => [u.id, u] as const));
  const subs = await db.select().from(calendarSubCalendarsTable);
  const subById = new Map(subs.map((s) => [s.id, s] as const));
  res.json(rows.map((c) => ({
    ...c,
    subCalendarSlug: c.subCalendarId ? subById.get(c.subCalendarId)?.slug ?? null : null,
    members: members.filter((m) => m.committeeId === c.id).map((m) => {
      const u = userMap.get(m.userId);
      return {
        id: m.id, userId: m.userId, role: m.role, createdAt: m.createdAt,
        userName: u?.name ?? "", userEmail: u?.email ?? "",
      };
    }),
  })));
});

router.post("/committees", authenticateJwt, requireManager, async (req, res) => {
  const body = req.body as { name?: string; slug?: string; description?: string };
  const name = body.name?.trim();
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const slug = slugify(body.slug ?? name);
  // Provision sub-calendar.
  let subId: number | null = null;
  try {
    const sub = await getOrCreateCommitteeSub(slug, name);
    subId = sub.id;
  } catch (err) {
    logger.warn({ err }, "committee sub-calendar provisioning failed");
  }
  const [row] = await db.insert(committeesTable).values({
    slug, name, description: body.description ?? "",
    subCalendarId: subId, active: true, createdAt: nowISO(),
  }).returning();
  res.status(201).json(row);
});

router.patch("/committees/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [c] = await db.select().from(committeesTable).where(eq(committeesTable.id, id));
  if (!c) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.description === "string") patch.description = body.description;
  if (typeof body.active === "boolean") patch.active = body.active;
  if (Object.keys(patch).length === 0) { res.json(c); return; }
  const [row] = await db.update(committeesTable).set(patch).where(eq(committeesTable.id, id)).returning();
  res.json(row);
});

router.delete("/committees/:id", authenticateJwt, requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(committeesTable).where(eq(committeesTable.id, id));
  res.status(204).end();
});

router.post("/committees/:id/members", authenticateJwt, requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as { userId?: number; role?: string };
  if (typeof body.userId !== "number") { res.status(400).json({ error: "userId required" }); return; }
  const role = body.role === "chair" ? "chair" : "member";
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, body.userId));
  if (!u) { res.status(404).json({ error: "User not found" }); return; }
  const [existing] = await db.select().from(committeeMembersTable).where(and(
    eq(committeeMembersTable.committeeId, id),
    eq(committeeMembersTable.userId, body.userId),
  ));
  if (existing) {
    await db.update(committeeMembersTable).set({ role }).where(eq(committeeMembersTable.id, existing.id));
    res.json({ id: existing.id });
    return;
  }
  const [row] = await db.insert(committeeMembersTable).values({
    committeeId: id, userId: body.userId, role, createdAt: nowISO(),
  }).returning();
  res.status(201).json({ id: row!.id });
});

router.delete("/committees/:id/members/:userId", authenticateJwt, requireManager, async (req, res) => {
  const id = Number(req.params.id);
  const userId = Number(req.params.userId);
  if (!Number.isFinite(id) || !Number.isFinite(userId)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(committeeMembersTable).where(and(
    eq(committeeMembersTable.committeeId, id),
    eq(committeeMembersTable.userId, userId),
  ));
  res.status(204).end();
});

export default router;
