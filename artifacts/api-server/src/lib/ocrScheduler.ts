// OCR scheduler / worker. Polls `document_ocr_jobs` for queued rows, fetches
// the underlying object, calls the OCR provider, runs the heuristic
// suggestion pass, and writes the results back. Cooperative with the
// org-settings global toggle and daily page cap. When a job completes after
// its document has already been committed (preview → commit fast path), the
// scheduler back-fills `documents.extractedText` and the vendor suggestion
// onto the matching row by `storage_key` so search and tagging still work.

import { db } from "@workspace/db";
import {
  documentOcrJobsTable,
  documentsTable,
  organizationSettingsTable,
  vendorsTable,
  buildingsTable,
  unitsTable,
  type OcrJobStatus,
} from "@workspace/db/schema";
import { eq, and, sql, gte, isNull } from "drizzle-orm";
import { ObjectStorageService } from "./objectStorage.js";
import { extractText, estimatePages, canExtract } from "./ocrProvider.js";
import { runSuggestions, type OcrSuggestions } from "./ocrHeuristics.js";
import { logger } from "./logger.js";

const TICK_MS = 5_000;
const MAX_ATTEMPTS = 3;
// Exponential backoff: attempt 1 fail → 30s, attempt 2 fail → 2min.
const RETRY_BACKOFF_MS = [30_000, 120_000];

let running = false;

const storage = new ObjectStorageService();

export async function enqueueOcrJob(args: {
  storageKey: string;
  fileName: string;
  contentType: string | null;
  enqueuedBy: number | null;
}): Promise<void> {
  const now = new Date().toISOString();
  // Idempotent — keyed on storage_key (unique).
  await db
    .insert(documentOcrJobsTable)
    .values({
      storageKey: args.storageKey,
      fileName: args.fileName,
      contentType: args.contentType,
      status: "queued",
      enqueuedBy: args.enqueuedBy,
      createdAt: now,
    })
    .onConflictDoNothing({ target: documentOcrJobsTable.storageKey });
}

export async function getOcrJobsByStorageKeys(keys: string[]) {
  if (keys.length === 0) return [];
  return db
    .select()
    .from(documentOcrJobsTable)
    .where(sql`${documentOcrJobsTable.storageKey} = ANY(${keys})`);
}

interface OrgOcrSettings { enabled: boolean; dailyPageCap: number }

async function loadOrgOcrSettings(): Promise<OrgOcrSettings> {
  const [row] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  return {
    enabled: row?.ocrEnabled ?? true,
    dailyPageCap: row?.ocrDailyPageCap ?? 1000,
  };
}

async function pagesProcessedToday(): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const since = startOfDay.toISOString();
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${documentOcrJobsTable.pageCount}), 0)` })
    .from(documentOcrJobsTable)
    .where(and(eq(documentOcrJobsTable.status, "completed"), gte(documentOcrJobsTable.completedAt, since)));
  return Number(row?.total ?? 0);
}

async function listEligibleJobs(): Promise<Array<{ id: number; storageKey: string; contentType: string | null }>> {
  const candidates = await db
    .select({
      id: documentOcrJobsTable.id,
      storageKey: documentOcrJobsTable.storageKey,
      contentType: documentOcrJobsTable.contentType,
      attempts: documentOcrJobsTable.attempts,
      startedAt: documentOcrJobsTable.startedAt,
    })
    .from(documentOcrJobsTable)
    .where(eq(documentOcrJobsTable.status, "queued"))
    .orderBy(documentOcrJobsTable.id)
    .limit(20);
  const nowMs = Date.now();
  return candidates.filter((c) => {
    if (!c.attempts || c.attempts === 0 || !c.startedAt) return true;
    const last = Date.parse(c.startedAt);
    if (!Number.isFinite(last)) return true;
    const ms = RETRY_BACKOFF_MS[Math.min(c.attempts, RETRY_BACKOFF_MS.length) - 1] ?? 0;
    return nowMs - last >= ms;
  });
}

async function claimJobById(id: number): Promise<boolean> {
  const now = new Date().toISOString();
  const updated = await db
    .update(documentOcrJobsTable)
    .set({ status: "processing", startedAt: now, attempts: sql`${documentOcrJobsTable.attempts} + 1` })
    .where(and(eq(documentOcrJobsTable.id, id), eq(documentOcrJobsTable.status, "queued")))
    .returning({ id: documentOcrJobsTable.id });
  return updated.length > 0;
}

async function loadHeuristicContext() {
  const [vendors, buildings, units] = await Promise.all([
    db.select({ id: vendorsTable.id, name: vendorsTable.name }).from(vendorsTable),
    db.select({ num: buildingsTable.num, address: buildingsTable.address, street: buildingsTable.street }).from(buildingsTable),
    db.select({ id: unitsTable.id, building: unitsTable.building, unit: unitsTable.unit, address: unitsTable.address }).from(unitsTable),
  ]);
  return { vendors, buildings, units };
}

function setStatus(
  id: number,
  status: OcrJobStatus,
  patch: Partial<typeof documentOcrJobsTable.$inferInsert> = {},
) {
  return db
    .update(documentOcrJobsTable)
    .set({ status, ...patch })
    .where(eq(documentOcrJobsTable.id, id));
}

async function processJob(
  id: number,
  ctx: Awaited<ReturnType<typeof loadHeuristicContext>>,
  prefetched?: { bytes: Buffer; pageCount: number },
) {
  const [job] = await db.select().from(documentOcrJobsTable).where(eq(documentOcrJobsTable.id, id));
  if (!job) return;

  try {
    if (!canExtract(job.contentType)) {
      await setStatus(id, "skipped", {
        completedAt: new Date().toISOString(),
        lastError: `Unsupported content type: ${job.contentType ?? "unknown"}`,
      });
      return;
    }

    let bytes: Buffer;
    if (prefetched) {
      bytes = prefetched.bytes;
    } else {
      try {
        const file = await storage.getObjectEntityFile(job.storageKey);
        const [buf] = await file.download();
        bytes = buf;
      } catch (err) {
        throw new Error(`Could not download object: ${(err as Error).message}`);
      }
    }

    const result = await extractText({
      storageKey: job.storageKey,
      fileName: job.fileName,
      contentType: job.contentType,
      bytes,
    });

    if (!result) {
      await setStatus(id, "skipped", {
        completedAt: new Date().toISOString(),
        lastError: `Unsupported content type: ${job.contentType ?? "unknown"}`,
      });
      return;
    }

    const suggestions: OcrSuggestions = runSuggestions({
      text: result.text,
      vendors: ctx.vendors,
      buildings: ctx.buildings,
      units: ctx.units,
    });

    // Prefer the preflight page count (used to gate the daily cap) over
    // the provider's reported pageCount, so accounting matches what we
    // budgeted before dispatch.
    const finalPageCount = prefetched?.pageCount ?? result.pageCount;
    await setStatus(id, "completed", {
      completedAt: new Date().toISOString(),
      fullText: result.text,
      pageCount: finalPageCount,
      suggestions,
      lastError: null,
    });

    // Back-fill any document(s) committed against this storage key while the
    // job was still running. We only touch fields the manager left blank so
    // that explicit overrides at commit time are never overwritten.
    await db
      .update(documentsTable)
      .set({ extractedText: result.text })
      .where(and(eq(documentsTable.storageKey, job.storageKey), isNull(documentsTable.extractedText)));
    const vendorVal = suggestions.vendor?.value;
    if (typeof vendorVal === "number") {
      await db
        .update(documentsTable)
        .set({ vendorId: vendorVal })
        .where(and(eq(documentsTable.storageKey, job.storageKey), isNull(documentsTable.vendorId)));
    }
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 500) ?? "OCR failed";
    const attempts = (job.attempts ?? 0); // already incremented at claim time
    if (attempts >= MAX_ATTEMPTS) {
      await setStatus(id, "failed", {
        completedAt: new Date().toISOString(),
        lastError: msg,
      });
    } else {
      // Re-queue for backoff retry.
      await setStatus(id, "queued", { lastError: msg });
    }
    logger.warn({ err, jobId: id }, "OCR job failed");
  }
}

export async function tickOcrScheduler(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const settings = await loadOrgOcrSettings();
    if (!settings.enabled) return;
    const ctx = await loadHeuristicContext();

    // Hard daily cap: pre-count pages per job and only dispatch a job when
    // it fits within the remaining budget. Jobs that exceed the budget are
    // left queued for the next UTC day. We process serially within the
    // tick so the budget can't be exceeded by concurrent dispatches.
    const eligible = await listEligibleJobs();
    for (const cand of eligible) {
      const used = await pagesProcessedToday();
      const remaining = settings.dailyPageCap - used;
      if (remaining <= 0) {
        logger.info({ used, cap: settings.dailyPageCap }, "OCR daily page cap reached");
        break;
      }

      let bytes: Buffer;
      try {
        const file = await storage.getObjectEntityFile(cand.storageKey);
        const [buf] = await file.download();
        bytes = buf;
      } catch (err) {
        logger.warn({ err, jobId: cand.id }, "OCR preflight download failed");
        continue;
      }

      const pages = await estimatePages({
        storageKey: cand.storageKey,
        fileName: "",
        contentType: cand.contentType,
        bytes,
      });
      if (pages > remaining) {
        logger.info(
          { jobId: cand.id, pages, remaining, cap: settings.dailyPageCap },
          "OCR job deferred — would exceed daily page cap",
        );
        continue;
      }

      const claimed = await claimJobById(cand.id);
      if (!claimed) continue;
      await processJob(cand.id, ctx, { bytes, pageCount: pages });
    }
  } catch (err) {
    logger.error({ err }, "OCR scheduler tick failed");
  } finally {
    running = false;
  }
}

export function startOcrScheduler(): void {
  // Kick off immediately, then every TICK_MS.
  tickOcrScheduler();
  setInterval(tickOcrScheduler, TICK_MS);
  logger.info("OCR scheduler started");
}
