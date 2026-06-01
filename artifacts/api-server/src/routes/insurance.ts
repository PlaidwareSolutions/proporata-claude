import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  insurancePoliciesTable,
  insurancePolicyHistoryTable,
  insurancePolicyHistoryDocumentsTable,
  documentsTable,
} from "@workspace/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  GetInsuranceParams,
  UpdateInsuranceBody,
  CreateInsurancePolicyHistoryBody,
  LinkInsurancePolicyHistoryDocumentBody,
} from "@workspace/api-zod";
import { decideInsuranceRollover } from "../lib/insuranceRollover.js";
import { buildingAccessFor, canSeeBuilding } from "../lib/buildingAccess.js";

export const insuranceReadRouter: IRouter = Router();
const router: IRouter = Router();

insuranceReadRouter.get("/insurance", async (req, res) => {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const access = await buildingAccessFor(req.user);
  const where = access.buildingIds === null
    ? undefined
    : access.buildingIds.length === 0
      ? null
      : inArray(insurancePoliciesTable.building, access.buildingIds);
  if (where === null) { res.json([]); return; }
  const rows = where
    ? await db.select().from(insurancePoliciesTable).where(where).orderBy(insurancePoliciesTable.building)
    : await db.select().from(insurancePoliciesTable).orderBy(insurancePoliciesTable.building);
  res.json(rows.map(toPolicy));
});

insuranceReadRouter.get("/insurance/:id", async (req, res) => {
  const parsed = GetInsuranceParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid building id" });
    return;
  }
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const access = await buildingAccessFor(req.user);
  if (!canSeeBuilding(access, parsed.data.id)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const [row] = await db
    .select()
    .from(insurancePoliciesTable)
    .where(eq(insurancePoliciesTable.building, parsed.data.id));
  if (!row) {
    res.status(404).json({ error: "Insurance policy not found" });
    return;
  }
  res.json(toPolicy(row));
});

router.patch("/insurance/:id", async (req, res) => {
  const idParsed = GetInsuranceParams.safeParse({ id: req.params.id });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid building id" });
    return;
  }
  const bodyParsed = UpdateInsuranceBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request body", details: bodyParsed.error.issues });
    return;
  }

  const [existing] = await db
    .select()
    .from(insurancePoliciesTable)
    .where(eq(insurancePoliciesTable.building, idParsed.data.id));
  if (!existing) {
    res.status(404).json({ error: "Insurance policy not found" });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const decision = decideInsuranceRollover(
    {
      building: existing.building,
      carrier: existing.carrier,
      policyNo: existing.policyNo,
      coverage: existing.coverage,
      premium: existing.premium,
      effectiveFrom: existing.effectiveFrom ?? null,
      expires: existing.expires,
    },
    bodyParsed.data,
    today,
  );

  const updates: Partial<typeof insurancePoliciesTable.$inferInsert> = {};
  const body = bodyParsed.data;
  if (body.carrier !== undefined) updates.carrier = body.carrier;
  if (body.policyNo !== undefined) updates.policyNo = body.policyNo;
  if (body.coverage !== undefined) updates.coverage = body.coverage;
  if (body.premium !== undefined) updates.premium = body.premium;
  if (body.expires !== undefined) updates.expires = body.expires;
  if (body.status !== undefined) updates.status = body.status;
  if (decision.shouldRollover && decision.newEffectiveFrom) {
    updates.effectiveFrom = decision.newEffectiveFrom;
  }

  // Wrap rollover insert + current-policy update in a single transaction so
  // we never leave an orphaned history row if the update fails (or vice-versa).
  const updated = await db.transaction(async (tx) => {
    if (decision.shouldRollover && decision.historyRow) {
      await tx.insert(insurancePolicyHistoryTable).values({
        ...decision.historyRow,
        createdAt: new Date().toISOString(),
      });
    }
    const [row] = await tx
      .update(insurancePoliciesTable)
      .set(updates)
      .where(eq(insurancePoliciesTable.building, idParsed.data.id))
      .returning();
    return row;
  });

  res.json(toPolicy(updated));
});

// Manager-only: prior policies are an internal archive, not part of the
// owner's current-summary view.
router.get("/insurance/:id/history", async (req, res) => {
  const parsed = GetInsuranceParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid building id" });
    return;
  }
  const rows = await db
    .select()
    .from(insurancePolicyHistoryTable)
    .where(eq(insurancePolicyHistoryTable.building, parsed.data.id))
    .orderBy(desc(insurancePolicyHistoryTable.effectiveTo));
  res.json(rows.map(toHistory));
});

// Manual backfill of a previously-held policy. Used when an admin enters
// a historical policy after the fact (auto-rollover only fires on PATCH).
router.post("/insurance/:id/history", async (req, res) => {
  const idParsed = GetInsuranceParams.safeParse({ id: req.params.id });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid building id" });
    return;
  }
  const bodyParsed = CreateInsurancePolicyHistoryBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request body", details: bodyParsed.error.issues });
    return;
  }
  const [row] = await db
    .insert(insurancePolicyHistoryTable)
    .values({
      building: idParsed.data.id,
      carrier: bodyParsed.data.carrier,
      policyNo: bodyParsed.data.policyNo,
      coverage: bodyParsed.data.coverage,
      premium: bodyParsed.data.premium,
      effectiveFrom: bodyParsed.data.effectiveFrom,
      effectiveTo: bodyParsed.data.effectiveTo,
      endedReason: bodyParsed.data.endedReason ?? "manual_backfill",
      notes: bodyParsed.data.notes ?? null,
      createdAt: new Date().toISOString(),
    })
    .returning();
  res.status(201).json(toHistory(row));
});

// Manager-only: historical policy declarations / COIs / claim files.
router.get("/insurance/history/:historyId/documents", async (req, res) => {
  const historyId = Number(req.params.historyId);
  if (!Number.isFinite(historyId)) {
    res.status(400).json({ error: "Invalid history id" });
    return;
  }
  const links = await db
    .select()
    .from(insurancePolicyHistoryDocumentsTable)
    .where(eq(insurancePolicyHistoryDocumentsTable.historyId, historyId));
  if (links.length === 0) {
    res.json([]);
    return;
  }
  const docs = await db
    .select()
    .from(documentsTable)
    .where(inArray(documentsTable.id, links.map((l) => l.documentId)));
  const docMap = new Map(docs.map((d) => [d.id, d]));
  res.json(
    links.map((l) => {
      const d = docMap.get(l.documentId);
      return {
        linkId: l.id,
        historyId: l.historyId,
        kind: l.kind,
        documentId: l.documentId,
        name: d?.name ?? null,
        category: d?.category ?? null,
        uploaded: d?.uploaded ?? null,
      };
    }),
  );
});

router.post("/insurance/history/:historyId/documents", async (req, res) => {
  const historyId = Number(req.params.historyId);
  if (!Number.isFinite(historyId)) {
    res.status(400).json({ error: "Invalid history id" });
    return;
  }
  const bodyParsed = LinkInsurancePolicyHistoryDocumentBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request body", details: bodyParsed.error.issues });
    return;
  }
  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.id, bodyParsed.data.documentId));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const [row] = await db
    .insert(insurancePolicyHistoryDocumentsTable)
    .values({
      historyId,
      documentId: bodyParsed.data.documentId,
      kind: bodyParsed.data.kind ?? "other",
      createdAt: new Date().toISOString(),
    })
    .returning();
  res.status(201).json({
    linkId: row.id,
    historyId: row.historyId,
    documentId: row.documentId,
    kind: row.kind,
  });
});

function toPolicy(row: typeof insurancePoliciesTable.$inferSelect) {
  return {
    building: row.building,
    carrier: row.carrier,
    policyNo: row.policyNo,
    coverage: row.coverage,
    premium: row.premium,
    expires: row.expires,
    status: row.status,
    effectiveFrom: row.effectiveFrom ?? null,
  };
}

function toHistory(row: typeof insurancePolicyHistoryTable.$inferSelect) {
  return {
    id: row.id,
    building: row.building,
    carrier: row.carrier,
    policyNo: row.policyNo,
    coverage: row.coverage,
    premium: row.premium,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    endedReason: row.endedReason ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt,
  };
}

export default router;
