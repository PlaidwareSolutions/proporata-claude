import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  architecturalRequestsTable,
  accAttachmentsTable,
  accEventsTable,
  notificationsTable,
  unitsTable,
  usersTable,
  organizationSettingsTable,
  resolutionsTable,
  motionsTable,
} from "@workspace/db/schema";
import { eq, desc, and, ne, inArray } from "drizzle-orm";
import { authenticateJwt, requireManager } from "../middleware/auth.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { Readable } from "stream";
import { upsertEvent, syncMilestones, cancelEventsForSource } from "../lib/calendarMaterializer.js";
import { buildCurrentSignatureBlockLines } from "../lib/signatureBlock.js";

const router: IRouter = Router();
const storage = new ObjectStorageService();

const TERMINAL = new Set(["approved", "approved_with_conditions", "denied", "withdrawn"]);
const REOPENABLE = new Set(["approved", "approved_with_conditions", "denied"]);
const MAX_ATTACHMENTS = 10;
const ALLOWED_PROJECT_TYPES = new Set([
  "Paint / Exterior color",
  "Fence",
  "Roof / Roofing material",
  "Landscaping / Hardscape",
  "Patio / Deck",
  "Window / Door replacement",
  "Solar panels",
  "Pool / Spa",
  "Other exterior modification",
]);

function nowISO() { return new Date().toISOString(); }

async function getOrgSettings() {
  const [row] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  return row;
}

async function notifyManagers(message: string, requestId: number) {
  const managers = await db.select().from(usersTable).where(ne(usersTable.role, "resident"));
  const created = nowISO();
  for (const u of managers) {
    if (u.pending) continue;
    await db.insert(notificationsTable).values({
      userId: u.id,
      type: "acc_update",
      message,
      entityType: "architectural_request",
      entityId: String(requestId),
      read: false,
      createdAt: created,
    });
  }
}

async function notifyOwner(ownerUserId: number, message: string, requestId: number) {
  await db.insert(notificationsTable).values({
    userId: ownerUserId,
    type: "acc_update",
    message,
    entityType: "architectural_request",
    entityId: String(requestId),
    read: false,
    createdAt: nowISO(),
  });
}

type ResolutionMeta = {
  number: string | null;
  title: string | null;
  status: "adopted" | "superseded" | "rescinded";
};

async function loadResolutionMetas(ids: number[]): Promise<Map<number, ResolutionMeta>> {
  const out = new Map<number, ResolutionMeta>();
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return out;
  const rows = await db.select({
    id: resolutionsTable.id,
    number: resolutionsTable.number,
    supersededByResolutionId: resolutionsTable.supersededByResolutionId,
    rescindedByMotionId: resolutionsTable.rescindedByMotionId,
    motionId: resolutionsTable.motionId,
  }).from(resolutionsTable).where(inArray(resolutionsTable.id, unique));
  const motionIds = rows.map((r) => r.motionId).filter((x): x is number => typeof x === "number");
  const motionTitles = new Map<number, string>();
  if (motionIds.length) {
    const ms = await db.select({ id: motionsTable.id, title: motionsTable.title })
      .from(motionsTable).where(inArray(motionsTable.id, motionIds));
    for (const m of ms) motionTitles.set(m.id, m.title);
  }
  for (const r of rows) {
    let status: ResolutionMeta["status"] = "adopted";
    if (r.rescindedByMotionId) status = "rescinded";
    else if (r.supersededByResolutionId) status = "superseded";
    out.set(r.id, {
      number: r.number ?? null,
      title: r.motionId ? motionTitles.get(r.motionId) ?? null : null,
      status,
    });
  }
  return out;
}

// Task #76: Materialize ACC milestones onto the compliance sub-calendar as
// owner-private events: submission, decision, planned start/end. Re-runs are
// idempotent (one event per slot per request).
async function materializeAccRequest(r: typeof architecturalRequestsTable.$inferSelect) {
  try {
    await syncMilestones(
      "compliance",
      "acc_request",
      String(r.id),
      [
        { slot: "submitted", title: "Submitted", date: r.submittedAt?.slice(0, 10), reminderLeadsMinutes: [] },
        { slot: "decision", title: `Decision (${r.status})`, date: r.decidedAt?.slice(0, 10), reminderLeadsMinutes: [1440] },
        { slot: "planned_start", title: "Planned project start", date: r.plannedStart, reminderLeadsMinutes: [10080, 1440] },
        { slot: "planned_end", title: "Planned project end", date: r.plannedEnd, reminderLeadsMinutes: [1440] },
      ],
      `ACC: ${r.title}`,
      `${r.projectType} — ${r.description.slice(0, 200)}`,
      r.ownerUserId,
    );
    // Task #78: Anonymized public ACC entry on the Community sub-calendar
    // for in-flight (submitted/under_review) requests, so neighbours can see
    // a project of the given type is pending without identifying the owner
    // or unit. Removed automatically once decided/withdrawn.
    if (r.status === "submitted" || r.status === "under_review") {
      const settings = await getOrgSettings();
      const days = settings?.accAutoApprovalDays ?? 30;
      const decisionBy = r.submittedAt
        ? (() => { const d = new Date(r.submittedAt); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); })()
        : (r.plannedStart ?? r.submittedAt?.slice(0, 10) ?? null);
      if (decisionBy) {
        await upsertEvent({
          subSlug: "community",
          sourceRefType: "acc_anon",
          sourceRefId: String(r.id),
          slot: "anon_pending",
          title: `ACC review pending — ${r.projectType} (decision by ${decisionBy})`,
          body: `An architectural review is pending in Building ${r.building}. Owner identity is not disclosed.`,
          startsAt: decisionBy,
          allDay: true,
          ownerUserId: null,
          reminderLeadsMinutes: [],
        });
      }
    } else {
      // Decided/withdrawn — remove the anonymized public entry if present.
      await syncMilestones(
        "community",
        "acc_anon",
        String(r.id),
        [],
        "",
        "",
        null,
      );
    }
    // Auto-approval expiration deadline (if status not yet decided and an
    // accAutoApprovalDays is configured, the submitted+N day mark surfaces).
    const settings2 = await getOrgSettings();
    if (settings2?.accAutoApprovalDays && settings2.accAutoApprovalDays > 0 && !r.decidedAt && r.submittedAt) {
      const submitted = new Date(r.submittedAt);
      submitted.setDate(submitted.getDate() + settings2.accAutoApprovalDays);
      await upsertEvent({
        subSlug: "compliance",
        sourceRefType: "acc_request",
        sourceRefId: String(r.id),
        slot: "auto_deadline",
        title: `ACC auto-approval deadline: ${r.title}`,
        body: `If no decision is rendered by this date, the request may be auto-approved.`,
        startsAt: submitted.toISOString().slice(0, 10),
        allDay: true,
        ownerUserId: r.ownerUserId,
        reminderLeadsMinutes: [10080, 1440],
      });
    }
  } catch {
    // best-effort; never block ACC flow on calendar issues.
  }
}

function toRequest(
  r: typeof architecturalRequestsTable.$inferSelect,
  resolutions?: Map<number, ResolutionMeta>,
) {
  const meta = r.resolutionId != null ? resolutions?.get(r.resolutionId) : undefined;
  return {
    id: r.id,
    unitId: r.unitId,
    building: r.building,
    ownerUserId: r.ownerUserId,
    ownerName: r.ownerName,
    projectType: r.projectType,
    title: r.title,
    description: r.description,
    contractorName: r.contractorName,
    plannedStart: r.plannedStart,
    plannedEnd: r.plannedEnd,
    acknowledgedGuidelines: r.acknowledgedGuidelines,
    status: r.status,
    submittedAt: r.submittedAt,
    decidedAt: r.decidedAt,
    decisionText: r.decisionText,
    conditionsText: r.conditionsText,
    decisionLetterStorageKey: r.decisionLetterStorageKey,
    autoApprovalFlagged: r.autoApprovalFlagged,
    autoApprovalFlaggedAt: r.autoApprovalFlaggedAt,
    resolutionId: r.resolutionId ?? null,
    resolutionNumber: meta?.number ?? null,
    resolutionTitle: meta?.title ?? null,
    resolutionStatus: meta?.status ?? null,
  };
}

function toEvent(e: typeof accEventsTable.$inferSelect) {
  return {
    id: e.id,
    requestId: e.requestId,
    type: e.type,
    authorUserId: e.authorUserId,
    authorName: e.authorName,
    authorRole: e.authorRole,
    body: e.body,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    voteValue: e.voteValue,
    createdAt: e.createdAt,
  };
}

function toAttachment(a: typeof accAttachmentsTable.$inferSelect) {
  return {
    id: a.id,
    requestId: a.requestId,
    name: a.name,
    size: a.size,
    contentType: a.contentType,
    storageKey: a.storageKey,
    kind: a.kind,
    uploadedByUserId: a.uploadedByUserId,
    uploadedByName: a.uploadedByName,
    uploadedAt: a.uploadedAt,
  };
}

async function isManager(req: Request) {
  return req.user?.role === "admin" || req.user?.role === "manager";
}

// ── List ──
router.get("/architectural-requests", authenticateJwt, async (req, res) => {
  try {
    let rows;
    if (await isManager(req)) {
      rows = await db
        .select()
        .from(architecturalRequestsTable)
        .orderBy(desc(architecturalRequestsTable.submittedAt));
    } else {
      rows = await db
        .select()
        .from(architecturalRequestsTable)
        .where(eq(architecturalRequestsTable.ownerUserId, req.user!.id))
        .orderBy(desc(architecturalRequestsTable.submittedAt));
    }
    const metas = await loadResolutionMetas(
      rows.map((r) => r.resolutionId).filter((x): x is number => typeof x === "number"),
    );
    res.json(rows.map((r) => toRequest(r, metas)));
  } catch (err) {
    req.log.error({ err }, "GET /architectural-requests failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Create (resident) ──
interface CreateBody {
  unitId?: string;
  projectType: string;
  title: string;
  description: string;
  contractorName?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  acknowledgedGuidelines?: boolean;
  attachments?: Array<{ name: string; storageKey: string; size?: number; contentType?: string | null }>;
}

router.post("/architectural-requests", authenticateJwt, async (req, res) => {
  const body = req.body as CreateBody;
  if (!body || typeof body.projectType !== "string" || !ALLOWED_PROJECT_TYPES.has(body.projectType)
    || typeof body.title !== "string" || !body.title.trim()
    || typeof body.description !== "string" || !body.description.trim()) {
    res.status(400).json({ error: "Invalid request body (projectType must be one of the allowed types)" }); return;
  }
  if (body.acknowledgedGuidelines !== true) {
    res.status(400).json({ error: "Architectural guidelines must be acknowledged" }); return;
  }
  if (Array.isArray(body.attachments) && body.attachments.length > MAX_ATTACHMENTS) {
    res.status(400).json({ error: `At most ${MAX_ATTACHMENTS} attachments allowed` }); return;
  }
  const settings = await getOrgSettings();
  if (settings && settings.accEnabled === false) { res.status(403).json({ error: "Architectural requests are disabled" }); return; }

  const unitId = body.unitId ?? req.user!.unitId;
  if (!unitId) { res.status(400).json({ error: "No unit assigned" }); return; }
  const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, unitId));
  if (!unit) { res.status(404).json({ error: "Unit not found" }); return; }

  // Residents may only submit for their own unit
  if (req.user!.role === "resident" && unit.id !== req.user!.unitId) {
    res.status(403).json({ error: "You may only submit for your assigned unit" }); return;
  }

  try {
    const submittedAt = nowISO();
    const [created] = await db.insert(architecturalRequestsTable).values({
      unitId,
      building: unit.building,
      ownerUserId: req.user!.id,
      ownerName: req.user!.name || req.user!.email,
      projectType: body.projectType,
      title: body.title.trim(),
      description: body.description.trim(),
      contractorName: body.contractorName ?? null,
      plannedStart: body.plannedStart ?? null,
      plannedEnd: body.plannedEnd ?? null,
      acknowledgedGuidelines: true,
      status: "submitted",
      submittedAt,
    }).returning();

    // Initial event
    await db.insert(accEventsTable).values({
      requestId: created!.id,
      type: "submitted",
      authorUserId: req.user!.id,
      authorName: req.user!.name || req.user!.email,
      authorRole: req.user!.role,
      toStatus: "submitted",
      createdAt: submittedAt,
    });

    // Attachments
    for (const att of body.attachments ?? []) {
      await db.insert(accAttachmentsTable).values({
        requestId: created!.id,
        name: att.name,
        size: att.size ?? 0,
        contentType: att.contentType ?? null,
        storageKey: att.storageKey,
        kind: "photo",
        uploadedByUserId: req.user!.id,
        uploadedByName: req.user!.name || req.user!.email,
        uploadedAt: submittedAt,
      });
    }

    await notifyManagers(`New architectural request: "${created!.title}" (Building ${created!.building})`, created!.id);
    await materializeAccRequest(created!);

    // Task #75: materialize "decide by" deadline event on the ACC committee calendar.
    try {
      const settings2 = await getOrgSettings();
      const days = settings2?.accAutoApprovalDays ?? 0;
      if (days > 0) {
        const { materializeAccDeadline } = await import("../lib/calendarMaterialize.js");
        await materializeAccDeadline(created!, days);
      }
    } catch (err) { req.log.warn({ err }, "calendar materialize ACC deadline failed"); }

    res.status(201).json(toRequest(created!));
    return;
  } catch (err) {
    req.log.error({ err }, "POST /architectural-requests failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get detail ──
router.get("/architectural-requests/:id", authenticateJwt, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(architecturalRequestsTable).where(eq(architecturalRequestsTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    if (!(await isManager(req)) && row.ownerUserId !== req.user!.id) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const events = await db.select().from(accEventsTable)
      .where(eq(accEventsTable.requestId, id))
      .orderBy(accEventsTable.createdAt, accEventsTable.id);
    const attachments = await db.select().from(accAttachmentsTable)
      .where(eq(accAttachmentsTable.requestId, id))
      .orderBy(accAttachmentsTable.uploadedAt);
    const metas = await loadResolutionMetas(row.resolutionId != null ? [row.resolutionId] : []);
    res.json({
      ...toRequest(row, metas),
      events: events.map(toEvent),
      attachments: attachments.map(toAttachment),
    });
  } catch (err) {
    req.log.error({ err }, "GET /architectural-requests/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

async function loadRequestForMutation(req: Request, res: Response) {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return null; }
  const [row] = await db.select().from(architecturalRequestsTable).where(eq(architecturalRequestsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return null; }
  return row;
}

// ── Add comment ──
router.post("/architectural-requests/:id/comments", authenticateJwt, async (req, res) => {
  const row = await loadRequestForMutation(req, res); if (!row) return;
  const body = (req.body as { body?: string })?.body;
  if (!body || !body.trim()) { res.status(400).json({ error: "body is required" }); return; }
  const isMgr = await isManager(req);
  if (!isMgr && row.ownerUserId !== req.user!.id) { res.status(403).json({ error: "Forbidden" }); return; }
  const created = nowISO();
  await db.insert(accEventsTable).values({
    requestId: row.id,
    type: "comment",
    authorUserId: req.user!.id,
    authorName: req.user!.name || req.user!.email,
    authorRole: req.user!.role,
    body: body.trim(),
    createdAt: created,
  });
  // Notify the opposite party
  if (isMgr) {
    await notifyOwner(row.ownerUserId, `New comment on your request "${row.title}"`, row.id);
  } else {
    await notifyManagers(`Owner replied on request "${row.title}"`, row.id);
  }
  res.status(201).json({ ok: true });
});

// ── Cast a vote (manager only) ──
router.post("/architectural-requests/:id/votes", authenticateJwt, requireManager, async (req, res) => {
  const row = await loadRequestForMutation(req, res); if (!row) return;
  const value = (req.body as { value?: string })?.value;
  if (!value || !["approve", "conditions", "deny"].includes(value)) {
    res.status(400).json({ error: "value must be approve | conditions | deny" }); return;
  }
  if (TERMINAL.has(row.status)) { res.status(409).json({ error: "Request is closed" }); return; }
  // Replace the user's previous vote
  const existing = await db.select().from(accEventsTable)
    .where(and(
      eq(accEventsTable.requestId, row.id),
      eq(accEventsTable.type, "vote"),
      eq(accEventsTable.authorUserId, req.user!.id),
    ));
  for (const v of existing) {
    await db.delete(accEventsTable).where(eq(accEventsTable.id, v.id));
  }
  await db.insert(accEventsTable).values({
    requestId: row.id,
    type: "vote",
    authorUserId: req.user!.id,
    authorName: req.user!.name || req.user!.email,
    authorRole: req.user!.role,
    voteValue: value,
    createdAt: nowISO(),
  });
  res.status(201).json({ ok: true });
});

// ── Status transitions ──
router.post("/architectural-requests/:id/transition", authenticateJwt, async (req, res) => {
  const row = await loadRequestForMutation(req, res); if (!row) return;
  const body = req.body as { action?: string; note?: string; conditions?: string; decisionText?: string };
  const action = body.action;
  if (!action) { res.status(400).json({ error: "action is required" }); return; }
  const isMgr = await isManager(req);
  const isOwner = row.ownerUserId === req.user!.id;
  const created = nowISO();

  let toStatus = row.status;
  let updateFields: Partial<typeof architecturalRequestsTable.$inferInsert> = {};
  let evType = "status_change";

  switch (action) {
    case "start_review":
      if (!isMgr) { res.status(403).json({ error: "Forbidden" }); return; }
      if (row.status !== "submitted" && row.status !== "more_info_needed") { res.status(409).json({ error: "Cannot start review from current status" }); return; }
      toStatus = "in_review";
      break;
    case "request_info":
      if (!isMgr) { res.status(403).json({ error: "Forbidden" }); return; }
      if (row.status !== "in_review" && row.status !== "submitted") { res.status(409).json({ error: "Cannot request info from current status" }); return; }
      toStatus = "more_info_needed";
      evType = "request_info";
      break;
    case "respond_info":
      if (!isOwner) { res.status(403).json({ error: "Forbidden" }); return; }
      if (row.status !== "more_info_needed") { res.status(409).json({ error: "Status not in more_info_needed" }); return; }
      toStatus = "in_review";
      evType = "info_response";
      break;
    case "decide_approve":
    case "decide_conditions":
    case "decide_deny":
      if (!isMgr) { res.status(403).json({ error: "Forbidden" }); return; }
      if (TERMINAL.has(row.status)) { res.status(409).json({ error: "Already decided" }); return; }
      // Quorum enforcement
      {
        const settings = await getOrgSettings();
        const quorumMode = settings?.accQuorumMode ?? "any";
        if (quorumMode === "majority") {
          const votes = await db.select().from(accEventsTable)
            .where(and(eq(accEventsTable.requestId, row.id), eq(accEventsTable.type, "vote")));
          const wantValue = action === "decide_approve" ? "approve"
                          : action === "decide_conditions" ? "conditions"
                          : "deny";
          const matching = votes.filter((v) => v.voteValue === wantValue).length;
          const total = votes.length;
          if (total === 0 || matching * 2 <= total) {
            res.status(409).json({
              error: `Quorum not reached for this decision (need majority of votes; have ${matching}/${total} matching)`,
            });
            return;
          }
        }
      }
      toStatus = action === "decide_approve" ? "approved"
              : action === "decide_conditions" ? "approved_with_conditions"
              : "denied";
      updateFields.decidedAt = created;
      if (body.decisionText) updateFields.decisionText = body.decisionText;
      if (action === "decide_conditions" && body.conditions) updateFields.conditionsText = body.conditions;
      // Generate decision letter PDF and attach
      try {
        const settings = await getOrgSettings();
        const resMetas = await loadResolutionMetas(row.resolutionId != null ? [row.resolutionId] : []);
        const resMeta = row.resolutionId != null ? resMetas.get(row.resolutionId) : undefined;
        const pdf = await buildDecisionLetterPdf({
          requestId: row.id,
          title: row.title,
          ownerName: row.ownerName,
          building: row.building,
          unitId: row.unitId,
          decision: toStatus,
          decisionText: body.decisionText ?? "",
          conditionsText: action === "decide_conditions" ? (body.conditions ?? "") : "",
          decidedAt: created,
          decidedBy: req.user!.name || req.user!.email,
          orgName: settings?.name || "Homeowners Association",
          orgAddress: settings?.address || "",
          orgContactEmail: settings?.contactEmail || "",
          resolutionNumber: resMeta?.number ?? null,
          resolutionStatus: resMeta?.status ?? null,
        });
        const uploadURL = await storage.getObjectEntityUploadURL();
        const objectPath = storage.normalizeObjectEntityPath(uploadURL);
        const putRes = await fetch(uploadURL, {
          method: "PUT",
          headers: { "Content-Type": "application/pdf" },
          body: pdf,
        });
        if (putRes.ok) {
          updateFields.decisionLetterStorageKey = objectPath;
          await db.insert(accAttachmentsTable).values({
            requestId: row.id,
            name: `decision-letter-${row.id}.pdf`,
            size: pdf.length,
            contentType: "application/pdf",
            storageKey: objectPath,
            kind: "decision_letter",
            uploadedByUserId: req.user!.id,
            uploadedByName: req.user!.name || req.user!.email,
            uploadedAt: created,
          });
        } else {
          req.log.warn({ status: putRes.status }, "Decision letter upload failed");
        }
      } catch (err) {
        req.log.warn({ err }, "Decision letter generation failed");
      }
      break;
    case "withdraw":
      if (!isOwner) { res.status(403).json({ error: "Forbidden" }); return; }
      if (TERMINAL.has(row.status)) { res.status(409).json({ error: "Already closed" }); return; }
      toStatus = "withdrawn";
      updateFields.decidedAt = created;
      break;
    case "reopen":
      if (!isMgr) { res.status(403).json({ error: "Forbidden" }); return; }
      if (!REOPENABLE.has(row.status)) { res.status(409).json({ error: "Not reopenable" }); return; }
      toStatus = "in_review";
      updateFields.decidedAt = null;
      updateFields.autoApprovalFlagged = false;
      updateFields.autoApprovalFlaggedAt = null;
      break;
    default:
      res.status(400).json({ error: "Unknown action" }); return;
  }

  await db.update(architecturalRequestsTable)
    .set({ status: toStatus, ...updateFields })
    .where(eq(architecturalRequestsTable.id, row.id));

  // Task #75: refresh the calendar deadline (clears it once the request leaves
  // submitted/under_review).
  try {
    const settingsForCal = await getOrgSettings();
    const days = settingsForCal?.accAutoApprovalDays ?? 0;
    const { materializeAccDeadline } = await import("../lib/calendarMaterialize.js");
    await materializeAccDeadline({ ...row, status: toStatus, decidedAt: (updateFields.decidedAt as string | null | undefined) ?? row.decidedAt }, days);
  } catch (err) { req.log.warn({ err }, "calendar materialize ACC deadline refresh failed"); }

  await db.insert(accEventsTable).values({
    requestId: row.id,
    type: evType,
    authorUserId: req.user!.id,
    authorName: req.user!.name || req.user!.email,
    authorRole: req.user!.role,
    body: body.note ?? null,
    fromStatus: row.status,
    toStatus,
    createdAt: created,
  });

  // Task #76: refresh calendar materialization on transition. For terminal
  // statuses we also clear the auto-approval deadline event explicitly.
  const [refreshed] = await db.select().from(architecturalRequestsTable).where(eq(architecturalRequestsTable.id, row.id));
  if (refreshed) await materializeAccRequest(refreshed);

  // Notifications
  if (isMgr) {
    await notifyOwner(row.ownerUserId, `Your request "${row.title}" is now ${toStatus.replace(/_/g, " ")}`, row.id);
  } else {
    await notifyManagers(`Owner ${action === "withdraw" ? "withdrew" : "responded to"} request "${row.title}"`, row.id);
  }

  res.json({ ok: true, status: toStatus });
});

// ── Attach / clear authorizing board resolution (manager only) ──
router.post("/architectural-requests/:id/resolution", authenticateJwt, requireManager, async (req, res) => {
  const row = await loadRequestForMutation(req, res); if (!row) return;
  const body = req.body as { resolutionId?: number | null };
  const newId = body?.resolutionId == null ? null : Number(body.resolutionId);
  if (newId !== null && !Number.isFinite(newId)) {
    res.status(400).json({ error: "resolutionId must be a number or null" }); return;
  }
  if (newId !== null) {
    const [r] = await db.select({ id: resolutionsTable.id }).from(resolutionsTable).where(eq(resolutionsTable.id, newId));
    if (!r) { res.status(404).json({ error: "Resolution not found" }); return; }
  }
  await db.update(architecturalRequestsTable)
    .set({ resolutionId: newId })
    .where(eq(architecturalRequestsTable.id, row.id));
  const [updated] = await db.select().from(architecturalRequestsTable).where(eq(architecturalRequestsTable.id, row.id));
  const metas = await loadResolutionMetas(updated!.resolutionId != null ? [updated!.resolutionId] : []);
  res.json(toRequest(updated!, metas));
});

// ── Resident-safe upload URL request (any authenticated owner or manager) ──
router.post("/architectural-requests/upload-url", authenticateJwt, async (req, res) => {
  const body = req.body as { name?: string; size?: number; contentType?: string };
  if (!body?.name) { res.status(400).json({ error: "name required" }); return; }
  try {
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
  } catch (err) {
    req.log.error({ err }, "ACC upload-url failed");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// ── Add attachment after creation ──
router.post("/architectural-requests/:id/attachments", authenticateJwt, async (req, res) => {
  const row = await loadRequestForMutation(req, res); if (!row) return;
  if (!(await isManager(req)) && row.ownerUserId !== req.user!.id) { res.status(403).json({ error: "Forbidden" }); return; }
  const body = req.body as { name?: string; storageKey?: string; size?: number; contentType?: string };
  if (!body.name || !body.storageKey) { res.status(400).json({ error: "name and storageKey required" }); return; }
  const existing = await db.select().from(accAttachmentsTable).where(eq(accAttachmentsTable.requestId, row.id));
  if (existing.length >= MAX_ATTACHMENTS) {
    res.status(400).json({ error: `At most ${MAX_ATTACHMENTS} attachments allowed` }); return;
  }
  const created = nowISO();
  const [att] = await db.insert(accAttachmentsTable).values({
    requestId: row.id,
    name: body.name,
    size: body.size ?? 0,
    contentType: body.contentType ?? null,
    storageKey: body.storageKey,
    kind: "photo",
    uploadedByUserId: req.user!.id,
    uploadedByName: req.user!.name || req.user!.email,
    uploadedAt: created,
  }).returning();
  await db.insert(accEventsTable).values({
    requestId: row.id,
    type: "attachment_added",
    authorUserId: req.user!.id,
    authorName: req.user!.name || req.user!.email,
    authorRole: req.user!.role,
    body: body.name,
    createdAt: created,
  });
  res.status(201).json(toAttachment(att!));
});

// ── Per-request attachment download (authorized: owner or manager) ──
router.get("/architectural-requests/:id/attachments/:attId", authenticateJwt, async (req, res) => {
  const row = await loadRequestForMutation(req, res); if (!row) return;
  if (!(await isManager(req)) && row.ownerUserId !== req.user!.id) { res.status(403).json({ error: "Forbidden" }); return; }
  const attId = parseInt(req.params.attId as string, 10);
  if (isNaN(attId)) { res.status(400).json({ error: "Invalid attachment id" }); return; }
  const [att] = await db.select().from(accAttachmentsTable).where(and(
    eq(accAttachmentsTable.id, attId),
    eq(accAttachmentsTable.requestId, row.id),
  ));
  if (!att) { res.status(404).json({ error: "Attachment not found" }); return; }
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
    req.log.error({ err }, "attachment download failed");
    res.status(500).json({ error: "Failed to download attachment" });
  }
});

// ── Decision letter download ──
router.get("/architectural-requests/:id/decision-letter", authenticateJwt, async (req, res) => {
  const row = await loadRequestForMutation(req, res); if (!row) return;
  if (!(await isManager(req)) && row.ownerUserId !== req.user!.id) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!row.decisionLetterStorageKey) { res.status(404).json({ error: "No decision letter" }); return; }
  try {
    const file = await storage.getObjectEntityFile(row.decisionLetterStorageKey);
    const response = await storage.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.setHeader("Content-Disposition", `attachment; filename="decision-letter-${row.id}.pdf"`);
    if (response.body) {
      const node = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      node.pipe(res);
    } else { res.end(); }
  } catch (err) {
    req.log.error({ err }, "decision-letter download failed");
    res.status(500).json({ error: "Failed to download decision letter" });
  }
});

// ── Decision letter PDF builder ──
async function buildDecisionLetterPdf(opts: {
  requestId: number; title: string; ownerName: string; building: number; unitId: string;
  decision: string; decisionText: string; conditionsText: string; decidedAt: string; decidedBy: string;
  orgName: string; orgAddress: string; orgContactEmail: string;
  resolutionNumber?: string | null;
  resolutionStatus?: "adopted" | "superseded" | "rescinded" | null;
}): Promise<Buffer> {
  const decisionLabel = opts.decision === "approved" ? "APPROVED"
    : opts.decision === "approved_with_conditions" ? "APPROVED WITH CONDITIONS"
    : opts.decision === "denied" ? "DENIED"
    : opts.decision.toUpperCase();

  const lines: Array<[string, number]> = [
    [`${opts.orgName} — Architectural Review Decision`, 16],
  ];
  if (opts.orgAddress) lines.push([opts.orgAddress, 10]);
  if (opts.orgContactEmail) lines.push([opts.orgContactEmail, 10]);
  lines.push([``, 6]);
  lines.push([`Request: #${opts.requestId} — ${opts.title}`, 11]);
  lines.push([`Owner: ${opts.ownerName}`, 11]);
  lines.push([`Property: Building ${opts.building}, Unit ${opts.unitId}`, 11]);
  lines.push([`Decision Date: ${opts.decidedAt.slice(0, 10)}`, 11]);
  if (opts.resolutionNumber) {
    const suffix = opts.resolutionStatus === "superseded" ? " (superseded)"
      : opts.resolutionStatus === "rescinded" ? " (rescinded)"
      : "";
    lines.push([`Authorizing Resolution: ${opts.resolutionNumber}${suffix}`, 11]);
  }
  lines.push([``, 6]);
  lines.push([`DECISION: ${decisionLabel}`, 13]);
  if (opts.decisionText) {
    lines.push([``, 6]);
    lines.push([`Notes:`, 11]);
    for (const chunk of chunkText(opts.decisionText, 90)) lines.push([chunk, 10]);
  }
  if (opts.conditionsText) {
    lines.push([``, 6]);
    lines.push([`Conditions:`, 11]);
    for (const chunk of chunkText(opts.conditionsText, 90)) lines.push([chunk, 10]);
  }
  lines.push([``, 14]);
  lines.push([`Issued by: ${opts.decidedBy}`, 10]);
  lines.push([`On behalf of the ${opts.orgName} Architectural Review Committee`, 10]);

  const signatureLines = await buildCurrentSignatureBlockLines(opts.decidedAt.slice(0, 10));
  for (const line of signatureLines) lines.push(line);

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
