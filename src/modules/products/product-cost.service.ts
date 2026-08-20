import prisma from '../../utils/prisma/prisma-client';
import ApiError from '../../utils/errors/api-error';

export interface BOMCostBreakdownItem {
  itemId: string;
  itemName: string;
  sku: string | null;
  itemType: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface ProductCostResult {
  productId: string;
  productName: string;
  sku: string | null;
  unit: string;
  adminUnitPrice: number;
  suggestedCost: number;
  priceWarning: boolean;
  warningMessage: string | null;
  breakdown: BOMCostBreakdownItem[];
}

export const productCostService = {
  /**
   * Calculate suggested production cost for a product based on its BOM entries.
   * Uses child item's own set unit price (non-recursive).
   */
  calculateProductCost: async (productId: string): Promise<ProductCostResult> => {
    const parentProduct = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!parentProduct) {
      throw ApiError.notFound('Product not found');
    }

    const bomEntries = await prisma.productBOM.findMany({
      where: { parentProductId: productId },
      include: {
        childProduct: {
          select: {
            id: true,
            name: true,
            sku: true,
            itemType: true,
            unit: true,
            unitPrice: true,
            isDiscontinued: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    let suggestedCostAcc = 0;
    const breakdown: BOMCostBreakdownItem[] = [];

    for (const entry of bomEntries) {
      const child = entry.childProduct;
      const quantity = Number(entry.quantityRequired);
      const unitPrice = Number(child.unitPrice);
      const total = Number((quantity * unitPrice).toFixed(2));

      suggestedCostAcc += total;

      breakdown.push({
        itemId: child.id,
        itemName: child.name,
        sku: child.sku,
        itemType: child.itemType,
        unit: child.unit,
        quantity,
        unitPrice,
        total,
      });
    }

    const suggestedCost = Number(suggestedCostAcc.toFixed(2));
    const adminUnitPrice = Number(parentProduct.unitPrice);
    const priceWarning = suggestedCost > 0 && suggestedCost >= adminUnitPrice;
    const warningMessage = priceWarning
      ? 'The final price is equal to or lower than the suggested cost. Please review.'
      : null;

    return {
      productId: parentProduct.id,
      productName: parentProduct.name,
      sku: parentProduct.sku,
      unit: parentProduct.unit,
      adminUnitPrice,
      suggestedCost,
      priceWarning,
      warningMessage,
      breakdown,
    };
  },
};
