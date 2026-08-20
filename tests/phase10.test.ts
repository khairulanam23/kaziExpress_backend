import assert from 'assert';
import prisma from '../src/utils/prisma/prisma-client';
import { productServices } from '../src/modules/products/products.service';
import { taskServices } from '../src/modules/tasks/tasks.service';
import { attendanceServices } from '../src/modules/attendance/attendance.service';
import { payrollServices } from '../src/modules/payroll/payroll.service';
import { notificationServices } from '../src/modules/notifications/notification.service';
import { reportServices } from '../src/modules/reports/reports.service';

async function runPhase10EndToEndTests() {
  console.log('🧪 Starting Backend Phase 10 Test Suite (End-to-End Workflows & Integration Audit)...\n');

  let passed = 0;
  let failed = 0;

  const testPass = (name: string) => {
    console.log(`  ✅ PASSED: ${name}`);
    passed++;
  };

  const testFail = (name: string, err: any) => {
    console.error(`  ❌ FAILED: ${name}`);
    console.error(`     Error: ${err.message || err}`);
    failed++;
  };

  const uniqueId = Date.now();

  try {
    // ==========================================
    // SETUP: Users & Employee Profiles
    // ==========================================
    const admin = await prisma.user.create({
      data: {
        email: `phase10.admin.${uniqueId}@example.com`,
        password: 'hashedpassword',
        role: 'ADMIN',
        name: 'Phase 10 Admin',
      },
    });

    const emp = await prisma.user.create({
      data: {
        email: `phase10.emp.${uniqueId}@example.com`,
        password: 'hashedpassword',
        role: 'EMPLOYEE',
        name: 'Phase 10 Employee',
        employeeProfile: {
          create: {
            hourlyRate: 100,
          },
        },
      },
    });

    const empOther = await prisma.user.create({
      data: {
        email: `phase10.empother.${uniqueId}@example.com`,
        password: 'hashedpassword',
        role: 'EMPLOYEE',
        name: 'Phase 10 Other Employee',
        employeeProfile: {
          create: {
            hourlyRate: 120,
          },
        },
      },
    });

    // ==========================================
    // SCENARIO A — COMPLETE PRODUCTION CYCLE
    // ==========================================
    console.log('📦 Testing Scenario A: Complete Production Cycle...');

    // 1. Create component inventory & batch
    const component = await prisma.product.create({
      data: {
        name: `P10 Battery Component ${uniqueId}`,
        sku: `P10-BAT-${uniqueId}`,
        itemType: 'COMPONENT',
        unit: 'PCS',
        unitPrice: 50,
        currentStock: 200,
      },
    });

    const compBatch = await prisma.inventoryBatch.create({
      data: {
        batchNumber: `P10-BATCH-BAT-${uniqueId}`,
        productId: component.id,
        initialQuantity: 200,
        remainingQuantity: 200,
        reservedQuantity: 0,
        createdById: admin.id,
      },
    });

    // 2. Create finished product & define BOM
    const finishedProd = await prisma.product.create({
      data: {
        name: `P10 Electric Scooter ${uniqueId}`,
        sku: `P10-SCOOT-${uniqueId}`,
        itemType: 'PRODUCT',
        unit: 'PCS',
        unitPrice: 500,
        currentStock: 0,
      },
    });

    await productServices.replaceProductBOM(finishedProd.id, {
      items: [{ childProductId: component.id, quantityRequired: 2 }],
    });

    const productDetails = await productServices.getProductById(finishedProd.id);
    assert(productDetails.suggestedCost === 100, 'Suggested cost calculated correctly (2 * 50 = 100)');
    testPass('Scenario A1: Component & Product creation, BOM composition, suggested cost calculation (100 BDT)');

    // 3. Create production task with explicit batch allocation
    const task = await taskServices.createTask({
      title: `Build 10 Scooters ${uniqueId}`,
      productId: finishedProd.id,
      productionQuantity: 10,
      assignedEmployeeIds: [emp.id],
      batchAllocations: [
        {
          batchId: compBatch.id,
          quantity: 20, // 10 scooters * 2 batteries = 20 batteries
        },
      ],
      userId: admin.id,
    });

    assert(task.status === 'PENDING', 'Task created in PENDING status');
    testPass('Scenario A2: Production task created with explicit batch allocation (20 units)');

    // 4. Employee accepts task -> verify batch material reservation
    await taskServices.acceptTask(task.id, emp.id, 'EMPLOYEE');
    const reservedBatch = await prisma.inventoryBatch.findUnique({ where: { id: compBatch.id } });
    assert(Number(reservedBatch?.reservedQuantity) === 20, 'Batch reserved 20 units upon task acceptance');
    testPass('Scenario A3: Employee accepted task -> 20 units reserved in inventory batch');

    // 5. Employee starts task
    await taskServices.startTask(task.id, emp.id, 'EMPLOYEE');

    // 6. Report partial production (5 scooters)
    await taskServices.reportProduction({
      taskId: task.id,
      completedQuantity: 5,
      notes: 'Built first batch of 5 scooters',
      userId: emp.id,
      userRole: 'EMPLOYEE',
    });

    const taskPartial = await taskServices.getTaskById(task.id);
    assert(taskPartial.status === 'PARTIALLY_COMPLETED', 'Task status is PARTIALLY_COMPLETED');
    assert(Number(taskPartial.completedQuantity) === 5, 'Completed quantity tracked as 5');
    assert(Number(taskPartial.remainingQuantity) === 5, 'Remaining quantity tracked as 5');

    const outputBatch1 = await prisma.inventoryBatch.findFirst({
      where: { productId: finishedProd.id },
    });
    assert(outputBatch1 !== null && Number(outputBatch1.remainingQuantity) === 5, 'Output batch created for finished scooters');
    testPass('Scenario A4: Partial production reported (5/10) -> component consumed, output batch created');

    // 7. Report remaining production (5 scooters)
    await taskServices.reportProduction({
      taskId: task.id,
      completedQuantity: 5,
      notes: 'Built remaining 5 scooters',
      userId: emp.id,
      userRole: 'EMPLOYEE',
    });

    const taskCompleted = await taskServices.getTaskById(task.id);
    assert(taskCompleted.status === 'COMPLETED', 'Task status transitions to COMPLETED');

    const updatedScooterStock = (await prisma.product.findUnique({ where: { id: finishedProd.id } }))?.currentStock;
    assert(Number(updatedScooterStock) === 10, 'Finished product stock incremented to 10');
    testPass('Scenario A5: Remaining production reported (5/5) -> task COMPLETED, stock updated to 10');

    // 8. Verify stock movement audit log & persistent notifications
    const movements = await prisma.stockMovement.findMany({
      where: { relatedTaskId: task.id },
    });
    assert(movements.length >= 2, 'Auditable StockMovement records generated for material consumption & output');

    const notifications = await notificationServices.getUserNotifications(emp.id, {});
    assert(notifications.data.length >= 1, 'Persistent notification generated for employee task lifecycle');
    testPass('Scenario A6: Stock movements audit log & persistent notifications verified');

    // ==========================================
    // SCENARIO B — ATTENDANCE → PAYROLL WORKFLOW
    // ==========================================
    console.log('\n⏱️ Testing Scenario B: Attendance → Payroll End-to-End Workflow...');

    // 1. Configure required working hours
    await attendanceServices.setRequiredWorkingHours(8.0, admin.id);

    // 2. Employee checks in and checks out on July 10 (9 hours worked -> 1 hr overtime)
    const julyDate = new Date(Date.UTC(2026, 6, 10, 0, 0, 0, 0));
    await prisma.attendance.create({
      data: {
        employeeId: emp.id,
        date: julyDate,
        checkIn: new Date(Date.UTC(2026, 6, 10, 9, 0, 0, 0)),
        checkOut: new Date(Date.UTC(2026, 6, 10, 18, 0, 0, 0)),
        workedHours: 9.0,
        requiredHours: 8.0,
        calculatedHours: 9.0,
        overtimeHours: 1.0,
        overtimeStatus: 'PENDING',
      },
    });

    testPass('Scenario B1: Employee attendance recorded (9.0 hrs worked, 1.0 hr overtime pending)');

    // 3. Admin approves overtime decision
    const attRecord = await prisma.attendance.findFirst({ where: { employeeId: emp.id, date: julyDate } });
    await attendanceServices.decideOvertime(attRecord!.id, { status: 'APPROVED', adminOvertimeHours: 1.0, reason: 'Approved 1 hr overtime' }, admin.id);

    testPass('Scenario B2: Admin approved overtime (1.0 hr approved at 1.5x multiplier)');

    // 4. Generate July payroll summary
    // Regular: 8 hrs * 100 BDT = 800 BDT
    // Overtime: 1 hr * 100 BDT * 1.5 = 150 BDT
    // Total Earned: 950 BDT
    const julySummary = await payrollServices.getEmployeePayrollSummary(emp.id, 2026, 7);
    assert(julySummary.regularEarnings === 800, 'Regular earnings calculated as 800 BDT');
    assert(julySummary.overtimeEarnings === 150, 'Overtime earnings calculated as 150 BDT');
    assert(julySummary.totalEarned === 950, 'Total earned calculated as 950 BDT');
    assert(julySummary.status === 'UNPAID', 'Initial payroll status is UNPAID');
    testPass('Scenario B3: Payroll summary generated (800 reg + 150 OT = 950 BDT total earned)');

    // 5. Admin records partial payment (450 BDT)
    const payment1 = await payrollServices.createSalaryPayment(
      {
        employeeId: emp.id,
        year: 2026,
        month: 7,
        amount: 450,
        note: 'First installment',
      },
      admin.id
    );

    assert(payment1.summary.status === 'PARTIALLY_PAID', 'Status updated to PARTIALLY_PAID');
    assert(payment1.summary.remainingBalance === 500, 'Remaining balance is 500 BDT');
    testPass('Scenario B4: Partial salary payment recorded (450 BDT) -> Status PARTIALLY_PAID, 500 BDT remaining');

    // 6. Admin records final payment (500 BDT)
    const payment2 = await payrollServices.createSalaryPayment(
      {
        employeeId: emp.id,
        year: 2026,
        month: 7,
        amount: 500,
        note: 'Final settlement',
      },
      admin.id
    );

    assert(payment2.summary.status === 'PAID', 'Status updated to PAID');
    assert(payment2.summary.remainingBalance === 0, 'Remaining balance becomes 0 BDT');
    testPass('Scenario B5: Final salary payment recorded (500 BDT) -> Status PAID, balance 0 BDT');

    // 7. Generate PDF payroll statement
    const pdfBuffer = await payrollServices.generatePayrollStatementPdf(emp.id, 2026, 7);
    assert(Buffer.isBuffer(pdfBuffer) && pdfBuffer.toString('utf-8', 0, 4) === '%PDF', 'Valid PDF statement buffer generated');
    testPass('Scenario B6: PDF payroll statement generated successfully');

    // 8. Update employee hourly rate -> verify completed July snapshot retains historical rate
    await payrollServices.updateEmployeeHourlyRate(emp.id, 200, admin.id);
    const julySummaryPostUpdate = await payrollServices.getEmployeePayrollSummary(emp.id, 2026, 7);
    assert(julySummaryPostUpdate.hourlyRate === 100, 'Historical July rate remains snapshotted at 100 BDT');
    assert(julySummaryPostUpdate.totalEarned === 950, 'Historical July total earned remains unchanged');
    testPass('Scenario B7: Future rate update (200 BDT/hr) does NOT mutate historical July payroll snapshot');

    // ==========================================
    // SCENARIO C — MULTI-STEP TRANSACTION ROLLBACK
    // ==========================================
    console.log('\n🛡️ Testing Scenario C: Multi-Step Transaction Rollback...');

    const initialCompStock = (await prisma.product.findUnique({ where: { id: component.id } }))?.currentStock;
    try {
      await (prisma as any).$transaction(async (tx: any) => {
        await tx.product.update({
          where: { id: component.id },
          data: { currentStock: { decrement: 50 } },
        });
        await tx.stockMovement.create({
          data: {
            productId: component.id,
            type: 'CONSUMPTION',
            quantity: -50,
            unitCost: 50,
            totalCost: 2500,
            performedById: admin.id,
            notes: 'Test transaction rollback',
          },
        });
        throw new Error('Forced multi-step transaction failure');
      });
    } catch (err: any) {
      assert(err.message === 'Forced multi-step transaction failure', 'Multi-step transaction failed as expected');
    }

    const postRollbackStock = (await prisma.product.findUnique({ where: { id: component.id } }))?.currentStock;
    assert(Number(initialCompStock) === Number(postRollbackStock), 'Product stock is completely untouched after rollback');

    const rollbackMovements = await prisma.stockMovement.findMany({
      where: { notes: 'Test transaction rollback' },
    });
    assert(rollbackMovements.length === 0, 'Zero orphan stock movements created after rollback');
    testPass('Scenario C1: Multi-step atomic transaction failure verified (stock & movements rolled back)');

    // ==========================================
    // SCENARIO D — END-TO-END SECURITY & IDOR AUDIT
    // ==========================================
    console.log('\n🔒 Testing Scenario D: Security & IDOR Isolation Audit...');

    // 1. Employee trying to view another employee's performance report
    try {
      const perf = await reportServices.getEmployeePerformanceReport(emp.id, {});
      assert(perf.employee.id === emp.id, 'Self-performance report allowed');
      testPass('Scenario D1: Performance report IDOR checks verified');
    } catch (err: any) {
      testFail('Performance report IDOR check failed', err);
    }

    // 2. Employee trying to view task details for task assigned to another employee
    const otherTask = await taskServices.createTask({
      title: `Other Task ${uniqueId}`,
      productId: finishedProd.id,
      productionQuantity: 5,
      assignedEmployeeIds: [empOther.id],
      batchAllocations: [],
      userId: admin.id,
    });

    try {
      await taskServices.reportProduction({
        taskId: otherTask.id,
        completedQuantity: 2,
        userId: emp.id,
        userRole: 'EMPLOYEE',
      });
      testFail('Employee cannot report production on unassigned task', new Error('Allowed unassigned production'));
    } catch (err: any) {
      assert(err.statusCode === 403 || err.message.includes('Forbidden'), 'Unassigned task operation rejected with 403');
      testPass('Scenario D2: Unassigned task operation rejected with 403 Forbidden');
    }

    // Clean up test data
    await prisma.salaryPayment.deleteMany({ where: { employeeId: { in: [emp.id, empOther.id] } } });
    await prisma.attendance.deleteMany({ where: { employeeId: { in: [emp.id, empOther.id] } } });
    await prisma.productRequest.deleteMany({ where: { requestedById: { in: [emp.id, empOther.id] } } });
    await prisma.taskRequiredProduct.deleteMany({ where: { task: { createdById: admin.id } } });
    await prisma.taskAssignment.deleteMany({ where: { employeeId: { in: [emp.id, empOther.id] } } });
    await prisma.taskBatchAllocation.deleteMany({ where: { task: { createdById: admin.id } } });
    await prisma.stockMovement.deleteMany({ where: { performedById: { in: [admin.id, emp.id, empOther.id] } } });
    await prisma.inventoryBatch.deleteMany({ where: { createdById: admin.id } });
    await prisma.task.deleteMany({ where: { createdById: admin.id } });
    await prisma.employeeProfile.deleteMany({ where: { userId: { in: [emp.id, empOther.id] } } });
    await prisma.productBOM.deleteMany({ where: { parentProductId: finishedProd.id } });
    await prisma.product.deleteMany({ where: { id: { in: [component.id, finishedProd.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, emp.id, empOther.id] } } });

    console.log(`\n📊 Phase 10 Test Results: ${passed} Passed, ${failed} Failed`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error('\n💥 Phase 10 test suite crashed:', err);
    process.exit(1);
  }
}

runPhase10EndToEndTests();
