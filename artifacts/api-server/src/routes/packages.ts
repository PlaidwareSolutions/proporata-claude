// Task #87: Mail & Package Room REST routes.
import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  packagesTable,
  packageLockersTable,
  packagePickupAuthorizationsTable,
  packageAuditTable,
  mailHoldWindowsTable,
  unitsTable,
  usersTable,
  amenitiesTable,
  type Package,
  type PackageCarrier,
  type PackageSize,
  type PackageStatus,
} from "@workspace/db/schema";
import { and, asc, desc, eq, gte, lte, ilike, or, isNull } from "drizzle-orm";
import { authenticateJwt, type AuthUser } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { buildSignedPayload, verifySignedPayload, getAmenityProvider, renderQrSvg } from "../lib/amenityAccess.js";
import { notifyPackageIntake } from "../lib/packagesNotify.js";

const router: IRouter = Router();

const CARRIERS: PackageCarrier[] = ["USPS", "UPS", "FedEx", "Amazon", "DHL", "Other"];
const SIZES: PackageSize[] = ["letter", "small", "medium", "large", "oversized"];

function nowISO(): string { return new Date().toISOString(); }
function isManager(u: AuthUser): boolean { return u.role === "admin" || u.role === "manager"; }
function isResident(u: AuthUser): boolean { return u.role === "resident"; }

function newPickupCode(): string {
  const hex = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `PKG-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}
function newLockerPin(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

async function audit(packageId: number, action: string, actor: AuthUser | null, diff?: unknown): Promise<void> {
  await db.insert(packageAuditTable).values({
    packageId, action,
    actorUserId: actor?.id ?? null,
    actorName: actor?.name ?? "system",
    diff: (diff as object) ?? null,
    createdAt: nowISO(),
  });
}

function publicPackage(p: Package, locker?: { bay: string } | null) {
  return {
    id: p.id,
    unitId: p.unitId,
    recipientUserId: p.recipientUserId ?? null,
    recipientName: p.recipientName,
    carrier: p.carrier,
    trackingNumber: p.trackingNumber,
    size: p.size,
    notes: p.notes,
    intakePhotoStorageKey: p.intakePhotoStorageKey ?? null,
    pickupPhotoStorageKey: p.pickupPhotoStorageKey ?? null,
    pickupCode: p.pickupCode,
    qrPayload: p.qrPayload,
    lockerId: p.lockerId ?? null,
    lockerBay: locker?.bay ?? null,
    lockerPin: p.lockerPin ?? null,
    status: p.status,
    heldUntil: p.heldUntil ?? null,
    staleAt: p.staleAt ?? null,
    rtsAt: p.rtsAt ?? null,
    pickedUpAt: p.pickedUpAt ?? null,
    pickedUpByName: p.pickedUpByName,
    pickedUpByUserId: p.pickedUpByUserId ?? null,
    intakeByUserId: p.intakeByUserId ?? null,
    intakeByName: p.intakeByName,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

async function activeHoldFor(unitId: string, on: Date = new Date()): Promise<{ endsOn: string } | null> {
  const today = on.toISOString().slice(0, 10);
  const [row] = await db
    .select()
    .from(mailHoldWindowsTable)
    .where(and(
      eq(mailHoldWindowsTable.unitId, unitId),
      lte(mailHoldWindowsTable.startsOn, today),
      gte(mailHoldWindowsTable.endsOn, today),
    ))
    .orderBy(desc(mailHoldWindowsTable.endsOn))
    .limit(1);
  return row ? { endsOn: row.endsOn } : null;
}

async function intakeOne(args: {
  actor: AuthUser;
  unitId: string;
  recipientUserId?: number | null;
  recipientName?: string;
  carrier?: string;
  trackingNumber?: string;
  size?: string;
  notes?: string;
  intakePhotoStorageKey?: string | null;
  lockerId?: number | null;
  lockerPin?: string | null;
}): Promise<{ pkg: Package; lockerBay: string | null }> {
  const carrier = (CARRIERS as string[]).includes(args.carrier ?? "") ? (args.carrier as PackageCarrier) : "Other";
  const size = (SIZES as string[]).includes(args.size ?? "") ? (args.size as PackageSize) : "medium";

  // Resolve recipient
  let recipientUserId: number | null = args.recipientUserId ?? null;
  let recipientName = args.recipientName ?? "";
  if (!recipientUserId || !recipientName) {
    const owners = await db.select().from(usersTable).where(eq(usersTable.unitId, args.unitId));
    if (!recipientName && owners[0]) recipientName = owners[0].name ?? owners[0].email;
    if (!recipientUserId && owners[0]) recipientUserId = owners[0].id;
  }

  // Locker
  let locker: { id: number; bay: string } | null = null;
  let lockerPin: string | null = args.lockerPin ?? null;
  if (args.lockerId) {
    const [l] = await db.select().from(packageLockersTable).where(eq(packageLockersTable.id, args.lockerId));
    if (l) {
      locker = { id: l.id, bay: l.bay };
      if (!lockerPin) lockerPin = newLockerPin();
    }
  }

  const code = newPickupCode();
  const created = nowISO();
  const qrPayload = buildSignedPayload({
    v: 1,
    scope: "package",
    code,
    unitId: args.unitId,
    issuedAt: created,
  });

  const hold = await activeHoldFor(args.unitId);
  const heldUntil = hold ? hold.endsOn : null;
  const status: PackageStatus = locker ? "in_locker" : "received";

  const [pkg] = await db.insert(packagesTable).values({
    unitId: args.unitId,
    recipientUserId: recipientUserId ?? null,
    recipientName,
    carrier,
    trackingNumber: args.trackingNumber ?? "",
    size,
    notes: args.notes ?? "",
    intakePhotoStorageKey: args.intakePhotoStorageKey ?? null,
    pickupPhotoStorageKey: null,
    pickupCode: code,
    qrPayload,
    lockerId: locker?.id ?? null,
    lockerPin,
    status,
    heldUntil,
    staleAt: null,
    rtsAt: null,
    pickedUpAt: null,
    pickedUpByName: "",
    pickedUpByUserId: null,
    intakeByUserId: args.actor.id ?? null,
    intakeByName: args.actor.name ?? "",
    createdAt: created,
    updatedAt: created,
  }).returning();

  await audit(pkg.id, "intake", args.actor, {
    carrier, size, trackingNumber: args.trackingNumber ?? "",
    lockerId: locker?.id ?? null, heldUntil,
  });

  // Notify (digest mode if on hold).
  await notifyPackageIntake({
    id: pkg.id,
    carrier: pkg.carrier,
    trackingNumber: pkg.trackingNumber,
    size: pkg.size,
    pickupCode: pkg.pickupCode,
    lockerBay: locker?.bay ?? null,
    lockerPin,
    recipientUserId: pkg.recipientUserId,
    recipientName: pkg.recipientName,
    unitId: pkg.unitId,
    heldUntil: pkg.heldUntil,
  }, { digest: !!heldUntil });

  return { pkg, lockerBay: locker?.bay ?? null };
}

// ── Lockers (manager) ─────────────────────────────────────────────────────

router.get("/package-lockers", async (req: Request, res: Response) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const rows = await db.select().from(packageLockersTable).orderBy(asc(packageLockersTable.bankSlug), asc(packageLockersTable.bay));
  res.json(rows);
});

router.post("/package-lockers", async (req: Request, res: Response) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const body = req.body ?? {};
  if (!body.bay) { res.status(400).json({ error: "bay required" }); return; }
  try {
    const [row] = await db.insert(packageLockersTable).values({
      bankSlug: body.bankSlug ?? "default",
      bay: String(body.bay),
      size: SIZES.includes(body.size) ? body.size : "medium",
      notes: body.notes ?? "",
      outOfService: !!body.outOfService,
      createdAt: nowISO(),
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    res.status(409).json({ error: "Locker bay already exists" });
  }
});

router.patch("/package-lockers/:id", async (req: Request, res: Response) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = Number(req.params.id);
  const body = req.body ?? {};
  const patch: Partial<typeof packageLockersTable.$inferInsert> = {};
  if (body.size !== undefined && SIZES.includes(body.size)) patch.size = body.size;
  if (body.notes !== undefined) patch.notes = String(body.notes);
  if (body.outOfService !== undefined) patch.outOfService = !!body.outOfService;
  const [row] = await db.update(packageLockersTable).set(patch).where(eq(packageLockersTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/package-lockers/:id", async (req: Request, res: Response) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  await db.delete(packageLockersTable).where(eq(packageLockersTable.id, Number(req.params.id)));
  res.status(204).end();
});

// ── Packages ─────────────────────────────────────────────────────────────

// Manager dashboard with filters.
router.get("/packages", async (req: Request, res: Response) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const { status, unitId, carrier, q, from, to } = req.query as Record<string, string | undefined>;
  const conds = [] as unknown[];
  if (status) conds.push(eq(packagesTable.status, status as PackageStatus));
  if (unitId) conds.push(eq(packagesTable.unitId, unitId));
  if (carrier) conds.push(eq(packagesTable.carrier, carrier as PackageCarrier));
  if (from) conds.push(gte(packagesTable.createdAt, from));
  if (to) conds.push(lte(packagesTable.createdAt, to));
  if (q) conds.push(or(
    ilike(packagesTable.recipientName, `%${q}%`),
    ilike(packagesTable.trackingNumber, `%${q}%`),
    ilike(packagesTable.pickupCode, `%${q}%`),
  )!);

  const rows = conds.length > 0
    ? await db.select().from(packagesTable).where(and(...(conds as never[]))).orderBy(desc(packagesTable.createdAt))
    : await db.select().from(packagesTable).orderBy(desc(packagesTable.createdAt));

  const lockerIds = Array.from(new Set(rows.map((r) => r.lockerId).filter((x): x is number => !!x)));
  const lockers = lockerIds.length > 0
    ? await db.select().from(packageLockersTable)
    : [];
  const lockerById = new Map<number, { bay: string }>(lockers.map((l) => [l.id, { bay: l.bay }]));
  res.json(rows.map((r) => publicPackage(r, r.lockerId ? lockerById.get(r.lockerId) : null)));
});

// Resident: my unit's packages.
router.get("/packages/me", async (req: Request, res: Response) => {
  const u = req.user!;
  if (!u.unitId) { res.json([]); return; }
  const rows = await db.select().from(packagesTable)
    .where(eq(packagesTable.unitId, u.unitId))
    .orderBy(desc(packagesTable.createdAt));
  const lockers = await db.select().from(packageLockersTable);
  const lockerById = new Map<number, { bay: string }>(lockers.map((l) => [l.id, { bay: l.bay }]));
  res.json(rows.map((r) => publicPackage(r, r.lockerId ? lockerById.get(r.lockerId) : null)));
});

router.get("/packages/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [p] = await db.select().from(packagesTable).where(eq(packagesTable.id, id));
  if (!p) { res.status(404).json({ error: "Not found" }); return; }
  if (isResident(req.user!) && req.user!.unitId !== p.unitId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const locker = p.lockerId ? (await db.select().from(packageLockersTable).where(eq(packageLockersTable.id, p.lockerId)))[0] ?? null : null;
  res.json(publicPackage(p, locker ? { bay: locker.bay } : null));
});

router.get("/packages/:id/qr.svg", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [p] = await db.select().from(packagesTable).where(eq(packagesTable.id, id));
  if (!p) { res.status(404).end(); return; }
  if (isResident(req.user!) && req.user!.unitId !== p.unitId) { res.status(403).end(); return; }
  const svg = await renderQrSvg(p.qrPayload);
  res.setHeader("content-type", "image/svg+xml; charset=utf-8");
  res.send(svg);
});

router.get("/packages/:id/audit", async (req: Request, res: Response) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = Number(req.params.id);
  const rows = await db.select().from(packageAuditTable)
    .where(eq(packageAuditTable.packageId, id))
    .orderBy(desc(packageAuditTable.createdAt));
  res.json(rows);
});

// Manager intake.
router.post("/packages", async (req: Request, res: Response) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const body = req.body ?? {};
  if (!body.unitId) { res.status(400).json({ error: "unitId required" }); return; }
  const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, body.unitId));
  if (!unit) { res.status(400).json({ error: "Unknown unit" }); return; }

  const { pkg, lockerBay } = await intakeOne({
    actor: req.user!,
    unitId: body.unitId,
    recipientUserId: body.recipientUserId ?? null,
    recipientName: body.recipientName,
    carrier: body.carrier,
    trackingNumber: body.trackingNumber,
    size: body.size,
    notes: body.notes,
    intakePhotoStorageKey: body.intakePhotoStorageKey ?? null,
    lockerId: body.lockerId ?? null,
    lockerPin: body.lockerPin ?? null,
  });

  res.status(201).json(publicPackage(pkg, lockerBay ? { bay: lockerBay } : null));
});

// Bulk intake.
router.post("/packages/bulk", async (req: Request, res: Response) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) { res.status(400).json({ error: "items[] required" }); return; }
  const created: Package[] = [];
  const errors: Array<{ index: number; error: string }> = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] ?? {};
    if (!it.unitId) { errors.push({ index: i, error: "unitId required" }); continue; }
    const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, it.unitId));
    if (!unit) { errors.push({ index: i, error: "Unknown unit" }); continue; }
    try {
      const { pkg } = await intakeOne({
        actor: req.user!,
        unitId: it.unitId,
        recipientName: it.recipientName,
        carrier: it.carrier,
        trackingNumber: it.trackingNumber,
        size: it.size,
        notes: it.notes,
      });
      created.push(pkg);
    } catch (err) {
      logger.error({ err, item: it }, "bulk intake row failed");
      errors.push({ index: i, error: (err as Error).message });
    }
  }
  res.status(201).json({ created: created.length, errors, packages: created.map((p) => publicPackage(p)) });
});

// Manager edit (locker reassign, notes, etc.).
router.patch("/packages/:id", async (req: Request, res: Response) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const id = Number(req.params.id);
  const [p] = await db.select().from(packagesTable).where(eq(packagesTable.id, id));
  if (!p) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body ?? {};
  const patch: Partial<typeof packagesTable.$inferInsert> = {};
  const diff: Record<string, unknown> = {};
  if (body.notes !== undefined) { patch.notes = String(body.notes); diff.notes = body.notes; }
  if (body.recipientName !== undefined) { patch.recipientName = String(body.recipientName); diff.recipientName = body.recipientName; }
  if (body.recipientUserId !== undefined) { patch.recipientUserId = body.recipientUserId ?? null; diff.recipientUserId = body.recipientUserId; }
  if (body.carrier !== undefined && CARRIERS.includes(body.carrier)) { patch.carrier = body.carrier; diff.carrier = body.carrier; }
  if (body.size !== undefined && SIZES.includes(body.size)) { patch.size = body.size; diff.size = body.size; }
  if (body.trackingNumber !== undefined) { patch.trackingNumber = String(body.trackingNumber); diff.trackingNumber = body.trackingNumber; }
  if (body.status !== undefined) { patch.status = body.status; diff.status = body.status; }

  let lockerBay: string | null = null;
  if (body.lockerId !== undefined) {
    if (body.lockerId === null) {
      patch.lockerId = null;
      patch.lockerPin = null;
    } else {
      const [l] = await db.select().from(packageLockersTable).where(eq(packageLockersTable.id, body.lockerId));
      if (!l) { res.status(400).json({ error: "Unknown locker" }); return; }
      patch.lockerId = l.id;
      patch.lockerPin = body.lockerPin ?? p.lockerPin ?? newLockerPin();
      patch.status = p.status === "received" ? "in_locker" : p.status;
      lockerBay = l.bay;
    }
    diff.lockerId = body.lockerId;
  }

  patch.updatedAt = nowISO();
  const [updated] = await db.update(packagesTable).set(patch).where(eq(packagesTable.id, id)).returning();
  await audit(id, "edit", req.user!, diff);
  const locker = updated.lockerId
    ? (await db.select().from(packageLockersTable).where(eq(packageLockersTable.id, updated.lockerId)))[0] ?? null
    : null;
  res.json(publicPackage(updated, locker ? { bay: locker.bay } : (lockerBay ? { bay: lockerBay } : null)));
});

// Pickup — manager OR kiosk OR resident scanning code.
router.post("/packages/:id/pickup", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [p] = await db.select().from(packagesTable).where(eq(packagesTable.id, id));
  if (!p) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body ?? {};
  const presentedCode = String(body.code ?? "").trim().toUpperCase();
  const presentedToken = String(body.token ?? "").trim();

  // Authorization: manager always allowed; resident must own unit OR present matching code.
  const u = req.user!;
  if (!isManager(u)) {
    let ok = false;
    if (presentedCode && presentedCode === p.pickupCode.toUpperCase()) ok = true;
    if (presentedToken) {
      const decoded = verifySignedPayload(presentedToken);
      if (decoded && decoded.scope === "package" && String(decoded.code).toUpperCase() === p.pickupCode.toUpperCase()) ok = true;
    }
    if (!ok && u.unitId === p.unitId) ok = true;
    if (!ok) { res.status(403).json({ error: "Pickup code required" }); return; }
  }

  if (p.status === "picked_up" || p.status === "returned") {
    res.status(400).json({ error: `Already ${p.status}` }); return;
  }

  // Verify proxy authorization if pickedUpByName is provided and != recipient/owner.
  const pickedUpByName: string = String(body.pickedUpByName ?? u.name ?? "").trim();
  if (pickedUpByName && pickedUpByName.toLowerCase() !== p.recipientName.toLowerCase()) {
    const owners = await db.select().from(usersTable).where(eq(usersTable.unitId, p.unitId));
    const ownerNames = new Set(owners.map((o) => (o.name ?? o.email).toLowerCase()));
    if (!ownerNames.has(pickedUpByName.toLowerCase())) {
      const auths = await db.select().from(packagePickupAuthorizationsTable).where(eq(packagePickupAuthorizationsTable.packageId, id));
      const authorized = auths.some((a) => a.authorizedName.toLowerCase() === pickedUpByName.toLowerCase());
      if (!authorized && !isManager(u)) {
        res.status(403).json({ error: "Pickup-proxy not authorized" }); return;
      }
    }
  }

  const now = nowISO();
  const [updated] = await db.update(packagesTable).set({
    status: "picked_up",
    pickedUpAt: now,
    pickedUpByName: pickedUpByName,
    pickedUpByUserId: u.id ?? null,
    pickupPhotoStorageKey: body.pickupPhotoStorageKey ?? p.pickupPhotoStorageKey ?? null,
    updatedAt: now,
  }).where(eq(packagesTable.id, id)).returning();

  await audit(id, "pickup", u, {
    pickedUpByName, pickupPhotoStorageKey: body.pickupPhotoStorageKey ?? null,
  });

  res.json(publicPackage(updated));
});

// Pickup-proxy authorization.
router.post("/packages/:id/authorize-proxy", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [p] = await db.select().from(packagesTable).where(eq(packagesTable.id, id));
  if (!p) { res.status(404).json({ error: "Not found" }); return; }
  const u = req.user!;
  if (!isManager(u) && u.unitId !== p.unitId) { res.status(403).json({ error: "Forbidden" }); return; }
  const body = req.body ?? {};
  if (!body.authorizedName) { res.status(400).json({ error: "authorizedName required" }); return; }
  const [row] = await db.insert(packagePickupAuthorizationsTable).values({
    packageId: id,
    authorizedName: String(body.authorizedName),
    authorizedUserId: body.authorizedUserId ?? null,
    note: body.note ?? "",
    createdByUserId: u.id ?? null,
    createdAt: nowISO(),
  }).returning();
  await audit(id, "authorize_proxy", u, { authorizedName: row.authorizedName });
  res.status(201).json(row);
});

router.get("/packages/:id/authorizations", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [p] = await db.select().from(packagesTable).where(eq(packagesTable.id, id));
  if (!p) { res.status(404).json({ error: "Not found" }); return; }
  const u = req.user!;
  if (!isManager(u) && u.unitId !== p.unitId) { res.status(403).json({ error: "Forbidden" }); return; }
  const rows = await db.select().from(packagePickupAuthorizationsTable)
    .where(eq(packagePickupAuthorizationsTable.packageId, id))
    .orderBy(desc(packagePickupAuthorizationsTable.createdAt));
  res.json(rows);
});

// Mail-hold windows for a unit (resident self-service).
router.get("/units/me/mail-holds", async (req: Request, res: Response) => {
  const u = req.user!;
  if (!u.unitId) { res.json([]); return; }
  const rows = await db.select().from(mailHoldWindowsTable)
    .where(eq(mailHoldWindowsTable.unitId, u.unitId))
    .orderBy(desc(mailHoldWindowsTable.startsOn));
  res.json(rows);
});

router.post("/units/me/mail-holds", async (req: Request, res: Response) => {
  const u = req.user!;
  if (!u.unitId) { res.status(400).json({ error: "No unit assigned" }); return; }
  const body = req.body ?? {};
  if (!body.startsOn || !body.endsOn) { res.status(400).json({ error: "startsOn/endsOn required" }); return; }
  if (String(body.startsOn) > String(body.endsOn)) { res.status(400).json({ error: "endsOn must be >= startsOn" }); return; }
  const [row] = await db.insert(mailHoldWindowsTable).values({
    unitId: u.unitId,
    startsOn: String(body.startsOn),
    endsOn: String(body.endsOn),
    note: body.note ?? "",
    createdByUserId: u.id ?? null,
    createdAt: nowISO(),
  }).returning();
  res.status(201).json(row);
});

router.delete("/units/me/mail-holds/:id", async (req: Request, res: Response) => {
  const u = req.user!;
  if (!u.unitId) { res.status(400).json({ error: "No unit assigned" }); return; }
  const id = Number(req.params.id);
  await db.delete(mailHoldWindowsTable).where(and(
    eq(mailHoldWindowsTable.id, id),
    eq(mailHoldWindowsTable.unitId, u.unitId),
  ));
  res.status(204).end();
});

// Manager: list all holds (operations view).
router.get("/mail-holds", async (req: Request, res: Response) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const rows = await db.select().from(mailHoldWindowsTable).orderBy(desc(mailHoldWindowsTable.startsOn));
  res.json(rows);
});

// Verify a presented pickup code/QR (kiosk lookup before pickup).
router.post("/packages/lookup", async (req: Request, res: Response) => {
  const body = req.body ?? {};
  let code = String(body.code ?? "").trim().toUpperCase();
  if (!code && body.token) {
    const decoded = verifySignedPayload(String(body.token));
    if (decoded?.scope === "package") code = String(decoded.code).toUpperCase();
  }
  if (!code) { res.status(400).json({ error: "code or token required" }); return; }
  const [p] = await db.select().from(packagesTable).where(eq(packagesTable.pickupCode, code));
  if (!p) { res.status(404).json({ error: "Unknown code" }); return; }
  if (isResident(req.user!) && req.user!.unitId !== p.unitId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const locker = p.lockerId
    ? (await db.select().from(packageLockersTable).where(eq(packageLockersTable.id, p.lockerId)))[0] ?? null
    : null;
  res.json(publicPackage(p, locker ? { bay: locker.bay } : null));
});

// Mail Room amenity locker provider info.
router.get("/mailroom/provider", async (req: Request, res: Response) => {
  if (!isManager(req.user!)) { res.status(403).json({ error: "Manager only" }); return; }
  const [a] = await db.select().from(amenitiesTable).where(eq(amenitiesTable.slug, "mail_package_room"));
  if (!a) { res.json(null); return; }
  const provider = await getAmenityProvider(a.id);
  res.json(provider ?? { kind: "none", amenityId: a.id, enabled: false });
});

export default router;
