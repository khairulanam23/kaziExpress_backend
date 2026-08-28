import prisma from '../../utils/prisma/prisma-client';
import ApiError from '../../utils/errors/api-error';
import { generateBatchNumber } from '../../utils/inventory/batch-generator';
import { batchCosting } from './batch-costing.service';

export interface AddStockPayload {
  productId: string;
  quantity: number;
  unitCost?: number;
  notes?: string;
  userId: string;
  /** Supplier of this delivery. Falls back to the product's vendor when unambiguous. */
  vendorId?: string;
}

export interface AdjustStockPayload {
  productId: string;
  newQuantity?: number;
  quantityDifference?: number;
  batchId?: string;
  reason: string;
  userId: string;
}

export interface ListMovementsParams {
  productId?: string;
  type?: string;
  batchId?: string;
  from?: string;
  to?: string;
  pageNo?: number;
  showPerPage?: number;
}

export const inventoryService = {
  /**
   * Add stock to an item. Automatically creates a new batch in a transaction.
   */
  addStock: async (payload: AddStockPayload) => {
    const { productId, quantity, unitCost, notes, userId, vendorId } = payload;

    if (quantity <= 0) {
      throw new ApiError(400, 'Quantity added must be greater than 0');
    }

    return await (prisma as any).$transaction(async (tx: any) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        include: { vendors: { select: { id: true } } },
      });

      if (!product || product.isDiscontinued) {
        throw new ApiError(404, 'Active product not found');
      }

      // Attribute the purchase to a vendor so price history is answerable
      // later. An explicit vendor wins; otherwise the product's own vendor is
      // used, but only when it is unambiguous — guessing between several would
      // corrupt the very analysis the field exists for.
      const candidateVendors = product.vendors?.map((v: { id: string }) => v.id) ?? [];
      const resolvedVendorId =
        vendorId ??
        product.vendorId ??
        (candidateVendors.length === 1 ? candidateVendors[0] : null);

      if (vendorId) {
        const vendor = await tx.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
        if (!vendor) throw new ApiError(404, 'Vendor not found');
      }

      const batchNumber = await generateBatchNumber();
      const batch = await tx.inventoryBatch.create({
        data: {
          batchNumber,
          productId,
          initialQuantity: quantity,
          remainingQuantity: quantity,
          reservedQuantity: 0,
          createdById: userId,
        },
      });

      const previousQuantity = Number(product.currentStock);
      const newQuantity = previousQuantity + quantity;
      const actualUnitCost = unitCost ?? Number(product.unitPrice);
      const totalCost = quantity * actualUnitCost;

      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: {
          currentStock: newQuantity,
        },
      });

      // A purchase knows its cost immediately and nothing can change it later.
      await batchCosting.costPurchasedBatch(tx, batch.id, actualUnitCost);

      const movement = await tx.stockMovement.create({
        data: {
          productId,
          batchId: batch.id,
          vendorId: resolvedVendorId,
          type: 'PURCHASE',
          quantity,
          previousQuantity,
          newQuantity,
          unitCost: actualUnitCost,
          totalCost,
          performedById: userId,
          notes: notes || `Added ${quantity} ${product.unit} (Batch: ${batchNumber})`,
          reason: notes || 'New stock added',
        },
      });

      return {
        product: updatedProduct,
        batch,
        movement,
      };
    });
  },

  /**
   * Adjust inventory manually (increase or decrease with full accountability).
   * Enforces non-negative inventory rule and invariant consistency.
   */
  adjustStock: async (payload: AdjustStockPayload) => {
    const { productId, newQuantity, quantityDifference, batchId, reason, userId } = payload;

    if (!reason || !reason.trim()) {
      throw new ApiError(400, 'An administrative note/reason is required for inventory adjustments');
    }

    return await (prisma as any).$transaction(async (tx: any) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
      });

      if (!product || product.isDiscontinued) {
        throw new ApiError(404, 'Active product not found');
      }

      const previousStock = Number(product.currentStock);
      let targetStock = previousStock;

      if (newQuantity !== undefined) {
        targetStock = newQuantity;
      } else if (quantityDifference !== undefined) {
        targetStock = previousStock + quantityDifference;
      } else {
        throw new ApiError(400, 'Specify either newQuantity or quantityDifference');
      }

      if (targetStock < 0) {
        throw new ApiError(400, `Inventory cannot be negative. Resulting stock would be ${targetStock}`);
      }

      const diff = targetStock - previousStock;
      if (diff === 0) {
        return { product, movement: null };
      }

      let createdBatch = null;

      if (diff > 0) {
        // Positive manual adjustment: Create a batch for the added quantity
        const batchNumber = await generateBatchNumber();
        createdBatch = await tx.inventoryBatch.create({
          data: {
            batchNumber,
            productId,
            initialQuantity: diff,
            remainingQuantity: diff,
            reservedQuantity: 0,
            createdById: userId,
          },
        });
      } else {
        // Negative manual adjustment (decrease / damage / write-off)
        const amountToRemove = Math.abs(diff);

        if (batchId) {
          const batch = await tx.inventoryBatch.findUnique({
            where: { id: batchId },
          });

          if (!batch || batch.productId !== productId) {
            throw new ApiError(404, 'Specified batch not found for this product');
          }

          if (Number(batch.remainingQuantity) < amountToRemove) {
            throw new ApiError(
              400,
              `Specified batch has insufficient available quantity (${batch.remainingQuantity}) for reduction of ${amountToRemove}`
            );
          }

          await tx.inventoryBatch.update({
            where: { id: batchId },
            data: {
              remainingQuantity: Number(batch.remainingQuantity) - amountToRemove,
            },
          });
        } else {
          // If no specific batch is selected, deduct from batches starting with largest remaining quantity
          let remainingToDeduct = amountToRemove;
          const activeBatches = await tx.inventoryBatch.findMany({
            where: { productId, remainingQuantity: { gt: 0 } },
            orderBy: { remainingQuantity: 'desc' },
          });

          for (const b of activeBatches) {
            if (remainingToDeduct <= 0) break;
            const bQty = Number(b.remainingQuantity);
            const deduct = Math.min(bQty, remainingToDeduct);
            await tx.inventoryBatch.update({
              where: { id: b.id },
              data: { remainingQuantity: bQty - deduct },
            });
            remainingToDeduct -= deduct;
          }
        }
      }

      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: { currentStock: targetStock },
      });

      const movementType = diff > 0 ? 'ADJUSTMENT' : 'WRITE_OFF';
      const actualUnitCost = Number(product.unitPrice);
      const totalCost = Math.abs(diff) * actualUnitCost;

      const movement = await tx.stockMovement.create({
        data: {
          productId,
          batchId: createdBatch ? createdBatch.id : batchId || null,
          type: movementType,
          quantity: Math.abs(diff),
          previousQuantity: previousStock,
          newQuantity: targetStock,
          unitCost: actualUnitCost,
          totalCost,
          performedById: userId,
          notes: reason,
          reason,
        },
      });

      return {
        product: updatedProduct,
        batch: createdBatch,
        movement,
      };
    });
  },

  /**
   * List batches for a given product or all products.
   */
  listBatches: async (productId?: string) => {
    return await (prisma as any).inventoryBatch.findMany({
      where: productId ? { productId } : undefined,
      include: {
        product: { select: { id: true, name: true, sku: true, itemType: true, unit: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * List inventory movement history with pagination.
   */
  listMovements: async (params: ListMovementsParams) => {
    const { productId, type, batchId, from, to, pageNo = 1, showPerPage = 20 } = params;
    const skip = (pageNo - 1) * showPerPage;

    const where: any = {};
    if (productId) where.productId = productId;
    if (type) where.type = type;
    if (batchId) where.batchId = batchId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [totalData, movements] = await Promise.all([
      (prisma as any).stockMovement.count({ where }),
      (prisma as any).stockMovement.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, sku: true, itemType: true, unit: true } },
          batch: { select: { id: true, batchNumber: true, remainingQuantity: true } },
          performedBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: showPerPage,
      }),
    ]);

    const totalPages = Math.ceil(totalData / showPerPage) || 1;
    return { movements, totalData, totalPages, currentPage: pageNo };
  },
};
