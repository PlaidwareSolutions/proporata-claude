/**
 * Demo Seed — Task #122
 * =====================
 *
 * Idempotent, ADDITIVE seed that populates ~25 entity domains with realistic
 * data for demos and screenshots. Specifically elevates Unit B01-U01
 * (Dylan Taylor, 2402 Hampshire Lane) to a hero unit with deep multi-year
 * history.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run seed:demo
 *
 * Wired into scripts/post-merge.sh behind SEED_DEMO_DATA=1.
 *
 * Deterministic-id strategy:
 *   - Tables with text PKs (work_orders, documents) use stable keys like
 *     `seed:wo:B01-U01:roof-2019`. Re-runs upsert.
 *   - Tables with serial PKs use a unique column (notes / email / slug /
 *     permitNumber / serial / etc.) carrying a `seed:` prefix that we look
 *     up before insert. If found, we update; otherwise we insert.
 *   - All seeded rows are tagged with a `seed:` marker either in the id,
 *     notes, or a synthetic field so the seed can be wiped surgically:
 *       DELETE FROM <table> WHERE notes LIKE 'seed:%';
 *
 * To extend per domain, add a function below and call it from `runDemoSeed`.
 * Each domain function is independently re-runnable. To wipe + reseed, drop
 * the database (or delete by `seed:%` prefix) and re-run.
 */

import bcrypt from "bcryptjs";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { type PgTable } from "drizzle-orm/pg-core";
import { db, pool } from "@workspace/db";
import {
  usersTable,
  vendorsTable,
  vendorCertificatesTable,
  vendorContractsTable,
  workOrdersTable,
  workOrderAttachmentsTable,
  workOrderEventsTable,
  buildingsTable,
  unitsTable,
  insurancePoliciesTable,
  documentsTable,
  documentImportBatchesTable,
  ownerAccountsTable,
  ledgerEntriesTable,
  bidRequestsTable,
  bidScopeItemsTable,
  bidQuotesTable,
  architecturalRequestsTable,
  accEventsTable,
  motionsTable,
  motionVotesTable,
  resolutionsTable,
  meetingsTable,
  meetingAgendaItemsTable,
  meetingAgendaCommentsTable,
  noticesTable,
  meetingAttendanceTable,
  committeesTable,
  committeeMembersTable,
  hearingsTable,
  calendarSubCalendarsTable,
  calendarEventsTable,
  calendarEventRsvpsTable,
  trashHolidayShiftsTable,
  calendarShareTokensTable,
  amenitiesTable,
  amenityBookingsTable,
  amenityBookingAuditTable,
  amenityBlackoutsTable,
  amenityLifeguardWindowsTable,
  amenityInspectionsTable,
  amenityDamageReportsTable,
  amenityDamageDisputesTable,
  amenityDepositLedgerTable,
  poolChemistryLogsTable,
  amenityExpenseEntriesTable,
  chargingPortsTable,
  chargingReservationsTable,
  chargingSessionsTable,
  guestParkingPermitsTable,
  guestParkingSettingsTable,
  guestParkingLookupsTable,
  unitVehiclesTable,
  packagesTable,
  packageLockersTable,
  packagePickupAuthorizationsTable,
  mailHoldWindowsTable,
  packageAuditTable,
  petsTable,
  petVaccinationsTable,
  petDogparkAgreementsTable,
  petIncidentsTable,
  fobInventoryTable,
  fobAssignmentsTable,
  poolTagsTable,
  violationsTable,
  complianceItemsTable,
  notificationsTable,
  notificationLogTable,
  buildingSystemsTable,
  buildingSystemInspectionsTable,
  buildingSystemRepairsTable,
  buildingSystemDocumentsTable,
} from "@workspace/db/schema";
import { ObjectStorageService, objectStorageClient } from "./lib/objectStorage.js";
import { buildPlaceholderPdf, buildDemoPdf } from "./lib/placeholderPdf.js";

// ─────────────────────────────────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────────────────────────────────

const HERO_UNIT = "B01-U01";
const HERO_BUILDING = 1;
const HERO_OWNER_NAME = "Dylan Taylor";
// Hero email matches scripts/seed-property-data.sql so userIsOwner() resolves.
const HERO_OWNER_EMAIL = "dylan.taylor49@aol.com";
// Synthetic non-routable demo phone (555-555-XXXX is reserved for fiction).
const HERO_OWNER_PHONE = "+15555550101";

const DEMO_PASSWORD = "Demo!2026";

// Synthetic phone numbers — 555-555-01XX is reserved for fiction/demo use.
const DEMO_PHONE = (n: number) => `+15555550${String(n).padStart(3, "0")}`;

const today = new Date();
const TODAY_ISO = today.toISOString();
const TODAY_DATE = TODAY_ISO.slice(0, 10);

function daysAgo(n: number): string {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}
function daysAhead(n: number): string {
  return daysAgo(-n);
}
function dateOnlyAgo(n: number): string {
  return daysAgo(n).slice(0, 10);
}
function dateOnlyAhead(n: number): string {
  return daysAhead(n).slice(0, 10);
}

const log = (msg: string) => console.log(`[seed-demo] ${msg}`);

let objectStorage: ObjectStorageService | null = null;
function getObjectStorage(): ObjectStorageService | null {
  if (objectStorage) return objectStorage;
  try {
    objectStorage = new ObjectStorageService();
    return objectStorage;
  } catch {
    return null;
  }
}

/**
 * Upload a PDF buffer to object storage and return its storage path.
 *
 * Fails loud if object storage isn't available — every seeded document MUST
 * have a real previewable PDF. Set SEED_DEMO_ALLOW_NO_STORAGE=1 to relax
 * during development without object storage configured.
 */
async function uploadPdfToStorage(keyHint: string, buf: Buffer): Promise<string> {
  const svc = getObjectStorage();
  if (!svc) {
    if (process.env.SEED_DEMO_ALLOW_NO_STORAGE === "1") return "";
    throw new Error("Object storage is not configured. Set DEFAULT_OBJECT_STORAGE_BUCKET_ID + PRIVATE_OBJECT_DIR or SEED_DEMO_ALLOW_NO_STORAGE=1 to skip PDFs.");
  }
  const privateDir = svc.getPrivateObjectDir();
  const safeKey = keyHint.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectId = `demo/${safeKey}.pdf`;
  const fullPath = privateDir.endsWith("/") ? `${privateDir}${objectId}` : `${privateDir}/${objectId}`;
  const stripped = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
  const idx = stripped.indexOf("/");
  if (idx < 0) throw new Error(`Invalid private object dir: ${privateDir}`);
  const bucketName = stripped.slice(0, idx);
  const objectName = stripped.slice(idx + 1);
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  await file.save(buf, { contentType: "application/pdf", resumable: false });
  return `/objects/${objectId}`;
}

async function uploadPlaceholderPdf(keyHint: string, name: string, category: string, dateStr: string): Promise<string> {
  return uploadPdfToStorage(keyHint, buildPlaceholderPdf(name, category, dateStr));
}

/**
 * Upsert helper — query by a unique column, insert if missing, return the row.
 * Constrained to Drizzle PgTable inputs so the helper does not silently widen
 * inserts via `any`. Each table's row shape is narrowed by `$inferSelect`.
 */
async function ensureRow<TTable extends PgTable>(
  table: TTable,
  whereClause: SQL,
  insertValues: TTable["$inferInsert"]
): Promise<TTable["$inferSelect"]> {
  const existing = await db.select().from(table as PgTable).where(whereClause).limit(1);
  if (existing[0]) return existing[0] as TTable["$inferSelect"];
  const inserted = await db.insert(table).values(insertValues).returning();
  return inserted[0] as TTable["$inferSelect"];
}

// ─────────────────────────────────────────────────────────────────────────
// Personas
// ─────────────────────────────────────────────────────────────────────────

interface Persona {
  email: string;
  name: string;
  role: "admin" | "manager" | "resident";
  unitId?: string | null;
  boardMember?: boolean;
  officerTitle?: string | null;
  phone?: string;
  phoneVerified?: boolean;
}

// All persona emails are clearly synthetic (.invalid TLD or @quailvalleyhoa.demo)
// except the hero, whose email matches scripts/seed-property-data.sql so the
// userIsOwner() lookup resolves to the right unit.
const PERSONAS: Persona[] = [
  { email: "demo.admin@quailvalleyhoa.demo", name: "Demo Admin", role: "admin", boardMember: true, officerTitle: null, phone: DEMO_PHONE(110) },
  { email: "demo.manager@quailvalleyhoa.demo", name: "Demo Manager", role: "manager", boardMember: false, phone: DEMO_PHONE(111) },
  { email: "demo.chair@quailvalleyhoa.demo", name: "Patricia Chair", role: "manager", boardMember: true, officerTitle: "President", phone: DEMO_PHONE(112) },
  { email: "demo.boardmember@quailvalleyhoa.demo", name: "Robert Director", role: "manager", boardMember: true, officerTitle: "Treasurer", phone: DEMO_PHONE(113) },
  { email: "demo.accountant@quailvalleyhoa.demo", name: "Linda Books", role: "manager", boardMember: false, phone: DEMO_PHONE(114) },
  { email: HERO_OWNER_EMAIL, name: HERO_OWNER_NAME, role: "resident", unitId: HERO_UNIT, phone: HERO_OWNER_PHONE, phoneVerified: true },
  { email: "demo.owner.b01-u03@example.invalid", name: "Demo Owner B01-U03", role: "resident", unitId: "B01-U03", phone: DEMO_PHONE(120) },
  { email: "demo.tenant.b01-u03@example.invalid", name: "Demo Tenant B01-U03", role: "resident", unitId: "B01-U03", phone: DEMO_PHONE(121) },
  { email: "demo.vendor@hamptonroofing.demo", name: "Henry Hampton (Vendor)", role: "manager", boardMember: false, phone: DEMO_PHONE(115) },
];

async function seedPersonas(): Promise<Map<string, number>> {
  log("Seeding personas...");
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const ids = new Map<string, number>();
  for (const p of PERSONAS) {
    const existing = await db.select().from(usersTable).where(eq(usersTable.email, p.email)).limit(1);
    if (existing[0]) {
      // Update key fields (idempotent refresh) but keep existing password.
      await db.update(usersTable)
        .set({
          name: p.name,
          role: p.role,
          unitId: p.unitId ?? null,
          boardMember: p.boardMember ?? false,
          officerTitle: p.officerTitle ?? null,
          phone: p.phone ?? null,
          phoneVerified: p.phoneVerified ?? false,
          pending: false,
        })
        .where(eq(usersTable.id, existing[0].id));
      ids.set(p.email, existing[0].id);
    } else {
      const inserted = await db.insert(usersTable).values({
        email: p.email,
        passwordHash,
        role: p.role,
        name: p.name,
        unitId: p.unitId ?? null,
        boardMember: p.boardMember ?? false,
        officerTitle: p.officerTitle ?? null,
        termStart: p.boardMember ? dateOnlyAgo(400) : null,
        termEnd: p.boardMember ? dateOnlyAhead(330) : null,
        phone: p.phone ?? null,
        phoneVerified: p.phoneVerified ?? false,
        pending: false,
        createdAt: TODAY_ISO,
      }).returning();
      ids.set(p.email, inserted[0].id);
    }
  }
  log(`  ${ids.size} personas (password: ${DEMO_PASSWORD})`);
  return ids;
}

// ─────────────────────────────────────────────────────────────────────────
// Vendors
// ─────────────────────────────────────────────────────────────────────────

interface SeedVendor {
  name: string;
  trade: string;
  contact: string;
  phone: string;
  email: string;
  license?: string;
  status?: string;
  coiExpiresOn?: string;
  hasW9?: boolean;
}

// All vendor phones use the 555-555-01XX synthetic block; emails use .demo.
const SEED_VENDORS: SeedVendor[] = [
  { name: "Hampton Roofing Co.", trade: "roofing", contact: "Henry Hampton", phone: DEMO_PHONE(201), email: "ops@hamptonroofing.demo", license: "TX-RC-44218", coiExpiresOn: dateOnlyAhead(120), hasW9: true },
  { name: "BlueWave Pool Service", trade: "pool", contact: "Marcus Reed", phone: DEMO_PHONE(202), email: "service@bluewave.demo", license: "TX-PO-19922", coiExpiresOn: dateOnlyAhead(45), hasW9: true },
  { name: "GreenScape Landscaping", trade: "landscaping", contact: "Diana Park", phone: DEMO_PHONE(203), email: "team@greenscape.demo", coiExpiresOn: dateOnlyAhead(15), hasW9: true },
  { name: "Sparkbright Electric", trade: "electrical", contact: "Pedro Vega", phone: DEMO_PHONE(204), email: "dispatch@sparkbright.demo", license: "TX-EL-77231", coiExpiresOn: dateOnlyAhead(220), hasW9: true },
  { name: "FlowFix Plumbing", trade: "plumbing", contact: "Yolanda Mims", phone: DEMO_PHONE(205), email: "calls@flowfix.demo", license: "TX-PL-31102", coiExpiresOn: dateOnlyAgo(20), hasW9: true },
  { name: "ClearView Glass", trade: "glass", contact: "Tom Ellis", phone: DEMO_PHONE(206), email: "tom@clearview.demo", coiExpiresOn: dateOnlyAhead(180), hasW9: false },
  { name: "AllPest Control", trade: "pest", contact: "Rita Ochoa", phone: DEMO_PHONE(207), email: "rita@allpest.demo", coiExpiresOn: dateOnlyAhead(75), hasW9: true },
  { name: "MetroTrash Services", trade: "trash", contact: "Greg Liu", phone: DEMO_PHONE(208), email: "billing@metrotrash.demo", coiExpiresOn: dateOnlyAhead(300), hasW9: true },
  { name: "GateGuard Access", trade: "gate", contact: "Sam Wahid", phone: DEMO_PHONE(209), email: "sam@gateguard.demo", coiExpiresOn: dateOnlyAhead(60), hasW9: true },
  { name: "FireSafe Inspections", trade: "fire", contact: "Carla Funk", phone: DEMO_PHONE(210), email: "carla@firesafe.demo", coiExpiresOn: dateOnlyAhead(40), hasW9: true },
  { name: "PaintCraft Painters", trade: "paint", contact: "Otis Rivera", phone: DEMO_PHONE(211), email: "otis@paintcraft.demo", coiExpiresOn: dateOnlyAhead(95), hasW9: true },
  { name: "Foundation First", trade: "concrete", contact: "Helena Vu", phone: DEMO_PHONE(212), email: "helena@foundationfirst.demo", coiExpiresOn: dateOnlyAhead(210), hasW9: true },
  { name: "ChillTech HVAC", trade: "hvac", contact: "Marv Lopez", phone: DEMO_PHONE(213), email: "marv@chilltech.demo", license: "TX-HV-55821", coiExpiresOn: dateOnlyAhead(150), hasW9: true },
  { name: "Yard Heroes (terminated)", trade: "landscaping", contact: "(former)", phone: DEMO_PHONE(214), email: "closed@yardheroes.demo", status: "inactive", hasW9: false },
  { name: "Acme Insurance Brokers", trade: "insurance", contact: "Eleanor Cho", phone: DEMO_PHONE(215), email: "eleanor@acmeins.demo", coiExpiresOn: dateOnlyAhead(400), hasW9: true },
];

async function seedVendors(): Promise<Map<string, number>> {
  log("Seeding vendors...");
  const ids = new Map<string, number>();
  for (const v of SEED_VENDORS) {
    const existing = await db.select().from(vendorsTable).where(eq(vendorsTable.email, v.email)).limit(1);
    let id: number;
    if (existing[0]) {
      id = existing[0].id;
      await db.update(vendorsTable).set({
        name: v.name, tradeCategory: v.trade, contactName: v.contact, phone: v.phone,
        licenseNumber: v.license ?? null, status: v.status ?? "active",
        notes: "seed:vendor",
      }).where(eq(vendorsTable.id, id));
    } else {
      const ins = await db.insert(vendorsTable).values({
        name: v.name, tradeCategory: v.trade, contactName: v.contact, phone: v.phone, email: v.email,
        licenseNumber: v.license ?? null, status: v.status ?? "active",
        notes: "seed:vendor",
      }).returning();
      id = ins[0].id;
    }
    ids.set(v.name, id);

    // COI cert
    if (v.coiExpiresOn) {
      const cert = await db.select().from(vendorCertificatesTable)
        .where(and(eq(vendorCertificatesTable.vendorId, id), eq(vendorCertificatesTable.kind, "coi")))
        .limit(1);
      if (!cert[0]) {
        await db.insert(vendorCertificatesTable).values({
          vendorId: id, kind: "coi", expiresOn: v.coiExpiresOn,
          notes: "seed:cert", createdAt: TODAY_ISO,
        });
      }
    }
    if (v.hasW9) {
      const w9 = await db.select().from(vendorCertificatesTable)
        .where(and(eq(vendorCertificatesTable.vendorId, id), eq(vendorCertificatesTable.kind, "w9")))
        .limit(1);
      if (!w9[0]) {
        await db.insert(vendorCertificatesTable).values({
          vendorId: id, kind: "w9", expiresOn: dateOnlyAhead(720),
          notes: "seed:cert", createdAt: TODAY_ISO,
        });
      }
    }
  }

  // Recurring landscaping + pool contracts
  const greenId = ids.get("GreenScape Landscaping");
  const blueId = ids.get("BlueWave Pool Service");
  const yardHeroes = ids.get("Yard Heroes (terminated)");
  type Recurrence = import("@workspace/db/schema").CalendarRecurrence;
  const contracts: Array<{
    vid: number | undefined; title: string;
    recurrence: Recurrence;
    active: boolean;
  }> = [
    { vid: greenId, title: "Weekly grounds maintenance", recurrence: { freq: "WEEKLY", byday: ["TU"] }, active: true },
    { vid: blueId, title: "Pool chemistry & cleaning (twice weekly)", recurrence: { freq: "WEEKLY", byday: ["MO", "TH"] }, active: true },
    { vid: yardHeroes, title: "Bi-weekly yard service (terminated 2024)", recurrence: { freq: "WEEKLY", interval: 2, byday: ["FR"] }, active: false },
  ];
  for (const c of contracts) {
    if (!c.vid) continue;
    const existing = await db.select().from(vendorContractsTable)
      .where(and(eq(vendorContractsTable.vendorId, c.vid), eq(vendorContractsTable.title, c.title))).limit(1);
    if (!existing[0]) {
      await db.insert(vendorContractsTable).values({
        vendorId: c.vid, serviceType: "landscaping", title: c.title,
        recurrence: c.recurrence, firstServiceOn: dateOnlyAgo(c.active ? 30 : 600),
        durationMinutes: 90, active: c.active,
        notes: "seed:contract",
        createdAt: TODAY_ISO,
      });
    }
  }
  log(`  ${ids.size} vendors`);
  return ids;
}

// ─────────────────────────────────────────────────────────────────────────
// Insurance policies (refresh per building)
// ─────────────────────────────────────────────────────────────────────────

async function seedInsurance() {
  log("Seeding insurance policies...");
  const buildings = await db.select().from(buildingsTable);
  for (const b of buildings) {
    const existing = await db.select().from(insurancePoliciesTable)
      .where(eq(insurancePoliciesTable.building, b.num)).limit(1);
    let expiresOn: string;
    let status: string;
    if (b.insuranceStatus === "missing") {
      expiresOn = dateOnlyAgo(30); status = "missing";
    } else if (b.insuranceStatus === "expiring") {
      expiresOn = dateOnlyAhead(20); status = "expiring";
    } else {
      expiresOn = dateOnlyAhead(180 + (b.num % 6) * 15); status = "current";
    }
    const carriers = ["Liberty Mutual", "Travelers", "Chubb", "Nationwide", "Allstate Commercial"];
    const carrier = carriers[b.num % carriers.length];
    const policyNo = `QV-${String(b.num).padStart(2, "0")}-${2026 - (b.num % 4)}`;
    if (existing[0]) {
      await db.update(insurancePoliciesTable).set({
        carrier, policyNo, coverage: 2_000_000 + b.num * 50_000,
        premium: 12_500 + b.num * 200, expires: expiresOn, status,
      }).where(eq(insurancePoliciesTable.id, existing[0].id));
    } else {
      await db.insert(insurancePoliciesTable).values({
        building: b.num, carrier, policyNo,
        coverage: 2_000_000 + b.num * 50_000, premium: 12_500 + b.num * 200,
        expires: expiresOn, status,
      });
    }
  }
  log(`  ${buildings.length} insurance policies`);
}

// ─────────────────────────────────────────────────────────────────────────
// Work orders (live + historical, heavy on B01-U01)
// ─────────────────────────────────────────────────────────────────────────

async function seedWorkOrders(vendorIds: Map<string, number>) {
  log("Seeding work orders...");
  const flow = await db.select().from(vendorsTable).where(eq(vendorsTable.email, "calls@flowfix.demo")).limit(1);
  const hampton = await db.select().from(vendorsTable).where(eq(vendorsTable.email, "ops@hamptonroofing.demo")).limit(1);
  const blue = await db.select().from(vendorsTable).where(eq(vendorsTable.email, "service@bluewave.demo")).limit(1);
  const green = await db.select().from(vendorsTable).where(eq(vendorsTable.email, "team@greenscape.demo")).limit(1);

  const seedWOs: Array<{
    id: string; building: number; unit?: string; title: string; category: string;
    priority: string; status: string; vendorId?: number; vendorName?: string;
    opened: string; due?: string; estCost: number; description: string;
    historical?: boolean; completedOn?: string; actualCost?: number;
    historicalVendorName?: string;
  }> = [
    // Hero unit B01-U01 — open + closed + 2 historical
    { id: "seed:wo:B01-U01:hvac-2026", building: 1, unit: "B01-U01", title: "Replace upstairs A/C condenser fan motor", category: "hvac", priority: "high", status: "in_progress", vendorId: vendorIds.get("ChillTech HVAC"), vendorName: "ChillTech HVAC", opened: daysAgo(4), due: dateOnlyAhead(3), estCost: 45000, description: "Resident reports loud rattling and weak airflow upstairs." },
    { id: "seed:wo:B01-U01:plumb-leak", building: 1, unit: "B01-U01", title: "Kitchen sink slow drain follow-up", category: "plumbing", priority: "low", status: "completed", vendorId: vendorIds.get("FlowFix Plumbing"), vendorName: "FlowFix Plumbing", opened: daysAgo(75), due: dateOnlyAgo(70), estCost: 18000, completedOn: dateOnlyAgo(68), actualCost: 17500, description: "Snake kitchen line; advise on disposal use." },
    { id: "seed:wo:B01-U01:roof-2019", building: 1, unit: "B01-U01", title: "Hail damage roof patch (3 squares)", category: "roofing", priority: "high", status: "completed", historical: true, opened: "2019-04-12T08:00:00.000Z", completedOn: "2019-04-22", actualCost: 285000, historicalVendorName: "Stevens Roofing (prior mgmt)", estCost: 280000, description: "Historical: post-storm patch; insurance partial reimbursement." },
    { id: "seed:wo:B01-U01:plumb-2021", building: 1, unit: "B01-U01", title: "Replace failing PEX supply line under master bath", category: "plumbing", priority: "high", status: "completed", historical: true, opened: "2021-07-08T08:00:00.000Z", completedOn: "2021-07-09", actualCost: 92000, historicalVendorName: "Anchor Plumbing (prior mgmt)", estCost: 90000, description: "Historical: emergency call; replaced 14ft of failing PEX." },
  ];

  // ~80 live + ~25 historical across other buildings
  const cats = ["hvac", "plumbing", "electrical", "roofing", "landscaping", "common_area", "pest", "paint"];
  const statuses = ["new", "in_progress", "in_progress", "completed", "completed", "completed"];
  const priorities = ["low", "normal", "normal", "high", "urgent"];
  const titlesByCat: Record<string, string[]> = {
    hvac: ["A/C unit not cooling", "Thermostat replacement", "Heat pump diagnostic"],
    plumbing: ["Slow drain in kitchen", "Toilet running constantly", "Outdoor spigot leaking", "Hot water heater inspection"],
    electrical: ["Breaker tripping in master bedroom", "GFCI outlet replacement", "Common area light out"],
    roofing: ["Inspect post-storm shingle damage", "Flashing repair near chimney"],
    landscaping: ["Replace dying shrubs along fenceline", "Repair sprinkler zone 4", "Trim overhanging oak"],
    common_area: ["Mailbox lock replacement", "Pressure wash sidewalks", "Repair amenity gate hinge"],
    pest: ["Quarterly pest treatment", "Wasp nest removal at clubhouse"],
    paint: ["Touch up exterior trim", "Repaint stair rail"],
  };
  let counter = 1;
  for (let b = 1; b <= 25; b++) {
    const numLive = b === 4 || b === 9 ? 5 : b === HERO_BUILDING ? 1 : 3;
    for (let i = 0; i < numLive; i++) {
      const cat = cats[counter % cats.length];
      const titles = titlesByCat[cat];
      const status = statuses[counter % statuses.length];
      const opened = daysAgo(15 + (counter * 7) % 480);
      seedWOs.push({
        id: `seed:wo:bldg${b}:live-${i + 1}`,
        building: b,
        title: titles[counter % titles.length],
        category: cat, priority: priorities[counter % priorities.length],
        status,
        opened,
        due: status !== "completed" ? dateOnlyAhead(7 + (counter % 30)) : undefined,
        estCost: 8000 + (counter * 1300) % 50000,
        completedOn: status === "completed" ? opened.slice(0, 10) : undefined,
        actualCost: status === "completed" ? 7500 + (counter * 1100) % 48000 : undefined,
        description: `Auto-seeded ${cat} work order in building ${b}.`,
      });
      counter++;
    }
  }
  // ~25 historical scattered
  const histYears = [2014, 2015, 2017, 2018, 2019, 2020, 2021, 2022, 2023];
  for (let i = 0; i < 25; i++) {
    const b = 1 + (i % 25);
    const cat = cats[i % cats.length];
    const yr = histYears[i % histYears.length];
    seedWOs.push({
      id: `seed:wo:bldg${b}:hist-${i + 1}`,
      building: b,
      title: `Historical: ${titlesByCat[cat][0]} (${yr})`,
      category: cat, priority: "normal", status: "completed",
      historical: true,
      opened: `${yr}-0${1 + (i % 8)}-15T08:00:00.000Z`,
      completedOn: `${yr}-0${1 + (i % 8)}-20`,
      estCost: 15000 + (i * 1700) % 60000,
      actualCost: 14500 + (i * 1600) % 59000,
      historicalVendorName: i % 2 === 0 ? "Stevens Roofing (prior mgmt)" : "Anchor Plumbing (prior mgmt)",
      description: `Historical work order from ${yr}, logged for record-keeping.`,
    });
  }

  for (const wo of seedWOs) {
    const existing = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, wo.id)).limit(1);
    const values = {
      id: wo.id, building: wo.building, unit: wo.unit ?? null,
      title: wo.title, category: wo.category, priority: wo.priority, status: wo.status,
      vendor: wo.vendorName ?? null, vendorId: wo.vendorId ?? null,
      opened: wo.opened, due: wo.due ?? null, estCost: wo.estCost,
      description: wo.description ?? null,
      historical: wo.historical ?? false,
      completedOn: wo.completedOn ?? null,
      actualCost: wo.actualCost ?? null,
      historicalVendorName: wo.historicalVendorName ?? null,
      historicalNotes: wo.historical ? "seed:wo:historical" : null,
    };
    if (existing[0]) {
      await db.update(workOrdersTable).set(values).where(eq(workOrdersTable.id, wo.id));
    } else {
      await db.insert(workOrdersTable).values(values);
    }
  }
  log(`  ${seedWOs.length} work orders (incl. ${seedWOs.filter(w => w.historical).length} historical)`);
}

// ─────────────────────────────────────────────────────────────────────────
// Bids
// ─────────────────────────────────────────────────────────────────────────

async function seedBids(vendorIds: Map<string, number>, userIds: Map<string, number>) {
  log("Seeding bid requests...");
  const managerId = userIds.get("demo.manager@quailvalleyhoa.demo") ?? null;
  const bids = [
    { title: "2026 Roof inspection contract — buildings 4, 9, 13", trade: "roofing", status: "open", deadline: dateOnlyAhead(14), notes: "seed:bid:roof-2026" },
    { title: "Pool deck resurfacing", trade: "concrete", status: "evaluating", deadline: dateOnlyAhead(3), notes: "seed:bid:pool-deck" },
    { title: "Annual landscaping rebid", trade: "landscaping", status: "awarded", deadline: dateOnlyAgo(20), awardVendor: "GreenScape Landscaping", notes: "seed:bid:landscape-2026" },
    { title: "Building 4 emergency siding replacement", trade: "paint", status: "awarded", deadline: dateOnlyAgo(35), awardVendor: "PaintCraft Painters", notes: "seed:bid:bldg4-siding" },
    { title: "Fence repair — Camelot Lane stretch", trade: "concrete", status: "cancelled", deadline: dateOnlyAgo(50), notes: "seed:bid:fence-cancelled" },
    { title: "Gate access controller upgrade", trade: "gate", status: "open", deadline: dateOnlyAhead(28), notes: "seed:bid:gate-controller" },
  ];
  for (const b of bids) {
    const existing = await db.select().from(bidRequestsTable).where(eq(bidRequestsTable.title, b.title)).limit(1);
    let bidId: number;
    if (existing[0]) {
      bidId = existing[0].id;
    } else {
      const awardVendorId = b.awardVendor ? vendorIds.get(b.awardVendor) ?? null : null;
      const ins = await db.insert(bidRequestsTable).values({
        title: b.title, scope: `${b.trade} scope of work`,
        tradeCategory: b.trade, status: b.status, deadline: b.deadline,
        sealedBids: false, createdBy: managerId, createdByName: "Demo Manager",
        createdAt: TODAY_ISO,
        awardedVendorId: awardVendorId,
        awardedAt: b.status === "awarded" ? daysAgo(15) : null,
        awardRationale: b.status === "awarded" ? "Lowest qualified bid; references checked." : null,
      }).returning();
      bidId = ins[0].id;
    }
    // 3 quotes per bid (skip if exists)
    const trades = Array.from(vendorIds.entries()).slice(0, 3);
    for (let i = 0; i < trades.length; i++) {
      const [vname, vid] = trades[i];
      const exists = await db.select().from(bidQuotesTable)
        .where(and(eq(bidQuotesTable.bidRequestId, bidId), eq(bidQuotesTable.vendorId, vid)))
        .limit(1);
      if (exists[0]) continue;
      await db.insert(bidQuotesTable).values({
        bidRequestId: bidId, vendorId: vid,
        leadTimeDays: 14 + i * 7, paymentTerms: "Net 30",
        warrantyText: "1-year workmanship", notes: `seed:quote ${vname}`,
        totalCents: 1_200_000 + i * 320_000,
        submittedAt: daysAgo(10 + i),
      });
    }
    // One scope item
    const itemExists = await db.select().from(bidScopeItemsTable)
      .where(and(eq(bidScopeItemsTable.bidRequestId, bidId), eq(bidScopeItemsTable.label, "Base scope"))).limit(1);
    if (!itemExists[0]) {
      await db.insert(bidScopeItemsTable).values({
        bidRequestId: bidId, sortOrder: 1, label: "Base scope", notes: "seed:scope",
      });
    }
  }
  log(`  ${bids.length} bid requests`);
}

// ─────────────────────────────────────────────────────────────────────────
// ACC requests
// ─────────────────────────────────────────────────────────────────────────

async function seedAccRequests(userIds: Map<string, number>) {
  log("Seeding ACC requests...");
  const heroUser = userIds.get(HERO_OWNER_EMAIL);
  if (!heroUser) return;
  const items = [
    { unitId: "B01-U01", ownerUserId: heroUser, ownerName: HERO_OWNER_NAME, building: 1, projectType: "exterior", title: "Replace front door (matching color)", description: "Steel door, color: existing federal blue.", status: "in_review", submittedDays: 8 },
    { unitId: "B01-U01", ownerUserId: heroUser, ownerName: HERO_OWNER_NAME, building: 1, projectType: "exterior", title: "Install storm door (2024 — historical approval)", description: "Approved retroactively per board minutes 2024-08.", status: "approved", submittedDays: 540, decided: true },
    { unitId: "B01-U03", ownerUserId: userIds.get("demo.owner.b01-u03@example.invalid") ?? heroUser, ownerName: "Demo Owner B01-U03", building: 1, projectType: "interior_visible", title: "New front-window blinds", description: "White faux-wood, 2-inch slats.", status: "approved", submittedDays: 60, decided: true },
    { unitId: "B02-U01", ownerUserId: heroUser, ownerName: "Kevin Martin", building: 2, projectType: "exterior", title: "Patio extension 6x10ft", description: "Stained concrete, neutral gray.", status: "denied", submittedDays: 45, decided: true },
    { unitId: "B03-U03", ownerUserId: heroUser, ownerName: "Anthony Murray", building: 3, projectType: "exterior", title: "Solar panel installation (8 panels)", description: "Roof-mount, south-facing.", status: "in_review", submittedDays: 5 },
    { unitId: "B05-U03", ownerUserId: heroUser, ownerName: "Nicholas Wright", building: 5, projectType: "fence", title: "Side fence replacement", description: "6ft cedar with cap, matching neighbors.", status: "auto_approved", submittedDays: 95, decided: true },
    { unitId: "B06-U02", ownerUserId: heroUser, ownerName: "Jack Washington", building: 6, projectType: "landscape", title: "Front yard succulent garden", description: "Drought-tolerant beds with mulch border.", status: "withdrawn", submittedDays: 110, decided: true },
    { unitId: "B07-U03", ownerUserId: heroUser, ownerName: "Arthur Cole", building: 7, projectType: "exterior", title: "Replace garage door", description: "Standard insulated steel, color matched.", status: "approved", submittedDays: 30, decided: true },
    { unitId: "B08-U01", ownerUserId: heroUser, ownerName: "Gloria Jenkins", building: 8, projectType: "exterior", title: "Add screen porch (back patio)", description: "Aluminum frame, screened only (no glass).", status: "in_review", submittedDays: 12 },
    { unitId: "B10-U02", ownerUserId: heroUser, ownerName: "B10 Owner", building: 10, projectType: "exterior", title: "Outdoor lighting upgrade", description: "Pathway and accent LED fixtures.", status: "approved", submittedDays: 20, decided: true },
    { unitId: "B12-U01", ownerUserId: heroUser, ownerName: "B12 Owner", building: 12, projectType: "fence", title: "Replace back gate", description: "Cedar to match.", status: "approved", submittedDays: 18, decided: true },
    { unitId: "B15-U02", ownerUserId: heroUser, ownerName: "B15 Owner", building: 15, projectType: "exterior", title: "Repaint front door (color change to dark green)", description: "Color sample attached.", status: "denied", submittedDays: 40, decided: true },
  ];
  for (const i of items) {
    const existing = await db.select().from(architecturalRequestsTable)
      .where(and(eq(architecturalRequestsTable.unitId, i.unitId), eq(architecturalRequestsTable.title, i.title))).limit(1);
    if (existing[0]) continue;
    const submittedAt = daysAgo(i.submittedDays);
    await db.insert(architecturalRequestsTable).values({
      unitId: i.unitId, building: i.building, ownerUserId: i.ownerUserId, ownerName: i.ownerName,
      projectType: i.projectType, title: i.title, description: i.description,
      acknowledgedGuidelines: true,
      status: i.status,
      submittedAt,
      decidedAt: i.decided ? daysAgo(i.submittedDays - 5) : null,
      decisionText: i.decided ? `Decision: ${i.status}` : null,
      autoApprovalFlagged: i.status === "auto_approved",
      autoApprovalFlaggedAt: i.status === "auto_approved" ? daysAgo(i.submittedDays - 30) : null,
    });
  }
  log(`  ${items.length} ACC requests`);
}

// ─────────────────────────────────────────────────────────────────────────
// Owner accounts + ledger entries (12 months for B01-U01, sample for others)
// ─────────────────────────────────────────────────────────────────────────

async function seedBilling(userIds: Map<string, number>) {
  log("Seeding billing & ledger entries...");
  const adminId = userIds.get("demo.admin@quailvalleyhoa.demo") ?? 1;
  const units = await db.select().from(unitsTable);
  // Hash unit id deterministically to vary delinquency / payment patterns.
  const unitHash = (id: string) => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return Math.abs(h);
  };
  for (const u of units) {
    const existing = await db.select().from(ownerAccountsTable).where(eq(ownerAccountsTable.unitId, u.id)).limit(1);
    let accountId: number;
    if (existing[0]) accountId = existing[0].id;
    else {
      const ins = await db.insert(ownerAccountsTable).values({
        unitId: u.id, openingBalance: 0, createdAt: TODAY_ISO,
      }).returning();
      accountId = ins[0].id;
    }
    const isHero = u.id === HERO_UNIT;
    const h = unitHash(u.id);
    // 12 months for every unit (hero + others) so every owner profile has a
    // full year of billing history. Idempotency keys are month-anchored
    // (`Mxx`) — independent of wall-clock — so reruns on different days
    // produce identical row counts.
    const months = 12;
    // Roughly 5% of non-hero units have a missed payment to demonstrate
    // delinquency; hero unit's m=4 is paid (no skip) so its history is clean.
    const delinquentMonth = isHero ? -1 : (h % 20 === 0 ? (h % 12) : -1);
    for (let m = months - 1; m >= 0; m--) {
      const occurredOn = dateOnlyAgo(m * 30);
      const memo = `seed:assess:${u.id}:M${m.toString().padStart(2, "0")}`;
      const exists = await db.select().from(ledgerEntriesTable)
        .where(and(eq(ledgerEntriesTable.ownerAccountId, accountId), eq(ledgerEntriesTable.memo, memo))).limit(1);
      if (!exists[0]) {
        await db.insert(ledgerEntriesTable).values({
          ownerAccountId: accountId, occurredOn, postedAt: daysAgo(m * 30),
          kind: "charge", chargeType: "monthly_assessment",
          amountCents: 38500, memo, postedBy: adminId,
        });
      }
      if (m !== delinquentMonth) {
        const payMemo = `seed:pay:${u.id}:M${m.toString().padStart(2, "0")}`;
        const payExists = await db.select().from(ledgerEntriesTable)
          .where(and(eq(ledgerEntriesTable.ownerAccountId, accountId), eq(ledgerEntriesTable.memo, payMemo))).limit(1);
        if (!payExists[0]) {
          // Hero gets a real online payment (stripe_card) for the most-recent
          // assessment so the receipt UI has something to show.
          const isHeroReceipt = isHero && m === 0;
          await db.insert(ledgerEntriesTable).values({
            ownerAccountId: accountId, occurredOn: dateOnlyAgo(m * 30 - 5),
            postedAt: daysAgo(m * 30 - 5),
            kind: "payment",
            paymentMethod: isHeroReceipt ? "stripe_card" : (h % 3 === 0 ? "check" : "ach"),
            amountCents: -38500, memo: payMemo, postedBy: adminId,
          });
        }
      }
    }
    // Hero special assessment 6 months ago.
    if (isHero) {
      const memo = `seed:special-assess:${u.id}`;
      const exists = await db.select().from(ledgerEntriesTable)
        .where(and(eq(ledgerEntriesTable.ownerAccountId, accountId), eq(ledgerEntriesTable.memo, memo))).limit(1);
      if (!exists[0]) {
        await db.insert(ledgerEntriesTable).values({
          ownerAccountId: accountId, occurredOn: dateOnlyAgo(180),
          postedAt: daysAgo(180), kind: "charge", chargeType: "special_assessment",
          amountCents: 75000, memo, postedBy: adminId,
        });
      }
    }
  }
  log(`  billing seeded for ${units.length} units (12 months each, ~5% delinquent, hero last payment via stripe_card)`);
}

// ─────────────────────────────────────────────────────────────────────────
// Governance: meetings, motions, resolutions, committees, notices
// ─────────────────────────────────────────────────────────────────────────

async function seedGovernance(userIds: Map<string, number>) {
  log("Seeding governance...");
  const chairId = userIds.get("demo.chair@quailvalleyhoa.demo");
  const treasId = userIds.get("demo.boardmember@quailvalleyhoa.demo");
  const adminId = userIds.get("demo.admin@quailvalleyhoa.demo");
  const heroId = userIds.get(HERO_OWNER_EMAIL);
  if (!chairId || !adminId) return;

  const meetings = [
    // Historical meetings spanning 3+ years for governance history.
    { title: "Q1 Board Meeting 2023", kind: "open", scheduledAt: daysAgo(1090), status: "adjourned", minutesStatus: "adopted", noticePosted: daysAgo(1100) },
    { title: "Q3 Board Meeting 2023", kind: "open", scheduledAt: daysAgo(910), status: "adjourned", minutesStatus: "adopted", noticePosted: daysAgo(920) },
    { title: "Annual Members Meeting 2023", kind: "annual", scheduledAt: daysAgo(820), status: "adjourned", minutesStatus: "adopted", noticePosted: daysAgo(855) },
    { title: "Q2 Board Meeting 2024", kind: "open", scheduledAt: daysAgo(660), status: "adjourned", minutesStatus: "adopted", noticePosted: daysAgo(670) },
    { title: "Q4 Board Meeting 2024", kind: "open", scheduledAt: daysAgo(490), status: "adjourned", minutesStatus: "adopted", noticePosted: daysAgo(500) },
    { title: "Q2 Board Meeting 2025", kind: "open", scheduledAt: daysAgo(310), status: "adjourned", minutesStatus: "adopted", noticePosted: daysAgo(320) },
    // Recent + upcoming meetings.
    { title: "Special Meeting — special assessment hearing", kind: "open", scheduledAt: daysAgo(190), status: "adjourned", minutesStatus: "adopted", noticePosted: daysAgo(220) },
    { title: "Annual Members Meeting 2025", kind: "annual", scheduledAt: daysAgo(120), status: "adjourned", minutesStatus: "adopted", noticePosted: daysAgo(155) },
    { title: "Q1 Board Meeting (adopted minutes)", kind: "open", scheduledAt: daysAgo(75), status: "adjourned", minutesStatus: "adopted", noticePosted: daysAgo(80) },
    { title: "Executive Session — vendor disputes", kind: "executive", scheduledAt: daysAgo(40), status: "adjourned", minutesStatus: "adopted", noticePosted: daysAgo(45) },
    { title: "Q2 Board Meeting (minutes pending)", kind: "open", scheduledAt: daysAgo(15), status: "adjourned", minutesStatus: "draft", noticePosted: daysAgo(20) },
    { title: "Upcoming open board meeting", kind: "open", scheduledAt: daysAhead(20), status: "scheduled", minutesStatus: "none", noticePosted: daysAgo(5) },
    { title: "Future meeting (notice not posted)", kind: "open", scheduledAt: daysAhead(60), status: "scheduled", minutesStatus: "none" },
    { title: "Annual Members Meeting 2026 (upcoming)", kind: "annual", scheduledAt: daysAhead(120), status: "scheduled", minutesStatus: "none", noticePosted: daysAgo(2) },
  ];
  // Map of meeting title -> id, populated as meetings are upserted, used
  // to attach historical motions and agenda items.
  const meetingIdByTitle = new Map<string, number>();
  const meetingIds: number[] = [];
  for (const m of meetings) {
    const ex = await db.select().from(meetingsTable).where(eq(meetingsTable.title, m.title)).limit(1);
    let id: number;
    if (ex[0]) {
      id = ex[0].id;
    } else {
      const ins = await db.insert(meetingsTable).values({
        title: m.title, kind: m.kind,
        scheduledAt: m.scheduledAt, durationMinutes: 90,
        locationPhysical: "Quail Valley Clubhouse", noticeText: `Notice for ${m.title}`,
        noticePostedAt: m.noticePosted ?? null,
        status: m.status,
        minutesStatus: m.minutesStatus,
        minutesContent: m.minutesStatus === "adopted" ? "Minutes adopted unanimously." : "",
        minutesAdoptedAt: m.minutesStatus === "adopted" ? new Date(new Date(m.scheduledAt).getTime() + 30 * 86400000).toISOString() : null,
        adjournedAt: m.status === "adjourned" ? m.scheduledAt : null,
        createdByUserId: chairId, createdByName: "Patricia Chair",
        createdAt: TODAY_ISO,
      }).returning();
      id = ins[0].id;
    }
    meetingIds.push(id);
    meetingIdByTitle.set(m.title, id);
    // Agenda item per meeting
    const agendaTitle = `Discussion: ${m.title}`;
    const agendaEx = await db.select().from(meetingAgendaItemsTable)
      .where(and(eq(meetingAgendaItemsTable.meetingId, id), eq(meetingAgendaItemsTable.title, agendaTitle))).limit(1);
    let agendaItemId: number;
    if (agendaEx[0]) agendaItemId = agendaEx[0].id;
    else {
      const ains = await db.insert(meetingAgendaItemsTable).values({
        meetingId: id, sortOrder: 1, kind: "discussion",
        title: agendaTitle, presenter: "Chair",
        closedSession: m.kind === "executive",
      }).returning();
      agendaItemId = ains[0].id;
    }
    // Hero comment on upcoming open meeting
    if (m.title === "Upcoming open board meeting" && heroId) {
      const cex = await db.select().from(meetingAgendaCommentsTable)
        .where(and(eq(meetingAgendaCommentsTable.agendaItemId, agendaItemId), eq(meetingAgendaCommentsTable.ownerUserId, heroId))).limit(1);
      if (!cex[0]) {
        await db.insert(meetingAgendaCommentsTable).values({
          agendaItemId, meetingId: id, ownerUserId: heroId, ownerName: HERO_OWNER_NAME,
          unitId: HERO_UNIT,
          body: "Requesting consideration of additional EV charging capacity in lot B.",
          createdAt: TODAY_ISO,
        });
      }
    }
    // Notice — meeting_scheduled
    if (m.noticePosted) {
      const nex = await db.select().from(noticesTable)
        .where(and(eq(noticesTable.kind, "meeting_scheduled"), eq(noticesTable.sourceType, "meeting"), eq(noticesTable.sourceId, id))).limit(1);
      if (!nex[0]) {
        await db.insert(noticesTable).values({
          kind: "meeting_scheduled", title: `Notice: ${m.title}`,
          body: `Public notice for ${m.title}`,
          sourceType: "meeting", sourceId: id, meetingId: id,
          postedAt: m.noticePosted, requiredWindowDays: m.kind === "annual" ? 30 : 3,
        });
      }

      // Agenda packet PDF + agenda_published notice. Posted ~2 days after
      // the meeting notice for a realistic timeline.
      const agendaPostedAt = new Date(new Date(m.noticePosted).getTime() + 2 * 86400000).toISOString();
      const meetingRow = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id)).limit(1);
      if (meetingRow[0] && !meetingRow[0].agendaPacketStorageKey) {
        const agendaPdf = buildDemoPdf(
          `Agenda Packet — ${m.title}`,
          "Quail Valley HOA Board Meeting",
          {
            "Meeting": m.title,
            "Kind": m.kind,
            "Scheduled": m.scheduledAt.slice(0, 10),
            "Location": "Quail Valley Clubhouse",
            "Notice Posted": m.noticePosted.slice(0, 10),
            "Agenda Posted": agendaPostedAt.slice(0, 10),
          },
          "Agenda items, supporting materials, and prior-meeting minutes attached.",
        );
        const key = await uploadPdfToStorage(`governance/agenda-${id}`, agendaPdf);
        if (key) {
          await db.update(meetingsTable).set({
            agendaPacketStorageKey: key,
            agendaPacketGeneratedAt: agendaPostedAt,
          }).where(eq(meetingsTable.id, id));
        }
      }
      const aex = await db.select().from(noticesTable)
        .where(and(eq(noticesTable.kind, "agenda_published"), eq(noticesTable.sourceType, "meeting"), eq(noticesTable.sourceId, id))).limit(1);
      if (!aex[0]) {
        await db.insert(noticesTable).values({
          kind: "agenda_published", title: `Agenda published: ${m.title}`,
          body: `The agenda packet for ${m.title} has been published.`,
          sourceType: "meeting", sourceId: id, meetingId: id,
          postedAt: agendaPostedAt, requiredWindowDays: null,
        });
      }
    }

    // Posted minutes PDF + minutes_adopted notice
    if (m.minutesStatus === "adopted") {
      const meetingRow = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id)).limit(1);
      const adoptedAt = meetingRow[0]?.minutesAdoptedAt ?? new Date(new Date(m.scheduledAt).getTime() + 30 * 86400000).toISOString();
      if (meetingRow[0] && !meetingRow[0].minutesStorageKey) {
        const minutesPdf = buildDemoPdf(
          `Adopted Minutes — ${m.title}`,
          "Quail Valley HOA Board Meeting Minutes",
          {
            "Meeting": m.title,
            "Held": m.scheduledAt.slice(0, 10),
            "Adopted": adoptedAt.slice(0, 10),
            "Quorum": "Established",
            "Outcome": "Minutes adopted unanimously",
          },
          "Full minutes including motions, votes, and discussion summary.",
        );
        const key = await uploadPdfToStorage(`governance/minutes-${id}`, minutesPdf);
        if (key) {
          await db.update(meetingsTable).set({ minutesStorageKey: key }).where(eq(meetingsTable.id, id));
        }
      }
      const mnex = await db.select().from(noticesTable)
        .where(and(eq(noticesTable.kind, "minutes_adopted"), eq(noticesTable.sourceType, "meeting"), eq(noticesTable.sourceId, id))).limit(1);
      if (!mnex[0]) {
        await db.insert(noticesTable).values({
          kind: "minutes_adopted", title: `Minutes adopted: ${m.title}`,
          body: `The Board has adopted the minutes for ${m.title}.`,
          sourceType: "meeting", sourceId: id, meetingId: id,
          postedAt: adoptedAt, requiredWindowDays: null,
        });
      }
    }
    // Attendance for past meetings
    if (m.status === "adjourned" && treasId) {
      for (const [uid, uname, isBoard] of [
        [chairId, "Patricia Chair", true],
        [treasId, "Robert Director", true],
        [adminId, "Demo Admin", false],
      ] as const) {
        const aex = await db.select().from(meetingAttendanceTable)
          .where(and(eq(meetingAttendanceTable.meetingId, id), eq(meetingAttendanceTable.userId, uid))).limit(1);
        if (!aex[0]) {
          await db.insert(meetingAttendanceTable).values({
            meetingId: id, userId: uid, userName: uname,
            status: "present", isBoardMember: isBoard,
            recordedAt: m.scheduledAt,
          });
        }
      }
    }
  }

  // Motions — ~25 entries spanning multiple years and outcomes for a
  // realistic governance ledger. `daysAgoOpen`/`daysAgoResolved` are stable
  // offsets so reruns produce identical timestamps.
  type SeedMotion = {
    title: string;
    kind: "general" | "resolution" | "bid_award" | "ratification" | "rescind_resolution" | "policy" | "stripe_config";
    status: "draft" | "open" | "adopted" | "rejected" | "withdrawn" | "expired";
    outcome?: "adopted" | "rejected" | "expired" | "withdrawn";
    daysAgoOpen?: number;
    daysAgoResolved?: number;
    category?: "architectural" | "financial" | "rules" | "personnel" | "emergency" | "other";
    public?: boolean;
    // Title of the meeting where this motion was voted on. When set, the
    // motion's meetingId + an agenda item linking the motion are created.
    meetingTitle?: string;
  };
  const motions: SeedMotion[] = [
    // Adopted public resolutions — span 3+ years (2023..2026) so the
    // governance library demonstrates real timeline coverage.
    { title: "Resolution 2023-001 — Adopt revised pool rules", kind: "resolution", status: "adopted", outcome: "adopted", daysAgoOpen: 1110, daysAgoResolved: 1090, category: "rules", public: true, meetingTitle: "Q1 Board Meeting 2023" },
    { title: "Resolution 2023-002 — Architectural fence guidelines update", kind: "resolution", status: "adopted", outcome: "adopted", daysAgoOpen: 940, daysAgoResolved: 910, category: "architectural", public: true, meetingTitle: "Q3 Board Meeting 2023" },
    { title: "Resolution 2024-001 — Reserve study funding plan", kind: "resolution", status: "adopted", outcome: "adopted", daysAgoOpen: 850, daysAgoResolved: 820, category: "financial", public: true, meetingTitle: "Annual Members Meeting 2023" },
    { title: "Resolution 2024-002 — Pet registration policy", kind: "resolution", status: "adopted", outcome: "adopted", daysAgoOpen: 700, daysAgoResolved: 660, category: "rules", public: true, meetingTitle: "Q2 Board Meeting 2024" },
    { title: "Resolution 2024-003 — Vendor selection criteria", kind: "resolution", status: "adopted", outcome: "adopted", daysAgoOpen: 540, daysAgoResolved: 490, category: "financial", public: true, meetingTitle: "Q4 Board Meeting 2024" },
    { title: "Resolution 2025-001 — EV charging station pilot", kind: "resolution", status: "adopted", outcome: "adopted", daysAgoOpen: 360, daysAgoResolved: 310, category: "architectural", public: true, meetingTitle: "Q2 Board Meeting 2025" },
    { title: "Resolution 2025-002 — Update ACC application fees", kind: "resolution", status: "adopted", outcome: "adopted", daysAgoOpen: 360, daysAgoResolved: 310, category: "architectural", public: true, meetingTitle: "Q2 Board Meeting 2025" },
    { title: "Resolution 2025-003 — Amenity reservation policy", kind: "resolution", status: "adopted", outcome: "adopted", daysAgoOpen: 220, daysAgoResolved: 190, category: "rules", public: true, meetingTitle: "Special Meeting — special assessment hearing" },
    { title: "Resolution 2025-004 — Delinquency collection schedule", kind: "resolution", status: "adopted", outcome: "adopted", daysAgoOpen: 150, daysAgoResolved: 120, category: "financial", public: true, meetingTitle: "Annual Members Meeting 2025" },
    { title: "Resolution 2025-005 — Trash & recycling vendor renewal", kind: "resolution", status: "adopted", outcome: "adopted", daysAgoOpen: 150, daysAgoResolved: 120, category: "financial", public: true, meetingTitle: "Annual Members Meeting 2025" },
    { title: "Resolution 2026-001 — 2026 budget adoption", kind: "resolution", status: "adopted", outcome: "adopted", daysAgoOpen: 110, daysAgoResolved: 75, category: "financial", public: true, meetingTitle: "Q1 Board Meeting (adopted minutes)" },
    { title: "Resolution 2026-002 — Special assessment 2026", kind: "resolution", status: "adopted", outcome: "adopted", daysAgoOpen: 110, daysAgoResolved: 75, category: "financial", public: true, meetingTitle: "Q1 Board Meeting (adopted minutes)" },
    { title: "Resolution 2026-003 — Updated insurance carrier", kind: "resolution", status: "adopted", outcome: "adopted", daysAgoOpen: 90, daysAgoResolved: 75, category: "financial", public: true, meetingTitle: "Q1 Board Meeting (adopted minutes)" },
    { title: "Resolution 2026-004 — Hearing & violation procedures", kind: "resolution", status: "adopted", outcome: "adopted", daysAgoOpen: 60, daysAgoResolved: 40, category: "rules", public: true, meetingTitle: "Executive Session — vendor disputes" },
    { title: "Resolution 2026-005 — Board meeting cadence", kind: "resolution", status: "adopted", outcome: "adopted", daysAgoOpen: 30, daysAgoResolved: 15, category: "personnel", public: true, meetingTitle: "Q2 Board Meeting (minutes pending)" },
    // Open / rejected / draft governance motions to round out ~25.
    { title: "Adopt updated pool rules (2026 revision)", kind: "resolution", status: "open", daysAgoOpen: 5, category: "rules" },
    { title: "Increase ACC fines for repeat violations", kind: "resolution", status: "rejected", outcome: "rejected", daysAgoOpen: 220, daysAgoResolved: 190, category: "rules", meetingTitle: "Special Meeting — special assessment hearing" },
    { title: "Approve Q1 vendor budget", kind: "general", status: "adopted", outcome: "adopted", daysAgoOpen: 110, daysAgoResolved: 75, meetingTitle: "Q1 Board Meeting (adopted minutes)" },
    { title: "Approve Q2 vendor budget", kind: "general", status: "adopted", outcome: "adopted", daysAgoOpen: 30, daysAgoResolved: 15, meetingTitle: "Q2 Board Meeting (minutes pending)" },
    { title: "Authorize gate controller upgrade", kind: "general", status: "open", daysAgoOpen: 8 },
    { title: "Award landscaping bid to GreenScape", kind: "bid_award", status: "adopted", outcome: "adopted", daysAgoOpen: 130, daysAgoResolved: 120, meetingTitle: "Annual Members Meeting 2025" },
    { title: "Award elevator service contract to Skyline", kind: "bid_award", status: "adopted", outcome: "adopted", daysAgoOpen: 350, daysAgoResolved: 310, meetingTitle: "Q2 Board Meeting 2025" },
    { title: "Ratify emergency plumbing bypass — Bldg 9", kind: "ratification", status: "adopted", outcome: "adopted", daysAgoOpen: 60, daysAgoResolved: 40, meetingTitle: "Executive Session — vendor disputes" },
    { title: "Ratify emergency roof tarp — Bldg 1", kind: "ratification", status: "adopted", outcome: "adopted", daysAgoOpen: 510, daysAgoResolved: 490, meetingTitle: "Q4 Board Meeting 2024" },
    { title: "Quarterly financial review", kind: "general", status: "draft" },
    { title: "Withdraw stale vendor RFQ", kind: "general", status: "withdrawn", outcome: "withdrawn", daysAgoOpen: 700, daysAgoResolved: 660, meetingTitle: "Q2 Board Meeting 2024" },
    // Motion tabled at the meeting and never returned — the schema has no
    // dedicated "tabled" status, so we represent it as withdrawn with a
    // clear title prefix so the governance UI can present it as tabled.
    { title: "Tabled: Clubhouse renovation scope discussion", kind: "general", status: "withdrawn", outcome: "withdrawn", daysAgoOpen: 510, daysAgoResolved: 490, meetingTitle: "Q4 Board Meeting 2024" },
    { title: "Tabled: Reserve study refresh proposal", kind: "general", status: "withdrawn", outcome: "withdrawn", daysAgoOpen: 350, daysAgoResolved: 310, meetingTitle: "Q2 Board Meeting 2025" },
  ];
  // Insert motions; collect inserted ids to write votes.
  const motionIdByTitle = new Map<string, number>();
  for (const m of motions) {
    const linkedMeetingId = m.meetingTitle ? meetingIdByTitle.get(m.meetingTitle) ?? null : null;
    const ex = await db.select().from(motionsTable).where(eq(motionsTable.title, m.title)).limit(1);
    let mid: number;
    if (ex[0]) {
      mid = ex[0].id;
      // Backfill meetingId on reruns if it wasn't set previously.
      if (linkedMeetingId && ex[0].meetingId !== linkedMeetingId) {
        await db.update(motionsTable).set({ meetingId: linkedMeetingId }).where(eq(motionsTable.id, mid));
      }
    } else {
      const ins = await db.insert(motionsTable).values({
        kind: m.kind, title: m.title, body: `Motion body: ${m.title}`,
        votingRule: { type: "majority" }, status: m.status, outcome: m.outcome ?? null,
        createdByUserId: chairId, createdByName: "Patricia Chair",
        createdAt: TODAY_ISO,
        openedAt: m.daysAgoOpen != null ? daysAgo(m.daysAgoOpen) : null,
        resolvedAt: m.daysAgoResolved != null ? daysAgo(m.daysAgoResolved) : null,
        meetingId: linkedMeetingId,
      }).returning();
      mid = ins[0].id;
    }
    motionIdByTitle.set(m.title, mid);
    // When a motion is attached to a past meeting, also create an agenda
    // item of kind "motion" so meeting-detail views surface the motion.
    if (linkedMeetingId) {
      const linkedMeeting = meetings.find(mt => mt.title === m.meetingTitle);
      const isClosed = linkedMeeting?.kind === "executive";
      const itemTitle = `Motion: ${m.title}`;
      const aix = await db.select().from(meetingAgendaItemsTable)
        .where(and(eq(meetingAgendaItemsTable.meetingId, linkedMeetingId), eq(meetingAgendaItemsTable.title, itemTitle))).limit(1);
      if (!aix[0]) {
        await db.insert(meetingAgendaItemsTable).values({
          meetingId: linkedMeetingId, sortOrder: 10, kind: "motion",
          title: itemTitle, presenter: "Chair", motionId: mid,
          closedSession: isClosed,
        });
      }
    }
    // Write a chair-yes vote on every non-draft motion so the ledger has
    // some vote history. Hash is deterministic so reruns match.
    if (m.status !== "draft") {
      const vex = await db.select().from(motionVotesTable)
        .where(and(eq(motionVotesTable.motionId, mid), eq(motionVotesTable.userId, chairId))).limit(1);
      if (!vex[0]) {
        await db.insert(motionVotesTable).values({
          motionId: mid, userId: chairId, userName: "Patricia Chair",
          decision: m.outcome === "rejected" ? "reject" : "approve",
          createdAt: m.daysAgoResolved != null ? daysAgo(m.daysAgoResolved) : daysAgo(m.daysAgoOpen ?? 1),
        });
      }
      if (treasId) {
        const vex2 = await db.select().from(motionVotesTable)
          .where(and(eq(motionVotesTable.motionId, mid), eq(motionVotesTable.userId, treasId))).limit(1);
        if (!vex2[0]) {
          await db.insert(motionVotesTable).values({
            motionId: mid, userId: treasId, userName: "Robert Director",
            decision: m.outcome === "rejected" ? "reject" : "approve",
            createdAt: m.daysAgoResolved != null ? daysAgo(m.daysAgoResolved) : daysAgo(m.daysAgoOpen ?? 1),
          });
        }
      }
    }
  }

  // Resolutions — one per resolution-kind motion. Adopted ones get a number.
  let adoptedSeqByYear: Record<number, number> = {};
  for (const m of motions) {
    if (m.kind !== "resolution") continue;
    const motionId = motionIdByTitle.get(m.title);
    if (!motionId) continue;
    const ex = await db.select().from(resolutionsTable).where(eq(resolutionsTable.motionId, motionId)).limit(1);
    if (ex[0]) continue;
    // Year/seq pulled from title prefix when present (e.g. "Resolution 2025-003 — …").
    const titleMatch = /^Resolution (\d{4})-(\d{3})/.exec(m.title);
    const year = titleMatch ? Number(titleMatch[1]) : null;
    const seq = titleMatch ? Number(titleMatch[2]) : null;
    if (m.outcome === "adopted" && year && seq) {
      adoptedSeqByYear[year] = Math.max(adoptedSeqByYear[year] ?? 0, seq);
    }
    await db.insert(resolutionsTable).values({
      motionId, category: m.category ?? "rules",
      number: m.outcome === "adopted" && year && seq ? `${year}-${String(seq).padStart(3, "0")}` : null,
      numberYear: m.outcome === "adopted" ? year : null,
      numberSeq: m.outcome === "adopted" ? seq : null,
      adoptedAt: m.daysAgoResolved != null && m.outcome === "adopted" ? daysAgo(m.daysAgoResolved) : null,
      public: m.public ?? false,
      createdAt: TODAY_ISO,
    });
  }

  // Resolution PDFs + resolution_adopted notices for adopted public resolutions.
  const adoptedResolutions = await db.select().from(resolutionsTable);
  for (const r of adoptedResolutions) {
    if (!r.number || !r.adoptedAt || !r.public) continue;
    const [linkedMotion] = await db.select().from(motionsTable).where(eq(motionsTable.id, r.motionId));
    if (!linkedMotion) continue;
    if (!r.pdfStorageKey) {
      const resPdf = buildDemoPdf(
        `Resolution ${r.number}`,
        linkedMotion.title,
        {
          "Number": r.number,
          "Category": r.category,
          "Adopted": r.adoptedAt.slice(0, 10),
          "Status": "Adopted",
          "Public": "Yes",
        },
        "Full resolution text on file with the Board secretary.",
      );
      const key = await uploadPdfToStorage(`governance/resolution-${r.id}`, resPdf);
      if (key) {
        await db.update(resolutionsTable).set({ pdfStorageKey: key }).where(eq(resolutionsTable.id, r.id));
      }
    }
    const rnex = await db.select().from(noticesTable)
      .where(and(eq(noticesTable.kind, "resolution_adopted"), eq(noticesTable.sourceType, "resolution"), eq(noticesTable.sourceId, r.id))).limit(1);
    if (!rnex[0]) {
      await db.insert(noticesTable).values({
        kind: "resolution_adopted",
        title: `Resolution ${r.number}: ${linkedMotion.title}`,
        body: linkedMotion.body || "",
        sourceType: "resolution", sourceId: r.id, meetingId: null,
        postedAt: r.adoptedAt, requiredWindowDays: null,
      });
    }
  }

  // Committees — name, charter blurb, and a charter PDF document.
  const committees: Array<{
    slug: string; name: string; description: string; charter: string;
    extraMembers?: Array<{ userId: number | undefined; role: string }>;
  }> = [
    {
      slug: "acc",
      name: "Architectural Control Committee",
      description: "Reviews architectural change requests and enforces design guidelines.",
      charter: "Reviews ACC applications within 30 days; recommends approvals/denials to the Board; maintains design standards.",
      extraMembers: [
        { userId: userIds.get("demo.admin@quailvalleyhoa.demo"), role: "member" },
        { userId: userIds.get(HERO_OWNER_EMAIL), role: "member" },
      ],
    },
    {
      slug: "finance",
      name: "Finance Committee",
      description: "Oversees the operating budget, reserve study, and audit cycle.",
      charter: "Reviews monthly financials; recommends annual budget; oversees reserve funding and the annual audit.",
      extraMembers: [
        { userId: userIds.get("demo.accountant@quailvalleyhoa.demo"), role: "member" },
      ],
    },
    {
      slug: "social",
      name: "Social & Community Events",
      description: "Plans community events and resident engagement programs.",
      charter: "Plans 4+ community events per year; coordinates clubhouse use; recruits resident volunteers.",
      extraMembers: [
        { userId: userIds.get(HERO_OWNER_EMAIL), role: "member" },
      ],
    },
    {
      slug: "rules",
      name: "Rules & Regulations Committee",
      description: "Drafts rule revisions and reviews ongoing compliance policies.",
      charter: "Drafts rule revisions for Board adoption; reviews violation patterns; recommends policy updates annually.",
      extraMembers: [
        { userId: userIds.get("demo.boardmember@quailvalleyhoa.demo"), role: "member" },
      ],
    },
  ];
  for (const c of committees) {
    const ex = await db.select().from(committeesTable).where(eq(committeesTable.slug, c.slug)).limit(1);
    let cid: number;
    if (ex[0]) {
      cid = ex[0].id;
      // Refresh description so reruns pick up enriched copy.
      await db.update(committeesTable).set({
        name: c.name, description: c.description, active: true,
      }).where(eq(committeesTable.id, cid));
    } else {
      const ins = await db.insert(committeesTable).values({
        slug: c.slug, name: c.name, description: c.description,
        active: true, createdAt: TODAY_ISO,
      }).returning();
      cid = ins[0].id;
    }
    // Add chair + treasurer + extras as members
    const memberSpecs: Array<{ userId: number; role: string }> = [];
    if (chairId) memberSpecs.push({ userId: chairId, role: "chair" });
    if (treasId) memberSpecs.push({ userId: treasId, role: "member" });
    for (const em of c.extraMembers ?? []) {
      if (em.userId && !memberSpecs.some(s => s.userId === em.userId)) {
        memberSpecs.push({ userId: em.userId, role: em.role });
      }
    }
    for (const spec of memberSpecs) {
      const mem = await db.select().from(committeeMembersTable)
        .where(and(eq(committeeMembersTable.committeeId, cid), eq(committeeMembersTable.userId, spec.userId))).limit(1);
      if (!mem[0]) {
        await db.insert(committeeMembersTable).values({
          committeeId: cid, userId: spec.userId, role: spec.role,
          createdAt: TODAY_ISO,
        });
      }
    }

    // Charter document (idempotent on stable seed: id).
    const charterDocId = `seed:doc:committee:${c.slug}:charter`;
    const dex = await db.select().from(documentsTable).where(eq(documentsTable.id, charterDocId)).limit(1);
    if (!dex[0]) {
      const charterPdf = buildDemoPdf(
        `${c.name} — Charter`,
        "Quail Valley HOA Committee Charter",
        {
          "Committee": c.name,
          "Slug": c.slug,
          "Adopted": dateOnlyAgo(700),
          "Status": "Active",
        },
        c.charter,
      );
      const storageKey = await uploadPdfToStorage(`governance/charter-${c.slug}`, charterPdf);
      await db.insert(documentsTable).values({
        id: charterDocId,
        name: `${c.name} Charter.pdf`,
        category: "Bylaws",
        uploaded: dateOnlyAgo(700),
        size: "12 KB",
        uploadedBy: "Patricia Chair",
        storageKey: storageKey || null,
        documentDate: dateOnlyAgo(700),
        isHistorical: false,
        source: "original",
        notes: `seed:committee-charter:${c.slug}`,
      });
    }
  }
  const adoptedResolutionCount = motions.filter(m => m.kind === "resolution" && m.outcome === "adopted").length;
  log(`  ${meetings.length} meetings, ${motions.length} motions, ${adoptedResolutionCount} adopted resolutions, committees: ${committees.length} (with charters)`);
}

// ─────────────────────────────────────────────────────────────────────────
// Calendar: community events + trash holiday shifts + share token
// ─────────────────────────────────────────────────────────────────────────

async function seedCalendar(userIds: Map<string, number>) {
  log("Seeding calendar...");
  const adminId = userIds.get("demo.admin@quailvalleyhoa.demo") ?? null;
  // Ensure community sub-calendar
  const commSub = await ensureRow(
    calendarSubCalendarsTable,
    eq(calendarSubCalendarsTable.slug, "community"),
    {
      slug: "community", name: "Community", color: "#22a06b",
      description: "Community events and gatherings",
      editorRoles: ["admin", "manager"], viewerRoles: [], isPublic: true, sortOrder: 60,
    }
  );

  // Services sub-calendar — for recurring operational events (trash,
  // recycling, landscaping, pool service).
  const servicesSub = await ensureRow(
    calendarSubCalendarsTable,
    eq(calendarSubCalendarsTable.slug, "services"),
    {
      slug: "services", name: "Services", color: "#888fa1",
      description: "Recurring operational events (trash, recycling, etc.)",
      editorRoles: ["admin", "manager"], viewerRoles: [], isPublic: true, sortOrder: 70,
    }
  );

  // Weekly recurring trash & recycling events. Recurrence rule covers ~52
  // weeks. Idempotent on (subCalendarId, title).
  const weeklyServices = [
    { title: "Trash pickup", byday: ["TU", "FR"], startHour: 7 },
    { title: "Recycling pickup", byday: ["WE"], startHour: 8 },
  ];
  // Anchor the first occurrence at the next upcoming weekday so reruns hit
  // the same instant family. We compute a stable "next Monday" relative to
  // TODAY_DATE so the rule is deterministic.
  const todayDate = new Date(TODAY_DATE + "T00:00:00Z");
  const dayOfWeek = todayDate.getUTCDay(); // 0=Sun..6=Sat
  const daysUntilMon = ((1 - dayOfWeek) + 7) % 7;
  const anchorMon = new Date(todayDate);
  anchorMon.setUTCDate(anchorMon.getUTCDate() + daysUntilMon);
  for (const s of weeklyServices) {
    const ex = await db.select().from(calendarEventsTable)
      .where(and(eq(calendarEventsTable.title, s.title), eq(calendarEventsTable.subCalendarId, servicesSub.id))).limit(1);
    if (ex[0]) continue;
    const start = new Date(anchorMon);
    start.setUTCHours(s.startHour, 0, 0, 0);
    const end = new Date(start);
    end.setUTCHours(s.startHour + 1, 0, 0, 0);
    const until = new Date(start);
    until.setUTCDate(until.getUTCDate() + 364);
    await db.insert(calendarEventsTable).values({
      subCalendarId: servicesSub.id, title: s.title,
      body: `Weekly ${s.title.toLowerCase()} service.`,
      startsAt: start.toISOString(), endsAt: end.toISOString(),
      allDay: false, locationText: "Curbside",
      recurrence: { freq: "WEEKLY", interval: 1, byday: s.byday, until: until.toISOString().slice(0, 10) },
      createdByUserId: adminId, createdByName: "Demo Admin",
      createdAt: TODAY_ISO, updatedAt: TODAY_ISO,
    });
  }

  const events = [
    { title: "Pool opening day", days: 30, allDay: true, capacity: 200 },
    { title: "Community garage sale", days: 45, allDay: true, capacity: 0 },
    { title: "Movie night at clubhouse", days: 14, allDay: false, capacity: 60 },
    { title: "HOA volunteer day", days: 60, allDay: true, capacity: 50 },
    { title: "Halloween block party", days: 90, allDay: true, capacity: 300 },
    { title: "Holiday lights tour", days: 200, allDay: true, capacity: 0 },
  ];
  const eventIdsByTitle = new Map<string, number>();
  for (const e of events) {
    const ex = await db.select().from(calendarEventsTable)
      .where(and(eq(calendarEventsTable.title, e.title), eq(calendarEventsTable.subCalendarId, commSub.id))).limit(1);
    if (ex[0]) {
      eventIdsByTitle.set(e.title, ex[0].id);
      continue;
    }
    const start = e.allDay ? dateOnlyAhead(e.days) : daysAhead(e.days);
    const end = e.allDay ? dateOnlyAhead(e.days) : daysAhead(e.days + 0.125);
    const inserted = await db.insert(calendarEventsTable).values({
      subCalendarId: commSub.id, title: e.title, body: `Community event: ${e.title}`,
      startsAt: start, endsAt: end, allDay: e.allDay,
      locationText: "Quail Valley Clubhouse",
      capacity: e.capacity || null,
      createdByUserId: adminId, createdByName: "Demo Admin",
      createdAt: TODAY_ISO, updatedAt: TODAY_ISO,
    }).returning();
    eventIdsByTitle.set(e.title, inserted[0].id);
  }

  // RSVPs on a handful of community events. Idempotent on
  // (eventId, occurrenceKey, userId) — the unique index dedupes reruns.
  const rsvpPlan: Array<{
    title: string;
    rsvps: Array<{ email: string; status: "yes" | "no" | "maybe"; partySize?: number; unitId?: string | null }>;
  }> = [
    {
      title: "Pool opening day",
      rsvps: [
        { email: HERO_OWNER_EMAIL, status: "yes", partySize: 4, unitId: HERO_UNIT },
        { email: "demo.owner.b01-u03@example.invalid", status: "yes", partySize: 2, unitId: "B01-U03" },
        { email: "demo.tenant.b01-u03@example.invalid", status: "maybe", partySize: 1, unitId: "B01-U03" },
        { email: "demo.chair@quailvalleyhoa.demo", status: "yes", partySize: 2 },
      ],
    },
    {
      title: "Movie night at clubhouse",
      rsvps: [
        { email: HERO_OWNER_EMAIL, status: "yes", partySize: 3, unitId: HERO_UNIT },
        { email: "demo.boardmember@quailvalleyhoa.demo", status: "no" },
        { email: "demo.owner.b01-u03@example.invalid", status: "maybe", partySize: 2, unitId: "B01-U03" },
      ],
    },
    {
      title: "HOA volunteer day",
      rsvps: [
        { email: "demo.chair@quailvalleyhoa.demo", status: "yes" },
        { email: "demo.boardmember@quailvalleyhoa.demo", status: "yes" },
        { email: HERO_OWNER_EMAIL, status: "maybe", partySize: 1, unitId: HERO_UNIT },
        { email: "demo.tenant.b01-u03@example.invalid", status: "no", unitId: "B01-U03" },
      ],
    },
    {
      title: "Halloween block party",
      rsvps: [
        { email: HERO_OWNER_EMAIL, status: "yes", partySize: 4, unitId: HERO_UNIT },
        { email: "demo.owner.b01-u03@example.invalid", status: "yes", partySize: 3, unitId: "B01-U03" },
        { email: "demo.chair@quailvalleyhoa.demo", status: "yes", partySize: 2 },
        { email: "demo.boardmember@quailvalleyhoa.demo", status: "maybe", partySize: 2 },
      ],
    },
  ];
  let rsvpCount = 0;
  for (const plan of rsvpPlan) {
    const eventId = eventIdsByTitle.get(plan.title);
    if (!eventId) continue;
    for (const r of plan.rsvps) {
      const userId = userIds.get(r.email);
      if (!userId) continue;
      const persona = PERSONAS.find((p) => p.email === r.email);
      const ex = await db.select().from(calendarEventRsvpsTable)
        .where(and(
          eq(calendarEventRsvpsTable.eventId, eventId),
          eq(calendarEventRsvpsTable.occurrenceKey, ""),
          eq(calendarEventRsvpsTable.userId, userId),
        )).limit(1);
      if (ex[0]) continue;
      await db.insert(calendarEventRsvpsTable).values({
        eventId, occurrenceKey: "", userId,
        userName: persona?.name ?? r.email,
        status: r.status,
        partySize: r.partySize ?? 1,
        unitId: r.unitId ?? persona?.unitId ?? null,
        createdAt: TODAY_ISO, updatedAt: TODAY_ISO,
      });
      rsvpCount++;
    }
  }

  // Trash holiday shifts
  const holidays = [
    { date: dateOnlyAhead(60), label: "Thanksgiving", shift: 1 },
    { date: dateOnlyAhead(90), label: "Christmas", shift: 1 },
  ];
  for (const h of holidays) {
    const ex = await db.select().from(trashHolidayShiftsTable)
      .where(and(eq(trashHolidayShiftsTable.holidayDate, h.date), eq(trashHolidayShiftsTable.label, h.label))).limit(1);
    if (!ex[0]) {
      await db.insert(trashHolidayShiftsTable).values({
        holidayDate: h.date, label: h.label, shiftDays: h.shift,
        createdAt: TODAY_ISO,
      });
    }
  }

  // Share token
  const tokenStr = "seed-share-token-community-2026";
  const tex = await db.select().from(calendarShareTokensTable).where(eq(calendarShareTokensTable.token, tokenStr)).limit(1);
  if (!tex[0]) {
    await db.insert(calendarShareTokensTable).values({
      token: tokenStr, label: "Public community share",
      subCalendarSlugs: ["community"], createdAt: TODAY_ISO,
    });
  }
  log(`  ${events.length} community events, ${rsvpCount} RSVPs, ${holidays.length} holiday shifts`);
}

// ─────────────────────────────────────────────────────────────────────────
// Amenity bookings + pool chemistry + lifeguard windows
// ─────────────────────────────────────────────────────────────────────────

async function seedAmenities(userIds: Map<string, number>) {
  log("Seeding amenity data...");
  const heroId = userIds.get(HERO_OWNER_EMAIL);
  const adminId = userIds.get("demo.admin@quailvalleyhoa.demo") ?? 1;
  if (!heroId) return;
  // Make sure default amenities exist (clubhouse, pool, etc.).
  const { bootstrapAmenities } = await import("./lib/amenitiesBootstrap.js");
  await bootstrapAmenities();
  const amenities = await db.select().from(amenitiesTable);
  const clubhouse = amenities.find(a => a.slug === "clubhouse");
  const pool = amenities.find(a => a.slug === "pool_party");
  if (!clubhouse) {
    log("  no amenities found; skipping (run amenitiesBootstrap first)");
    return;
  }

  type BookingStatus = import("@workspace/db/schema").AmenityBookingStatus;
  const bookings: Array<{
    amenityId: number; daysOut: number; status: BookingStatus; purpose: string;
    durationHours: number; deposit: number;
  }> = [
    // Hero coverage: every booking status represented at least once.
    { amenityId: clubhouse.id, daysOut: 14, status: "confirmed", purpose: "seed:booking:hero-upcoming-clubhouse", durationHours: 4, deposit: 25000 },
    { amenityId: pool?.id ?? clubhouse.id, daysOut: -3, status: "used_pending_inspection", purpose: "seed:booking:hero-pool-recent", durationHours: 3, deposit: 15000 },
    { amenityId: clubhouse.id, daysOut: -30, status: "cancelled", purpose: "seed:booking:hero-cancelled", durationHours: 4, deposit: 25000 },
    { amenityId: clubhouse.id, daysOut: 30, status: "pending_payment", purpose: "seed:booking:hero-pending", durationHours: 5, deposit: 25000 },
    { amenityId: clubhouse.id, daysOut: -60, status: "used", purpose: "seed:booking:hero-completed", durationHours: 4, deposit: 25000 },
    { amenityId: clubhouse.id, daysOut: -120, status: "forfeited", purpose: "seed:booking:hero-forfeited", durationHours: 4, deposit: 25000 },
    { amenityId: clubhouse.id, daysOut: -200, status: "refunded", purpose: "seed:booking:hero-refunded", durationHours: 4, deposit: 25000 },
    // Booking with a damage report on it.
    { amenityId: clubhouse.id, daysOut: -90, status: "used", purpose: "seed:booking:hero-damaged", durationHours: 6, deposit: 25000 },
  ];
  const bookingRecords = new Map<string, number>();
  for (const b of bookings) {
    const ex = await db.select().from(amenityBookingsTable)
      .where(and(eq(amenityBookingsTable.purpose, b.purpose), eq(amenityBookingsTable.ownerUserId, heroId))).limit(1);
    if (ex[0]) {
      bookingRecords.set(b.purpose, ex[0].id);
      continue;
    }
    const startsAt = daysAhead(b.daysOut);
    const endsAt = new Date(new Date(startsAt).getTime() + b.durationHours * 3600_000).toISOString();
    const ins = await db.insert(amenityBookingsTable).values({
      amenityId: b.amenityId, ownerUserId: heroId, unitId: HERO_UNIT,
      startsAt, endsAt, guestCount: 12, purpose: b.purpose,
      status: b.status,
      depositCents: b.deposit, depositPaidAt: b.status === "pending_payment" ? null : daysAgo(b.daysOut > 0 ? 7 : 35),
      depositRefundedAt: b.status === "cancelled" || b.status === "refunded" ? daysAgo(28) : null,
      agreementSigned: true, agreementSignedAt: daysAgo(b.daysOut > 0 ? 7 : 35),
      agreementSignedName: HERO_OWNER_NAME,
      cancelledAt: b.status === "cancelled" ? daysAgo(28) : null,
      createdAt: TODAY_ISO, updatedAt: TODAY_ISO,
    }).returning();
    bookingRecords.set(b.purpose, ins[0].id);
    // Booking audit
    await db.insert(amenityBookingAuditTable).values({
      bookingId: ins[0].id, action: "created",
      actorUserId: heroId, actorName: HERO_OWNER_NAME,
      diff: { status: b.status }, createdAt: TODAY_ISO,
    });
  }

  // Pre/post inspections for the recent pool booking and the damaged booking.
  const inspectionTargets: Array<{ purpose: string; kind: "pre" | "post"; status: "draft" | "submitted" }> = [
    { purpose: "seed:booking:hero-pool-recent", kind: "pre", status: "submitted" },
    { purpose: "seed:booking:hero-pool-recent", kind: "post", status: "submitted" },
    { purpose: "seed:booking:hero-damaged", kind: "post", status: "submitted" },
  ];
  for (const t of inspectionTargets) {
    const bookingId = bookingRecords.get(t.purpose);
    if (!bookingId) continue;
    const ex = await db.select().from(amenityInspectionsTable)
      .where(and(eq(amenityInspectionsTable.bookingId, bookingId), eq(amenityInspectionsTable.kind, t.kind))).limit(1);
    if (ex[0]) continue;
    await db.insert(amenityInspectionsTable).values({
      bookingId, kind: t.kind, status: t.status,
      inspectorUserId: adminId, inspectorName: "Demo Admin", inspectorRole: "manager",
      notes: `seed:inspection:${t.kind}`,
      signature: "Demo Admin", performedAt: TODAY_ISO,
      createdAt: TODAY_ISO, updatedAt: TODAY_ISO,
    });
  }

  // Annual inspection (pool deck) — uses amenityAnnualInspectionsTable if present.
  // Damage report + dispute on the damaged booking.
  const damagedBookingId = bookingRecords.get("seed:booking:hero-damaged");
  if (damagedBookingId) {
    const drEx = await db.select().from(amenityDamageReportsTable)
      .where(eq(amenityDamageReportsTable.bookingId, damagedBookingId)).limit(1);
    let damageReportId: number;
    if (drEx[0]) damageReportId = drEx[0].id;
    else {
      const ins = await db.insert(amenityDamageReportsTable).values({
        bookingId: damagedBookingId, reportedByUserId: adminId,
        reportedByName: "Demo Admin", summary: "Stained carpet, broken folding chair",
        details: "seed:damage:report",
        estimatedCostCents: 18000, depositChargedCents: 18000,
        status: "charged",
        managerNotes: "Charged to deposit per amenity rules.",
        createdAt: TODAY_ISO, updatedAt: TODAY_ISO,
        resolvedAt: TODAY_ISO,
      }).returning();
      damageReportId = ins[0].id;
    }
    // Dispute from owner
    const dEx = await db.select().from(amenityDamageDisputesTable)
      .where(eq(amenityDamageDisputesTable.damageReportId, damageReportId)).limit(1);
    if (!dEx[0]) {
      await db.insert(amenityDamageDisputesTable).values({
        damageReportId, ownerUserId: heroId, ownerName: HERO_OWNER_NAME,
        message: "seed:damage:dispute — Carpet stains predated my booking.",
        status: "under_review",
        managerResponse: "Under review by ACC.",
        createdAt: TODAY_ISO, updatedAt: TODAY_ISO,
      });
    }
    // Deposit ledger entries
    type LedgerKind = import("@workspace/db/schema").AmenityDepositLedgerKind;
    const ledger: Array<{ kind: LedgerKind; amount: number; balance: number; reason: string }> = [
      { kind: "held", amount: 25000, balance: 25000, reason: "Deposit held at booking" },
      { kind: "charged", amount: -18000, balance: 7000, reason: "Damage report charge" },
      { kind: "refunded", amount: -7000, balance: 0, reason: "Remainder refunded" },
    ];
    for (const l of ledger) {
      const ex = await db.select().from(amenityDepositLedgerTable)
        .where(and(eq(amenityDepositLedgerTable.bookingId, damagedBookingId), eq(amenityDepositLedgerTable.kind, l.kind))).limit(1);
      if (ex[0]) continue;
      await db.insert(amenityDepositLedgerTable).values({
        bookingId: damagedBookingId, kind: l.kind,
        amountCents: l.amount, balanceCents: l.balance,
        reason: l.reason, damageReportId: l.kind === "charged" ? damageReportId : null,
        actorUserId: adminId, actorName: "Demo Admin", createdAt: TODAY_ISO,
      });
    }
  }

  // Pool chemistry — 30 days
  if (pool) {
    for (let d = 0; d < 30; d++) {
      const recordedAt = daysAgo(d);
      const memo = `seed:pool:${recordedAt.slice(0, 10)}`;
      const ex = await db.select().from(poolChemistryLogsTable)
        .where(eq(poolChemistryLogsTable.notes, memo)).limit(1);
      if (ex[0]) continue;
      const flagged = d === 5;
      await db.insert(poolChemistryLogsTable).values({
        recordedAt, recordedByName: "Demo Pool Tech",
        freeChlorinePpm: flagged ? 0.4 : 2.5,
        totalChlorinePpm: flagged ? 0.5 : 2.7,
        ph: flagged ? 8.2 : 7.4,
        alkalinityPpm: 100, calciumHardnessPpm: 250, cyanuricAcidPpm: 50,
        temperatureF: 82,
        notes: memo, flagged,
        flagReasons: flagged ? ["low_chlorine", "high_ph"] : [],
        createdAt: recordedAt,
      });
    }
  }

  // Lifeguard window + blackout
  if (pool) {
    const lwStart = daysAhead(7);
    const lwEnd = new Date(new Date(lwStart).getTime() + 4 * 3600_000).toISOString();
    const lwex = await db.select().from(amenityLifeguardWindowsTable)
      .where(and(eq(amenityLifeguardWindowsTable.amenityId, pool.id), eq(amenityLifeguardWindowsTable.staffName, "seed:lg:demo"))).limit(1);
    if (!lwex[0]) {
      await db.insert(amenityLifeguardWindowsTable).values({
        amenityId: pool.id, startsAt: lwStart, endsAt: lwEnd, staffName: "seed:lg:demo",
        createdAt: TODAY_ISO,
      });
    }
    const bex = await db.select().from(amenityBlackoutsTable)
      .where(and(eq(amenityBlackoutsTable.amenityId, pool.id), eq(amenityBlackoutsTable.reason, "seed:blackout:annual-cleaning"))).limit(1);
    if (!bex[0]) {
      await db.insert(amenityBlackoutsTable).values({
        amenityId: pool.id,
        startsAt: daysAhead(45), endsAt: daysAhead(48),
        reason: "seed:blackout:annual-cleaning", createdAt: TODAY_ISO,
      });
    }
  }

  // Expense entries
  type ExpenseKind = import("@workspace/db/schema").AmenityExpenseKind;
  const expenses: Array<[ExpenseKind, string, number]> = [
    ["cleaning", "Weekly clubhouse cleaning", 35000],
    ["supplies", "Pool chemicals — bulk order", 82000],
    ["maintenance", "Clubhouse HVAC repair", 124000],
    ["utilities", "Pool pump electricity (Q1)", 56000],
  ];
  for (const [kind, desc, amt] of expenses) {
    const ex = await db.select().from(amenityExpenseEntriesTable)
      .where(and(eq(amenityExpenseEntriesTable.amenityId, clubhouse.id), eq(amenityExpenseEntriesTable.description, desc))).limit(1);
    if (!ex[0]) {
      await db.insert(amenityExpenseEntriesTable).values({
        amenityId: clubhouse.id, occurredOn: dateOnlyAgo(10), kind,
        description: desc, amountCents: amt,
        createdByName: "seed:expense", createdAt: TODAY_ISO, updatedAt: TODAY_ISO,
      });
    }
  }

  log(`  ${bookings.length} bookings (all statuses), inspections+damage+disputes+ledger, 30d pool chemistry, expenses`);
}

// ─────────────────────────────────────────────────────────────────────────
// EV Charging
// ─────────────────────────────────────────────────────────────────────────

async function seedCharging(userIds: Map<string, number>) {
  log("Seeding EV charging...");
  const heroId = userIds.get(HERO_OWNER_EMAIL);
  if (!heroId) return;
  const amenities = await db.select().from(amenitiesTable);
  let evAmenity = amenities.find(a => a.slug === "ev_charging");
  if (!evAmenity) {
    const ins = await db.insert(amenitiesTable).values({
      slug: "ev_charging", name: "EV Charging", description: "EV charging ports",
      capacity: 4, bookingUnit: "hourly", depositCents: 0,
      rules: {}, agreementText: "", enabled: true, sortOrder: 80,
      createdAt: TODAY_ISO, updatedAt: TODAY_ISO,
    }).returning();
    evAmenity = ins[0];
  }
  const ports = [
    { name: "EV-1 (reserved)", mode: "reserved" as const, provider: "manual" as const },
    { name: "EV-2 (FCFS)", mode: "fcfs" as const, provider: "manual" as const },
    { name: "EV-3 (mixed)", mode: "reserved_fcfs" as const, provider: "manual" as const },
    { name: "EV-4 (OCPP)", mode: "reserved" as const, provider: "ocpp16" as const },
  ];
  const portIds: number[] = [];
  for (let i = 0; i < ports.length; i++) {
    const p = ports[i];
    const ex = await db.select().from(chargingPortsTable)
      .where(and(eq(chargingPortsTable.amenityId, evAmenity.id), eq(chargingPortsTable.name, p.name))).limit(1);
    let id: number;
    if (ex[0]) id = ex[0].id;
    else {
      const ins = await db.insert(chargingPortsTable).values({
        amenityId: evAmenity.id, name: p.name, location: `Lot B slot ${i + 1}`,
        connectorType: "J1772", maxKw: 7, mode: p.mode, provider: p.provider,
        providerConfig: p.provider === "ocpp16" ? { endpoint: "wss://ocpp.example/ev4", auth: "***masked***" } : {},
        perKwhCents: 35, idlePerMinuteCents: 40, idleGraceMinutes: 10, idleCapCents: 2000,
        enabled: true, sortOrder: i, createdAt: TODAY_ISO, updatedAt: TODAY_ISO,
      }).returning();
      id = ins[0].id;
    }
    portIds.push(id);
  }

  // Sessions for hero
  const portId = portIds[0];
  const sessions = [
    { start: daysAgo(0.05), end: null, status: "active" as const, kwh: "12.4", cost: 434 },
    { start: daysAgo(7), end: daysAgo(7).replace(/T.*/, "T22:00:00.000Z"), status: "billed" as const, kwh: "32.1", cost: 1124 },
    { start: daysAgo(20), end: daysAgo(20).replace(/T.*/, "T22:00:00.000Z"), status: "refunded" as const, kwh: "8.0", cost: 0 },
  ];
  for (const s of sessions) {
    const tag = `seed:session:hero:${s.status}`;
    const ex = await db.select().from(chargingSessionsTable)
      .where(and(eq(chargingSessionsTable.ownerUserId, heroId), eq(chargingSessionsTable.refundReason, tag))).limit(1);
    if (ex[0]) continue;
    await db.insert(chargingSessionsTable).values({
      portId, ownerUserId: heroId, unitId: HERO_UNIT,
      startAt: s.start, endAt: s.end,
      kwh: s.kwh, costCents: s.cost,
      status: s.status, refundReason: tag,
      createdAt: TODAY_ISO, updatedAt: TODAY_ISO,
    });
  }
  // Charging reservations covering each status.
  type ResvStatus = import("@workspace/db/schema").ChargingReservationStatus;
  const reservations: Array<{ port: number; daysOut: number; status: ResvStatus; tag: string }> = [
    { port: 0, daysOut: 2, status: "pending", tag: "seed:resv:hero-upcoming" },
    { port: 0, daysOut: 0, status: "active", tag: "seed:resv:hero-active" },
    { port: 0, daysOut: -3, status: "completed", tag: "seed:resv:hero-completed" },
    { port: 1, daysOut: -10, status: "cancelled", tag: "seed:resv:hero-cancelled" },
    { port: 1, daysOut: -20, status: "no_show", tag: "seed:resv:hero-noshow" },
  ];
  for (const r of reservations) {
    // Idempotency key: (portId, ownerUserId, status) — each hero status appears
    // exactly once, so this is stable across runs regardless of wall-clock time.
    const ex = await db.select().from(chargingReservationsTable)
      .where(and(
        eq(chargingReservationsTable.portId, portIds[r.port]),
        eq(chargingReservationsTable.ownerUserId, heroId),
        eq(chargingReservationsTable.status, r.status),
      )).limit(1);
    if (ex[0]) continue;
    const startsAt = daysAhead(r.daysOut);
    const endsAt = new Date(new Date(startsAt).getTime() + 2 * 3600_000).toISOString();
    await db.insert(chargingReservationsTable).values({
      portId: portIds[r.port], ownerUserId: heroId, unitId: HERO_UNIT,
      startsAt, endsAt, status: r.status,
      cancelledAt: r.status === "cancelled" ? daysAgo(10) : null,
      createdAt: TODAY_ISO, updatedAt: TODAY_ISO,
    });
  }
  log(`  ${ports.length} charging ports, ${sessions.length} hero sessions, ${reservations.length} reservations (all statuses)`);
}

// ─────────────────────────────────────────────────────────────────────────
// Guest parking permits + vehicles
// ─────────────────────────────────────────────────────────────────────────

async function seedGuestParking(userIds: Map<string, number>) {
  log("Seeding guest parking + vehicles...");
  const heroId = userIds.get(HERO_OWNER_EMAIL);
  const adminId = userIds.get("demo.admin@quailvalleyhoa.demo") ?? 1;
  if (!heroId) return;
  // settings (singleton) — overwrite each run so demo always has the right policy.
  const settingsEx = await db.select().from(guestParkingSettingsTable).limit(1);
  // 2 nights/unit nightly cap matches realistic HOA guest parking policy.
  const config = {
    perUnitNightlyCap: 2, rollingWindowDays: 30, maxConsecutiveNights: 7,
    maxAdvanceDays: 30, requireAccountCurrent: true,
    requireNoOpenViolations: true, excludeRegisteredVehicles: true,
    agreementText: "Guest agrees to obey community parking rules.",
  };
  if (settingsEx[0]) {
    await db.update(guestParkingSettingsTable)
      .set({ config, updatedAt: TODAY_ISO })
      .where(eq(guestParkingSettingsTable.id, settingsEx[0].id));
  } else {
    await db.insert(guestParkingSettingsTable).values({ config, updatedAt: TODAY_ISO });
  }

  type ParkingStatus = import("@workspace/db/schema").GuestParkingPermitStatus;
  const permits: Array<{ unit: string; owner: number; plate: string; guest: string; status: ParkingStatus; startsOffset: number; nights: number }> = [
    { unit: HERO_UNIT, owner: heroId, plate: "DLY-2026", guest: "Demo Guest A", status: "active", startsOffset: -1, nights: 3 },
    { unit: "B02-U01", owner: heroId, plate: "JK-1138", guest: "Demo Guest B", status: "active", startsOffset: 0, nights: 2 },
    { unit: "B03-U03", owner: heroId, plate: "BL-7720", guest: "Demo Guest C", status: "active", startsOffset: 2, nights: 4 },
    { unit: "B05-U03", owner: heroId, plate: "OLD-2025", guest: "Demo Guest D", status: "expired", startsOffset: -45, nights: 2 },
    { unit: "B06-U02", owner: heroId, plate: "OLD-2024", guest: "Demo Guest E", status: "expired", startsOffset: -90, nights: 3 },
    { unit: "B07-U03", owner: heroId, plate: "TOW-9919", guest: "Demo Guest F (towed)", status: "expired", startsOffset: -180, nights: 1 },
    { unit: "B08-U01", owner: heroId, plate: "CXL-4421", guest: "Demo Guest G", status: "cancelled", startsOffset: -10, nights: 2 },
  ];
  let seq = 1000;
  for (const p of permits) {
    const permitNumber = `seed:GP-2026-${String(seq).padStart(4, "0")}`;
    const ex = await db.select().from(guestParkingPermitsTable).where(eq(guestParkingPermitsTable.permitNumber, permitNumber)).limit(1);
    if (ex[0]) { seq++; continue; }
    const startsOn = dateOnlyAhead(p.startsOffset);
    const endsOn = dateOnlyAhead(p.startsOffset + p.nights - 1);
    await db.insert(guestParkingPermitsTable).values({
      unitId: p.unit, ownerUserId: p.owner,
      permitNumber, numberYear: 2026, numberSeq: seq,
      startsOn, endsOn, nights: p.nights, guestName: p.guest,
      plate: p.plate, plateState: "TX",
      vehicleMake: "Toyota", vehicleModel: "Camry", vehicleColor: "Silver",
      status: p.status,
      qrToken: `seed-qr-${seq}`,
      createdAt: TODAY_ISO, updatedAt: TODAY_ISO,
    });
    seq++;
  }

  // Patrol audit lookups — covers permitted, unregistered, and the towed result.
  const lookups: Array<{ plate: string; result: string; permitSeq: number | null; unitId: string | null; notes: string }> = [
    { plate: "DLY-2026", result: "permitted", permitSeq: 1000, unitId: HERO_UNIT, notes: "Active permit verified" },
    { plate: "OLD-2025", result: "expired", permitSeq: 1003, unitId: "B05-U03", notes: "Permit expired; warning issued" },
    { plate: "TOW-9919", result: "expired", permitSeq: 1005, unitId: "B07-U03", notes: "TOWED — vehicle relocated to impound lot per policy 3.2" },
    { plate: "UNK-0001", result: "unregistered", permitSeq: null, unitId: null, notes: "No permit found — patrol left warning" },
    { plate: "TXP-DYL1", result: "registered_resident", permitSeq: null, unitId: HERO_UNIT, notes: "Resident vehicle on file" },
  ];
  for (const l of lookups) {
    const lookupTag = `seed:lookup:${l.plate}:${l.result}`;
    const ex = await db.select().from(guestParkingLookupsTable)
      .where(eq(guestParkingLookupsTable.notes, l.notes)).limit(1);
    if (ex[0]) continue;
    let permitId: number | null = null;
    if (l.permitSeq != null) {
      const pn = `seed:GP-2026-${String(l.permitSeq).padStart(4, "0")}`;
      const p = await db.select().from(guestParkingPermitsTable)
        .where(eq(guestParkingPermitsTable.permitNumber, pn)).limit(1);
      permitId = p[0]?.id ?? null;
    }
    await db.insert(guestParkingLookupsTable).values({
      query: l.plate, plate: l.plate, result: l.result,
      permitId, unitId: l.unitId,
      patrolUserId: adminId, patrolName: "Patrol Officer (demo)",
      notes: l.notes, createdAt: daysAgo(Math.abs(l.plate.charCodeAt(0)) % 30),
    });
  }

  // Hero vehicle
  const vex = await db.select().from(unitVehiclesTable)
    .where(and(eq(unitVehiclesTable.unitId, HERO_UNIT), eq(unitVehiclesTable.plate, "TXP-DYL1"))).limit(1);
  if (!vex[0]) {
    await db.insert(unitVehiclesTable).values({
      unitId: HERO_UNIT, plate: "TXP-DYL1", state: "TX",
      make: "Honda", model: "Accord", color: "Charcoal",
      notes: "seed:vehicle:hero-primary",
      createdAt: TODAY_ISO, updatedAt: TODAY_ISO,
    });
  }
  log(`  ${permits.length} guest permits + hero vehicle`);
}

// ─────────────────────────────────────────────────────────────────────────
// Packages + mail holds
// ─────────────────────────────────────────────────────────────────────────

async function seedPackages(userIds: Map<string, number>) {
  log("Seeding packages + mail holds...");
  const heroId = userIds.get(HERO_OWNER_EMAIL);
  if (!heroId) return;
  // Locker
  let locker = (await db.select().from(packageLockersTable)
    .where(and(eq(packageLockersTable.bankSlug, "default"), eq(packageLockersTable.bay, "A1"))).limit(1))[0];
  if (!locker) {
    const ins = await db.insert(packageLockersTable).values({
      bankSlug: "default", bay: "A1", size: "medium", createdAt: TODAY_ISO,
    }).returning();
    locker = ins[0];
  }

  const packages = [
    { unit: HERO_UNIT, recipient: HERO_OWNER_NAME, recipientUserId: heroId, carrier: "Amazon" as const, status: "received" as const, code: "seed-pkg-hero-001" },
    { unit: HERO_UNIT, recipient: HERO_OWNER_NAME, recipientUserId: heroId, carrier: "UPS" as const, status: "picked_up" as const, code: "seed-pkg-hero-002" },
    { unit: "B02-U01", recipient: "Kevin Martin", recipientUserId: null, carrier: "FedEx" as const, status: "in_locker" as const, code: "seed-pkg-002" },
    { unit: "B03-U03", recipient: "Anthony Murray", recipientUserId: null, carrier: "USPS" as const, status: "stale" as const, code: "seed-pkg-003" },
    { unit: "B05-U03", recipient: "Nicholas Wright", recipientUserId: null, carrier: "USPS" as const, status: "return_to_sender" as const, code: "seed-pkg-004" },
  ];
  for (const p of packages) {
    const ex = await db.select().from(packagesTable).where(eq(packagesTable.pickupCode, p.code)).limit(1);
    if (ex[0]) continue;
    const ins = await db.insert(packagesTable).values({
      unitId: p.unit, recipientUserId: p.recipientUserId, recipientName: p.recipient,
      carrier: p.carrier, trackingNumber: `1Z${p.code}`,
      pickupCode: p.code, qrPayload: `qr:${p.code}`,
      lockerId: p.status === "in_locker" ? locker.id : null,
      lockerPin: p.status === "in_locker" ? "4421" : null,
      status: p.status,
      pickedUpAt: p.status === "picked_up" ? daysAgo(2) : null,
      pickedUpByName: p.status === "picked_up" ? p.recipient : "",
      pickedUpByUserId: p.status === "picked_up" ? p.recipientUserId : null,
      intakeByName: "Demo Front Desk",
      staleAt: p.status === "stale" ? daysAgo(20) : null,
      rtsAt: p.status === "return_to_sender" ? daysAgo(45) : null,
      createdAt: daysAgo(15), updatedAt: TODAY_ISO,
    }).returning();
    await db.insert(packageAuditTable).values({
      packageId: ins[0].id, action: "intake",
      actorName: "Demo Front Desk", createdAt: daysAgo(15),
    });
  }

  // Mail hold for B01-U01 (vacation)
  const mhEx = await db.select().from(mailHoldWindowsTable)
    .where(and(eq(mailHoldWindowsTable.unitId, HERO_UNIT), eq(mailHoldWindowsTable.note, "seed:hold:vacation"))).limit(1);
  if (!mhEx[0]) {
    await db.insert(mailHoldWindowsTable).values({
      unitId: HERO_UNIT, startsOn: dateOnlyAhead(10), endsOn: dateOnlyAhead(18),
      note: "seed:hold:vacation", createdAt: TODAY_ISO,
    });
  }
  log(`  ${packages.length} packages + 1 mail hold`);
}

// ─────────────────────────────────────────────────────────────────────────
// Pets + dog park agreements
// ─────────────────────────────────────────────────────────────────────────

async function seedPets(userIds: Map<string, number>) {
  log("Seeding pets...");
  const heroId = userIds.get(HERO_OWNER_EMAIL);
  if (!heroId) return;
  type PetSpecies = import("@workspace/db/schema").PetSpecies;
  type PetStatus = import("@workspace/db/schema").PetStatus;
  const petList: Array<{ unit: string; name: string; species: PetSpecies; breed: string; weight: number; status: PetStatus; vacExpires: string }> = [
    { unit: HERO_UNIT, name: "Biscuit", species: "dog", breed: "Golden Retriever", weight: 65, status: "compliant", vacExpires: dateOnlyAhead(180) },
    { unit: HERO_UNIT, name: "Mittens", species: "cat", breed: "Domestic Shorthair", weight: 11, status: "expiring_soon", vacExpires: dateOnlyAhead(14) },
    { unit: "B01-U03", name: "Cooper", species: "dog", breed: "Labrador", weight: 70, status: "compliant", vacExpires: dateOnlyAhead(220) },
    { unit: "B02-U01", name: "Luna", species: "dog", breed: "Beagle", weight: 25, status: "compliant", vacExpires: dateOnlyAhead(150) },
    { unit: "B03-U03", name: "Whiskers", species: "cat", breed: "Maine Coon", weight: 14, status: "compliant", vacExpires: dateOnlyAhead(360) },
    { unit: "B05-U03", name: "Rex", species: "dog", breed: "German Shepherd", weight: 80, status: "suspended", vacExpires: dateOnlyAgo(60) },
    { unit: "B06-U02", name: "Bella", species: "dog", breed: "Poodle Mix", weight: 35, status: "compliant", vacExpires: dateOnlyAhead(280) },
    { unit: "B07-U03", name: "Charlie", species: "dog", breed: "Corgi", weight: 28, status: "compliant", vacExpires: dateOnlyAhead(190) },
  ];
  for (const p of petList) {
    const ex = await db.select().from(petsTable)
      .where(and(eq(petsTable.unitId, p.unit), eq(petsTable.name, p.name))).limit(1);
    let petId: number;
    if (ex[0]) { petId = ex[0].id; }
    else {
      const ins = await db.insert(petsTable).values({
        unitId: p.unit, filedByUserId: heroId, filedByName: HERO_OWNER_NAME,
        name: p.name, species: p.species, breed: p.breed,
        weightLbs: p.weight, sex: "unknown", spayedNeutered: true,
        notes: "seed:pet",
        status: p.status,
        approvalState: "approved", approvedAt: TODAY_ISO,
        createdAt: TODAY_ISO, updatedAt: TODAY_ISO,
      }).returning();
      petId = ins[0].id;
    }
    // Vaccination
    const vex = await db.select().from(petVaccinationsTable)
      .where(and(eq(petVaccinationsTable.petId, petId), eq(petVaccinationsTable.vaccineType, "rabies"))).limit(1);
    if (!vex[0]) {
      await db.insert(petVaccinationsTable).values({
        petId, vaccineType: "rabies",
        administeredOn: dateOnlyAgo(180), expiresOn: p.vacExpires,
        notes: "seed:vac",
        uploadedByName: HERO_OWNER_NAME, createdAt: TODAY_ISO,
      });
    }
  }

  // Dog park agreements (4 units)
  for (const u of [HERO_UNIT, "B02-U01", "B03-U03", "B07-U03"]) {
    const ex = await db.select().from(petDogparkAgreementsTable)
      .where(and(eq(petDogparkAgreementsTable.unitId, u), eq(petDogparkAgreementsTable.signedByName, "seed:dogpark"))).limit(1);
    if (!ex[0]) {
      await db.insert(petDogparkAgreementsTable).values({
        unitId: u, signedByUserId: heroId,
        signedByName: "seed:dogpark", agreementText: "Dog park rules — seeded.",
        signedAt: daysAgo(30), expiresAt: daysAhead(335),
      });
    }
  }
  log(`  ${petList.length} pets + 4 dog park agreements`);
}

// ─────────────────────────────────────────────────────────────────────────
// Fobs + pool tags
// ─────────────────────────────────────────────────────────────────────────

async function seedFobsAndTags(userIds: Map<string, number>) {
  log("Seeding fobs + pool tags...");
  const heroId = userIds.get(HERO_OWNER_EMAIL);
  if (!heroId) return;
  // 60 fobs
  for (let i = 1; i <= 60; i++) {
    const serial = `seed-fob-${String(i).padStart(4, "0")}`;
    const ex = await db.select().from(fobInventoryTable).where(eq(fobInventoryTable.serial, serial)).limit(1);
    if (ex[0]) continue;
    const status = i <= 30 ? "assigned" : i === 59 ? "lost" : i === 60 ? "lost" : "available";
    await db.insert(fobInventoryTable).values({
      serial, status,
      notes: "seed:fob", createdAt: TODAY_ISO, updatedAt: TODAY_ISO,
    });
  }
  // Assign fob #1 to hero
  const heroFob = (await db.select().from(fobInventoryTable).where(eq(fobInventoryTable.serial, "seed-fob-0001")).limit(1))[0];
  if (heroFob) {
    const aex = await db.select().from(fobAssignmentsTable)
      .where(and(eq(fobAssignmentsTable.fobId, heroFob.id), eq(fobAssignmentsTable.unitId, HERO_UNIT))).limit(1);
    if (!aex[0]) {
      await db.insert(fobAssignmentsTable).values({
        fobId: heroFob.id, unitId: HERO_UNIT,
        assignedToUserId: heroId, assignedToName: HERO_OWNER_NAME,
        assignedAt: daysAgo(120),
      });
    }
  }

  // Pool tags for ~20 units
  const units = await db.select().from(unitsTable).limit(20);
  for (const u of units) {
    const ex = await db.select().from(poolTagsTable)
      .where(and(eq(poolTagsTable.unitId, u.id), eq(poolTagsTable.suspendedReason, "seed:pooltag"))).limit(1);
    if (ex[0]) continue;
    const isSuspendedDelinquent = u.id === "B04-U02";
    await db.insert(poolTagsTable).values({
      unitId: u.id, residentUserId: u.id === HERO_UNIT ? heroId : null,
      residentName: u.ownerName,
      expiresAt: dateOnlyAhead(300),
      status: isSuspendedDelinquent ? "suspended" : "active",
      suspendedReason: "seed:pooltag",
      issuedAt: daysAgo(60), updatedAt: TODAY_ISO,
    });
  }
  log("  60 fobs + 20 pool tags");
}

// ─────────────────────────────────────────────────────────────────────────
// Violations + compliance items
// ─────────────────────────────────────────────────────────────────────────

async function seedViolationsAndCompliance(userIds: Map<string, number>) {
  log("Seeding violations + compliance items...");
  const heroId = userIds.get(HERO_OWNER_EMAIL);
  if (!heroId) return;
  const violations = [
    { unit: HERO_UNIT, owner: heroId, ownerName: HERO_OWNER_NAME, cat: "trash", status: "resolved", desc: "Trash bin left out past pickup day", days: 60, fine: 0 },
    { unit: "B02-U01", owner: heroId, ownerName: "Kevin Martin", cat: "landscaping", status: "first_notice", desc: "Overgrown lawn", days: 12, fine: 0 },
    { unit: "B03-U03", owner: heroId, ownerName: "Anthony Murray", cat: "parking", status: "second_notice", desc: "Unregistered vehicle", days: 35, fine: 5000 },
    { unit: "B04-U04", owner: heroId, ownerName: "Christina Chavez", cat: "architectural", status: "hearing", desc: "Unapproved fence color", days: 50, fine: 10000 },
    { unit: "B05-U03", owner: heroId, ownerName: "Nicholas Wright", cat: "nuisance", status: "fined", desc: "Repeated noise", days: 40, fine: 15000 },
    { unit: "B06-U02", owner: heroId, ownerName: "Jack Washington", cat: "trash", status: "dismissed", desc: "Reported in error", days: 90, fine: 0 },
    { unit: "B07-U03", owner: heroId, ownerName: "Arthur Cole", cat: "landscaping", status: "open", desc: "Dead shrubs along walkway", days: 5, fine: 0 },
    { unit: "B08-U01", owner: heroId, ownerName: "Gloria Jenkins", cat: "parking", status: "resolved", desc: "Boat parked in driveway >72hr", days: 120, fine: 5000 },
  ];
  for (const v of violations) {
    const desc = `seed:viol:${v.unit}:${v.cat}`;
    const ex = await db.select().from(violationsTable)
      .where(and(eq(violationsTable.unitId, v.unit), eq(violationsTable.description, desc))).limit(1);
    if (ex[0]) continue;
    await db.insert(violationsTable).values({
      unitId: v.unit, ownerUserId: v.owner, ownerName: v.ownerName,
      category: v.cat, description: desc,
      status: v.status, observedAt: daysAgo(v.days),
      firstNoticeDate: v.status !== "open" ? dateOnlyAgo(v.days - 2) : null,
      cureDeadline: dateOnlyAhead(7),
      resolvedAt: v.status === "resolved" || v.status === "dismissed" ? daysAgo(v.days - 14) : null,
      fineCents: v.fine,
      createdAt: TODAY_ISO, updatedAt: TODAY_ISO,
    });
  }

  // Compliance items
  const items = [
    { kind: "tax", title: "Federal 1120-H filing", days: 90 },
    { kind: "audit", title: "Annual financial audit", days: 120 },
    { kind: "insurance", title: "Master policy renewal", days: 60 },
    { kind: "regulatory", title: "Texas POAA annual report", days: 200 },
    { kind: "bank_recon", title: "Monthly bank reconciliation", days: 5 },
    { kind: "other", title: "Reserve study refresh", days: 365 },
  ];
  for (const i of items) {
    const ex = await db.select().from(complianceItemsTable)
      .where(eq(complianceItemsTable.title, i.title)).limit(1);
    if (ex[0]) continue;
    await db.insert(complianceItemsTable).values({
      kind: i.kind, title: i.title, description: `seed:compliance ${i.title}`,
      dueDate: dateOnlyAhead(i.days), status: "open",
      createdAt: TODAY_ISO, updatedAt: TODAY_ISO,
    });
  }
  log(`  ${violations.length} violations, ${items.length} compliance items`);
}

// ─────────────────────────────────────────────────────────────────────────
// Documents (≥12 for B01-U01 with placeholder PDFs)
// ─────────────────────────────────────────────────────────────────────────

async function seedDocuments(userIds: Map<string, number>, vendorIds: Map<string, number>) {
  log("Seeding documents (with placeholder PDFs)...");
  const adminId = userIds.get("demo.admin@quailvalleyhoa.demo") ?? 1;

  // Import batches (idempotent on id)
  const heroBatchId = "seed:batch:B01-U01-binder-2026";
  const heroBatchEx = await db.select().from(documentImportBatchesTable).where(eq(documentImportBatchesTable.id, heroBatchId)).limit(1);
  if (!heroBatchEx[0]) {
    await db.insert(documentImportBatchesTable).values({
      id: heroBatchId, label: "B01-U01 binder digitization 2026",
      status: "committed", fileCount: 4, defaultCategory: "Inspection",
      defaultBuilding: 1, defaultUnit: HERO_UNIT,
      defaultSource: "scanned", defaultIsHistorical: true,
      createdBy: adminId, createdByName: "Demo Admin", createdAt: TODAY_ISO,
    });
  }
  const archiveBatchId = "seed:batch:community-archive-2026";
  const archiveBatchEx = await db.select().from(documentImportBatchesTable).where(eq(documentImportBatchesTable.id, archiveBatchId)).limit(1);
  if (!archiveBatchEx[0]) {
    await db.insert(documentImportBatchesTable).values({
      id: archiveBatchId, label: "Community archive 2014–2023 digitization 2026",
      status: "committed", fileCount: 30, defaultCategory: "Bylaws",
      defaultBuilding: null, defaultUnit: null,
      defaultSource: "scanned", defaultIsHistorical: true,
      createdBy: adminId, createdByName: "Demo Admin", createdAt: TODAY_ISO,
    });
  }

  const docs: Array<{
    id: string; name: string; category: string; building?: number | null; unit?: string | null;
    documentDate?: string; isHistorical?: boolean; source?: string; importBatchId?: string | null;
    notes?: string; vendorId?: number | null;
  }> = [
    // ≥12 hero unit docs
    { id: "seed:doc:B01-U01:welcome", name: "HOA Welcome Packet.pdf", category: "Bylaws", building: 1, unit: HERO_UNIT, documentDate: dateOnlyAgo(700), source: "original", notes: "Welcome packet" },
    { id: "seed:doc:B01-U01:insurance-binder", name: "Insurance binder excerpt 2026.pdf", category: "Insurance", building: 1, unit: HERO_UNIT, documentDate: dateOnlyAgo(60), source: "original" },
    { id: "seed:doc:B01-U01:roof-2017", name: "Roof inspection 2017.pdf", category: "Inspection", building: 1, unit: HERO_UNIT, documentDate: "2017-05-15", isHistorical: true, source: "scanned", importBatchId: heroBatchId },
    { id: "seed:doc:B01-U01:roof-2019-invoice", name: "Roof repair invoice 2019.pdf", category: "Vendor", building: 1, unit: HERO_UNIT, documentDate: "2019-04-22", isHistorical: true, source: "vendor", importBatchId: heroBatchId },
    { id: "seed:doc:B01-U01:plumb-2021-scope", name: "Plumbing scope 2021.pdf", category: "Vendor", building: 1, unit: HERO_UNIT, documentDate: "2021-07-08", isHistorical: true, source: "vendor", importBatchId: heroBatchId },
    { id: "seed:doc:B01-U01:acc-current", name: "Front door ACC submission 2026.pdf", category: "Bylaws", building: 1, unit: HERO_UNIT, documentDate: dateOnlyAgo(8), source: "original" },
    { id: "seed:doc:B01-U01:acc-historical", name: "Storm door ACC submission 2024.pdf", category: "Bylaws", building: 1, unit: HERO_UNIT, documentDate: "2024-08-15", isHistorical: true, source: "scanned", importBatchId: heroBatchId },
    { id: "seed:doc:B01-U01:prior-mgmt-1", name: "Prior management correspondence 2018.pdf", category: "Meeting", building: 1, unit: HERO_UNIT, documentDate: "2018-03-10", isHistorical: true, source: "prior_mgmt" },
    { id: "seed:doc:B01-U01:prior-mgmt-2", name: "Prior management correspondence 2020.pdf", category: "Meeting", building: 1, unit: HERO_UNIT, documentDate: "2020-09-22", isHistorical: true, source: "prior_mgmt" },
    { id: "seed:doc:B01-U01:prior-mgmt-3", name: "Prior management correspondence 2022.pdf", category: "Meeting", building: 1, unit: HERO_UNIT, documentDate: "2022-11-04", isHistorical: true, source: "prior_mgmt" },
    { id: "seed:doc:B01-U01:financial-2025", name: "Year-end statement 2025.pdf", category: "Financial", building: 1, unit: HERO_UNIT, documentDate: "2026-01-30", source: "original" },
    { id: "seed:doc:B01-U01:board-ratification", name: "Board ratification letter — storm door 2024.pdf", category: "Meeting", building: 1, unit: HERO_UNIT, documentDate: "2024-09-01", source: "original" },
    // Community-wide / building-level docs
    { id: "seed:doc:bylaws", name: "Quail Valley Bylaws 2014.pdf", category: "Bylaws", documentDate: "2014-06-15", isHistorical: true, source: "scanned", importBatchId: archiveBatchId },
    { id: "seed:doc:ccr", name: "CC&Rs amended 2018.pdf", category: "Bylaws", documentDate: "2018-10-01", source: "original" },
    { id: "seed:doc:budget-2026", name: "2026 Operating Budget.pdf", category: "Financial", documentDate: dateOnlyAgo(45), source: "original" },
    { id: "seed:doc:reserve-2024", name: "Reserve Study 2024.pdf", category: "Financial", documentDate: "2024-04-12", source: "original" },
    // Insurance declaration page PDFs — one per building (master policy
    // applies to the whole community, but each building gets a copy linked
    // for owner self-service).
    { id: "seed:doc:insurance:declaration-2026", name: "Insurance — Declaration page 2026.pdf", category: "Insurance", documentDate: dateOnlyAgo(60), source: "original", notes: "Master policy declaration page" },
    { id: "seed:doc:insurance:declaration-2025", name: "Insurance — Declaration page 2025.pdf", category: "Insurance", documentDate: "2025-02-01", isHistorical: true, source: "scanned", notes: "Prior year declaration" },
    { id: "seed:doc:insurance:flood-2026", name: "Insurance — Flood declaration 2026.pdf", category: "Insurance", documentDate: dateOnlyAgo(60), source: "original" },
    { id: "seed:doc:insurance:umbrella-2026", name: "Insurance — Umbrella liability declaration 2026.pdf", category: "Insurance", documentDate: dateOnlyAgo(60), source: "original" },
    // Per-building copies of the master declaration page so the building-
    // scoped documents library and owner self-service surfaces them.
    { id: "seed:doc:bldg1:insurance-declaration-2026", name: "Insurance — Declaration page 2026.pdf", category: "Insurance", building: 1, documentDate: dateOnlyAgo(60), source: "original", notes: "Master policy declaration page (Bldg 1 copy)" },
    { id: "seed:doc:bldg2:insurance-declaration-2026", name: "Insurance — Declaration page 2026.pdf", category: "Insurance", building: 2, documentDate: dateOnlyAgo(60), source: "original", notes: "Master policy declaration page (Bldg 2 copy)" },
  ];
  // Building-scoped historical docs (10 buildings × 3 docs)
  for (let b = 1; b <= 10; b++) {
    docs.push(
      {
        id: `seed:doc:bldg${b}:hist-roof-2018`,
        name: `Building ${b} roof inspection 2018.pdf`,
        category: "Inspection", building: b,
        documentDate: `2018-0${1 + (b % 8)}-15`, isHistorical: true, source: "scanned",
        importBatchId: archiveBatchId,
      },
      {
        id: `seed:doc:bldg${b}:fire-2022`,
        name: `Building ${b} fire-system inspection 2022.pdf`,
        category: "Inspection", building: b,
        documentDate: `2022-0${1 + (b % 8)}-12`, isHistorical: true, source: "vendor",
        importBatchId: archiveBatchId,
      },
      {
        id: `seed:doc:bldg${b}:reserve-walk-2023`,
        name: `Building ${b} reserve walkthrough 2023.pdf`,
        category: "Financial", building: b,
        documentDate: `2023-0${1 + (b % 8)}-20`, isHistorical: true, source: "scanned",
        importBatchId: archiveBatchId,
      },
    );
  }
  // Per-unit owner binders (one doc per unit) — keeps every unit's profile
  // looking populated and pushes total > 120 docs.
  const allUnits = await db.select().from(unitsTable);
  for (const u of allUnits) {
    if (u.id === HERO_UNIT) continue;
    docs.push({
      id: `seed:doc:${u.id}:welcome-binder`,
      name: `${u.id} welcome binder.pdf`,
      category: "Bylaws", building: u.building, unit: u.id,
      documentDate: dateOnlyAgo(540), source: "original",
    });
  }
  // Vendor COI / W-9 / contract docs for every active vendor — linked via
  // vendorId so the vendor file room (which queries documents by vendor_id)
  // surfaces them.
  for (const v of SEED_VENDORS) {
    const vid = vendorIds.get(v.name) ?? null;
    docs.push({
      id: `seed:doc:vendor:${v.email}:coi`,
      name: `${v.name} — Certificate of Insurance.pdf`,
      category: "Vendor",
      documentDate: v.coiExpiresOn ?? dateOnlyAhead(120),
      source: "vendor", vendorId: vid,
    });
    if (v.hasW9) {
      docs.push({
        id: `seed:doc:vendor:${v.email}:w9`,
        name: `${v.name} — W-9.pdf`,
        category: "Vendor", documentDate: dateOnlyAgo(30), source: "vendor",
        vendorId: vid,
      });
    }
    docs.push({
      id: `seed:doc:vendor:${v.email}:contract`,
      name: `${v.name} — Service agreement.pdf`,
      category: "Vendor", documentDate: dateOnlyAgo(180), source: "vendor",
      vendorId: vid,
    });
  }
  // Update the archive batch fileCount to reflect the actual mix.
  const archiveDocCount = docs.filter(d => d.importBatchId === archiveBatchId).length;
  await db.update(documentImportBatchesTable)
    .set({ fileCount: archiveDocCount })
    .where(eq(documentImportBatchesTable.id, archiveBatchId));
  const heroDocCount = docs.filter(d => d.importBatchId === heroBatchId).length;
  await db.update(documentImportBatchesTable)
    .set({ fileCount: heroDocCount })
    .where(eq(documentImportBatchesTable.id, heroBatchId));

  for (const d of docs) {
    const ex = await db.select().from(documentsTable).where(eq(documentsTable.id, d.id)).limit(1);
    let storageKey = ex[0]?.storageKey ?? "";
    if (!storageKey) {
      storageKey = await uploadPlaceholderPdf(d.id, d.name, d.category, d.documentDate ?? TODAY_DATE);
    }
    const values = {
      id: d.id, name: d.name, category: d.category,
      building: d.building ?? null, unit: d.unit ?? null,
      uploaded: d.documentDate ?? TODAY_DATE,
      size: "12 KB", uploadedBy: "Demo Admin",
      storageKey: storageKey || null,
      documentDate: d.documentDate ?? null,
      isHistorical: d.isHistorical ?? false,
      source: d.source ?? "original",
      importBatchId: d.importBatchId ?? null,
      notes: d.notes ?? "seed:document",
      vendorId: d.vendorId ?? null,
    };
    if (ex[0]) {
      await db.update(documentsTable).set(values).where(eq(documentsTable.id, d.id));
    } else {
      await db.insert(documentsTable).values(values);
    }
  }
  log(`  ${docs.length} documents (storageKey may be empty if object storage unavailable)`);
}

// ─────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────

async function seedNotifications(userIds: Map<string, number>) {
  log("Seeding notifications...");
  const heroId = userIds.get(HERO_OWNER_EMAIL);
  if (!heroId) return;
  const items = [
    { type: "billing", message: "Your monthly assessment of $385.00 has been posted." },
    { type: "amenity", message: "Your clubhouse reservation is confirmed for next week." },
    { type: "acc", message: "Your ACC request 'Replace front door' is in review." },
    { type: "package", message: "A package from Amazon has arrived for you." },
    { type: "meeting", message: "Notice: Upcoming open board meeting in 20 days." },
  ];
  for (const i of items) {
    const ex = await db.select().from(notificationsTable)
      .where(and(eq(notificationsTable.userId, heroId), eq(notificationsTable.message, i.message))).limit(1);
    if (ex[0]) continue;
    await db.insert(notificationsTable).values({
      userId: heroId, type: i.type, message: i.message,
      read: false, createdAt: TODAY_ISO,
    });
  }
  log(`  ${items.length} notifications for hero`);
}

// ─────────────────────────────────────────────────────────────────────────
// Hearings, work-order events/attachments, package pickup auth, pet
// incidents, notification log, fob lost-and-reissued audit.
// ─────────────────────────────────────────────────────────────────────────

async function seedDeepCoverage(userIds: Map<string, number>) {
  log("Seeding hearings, WO events, package pickup auth, pet incidents, notif log, fob reissue...");
  const adminId = userIds.get("demo.admin@quailvalleyhoa.demo") ?? 1;
  const chairId = userIds.get("demo.chair@quailvalleyhoa.demo") ?? adminId;
  const heroId = userIds.get(HERO_OWNER_EMAIL) ?? adminId;

  // Hearings: link to the architectural and nuisance violations (B04-U04, B05-U03)
  // and to the special-assessment meeting.
  const hearingTitles = [
    {
      tag: "seed:hearing:viol-b04-u04",
      title: "Violation hearing — B04-U04 unapproved fence color",
      kind: "violation", refType: "violations",
      scheduledAt: daysAhead(7), noticeDate: dateOnlyAgo(20),
      status: "scheduled" as const,
    },
    {
      tag: "seed:hearing:viol-b05-u03",
      title: "Violation hearing — B05-U03 noise (held)",
      kind: "violation", refType: "violations",
      scheduledAt: daysAgo(14), noticeDate: dateOnlyAgo(45),
      status: "held" as const, outcome: "Fine upheld; cure period 30 days.",
    },
    {
      tag: "seed:hearing:special-assess",
      title: "Special assessment hearing 2025",
      kind: "special_assessment", refType: "special_assessments",
      scheduledAt: daysAgo(190), noticeDate: dateOnlyAgo(220),
      status: "held" as const, outcome: "Special assessment approved by member vote.",
    },
  ];
  for (const h of hearingTitles) {
    const ex = await db.select().from(hearingsTable).where(eq(hearingsTable.title, h.title)).limit(1);
    if (ex[0]) continue;
    await db.insert(hearingsTable).values({
      kind: h.kind, refType: h.refType, refId: null, title: h.title,
      scheduledAt: h.scheduledAt, locationText: "Clubhouse meeting room",
      noticeDate: h.noticeDate, status: h.status, outcome: h.outcome ?? null,
      createdByUserId: chairId, createdAt: TODAY_ISO, updatedAt: TODAY_ISO,
    });
  }

  // Work-order events + attachments for hero unit work orders.
  const heroWoIds = ["seed:wo:B01-U01:hvac-2026", "seed:wo:B01-U01:plumb-leak"];
  for (const woId of heroWoIds) {
    const events: Array<{ kind: string; payload: unknown; daysOffset: number }> = [
      { kind: "opened", payload: { source: "owner_portal" }, daysOffset: 4 },
      { kind: "assigned", payload: { vendor: "ChillTech HVAC" }, daysOffset: 3 },
      { kind: "note", payload: { text: "Vendor confirmed arrival window 9-11am." }, daysOffset: 2 },
      { kind: "status_changed", payload: { from: "new", to: "in_progress" }, daysOffset: 2 },
    ];
    for (const e of events) {
      const tag = `seed:wo-event:${woId}:${e.kind}`;
      const ex = await db.select().from(workOrderEventsTable)
        .where(and(eq(workOrderEventsTable.workOrderId, woId), eq(workOrderEventsTable.kind, e.kind))).limit(1);
      if (ex[0]) continue;
      await db.insert(workOrderEventsTable).values({
        workOrderId: woId, kind: e.kind, actorUserId: adminId, actorName: "Demo Admin",
        payload: { ...(e.payload as object), tag }, createdAt: daysAgo(e.daysOffset),
      });
    }
    // Attachment
    const aex = await db.select().from(workOrderAttachmentsTable)
      .where(and(eq(workOrderAttachmentsTable.workOrderId, woId), eq(workOrderAttachmentsTable.name, "Diagnostic photo.jpg"))).limit(1);
    if (!aex[0]) {
      await db.insert(workOrderAttachmentsTable).values({
        workOrderId: woId, storageKey: `seed:attach:${woId}`,
        mimeType: "image/jpeg", size: 102400, name: "Diagnostic photo.jpg",
        uploadedBy: adminId, uploadedAt: daysAgo(2),
      });
    }
  }

  // Package pickup authorization on the hero in-locker package.
  const heroPkg = await db.select().from(packagesTable)
    .where(eq(packagesTable.pickupCode, "seed-pkg-hero-001")).limit(1);
  if (heroPkg[0]) {
    const ex = await db.select().from(packagePickupAuthorizationsTable)
      .where(eq(packagePickupAuthorizationsTable.packageId, heroPkg[0].id)).limit(1);
    if (!ex[0]) {
      await db.insert(packagePickupAuthorizationsTable).values({
        packageId: heroPkg[0].id, authorizedName: "Demo Proxy Picker",
        authorizedUserId: null, note: "seed:pickup-auth — owner authorized neighbor",
        createdByUserId: heroId, createdAt: TODAY_ISO,
      });
    }
    // Audit row reflecting proxy intent
    const audEx = await db.select().from(packageAuditTable)
      .where(and(eq(packageAuditTable.packageId, heroPkg[0].id), eq(packageAuditTable.action, "authorize_proxy"))).limit(1);
    if (!audEx[0]) {
      await db.insert(packageAuditTable).values({
        packageId: heroPkg[0].id, action: "authorize_proxy",
        actorUserId: heroId, actorName: HERO_OWNER_NAME,
        createdAt: TODAY_ISO,
      });
    }
  }

  // Pet incidents — bite (severe) + off-leash (minor). Pair with the
  // already-suspended Rex (B05-U03) so the suspension status is justified.
  const rex = await db.select().from(petsTable)
    .where(and(eq(petsTable.unitId, "B05-U03"), eq(petsTable.name, "Rex"))).limit(1);
  if (rex[0]) {
    const incidents = [
      { kind: "bite", severity: "severe", desc: "Reported bite at dog park; animal control notified." },
      { kind: "off_leash", severity: "minor", desc: "Observed off-leash on common area." },
    ];
    for (const inc of incidents) {
      const ex = await db.select().from(petIncidentsTable)
        .where(and(eq(petIncidentsTable.petId, rex[0].id), eq(petIncidentsTable.kind, inc.kind))).limit(1);
      if (ex[0]) continue;
      await db.insert(petIncidentsTable).values({
        petId: rex[0].id, unitId: "B05-U03", occurredAt: daysAgo(20),
        kind: inc.kind, severity: inc.severity, description: inc.desc,
        reportedByUserId: adminId, reportedByName: "Demo Admin",
        resolution: inc.kind === "bite" ? "Pet privileges suspended pending board review." : "",
        status: inc.kind === "bite" ? "reviewed" : "open",
        createdAt: TODAY_ISO,
      });
    }
    // Make sure the suspension is reflected.
    if (!rex[0].suspendedUntil) {
      await db.update(petsTable)
        .set({ suspendedUntil: dateOnlyAhead(60), status: "suspended", updatedAt: TODAY_ISO })
        .where(eq(petsTable.id, rex[0].id));
    }
  }

  // Notification log — delivered email + sms records.
  const notifLogItems = [
    { group: "all_owners", subject: "2026 Operating Budget posted", body: "The 2026 budget has been adopted.", count: 75, sentBy: "email" },
    { group: "delinquent", subject: "Late assessment reminder", body: "A reminder of your past-due balance.", count: 4, sentBy: "email" },
    { group: "building_4", subject: "Building 4 emergency siding work", body: "Crews on site Monday.", count: 4, sentBy: "sms" },
    { group: "all_residents", subject: "Pool closure for annual cleaning", body: "Closure 45–48 days from notice.", count: 75, sentBy: "email" },
  ];
  for (const n of notifLogItems) {
    const ex = await db.select().from(notificationLogTable)
      .where(eq(notificationLogTable.subject, n.subject)).limit(1);
    if (ex[0]) continue;
    await db.insert(notificationLogTable).values({
      recipientGroup: n.group, buildingId: n.group === "building_4" ? 4 : null,
      subject: n.subject, body: n.body,
      sentAt: daysAgo(7), sentBy: n.sentBy, recipientCount: n.count,
    });
  }

  // Fob lost-and-reissued audit lives in fob_inventory.notes (no separate audit table).
  const lostFob = await db.select().from(fobInventoryTable)
    .where(eq(fobInventoryTable.serial, "seed-fob-0059")).limit(1);
  if (lostFob[0] && !lostFob[0].notes?.includes("reissue")) {
    await db.update(fobInventoryTable).set({
      notes: `seed:fob | lost ${dateOnlyAgo(30)} | reissue: serial=seed-fob-0061 issued ${dateOnlyAgo(28)}`,
      updatedAt: TODAY_ISO,
    }).where(eq(fobInventoryTable.id, lostFob[0].id));
  }

  log(`  hearings, WO events/attachments, pickup auth, pet incidents, ${notifLogItems.length} notification_log rows, fob reissue note`);
}

// ─────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────

async function runDemoSeed() {
  log("=== Demo seed starting ===");

  // Make sure property data is in place; if buildings table is empty, abort
  // (post-merge.sh runs seed-property-data.sql before this).
  const buildingCount = await db.select({ c: sql<number>`count(*)` }).from(buildingsTable);
  if (Number(buildingCount[0]?.c ?? 0) === 0) {
    log("ERROR: buildings table is empty — run seed-property-data.sql first.");
    return;
  }

  const userIds = await seedPersonas();
  const vendorIds = await seedVendors();
  await seedInsurance();
  await seedWorkOrders(vendorIds);
  await seedBids(vendorIds, userIds);
  await seedAccRequests(userIds);
  await seedBilling(userIds);
  await seedGovernance(userIds);
  await seedCalendar(userIds);
  await seedAmenities(userIds);
  await seedCharging(userIds);
  await seedGuestParking(userIds);
  await seedPackages(userIds);
  await seedPets(userIds);
  await seedFobsAndTags(userIds);
  await seedViolationsAndCompliance(userIds);
  await seedDocuments(userIds, vendorIds);
  await seedBuildingSystems(vendorIds);
  await seedNotifications(userIds);
  await seedDeepCoverage(userIds);

  log("=== Demo seed complete ===");
  log(`Demo password (all personas): ${DEMO_PASSWORD}`);
  log(`Hero unit: ${HERO_UNIT} — ${HERO_OWNER_NAME} (${HERO_OWNER_EMAIL})`);
}

// ─────────────────────────────────────────────────────────────────────────
// Building Systems: ~10 systems across 2 buildings with inspection +
// repair history. Linked back to seed documents and to a work order so
// the file room and maintenance views are populated.
// ─────────────────────────────────────────────────────────────────────────

async function seedBuildingSystems(_vendorIds: Map<string, number>) {
  log("Seeding building systems...");
  const systems = [
    { building: 1, kind: "roof" as const, label: "Bldg 1 — Composition shingle roof", manufacturer: "GAF", model: "Timberline HDZ", installedOn: "2017-05-10", warrantyExpiresOn: "2042-05-10", status: "watch" as const, repairWO: "WO-2026-101" },
    { building: 1, kind: "hvac" as const, label: "Bldg 1 — Common-area HVAC", manufacturer: "Carrier", model: "48TC", installedOn: "2019-03-15", warrantyExpiresOn: "2029-03-15", status: "good" as const },
    { building: 1, kind: "fire_safety" as const, label: "Bldg 1 — Fire alarm panel", manufacturer: "Notifier", model: "NFS2-640", installedOn: "2014-08-01", status: "good" as const },
    { building: 1, kind: "elevator" as const, label: "Bldg 1 — Passenger elevator", manufacturer: "Otis", model: "Gen2", installedOn: "2014-01-01", status: "good" as const },
    { building: 1, kind: "plumbing" as const, label: "Bldg 1 — Domestic hot-water boiler", manufacturer: "Lochinvar", model: "Knight KBN286", installedOn: "2016-02-20", warrantyExpiresOn: "2026-02-20", status: "watch" as const },
    { building: 2, kind: "roof" as const, label: "Bldg 2 — TPO low-slope roof", manufacturer: "Carlisle", model: "Sure-Weld TPO", installedOn: "2015-09-12", warrantyExpiresOn: "2030-09-12", status: "good" as const },
    { building: 2, kind: "hvac" as const, label: "Bldg 2 — Common-area HVAC", manufacturer: "Trane", model: "Voyager", installedOn: "2018-07-20", status: "good" as const },
    { building: 2, kind: "fire_safety" as const, label: "Bldg 2 — Fire sprinkler riser", manufacturer: "Tyco", installedOn: "2014-08-01", status: "action" as const },
    { building: 2, kind: "electrical" as const, label: "Bldg 2 — Main switchgear", manufacturer: "Square D", installedOn: "2014-08-01", status: "good" as const },
    { building: 2, kind: "exterior" as const, label: "Bldg 2 — Stucco façade", installedOn: "2014-08-01", status: "watch" as const },
  ];
  for (const s of systems) {
    const ex = await db.select().from(buildingSystemsTable)
      .where(and(eq(buildingSystemsTable.building, s.building), eq(buildingSystemsTable.label, s.label))).limit(1);
    let sysId: number;
    if (ex[0]) {
      sysId = ex[0].id;
    } else {
      const ins = await db.insert(buildingSystemsTable).values({
        building: s.building, kind: s.kind, label: s.label,
        manufacturer: s.manufacturer ?? null, model: s.model ?? null,
        installedOn: s.installedOn ?? null,
        warrantyExpiresOn: s.warrantyExpiresOn ?? null,
        status: s.status, notes: "seed:building_system",
        createdAt: TODAY_ISO,
      }).returning();
      sysId = ins[0].id;
    }
    // One inspection 90 days ago, one 365 days ago.
    for (const days of [90, 365]) {
      const inspectedOn = dateOnlyAgo(days);
      const iex = await db.select().from(buildingSystemInspectionsTable)
        .where(and(eq(buildingSystemInspectionsTable.systemId, sysId), eq(buildingSystemInspectionsTable.inspectedOn, inspectedOn))).limit(1);
      if (iex[0]) continue;
      await db.insert(buildingSystemInspectionsTable).values({
        systemId: sysId, inspectedOn,
        inspector: "Demo Inspector",
        summary: `Routine inspection — ${s.label} status: ${s.status}`,
        documentId: null, createdAt: TODAY_ISO,
      });
    }
    // Optional repair link to a work order id (the WO may not exist; the
    // table only stores a string id, no FK constraint).
    if (s.repairWO) {
      const rex = await db.select().from(buildingSystemRepairsTable)
        .where(and(eq(buildingSystemRepairsTable.systemId, sysId), eq(buildingSystemRepairsTable.workOrderId, s.repairWO))).limit(1);
      if (!rex[0]) {
        await db.insert(buildingSystemRepairsTable).values({
          systemId: sysId, workOrderId: s.repairWO, createdAt: TODAY_ISO,
        });
      }
    }
    // Link the building's inspection PDF to the roof/fire systems.
    if (s.kind === "fire_safety" || s.kind === "roof") {
      const docId = s.kind === "fire_safety"
        ? `seed:doc:bldg${s.building}:fire-2022`
        : `seed:doc:bldg${s.building}:hist-roof-2018`;
      const dex = await db.select().from(buildingSystemDocumentsTable)
        .where(and(eq(buildingSystemDocumentsTable.systemId, sysId), eq(buildingSystemDocumentsTable.documentId, docId))).limit(1);
      if (!dex[0]) {
        await db.insert(buildingSystemDocumentsTable).values({
          systemId: sysId, documentId: docId,
          kind: "inspection", createdAt: TODAY_ISO,
        });
      }
    }
  }
  log(`  ${systems.length} building systems with inspection + repair history`);
}

runDemoSeed()
  .catch((err) => {
    console.error("[seed-demo] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
