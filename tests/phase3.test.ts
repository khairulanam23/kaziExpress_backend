import prisma from '../src/utils/prisma/prisma-client';
import { productServices } from '../src/modules/products/products.service';
import { productCostService } from '../src/modules/products/product-cost.service';
import bcrypt from 'bcryptjs';

async function runPhase3Tests() {
  console.log('🧪 Starting Backend Phase 3 Test Suite...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASSED: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  try {
    // Setup test users
    const adminEmail = `phase3.admin.${Date.now()}@example.com`;
    const employeeEmail = `phase3.employee.${Date.now()}@example.com`;
    const passwordHash = await bcrypt.hash('password123', 10);

    const admin = await prisma.user.create({
      data: { email: adminEmail, password: passwordHash, role: 'ADMIN', name: 'Phase3 Admin' },
    });

    const employee = await prisma.user.create({
      data: { email: employeeEmail, password: passwordHash, role: 'EMPLOYEE', name: 'Phase3 Employee' },
    });

    // Setup Test Items
    const compA = await productServices.createProduct({
      name: 'Component A (Screw)',
      sku: `SKU-C1-${Date.now()}`,
      itemType: 'COMPONENT',
      unit: 'Piece',
      unitPrice: 12.75,
      currentStock: 100,
    });

    const compB = await productServices.createProduct({
      name: 'Component B (Wire)',
      sku: `SKU-C2-${Date.now()}`,
      itemType: 'COMPONENT',
      unit: 'Meter',
      unitPrice: 50.50,
      currentStock: 200,
    });

    // 1. Basic BOM: Product can have BOM & Component can be BOM child
    const productSub = await productServices.createProduct({
      name: 'Sub-Assembly Product B',
      sku: `SKU-PB-${Date.now()}`,
      itemType: 'PRODUCT',
      unit: 'Set',
      unitPrice: 500.00, // Admin set final price = 500
      currentStock: 10,
      isComposite: true,
      bomItems: [
        { childProductId: compA.id, quantityRequired: 4 }, // 4 * 12.75 = 51.00
        { childProductId: compB.id, quantityRequired: 1.5 }, // 1.5 * 50.50 = 75.75
      ],
    });

    assert(productSub.bomSummary.length === 2, 'Product can have BOM with Component children');

    // 2. Product can be BOM child of another Product
    const productMain = await productServices.createProduct({
      name: 'Main Product A',
      sku: `SKU-PA-${Date.now()}`,
      itemType: 'PRODUCT',
      unit: 'Unit',
      unitPrice: 1500.00, // Admin set price = 1500
      currentStock: 5,
      isComposite: true,
      bomItems: [
        { childProductId: productSub.id, quantityRequired: 2 }, // Product child: 2 * 500 = 1000
        { childProductId: compA.id, quantityRequired: 10 },    // Component child: 10 * 12.75 = 127.50
      ],
    });

    assert(productMain.bomSummary.length === 2, 'Product can contain another Product in its BOM');

    // 3. Component CANNOT be a BOM parent
    try {
      await productServices.replaceProductBOM(compA.id, {
        items: [{ childProductId: compB.id, quantityRequired: 1 }],
      });
      assert(false, 'Component cannot be BOM parent');
    } catch (err: any) {
      assert(err.message.includes('Components cannot have a Bill of Materials'), 'Component cannot be BOM parent');
    }

    // 4. Product cannot contain itself (Self-reference protection)
    try {
      await productServices.replaceProductBOM(productMain.id, {
        items: [{ childProductId: productMain.id, quantityRequired: 1 }],
      });
      assert(false, 'Product cannot contain itself');
    } catch (err: any) {
      assert(err.message.includes('component of itself'), 'Product cannot contain itself');
    }

    // 5. Multi-tier Circular BOM protection (Main A -> Sub B -> Main A)
    try {
      await productServices.replaceProductBOM(productSub.id, {
        items: [{ childProductId: productMain.id, quantityRequired: 1 }],
      });
      assert(false, 'Circular BOM is rejected');
    } catch (err: any) {
      assert(err.message.includes('circular reference'), 'Circular BOM is rejected');
    }

    // 6. Duplicate BOM items intelligently merged
    const mergedBOM = await productServices.replaceProductBOM(productMain.id, {
      items: [
        { childProductId: compA.id, quantityRequired: 3 },
        { childProductId: compA.id, quantityRequired: 2 }, // Duplicate compA entry
      ],
    });

    assert(
      mergedBOM.children.length === 1 && mergedBOM.children[0].quantityRequired === 5,
      'Duplicate BOM items merged cleanly (3 + 2 = 5)'
    );

    // 7. Zero quantity rejected
    try {
      await productServices.replaceProductBOM(productMain.id, {
        items: [{ childProductId: compA.id, quantityRequired: 0 }],
      });
      assert(false, 'Zero BOM quantity rejected');
    } catch (err: any) {
      assert(err.message.includes('greater than zero'), 'Zero BOM quantity rejected');
    }

    // 8. Negative quantity rejected
    try {
      await productServices.replaceProductBOM(productMain.id, {
        items: [{ childProductId: compA.id, quantityRequired: -2 }],
      });
      assert(false, 'Negative BOM quantity rejected');
    } catch (err: any) {
      assert(err.message.includes('greater than zero'), 'Negative BOM quantity rejected');
    }

    // 9. Costing: Product child uses its OWN set final price (500), NOT recursive BOM calculation
    // Reset productMain BOM: 2 * ProductSub (500) + 1.5 * CompB (50.50) = 1000 + 75.75 = 1075.75
    await productServices.replaceProductBOM(productMain.id, {
      items: [
        { childProductId: productSub.id, quantityRequired: 2 },
        { childProductId: compB.id, quantityRequired: 1.5 },
      ],
    });

    const costRes = await productCostService.calculateProductCost(productMain.id);

    assert(costRes.suggestedCost === 1075.75, 'Suggested cost uses child product set price non-recursively (1075.75)');
    assert(costRes.breakdown.length === 2, 'Cost breakdown contains 2 items');

    const subEntry = costRes.breakdown.find((b) => b.itemId === productSub.id);
    assert(subEntry !== undefined && subEntry.unitPrice === 500 && subEntry.total === 1000, 'Product child entry uses set unit price (500 * 2 = 1000)');

    // 10. Decimal precision & prices check
    assert(costRes.suggestedCost === 1075.75, 'Decimal precision preserved for 1.5 * 50.50 (75.75)');

    // 11. Price Review Warning activates when suggested >= final
    await prisma.product.update({
      where: { id: productMain.id },
      data: { unitPrice: 1000.00 }, // 1000 <= 1075.75
    });

    const costWarnRes = await productCostService.calculateProductCost(productMain.id);
    assert(costWarnRes.priceWarning === true, 'Price warning true when suggested cost (1075.75) >= admin final price (1000)');

    // 12. Warning does not block saving (Admin can save price)
    const savedLowPrice = await productServices.updateProduct(productMain.id, { unitPrice: 900.00 });
    assert(Number(savedLowPrice.unitPrice) === 900.00 && savedLowPrice.priceWarning !== null, 'Admin can save low price despite warning');

    // 13. Price warning false when admin final price > suggested cost
    await productServices.updateProduct(productMain.id, { unitPrice: 1500.00 }); // 1500 > 1075.75
    const costOkRes = await productCostService.calculateProductCost(productMain.id);
    assert(costOkRes.priceWarning === false, 'Price warning false when admin price (1500) > suggested cost (1075.75)');

    // 14. Product with NO BOM is valid (suggested cost = 0, breakdown = [])
    const noBOMProd = await productServices.createProduct({
      name: 'Standalone Product',
      sku: `SKU-NOBOM-${Date.now()}`,
      itemType: 'PRODUCT',
      unit: 'Piece',
      unitPrice: 200,
    });

    const noBOMCost = await productCostService.calculateProductCost(noBOMProd.id);
    assert(noBOMCost.suggestedCost === 0 && noBOMCost.breakdown.length === 0, 'Product without BOM has suggestedCost = 0');

    // 15. Changing BOM does NOT alter inventory stocks or create stock movements
    const compABefore = await prisma.product.findUnique({ where: { id: compA.id } });
    const stockCompABefore = Number(compABefore?.currentStock);
    await productServices.replaceProductBOM(productMain.id, {
      items: [{ childProductId: compA.id, quantityRequired: 10 }],
    });
    const compAFresh = await prisma.product.findUnique({ where: { id: compA.id } });
    assert(Number(compAFresh?.currentStock) === stockCompABefore, 'BOM replacement leaves inventory stocks completely untouched');

    // Cleanup test data
    const testProductIds = [compA.id, compB.id, productSub.id, productMain.id, noBOMProd.id];
    await prisma.stockMovement.deleteMany({ where: { productId: { in: testProductIds } } });
    await prisma.inventoryBatch.deleteMany({ where: { productId: { in: testProductIds } } });
    await prisma.productBOM.deleteMany({ where: { OR: [{ parentProductId: { in: testProductIds } }, { childProductId: { in: testProductIds } }] } });
    await prisma.product.deleteMany({ where: { id: { in: testProductIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, employee.id] } } });

    console.log(`\n📊 Phase 3 Test Results: ${passed} Passed, ${failed} Failed`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('💥 Phase 3 test suite crashed:', err);
    process.exit(1);
  }
}

runPhase3Tests();
