// Membership roster and eligibility.
//
// "Membership" in this app is a legal concept that runs with title to a
// unit, not a portal/login concept. By Texas non-profit / HOA convention:
//
//   - A user is a *member* iff they are the recorded owner of an
//     existing unit AND their owner_accounts.ownership_status is
//     "active". Tenants, co-occupants, managers, admins, and unitless
//     users are NEVER members for the purposes of voting / quorum /
//     candidacy — even if they have a portal login.
//   - "Good standing" is `ownership_status === "active"`.
//     "suspended_voting" owners and "closed" owners are NOT in good
//     standing and must be rejected from member-only endpoints.
//   - The email column on `units` is contact info only. It is NOT,
//     and must never be treated as, a membership grant.
//
// `ownership_status` is derived nightly (and on demand) from the
// configured past-due threshold (organization_settings.
// past_due_voting_threshold_days, default 60). An admin may manually
// override the status; manual overrides are audit-logged.

import { db } from "@workspace/db";
import {
  ownerAccountsTable,
  unitsTable,
  usersTable,
  ledgerEntriesTable,
  organizationSettingsTable,
  profileAuditTable,
} from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

export type OwnershipStatus = "active" | "suspended_voting" | "closed";

export interface AuthLikeUser {
  id: number;
  email?: string;
  role?: string;
}

export type EligibilityReason =
  | "ok"
  | "no_unit"
  | "not_owner"
  | "no_owner_account"
  | "suspended_voting"
  | "closed";

export interface MemberEligibility {
  isMember: boolean;
  inGoodStanding: boolean;
  unitId: string | null;
  ownershipStatus: OwnershipStatus | null;
  reason: EligibilityReason;
}

/**
 * Pure classifier — given the user, the matched unit row (if any), and
 * the owner_account row (if any), decide membership and good-standing.
 * Extracted from the DB-fetching wrapper so tests can exercise every
 * branch without a live database.
 */
export function classifyEligibility(opts: {
  user: AuthLikeUser | null | undefined;
  userEmail: string | null;
  ownedUnitId: string | null;
  ownershipStatus: OwnershipStatus | null;
  hasOwnerAccount: boolean;
}): MemberEligibility {
  const { user, userEmail, ownedUnitId, ownershipStatus, hasOwnerAccount } = opts;
  if (!user || typeof user.id !== "number") {
    return { isMember: false, inGoodStanding: false, unitId: null, ownershipStatus: null, reason: "no_unit" };
  }
  if (!userEmail) {
    return { isMember: false, inGoodStanding: false, unitId: null, ownershipStatus: null, reason: "not_owner" };
  }
  if (!ownedUnitId) {
    return { isMember: false, inGoodStanding: false, unitId: null, ownershipStatus: null, reason: "not_owner" };
  }
  if (!hasOwnerAccount) {
    return { isMember: false, inGoodStanding: false, unitId: ownedUnitId, ownershipStatus: null, reason: "no_owner_account" };
  }
  const status = ownershipStatus ?? "active";
  if (status === "active") {
    return { isMember: true, inGoodStanding: true, unitId: ownedUnitId, ownershipStatus: status, reason: "ok" };
  }
  return {
    isMember: status !== "closed",
    inGoodStanding: false,
    unitId: ownedUnitId,
    ownershipStatus: status,
    reason: status,
  };
}

/**
 * Resolve whether the given authenticated user is a member in good
 * standing. A user is a member iff they are the recorded owner of a
 * unit AND that unit's owner_accounts.ownership_status is "active".
 *
 * Tenants, managers/admins without an owned unit, and owners whose
 * ownership_status is "suspended_voting" or "closed" all return
 * `inGoodStanding: false`.
 */
export async function isMemberInGoodStanding(
  user: AuthLikeUser,
): Promise<MemberEligibility> {
  if (!user || typeof user.id !== "number") {
    return classifyEligibility({ user: null, userEmail: null, ownedUnitId: null, ownershipStatus: null, hasOwnerAccount: false });
  }

  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  const userEmail = (u?.email ?? "").trim().toLowerCase() || null;
  if (!u || !userEmail) {
    return classifyEligibility({ user, userEmail: null, ownedUnitId: null, ownershipStatus: null, hasOwnerAccount: false });
  }

  const [unit] = await db
    .select({ id: unitsTable.id })
    .from(unitsTable)
    .where(sql`LOWER(TRIM(${unitsTable.ownerEmail})) = ${userEmail}`);

  if (!unit) {
    return classifyEligibility({ user, userEmail, ownedUnitId: null, ownershipStatus: null, hasOwnerAccount: false });
  }

  const [oa] = await db
    .select()
    .from(ownerAccountsTable)
    .where(eq(ownerAccountsTable.unitId, unit.id));

  return classifyEligibility({
    user,
    userEmail,
    ownedUnitId: unit.id,
    ownershipStatus: (oa?.ownershipStatus as OwnershipStatus | undefined) ?? null,
    hasOwnerAccount: !!oa,
  });
}

export interface MemberRosterRow {
  unitId: string;
  unit: string;
  building: number;
  ownerName: string;
  ownerEmail: string | null;
  ownerUserId: number | null;
  boardMember: boolean;
  ownershipStatus: OwnershipStatus;
  ownershipStatusChangedAt: string | null;
  ownershipStatusReason: string | null;
  hasOwnerAccount: boolean;
  balanceCents: number;
  oldestUnpaidChargeAt: string | null;
  daysPastDue: number;
  inGoodStanding: boolean;
  ineligibilityReason: string | null;
}

/**
 * List one row per unit (the membership roster). Tenants are excluded.
 * Returns the primary owner of record (single-owner-per-unit; co-owner
 * modeling is out of scope). Units without an owner_account row are
 * surfaced but flagged `inGoodStanding: false` so they cannot be
 * silently counted toward quorum.
 */
export async function listMembers(now: Date = new Date()): Promise<MemberRosterRow[]> {
  const units = await db.select().from(unitsTable);
  if (units.length === 0) return [];

  const accounts = await db.select().from(ownerAccountsTable);
  const accByUnit = new Map(accounts.map((a) => [a.unitId, a]));

  const userRows = await db
    .select({ id: usersTable.id, email: usersTable.email, boardMember: usersTable.boardMember, pending: usersTable.pending })
    .from(usersTable);
  const userByEmail = new Map(userRows.map((u) => [u.email.trim().toLowerCase(), u]));

  const accountIds = accounts.map((a) => a.id);
  const ledgerByAccount = new Map<number, { kind: string; occurredOn: string; amountCents: number }[]>();
  if (accountIds.length > 0) {
    const entries = await db.select().from(ledgerEntriesTable);
    for (const e of entries) {
      if (!accountIds.includes(e.ownerAccountId)) continue;
      const list = ledgerByAccount.get(e.ownerAccountId) ?? [];
      list.push({ kind: e.kind, occurredOn: e.occurredOn, amountCents: e.amountCents });
      ledgerByAccount.set(e.ownerAccountId, list);
    }
  }

  const [settings] = await db
    .select()
    .from(organizationSettingsTable)
    .where(eq(organizationSettingsTable.id, 1));
  const thresholdDays = settings?.pastDueVotingThresholdDays ?? 60;

  const rows: MemberRosterRow[] = [];
  for (const u of units) {
    const acc = accByUnit.get(u.id);
    const status = ((acc?.ownershipStatus as OwnershipStatus | undefined) ?? "active");
    const ownerEmail = (u.ownerEmail ?? "").trim();
    const matched = ownerEmail ? userByEmail.get(ownerEmail.toLowerCase()) : undefined;
    const entries = acc ? (ledgerByAccount.get(acc.id) ?? []) : [];
    const aging = computeAging(entries, now);
    const inGood = !!acc && status === "active";
    let reason: string | null = null;
    if (!acc) reason = "no_owner_account";
    else if (status === "suspended_voting") reason = `ownership_status=suspended_voting (past_due_${thresholdDays}_days)`;
    else if (status === "closed") reason = "ownership_status=closed";

    rows.push({
      unitId: u.id,
      unit: u.unit,
      building: u.building,
      ownerName: u.ownerName,
      ownerEmail: ownerEmail || null,
      ownerUserId: matched && !matched.pending ? matched.id : null,
      boardMember: matched ? matched.boardMember === true : false,
      ownershipStatus: status,
      ownershipStatusChangedAt: acc?.ownershipStatusChangedAt ?? null,
      ownershipStatusReason: acc?.ownershipStatusReason ?? null,
      hasOwnerAccount: !!acc,
      balanceCents: aging.balanceCents,
      oldestUnpaidChargeAt: aging.oldestUnpaidChargeAt,
      daysPastDue: aging.daysPastDue,
      inGoodStanding: inGood,
      ineligibilityReason: reason,
    });
  }
  rows.sort((a, b) => {
    if (a.building !== b.building) return a.building - b.building;
    return a.unit.localeCompare(b.unit);
  });
  return rows;
}

/** Subset of `listMembers` that returns only voting-eligible members. */
export async function listMembersInGoodStanding(now: Date = new Date()): Promise<MemberRosterRow[]> {
  const rows = await listMembers(now);
  return rows.filter((r) => r.inGoodStanding);
}

/** Count of members eligible to vote (good-standing owners only). */
export async function countMembersInGoodStanding(now: Date = new Date()): Promise<{
  total: number;
  inGoodStanding: number;
}> {
  const rows = await listMembers(now);
  return {
    total: rows.length,
    inGoodStanding: rows.filter((r) => r.inGoodStanding).length,
  };
}

/**
 * Recompute ownership_status for every owner_account based on the
 * configured past-due threshold. Owners whose oldest unpaid charge
 * is older than the threshold flip to "suspended_voting"; owners
 * whose ledger no longer shows aged unpaid charges flip back to
 * "active". "closed" rows are never auto-changed and require an
 * admin override to leave that state.
 *
 * Manual overrides (rows whose status was last changed with reason
 * starting "manual:") are also left alone — admin intent wins until
 * an admin reverses it.
 */
export async function recomputeOwnershipStatuses(now: Date = new Date()): Promise<{
  scanned: number;
  updated: number;
  flippedToSuspended: number;
  flippedToActive: number;
}> {
  const [settings] = await db
    .select()
    .from(organizationSettingsTable)
    .where(eq(organizationSettingsTable.id, 1));
  const thresholdDays = settings?.pastDueVotingThresholdDays ?? 60;

  const accounts = await db.select().from(ownerAccountsTable);
  let flippedToSuspended = 0;
  let flippedToActive = 0;

  for (const acc of accounts) {
    const status = (acc.ownershipStatus as OwnershipStatus | undefined) ?? "active";
    if (status === "closed") continue;
    if ((acc.ownershipStatusReason ?? "").startsWith("manual:")) continue;

    const entries = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.ownerAccountId, acc.id));

    const aged = hasAgedUnpaidCharge(entries, thresholdDays, now);
    const next: OwnershipStatus = aged ? "suspended_voting" : "active";
    if (next !== status) {
      await db
        .update(ownerAccountsTable)
        .set({
          ownershipStatus: next,
          ownershipStatusChangedAt: now.toISOString(),
          ownershipStatusReason: aged
            ? `auto:past_due_${thresholdDays}_days`
            : "auto:caught_up",
        })
        .where(eq(ownerAccountsTable.id, acc.id));
      if (next === "suspended_voting") flippedToSuspended++;
      else flippedToActive++;
    }
  }

  return {
    scanned: accounts.length,
    updated: flippedToSuspended + flippedToActive,
    flippedToSuspended,
    flippedToActive,
  };
}

type EntryLite = {
  kind: string;
  occurredOn: string;
  amountCents: number;
};

/**
 * FIFO-walk a ledger and return aging info (open balance, oldest unpaid
 * charge date, days past due). Mirrors the `deriveStatus` logic in
 * `routes/billing.ts` so this and billing don't drift apart.
 */
export function computeAging(
  entries: EntryLite[],
  now: Date,
): { balanceCents: number; oldestUnpaidChargeAt: string | null; daysPastDue: number } {
  type Charge = { occurredOn: string; remaining: number };
  const open: Charge[] = [];
  let credit = 0;
  const sorted = [...entries].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
  function applyCredit(amount: number) {
    let remaining = amount;
    for (const c of open) {
      if (remaining <= 0) break;
      if (c.remaining <= 0) continue;
      const take = Math.min(c.remaining, remaining);
      c.remaining -= take;
      remaining -= take;
    }
    credit += remaining;
  }
  function consumeCredit(amount: number): number {
    const take = Math.min(credit, amount);
    credit -= take;
    return amount - take;
  }
  for (const e of sorted) {
    if (e.kind === "charge") {
      const after = consumeCredit(e.amountCents);
      if (after > 0) open.push({ occurredOn: e.occurredOn, remaining: after });
    } else if (e.kind === "payment") {
      applyCredit(e.amountCents);
    } else if (e.kind === "void" || e.kind === "refund") {
      const reversal = -e.amountCents;
      if (reversal < 0) applyCredit(-reversal);
      else open.push({ occurredOn: e.occurredOn, remaining: reversal });
    }
  }
  let balance = 0;
  let oldest: string | null = null;
  for (const c of open) {
    if (c.remaining <= 0) continue;
    balance += c.remaining;
    if (oldest === null || c.occurredOn < oldest) oldest = c.occurredOn;
  }
  balance -= credit;
  let daysPastDue = 0;
  if (oldest) {
    const ageMs = now.getTime() - new Date(oldest).getTime();
    daysPastDue = Math.max(0, Math.floor(ageMs / 86400_000));
  }
  return { balanceCents: balance, oldestUnpaidChargeAt: oldest, daysPastDue };
}

/** Returns true when any unpaid charge is older than `thresholdDays`. */
export function hasAgedUnpaidCharge(
  entries: EntryLite[],
  thresholdDays: number,
  now: Date,
): boolean {
  const aging = computeAging(entries, now);
  if (!aging.oldestUnpaidChargeAt) return false;
  return aging.daysPastDue >= thresholdDays;
}

/**
 * Set an owner_account's ownership_status manually. Audit-logged via
 * profile_audit so future reviews can see who changed what.
 */
export async function setOwnershipStatus(opts: {
  unitId: string;
  status: OwnershipStatus;
  reason: string;
  actorUserId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const [acc] = await db
    .select()
    .from(ownerAccountsTable)
    .where(eq(ownerAccountsTable.unitId, opts.unitId));
  if (!acc) return { ok: false, error: "owner account not found" };
  const oldStatus = (acc.ownershipStatus as OwnershipStatus | undefined) ?? "active";
  const now = new Date().toISOString();
  await db
    .update(ownerAccountsTable)
    .set({
      ownershipStatus: opts.status,
      ownershipStatusChangedAt: now,
      ownershipStatusReason: `manual:${opts.reason}`.slice(0, 240),
    })
    .where(eq(ownerAccountsTable.id, acc.id));
  await db.insert(profileAuditTable).values({
    userId: opts.actorUserId,
    unitId: opts.unitId,
    action: "update",
    field: "owner_account.ownership_status",
    oldValue: oldStatus,
    newValue: opts.status,
    createdAt: now,
  });
  return { ok: true };
}
