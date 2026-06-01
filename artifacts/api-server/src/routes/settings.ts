import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { requireAdmin } from "../middleware/auth.js";
import {
  organizationSettingsTable,
  documentCategoriesTable,
  mapMarkersTable,
  userNotificationPreferencesTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import {
  validateMotionAuthorizes,
  findUnconsumedBypassFor,
  findPendingMotionFor,
  gateRequiredError,
  markBypassConsumed,
} from "../lib/motionGates.js";

const router: IRouter = Router();

const DEFAULT_ORG = {
  id: 1,
  name: "Quail Valley HOA",
  address: null as string | null,
  contactEmail: "manager@quailvalleyhoa.org" as string | null,
  phone: null as string | null,
  timezone: "America/Chicago",
  notificationPreferences: { urgent: true, expiring: true, weekly: false } as Record<string, boolean> | null,
};

async function getOrCreateOrgSettings() {
  const [row] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  if (row) return row;
  const [created] = await db
    .insert(organizationSettingsTable)
    .values(DEFAULT_ORG)
    .returning();
  return created!;
}

router.get("/settings", async (_req, res) => {
  try {
    const settings = await getOrCreateOrgSettings();
    res.json(toOrgSettings(settings));
  } catch (err) {
    console.error("GET /settings error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Task #64: list of organization-settings columns that can be flagged "gated".
// When any of these keys is included in `gatedPolicies`, direct PATCHes to it
// (top-level /settings, /settings/bids, /settings/acc) are blocked and the
// caller is told to open a policy_change motion instead.
const GATED_KEY_TO_PATCH_FIELD: Record<string, string> = {
  bidMinQuotesThresholdCents: "bidMinQuotesThresholdCents",
  bidDefaultSealed: "bidDefaultSealed",
  bidReminderDaysBefore: "bidReminderDaysBefore",
  accEnabled: "accEnabled",
  accQuorumMode: "accQuorumMode",
  accAutoApprovalDays: "accAutoApprovalDays",
  paymentsEnabled: "paymentsEnabled",
  paymentsSurchargeEnabled: "paymentsSurchargeEnabled",
  paymentsSurchargePercentBp: "paymentsSurchargePercentBp",
  paymentsAutoPayLagDays: "paymentsAutoPayLagDays",
  notificationPreferences: "notificationPreferences",
  name: "name",
  address: "address",
  contactEmail: "contactEmail",
  phone: "phone",
  timezone: "timezone",
};

async function enforcePolicyGate(
  req: import("express").Request,
  res: import("express").Response,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const [orgRow] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  const gated = ((orgRow?.gatedPolicies as string[] | null) ?? []);
  if (gated.length === 0) return true;
  const offending = Object.keys(patch).filter((k) => gated.includes(k) && k in GATED_KEY_TO_PATCH_FIELD);
  if (offending.length === 0) return true;
  const motionIdRaw = (req.body as { motionId?: number | null }).motionId;
  const bypassIdRaw = (req.body as { bypassId?: number | null }).bypassId;
  // Each gated key requires its own Adopted policy_change motion. We only
  // accept exactly-one-key updates when going through the gate.
  if (offending.length > 1) {
    res.status(409).json({
      error: "motion_required",
      reason: `Multiple gated policies cannot be changed in one request: ${offending.join(", ")}`,
    });
    return false;
  }
  const policyKey = offending[0];
  const targetId = `policy:${policyKey}`;
  if (typeof bypassIdRaw === "number") {
    const bp = await findUnconsumedBypassFor("policy", targetId, bypassIdRaw);
    if (!bp) { res.status(409).json({ error: "motion_required", reason: "Bypass not found or already consumed" }); return false; }
    await markBypassConsumed(bp.id);
    return true;
  }
  if (typeof motionIdRaw === "number") {
    const v = await validateMotionAuthorizes({
      motionId: motionIdRaw, expectedKind: "policy_change",
      targetType: "policy", targetId,
    });
    if (!v.ok) { res.status(409).json({ error: "motion_required", reason: v.reason }); return false; }
    return true;
  }
  res.status(409).json(gateRequiredError({
    reason: `Policy "${policyKey}" is gated; an Adopted policy_change motion is required to change it.`,
    targetType: "policy", targetId, motionKind: "policy_change",
    pendingMotionId: await findPendingMotionFor("policy", targetId),
  }).body);
  return false;
}

router.patch("/settings", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name;
  if ("address" in body) patch.address = body.address === null ? null : String(body.address);
  if ("contactEmail" in body) patch.contactEmail = body.contactEmail === null ? null : String(body.contactEmail);
  if ("phone" in body) patch.phone = body.phone === null ? null : String(body.phone);
  if (typeof body.timezone === "string") patch.timezone = body.timezone;
  if ("notificationPreferences" in body && (body.notificationPreferences === null || typeof body.notificationPreferences === "object")) {
    patch.notificationPreferences = body.notificationPreferences;
  }
  if (typeof body.paymentsEnabled === "boolean") patch.paymentsEnabled = body.paymentsEnabled;
  if (typeof body.paymentsSurchargeEnabled === "boolean") patch.paymentsSurchargeEnabled = body.paymentsSurchargeEnabled;
  if (typeof body.paymentsSurchargePercentBp === "number" && Number.isFinite(body.paymentsSurchargePercentBp)) {
    patch.paymentsSurchargePercentBp = Math.max(0, Math.round(body.paymentsSurchargePercentBp as number));
  }
  if (typeof body.paymentsAutoPayLagDays === "number" && Number.isFinite(body.paymentsAutoPayLagDays)) {
    patch.paymentsAutoPayLagDays = Math.max(0, Math.round(body.paymentsAutoPayLagDays as number));
  }
  // Configurable past-due threshold (days) that drives ownership_status
  // suspension. Default 60. Stored on organization_settings.
  if (typeof body.pastDueVotingThresholdDays === "number" && Number.isFinite(body.pastDueVotingThresholdDays)) {
    patch.pastDueVotingThresholdDays = Math.max(0, Math.round(body.pastDueVotingThresholdDays as number));
  }
  // Task #146 — admins bump the org-wide welcome-tour version after major
  // releases to opt the whole community into the tour again. Restricted to
  // admins (the UI control on /settings is admin-only) and clamped to a
  // monotonic increase so a stale client can't silently regress it and
  // re-prompt everyone unintentionally.
  if (typeof body.currentTourVersion === "number" && Number.isFinite(body.currentTourVersion)) {
    if (req.user?.role !== "admin") {
      res.status(403).json({ error: "Only admins can change the welcome-tour version" });
      return;
    }
    const [orgRow] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
    const cur = orgRow?.currentTourVersion ?? 1;
    const next = Math.max(1, Math.round(body.currentTourVersion as number));
    if (next < cur) {
      res.status(400).json({ error: "currentTourVersion cannot be decreased" });
      return;
    }
    patch.currentTourVersion = next;
  }
  // OCR fields are admin-only — see PATCH /settings/ocr below. Strip
  // anything an unprivileged client might send on the general settings PATCH.
  delete body.ocrEnabled;
  delete body.ocrDailyPageCap;
  try {
    await getOrCreateOrgSettings();
    if (!(await enforcePolicyGate(req, res, patch))) return;
    const [updated] = await db
      .update(organizationSettingsTable)
      .set(patch)
      .where(eq(organizationSettingsTable.id, 1))
      .returning();
    res.json(toOrgSettings(updated!));
  } catch (err) {
    console.error("PATCH /settings error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// OCR auto-tag suggestion settings — admin-only mutation. Reads come from
// `GET /settings`. Kept on a dedicated path so the auth gate is unambiguous.
router.patch("/settings/ocr", requireAdmin, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (typeof body.ocrEnabled === "boolean") patch.ocrEnabled = body.ocrEnabled;
  if (typeof body.ocrDailyPageCap === "number" && Number.isFinite(body.ocrDailyPageCap)) {
    patch.ocrDailyPageCap = Math.max(0, Math.round(body.ocrDailyPageCap as number));
  }
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No OCR settings to update" });
    return;
  }
  try {
    await getOrCreateOrgSettings();
    const [updated] = await db
      .update(organizationSettingsTable)
      .set(patch)
      .where(eq(organizationSettingsTable.id, 1))
      .returning();
    res.json(toOrgSettings(updated!));
  } catch (err) {
    console.error("PATCH /settings/ocr error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/settings/categories", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(documentCategoriesTable)
      .orderBy(documentCategoriesTable.sortOrder, documentCategoriesTable.id);
    res.json(rows.map(toCategory));
  } catch (err) {
    console.error("GET /settings/categories error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/settings/categories", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  try {
    const existing = await db
      .select()
      .from(documentCategoriesTable)
      .orderBy(documentCategoriesTable.sortOrder, documentCategoriesTable.id);
    const maxOrder = existing.length > 0 ? Math.max(...existing.map((r) => r.sortOrder)) : -1;
    const [created] = await db
      .insert(documentCategoriesTable)
      .values({ name: body.name.trim(), sortOrder: maxOrder + 1 })
      .returning();
    res.status(201).json(toCategory(created!));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "Category already exists" });
    } else {
      console.error("POST /settings/categories error", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.delete("/settings/categories/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid category id" });
    return;
  }
  try {
    const result = await db
      .delete(documentCategoriesTable)
      .where(eq(documentCategoriesTable.id, id))
      .returning();
    if (result.length === 0) {
      res.status(404).json({ error: "Category not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /settings/categories/:id error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const DEFAULT_USER_ID = "manager";

function getUserId(req: Parameters<typeof router.get>[1] extends (req: infer R, ...args: never[]) => void ? R : never): string {
  const header = req.headers["x-user-id"];
  if (typeof header === "string" && header.trim()) return header.trim();
  return DEFAULT_USER_ID;
}

async function getOrCreateUserNotifPrefs(userId: string) {
  const [row] = await db
    .select()
    .from(userNotificationPreferencesTable)
    .where(eq(userNotificationPreferencesTable.userId, userId));
  if (row) return row;
  const [created] = await db
    .insert(userNotificationPreferencesTable)
    .values({ userId, urgent: 1, expiring: 1, weekly: 0 })
    .returning();
  return created!;
}

router.get("/settings/notification-preferences", async (req, res) => {
  try {
    const userId = getUserId(req);
    const row = await getOrCreateUserNotifPrefs(userId);
    res.json(toUserNotifPrefs(row));
  } catch (err) {
    console.error("GET /settings/notification-preferences error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/settings/notification-preferences", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const patch: Partial<{ urgent: number; expiring: number; weekly: number }> = {};
  if (typeof body.urgent === "boolean") patch.urgent = body.urgent ? 1 : 0;
  if (typeof body.expiring === "boolean") patch.expiring = body.expiring ? 1 : 0;
  if (typeof body.weekly === "boolean") patch.weekly = body.weekly ? 1 : 0;
  try {
    const userId = getUserId(req);
    await getOrCreateUserNotifPrefs(userId);
    const [updated] = await db
      .update(userNotificationPreferencesTable)
      .set(patch)
      .where(eq(userNotificationPreferencesTable.userId, userId))
      .returning();
    res.json(toUserNotifPrefs(updated!));
  } catch (err) {
    console.error("PATCH /settings/notification-preferences error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/settings/markers", async (_req, res) => {
  try {
    const rows = await db.select().from(mapMarkersTable);
    res.json(rows.map(toMarker));
  } catch (err) {
    console.error("GET /settings/markers error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const VALID_VIEWS = ["plat", "satellite", "roadmap"];

router.patch("/settings/markers/:buildingNum/:view", async (req, res) => {
  const buildingNum = parseInt(req.params.buildingNum, 10);
  const view = req.params.view;
  if (isNaN(buildingNum) || !VALID_VIEWS.includes(view)) {
    res.status(400).json({ error: "Invalid building number or view" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body.left !== "number" || typeof body.top !== "number") {
    res.status(400).json({ error: "left and top are required numbers" });
    return;
  }
  try {
    const [row] = await db
      .select()
      .from(mapMarkersTable)
      .where(and(eq(mapMarkersTable.buildingNum, buildingNum), eq(mapMarkersTable.view, view)));
    let result;
    if (row) {
      [result] = await db
        .update(mapMarkersTable)
        .set({ left: body.left, top: body.top })
        .where(eq(mapMarkersTable.id, row.id))
        .returning();
    } else {
      [result] = await db
        .insert(mapMarkersTable)
        .values({ buildingNum, view, left: body.left, top: body.top })
        .returning();
    }
    res.json(toMarker(result!));
  } catch (err) {
    console.error("PATCH /settings/markers error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

function toOrgSettings(row: typeof organizationSettingsTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    address: row.address ?? null,
    contactEmail: row.contactEmail ?? null,
    phone: row.phone ?? null,
    timezone: row.timezone,
    notificationPreferences: (row.notificationPreferences as Record<string, boolean> | null) ?? { urgent: true, expiring: true, weekly: false },
    bidMinQuotesThresholdCents: row.bidMinQuotesThresholdCents ?? 0,
    bidDefaultSealed: row.bidDefaultSealed ?? false,
    bidReminderDaysBefore: row.bidReminderDaysBefore ?? 3,
    paymentsEnabled: !!row.paymentsEnabled,
    paymentsSurchargeEnabled: !!row.paymentsSurchargeEnabled,
    paymentsSurchargePercentBp: row.paymentsSurchargePercentBp ?? 0,
    paymentsAutoPayLagDays: row.paymentsAutoPayLagDays ?? 3,
    expenditureThresholdCents: row.expenditureThresholdCents ?? 0,
    gatedPolicies: (row.gatedPolicies as string[] | null) ?? [],
    emergencyBypassEnabled: !!row.emergencyBypassEnabled,
    meetingNoticeOpenDays: row.meetingNoticeOpenDays ?? 3,
    meetingNoticeExecutiveDays: row.meetingNoticeExecutiveDays ?? 2,
    meetingNoticeAnnualDays: row.meetingNoticeAnnualDays ?? 30,
    meetingQuorumMode: row.meetingQuorumMode ?? "majority",
    meetingQuorumPercentBp: row.meetingQuorumPercentBp ?? 5000,
    // OCR auto-tag suggestions for the bulk historical-document importer.
    // Read-back is available to anyone allowed to read settings; modification
    // is gated by `requireAdmin` on PATCH /settings/ocr.
    ocrEnabled: row.ocrEnabled ?? true,
    ocrDailyPageCap: row.ocrDailyPageCap ?? 1000,
    pastDueVotingThresholdDays: row.pastDueVotingThresholdDays ?? 60,
    currentTourVersion: row.currentTourVersion ?? 1,
  };
}

router.get("/settings/governance", async (_req, res) => {
  try {
    const row = await getOrCreateOrgSettings();
    res.json({
      noticeOpenDays: row.meetingNoticeOpenDays ?? 3,
      noticeExecutiveDays: row.meetingNoticeExecutiveDays ?? 2,
      noticeAnnualDays: row.meetingNoticeAnnualDays ?? 30,
      quorumMode: row.meetingQuorumMode ?? "majority",
      quorumPercentBp: row.meetingQuorumPercentBp ?? 5000,
    });
  } catch (err) {
    console.error("GET /settings/governance error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/settings/governance", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== "object") { res.status(400).json({ error: "Invalid body" }); return; }
  const patch: Record<string, unknown> = {};
  if (typeof body.noticeOpenDays === "number" && body.noticeOpenDays >= 0) patch.meetingNoticeOpenDays = Math.floor(body.noticeOpenDays);
  if (typeof body.noticeExecutiveDays === "number" && body.noticeExecutiveDays >= 0) patch.meetingNoticeExecutiveDays = Math.floor(body.noticeExecutiveDays);
  if (typeof body.noticeAnnualDays === "number" && body.noticeAnnualDays >= 0) patch.meetingNoticeAnnualDays = Math.floor(body.noticeAnnualDays);
  if (typeof body.quorumMode === "string" && ["majority", "percent", "all"].includes(body.quorumMode)) patch.meetingQuorumMode = body.quorumMode;
  if (typeof body.quorumPercentBp === "number") patch.meetingQuorumPercentBp = Math.max(0, Math.min(10000, Math.floor(body.quorumPercentBp)));
  try {
    await getOrCreateOrgSettings();
    if (Object.keys(patch).length === 0) {
      const row = await getOrCreateOrgSettings();
      res.json({
        noticeOpenDays: row.meetingNoticeOpenDays ?? 3,
        noticeExecutiveDays: row.meetingNoticeExecutiveDays ?? 2,
        noticeAnnualDays: row.meetingNoticeAnnualDays ?? 30,
        quorumMode: row.meetingQuorumMode ?? "majority",
        quorumPercentBp: row.meetingQuorumPercentBp ?? 5000,
      });
      return;
    }
    const [updated] = await db.update(organizationSettingsTable).set(patch).where(eq(organizationSettingsTable.id, 1)).returning();
    res.json({
      noticeOpenDays: updated!.meetingNoticeOpenDays ?? 3,
      noticeExecutiveDays: updated!.meetingNoticeExecutiveDays ?? 2,
      noticeAnnualDays: updated!.meetingNoticeAnnualDays ?? 30,
      quorumMode: updated!.meetingQuorumMode ?? "majority",
      quorumPercentBp: updated!.meetingQuorumPercentBp ?? 5000,
    });
  } catch (err) {
    console.error("PATCH /settings/governance error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/settings/bids", async (_req, res) => {
  try {
    const row = await getOrCreateOrgSettings();
    res.json({
      minQuotesThresholdCents: row.bidMinQuotesThresholdCents ?? 0,
      defaultSealed: row.bidDefaultSealed ?? false,
      reminderDaysBefore: row.bidReminderDaysBefore ?? 3,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/settings/bids", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== "object") { res.status(400).json({ error: "Invalid body" }); return; }
  const patch: Record<string, unknown> = {};
  if (typeof body.minQuotesThresholdCents === "number" && body.minQuotesThresholdCents >= 0) {
    patch.bidMinQuotesThresholdCents = Math.floor(body.minQuotesThresholdCents);
  }
  if (typeof body.defaultSealed === "boolean") patch.bidDefaultSealed = body.defaultSealed;
  if (typeof body.reminderDaysBefore === "number" && body.reminderDaysBefore >= 0) {
    patch.bidReminderDaysBefore = Math.floor(body.reminderDaysBefore);
  }
  try {
    await getOrCreateOrgSettings();
    if (!(await enforcePolicyGate(req, res, patch))) return;
    if (Object.keys(patch).length === 0) {
      const row = await getOrCreateOrgSettings();
      res.json({
        minQuotesThresholdCents: row.bidMinQuotesThresholdCents ?? 0,
        defaultSealed: row.bidDefaultSealed ?? false,
        reminderDaysBefore: row.bidReminderDaysBefore ?? 3,
      });
      return;
    }
    const [updated] = await db.update(organizationSettingsTable).set(patch).where(eq(organizationSettingsTable.id, 1)).returning();
    res.json({
      minQuotesThresholdCents: updated!.bidMinQuotesThresholdCents ?? 0,
      defaultSealed: updated!.bidDefaultSealed ?? false,
      reminderDaysBefore: updated!.bidReminderDaysBefore ?? 3,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/settings/acc", async (_req, res) => {
  try {
    const row = await getOrCreateOrgSettings();
    res.json({
      enabled: row.accEnabled !== false,
      quorumMode: row.accQuorumMode ?? "any",
      autoApprovalDays: row.accAutoApprovalDays ?? 0,
    });
  } catch (err) {
    console.error("GET /settings/acc error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/settings/acc", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== "object") { res.status(400).json({ error: "Invalid body" }); return; }
  const patch: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") patch.accEnabled = body.enabled;
  if (typeof body.quorumMode === "string" && ["any", "majority"].includes(body.quorumMode)) patch.accQuorumMode = body.quorumMode;
  if (typeof body.autoApprovalDays === "number" && body.autoApprovalDays >= 0) patch.accAutoApprovalDays = Math.floor(body.autoApprovalDays);
  try {
    const existing = await getOrCreateOrgSettings();
    if (!(await enforcePolicyGate(req, res, patch))) return;
    if (Object.keys(patch).length === 0) {
      res.json({
        enabled: existing.accEnabled !== false,
        quorumMode: existing.accQuorumMode ?? "any",
        autoApprovalDays: existing.accAutoApprovalDays ?? 0,
      });
      return;
    }
    const [updated] = await db.update(organizationSettingsTable).set(patch).where(eq(organizationSettingsTable.id, 1)).returning();
    res.json({
      enabled: updated!.accEnabled !== false,
      quorumMode: updated!.accQuorumMode ?? "any",
      autoApprovalDays: updated!.accAutoApprovalDays ?? 0,
    });
  } catch (err) {
    console.error("PATCH /settings/acc error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

function toUserNotifPrefs(row: typeof userNotificationPreferencesTable.$inferSelect) {
  return {
    userId: row.userId,
    urgent: row.urgent !== 0,
    expiring: row.expiring !== 0,
    weekly: row.weekly !== 0,
  };
}

function toCategory(row: typeof documentCategoriesTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
  };
}

function toMarker(row: typeof mapMarkersTable.$inferSelect) {
  return {
    id: row.id,
    buildingNum: row.buildingNum,
    view: row.view,
    left: row.left,
    top: row.top,
  };
}

export default router;
