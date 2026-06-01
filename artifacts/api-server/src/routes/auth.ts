import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { usersTable, boardMemberAuditTable, boardHistoryTable } from "@workspace/db/schema";
import { and, desc, eq, ne, lte, gte, or, isNull } from "drizzle-orm";
import { authenticateJwt, requireAdmin, requireManagerOrBoardMember, signToken, type AuthUser } from "../middleware/auth.js";
import { checkPassword } from "../lib/password.js";

// Task #30: invite-accept flow. The plaintext token is base64url-encoded
// 32 random bytes, returned once to the admin so they can hand it (or the
// invite URL) to the resident. Only the SHA-256 hash is persisted on the
// users row, so a leak of the DB doesn't leak active invite tokens.
const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function generateInviteToken(): { token: string; tokenHash: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS).toISOString();
  return { token, tokenHash, expiresAt };
}

function hashInviteToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const OFFICER_TITLES = ["President", "Vice President", "Treasurer", "Secretary", "Member-at-Large"] as const;
const UNIQUE_OFFICER_TITLES = ["President", "Vice President", "Treasurer", "Secretary"] as const;
type OfficerTitle = (typeof OFFICER_TITLES)[number];

function isValidOfficerTitle(t: unknown): t is OfficerTitle {
  return typeof t === "string" && (OFFICER_TITLES as readonly string[]).includes(t);
}

function normalizeDate(d: unknown): string | null | undefined {
  if (d === undefined) return undefined;
  if (d === null) return null;
  if (typeof d !== "string") return undefined;
  const trimmed = d.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  return trimmed;
}

type UserRow = typeof usersTable.$inferSelect;
function toUserDto(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    name: u.name,
    unitId: u.unitId ?? null,
    pending: u.pending,
    boardMember: u.boardMember,
    officerTitle: u.officerTitle ?? null,
    termStart: u.termStart ?? null,
    termEnd: u.termEnd ?? null,
    createdAt: u.createdAt,
  };
}

const router: IRouter = Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/",
};

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim()));
  if (!user || !user.passwordHash) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (user.pending) {
    res.status(403).json({ error: "Account setup is pending. Please set your password via the invite link." });
    return;
  }

  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    role: user.role as AuthUser["role"],
    name: user.name,
    unitId: user.unitId ?? null,
    boardMember: user.boardMember === true,
  };

  const token = signToken(authUser);
  res.cookie("auth_token", token, COOKIE_OPTIONS);
  res.json({ user: authUser });
});

router.post("/auth/logout", (_req, res) => {
  res.clearCookie("auth_token", { path: "/" });
  res.json({ ok: true });
});

router.get("/auth/me", authenticateJwt, async (req, res) => {
  // Re-read boardMember from the DB so a user whose flag was just toggled
  // by an admin sees the updated value without having to log out and back in.
  const [row] = await db
    .select({ boardMember: usersTable.boardMember })
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.id));
  const user: AuthUser = {
    ...req.user!,
    boardMember: row?.boardMember === true,
  };
  res.json({ user });
});

// Readable by admins, managers, and board-member residents so they can see
// the roster (and board-flag badges). Mutating endpoints below remain
// admin-only. Non-admins receive a reduced shape — no email, no createdAt.
router.get("/users", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const isAdmin = req.user?.role === "admin";
  const rows = await db.select().from(usersTable).orderBy(usersTable.createdAt);
  if (isAdmin) {
    res.json(rows.map(toUserDto));
    return;
  }
  res.json(rows.map((r) => ({
    ...toUserDto(r),
    email: "",
    createdAt: "",
  })));
});

router.post("/users/invite", authenticateJwt, requireAdmin, async (req, res) => {
  const { email, role, name, unitId, boardMember } = req.body as { email?: string; role?: string; name?: string; unitId?: string | null; boardMember?: boolean };
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }
  const validRoles = ["admin", "manager", "resident"];
  const assignedRole = validRoles.includes(role ?? "") ? role! : "manager";

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim()));
  if (existing.length > 0) {
    res.status(409).json({ error: "A user with that email already exists" });
    return;
  }

  const { token, tokenHash, expiresAt } = generateInviteToken();
  const [created] = await db.insert(usersTable).values({
    email: email.toLowerCase().trim(),
    role: assignedRole,
    name: name?.trim() ?? "",
    unitId: unitId ?? null,
    pending: true,
    boardMember: boardMember === true,
    inviteTokenHash: tokenHash,
    inviteTokenExpiresAt: expiresAt,
    createdAt: new Date().toISOString(),
  }).returning();

  res.status(201).json({
    user: toUserDto(created),
    inviteToken: token,
    inviteTokenExpiresAt: expiresAt,
  });
});

// Regenerate an invite token for a still-pending user (e.g. the previous
// link expired or got lost). Admin-only. Returns the new plaintext token
// the same way the original /users/invite does.
router.post("/users/:id/invite/resend", authenticateJwt, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (!target.pending) {
    res.status(409).json({ error: "User has already accepted their invite" });
    return;
  }
  const { token, tokenHash, expiresAt } = generateInviteToken();
  const [updated] = await db
    .update(usersTable)
    .set({ inviteTokenHash: tokenHash, inviteTokenExpiresAt: expiresAt })
    .where(eq(usersTable.id, id))
    .returning();
  res.json({
    user: toUserDto(updated),
    inviteToken: token,
    inviteTokenExpiresAt: expiresAt,
  });
});

// Public preview of an invite token — used by the /accept-invite/:token
// page to greet the user by name and show which workspace role they're
// being granted before they pick a password. Doesn't return anything
// sensitive (no email of other users, no password hash).
router.get("/auth/invite/:token", async (req, res) => {
  const token = req.params.token;
  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "Invite token is required" });
    return;
  }
  const tokenHash = hashInviteToken(token);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.inviteTokenHash, tokenHash));
  if (!user || !user.pending || !user.inviteTokenExpiresAt) {
    res.status(404).json({ error: "Invite link is invalid or has already been used" });
    return;
  }
  if (new Date(user.inviteTokenExpiresAt).getTime() < Date.now()) {
    res.status(410).json({ error: "Invite link has expired. Ask an admin to send a new one." });
    return;
  }
  res.json({
    email: user.email,
    name: user.name,
    role: user.role,
  });
});

// Public accept-invite endpoint. Validates the token, enforces the shared
// password policy, sets the password, clears `pending` + the invite token,
// and signs a JWT cookie so the user lands in their workspace logged in.
router.post("/auth/accept-invite", async (req, res) => {
  const body = req.body as { token?: unknown; password?: unknown };
  if (typeof body.token !== "string" || !body.token) {
    res.status(400).json({ error: "Invite token is required" });
    return;
  }
  const tokenHash = hashInviteToken(body.token);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.inviteTokenHash, tokenHash));
  if (!user || !user.pending || !user.inviteTokenExpiresAt) {
    res.status(404).json({ error: "Invite link is invalid or has already been used" });
    return;
  }
  if (new Date(user.inviteTokenExpiresAt).getTime() < Date.now()) {
    res.status(410).json({ error: "Invite link has expired. Ask an admin to send a new one." });
    return;
  }
  const pwCheck = checkPassword(body.password, user.email);
  if (!pwCheck.ok) {
    res.status(400).json({ error: pwCheck.error });
    return;
  }
  const passwordHash = await bcrypt.hash(body.password as string, 10);
  const [updated] = await db
    .update(usersTable)
    .set({
      passwordHash,
      pending: false,
      inviteTokenHash: null,
      inviteTokenExpiresAt: null,
    })
    .where(eq(usersTable.id, user.id))
    .returning();

  const authUser: AuthUser = {
    id: updated.id,
    email: updated.email,
    role: updated.role as AuthUser["role"],
    name: updated.name,
    unitId: updated.unitId ?? null,
    boardMember: updated.boardMember === true,
  };
  const jwtToken = signToken(authUser);
  res.cookie("auth_token", jwtToken, COOKIE_OPTIONS);
  res.json({ user: authUser });
});

router.patch("/users/:id/role", authenticateJwt, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const { role } = req.body as { role?: string };
  const validRoles = ["admin", "manager", "resident"];
  if (!role || !validRoles.includes(role)) {
    res.status(400).json({ error: "Invalid role. Must be admin, manager, or resident" });
    return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (target.role === "admin" && role !== "admin") {
    const otherActiveAdmins = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(
        eq(usersTable.role, "admin"),
        eq(usersTable.pending, false),
        ne(usersTable.id, id),
      ));
    if (otherActiveAdmins.length === 0) {
      res.status(409).json({ error: "Cannot demote the last remaining Admin. Promote another user to Admin first." });
      return;
    }
  }

  const [updated] = await db
    .update(usersTable)
    .set({ role })
    .where(eq(usersTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(toUserDto(updated));
});

async function recordBoardHistory(entry: {
  userId: number;
  actor: AuthUser;
  action: string;
  oldBoardMember?: boolean | null;
  newBoardMember?: boolean | null;
  oldOfficerTitle?: string | null;
  newOfficerTitle?: string | null;
  oldTermStart?: string | null;
  newTermStart?: string | null;
  oldTermEnd?: string | null;
  newTermEnd?: string | null;
}) {
  await db.insert(boardHistoryTable).values({
    userId: entry.userId,
    actorUserId: entry.actor.id,
    actorName: entry.actor.name || entry.actor.email,
    action: entry.action,
    oldBoardMember: entry.oldBoardMember ?? null,
    newBoardMember: entry.newBoardMember ?? null,
    oldOfficerTitle: entry.oldOfficerTitle ?? null,
    newOfficerTitle: entry.newOfficerTitle ?? null,
    oldTermStart: entry.oldTermStart ?? null,
    newTermStart: entry.newTermStart ?? null,
    oldTermEnd: entry.oldTermEnd ?? null,
    newTermEnd: entry.newTermEnd ?? null,
    createdAt: new Date().toISOString(),
  });
}

router.patch("/users/:id/board-member", authenticateJwt, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const { boardMember } = req.body as { boardMember?: boolean };
  if (typeof boardMember !== "boolean") {
    res.status(400).json({ error: "boardMember must be a boolean" });
    return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Enforce against active (non-pending) board members so pending invites
  // can't satisfy the "at least one board member" invariant.
  if (target.boardMember && !boardMember && !target.pending) {
    const otherActiveBoard = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(
        eq(usersTable.boardMember, true),
        eq(usersTable.pending, false),
        ne(usersTable.id, id),
      ));
    if (otherActiveBoard.length === 0) {
      res.status(409).json({
        error: "Cannot remove the last remaining board member. Designate another board member first.",
      });
      return;
    }
  }

  // Update + audit must be atomic: if the audit row cannot be written we
  // must not let the sensitive flag change persist, otherwise the history
  // would silently drop entries and Stripe-approval disputes could not be
  // investigated. Skip the audit insert only when the request is a no-op
  // (no actual change). When un-flagging a user we also clear officer
  // state inside the same transaction — non-board members should not
  // hold an officer title or active term.
  const oldValue = target.boardMember === true;
  let updated;
  try {
    updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(usersTable)
        .set({
          boardMember,
          ...(boardMember ? {} : { officerTitle: null, termStart: null, termEnd: null }),
        })
        .where(eq(usersTable.id, id))
        .returning();
      if (oldValue !== boardMember) {
        await tx.insert(boardMemberAuditTable).values({
          userId: id,
          oldValue,
          newValue: boardMember,
          changedByUserId: req.user!.id,
          changedByName: req.user!.name ?? "",
          changedByEmail: req.user!.email ?? "",
          createdAt: new Date().toISOString(),
        });
      }
      return row;
    });
  } catch (err) {
    console.error("board member update + audit failed", err);
    res.status(500).json({ error: "Failed to record board-member change" });
    return;
  }

  // Task #75: materialize officer-term events on the Board calendar.
  try {
    const { materializeOfficerTerm } = await import("../lib/calendarMaterialize.js");
    await materializeOfficerTerm({
      id: updated.id, name: updated.name, email: updated.email,
      officerTitle: updated.officerTitle ?? null,
      termStart: updated.termStart ?? null, termEnd: updated.termEnd ?? null,
      boardMember: updated.boardMember === true,
    });
  } catch (err) { console.error("calendar materializeOfficerTerm failed", err); }

  if (target.boardMember !== boardMember) {
    await recordBoardHistory({
      userId: id,
      actor: req.user!,
      action: boardMember ? "board_member_added" : "board_member_removed",
      oldBoardMember: target.boardMember,
      newBoardMember: boardMember,
      oldOfficerTitle: target.officerTitle,
      newOfficerTitle: updated.officerTitle ?? null,
      oldTermStart: target.termStart,
      newTermStart: updated.termStart ?? null,
      oldTermEnd: target.termEnd,
      newTermEnd: updated.termEnd ?? null,
    });
  }

  res.json(toUserDto(updated));
});

router.patch("/users/:id/officer", authenticateJwt, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const body = req.body as {
    officerTitle?: string | null;
    termStart?: string | null;
    termEnd?: string | null;
  };

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (!target.boardMember) {
    res.status(400).json({ error: "Only board members can hold officer titles or terms. Flag them as a board member first." });
    return;
  }

  const updates: { officerTitle?: string | null; termStart?: string | null; termEnd?: string | null } = {};

  if (body.officerTitle !== undefined) {
    if (body.officerTitle === null || body.officerTitle === "") {
      updates.officerTitle = null;
    } else if (isValidOfficerTitle(body.officerTitle)) {
      updates.officerTitle = body.officerTitle;
    } else {
      res.status(400).json({ error: `Invalid officer title. Must be one of: ${OFFICER_TITLES.join(", ")}` });
      return;
    }
  }

  if (body.termStart !== undefined) {
    const v = normalizeDate(body.termStart);
    if (v === undefined) {
      res.status(400).json({ error: "termStart must be a date in YYYY-MM-DD format or null" });
      return;
    }
    updates.termStart = v;
  }
  if (body.termEnd !== undefined) {
    const v = normalizeDate(body.termEnd);
    if (v === undefined) {
      res.status(400).json({ error: "termEnd must be a date in YYYY-MM-DD format or null" });
      return;
    }
    updates.termEnd = v;
  }

  // Uniqueness guard: at most one person holds President / VP / Treasurer /
  // Secretary at any time. Member-at-Large is not unique.
  if (
    updates.officerTitle &&
    (UNIQUE_OFFICER_TITLES as readonly string[]).includes(updates.officerTitle)
  ) {
    const conflict = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(and(
        eq(usersTable.officerTitle, updates.officerTitle),
        ne(usersTable.id, id),
      ));
    if (conflict.length > 0) {
      const who = conflict[0]!.name || `user #${conflict[0]!.id}`;
      res.status(409).json({
        error: `${updates.officerTitle} is already held by ${who}. Clear that officer's title first.`,
      });
      return;
    }
  }

  if (Object.keys(updates).length === 0) {
    res.json(toUserDto(target));
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning();

  // Task #75: refresh officer-term calendar events whenever title/term changes.
  try {
    const { materializeOfficerTerm } = await import("../lib/calendarMaterialize.js");
    await materializeOfficerTerm({
      id: updated.id, name: updated.name, email: updated.email,
      officerTitle: updated.officerTitle ?? null,
      termStart: updated.termStart ?? null, termEnd: updated.termEnd ?? null,
      boardMember: updated.boardMember === true,
    });
  } catch (err) { console.error("calendar materializeOfficerTerm failed", err); }

  const action =
    updates.officerTitle !== undefined && updates.officerTitle !== target.officerTitle
      ? updates.officerTitle === null
        ? "officer_title_cleared"
        : target.officerTitle
          ? "officer_title_changed"
          : "officer_title_assigned"
      : "officer_term_updated";

  await recordBoardHistory({
    userId: id,
    actor: req.user!,
    action,
    oldBoardMember: target.boardMember,
    newBoardMember: updated.boardMember,
    oldOfficerTitle: target.officerTitle,
    newOfficerTitle: updated.officerTitle,
    oldTermStart: target.termStart,
    newTermStart: updated.termStart,
    oldTermEnd: target.termEnd,
    newTermEnd: updated.termEnd,
  });

  res.json(toUserDto(updated));
});

router.get("/board/history", authenticateJwt, requireManagerOrBoardMember, async (_req, res) => {
  const rows = await db
    .select({
      id: boardHistoryTable.id,
      userId: boardHistoryTable.userId,
      actorUserId: boardHistoryTable.actorUserId,
      actorName: boardHistoryTable.actorName,
      action: boardHistoryTable.action,
      oldBoardMember: boardHistoryTable.oldBoardMember,
      newBoardMember: boardHistoryTable.newBoardMember,
      oldOfficerTitle: boardHistoryTable.oldOfficerTitle,
      newOfficerTitle: boardHistoryTable.newOfficerTitle,
      oldTermStart: boardHistoryTable.oldTermStart,
      newTermStart: boardHistoryTable.newTermStart,
      oldTermEnd: boardHistoryTable.oldTermEnd,
      newTermEnd: boardHistoryTable.newTermEnd,
      createdAt: boardHistoryTable.createdAt,
      userName: usersTable.name,
    })
    .from(boardHistoryTable)
    .leftJoin(usersTable, eq(usersTable.id, boardHistoryTable.userId))
    .orderBy(desc(boardHistoryTable.createdAt))
    .limit(500);
  res.json(rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    userName: r.userName ?? null,
    actorUserId: r.actorUserId ?? null,
    actorName: r.actorName,
    action: r.action,
    oldBoardMember: r.oldBoardMember,
    newBoardMember: r.newBoardMember,
    oldOfficerTitle: r.oldOfficerTitle,
    newOfficerTitle: r.newOfficerTitle,
    oldTermStart: r.oldTermStart,
    newTermStart: r.newTermStart,
    oldTermEnd: r.oldTermEnd,
    newTermEnd: r.newTermEnd,
    createdAt: r.createdAt,
  })));
});

// Historical roster — board members whose term contained `date` (or, for
// rows with no term recorded, the current snapshot if date is omitted/today).
router.get("/board/at", authenticateJwt, requireManagerOrBoardMember, async (req, res) => {
  const dateParam = (req.query.date as string | undefined) ?? "";
  const date = normalizeDate(dateParam);
  if (date === undefined && dateParam !== "") {
    res.status(400).json({ error: "date must be in YYYY-MM-DD format" });
    return;
  }
  const effective = date ?? new Date().toISOString().slice(0, 10);

  // A user counts as on the board on `effective` when:
  //   - boardMember = true AND (termStart IS NULL OR termStart <= effective)
  //                       AND (termEnd   IS NULL OR termEnd   >= effective)
  // Users with no term dates show in the current snapshot only.
  const isToday = effective === new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      officerTitle: usersTable.officerTitle,
      termStart: usersTable.termStart,
      termEnd: usersTable.termEnd,
      boardMember: usersTable.boardMember,
    })
    .from(usersTable)
    .where(and(
      eq(usersTable.boardMember, true),
      or(isNull(usersTable.termStart), lte(usersTable.termStart, effective))!,
      or(isNull(usersTable.termEnd), gte(usersTable.termEnd, effective))!,
    ))
    .orderBy(usersTable.name);

  // For non-current dates, drop users with no term dates at all (we can't
  // confidently say they were on the board then).
  const filtered = isToday
    ? rows
    : rows.filter((r) => r.termStart !== null || r.termEnd !== null);

  res.json({
    date: effective,
    members: filtered.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      officerTitle: r.officerTitle,
      termStart: r.termStart,
      termEnd: r.termEnd,
    })),
  });
});

router.get("/users/:id/board-member-history", authenticateJwt, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const [target] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const rows = await db
    .select()
    .from(boardMemberAuditTable)
    .where(eq(boardMemberAuditTable.userId, id))
    .orderBy(desc(boardMemberAuditTable.createdAt));
  res.json(rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    oldValue: r.oldValue,
    newValue: r.newValue,
    changedByUserId: r.changedByUserId ?? null,
    changedByName: r.changedByName,
    changedByEmail: r.changedByEmail,
    createdAt: r.createdAt,
  })));
});

router.patch("/users/:id/unit", authenticateJwt, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const { unitId } = req.body as { unitId?: string | null };
  const [updated] = await db
    .update(usersTable)
    .set({ unitId: unitId ?? null })
    .where(eq(usersTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({
    id: updated.id,
    email: updated.email,
    role: updated.role,
    name: updated.name,
    unitId: updated.unitId ?? null,
    pending: updated.pending,
    boardMember: updated.boardMember,
    officerTitle: updated.officerTitle ?? null,
    termStart: updated.termStart ?? null,
    termEnd: updated.termEnd ?? null,
    createdAt: updated.createdAt,
  });
});

router.delete("/users/:id", authenticateJwt, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  if (req.user!.id === id) {
    res.status(400).json({ error: "You cannot delete your own account" });
    return;
  }

  // Mirror the role/flag PATCH invariants on delete.
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (!target.pending && target.role === "admin") {
    const otherActiveAdmins = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(
        eq(usersTable.role, "admin"),
        eq(usersTable.pending, false),
        ne(usersTable.id, id),
      ));
    if (otherActiveAdmins.length === 0) {
      res.status(409).json({ error: "Cannot delete the last remaining Admin. Promote another user to Admin first." });
      return;
    }
  }
  if (!target.pending && target.boardMember) {
    const otherActiveBoard = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(
        eq(usersTable.boardMember, true),
        eq(usersTable.pending, false),
        ne(usersTable.id, id),
      ));
    if (otherActiveBoard.length === 0) {
      res.status(409).json({ error: "Cannot delete the last remaining board member. Designate another board member first." });
      return;
    }
  }

  const [deleted] = await db.delete(usersTable).where(eq(usersTable.id, id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.status(204).send();
});

export default router;
