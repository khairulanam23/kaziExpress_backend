import { DispositionType } from '@prisma/client';
import prisma from '../../utils/prisma/prisma-client';

/**
 * Gross profit: what was sold, what it cost, and the difference.
 *
 * Every figure is read from the frozen values on each disposition rather than
 * recomputed from current prices and costs. That is deliberate — a report that
 * recalculated would quietly rewrite last month's profit the next time a
 * product was re-priced.
 *
 * Reversed dispositions are excluded outright rather than netted off, because
 * a reversal means the sale did not happen.
 */

const num = (v: any): number => (v === null || v === undefined ? 0 : Number(v));
const round = (v: number, dp = 2): number => Number(v.toFixed(dp));
const DAY_MS = 24 * 60 * 60 * 1000;

const marginOf = (revenue: number, profit: number) => (revenue > 0 ? round((profit / revenue) * 100, 1) : null);

export const profitServices = {
  getProfitReport: async (
    query: {
      from?: string; to?: string; productId?: string; customerId?: string;
      includeStoreTransfers?: boolean;
    } = {},
  ) => {
    const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
    const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : new Date(to.getTime() - 90 * DAY_MS);

    // Store transfers are sales in this business — the store is run separately
    // — but they can be excluded to see outside revenue on its own.
    const includeTransfers = query.includeStoreTransfers !== false;
    const revenueTypes: DispositionType[] = includeTransfers
      ? [DispositionType.CUSTOMER_SALE, DispositionType.STORE_TRANSFER]
      : [DispositionType.CUSTOMER_SALE];

    const dispositions = await prisma.disposition.findMany({
      where: {
        reversedAt: null,
        dispositionedAt: { gte: from, lte: to },
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
      },
      select: {
        id: true, dispositionNumber: true, type: true, quantity: true,
        unitSellingPrice: true, totalRevenue: true, unitCogs: true, totalCogs: true,
        grossProfit: true, costWasFinal: true, dispositionedAt: true, reason: true,
        product: { select: { id: true, name: true, sku: true, unit: true } },
        customer: { select: { id: true, name: true, type: true } },
        batch: { select: { id: true, batchNumber: true } },
      },
      orderBy: { dispositionedAt: 'desc' },
    });

    const sales = dispositions.filter((d) => revenueTypes.includes(d.type));
    const writeOffs = dispositions.filter((d) => d.type === DispositionType.WRITE_OFF);

    const revenue = sales.reduce((s, d) => s + num(d.totalRevenue), 0);
    const cogs = sales.reduce((s, d) => s + num(d.totalCogs), 0);
    const grossProfit = revenue - cogs;
    const writeOffCost = writeOffs.reduce((s, d) => s + num(d.totalCogs), 0);

    // ── By product ───────────────────────────────────────────────────────────
    const byProduct = new Map<string, any>();
    for (const d of sales) {
      const entry = byProduct.get(d.product.id) ?? {
        productId: d.product.id, name: d.product.name, sku: d.product.sku, unit: d.product.unit,
        unitsSold: 0, revenue: 0, cogs: 0, grossProfit: 0, sales: 0,
      };
      entry.unitsSold += num(d.quantity);
      entry.revenue += num(d.totalRevenue);
      entry.cogs += num(d.totalCogs);
      entry.grossProfit += num(d.grossProfit);
      entry.sales += 1;
      byProduct.set(d.product.id, entry);
    }
    for (const d of writeOffs) {
      const entry = byProduct.get(d.product.id) ?? {
        productId: d.product.id, name: d.product.name, sku: d.product.sku, unit: d.product.unit,
        unitsSold: 0, revenue: 0, cogs: 0, grossProfit: 0, sales: 0,
      };
      entry.writeOffCost = (entry.writeOffCost ?? 0) + num(d.totalCogs);
      byProduct.set(d.product.id, entry);
    }

    // ── By customer ──────────────────────────────────────────────────────────
    const byCustomer = new Map<string, any>();
    for (const d of sales) {
      const key = d.customer?.id ?? 'unattributed';
      const entry = byCustomer.get(key) ?? {
        customerId: d.customer?.id ?? null,
        name: d.customer?.name ?? 'Unattributed',
        type: d.customer?.type ?? null,
        unitsSold: 0, revenue: 0, cogs: 0, grossProfit: 0, sales: 0,
      };
      entry.unitsSold += num(d.quantity);
      entry.revenue += num(d.totalRevenue);
      entry.cogs += num(d.totalCogs);
      entry.grossProfit += num(d.grossProfit);
      entry.sales += 1;
      byCustomer.set(key, entry);
    }

    // ── By month, so a trend is visible rather than a single total ──────────
    const byMonth = new Map<string, any>();
    for (const d of sales) {
      const key = d.dispositionedAt.toISOString().slice(0, 7);
      const entry = byMonth.get(key) ?? { month: key, revenue: 0, cogs: 0, grossProfit: 0, unitsSold: 0 };
      entry.revenue += num(d.totalRevenue);
      entry.cogs += num(d.totalCogs);
      entry.grossProfit += num(d.grossProfit);
      entry.unitsSold += num(d.quantity);
      byMonth.set(key, entry);
    }

    const finish = (rows: any[]) =>
      rows
        .map((r) => ({
          ...r,
          unitsSold: round(r.unitsSold, 3),
          revenue: round(r.revenue),
          cogs: round(r.cogs),
          grossProfit: round(r.grossProfit),
          writeOffCost: r.writeOffCost ? round(r.writeOffCost) : 0,
          marginPercent: marginOf(r.revenue, r.grossProfit),
        }))
        .sort((a, b) => b.grossProfit - a.grossProfit);

    const provisional = sales.filter((d) => !d.costWasFinal);

    return {
      basis:
        'Revenue and cost of goods sold are the figures frozen when each sale was recorded, never recalculated. ' +
        (includeTransfers
          ? 'Transfers to the company\'s own store are counted as sales.'
          : 'Transfers to the company\'s own store are excluded.') +
        (provisional.length > 0
          ? ` ${provisional.length} sale(s) drew from a batch whose production run had not finished, so their cost excludes labour and understates COGS.`
          : ''),
      period: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        sales: sales.length,
        unitsSold: round(sales.reduce((s, d) => s + num(d.quantity), 0), 3),
        revenue: round(revenue),
        cogs: round(cogs),
        grossProfit: round(grossProfit),
        marginPercent: marginOf(revenue, grossProfit),
        writeOffs: writeOffs.length,
        writeOffCost: round(writeOffCost),
        /** Gross profit after finished goods scrapped in the same period. */
        netOfWriteOffs: round(grossProfit - writeOffCost),
        salesWithProvisionalCost: provisional.length,
      },
      byProduct: finish([...byProduct.values()]),
      byCustomer: finish([...byCustomer.values()]),
      byMonth: [...byMonth.values()]
        .map((m) => ({
          ...m,
          revenue: round(m.revenue),
          cogs: round(m.cogs),
          grossProfit: round(m.grossProfit),
          unitsSold: round(m.unitsSold, 3),
          marginPercent: marginOf(m.revenue, m.grossProfit),
        }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      recent: dispositions.slice(0, 50).map((d) => ({
        id: d.id,
        dispositionNumber: d.dispositionNumber,
        type: d.type,
        product: d.product.name,
        sku: d.product.sku,
        batchNumber: d.batch.batchNumber,
        customer: d.customer?.name ?? null,
        quantity: num(d.quantity),
        unitSellingPrice: num(d.unitSellingPrice),
        revenue: num(d.totalRevenue),
        cogs: num(d.totalCogs),
        grossProfit: num(d.grossProfit),
        marginPercent: marginOf(num(d.totalRevenue), num(d.grossProfit)),
        costWasFinal: d.costWasFinal,
        reason: d.reason,
        at: d.dispositionedAt.toISOString(),
      })),
    };
  },
};
