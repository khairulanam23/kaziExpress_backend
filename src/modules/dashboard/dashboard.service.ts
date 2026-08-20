import prisma from '../../utils/prisma/prisma-client';
import { payrollServices } from '../payroll/payroll.service';
import { notificationServices } from '../notifications/notification.service';

export const dashboardServices = {
  /**
   * Admin Dashboard Overview API.
   * Returns current inventory state & period-filtered historical metrics.
   */
  getAdminDashboardOverview: async (adminId: string, fromStr?: string, toStr?: string) => {
    const now = new Date();
    const fromDate = fromStr ? new Date(`${fromStr}T00:00:00.000Z`) : new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    const toDate = toStr ? new Date(`${toStr}T23:59:59.999Z`) : new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999));

    const todayStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
    const todayEnd = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999));

    // 1. Inventory Metrics (Current database state)
    const activeProducts = await prisma.product.findMany({
      where: { isDiscontinued: false },
      select: { id: true, itemType: true, currentStock: true, unitPrice: true, lowStockThreshold: true },
    });

    const totalActiveItems = activeProducts.length;
    let totalComponents = 0;
    let totalFinishedProducts = 0;
    let totalInventoryQuantity = 0;
    let totalInventoryValue = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    for (const p of activeProducts) {
      const stock = Number(p.currentStock || 0);
      const price = Number(p.unitPrice || 0);
      const threshold = p.lowStockThreshold !== null ? Number(p.lowStockThreshold) : 0;

      if (p.itemType === 'COMPONENT') totalComponents++;
      if (p.itemType === 'PRODUCT') totalFinishedProducts++;

      totalInventoryQuantity += stock;
      totalInventoryValue += stock * price;

      if (stock <= 0) {
        outOfStockCount++;
      } else if (p.lowStockThreshold !== null && stock <= threshold) {
        lowStockCount++;
      }
    }

    const recentStockMovements = await prisma.stockMovement.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        product: { select: { id: true, name: true, sku: true } },
        performedBy: { select: { id: true, name: true } },
      },
    });

    // 2. Production Metrics
    const taskStatusCounts = await prisma.task.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    const statusMap: Record<string, number> = {};
    for (const item of taskStatusCounts) {
      statusMap[item.status] = item._count.id;
    }

    const pendingTasks = statusMap['PENDING'] || 0;
    const acceptedTasks = statusMap['ACCEPTED'] || 0;
    const inProgressTasks = statusMap['IN_PROGRESS'] || 0;
    const partiallyCompletedTasks = statusMap['PARTIALLY_COMPLETED'] || 0;
    const completedTasks = statusMap['COMPLETED'] || 0;
    const cancelledTasks = statusMap['CANCELLED'] || 0;
    const totalActiveProductionTasks = pendingTasks + acceptedTasks + inProgressTasks + partiallyCompletedTasks;

    const completedQuantityAggregation = await prisma.stockMovement.aggregate({
      where: {
        type: 'ASSEMBLY',
        createdAt: { gte: fromDate, lte: toDate },
      },
      _sum: { quantity: true },
    });
    const productionQuantityCompletedInPeriod = Number(completedQuantityAggregation._sum?.quantity || 0);

    // 3. Employee Metrics
    const totalActiveEmployees = await prisma.user.count({
      where: { role: 'EMPLOYEE', isActive: true },
    });

    const checkedInToday = await prisma.attendance.count({
      where: {
        date: { gte: todayStart, lte: todayEnd },
        checkIn: { not: null },
        checkOut: null,
      },
    });

    const attendedOrCheckedInToday = await prisma.attendance.count({
      where: {
        date: { gte: todayStart, lte: todayEnd },
        checkIn: { not: null },
      },
    });

    const employeesCurrentlyAbsent = Math.max(0, totalActiveEmployees - attendedOrCheckedInToday);

    const pendingOvertimeCount = await prisma.attendance.count({
      where: {
        overtimeStatus: 'PENDING',
        overtimeHours: { gt: 0 },
      },
    });

    // 4. Payroll Metrics (Current Month / Period)
    const selectedYear = fromDate.getFullYear();
    const selectedMonth = fromDate.getMonth() + 1;
    const payrollOverview = await payrollServices.getMonthlyPayrollOverview(selectedYear, selectedMonth);

    let unpaidEmployeesCount = 0;
    let partiallyPaidEmployeesCount = 0;
    for (const s of payrollOverview.summaries) {
      if (s.status === 'UNPAID') unpaidEmployeesCount++;
      if (s.status === 'PARTIALLY_PAID') partiallyPaidEmployeesCount++;
    }

    // 5. Notifications Metrics
    const unreadCountRes = await notificationServices.getUnreadCount(adminId);
    const latestNotifications = await notificationServices.getQuickNotifications(adminId);

    return {
      period: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      },
      inventory: {
        totalActiveItems,
        totalComponents,
        totalFinishedProducts,
        totalInventoryQuantity,
        totalInventoryValue,
        lowStockCount,
        outOfStockCount,
        recentStockMovements,
      },
      production: {
        totalActiveProductionTasks,
        pendingTasks,
        acceptedTasks,
        inProgressTasks,
        partiallyCompletedTasks,
        completedTasks,
        cancelledTasks,
        productionQuantityCompletedInPeriod,
      },
      employees: {
        totalActiveEmployees,
        checkedInToday,
        employeesCurrentlyAbsent,
        pendingOvertimeCount,
      },
      payroll: {
        year: selectedYear,
        month: selectedMonth,
        currentMonthTotalEarnings: payrollOverview.totals.totalEarned,
        currentMonthPaidAmount: payrollOverview.totals.totalPaid,
        currentMonthRemainingBalance: payrollOverview.totals.totalRemaining,
        unpaidEmployeesCount,
        partiallyPaidEmployeesCount,
      },
      notifications: {
        unreadCount: unreadCountRes.count,
        latestNotifications,
      },
    };
  },

  /**
   * Employee Dashboard Overview API.
   * Returns employee-specific metrics only.
   */
  getEmployeeDashboardOverview: async (employeeId: string, fromStr?: string, toStr?: string) => {
    const now = new Date();
    const fromDate = fromStr ? new Date(`${fromStr}T00:00:00.000Z`) : new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    const toDate = toStr ? new Date(`${toStr}T23:59:59.999Z`) : new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999));

    const todayStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
    const todayEnd = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999));

    const assignedTasksCount = await prisma.taskAssignment.count({
      where: {
        employeeId,
        task: {
          status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED'] },
        },
      },
    });

    const completedTasksCount = await prisma.taskAssignment.count({
      where: {
        employeeId,
        task: {
          status: 'COMPLETED',
          completedAt: { gte: fromDate, lte: toDate },
        },
      },
    });

    const todayAttendance = await prisma.attendance.findFirst({
      where: {
        employeeId,
        date: { gte: todayStart, lte: todayEnd },
      },
    });

    let todayStatus = 'ABSENT';
    if (todayAttendance) {
      if (todayAttendance.checkIn && !todayAttendance.checkOut) {
        todayStatus = 'CHECKED_IN';
      } else if (todayAttendance.checkIn && todayAttendance.checkOut) {
        todayStatus = 'CHECKED_OUT';
      }
    }

    const selectedYear = fromDate.getFullYear();
    const selectedMonth = fromDate.getMonth() + 1;
    const payrollSummary = await payrollServices.getEmployeePayrollSummary(employeeId, selectedYear, selectedMonth);

    const unreadCountRes = await notificationServices.getUnreadCount(employeeId);
    const latestNotifications = await notificationServices.getQuickNotifications(employeeId);

    return {
      period: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      },
      tasks: {
        assignedActiveTasks: assignedTasksCount,
        completedTasksInPeriod: completedTasksCount,
      },
      attendance: {
        todayStatus,
        todayAttendance,
      },
      payroll: {
        year: selectedYear,
        month: selectedMonth,
        totalEarned: payrollSummary.totalEarned,
        totalPaid: payrollSummary.salaryPaid,
        remainingBalance: payrollSummary.remainingBalance,
      },
      notifications: {
        unreadCount: unreadCountRes.count,
        latestNotifications,
      },
    };
  },
};
