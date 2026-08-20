import prisma from '../src/utils/prisma/prisma-client';
import { inventoryService } from '../src/modules/inventory/inventory.service';
import { productServices } from '../src/modules/products/products.service';
import bcrypt from 'bcryptjs';

async function runPhase2Tests() {
  console.log('🧪 Starting Backend Phase 2 Test Suite...\n');

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
    // 0. Setup test users (Admin & Employee)
    const adminEmail = `test.admin.${Date.now()}@example.com`;
    const employeeEmail = `test.employee.${Date.now()}@example.com`;
    const passwordHash = await bcrypt.hash('password123', 10);

    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        password: passwordHash,
        role: 'ADMIN',
        name: 'Test Admin',
      },
    });

    const employee = await prisma.user.create({
      data: {
        email: employeeEmail,
        password: passwordHash,
        role: 'EMPLOYEE',
        name: 'Test Employee',
      },
    });

    // 1. Create Categories & Vendors
    const cat1 = await prisma.category.create({ data: { name: `Electronics-${Date.now()}` } });
    const cat2 = await prisma.category.create({ data: { name: `Battery-${Date.now()}` } });
    const vendor1 = await prisma.vendor.create({ data: { name: `Vendor A-${Date.now()}` } });
    const vendor2 = await prisma.vendor.create({ data: { name: `Vendor B-${Date.now()}` } });

    // 2. Component Creation
    const compBMS = await productServices.createProduct({
      name: 'BMS Board',
      sku: `SKU-BMS-${Date.now()}`,
      itemType: 'COMPONENT',
      unit: 'Piece',
      unitPrice: 100,
      currentStock: 50,
      categoryIds: [cat1.id],
      vendorIds: [vendor1.id],
      remarks: 'Circuit protection board',
    });

    assert(compBMS.itemType === 'COMPONENT', 'Component created with itemType = COMPONENT');
    assert(Number(compBMS.unitPrice) === 100, 'Component unit price set to 100');

    const compBattery = await productServices.createProduct({
      name: 'Li-Ion Cell',
      sku: `SKU-BAT-${Date.now()}`,
      itemType: 'COMPONENT',
      unit: 'Piece',
      unitPrice: 400,
      currentStock: 100,
      categoryIds: [cat1.id, cat2.id],
      vendorIds: [vendor1.id, vendor2.id],
      remarks: '3.7V 3000mAh',
    });

    assert(compBattery.categories.length === 2, 'Component assigned to multiple categories');
    assert(compBattery.vendors.length === 2, 'Component assigned to multiple vendors');

    // 3. SKU Uniqueness Test
    try {
      await productServices.createProduct({
        name: 'Duplicate SKU Item',
        sku: compBMS.sku!,
        unitPrice: 50,
      });
      assert(false, 'SKU uniqueness enforcement');
    } catch (err: any) {
      assert(err.message.includes('SKU already exists'), 'SKU uniqueness enforcement');
    }

    // 4. Product Creation with BOM & Cost Suggestion
    const powerBank = await productServices.createProduct({
      name: '10000mAh Power Bank',
      sku: `SKU-PB-${Date.now()}`,
      itemType: 'PRODUCT',
      unit: 'Piece',
      unitPrice: 1500, // Admin price set to 1500
      currentStock: 0,
      isComposite: true,
      bomItems: [
        { childProductId: compBMS.id, quantityRequired: 1 },       // 1 * 100 = 100
        { childProductId: compBattery.id, quantityRequired: 3 },   // 3 * 400 = 1200
      ], // Suggested cost = 1300
    });

    assert(powerBank.suggestedCost === 1300, 'Suggested cost calculated as sum of child set prices (1300)');
    assert(powerBank.priceWarning === null, 'No price warning when admin price (1500) > suggested cost (1300)');

    // 5. Price Review Warning Test (Admin sets price equal or lower than suggested cost)
    const lowPricePB = await productServices.updateProduct(powerBank.id, {
      unitPrice: 1250, // 1250 < 1300
    });

    assert(
      lowPricePB.priceWarning !== null && lowPricePB.priceWarning.includes('equal to or lower than'),
      'Price Review Warning generated when admin set price (1250) <= suggested cost (1300)'
    );

    // 6. Stock Addition & Automatic Batch Creation
    const addStockRes = await inventoryService.addStock({
      productId: powerBank.id,
      quantity: 20,
      unitCost: 1300,
      notes: 'Initial production batch received',
      userId: admin.id,
    });

    assert(addStockRes.batch.batchNumber.startsWith('BATCH-'), 'Batch number automatically generated format BATCH-YYYY-MM-XXX');
    assert(Number(addStockRes.product.currentStock) === 20, 'Product current stock increased to 20');
    assert(Number(addStockRes.batch.remainingQuantity) === 20, 'Batch remaining quantity set to 20');

    // 7. Manual Stock Adjustment & Accountability Audit Log
    const adjustRes = await inventoryService.adjustStock({
      productId: powerBank.id,
      quantityDifference: -5,
      batchId: addStockRes.batch.id,
      reason: '5 damaged units removed during QA inspection',
      userId: admin.id,
    });

    assert(Number(adjustRes.product.currentStock) === 15, 'Product current stock decreased to 15 after damage removal');
    assert(adjustRes.movement?.reason === '5 damaged units removed during QA inspection', 'Audit log records exact administrative reason');
    assert(Number(adjustRes.movement?.previousQuantity) === 20, 'Audit log records previous quantity (20)');
    assert(Number(adjustRes.movement?.newQuantity) === 15, 'Audit log records new quantity (15)');

    // 8. Negative Stock Rejection
    try {
      await inventoryService.adjustStock({
        productId: powerBank.id,
        quantityDifference: -100,
        reason: 'Attempt excessive reduction',
        userId: admin.id,
      });
      assert(false, 'Negative inventory attempt rejected');
    } catch (err: any) {
      assert(err.message.includes('cannot be negative'), 'Negative inventory attempt rejected with clear error');
    }

    // 9. Circular BOM Prevention
    try {
      await productServices.replaceProductBOM(compBMS.id, {
        items: [{ childProductId: powerBank.id, quantityRequired: 1 }], // BMS -> PowerBank (already PowerBank -> BMS)
      });
      assert(false, 'Circular BOM prevention');
    } catch (err: any) {
      assert(
        err.message.includes('circular reference') ||
        err.message.includes('component of itself') ||
        err.message.includes('Components cannot have a Bill of Materials'),
        'Circular BOM prevention'
      );
    }

    // 10. Clean up test records
    await prisma.stockMovement.deleteMany({ where: { productId: { in: [compBMS.id, compBattery.id, powerBank.id] } } });
    await prisma.inventoryBatch.deleteMany({ where: { productId: { in: [compBMS.id, compBattery.id, powerBank.id] } } });
    await prisma.productBOM.deleteMany({ where: { parentProductId: { in: [compBMS.id, compBattery.id, powerBank.id] } } });
    await prisma.product.deleteMany({ where: { id: { in: [compBMS.id, compBattery.id, powerBank.id] } } });
    await prisma.category.deleteMany({ where: { id: { in: [cat1.id, cat2.id] } } });
    await prisma.vendor.deleteMany({ where: { id: { in: [vendor1.id, vendor2.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, employee.id] } } });

    console.log(`\n📊 Test Results: ${passed} Passed, ${failed} Failed`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('💥 Test suite crashed:', error);
    process.exit(1);
  }
}

runPhase2Tests();
