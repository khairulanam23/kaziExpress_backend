import assert from 'assert';
import prisma from '../src/utils/prisma/prisma-client';
import { taskServices } from '../src/modules/tasks/tasks.service';

/**
 * Production consumption must be valued at what the stock actually cost.
 *
 * The defect this guards was silent and total: `reportProduction` read
 * `batch.product?.unitPrice` from a query that never selected `product`, so
 * every CONSUMPTION movement was written with `unitCost: 0`. Material cost is
 * summed from those movements, so every manufactured batch came out at zero,
 * every sale from one showed a 100% margin, and the backfill — which recomputes
 * from the same movements — reported 0.00 → 0.00 and looked like it had worked.
 *
 * The assertions are therefore about the *ledger*, not about a request
 * succeeding: a test that only checked the call returned 200 passed throughout.
 */
async function runPhase19Tests() {
  console.log('🧪 Starting Backend Phase 19 Test Suite (Production Cost Capture)...\n');

  let passed = 0;
  const testPass = (name: string) => {
    console.log(`  ✅ PASSED: ${name}`);
    passed++;
  };

  const stamp = Date.now();
  const made: { products: string[]; tasks: string[]; users: string[] } = { products: [], tasks: [], users: [] };

  try {
    const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });

    // ── A component whose batch cost (250) differs from its list price (999) ──
    // so a test that accidentally uses list price cannot coincidentally pass.
    const component = await prisma.product.create({
      data: { name: `P19 Cell ${stamp}`, sku: `P19C-${stamp}`, unitPrice: 999, currentStock: 100, unit: 'pcs', itemType: 'COMPONENT' },
    });
    const widget = await prisma.product.create({
      data: { name: `P19 Widget ${stamp}`, sku: `P19W-${stamp}`, unitPrice: 5000, currentStock: 0, unit: 'pcs', itemType: 'PRODUCT', isComposite: true },
    });
    made.products.push(component.id, widget.id);

    const componentBatch = await prisma.inventoryBatch.create({
      data: {
        batchNumber: `P19-BATCH-${stamp}`,
        productId: component.id,
        initialQuantity: 100,
        remainingQuantity: 100,
        reservedQuantity: 0,
        materialUnitCost: 250,
        labourUnitCost: 0,
        unitCost: 250,
        costFinalizedAt: new Date(),
        createdById: admin.id,
      },
    });

    const employee = await prisma.user.create({
      data: { name: `P19 Emp ${stamp}`, email: `p19.${stamp}@example.com`, password: 'x', role: 'EMPLOYEE', isActive: true },
    });
    made.users.push(employee.id);

    // 40 cells allocated for 10 widgets. Reporting 6 consumes 60% of the
    // allocation — 24 cells at 250 = 6,000 over 6 units = 1,000/unit — and
    // leaves the run open, which is the state the Power Bank batch was in.
    const task = await prisma.task.create({
      data: {
        title: `P19 Run ${stamp}`,
        productId: widget.id,
        productionQuantity: 10,
        remainingQuantity: 10,
        status: 'PENDING',
        createdById: admin.id,
        assignments: { create: [{ employeeId: employee.id }] },
        batchAllocations: { create: [{ batchId: componentBatch.id, allocatedQuantity: 40 }] },
      },
    });
    made.tasks.push(task.id);

    await taskServices.acceptTask(task.id, employee.id, 'EMPLOYEE');
    await taskServices.startTask(task.id, employee.id, 'EMPLOYEE');
    await taskServices.reportProduction({
      taskId: task.id, completedQuantity: 6, userId: employee.id, userRole: 'EMPLOYEE', notes: 'P19',
    } as any);

    // ── The ledger must carry the batch's cost, not zero and not list price ──
    const consumption = await prisma.stockMovement.findMany({
      where: { relatedTaskId: task.id, type: 'CONSUMPTION' },
      select: { unitCost: true, totalCost: true, quantity: true },
    });
    assert.ok(consumption.length > 0, 'production must record a consumption movement');

    for (const m of consumption) {
      assert.strictEqual(
        Number(m.unitCost),
        250,
        `consumption must be valued at the batch's cost (250), got ${Number(m.unitCost)}`,
      );
      assert.notStrictEqual(Number(m.unitCost), 0, 'consumption must never be recorded at zero cost');
      assert.notStrictEqual(Number(m.unitCost), 999, 'consumption must not use the product list price');
    }
    testPass('consumption is valued at the consumed batch cost, not zero and not list price');

    const totalMaterial = consumption.reduce((sum, m) => sum + Math.abs(Number(m.totalCost)), 0);
    assert.strictEqual(totalMaterial, 6000, `24 units at 250 should be 6,000, got ${totalMaterial}`);
    testPass('consumption total cost is quantity times batch cost');

    // ── Which is what the produced batch must inherit ──────────────────────
    const output = await prisma.inventoryBatch.findFirstOrThrow({
      where: { sourceTaskId: task.id },
      select: { materialUnitCost: true, labourUnitCost: true, unitCost: true, costFinalizedAt: true, initialQuantity: true },
    });
    assert.strictEqual(Number(output.materialUnitCost), 1000, `6,000 over 6 units should be 1,000/unit, got ${Number(output.materialUnitCost)}`);
    assert.strictEqual(Number(output.unitCost), 1000, 'provisional unit cost is the material cost');
    testPass('the produced batch carries the material cost its run consumed');

    // Labour is only knowable once the run ends — it must stay unset, not zero.
    assert.strictEqual(output.labourUnitCost, null, 'labour must stay unset while the run is unfinished');
    assert.strictEqual(output.costFinalizedAt, null, 'an unfinished run leaves its batch provisional');
    testPass('labour is left unset rather than fabricated while the run is open');

    // ── A reservation is read by people; it must not show zero either ──────
    const reservation = await prisma.stockMovement.findFirst({
      where: { relatedTaskId: task.id, type: 'TASK_RESERVATION' },
      select: { unitCost: true },
    });
    assert.ok(reservation, 'accepting a task must record a reservation movement');
    assert.strictEqual(Number(reservation!.unitCost), 250, 'reservation is valued at the batch cost');
    testPass('reservation movements carry the batch cost');

    console.log(`\n🎉 Phase 19 complete — ${passed} assertion group(s) passed.\n`);
  } finally {
    for (const id of made.tasks) {
      await prisma.stockMovement.deleteMany({ where: { relatedTaskId: id } }).catch(() => {});
      await prisma.inventoryBatch.deleteMany({ where: { sourceTaskId: id } }).catch(() => {});
      await prisma.task.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.products) {
      await prisma.stockMovement.deleteMany({ where: { productId: id } }).catch(() => {});
      await prisma.inventoryBatch.deleteMany({ where: { productId: id } }).catch(() => {});
      await prisma.product.delete({ where: { id } }).catch(() => {});
    }
    for (const id of made.users) {
      await prisma.taskAssignment.deleteMany({ where: { employeeId: id } }).catch(() => {});
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
}

runPhase19Tests().catch((error) => {
  console.error('\n❌ Phase 19 FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
