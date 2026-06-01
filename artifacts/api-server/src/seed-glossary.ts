/**
 * Glossary seed (Task #140) — idempotent.
 * Run with: pnpm --filter @workspace/api-server exec tsx src/seed-glossary.ts
 */
import { db, pool } from "@workspace/db";
import { glossaryTermsTable, glossaryRouteMappingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

type SeedTerm = {
  termKey: string;
  title: string;
  category: "governance" | "maintenance" | "property" | "compliance" | "financials" | "community";
  shortDef: string;
  longDef?: string;
  seeAlsoRoute?: string;
  routes: string[];
};

const TERMS: SeedTerm[] = [
  // Governance
  { termKey: "motion", title: "Motion", category: "governance",
    shortDef: "A formal proposal voted on by the board (e.g. \"Approve a $5,000 painting contract\").",
    longDef: "Motions are how decisions get made. A board member files one, fellow members vote yes, no, or abstain, and once enough \"yes\" votes are in, the motion is adopted and can become a resolution.",
    seeAlsoRoute: "/motions", routes: ["/motions", "/portal/board"] },
  { termKey: "quorum", title: "Quorum", category: "governance",
    shortDef: "The minimum number of board members who must participate for a vote to count.",
    longDef: "If a board has 7 members and the quorum is 4, at least 4 must vote (yes, no, or abstain) before a motion can be officially adopted or rejected.",
    routes: ["/motions", "/meetings", "/boards"] },
  { termKey: "tally", title: "Tally", category: "governance",
    shortDef: "The running count of yes / no / abstain votes on a motion.",
    routes: ["/motions"] },
  { termKey: "supermajority", title: "Supermajority", category: "governance",
    shortDef: "A higher threshold than a simple majority — for example, two-thirds of board members must vote yes.",
    longDef: "Some decisions (large spends, governing-document changes) require more than 50% support. The exact percentage is set by your bylaws.",
    routes: ["/motions", "/resolutions"] },
  { termKey: "adopted", title: "Adopted", category: "governance",
    shortDef: "A motion that has received enough yes votes to pass and become binding.",
    routes: ["/motions", "/resolutions"] },
  { termKey: "voting-rule", title: "Voting rule", category: "governance",
    shortDef: "The combination of quorum + threshold (simple majority, supermajority) that decides whether a motion passes.",
    routes: ["/motions"] },
  { termKey: "resolution", title: "Resolution", category: "governance",
    shortDef: "An official, signed record of a board decision after a motion is adopted.",
    longDef: "Once a motion passes, it becomes a resolution with a number, an effective date, and a permanent place in the HOA's records.",
    seeAlsoRoute: "/resolutions", routes: ["/resolutions", "/portal/resolutions"] },
  { termKey: "adoption", title: "Adoption", category: "governance",
    shortDef: "The moment a motion receives enough votes to officially pass and become a resolution.",
    routes: ["/resolutions"] },
  { termKey: "effective-date", title: "Effective date", category: "governance",
    shortDef: "The date a resolution takes effect, which may be later than the date it was adopted.",
    routes: ["/resolutions"] },
  { termKey: "resolution-chain", title: "Resolution chain", category: "governance",
    shortDef: "When a newer resolution amends, replaces, or repeals an older one, the connected resolutions form a chain.",
    routes: ["/resolutions"] },
  { termKey: "board-officer", title: "Board officer", category: "governance",
    shortDef: "A board member elected to a specific role: President, Vice-President, Secretary, or Treasurer.",
    routes: ["/boards"] },
  { termKey: "meeting-minutes", title: "Meeting minutes", category: "governance",
    shortDef: "The official written record of what was discussed and decided during a board meeting.",
    seeAlsoRoute: "/meetings", routes: ["/meetings"] },
  { termKey: "agenda", title: "Agenda", category: "governance",
    shortDef: "The list of topics planned for a meeting, published in advance.",
    routes: ["/meetings", "/calendar"] },

  // Maintenance
  { termKey: "work-order", title: "Work order", category: "maintenance",
    shortDef: "A maintenance or repair task tracked from request through to completion.",
    longDef: "A work order captures who reported the issue, what needs fixing, which vendor or staff member is doing the work, and a status that moves from open → in progress → done.",
    seeAlsoRoute: "/work-orders", routes: ["/work-orders", "/work-orders/new"] },
  { termKey: "service-request", title: "Service request", category: "maintenance",
    shortDef: "A resident's request for maintenance, which managers turn into a work order.",
    routes: ["/work-orders", "/portal/architectural"] },
  { termKey: "trade", title: "Trade", category: "maintenance",
    shortDef: "The category of work — plumbing, electrical, HVAC, landscaping, etc.",
    longDef: "Trades let you match a work order to vendors who specialize in that kind of work.",
    routes: ["/work-orders", "/vendors"] },
  { termKey: "vendor", title: "Vendor", category: "maintenance",
    shortDef: "An outside company or contractor hired to do work for the HOA.",
    seeAlsoRoute: "/vendors", routes: ["/vendors", "/work-orders", "/bids"] },
  { termKey: "scope-item", title: "Scope item", category: "maintenance",
    shortDef: "A single line of work inside a larger job (e.g. \"replace 12 sprinkler heads\").",
    routes: ["/bids", "/work-orders"] },
  { termKey: "quote", title: "Quote", category: "maintenance",
    shortDef: "A vendor's price estimate for a piece of work.",
    routes: ["/bids", "/vendors"] },
  { termKey: "rfp", title: "RFP", category: "maintenance",
    shortDef: "Request For Proposal — a structured invitation to vendors to submit bids on a project.",
    seeAlsoRoute: "/bids", routes: ["/bids"] },
  { termKey: "sealed-bid", title: "Sealed bid", category: "maintenance",
    shortDef: "A vendor's bid that is hidden until the RFP closes, so vendors can't see each other's prices.",
    routes: ["/bids"] },
  { termKey: "award", title: "Award", category: "maintenance",
    shortDef: "Choosing the winning bid in an RFP and assigning the work to that vendor.",
    routes: ["/bids"] },
  { termKey: "status-lifecycle", title: "Status lifecycle", category: "maintenance",
    shortDef: "The defined sequence a work order moves through: open → in progress → done.",
    routes: ["/work-orders"] },

  // Property
  { termKey: "unit", title: "Unit", category: "property",
    shortDef: "A single home, condo, or townhouse inside the community.",
    seeAlsoRoute: "/units", routes: ["/units"] },
  { termKey: "plat-map", title: "Plat map", category: "property",
    shortDef: "A scaled drawing showing the boundaries of the community and individual units.",
    seeAlsoRoute: "/site-map", routes: ["/site-map", "/buildings"] },
  { termKey: "common-area", title: "Common area", category: "property",
    shortDef: "Shared spaces owned by the HOA — pool, clubhouse, sidewalks, hallways, landscaping.",
    routes: ["/site-map", "/buildings", "/amenities"] },
  { termKey: "building-declaration", title: "Building declaration", category: "property",
    shortDef: "The legal document that defines a building, its units, and what the HOA versus owners are responsible for.",
    routes: ["/buildings", "/documents"] },
  { termKey: "roof-age", title: "Roof age", category: "property",
    shortDef: "How many years since the roof was last replaced — used for budgeting and insurance.",
    routes: ["/buildings", "/site-map"] },
  { termKey: "encroachment", title: "Encroachment", category: "property",
    shortDef: "When a structure (fence, deck, shed) crosses onto common area or a neighboring unit.",
    routes: ["/buildings", "/architectural-requests"] },

  // Compliance / Architectural
  { termKey: "architectural-request", title: "Architectural request", category: "compliance",
    shortDef: "An owner's request to make a change to the outside of their unit (paint, fence, deck) that needs HOA approval.",
    seeAlsoRoute: "/architectural-requests",
    routes: ["/architectural-requests", "/portal/architectural"] },
  { termKey: "acc", title: "ACC", category: "compliance",
    shortDef: "Architectural Control Committee — the group of board members who review architectural requests.",
    routes: ["/architectural-requests", "/portal/architectural"] },
  { termKey: "covenant", title: "Covenant", category: "compliance",
    shortDef: "A rule recorded with the property that owners must follow (e.g. \"no fences taller than 6 feet\").",
    routes: ["/architectural-requests", "/documents"] },
  { termKey: "violation", title: "Violation", category: "compliance",
    shortDef: "When something at a unit breaks the HOA's rules — usually flagged by patrol or a neighbor.",
    routes: ["/patrol", "/architectural-requests"] },
  { termKey: "decal-fob-pool-tag", title: "Decal / fob / pool tag", category: "compliance",
    shortDef: "Physical credentials that identify residents and let them into amenities or parking areas.",
    routes: ["/fobs", "/pool-tags", "/parking"] },
  { termKey: "insurance-gap", title: "Insurance gap", category: "compliance",
    shortDef: "A period where a policy has expired and not yet been renewed — leaving the HOA exposed.",
    seeAlsoRoute: "/insurance", routes: ["/insurance"] },
  { termKey: "declaration-page", title: "Declaration page", category: "compliance",
    shortDef: "A one-page summary from an insurance policy showing coverage, dates, and limits.",
    routes: ["/insurance"] },
  { termKey: "compliance", title: "Compliance", category: "compliance",
    shortDef: "Whether a unit, owner, or vendor is meeting all HOA rules and required documentation.",
    routes: ["/insurance", "/vendors", "/patrol"] },

  // Financials
  { termKey: "ledger", title: "Ledger", category: "financials",
    shortDef: "The running list of charges and payments on an owner's account.",
    seeAlsoRoute: "/portal/account", routes: ["/billing", "/portal/account"] },
  { termKey: "assessment", title: "Assessment", category: "financials",
    shortDef: "A charge from the HOA — most commonly the regular dues, but also one-time charges for special projects.",
    routes: ["/billing", "/portal/account"] },
  { termKey: "dues", title: "Dues", category: "financials",
    shortDef: "The regular (usually monthly or quarterly) payment each owner makes to the HOA.",
    routes: ["/billing", "/portal/account"] },
  { termKey: "balance", title: "Balance", category: "financials",
    shortDef: "How much an owner currently owes (positive) or has on credit (negative).",
    routes: ["/billing", "/portal/account"] },
  { termKey: "statement", title: "Statement", category: "financials",
    shortDef: "A printable summary of an owner's recent charges, payments, and balance.",
    routes: ["/billing", "/portal/account"] },
  { termKey: "refund", title: "Refund", category: "financials",
    shortDef: "Returning money to an owner — usually for an overpayment or a charge that's been waived.",
    routes: ["/billing/payments", "/billing"] },
  { termKey: "payment", title: "Payment", category: "financials",
    shortDef: "Money received from an owner that pays down their balance.",
    routes: ["/billing/payments"] },

  // Community
  { termKey: "amenity", title: "Amenity", category: "community",
    shortDef: "A shared facility residents can use — pool, gym, clubhouse, BBQ area.",
    seeAlsoRoute: "/amenities", routes: ["/amenities", "/portal/amenities"] },
  { termKey: "reservation", title: "Reservation", category: "community",
    shortDef: "A booking by a resident to use an amenity at a specific time.",
    routes: ["/amenities", "/portal/amenities"] },
  { termKey: "package-locker", title: "Package locker", category: "community",
    shortDef: "A secure box where deliveries are held until a resident picks them up.",
    seeAlsoRoute: "/mail-room", routes: ["/mail-room", "/portal/mail"] },
  { termKey: "ev-charging-session", title: "EV charging session", category: "community",
    shortDef: "A single charge of an electric vehicle at a community charger, with the kWh and any fees.",
    routes: ["/ev-charging", "/portal/ev-charging"] },
  { termKey: "guest-permit", title: "Guest permit", category: "community",
    shortDef: "A short-term parking pass given to a resident's visitor.",
    routes: ["/parking", "/portal/parking"] },
  { termKey: "patrol", title: "Patrol", category: "community",
    shortDef: "Periodic walk-throughs of the community to spot issues, safety concerns, and rule violations.",
    routes: ["/patrol"] },
  { termKey: "pets", title: "Pets", category: "community",
    shortDef: "Registered pets that live in the community, including required vaccinations and weight limits.",
    routes: ["/pets", "/portal/pets"] },
];

async function run() {
  const now = new Date().toISOString();
  for (let i = 0; i < TERMS.length; i++) {
    const t = TERMS[i]!;
    const [existing] = await db
      .select()
      .from(glossaryTermsTable)
      .where(eq(glossaryTermsTable.termKey, t.termKey));

    let termId: number;
    if (existing) {
      await db.update(glossaryTermsTable).set({
        title: t.title,
        category: t.category,
        shortDef: t.shortDef,
        longDef: t.longDef ?? "",
        seeAlsoRoute: t.seeAlsoRoute ?? null,
        published: true,
        sortOrder: i,
        updatedAt: now,
      }).where(eq(glossaryTermsTable.id, existing.id));
      termId = existing.id;
    } else {
      const [created] = await db.insert(glossaryTermsTable).values({
        termKey: t.termKey,
        title: t.title,
        category: t.category,
        shortDef: t.shortDef,
        longDef: t.longDef ?? "",
        seeAlsoRoute: t.seeAlsoRoute ?? null,
        published: true,
        sortOrder: i,
        createdAt: now,
        updatedAt: now,
      }).returning();
      termId = created!.id;
    }

    await db.delete(glossaryRouteMappingsTable).where(eq(glossaryRouteMappingsTable.termId, termId));
    if (t.routes.length > 0) {
      await db.insert(glossaryRouteMappingsTable).values(
        t.routes.map((route, j) => ({ termId, route, sortOrder: j })),
      );
    }
  }
  console.log(`Seeded ${TERMS.length} glossary terms.`);
}

run()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end();
    process.exit(1);
  });
