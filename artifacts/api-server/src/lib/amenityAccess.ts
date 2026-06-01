// Task #82: Amenity access control — provider abstraction, code/QR issuance,
// validation, and audit. Two adapters are shipped:
//   - "virtual_lock": fully in-process; codes are HMAC-signed and stored in
//     our DB. The "lock" is the API itself — patrol or a kiosk validates
//     codes via /amenity-access/validate.
//   - "stub_http": demonstrates an outbound integration shape. Endpoints are
//     not actually called over the network unless an env-var named in the
//     provider config resolves to a real URL; otherwise the adapter returns
//     a deterministic stub response so manager test buttons work safely.
//
// Secrets are never stored in the DB. The provider config holds the *name*
// of the env var that holds the secret; lookups resolve it at runtime.

import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  amenityAccessProvidersTable,
  amenityAccessCodesTable,
  amenityAccessAuditTable,
  amenitiesTable,
  amenityBookingsTable,
  type Amenity,
  type AmenityAccessCode,
  type AmenityAccessProvider,
  type AmenityBooking,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { logger } from "./logger.js";

export type ProviderKind = "none" | "virtual_lock" | "stub_http";

function nowISO(): string {
  return new Date().toISOString();
}

function signingSecret(): string {
  return process.env.AMENITY_ACCESS_SIGNING_SECRET
    ?? process.env.JWT_SECRET
    ?? "dev-amenity-access-secret-change-me";
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hmac(input: string): string {
  return b64url(crypto.createHmac("sha256", signingSecret()).update(input).digest());
}

// Compact human-readable code: 12 hex chars chunked as XXXX-XXXX-XXXX.
function newHumanCode(): string {
  const hex = crypto.randomBytes(6).toString("hex").toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

// Build a signed compact token: base64url(json).hmac
export function buildSignedPayload(payload: Record<string, unknown>): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${hmac(body)}`;
}

export function verifySignedPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (hmac(body) !== sig) return null;
  try {
    const json = Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function getAmenityProvider(amenityId: number): Promise<AmenityAccessProvider | null> {
  const [row] = await db
    .select()
    .from(amenityAccessProvidersTable)
    .where(eq(amenityAccessProvidersTable.amenityId, amenityId));
  return row ?? null;
}

export async function upsertAmenityProvider(amenityId: number, patch: {
  kind?: ProviderKind;
  baseUrlEnvVar?: string | null;
  apiKeyEnvVar?: string | null;
  config?: Record<string, unknown>;
  enabled?: boolean;
}): Promise<AmenityAccessProvider> {
  const existing = await getAmenityProvider(amenityId);
  const now = nowISO();
  if (existing) {
    const [updated] = await db.update(amenityAccessProvidersTable).set({
      kind: patch.kind ?? existing.kind,
      baseUrlEnvVar: patch.baseUrlEnvVar === undefined ? existing.baseUrlEnvVar : patch.baseUrlEnvVar,
      apiKeyEnvVar: patch.apiKeyEnvVar === undefined ? existing.apiKeyEnvVar : patch.apiKeyEnvVar,
      config: patch.config ?? existing.config,
      enabled: patch.enabled ?? existing.enabled,
      updatedAt: now,
    }).where(eq(amenityAccessProvidersTable.id, existing.id)).returning();
    return updated;
  }
  const [created] = await db.insert(amenityAccessProvidersTable).values({
    amenityId,
    kind: patch.kind ?? "virtual_lock",
    baseUrlEnvVar: patch.baseUrlEnvVar ?? null,
    apiKeyEnvVar: patch.apiKeyEnvVar ?? null,
    config: patch.config ?? {},
    enabled: patch.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  }).returning();
  return created;
}

// ── Audit ────────────────────────────────────────────────────────────────

export async function recordAudit(args: {
  bookingId?: number | null;
  amenityId?: number | null;
  accessCodeId?: number | null;
  providerKind?: string;
  action: string;
  success?: boolean;
  actorUserId?: number | null;
  actorName?: string | null;
  message?: string;
  payload?: unknown;
}): Promise<void> {
  await db.insert(amenityAccessAuditTable).values({
    bookingId: args.bookingId ?? null,
    amenityId: args.amenityId ?? null,
    accessCodeId: args.accessCodeId ?? null,
    providerKind: args.providerKind ?? "none",
    action: args.action,
    success: args.success ?? true,
    actorUserId: args.actorUserId ?? null,
    actorName: args.actorName ?? "system",
    message: args.message ?? "",
    payload: (args.payload as object) ?? null,
    createdAt: nowISO(),
  });
}

// ── Provider adapters ────────────────────────────────────────────────────

interface ProviderIssueArgs {
  amenity: Amenity;
  booking: AmenityBooking;
  code: string;
  validFrom: string;
  validTo: string;
}

interface ProviderResult {
  ok: boolean;
  providerRef?: string | null;
  message?: string;
}

interface ProviderAdapter {
  kind: ProviderKind;
  issue(args: ProviderIssueArgs, provider: AmenityAccessProvider): Promise<ProviderResult>;
  revoke(code: AmenityAccessCode, provider: AmenityAccessProvider): Promise<ProviderResult>;
  test(provider: AmenityAccessProvider): Promise<ProviderResult>;
}

const virtualLockAdapter: ProviderAdapter = {
  kind: "virtual_lock",
  async issue() {
    // Code is fully self-contained (HMAC-signed) — nothing to push externally.
    return { ok: true, providerRef: "virtual" };
  },
  async revoke() {
    // The DB row gets status=revoked; nothing else to do.
    return { ok: true, providerRef: "virtual" };
  },
  async test() {
    return { ok: true, providerRef: "virtual", message: "Virtual lock ready" };
  },
};

const stubHttpAdapter: ProviderAdapter = {
  kind: "stub_http",
  async issue(args, provider) {
    const baseUrl = provider.baseUrlEnvVar ? process.env[provider.baseUrlEnvVar] : "";
    const apiKey = provider.apiKeyEnvVar ? process.env[provider.apiKeyEnvVar] : "";
    if (!baseUrl) {
      return { ok: true, providerRef: `stub-${args.booking.id}`, message: "stub-http: no base URL configured (dry-run)" };
    }
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/access`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({
          bookingId: args.booking.id,
          amenitySlug: args.amenity.slug,
          code: args.code,
          validFrom: args.validFrom,
          validTo: args.validTo,
        }),
      });
      if (!res.ok) return { ok: false, message: `Provider HTTP ${res.status}` };
      const data = (await res.json().catch(() => ({}))) as { ref?: string };
      return { ok: true, providerRef: data.ref ?? null };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
  async revoke(code, provider) {
    const baseUrl = provider.baseUrlEnvVar ? process.env[provider.baseUrlEnvVar] : "";
    const apiKey = provider.apiKeyEnvVar ? process.env[provider.apiKeyEnvVar] : "";
    if (!baseUrl) return { ok: true, message: "stub-http: no base URL configured (dry-run)" };
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/access/${encodeURIComponent(code.code)}`, {
        method: "DELETE",
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
      });
      if (!res.ok) return { ok: false, message: `Provider HTTP ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
  async test(provider) {
    const baseUrl = provider.baseUrlEnvVar ? process.env[provider.baseUrlEnvVar] : "";
    if (!baseUrl) {
      return { ok: true, message: "stub-http adapter is wired up but no base URL env var is set; behaving as dry-run." };
    }
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, { method: "GET" });
      return { ok: res.ok, message: `Provider responded HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
};

const noneAdapter: ProviderAdapter = {
  kind: "none",
  async issue() { return { ok: true, providerRef: null }; },
  async revoke() { return { ok: true }; },
  async test() { return { ok: true, message: "No provider configured." }; },
};

function adapterFor(kind: string): ProviderAdapter {
  if (kind === "virtual_lock") return virtualLockAdapter;
  if (kind === "stub_http") return stubHttpAdapter;
  return noneAdapter;
}

// ── Public API ───────────────────────────────────────────────────────────

export async function issueAccessForBooking(
  booking: AmenityBooking,
  amenity: Amenity,
  actor: { id?: number | null; name?: string | null } = {},
): Promise<AmenityAccessCode | null> {
  const provider = await getAmenityProvider(amenity.id);
  const kind: ProviderKind = (provider?.enabled ? (provider.kind as ProviderKind) : "virtual_lock");
  // Even when no provider row exists, default to virtual_lock so owners
  // always get a code/QR they can present to patrol.

  // If we already issued an active code for this booking, return it.
  const [existing] = await db
    .select()
    .from(amenityAccessCodesTable)
    .where(eq(amenityAccessCodesTable.bookingId, booking.id));
  if (existing && existing.status === "active") {
    return existing;
  }
  // Edited bookings: revoke old code first.
  if (existing && existing.status !== "revoked") {
    await revokeAccessForBooking(booking.id, "reissue", actor);
  }

  const code = newHumanCode();
  const qrPayload = buildSignedPayload({
    v: 1,
    code,
    bookingId: booking.id,
    amenityId: amenity.id,
    amenitySlug: amenity.slug,
    validFrom: booking.startsAt,
    validTo: booking.endsAt,
  });

  const adapter = adapterFor(kind);
  const result = await adapter.issue(
    { amenity, booking, code, validFrom: booking.startsAt, validTo: booking.endsAt },
    provider ?? { id: 0, amenityId: amenity.id, kind, baseUrlEnvVar: null, apiKeyEnvVar: null, config: {}, enabled: true, createdAt: nowISO(), updatedAt: nowISO() },
  );
  if (!result.ok) {
    logger.warn({ bookingId: booking.id, amenitySlug: amenity.slug, message: result.message }, "Access provider issue failed; storing code locally anyway");
  }

  const [row] = await db.insert(amenityAccessCodesTable).values({
    bookingId: booking.id,
    amenityId: amenity.id,
    code,
    qrPayload,
    validFrom: booking.startsAt,
    validTo: booking.endsAt,
    status: "active",
    providerKind: kind,
    providerRef: result.providerRef ?? null,
    issuedAt: nowISO(),
    revokedAt: null,
  }).returning();

  await recordAudit({
    bookingId: booking.id,
    amenityId: amenity.id,
    accessCodeId: row.id,
    providerKind: kind,
    action: "issue",
    success: result.ok,
    actorUserId: actor.id ?? null,
    actorName: actor.name ?? null,
    message: result.message ?? "",
  });
  return row;
}

export async function revokeAccessForBooking(
  bookingId: number,
  reason: string,
  actor: { id?: number | null; name?: string | null } = {},
): Promise<void> {
  const [code] = await db
    .select()
    .from(amenityAccessCodesTable)
    .where(eq(amenityAccessCodesTable.bookingId, bookingId));
  if (!code || code.status === "revoked") return;
  const provider = await getAmenityProvider(code.amenityId);
  const adapter = adapterFor(code.providerKind);
  const result = await adapter.revoke(
    code,
    provider ?? { id: 0, amenityId: code.amenityId, kind: code.providerKind, baseUrlEnvVar: null, apiKeyEnvVar: null, config: {}, enabled: true, createdAt: nowISO(), updatedAt: nowISO() },
  );
  await db.update(amenityAccessCodesTable)
    .set({ status: "revoked", revokedAt: nowISO() })
    .where(eq(amenityAccessCodesTable.id, code.id));
  await recordAudit({
    bookingId,
    amenityId: code.amenityId,
    accessCodeId: code.id,
    providerKind: code.providerKind,
    action: "revoke",
    success: result.ok,
    actorUserId: actor.id ?? null,
    actorName: actor.name ?? null,
    message: reason || result.message || "",
  });
}

export async function reissueAccessForBooking(
  booking: AmenityBooking,
  amenity: Amenity,
  actor: { id?: number | null; name?: string | null } = {},
): Promise<AmenityAccessCode | null> {
  await revokeAccessForBooking(booking.id, "reissue", actor);
  return issueAccessForBooking(booking, amenity, actor);
}

export async function testProvider(amenityId: number): Promise<ProviderResult & { kind: ProviderKind }> {
  const provider = await getAmenityProvider(amenityId);
  const kind: ProviderKind = (provider?.kind as ProviderKind) ?? "none";
  const adapter = adapterFor(kind);
  const out = await adapter.test(
    provider ?? { id: 0, amenityId, kind, baseUrlEnvVar: null, apiKeyEnvVar: null, config: {}, enabled: true, createdAt: nowISO(), updatedAt: nowISO() },
  );
  await recordAudit({
    amenityId,
    providerKind: kind,
    action: "test",
    success: out.ok,
    message: out.message ?? "",
  });
  return { ...out, kind };
}

export interface ValidationOutcome {
  ok: boolean;
  reason?: string;
  booking?: AmenityBooking;
  amenity?: Amenity;
  code?: AmenityAccessCode;
}

// Validate a presented code or QR token.
export async function validatePresentedCode(input: { code?: string; token?: string }, at: Date = new Date()): Promise<ValidationOutcome> {
  let codeStr = input.code?.trim().toUpperCase() || "";
  if (!codeStr && input.token) {
    const decoded = verifySignedPayload(input.token);
    if (!decoded) return { ok: false, reason: "Invalid signature" };
    codeStr = String(decoded.code ?? "").toUpperCase();
  }
  if (!codeStr) return { ok: false, reason: "No code provided" };

  const [row] = await db
    .select()
    .from(amenityAccessCodesTable)
    .where(eq(amenityAccessCodesTable.code, codeStr));
  if (!row) return { ok: false, reason: "Unknown code" };
  if (row.status !== "active") return { ok: false, reason: `Code ${row.status}` };

  const start = new Date(row.validFrom).getTime();
  const end = new Date(row.validTo).getTime();
  const t = at.getTime();
  // Allow a 30-minute grace before start and 60 minutes after end.
  if (t < start - 30 * 60_000) return { ok: false, reason: "Code is not yet valid" };
  if (t > end + 60 * 60_000) return { ok: false, reason: "Code has expired" };

  const [booking] = await db.select().from(amenityBookingsTable).where(eq(amenityBookingsTable.id, row.bookingId));
  const [amenity] = await db.select().from(amenitiesTable).where(eq(amenitiesTable.id, row.amenityId));
  if (!booking || !amenity) return { ok: false, reason: "Booking unavailable" };
  if (booking.status === "cancelled" || booking.status === "refunded" || booking.status === "forfeited") {
    return { ok: false, reason: `Booking ${booking.status}` };
  }
  return { ok: true, code: row, booking, amenity };
}

export async function renderQrSvg(payload: string): Promise<string> {
  return QRCode.toString(payload, { type: "svg", margin: 1, errorCorrectionLevel: "M", width: 240 });
}

export function publicCode(code: AmenityAccessCode) {
  return {
    id: code.id,
    bookingId: code.bookingId,
    amenityId: code.amenityId,
    code: code.code,
    qrPayload: code.qrPayload,
    validFrom: code.validFrom,
    validTo: code.validTo,
    status: code.status,
    providerKind: code.providerKind,
    providerRef: code.providerRef,
    issuedAt: code.issuedAt,
    revokedAt: code.revokedAt,
  };
}

export function publicProvider(p: AmenityAccessProvider) {
  return {
    id: p.id,
    amenityId: p.amenityId,
    kind: p.kind as ProviderKind,
    baseUrlEnvVar: p.baseUrlEnvVar,
    apiKeyEnvVar: p.apiKeyEnvVar,
    baseUrlEnvSet: p.baseUrlEnvVar ? Boolean(process.env[p.baseUrlEnvVar]) : false,
    apiKeyEnvSet: p.apiKeyEnvVar ? Boolean(process.env[p.apiKeyEnvVar]) : false,
    config: p.config,
    enabled: p.enabled,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
