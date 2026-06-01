// Task #149: integration tests confirming `requireNotResident` actually
// blocks resident-role tokens from manager-only GET routes (buildings,
// units list, insurance history, reports). Also asserts admin & manager
// tokens succeed on the same routes, so a future refactor that loosens
// the gate will be caught.

process.env.NODE_ENV = process.env.NODE_ENV ?? "production";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-task-149";

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { eq, inArray, sql } from "drizzle-orm";

import { db } from "@workspace/db";
import {
  buildingsTable,
  unitsTable,
  usersTable,
} from "@workspace/db/schema";

import app from "../app.js";
import { signToken, type UserRole } from "../middleware/auth.js";

const BUILDING_NUM = 991_449;
const UNIT_ID = "T149-A";
const EMAIL_PREFIX = "t149-";

const EMAILS = {
  admin: `${EMAIL_PREFIX}admin@test.invalid`,
  manager: `${EMAIL_PREFIX}manager@test.invalid`,
  resident: `${EMAIL_PREFIX}resident@test.invalid`,
} as const;

interface UserRow {
  id: number;
  email: string;
  role: UserRole;
  unitId: string | null;
  boardMember: boolean;
}

let server: http.Server;
let baseUrl = "";

function url(path: string): string {
  return `${baseUrl}${path}`;
}

function tokenFor(row: UserRow): string {
  return signToken({
    id: row.id,
    email: row.email,
    role: row.role,
    name: row.email,
    unitId: row.unitId,
    boardMember: row.boardMember,
  });
}

function authHeaders(token: string): Record<string, string> {
  return { Cookie: `auth_token=${token}` };
}

async function loadUser(email: string): Promise<UserRow> {
  const [row] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      role: usersTable.role,
      unitId: usersTable.unitId,
      boardMember: usersTable.boardMember,
    })
    .from(usersTable)
    .where(eq(usersTable.email, email));
  return {
    id: row.id,
    email: row.email,
    role: row.role as UserRole,
    unitId: row.unitId,
    boardMember: row.boardMember,
  };
}

async function cleanupTestData(): Promise<void> {
  await db
    .update(usersTable)
    .set({ unitId: null })
    .where(sql`${usersTable.email} LIKE ${EMAIL_PREFIX + "%"}`);
  await db
    .delete(usersTable)
    .where(sql`${usersTable.email} LIKE ${EMAIL_PREFIX + "%"}`);
  await db.delete(unitsTable).where(inArray(unitsTable.id, [UNIT_ID]));
  await db.delete(buildingsTable).where(eq(buildingsTable.num, BUILDING_NUM));
}

before(async () => {
  await cleanupTestData();

  await db.insert(buildingsTable).values({
    num: BUILDING_NUM,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    status: "ok",
    openWO: 0,
    address: "Task 149 test building",
    street: "Test St",
    units: 1,
    yearBuilt: 2020,
    roofYear: 2020,
    insuranceStatus: "ok",
  });

  await db.insert(unitsTable).values({
    id: UNIT_ID,
    building: BUILDING_NUM,
    unit: "A",
    address: "Task 149 test address",
    beds: 2,
    baths: 1,
    sqft: 800,
    occupancy: "owner",
    ownerName: "Test Owner",
    ownerEmail: EMAILS.resident,
  });

  const NOW_ISO = new Date().toISOString();
  for (const u of [
    { email: EMAILS.admin, role: "admin", unitId: null },
    { email: EMAILS.manager, role: "manager", unitId: null },
    { email: EMAILS.resident, role: "resident", unitId: UNIT_ID },
  ] as const) {
    await db.insert(usersTable).values({
      email: u.email,
      role: u.role,
      name: u.email,
      unitId: u.unitId,
      createdAt: NOW_ISO,
    });
  }

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await cleanupTestData();
});

// Routes guarded by `requireNotResident`. Each entry is exercised with
// resident (expect 403), manager (expect 2xx), and admin (expect 2xx)
// tokens. /units/:id is intentionally NOT in this list — that path has
// a resident-readable read router mounted ahead of the manager gate.
const MANAGER_ONLY_GETS: ReadonlyArray<{ name: string; path: string }> = [
  { name: "GET /buildings", path: "/api/buildings" },
  { name: "GET /units (list)", path: "/api/units" },
  { name: "GET /insurance/:id/history", path: `/api/insurance/${BUILDING_NUM}/history` },
  { name: "GET /reports/spend", path: "/api/reports/spend" },
  { name: "GET /reports/spend-by-month", path: "/api/reports/spend-by-month" },
];

describe("requireNotResident gate (Task #149)", () => {
  for (const route of MANAGER_ONLY_GETS) {
    describe(route.name, () => {
      it("rejects unauthenticated requests with 401", async () => {
        const res = await fetch(url(route.path));
        assert.equal(res.status, 401, `${route.name} should be 401 unauthenticated`);
        // Drain body so the connection can close cleanly.
        await res.text();
      });

      it("rejects a resident-role token with 403", async () => {
        const u = await loadUser(EMAILS.resident);
        const res = await fetch(url(route.path), { headers: authHeaders(tokenFor(u)) });
        assert.equal(res.status, 403, `${route.name} should 403 a resident`);
        await res.text();
      });

      it("allows a manager-role token (2xx)", async () => {
        const u = await loadUser(EMAILS.manager);
        const res = await fetch(url(route.path), { headers: authHeaders(tokenFor(u)) });
        assert.ok(
          res.status >= 200 && res.status < 300,
          `${route.name} should succeed for manager, got ${res.status}`,
        );
        await res.text();
      });

      it("allows an admin-role token (2xx)", async () => {
        const u = await loadUser(EMAILS.admin);
        const res = await fetch(url(route.path), { headers: authHeaders(tokenFor(u)) });
        assert.ok(
          res.status >= 200 && res.status < 300,
          `${route.name} should succeed for admin, got ${res.status}`,
        );
        await res.text();
      });
    });
  }
});
