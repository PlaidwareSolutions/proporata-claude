import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export type UserRole = "admin" | "manager" | "resident";

export interface AuthUser {
  id: number;
  email: string;
  role: UserRole;
  name: string;
  unitId: string | null;
  boardMember: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is not set");
  return secret;
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name, unitId: user.unitId, boardMember: user.boardMember },
    getJwtSecret(),
    { expiresIn: "7d" },
  );
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, getJwtSecret()) as AuthUser & { iat?: number; exp?: number };
    return {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      name: payload.name,
      unitId: payload.unitId,
      boardMember: payload.boardMember === true,
    };
  } catch {
    return null;
  }
}

export function authenticateJwt(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.auth_token as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  req.user = user;
  next();
}

// Re-read the current role + pending state from the DB so a demoted or
// disabled admin's stale JWT cannot continue to authorize sensitive writes.
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [row] = await db
    .select({ role: usersTable.role, pending: usersTable.pending })
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id));
  if (!row || row.pending || row.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  req.user.role = row.role as UserRole;
  next();
}

export async function requireManager(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [row] = await db
    .select({ role: usersTable.role, pending: usersTable.pending })
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id));
  if (!row || row.pending || (row.role !== "admin" && row.role !== "manager")) {
    res.status(403).json({ error: "Manager access required" });
    return;
  }
  req.user.role = row.role as UserRole;
  next();
}

// Re-read the board flag from the DB so flag changes take effect immediately
// without requiring a re-login.
export async function requireBoardMember(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [row] = await db
    .select({ boardMember: usersTable.boardMember })
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id));
  if (!row?.boardMember) {
    res.status(403).json({ error: "Only board members may perform this action" });
    return;
  }
  next();
}

// Defense-in-depth gate for routes whose data should never be exposed
// to residents (manager/board domain), separate from the explicit
// manager-only writes guarded by requireManager. Residents (role
// "resident") are 403'd; admins, managers, and pending users are not.
// We re-read the role from the DB so a freshly-demoted user's stale JWT
// can't keep reading manager-only data.
export async function requireNotResident(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [row] = await db
    .select({ role: usersTable.role, pending: usersTable.pending })
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id));
  if (!row || row.pending || row.role === "resident") {
    res.status(403).json({ error: "Manager access required" });
    return;
  }
  req.user.role = row.role as UserRole;
  next();
}

export async function requireManagerOrBoardMember(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [row] = await db
    .select({ role: usersTable.role, pending: usersTable.pending, boardMember: usersTable.boardMember })
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id));
  if (!row || row.pending) {
    res.status(403).json({ error: "Manager or board-member access required" });
    return;
  }
  if (row.role === "admin" || row.role === "manager" || row.boardMember) {
    req.user.role = row.role as UserRole;
    next();
    return;
  }
  res.status(403).json({ error: "Manager or board-member access required" });
}
