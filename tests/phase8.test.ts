import prisma from '../src/utils/prisma/prisma-client';
import { dashboardServices } from '../src/modules/dashboard/dashboard.service';
import { reportServices } from '../src/modules/reports/reports.service';
import { pdfGenerators } from '../src/utils/pdf/pdf-generator.util';
import { csvExporters } from '../src/utils/csv/csv-exporter.util';
import { taskServices } from '../src/modules/tasks/tasks.service';
import { attendanceServices } from '../src/modules/attendance/attendance.service';
import { payrollServices } from '../src/modules/payroll/payroll.service';
import bcrypt from 'bcryptjs';

async function runPhase8Tests() {
  console.log('🧪 Starting Backend Phase 8 Test Suite...\n');

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
    // 0. Setup test users and data
    const adminEmail = `phase8.admin.${Date.now()}@example.com`;
    const emp1Email = `phase8.emp1.${Date.now()}@example.com`;
    const emp2Email = `phase8.emp2.${Date.now()}@example.com`;
    const passwordHash = await bcrypt.hash('password123', 10);

    const admin = await prisma.user.create({
      data: { email: adminEmail, password: passwordHash, role: 'ADMIN', name: 'Phase8 Admin' },
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

    const category = await prisma.category.create({
      data: { name: `Phase8 Cat ${Date.now()}` },
    });

    const vendor = await prisma.vendor.create({
      data: { name: `Phase8 Vendor ${Date.now()}` },
    });

    const comp = await prisma.product.create({
      data: {
        name: `Phase8 Component ${Date.now()}`,
        sku: `P8-COMP-${Date.now()}`,
        itemType: 'COMPONENT',
        unit: 'PCS',
        unitPrice: 50,
        currentStock: 100,
        lowStockThreshold: 20,
        categories: { connect: [{ id: category.id }] },
        vendors: { connect: [{ id: vendor.id }] },
      },
    });

    // 1. Dashboard Overview API Tests
    const adminOverview = await dashboardServices.getAdminDashboardOverview(admin.id, '2026-08-01', '2026-08-31');
    assert(adminOverview.inventory.totalActiveItems >= 1, 'Admin dashboard returns active items count');
    assert(adminOverview.inventory.totalInventoryValue >= 5000, 'Admin dashboard calculates total inventory value correctly');
    assert(adminOverview.employees.totalActiveEmployees >= 2, 'Admin dashboard counts active employees');

    const empOverview = await dashboardServices.getEmployeeDashboardOverview(emp1.id, '2026-08-01', '2026-08-31');
    assert(empOverview.payroll !== undefined, 'Employee dashboard returns employee-specific payroll metrics');
    assert(empOverview.attendance.todayStatus !== undefined, 'Employee dashboard returns today attendance status');

    // 2. Inventory Reports Tests
    const invReport = await reportServices.getInventoryReport({ categoryId: category.id });
    assert(invReport.summary.totalItems === 1, 'Inventory report filters by category correctly');
    assert(invReport.byCategory.length === 1 && invReport.byCategory[0].name === category.name, 'Inventory report groups items by category');
    assert(invReport.byVendor.length === 1 && invReport.byVendor[0].name === vendor.name, 'Inventory report groups items by vendor');

    const pdfInvBuffer = await pdfGenerators.generateInventoryPDF(invReport);
    assert(Buffer.isBuffer(pdfInvBuffer) && pdfInvBuffer.length > 500, 'Inventory PDF report generated successfully');

    // 3. Stock Movement & CSV Export Tests
    const movement = await prisma.stockMovement.create({
      data: {
        productId: comp.id,
        type: 'ADJUSTMENT',
        quantity: 10,
        previousQuantity: 90,
        newQuantity: 100,
        unitCost: 50,
        totalCost: 500,
        performedById: admin.id,
        reason: 'Initial test adjustment',
      },
    });

    const stockReport = await reportServices.getStockMovementReport({ productId: comp.id });
    assert(stockReport.movements.length >= 1, 'Stock movement report returns audit trail records');

    const csvMovements = csvExporters.exportStockMovementsCSV(stockReport.movements);
    assert(csvMovements.includes('Initial test adjustment') && csvMovements.startsWith('"Timestamp"'), 'Stock movements CSV generated with correct RFC-4180 headers');

    // 4. Production Report Tests
    const task = await taskServices.createTask({
      title: `Phase8 Production Task ${Date.now()}`,
      productId: comp.id,
      productionQuantity: 20,
      assignedEmployeeIds: [emp1.id],
      userId: admin.id,
    });

    await taskServices.acceptTask(task.id, emp1.id, 'EMPLOYEE');
    await taskServices.startTask(task.id, emp1.id, 'EMPLOYEE');
    await taskServices.reportProduction({ taskId: task.id, completedQuantity: 10, userId: emp1.id });

    const prodReport = await reportServices.getProductionReport({ employeeId: emp1.id });
    assert(prodReport.summary.totalPlannedQuantity === 20, 'Production report sums planned quantity correctly');
    assert(prodReport.summary.totalCompletedQuantity === 10, 'Production report sums completed quantity correctly');
    assert(prodReport.summary.completionPercentage === 50, 'Production completion percentage calculated correctly (50%)');

    const pdfProdBuffer = await pdfGenerators.generateProductionPDF(prodReport);
    assert(Buffer.isBuffer(pdfProdBuffer) && pdfProdBuffer.length > 500, 'Production PDF report generated successfully');

    const csvProd = csvExporters.exportProductionCSV(prodReport.tasks);
    assert(csvProd.includes('Phase8 Production Task'), 'Production CSV report exported successfully');

    // 5. Attendance Report Tests
    await attendanceServices.checkIn(emp1.id, { timestamp: new Date('2026-08-15T09:00:00.000Z') });
    await attendanceServices.checkOut(emp1.id, { timestamp: new Date('2026-08-15T18:00:00.000Z') });

    const attReport = await reportServices.getAttendanceReport({ from: '2026-08-01', to: '2026-08-31', employeeId: emp1.id });
    assert(attReport.summary.totalWorkedHours === 9.0, 'Attendance report calculates total worked hours correctly (9.0 hrs)');
    assert(attReport.employeeSummaries[0].overtimeHours === 1.0, 'Attendance report calculates overtime hours correctly (1.0 hr)');

    const pdfAttBuffer = await pdfGenerators.generateAttendancePDF(attReport);
    assert(Buffer.isBuffer(pdfAttBuffer) && pdfAttBuffer.length > 500, 'Attendance PDF report generated successfully');

    const csvAtt = csvExporters.exportAttendanceCSV(attReport.employeeSummaries);
    assert(csvAtt.includes('Rahim') && csvAtt.includes('9'), 'Attendance CSV report exported successfully');

    // 6. Payroll Report Tests
    await payrollServices.createSalaryPayment(
      { employeeId: emp1.id, year: 2026, month: 8, amount: 400, note: 'Advance pay' },
      admin.id
    );

    const payrollReport = await reportServices.getPayrollReport({ year: 2026, month: 8 });
    assert(payrollReport.summary.totalEarned >= 800, 'Payroll report returns total earned');
    assert(payrollReport.summary.totalPaid >= 400, 'Payroll report returns total paid amount');

    const pdfPayBuffer = await pdfGenerators.generatePayrollPDF(payrollReport);
    assert(Buffer.isBuffer(pdfPayBuffer) && pdfPayBuffer.length > 500, 'Payroll PDF report generated successfully');

    const csvPay = csvExporters.exportPayrollCSV(payrollReport.employeeBreakdown, payrollReport.period);
    assert(csvPay.includes('Rahim') && csvPay.includes('400'), 'Payroll CSV report exported successfully');

    // 7. Employee Performance Report Tests
    const perfReport = await reportServices.getEmployeePerformanceReport(emp1.id, { from: '2026-08-01', to: '2026-08-31' });
    assert(perfReport.employee.name === 'Rahim', 'Employee performance report identifies correct employee');
    assert(perfReport.attendance.totalWorkedHours === 9.0, 'Performance report includes attendance worked hours');
    assert(perfReport.production.completedQuantity === 10, 'Performance report includes production completed quantity');
    assert(perfReport.payroll.paidAmount === 400, 'Performance report includes payroll details');

    const pdfPerfBuffer = await pdfGenerators.generateEmployeePerformancePDF(perfReport);
    assert(Buffer.isBuffer(pdfPerfBuffer) && pdfPerfBuffer.length > 500, 'Employee performance PDF generated successfully');

    // Clean up test data
    await prisma.salaryPayment.deleteMany({ where: { employeeId: { in: [emp1.id, emp2.id] } } });
    await prisma.attendance.deleteMany({ where: { employeeId: { in: [emp1.id, emp2.id] } } });
    await prisma.taskRequiredProduct.deleteMany({ where: { task: { createdById: admin.id } } });
    await prisma.taskAssignment.deleteMany({ where: { employeeId: { in: [emp1.id, emp2.id] } } });
    await prisma.taskBatchAllocation.deleteMany({ where: { task: { createdById: admin.id } } });
    await prisma.stockMovement.deleteMany({ where: { performedById: { in: [admin.id, emp1.id, emp2.id] } } });
    await prisma.task.deleteMany({ where: { createdById: admin.id } });
    await prisma.employeeProfile.deleteMany({ where: { userId: { in: [emp1.id, emp2.id] } } });
    await prisma.product.delete({ where: { id: comp.id } });
    await prisma.category.delete({ where: { id: category.id } });
    await prisma.vendor.delete({ where: { id: vendor.id } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, emp1.id, emp2.id] } } });

    console.log(`\n📊 Phase 8 Test Results: ${passed} Passed, ${failed} Failed`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('💥 Phase 8 test suite crashed:', err);
    process.exit(1);
  }
}

runPhase8Tests();
