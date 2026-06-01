import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { workOrdersTable, buildingsTable, budgetsTable } from "@workspace/db/schema";
import { gte, lte, and, eq, sql, desc, inArray } from "drizzle-orm";
import { GetSpendReportQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get("/reports/spend", async (req, res) => {
  const parsed = GetSpendReportQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }

  const { from, to } = parsed.data;

  if (from && !ISO_DATE_RE.test(from)) {
    res.status(400).json({ error: "Invalid 'from' date — expected YYYY-MM-DD" });
    return;
  }
  if (to && !ISO_DATE_RE.test(to)) {
    res.status(400).json({ error: "Invalid 'to' date — expected YYYY-MM-DD" });
    return;
  }

  const conditions = [];
  if (from) conditions.push(gte(workOrdersTable.opened, from));
  if (to) conditions.push(lte(workOrdersTable.opened, to));
  // Task #119: operational metrics exclude historical (backfilled) work orders.
  conditions.push(sql`${workOrdersTable.historical} = false`);
  const whereClause = and(...conditions);

  const [monthlySpendRows, monthlyVolumeRows, buildingSpendRows, categorySpendRows, totalRows] =
    await Promise.all([
      db
        .select({
          month: sql<string>`substr(${workOrdersTable.opened}, 1, 7)`.as("month"),
          total: sql<number>`sum(${workOrdersTable.estCost})`.as("total"),
        })
        .from(workOrdersTable)
        .where(whereClause)
        .groupBy(sql`substr(${workOrdersTable.opened}, 1, 7)`)
        .orderBy(sql`substr(${workOrdersTable.opened}, 1, 7)`),

      db
        .select({
          month: sql<string>`substr(${workOrdersTable.opened}, 1, 7)`.as("month"),
          count: sql<number>`count(*)`.as("count"),
        })
        .from(workOrdersTable)
        .where(whereClause)
        .groupBy(sql`substr(${workOrdersTable.opened}, 1, 7)`)
        .orderBy(sql`substr(${workOrdersTable.opened}, 1, 7)`),

      db
        .select({
          building: workOrdersTable.building,
          total: sql<number>`sum(${workOrdersTable.estCost})`.as("total"),
        })
        .from(workOrdersTable)
        .where(whereClause)
        .groupBy(workOrdersTable.building)
        .orderBy(desc(sql`sum(${workOrdersTable.estCost})`))
        .limit(10),

      db
        .select({
          category: workOrdersTable.category,
          total: sql<number>`sum(${workOrdersTable.estCost})`.as("total"),
        })
        .from(workOrdersTable)
        .where(whereClause)
        .groupBy(workOrdersTable.category)
        .orderBy(desc(sql`sum(${workOrdersTable.estCost})`)),

      db
        .select({
          totalSpend: sql<number>`coalesce(sum(${workOrdersTable.estCost}), 0)`.as("totalSpend"),
          totalOrders: sql<number>`count(*)`.as("totalOrders"),
        })
        .from(workOrdersTable)
        .where(whereClause),
    ]);

  const buildingNums = buildingSpendRows.map((r) => r.building);
  const buildingAddressMap: Record<number, string> = {};
  if (buildingNums.length > 0) {
    const bldgRows = await db
      .select({ num: buildingsTable.num, address: buildingsTable.address })
      .from(buildingsTable)
      .where(inArray(buildingsTable.num, buildingNums));
    for (const b of bldgRows) buildingAddressMap[b.num] = b.address;
  }

  const spendByBuilding = buildingSpendRows.map((r) => ({
    building: r.building,
    address: buildingAddressMap[r.building] ?? `Building ${r.building}`,
    total: Number(r.total),
  }));

  // Budgets are scoped to a single fiscal year. We pick the year of the
  // report's `to` bound (or the current year when no upper bound was
  // provided) and *always* compare actuals to budget against that full
  // fiscal year — not against the user's selected range, which can span
  // multiple years (e.g. the default "Last 12 months") and would otherwise
  // produce misleading overspend flags.
  const budgetFiscalYear = to
    ? Number(to.slice(0, 4))
    : new Date().getFullYear();
  const fyFrom = `${budgetFiscalYear}-01-01`;
  const fyTo = `${budgetFiscalYear}-12-31`;
  const [budgetRows, fyCategorySpendRows] = await Promise.all([
    db
      .select({ category: budgetsTable.category, amount: budgetsTable.amount })
      .from(budgetsTable)
      .where(eq(budgetsTable.fiscalYear, budgetFiscalYear)),
    db
      .select({
        category: workOrdersTable.category,
        total: sql<number>`sum(${workOrdersTable.estCost})`.as("total"),
      })
      .from(workOrdersTable)
      .where(and(
        gte(workOrdersTable.opened, fyFrom),
        lte(workOrdersTable.opened, fyTo),
        sql`${workOrdersTable.historical} = false`,
      ))
      .groupBy(workOrdersTable.category),
  ]);

  res.json({
    totalSpend: Number(totalRows[0]?.totalSpend ?? 0),
    totalOrders: Number(totalRows[0]?.totalOrders ?? 0),
    monthlySpend: monthlySpendRows.map((r) => ({ month: r.month, total: Number(r.total) })),
    monthlyVolume: monthlyVolumeRows.map((r) => ({ month: r.month, count: Number(r.count) })),
    spendByBuilding,
    spendByCategory: categorySpendRows.map((r) => ({ category: r.category, total: Number(r.total) })),
    budgetByCategory: budgetRows.map((r) => ({
      category: r.category,
      amount: Number(r.amount),
      fiscalYear: budgetFiscalYear,
    })),
    budgetFiscalYear,
    // Per-category spend totals scoped to the entire budget fiscal year, so
    // the UI can compare apples-to-apples against the annual budget even
    // when the user's selected range spans multiple years.
    spendByCategoryInBudgetYear: fyCategorySpendRows.map((r) => ({
      category: r.category,
      total: Number(r.total),
    })),
  });
});

router.get("/reports/spend-by-month", async (_req, res) => {
  const rows = await db
    .select({
      month: sql<string>`substr(${workOrdersTable.opened}, 1, 7)`,
      total: sql<number>`cast(sum(${workOrdersTable.estCost}) as integer)`,
    })
    .from(workOrdersTable)
    .where(sql`${workOrdersTable.historical} = false`)
    .groupBy(sql`substr(${workOrdersTable.opened}, 1, 7)`)
    .orderBy(sql`substr(${workOrdersTable.opened}, 1, 7)`);

  res.json(rows.map((r) => ({ month: r.month, total: r.total ?? 0 })));
});

export default router;
