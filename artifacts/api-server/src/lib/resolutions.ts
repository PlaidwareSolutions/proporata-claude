// Task #63: Board Resolutions Library — finalize hooks and PDF builder.
//
// Wired into routes/motions.ts → applyAdopted() so that when a motion of
// kind "resolution" or "rescind_resolution" is adopted, the matching
// resolution row is numbered (gap-free per year), its adopted PDF is
// generated and uploaded, and any rescind chain is reflected.

import { db } from "@workspace/db";
import {
  resolutionsTable,
  motionsTable,
  motionVotesTable,
  motionAttachmentsTable,
  organizationSettingsTable,
  type MotionVotingRule,
} from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { ObjectStorageService } from "./objectStorage.js";
import { describeRule } from "./motions.js";
import { logger } from "./logger.js";
import { buildCurrentSignatureBlockLines } from "./signatureBlock.js";
import { onResolutionAdoptedForOwners } from "./governance.js";

const storage = new ObjectStorageService();

export const RESOLUTION_CATEGORIES = [
  "architectural", "financial", "rules", "personnel", "emergency", "other",
] as const;
export type ResolutionCategory = typeof RESOLUTION_CATEGORIES[number];

export function isResolutionCategory(s: unknown): s is ResolutionCategory {
  return typeof s === "string" && (RESOLUTION_CATEGORIES as readonly string[]).includes(s);
}

function nowISO(): string { return new Date().toISOString(); }
function pad3(n: number): string { return n.toString().padStart(3, "0"); }

/**
 * Allocate the next number for a year inside a transaction. A
 * year-scoped advisory lock prevents two concurrent adoptions from
 * grabbing the same sequence.
 */
async function allocateNumber(year: number): Promise<{ seq: number; number: string }> {
  return db.transaction(async (tx) => {
    // Hash a stable key per year so concurrent finalizers serialize.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"resolutions:" + year}))`);
    const rows = await tx
      .select({ max: sql<number | null>`COALESCE(MAX(${resolutionsTable.numberSeq}), 0)` })
      .from(resolutionsTable)
      .where(eq(resolutionsTable.numberYear, year));
    const next = (rows[0]?.max ?? 0) + 1;
    return { seq: next, number: `${year}-${pad3(next)}` };
  });
}

/** Look up the resolution row attached to a motion, if any. */
export async function getResolutionByMotion(motionId: number) {
  const [row] = await db.select().from(resolutionsTable).where(eq(resolutionsTable.motionId, motionId));
  return row ?? null;
}

/**
 * Called when a motion of kind="resolution" reaches `adopted`.
 * Numbers the resolution and uploads its adopted PDF.
 */
export async function onResolutionMotionAdopted(motionId: number): Promise<void> {
  const res = await getResolutionByMotion(motionId);
  if (!res) return;
  if (res.number) return; // already numbered (idempotent)
  const adoptedAt = nowISO();
  const year = new Date(adoptedAt).getUTCFullYear();
  const { seq, number } = await allocateNumber(year);
  await db.update(resolutionsTable)
    .set({ number, numberYear: year, numberSeq: seq, adoptedAt })
    .where(eq(resolutionsTable.id, res.id));
  // Task #75: materialize "Effective" calendar event on the Board sub-calendar.
  try {
    const { materializeResolutionEffective } = await import("./calendarMaterialize.js");
    const [m] = await db.select().from(motionsTable).where(eq(motionsTable.id, motionId));
    await materializeResolutionEffective({ id: res.id, number, title: m?.title ?? "Resolution", adoptedAt });
  } catch (err) {
    logger.warn({ err, resolutionId: res.id }, "resolution effective-event materialization failed");
  }

  // Task #66: if the resolution is flagged public, fan out to owners and
  // post a public notice. Private resolutions skip this (board-only audit).
  try { await onResolutionAdoptedForOwners(res.id); }
  catch (err) { logger.warn({ err, resolutionId: res.id }, "owner-side resolution-adopted notify failed"); }

  // Build and upload PDF after numbering so it can include the official number.
  try {
    const pdf = await buildAdoptedResolutionPdf(res.id);
    if (pdf) {
      const uploadURL = await storage.getObjectEntityUploadURL();
      const objectPath = storage.normalizeObjectEntityPath(uploadURL);
      const put = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: pdf,
      });
      if (put.ok) {
        await db.update(resolutionsTable)
          .set({ pdfStorageKey: objectPath })
          .where(eq(resolutionsTable.id, res.id));
      } else {
        logger.warn({ status: put.status, resolutionId: res.id }, "resolution PDF upload failed");
      }
    }
  } catch (err) {
    logger.error({ err, resolutionId: res.id }, "resolution PDF generation failed (number still assigned)");
  }
}

/**
 * Called when a motion of kind="rescind_resolution" is adopted. The motion's
 * payload carries the target resolution id; we already linked the motion to
 * the resolution at create time, so the resolution's status flips automatically
 * once the motion is `adopted`. Nothing to do here besides log.
 */
export async function onRescindMotionAdopted(motionId: number): Promise<void> {
  const [m] = await db.select().from(motionsTable).where(eq(motionsTable.id, motionId));
  if (!m) return;
  const target = (m.payload as { targetResolutionId?: number } | null)?.targetResolutionId;
  if (!target) return;
  // Defensive: ensure the link is set (should already be set at create time).
  await db.update(resolutionsTable)
    .set({ rescindedByMotionId: motionId })
    .where(and(eq(resolutionsTable.id, target), sql`${resolutionsTable.rescindedByMotionId} IS NULL`));
  logger.info({ motionId, target }, "Rescind motion adopted");
}

// ── Resolution status derivation ────────────────────────────────────────────
export type ResolutionStatus = "draft" | "adopted" | "superseded" | "rescinded" | "rejected";

export async function deriveStatus(opts: {
  motionStatus: string;
  rescindedByMotionId: number | null;
  supersededByResolutionId: number | null;
}): Promise<ResolutionStatus> {
  if (opts.motionStatus === "draft" || opts.motionStatus === "open") return "draft";
  if (opts.motionStatus !== "adopted") return "rejected";
  if (opts.supersededByResolutionId) return "superseded";
  if (opts.rescindedByMotionId) {
    const [rm] = await db.select().from(motionsTable).where(eq(motionsTable.id, opts.rescindedByMotionId));
    if (rm?.status === "adopted") return "rescinded";
  }
  return "adopted";
}

// ── Adopted Resolution PDF builder ──────────────────────────────────────────
async function buildAdoptedResolutionPdf(resolutionId: number): Promise<Buffer | null> {
  const [res] = await db.select().from(resolutionsTable).where(eq(resolutionsTable.id, resolutionId));
  if (!res) return null;
  const [motion] = await db.select().from(motionsTable).where(eq(motionsTable.id, res.motionId));
  if (!motion) return null;
  const votes = await db.select().from(motionVotesTable).where(eq(motionVotesTable.motionId, motion.id));
  const attachments = await db.select().from(motionAttachmentsTable).where(eq(motionAttachmentsTable.motionId, motion.id));
  const [org] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  const orgName = org?.name ?? "HOA";
  const orgAddr = org?.address ?? "";

  const lines: Array<[string, number]> = [];
  lines.push([`${orgName}`, 16]);
  if (orgAddr) lines.push([orgAddr, 9]);
  lines.push([``, 6]);
  lines.push([`ADOPTED BOARD RESOLUTION`, 14]);
  lines.push([``, 4]);
  lines.push([`Resolution No. ${res.number}`, 12]);
  lines.push([`Category: ${res.category}`, 10]);
  lines.push([`Title: ${motion.title}`, 11]);
  lines.push([`Adopted on: ${(res.adoptedAt ?? "").slice(0, 10)}`, 10]);
  lines.push([`Voting rule: ${describeRule(motion.votingRule as MotionVotingRule)}`, 10]);
  lines.push([``, 6]);
  if (motion.body) {
    lines.push([`Resolved:`, 11]);
    for (const c of chunkText(motion.body, 92)) lines.push([c, 10]);
    lines.push([``, 4]);
  }
  if (attachments.length) {
    lines.push([`Attachments:`, 11]);
    for (const a of attachments) lines.push([` · ${a.name}`, 9]);
    lines.push([``, 4]);
  }
  const ap = votes.filter((v) => v.decision === "approve").length;
  const rj = votes.filter((v) => v.decision === "reject").length;
  const ab = votes.filter((v) => v.decision === "abstain").length;
  lines.push([`Tally: ${ap} approve · ${rj} reject · ${ab} abstain`, 10]);
  lines.push([``, 4]);
  lines.push([`Vote of record:`, 11]);
  for (const v of votes) {
    lines.push([` · ${v.userName}: ${v.decision} on ${v.createdAt.slice(0, 10)}${v.comment ? ` — ${v.comment}` : ""}`, 9]);
  }
  const sigDate = (res.adoptedAt ?? motion.createdAt).slice(0, 10);
  const signatureLines = await buildCurrentSignatureBlockLines(sigDate);
  for (const sl of signatureLines) lines.push(sl);

  return renderPdf(lines);
}

function renderPdf(lines: Array<[string, number]>): Buffer {
  const ops: string[] = ["BT", "/F1 16 Tf", "72 740 Td"];
  let first = true;
  for (const [t, sz] of lines) {
    if (first) { ops.push(`(${esc(t)}) Tj`); first = false; }
    else { ops.push(`/F1 ${sz} Tf`, "0 -16 Td", `(${esc(t)}) Tj`); }
  }
  ops.push("ET");
  const stream = ops.join("\n");
  const streamBytes = Buffer.from(stream, "latin1");
  const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`;
  const obj4 = `4 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream\nendobj\n`;
  const obj5 = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
  const header = `%PDF-1.4\n`;
  const offsets: number[] = [];
  let pos = header.length;
  const objects = [obj1, obj2, obj3, obj4, obj5];
  for (const o of objects) { offsets.push(pos); pos += Buffer.byteLength(o, "latin1"); }
  const xrefOffset = pos;
  const xref = [`xref\n`, `0 6\n`, `0000000000 65535 f \n`,
    ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  const trailer = `trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.concat([
    Buffer.from(header, "latin1"),
    ...objects.map((o) => Buffer.from(o, "latin1")),
    Buffer.from(xref, "latin1"),
    Buffer.from(trailer, "latin1"),
  ]);
}

function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").slice(0, 200);
}
function chunkText(s: string, n: number): string[] {
  const out: string[] = [];
  for (const para of s.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if ((line + " " + word).trim().length > n) { if (line) out.push(line); line = word; }
      else { line = line ? line + " " + word : word; }
    }
    if (line) out.push(line);
    out.push("");
  }
  return out;
}
