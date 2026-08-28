import assert from 'assert';
import fs from 'fs';
import path from 'path';
import prisma from '../src/utils/prisma/prisma-client';
import { analyticsServices } from '../src/modules/reports/reports.analytics.service';
import { traceServices } from '../src/modules/inventory/inventory.trace.service';
import { inventoryService } from '../src/modules/inventory/inventory.service';

/**
 * P1 roadmap items: the analytical reports and batch genealogy.
 *
 * Each report is exercised against purpose-built data with a known answer, so a
 * regression shows up as a wrong number rather than as a report that still
 * renders.
 */
async function runPhase15Tests() {
  console.log('🧪 Starting Backend Phase 15 Test Suite (Roadmap P1 — Analytics & Traceability)...\n');

  let passed = 0;
  const testPass = (name: string) => {
    console.log(`  ✅ PASSED: ${name}`);
    passed++;
  };

  const stamp = Date.now();
  const created = { users: [] as string[], products: [] as string[], vendors: [] as string[], tasks: [] as string[] };
  const today = new Date();
  const daysAgo = (n: number) => new Date(today.getTime() - n * 24 * 60 * 60 * 1000);

  try {
    // ── Fixtures ─────────────────────────────────────────────────────────────
    const vendor = await prisma.vendor.create({ data: { name: `P15 Vendor ${stamp}` } });
    created.vendors.push(vendor.id);

    const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });

    const component = await prisma.product.create({
      data: { name: `P15 Component ${stamp}`, sku: `P15C-${stamp}`, unitPrice: 100, currentStock: 0, unit: 'pcs', itemType: 'COMPONENT', lowStockThreshold: 50, reorderTimeDays: 14, vendorId: vendor.id },
    });
    const composite = await prisma.product.create({
      data: { name: `P15 Composite ${stamp}`, sku: `P15P-${stamp}`, unitPrice: 900, currentStock: 0, unit: 'pcs', itemType: 'PRODUCT', isComposite: true },
    });
    created.products.push(component.id, composite.id);

    // ── Item 13: a purchase records who supplied it ──────────────────────────
    const added = await inventoryService.addStock({ productId: component.id, quantity: 100, unitCost: 100, userId: admin.id });
    const purchaseMovement = await prisma.stockMovement.findFirstOrThrow({ where: { batchId: added.batch.id, type: 'PURCHASE' } });
    assert.strictEqual(purchaseMovement.vendorId, vendor.id, 'purchase inherited the product vendor');

    const explicit = await inventoryService.addStock({ productId: component.id, quantity: 50, unitCost: 130, userId: admin.id, vendorId: vendor.id });
    const explicitMovement = await prisma.stockMovement.findFirstOrThrow({ where: { batchId: explicit.batch.id, type: 'PURCHASE' } });
    assert.strictEqual(explicitMovement.vendorId, vendor.id, 'an explicit vendor is recorded');

    let rejected = false;
    try {
      await inventoryService.addStock({ productId: component.id, quantity: 1, userId: admin.id, vendorId: '00000000-0000-0000-0000-000000000000' });
    } catch { rejected = true; }
    assert(rejected, 'an unknown vendor is rejected rather than silently stored');
    testPass('Purchases record their supplier, explicitly or from the product');

    // ── Item 13: price drift is detected ─────────────────────────────────────
    const vendorReport = await analyticsServices.getVendorPerformanceReport({ vendorId: vendor.id });
    const vendorRow = vendorReport.vendors.find((v) => v.vendorId === vendor.id);
    assert(vendorRow, 'the vendor appears in its own report');
    const line = vendorRow!.products.find((p) => p.productId === component.id);
    assert(line, 'the supplied product appears');
    assert.strictEqual(line!.firstUnitCost, 100, 'first delivery price retained');
    assert.strictEqual(line!.lastUnitCost, 130, 'latest delivery price retained');
    assert.strictEqual(line!.priceDriftPercent, 30, '100 -> 130 is a 30% rise');
    assert(vendorRow!.productsWithRisingPrice >= 1, 'the rise is counted');
    testPass('Vendor report detects a 30% price rise across two deliveries');

    // ── Item 11: valuation uses batch cost, not list price ──────────────────
    const valuation = await analyticsServices.getValuationReport();
    const valued = valuation.items.find((i) => i.productId === component.id);
    assert(valued, 'the product is valued');
    // 100 @ 100 + 50 @ 130 = 16,500 at cost; 150 @ list 100 = 15,000.
    assert.strictEqual(valued!.actualValue, 16500, `valued at acquisition cost (got ${valued!.actualValue})`);
    assert.strictEqual(valued!.listValue, 15000, 'list valuation reported alongside');
    assert.strictEqual(valued!.variance, 1500, 'the gap between the two is the finding');
    testPass('Valuation prices each batch at what it actually cost, not the list price');

    // ── Item 4: waste is costed and attributed ───────────────────────────────
    const task = await prisma.task.create({
      data: {
        title: `P15 Run ${stamp}`, productId: composite.id, productionQuantity: 10, completedQuantity: 10,
        remainingQuantity: 0, status: 'COMPLETED', createdById: admin.id,
        startedAt: daysAgo(3), completedAt: daysAgo(1), deadline: daysAgo(0),
      },
    });
    created.tasks.push(task.id);

    await prisma.stockMovement.createMany({
      data: [
        { productId: component.id, type: 'CONSUMPTION', quantity: 40, unitCost: 100, totalCost: 4000, relatedTaskId: task.id, performedById: admin.id, createdAt: daysAgo(2) },
        { productId: component.id, type: 'DAMAGE', quantity: 5, unitCost: 100, totalCost: 500, relatedTaskId: task.id, performedById: admin.id, reason: 'Dropped', createdAt: daysAgo(2) },
        { productId: component.id, type: 'WRITE_OFF', quantity: 3, unitCost: 100, totalCost: 300, performedById: admin.id, reason: 'Corroded', createdAt: daysAgo(2) },
      ],
    });

    const waste = await analyticsServices.getWasteReport({ productId: component.id });
    assert.strictEqual(waste.summary.totalCost, 800, `damage 500 + write-off 300 (got ${waste.summary.totalCost})`);
    assert.strictEqual(waste.summary.damagedCost, 500, 'damage separated from write-off');
    assert.strictEqual(waste.summary.writtenOffCost, 300, 'write-off separated from damage');
    assert.strictEqual(waste.summary.events, 2, 'consumption is not waste');
    assert(waste.byTask.some((t) => t.taskId === task.id && t.cost === 500), 'damage is attributed to its task');
    assert(waste.byReason.some((r) => r.reason === 'Dropped'), 'the stated reason is grouped');
    const shares = waste.byProduct.reduce((s, r) => s + r.shareOfCost, 0);
    assert(Math.abs(shares - 100) < 0.5, `shares of loss total 100% (got ${shares})`);
    testPass('Waste report costs damage and write-off separately and attributes both');

    // ── Item 7: production cost uses actual consumption ─────────────────────
    const cost = await analyticsServices.getProductionCostReport({ productId: composite.id });
    const run = cost.runs.find((r) => r.taskId === task.id);
    assert(run, 'the completed run appears');
    assert.strictEqual(run!.materialCost, 4500, `consumption 4000 + damage 500 (got ${run!.materialCost})`);
    assert.strictEqual(run!.wasteCost, 500, 'waste inside the run is called out');
    assert.strictEqual(run!.producedQuantity, 10, 'units produced read from the task');
    assert(run!.costPerUnit !== null && run!.costPerUnit >= 450, 'cost per unit covers at least the material');
    testPass('Production cost reads actual consumption, not the BOM estimate');

    // A run's cost must not change with the window it is queried in.
    const wide = await analyticsServices.getProductionCostReport({ from: '2020-01-01' });
    const narrow = await analyticsServices.getProductionCostReport({ from: daysAgo(7).toISOString().slice(0, 10) });
    const wideRun = wide.runs.find((r) => r.taskId === task.id);
    const narrowRun = narrow.runs.find((r) => r.taskId === task.id);
    assert.strictEqual(wideRun?.materialCost, narrowRun?.materialCost, 'material is window-independent');
    assert.strictEqual(wideRun?.labourCost, narrowRun?.labourCost, 'labour is window-independent');
    testPass("A run's cost is the same however wide the reporting window");

    // ── Item 5: reorder distinguishes buying from building ──────────────────
    await prisma.product.update({ where: { id: component.id }, data: { currentStock: 10 } });
    const reorder = await analyticsServices.getReorderReport({ lookbackDays: 30, horizonDays: 30 });
    const compRow = reorder.items.find((i) => i.productId === component.id);
    const compositeRow = reorder.items.find((i) => i.productId === composite.id);
    assert(compRow, 'the component is reviewed');
    assert.strictEqual(compRow!.action, 'PURCHASE', 'a bought part is purchased');
    assert(compRow!.urgency === 'ORDER_NOW' || compRow!.urgency === 'CRITICAL', `stock 10 under threshold 50 is actionable (got ${compRow!.urgency})`);
    assert(compRow!.suggestedOrderQuantity > 0, 'an actionable row suggests a quantity');
    assert(compRow!.averageDailyConsumption > 0, 'consumption is measured from movements');
    assert(compositeRow, 'the composite is reviewed');
    assert.strictEqual(compositeRow!.action, 'PRODUCE', 'a built product is produced, never purchased');
    assert.strictEqual(compositeRow!.estimatedOrderCost, 0, 'a production run carries no purchase cost');
    testPass('Reorder plan tells you to buy parts and build products, never the reverse');

    // ── Item 6: batch genealogy walks both directions ───────────────────────
    const inputBatch = added.batch;
    await prisma.taskBatchAllocation.create({ data: { taskId: task.id, batchId: inputBatch.id, allocatedQuantity: 40 } });
    const outputBatch = await prisma.inventoryBatch.create({
      data: { batchNumber: `P15-OUT-${stamp}`, productId: composite.id, initialQuantity: 10, remainingQuantity: 10, createdById: admin.id, sourceTaskId: task.id },
    });

    const forward = await traceServices.getBatchTrace(inputBatch.id);
    assert.strictEqual(forward.summary.isPurchased, true, 'the input batch was bought, not built');
    assert(forward.summary.affectedBatches >= 1, 'the output batch is downstream of it');
    assert(forward.recallList.some((r) => r.batchId === outputBatch.id), 'the recall list names the finished batch');
    assert(forward.summary.stillInStock >= 1, 'stock still on the shelf is counted as recoverable');

    const backward = await traceServices.getBatchTrace(outputBatch.id);
    assert.strictEqual(backward.summary.isPurchased, false, 'the output batch was built');
    assert(backward.upstream.children.some((c) => c.batchId === inputBatch.id), 'its inputs are traceable');
    const link = backward.upstream.children.find((c) => c.batchId === inputBatch.id);
    assert.strictEqual(link?.quantityInThisLink, 40, 'the quantity consumed in that link is carried');
    testPass('Batch genealogy traces a defective input forward and a finished unit back');

    // ── Item 9: the spec matches the routes that exist ──────────────────────
    const specPath = path.join(__dirname, '..', 'src', 'docs', 'openapi.json');
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
    const operations = Object.values(spec.paths as Record<string, any>)
      .flatMap((ops) => Object.entries(ops));
    assert(operations.length > 140, `the spec documents the whole API, not a sample (got ${operations.length})`);
    assert(spec.components.schemas.ErrorResponse.properties.errors, 'the documented error envelope has an errors array');
    assert(spec.components.schemas.SuccessResponse.properties.status, 'the documented success envelope uses status, not success');
    const publicOps = operations.filter(([, op]: any) => (op.security ?? []).length === 0).map(([m]: any) => m);
    assert.strictEqual(publicOps.length, 5, `only login/register/refresh/forgot/reset are public (got ${publicOps.length})`);
    assert(spec.paths['/reports/waste']?.get, 'newly added routes are documented automatically');
    assert(spec.paths['/dashboard/overview']?.get, 'paths are relative to servers[].url, not double-prefixed');
    assert(!Object.keys(spec.paths).some((k) => k.startsWith('/api/v1')), 'no path repeats the server base URL');
    assert(spec.paths['/inventory/batches/{id}/trace']?.get, 'path parameters are converted for OpenAPI');
    testPass(`OpenAPI spec covers all ${operations.length} operations with the real envelope`);

    console.log(`\n📊 Phase 15 Test Results: ${passed} Passed, 0 Failed`);
  } catch (err: any) {
    console.error('\n💥 Phase 15 test suite crashed:', err);
    process.exitCode = 1;
  } finally {
    for (const taskId of created.tasks) {
      await prisma.taskBatchAllocation.deleteMany({ where: { taskId } }).catch(() => {});
      await prisma.stockMovement.deleteMany({ where: { relatedTaskId: taskId } }).catch(() => {});
    }
    for (const productId of created.products) {
      await prisma.stockMovement.deleteMany({ where: { productId } }).catch(() => {});
      await prisma.taskBatchAllocation.deleteMany({ where: { batch: { productId } } }).catch(() => {});
      await prisma.inventoryBatch.deleteMany({ where: { productId } }).catch(() => {});
    }
    for (const taskId of created.tasks) await prisma.task.delete({ where: { id: taskId } }).catch(() => {});
    for (const productId of created.products) await prisma.product.delete({ where: { id: productId } }).catch(() => {});
    for (const vendorId of created.vendors) await prisma.vendor.delete({ where: { id: vendorId } }).catch(() => {});
    await prisma.$disconnect().catch(() => {});
  }
}

runPhase15Tests();
