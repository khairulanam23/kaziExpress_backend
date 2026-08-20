import prisma from '../../utils/prisma/prisma-client';
import { Prisma } from '@prisma/client';
import ApiError from '../../utils/errors/api-error';
import { buildPagination, totalPagesOf } from '../../helpers/pagination';
import { getBOMTree, detectCircularBOM } from './bom.util';
import { CreateProductInput, UpdateProductInput, ProductSearchQueryInput, ReplaceBOMInput, CustomFieldInput } from './products.validation';
import { getConfigValue } from '../config/config.service';
import { storageProvider } from '../../utils/storage/storage.service';
import { notificationServices } from '../notifications/notification.service';

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * Creates a product. If `bomItems` is provided and `isComposite` is true,
 * the BOM entries are created atomically in the same transaction.
 * Deducts component stock immediately if initial starting quantity is positive.
 */
const createProduct = async (data: CreateProductInput) => {
  const { bomItems, categoryIds, vendorIds, ...productData } = data;

  if (productData.sku) {
    const existing = await prisma.product.findUnique({ where: { sku: productData.sku } });
    if (existing) throw ApiError.conflict('A product with this SKU already exists', 'DUPLICATE_SKU');
  }

  if (productData.itemType === 'COMPONENT' && bomItems && bomItems.length > 0) {
    throw ApiError.badRequest('Components cannot have a Bill of Materials. Only PRODUCTS can act as BOM parents.', 'INVALID_BOM_PARENT');
  }

  const initialStock = productData.currentStock ?? 0;

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        ...productData,
        isComposite: !!(bomItems && bomItems.length > 0) || productData.isComposite,
        customFields: productData.customFields ?? {},
        currentStock: initialStock,
        ...(categoryIds && categoryIds.length > 0 && {
          categories: { connect: categoryIds.map((cid) => ({ id: cid })) },
        }),
        ...(vendorIds && vendorIds.length > 0 && {
          vendors: { connect: vendorIds.map((vid) => ({ id: vid })) },
        }),
      },
    });

    // Create BOM entries if provided
    if (bomItems && bomItems.length > 0) {
      const childIds = bomItems.map((i) => i.childProductId);

      // Self-reference check
      if (childIds.includes(product.id)) {
        throw ApiError.badRequest('A product cannot be a component of itself', 'CIRCULAR_BOM');
      }

      // Duplicate child check
      const uniqueChildIds = new Set(childIds);
      if (uniqueChildIds.size !== childIds.length) {
        throw ApiError.badRequest('Duplicate component entries are not allowed', 'DUPLICATE_BOM_ENTRY');
      }

      // Validate all child products exist
      const children = await tx.product.findMany({ where: { id: { in: childIds } } });
      if (children.length !== childIds.length) {
        throw ApiError.badRequest('One or more component product IDs do not exist', 'INVALID_BOM_CHILD');
      }

      // Circular reference check
      if (await detectCircularBOM(product.id, childIds, tx)) {
        throw ApiError.badRequest('Adding these components would create a circular reference', 'CIRCULAR_BOM');
      }

      await tx.productBOM.createMany({
        data: bomItems.map((item) => ({
          parentProductId: product.id,
          childProductId: item.childProductId,
          quantityRequired: item.quantityRequired,
        })),
      });

      // If initial stock is positive, validate component stock and deduct it
      if (initialStock > 0) {
        let calculatedMaterialCost = 0;

        for (const item of bomItems) {
          const childProduct = children.find((c) => c.id === item.childProductId);
          if (!childProduct) throw ApiError.badRequest('Component not found', 'INVALID_BOM_CHILD');

          const requiredQty = Number(item.quantityRequired) * initialStock;
          const availStock = Number(childProduct.currentStock);

          if (availStock < requiredQty) {
            throw ApiError.badRequest(
              `Insufficient stock for component product "${childProduct.name}". Required: ${requiredQty}, Available: ${availStock}`,
              'INSUFFICIENT_STOCK',
              {
                productId: childProduct.id,
                componentName: childProduct.name,
                required: requiredQty,
                available: availStock,
              }
            );
          }

          const unitCost = Number(childProduct.unitPrice);
          calculatedMaterialCost += Number(item.quantityRequired) * unitCost;

          // Record CONSUMPTION movement for component
          await tx.stockMovement.create({
            data: {
              productId: childProduct.id,
              type: 'CONSUMPTION',
              quantity: -requiredQty,
              unitCost,
              totalCost: Number((requiredQty * unitCost).toFixed(2)),
              notes: `Auto-assembly on creation of parent: ${product.name} (Qty: ${initialStock})`,
            },
          });

          // Deduct component stock
          const updatedComponent = await tx.product.update({
            where: { id: childProduct.id },
            data: { currentStock: { decrement: requiredQty } },
          });

          await maybeFlagNegativeStock(childProduct.id, Number(updatedComponent.currentStock), tx);
        }

        // Record ASSEMBLY movement for parent
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            type: 'ASSEMBLY',
            quantity: initialStock,
            unitCost: calculatedMaterialCost,
            totalCost: Number((initialStock * calculatedMaterialCost).toFixed(2)),
            notes: `Auto-assembled on product creation`,
          },
        });
      }
    }

    await maybeFlagNegativeStock(product.id, Number(product.currentStock), tx);

    return getProductByIdInternal(product.id, tx);
  }, {
    timeout: 30000
  });
};

const updateProduct = async (id: string, data: UpdateProductInput) => {
  const { bomItems, removeImage, categoryIds, vendorIds, ...productData } = data;

  const existing = await prisma.product.findUnique({
    where: { id },
    include: { bomAsParent: { include: { childProduct: true } } },
  });
  if (!existing) throw ApiError.notFound('Product not found');

  if (productData.sku && productData.sku !== existing.sku) {
    const dupe = await prisma.product.findUnique({ where: { sku: productData.sku } });
    if (dupe) throw ApiError.conflict('A product with this SKU already exists', 'DUPLICATE_SKU');
  }

  const oldStock = Number(existing.currentStock);
  const newStock = productData.currentStock !== undefined ? productData.currentStock : oldStock;
  const delta = newStock - oldStock;

  return prisma.$transaction(async (tx) => {
    // 1. Sync BOM config if explicitly passed
    let activeBOM = existing.bomAsParent.map((b) => ({
      childProductId: b.childProductId,
      quantityRequired: Number(b.quantityRequired),
      childProduct: b.childProduct,
    }));

    if (bomItems !== undefined) {
      if (bomItems.length > 0) {
        const childIds = bomItems.map((i) => i.childProductId);

        if (childIds.includes(id)) {
          throw ApiError.badRequest('A product cannot be a component of itself', 'CIRCULAR_BOM');
        }

        const uniqueChildIds = new Set(childIds);
        if (uniqueChildIds.size !== childIds.length) {
          throw ApiError.badRequest('Duplicate component entries are not allowed', 'DUPLICATE_BOM_ENTRY');
        }

        const children = await tx.product.findMany({ where: { id: { in: childIds } } });
        if (children.length !== childIds.length) {
          throw ApiError.badRequest('One or more component product IDs do not exist', 'INVALID_BOM_CHILD');
        }

        // Circular reference check
        if (await detectCircularBOM(id, childIds, tx)) {
          throw ApiError.badRequest('Adding these components would create a circular reference', 'CIRCULAR_BOM');
        }

        // Replace BOM
        await tx.productBOM.deleteMany({ where: { parentProductId: id } });
        await tx.productBOM.createMany({
          data: bomItems.map((item) => ({
            parentProductId: id,
            childProductId: item.childProductId,
            quantityRequired: item.quantityRequired,
          })),
        });

        activeBOM = bomItems.map((item) => {
          const childProduct = children.find((c) => c.id === item.childProductId);
          return {
            childProductId: item.childProductId,
            quantityRequired: item.quantityRequired,
            childProduct: childProduct!,
          };
        });
        productData.isComposite = true;
      } else {
        // Empty bomItems = remove all components
        await tx.productBOM.deleteMany({ where: { parentProductId: id } });
        productData.isComposite = false;
        activeBOM = [];
      }
    }

    const isCurrentlyComposite = productData.isComposite !== undefined ? productData.isComposite : existing.isComposite;

    // 2. Perform delta stock deductions/returns for compound products
    if (isCurrentlyComposite && activeBOM.length > 0 && delta !== 0) {
      if (delta > 0) {
        // Assembly delta: deduct component stocks
        let calculatedMaterialCost = 0;
        for (const item of activeBOM) {
          const requiredQty = item.quantityRequired * delta;
          const availStock = Number(item.childProduct.currentStock);

          if (availStock < requiredQty) {
            throw ApiError.badRequest(
              `Insufficient stock for component product "${item.childProduct.name}". Required: ${requiredQty}, Available: ${availStock}`,
              'INSUFFICIENT_STOCK',
              {
                productId: item.childProductId,
                componentName: item.childProduct.name,
                required: requiredQty,
                available: availStock,
              }
            );
          }

          const unitCost = Number(item.childProduct.unitPrice);
          calculatedMaterialCost += item.quantityRequired * unitCost;

          // Record Consumption movement for component
          await tx.stockMovement.create({
            data: {
              productId: item.childProductId,
              type: 'CONSUMPTION',
              quantity: -requiredQty,
              unitCost,
              totalCost: Number((requiredQty * unitCost).toFixed(2)),
              notes: `Auto-assembly on update of parent: ${existing.name} (Delta Qty: +${delta})`,
            },
          });

          // Deduct component stock
          const updatedComponent = await tx.product.update({
            where: { id: item.childProductId },
            data: { currentStock: { decrement: requiredQty } },
          });
          await maybeFlagNegativeStock(item.childProductId, Number(updatedComponent.currentStock), tx);
        }

        // Record Assembly movement for parent
        await tx.stockMovement.create({
          data: {
            productId: id,
            type: 'ASSEMBLY',
            quantity: delta,
            unitCost: calculatedMaterialCost,
            totalCost: Number((delta * calculatedMaterialCost).toFixed(2)),
            notes: `Auto-assembled on product update`,
          },
        });
      } else {
        // Disassembly delta (delta is negative): return component stock
        const disassembleQty = Math.abs(delta);
        let calculatedMaterialCost = 0;

        for (const item of activeBOM) {
          const returnQty = item.quantityRequired * disassembleQty;
          const unitCost = Number(item.childProduct.unitPrice);
          calculatedMaterialCost += item.quantityRequired * unitCost;

          // Record Return/Adjustment movement for component
          await tx.stockMovement.create({
            data: {
              productId: item.childProductId,
              type: 'RETURN',
              quantity: returnQty,
              unitCost,
              totalCost: Number((returnQty * unitCost).toFixed(2)),
              notes: `Disassembly on update of parent: ${existing.name} (Delta Qty: -${disassembleQty})`,
            },
          });

          // Increment component stock
          const updatedComponent = await tx.product.update({
            where: { id: item.childProductId },
            data: { currentStock: { increment: returnQty } },
          });
          await maybeFlagNegativeStock(item.childProductId, Number(updatedComponent.currentStock), tx);
        }

        // Record negative Adjustment movement for parent
        await tx.stockMovement.create({
          data: {
            productId: id,
            type: 'ADJUSTMENT',
            quantity: delta, // negative
            unitCost: calculatedMaterialCost,
            totalCost: Number((delta * calculatedMaterialCost).toFixed(2)),
            notes: `Disassembled on product update`,
          },
        });
      }
    }

    const updatePayload: any = { ...productData };
    if (categoryIds !== undefined) {
      updatePayload.categories = { set: categoryIds.map((cid) => ({ id: cid })) };
    }
    if (vendorIds !== undefined) {
      updatePayload.vendors = { set: vendorIds.map((vid) => ({ id: vid })) };
    }

    const updated = await tx.product.update({ where: { id }, data: updatePayload });
    await maybeFlagNegativeStock(updated.id, Number(updated.currentStock), tx);

    return getProductByIdInternal(updated.id, tx);
  }, {
    timeout: 30000
  });
};

/** Hard-delete: physically remove the product and its dependent relations from the database. */
const deleteProduct = async (id: string) => {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Product not found');

  // Delete image from storage provider if exists
  if (existing.imageStorageId) {
    await storageProvider.deleteFile(existing.imageStorageId);
  }

  // Delete all dependencies and the product itself atomically in a transaction
  return prisma.$transaction(async (tx) => {
    // 1. Delete ProductBOM rows (parent or child relations)
    await tx.productBOM.deleteMany({
      where: {
        OR: [
          { parentProductId: id },
          { childProductId: id }
        ]
      }
    });

    // 2. Delete StockMovement rows
    await tx.stockMovement.deleteMany({ where: { productId: id } });

    // 3. Delete TaskRequiredProduct rows
    await tx.taskRequiredProduct.deleteMany({ where: { productId: id } });

    // 4. Delete ProductRequest rows
    await tx.productRequest.deleteMany({ where: { productId: id } });

    // 5. Delete the Product itself
    return tx.product.delete({ where: { id } });
  }, {
    timeout: 30000
  });
};

/**
 * Internal helper to load a product with enriched BOM summary and suggested cost calculation.
 */
const getProductByIdInternal = async (id: string, db: DbClient = prisma) => {
  const product = await db.product.findUnique({
    where: { id },
    include: {
      vendor: true,
      category: true,
      vendors: true,
      categories: true,
      bomAsParent: {
        include: {
          childProduct: {
            select: { id: true, name: true, sku: true, unitPrice: true, currentStock: true },
          },
        },
      },
    },
  });
  if (!product) throw ApiError.notFound('Product not found');

  const bomSummary = product.bomAsParent.map((entry) => ({
    childProductId: entry.childProductId,
    name: entry.childProduct.name,
    sku: entry.childProduct.sku,
    quantityRequired: Number(entry.quantityRequired),
    unitPrice: Number(entry.childProduct.unitPrice),
    currentStock: Number(entry.childProduct.currentStock),
  }));

  // Suggested cost = sum of child.unitPrice * quantityRequired (non-recursive, child's own set price)
  const suggestedCost = bomSummary.reduce((sum, item) => sum + item.unitPrice * item.quantityRequired, 0);
  const adminUnitPrice = Number(product.unitPrice);

  const priceWarning = (suggestedCost > 0 && suggestedCost >= adminUnitPrice)
    ? 'The final price is equal to or lower than the suggested cost. Please review.'
    : null;

  return {
    ...product,
    bomSummary,
    materialCost: suggestedCost,
    suggestedCost,
    priceWarning,
  };
};

const getProductById = async (id: string) => getProductByIdInternal(id);

const getManyProduct = async (query: ProductSearchQueryInput) => {
  const { skip, take, showPerPage } = buildPagination(query);

  const where: Record<string, unknown> = {
    ...(query.search && {
      OR: [
        { name: { contains: query.search, mode: 'insensitive' as const } },
        { sku: { contains: query.search, mode: 'insensitive' as const } },
      ],
    }),
    ...(query.itemType && { itemType: query.itemType }),
    ...(query.isDiscontinued !== undefined && { isDiscontinued: query.isDiscontinued }),
    ...(query.isComposite !== undefined && { isComposite: query.isComposite }),
    ...(query.categoryId && {
      OR: [
        { categoryId: query.categoryId },
        { categories: { some: { id: query.categoryId } } },
      ],
    }),
    ...(query.category && {
      OR: [
        { categoryId: query.category },
        { categories: { some: { id: query.category } } },
        { categories: { some: { name: { contains: query.category, mode: 'insensitive' as const } } } },
      ],
    }),
    ...(query.vendorId && {
      OR: [
        { vendorId: query.vendorId },
        { vendors: { some: { id: query.vendorId } } },
      ],
    }),
  };

  if (query.lowStock) {
    (where as { currentStock?: unknown }).currentStock = { lt: 0 };
  }

  const [totalData, products] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      skip,
      take,
      include: {
        vendor: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        vendors: { select: { id: true, name: true } },
        categories: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    }),
  ]);

  return { products, totalData, totalPages: totalPagesOf(totalData, showPerPage) };
};

/** GET /products/low-stock — products below threshold or currently negative. */
const getLowStockProducts = async () => {
  const [products, all] = await Promise.all([
    prisma.product.findMany({
      where: {
        isDiscontinued: false,
        OR: [{ currentStock: { lt: 0 } }],
      },
      include: { vendor: { select: { id: true, name: true } } },
    }),
    prisma.product.findMany({
      where: { isDiscontinued: false, lowStockThreshold: { not: null } },
      include: { vendor: { select: { id: true, name: true } } },
    })
  ]);
  const belowThreshold = all.filter((p) => Number(p.currentStock) <= Number(p.lowStockThreshold));

  const merged = new Map(products.map((p) => [p.id, p]));
  for (const p of belowThreshold) merged.set(p.id, p);

  return Array.from(merged.values()).map((p) => ({
    ...p,
    daysNegative: p.negativeSince ? Math.floor((Date.now() - new Date(p.negativeSince).getTime()) / 86_400_000) : 0,
  }));
};

const getProductBOM = async (id: string) => getBOMTree(id);

/** Replaces the entire BOM for a composite product in a single transaction. */
const replaceProductBOM = async (id: string, data: ReplaceBOMInput) => {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw ApiError.notFound('Product not found');

  if (product.itemType === 'COMPONENT') {
    throw ApiError.badRequest('Components cannot have a Bill of Materials. Only PRODUCTS can act as BOM parents.', 'INVALID_BOM_PARENT');
  }

  // Validate non-zero positive quantity and intelligently merge duplicate child items
  const mergedMap = new Map<string, number>();
  for (const item of data.items) {
    if (item.quantityRequired <= 0) {
      throw ApiError.badRequest('BOM quantity must be greater than zero', 'INVALID_BOM_QUANTITY');
    }
    const currentQty = mergedMap.get(item.childProductId) || 0;
    mergedMap.set(item.childProductId, currentQty + item.quantityRequired);
  }

  const mergedItems = Array.from(mergedMap.entries()).map(([childProductId, quantityRequired]) => ({
    childProductId,
    quantityRequired,
  }));

  const childIds = mergedItems.map((i) => i.childProductId);
  if (childIds.includes(id)) {
    throw ApiError.badRequest('A product cannot be a component of itself', 'CIRCULAR_BOM');
  }

  const children = await prisma.product.findMany({ where: { id: { in: childIds } } });
  if (children.length !== childIds.length) {
    throw ApiError.badRequest('One or more component products do not exist', 'INVALID_BOM_CHILD');
  }

  const discontinuedChild = children.find((c) => c.isDiscontinued);
  if (discontinuedChild) {
    throw ApiError.badRequest(`Component product "${discontinuedChild.name}" is inactive/discontinued`, 'INACTIVE_BOM_CHILD');
  }

  // Circular reference check
  if (await detectCircularBOM(id, childIds)) {
    throw ApiError.badRequest('Adding these components would create a circular reference', 'CIRCULAR_BOM');
  }

  await prisma.$transaction([
    prisma.productBOM.deleteMany({ where: { parentProductId: id } }),
    prisma.productBOM.createMany({
      data: mergedItems.map((item) => ({
        parentProductId: id,
        childProductId: item.childProductId,
        quantityRequired: item.quantityRequired,
      })),
    }),
    prisma.product.update({ where: { id }, data: { isComposite: mergedItems.length > 0 } }),
  ]);

  return getBOMTree(id);
};

const addOrUpdateCustomField = async (id: string, data: CustomFieldInput) => {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw ApiError.notFound('Product not found');

  const customFields = { ...(product.customFields as Record<string, unknown>), [data.key]: data.value };
  return prisma.product.update({ where: { id }, data: { customFields: customFields as Prisma.InputJsonObject } });
};

const removeCustomField = async (id: string, key: string) => {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw ApiError.notFound('Product not found');

  const customFields = { ...(product.customFields as Record<string, unknown>) };
  delete customFields[key];
  return prisma.product.update({ where: { id }, data: { customFields: customFields as Prisma.InputJsonObject } });
};

/**
 * Tracks how long a product has been in negative stock, enforcing the
 * `negative_stock_max_days` system config.
 */
export const maybeFlagNegativeStock = async (productId: string, newStock: number, db: DbClient = prisma) => {
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) return product;

  if (newStock < 0 && !product.negativeSince) {
    const maxDays = Number((await getConfigValue('negative_stock_max_days')) ?? 7);
    const negativeStockAllowedUntil = new Date(Date.now() + maxDays * 86_400_000);
    return db.product.update({ where: { id: productId }, data: { negativeSince: new Date(), negativeStockAllowedUntil } });
  }

  if (newStock >= 0 && product.negativeSince) {
    return db.product.update({ where: { id: productId }, data: { negativeSince: null, negativeStockAllowedUntil: null } });
  }

  return product;
};

export const checkAndNotifyLowStock = async (productId: string) => {
  const item = await prisma.product.findUnique({ where: { id: productId } });
  if (item && item.lowStockThreshold !== null && item.lowStockThreshold !== undefined) {
    const stock = Number(item.currentStock || 0);
    const threshold = Number(item.lowStockThreshold);
    if (stock < threshold) {
      const todayStr = new Date().toISOString().split('T')[0];
      await notificationServices.notifyAdmins(
        'Low Stock Alert',
        `Component "${item.name}" has fallen below its minimum stock level (Current: ${stock}, Threshold: ${threshold}).`,
        `/inventory/items/${item.id}`,
        `LOW_STOCK:${item.id}:${todayStr}`
      );
    }
  }
};

export const productServices = {
  createProduct,
  updateProduct,
  deleteProduct,
  getProductById,
  getManyProduct,
  getLowStockProducts: async () => {
    const products = await getLowStockProducts();
    for (const item of products) {
      await checkAndNotifyLowStock(item.id);
    }
    return products;
  },
  getProductBOM,
  replaceProductBOM,
  addOrUpdateCustomField,
  removeCustomField,
  checkAndNotifyLowStock,
};
