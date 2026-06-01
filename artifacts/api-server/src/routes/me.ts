import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  usersTable,
  unitsTable,
  userNotificationPreferencesTable,
  emailChangeTokensTable,
  profileAuditTable,
  organizationSettingsTable,
  phoneVerificationsTable,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { authenticateJwt, signToken, type AuthUser } from "../middleware/auth.js";
import { sendSms, toE164, isSmsConfigured } from "../lib/sms.js";
import { checkPassword } from "../lib/password.js";

const router: IRouter = Router();

const NAME_MAX = 120;
const ADDRESS_MAX = 240;
const PHONE_MAX = 32;
const EMAIL_MAX = 254;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function trimStr(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

function normalizePhone(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  // Keep digits, +, spaces, dashes, parens
  const cleaned = trimmed.replace(/[^\d+\s().-]/g, "");
  return cleaned.slice(0, PHONE_MAX) || null;
}

function validateEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  if (!t || t.length > EMAIL_MAX) return null;
  if (!EMAIL_RE.test(t)) return null;
  return t;
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/",
};

type OccupancyRole = "owner" | "tenant" | "none";

/**
 * Determine the resident's role at their unit by comparing the user's
 * login email against the unit's recorded owner/tenant emails. This
 * intentionally does not use unit.occupancy (which describes whether
 * the unit is owner-occupied vs. tenant-occupied — a property of the
 * unit, not of any one user). An owner-of-record may live elsewhere
 * while a tenant occupies their unit, and we still need to grant the
 * owner edit rights to owner-only fields like the mailing address.
 */
function resolveOccupancyRole(
  userEmail: string,
  unit: typeof unitsTable.$inferSelect | undefined,
): OccupancyRole {
  if (!unit) return "none";
  const me = userEmail.trim().toLowerCase();
  const ownerEmail = (unit.ownerEmail ?? "").trim().toLowerCase();
  const tenantEmail = (unit.tenantEmail ?? "").trim().toLowerCase();
  if (me && me === ownerEmail) return "owner";
  if (me && me === tenantEmail) return "tenant";
  return "none";
}

async function getOrgName(): Promise<string> {
  try {
    const [row] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
    return row?.name?.trim() || "HOA";
  } catch {
    return "HOA";
  }
}

async function getOrCreatePrefs(userId: string) {
  const [row] = await db
    .select()
    .from(userNotificationPreferencesTable)
    .where(eq(userNotificationPreferencesTable.userId, userId));
  if (row) return row;
  const [created] = await db
    .insert(userNotificationPreferencesTable)
    .values({ userId })
    .returning();
  return created!;
}

async function audit(
  userId: number,
  unitId: string | null,
  action: string,
  field: string,
  oldValue: string | null,
  newValue: string | null,
) {
  try {
    await db.insert(profileAuditTable).values({
      userId,
      unitId,
      action,
      field,
      oldValue,
      newValue,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("profile audit log failed", err);
  }
}

router.get("/me/profile", authenticateJwt, async (req, res) => {
  try {
    const me = req.user!;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, me.id));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    let unit: typeof unitsTable.$inferSelect | undefined;
    if (user.unitId) {
      [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, user.unitId));
    }
    const prefs = await getOrCreatePrefs(String(user.id));
    const hoaName = await getOrgName();

    const occupancyRole = resolveOccupancyRole(user.email, unit);

    res.json({
      hoaName,
      smsEnabled: isSmsConfigured(),
      user: {
        id: user.id,
        email: user.email,
        pendingEmail: user.pendingEmail ?? null,
        role: user.role,
        name: user.name,
        phone: user.phone ?? null,
        phoneNumber: user.phoneNumber ?? null,
        phoneVerified: user.phoneVerified === true,
        createdAt: user.createdAt,
      },
      unit: unit
        ? {
            id: unit.id,
            address: unit.address,
            unit: unit.unit,
            occupancy: unit.occupancy,
            occupancyRole,
            ownerName: unit.ownerName,
            ownerPhone: unit.ownerPhone ?? null,
            ownerMailingAddress: unit.ownerMailingAddress ?? null,
            ownerEmergencyName: unit.ownerEmergencyName ?? null,
            ownerEmergencyPhone: unit.ownerEmergencyPhone ?? null,
            tenantName: unit.tenantName ?? null,
            tenantPhone: unit.tenantPhone ?? null,
            tenantEmergencyName: unit.tenantEmergencyName ?? null,
            tenantEmergencyPhone: unit.tenantEmergencyPhone ?? null,
          }
        : null,
      preferences: {
        workOrdersInApp: prefs.workOrdersInApp !== 0,
        workOrdersEmail: prefs.workOrdersEmail !== 0,
        announcementsInApp: prefs.announcementsInApp !== 0,
        announcementsEmail: prefs.announcementsEmail !== 0,
        billingInApp: prefs.billingInApp !== 0,
        billingEmail: prefs.billingEmail !== 0,
        accInApp: prefs.accInApp !== 0,
        accEmail: prefs.accEmail !== 0,
        governanceEmail: prefs.governanceEmail !== 0,
      },
    });
  } catch (err) {
    console.error("GET /me/profile error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/me/profile", authenticateJwt, async (req, res) => {
  try {
    const me = req.user!;
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== "object") {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, me.id));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Update display name + phone on user record.
    const userPatch: Partial<typeof usersTable.$inferInsert> = {};
    if ("name" in body) {
      const v = trimStr(body.name, NAME_MAX);
      if (v === null) {
        res.status(400).json({ error: "Name cannot be empty" });
        return;
      }
      userPatch.name = v;
    }
    if ("phone" in body) {
      userPatch.phone = normalizePhone(body.phone);
    }

    let nameChanged = false;
    if (Object.keys(userPatch).length > 0) {
      await db.update(usersTable).set(userPatch).where(eq(usersTable.id, me.id));
      for (const [k, v] of Object.entries(userPatch)) {
        const oldVal = (user as Record<string, unknown>)[k];
        if (k === "name" && String(oldVal ?? "") !== String(v ?? "")) {
          nameChanged = true;
        }
        await audit(
          me.id,
          user.unitId ?? null,
          "update",
          `user.${k}`,
          oldVal == null ? null : String(oldVal),
          v == null ? null : String(v),
        );
      }
    }

    // Owner-only and tenant-only fields are gated on the user's actual
    // relationship to the unit (matched by login email), not on the
    // unit's occupancy status.
    const OWNER_ONLY = [
      "ownerName",
      "ownerPhone",
      "ownerMailingAddress",
      "ownerEmergencyName",
      "ownerEmergencyPhone",
    ] as const;
    const TENANT_ONLY = [
      "tenantName",
      "tenantPhone",
      "tenantEmergencyName",
      "tenantEmergencyPhone",
    ] as const;

    if (user.unitId) {
      const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, user.unitId));
      if (unit) {
        const role = resolveOccupancyRole(user.email, unit);
        const submittedOwner = OWNER_ONLY.filter((f) => f in body);
        const submittedTenant = TENANT_ONLY.filter((f) => f in body);

        if (role !== "owner" && submittedOwner.length > 0) {
          res.status(403).json({
            error: `Only the owner of record can edit: ${submittedOwner.join(", ")}`,
          });
          return;
        }
        if (role !== "tenant" && submittedTenant.length > 0) {
          res.status(403).json({
            error: `Only the tenant of record can edit: ${submittedTenant.join(", ")}`,
          });
          return;
        }

        const unitPatch: Partial<typeof unitsTable.$inferInsert> = {};
        if (role === "owner") {
          if ("ownerName" in body) {
            const v = trimStr(body.ownerName, NAME_MAX);
            if (v === null) {
              res.status(400).json({ error: "Owner name cannot be empty" });
              return;
            }
            unitPatch.ownerName = v;
          }
          if ("ownerPhone" in body) {
            unitPatch.ownerPhone = normalizePhone(body.ownerPhone);
          }
          if ("ownerMailingAddress" in body) {
            unitPatch.ownerMailingAddress = trimStr(body.ownerMailingAddress, ADDRESS_MAX);
          }
          if ("ownerEmergencyName" in body) {
            unitPatch.ownerEmergencyName = trimStr(body.ownerEmergencyName, NAME_MAX);
          }
          if ("ownerEmergencyPhone" in body) {
            unitPatch.ownerEmergencyPhone = normalizePhone(body.ownerEmergencyPhone);
          }
        } else if (role === "tenant") {
          if ("tenantName" in body) {
            unitPatch.tenantName = trimStr(body.tenantName, NAME_MAX);
          }
          if ("tenantPhone" in body) {
            unitPatch.tenantPhone = normalizePhone(body.tenantPhone);
          }
          if ("tenantEmergencyName" in body) {
            unitPatch.tenantEmergencyName = trimStr(body.tenantEmergencyName, NAME_MAX);
          }
          if ("tenantEmergencyPhone" in body) {
            unitPatch.tenantEmergencyPhone = normalizePhone(body.tenantEmergencyPhone);
          }
        }

        if (Object.keys(unitPatch).length > 0) {
          await db.update(unitsTable).set(unitPatch).where(eq(unitsTable.id, unit.id));
          for (const [k, v] of Object.entries(unitPatch)) {
            const oldVal = (unit as Record<string, unknown>)[k];
            await audit(
              me.id,
              unit.id,
              "update",
              `unit.${k}`,
              oldVal == null ? null : String(oldVal),
              v == null ? null : String(v),
            );
          }
        }
      }
    }

    // Communication preferences.
    if (body.preferences && typeof body.preferences === "object") {
      const prefBody = body.preferences as Record<string, unknown>;
      const userIdStr = String(me.id);
      await getOrCreatePrefs(userIdStr);
      const prefPatch: Record<string, number> = {};
      const FIELDS = [
        "workOrdersInApp",
        "workOrdersEmail",
        "announcementsInApp",
        "announcementsEmail",
        "billingInApp",
        "billingEmail",
        "accInApp",
        "accEmail",
        "governanceEmail",
      ] as const;
      for (const f of FIELDS) {
        if (typeof prefBody[f] === "boolean") {
          prefPatch[f] = prefBody[f] ? 1 : 0;
        }
      }
      if (Object.keys(prefPatch).length > 0) {
        await db
          .update(userNotificationPreferencesTable)
          .set(prefPatch)
          .where(eq(userNotificationPreferencesTable.userId, userIdStr));
        await audit(
          me.id,
          user.unitId ?? null,
          "update",
          "preferences",
          null,
          JSON.stringify(prefPatch),
        );
      }
    }

    // If the display name changed, reissue the auth cookie so the
    // header/auth context immediately reflects the new name.
    if (nameChanged) {
      const [refreshed] = await db.select().from(usersTable).where(eq(usersTable.id, me.id));
      if (refreshed) {
        const next: AuthUser = {
          id: refreshed.id,
          email: refreshed.email,
          role: refreshed.role as AuthUser["role"],
          name: refreshed.name,
          unitId: refreshed.unitId ?? null,
          boardMember: refreshed.boardMember === true,
        };
        const token = signToken(next);
        res.cookie("auth_token", token, COOKIE_OPTIONS);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("PATCH /me/profile error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/me/email-change", authenticateJwt, async (req, res) => {
  try {
    const me = req.user!;
    const body = req.body as { newEmail?: unknown; password?: unknown };
    const newEmail = validateEmail(body?.newEmail);
    if (!newEmail) {
      res.status(400).json({ error: "A valid new email is required" });
      return;
    }
    if (typeof body?.password !== "string" || !body.password) {
      res.status(400).json({ error: "Current password is required" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, me.id));
    if (!user || !user.passwordHash) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: "Incorrect password" });
      return;
    }

    if (newEmail === user.email.toLowerCase()) {
      res.status(400).json({ error: "New email matches your current email" });
      return;
    }

    // Ensure no other account uses that email.
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, newEmail));
    if (existing && existing.id !== me.id) {
      res.status(409).json({ error: "That email is already in use" });
      return;
    }

    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await db.insert(emailChangeTokensTable).values({
      userId: me.id,
      newEmail,
      tokenHash,
      expiresAt,
      createdAt: new Date().toISOString(),
    });

    await db.update(usersTable).set({ pendingEmail: newEmail }).where(eq(usersTable.id, me.id));

    await audit(me.id, user.unitId ?? null, "request", "user.email", user.email, newEmail);

    // Verification email send is the responsibility of the email provider task (#27).
    // We surface the verification link/token in the response when running outside production
    // so the flow can be exercised end-to-end during development.
    const payload: { ok: true; pendingEmail: string; verificationToken?: string } = {
      ok: true,
      pendingEmail: newEmail,
    };
    if (process.env.NODE_ENV !== "production") {
      payload.verificationToken = rawToken;
    }
    res.json(payload);
  } catch (err) {
    console.error("POST /me/email-change error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/me/email-change/verify", async (req, res) => {
  try {
    const body = req.body as { token?: unknown };
    if (typeof body?.token !== "string" || !body.token) {
      res.status(400).json({ error: "Verification token is required" });
      return;
    }
    const tokenHash = crypto.createHash("sha256").update(body.token).digest("hex");
    const [row] = await db
      .select()
      .from(emailChangeTokensTable)
      .where(eq(emailChangeTokensTable.tokenHash, tokenHash));
    if (!row || row.consumedAt) {
      res.status(404).json({ error: "Invalid or already used token" });
      return;
    }
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      res.status(410).json({ error: "Token has expired" });
      return;
    }

    // Make sure email isn't taken since the request was made.
    const [conflict] = await db.select().from(usersTable).where(eq(usersTable.email, row.newEmail));
    if (conflict && conflict.id !== row.userId) {
      res.status(409).json({ error: "That email is already in use" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, row.userId));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const oldEmail = user.email;

    await db
      .update(usersTable)
      .set({ email: row.newEmail, pendingEmail: null })
      .where(eq(usersTable.id, row.userId));

    await db
      .update(emailChangeTokensTable)
      .set({ consumedAt: new Date().toISOString() })
      .where(eq(emailChangeTokensTable.id, row.id));

    await audit(row.userId, user.unitId ?? null, "verify", "user.email", oldEmail, row.newEmail);

    // Refresh the auth cookie with the new email so the active session stays valid.
    const refreshed: AuthUser = {
      id: user.id,
      email: row.newEmail,
      role: user.role as AuthUser["role"],
      name: user.name,
      unitId: user.unitId ?? null,
      boardMember: user.boardMember === true,
    };
    const token = signToken(refreshed);
    res.cookie("auth_token", token, COOKIE_OPTIONS);

    res.json({ ok: true, email: row.newEmail });
  } catch (err) {
    console.error("POST /me/email-change/verify error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/me/password", authenticateJwt, async (req, res) => {
  try {
    const me = req.user!;
    const body = req.body as { currentPassword?: unknown; newPassword?: unknown };
    if (typeof body?.currentPassword !== "string" || !body.currentPassword) {
      res.status(400).json({ error: "Current password is required" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, me.id));
    if (!user || !user.passwordHash) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const ok = await bcrypt.compare(body.currentPassword, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }
    // Task #48: enforce the shared password policy on changes too.
    const pwCheck = checkPassword(body.newPassword, user.email);
    if (!pwCheck.ok) {
      res.status(400).json({ error: pwCheck.error });
      return;
    }
    const newHash = await bcrypt.hash(body.newPassword as string, 10);
    await db.update(usersTable).set({ passwordHash: newHash }).where(eq(usersTable.id, me.id));

    await audit(me.id, user.unitId ?? null, "update", "user.password", null, null);

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /me/password error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Phone verification (Task #95) ---
//
// Verified phone numbers are required to receive SMS calendar reminders.
// Flow: POST /me/phone/start with a phone number sends a 6-digit code
// via SMS. POST /me/phone/verify with that code marks the number as
// verified on the user record. POST /me/phone/clear removes the verified
// number. Quiet hours don't apply to verification SMS — the user just
// requested the code.

const PHONE_CODE_TTL_MS = 10 * 60 * 1000;
const PHONE_MAX_ATTEMPTS = 6;
const PHONE_RESEND_COOLDOWN_MS = 30 * 1000;
// Per-user daily cap on verification SMS sends — prevents an authenticated
// user from cycling numbers to rack up paid Twilio sends.
const PHONE_DAILY_SEND_LIMIT = 10;

router.post("/me/phone/start", authenticateJwt, async (req, res) => {
  try {
    const me = req.user!;
    const body = req.body as { phoneNumber?: unknown };
    const e164 = toE164(typeof body?.phoneNumber === "string" ? body.phoneNumber : null);
    if (!e164) {
      res.status(400).json({ error: "A valid phone number is required (US 10-digit or E.164)" });
      return;
    }

    // In production we refuse to issue codes if Twilio isn't configured —
    // otherwise users would see a "code sent" message that never arrives.
    if (!isSmsConfigured() && process.env.NODE_ENV === "production") {
      res.status(503).json({ error: "SMS provider is not configured" });
      return;
    }

    // Rate-limit: same-number cooldown (rapid resend) + per-user daily cap
    // (prevents cycling numbers to drive up Twilio cost).
    const recent = await db.select().from(phoneVerificationsTable).where(eq(phoneVerificationsTable.userId, me.id));
    const fresh = recent
      .filter((r) => r.phoneNumber === e164 && !r.consumedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (fresh) {
      const ageMs = Date.now() - new Date(fresh.createdAt).getTime();
      if (ageMs < PHONE_RESEND_COOLDOWN_MS) {
        res.status(429).json({ error: "Please wait a moment before requesting another code" });
        return;
      }
    }
    const dayAgoMs = Date.now() - 24 * 60 * 60 * 1000;
    const sendsLastDay = recent.filter((r) => new Date(r.createdAt).getTime() >= dayAgoMs).length;
    if (sendsLastDay >= PHONE_DAILY_SEND_LIMIT) {
      res.status(429).json({ error: "Daily verification limit reached. Please try again tomorrow." });
      return;
    }

    // Cryptographically-strong 6-digit code (uniform 100000–999999).
    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PHONE_CODE_TTL_MS).toISOString();

    await db.insert(phoneVerificationsTable).values({
      userId: me.id,
      phoneNumber: e164,
      codeHash,
      attempts: 0,
      expiresAt,
      createdAt: now.toISOString(),
    });

    const orgName = await getOrgName();
    const result = await sendSms(e164, `${orgName}: your verification code is ${code}. It expires in 10 minutes.`);

    // If sending failed in production, fail the whole request — the user
    // shouldn't be told "code sent" when Twilio rejected it.
    if (!result.ok && process.env.NODE_ENV === "production" && isSmsConfigured()) {
      res.status(502).json({ error: `Could not send verification SMS: ${result.error ?? "unknown error"}` });
      return;
    }

    await audit(me.id, null, "request", "user.phoneNumber", null, e164);

    const payload: { ok: true; phoneNumber: string; smsConfigured: boolean; devCode?: string; smsError?: string } = {
      ok: true,
      phoneNumber: e164,
      smsConfigured: isSmsConfigured(),
    };
    // Only surface the code outside production; in production, never leak
    // it regardless of provider state (we refuse the request above when
    // SMS isn't configured in prod).
    if (process.env.NODE_ENV !== "production") {
      payload.devCode = code;
    }
    if (!result.ok) {
      payload.smsError = result.error;
    }
    res.json(payload);
  } catch (err) {
    console.error("POST /me/phone/start error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/me/phone/verify", authenticateJwt, async (req, res) => {
  try {
    const me = req.user!;
    const body = req.body as { code?: unknown };
    if (typeof body?.code !== "string" || !/^\d{4,8}$/.test(body.code)) {
      res.status(400).json({ error: "A valid verification code is required" });
      return;
    }

    const rows = await db.select().from(phoneVerificationsTable).where(eq(phoneVerificationsTable.userId, me.id));
    const open = rows
      .filter((r) => !r.consumedAt && new Date(r.expiresAt).getTime() > Date.now())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!open) {
      res.status(404).json({ error: "No pending verification — request a new code" });
      return;
    }
    if (open.attempts >= PHONE_MAX_ATTEMPTS) {
      res.status(429).json({ error: "Too many attempts — request a new code" });
      return;
    }

    const codeHash = crypto.createHash("sha256").update(body.code).digest("hex");
    if (codeHash !== open.codeHash) {
      await db
        .update(phoneVerificationsTable)
        .set({ attempts: open.attempts + 1 })
        .where(eq(phoneVerificationsTable.id, open.id));
      res.status(400).json({ error: "Incorrect code" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, me.id));
    const oldNumber = user?.phoneNumber ?? null;

    await db
      .update(usersTable)
      .set({ phoneNumber: open.phoneNumber, phoneVerified: true })
      .where(eq(usersTable.id, me.id));

    await db
      .update(phoneVerificationsTable)
      .set({ consumedAt: new Date().toISOString() })
      .where(eq(phoneVerificationsTable.id, open.id));

    await audit(me.id, user?.unitId ?? null, "verify", "user.phoneNumber", oldNumber, open.phoneNumber);

    res.json({ ok: true, phoneNumber: open.phoneNumber, phoneVerified: true });
  } catch (err) {
    console.error("POST /me/phone/verify error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/me/phone/clear", authenticateJwt, async (req, res) => {
  try {
    const me = req.user!;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, me.id));
    const oldNumber = user?.phoneNumber ?? null;

    await db
      .update(usersTable)
      .set({ phoneNumber: null, phoneVerified: false })
      .where(eq(usersTable.id, me.id));

    // Mark any open verifications as consumed so they don't linger.
    const open = await db
      .select()
      .from(phoneVerificationsTable)
      .where(and(eq(phoneVerificationsTable.userId, me.id), eq(phoneVerificationsTable.phoneNumber, oldNumber ?? "")));
    for (const row of open) {
      if (!row.consumedAt) {
        await db
          .update(phoneVerificationsTable)
          .set({ consumedAt: new Date().toISOString() })
          .where(eq(phoneVerificationsTable.id, row.id));
      }
    }

    await audit(me.id, user?.unitId ?? null, "clear", "user.phoneNumber", oldNumber, null);
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /me/phone/clear error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
