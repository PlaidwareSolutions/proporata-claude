// Integration tests for the membership roster API. Exercises the
// DB-backed eligibility helpers (`isMemberInGoodStanding`,
// `listMembers`, `recomputeOwnershipStatuses`) and the /api/members
// HTTP routes against a real Postgres. Test rows are scoped under a
// unique building number / unit-ID prefix so they can be torn down in
// `after` without touching pre-existing data.

// Disable pino-pretty's worker-thread transport so the test process
// can exit cleanly, and provide a JWT secret for token signing.
process.env.NODE_ENV = process.env.NODE_ENV ?? "production";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-task-143";

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
  ownerAccountsTable,
  ledgerEntriesTable,
  profileAuditTable,
  organizationSettingsTable,
} from "@workspace/db/schema";

import app from "../app.js";
import { signToken, type AuthUser, type UserRole } from "../middleware/auth.js";
import {
  isMemberInGoodStanding,
  listMembers,
} from "../lib/membership.js";

const BUILDING_NUM = 991_443;
const EMAIL_PREFIX = "t143-";

const UNIT_IDS = {
  ownerActive: "T143-A",
  ownerSusp: "T143-S",
  ownerClosed: "T143-C",
  tenant: "T143-T",
  noOwnerAccount: "T143-N",
} as const;

const EMAILS = {
  admin: `${EMAIL_PREFIX}admin@test.invalid`,
  manager: `${EMAIL_PREFIX}manager@test.invalid`,
  ownerActive: `${EMAIL_PREFIX}owner-active@test.invalid`,
  ownerSusp: `${EMAIL_PREFIX}owner-susp@test.invalid`,
  ownerClosed: `${EMAIL_PREFIX}owner-closed@test.invalid`,
  ownerNoOA: `${EMAIL_PREFIX}owner-noaccount@test.invalid`,
  tenant: `${EMAIL_PREFIX}tenant@test.invalid`,
  // Owner-of-record on the "tenant" unit. Intentionally NOT a portal
  // user: tenants are not members, even though they have a login.
  tenantUnitOwner: `${EMAIL_PREFIX}tenant-unit-owner@test.invalid`,
} as const;

interface UserRow {
  id: number;
  email: string;
  role: UserRole;
  unitId: string | null;
  pending: boolean;
  boardMember: boolean;
}

const NOW_ISO = new Date().toISOString();

let userIds: Record<keyof typeof EMAILS, number>;
let ownerAccountIds: { ownerActive: number; ownerSusp: number; ownerClosed: number; tenant: number };
let savedThreshold: number | null = null;
let createdSettingsRow = false;
let savedOwnerAccounts: Array<typeof ownerAccountsTable.$inferSelect> = [];
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
  return { Cookie: `auth_token=${token}`, "Content-Type": "application/json" };
}

async function loadUser(email: string): Promise<UserRow> {
  const [row] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      role: usersTable.role,
      unitId: usersTable.unitId,
      pending: usersTable.pending,
      boardMember: usersTable.boardMember,
    })
    .from(usersTable)
    .where(eq(usersTable.email, email));
  return {
    id: row.id,
    email: row.email,
    role: row.role as UserRole,
    unitId: row.unitId,
    pending: row.pending,
    boardMember: row.boardMember,
  };
}

async function cleanupTestData(): Promise<void> {
  const allUnits = Object.values(UNIT_IDS) as string[];
  // Users referencing test units must release the FK first.
  await db
    .update(usersTable)
    .set({ unitId: null })
    .where(sql`${usersTable.email} LIKE ${EMAIL_PREFIX + "%"}`);
  // Ledger entries reference owner_accounts; owner_accounts reference units.
  const accs = await db
    .select({ id: ownerAccountsTable.id })
    .from(ownerAccountsTable)
    .where(inArray(ownerAccountsTable.unitId, allUnits));
  const accIds = accs.map((a) => a.id);
  if (accIds.length > 0) {
    await db
      .delete(ledgerEntriesTable)
      .where(inArray(ledgerEntriesTable.ownerAccountId, accIds));
  }
  await db
    .delete(profileAuditTable)
    .where(inArray(profileAuditTable.unitId, allUnits));
  await db
    .delete(ownerAccountsTable)
    .where(inArray(ownerAccountsTable.unitId, allUnits));
  await db
    .delete(usersTable)
    .where(sql`${usersTable.email} LIKE ${EMAIL_PREFIX + "%"}`);
  await db.delete(unitsTable).where(inArray(unitsTable.id, allUnits));
  await db.delete(buildingsTable).where(eq(buildingsTable.num, BUILDING_NUM));
}

before(async () => {
  // Snapshot all owner_accounts and the threshold setting so we can
  // undo any side effects from the recompute test (which scans every
  // row in owner_accounts, not just our test rows).
  savedOwnerAccounts = await db.select().from(ownerAccountsTable);
  const [s] = await db
    .select()
    .from(organizationSettingsTable)
    .where(eq(organizationSettingsTable.id, 1));
  savedThreshold = s?.pastDueVotingThresholdDays ?? null;
  if (s) {
    if (s.pastDueVotingThresholdDays !== 60) {
      await db
        .update(organizationSettingsTable)
        .set({ pastDueVotingThresholdDays: 60 })
        .where(eq(organizationSettingsTable.id, 1));
    }
  } else {
    await db.insert(organizationSettingsTable).values({
      id: 1,
      name: "test",
      pastDueVotingThresholdDays: 60,
    });
    createdSettingsRow = true;
  }

  await cleanupTestData();

  await db.insert(buildingsTable).values({
    num: BUILDING_NUM,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    status: "ok",
    openWO: 0,
    address: "Task 143 test building",
    street: "Test St",
    units: 5,
    yearBuilt: 2020,
    roofYear: 2020,
    insuranceStatus: "ok",
  });

  const baseUnit = {
    building: BUILDING_NUM,
    address: "Task 143 test address",
    beds: 2,
    baths: 1,
    sqft: 800,
    occupancy: "owner",
  };
  await db.insert(unitsTable).values([
    {
      ...baseUnit,
      id: UNIT_IDS.ownerActive,
      unit: "A",
      ownerName: "Owner Active",
      ownerEmail: EMAILS.ownerActive,
    },
    {
      ...baseUnit,
      id: UNIT_IDS.ownerSusp,
      unit: "S",
      ownerName: "Owner Susp",
      ownerEmail: EMAILS.ownerSusp,
    },
    {
      ...baseUnit,
      id: UNIT_IDS.ownerClosed,
      unit: "C",
      ownerName: "Owner Closed",
      ownerEmail: EMAILS.ownerClosed,
    },
    {
      ...baseUnit,
      id: UNIT_IDS.tenant,
      unit: "T",
      occupancy: "tenant",
      ownerName: "Tenant Unit Owner",
      ownerEmail: EMAILS.tenantUnitOwner,
      tenantName: "Test Tenant",
      tenantEmail: EMAILS.tenant,
    },
    {
      ...baseUnit,
      id: UNIT_IDS.noOwnerAccount,
      unit: "N",
      ownerName: "Owner NoOA",
      ownerEmail: EMAILS.ownerNoOA,
    },
  ]);

  // Insert all test users.
  const userRows = [
    { email: EMAILS.admin, role: "admin", unitId: null },
    { email: EMAILS.manager, role: "manager", unitId: null },
    { email: EMAILS.ownerActive, role: "resident", unitId: UNIT_IDS.ownerActive },
    { email: EMAILS.ownerSusp, role: "resident", unitId: UNIT_IDS.ownerSusp },
    { email: EMAILS.ownerClosed, role: "resident", unitId: UNIT_IDS.ownerClosed },
    { email: EMAILS.ownerNoOA, role: "resident", unitId: UNIT_IDS.noOwnerAccount },
    { email: EMAILS.tenant, role: "resident", unitId: UNIT_IDS.tenant },
  ] as const;
  for (const u of userRows) {
    await db.insert(usersTable).values({
      email: u.email,
      role: u.role,
      name: u.email,
      unitId: u.unitId,
      createdAt: NOW_ISO,
    });
  }

  userIds = {
    admin: (await loadUser(EMAILS.admin)).id,
    manager: (await loadUser(EMAILS.manager)).id,
    ownerActive: (await loadUser(EMAILS.ownerActive)).id,
    ownerSusp: (await loadUser(EMAILS.ownerSusp)).id,
    ownerClosed: (await loadUser(EMAILS.ownerClosed)).id,
    ownerNoOA: (await loadUser(EMAILS.ownerNoOA)).id,
    tenant: (await loadUser(EMAILS.tenant)).id,
    tenantUnitOwner: 0, // sentinel; not actually inserted
  };

  // Insert owner_accounts. Note: the "noOwnerAccount" unit is
  // intentionally left without one.
  const oaInserts: Array<{ unitId: string; status: "active" | "suspended_voting" | "closed"; reason: string | null }> = [
    { unitId: UNIT_IDS.ownerActive, status: "active", reason: null },
    {
      unitId: UNIT_IDS.ownerSusp,
      status: "suspended_voting",
      // "manual:" prefix → recompute MUST skip this row.
      reason: "manual:operator override (test)",
    },
    { unitId: UNIT_IDS.ownerClosed, status: "closed", reason: "manual:title transferred" },
    { unitId: UNIT_IDS.tenant, status: "active", reason: null },
  ];
  for (const oa of oaInserts) {
    await db.insert(ownerAccountsTable).values({
      unitId: oa.unitId,
      ownershipStatus: oa.status,
      ownershipStatusChangedAt: NOW_ISO,
      ownershipStatusReason: oa.reason,
      createdAt: NOW_ISO,
    });
  }

  const accRows = await db
    .select()
    .from(ownerAccountsTable)
    .where(inArray(ownerAccountsTable.unitId, [
      UNIT_IDS.ownerActive,
      UNIT_IDS.ownerSusp,
      UNIT_IDS.ownerClosed,
      UNIT_IDS.tenant,
    ]));
  const byUnit = new Map(accRows.map((a) => [a.unitId, a.id]));
  ownerAccountIds = {
    ownerActive: byUnit.get(UNIT_IDS.ownerActive)!,
    ownerSusp: byUnit.get(UNIT_IDS.ownerSusp)!,
    ownerClosed: byUnit.get(UNIT_IDS.ownerClosed)!,
    tenant: byUnit.get(UNIT_IDS.tenant)!,
  };

  // Aged unpaid charge on ownerActive → recompute should flip to
  // suspended_voting (but only AFTER the listMembers tests run, since
  // those expect status=active).
  await db.insert(ledgerEntriesTable).values({
    ownerAccountId: ownerAccountIds.ownerActive,
    occurredOn: "2025-01-01",
    postedAt: "2025-01-01T00:00:00Z",
    kind: "charge",
    amountCents: 25_000,
    postedBy: userIds.admin,
  });

  // Boot the express app on an ephemeral port.
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

  // Restore every owner_account row that recompute may have touched.
  for (const a of savedOwnerAccounts) {
    await db
      .update(ownerAccountsTable)
      .set({
        ownershipStatus: a.ownershipStatus,
        ownershipStatusChangedAt: a.ownershipStatusChangedAt,
        ownershipStatusReason: a.ownershipStatusReason,
      })
      .where(eq(ownerAccountsTable.id, a.id));
  }

  if (createdSettingsRow) {
    await db
      .delete(organizationSettingsTable)
      .where(eq(organizationSettingsTable.id, 1));
  } else if (savedThreshold !== null) {
    await db
      .update(organizationSettingsTable)
      .set({ pastDueVotingThresholdDays: savedThreshold })
      .where(eq(organizationSettingsTable.id, 1));
  }

  await cleanupTestData();
});

// ──────────────────────────────────────────────────────────────────
// DB-backed lib tests
// ──────────────────────────────────────────────────────────────────

describe("isMemberInGoodStanding (DB-backed)", () => {
  it("classifies an active owner as a member in good standing", async () => {
    const u = await loadUser(EMAILS.ownerActive);
    const r = await isMemberInGoodStanding({ id: u.id, email: u.email, role: u.role });
    assert.equal(r.isMember, true);
    assert.equal(r.inGoodStanding, true);
    assert.equal(r.reason, "ok");
    assert.equal(r.unitId, UNIT_IDS.ownerActive);
    assert.equal(r.ownershipStatus, "active");
  });

  it("classifies a suspended_voting owner as a member NOT in good standing", async () => {
    const u = await loadUser(EMAILS.ownerSusp);
    const r = await isMemberInGoodStanding({ id: u.id, email: u.email, role: u.role });
    assert.equal(r.isMember, true);
    assert.equal(r.inGoodStanding, false);
    assert.equal(r.reason, "suspended_voting");
    assert.equal(r.ownershipStatus, "suspended_voting");
  });

  it("classifies a closed owner as NOT a member", async () => {
    const u = await loadUser(EMAILS.ownerClosed);
    const r = await isMemberInGoodStanding({ id: u.id, email: u.email, role: u.role });
    assert.equal(r.isMember, false);
    assert.equal(r.inGoodStanding, false);
    assert.equal(r.reason, "closed");
  });

  it("classifies a tenant (not the owner of record) as not a member", async () => {
    const u = await loadUser(EMAILS.tenant);
    const r = await isMemberInGoodStanding({ id: u.id, email: u.email, role: u.role });
    assert.equal(r.isMember, false);
    assert.equal(r.inGoodStanding, false);
    assert.equal(r.reason, "not_owner");
    assert.equal(r.unitId, null);
  });

  it("classifies a manager without an owned unit as not a member", async () => {
    const u = await loadUser(EMAILS.manager);
    const r = await isMemberInGoodStanding({ id: u.id, email: u.email, role: u.role });
    assert.equal(r.isMember, false);
    assert.equal(r.inGoodStanding, false);
    assert.equal(r.reason, "not_owner");
  });

  it("classifies an owner of a unit with no owner_account row as no_owner_account", async () => {
    const u = await loadUser(EMAILS.ownerNoOA);
    const r = await isMemberInGoodStanding({ id: u.id, email: u.email, role: u.role });
    assert.equal(r.isMember, false);
    assert.equal(r.inGoodStanding, false);
    assert.equal(r.reason, "no_owner_account");
    assert.equal(r.unitId, UNIT_IDS.noOwnerAccount);
  });
});

describe("listMembers (DB-backed)", () => {
  it("includes one row per test unit with the correct flags", async () => {
    const rows = await listMembers();
    const byUnit = new Map(rows.map((r) => [r.unitId, r]));

    const active = byUnit.get(UNIT_IDS.ownerActive);
    assert.ok(active, "ownerActive unit missing from roster");
    assert.equal(active!.inGoodStanding, true);
    assert.equal(active!.ownershipStatus, "active");
    assert.equal(active!.hasOwnerAccount, true);
    assert.equal(active!.ineligibilityReason, null);
    assert.equal(active!.ownerEmail, EMAILS.ownerActive);
    assert.equal(active!.ownerUserId, userIds.ownerActive);

    const susp = byUnit.get(UNIT_IDS.ownerSusp);
    assert.ok(susp, "ownerSusp unit missing");
    assert.equal(susp!.inGoodStanding, false);
    assert.equal(susp!.ownershipStatus, "suspended_voting");
    assert.ok(susp!.ineligibilityReason?.startsWith("ownership_status=suspended_voting"));

    const closed = byUnit.get(UNIT_IDS.ownerClosed);
    assert.ok(closed);
    assert.equal(closed!.inGoodStanding, false);
    assert.equal(closed!.ownershipStatus, "closed");
    assert.equal(closed!.ineligibilityReason, "ownership_status=closed");

    const tenantUnit = byUnit.get(UNIT_IDS.tenant);
    assert.ok(tenantUnit, "tenant unit missing — listMembers must surface units regardless of occupancy");
    // Owner of record on this unit is NOT a portal user, so ownerUserId is null.
    assert.equal(tenantUnit!.ownerUserId, null);
    assert.equal(tenantUnit!.inGoodStanding, true);

    const noOA = byUnit.get(UNIT_IDS.noOwnerAccount);
    assert.ok(noOA, "unit with no owner_account row must still be listed");
    assert.equal(noOA!.hasOwnerAccount, false);
    assert.equal(noOA!.inGoodStanding, false);
    assert.equal(noOA!.ineligibilityReason, "no_owner_account");
  });
});

// ──────────────────────────────────────────────────────────────────
// Route tests
// ──────────────────────────────────────────────────────────────────

describe("GET /api/members", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await fetch(url("/api/members"));
    assert.equal(res.status, 401);
  });

  it("rejects residents with 403", async () => {
    const u = await loadUser(EMAILS.ownerActive);
    const res = await fetch(url("/api/members"), { headers: authHeaders(tokenFor(u)) });
    assert.equal(res.status, 403);
  });

  it("returns the roster with correct counts to a manager", async () => {
    const u = await loadUser(EMAILS.manager);
    const res = await fetch(url("/api/members"), { headers: authHeaders(tokenFor(u)) });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      members: Array<{ unitId: string; inGoodStanding: boolean }>;
      counts: { total: number; inGoodStanding: number; notInGoodStanding: number };
    };
    assert.equal(body.counts.total, body.members.length);
    assert.equal(
      body.counts.inGoodStanding,
      body.members.filter((m) => m.inGoodStanding).length,
    );
    assert.equal(
      body.counts.notInGoodStanding,
      body.members.filter((m) => !m.inGoodStanding).length,
    );
    const unitIds = new Set(body.members.map((m) => m.unitId));
    for (const id of Object.values(UNIT_IDS)) {
      assert.ok(unitIds.has(id), `expected unit ${id} in roster`);
    }
  });
});

describe("POST /api/members/recompute", () => {
  it("rejects residents with 403", async () => {
    const u = await loadUser(EMAILS.ownerActive);
    const res = await fetch(url("/api/members/recompute"), {
      method: "POST",
      headers: authHeaders(tokenFor(u)),
    });
    assert.equal(res.status, 403);
  });

  it("flips active rows with aged unpaid charges and skips manual:/closed rows", async () => {
    const u = await loadUser(EMAILS.manager);
    const res = await fetch(url("/api/members/recompute"), {
      method: "POST",
      headers: authHeaders(tokenFor(u)),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      scanned: number;
      updated: number;
      flippedToSuspended: number;
      flippedToActive: number;
      total: number;
      inGoodStanding: number;
    };
    assert.ok(body.scanned >= 4, "scanned count should include our 4 test owner_accounts");
    assert.ok(body.flippedToSuspended >= 1, "ownerActive aged charge should have flipped to suspended");

    // ownerActive: flipped to suspended with auto: reason.
    const [active] = await db
      .select()
      .from(ownerAccountsTable)
      .where(eq(ownerAccountsTable.id, ownerAccountIds.ownerActive));
    assert.equal(active.ownershipStatus, "suspended_voting");
    assert.ok(
      active.ownershipStatusReason?.startsWith("auto:past_due_"),
      `reason should be auto:past_due_*, was ${active.ownershipStatusReason}`,
    );

    // ownerSusp: manual: reason → must be skipped (status + reason unchanged).
    const [susp] = await db
      .select()
      .from(ownerAccountsTable)
      .where(eq(ownerAccountsTable.id, ownerAccountIds.ownerSusp));
    assert.equal(susp.ownershipStatus, "suspended_voting");
    assert.ok(
      susp.ownershipStatusReason?.startsWith("manual:"),
      "manual: row must NOT have its reason rewritten by recompute",
    );

    // ownerClosed: closed → must be skipped.
    const [closed] = await db
      .select()
      .from(ownerAccountsTable)
      .where(eq(ownerAccountsTable.id, ownerAccountIds.ownerClosed));
    assert.equal(closed.ownershipStatus, "closed");
  });
});

describe("PATCH /api/members/:unitId/status", () => {
  it("rejects managers with 403 (admin-only)", async () => {
    const u = await loadUser(EMAILS.manager);
    const res = await fetch(url(`/api/members/${UNIT_IDS.tenant}/status`), {
      method: "PATCH",
      headers: authHeaders(tokenFor(u)),
      body: JSON.stringify({ status: "closed", reason: "should not work" }),
    });
    assert.equal(res.status, 403);
  });

  it("rejects an invalid status with 400", async () => {
    const u = await loadUser(EMAILS.admin);
    const res = await fetch(url(`/api/members/${UNIT_IDS.tenant}/status`), {
      method: "PATCH",
      headers: authHeaders(tokenFor(u)),
      body: JSON.stringify({ status: "bogus", reason: "x" }),
    });
    assert.equal(res.status, 400);
  });

  it("rejects a missing reason with 400", async () => {
    const u = await loadUser(EMAILS.admin);
    const res = await fetch(url(`/api/members/${UNIT_IDS.tenant}/status`), {
      method: "PATCH",
      headers: authHeaders(tokenFor(u)),
      body: JSON.stringify({ status: "closed" }),
    });
    assert.equal(res.status, 400);
  });

  it("returns 404 for an unknown unitId", async () => {
    const u = await loadUser(EMAILS.admin);
    const res = await fetch(url(`/api/members/T143-DOES-NOT-EXIST/status`), {
      method: "PATCH",
      headers: authHeaders(tokenFor(u)),
      body: JSON.stringify({ status: "closed", reason: "no such unit" }),
    });
    assert.equal(res.status, 404);
  });

  it("updates the status as an admin and writes a profile_audit row", async () => {
    const u = await loadUser(EMAILS.admin);
    const res = await fetch(url(`/api/members/${UNIT_IDS.tenant}/status`), {
      method: "PATCH",
      headers: authHeaders(tokenFor(u)),
      body: JSON.stringify({ status: "closed", reason: "ownership transferred" }),
    });
    assert.equal(res.status, 200);

    const [acc] = await db
      .select()
      .from(ownerAccountsTable)
      .where(eq(ownerAccountsTable.id, ownerAccountIds.tenant));
    assert.equal(acc.ownershipStatus, "closed");
    assert.ok(
      acc.ownershipStatusReason?.startsWith("manual:ownership transferred"),
      `reason should be manual:..., was ${acc.ownershipStatusReason}`,
    );

    const audit = await db
      .select()
      .from(profileAuditTable)
      .where(eq(profileAuditTable.unitId, UNIT_IDS.tenant));
    const last = audit[audit.length - 1];
    assert.ok(last, "expected a profile_audit row");
    assert.equal(last.userId, userIds.admin);
    assert.equal(last.field, "owner_account.ownership_status");
    assert.equal(last.action, "update");
    assert.equal(last.newValue, "closed");
    assert.equal(last.oldValue, "active");
  });
});
