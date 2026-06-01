import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  vendorsTable,
  workOrdersTable,
  workOrderAttachmentsTable,
  vendorCertificatesTable,
  vendorContractsTable,
  bidQuotesTable,
  documentsTable,
} from "@workspace/db/schema";
import { eq, and, sum, count, ne, isNull, or, inArray, desc } from "drizzle-orm";
import {
  ListVendorsQueryParams,
  GetVendorParams,
  CreateVendorBody,
  UpdateVendorBody,
} from "@workspace/api-zod";
import { aggregateVendorFiles, filterVendorFiles, type VendorFileSource } from "../lib/vendorFiles.js";

const router: IRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_ALLOWED_RE = /^[+()\-.\s\d\u00a0]+$/;

function isValidEmail(value: string): boolean {
  const v = value.trim();
  if (v.length === 0 || v.length > 254) return false;
  return EMAIL_RE.test(v);
}

function isValidPhone(value: string): boolean {
  const v = value.trim();
  if (v.length === 0) return false;
  if (!PHONE_ALLOWED_RE.test(v)) return false;
  const digits = v.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function validateContactFields(
  fields: { phone?: string | null; email?: string | null },
): { field: "phone" | "email"; message: string } | null {
  if (fields.phone !== undefined && fields.phone !== null && !isValidPhone(fields.phone)) {
    return { field: "phone", message: "Invalid phone number" };
  }
  if (fields.email !== undefined && fields.email !== null && !isValidEmail(fields.email)) {
    return { field: "email", message: "Invalid email address" };
  }
  return null;
}

router.get("/vendors", async (req, res) => {
  const parsed = ListVendorsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }

  let query = db.select().from(vendorsTable).$dynamic();
  if (parsed.data.status) {
    query = query.where(eq(vendorsTable.status, parsed.data.status));
  }
  const vendors = await query.orderBy(vendorsTable.name);

  const woStats = await db
    .select({
      vendorId: workOrdersTable.vendorId,
      activeWoCount: count(workOrdersTable.id),
      totalSpend: sum(workOrdersTable.estCost),
    })
    .from(workOrdersTable)
    .where(ne(workOrdersTable.status, "done"))
    .groupBy(workOrdersTable.vendorId);

  const allSpend = await db
    .select({
      vendorId: workOrdersTable.vendorId,
      totalSpend: sum(workOrdersTable.estCost),
    })
    .from(workOrdersTable)
    .groupBy(workOrdersTable.vendorId);

  const activeMap = new Map(woStats.map((r) => [r.vendorId, Number(r.activeWoCount)]));
  const spendMap = new Map(allSpend.map((r) => [r.vendorId, Number(r.totalSpend ?? 0)]));

  res.json(
    vendors.map((v) => toVendor(v, activeMap.get(v.id) ?? 0, spendMap.get(v.id) ?? 0)),
  );
});

router.post("/vendors", async (req, res) => {
  const parsed = CreateVendorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }

  const contactErr = validateContactFields({ phone: parsed.data.phone, email: parsed.data.email });
  if (contactErr) {
    res.status(400).json({ error: contactErr.message, field: contactErr.field });
    return;
  }

  const [created] = await db
    .insert(vendorsTable)
    .values({
      name: parsed.data.name,
      tradeCategory: parsed.data.tradeCategory,
      contactName: parsed.data.contactName,
      phone: parsed.data.phone.trim(),
      email: parsed.data.email.trim(),
      licenseNumber: parsed.data.licenseNumber ?? null,
      status: parsed.data.status ?? "active",
      notes: parsed.data.notes ?? null,
    })
    .returning();

  res.status(201).json(toVendor(created, 0, 0));
});

router.get("/vendors/:id", async (req, res) => {
  const parsed = GetVendorParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid vendor id" });
    return;
  }

  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, parsed.data.id));

  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }

  const workOrders = await db
    .select()
    .from(workOrdersTable)
    .where(eq(workOrdersTable.vendorId, vendor.id))
    .orderBy(desc(workOrdersTable.opened), desc(workOrdersTable.id));

  const activeWoCount = workOrders.filter((w) => w.status !== "done").length;
  const totalSpend = workOrders.reduce((s, w) => s + w.estCost, 0);

  res.json({
    ...toVendor(vendor, activeWoCount, totalSpend),
    workOrders: workOrders.map(toWorkOrder),
  });
});

router.patch("/vendors/:id", async (req, res) => {
  const idParsed = GetVendorParams.safeParse({ id: req.params.id });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid vendor id" });
    return;
  }

  const bodyParsed = UpdateVendorBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request body", details: bodyParsed.error.issues });
    return;
  }

  const contactErr = validateContactFields({
    phone: bodyParsed.data.phone,
    email: bodyParsed.data.email,
  });
  if (contactErr) {
    res.status(400).json({ error: contactErr.message, field: contactErr.field });
    return;
  }

  const [existing] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, idParsed.data.id));

  if (!existing) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }

  const updates: Partial<typeof vendorsTable.$inferInsert> = {};
  const body = bodyParsed.data;
  if (body.name !== undefined) updates.name = body.name;
  if (body.tradeCategory !== undefined) updates.tradeCategory = body.tradeCategory;
  if (body.contactName !== undefined) updates.contactName = body.contactName;
  if (body.phone !== undefined) updates.phone = body.phone.trim();
  if (body.email !== undefined) updates.email = body.email.trim();
  if (body.licenseNumber !== undefined) updates.licenseNumber = body.licenseNumber;
  if (body.status !== undefined) updates.status = body.status;
  if (body.notes !== undefined) updates.notes = body.notes;

  const [updated] = await db
    .update(vendorsTable)
    .set(updates)
    .where(eq(vendorsTable.id, idParsed.data.id))
    .returning();

  const woStats = await db
    .select({
      activeWoCount: count(workOrdersTable.id),
      totalSpend: sum(workOrdersTable.estCost),
    })
    .from(workOrdersTable)
    .where(and(eq(workOrdersTable.vendorId, updated.id), ne(workOrdersTable.status, "done")));

  const allSpendRows = await db
    .select({ totalSpend: sum(workOrdersTable.estCost) })
    .from(workOrdersTable)
    .where(eq(workOrdersTable.vendorId, updated.id));

  res.json(
    toVendor(
      updated,
      Number(woStats[0]?.activeWoCount ?? 0),
      Number(allSpendRows[0]?.totalSpend ?? 0),
    ),
  );
});

router.get("/vendors/:id/files", async (req, res) => {
  const parsed = GetVendorParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid vendor id" });
    return;
  }
  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, parsed.data.id));
  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }

  const certs = await db
    .select()
    .from(vendorCertificatesTable)
    .where(eq(vendorCertificatesTable.vendorId, vendor.id));
  const contracts = await db
    .select()
    .from(vendorContractsTable)
    .where(eq(vendorContractsTable.vendorId, vendor.id));

  const woRows = await db
    .select({ id: workOrdersTable.id })
    .from(workOrdersTable)
    .where(eq(workOrdersTable.vendorId, vendor.id));
  const woIds = woRows.map((r) => r.id);
  const woAttachments = woIds.length > 0
    ? await db
        .select()
        .from(workOrderAttachmentsTable)
        .where(inArray(workOrderAttachmentsTable.workOrderId, woIds))
    : [];

  const bidQuotes = await db
    .select()
    .from(bidQuotesTable)
    .where(eq(bidQuotesTable.vendorId, vendor.id));

  const docs = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.vendorId, vendor.id));

  const all = aggregateVendorFiles({
      certificates: certs.map((c) => ({
        id: c.id,
        kind: c.kind,
        documentStorageKey: c.documentStorageKey,
        expiresOn: c.expiresOn,
        createdAt: c.createdAt,
      })),
      contracts: contracts.map((k) => ({
        id: k.id,
        title: k.title,
        contractDocStorageKey: k.contractDocStorageKey,
        createdAt: k.createdAt,
      })),
      workOrderAttachments: woAttachments.map((a) => ({
        id: a.id,
        workOrderId: a.workOrderId,
        name: a.name,
        storageKey: a.storageKey,
        uploadedAt: a.uploadedAt,
      })),
      bidQuotes: bidQuotes.map((q) => ({
        id: q.id,
        bidRequestId: q.bidRequestId,
        licenseStorageKey: q.licenseStorageKey,
        coiStorageKey: q.coiStorageKey,
        quotePdfStorageKey: q.quotePdfStorageKey,
        submittedAt: q.submittedAt,
      })),
    documents: docs.map((d) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      storageKey: d.storageKey,
      uploaded: d.uploaded,
    })),
  });

  const validSources: VendorFileSource[] = ["certificate", "contract", "work_order", "bid_quote", "document"];
  const sourceParam = typeof req.query.source === "string" ? req.query.source : undefined;
  const yearParam = typeof req.query.year === "string" ? Number(req.query.year) : undefined;
  const qParam = typeof req.query.q === "string" ? req.query.q : undefined;
  res.json(filterVendorFiles(all, {
    source: sourceParam && validSources.includes(sourceParam as VendorFileSource) ? (sourceParam as VendorFileSource) : undefined,
    year: yearParam && Number.isFinite(yearParam) ? yearParam : undefined,
    q: qParam,
  }));
});

router.delete("/vendors/:id", async (req, res) => {
  const parsed = GetVendorParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid vendor id" });
    return;
  }

  const [existing] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, parsed.data.id));

  if (!existing) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }

  await db
    .update(workOrdersTable)
    .set({ vendorId: null })
    .where(eq(workOrdersTable.vendorId, parsed.data.id));

  await db.delete(vendorsTable).where(eq(vendorsTable.id, parsed.data.id));

  res.status(204).send();
});

function toVendor(
  row: typeof vendorsTable.$inferSelect,
  activeWoCount: number,
  totalSpend: number,
) {
  return {
    id: row.id,
    name: row.name,
    tradeCategory: row.tradeCategory,
    contactName: row.contactName,
    phone: row.phone,
    email: row.email,
    licenseNumber: row.licenseNumber ?? null,
    status: row.status,
    notes: row.notes ?? null,
    activeWoCount,
    totalSpend,
  };
}

function toWorkOrder(row: typeof workOrdersTable.$inferSelect) {
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
  };
}

export default router;
