import { DispositionType, Prisma, StockMovementType } from '@prisma/client';
import prisma from '../../utils/prisma/prisma-client';
import ApiError from '../../utils/errors/api-error';
import { generateDispositionNumber } from '../../utils/inventory/disposition-generator';
import { batchCosting } from '../inventory/batch-costing.service';
import type { CreateDispositionInput } from './sales.validation';

/**
 * Finished goods and what happens to them.
 *
 * "Finished goods" means a batch produced by a production run — a batch with a
 * `sourceTaskId`. That is precisely the thing the business makes: a composite
 * product, built by an employee, out of components.
 *
 * Disposing of one records revenue and cost together and freezes both. Nothing
 * downstream recomputes them: re-pricing a product next month, or re-costing a
 * batch, must never change what a past month earned.
 */

const num = (v: any): number => (v === null || v === undefined ? 0 : Number(v));
const round = (v: number, dp = 2): number => Number(v.toFixed(dp));

/** Revenue-bearing dispositions. A write-off earns nothing by definition. */
const REVENUE_TYPES: DispositionType[] = [DispositionType.CUSTOMER_SALE, DispositionType.STORE_TRANSFER];

export type FinishedGoodsStatus = 'UNSOLD' | 'PARTLY_SOLD' | 'FULLY_DISPOSED';

function statusOf(initial: number, remaining: number): FinishedGoodsStatus {
  if (remaining <= 0) return 'FULLY_DISPOSED';
  if (remaining < initial) return 'PARTLY_SOLD';
  return 'UNSOLD';
}

export const salesServices = {
  // ─────────────────────────────────────────────────────────────────────────
  // The finished goods register
  // ─────────────────────────────────────────────────────────────────────────
  getFinishedGoods: async (query: { search?: string; productId?: string; status?: string } = {}) => {
    const batches = await prisma.inventoryBatch.findMany({
      where: {
        sourceTaskId: { not: null },
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.search
          ? {
              OR: [
                { batchNumber: { contains: query.search, mode: 'insensitive' } },
                { product: { name: { contains: query.search, mode: 'insensitive' } } },
                { product: { sku: { contains: query.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: {
        id: true, batchNumber: true, initialQuantity: true, remainingQuantity: true,
        materialUnitCost: true, labourUnitCost: true, unitCost: true, costFinalizedAt: true,
        createdAt: true,
        product: { select: { id: true, name: true, sku: true, unit: true, unitPrice: true, sellingPrice: true, imageUrl: true } },
        sourceTask: {
          select: {
            id: true, title: true, status: true, completedAt: true,
            assignments: { select: { employee: { select: { id: true, name: true, email: true, avatarUrl: true } } } },
          },
        },
        dispositions: {
          where: { reversedAt: null },
          select: { id: true, type: true, quantity: true, totalRevenue: true, grossProfit: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const rows = batches.map((batch) => {
      const initial = num(batch.initialQuantity);
      const remaining = num(batch.remainingQuantity);
      const unitCost = batch.unitCost === null ? num(batch.product.unitPrice) : num(batch.unitCost);
      const disposed = batch.dispositions.reduce((sum, d) => sum + num(d.quantity), 0);
      const revenue = batch.dispositions.reduce((sum, d) => sum + num(d.totalRevenue), 0);
      const profit = batch.dispositions.reduce((sum, d) => sum + num(d.grossProfit), 0);
      const suggested = batch.product.sellingPrice === null ? null : num(batch.product.sellingPrice);

      return {
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        product: {
          id: batch.product.id, name: batch.product.name, sku: batch.product.sku,
          unit: batch.product.unit, imageUrl: batch.product.imageUrl,
          sellingPrice: suggested,
        },
        producedBy: batch.sourceTask?.assignments.map((a) => ({
          id: a.employee.id, name: a.employee.name ?? a.employee.email, avatarUrl: a.employee.avatarUrl,
        })) ?? [],
        producedByTask: batch.sourceTask
          ? { id: batch.sourceTask.id, title: batch.sourceTask.title, status: batch.sourceTask.status, completedAt: batch.sourceTask.completedAt?.toISOString() ?? null }
          : null,
        producedAt: batch.createdAt.toISOString(),
        initialQuantity: round(initial, 3),
        remainingQuantity: round(remaining, 3),
        disposedQuantity: round(disposed, 3),
        unitCost: round(unitCost, 4),
        materialUnitCost: batch.materialUnitCost === null ? null : round(num(batch.materialUnitCost), 4),
        labourUnitCost: batch.labourUnitCost === null ? null : round(num(batch.labourUnitCost), 4),
        // A provisional cost means the run is still open and labour is not yet
        // included — sellable, but the caller should be told.
        costIsFinal: batch.costFinalizedAt !== null,
        stockValueRemaining: round(remaining * unitCost),
        revenueToDate: round(revenue),
        profitToDate: round(profit),
        suggestedMargin:
          suggested === null || unitCost <= 0 ? null : round(((suggested - unitCost) / suggested) * 100, 1),
        status: statusOf(initial, remaining),
        dispositionCount: batch.dispositions.length,
      };
    });

    const filtered = query.status && query.status !== 'ALL' ? rows.filter((r) => r.status === query.status) : rows;

    return {
      summary: {
        batches: filtered.length,
        unsold: filtered.filter((r) => r.status === 'UNSOLD').length,
        partlySold: filtered.filter((r) => r.status === 'PARTLY_SOLD').length,
        fullyDisposed: filtered.filter((r) => r.status === 'FULLY_DISPOSED').length,
        provisionalCost: filtered.filter((r) => !r.costIsFinal).length,
        unitsOnHand: round(filtered.reduce((s, r) => s + r.remainingQuantity, 0), 3),
        stockValue: round(filtered.reduce((s, r) => s + r.stockValueRemaining, 0)),
        revenueToDate: round(filtered.reduce((s, r) => s + r.revenueToDate, 0)),
        profitToDate: round(filtered.reduce((s, r) => s + r.profitToDate, 0)),
      },
      items: filtered,
    };
  },

  getFinishedGoodsBatch: async (batchId: string) => {
    const batch = await prisma.inventoryBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true, batchNumber: true, initialQuantity: true, remainingQuantity: true,
        materialUnitCost: true, labourUnitCost: true, unitCost: true, costFinalizedAt: true, createdAt: true,
        sourceTaskId: true,
        product: { select: { id: true, name: true, sku: true, unit: true, unitPrice: true, sellingPrice: true } },
        sourceTask: {
          select: {
            id: true, title: true, status: true, startedAt: true, completedAt: true,
            assignments: { select: { employee: { select: { id: true, name: true, email: true } } } },
          },
        },
        dispositions: {
          orderBy: { dispositionedAt: 'desc' },
          select: {
            id: true, dispositionNumber: true, type: true, quantity: true,
            unitSellingPrice: true, totalRevenue: true, unitCogs: true, totalCogs: true,
            grossProfit: true, costWasFinal: true, reason: true, notes: true,
            dispositionedAt: true, reversedAt: true, reversalReason: true,
            customer: { select: { id: true, name: true, type: true } },
            recordedBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!batch) throw ApiError.notFound('Batch not found');
    if (!batch.sourceTaskId) {
      throw ApiError.badRequest('This batch was purchased, not manufactured — finished goods covers production output only');
    }

    const initial = num(batch.initialQuantity);
    const remaining = num(batch.remainingQuantity);
    const unitCost = batch.unitCost === null ? num(batch.product.unitPrice) : num(batch.unitCost);

    return {
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      product: batch.product,
      producedByTask: batch.sourceTask,
      producedAt: batch.createdAt.toISOString(),
      initialQuantity: round(initial, 3),
      remainingQuantity: round(remaining, 3),
      cost: {
        material: batch.materialUnitCost === null ? null : round(num(batch.materialUnitCost), 4),
        labour: batch.labourUnitCost === null ? null : round(num(batch.labourUnitCost), 4),
        unit: round(unitCost, 4),
        isFinal: batch.costFinalizedAt !== null,
        finalizedAt: batch.costFinalizedAt?.toISOString() ?? null,
      },
      status: statusOf(initial, remaining),
      dispositions: batch.dispositions.map((d) => ({
        ...d,
        quantity: num(d.quantity),
        unitSellingPrice: num(d.unitSellingPrice),
        totalRevenue: num(d.totalRevenue),
        unitCogs: num(d.unitCogs),
        totalCogs: num(d.totalCogs),
        grossProfit: num(d.grossProfit),
        dispositionedAt: d.dispositionedAt.toISOString(),
        reversedAt: d.reversedAt?.toISOString() ?? null,
      })),
    };
  },

  /** The default price offered for a product's finished goods. */
  setSellingPrice: async (productId: string, sellingPrice: number | null) => {
    const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, isComposite: true } });
    if (!product) throw ApiError.notFound('Product not found');
    return prisma.product.update({
      where: { id: productId },
      data: { sellingPrice },
      select: { id: true, name: true, sku: true, unitPrice: true, sellingPrice: true },
    });
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Recording a disposition
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Sell, transfer or write off part of a finished-goods batch.
   *
   * Everything happens in one transaction: the batch and the product's stock
   * are decremented, a stock movement is written, and revenue and cost are
   * frozen onto the record. Splitting these apart would let valuation and
   * profit disagree the moment anything failed halfway.
   */
  createDisposition: async (batchId: string, payload: CreateDispositionInput, userId: string) => {
    return prisma.$transaction(async (tx) => {
      const batch = await tx.inventoryBatch.findUnique({
        where: { id: batchId },
        select: {
          id: true, batchNumber: true, productId: true, remainingQuantity: true, reservedQuantity: true,
          sourceTaskId: true,
          product: { select: { id: true, name: true, currentStock: true } },
        },
      });

      if (!batch) throw ApiError.notFound('Batch not found');
      if (!batch.sourceTaskId) {
        throw ApiError.badRequest('Only manufactured batches can be sold as finished goods');
      }

      const remaining = num(batch.remainingQuantity);
      const reserved = num(batch.reservedQuantity);
      const available = remaining - reserved;
      const quantity = payload.quantity;

      if (quantity > available) {
        throw ApiError.badRequest(
          `Only ${available} available in ${batch.batchNumber}` +
            (reserved > 0 ? ` (${remaining} remaining, ${reserved} reserved for production)` : ''),
        );
      }

      if (payload.customerId) {
        const customer = await tx.customer.findUnique({ where: { id: payload.customerId }, select: { id: true, isActive: true } });
        if (!customer) throw ApiError.notFound('Customer not found');
        if (!customer.isActive) throw ApiError.badRequest('That customer is no longer active');
      }

      // Cost is taken now and frozen. Re-costing the batch later must not
      // change what this sale earned.
      const { unitCost, isFinal } = await batchCosting.resolveUnitCost(tx, batchId);

      const isRevenue = REVENUE_TYPES.includes(payload.type);
      const unitSellingPrice = isRevenue ? (payload.unitSellingPrice ?? 0) : 0;
      const totalRevenue = round(unitSellingPrice * quantity);
      const totalCogs = round(unitCost * quantity);
      const grossProfit = round(totalRevenue - totalCogs);

      await tx.inventoryBatch.update({
        where: { id: batchId },
        data: { remainingQuantity: { decrement: quantity } },
      });
      await tx.product.update({
        where: { id: batch.productId },
        data: { currentStock: { decrement: quantity } },
      });

      const previousQuantity = num(batch.product.currentStock);
      await tx.stockMovement.create({
        data: {
          productId: batch.productId,
          batchId,
          // A write-off keeps using the existing WRITE_OFF type so the waste
          // report continues to see it without a parallel mechanism.
          type: payload.type === DispositionType.WRITE_OFF ? StockMovementType.WRITE_OFF : StockMovementType.SALE,
          quantity,
          previousQuantity,
          newQuantity: previousQuantity - quantity,
          unitCost,
          totalCost: totalCogs,
          performedById: userId,
          reason: payload.reason ?? (isRevenue ? 'Finished goods sold' : 'Finished goods written off'),
          notes: payload.notes ?? undefined,
        },
      });

      const disposition = await tx.disposition.create({
        data: {
          dispositionNumber: await generateDispositionNumber(tx),
          batchId,
          productId: batch.productId,
          type: payload.type,
          customerId: payload.customerId ?? null,
          quantity,
          unitSellingPrice,
          totalRevenue,
          unitCogs: unitCost,
          totalCogs,
          grossProfit,
          costWasFinal: isFinal,
          reason: payload.reason ?? null,
          notes: payload.notes ?? null,
          recordedById: userId,
        },
        include: {
          customer: { select: { id: true, name: true, type: true } },
          product: { select: { id: true, name: true, sku: true, unit: true } },
          batch: { select: { id: true, batchNumber: true, remainingQuantity: true } },
        },
      });

      return disposition;
    });
  },

  /**
   * Undo a disposition by returning the stock to its batch.
   *
   * The original record is kept and marked reversed rather than deleted — the
   * same append-only discipline the stock ledger follows, so a mistake is
   * visible instead of erased.
   */
  reverseDisposition: async (dispositionId: string, reason: string, userId: string) => {
    return prisma.$transaction(async (tx) => {
      const disposition = await tx.disposition.findUnique({
        where: { id: dispositionId },
        select: {
          id: true, batchId: true, productId: true, quantity: true, reversedAt: true,
          dispositionNumber: true, unitCogs: true, type: true,
          product: { select: { currentStock: true } },
        },
      });

      if (!disposition) throw ApiError.notFound('Disposition not found');
      if (disposition.reversedAt) throw ApiError.badRequest('That disposition has already been reversed');

      const quantity = num(disposition.quantity);

      await tx.inventoryBatch.update({
        where: { id: disposition.batchId },
        data: { remainingQuantity: { increment: quantity } },
      });
      await tx.product.update({
        where: { id: disposition.productId },
        data: { currentStock: { increment: quantity } },
      });

      const previousQuantity = num(disposition.product.currentStock);
      await tx.stockMovement.create({
        data: {
          productId: disposition.productId,
          batchId: disposition.batchId,
          type: StockMovementType.RETURN,
          quantity,
          previousQuantity,
          newQuantity: previousQuantity + quantity,
          unitCost: num(disposition.unitCogs),
          totalCost: round(num(disposition.unitCogs) * quantity),
          performedById: userId,
          reason: `Reversal of ${disposition.dispositionNumber}`,
          notes: reason,
        },
      });

      return tx.disposition.update({
        where: { id: dispositionId },
        data: { reversedAt: new Date(), reversedById: userId, reversalReason: reason },
        include: {
          customer: { select: { id: true, name: true } },
          product: { select: { id: true, name: true, sku: true } },
          batch: { select: { id: true, batchNumber: true } },
        },
      });
    });
  },

  getDispositions: async (query: {
    from?: string; to?: string; type?: string; customerId?: string; productId?: string;
    includeReversed?: boolean; showPerPage?: number; pageNo?: number;
  } = {}) => {
    const take = query.showPerPage && query.showPerPage > 0 ? Math.min(query.showPerPage, 200) : 25;
    const page = query.pageNo && query.pageNo > 0 ? query.pageNo : 1;

    const where: Prisma.DispositionWhereInput = {
      ...(query.includeReversed ? {} : { reversedAt: null }),
      ...(query.type ? { type: query.type as DispositionType } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.from || query.to
        ? {
            dispositionedAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };

    const [totalData, dispositions] = await Promise.all([
      prisma.disposition.count({ where }),
      prisma.disposition.findMany({
        where,
        orderBy: { dispositionedAt: 'desc' },
        skip: (page - 1) * take,
        take,
        include: {
          customer: { select: { id: true, name: true, type: true } },
          product: { select: { id: true, name: true, sku: true, unit: true } },
          batch: { select: { id: true, batchNumber: true } },
          recordedBy: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    return { totalData, page, showPerPage: take, dispositions };
  },
};
