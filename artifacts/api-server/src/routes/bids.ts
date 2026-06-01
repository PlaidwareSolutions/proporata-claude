import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  bidRequestsTable,
  bidScopeItemsTable,
  bidInvitationsTable,
  bidQuotesTable,
  bidQuoteLinesTable,
  bidAttachmentsTable,
  vendorsTable,
  workOrdersTable,
  workOrderAttachmentsTable,
  notificationsTable,
  organizationSettingsTable,
  usersTable,
  workOrderEventsTable,
  resolutionsTable,
  motionsTable,
} from "@workspace/db/schema";
import { eq, and, desc, ne, asc, inArray } from "drizzle-orm";
import { authenticateJwt, requireManager } from "../middleware/auth.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { Readable } from "stream";
import { sendEmail, buildBidInviteEmail, buildBidThankYouEmail } from "../lib/email.js";
import crypto from "crypto";
import { logger } from "../lib/logger.js";
import { buildCurrentSignatureBlockLines } from "../lib/signatureBlock.js";
import { syncAutoCalendarEvents } from "../lib/calendarAutoEvents.js";
import {
  loadGovernanceSettings,
  validateMotionAuthorizes,
  findUnconsumedBypassFor,
  findPendingMotionFor,
  gateRequiredError,
  markBypassConsumed,
} from "../lib/motionGates.js";

const router: IRouter = Router();
const storage = new ObjectStorageService();

const TERMINAL = new Set(["awarded", "cancelled"]);

function nowISO() { return new Date().toISOString(); }

function genToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function nextWorkOrderId(): Promise<string> {
  const all = await db.select({ id: workOrdersTable.id }).from(workOrdersTable);
  const maxN = all.reduce((m, r) => {
    const match = r.id.match(/^WO-(\d+)$/);
    return match ? Math.max(m, parseInt(match[1]!, 10)) : m;
  }, 0);
  return `WO-${String(maxN + 1).padStart(3, "0")}`;
}

type ResolutionMeta = {
  number: string | null;
  title: string | null;
  status: "adopted" | "superseded" | "rescinded";
};

async function loadResolutionMeta(id: number | null | undefined): Promise<ResolutionMeta | null> {
  if (id == null) return null;
  const [r] = await db.select({
    id: resolutionsTable.id,
    number: resolutionsTable.number,
    supersededByResolutionId: resolutionsTable.supersededByResolutionId,
    rescindedByMotionId: resolutionsTable.rescindedByMotionId,
    motionId: resolutionsTable.motionId,
  }).from(resolutionsTable).where(eq(resolutionsTable.id, id));
  if (!r) return null;
  let title: string | null = null;
  if (r.motionId) {
    const [m] = await db.select({ title: motionsTable.title }).from(motionsTable).where(eq(motionsTable.id, r.motionId));
    title = m?.title ?? null;
  }
  let status: ResolutionMeta["status"] = "adopted";
  if (r.rescindedByMotionId) status = "rescinded";
  else if (r.supersededByResolutionId) status = "superseded";
  return { number: r.number ?? null, title, status };
}

function toBid(r: typeof bidRequestsTable.$inferSelect, resolution?: ResolutionMeta | null) {
  return {
    id: r.id,
    title: r.title,
    scope: r.scope,
    buildingNum: r.buildingNum ?? null,
    unitId: r.unitId ?? null,
    tradeCategory: r.tradeCategory,
    status: r.status,
    deadline: r.deadline,
    sealedBids: r.sealedBids,
    sealedOpenedAt: r.sealedOpenedAt ?? null,
    notifyNonAwarded: r.notifyNonAwarded,
    createdBy: r.createdBy ?? null,
    createdByName: r.createdByName,
    createdAt: r.createdAt,
    awardedVendorId: r.awardedVendorId ?? null,
    awardedAt: r.awardedAt ?? null,
    awardRationale: r.awardRationale ?? null,
    awardMemoStorageKey: r.awardMemoStorageKey ?? null,
    awardedWorkOrderId: r.awardedWorkOrderId ?? null,
    sourceWorkOrderId: r.sourceWorkOrderId ?? null,
    resolutionId: r.resolutionId ?? null,
    resolutionNumber: resolution?.number ?? null,
    resolutionTitle: resolution?.title ?? null,
    resolutionStatus: resolution?.status ?? null,
    awardMotionId: r.awardMotionId ?? null,
    awardEmergencyBypassId: r.awardEmergencyBypassId ?? null,
  };
}

async function getOrg() {
  const [s] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  return s;
}

async function notifyManagers(message: string, bidId: number) {
  const managers = await db.select().from(usersTable).where(ne(usersTable.role, "resident"));
  const created = nowISO();
  for (const u of managers) {
    if (u.pending) continue;
    await db.insert(notificationsTable).values({
      userId: u.id,
      type: "bid_update",
      message,
      entityType: "bid_request",
      entityId: String(bidId),
      read: false,
      createdAt: created,
    });
  }
}

function isSealedActive(bid: typeof bidRequestsTable.$inferSelect): boolean {
  if (!bid.sealedBids) return false;
  if (bid.sealedOpenedAt) return false;
  if (bid.status === "awarded") return false;
  // Sealed remains until deadline passes OR opened early.
  const deadlineMs = new Date(bid.deadline).getTime();
  if (!isNaN(deadlineMs) && Date.now() > deadlineMs) return false;
  return true;
}

// ── List ──
router.get("/bids", async (req, res) => {
  try {
    const status = (req.query.status as string | undefined) ?? undefined;
    const rows = status
      ? await db.select().from(bidRequestsTable).where(eq(bidRequestsTable.status, status)).orderBy(desc(bidRequestsTable.createdAt))
      : await db.select().from(bidRequestsTable).orderBy(desc(bidRequestsTable.createdAt));

    const ids = rows.map((r) => r.id);
    const invs = ids.length
      ? await db.select().from(bidInvitationsTable).where(inArray(bidInvitationsTable.bidRequestId, ids))
      : [];
    const counts = new Map<number, { invited: number; submitted: number }>();
    for (const r of rows) counts.set(r.id, { invited: 0, submitted: 0 });
    for (const i of invs) {
      const c = counts.get(i.bidRequestId)!;
      c.invited += 1;
      if (i.status === "submitted") c.submitted += 1;
    }
    const resIds = Array.from(new Set(rows.map((r) => r.resolutionId).filter((x): x is number => typeof x === "number")));
    const resMetas = new Map<number, ResolutionMeta>();
    for (const rid of resIds) {
      const m = await loadResolutionMeta(rid);
      if (m) resMetas.set(rid, m);
    }
    res.json(rows.map((r) => ({
      ...toBid(r, r.resolutionId != null ? resMetas.get(r.resolutionId) ?? null : null),
      invitedCount: counts.get(r.id)?.invited ?? 0,
      submittedCount: counts.get(r.id)?.submitted ?? 0,
    })));
  } catch (err) {
    req.log.error({ err }, "GET /bids failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Create draft ──
interface CreateBidBody {
  title?: string;
  scope?: string;
  buildingNum?: number | null;
  unitId?: string | null;
  tradeCategory?: string;
  deadline?: string;
  sealedBids?: boolean;
  notifyNonAwarded?: boolean;
  sourceWorkOrderId?: string | null;
  resolutionId?: number | null;
  scopeItems?: Array<{ label: string; notes?: string | null }>;
}

router.post("/bids", async (req, res) => {
  const body = req.body as CreateBidBody;
  if (!body?.title?.trim() || !body?.tradeCategory?.trim() || !body?.deadline) {
    res.status(400).json({ error: "title, tradeCategory, and deadline are required" }); return;
  }
  try {
    const settings = await getOrg();
    const sealedDefault = settings?.bidDefaultSealed ?? false;
    const [created] = await db.insert(bidRequestsTable).values({
      title: body.title.trim(),
      scope: body.scope?.trim() ?? "",
      buildingNum: body.buildingNum ?? null,
      unitId: body.unitId ?? null,
      tradeCategory: body.tradeCategory.trim(),
      status: "draft",
      deadline: body.deadline,
      sealedBids: body.sealedBids ?? sealedDefault,
      notifyNonAwarded: body.notifyNonAwarded ?? true,
      createdBy: req.user!.id,
      createdByName: req.user!.name || req.user!.email,
      createdAt: nowISO(),
      sourceWorkOrderId: body.sourceWorkOrderId ?? null,
      resolutionId: body.resolutionId ?? null,
    }).returning();

    if (Array.isArray(body.scopeItems)) {
      for (let i = 0; i < body.scopeItems.length; i++) {
        const it = body.scopeItems[i]!;
        if (!it.label?.trim()) continue;
        await db.insert(bidScopeItemsTable).values({
          bidRequestId: created!.id,
          sortOrder: i,
          label: it.label.trim(),
          notes: it.notes ?? null,
        });
      }
    }
    const meta = await loadResolutionMeta(created!.resolutionId);
    // Task #75: materialize bid lifecycle milestones on the Operations calendar.
    try {
      const { materializeBidMilestones } = await import("../lib/calendarMaterialize.js");
      await materializeBidMilestones({
        id: created!.id, title: created!.title, status: created!.status,
        createdAt: created!.createdAt, deadline: created!.deadline,
        awardedAt: created!.awardedAt, awardedVendorName: null,
      });
    } catch (err) { req.log.warn({ err }, "calendar materialize bid failed"); }
    res.status(201).json(toBid(created!, meta));
  } catch (err) {
    req.log.error({ err }, "POST /bids failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

async function loadBid(id: number) {
  const [r] = await db.select().from(bidRequestsTable).where(eq(bidRequestsTable.id, id));
  return r;
}

// ── Detail (with comparison data) ──
router.get("/bids/:id", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const bid = await loadBid(id);
    if (!bid) { res.status(404).json({ error: "Not found" }); return; }
    const items = await db.select().from(bidScopeItemsTable)
      .where(eq(bidScopeItemsTable.bidRequestId, id))
      .orderBy(asc(bidScopeItemsTable.sortOrder), asc(bidScopeItemsTable.id));
    const invs = await db.select().from(bidInvitationsTable).where(eq(bidInvitationsTable.bidRequestId, id));
    const vendorIds = invs.map((i) => i.vendorId);
    const vendors = vendorIds.length
      ? await db.select().from(vendorsTable).where(inArray(vendorsTable.id, vendorIds))
      : [];
    const vmap = new Map(vendors.map((v) => [v.id, v]));
    const quotes = await db.select().from(bidQuotesTable).where(eq(bidQuotesTable.bidRequestId, id));
    const quoteIds = quotes.map((q) => q.id);
    const lines = quoteIds.length
      ? await db.select().from(bidQuoteLinesTable).where(inArray(bidQuoteLinesTable.bidQuoteId, quoteIds))
      : [];
    const attachments = await db.select().from(bidAttachmentsTable).where(eq(bidAttachmentsTable.bidRequestId, id));

    const sealed = isSealedActive(bid);

    const quotesPayload = quotes.map((q) => {
      const vendor = vmap.get(q.vendorId);
      const ls = lines.filter((l) => l.bidQuoteId === q.id);
      return {
        id: q.id,
        bidRequestId: q.bidRequestId,
        vendorId: q.vendorId,
        vendorName: vendor?.name ?? "(unknown)",
        invitationId: q.invitationId ?? null,
        leadTimeDays: q.leadTimeDays ?? null,
        paymentTerms: q.paymentTerms ?? null,
        warrantyText: q.warrantyText ?? null,
        notes: q.notes ?? null,
        // While sealed, do not even reveal whether documents exist — quote PDFs
        // typically contain prices and would leak sealed-bid contents to managers
        // who could otherwise stream them via the manager doc endpoint.
        licenseStorageKey: sealed ? null : (q.licenseStorageKey ?? null),
        coiStorageKey: sealed ? null : (q.coiStorageKey ?? null),
        quotePdfStorageKey: sealed ? null : (q.quotePdfStorageKey ?? null),
        enteredByManager: q.enteredByManager,
        firmConfirmation: q.firmConfirmation,
        totalCents: sealed ? null : q.totalCents,
        submittedAt: q.submittedAt,
        lines: ls.map((l) => ({
          scopeItemId: l.scopeItemId,
          amountCents: sealed ? null : l.amountCents,
        })),
      };
    });

    const invsPayload = invs.map((i) => ({
      id: i.id,
      vendorId: i.vendorId,
      vendorName: vmap.get(i.vendorId)?.name ?? "(unknown)",
      vendorEmail: vmap.get(i.vendorId)?.email ?? null,
      status: i.status,
      invitedAt: i.invitedAt,
      viewedAt: i.viewedAt ?? null,
      submittedAt: i.submittedAt ?? null,
      declinedAt: i.declinedAt ?? null,
      tokenExpiresAt: i.tokenExpiresAt,
    }));

    const resolution = await loadResolutionMeta(bid.resolutionId);
    res.json({
      ...toBid(bid, resolution),
      sealedActive: sealed,
      scopeItems: items.map((it) => ({ id: it.id, sortOrder: it.sortOrder, label: it.label, notes: it.notes ?? null })),
      invitations: invsPayload,
      quotes: quotesPayload,
      attachments: attachments.map((a) => ({
        id: a.id, name: a.name, size: a.size, contentType: a.contentType ?? null,
        storageKey: a.storageKey, kind: a.kind, uploadedByName: a.uploadedByName, uploadedAt: a.uploadedAt,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "GET /bids/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Patch (draft only) ──
router.patch("/bids/:id", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const bid = await loadBid(id);
  if (!bid) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body as Partial<CreateBidBody>;
  const updates: Partial<typeof bidRequestsTable.$inferInsert> = {};
  // Most fields are draft-only — scope, deadline, vendor settings, etc.
  if (bid.status === "draft") {
    if (body.title !== undefined) updates.title = String(body.title);
    if (body.scope !== undefined) updates.scope = String(body.scope);
    if (body.buildingNum !== undefined) updates.buildingNum = body.buildingNum;
    if (body.unitId !== undefined) updates.unitId = body.unitId;
    if (body.tradeCategory !== undefined) updates.tradeCategory = String(body.tradeCategory);
    if (body.deadline !== undefined) updates.deadline = String(body.deadline);
    if (body.sealedBids !== undefined) updates.sealedBids = !!body.sealedBids;
    if (body.notifyNonAwarded !== undefined) updates.notifyNonAwarded = !!body.notifyNonAwarded;
  }
  // Linking a board resolution is allowed at any time so managers can attach the
  // adopting resolution after award (or reattach when a newer one supersedes).
  if (body.resolutionId !== undefined) updates.resolutionId = body.resolutionId ?? null;
  if (Object.keys(updates).length === 0) {
    if (bid.status !== "draft") { res.status(409).json({ error: "Only draft bids can be edited" }); return; }
  }
  await db.update(bidRequestsTable).set(updates).where(eq(bidRequestsTable.id, id));
  const [u] = await db.select().from(bidRequestsTable).where(eq(bidRequestsTable.id, id));
  const meta = await loadResolutionMeta(u!.resolutionId);
  // Task #75: re-materialize bid milestones (deadline may have moved).
  try {
    const { materializeBidMilestones } = await import("../lib/calendarMaterialize.js");
    await materializeBidMilestones({
      id: u!.id, title: u!.title, status: u!.status,
      createdAt: u!.createdAt, deadline: u!.deadline,
      awardedAt: u!.awardedAt, awardedVendorName: null,
    });
  } catch (err) { req.log.warn({ err }, "calendar materialize bid failed"); }
  res.json(toBid(u!, meta));
});

// ── Scope items ──
router.post("/bids/:id/scope-items", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const bid = await loadBid(id);
  if (!bid) { res.status(404).json({ error: "Not found" }); return; }
  if (bid.status !== "draft") { res.status(409).json({ error: "Scope items only editable while draft" }); return; }
  const body = req.body as { label?: string; notes?: string | null };
  if (!body.label?.trim()) { res.status(400).json({ error: "label is required" }); return; }
  const existing = await db.select().from(bidScopeItemsTable).where(eq(bidScopeItemsTable.bidRequestId, id));
  const [created] = await db.insert(bidScopeItemsTable).values({
    bidRequestId: id,
    sortOrder: existing.length,
    label: body.label.trim(),
    notes: body.notes ?? null,
  }).returning();
  res.status(201).json({ id: created!.id, label: created!.label, notes: created!.notes ?? null, sortOrder: created!.sortOrder });
});

router.delete("/bids/scope-items/:itemId", async (req, res) => {
  const itemId = parseInt(req.params.itemId as string, 10);
  if (isNaN(itemId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [item] = await db.select().from(bidScopeItemsTable).where(eq(bidScopeItemsTable.id, itemId));
  if (!item) { res.status(404).json({ error: "Not found" }); return; }
  const bid = await loadBid(item.bidRequestId);
  if (bid?.status !== "draft") { res.status(409).json({ error: "Only draft bids editable" }); return; }
  await db.delete(bidScopeItemsTable).where(eq(bidScopeItemsTable.id, itemId));
  res.status(204).send();
});

// ── Invite vendors ──
router.post("/bids/:id/invitations", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const bid = await loadBid(id);
  if (!bid) { res.status(404).json({ error: "Not found" }); return; }
  if (bid.status === "awarded" || bid.status === "cancelled") { res.status(409).json({ error: "Bid is closed" }); return; }
  const body = req.body as { vendorIds?: number[] };
  if (!Array.isArray(body.vendorIds) || body.vendorIds.length === 0) {
    res.status(400).json({ error: "vendorIds required" }); return;
  }
  const created: Array<{ vendorId: number; magicLink: string }> = [];
  const protocol = req.headers["x-forwarded-proto"] ?? req.protocol;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const baseUrl = `${protocol}://${host}`;
  for (const vendorId of body.vendorIds) {
    const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, vendorId));
    if (!vendor) continue;
    // Skip if already invited (regenerate token instead)
    const [existing] = await db.select().from(bidInvitationsTable)
      .where(and(eq(bidInvitationsTable.bidRequestId, id), eq(bidInvitationsTable.vendorId, vendorId)));
    const { raw, hash } = genToken();
    if (existing) {
      await db.update(bidInvitationsTable).set({
        tokenHash: hash,
        tokenExpiresAt: bid.deadline,
        status: existing.status === "submitted" ? existing.status : "invited",
        invitedAt: nowISO(),
      }).where(eq(bidInvitationsTable.id, existing.id));
    } else {
      await db.insert(bidInvitationsTable).values({
        bidRequestId: id,
        vendorId,
        tokenHash: hash,
        tokenExpiresAt: bid.deadline,
        status: "invited",
        invitedAt: nowISO(),
      });
    }
    const settings = await getOrg();
    const magicLink = `${baseUrl}/quote/${raw}`;
    if (bid.status !== "draft") {
      await sendEmail(vendor.email, `Bid request: ${bid.title}`, buildBidInviteEmail({
        orgName: settings?.name ?? "HOA",
        bidTitle: bid.title,
        deadline: bid.deadline,
        link: magicLink,
        vendorName: vendor.name,
      }));
    }
    created.push({ vendorId, magicLink });
  }
  res.status(201).json({ invitations: created });
});

// ── Send (transition draft → open and dispatch invites) ──
router.post("/bids/:id/send", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const bid = await loadBid(id);
  if (!bid) { res.status(404).json({ error: "Not found" }); return; }
  if (bid.status !== "draft") { res.status(409).json({ error: "Only draft bids can be sent" }); return; }
  const items = await db.select().from(bidScopeItemsTable).where(eq(bidScopeItemsTable.bidRequestId, id));
  if (items.length === 0) { res.status(400).json({ error: "Add at least one scope item before sending" }); return; }
  const invs = await db.select().from(bidInvitationsTable).where(eq(bidInvitationsTable.bidRequestId, id));
  if (invs.length === 0) { res.status(400).json({ error: "Invite at least one vendor before sending" }); return; }
  await db.update(bidRequestsTable).set({ status: "open" }).where(eq(bidRequestsTable.id, id));
  // Dispatch emails for all invitations (regenerate tokens so vendors get fresh links)
  const protocol = req.headers["x-forwarded-proto"] ?? req.protocol;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const baseUrl = `${protocol}://${host}`;
  const settings = await getOrg();
  const links: Array<{ vendorId: number; magicLink: string }> = [];
  for (const inv of invs) {
    const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, inv.vendorId));
    if (!vendor) continue;
    const { raw, hash } = genToken();
    await db.update(bidInvitationsTable).set({
      tokenHash: hash,
      tokenExpiresAt: bid.deadline,
      invitedAt: nowISO(),
      status: inv.status === "submitted" ? inv.status : "invited",
    }).where(eq(bidInvitationsTable.id, inv.id));
    const magicLink = `${baseUrl}/quote/${raw}`;
    await sendEmail(vendor.email, `Bid request: ${bid.title}`, buildBidInviteEmail({
      orgName: settings?.name ?? "HOA",
      bidTitle: bid.title,
      deadline: bid.deadline,
      link: magicLink,
      vendorName: vendor.name,
    }));
    links.push({ vendorId: inv.vendorId, magicLink });
  }
  // Fire-and-forget: refresh the auto-populated "Bid opened" / "Bid closes"
  // calendar events so they appear immediately rather than on next hourly tick.
  void syncAutoCalendarEvents();
  res.json({ ok: true, status: "open", links });
});

// ── Manager-fallback quote entry ──
router.post("/bids/:id/manager-quote", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const bid = await loadBid(id);
  if (!bid) { res.status(404).json({ error: "Not found" }); return; }
  if (TERMINAL.has(bid.status)) { res.status(409).json({ error: "Bid is closed" }); return; }
  const body = req.body as {
    vendorId: number;
    leadTimeDays?: number;
    paymentTerms?: string;
    warrantyText?: string;
    notes?: string;
    quotePdfStorageKey?: string;
    licenseStorageKey?: string;
    coiStorageKey?: string;
    lines: Array<{ scopeItemId: number; amountCents: number }>;
  };
  if (!body?.vendorId || !Array.isArray(body.lines)) {
    res.status(400).json({ error: "vendorId and lines required" }); return;
  }
  try {
    await upsertQuote({
      bid,
      vendorId: body.vendorId,
      leadTimeDays: body.leadTimeDays ?? null,
      paymentTerms: body.paymentTerms ?? null,
      warrantyText: body.warrantyText ?? null,
      notes: body.notes ?? null,
      quotePdfStorageKey: body.quotePdfStorageKey ?? null,
      licenseStorageKey: body.licenseStorageKey ?? null,
      coiStorageKey: body.coiStorageKey ?? null,
      enteredByManager: true,
      firmConfirmation: true,
      lines: body.lines,
    });
  } catch (err) {
    if (err instanceof QuoteValidationError) {
      res.status(400).json({ error: err.message }); return;
    }
    throw err;
  }
  res.status(201).json({ ok: true });
});

export class QuoteValidationError extends Error {
  constructor(msg: string) { super(msg); this.name = "QuoteValidationError"; }
}

export async function upsertQuote(args: {
  bid: typeof bidRequestsTable.$inferSelect;
  vendorId: number;
  invitationId?: number | null;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  warrantyText: string | null;
  notes: string | null;
  quotePdfStorageKey: string | null;
  licenseStorageKey: string | null;
  coiStorageKey: string | null;
  enteredByManager: boolean;
  firmConfirmation: boolean;
  lines: Array<{ scopeItemId: number; amountCents: number }>;
}) {
  const items = await db.select().from(bidScopeItemsTable).where(eq(bidScopeItemsTable.bidRequestId, args.bid.id));
  if (items.length === 0) {
    throw new QuoteValidationError("Bid has no scope items to price");
  }
  const itemIds = new Set(items.map((i) => i.id));

  // Strict validation: every scope item must have exactly one line with a
  // non-negative integer-cent amount. No silent filtering — incomplete or
  // malformed quotes are rejected so they can never appear "lowest" simply
  // because missing rows defaulted to $0.
  const seen = new Set<number>();
  for (const l of args.lines) {
    if (!itemIds.has(l.scopeItemId)) {
      throw new QuoteValidationError(`Line references unknown scope item ${l.scopeItemId}`);
    }
    if (seen.has(l.scopeItemId)) {
      throw new QuoteValidationError(`Duplicate line for scope item ${l.scopeItemId}`);
    }
    seen.add(l.scopeItemId);
    if (typeof l.amountCents !== "number" || !Number.isFinite(l.amountCents)) {
      throw new QuoteValidationError(`Line for scope item ${l.scopeItemId} is missing a numeric amount`);
    }
    if (!Number.isInteger(l.amountCents) || l.amountCents < 0) {
      throw new QuoteValidationError(`Line for scope item ${l.scopeItemId} must be a non-negative integer (cents)`);
    }
  }
  for (const it of items) {
    if (!seen.has(it.id)) {
      throw new QuoteValidationError(`Missing price for scope item: ${it.label}`);
    }
  }

  const total = args.lines.reduce((s, l) => s + l.amountCents, 0);
  const submittedAt = nowISO();

  // Wrap the entire quote write (header + lines + invitation status) in a
  // single transaction so a mid-operation failure cannot leave a quote with
  // partial or no line items.
  const quoteId = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(bidQuotesTable)
      .where(and(eq(bidQuotesTable.bidRequestId, args.bid.id), eq(bidQuotesTable.vendorId, args.vendorId)));
    let qid: number;
    if (existing) {
      await tx.update(bidQuotesTable).set({
        invitationId: args.invitationId ?? existing.invitationId,
        leadTimeDays: args.leadTimeDays,
        paymentTerms: args.paymentTerms,
        warrantyText: args.warrantyText,
        notes: args.notes,
        quotePdfStorageKey: args.quotePdfStorageKey ?? existing.quotePdfStorageKey,
        licenseStorageKey: args.licenseStorageKey ?? existing.licenseStorageKey,
        coiStorageKey: args.coiStorageKey ?? existing.coiStorageKey,
        enteredByManager: args.enteredByManager,
        firmConfirmation: args.firmConfirmation,
        totalCents: total,
        submittedAt,
      }).where(eq(bidQuotesTable.id, existing.id));
      qid = existing.id;
      await tx.delete(bidQuoteLinesTable).where(eq(bidQuoteLinesTable.bidQuoteId, qid));
    } else {
      const [q] = await tx.insert(bidQuotesTable).values({
        bidRequestId: args.bid.id,
        vendorId: args.vendorId,
        invitationId: args.invitationId ?? null,
        leadTimeDays: args.leadTimeDays,
        paymentTerms: args.paymentTerms,
        warrantyText: args.warrantyText,
        notes: args.notes,
        quotePdfStorageKey: args.quotePdfStorageKey,
        licenseStorageKey: args.licenseStorageKey,
        coiStorageKey: args.coiStorageKey,
        enteredByManager: args.enteredByManager,
        firmConfirmation: args.firmConfirmation,
        totalCents: total,
        submittedAt,
      }).returning();
      qid = q!.id;
    }
    for (const l of args.lines) {
      await tx.insert(bidQuoteLinesTable).values({
        bidQuoteId: qid,
        scopeItemId: l.scopeItemId,
        amountCents: l.amountCents,
      });
    }
    // Update invitation status atomically with the quote write.
    if (args.invitationId) {
      await tx.update(bidInvitationsTable).set({ status: "submitted", submittedAt })
        .where(eq(bidInvitationsTable.id, args.invitationId));
    } else {
      const [inv] = await tx.select().from(bidInvitationsTable)
        .where(and(eq(bidInvitationsTable.bidRequestId, args.bid.id), eq(bidInvitationsTable.vendorId, args.vendorId)));
      if (inv) {
        await tx.update(bidInvitationsTable).set({ status: "submitted", submittedAt })
          .where(eq(bidInvitationsTable.id, inv.id));
      } else if (args.enteredByManager) {
        // Synthetic invitation row for traceability
        const { hash } = genToken();
        await tx.insert(bidInvitationsTable).values({
          bidRequestId: args.bid.id,
          vendorId: args.vendorId,
          tokenHash: hash,
          tokenExpiresAt: args.bid.deadline,
          status: "submitted",
          invitedAt: submittedAt,
          submittedAt,
        });
      }
    }
    return qid;
  });

  // Auto-close runs after commit (it issues its own writes and notifications).
  await maybeAutoClose(args.bid.id);
  return quoteId;
}

export async function maybeAutoClose(bidId: number) {
  const bid = await loadBid(bidId);
  if (!bid || bid.status !== "open") return;
  const invs = await db.select().from(bidInvitationsTable).where(eq(bidInvitationsTable.bidRequestId, bidId));
  if (invs.length === 0) return;
  const allClosed = invs.every((i) => i.status === "submitted" || i.status === "declined" || i.status === "no_response");
  if (allClosed) {
    await db.update(bidRequestsTable).set({ status: "closed" }).where(eq(bidRequestsTable.id, bidId));
    await notifyManagers(`All vendors have responded for bid "${bid.title}" — ready to award`, bidId);
  }
}

// ── Award ──
router.post("/bids/:id/award", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const bid = await loadBid(id);
  if (!bid) { res.status(404).json({ error: "Not found" }); return; }
  if (bid.status !== "open" && bid.status !== "closed") { res.status(409).json({ error: "Only open or closed bids can be awarded" }); return; }
  if (isSealedActive(bid)) {
    res.status(409).json({ error: "Sealed bids cannot be awarded until the deadline passes or sealed bids are opened early" });
    return;
  }
  const body = req.body as { vendorId?: number; rationale?: string; motionId?: number | null; bypassId?: number | null };
  if (!body?.vendorId || !body?.rationale?.trim()) { res.status(400).json({ error: "vendorId and rationale required" }); return; }
  const [winningQuote] = await db.select().from(bidQuotesTable)
    .where(and(eq(bidQuotesTable.bidRequestId, id), eq(bidQuotesTable.vendorId, body.vendorId)));
  if (!winningQuote) { res.status(400).json({ error: "Selected vendor has no submitted quote" }); return; }
  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, body.vendorId));
  if (!vendor) { res.status(400).json({ error: "Vendor not found" }); return; }

  // Task #64: gate above-threshold awards behind an Adopted expenditure motion
  // (or admin emergency bypass). The bid id is the natural target identifier.
  const gateSettings = await loadGovernanceSettings();
  const winningCents = winningQuote.totalCents ?? 0;
  let awardMotionId: number | null = null;
  let awardEmergencyBypassId: number | null = null;
  if (gateSettings.expenditureThresholdCents > 0 && winningCents >= gateSettings.expenditureThresholdCents) {
    const targetId = `bid:${bid.id}:vendor:${vendor.id}`;
    if (typeof body.bypassId === "number") {
      const bp = await findUnconsumedBypassFor("bid_award", targetId, body.bypassId);
      if (!bp) { res.status(409).json({ error: "motion_required", reason: "Bypass not found or already consumed" }); return; }
      awardEmergencyBypassId = bp.id;
    } else if (typeof body.motionId === "number") {
      const v = await validateMotionAuthorizes({
        motionId: body.motionId, expectedKind: "expenditure",
        targetType: "bid_award", targetId, minAmountCents: winningCents,
      });
      if (!v.ok) { res.status(409).json({ error: "motion_required", reason: v.reason }); return; }
      awardMotionId = v.motionId;
    } else {
      res.status(409).json(gateRequiredError({
        reason: `Award amount $${(winningCents / 100).toFixed(2)} exceeds the board expenditure threshold of $${(gateSettings.expenditureThresholdCents / 100).toFixed(2)}; an Adopted expenditure motion is required.`,
        targetType: "bid_award", targetId, motionKind: "expenditure",
        pendingMotionId: await findPendingMotionFor("bid_award", targetId),
      }).body);
      return;
    }
  }
  const items = await db.select().from(bidScopeItemsTable).where(eq(bidScopeItemsTable.bidRequestId, id))
    .orderBy(asc(bidScopeItemsTable.sortOrder));

  const woId = await nextWorkOrderId();
  const opened = nowISO();
  const description = [
    bid.scope || "",
    "",
    "Scope items:",
    ...items.map((it, i) => `${i + 1}. ${it.label}${it.notes ? ` — ${it.notes}` : ""}`),
    "",
    `Awarded from bid #${bid.id} to ${vendor.name}.`,
    `Rationale: ${body.rationale}`,
  ].join("\n");

  // Step 1: build + upload award memo BEFORE the transaction (object storage is not transactional).
  // The award is required to produce a memo, so failure here aborts the award entirely.
  let memoStorageKey: string;
  let memoSize: number;
  try {
    const allQuotes = await db.select().from(bidQuotesTable).where(eq(bidQuotesTable.bidRequestId, id));
    const settings = await getOrg();
    const resolutionMeta = await loadResolutionMeta(bid.resolutionId);
    const pdf = await buildAwardMemoPdf({
      bidId: bid.id,
      title: bid.title,
      tradeCategory: bid.tradeCategory,
      buildingNum: bid.buildingNum,
      awardedVendorName: vendor.name,
      awardedTotalCents: winningQuote.totalCents,
      rationale: body.rationale,
      decidedAt: opened,
      decidedBy: req.user!.name || req.user!.email,
      orgName: settings?.name ?? "Homeowners Association",
      orgAddress: settings?.address ?? "",
      orgContactEmail: settings?.contactEmail ?? "",
      resolutionNumber: resolutionMeta?.number ?? null,
      resolutionStatus: resolutionMeta?.status ?? null,
      quotes: await Promise.all(allQuotes.map(async (q) => {
        const [v] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, q.vendorId));
        return { vendorName: v?.name ?? "(unknown)", totalCents: q.totalCents };
      })),
    });
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    const putRes = await fetch(uploadURL, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: pdf,
    });
    if (!putRes.ok) throw new Error(`memo upload failed: ${putRes.status}`);
    memoStorageKey = objectPath;
    memoSize = pdf.length;
  } catch (err) {
    logger.error({ err }, "Award aborted: memo generation/upload failed");
    res.status(500).json({ error: "Failed to generate award memo; award not recorded" });
    return;
  }

  // Step 2: atomic DB write — WO create, attachments, bid update.
  let createdWOId: string;
  try {
    createdWOId = await db.transaction(async (tx) => {
      const [createdWO] = await tx.insert(workOrdersTable).values({
        id: woId,
        building: bid.buildingNum ?? 1,
        unit: bid.unitId ?? null,
        title: bid.title,
        category: bid.tradeCategory,
        priority: "med",
        status: "open",
        vendor: vendor.name,
        vendorId: vendor.id,
        opened,
        estCost: Math.round(winningQuote.totalCents / 100),
        description,
        sourceBidId: bid.id,
        sourceMotionId: awardMotionId,
        emergencyBypassId: awardEmergencyBypassId,
      }).returning();

      if (awardMotionId || awardEmergencyBypassId) {
        await tx.insert(workOrderEventsTable).values({
          workOrderId: createdWO!.id,
          kind: "motion_authorized",
          actorUserId: req.user?.id ?? null,
          actorName: req.user?.name ?? "system",
          payload: { motionId: awardMotionId, bypassId: awardEmergencyBypassId, amountCents: winningCents, source: "bid_award", bidId: bid.id },
          createdAt: opened,
        });
      }

      // Award memo: attach to the bid AND to the work order
      await tx.insert(bidAttachmentsTable).values({
        bidRequestId: bid.id,
        name: `award-memo-${bid.id}.pdf`,
        size: memoSize,
        contentType: "application/pdf",
        storageKey: memoStorageKey,
        kind: "award_memo",
        uploadedByUserId: req.user!.id,
        uploadedByName: req.user!.name || req.user!.email,
        uploadedAt: opened,
      });
      await tx.insert(workOrderAttachmentsTable).values({
        workOrderId: createdWO!.id,
        storageKey: memoStorageKey,
        mimeType: "application/pdf",
        size: memoSize,
        name: `award-memo-${bid.id}.pdf`,
        uploadedBy: req.user!.id,
        uploadedAt: opened,
      });

      // If the awarded vendor submitted a quote PDF, also attach it to the work order.
      if (winningQuote.quotePdfStorageKey) {
        await tx.insert(workOrderAttachmentsTable).values({
          workOrderId: createdWO!.id,
          storageKey: winningQuote.quotePdfStorageKey,
          mimeType: "application/pdf",
          size: 0,
          name: `awarded-quote-${vendor.name.replace(/[^a-z0-9]+/gi, "-")}.pdf`,
          uploadedBy: req.user!.id,
          uploadedAt: opened,
        });
      }

      await tx.update(bidRequestsTable).set({
        status: "awarded",
        awardedVendorId: vendor.id,
        awardedAt: opened,
        awardRationale: body.rationale,
        awardMemoStorageKey: memoStorageKey,
        awardedWorkOrderId: createdWO!.id,
        awardMotionId,
        awardEmergencyBypassId,
      }).where(eq(bidRequestsTable.id, id));

      return createdWO!.id;
    });
  } catch (err) {
    logger.error({ err }, "Award transaction failed; rolled back");
    res.status(500).json({ error: "Award failed; no changes were saved" });
    return;
  }

  if (awardEmergencyBypassId) await markBypassConsumed(awardEmergencyBypassId);

  // Step 3: best-effort side effects (notifications + emails) outside the critical path.
  try {
    await notifyManagers(`Bid "${bid.title}" awarded to ${vendor.name} (${createdWOId})`, bid.id);
    if (bid.notifyNonAwarded) {
      const allQuotes = await db.select().from(bidQuotesTable).where(eq(bidQuotesTable.bidRequestId, id));
      const settings = await getOrg();
      for (const q of allQuotes) {
        if (q.vendorId === vendor.id) continue;
        const [v] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, q.vendorId));
        if (!v) continue;
        await sendEmail(v.email, `Bid result: ${bid.title}`, buildBidThankYouEmail({
          orgName: settings?.name ?? "HOA",
          bidTitle: bid.title,
          vendorName: v.name,
        }));
      }
    }
  } catch (err) {
    logger.warn({ err }, "Award notifications/emails partially failed (award already recorded)");
  }

  // Task #75: re-materialize milestones to mark Awarded.
  try {
    const { materializeBidMilestones, materializeWorkOrder } = await import("../lib/calendarMaterialize.js");
    await materializeBidMilestones({
      id: bid.id, title: bid.title, status: "awarded",
      createdAt: bid.createdAt, deadline: bid.deadline,
      awardedAt: opened, awardedVendorName: vendor.name,
    });
    const [createdWO] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, createdWOId));
    if (createdWO) await materializeWorkOrder(createdWO);
  } catch (err) { logger.warn({ err }, "calendar materialize award failed"); }

  res.json({ ok: true, workOrderId: createdWOId, awardMemoStorageKey: memoStorageKey });
});

// ── Cancel ──
router.post("/bids/:id/cancel", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const bid = await loadBid(id);
  if (!bid) { res.status(404).json({ error: "Not found" }); return; }
  if (TERMINAL.has(bid.status)) { res.status(409).json({ error: "Already closed" }); return; }
  await db.update(bidRequestsTable).set({ status: "cancelled" }).where(eq(bidRequestsTable.id, id));
  // Cancel both the linked bid-open and bid-close calendar events.
  void syncAutoCalendarEvents();
  // Task #75: also drop the bid's milestone events from the per-source calendar feed.
  try {
    const { removeBidMilestones } = await import("../lib/calendarMaterialize.js");
    await removeBidMilestones(id);
  } catch (err) { req.log.warn({ err }, "calendar removeBidMilestones failed"); }
  res.json({ ok: true });
});

// ── Open sealed bids early ──
router.post("/bids/:id/open-sealed-early", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const bid = await loadBid(id);
  if (!bid) { res.status(404).json({ error: "Not found" }); return; }
  if (!bid.sealedBids) { res.status(400).json({ error: "Bid is not sealed" }); return; }
  if (bid.sealedOpenedAt) { res.status(409).json({ error: "Already opened" }); return; }
  await db.update(bidRequestsTable).set({ sealedOpenedAt: nowISO() }).where(eq(bidRequestsTable.id, id));
  res.json({ ok: true });
});

// ── Attachments (specs / drawings on the bid itself) ──
router.post("/bids/:id/attachments", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const bid = await loadBid(id);
  if (!bid) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body as { name?: string; storageKey?: string; size?: number; contentType?: string; kind?: string };
  if (!body.name || !body.storageKey) { res.status(400).json({ error: "name and storageKey required" }); return; }
  const [att] = await db.insert(bidAttachmentsTable).values({
    bidRequestId: id,
    name: body.name,
    size: body.size ?? 0,
    contentType: body.contentType ?? null,
    storageKey: body.storageKey,
    kind: body.kind ?? "spec",
    uploadedByUserId: req.user!.id,
    uploadedByName: req.user!.name || req.user!.email,
    uploadedAt: nowISO(),
  }).returning();
  res.status(201).json({ id: att!.id, name: att!.name, storageKey: att!.storageKey });
});

router.post("/bids/upload-url", async (_req, res) => {
  try {
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
  } catch (err) {
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.get("/bids/:id/attachments/:attId", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  const attId = parseInt(req.params.attId as string, 10);
  if (isNaN(id) || isNaN(attId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [att] = await db.select().from(bidAttachmentsTable)
    .where(and(eq(bidAttachmentsTable.id, attId), eq(bidAttachmentsTable.bidRequestId, id)));
  if (!att) { res.status(404).json({ error: "Not found" }); return; }
  try {
    const file = await storage.getObjectEntityFile(att.storageKey);
    const response = await storage.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.setHeader("Content-Disposition", `inline; filename="${att.name.replace(/"/g, "")}"`);
    if (response.body) {
      const node = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      node.pipe(res);
    } else { res.end(); }
  } catch (err) {
    res.status(500).json({ error: "Download failed" });
  }
});

// Manager: stream a vendor-uploaded quote document (quote PDF / license / COI).
router.get("/bids/quotes/:quoteId/doc/:kind", async (req, res) => {
  const quoteId = parseInt(req.params.quoteId as string, 10);
  const kind = req.params.kind as string;
  if (isNaN(quoteId) || !["quote", "license", "coi"].includes(kind)) {
    res.status(400).json({ error: "Invalid request" }); return;
  }
  const [q] = await db.select().from(bidQuotesTable).where(eq(bidQuotesTable.id, quoteId));
  if (!q) { res.status(404).json({ error: "Not found" }); return; }
  const [parentBid] = await db.select().from(bidRequestsTable).where(eq(bidRequestsTable.id, q.bidRequestId));
  if (!parentBid) { res.status(404).json({ error: "Not found" }); return; }
  // Quote PDFs typically contain prices and break sealed-bid integrity if served
  // before the bid is opened. License/COI usually do not, but we err on the side
  // of caution and gate every quote document on sealed-active.
  if (isSealedActive(parentBid)) {
    res.status(409).json({ error: "Sealed bid: documents are not available until the deadline passes or sealed bids are opened early" });
    return;
  }
  const key = kind === "quote" ? q.quotePdfStorageKey
    : kind === "license" ? q.licenseStorageKey
    : q.coiStorageKey;
  if (!key) { res.status(404).json({ error: "Document not provided" }); return; }
  try {
    const file = await storage.getObjectEntityFile(key);
    const response = await storage.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.setHeader("Content-Disposition", `inline; filename="${kind}-quote-${quoteId}.pdf"`);
    if (response.body) {
      const node = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      node.pipe(res);
    } else { res.end(); }
  } catch {
    res.status(500).json({ error: "Download failed" });
  }
});

router.get("/bids/:id/award-memo", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const bid = await loadBid(id);
  if (!bid?.awardMemoStorageKey) { res.status(404).json({ error: "No award memo" }); return; }
  try {
    const file = await storage.getObjectEntityFile(bid.awardMemoStorageKey);
    const response = await storage.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.setHeader("Content-Disposition", `attachment; filename="award-memo-${bid.id}.pdf"`);
    if (response.body) {
      const node = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      node.pipe(res);
    } else { res.end(); }
  } catch (err) {
    res.status(500).json({ error: "Download failed" });
  }
});

// ── Public token routes (no auth) ──
export const bidPublicRouter: IRouter = Router();

async function loadByToken(rawToken: string) {
  const hash = hashToken(rawToken);
  const [inv] = await db.select().from(bidInvitationsTable).where(eq(bidInvitationsTable.tokenHash, hash));
  if (!inv) return null;
  const bid = await loadBid(inv.bidRequestId);
  if (!bid) return null;
  return { inv, bid };
}

bidPublicRouter.get("/quote/:token", async (req, res) => {
  const ctx = await loadByToken(req.params.token as string);
  if (!ctx) { res.status(404).json({ error: "Invalid or expired link" }); return; }
  const { inv, bid } = ctx;
  if (new Date(inv.tokenExpiresAt).getTime() < Date.now()) {
    res.status(410).json({ error: "Link expired" }); return;
  }
  if (bid.status === "cancelled") { res.status(410).json({ error: "Bid was cancelled" }); return; }
  if (bid.status === "awarded") { res.status(410).json({ error: "Bid has been awarded" }); return; }

  // Mark viewed
  if (inv.status === "invited") {
    await db.update(bidInvitationsTable)
      .set({ status: "viewed", viewedAt: nowISO() })
      .where(eq(bidInvitationsTable.id, inv.id));
  }
  const items = await db.select().from(bidScopeItemsTable).where(eq(bidScopeItemsTable.bidRequestId, bid.id))
    .orderBy(asc(bidScopeItemsTable.sortOrder));
  const attachments = await db.select().from(bidAttachmentsTable).where(eq(bidAttachmentsTable.bidRequestId, bid.id));
  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, inv.vendorId));
  const [existingQuote] = await db.select().from(bidQuotesTable)
    .where(and(eq(bidQuotesTable.bidRequestId, bid.id), eq(bidQuotesTable.vendorId, inv.vendorId)));
  const existingLines = existingQuote
    ? await db.select().from(bidQuoteLinesTable).where(eq(bidQuoteLinesTable.bidQuoteId, existingQuote.id))
    : [];
  const settings = await getOrg();
  res.json({
    orgName: settings?.name ?? "HOA",
    bid: {
      id: bid.id,
      title: bid.title,
      scope: bid.scope,
      tradeCategory: bid.tradeCategory,
      buildingNum: bid.buildingNum ?? null,
      deadline: bid.deadline,
      sealedBids: bid.sealedBids,
    },
    vendor: vendor ? { id: vendor.id, name: vendor.name, email: vendor.email } : null,
    scopeItems: items.map((it) => ({ id: it.id, label: it.label, notes: it.notes ?? null, sortOrder: it.sortOrder })),
    attachments: attachments.map((a) => ({
      id: a.id, name: a.name, size: a.size, contentType: a.contentType ?? null,
      downloadUrl: `/api/quote/${encodeURIComponent(req.params.token as string)}/attachments/${a.id}`,
    })),
    existingQuote: existingQuote ? {
      leadTimeDays: existingQuote.leadTimeDays,
      paymentTerms: existingQuote.paymentTerms,
      warrantyText: existingQuote.warrantyText,
      notes: existingQuote.notes,
      firmConfirmation: existingQuote.firmConfirmation,
      lines: existingLines.map((l) => ({ scopeItemId: l.scopeItemId, amountCents: l.amountCents })),
    } : null,
  });
});

bidPublicRouter.post("/quote/:token", async (req, res) => {
  const ctx = await loadByToken(req.params.token as string);
  if (!ctx) { res.status(404).json({ error: "Invalid or expired link" }); return; }
  const { inv, bid } = ctx;
  if (new Date(inv.tokenExpiresAt).getTime() < Date.now()) { res.status(410).json({ error: "Link expired" }); return; }
  if (bid.status === "cancelled" || bid.status === "awarded" || bid.status === "closed") { res.status(410).json({ error: "Bid is closed" }); return; }
  // Once a sealed bid has been opened (early or via deadline-pass), vendors may
  // no longer modify their submission — managers have already seen prices, so
  // allowing further edits would let a vendor adjust after the fact.
  if (bid.sealedBids && bid.sealedOpenedAt) {
    res.status(410).json({ error: "Sealed bid has been opened — submissions are now locked" }); return;
  }
  const body = req.body as {
    leadTimeDays?: number;
    paymentTerms?: string;
    warrantyText?: string;
    notes?: string;
    firmConfirmation?: boolean;
    quotePdfStorageKey?: string;
    licenseStorageKey?: string;
    coiStorageKey?: string;
    lines?: Array<{ scopeItemId: number; amountCents: number }>;
  };
  if (body.firmConfirmation !== true) { res.status(400).json({ error: "Firm-quote confirmation is required" }); return; }
  if (!Array.isArray(body.lines) || body.lines.length === 0) { res.status(400).json({ error: "lines required" }); return; }
  try {
    await upsertQuote({
      bid,
      vendorId: inv.vendorId,
      invitationId: inv.id,
      leadTimeDays: body.leadTimeDays ?? null,
      paymentTerms: body.paymentTerms ?? null,
      warrantyText: body.warrantyText ?? null,
      notes: body.notes ?? null,
      quotePdfStorageKey: body.quotePdfStorageKey ?? null,
      licenseStorageKey: body.licenseStorageKey ?? null,
      coiStorageKey: body.coiStorageKey ?? null,
      enteredByManager: false,
      firmConfirmation: true,
      lines: body.lines,
    });
  } catch (err) {
    if (err instanceof QuoteValidationError) {
      res.status(400).json({ error: err.message }); return;
    }
    throw err;
  }
  res.json({ ok: true });
});

bidPublicRouter.post("/quote/:token/decline", async (req, res) => {
  const ctx = await loadByToken(req.params.token as string);
  if (!ctx) { res.status(404).json({ error: "Invalid or expired link" }); return; }
  const { inv, bid } = ctx;
  if (new Date(inv.tokenExpiresAt).getTime() < Date.now()) { res.status(410).json({ error: "Link expired" }); return; }
  if (bid.status === "cancelled" || bid.status === "awarded" || bid.status === "closed") {
    res.status(410).json({ error: "Bid is closed" }); return;
  }
  if (bid.sealedBids && bid.sealedOpenedAt) {
    res.status(410).json({ error: "Sealed bid has been opened — submissions are now locked" }); return;
  }
  await db.update(bidInvitationsTable).set({ status: "declined", declinedAt: nowISO() })
    .where(eq(bidInvitationsTable.id, inv.id));
  await maybeAutoClose(bid.id);
  res.json({ ok: true });
});

// Stream a bid attachment to a vendor authenticated by their magic-link token.
bidPublicRouter.get("/quote/:token/attachments/:attId", async (req, res) => {
  const ctx = await loadByToken(req.params.token as string);
  if (!ctx) { res.status(404).json({ error: "Invalid or expired link" }); return; }
  const { inv, bid } = ctx;
  if (new Date(inv.tokenExpiresAt).getTime() < Date.now()) { res.status(410).json({ error: "Link expired" }); return; }
  if (bid.status === "cancelled") { res.status(410).json({ error: "Bid was cancelled" }); return; }
  const attId = parseInt(req.params.attId as string, 10);
  if (isNaN(attId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [att] = await db.select().from(bidAttachmentsTable)
    .where(and(eq(bidAttachmentsTable.id, attId), eq(bidAttachmentsTable.bidRequestId, bid.id)));
  // Vendors should not see internal artifacts like the award memo.
  if (!att || att.kind === "award_memo") { res.status(404).json({ error: "Not found" }); return; }
  try {
    const file = await storage.getObjectEntityFile(att.storageKey);
    const response = await storage.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.setHeader("Content-Disposition", `inline; filename="${att.name.replace(/"/g, "")}"`);
    if (response.body) {
      const node = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      node.pipe(res);
    } else { res.end(); }
  } catch (err) {
    res.status(500).json({ error: "Download failed" });
  }
});

bidPublicRouter.post("/quote/:token/upload-url", async (req, res) => {
  const ctx = await loadByToken(req.params.token as string);
  if (!ctx) { res.status(404).json({ error: "Invalid or expired link" }); return; }
  const { inv, bid } = ctx;
  // Match the same gates as quote-view/quote-submit so an expired or
  // closed-bid token cannot mint upload URLs against object storage.
  if (new Date(inv.tokenExpiresAt).getTime() < Date.now()) {
    res.status(410).json({ error: "Link expired" }); return;
  }
  if (bid.status !== "open" && bid.status !== "draft") {
    res.status(410).json({ error: "Bid is no longer accepting submissions" }); return;
  }
  if (bid.sealedBids && bid.sealedOpenedAt) {
    res.status(410).json({ error: "Sealed bid has been opened — submissions are now locked" }); return;
  }
  try {
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
  } catch (err) {
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// ── Award memo PDF builder ──
async function buildAwardMemoPdf(opts: {
  bidId: number; title: string; tradeCategory: string; buildingNum: number | null;
  awardedVendorName: string; awardedTotalCents: number; rationale: string;
  decidedAt: string; decidedBy: string;
  orgName: string; orgAddress: string; orgContactEmail: string;
  quotes: Array<{ vendorName: string; totalCents: number }>;
  resolutionNumber?: string | null;
  resolutionStatus?: "adopted" | "superseded" | "rescinded" | null;
}): Promise<Buffer> {
  const lines: Array<[string, number]> = [
    [`${opts.orgName} — Bid Award Memo`, 16],
  ];
  if (opts.orgAddress) lines.push([opts.orgAddress, 10]);
  if (opts.orgContactEmail) lines.push([opts.orgContactEmail, 10]);
  lines.push([``, 6]);
  lines.push([`Bid #BR-${opts.bidId} — ${opts.title}`, 11]);
  lines.push([`Trade: ${opts.tradeCategory}`, 11]);
  if (opts.buildingNum) lines.push([`Building: ${opts.buildingNum}`, 11]);
  lines.push([`Decision Date: ${opts.decidedAt.slice(0, 10)}`, 11]);
  if (opts.resolutionNumber) {
    const suffix = opts.resolutionStatus === "superseded" ? " (superseded)"
      : opts.resolutionStatus === "rescinded" ? " (rescinded)"
      : "";
    lines.push([`Authorizing Resolution: ${opts.resolutionNumber}${suffix}`, 11]);
  }
  lines.push([``, 6]);
  lines.push([`AWARDED TO: ${opts.awardedVendorName}`, 13]);
  lines.push([`Awarded Total: $${(opts.awardedTotalCents / 100).toFixed(2)}`, 11]);
  lines.push([``, 8]);
  lines.push([`Comparison summary:`, 11]);
  for (const q of opts.quotes) {
    lines.push([` - ${q.vendorName}: $${(q.totalCents / 100).toFixed(2)}`, 10]);
  }
  lines.push([``, 8]);
  lines.push([`Rationale:`, 11]);
  for (const chunk of chunkText(opts.rationale, 90)) lines.push([chunk, 10]);
  lines.push([``, 14]);
  lines.push([`Decided by: ${opts.decidedBy}`, 10]);
  lines.push([`On behalf of the ${opts.orgName} Board`, 10]);

  const signatureLines = await buildCurrentSignatureBlockLines(opts.decidedAt.slice(0, 10));
  for (const sl of signatureLines) lines.push(sl);

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
  for (const obj of objects) { offsets.push(pos); pos += Buffer.byteLength(obj, "latin1"); }
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
      if ((line + " " + word).length > n) { if (line) out.push(line); line = word; }
      else { line = line ? `${line} ${word}` : word; }
    }
    if (line) out.push(line);
  }
  return out;
}

export default router;
