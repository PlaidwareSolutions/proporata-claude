// Task #84: Amenity Guest Parking & Vehicle Registry — domain helpers.
// Numbering, eligibility gates, cap evaluation, PDF/QR generation, and
// signed digital-pass tokens. The on-disk PDF is a simple HTML rendering
// (browser-printable). For a true binary PDF we re-use the same HTML.

import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  guestParkingPermitsTable,
  guestParkingSettingsTable,
  guestParkingLookupsTable,
  unitVehiclesTable,
  unitsTable,
  usersTable,
  violationsTable,
  ownerAccountsTable,
  ledgerEntriesTable,
  amenityAccessAuditTable,
  type GuestParkingPermit,
  type GuestParkingSettingsValue,
} from "@workspace/db/schema";
import { and, eq, ne, sql } from "drizzle-orm";
import QRCode from "qrcode";

export const DEFAULT_GUEST_PARKING_SETTINGS: GuestParkingSettingsValue = {
  perUnitNightlyCap: 14,
  rollingWindowDays: 30,
  maxConsecutiveNights: 7,
  maxAdvanceDays: 30,
  requireAccountCurrent: true,
  requireNoOpenViolations: true,
  excludeRegisteredVehicles: true,
  agreementText:
    "By requesting a guest-parking permit you certify that the vehicle described is a guest of the unit and is not owned by a resident or owner of this association. The permit must be displayed face-up on the dashboard for the entire duration of the stay. Vehicles parked in guest stalls without a valid, visible permit may be towed at the owner's expense. The HOA is not responsible for any damage to or theft from vehicles parked on the property.",
};

function nowISO(): string { return new Date().toISOString(); }
function toDateOnly(s: string): string { return s.slice(0, 10); }
function pad4(n: number): string { return n.toString().padStart(4, "0"); }

export function nightsBetween(startsOn: string, endsOn: string): number {
  const s = new Date(`${startsOn}T00:00:00Z`).getTime();
  const e = new Date(`${endsOn}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((e - s) / (24 * 60 * 60 * 1000)) + 1);
}

export async function loadSettings(): Promise<GuestParkingSettingsValue> {
  const [row] = await db.select().from(guestParkingSettingsTable);
  if (!row) return DEFAULT_GUEST_PARKING_SETTINGS;
  return { ...DEFAULT_GUEST_PARKING_SETTINGS, ...(row.config ?? {}) };
}

export async function saveSettings(value: GuestParkingSettingsValue, userId: number | null): Promise<GuestParkingSettingsValue> {
  const [row] = await db.select().from(guestParkingSettingsTable);
  if (row) {
    await db.update(guestParkingSettingsTable)
      .set({ config: value, updatedAt: nowISO(), updatedByUserId: userId })
      .where(eq(guestParkingSettingsTable.id, row.id));
  } else {
    await db.insert(guestParkingSettingsTable).values({
      config: value, updatedAt: nowISO(), updatedByUserId: userId,
    });
  }
  return value;
}

// ── Numbering ───────────────────────────────────────────────────────────

export async function allocatePermitNumber(year: number): Promise<{ number: string; seq: number; year: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"guest_parking_permits:" + year}))`);
    const rows = await tx
      .select({ max: sql<number | null>`COALESCE(MAX(${guestParkingPermitsTable.numberSeq}), 0)` })
      .from(guestParkingPermitsTable)
      .where(eq(guestParkingPermitsTable.numberYear, year));
    const seq = (rows[0]?.max ?? 0) + 1;
    return { year, seq, number: `GP-${year}-${pad4(seq)}` };
  });
}

// ── Cap accounting (per-unit nights in rolling window) ─────────────────

export async function nightsUsedForUnit(unitId: string, anchor: Date, windowDays: number): Promise<number> {
  // Count nights for this unit's permits whose stay window intersects the
  // rolling window ending at `anchor`. Cancelled permits do not count.
  const windowStart = new Date(anchor.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const startStr = windowStart.toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(guestParkingPermitsTable)
    .where(and(
      eq(guestParkingPermitsTable.unitId, unitId),
      ne(guestParkingPermitsTable.status, "cancelled"),
    ));
  let nights = 0;
  for (const p of rows) {
    if (p.endsOn < startStr) continue;
    const nightStart = p.startsOn < startStr ? startStr : p.startsOn;
    nights += nightsBetween(nightStart, p.endsOn);
  }
  return nights;
}

// ── Eligibility gates ──────────────────────────────────────────────────

export interface EligibilityIssue { code: string; message: string; }

export async function checkEligibility(opts: {
  unitId: string;
  ownerUserId: number;
  startsOn: string;
  endsOn: string;
  plate: string;
  excludePermitId?: number;
}): Promise<EligibilityIssue[]> {
  const issues: EligibilityIssue[] = [];
  const settings = await loadSettings();
  const today = new Date().toISOString().slice(0, 10);
  const reqNights = nightsBetween(opts.startsOn, opts.endsOn);

  if (opts.startsOn < today) issues.push({ code: "past_start", message: "Permit start date cannot be in the past." });
  if (opts.endsOn < opts.startsOn) issues.push({ code: "bad_dates", message: "End date must be on or after start." });

  if (reqNights > settings.maxConsecutiveNights) {
    issues.push({ code: "too_long", message: `Stay exceeds the per-permit limit of ${settings.maxConsecutiveNights} consecutive nights.` });
  }

  const startMs = new Date(`${opts.startsOn}T00:00:00Z`).getTime();
  const advanceDays = (startMs - new Date(`${today}T00:00:00Z`).getTime()) / (24 * 60 * 60 * 1000);
  if (advanceDays > settings.maxAdvanceDays) {
    issues.push({ code: "too_far_ahead", message: `Permits may be issued up to ${settings.maxAdvanceDays} days in advance.` });
  }

  const used = await nightsUsedForUnit(opts.unitId, new Date(`${opts.endsOn}T23:59:59Z`), settings.rollingWindowDays);
  // Subtract any nights from the permit being modified.
  let adjUsed = used;
  if (opts.excludePermitId) {
    const [existing] = await db.select().from(guestParkingPermitsTable).where(eq(guestParkingPermitsTable.id, opts.excludePermitId));
    if (existing && existing.status !== "cancelled") {
      adjUsed -= nightsBetween(existing.startsOn, existing.endsOn);
      if (adjUsed < 0) adjUsed = 0;
    }
  }
  if (adjUsed + reqNights > settings.perUnitNightlyCap) {
    issues.push({
      code: "cap_exceeded",
      message: `Unit cap reached: ${adjUsed} nights used in the last ${settings.rollingWindowDays} days; this stay would push to ${adjUsed + reqNights} (cap ${settings.perUnitNightlyCap}).`,
    });
  }

  // Vehicle registry exclusion
  if (settings.excludeRegisteredVehicles && opts.plate) {
    const plate = opts.plate.toUpperCase();
    const matches = await db
      .select()
      .from(unitVehiclesTable)
      .where(sql`upper(${unitVehiclesTable.plate}) = ${plate}`);
    if (matches.length > 0) {
      issues.push({
        code: "registered_vehicle",
        message: "This plate is registered to a unit. Resident-owned vehicles cannot use guest-parking permits.",
      });
    }
  }

  // Account current
  if (settings.requireAccountCurrent) {
    const [acct] = await db.select().from(ownerAccountsTable).where(eq(ownerAccountsTable.unitId, opts.unitId));
    if (acct) {
      const entries = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.ownerAccountId, acct.id));
      // amountCents convention: positive = charges, negative = payments. Balance > 0 means owed.
      const balance = entries
        .filter((e) => !e.voidedAt)
        .reduce((sum, e) => sum + e.amountCents, 0)
        + (acct.openingBalance ?? 0);
      if (balance > 0) {
        issues.push({ code: "account_not_current", message: `Account is not current (balance $${(balance / 100).toFixed(2)}). Pay outstanding charges to issue a permit.` });
      }
    }
  }

  // No open major violations (parking category, status not resolved/dismissed)
  if (settings.requireNoOpenViolations) {
    const open = await db.select().from(violationsTable).where(eq(violationsTable.unitId, opts.unitId));
    const hasOpen = open.some((v) => v.status !== "resolved" && v.status !== "dismissed" && (v.category === "parking" || v.fineCents > 0));
    if (hasOpen) {
      issues.push({ code: "open_violation", message: "There is an open major or parking-related violation on this unit." });
    }
  }

  return issues;
}

// ── Tokens / QR ────────────────────────────────────────────────────────

function signingSecret(): string {
  return process.env.AMENITY_ACCESS_SIGNING_SECRET
    ?? process.env.JWT_SECRET
    ?? "dev-amenity-access-secret-change-me";
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newQrToken(seed: { permitId: number; permitNumber: string; plate: string }): string {
  const body = b64url(Buffer.from(JSON.stringify({ v: 1, k: "guest_parking", ...seed }), "utf8"));
  const sig = b64url(crypto.createHmac("sha256", signingSecret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyQrToken(token: string): { permitId: number; permitNumber: string; plate: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = b64url(crypto.createHmac("sha256", signingSecret()).update(body).digest());
  if (expected !== sig) return null;
  try {
    const json = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (typeof json.permitId !== "number" || typeof json.permitNumber !== "string") return null;
    return { permitId: json.permitId, permitNumber: json.permitNumber, plate: String(json.plate ?? "") };
  } catch { return null; }
}

export async function renderQrSvg(payload: string, size = 220): Promise<string> {
  return QRCode.toString(payload, { type: "svg", margin: 1, errorCorrectionLevel: "M", width: size });
}

export async function renderQrPngDataUrl(payload: string, size = 220): Promise<string> {
  return QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 1, width: size });
}

// ── PDF (HTML) renderer ────────────────────────────────────────────────

export async function renderPermitHtml(p: GuestParkingPermit, opts: {
  orgName: string;
  unitLabel: string;
  ownerName: string;
  publicPassUrl: string;
}): Promise<string> {
  const qrPng = await renderQrPngDataUrl(opts.publicPassUrl, 200);
  const e = (s: string) => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const fmtDate = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const veh = [p.vehicleColor, p.vehicleMake, p.vehicleModel].filter(Boolean).join(" ") || p.vehicleDesc || "—";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Guest Parking Permit ${e(p.permitNumber)}</title>
<style>
@page { size: letter; margin: 0.5in; }
body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; margin: 0; padding: 24px; }
.permit { border: 4px double #111; padding: 28px; max-width: 720px; margin: 0 auto; position: relative; }
h1 { margin: 0 0 4px; font-size: 30px; letter-spacing: 0.05em; text-transform: uppercase; }
h2 { margin: 0 0 18px; font-weight: 500; color: #555; font-size: 14px; }
.row { display: flex; gap: 24px; align-items: flex-start; }
.col { flex: 1; }
.permit-id { font-size: 30px; font-family: 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.1em; padding: 14px; background: #FFF7E0; border: 2px solid #C49600; text-align: center; margin: 14px 0; }
table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; }
td { padding: 6px 0; border-bottom: 1px solid #eee; vertical-align: top; }
td.l { color: #666; width: 38%; }
.qr { width: 200px; text-align: center; }
.qr img { width: 200px; height: 200px; }
.qr .cap { font-size: 11px; color: #666; margin-top: 4px; }
.notice { font-size: 11.5px; color: #555; margin-top: 18px; line-height: 1.5; }
.dash-display { background: #FFE96B; padding: 8px; border: 2px solid #C49600; text-align: center; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; font-size: 13px; }
@media print { body { padding: 0 } .no-print { display: none } }
</style></head><body>
<div class="permit">
  <h1>Guest Parking Permit</h1>
  <h2>${e(opts.orgName)}</h2>
  <div class="dash-display">Display face-up on dashboard</div>
  <div class="permit-id">${e(p.permitNumber)}</div>
  <div class="row">
    <div class="col">
      <table>
        <tr><td class="l">Issued to (Unit)</td><td>${e(opts.ownerName)} — Unit ${e(opts.unitLabel)}</td></tr>
        <tr><td class="l">Guest</td><td>${e(p.guestName || "—")}</td></tr>
        <tr><td class="l">Vehicle</td><td>${e(veh)}</td></tr>
        <tr><td class="l">Plate</td><td><strong>${e(p.plate)}</strong>${p.plateState ? " (" + e(p.plateState) + ")" : ""}</td></tr>
        <tr><td class="l">Valid nights</td><td>${e(fmtDate(p.startsOn))} → ${e(fmtDate(p.endsOn))}<br/><span style="color:#666;font-size:12px">${p.nights} night${p.nights === 1 ? "" : "s"}</span></td></tr>
        <tr><td class="l">Status</td><td>${e(p.status)}</td></tr>
        <tr><td class="l">Issued</td><td>${e(new Date(p.createdAt).toLocaleString("en-US"))}</td></tr>
      </table>
    </div>
    <div class="qr">
      <img src="${qrPng}" alt="QR code"/>
      <div class="cap">Scan to verify</div>
    </div>
  </div>
  <p class="notice">This permit must be displayed face-up on the dashboard of the parked vehicle for the entire stay. Vehicles parked in guest spots without a valid, visible permit may be towed at the owner's expense. The HOA is not responsible for theft or damage to vehicles. Issued nights count against the unit's rolling guest-parking allowance.</p>
  <p class="notice"><strong>Permit #:</strong> ${e(p.permitNumber)} · <strong>Verify:</strong> ${e(opts.publicPassUrl)}</p>
  <button class="no-print" onclick="window.print()" style="margin-top:14px;padding:8px 16px;background:#3245FF;color:#fff;border:0;border-radius:6px;font-weight:600;cursor:pointer">Print permit</button>
</div></body></html>`;
}

// ── Audit ──────────────────────────────────────────────────────────────

export async function recordPermitAudit(args: {
  permitId: number;
  action: string;
  actorUserId: number | null;
  actorName: string | null;
  message?: string;
  payload?: unknown;
}): Promise<void> {
  await db.insert(amenityAccessAuditTable).values({
    bookingId: null,
    amenityId: null,
    accessCodeId: null,
    providerKind: "guest_parking",
    action: args.action,
    success: true,
    actorUserId: args.actorUserId,
    actorName: args.actorName ?? "system",
    message: args.message ?? "",
    payload: { permitId: args.permitId, ...((args.payload as object) ?? {}) },
    createdAt: nowISO(),
  });
}

export async function recordLookup(args: {
  query: string;
  plate?: string;
  result: string;
  permitId?: number | null;
  unitId?: string | null;
  patrolUserId?: number | null;
  patrolName?: string | null;
  notes?: string;
}): Promise<void> {
  await db.insert(guestParkingLookupsTable).values({
    query: args.query,
    plate: (args.plate ?? "").toUpperCase(),
    result: args.result,
    permitId: args.permitId ?? null,
    unitId: args.unitId ?? null,
    patrolUserId: args.patrolUserId ?? null,
    patrolName: args.patrolName ?? "",
    notes: args.notes ?? "",
    createdAt: nowISO(),
  });
}

export function publicPermit(p: GuestParkingPermit, ownerName?: string | null) {
  return {
    id: p.id,
    unitId: p.unitId,
    ownerUserId: p.ownerUserId,
    ownerName: ownerName ?? null,
    permitNumber: p.permitNumber,
    startsOn: p.startsOn,
    endsOn: p.endsOn,
    nights: p.nights,
    guestName: p.guestName,
    plate: p.plate,
    plateState: p.plateState,
    vehicleMake: p.vehicleMake,
    vehicleModel: p.vehicleModel,
    vehicleColor: p.vehicleColor,
    vehicleDesc: p.vehicleDesc,
    notes: p.notes,
    status: p.status,
    qrToken: p.qrToken,
    cancelledAt: p.cancelledAt,
    cancellationReason: p.cancellationReason,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export { toDateOnly };
export async function loadOwnerName(userId: number): Promise<string> {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return u?.name ?? "Owner";
}
export async function loadUnitLabel(unitId: string): Promise<string> {
  const [u] = await db.select().from(unitsTable).where(eq(unitsTable.id, unitId));
  return u?.id ?? unitId;
}
