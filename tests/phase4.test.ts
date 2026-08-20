import prisma from '../src/utils/prisma/prisma-client';
import { taskServices } from '../src/modules/tasks/tasks.service';
import { inventoryService } from '../src/modules/inventory/inventory.service';
import { productServices } from '../src/modules/products/products.service';
import bcrypt from 'bcryptjs';

async function runPhase4Tests() {
  console.log('🧪 Starting Backend Phase 4 Test Suite...\n');

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
    // 0. Setup test users
    const adminEmail = `phase4.admin.${Date.now()}@example.com`;
    const emp1Email = `phase4.emp1.${Date.now()}@example.com`;
    const emp2Email = `phase4.emp2.${Date.now()}@example.com`;
    const passwordHash = await bcrypt.hash('password123', 10);

    const admin = await prisma.user.create({
      data: { email: adminEmail, password: passwordHash, role: 'ADMIN', name: 'Phase4 Admin' },
    });

    const emp1 = await prisma.user.create({
      data: { email: emp1Email, password: passwordHash, role: 'EMPLOYEE', name: 'Rahim' },
    });

    const emp2 = await prisma.user.create({
      data: { email: emp2Email, password: passwordHash, role: 'EMPLOYEE', name: 'Karim' },
    });

    // 1. Setup Component & Finished Product Items
    const compBattery = await productServices.createProduct({
      name: 'Li-Ion Battery Cell',
      sku: `SKU-BAT4-${Date.now()}`,
      itemType: 'COMPONENT',
      unit: 'Piece',
      unitPrice: 400,
      currentStock: 0,
    });

    const compBMS = await productServices.createProduct({
      name: 'BMS Protection Board',
      sku: `SKU-BMS4-${Date.now()}`,
      itemType: 'COMPONENT',
      unit: 'Piece',
      unitPrice: 100,
      currentStock: 0,
    });

    const prodPowerBank = await productServices.createProduct({
      name: '10000mAh Power Bank',
      sku: `SKU-PB4-${Date.now()}`,
      itemType: 'PRODUCT',
      unit: 'Piece',
      unitPrice: 1600,
      currentStock: 0,
      isComposite: true,
      bomItems: [
        { childProductId: compBattery.id, quantityRequired: 3 }, // 3 * 30 = 90 batteries
        { childProductId: compBMS.id, quantityRequired: 1 },     // 1 * 30 = 30 BMS
      ],
    });

    // 2. Add Stock & Auto-create Batches for Components
    const batStock1 = await inventoryService.addStock({
      productId: compBattery.id,
      quantity: 50, // Batch A: 50
      unitCost: 400,
      notes: 'Battery Batch A',
      userId: admin.id,
    });

    const batStock2 = await inventoryService.addStock({
      productId: compBattery.id,
      quantity: 50, // Batch B: 50
      unitCost: 400,
      notes: 'Battery Batch B',
      userId: admin.id,
    });

    const bmsStock = await inventoryService.addStock({
      productId: compBMS.id,
      quantity: 40, // BMS Batch: 40
      unitCost: 100,
      notes: 'BMS Batch',
      userId: admin.id,
    });

    const batchA = batStock1.batch;
    const batchB = batStock2.batch;

    // 3. Task Creation: Admin creates task for 30 Power Banks
    const task1 = await taskServices.createTask({
      title: 'Produce 30 Power Banks',
      description: 'Customer order #1001',
      productId: prodPowerBank.id,
      productionQuantity: 30,
      assignedEmployeeIds: [emp1.id],
      deadline: '2026-08-25',
      batchAllocations: [
        { batchId: batchA.id, quantity: 50 }, // Batch A: 50
        { batchId: batchB.id, quantity: 40 }, // Batch B: 40 (Total: 90 Batteries)
        { batchId: bmsStock.batch.id, quantity: 30 }, // BMS: 30
      ],
      userId: admin.id,
    });

    assert(task1.status === 'PENDING', 'Task 1 created with status PENDING');
    assert(Number(task1.productionQuantity) === 30, 'Production quantity set to 30');
    assert(Number(task1.remainingQuantity) === 30, 'Remaining quantity initialized to 30');
    assert(task1.requiredProducts.length === 2, 'Task contains immutable material requirement snapshot (2 items)');
    assert(task1.batchAllocations.length === 3, 'Admin explicitly allocated 3 batches');

    // 4. BOM Requirement Conversion
    const reqBat = task1.requiredProducts.find((r: any) => r.productId === compBattery.id);
    assert(reqBat && Number(reqBat.quantity) === 90, 'BOM requirement converted correctly (3 * 30 = 90 batteries)');

    // 5. Zero/Negative Production Quantity Rejection
    try {
      await taskServices.createTask({
        title: 'Invalid Task',
        productId: prodPowerBank.id,
        productionQuantity: 0,
        userId: admin.id,
      });
      assert(false, 'Zero production quantity rejected');
    } catch (err: any) {
      assert(err.message.includes('greater than 0'), 'Zero production quantity rejected');
    }

    // 6. Insufficient Batch Quantity Rejection
    try {
      await taskServices.createTask({
        title: 'Excessive Task',
        productId: prodPowerBank.id,
        productionQuantity: 100,
        batchAllocations: [{ batchId: batchA.id, quantity: 500 }], // Insufficient stock in Batch A
        userId: admin.id,
      });
      assert(false, 'Insufficient batch quantity rejected');
    } catch (err: any) {
      assert(err.message.includes('Insufficient inventory'), 'Insufficient batch quantity rejected with shortage detail');
    }

    // 7. Unassigned Employee Acceptance Rejection
    try {
      await taskServices.acceptTask(task1.id, emp2.id, 'EMPLOYEE'); // emp2 is NOT assigned
      assert(false, 'Unassigned employee cannot accept task');
    } catch (err: any) {
      assert(err.message.includes('not assigned'), 'Unassigned employee cannot accept task');
    }

    // 8. Assigned Employee Acceptance & Batch Reservation
    const acceptedTask = await taskServices.acceptTask(task1.id, emp1.id, 'EMPLOYEE');
    assert(acceptedTask.status === 'ACCEPTED', 'Assigned employee accepted task -> Status ACCEPTED');

    const freshBatchA = await prisma.inventoryBatch.findUnique({ where: { id: batchA.id } });
    assert(Number(freshBatchA?.reservedQuantity) === 50, 'Acceptance reserved 50 units in Batch A at batch level');

    // 9. Double Acceptance Check
    try {
      await taskServices.acceptTask(task1.id, emp1.id, 'EMPLOYEE');
      assert(false, 'Double acceptance prevented');
    } catch (err: any) {
      assert(err.message.includes('cannot be accepted'), 'Double acceptance prevented');
    }

    // 10. Start Task
    const startedTask = await taskServices.startTask(task1.id, emp1.id, 'EMPLOYEE');
    assert(startedTask.status === 'IN_PROGRESS', 'Task started -> Status IN_PROGRESS');

    // 11. Partial Production Reporting (Report 25 completed out of 30)
    const partialRes = await taskServices.reportProduction({
      taskId: task1.id,
      completedQuantity: 25,
      notes: 'Completed 25 Power Banks today',
      userId: emp1.id,
    });

    assert(partialRes.task.status === 'PARTIALLY_COMPLETED', 'Task status updated to PARTIALLY_COMPLETED');
    assert(Number(partialRes.task.completedQuantity) === 25, 'Completed quantity tracked as 25');
    assert(Number(partialRes.task.remainingQuantity) === 5, 'Remaining quantity tracked as 5');
    assert(partialRes.outputBatch.batchNumber.startsWith('BATCH-'), 'Output InventoryBatch created for finished product');
    assert(Number(partialRes.outputBatch.remainingQuantity) === 25, 'Output batch created for completed quantity (25) ONLY');

    const finishedProdFresh = await prisma.product.findUnique({ where: { id: prodPowerBank.id } });
    assert(Number(finishedProdFresh?.currentStock) === 25, 'Finished product stock incremented by 25 ONLY');

    // 12. Over-reporting Production Rejection (Attempting 10 when remaining is 5)
    try {
      await taskServices.reportProduction({
        taskId: task1.id,
        completedQuantity: 10,
        userId: emp1.id,
      });
      assert(false, 'Over-reporting completed quantity rejected');
    } catch (err: any) {
      assert(err.message.includes('remaining for this task'), 'Over-reporting completed quantity rejected');
    }

    // 13. Full Production Completion (Report remaining 5)
    const fullRes = await taskServices.reportProduction({
      taskId: task1.id,
      completedQuantity: 5,
      notes: 'Completed remaining 5 Power Banks',
      userId: emp1.id,
    });

    assert(fullRes.task.status === 'COMPLETED', 'Task status updated to COMPLETED when remaining reaches 0');
    assert(Number(fullRes.task.completedQuantity) === 30, 'Total completed quantity equals 30');

    const finishedProdFinal = await prisma.product.findUnique({ where: { id: prodPowerBank.id } });
    assert(Number(finishedProdFinal?.currentStock) === 30, 'Finished product stock total reaches 30');

    // 14. Damage Reporting & Accountability
    const damageMovement = await taskServices.reportDamage({
      taskId: task1.id,
      productId: compBattery.id,
      batchId: batchB.id,
      quantity: 2,
      reason: '2 batteries damaged during assembly',
      userId: emp1.id,
    });

    assert(damageMovement.type === 'DAMAGE', 'Damage report logged in StockMovement as DAMAGE');
    assert(damageMovement.reason === '2 batteries damaged during assembly', 'Damage reason recorded');

    // 15. Refill Request & Approval Workflow
    const refillReq = await taskServices.requestRefill({
      taskId: task1.id,
      productId: compBattery.id,
      quantity: 2,
      reason: 'Need 2 replacement batteries for damaged ones',
      userId: emp1.id,
    });

    assert(refillReq.status === 'PENDING', 'Refill request created with status PENDING');

    const approvedRefill = await taskServices.decideRefill({
      requestId: refillReq.id,
      status: 'APPROVED',
      allocatedBatchId: batchB.id,
      userId: admin.id,
    });

    assert(approvedRefill.status === 'APPROVED', 'Admin approved refill request -> Status APPROVED');

    // 16. Task Cancellation & Inventory Reservation Release
    const taskCancelTest = await taskServices.createTask({
      title: 'Task to be cancelled',
      productId: prodPowerBank.id,
      productionQuantity: 10,
      assignedEmployeeIds: [emp1.id],
      batchAllocations: [{ batchId: batchB.id, quantity: 5 }],
      userId: admin.id,
    });

    await taskServices.acceptTask(taskCancelTest.id, emp1.id, 'EMPLOYEE');
    const batchBReservedBeforeCancel = Number((await prisma.inventoryBatch.findUnique({ where: { id: batchB.id } }))?.reservedQuantity);

    const cancelledTask = await taskServices.cancelTask(taskCancelTest.id, admin.id);
    assert(cancelledTask.status === 'CANCELLED', 'Task status updated to CANCELLED');

    const batchBReservedAfterCancel = Number((await prisma.inventoryBatch.findUnique({ where: { id: batchB.id } }))?.reservedQuantity);
    assert(batchBReservedAfterCancel < batchBReservedBeforeCancel, 'Cancelling task released reserved inventory');

    // 17. Immutable BOM Snapshot Verification (Changing BOM after task creation)
    const oldTaskReqQty = Number(task1.requiredProducts[0].quantity);
    await productServices.replaceProductBOM(prodPowerBank.id, {
      items: [{ childProductId: compBattery.id, quantityRequired: 10 }], // Changed BOM from 3 to 10
    });

    const task1Fresh = await taskServices.getTaskById(task1.id);
    assert(Number(task1Fresh.requiredProducts[0].quantity) === oldTaskReqQty, 'BOM change after task creation does NOT alter historical task requirement snapshot');

    // Clean up test data
    const taskIds = [task1.id, taskCancelTest.id];
    const productIds = [compBattery.id, compBMS.id, prodPowerBank.id];

    await prisma.stockMovement.deleteMany({ where: { OR: [{ relatedTaskId: { in: taskIds } }, { productId: { in: productIds } }] } });
    await prisma.productRequest.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.taskBatchAllocation.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.taskRequiredProduct.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.taskAssignment.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.inventoryBatch.deleteMany({ where: { OR: [{ sourceTaskId: { in: taskIds } }, { productId: { in: productIds } }] } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.productBOM.deleteMany({ where: { parentProductId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, emp1.id, emp2.id] } } });

    console.log(`\n📊 Phase 4 Test Results: ${passed} Passed, ${failed} Failed`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('💥 Phase 4 test suite crashed:', err);
    process.exit(1);
  }
}

runPhase4Tests();
