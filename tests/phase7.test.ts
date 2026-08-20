import prisma from '../src/utils/prisma/prisma-client';
import { notificationServices } from '../src/modules/notifications/notification.service';
import { taskServices } from '../src/modules/tasks/tasks.service';
import { attendanceServices } from '../src/modules/attendance/attendance.service';
import { payrollServices } from '../src/modules/payroll/payroll.service';
import { productServices } from '../src/modules/products/products.service';
import bcrypt from 'bcryptjs';

async function runPhase7Tests() {
  console.log('🧪 Starting Backend Phase 7 Test Suite...\n');

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
    const adminEmail = `phase7.admin.${Date.now()}@example.com`;
    const emp1Email = `phase7.emp1.${Date.now()}@example.com`;
    const emp2Email = `phase7.emp2.${Date.now()}@example.com`;
    const passwordHash = await bcrypt.hash('password123', 10);

    const admin = await prisma.user.create({
      data: { email: adminEmail, password: passwordHash, role: 'ADMIN', name: 'Phase7 Admin' },
    });

    const emp1 = await prisma.user.create({
      data: { email: emp1Email, password: passwordHash, role: 'EMPLOYEE', name: 'Rahim' },
    });

    const emp2 = await prisma.user.create({
      data: { email: emp2Email, password: passwordHash, role: 'EMPLOYEE', name: 'Karim' },
    });

    await prisma.employeeProfile.create({
      data: { userId: emp1.id, hourlyRate: 100.0 },
    });

    // 1. Notification Creation & CRUD
    const n1 = await notificationServices.create(
      emp1.id,
      'Welcome Notification',
      'Welcome to the system!',
      '/dashboard'
    );
    assert(n1.id !== undefined && n1.isRead === false, 'Notification created with default isRead = false');

    const n2 = await notificationServices.create(
      emp1.id,
      'Second Notification',
      'This is your second alert',
      '/tasks'
    );

    // List notifications with pagination
    const listRes = await notificationServices.getUserNotifications(emp1.id, { page: 1, limit: 10 });
    assert(listRes.data.length === 2 && listRes.meta.total === 2, 'List notifications returns paginated user records');

    // Quick 5 notifications
    const quickRes = await notificationServices.getQuickNotifications(emp1.id);
    assert(quickRes.length === 2, 'Quick notifications returns top newest notifications');

    // Unread count
    const countRes = await notificationServices.getUnreadCount(emp1.id);
    assert(countRes.count === 2, 'Unread count correctly counts active unread notifications (2)');

    // Mark 1 as read
    const readN1 = await notificationServices.markAsRead(n1.id, emp1.id);
    assert(readN1.isRead === true, 'Mark one notification as read updates isRead to true');

    const countAfterOneRead = await notificationServices.getUnreadCount(emp1.id);
    assert(countAfterOneRead.count === 1, 'Unread count decreases to 1 after marking one read');

    // Mark all as read
    await notificationServices.markAllAsRead(emp1.id);
    const countAfterAllRead = await notificationServices.getUnreadCount(emp1.id);
    assert(countAfterAllRead.count === 0, 'Mark all as read sets unread count to 0');

    // Delete notification
    await notificationServices.deleteNotification(n1.id, emp1.id);
    const listAfterDelete = await notificationServices.getUserNotifications(emp1.id, { page: 1, limit: 10 });
    assert(listAfterDelete.data.length === 1, 'Delete notification removes target notification');

    // 2. Security & IDOR Checks
    try {
      await notificationServices.markAsRead(n2.id, emp2.id); // emp2 trying to mark emp1's notification
      assert(false, 'Employee cannot mark another user notification as read');
    } catch (err: any) {
      assert(err.statusCode === 403, 'Attempting to mark another user notification read returns 403 Forbidden');
    }

    try {
      await notificationServices.deleteNotification(n2.id, emp2.id); // emp2 trying to delete emp1's notification
      assert(false, 'Employee cannot delete another user notification');
    } catch (err: any) {
      assert(err.statusCode === 403, 'Attempting to delete another user notification returns 403 Forbidden');
    }

    // 3. Duplicate Protection / Idempotency
    const eventKey = 'UNIQUE_EVENT_TEST_KEY_123';
    const dup1 = await notificationServices.create(emp1.id, 'Idempotent Event', 'Message 1', '/test', eventKey);
    const dup2 = await notificationServices.create(emp1.id, 'Idempotent Event', 'Message 1', '/test', eventKey);
    assert(dup1.id === dup2.id, 'Duplicate notification creation with same eventKey returns existing notification without duplicate DB entry');

    // 4. Retention & Cleanup (28-day expiration)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const oldNotif = await prisma.notification.create({
      data: {
        userId: emp1.id,
        title: 'Expired Notification',
        message: 'This is 30 days old',
        createdAt: thirtyDaysAgo,
      },
    });

    const activeList = await notificationServices.getUserNotifications(emp1.id, { page: 1, limit: 50 });
    const hasOldNotif = activeList.data.some((n) => n.id === oldNotif.id);
    assert(!hasOldNotif, 'Notifications older than 28 days are excluded from user queries');

    const cleanupRes = await notificationServices.deleteExpiredNotifications();
    assert(cleanupRes.deletedCount >= 1, 'Cleanup operation safely purges notifications older than 28 days');

    // 5. Automatic Business Event Triggers

    // A. Inventory Low Stock Alert
    const comp = await prisma.product.create({
      data: {
        name: `Phase7 Wire ${Date.now()}`,
        sku: `P7-WIRE-${Date.now()}`,
        itemType: 'COMPONENT',
        unit: 'METER',
        unitPrice: 50,
        currentStock: 3,
        lowStockThreshold: 10,
      },
    });

    await productServices.checkAndNotifyLowStock(comp.id);
    const adminNotifs = await notificationServices.getUserNotifications(admin.id, { page: 1, limit: 10 });
    const lowStockNotif = adminNotifs.data.find((n) => n.title.includes('Low Stock Alert'));
    assert(lowStockNotif !== undefined, 'Low Stock alert automatically generates notification for admins');

    // B. Production Task Triggers (Created/Assigned, Accepted, Started, Completed, Cancelled)
    const task = await taskServices.createTask({
      title: `Phase7 Assembly Task ${Date.now()}`,
      productId: comp.id,
      productionQuantity: 20,
      assignedEmployeeIds: [emp1.id],
      userId: admin.id,
    });

    const emp1NotifsAfterAssign = await notificationServices.getUserNotifications(emp1.id, { page: 1, limit: 10 });
    const assignNotif = emp1NotifsAfterAssign.data.find((n) => n.title.includes('New Task Assigned'));
    assert(assignNotif !== undefined, 'Task creation generates "New Task Assigned" notification for assigned employee');

    // Task Accepted
    await taskServices.acceptTask(task.id, emp1.id, 'EMPLOYEE');
    const adminNotifsAfterAccept = await notificationServices.getUserNotifications(admin.id, { page: 1, limit: 10 });
    const acceptNotif = adminNotifsAfterAccept.data.find((n) => n.title.includes('Task Accepted'));
    assert(acceptNotif !== undefined, 'Task acceptance generates notification for admins');

    // Task Started
    await taskServices.startTask(task.id, emp1.id, 'EMPLOYEE');
    const adminNotifsAfterStart = await notificationServices.getUserNotifications(admin.id, { page: 1, limit: 10 });
    const startNotif = adminNotifsAfterStart.data.find((n) => n.title.includes('Task Started'));
    assert(startNotif !== undefined, 'Task start generates notification for admins');

    // Partial Production
    await taskServices.reportProduction({ taskId: task.id, completedQuantity: 10, userId: emp1.id });
    const adminNotifsAfterPartial = await notificationServices.getUserNotifications(admin.id, { page: 1, limit: 10 });
    const partialNotif = adminNotifsAfterPartial.data.find((n) => n.title.includes('Partial Production'));
    assert(partialNotif !== undefined, 'Partial production report generates notification for admins');

    // Task Completed
    await taskServices.reportProduction({ taskId: task.id, completedQuantity: 10, userId: emp1.id });
    const adminNotifsAfterComplete = await notificationServices.getUserNotifications(admin.id, { page: 1, limit: 10 });
    const completeNotif = adminNotifsAfterComplete.data.find((n) => n.title.includes('Task Completed'));
    assert(completeNotif !== undefined, 'Task completion generates notification for admins');

    // C. Refill Request Triggers
    const refillTask = await taskServices.createTask({
      title: `Phase7 Refill Task ${Date.now()}`,
      productId: comp.id,
      productionQuantity: 10,
      assignedEmployeeIds: [emp1.id],
      userId: admin.id,
    });

    const refillReq = await taskServices.requestRefill({
      taskId: refillTask.id,
      productId: comp.id,
      quantity: 5,
      reason: 'Need extra wire',
      userId: emp1.id,
    });

    const adminNotifsAfterRefillReq = await notificationServices.getUserNotifications(admin.id, { page: 1, limit: 10 });
    const refillReqNotif = adminNotifsAfterRefillReq.data.find((n) => n.title.includes('New Refill Request'));
    assert(refillReqNotif !== undefined, 'New refill request generates notification for admins');

    await taskServices.decideRefill({
      requestId: refillReq.id,
      status: 'APPROVED',
      userId: admin.id,
    });

    const emp1NotifsAfterRefillDec = await notificationServices.getUserNotifications(emp1.id, { page: 1, limit: 10 });
    const refillAppNotif = emp1NotifsAfterRefillDec.data.find((n) => n.title.includes('Refill Request Approved'));
    assert(refillAppNotif !== undefined, 'Refill request approval generates notification for requesting employee');

    // Task Cancelled
    const cancelTaskObj = await taskServices.createTask({
      title: `Phase7 Cancel Task ${Date.now()}`,
      productId: comp.id,
      productionQuantity: 5,
      assignedEmployeeIds: [emp1.id],
      userId: admin.id,
    });

    await taskServices.cancelTask(cancelTaskObj.id, admin.id);
    const emp1NotifsAfterCancel = await notificationServices.getUserNotifications(emp1.id, { page: 1, limit: 10 });
    const cancelNotif = emp1NotifsAfterCancel.data.find((n) => n.title.includes('Task Cancelled'));
    assert(cancelNotif !== undefined, 'Task cancellation generates notification for affected employee');

    // D. Overtime Decision Trigger
    await attendanceServices.checkIn(emp1.id, { timestamp: new Date('2026-08-10T09:00:00.000Z') });
    const attOut = await attendanceServices.checkOut(emp1.id, { timestamp: new Date('2026-08-10T19:00:00.000Z') });

    await attendanceServices.decideOvertime(attOut.id, { status: 'APPROVED' }, admin.id);
    const emp1NotifsAfterOT = await notificationServices.getUserNotifications(emp1.id, { page: 1, limit: 10 });
    const otNotif = emp1NotifsAfterOT.data.find((n) => n.title.includes('Overtime Decision Updated'));
    assert(otNotif !== undefined, 'Overtime decision generates notification for employee');

    // E. Salary Payment Trigger
    await payrollServices.createSalaryPayment(
      { employeeId: emp1.id, year: 2026, month: 8, amount: 500, note: 'Partial payment' },
      admin.id
    );
    const emp1NotifsAfterPay = await notificationServices.getUserNotifications(emp1.id, { page: 1, limit: 10 });
    const payNotif = emp1NotifsAfterPay.data.find((n) => n.title.includes('Salary Payment Received'));
    assert(payNotif !== undefined, 'Salary payment creation generates notification for employee');

    // Clean up test data
    await prisma.notification.deleteMany({ where: { userId: { in: [admin.id, emp1.id, emp2.id] } } });
    await prisma.salaryPayment.deleteMany({ where: { employeeId: { in: [emp1.id, emp2.id] } } });
    await prisma.productRequest.deleteMany({ where: { requestedById: { in: [admin.id, emp1.id, emp2.id] } } });
    await prisma.taskRequiredProduct.deleteMany({ where: { task: { createdById: admin.id } } });
    await prisma.taskAssignment.deleteMany({ where: { employeeId: { in: [emp1.id, emp2.id] } } });
    await prisma.taskBatchAllocation.deleteMany({ where: { task: { createdById: admin.id } } });
    await prisma.stockMovement.deleteMany({ where: { performedById: { in: [admin.id, emp1.id, emp2.id] } } });
    await prisma.task.deleteMany({ where: { createdById: admin.id } });
    await prisma.attendance.deleteMany({ where: { employeeId: { in: [emp1.id, emp2.id] } } });
    await prisma.employeeProfile.deleteMany({ where: { userId: { in: [emp1.id, emp2.id] } } });
    await prisma.product.delete({ where: { id: comp.id } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, emp1.id, emp2.id] } } });

    console.log(`\n📊 Phase 7 Test Results: ${passed} Passed, ${failed} Failed`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('💥 Phase 7 test suite crashed:', err);
    process.exit(1);
  }
}

runPhase7Tests();
