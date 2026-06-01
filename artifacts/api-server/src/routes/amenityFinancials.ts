// Task #88: Reporting & financials routes for amenities. All routes are
// scoped under `/reports/amenities/*` (managers/admins read-write; board
// members read-only) plus `/me/amenity-usage` and
// `/users/:userId/amenity-usage` for owner-history surfaces.

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  amenitiesTable,
  amenityExpenseEntriesTable,
  organizationSettingsTable,
  usersTable,
} from "@workspace/db/schema";
import { and, asc, eq } from "drizzle-orm";
import {
  loadRevenueEvents, rollupRevenue, loadUtilizationGrid, loadDepositSnapshot,
  executeRefund, loadUserUsage, loadExpenseTotals,
  csvRow, isIsoDate, nowISO, type RevenueEvent,
} from "../lib/amenityFinancials.js";
import type { AuthUser } from "../middleware/auth.js";

const router: IRouter = Router();

function isManagerOrAdmin(u: AuthUser): boolean { return u.role === "admin" || u.role === "manager"; }
function canRead(u: AuthUser): boolean { return isManagerOrAdmin(u) || u.boardMember === true; }

function requireFinanceRead(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): void {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!canRead(req.user)) { res.status(403).json({ error: "Manager, admin, or board member required" }); return; }
  next();
}

function requireFinanceWrite(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): void {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!isManagerOrAdmin(req.user)) { res.status(403).json({ error: "Manager or admin required" }); return; }
  next();
}

function parseDateRange(req: import("express").Request): { from?: string; to?: string; error?: string } {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  if (from && !isIsoDate(from)) return { error: "Invalid 'from' date — expected YYYY-MM-DD" };
  if (to && !isIsoDate(to)) return { error: "Invalid 'to' date — expected YYYY-MM-DD" };
  return { from, to };
}

function priorPeriod(from?: string, to?: string): { from?: string; to?: string } {
  if (!from || !to) return {};
  const f = new Date(`${from}T00:00:00Z`).getTime();
  const t = new Date(`${to}T00:00:00Z`).getTime();
  if (!Number.isFinite(f) || !Number.isFinite(t) || t < f) return {};
  const span = t - f;
  const pf = new Date(f - span - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const pt = new Date(f - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { from: pf, to: pt };
}

function priorYear(from?: string, to?: string): { from?: string; to?: string } {
  if (!from || !to) return {};
  const shift = (s: string) => {
    const d = new Date(`${s}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().slice(0, 10);
  };
  return { from: shift(from), to: shift(to) };
}

// ── Revenue / KPIs ───────────────────────────────────────────────────────

router.get("/reports/amenities/revenue", requireFinanceRead, async (req, res) => {
  const range = parseDateRange(req);
  if (range.error) { res.status(400).json({ error: range.error }); return; }
  const amenityId = req.query.amenityId ? Number(req.query.amenityId) : undefined;
  const unitId = typeof req.query.unitId === "string" ? req.query.unitId : undefined;
  const compare = String(req.query.compare ?? "");

  const events = await loadRevenueEvents({ from: range.from, to: range.to, amenityId, unitId });
  const rollup = rollupRevenue(events);

  // Held deposit balance (always current, not range-bound)
  const dep = await loadDepositSnapshot({});

  let priorRollup: ReturnType<typeof rollupRevenue> | null = null;
  let priorYearRollup: ReturnType<typeof rollupRevenue> | null = null;
  if (compare === "prior_period" || compare === "both") {
    const pp = priorPeriod(range.from, range.to);
    if (pp.from && pp.to) {
      const prevEvents = await loadRevenueEvents({ from: pp.from, to: pp.to, amenityId, unitId });
      priorRollup = rollupRevenue(prevEvents);
    }
  }
  if (compare === "prior_year" || compare === "both") {
    const py = priorYear(range.from, range.to);
    if (py.from && py.to) {
      const prevEvents = await loadRevenueEvents({ from: py.from, to: py.to, amenityId, unitId });
      priorYearRollup = rollupRevenue(prevEvents);
    }
  }

  res.json({
    range: { from: range.from ?? null, to: range.to ?? null },
    kpis: {
      grossCents: rollup.totalGrossCents,
      refundCents: rollup.totalRefundCents,
      netCents: rollup.totalNetCents,
      heldBalanceCents: dep.heldBalanceCents,
      eventCount: events.length,
      refundRate: rollup.totalGrossCents > 0 ? rollup.totalRefundCents / rollup.totalGrossCents : 0,
    },
    byKind: rollup.byKind,
    byAmenity: rollup.byAmenity,
    byMonth: rollup.byMonth,
    priorPeriod: priorRollup ? {
      grossCents: priorRollup.totalGrossCents,
      refundCents: priorRollup.totalRefundCents,
      netCents: priorRollup.totalNetCents,
      byMonth: priorRollup.byMonth,
    } : null,
    priorYear: priorYearRollup ? {
      grossCents: priorYearRollup.totalGrossCents,
      refundCents: priorYearRollup.totalRefundCents,
      netCents: priorYearRollup.totalNetCents,
      byMonth: priorYearRollup.byMonth,
    } : null,
  });
});

router.get("/reports/amenities/revenue.csv", requireFinanceRead, async (req, res) => {
  const range = parseDateRange(req);
  if (range.error) { res.status(400).json({ error: range.error }); return; }
  const amenityId = req.query.amenityId ? Number(req.query.amenityId) : undefined;
  const unitId = typeof req.query.unitId === "string" ? req.query.unitId : undefined;
  const events = await loadRevenueEvents({ from: range.from, to: range.to, amenityId, unitId });
  let body = csvRow(["occurred_at", "amenity", "kind", "unit_id", "owner_user_id", "gross_cents", "refund_cents", "net_cents", "source_kind", "source_id", "memo"]);
  for (const e of events) {
    body += csvRow([e.occurredAt, e.amenityName, e.kind, e.unitId ?? "", e.ownerUserId ?? "", e.grossCents, e.refundCents, e.netCents, e.sourceKind, e.sourceId, e.memo]);
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="amenity-revenue-${range.from ?? "all"}_${range.to ?? "all"}.csv"`);
  res.send(body);
});

// ── Utilization heat-map ─────────────────────────────────────────────────

router.get("/reports/amenities/utilization", requireFinanceRead, async (req, res) => {
  const range = parseDateRange(req);
  if (range.error) { res.status(400).json({ error: range.error }); return; }
  const amenityId = req.query.amenityId ? Number(req.query.amenityId) : null;
  const today = new Date().toISOString().slice(0, 10);
  const ninetyAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const grid = await loadUtilizationGrid(amenityId, range.from ?? ninetyAgo, range.to ?? today);
  res.json({
    amenityId: amenityId ?? null,
    range: { from: range.from ?? ninetyAgo, to: range.to ?? today },
    cells: grid.cells,
    totalBookings: grid.totalBookings,
    totalMinutes: grid.totalMinutes,
    peak: grid.peak,
  });
});

// ── Deposit ledger view ──────────────────────────────────────────────────

router.get("/reports/amenities/deposits", requireFinanceRead, async (req, res) => {
  const range = parseDateRange(req);
  if (range.error) { res.status(400).json({ error: range.error }); return; }
  const stuckDays = req.query.stuckDays ? Math.max(0, Number(req.query.stuckDays)) : undefined;
  const snap = await loadDepositSnapshot({ from: range.from, to: range.to, ageDaysMin: stuckDays });
  res.json(snap);
});

router.get("/reports/amenities/deposits.csv", requireFinanceRead, async (req, res) => {
  const range = parseDateRange(req);
  if (range.error) { res.status(400).json({ error: range.error }); return; }
  const snap = await loadDepositSnapshot({ from: range.from, to: range.to });
  let body = csvRow(["created_at", "booking_id", "amenity", "unit_id", "owner", "kind", "amount_cents", "balance_cents", "reason", "actor"]);
  for (const r of snap.ledger) {
    body += csvRow([r.createdAt, r.bookingId, r.amenityName, r.unitId ?? "", r.ownerName, r.kind, r.amountCents, r.balanceCents, r.reason, r.actorName]);
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="amenity-deposits.csv"`);
  res.send(body);
});

// ── Refund engine ────────────────────────────────────────────────────────

router.post("/reports/amenities/refunds", requireFinanceWrite, async (req, res) => {
  const body = req.body ?? {};
  const source = body.source as string;
  if (!["booking", "charging_session", "guest_parking_permit"].includes(source)) {
    res.status(400).json({ error: "Invalid source" }); return;
  }
  const sourceId = Number(body.sourceId);
  if (!Number.isFinite(sourceId)) { res.status(400).json({ error: "Invalid sourceId" }); return; }
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!reason.trim()) { res.status(400).json({ error: "Reason required" }); return; }
  const amountCents = body.amountCents != null ? Math.max(0, Math.floor(Number(body.amountCents))) : undefined;
  const approveAboveThreshold = body.approveAboveThreshold === true;

  const [org] = await db.select().from(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
  const thresholdCents = org?.expenditureThresholdCents ?? 0;
  const isAdmin = req.user!.role === "admin";

  const result = await executeRefund({
    source: source as "booking" | "charging_session" | "guest_parking_permit",
    sourceId, amountCents, reason,
    actorUserId: req.user!.id, actorName: req.user!.name,
    approveAboveThreshold,
  }, thresholdCents, isAdmin);

  if (!result.ok) {
    res.status(result.approvalRequired ? 403 : 400).json(result);
    return;
  }
  res.json(result);
});

// ── Operating expenses ───────────────────────────────────────────────────

router.get("/reports/amenities/expenses", requireFinanceRead, async (req, res) => {
  const range = parseDateRange(req);
  if (range.error) { res.status(400).json({ error: range.error }); return; }
  const amenityId = req.query.amenityId ? Number(req.query.amenityId) : undefined;
  const data = await loadExpenseTotals({ from: range.from, to: range.to, amenityId });
  res.json({
    rows: data.rows,
    totalCents: data.totalCents,
    byAmenity: Array.from(data.byAmenity.entries()).map(([id, total]) => ({ amenityId: id, totalCents: total })),
    byMonth: Array.from(data.byMonth.entries()).map(([month, total]) => ({ month, totalCents: total })),
  });
});

router.post("/reports/amenities/expenses", requireFinanceWrite, async (req, res) => {
  const b = req.body ?? {};
  const amenityId = Number(b.amenityId);
  if (!Number.isFinite(amenityId)) { res.status(400).json({ error: "amenityId required" }); return; }
  const [a] = await db.select().from(amenitiesTable).where(eq(amenitiesTable.id, amenityId));
  if (!a) { res.status(404).json({ error: "Amenity not found" }); return; }
  const occurredOn = typeof b.occurredOn === "string" && isIsoDate(b.occurredOn) ? b.occurredOn : null;
  if (!occurredOn) { res.status(400).json({ error: "occurredOn (YYYY-MM-DD) required" }); return; }
  const amountCents = Math.max(0, Math.floor(Number(b.amountCents) || 0));
  if (amountCents <= 0) { res.status(400).json({ error: "amountCents must be > 0" }); return; }
  const kind = ["cleaning", "lifeguard", "supplies", "maintenance", "utilities", "permits", "other"].includes(b.kind) ? b.kind : "other";
  const at = nowISO();
  const [row] = await db.insert(amenityExpenseEntriesTable).values({
    amenityId, occurredOn, kind,
    vendor: typeof b.vendor === "string" ? b.vendor.slice(0, 200) : "",
    vendorId: typeof b.vendorId === "number" ? b.vendorId : null,
    description: typeof b.description === "string" ? b.description.slice(0, 1000) : "",
    amountCents,
    invoiceRef: typeof b.invoiceRef === "string" ? b.invoiceRef.slice(0, 200) : "",
    workOrderId: typeof b.workOrderId === "string" ? b.workOrderId : null,
    notes: typeof b.notes === "string" ? b.notes.slice(0, 2000) : "",
    createdByUserId: req.user!.id,
    createdByName: req.user!.name,
    createdAt: at, updatedAt: at,
  }).returning();
  res.status(201).json(row);
});

router.patch("/reports/amenities/expenses/:id", requireFinanceWrite, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(amenityExpenseEntriesTable).where(eq(amenityExpenseEntriesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const b = req.body ?? {};
  const patch: Partial<typeof amenityExpenseEntriesTable.$inferInsert> = { updatedAt: nowISO() };
  if (typeof b.amenityId === "number") patch.amenityId = b.amenityId;
  if (typeof b.occurredOn === "string" && isIsoDate(b.occurredOn)) patch.occurredOn = b.occurredOn;
  if (["cleaning", "lifeguard", "supplies", "maintenance", "utilities", "permits", "other"].includes(b.kind)) patch.kind = b.kind;
  if (typeof b.vendor === "string") patch.vendor = b.vendor.slice(0, 200);
  if (typeof b.description === "string") patch.description = b.description.slice(0, 1000);
  if (typeof b.amountCents === "number") patch.amountCents = Math.max(0, Math.floor(b.amountCents));
  if (typeof b.invoiceRef === "string") patch.invoiceRef = b.invoiceRef.slice(0, 200);
  if (typeof b.notes === "string") patch.notes = b.notes.slice(0, 2000);
  const [row] = await db.update(amenityExpenseEntriesTable).set(patch).where(eq(amenityExpenseEntriesTable.id, id)).returning();
  res.json(row);
});

router.delete("/reports/amenities/expenses/:id", requireFinanceWrite, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(amenityExpenseEntriesTable).where(eq(amenityExpenseEntriesTable.id, id));
  res.status(204).end();
});

// ── Per-amenity P&L ──────────────────────────────────────────────────────

router.get("/reports/amenities/pnl", requireFinanceRead, async (req, res) => {
  const range = parseDateRange(req);
  if (range.error) { res.status(400).json({ error: range.error }); return; }
  const events = await loadRevenueEvents({ from: range.from, to: range.to });
  const rollup = rollupRevenue(events);
  const expenses = await loadExpenseTotals({ from: range.from, to: range.to });
  const amenities = await db.select().from(amenitiesTable).orderBy(asc(amenitiesTable.sortOrder), asc(amenitiesTable.id));
  const rows = amenities.map((a) => {
    const rev = rollup.byAmenity.find((r) => r.amenityId === a.id);
    const exp = expenses.byAmenity.get(a.id) ?? 0;
    const net = (rev?.netCents ?? 0) - exp;
    return {
      amenityId: a.id, amenitySlug: a.slug, amenityName: a.name,
      revenueGrossCents: rev?.grossCents ?? 0,
      revenueRefundCents: rev?.refundCents ?? 0,
      revenueNetCents: rev?.netCents ?? 0,
      expenseCents: exp,
      netCents: net,
      eventCount: rev?.events ?? 0,
    };
  });
  res.json({
    range: { from: range.from ?? null, to: range.to ?? null },
    rows: rows.sort((a, b) => b.netCents - a.netCents),
    totals: {
      revenueGrossCents: rollup.totalGrossCents,
      revenueRefundCents: rollup.totalRefundCents,
      revenueNetCents: rollup.totalNetCents,
      expenseCents: expenses.totalCents,
      netCents: rollup.totalNetCents - expenses.totalCents,
    },
  });
});

// ── Unfavorable-trend alerts ─────────────────────────────────────────────

router.get("/reports/amenities/alerts", requireFinanceRead, async (req, res) => {
  const range = parseDateRange(req);
  if (range.error) { res.status(400).json({ error: range.error }); return; }
  const refundRateBp = req.query.refundRateBp ? Number(req.query.refundRateBp) : 1000; // 10%
  const forfeitThresholdCents = req.query.forfeitThresholdCents ? Number(req.query.forfeitThresholdCents) : 100000;
  const utilizationFloorBp = req.query.utilizationFloorBp ? Number(req.query.utilizationFloorBp) : 2000; // 20%

  const events = await loadRevenueEvents({ from: range.from, to: range.to });
  const rollup = rollupRevenue(events);
  const alerts: Array<{ severity: "info" | "warn" | "critical"; code: string; amenityId?: number; amenityName?: string; message: string; valueCents?: number; ratioBp?: number }> = [];

  const grossOverall = rollup.totalGrossCents;
  if (grossOverall > 0 && (rollup.totalRefundCents / grossOverall) * 10000 > refundRateBp) {
    alerts.push({
      severity: "warn", code: "refund_rate_high",
      message: `Refund rate ${((rollup.totalRefundCents / grossOverall) * 100).toFixed(1)}% exceeds threshold`,
      ratioBp: Math.round((rollup.totalRefundCents / grossOverall) * 10000),
    });
  }
  if (rollup.byKind.deposit_forfeiture > forfeitThresholdCents) {
    alerts.push({
      severity: "warn", code: "forfeit_high",
      message: `Deposit forfeitures total $${(rollup.byKind.deposit_forfeiture / 100).toFixed(2)} above threshold`,
      valueCents: rollup.byKind.deposit_forfeiture,
    });
  }

  // Per-amenity refund rate / underutilization
  const amenities = await db.select().from(amenitiesTable);
  for (const a of amenities) {
    const ar = rollup.byAmenity.find((r) => r.amenityId === a.id);
    if (ar && ar.grossCents > 0 && (ar.refundCents / ar.grossCents) * 10000 > refundRateBp) {
      alerts.push({
        severity: "warn", code: "refund_rate_high_per_amenity",
        amenityId: a.id, amenityName: a.name,
        message: `${a.name}: refund rate ${((ar.refundCents / ar.grossCents) * 100).toFixed(1)}%`,
        ratioBp: Math.round((ar.refundCents / ar.grossCents) * 10000),
      });
    }
    // Utilization: bookings hours vs available hours (default 12h/day window)
    const today = new Date().toISOString().slice(0, 10);
    const start = range.from ?? new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const end = range.to ?? today;
    const grid = await loadUtilizationGrid(a.id, start, end);
    const days = Math.max(1, Math.ceil((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / (24 * 3600 * 1000)));
    const availableMinutes = days * 12 * 60; // generous baseline
    const ratio = grid.totalMinutes / availableMinutes;
    if (ratio * 10000 < utilizationFloorBp) {
      alerts.push({
        severity: "info", code: "utilization_low",
        amenityId: a.id, amenityName: a.name,
        message: `${a.name}: utilization ${(ratio * 100).toFixed(1)}% below floor`,
        ratioBp: Math.round(ratio * 10000),
      });
    }
  }

  // Stuck deposits
  const dep = await loadDepositSnapshot({ ageDaysMin: 30 });
  if (dep.held.length > 0) {
    alerts.push({
      severity: "warn", code: "deposit_stuck",
      message: `${dep.held.length} deposit(s) held >30 days without resolution`,
      valueCents: dep.heldBalanceCents,
    });
  }

  res.json({
    range: { from: range.from ?? null, to: range.to ?? null },
    thresholds: { refundRateBp, forfeitThresholdCents, utilizationFloorBp },
    alerts,
  });
});

// ── Per-owner usage ──────────────────────────────────────────────────────

router.get("/me/amenity-usage", async (req, res) => {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const range = parseDateRange(req);
  if (range.error) { res.status(400).json({ error: range.error }); return; }
  const rows = await loadUserUsage(req.user.id, { from: range.from, to: range.to });
  res.json({ userId: req.user.id, range: { from: range.from ?? null, to: range.to ?? null }, rows });
});

router.get("/me/amenity-usage.csv", async (req, res) => {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const range = parseDateRange(req);
  if (range.error) { res.status(400).json({ error: range.error }); return; }
  const rows = await loadUserUsage(req.user.id, { from: range.from, to: range.to });
  let body = csvRow(["occurred_at", "kind", "amenity", "status", "amount_cents", "detail"]);
  for (const r of rows) body += csvRow([r.occurredAt, r.kind, r.amenityName, r.status, r.amountCents, r.detail]);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="my-amenity-usage.csv"`);
  res.send(body);
});

router.get("/users/:userId/amenity-usage", requireFinanceRead, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId)) { res.status(400).json({ error: "Invalid userId" }); return; }
  const range = parseDateRange(req);
  if (range.error) { res.status(400).json({ error: range.error }); return; }
  const rows = await loadUserUsage(userId, { from: range.from, to: range.to });
  res.json({ userId, range: { from: range.from ?? null, to: range.to ?? null }, rows });
});

// ── PDF / printable monthly summary ──────────────────────────────────────

function escapeHtml(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

router.get("/reports/amenities/monthly-summary", requireFinanceRead, async (req, res) => {
  const month = typeof req.query.month === "string" ? req.query.month : new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) { res.status(400).json({ error: "month must be YYYY-MM" }); return; }
  const from = `${month}-01`;
  const dt = new Date(`${month}-01T00:00:00Z`);
  dt.setUTCMonth(dt.getUTCMonth() + 1);
  dt.setUTCDate(0);
  const to = dt.toISOString().slice(0, 10);
  const events = await loadRevenueEvents({ from, to });
  const rollup = rollupRevenue(events);
  const expenses = await loadExpenseTotals({ from, to });
  const dep = await loadDepositSnapshot({ from, to });

  // Top spenders
  const byUnit = new Map<string, { unitId: string; gross: number; events: number }>();
  for (const e of events) {
    if (!e.unitId) continue;
    let row = byUnit.get(e.unitId);
    if (!row) { row = { unitId: e.unitId, gross: 0, events: 0 }; byUnit.set(e.unitId, row); }
    row.gross += e.grossCents;
    row.events += 1;
  }
  const topSpenders = Array.from(byUnit.values()).sort((a, b) => b.gross - a.gross).slice(0, 10);

  const refunds = events.filter((e) => e.kind === "refund").sort((a, b) => b.refundCents - a.refundCents).slice(0, 10);

  if (req.query.format === "json") {
    res.json({
      month, range: { from, to },
      kpis: {
        grossCents: rollup.totalGrossCents,
        refundCents: rollup.totalRefundCents,
        netCents: rollup.totalNetCents,
        expenseCents: expenses.totalCents,
        contributionCents: rollup.totalNetCents - expenses.totalCents,
        heldBalanceCents: dep.heldBalanceCents,
      },
      byAmenity: rollup.byAmenity,
      topSpenders,
      refunds: refunds.map((e) => ({ amenityName: e.amenityName, unitId: e.unitId, refundCents: e.refundCents, memo: e.memo, occurredAt: e.occurredAt })),
    });
    return;
  }

  const fmt = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Amenity month-end summary — ${month}</title>
<style>
@page { size: letter; margin: 0.75in; }
body { font-family: system-ui, sans-serif; color: #111; max-width: 900px; margin: 24px auto; }
h1 { margin: 0; font-size: 26px; letter-spacing: -0.01em; }
h2 { margin: 28px 0 8px; font-size: 16px; text-transform: uppercase; letter-spacing: 0.05em; color: #444; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
.kpi { border: 1px solid #ddd; border-radius: 6px; padding: 12px; }
.kpi .l { font-size: 11px; text-transform: uppercase; color: #666; letter-spacing: 0.04em; }
.kpi .v { font-size: 22px; font-weight: 700; margin-top: 4px; font-variant-numeric: tabular-nums; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 6px 8px; border-bottom: 1px solid #eee; text-align: left; }
th { font-size: 11px; text-transform: uppercase; color: #555; }
td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
.no-print { margin-top: 20px; }
@media print { .no-print { display: none } }
</style></head><body>
<h1>Amenity month-end summary</h1>
<div style="color: #555; margin-top: 4px;">${escapeHtml(month)} · generated ${escapeHtml(new Date().toISOString().slice(0, 10))}</div>
<div class="kpis">
  <div class="kpi"><div class="l">Gross collected</div><div class="v">${fmt(rollup.totalGrossCents)}</div></div>
  <div class="kpi"><div class="l">Refunded</div><div class="v">${fmt(rollup.totalRefundCents)}</div></div>
  <div class="kpi"><div class="l">Net</div><div class="v">${fmt(rollup.totalNetCents)}</div></div>
  <div class="kpi"><div class="l">Held deposits</div><div class="v">${fmt(dep.heldBalanceCents)}</div></div>
</div>

<h2>Revenue by amenity</h2>
<table><thead><tr><th>Amenity</th><th class="r">Gross</th><th class="r">Refunded</th><th class="r">Net</th><th class="r">Events</th></tr></thead><tbody>
${rollup.byAmenity.map((a) => `<tr><td>${escapeHtml(a.amenityName)}</td><td class="r">${fmt(a.grossCents)}</td><td class="r">${fmt(a.refundCents)}</td><td class="r">${fmt(a.netCents)}</td><td class="r">${a.events}</td></tr>`).join("")}
</tbody></table>

<h2>Top spenders</h2>
<table><thead><tr><th>Unit</th><th class="r">Gross</th><th class="r">Events</th></tr></thead><tbody>
${topSpenders.map((u) => `<tr><td>${escapeHtml(u.unitId)}</td><td class="r">${fmt(u.gross)}</td><td class="r">${u.events}</td></tr>`).join("") || "<tr><td colspan=3 style=color:#999>None</td></tr>"}
</tbody></table>

<h2>Notable refunds</h2>
<table><thead><tr><th>When</th><th>Amenity</th><th>Unit</th><th>Memo</th><th class="r">Refund</th></tr></thead><tbody>
${refunds.map((r) => `<tr><td>${escapeHtml(r.occurredAt.slice(0, 10))}</td><td>${escapeHtml(r.amenityName)}</td><td>${escapeHtml(r.unitId ?? "")}</td><td>${escapeHtml(r.memo)}</td><td class="r">${fmt(r.refundCents)}</td></tr>`).join("") || "<tr><td colspan=5 style=color:#999>None</td></tr>"}
</tbody></table>

<h2>Operating expenses</h2>
<table><thead><tr><th>Date</th><th>Amenity</th><th>Vendor</th><th>Kind</th><th>Description</th><th class="r">Amount</th></tr></thead><tbody>
${(await Promise.all(expenses.rows.map(async (r) => {
  const [a] = await db.select().from(amenitiesTable).where(eq(amenitiesTable.id, r.amenityId));
  return `<tr><td>${escapeHtml(r.occurredOn)}</td><td>${escapeHtml(a?.name ?? "")}</td><td>${escapeHtml(r.vendor)}</td><td>${escapeHtml(r.kind)}</td><td>${escapeHtml(r.description)}</td><td class="r">${fmt(r.amountCents)}</td></tr>`;
}))).join("") || "<tr><td colspan=6 style=color:#999>None</td></tr>"}
</tbody></table>

<div style="display:flex;justify-content:space-between;margin-top:24px;font-size:13px">
  <div><strong>Total expenses:</strong> ${fmt(expenses.totalCents)}</div>
  <div><strong>Net contribution:</strong> ${fmt(rollup.totalNetCents - expenses.totalCents)}</div>
</div>

<div class="no-print"><button onclick="window.print()" style="margin-top:16px;padding:8px 16px;background:#3245FF;color:#fff;border:0;border-radius:6px;font-weight:600;cursor:pointer">Print / Save as PDF</button></div>
</body></html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

void usersTable;
void and;

export default router;
