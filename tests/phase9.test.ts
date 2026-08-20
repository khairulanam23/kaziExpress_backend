import assert from 'assert';
import prisma from '../src/utils/prisma/prisma-client';
import { taskServices } from '../src/modules/tasks/tasks.service';
import { payrollServices } from '../src/modules/payroll/payroll.service';
import { reportServices } from '../src/modules/reports/reports.service';

async function runPhase9Tests() {
  console.log('🧪 Starting Backend Phase 9 Test Suite (Integration, Security & Hardening)...\n');

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
    // 1. Setup Test Users
    const admin = await prisma.user.create({
      data: {
        email: `phase9.admin.${uniqueId}@example.com`,
        password: 'hashedpassword',
        role: 'ADMIN',
        name: 'Phase 9 Admin',
      },
    });

    const emp1 = await prisma.user.create({
      data: {
        email: `phase9.emp1.${uniqueId}@example.com`,
        password: 'hashedpassword',
        role: 'EMPLOYEE',
        name: 'Phase 9 Employee 1',
        employeeProfile: {
          create: {
            hourlyRate: 100,
          },
        },
      },
    });

    const emp2 = await prisma.user.create({
      data: {
        email: `phase9.emp2.${uniqueId}@example.com`,
        password: 'hashedpassword',
        role: 'EMPLOYEE',
        name: 'Phase 9 Employee 2',
        employeeProfile: {
          create: {
            hourlyRate: 120,
          },
        },
      },
    });

    // 2. Setup Test Products & Inventory Batch
    const compProduct = await prisma.product.create({
      data: {
        name: `P9 Raw Component ${uniqueId}`,
        sku: `P9-COMP-${uniqueId}`,
        itemType: 'COMPONENT',
        unit: 'KG',
        unitPrice: 20,
        currentStock: 100,
      },
    });

    const finishedProduct = await prisma.product.create({
      data: {
        name: `P9 Finished Product ${uniqueId}`,
        sku: `P9-PROD-${uniqueId}`,
        itemType: 'PRODUCT',
        unit: 'PCS',
        unitPrice: 200,
        currentStock: 0,
      },
    });

    const batch = await prisma.inventoryBatch.create({
      data: {
        batchNumber: `P9-BATCH-${uniqueId}`,
        productId: compProduct.id,
        initialQuantity: 100,
        remainingQuantity: 100,
        reservedQuantity: 0,
        createdById: admin.id,
      },
    });

    // 3. Create Production Task assigned ONLY to emp1
    const task = await taskServices.createTask({
      title: `P9 Production Task ${uniqueId}`,
      productId: finishedProduct.id,
      productionQuantity: 10,
      assignedEmployeeIds: [emp1.id],
      batchAllocations: [
        {
          batchId: batch.id,
          quantity: 20,
        },
      ],
      userId: admin.id,
    });

    // TEST 1: IDOR Protection — Unassigned emp2 attempting to report production on task assigned to emp1
    try {
      await taskServices.reportProduction({
        taskId: task.id,
        completedQuantity: 5,
        userId: emp2.id,
        userRole: 'EMPLOYEE',
      });
      testFail('Unassigned employee cannot report production on task', new Error('Allowed unassigned employee'));
    } catch (err: any) {
      assert(err.statusCode === 403 || err.message.includes('Forbidden'), 'Rejects unassigned employee production report');
      testPass('Unassigned employee rejected from reporting production (403 Forbidden)');
    }

    // TEST 2: IDOR Protection — Unassigned emp2 attempting to report damage on task
    try {
      await taskServices.reportDamage({
        taskId: task.id,
        productId: compProduct.id,
        batchId: batch.id,
        quantity: 2,
        reason: 'Malicious damage report',
        userId: emp2.id,
        userRole: 'EMPLOYEE',
      });
      testFail('Unassigned employee cannot report damage on task', new Error('Allowed unassigned damage report'));
    } catch (err: any) {
      assert(err.statusCode === 403 || err.message.includes('Forbidden'), 'Rejects unassigned employee damage report');
      testPass('Unassigned employee rejected from reporting damage (403 Forbidden)');
    }

    // TEST 3: IDOR Protection — Unassigned emp2 attempting to request refill for task
    try {
      await taskServices.requestRefill({
        taskId: task.id,
        productId: compProduct.id,
        quantity: 5,
        reason: 'Malicious refill request',
        userId: emp2.id,
        userRole: 'EMPLOYEE',
      });
      testFail('Unassigned employee cannot request refill for task', new Error('Allowed unassigned refill request'));
    } catch (err: any) {
      assert(err.statusCode === 403 || err.message.includes('Forbidden'), 'Rejects unassigned employee refill request');
      testPass('Unassigned employee rejected from requesting refill (403 Forbidden)');
    }

    // TEST 4: Task Execution Lifecycle & Production Completion Guard
    await taskServices.acceptTask(task.id, emp1.id, 'EMPLOYEE');
    await taskServices.startTask(task.id, emp1.id, 'EMPLOYEE');

    // emp1 completes all 10 units
    await taskServices.reportProduction({
      taskId: task.id,
      completedQuantity: 10,
      notes: 'Full production complete',
      userId: emp1.id,
      userRole: 'EMPLOYEE',
    });

    const completedTask = await taskServices.getTaskById(task.id);
    assert(completedTask.status === 'COMPLETED', 'Task status transitions to COMPLETED');
    testPass('Task status transitions to COMPLETED when full quantity produced');

    // TEST 5: Business Rule Guard — Cannot report production on a COMPLETED task
    try {
      await taskServices.reportProduction({
        taskId: task.id,
        completedQuantity: 1,
        notes: 'Extra production after complete',
        userId: emp1.id,
        userRole: 'EMPLOYEE',
      });
      testFail('Completed task cannot receive additional production', new Error('Allowed production on COMPLETED task'));
    } catch (err: any) {
      assert(err.statusCode === 400 || err.message.includes('COMPLETED'), 'Rejects production on COMPLETED task');
      testPass('Production attempt on COMPLETED task rejected (400 Bad Request)');
    }

    // TEST 6: Business Rule Guard — Cannot report production on a CANCELLED task
    const task2 = await taskServices.createTask({
      title: `P9 Cancelled Task ${uniqueId}`,
      productId: finishedProduct.id,
      productionQuantity: 5,
      assignedEmployeeIds: [emp1.id],
      batchAllocations: [
        {
          batchId: batch.id,
          quantity: 10,
        },
      ],
      userId: admin.id,
    });

    await taskServices.acceptTask(task2.id, emp1.id, 'EMPLOYEE');
    await taskServices.cancelTask(task2.id, admin.id);

    try {
      await taskServices.reportProduction({
        taskId: task2.id,
        completedQuantity: 2,
        userId: emp1.id,
        userRole: 'EMPLOYEE',
      });
      testFail('Cancelled task cannot receive production', new Error('Allowed production on CANCELLED task'));
    } catch (err: any) {
      assert(err.statusCode === 400 || err.message.includes('CANCELLED'), 'Rejects production on CANCELLED task');
      testPass('Production attempt on CANCELLED task rejected (400 Bad Request)');
    }

    // TEST 7: Payroll Overpayment Security Guard
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;

    // Record attendance for emp1 to generate earnings
    await prisma.attendance.create({
      data: {
        employeeId: emp1.id,
        date: new Date(Date.UTC(curYear, curMonth - 1, 15, 0, 0, 0, 0)),
        checkIn: new Date(Date.UTC(curYear, curMonth - 1, 15, 9, 0, 0, 0)),
        checkOut: new Date(Date.UTC(curYear, curMonth - 1, 15, 17, 0, 0, 0)),
        workedHours: 8.0,
        requiredHours: 8.0,
        calculatedHours: 8.0,
        overtimeHours: 0,
        overtimeStatus: 'APPROVED',
      },
    });

    const emp1Summary = await payrollServices.getEmployeePayrollSummary(emp1.id, curYear, curMonth);
    const balance = emp1Summary.remainingBalance;

    try {
      await payrollServices.createSalaryPayment(
        {
          employeeId: emp1.id,
          year: curYear,
          month: curMonth,
          amount: balance + 500, // Overpay attempt
          note: 'Overpay test',
        },
        admin.id
      );
      testFail('Salary payment cannot exceed remaining balance', new Error('Allowed overpayment'));
    } catch (err: any) {
      assert(err.statusCode === 400 || err.message.includes('exceeds'), 'Rejects salary overpayment');
      testPass('Salary payment exceeding remaining balance rejected (400 Bad Request)');
    }

    // TEST 8: Atomic Transaction Safety Verification
    const initialCompStock = (await prisma.product.findUnique({ where: { id: compProduct.id } }))?.currentStock;
    try {
      await (prisma as any).$transaction(async (tx: any) => {
        await tx.product.update({
          where: { id: compProduct.id },
          data: { currentStock: { decrement: 10 } },
        });
        throw new Error('Simulated atomic transaction failure');
      });
    } catch (err: any) {
      assert(err.message === 'Simulated atomic transaction failure', 'Transaction rolled back as expected');
    }

    const postRollbackCompStock = (await prisma.product.findUnique({ where: { id: compProduct.id } }))?.currentStock;
    assert(Number(initialCompStock) === Number(postRollbackCompStock), 'Database stock remains untouched after transaction rollback');
    testPass('Database state remains unchanged after transaction rollback');

    // Clean up test data
    await prisma.salaryPayment.deleteMany({ where: { employeeId: { in: [emp1.id, emp2.id] } } });
    await prisma.attendance.deleteMany({ where: { employeeId: { in: [emp1.id, emp2.id] } } });
    await prisma.productRequest.deleteMany({ where: { requestedById: { in: [emp1.id, emp2.id] } } });
    await prisma.taskRequiredProduct.deleteMany({ where: { task: { createdById: admin.id } } });
    await prisma.taskAssignment.deleteMany({ where: { employeeId: { in: [emp1.id, emp2.id] } } });
    await prisma.taskBatchAllocation.deleteMany({ where: { task: { createdById: admin.id } } });
    await prisma.stockMovement.deleteMany({ where: { performedById: { in: [admin.id, emp1.id, emp2.id] } } });
    await prisma.inventoryBatch.deleteMany({ where: { createdById: admin.id } });
    await prisma.task.deleteMany({ where: { createdById: admin.id } });
    await prisma.employeeProfile.deleteMany({ where: { userId: { in: [emp1.id, emp2.id] } } });
    await prisma.product.deleteMany({ where: { id: { in: [compProduct.id, finishedProduct.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, emp1.id, emp2.id] } } });

    console.log(`\n📊 Phase 9 Test Results: ${passed} Passed, ${failed} Failed`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error('\n💥 Phase 9 test suite crashed:', err);
    process.exit(1);
  }
}

runPhase9Tests();
