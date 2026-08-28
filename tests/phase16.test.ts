import assert from 'assert';
import prisma from '../src/utils/prisma/prisma-client';
import { batchCosting } from '../src/modules/inventory/batch-costing.service';
import { salesServices } from '../src/modules/sales/sales.service';
import { profitServices } from '../src/modules/sales/profit.service';
import { customerServices } from '../src/modules/customers/customers.service';
import { analyticsServices } from '../src/modules/reports/reports.analytics.service';

/**
 * Profit calculation: batch costing, dispositions and gross profit.
 *
 * The fixtures use round numbers so every assertion states an arithmetic fact
 * rather than a shape — a regression shows up as a wrong figure, not as a
 * report that still renders.
 */
async function runPhase16Tests() {
  console.log('🧪 Starting Backend Phase 16 Test Suite (Profit Calculation)...\n');

  let passed = 0;
  const testPass = (name: string) => {
    console.log(`  ✅ PASSED: ${name}`);
    passed++;
  };

  const stamp = Date.now();
  const made: { products: string[]; tasks: string[]; customers: string[]; users: string[] } = {
    products: [], tasks: [], customers: [], users: [],
  };

  try {
    const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });

    // ── Fixtures: a component consumed by a run that yields 10 units ────────
    const component = await prisma.product.create({
      data: { name: `P16 Component ${stamp}`, sku: `P16C-${stamp}`, unitPrice: 100, currentStock: 1000, unit: 'pcs', itemType: 'COMPONENT' },
    });
    const widget = await prisma.product.create({
      // List price 9,000 — deliberately unlike the real cost, which is what the
      // old ASSEMBLY movement wrongly recorded.
      data: { name: `P16 Widget ${stamp}`, sku: `P16W-${stamp}`, unitPrice: 9000, sellingPrice: 1000, currentStock: 0, unit: 'pcs', itemType: 'PRODUCT', isComposite: true },
    });
    made.products.push(component.id, widget.id);

    const employee = await prisma.user.create({
      data: {
        email: `p16.maker.${stamp}@test.local`, password: 'x', name: 'P16 Maker', role: 'EMPLOYEE', isActive: true,
        employeeProfile: { create: { hourlyRate: 100, payCalculationMode: 'HOURLY' } },
      },
    });
    made.users.push(employee.id);

    const started = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const task = await prisma.task.create({
      data: {
        title: `P16 Run ${stamp}`, productId: widget.id, productionQuantity: 10, completedQuantity: 10, remainingQuantity: 0,
        status: 'IN_PROGRESS', createdById: admin.id, startedAt: started,
        assignments: { create: { employeeId: employee.id } },
      },
    });
    made.tasks.push(task.id);

    // 40 units of material at 100 = 4,000 consumed by the run.
    await prisma.stockMovement.create({
      data: { productId: component.id, type: 'CONSUMPTION', quantity: 40, unitCost: 100, totalCost: 4000, relatedTaskId: task.id, performedById: admin.id },
    });

    const batch = await prisma.inventoryBatch.create({
      data: { batchNumber: `P16-${stamp}`, productId: widget.id, initialQuantity: 10, remainingQuantity: 10, createdById: admin.id, sourceTaskId: task.id },
    });
    await prisma.product.update({ where: { id: widget.id }, data: { currentStock: 10 } });

    // ── Costing: provisional, then final ────────────────────────────────────
    await prisma.$transaction((tx) => batchCosting.costManufacturedBatch(tx, batch.id, task.id, 10));
    let costed = await prisma.inventoryBatch.findUniqueOrThrow({ where: { id: batch.id } });
    assert.strictEqual(Number(costed.materialUnitCost), 400, '4,000 of material over 10 units is 400 each');
    assert.strictEqual(Number(costed.unitCost), 400, 'provisional cost is material only');
    assert.strictEqual(costed.costFinalizedAt, null, 'still provisional while the run is open');
    assert.notStrictEqual(Number(costed.unitCost), Number(widget.unitPrice), 'cost is not the list price');
    testPass('A fresh batch is costed from material actually consumed, not the list price');

    // One 8h day at 100/h = 800 of labour over 10 units = 80 each.
    await prisma.attendance.create({
      data: { employeeId: employee.id, date: new Date(Date.UTC(started.getUTCFullYear(), started.getUTCMonth(), started.getUTCDate())), checkIn: started, workedHours: 8, requiredHours: 8 },
    });
    await prisma.task.update({ where: { id: task.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    await prisma.$transaction((tx) => batchCosting.finalizeTaskCosts(tx, task.id));

    costed = await prisma.inventoryBatch.findUniqueOrThrow({ where: { id: batch.id } });
    assert.strictEqual(Number(costed.labourUnitCost), 80, '800 of labour over 10 units is 80 each');
    assert.strictEqual(Number(costed.unitCost), 480, 'final cost is material 400 + labour 80');
    assert(costed.costFinalizedAt !== null, 'the batch is marked final once the run completes');
    testPass('Completing the run apportions labour and marks the cost final (400 + 80 = 480)');

    // Re-running must recompute, never accumulate.
    await prisma.$transaction((tx) => batchCosting.finalizeTaskCosts(tx, task.id));
    costed = await prisma.inventoryBatch.findUniqueOrThrow({ where: { id: batch.id } });
    assert.strictEqual(Number(costed.unitCost), 480, 'finalising twice leaves the cost unchanged');
    testPass('Cost finalisation is idempotent');

    // ── Selling ─────────────────────────────────────────────────────────────
    const buyer = await customerServices.create({ name: `P16 Buyer ${stamp}`, type: 'WHOLESALE' } as any, admin.id);
    const outlet = await customerServices.create({ name: `P16 Outlet ${stamp}`, type: 'OWN_STORE' } as any, admin.id);
    made.customers.push(buyer.id, outlet.id);

    const sale = await salesServices.createDisposition(
      batch.id,
      { type: 'CUSTOMER_SALE', quantity: 4, customerId: buyer.id, unitSellingPrice: 1000 } as any,
      admin.id,
    );
    assert.strictEqual(Number(sale.totalRevenue), 4000, '4 at 1,000 is 4,000 of revenue');
    assert.strictEqual(Number(sale.totalCogs), 1920, '4 at 480 is 1,920 of cost');
    assert.strictEqual(Number(sale.grossProfit), 2080, 'profit is 4,000 − 1,920');
    assert.strictEqual(sale.costWasFinal, true, 'the cost used was final');
    assert(sale.dispositionNumber.startsWith('DISP-'), 'a human-readable reference is issued');

    const afterSale = await prisma.inventoryBatch.findUniqueOrThrow({ where: { id: batch.id } });
    const productAfter = await prisma.product.findUniqueOrThrow({ where: { id: widget.id } });
    assert.strictEqual(Number(afterSale.remainingQuantity), 6, 'the batch drops from 10 to 6');
    assert.strictEqual(Number(productAfter.currentStock), 6, 'product stock drops with it');
    const movement = await prisma.stockMovement.findFirst({ where: { batchId: batch.id, type: 'SALE' } });
    assert(movement, 'a SALE movement is written into the ledger');
    testPass('A sale freezes revenue and cost, and moves stock in the same transaction');

    // ── Freezing: re-pricing must not rewrite history ───────────────────────
    await salesServices.setSellingPrice(widget.id, 5000);
    const reread = await prisma.disposition.findUniqueOrThrow({ where: { id: sale.id } });
    assert.strictEqual(Number(reread.unitSellingPrice), 1000, 'the recorded price is untouched by re-pricing');
    assert.strictEqual(Number(reread.grossProfit), 2080, 'and so is the recorded profit');
    testPass('Re-pricing a product does not rewrite what a past sale earned');

    // ── The three destinations behave differently ──────────────────────────
    await salesServices.createDisposition(
      batch.id, { type: 'STORE_TRANSFER', quantity: 2, customerId: outlet.id, unitSellingPrice: 900 } as any, admin.id,
    );
    const writeOff = await salesServices.createDisposition(
      batch.id, { type: 'WRITE_OFF', quantity: 1, reason: 'Failed inspection' } as any, admin.id,
    );
    assert.strictEqual(Number(writeOff.totalRevenue), 0, 'a write-off earns nothing');
    assert.strictEqual(Number(writeOff.grossProfit), -480, 'and loses what the unit cost');
    const woMovement = await prisma.stockMovement.findFirst({ where: { batchId: batch.id, type: 'WRITE_OFF' } });
    assert(woMovement, 'a write-off uses the existing WRITE_OFF movement type, not a parallel one');
    testPass('Sale, store transfer and write-off are recorded as three different things');

    // The waste report must see the write-off without any new wiring.
    const waste = await analyticsServices.getWasteReport({ productId: widget.id });
    assert(waste.summary.totalCost >= 480, 'the finished-goods write-off reaches the waste report');
    testPass('Written-off finished goods flow into the existing waste report');

    // ── Guard rails ─────────────────────────────────────────────────────────
    let blocked = 0;
    const expectReject = async (label: string, fn: () => Promise<unknown>) => {
      try { await fn(); assert.fail(`expected rejection: ${label}`); } catch (err: any) {
        if (err?.message?.startsWith('expected rejection')) throw err;
        blocked++;
      }
    };
    await expectReject('over-selling', () =>
      salesServices.createDisposition(batch.id, { type: 'CUSTOMER_SALE', quantity: 9999, customerId: buyer.id, unitSellingPrice: 10 } as any, admin.id));
    const purchasedBatch = await prisma.inventoryBatch.findFirst({ where: { sourceTaskId: null } });
    if (purchasedBatch) {
      await expectReject('selling a purchased batch', () =>
        salesServices.createDisposition(purchasedBatch.id, { type: 'CUSTOMER_SALE', quantity: 1, customerId: buyer.id, unitSellingPrice: 10 } as any, admin.id));
    }
    await expectReject('unknown customer', () =>
      salesServices.createDisposition(batch.id, { type: 'CUSTOMER_SALE', quantity: 1, customerId: '00000000-0000-0000-0000-000000000000', unitSellingPrice: 10 } as any, admin.id));
    assert(blocked >= 2, `guard rails rejected ${blocked} invalid dispositions`);
    testPass('Over-selling, purchased batches and unknown buyers are all rejected');

    // ── Profit report ───────────────────────────────────────────────────────
    const profit = await profitServices.getProfitReport({ productId: widget.id });
    assert.strictEqual(profit.summary.revenue, 5800, 'revenue is 4,000 sale + 1,800 transfer');
    assert.strictEqual(profit.summary.cogs, 2880, 'cost is 6 units at 480');
    assert.strictEqual(profit.summary.grossProfit, 2920, 'gross profit is 5,800 − 2,880');
    assert.strictEqual(profit.summary.writeOffCost, 480, 'the write-off is reported separately, not as a zero-price sale');
    assert.strictEqual(profit.summary.netOfWriteOffs, 2440, 'and subtracted to give profit after scrap');
    testPass('Profit report: revenue 5,800 − COGS 2,880 = 2,920, less 480 written off');

    const external = await profitServices.getProfitReport({ productId: widget.id, includeStoreTransfers: false });
    assert.strictEqual(external.summary.revenue, 4000, 'excluding own-store transfers leaves outside revenue only');
    assert.strictEqual(external.summary.grossProfit, 2080, 'and the profit that came with it');
    testPass('Own-store transfers can be excluded to see outside revenue alone');

    // ── Reversal ────────────────────────────────────────────────────────────
    await salesServices.reverseDisposition(sale.id, 'Customer cancelled');
    const afterReversal = await prisma.inventoryBatch.findUniqueOrThrow({ where: { id: batch.id } });
    assert.strictEqual(Number(afterReversal.remainingQuantity), 7, 'the 4 units come back (3 + 4)');
    const profitAfter = await profitServices.getProfitReport({ productId: widget.id });
    assert.strictEqual(profitAfter.summary.revenue, 1800, 'the reversed sale no longer counts as revenue');
    const reversedRow = await prisma.disposition.findUniqueOrThrow({ where: { id: sale.id } });
    assert(reversedRow.reversedAt !== null, 'the original record is kept and marked, not deleted');
    assert.strictEqual(reversedRow.reversalReason, 'Customer cancelled', 'with the reason retained');
    await expectReject('double reversal', () => salesServices.reverseDisposition(sale.id, 'again'));
    testPass('Reversing a sale returns the stock and removes it from profit, keeping the audit trail');

    // ── The register ────────────────────────────────────────────────────────
    const register = await salesServices.getFinishedGoods({});
    const row = register.items.find((i) => i.batchId === batch.id);
    assert(row, 'the batch appears in the finished goods register');
    assert.strictEqual(row!.status, 'PARTLY_SOLD', '7 of 10 left is partly sold');
    assert.strictEqual(row!.unitCost, 480, 'the register shows the real cost');
    assert.strictEqual(row!.costIsFinal, true, 'and that it is final');
    assert(row!.producedBy.some((p) => p.name === 'P16 Maker'), 'and who built it');
    testPass('The finished goods register shows cost, status and who made it');

    console.log(`\n📊 Phase 16 Test Results: ${passed} Passed, 0 Failed`);
  } catch (err: any) {
    console.error('\n💥 Phase 16 test suite crashed:', err);
    process.exitCode = 1;
  } finally {
    for (const id of made.products) {
      await prisma.disposition.deleteMany({ where: { productId: id } }).catch(() => {});
      await prisma.stockMovement.deleteMany({ where: { productId: id } }).catch(() => {});
      await prisma.inventoryBatch.deleteMany({ where: { productId: id } }).catch(() => {});
    }
    for (const id of made.tasks) {
      await prisma.taskAssignment.deleteMany({ where: { taskId: id } }).catch(() => {});
      await prisma.task.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.products) await prisma.product.delete({ where: { id } }).catch(() => {});
    for (const id of made.customers) await prisma.customer.delete({ where: { id } }).catch(() => {});
    for (const id of made.users) {
      await prisma.attendance.deleteMany({ where: { employeeId: id } }).catch(() => {});
      await prisma.employeeProfile.deleteMany({ where: { userId: id } }).catch(() => {});
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect().catch(() => {});
  }
}

runPhase16Tests();
