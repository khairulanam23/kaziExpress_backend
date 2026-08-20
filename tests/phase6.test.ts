import prisma from '../src/utils/prisma/prisma-client';
import { payrollServices } from '../src/modules/payroll/payroll.service';
import { attendanceServices } from '../src/modules/attendance/attendance.service';
import bcrypt from 'bcryptjs';

async function runPhase6Tests() {
  console.log('🧪 Starting Backend Phase 6 Test Suite...\n');

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
    const adminEmail = `phase6.admin.${Date.now()}@example.com`;
    const emp1Email = `phase6.emp1.${Date.now()}@example.com`;
    const emp2Email = `phase6.emp2.${Date.now()}@example.com`;
    const passwordHash = await bcrypt.hash('password123', 10);

    const admin = await prisma.user.create({
      data: { email: adminEmail, password: passwordHash, role: 'ADMIN', name: 'Phase6 Admin' },
    });

    const emp1 = await prisma.user.create({
      data: { email: emp1Email, password: passwordHash, role: 'EMPLOYEE', name: 'Rahim' },
    });

    const emp2 = await prisma.user.create({
      data: { email: emp2Email, password: passwordHash, role: 'EMPLOYEE', name: 'Karim' },
    });

    // Setup Employee Profiles with hourly rates
    await prisma.employeeProfile.create({
      data: { userId: emp1.id, hourlyRate: 100.0, overtimeMultiplier: 1.5 },
    });

    await prisma.employeeProfile.create({
      data: { userId: emp2.id, hourlyRate: 120.0, overtimeMultiplier: 1.5 },
    });

    // 1. Create July 2026 Attendance Records for Employee 1 (Rahim: 100 BDT/hr)
    // Day 1: 9:00 to 17:00 (8h worked -> 8h reg, 0h OT)
    await attendanceServices.checkIn(emp1.id, { timestamp: new Date('2026-07-01T09:00:00.000Z') });
    await attendanceServices.checkOut(emp1.id, { timestamp: new Date('2026-07-01T17:00:00.000Z') });

    // Day 2: 9:00 to 18:00 (9h worked -> 8h reg, 1h OT - PENDING)
    await attendanceServices.checkIn(emp1.id, { timestamp: new Date('2026-07-02T09:00:00.000Z') });
    await attendanceServices.checkOut(emp1.id, { timestamp: new Date('2026-07-02T18:00:00.000Z') });

    // Day 3: 9:00 to 19:00 (10h worked -> 8h reg, 2h OT - REJECTED)
    await attendanceServices.checkIn(emp1.id, { timestamp: new Date('2026-07-03T09:00:00.000Z') });
    const attRejected = await attendanceServices.checkOut(emp1.id, { timestamp: new Date('2026-07-03T19:00:00.000Z') });
    await attendanceServices.decideOvertime(attRejected.id, { status: 'REJECTED', reason: 'Unapproved OT' }, admin.id);

    // Day 4: 9:00 to 21:00 (12h worked -> 8h reg, 4h OT - APPROVED)
    await attendanceServices.checkIn(emp1.id, { timestamp: new Date('2026-07-04T09:00:00.000Z') });
    const attApproved = await attendanceServices.checkOut(emp1.id, { timestamp: new Date('2026-07-04T21:00:00.000Z') });
    await attendanceServices.decideOvertime(attApproved.id, { status: 'APPROVED' }, admin.id);

    // Day 5: 9:00 to 20:00 (11h worked -> 8h reg, 3h OT - APPROVED & EDITED to 2.5h)
    await attendanceServices.checkIn(emp1.id, { timestamp: new Date('2026-07-05T09:00:00.000Z') });
    const attEdited = await attendanceServices.checkOut(emp1.id, { timestamp: new Date('2026-07-05T20:00:00.000Z') });
    await attendanceServices.decideOvertime(attEdited.id, { status: 'APPROVED', adminOvertimeHours: 2.5, reason: 'Edited by admin' }, admin.id);

    // 2. Test Payroll Calculation for July 2026
    const summary1 = await payrollServices.getEmployeePayrollSummary(emp1.id, 2026, 7);

    // Total Worked: 8 + 9 + 10 + 12 + 11 = 50 hours
    assert(summary1.workedHoursTotal === 50, 'Total worked hours calculated correctly (50h)');

    // Regular Hours: 8 + 8 + 8 + 8 + 8 = 40 hours
    assert(summary1.regularHours === 40, 'Regular hours capped at 8h/day (40h total)');

    // Regular Earnings: 40 * 100 = 4000 BDT
    assert(summary1.regularEarnings === 4000, 'Regular earnings calculated as 40 * 100 = 4000 BDT');

    // Pending OT (1h) & Rejected OT (2h) produce 0 payable OT
    assert(summary1.pendingOvertimeHours === 1.0, 'Pending overtime tracked as 1.0h');
    assert(summary1.rejectedOvertimeHours === 2.0, 'Rejected overtime tracked as 2.0h');

    // Approved OT: 4.0h (attApproved) + 2.5h (attEdited) = 6.5h
    assert(summary1.approvedOvertimeHours === 6.5, 'Approved overtime incorporates admin edits (4.0 + 2.5 = 6.5h)');

    // Overtime Rate: 100 * 1.5 = 150 BDT/hr
    // Overtime Earnings: 6.5 * 150 = 975 BDT
    assert(summary1.overtimeEarnings === 975, 'Overtime earnings calculated as 6.5 * 150 = 975 BDT');

    // Total Earned: 4000 + 975 = 4975 BDT
    assert(summary1.totalEarned === 4975, 'Total earned calculated as 4000 + 975 = 4975 BDT');

    // Initial Status: UNPAID, Paid = 0, Remaining = 4975
    assert(summary1.status === 'UNPAID', 'Initial payroll status is UNPAID');
    assert(summary1.salaryPaid === 0, 'Initial salary paid is 0');
    assert(summary1.remainingBalance === 4975, 'Initial remaining balance equals total earned (4975 BDT)');

    // 3. Salary Payment Creation (Partial Payment 1: 2000 BDT)
    const payment1 = await payrollServices.createSalaryPayment(
      { employeeId: emp1.id, year: 2026, month: 7, amount: 2000, note: 'Advance 1' },
      admin.id
    );

    assert(payment1.summary.status === 'PARTIALLY_PAID', 'Status updated to PARTIALLY_PAID after payment');
    assert(payment1.summary.salaryPaid === 2000, 'Salary paid tracked as 2000 BDT');
    assert(payment1.summary.remainingBalance === 2975, 'Remaining balance updated to 4975 - 2000 = 2975 BDT');

    // Partial Payment 2: 2975 BDT (Full Remaining)
    const payment2 = await payrollServices.createSalaryPayment(
      { employeeId: emp1.id, year: 2026, month: 7, amount: 2975, note: 'Final settlement' },
      admin.id
    );

    assert(payment2.summary.status === 'PAID', 'Status updated to PAID after full payment');
    assert(payment2.summary.salaryPaid === 4975, 'Total salary paid equals 4975 BDT');
    assert(payment2.summary.remainingBalance === 0, 'Remaining balance becomes 0 BDT');
    assert(payment2.summary.payments.length === 2, 'Multiple payment records preserved independently in payment history');

    // 4. Overpayment Protection Rejection (Attempt to pay 100 BDT when remaining is 0)
    try {
      await payrollServices.createSalaryPayment(
        { employeeId: emp1.id, year: 2026, month: 7, amount: 100 },
        admin.id
      );
      assert(false, 'Overpayment rejected');
    } catch (err: any) {
      assert(err.message.includes('exceeds remaining unpaid balance'), 'Overpayment rejected with clear error message');
    }

    // 5. Payment Audit Trail
    const paymentHist = await payrollServices.getSalaryPaymentHistory(emp1.id, 2026, 7);
    assert(paymentHist.length === 2, 'Payment history retains all payment transactions');
    assert(paymentHist[0].paidBy.id === admin.id, 'Payment record preserves who paid (Admin ID)');

    // 6. Historical Hourly Rate Preservation (Admin changes Rahim rate from 100 to 150 during July)
    await payrollServices.updateEmployeeHourlyRate(emp1.id, 150.0, admin.id);

    // July payroll summary should STILL recalculate to 4975 BDT (using historical snapshot rate 100)
    const julySummaryPostUpdate = await payrollServices.getEmployeePayrollSummary(emp1.id, 2026, 7);
    assert(julySummaryPostUpdate.hourlyRate === 100, 'Changing hourly rate does NOT alter completed July billing period (retains 100 BDT/hr)');
    assert(julySummaryPostUpdate.totalEarned === 4975, 'Historical July total earned remains unchanged at 4975 BDT');

    // August payroll summary uses new rate (150 BDT/hr)
    // Create 1 day in August: 8h worked
    await attendanceServices.checkIn(emp1.id, { timestamp: new Date('2026-08-01T09:00:00.000Z') });
    await attendanceServices.checkOut(emp1.id, { timestamp: new Date('2026-08-01T17:00:00.000Z') });

    const augSummary = await payrollServices.getEmployeePayrollSummary(emp1.id, 2026, 8);
    assert(augSummary.hourlyRate === 150, 'New hourly rate (150 BDT/hr) applies to next billing cycle (August)');
    assert(augSummary.regularEarnings === 1200, 'August regular earnings calculated with new rate (8 * 150 = 1200 BDT)');

    // 7. Monthly Payroll Overview for All Employees (Admin View)
    const overview = await payrollServices.getMonthlyPayrollOverview(2026, 7);
    assert(overview.summaries.length >= 2, 'Admin monthly overview returns all employees');
    assert(overview.totals.totalEarned >= 4975, 'Admin monthly overview sums total earnings correctly');

    // 8. PDF Statement Generation
    const pdfBuffer = await payrollServices.generatePayrollStatementPdf(emp1.id, 2026, 7);
    assert(pdfBuffer !== null && pdfBuffer.length > 500, 'PDF payroll statement buffer generated successfully (> 500 bytes)');
    assert(pdfBuffer.toString('utf-8', 0, 5) === '%PDF-', 'Generated document is a valid PDF (%PDF-)');

    // Clean up test data
    await prisma.salaryPayment.deleteMany({ where: { employeeId: { in: [emp1.id, emp2.id] } } });
    await prisma.monthlyPayrollSnapshot.deleteMany({ where: { employeeId: { in: [emp1.id, emp2.id] } } });
    await prisma.attendance.deleteMany({ where: { employeeId: { in: [emp1.id, emp2.id] } } });
    await prisma.employeeProfile.deleteMany({ where: { userId: { in: [emp1.id, emp2.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, emp1.id, emp2.id] } } });

    console.log(`\n📊 Phase 6 Test Results: ${passed} Passed, ${failed} Failed`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('💥 Phase 6 test suite crashed:', err);
    process.exit(1);
  }
}

runPhase6Tests();
