// Task #89: Amenity compliance status engine. Computes a Green/Amber/Red
// rollup for an amenity by combining required postings, certificates,
// and the most recent annual inspection.

import { db } from "@workspace/db";
import {
  amenitiesTable,
  amenityRequiredPostingsTable,
  amenityPostingIssuancesTable,
  amenityCertificatesTable,
  amenityAnnualInspectionsTable,
  amenityIncidentReportsTable,
  type Amenity,
  type AmenityRequiredPosting,
  type AmenityPostingIssuance,
  type AmenityCertificate,
  type AmenityAnnualInspection,
} from "@workspace/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";

export type ComplianceColor = "green" | "amber" | "red";

const AMBER_DAYS = 30;

function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db_ = new Date(b).getTime();
  return Math.round((da - db_) / (24 * 60 * 60 * 1000));
}

export interface PostingStatus {
  posting: AmenityRequiredPosting;
  current: AmenityPostingIssuance | null;
  expiresAt: string | null;
  color: ComplianceColor;
  reason: string;
}

export function computePostingStatus(
  posting: AmenityRequiredPosting,
  issuances: AmenityPostingIssuance[],
  nowIso: string,
): PostingStatus {
  const active = issuances
    .filter((i) => i.postingId === posting.id && i.status === "active")
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))[0] ?? null;
  if (!active) {
    return {
      posting, current: null, expiresAt: null,
      color: posting.required ? "red" : "amber",
      reason: posting.required ? "No active posting on file." : "Optional posting missing.",
    };
  }
  let expiresAt = active.expiresAt;
  if (!expiresAt && posting.replaceEveryDays > 0) {
    const d = new Date(active.postedAt);
    d.setUTCDate(d.getUTCDate() + posting.replaceEveryDays);
    expiresAt = d.toISOString();
  }
  if (expiresAt) {
    const days = daysBetween(expiresAt, nowIso);
    if (days < 0) return { posting, current: active, expiresAt, color: "red", reason: `Expired ${-days}d ago.` };
    if (days <= AMBER_DAYS) return { posting, current: active, expiresAt, color: "amber", reason: `Expires in ${days}d.` };
  }
  return { posting, current: active, expiresAt, color: "green", reason: "Posting current." };
}

export interface CertStatus {
  cert: AmenityCertificate;
  color: ComplianceColor;
  reason: string;
}

export function computeCertStatus(cert: AmenityCertificate, nowIso: string): CertStatus {
  if (!cert.expiresOn) return { cert, color: "green", reason: "No expiration." };
  const days = daysBetween(cert.expiresOn, nowIso.slice(0, 10));
  if (days < 0) return { cert, color: "red", reason: `Expired ${-days}d ago.` };
  if (days <= AMBER_DAYS) return { cert, color: "amber", reason: `Expires in ${days}d.` };
  return { cert, color: "green", reason: "Current." };
}

export interface InspectionStatus {
  latest: AmenityAnnualInspection | null;
  color: ComplianceColor;
  reason: string;
}

export function computeAnnualInspectionStatus(
  inspections: AmenityAnnualInspection[],
  nowIso: string,
): InspectionStatus {
  const passed = inspections
    .filter((i) => i.status === "passed" && i.performedOn)
    .sort((a, b) => (b.performedOn ?? "").localeCompare(a.performedOn ?? ""))[0] ?? null;
  if (!passed) {
    const scheduled = inspections.find((i) => i.status === "scheduled" || i.status === "in_progress");
    return {
      latest: scheduled ?? null,
      color: scheduled ? "amber" : "red",
      reason: scheduled ? "Inspection scheduled but not yet passed." : "No annual inspection on file.",
    };
  }
  const days = daysBetween(nowIso.slice(0, 10), passed.performedOn ?? passed.scheduledOn);
  if (days > 365) return { latest: passed, color: "red", reason: `Last passed ${days}d ago.` };
  if (days > 365 - AMBER_DAYS) return { latest: passed, color: "amber", reason: `Annual inspection due in ${365 - days}d.` };
  return { latest: passed, color: "green", reason: "Within annual cycle." };
}

export interface AmenityComplianceSummary {
  amenityId: number;
  amenitySlug: string;
  amenityName: string;
  overall: ComplianceColor;
  postings: PostingStatus[];
  certificates: CertStatus[];
  inspection: InspectionStatus;
  openIncidents: number;
  majorOpenIncidents: number;
}

export function rollupColor(colors: ComplianceColor[]): ComplianceColor {
  if (colors.includes("red")) return "red";
  if (colors.includes("amber")) return "amber";
  return "green";
}

export async function summarizeAmenityCompliance(
  amenity: Amenity,
  nowIso: string = new Date().toISOString(),
): Promise<AmenityComplianceSummary> {
  const postings = await db.select().from(amenityRequiredPostingsTable)
    .where(eq(amenityRequiredPostingsTable.amenityId, amenity.id))
    .orderBy(asc(amenityRequiredPostingsTable.sortOrder));
  const issuances = await db.select().from(amenityPostingIssuancesTable)
    .where(eq(amenityPostingIssuancesTable.amenityId, amenity.id));
  const certs = await db.select().from(amenityCertificatesTable)
    .where(eq(amenityCertificatesTable.amenityId, amenity.id));
  const inspections = await db.select().from(amenityAnnualInspectionsTable)
    .where(eq(amenityAnnualInspectionsTable.amenityId, amenity.id));
  const incidents = await db.select().from(amenityIncidentReportsTable)
    .where(eq(amenityIncidentReportsTable.amenityId, amenity.id));

  const postingStatuses = postings.map((p) => computePostingStatus(p, issuances, nowIso));
  const certStatuses = certs.map((c) => computeCertStatus(c, nowIso));
  const inspectionStatus = computeAnnualInspectionStatus(inspections, nowIso);
  const openIncidents = incidents.filter((i) => i.status !== "closed");
  const majorOpen = openIncidents.filter((i) => i.severity === "major");

  const colors: ComplianceColor[] = [
    ...postingStatuses.map((p) => p.color),
    ...certStatuses.map((c) => c.color),
    inspectionStatus.color,
    majorOpen.length > 0 ? "red" : openIncidents.length > 0 ? "amber" : "green",
  ];

  return {
    amenityId: amenity.id,
    amenitySlug: amenity.slug,
    amenityName: amenity.name,
    overall: rollupColor(colors),
    postings: postingStatuses,
    certificates: certStatuses,
    inspection: inspectionStatus,
    openIncidents: openIncidents.length,
    majorOpenIncidents: majorOpen.length,
  };
}

export async function summarizeAllAmenities(): Promise<AmenityComplianceSummary[]> {
  const amenities = await db.select().from(amenitiesTable).orderBy(asc(amenitiesTable.sortOrder));
  const out: AmenityComplianceSummary[] = [];
  for (const a of amenities) out.push(await summarizeAmenityCompliance(a));
  return out;
}

const MERGE_TOKENS = /\{\{\s*(\w+)\s*\}\}/g;

export function renderTemplate(body: string, tokens: Record<string, string>): string {
  return body.replace(MERGE_TOKENS, (_, key) => tokens[key] ?? "");
}
