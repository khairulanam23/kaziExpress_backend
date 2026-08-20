import prisma from '../../utils/prisma/prisma-client';
import ApiError from '../../utils/errors/api-error';
import { payrollServices } from '../payroll/payroll.service';

export const reportServices = {
  /**
   * 1. Inventory Report
   */
  getInventoryReport: async (query: {
    itemType?: 'COMPONENT' | 'PRODUCT';
    categoryId?: string;
    vendorId?: string;
    status?: 'ACTIVE' | 'DISCONTINUED' | 'ALL';
  }) => {
    const where: any = {};

    if (query.itemType) {
      where.itemType = query.itemType;
    }

    if (query.status === 'ACTIVE' || !query.status) {
      where.isDiscontinued = false;
    } else if (query.status === 'DISCONTINUED') {
      where.isDiscontinued = true;
    }

    if (query.categoryId) {
      where.OR = [
        { categoryId: query.categoryId },
        { categories: { some: { id: query.categoryId } } },
      ];
    }

    if (query.vendorId) {
      where.OR = [
        { vendorId: query.vendorId },
        { vendors: { some: { id: query.vendorId } } },
      ];
    }

    const items = await prisma.product.findMany({
      where,
      include: {
        category: true,
        vendor: true,
        categories: true,
        vendors: true,
      },
      orderBy: { name: 'asc' },
    });

    const totalItems = items.length;
    let totalComponents = 0;
    let totalProducts = 0;
    let totalQuantity = 0;
    let totalValue = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    const categoryMap = new Map<string, { name: string; count: number; value: number }>();
    const vendorMap = new Map<string, { name: string; count: number; value: number }>();

    for (const item of items) {
      const stock = Number(item.currentStock || 0);
      const price = Number(item.unitPrice || 0);
      const val = stock * price;
      const threshold = item.lowStockThreshold !== null ? Number(item.lowStockThreshold) : 0;

      if (item.itemType === 'COMPONENT') totalComponents++;
      if (item.itemType === 'PRODUCT') totalProducts++;

      totalQuantity += stock;
      totalValue += val;

      if (stock <= 0) {
        outOfStockCount++;
      } else if (item.lowStockThreshold !== null && stock <= threshold) {
        lowStockCount++;
      }

      const itemCats = [...(item.categories || [])];
      if (item.category && !itemCats.some((c) => c.id === item.category!.id)) {
        itemCats.push(item.category);
      }

      for (const cat of itemCats) {
        const existing = categoryMap.get(cat.id) || { name: cat.name, count: 0, value: 0 };
        categoryMap.set(cat.id, {
          name: cat.name,
          count: existing.count + 1,
          value: existing.value + val,
        });
      }

      const itemVendors = [...(item.vendors || [])];
      if (item.vendor && !itemVendors.some((v) => v.id === item.vendor!.id)) {
        itemVendors.push(item.vendor);
      }

      for (const v of itemVendors) {
        const existing = vendorMap.get(v.id) || { name: v.name, count: 0, value: 0 };
        vendorMap.set(v.id, {
          name: v.name,
          count: existing.count + 1,
          value: existing.value + val,
        });
      }
    }

    const recentMovements = await prisma.stockMovement.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        performedBy: { select: { id: true, name: true } },
      },
    });

    return {
      summary: {
        totalItems,
        totalComponents,
        totalProducts,
        totalQuantity,
        totalValue,
        lowStockCount,
        outOfStockCount,
      },
      byCategory: Array.from(categoryMap.values()),
      byVendor: Array.from(vendorMap.values()),
      recentMovements,
      items,
    };
  },

  /**
   * 2. Stock Movement Report (Audit Report)
   */
  getStockMovementReport: async (query: {
    from?: string;
    to?: string;
    productId?: string;
    type?: string;
    performedById?: string;
    taskId?: string;
    batchId?: string;
    page?: number;
    limit?: number;
  }) => {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(`${query.from}T00:00:00.000Z`);
      if (query.to) where.createdAt.lte = new Date(`${query.to}T23:59:59.999Z`);
    }

    if (query.productId) where.productId = query.productId;
    if (query.type) where.type = query.type;
    if (query.performedById) where.performedById = query.performedById;
    if (query.taskId) where.relatedTaskId = query.taskId;
    if (query.batchId) where.batchId = query.batchId;

    const [movements, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true } },
          performedBy: { select: { id: true, name: true, email: true } },
          batch: { select: { id: true, batchNumber: true } },
          relatedTask: { select: { id: true, title: true } },
        },
      }),
      prisma.stockMovement.count({ where }),
    ]);

    return {
      movements,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * 3. Production Report
   */
  getProductionReport: async (query: {
    from?: string;
    to?: string;
    employeeId?: string;
    productId?: string;
    status?: string;
  }) => {
    const where: any = {};

    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(`${query.from}T00:00:00.000Z`);
      if (query.to) where.createdAt.lte = new Date(`${query.to}T23:59:59.999Z`);
    }

    if (query.productId) where.productId = query.productId;
    if (query.status) where.status = query.status;

    if (query.employeeId) {
      where.assignments = {
        some: { employeeId: query.employeeId },
      };
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        assignments: { include: { employee: { select: { id: true, name: true, email: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalTasks = tasks.length;
    let completedTasks = 0;
    let partiallyCompletedTasks = 0;
    let cancelledTasks = 0;
    let pendingTasks = 0;
    let inProgressTasks = 0;
    let totalPlannedQuantity = 0;
    let totalCompletedQuantity = 0;
    let totalRemainingQuantity = 0;

    const employeeMap = new Map<
      string,
      { employeeName: string; email: string; assignedTasks: number; completedTasks: number; plannedQty: number; completedQty: number }
    >();

    for (const task of tasks) {
      const planned = Number(task.productionQuantity || 0);
      const done = Number(task.completedQuantity || 0);
      const remaining = Number(task.remainingQuantity || 0);

      totalPlannedQuantity += planned;
      totalCompletedQuantity += done;
      totalRemainingQuantity += remaining;

      if (task.status === 'COMPLETED') completedTasks++;
      if (task.status === 'PARTIALLY_COMPLETED') partiallyCompletedTasks++;
      if (task.status === 'CANCELLED') cancelledTasks++;
      if (task.status === 'PENDING') pendingTasks++;
      if (task.status === 'IN_PROGRESS') inProgressTasks++;

      for (const a of task.assignments) {
        const emp = a.employee;
        const existing = employeeMap.get(emp.id) || {
          employeeName: emp.name || '',
          email: emp.email,
          assignedTasks: 0,
          completedTasks: 0,
          plannedQty: 0,
          completedQty: 0,
        };

        existing.assignedTasks++;
        if (task.status === 'COMPLETED') existing.completedTasks++;
        existing.plannedQty += planned;
        existing.completedQty += done;

        employeeMap.set(emp.id, existing);
      }
    }

    const completionPercentage = totalPlannedQuantity > 0 ? Number(((totalCompletedQuantity / totalPlannedQuantity) * 100).toFixed(1)) : 0;

    const employeeSummaries = Array.from(employeeMap.entries()).map(([employeeId, data]) => {
      const remainingQty = Math.max(0, data.plannedQty - data.completedQty);
      const pct = data.plannedQty > 0 ? Number(((data.completedQty / data.plannedQty) * 100).toFixed(1)) : 0;
      return {
        employeeId,
        ...data,
        remainingQty,
        completionPercentage: pct,
      };
    });

    return {
      summary: {
        totalTasks,
        completedTasks,
        partiallyCompletedTasks,
        cancelledTasks,
        pendingTasks,
        inProgressTasks,
        totalPlannedQuantity,
        totalCompletedQuantity,
        totalRemainingQuantity,
        completionPercentage,
      },
      employeeSummaries,
      tasks,
    };
  },

  /**
   * 4. Attendance Report
   */
  getAttendanceReport: async (query: { from?: string; to?: string; employeeId?: string }) => {
    const now = new Date();
    const fromStr = query.from || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const toStr = query.to || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`;

    const where: any = {
      date: {
        gte: new Date(`${fromStr}T00:00:00.000Z`),
        lte: new Date(`${toStr}T23:59:59.999Z`),
      },
    };

    if (query.employeeId) {
      where.employeeId = query.employeeId;
    }

    const records = await prisma.attendance.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, email: true } },
      },
      orderBy: { date: 'desc' },
    });

    const activeEmployees = await prisma.user.findMany({
      where: query.employeeId ? { id: query.employeeId } : { role: 'EMPLOYEE', isActive: true },
      select: { id: true, name: true, email: true },
    });

    const empSummaryMap = new Map<
      string,
      {
        employeeName: string;
        email: string;
        daysAttended: number;
        workedHours: number;
        requiredHours: number;
        overtimeHours: number;
        approvedOvertimeHours: number;
        rejectedOvertimeHours: number;
        pendingOvertimeHours: number;
        lateOccurrences: number;
      }
    >();

    for (const emp of activeEmployees) {
      empSummaryMap.set(emp.id, {
        employeeName: emp.name || '',
        email: emp.email,
        daysAttended: 0,
        workedHours: 0,
        requiredHours: 0,
        overtimeHours: 0,
        approvedOvertimeHours: 0,
        rejectedOvertimeHours: 0,
        pendingOvertimeHours: 0,
        lateOccurrences: 0,
      });
    }

    let totalWorkedHours = 0;
    let totalApprovedOvertime = 0;
    let totalDaysAttended = 0;

    for (const rec of records) {
      const summary = empSummaryMap.get(rec.employeeId);
      if (summary) {
        if (rec.checkIn) {
          summary.daysAttended++;
          totalDaysAttended++;
        }

        const worked = Number(rec.workedHours || 0);
        const req = Number(rec.requiredHours || 8.0);
        const ot = Number(rec.overtimeHours || 0);

        summary.workedHours += worked;
        summary.requiredHours += req;
        summary.overtimeHours += ot;
        totalWorkedHours += worked;

        if (rec.overtimeStatus === 'APPROVED') {
          const approvedOt = Number(rec.adminOvertimeHours ?? ot);
          summary.approvedOvertimeHours += approvedOt;
          totalApprovedOvertime += approvedOt;
        } else if (rec.overtimeStatus === 'REJECTED') {
          summary.rejectedOvertimeHours += ot;
        } else if (rec.overtimeStatus === 'PENDING') {
          summary.pendingOvertimeHours += ot;
        }

        if (rec.checkIn) {
          const checkInDate = new Date(rec.checkIn);
          if (checkInDate.getUTCHours() > 9 || (checkInDate.getUTCHours() === 9 && checkInDate.getUTCMinutes() > 15)) {
            summary.lateOccurrences++;
          }
        }
      }
    }

    return {
      period: { from: fromStr, to: toStr },
      summary: {
        totalEmployees: activeEmployees.length,
        totalDaysAttended,
        totalWorkedHours: Number(totalWorkedHours.toFixed(2)),
        totalApprovedOvertime: Number(totalApprovedOvertime.toFixed(2)),
      },
      employeeSummaries: Array.from(empSummaryMap.entries()).map(([employeeId, data]) => ({
        employeeId,
        employeeName: data.employeeName,
        email: data.email,
        daysAttended: data.daysAttended,
        workedHours: Number(data.workedHours.toFixed(2)),
        requiredHours: Number(data.requiredHours.toFixed(2)),
        overtimeHours: Number(data.overtimeHours.toFixed(2)),
        approvedOvertimeHours: Number(data.approvedOvertimeHours.toFixed(2)),
        rejectedOvertimeHours: Number(data.rejectedOvertimeHours.toFixed(2)),
        pendingOvertimeHours: Number(data.pendingOvertimeHours.toFixed(2)),
        lateOccurrences: data.lateOccurrences,
      })),
      records,
    };
  },

  /**
   * 5. Payroll Report
   */
  getPayrollReport: async (query: { year?: number; month?: number; employeeId?: string }) => {
    const now = new Date();
    const year = query.year || now.getFullYear();
    const month = query.month || now.getMonth() + 1;

    const overview = await payrollServices.getMonthlyPayrollOverview(year, month);

    let summaries = overview.summaries;
    if (query.employeeId) {
      summaries = summaries.filter((s) => s.employee.id === query.employeeId);
    }

    let unpaidEmployees = 0;
    let partiallyPaidEmployees = 0;
    let fullyPaidEmployees = 0;

    for (const s of summaries) {
      if (s.status === 'UNPAID') unpaidEmployees++;
      if (s.status === 'PARTIALLY_PAID') partiallyPaidEmployees++;
      if (s.status === 'PAID') fullyPaidEmployees++;
    }

    return {
      period: { year, month },
      summary: {
        totalEmployees: summaries.length,
        totalEarned: overview.totals.totalEarned,
        totalPaid: overview.totals.totalPaid,
        totalRemaining: overview.totals.totalRemaining,
        totalApprovedOvertimeEarnings: overview.totals.totalOvertimeEarnings,
        unpaidEmployees,
        partiallyPaidEmployees,
        fullyPaidEmployees,
      },
      employeeBreakdown: summaries.map((s) => ({
        employee: s.employee,
        hourlyRate: s.hourlyRate,
        workedHours: s.workedHoursTotal,
        regularEarnings: s.regularEarnings,
        approvedOvertimeHours: s.approvedOvertimeHours,
        overtimeEarnings: s.overtimeEarnings,
        totalEarned: s.totalEarned,
        totalPaid: s.salaryPaid,
        remainingBalance: s.remainingBalance,
        paymentStatus: s.status,
      })),
    };
  },

  /**
   * 6. Employee Performance Report
   */
  getEmployeePerformanceReport: async (employeeId: string, query: { from?: string; to?: string }) => {
    const employee = await prisma.user.findUnique({
      where: { id: employeeId },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });

    if (!employee) throw ApiError.notFound('Employee not found');

    const attReport = await reportServices.getAttendanceReport({ ...query, employeeId });
    const prodReport = await reportServices.getProductionReport({ ...query, employeeId });

    const now = new Date();
    const year = query.from ? new Date(query.from).getFullYear() : now.getFullYear();
    const month = query.from ? new Date(query.from).getMonth() + 1 : now.getMonth() + 1;
    const payrollSummary = await payrollServices.getEmployeePayrollSummary(employeeId, year, month);

    const empAtt = attReport.employeeSummaries[0] || {
      daysAttended: 0,
      workedHours: 0,
      overtimeHours: 0,
      approvedOvertimeHours: 0,
      lateOccurrences: 0,
    };

    const empProd = prodReport.employeeSummaries[0] || {
      assignedTasks: 0,
      completedTasks: 0,
      plannedQty: 0,
      completedQty: 0,
      completionPercentage: 0,
    };

    return {
      employee,
      period: {
        from: attReport.period.from,
        to: attReport.period.to,
      },
      attendance: {
        daysAttended: empAtt.daysAttended,
        totalWorkedHours: empAtt.workedHours,
        overtimeHours: empAtt.overtimeHours,
        approvedOvertimeHours: empAtt.approvedOvertimeHours,
        lateOccurrences: empAtt.lateOccurrences,
      },
      production: {
        assignedTasks: empProd.assignedTasks,
        completedTasks: empProd.completedTasks,
        cancelledTasks: prodReport.summary.cancelledTasks,
        plannedQuantity: empProd.plannedQty,
        completedQuantity: empProd.completedQty,
        completionRate: empProd.completionPercentage,
      },
      payroll: {
        year,
        month,
        totalEarned: payrollSummary.totalEarned,
        paidAmount: payrollSummary.salaryPaid,
        remainingBalance: payrollSummary.remainingBalance,
      },
    };
  },
};
