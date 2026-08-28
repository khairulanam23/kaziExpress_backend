import { StockMovementType, TaskStatus } from '@prisma/client';
import prisma from '../../utils/prisma/prisma-client';

/**
 * Analytical reports built on data the system already records but never showed.
 *
 * Every figure here is derived server-side. Where a number rests on an
 * assumption that could reasonably have been made differently — how labour is
 * attributed to a task, how a batch is valued — the assumption is returned in
 * the payload as `basis`, so the screen can state it rather than presenting a
 * derived figure as if it were measured.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const num = (v: any): number => (v === null || v === undefined ? 0 : Number(v));
const round = (v: number, dp = 2): number => Number(v.toFixed(dp));

/** Movement types that represent material destroyed rather than consumed. */
export const WASTE_TYPES: StockMovementType[] = [StockMovementType.DAMAGE, StockMovementType.WRITE_OFF];

/** Movement types that represent material genuinely used up. */
const CONSUMING_TYPES: StockMovementType[] = [
  StockMovementType.CONSUMPTION,
  StockMovementType.DAMAGE,
  StockMovementType.WRITE_OFF,
  StockMovementType.ASSEMBLY,
];

function windowFrom(query: { from?: string; to?: string } = {}, defaultDays: number) {
  const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
  const from = query.from
    ? new Date(`${query.from}T00:00:00.000Z`)
    : new Date(to.getTime() - defaultDays * DAY_MS);
  return { from, to };
}

// ───────────────────────────────────────────────────────────────────────────
// Labour attribution — shared by the production-cost and efficiency reports.
// ───────────────────────────────────────────────────────────────────────────

/**
 * There is no timesheet tying an employee's hours to a specific task, so hours
 * are attributed: a day's attendance is split evenly across the tasks that
 * employee was assigned to and that were active that day. An employee who
 * worked 8h across two live tasks contributes 4h to each.
 *
 * This is an estimate. It is stated as one everywhere it surfaces.
 */
export const LABOUR_BASIS =
  'Attendance hours are split evenly across the tasks an employee was assigned to and that were active that day, over each task\'s own span. There is no per-task timesheet, so this is an estimate: a long-running task absorbs a share of every day it was open.';

interface LabourSlice {
  hours: number;
  cost: number;
}

async function attributeLabour(taskIds: string[]): Promise<Map<string, LabourSlice>> {
  if (taskIds.length === 0) return new Map();

  // A run's labour is a property of the run, so attribution walks each task's
  // own active span. Anything else would make the same task cost a different
  // amount depending on the period the report was asked about.
  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds }, startedAt: { not: null } },
    select: { id: true, startedAt: true, completedAt: true, assignments: { select: { employeeId: true } } },
  });
  if (tasks.length === 0) return new Map();

  // Days that must also count concurrent work: a task competing for the same
  // day is included even when it is outside the caller's task list, otherwise
  // an employee's day would be over-allocated to the tasks being reported on.
  const spanStart = new Date(Math.min(...tasks.map((t) => (t.startedAt as Date).getTime())));
  const spanEnd = new Date(Math.max(...tasks.map((t) => (t.completedAt ?? new Date()).getTime())));

  const concurrent = await prisma.task.findMany({
    where: {
      startedAt: { not: null, lte: spanEnd },
      OR: [{ completedAt: null }, { completedAt: { gte: spanStart } }],
    },
    select: { id: true, startedAt: true, completedAt: true, assignments: { select: { employeeId: true } } },
  });

  // employeeId -> day (yyyy-mm-dd) -> taskIds active that day
  const byEmployeeDay = new Map<string, Map<string, string[]>>();
  for (const task of concurrent) {
    const start = task.startedAt as Date;
    const end = task.completedAt ?? new Date();
    for (const assignment of task.assignments) {
      let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
      while (cursor <= end) {
        const day = cursor.toISOString().slice(0, 10);
        const days = byEmployeeDay.get(assignment.employeeId) ?? new Map<string, string[]>();
        days.set(day, [...(days.get(day) ?? []), task.id]);
        byEmployeeDay.set(assignment.employeeId, days);
        cursor = new Date(cursor.getTime() + DAY_MS);
      }
    }
  }

  const employeeIds = [...byEmployeeDay.keys()];
  if (employeeIds.length === 0) return new Map();

  const [attendance, profiles] = await Promise.all([
    prisma.attendance.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: spanStart, lte: spanEnd } },
      select: { employeeId: true, date: true, workedHours: true },
    }),
    prisma.employeeProfile.findMany({
      where: { userId: { in: employeeIds } },
      select: { userId: true, hourlyRate: true },
    }),
  ]);

  const rateOf = new Map(profiles.map((p) => [p.userId, num(p.hourlyRate)]));
  const perTask = new Map<string, LabourSlice>();

  for (const record of attendance) {
    const hours = num(record.workedHours);
    if (hours <= 0) continue;
    const day = record.date.toISOString().slice(0, 10);
    const dayTasks = byEmployeeDay.get(record.employeeId)?.get(day) ?? [];
    if (dayTasks.length === 0) continue;

    const share = hours / dayTasks.length;
    const cost = share * (rateOf.get(record.employeeId) ?? 0);
    for (const taskId of dayTasks) {
      const slice = perTask.get(taskId) ?? { hours: 0, cost: 0 };
      slice.hours += share;
      slice.cost += cost;
      perTask.set(taskId, slice);
    }
  }

  return perTask;
}

export const analyticsServices = {
  // ─────────────────────────────────────────────────────────────────────────
  // Roadmap item 13 — Vendor performance
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Purchase price history per vendor, and whether their price is drifting.
   *
   * `StockMovement.vendorId` was added for this; deliveries recorded before it
   * existed cannot be attributed, so the count of those is reported rather than
   * quietly folded into the totals.
   */
  getVendorPerformanceReport: async (query: { from?: string; to?: string; vendorId?: string } = {}) => {
    const { from, to } = windowFrom(query, 365);

    const purchases = await prisma.stockMovement.findMany({
      where: {
        type: StockMovementType.PURCHASE,
        createdAt: { gte: from, lte: to },
        ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      },
      select: {
        id: true, quantity: true, unitCost: true, totalCost: true, createdAt: true,
        vendor: { select: { id: true, name: true, isActive: true } },
        product: { select: { id: true, name: true, sku: true, unit: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const attributed = purchases.filter((m) => m.vendor);
    const unattributed = purchases.length - attributed.length;

    const byVendor = new Map<string, any>();
    for (const m of attributed) {
      const vendor = m.vendor!;
      const entry = byVendor.get(vendor.id) ?? {
        vendorId: vendor.id, name: vendor.name, isActive: vendor.isActive,
        deliveries: 0, quantity: 0, spend: 0, products: new Map<string, any>(),
      };
      entry.deliveries += 1;
      entry.quantity += num(m.quantity);
      entry.spend += num(m.totalCost);

      const line = entry.products.get(m.product.id) ?? {
        productId: m.product.id, name: m.product.name, sku: m.product.sku, unit: m.product.unit,
        deliveries: 0, quantity: 0, spend: 0, firstUnitCost: num(m.unitCost), lastUnitCost: num(m.unitCost),
        minUnitCost: num(m.unitCost), maxUnitCost: num(m.unitCost), firstAt: m.createdAt, lastAt: m.createdAt,
      };
      line.deliveries += 1;
      line.quantity += num(m.quantity);
      line.spend += num(m.totalCost);
      line.lastUnitCost = num(m.unitCost);
      line.lastAt = m.createdAt;
      line.minUnitCost = Math.min(line.minUnitCost, num(m.unitCost));
      line.maxUnitCost = Math.max(line.maxUnitCost, num(m.unitCost));
      entry.products.set(m.product.id, line);
      byVendor.set(vendor.id, entry);
    }

    const vendors = [...byVendor.values()]
      .map((v) => {
        const lines = [...v.products.values()].map((l: any) => {
          const drift = l.firstUnitCost > 0 ? ((l.lastUnitCost - l.firstUnitCost) / l.firstUnitCost) * 100 : 0;
          return {
            productId: l.productId, name: l.name, sku: l.sku, unit: l.unit,
            deliveries: l.deliveries,
            quantity: round(l.quantity, 3),
            spend: round(l.spend),
            averageUnitCost: l.quantity > 0 ? round(l.spend / l.quantity, 4) : 0,
            firstUnitCost: round(l.firstUnitCost, 4),
            lastUnitCost: round(l.lastUnitCost, 4),
            minUnitCost: round(l.minUnitCost, 4),
            maxUnitCost: round(l.maxUnitCost, 4),
            // Only meaningful once there is more than one delivery to compare.
            priceDriftPercent: l.deliveries > 1 ? round(drift, 1) : null,
            firstAt: l.firstAt.toISOString(),
            lastAt: l.lastAt.toISOString(),
          };
        }).sort((a: any, b: any) => b.spend - a.spend);

        const rising = lines.filter((l: any) => (l.priceDriftPercent ?? 0) > 0);
        return {
          vendorId: v.vendorId, name: v.name, isActive: v.isActive,
          deliveries: v.deliveries,
          quantity: round(v.quantity, 3),
          spend: round(v.spend),
          productsSupplied: lines.length,
          productsWithRisingPrice: rising.length,
          largestPriceRisePercent: rising.length ? Math.max(...rising.map((l: any) => l.priceDriftPercent as number)) : null,
          products: lines,
        };
      })
      .sort((a, b) => b.spend - a.spend);

    return {
      basis:
        unattributed > 0
          ? `${unattributed} purchase(s) in this period predate vendor attribution and are excluded from the per-vendor figures.`
          : 'All purchases in this period are attributed to a vendor.',
      period: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        vendors: vendors.length,
        deliveries: attributed.length,
        unattributedDeliveries: unattributed,
        totalSpend: round(attributed.reduce((s, m) => s + num(m.totalCost), 0)),
      },
      vendors,
    };
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Roadmap item 4 — Waste & scrap analysis
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * What material was destroyed rather than used, what it cost, and where it
   * went. Reads DAMAGE and WRITE_OFF movements, which already carry cost, task
   * and operator.
   */
  getWasteReport: async (query: { from?: string; to?: string; productId?: string } = {}) => {
    const { from, to } = windowFrom(query, 90);

    const movements = await prisma.stockMovement.findMany({
      where: {
        type: { in: WASTE_TYPES },
        createdAt: { gte: from, lte: to },
        ...(query.productId ? { productId: query.productId } : {}),
      },
      select: {
        id: true,
        type: true,
        quantity: true,
        totalCost: true,
        reason: true,
        notes: true,
        createdAt: true,
        product: { select: { id: true, name: true, sku: true, unit: true } },
        relatedTask: { select: { id: true, title: true } },
        performedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalCost = movements.reduce((sum, m) => sum + num(m.totalCost), 0);
    const totalQuantity = movements.reduce((sum, m) => sum + Math.abs(num(m.quantity)), 0);

    const group = <T>(keyOf: (m: (typeof movements)[number]) => T | null, label: (m: (typeof movements)[number]) => any) => {
      const map = new Map<string, any>();
      for (const m of movements) {
        const key = keyOf(m);
        if (key === null || key === undefined) continue;
        const id = String(key);
        const entry = map.get(id) ?? { ...label(m), events: 0, quantity: 0, cost: 0 };
        entry.events += 1;
        entry.quantity += Math.abs(num(m.quantity));
        entry.cost += num(m.totalCost);
        map.set(id, entry);
      }
      return [...map.values()]
        .map((e) => ({ ...e, quantity: round(e.quantity, 3), cost: round(e.cost), shareOfCost: totalCost ? round((e.cost / totalCost) * 100, 1) : 0 }))
        .sort((a, b) => b.cost - a.cost);
    };

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        events: movements.length,
        totalQuantity: round(totalQuantity, 3),
        totalCost: round(totalCost),
        damagedCost: round(movements.filter((m) => m.type === 'DAMAGE').reduce((s, m) => s + num(m.totalCost), 0)),
        writtenOffCost: round(movements.filter((m) => m.type === 'WRITE_OFF').reduce((s, m) => s + num(m.totalCost), 0)),
      },
      byProduct: group((m) => m.product?.id, (m) => ({ productId: m.product?.id, name: m.product?.name, sku: m.product?.sku, unit: m.product?.unit })),
      byTask: group((m) => m.relatedTask?.id ?? null, (m) => ({ taskId: m.relatedTask?.id, title: m.relatedTask?.title })),
      byEmployee: group((m) => m.performedBy?.id ?? null, (m) => ({ employeeId: m.performedBy?.id, name: m.performedBy?.name ?? m.performedBy?.email })),
      byReason: group((m) => (m.reason || m.notes || 'Unspecified').slice(0, 80), (m) => ({ reason: (m.reason || m.notes || 'Unspecified').slice(0, 80) })),
      recent: movements.slice(0, 50).map((m) => ({
        id: m.id,
        type: m.type,
        product: m.product?.name,
        sku: m.product?.sku,
        quantity: round(Math.abs(num(m.quantity)), 3),
        cost: round(num(m.totalCost)),
        reason: m.reason ?? m.notes ?? null,
        task: m.relatedTask?.title ?? null,
        employee: m.performedBy?.name ?? m.performedBy?.email ?? null,
        at: m.createdAt.toISOString(),
      })),
    };
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Roadmap item 5 — Reorder planning
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Answers what the low-stock threshold cannot: given how fast this product is
   * actually being consumed and how long its vendor takes, is it already too
   * late to order?
   */
  getReorderReport: async (query: { lookbackDays?: number; horizonDays?: number } = {}) => {
    const lookbackDays = query.lookbackDays && query.lookbackDays > 0 ? query.lookbackDays : 90;
    const horizonDays = query.horizonDays && query.horizonDays > 0 ? query.horizonDays : 30;
    const since = new Date(Date.now() - lookbackDays * DAY_MS);

    const [products, consumption] = await Promise.all([
      prisma.product.findMany({
        where: { isDiscontinued: false },
        select: {
          id: true, name: true, sku: true, unit: true, currentStock: true, isComposite: true,
          lowStockThreshold: true, reorderTimeDays: true, quantityInReorder: true, unitPrice: true,
          vendor: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.stockMovement.groupBy({
        by: ['productId'],
        where: { type: { in: CONSUMING_TYPES }, createdAt: { gte: since } },
        _sum: { quantity: true },
      }),
    ]);

    const consumedBy = new Map(consumption.map((c) => [c.productId, Math.abs(num(c._sum.quantity))]));

    const rows = products.map((p) => {
      const stock = num(p.currentStock);
      const consumed = consumedBy.get(p.id) ?? 0;
      const dailyBurn = consumed / lookbackDays;
      const leadTimeDays = p.reorderTimeDays ?? null;
      const daysOfCover = dailyBurn > 0 ? stock / dailyBurn : null;
      const threshold = p.lowStockThreshold === null ? null : num(p.lowStockThreshold);

      // Order now if stock will run out before a replacement could arrive.
      const tooLate = daysOfCover !== null && leadTimeDays !== null && daysOfCover < leadTimeDays;
      const belowThreshold = threshold !== null && stock < threshold;
      const runsOutInHorizon = daysOfCover !== null && daysOfCover <= horizonDays;

      let urgency: 'CRITICAL' | 'ORDER_NOW' | 'MONITOR' | 'OK';
      if (stock <= 0) urgency = 'CRITICAL';
      else if (tooLate || belowThreshold) urgency = 'ORDER_NOW';
      else if (runsOutInHorizon) urgency = 'MONITOR';
      else urgency = 'OK';

      // Cover the lead time plus the horizon, less what is already on hand.
      const coverDays = (leadTimeDays ?? 0) + horizonDays;
      const derivedNeed = Math.max(0, dailyBurn * coverDays - stock);
      // A product can be out of stock with no consumption history (nothing was
      // available to consume). Falling back to the threshold keeps a CRITICAL
      // row from suggesting an order of zero.
      const fallbackNeed = threshold !== null ? Math.max(0, threshold - stock) : 0;
      const suggestedOrderQuantity = p.quantityInReorder !== null && num(p.quantityInReorder) > 0
        ? num(p.quantityInReorder)
        : round(derivedNeed > 0 ? derivedNeed : fallbackNeed, 3);

      // A composite is built in-house, so the answer to "we are out" is a
      // production run, not a purchase order. Telling someone to buy a product
      // they assemble themselves would be worse than saying nothing.
      const action: 'PURCHASE' | 'PRODUCE' = p.isComposite ? 'PRODUCE' : 'PURCHASE';

      return {
        productId: p.id, name: p.name, sku: p.sku, unit: p.unit,
        action,
        vendor: p.vendor && action === 'PURCHASE' ? { id: p.vendor.id, name: p.vendor.name } : null,
        currentStock: round(stock, 3),
        lowStockThreshold: threshold,
        averageDailyConsumption: round(dailyBurn, 3),
        daysOfCoverRemaining: daysOfCover === null ? null : round(daysOfCover, 1),
        leadTimeDays,
        suggestedOrderQuantity,
        // Only purchases carry a cost here; a production run's cost belongs to
        // the production-cost report, not to a purchasing total.
        estimatedOrderCost: action === 'PURCHASE' ? round(suggestedOrderQuantity * num(p.unitPrice)) : 0,
        urgency,
        reason:
          stock <= 0 && action === 'PRODUCE' ? 'Out of stock — schedule a production run'
          : stock <= 0 ? 'Out of stock'
          : tooLate ? `Runs out in ${round(daysOfCover as number, 1)}d but the lead time is ${leadTimeDays}d`
          : belowThreshold ? 'Below the low-stock threshold'
          : runsOutInHorizon ? `Runs out within ${horizonDays}d`
          : dailyBurn === 0 ? 'No consumption in the lookback window'
          : 'Sufficient cover',
      };
    });

    const rank = { CRITICAL: 0, ORDER_NOW: 1, MONITOR: 2, OK: 3 } as const;
    rows.sort((a, b) => rank[a.urgency] - rank[b.urgency] || (a.daysOfCoverRemaining ?? 1e9) - (b.daysOfCoverRemaining ?? 1e9));

    const actionable = rows.filter((r) => r.urgency !== 'OK');
    return {
      basis: `Consumption averaged over the last ${lookbackDays} days; cover is projected ${horizonDays} days ahead.`,
      parameters: { lookbackDays, horizonDays },
      summary: {
        productsReviewed: rows.length,
        critical: rows.filter((r) => r.urgency === 'CRITICAL').length,
        orderNow: rows.filter((r) => r.urgency === 'ORDER_NOW').length,
        monitor: rows.filter((r) => r.urgency === 'MONITOR').length,
        toPurchase: actionable.filter((r) => r.action === 'PURCHASE').length,
        toProduce: actionable.filter((r) => r.action === 'PRODUCE').length,
        estimatedOrderCost: round(actionable.reduce((s, r) => s + r.estimatedOrderCost, 0)),
      },
      items: rows,
    };
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Roadmap item 7 — Production cost per unit
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * What each production run actually cost to make: material drawn from the
   * movement ledger (not the BOM estimate) plus attributed labour, against the
   * units it actually produced.
   */
  getProductionCostReport: async (query: { from?: string; to?: string; productId?: string } = {}) => {
    const { from, to } = windowFrom(query, 90);

    const tasks = await prisma.task.findMany({
      where: {
        status: { in: [TaskStatus.COMPLETED, TaskStatus.PARTIALLY_COMPLETED] },
        completedAt: { gte: from, lte: to },
        ...(query.productId ? { productId: query.productId } : {}),
      },
      select: {
        id: true, title: true, productionQuantity: true, completedQuantity: true,
        startedAt: true, completedAt: true, deadline: true,
        product: { select: { id: true, name: true, sku: true, unit: true, unitPrice: true } },
        requiredProducts: { select: { quantity: true, unitPrice: true } },
        stockMovements: {
          where: { type: { in: [StockMovementType.CONSUMPTION, StockMovementType.DAMAGE] } },
          select: { type: true, totalCost: true, quantity: true },
        },
        assignments: { select: { employeeId: true } },
      },
      orderBy: { completedAt: 'desc' },
    });

    const labour = await attributeLabour(tasks.map((t) => t.id));

    const rows = tasks.map((task) => {
      const produced = num(task.completedQuantity);
      const materialCost = task.stockMovements.reduce((s, m) => s + num(m.totalCost), 0);
      const wasteCost = task.stockMovements.filter((m) => m.type === 'DAMAGE').reduce((s, m) => s + num(m.totalCost), 0);
      const plannedMaterial = task.requiredProducts.reduce((s, r) => s + num(r.quantity) * num(r.unitPrice), 0);
      const slice = labour.get(task.id) ?? { hours: 0, cost: 0 };
      const totalCost = materialCost + slice.cost;

      return {
        taskId: task.id,
        title: task.title,
        product: task.product ? { id: task.product.id, name: task.product.name, sku: task.product.sku, unit: task.product.unit } : null,
        targetQuantity: round(num(task.productionQuantity), 3),
        producedQuantity: round(produced, 3),
        materialCost: round(materialCost),
        plannedMaterialCost: round(plannedMaterial),
        materialVariance: round(materialCost - plannedMaterial),
        wasteCost: round(wasteCost),
        labourHours: round(slice.hours, 2),
        labourCost: round(slice.cost),
        totalCost: round(totalCost),
        costPerUnit: produced > 0 ? round(totalCost / produced) : null,
        completedAt: task.completedAt?.toISOString() ?? null,
        onTime: task.deadline && task.completedAt ? task.completedAt <= new Date(`${task.deadline.toISOString().slice(0, 10)}T23:59:59.999Z`) : null,
      };
    });

    // Per-product averages, weighted by units produced rather than by run.
    const byProduct = new Map<string, any>();
    for (const row of rows) {
      if (!row.product) continue;
      const entry = byProduct.get(row.product.id) ?? {
        productId: row.product.id, name: row.product.name, sku: row.product.sku, unit: row.product.unit,
        runs: 0, unitsProduced: 0, materialCost: 0, labourCost: 0, wasteCost: 0, totalCost: 0,
      };
      entry.runs += 1;
      entry.unitsProduced += row.producedQuantity;
      entry.materialCost += row.materialCost;
      entry.labourCost += row.labourCost;
      entry.wasteCost += row.wasteCost;
      entry.totalCost += row.totalCost;
      byProduct.set(row.product.id, entry);
    }

    const totals = rows.reduce(
      (acc, r) => ({
        material: acc.material + r.materialCost,
        labour: acc.labour + r.labourCost,
        waste: acc.waste + r.wasteCost,
        units: acc.units + r.producedQuantity,
      }),
      { material: 0, labour: 0, waste: 0, units: 0 },
    );

    return {
      basis: LABOUR_BASIS,
      period: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        runs: rows.length,
        unitsProduced: round(totals.units, 3),
        materialCost: round(totals.material),
        labourCost: round(totals.labour),
        wasteCost: round(totals.waste),
        totalCost: round(totals.material + totals.labour),
        averageCostPerUnit: totals.units > 0 ? round((totals.material + totals.labour) / totals.units) : null,
      },
      byProduct: [...byProduct.values()]
        .map((e) => ({
          ...e,
          unitsProduced: round(e.unitsProduced, 3),
          materialCost: round(e.materialCost),
          labourCost: round(e.labourCost),
          wasteCost: round(e.wasteCost),
          totalCost: round(e.totalCost),
          averageCostPerUnit: e.unitsProduced > 0 ? round(e.totalCost / e.unitsProduced) : null,
        }))
        .sort((a, b) => b.totalCost - a.totalCost),
      runs: rows,
    };
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Roadmap item 11 — Inventory valuation
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Stock on hand valued at what it actually cost to acquire, batch by batch,
   * rather than at the product's list price. The two are reported side by side
   * because the gap between them is itself the finding.
   */
  getValuationReport: async (query: { categoryId?: string } = {}) => {
    const batches = await prisma.inventoryBatch.findMany({
      where: {
        remainingQuantity: { gt: 0 },
        ...(query.categoryId
          ? { product: { OR: [{ categoryId: query.categoryId }, { categories: { some: { id: query.categoryId } } }] } }
          : {}),
      },
      select: {
        id: true, batchNumber: true, remainingQuantity: true, reservedQuantity: true, createdAt: true,
        unitCost: true, costFinalizedAt: true, sourceTaskId: true,
        product: { select: { id: true, name: true, sku: true, unit: true, unitPrice: true, itemType: true } },
        stockMovements: {
          where: { type: { in: [StockMovementType.PURCHASE, StockMovementType.ASSEMBLY, StockMovementType.RETURN] } },
          select: { unitCost: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const byProduct = new Map<string, any>();
    let totalActual = 0;
    let totalAtList = 0;
    let batchesWithoutCost = 0;

    for (const batch of batches) {
      const remaining = num(batch.remainingQuantity);
      const listPrice = num(batch.product.unitPrice);
      // The batch carries its own cost now — material plus, for a finished run,
      // labour. Only batches predating cost tracking fall back to the movement
      // or, failing that, the list price.
      const acquired = batch.stockMovements[0];
      const costed = batch.unitCost !== null;
      if (!costed && !acquired) batchesWithoutCost += 1;
      const unitCost = costed ? num(batch.unitCost) : acquired ? num(acquired.unitCost) : listPrice;

      const actualValue = remaining * unitCost;
      const listValue = remaining * listPrice;
      totalActual += actualValue;
      totalAtList += listValue;

      const entry = byProduct.get(batch.product.id) ?? {
        productId: batch.product.id, name: batch.product.name, sku: batch.product.sku,
        unit: batch.product.unit, itemType: batch.product.itemType, listUnitPrice: round(listPrice),
        batches: 0, quantity: 0, reserved: 0, actualValue: 0, listValue: 0, oldestBatchAt: batch.createdAt,
      };
      entry.batches += 1;
      entry.quantity += remaining;
      entry.reserved += num(batch.reservedQuantity);
      entry.actualValue += actualValue;
      entry.listValue += listValue;
      byProduct.set(batch.product.id, entry);
    }

    const items = [...byProduct.values()]
      .map((e) => ({
        ...e,
        quantity: round(e.quantity, 3),
        reserved: round(e.reserved, 3),
        actualValue: round(e.actualValue),
        listValue: round(e.listValue),
        variance: round(e.actualValue - e.listValue),
        weightedUnitCost: e.quantity > 0 ? round(e.actualValue / e.quantity, 4) : 0,
        oldestBatchAt: e.oldestBatchAt.toISOString(),
      }))
      .sort((a, b) => b.actualValue - a.actualValue);

    return {
      basis: 'Each batch is valued at its own recorded cost — what a purchase was bought for, or what a production run consumed in material and labour. Batches predating cost tracking fall back to their creating movement, then to the list price.',
      summary: {
        products: items.length,
        batches: batches.length,
        batchesValuedAtListPrice: batchesWithoutCost,
        batchesWithProvisionalCost: batches.filter((b) => b.sourceTaskId && b.unitCost !== null && b.costFinalizedAt === null).length,
        totalValueAtCost: round(totalActual),
        totalValueAtListPrice: round(totalAtList),
        variance: round(totalActual - totalAtList),
      },
      items,
    };
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Roadmap item 12 — Labour efficiency
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Output per hour worked, per employee and per product, plus how often work
   * landed by its deadline.
   */
  getLabourEfficiencyReport: async (query: { from?: string; to?: string } = {}) => {
    const { from, to } = windowFrom(query, 30);

    const [tasks, attendance, profiles] = await Promise.all([
      prisma.task.findMany({
        where: { completedAt: { gte: from, lte: to } },
        select: {
          id: true, title: true, completedQuantity: true, productionQuantity: true,
          startedAt: true, completedAt: true, deadline: true, status: true,
          product: { select: { id: true, name: true, sku: true, unit: true } },
          assignments: { select: { employee: { select: { id: true, name: true, email: true } } } },
        },
      }),
      prisma.attendance.findMany({
        where: { date: { gte: from, lte: to } },
        select: { employeeId: true, workedHours: true, overtimeHours: true, overtimeStatus: true },
      }),
      prisma.employeeProfile.findMany({ select: { userId: true, hourlyRate: true, department: true, designation: true } }),
    ]);

    const labour = await attributeLabour(tasks.map((t) => t.id));
    const rateOf = new Map(profiles.map((p) => [p.userId, p]));

    const hoursByEmployee = new Map<string, number>();
    for (const a of attendance) {
      hoursByEmployee.set(a.employeeId, (hoursByEmployee.get(a.employeeId) ?? 0) + num(a.workedHours));
    }

    const byEmployee = new Map<string, any>();
    for (const task of tasks) {
      const produced = num(task.completedQuantity);
      const assignees = task.assignments.map((a) => a.employee);
      if (assignees.length === 0) continue;
      const perHead = produced / assignees.length;
      const slice = labour.get(task.id) ?? { hours: 0, cost: 0 };

      for (const person of assignees) {
        const entry = byEmployee.get(person.id) ?? {
          employeeId: person.id,
          name: person.name ?? person.email,
          department: rateOf.get(person.id)?.department ?? null,
          designation: rateOf.get(person.id)?.designation ?? null,
          tasksCompleted: 0, unitsProduced: 0, attributedHours: 0, labourCost: 0, onTime: 0, late: 0,
        };
        entry.tasksCompleted += 1;
        entry.unitsProduced += perHead;
        entry.attributedHours += slice.hours / assignees.length;
        entry.labourCost += slice.cost / assignees.length;
        if (task.deadline && task.completedAt) {
          const due = new Date(`${task.deadline.toISOString().slice(0, 10)}T23:59:59.999Z`);
          if (task.completedAt <= due) entry.onTime += 1;
          else entry.late += 1;
        }
        byEmployee.set(person.id, entry);
      }
    }

    const employees = [...byEmployee.values()]
      .map((e) => ({
        ...e,
        unitsProduced: round(e.unitsProduced, 3),
        attributedHours: round(e.attributedHours, 2),
        totalHoursWorked: round(hoursByEmployee.get(e.employeeId) ?? 0, 2),
        labourCost: round(e.labourCost),
        unitsPerHour: e.attributedHours > 0 ? round(e.unitsProduced / e.attributedHours, 3) : null,
        costPerUnit: e.unitsProduced > 0 ? round(e.labourCost / e.unitsProduced) : null,
        onTimeRate: e.onTime + e.late > 0 ? round((e.onTime / (e.onTime + e.late)) * 100, 1) : null,
      }))
      .sort((a, b) => (b.unitsPerHour ?? -1) - (a.unitsPerHour ?? -1));

    const completed = tasks.filter((t) => t.deadline && t.completedAt);
    const onTime = completed.filter((t) => t.completedAt! <= new Date(`${t.deadline!.toISOString().slice(0, 10)}T23:59:59.999Z`)).length;

    return {
      basis: LABOUR_BASIS,
      period: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        tasksCompleted: tasks.length,
        unitsProduced: round(tasks.reduce((s, t) => s + num(t.completedQuantity), 0), 3),
        attributedHours: round([...labour.values()].reduce((s, l) => s + l.hours, 0), 2),
        labourCost: round([...labour.values()].reduce((s, l) => s + l.cost, 0)),
        tasksWithDeadline: completed.length,
        onTimeRate: completed.length > 0 ? round((onTime / completed.length) * 100, 1) : null,
      },
      employees,
    };
  },
};
