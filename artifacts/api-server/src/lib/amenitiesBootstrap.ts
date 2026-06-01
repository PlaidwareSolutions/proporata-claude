// Task #77: Bootstrap defaults — ensure the "amenities" sub-calendar exists
// and seed the default catalog of bookable amenities. Idempotent on slug.

import { db } from "@workspace/db";
import {
  amenitiesTable,
  amenityInspectionTemplatesTable,
  amenityInspectionTemplateItemsTable,
  calendarSubCalendarsTable,
  type Amenity,
  type AmenityRules,
  type AmenityInspectionTemplateKind,
  type AmenityInspectionItemSeverity,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger.js";

const SUB_SLUG = "amenities";

interface DefaultAmenity {
  slug: string;
  name: string;
  description: string;
  capacity: number;
  bookingUnit: Amenity["bookingUnit"];
  depositCents: number;
  rules: AmenityRules;
  agreementText: string;
  sortOrder: number;
}

const DEFAULT_AMENITIES: DefaultAmenity[] = [
  {
    slug: "clubhouse",
    name: "Clubhouse",
    description:
      "Reserve the community clubhouse for parties, meetings, or family gatherings. Includes kitchen and AV.",
    capacity: 60,
    bookingUnit: "block",
    depositCents: 25000,
    rules: {
      blockHours: 4,
      hoursByWeekday: [
        { open: "10:00", close: "22:00" },
        { open: "10:00", close: "22:00" },
        { open: "10:00", close: "22:00" },
        { open: "10:00", close: "22:00" },
        { open: "10:00", close: "22:00" },
        { open: "10:00", close: "23:00" },
        { open: "10:00", close: "23:00" },
      ],
      minLeadMinutes: 1440,
      maxLeadDays: 120,
      monthlyCapPerOwner: 2,
      cancelWindowHours: 48,
    },
    agreementText:
      "I agree to leave the clubhouse clean and undamaged, abide by the noise ordinance, and accept liability for any damage caused during my reservation. The deposit will be refunded after inspection.",
    sortOrder: 10,
  },
  {
    slug: "pool_party",
    name: "Pool Party (Lifeguard Required)",
    description:
      "Reserve the pool deck and request an on-duty lifeguard for a private party. Pool remains open to other residents.",
    capacity: 25,
    bookingUnit: "block",
    depositCents: 15000,
    rules: {
      blockHours: 3,
      hoursByWeekday: [
        { open: "10:00", close: "20:00" },
        null,
        null,
        null,
        null,
        { open: "10:00", close: "20:00" },
        { open: "10:00", close: "20:00" },
      ],
      minLeadMinutes: 4320,
      maxLeadDays: 90,
      monthlyCapPerOwner: 1,
      cancelWindowHours: 72,
      requiresLifeguard: true,
    },
    agreementText:
      "I understand a certified lifeguard is required for my pool party and that it will be scheduled by management. I accept liability for my guests and agree to follow all pool rules.",
    sortOrder: 20,
  },
  {
    slug: "tennis_court",
    name: "Tennis Court",
    description:
      "Reserve the tennis court in 1-hour blocks. Walk-on play allowed when no reservation is active.",
    capacity: 4,
    bookingUnit: "hourly",
    depositCents: 0,
    rules: {
      hoursByWeekday: [
        { open: "07:00", close: "21:00" },
        { open: "07:00", close: "21:00" },
        { open: "07:00", close: "21:00" },
        { open: "07:00", close: "21:00" },
        { open: "07:00", close: "21:00" },
        { open: "07:00", close: "21:00" },
        { open: "07:00", close: "21:00" },
      ],
      minLeadMinutes: 0,
      maxLeadDays: 14,
      monthlyCapPerOwner: 0,
      cancelWindowHours: 1,
    },
    agreementText: "I agree to follow court rules and limit my reservation to one block per session.",
    sortOrder: 30,
  },
  {
    slug: "pickleball_court",
    name: "Pickleball Court",
    description: "Reserve the pickleball court in 1-hour blocks.",
    capacity: 4,
    bookingUnit: "hourly",
    depositCents: 0,
    rules: {
      hoursByWeekday: [
        { open: "07:00", close: "21:00" },
        { open: "07:00", close: "21:00" },
        { open: "07:00", close: "21:00" },
        { open: "07:00", close: "21:00" },
        { open: "07:00", close: "21:00" },
        { open: "07:00", close: "21:00" },
        { open: "07:00", close: "21:00" },
      ],
      minLeadMinutes: 0,
      maxLeadDays: 14,
      cancelWindowHours: 1,
    },
    agreementText: "I agree to follow court rules and limit my reservation to one block per session.",
    sortOrder: 40,
  },
  {
    slug: "pavilion",
    name: "Pavilion",
    description: "Reserve the outdoor pavilion for picnics, BBQs, and small gatherings.",
    capacity: 30,
    bookingUnit: "block",
    depositCents: 5000,
    rules: {
      blockHours: 4,
      hoursByWeekday: [
        { open: "09:00", close: "21:00" },
        { open: "09:00", close: "21:00" },
        { open: "09:00", close: "21:00" },
        { open: "09:00", close: "21:00" },
        { open: "09:00", close: "21:00" },
        { open: "09:00", close: "22:00" },
        { open: "09:00", close: "22:00" },
      ],
      minLeadMinutes: 1440,
      maxLeadDays: 60,
      monthlyCapPerOwner: 2,
      cancelWindowHours: 24,
    },
    agreementText:
      "I agree to clean up after my event, dispose of trash properly, and accept liability for damage to the pavilion or grounds.",
    sortOrder: 50,
  },
  {
    slug: "guest_parking",
    name: "Guest Parking",
    description:
      "Reserve a guest-parking spot for an overnight stay. A printable permit is generated upon confirmation.",
    capacity: 1,
    bookingUnit: "overnight",
    depositCents: 0,
    rules: {
      minLeadMinutes: 0,
      maxLeadDays: 30,
      cancelWindowHours: 1,
      guestParkingNightlyCap: 7,
    },
    agreementText:
      "I confirm this guest is staying with me. The vehicle must display the printable permit at all times. The community is not liable for theft or damage.",
    sortOrder: 60,
  },
  // EV charging is modelled as a single amenity row whose physical capacity
  // is described per-port via the charging_ports table.
  {
    slug: "ev_charger",
    name: "EV Charger",
    description:
      "Reserve a charging port for your electric vehicle. Energy use is billed to your dues account; idle and no-show fees may apply.",
    capacity: 1,
    bookingUnit: "block",
    depositCents: 0,
    rules: {
      blockHours: 1,
      hoursByWeekday: [
        { open: "00:00", close: "23:59" },
        { open: "00:00", close: "23:59" },
        { open: "00:00", close: "23:59" },
        { open: "00:00", close: "23:59" },
        { open: "00:00", close: "23:59" },
        { open: "00:00", close: "23:59" },
        { open: "00:00", close: "23:59" },
      ],
      minLeadMinutes: 0,
      maxLeadDays: 14,
      cancelWindowHours: 1,
    },
    agreementText:
      "I agree to be billed for the energy delivered during my session at the posted per-kWh rate, and accept any idle or no-show fees if I overstay or fail to arrive within the grace period.",
    sortOrder: 65,
  },
  {
    slug: "dog_park",
    name: "Dog Park",
    description:
      "Off-leash dog park gated by access code. Requires a registered, vaccinated dog and a current park-rules agreement.",
    capacity: 0,
    bookingUnit: "block",
    depositCents: 0,
    rules: {
      blockHours: 1,
      hoursByWeekday: [
        { open: "06:00", close: "22:00" },
        { open: "06:00", close: "22:00" },
        { open: "06:00", close: "22:00" },
        { open: "06:00", close: "22:00" },
        { open: "06:00", close: "22:00" },
        { open: "06:00", close: "22:00" },
        { open: "06:00", close: "22:00" },
      ],
      minLeadMinutes: 0,
      maxLeadDays: 7,
      cancelWindowHours: 0,
    },
    agreementText:
      "I agree to follow all dog-park rules: keep my dog under voice control, clean up after my dog, ensure all vaccinations are current, and accept liability for my dog's behavior.",
    sortOrder: 67,
  },
  {
    slug: "move_in_slot",
    name: "Move-in / Move-out Slot",
    description:
      "Reserve the loading-dock and elevator-pad service for a 4-hour move-in or move-out window.",
    capacity: 1,
    bookingUnit: "block",
    depositCents: 50000,
    rules: {
      blockHours: 4,
      hoursByWeekday: [
        null,
        { open: "08:00", close: "18:00" },
        { open: "08:00", close: "18:00" },
        { open: "08:00", close: "18:00" },
        { open: "08:00", close: "18:00" },
        { open: "08:00", close: "18:00" },
        null,
      ],
      minLeadMinutes: 4320,
      maxLeadDays: 90,
      monthlyCapPerOwner: 2,
      cancelWindowHours: 72,
    },
    agreementText:
      "I agree that my movers will use protective padding on the elevator and walls. The deposit is refunded after a damage inspection.",
    sortOrder: 70,
  },
  {
    slug: "mail_package_room",
    name: "Mail / Package Room",
    description:
      "Central package drop point. Operational amenity — packages logged here are tracked, locker-assigned, and released via pickup code.",
    capacity: 0,
    bookingUnit: "block",
    depositCents: 0,
    rules: {},
    agreementText: "",
    sortOrder: 80,
  },
];

export async function ensureAmenitiesSubCalendar(): Promise<void> {
  const [existing] = await db
    .select()
    .from(calendarSubCalendarsTable)
    .where(eq(calendarSubCalendarsTable.slug, SUB_SLUG));
  if (existing) return;
  await db
    .insert(calendarSubCalendarsTable)
    .values({
      slug: SUB_SLUG,
      name: "Amenities",
      color: "#0E8A6B",
      description: "Bookable common-area reservations.",
      editorRoles: ["admin", "manager"],
      viewerRoles: ["admin", "manager", "resident", "board"],
      isPublic: true,
      isExternal: false,
      sortOrder: 50,
    })
    .onConflictDoNothing();
  logger.info({ slug: SUB_SLUG }, "Created amenities sub-calendar");
}

export async function seedDefaultAmenities(): Promise<void> {
  const now = new Date().toISOString();
  for (const a of DEFAULT_AMENITIES) {
    await db
      .insert(amenitiesTable)
      .values({
        slug: a.slug,
        name: a.name,
        description: a.description,
        photoUrl: null,
        capacity: a.capacity,
        bookingUnit: a.bookingUnit,
        depositCents: a.depositCents,
        rules: a.rules,
        agreementText: a.agreementText,
        agreementTemplatePath: null,
        enabled: true,
        sortOrder: a.sortOrder,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }
}

// Task #83: Default inspection templates seeded on bootstrap. One pre-use and
// one post-use template per amenity slug that handles deposits/damage. The
// owner_self template is a single shared "owner walkthrough" used by residents.
interface DefaultTemplate {
  amenitySlug: string | null;
  name: string;
  kind: AmenityInspectionTemplateKind;
  description: string;
  sortOrder: number;
  items: Array<{
    label: string;
    helpText?: string;
    requiresPhoto?: boolean;
    severity?: AmenityInspectionItemSeverity;
  }>;
}

const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    amenitySlug: "clubhouse",
    name: "Clubhouse — Pre-use",
    kind: "pre",
    description: "Walkthrough before owner takes possession of the clubhouse.",
    sortOrder: 10,
    items: [
      { label: "Floors clean and free of debris", severity: "warn" },
      { label: "Tables and chairs intact and in place", severity: "warn" },
      { label: "Kitchen appliances operational", severity: "critical" },
      { label: "Restrooms stocked and clean", severity: "warn" },
      { label: "AV / projector / sound functional", severity: "warn" },
      { label: "Walls / paint without damage", requiresPhoto: true, severity: "warn" },
      { label: "Exit signs and fire extinguishers present", severity: "critical" },
    ],
  },
  {
    amenitySlug: "clubhouse",
    name: "Clubhouse — Post-use",
    kind: "post",
    description: "Walkthrough after owner vacates the clubhouse.",
    sortOrder: 20,
    items: [
      { label: "Floors clean and trash removed", severity: "warn" },
      { label: "Tables and chairs returned to original layout", severity: "info" },
      { label: "Kitchen left clean (sinks, counters, appliances)", severity: "warn" },
      { label: "Restrooms left clean", severity: "warn" },
      { label: "Walls / paint without damage", requiresPhoto: true, severity: "critical" },
      { label: "AV / projector / sound powered off and intact", severity: "warn" },
      { label: "Doors and windows secured", severity: "critical" },
    ],
  },
  {
    amenitySlug: "pool_party",
    name: "Pool Party — Pre-use",
    kind: "pre",
    description: "Walkthrough before private pool party begins.",
    sortOrder: 10,
    items: [
      { label: "Lifeguard on duty and credentials verified", severity: "critical" },
      { label: "Deck furniture intact and in place", severity: "warn" },
      { label: "Pool deck clean and free of hazards", severity: "warn" },
      { label: "Restrooms stocked", severity: "info" },
      { label: "Pool chemistry within range (latest log)", severity: "critical" },
    ],
  },
  {
    amenitySlug: "pool_party",
    name: "Pool Party — Post-use",
    kind: "post",
    description: "Walkthrough after private pool party ends.",
    sortOrder: 20,
    items: [
      { label: "Trash collected from deck", severity: "warn" },
      { label: "Furniture returned to original layout", severity: "info" },
      { label: "No glass or hazards in pool/deck", severity: "critical" },
      { label: "Restrooms left clean", severity: "warn" },
      { label: "Damage to deck or furniture", requiresPhoto: true, severity: "critical" },
    ],
  },
  {
    amenitySlug: "pavilion",
    name: "Pavilion — Post-use",
    kind: "post",
    description: "Walkthrough after pavilion reservation ends.",
    sortOrder: 10,
    items: [
      { label: "Trash removed and bins emptied", severity: "warn" },
      { label: "BBQ / grill cleaned (if used)", severity: "warn" },
      { label: "Tables and benches intact", requiresPhoto: true, severity: "warn" },
      { label: "No damage to landscaping", severity: "warn" },
    ],
  },
  {
    amenitySlug: "move_in_slot",
    name: "Move-in / Move-out — Post-use",
    kind: "post",
    description: "Walkthrough after move-in or move-out window closes.",
    sortOrder: 10,
    items: [
      { label: "Elevator pads removed and elevator in normal mode", severity: "warn" },
      { label: "Elevator interior intact (walls, ceiling, doors)", requiresPhoto: true, severity: "critical" },
      { label: "Hallway walls and corners intact", requiresPhoto: true, severity: "critical" },
      { label: "Loading dock clear of debris", severity: "warn" },
      { label: "Floor scratches or stains", requiresPhoto: true, severity: "warn" },
    ],
  },
  {
    amenitySlug: null,
    name: "Owner self-inspection",
    kind: "owner_self",
    description: "Quick walkthrough the owner can complete before checkout to flag any issues.",
    sortOrder: 100,
    items: [
      { label: "Space looks the way I found it", severity: "info" },
      { label: "I noticed damage that I did not cause", requiresPhoto: true, severity: "warn" },
      { label: "I caused minor damage during my use", requiresPhoto: true, severity: "warn" },
    ],
  },
];

export async function seedDefaultInspectionTemplates(): Promise<void> {
  const now = new Date().toISOString();
  for (const t of DEFAULT_TEMPLATES) {
    const existing = await db
      .select()
      .from(amenityInspectionTemplatesTable)
      .where(and(
        t.amenitySlug
          ? eq(amenityInspectionTemplatesTable.amenitySlug, t.amenitySlug)
          : eq(amenityInspectionTemplatesTable.kind, t.kind),
        eq(amenityInspectionTemplatesTable.kind, t.kind),
        eq(amenityInspectionTemplatesTable.name, t.name),
      ))
      .limit(1);
    if (existing.length > 0) continue;
    const [tpl] = await db.insert(amenityInspectionTemplatesTable).values({
      amenitySlug: t.amenitySlug,
      name: t.name,
      kind: t.kind,
      description: t.description,
      enabled: true,
      sortOrder: t.sortOrder,
      createdAt: now,
      updatedAt: now,
    }).returning();
    for (let i = 0; i < t.items.length; i++) {
      const it = t.items[i];
      await db.insert(amenityInspectionTemplateItemsTable).values({
        templateId: tpl.id,
        label: it.label,
        helpText: it.helpText ?? "",
        requiresPhoto: it.requiresPhoto ?? false,
        severity: it.severity ?? "warn",
        sortOrder: i * 10,
      });
    }
  }
}

export async function bootstrapAmenities(): Promise<void> {
  try {
    await ensureAmenitiesSubCalendar();
    await seedDefaultAmenities();
    await seedDefaultInspectionTemplates();
  } catch (err) {
    logger.error({ err }, "Amenities bootstrap failed");
  }
}

export async function getAmenitiesSubCalendarId(): Promise<number | null> {
  const [row] = await db
    .select()
    .from(calendarSubCalendarsTable)
    .where(eq(calendarSubCalendarsTable.slug, SUB_SLUG));
  return row?.id ?? null;
}
