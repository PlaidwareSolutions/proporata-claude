import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  workOrdersTable,
  unitsTable,
  workOrderAttachmentsTable,
  workOrderEventsTable,
  notificationsTable,
  usersTable,
  organizationSettingsTable,
  userNotificationPreferencesTable,
  resolutionsTable,
} from "@workspace/db/schema";
import { eq, desc, sql, and, ne, inArray } from "drizzle-orm";
import { sendEmail, buildWorkOrderCommentEmail } from "../lib/email.js";
import {
  ListWorkOrdersQueryParams,
  GetWorkOrderParams,
  CreateWorkOrderBody,
  UpdateWorkOrderBody,
  CreateWorkOrderCommentBody,
  CreateWorkOrderAttachmentBody,
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import {
  createWorkOrderNotification,
  createWorkOrderStatusNotification,
} from "../lib/notificationService.js";
import { requireManager } from "../middleware/auth.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import {
  loadGovernanceSettings,
  validateMotionAuthorizes,
  findUnconsumedBypassFor,
  findPendingMotionFor,
  markBypassConsumed,
  gateRequiredError,
} from "../lib/motionGates.js";

const router: IRouter = Router();
const storage = new ObjectStorageService();

router.get("/work-orders", async (req, res) => {
  const parsed = ListWorkOrdersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }
  let query = db.select().from(workOrdersTable).$dynamic();
  const conditions = [];
  if (parsed.data.building) conditions.push(eq(workOrdersTable.building, parsed.data.building));
  if (parsed.data.status)   conditions.push(eq(workOrdersTable.status, parsed.data.status));
  if (parsed.data.unit)     conditions.push(eq(workOrdersTable.unit, parsed.data.unit));
  // Task #119: historical filter — defaults to excluding historical entries
  // from operational lists; building/unit history views opt in via "true" or "all".
  const historicalParam = (req.query.historical as string | undefined) ?? "false";
  if (historicalParam === "true") conditions.push(eq(workOrdersTable.historical, true));
  else if (historicalParam === "false") conditions.push(eq(workOrdersTable.historical, false));
  // "all" => no constraint
  if (req.user?.role === "resident" && req.user.unitId) {
    conditions.push(eq(workOrdersTable.unit, req.user.unitId));
  }
  if (conditions.length > 0) query = query.where(and(...conditions));
  const rows = await query.orderBy(desc(workOrdersTable.opened));
  const metas = await loadResolutionMetas(
    rows.map((r) => r.resolutionId).filter((x): x is number => typeof x === "number"),
  );
  res.json(rows.map((r) => toWorkOrder(r, metas)));
});

router.post("/work-orders", async (req, res) => {
  const parsed = CreateWorkOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }

  // Task #119: historical work orders bypass the expenditure gate, calendar
  // materialization, and notifications — they only require manager+ rights and
  // a completedOn date. They are recorded as `done` regardless of input status.
  const isHistorical = parsed.data.historical === true;
  if (isHistorical) {
    const actor = req.user;
    if (!actor || (actor.role !== "manager" && actor.role !== "admin")) {
      res.status(403).json({ error: "Only managers may log historical work orders" });
      return;
    }
    if (!parsed.data.completedOn || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.data.completedOn)) {
      res.status(400).json({ error: "completedOn (YYYY-MM-DD) is required for historical work orders" });
      return;
    }
    const maxRow = await db.select({ maxId: sql<string>`max(id)` }).from(workOrdersTable);
    const maxIdStr = maxRow[0]?.maxId ?? "WO-1000";
    const maxNum = parseInt(maxIdStr.replace("WO-", ""), 10);
    const newId = `WO-${maxNum + 1}`;
    const opened = parsed.data.completedOn;
    const [created] = await db
      .insert(workOrdersTable)
      .values({
        id: newId,
        building: parsed.data.building,
        unit: parsed.data.unit ?? null,
        title: parsed.data.title,
        category: parsed.data.category,
        priority: parsed.data.priority,
        status: "done",
        vendor: parsed.data.vendor ?? null,
        vendorId: parsed.data.vendorId ?? null,
        opened,
        due: null,
        estCost: parsed.data.estCost ?? parsed.data.actualCost ?? 0,
        description: parsed.data.description ?? null,
        resolutionId: parsed.data.resolutionId ?? null,
        historical: true,
        completedOn: parsed.data.completedOn,
        actualCost: parsed.data.actualCost ?? null,
        historicalVendorName: parsed.data.historicalVendorName ?? null,
        historicalNotes: parsed.data.historicalNotes ?? null,
      })
      .returning();
    await db.insert(workOrderEventsTable).values({
      workOrderId: created.id,
      kind: "historical_logged",
      actorUserId: actor.id,
      actorName: actor.name,
      payload: {
        completedOn: parsed.data.completedOn,
        actualCost: parsed.data.actualCost ?? null,
        vendorName: parsed.data.historicalVendorName ?? null,
        notes: parsed.data.historicalNotes ?? null,
      },
      createdAt: new Date().toISOString(),
    });
    res.status(201).json(toWorkOrder(created));
    return;
  }

  // Task #64: gate above-threshold expenditures behind an Adopted motion or
  // a single-use admin emergency bypass. Resident-submitted requests carry a
  // $0 estCost and never trip the gate, so the resident path below is unaffected.
  const motionIdRaw = (req.body as { motionId?: number | null }).motionId;
  const bypassIdRaw = (req.body as { bypassId?: number | null }).bypassId;
  const proposedCents = Math.round(((parsed.data.estCost ?? 0) as number) * 100);
  const gateSettings = await loadGovernanceSettings();
  let sourceMotionId: number | null = null;
  let emergencyBypassId: number | null = null;
  if (gateSettings.expenditureThresholdCents > 0 && proposedCents >= gateSettings.expenditureThresholdCents) {
    if (typeof bypassIdRaw === "number") {
      const bypass = await findUnconsumedBypassFor("work_order", `proposed:${proposedCents}:${parsed.data.title}`, bypassIdRaw);
      if (!bypass) {
        res.status(409).json(gateRequiredError({
          reason: "Emergency bypass not found, already consumed, or does not match this work order",
          targetType: "work_order", targetId: `proposed:${proposedCents}:${parsed.data.title}`,
          motionKind: "expenditure", pendingMotionId: null,
        }).body);
        return;
      }
      emergencyBypassId = bypass.id;
    } else if (typeof motionIdRaw === "number") {
      const v = await validateMotionAuthorizes({
        motionId: motionIdRaw, expectedKind: "expenditure",
        targetType: "work_order", targetId: `proposed:${proposedCents}:${parsed.data.title}`,
        minAmountCents: proposedCents,
      });
      if (!v.ok) { res.status(409).json({ error: "motion_required", reason: v.reason }); return; }
      sourceMotionId = v.motionId;
    } else {
      const pending = await findPendingMotionFor("work_order", `proposed:${proposedCents}:${parsed.data.title}`);
      res.status(409).json(gateRequiredError({
        reason: `Estimated cost $${(proposedCents / 100).toFixed(2)} exceeds the board expenditure threshold of $${(gateSettings.expenditureThresholdCents / 100).toFixed(2)}; an Adopted expenditure motion is required.`,
        targetType: "work_order", targetId: `proposed:${proposedCents}:${parsed.data.title}`,
        motionKind: "expenditure", pendingMotionId: pending,
      }).body);
      return;
    }
  }

  // Residents may only submit work orders scoped to their own unit/building
  let building = parsed.data.building;
  let unit = parsed.data.unit ?? null;
  if (req.user?.role === "resident") {
    if (!req.user.unitId) {
      res.status(403).json({ error: "Resident account has no unit assigned" });
      return;
    }
    const [residentUnit] = await db
      .select()
      .from(unitsTable)
      .where(eq(unitsTable.id, req.user.unitId));
    if (!residentUnit) {
      res.status(403).json({ error: "Unit not found" });
      return;
    }
    building = residentUnit.building;
    unit = req.user.unitId;
  }

  const maxRow = await db
    .select({ maxId: sql<string>`max(id)` })
    .from(workOrdersTable);
  const maxIdStr = maxRow[0]?.maxId ?? "WO-1000";
  const maxNum = parseInt(maxIdStr.replace("WO-", ""), 10);
  const newId = `WO-${maxNum + 1}`;

  const today = new Date().toISOString().slice(0, 10);
  const [created] = await db
    .insert(workOrdersTable)
    .values({
      id: newId,
      building,
      unit,
      title: parsed.data.title,
      category: parsed.data.category,
      priority: parsed.data.priority,
      status: parsed.data.status ?? "open",
      vendor: parsed.data.vendor ?? null,
      vendorId: parsed.data.vendorId ?? null,
      opened: today,
      due: parsed.data.due ?? null,
      estCost: parsed.data.estCost ?? 0,
      description: parsed.data.description ?? null,
      sourceMotionId,
      emergencyBypassId,
      resolutionId: parsed.data.resolutionId ?? null,
    })
    .returning();

  // Task #64: cross-link motion ↔ work order in the audit log so reviewers
  // can trace authority for the expenditure from either direction.
  if (sourceMotionId || emergencyBypassId) {
    await db.insert(workOrderEventsTable).values({
      workOrderId: created.id,
      kind: "motion_authorized",
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.name ?? "system",
      payload: { motionId: sourceMotionId, bypassId: emergencyBypassId, amountCents: proposedCents },
      createdAt: new Date().toISOString(),
    });
    if (emergencyBypassId) await markBypassConsumed(emergencyBypassId);
  }

  const createdMetas = await loadResolutionMetas(
    created.resolutionId != null ? [created.resolutionId] : [],
  );
  res.status(201).json(toWorkOrder(created, createdMetas));

  if (created.priority === "urgent" || created.priority === "high") {
    createWorkOrderNotification({
      id: created.id,
      title: created.title,
      priority: created.priority,
      building: created.building,
    }).catch((err) => console.error("Notification error:", err));
  }

  // Task #75: materialize the work order's due-date event on the Operations calendar.
  try {
    const { materializeWorkOrder } = await import("../lib/calendarMaterialize.js");
    await materializeWorkOrder(created);
  } catch (err) { console.error("calendar materialize WO failed", err); }
});

router.get("/work-orders/:id", async (req, res) => {
  const parsed = GetWorkOrderParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid work order id" });
    return;
  }
  const [row] = await db
    .select()
    .from(workOrdersTable)
    .where(eq(workOrdersTable.id, parsed.data.id));
  if (!row) {
    res.status(404).json({ error: "Work order not found" });
    return;
  }
  if (req.user?.role === "resident" && req.user.unitId !== row.unit) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const metas = await loadResolutionMetas(
    row.resolutionId != null ? [row.resolutionId] : [],
  );
  res.json(toWorkOrder(row, metas));
});

router.patch("/work-orders/:id", requireManager, async (req, res) => {
  const idParsed = GetWorkOrderParams.safeParse({ id: req.params.id });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid work order id" });
    return;
  }
  const bodyParsed = UpdateWorkOrderBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request body", details: bodyParsed.error.issues });
    return;
  }

  const existing = await db
    .select()
    .from(workOrdersTable)
    .where(eq(workOrdersTable.id, idParsed.data.id));
  if (!existing[0]) {
    res.status(404).json({ error: "Work order not found" });
    return;
  }

  const updates: Partial<typeof workOrdersTable.$inferInsert> = {};
  const body = bodyParsed.data;
  if (body.unit !== undefined) updates.unit = body.unit;
  if (body.title !== undefined) updates.title = body.title;
  if (body.category !== undefined) updates.category = body.category;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.status !== undefined) updates.status = body.status;
  if (body.vendor !== undefined) updates.vendor = body.vendor;
  if (body.vendorId !== undefined) updates.vendorId = body.vendorId;
  if (body.due !== undefined) updates.due = body.due;
  if (body.estCost !== undefined) updates.estCost = body.estCost;
  if (body.description !== undefined) updates.description = body.description;
  if (body.resolutionId !== undefined) updates.resolutionId = body.resolutionId;
  if (body.completedOn !== undefined) updates.completedOn = body.completedOn;
  if (body.actualCost !== undefined) updates.actualCost = body.actualCost;
  if (body.historicalVendorName !== undefined) updates.historicalVendorName = body.historicalVendorName;
  if (body.historicalNotes !== undefined) updates.historicalNotes = body.historicalNotes;

  const prev = existing[0];

  // Task #64: re-gate when estCost is being raised to or above the threshold.
  // Decreases never need authorization; increases below the threshold also
  // pass through.
  if (body.estCost !== undefined && body.estCost > (prev.estCost ?? 0)) {
    const gateSettings = await loadGovernanceSettings();
    const newCents = Math.round(Number(body.estCost) * 100);
    if (gateSettings.expenditureThresholdCents > 0 && newCents >= gateSettings.expenditureThresholdCents) {
      const motionIdRaw = (req.body as { motionId?: number | null }).motionId;
      const bypassIdRaw = (req.body as { bypassId?: number | null }).bypassId;
      const targetId = `wo:${prev.id}:${newCents}`;
      if (typeof bypassIdRaw === "number") {
        const bypass = await findUnconsumedBypassFor("work_order", targetId, bypassIdRaw);
        if (!bypass) { res.status(409).json({ error: "motion_required", reason: "Bypass not found or already consumed" }); return; }
        updates.emergencyBypassId = bypass.id;
        await markBypassConsumed(bypass.id);
      } else if (typeof motionIdRaw === "number") {
        const v = await validateMotionAuthorizes({
          motionId: motionIdRaw, expectedKind: "expenditure",
          targetType: "work_order", targetId, minAmountCents: newCents,
        });
        if (!v.ok) { res.status(409).json({ error: "motion_required", reason: v.reason }); return; }
        updates.sourceMotionId = v.motionId;
      } else {
        res.status(409).json(gateRequiredError({
          reason: `Raising estimated cost to $${(newCents / 100).toFixed(2)} requires an Adopted expenditure motion.`,
          targetType: "work_order", targetId, motionKind: "expenditure",
          pendingMotionId: await findPendingMotionFor("work_order", targetId),
        }).body);
        return;
      }
    }
  }
  const actor = req.user!;
  const now = new Date().toISOString();

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(workOrdersTable)
      .set(updates)
      .where(eq(workOrdersTable.id, idParsed.data.id))
      .returning();

    const events: Array<{
      kind: string;
      payload: Record<string, unknown>;
    }> = [];
    if (body.status !== undefined && prev.status !== body.status) {
      events.push({
        kind: "status_changed",
        payload: { from: prev.status, to: body.status },
      });
    }
    if (body.priority !== undefined && prev.priority !== body.priority) {
      events.push({
        kind: "priority_changed",
        payload: { from: prev.priority, to: body.priority },
      });
    }
    if (
      (body.vendorId !== undefined && (prev.vendorId ?? null) !== (body.vendorId ?? null)) ||
      (body.vendor !== undefined && (prev.vendor ?? null) !== (body.vendor ?? null))
    ) {
      events.push({
        kind: "vendor_assigned",
        payload: {
          vendorId: body.vendorId ?? row.vendorId ?? null,
          vendorName: body.vendor ?? row.vendor ?? null,
        },
      });
    }
    for (const ev of events) {
      await tx.insert(workOrderEventsTable).values({
        workOrderId: row.id,
        kind: ev.kind,
        actorUserId: actor.id,
        actorName: actor.name,
        payload: ev.payload,
        createdAt: now,
      });
    }
    return row;
  });

  const updatedMetas = await loadResolutionMetas(
    updated.resolutionId != null ? [updated.resolutionId] : [],
  );
  res.json(toWorkOrder(updated, updatedMetas));

  if (body.status !== undefined && existing[0]?.status !== body.status) {
    createWorkOrderStatusNotification({
      id: updated.id,
      title: updated.title,
      status: updated.status,
      building: updated.building,
      unit: updated.unit,
    }).catch((err) => console.error("Notification error:", err));
  }

  // Task #75: re-materialize after edit (due date / status changes update the event).
  try {
    const { materializeWorkOrder } = await import("../lib/calendarMaterialize.js");
    await materializeWorkOrder(updated);
  } catch (err) { console.error("calendar materialize WO failed", err); }
});

router.delete("/work-orders/:id", requireManager, async (req, res) => {
  const parsed = GetWorkOrderParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid work order id" });
    return;
  }
  const [deleted] = await db
    .delete(workOrdersTable)
    .where(eq(workOrdersTable.id, parsed.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Work order not found" });
    return;
  }
  // Task #75: cancel the calendar event tied to this work order.
  try {
    const { removeSourceEvent } = await import("../lib/calendarMaterialize.js");
    await removeSourceEvent("work_order", deleted.id);
  } catch (err) { console.error("calendar removeSourceEvent WO failed", err); }
  res.status(204).send();
});

// ---- Events / Comments / Attachments ----

type AuthResult =
  | { error: 403 | 404; row?: undefined }
  | { error?: undefined; row: typeof workOrdersTable.$inferSelect };

async function loadAuthorizedWorkOrder(id: string, req: import("express").Request): Promise<AuthResult> {
  const [row] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!row) return { error: 404 };
  if (req.user?.role === "resident" && req.user.unitId !== row.unit) {
    return { error: 403 };
  }
  return { row };
}

router.get("/work-orders/:id/events", async (req, res) => {
  const idParsed = GetWorkOrderParams.safeParse({ id: req.params.id });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid work order id" });
    return;
  }
  const auth = await loadAuthorizedWorkOrder(idParsed.data.id, req);
  if (auth.error) {
    res.status(auth.error).json({ error: auth.error === 403 ? "Access denied" : "Work order not found" });
    return;
  }

  const [events, attachments] = await Promise.all([
    db
      .select()
      .from(workOrderEventsTable)
      .where(eq(workOrderEventsTable.workOrderId, idParsed.data.id))
      .orderBy(workOrderEventsTable.createdAt),
    db
      .select()
      .from(workOrderAttachmentsTable)
      .where(eq(workOrderAttachmentsTable.workOrderId, idParsed.data.id))
      .orderBy(workOrderAttachmentsTable.uploadedAt),
  ]);

  res.json({
    events: events.map(toEvent),
    attachments: attachments.map(toAttachment),
  });
});

router.post("/work-orders/:id/upload-url", async (req, res) => {
  const idParsed = GetWorkOrderParams.safeParse({ id: req.params.id });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid work order id" });
    return;
  }
  const bodyParsed = RequestUploadUrlBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }
  const auth = await loadAuthorizedWorkOrder(idParsed.data.id, req);
  if (auth.error) {
    res.status(auth.error).json({ error: auth.error === 403 ? "Access denied" : "Work order not found" });
    return;
  }
  if (!bodyParsed.data.contentType.startsWith("image/")) {
    res.status(400).json({ error: "Only image uploads are allowed for work orders" });
    return;
  }
  try {
    const { name, size, contentType } = bodyParsed.data;
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating work-order upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.post("/work-orders/:id/comments", async (req, res) => {
  const idParsed = GetWorkOrderParams.safeParse({ id: req.params.id });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid work order id" });
    return;
  }
  const bodyParsed = CreateWorkOrderCommentBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request body", details: bodyParsed.error.issues });
    return;
  }
  const text = bodyParsed.data.text.trim();
  if (!text) {
    res.status(400).json({ error: "Comment text is required" });
    return;
  }
  const auth = await loadAuthorizedWorkOrder(idParsed.data.id, req);
  if (auth.error) {
    res.status(auth.error).json({ error: auth.error === 403 ? "Access denied" : "Work order not found" });
    return;
  }

  const actor = req.user!;
  const now = new Date().toISOString();

  const [event] = await db
    .insert(workOrderEventsTable)
    .values({
      workOrderId: idParsed.data.id,
      kind: "comment",
      actorUserId: actor.id,
      actorName: actor.name,
      payload: { text },
      createdAt: now,
    })
    .returning();

  res.status(201).json(toEvent(event));

  notifyCommentCounterparty({
    workOrder: auth.row,
    actor,
    text,
  }).catch((err) => console.error("Comment notification error:", err));
});

router.patch("/work-orders/:id/comments/:eventId", async (req, res) => {
  const idParsed = GetWorkOrderParams.safeParse({ id: req.params.id });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid work order id" });
    return;
  }
  const eventId = parseInt(req.params.eventId as string, 10);
  if (Number.isNaN(eventId)) {
    res.status(400).json({ error: "Invalid event id" });
    return;
  }
  const bodyParsed = CreateWorkOrderCommentBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request body", details: bodyParsed.error.issues });
    return;
  }
  const text = bodyParsed.data.text.trim();
  if (!text) {
    res.status(400).json({ error: "Comment text is required" });
    return;
  }
  const auth = await loadAuthorizedWorkOrder(idParsed.data.id, req);
  if (auth.error) {
    res.status(auth.error).json({ error: auth.error === 403 ? "Access denied" : "Work order not found" });
    return;
  }

  const [existing] = await db
    .select()
    .from(workOrderEventsTable)
    .where(
      and(
        eq(workOrderEventsTable.id, eventId),
        eq(workOrderEventsTable.workOrderId, idParsed.data.id),
      ),
    );
  if (!existing || existing.kind !== "comment") {
    res.status(404).json({ error: "Comment not found" });
    return;
  }
  if (existing.deletedAt) {
    res.status(400).json({ error: "Cannot edit a deleted comment" });
    return;
  }
  const actor = req.user!;
  const isAuthor = existing.actorUserId === actor.id;
  const isManager = actor.role === "manager" || actor.role === "admin";
  if (!isAuthor && !isManager) {
    res.status(403).json({ error: "Only the author or a manager can edit this comment" });
    return;
  }

  const now = new Date().toISOString();
  const [updated] = await db
    .update(workOrderEventsTable)
    .set({
      payload: { text },
      editedAt: now,
      originalPayload: existing.originalPayload ?? existing.payload,
    })
    .where(eq(workOrderEventsTable.id, eventId))
    .returning();

  res.json(toEvent(updated));
});

router.delete("/work-orders/:id/comments/:eventId", async (req, res) => {
  const idParsed = GetWorkOrderParams.safeParse({ id: req.params.id });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid work order id" });
    return;
  }
  const eventId = parseInt(req.params.eventId as string, 10);
  if (Number.isNaN(eventId)) {
    res.status(400).json({ error: "Invalid event id" });
    return;
  }
  const auth = await loadAuthorizedWorkOrder(idParsed.data.id, req);
  if (auth.error) {
    res.status(auth.error).json({ error: auth.error === 403 ? "Access denied" : "Work order not found" });
    return;
  }

  const [existing] = await db
    .select()
    .from(workOrderEventsTable)
    .where(
      and(
        eq(workOrderEventsTable.id, eventId),
        eq(workOrderEventsTable.workOrderId, idParsed.data.id),
      ),
    );
  if (!existing || existing.kind !== "comment") {
    res.status(404).json({ error: "Comment not found" });
    return;
  }
  if (existing.deletedAt) {
    res.json(toEvent(existing));
    return;
  }
  const actor = req.user!;
  const isAuthor = existing.actorUserId === actor.id;
  const isManager = actor.role === "manager" || actor.role === "admin";
  if (!isAuthor && !isManager) {
    res.status(403).json({ error: "Only the author or a manager can delete this comment" });
    return;
  }

  const now = new Date().toISOString();
  const [updated] = await db
    .update(workOrderEventsTable)
    .set({
      deletedAt: now,
      originalPayload: existing.originalPayload ?? existing.payload,
    })
    .where(eq(workOrderEventsTable.id, eventId))
    .returning();

  res.json(toEvent(updated));
});

router.post("/work-orders/:id/attachments", async (req, res) => {
  const idParsed = GetWorkOrderParams.safeParse({ id: req.params.id });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid work order id" });
    return;
  }
  const bodyParsed = CreateWorkOrderAttachmentBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request body", details: bodyParsed.error.issues });
    return;
  }
  const auth = await loadAuthorizedWorkOrder(idParsed.data.id, req);
  if (auth.error) {
    res.status(auth.error).json({ error: auth.error === 403 ? "Access denied" : "Work order not found" });
    return;
  }

  if (!bodyParsed.data.mimeType.startsWith("image/")) {
    res.status(400).json({ error: "Only image attachments are supported" });
    return;
  }
  if (bodyParsed.data.size > 10 * 1024 * 1024) {
    res.status(400).json({ error: "Attachment exceeds 10 MB limit" });
    return;
  }

  const actor = req.user!;
  const now = new Date().toISOString();

  const created = await db.transaction(async (tx) => {
    const [att] = await tx
      .insert(workOrderAttachmentsTable)
      .values({
        workOrderId: idParsed.data.id,
        storageKey: bodyParsed.data.storageKey,
        mimeType: bodyParsed.data.mimeType,
        size: bodyParsed.data.size,
        name: bodyParsed.data.name ?? null,
        uploadedBy: actor.id,
        uploadedAt: now,
      })
      .returning();

    await tx.insert(workOrderEventsTable).values({
      workOrderId: idParsed.data.id,
      kind: "photo_added",
      actorUserId: actor.id,
      actorName: actor.name,
      payload: {
        attachmentId: att.id,
        name: att.name,
        storageKey: att.storageKey,
      },
      createdAt: now,
    });
    return att;
  });

  res.status(201).json(toAttachment(created));
});

router.delete("/work-orders/:id/attachments/:attId", requireManager, async (req, res) => {
  const id = req.params.id as string;
  const attId = parseInt(req.params.attId as string, 10);
  if (!id || Number.isNaN(attId)) {
    res.status(400).json({ error: "Invalid id(s)" });
    return;
  }
  const [att] = await db
    .select()
    .from(workOrderAttachmentsTable)
    .where(
      and(
        eq(workOrderAttachmentsTable.id, attId),
        eq(workOrderAttachmentsTable.workOrderId, id),
      ),
    );
  if (!att) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }

  if (att.storageKey) {
    try {
      await storage.deleteObject(att.storageKey);
    } catch (err) {
      req.log.warn({ err }, "Failed to delete attachment object from storage");
    }
  }

  await db.delete(workOrderAttachmentsTable).where(eq(workOrderAttachmentsTable.id, attId));
  res.status(204).send();
});

// ---- Helpers ----

async function notifyCommentCounterparty({
  workOrder,
  actor,
  text,
}: {
  workOrder: typeof workOrdersTable.$inferSelect;
  actor: { id: number; role: string; name: string };
  text: string;
}) {
  const now = new Date().toISOString();
  const snippet = text.length > 80 ? `${text.slice(0, 79)}…` : text;
  const message = `New comment on "${workOrder.title}" from ${actor.name}: ${snippet}`;
  const recipientIds: number[] = [];

  if (actor.role === "resident") {
    // Notify managers + admins (excluding the actor)
    const mgrs = await db
      .select()
      .from(usersTable)
      .where(and(ne(usersTable.role, "resident"), eq(usersTable.pending, false)));
    for (const m of mgrs) {
      if (m.id !== actor.id) recipientIds.push(m.id);
    }
  } else {
    // Manager/admin — notify the resident(s) of the unit, if any
    if (workOrder.unit) {
      const residents = await db
        .select()
        .from(usersTable)
        .where(and(eq(usersTable.unitId, workOrder.unit), eq(usersTable.role, "resident")));
      for (const r of residents) {
        if (r.id !== actor.id && !r.pending) recipientIds.push(r.id);
      }
    }
  }

  if (recipientIds.length === 0) return;

  const recipients = await db
    .select()
    .from(usersTable)
    .where(inArray(usersTable.id, recipientIds));

  const [orgRow] = await db
    .select()
    .from(organizationSettingsTable)
    .where(eq(organizationSettingsTable.id, 1));
  const orgName = orgRow?.name ?? "HOA Hub";

  const subject = `New comment on work order: ${workOrder.title}`;
  const html = buildWorkOrderCommentEmail({
    orgName,
    workOrderId: workOrder.id,
    workOrderTitle: workOrder.title,
    building: workOrder.building,
    actorName: actor.name,
    text,
  });

  for (const user of recipients) {
    const [pref] = await db
      .select()
      .from(userNotificationPreferencesTable)
      .where(eq(userNotificationPreferencesTable.userId, String(user.id)));

    // Default = on when no preferences row exists.
    const wantsInApp = !pref || pref.workOrdersInApp !== 0;
    const wantsEmail = !pref || pref.workOrdersEmail !== 0;

    if (wantsInApp) {
      await db.insert(notificationsTable).values({
        userId: user.id,
        type: "wo_comment",
        message,
        entityType: "work_order",
        entityId: workOrder.id,
        read: false,
        createdAt: now,
      });
    }

    if (!wantsEmail || !user.email) continue;
    try {
      const result = await sendEmail(user.email, subject, html);
      if (!result.ok) {
        console.error("Comment email failed:", result.error);
      }
    } catch (err) {
      console.error("Comment email error:", err);
    }
  }
}

type ResolutionMeta = {
  number: string | null;
  title: string | null;
  status: "adopted" | "superseded" | "rescinded";
};

async function loadResolutionMetas(ids: number[]): Promise<Map<number, ResolutionMeta>> {
  const out = new Map<number, ResolutionMeta>();
  const unique = Array.from(new Set(ids.filter((x): x is number => typeof x === "number")));
  if (unique.length === 0) return out;
  const rows = await db
    .select({
      id: resolutionsTable.id,
      number: resolutionsTable.number,
      supersededByResolutionId: resolutionsTable.supersededByResolutionId,
      rescindedByMotionId: resolutionsTable.rescindedByMotionId,
      motionTitle: sql<string | null>`(select title from motions where motions.id = ${resolutionsTable.motionId})`,
    })
    .from(resolutionsTable)
    .where(inArray(resolutionsTable.id, unique));
  for (const r of rows) {
    let status: ResolutionMeta["status"] = "adopted";
    if (r.rescindedByMotionId) status = "rescinded";
    else if (r.supersededByResolutionId) status = "superseded";
    out.set(r.id, { number: r.number ?? null, title: r.motionTitle ?? null, status });
  }
  return out;
}

function toWorkOrder(
  row: typeof workOrdersTable.$inferSelect,
  resolutions?: Map<number, ResolutionMeta>,
) {
  const r = row.resolutionId != null ? resolutions?.get(row.resolutionId) : undefined;
  return {
    id: row.id,
    building: row.building,
    unit: row.unit ?? null,
    title: row.title,
    category: row.category,
    priority: row.priority,
    status: row.status,
    vendor: row.vendor ?? null,
    vendorId: row.vendorId ?? null,
    opened: row.opened,
    due: row.due ?? null,
    estCost: row.estCost,
    description: row.description ?? null,
    resolutionId: row.resolutionId ?? null,
    resolutionNumber: r?.number ?? null,
    resolutionTitle: r?.title ?? null,
    resolutionStatus: r?.status ?? null,
    historical: row.historical,
    completedOn: row.completedOn ?? null,
    actualCost: row.actualCost ?? null,
    historicalVendorName: row.historicalVendorName ?? null,
    historicalNotes: row.historicalNotes ?? null,
    sourceMotionId: row.sourceMotionId ?? null,
    emergencyBypassId: row.emergencyBypassId ?? null,
  };
}

function toEvent(row: typeof workOrderEventsTable.$inferSelect) {
  const isDeleted = !!row.deletedAt;
  let payload = (row.payload ?? null) as Record<string, unknown> | null;
  if (isDeleted && row.kind === "comment" && payload && typeof payload === "object") {
    payload = { ...payload, text: "" };
  }
  return {
    id: row.id,
    workOrderId: row.workOrderId,
    kind: row.kind,
    actorUserId: row.actorUserId ?? null,
    actorName: row.actorName ?? null,
    payload,
    createdAt: row.createdAt,
    editedAt: row.editedAt ?? null,
    deletedAt: row.deletedAt ?? null,
  };
}

function toAttachment(row: typeof workOrderAttachmentsTable.$inferSelect) {
  return {
    id: row.id,
    workOrderId: row.workOrderId,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    size: row.size,
    name: row.name ?? null,
    uploadedBy: row.uploadedBy ?? null,
    uploadedAt: row.uploadedAt,
  };
}

export default router;
