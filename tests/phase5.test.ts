import prisma from '../src/utils/prisma/prisma-client';
import { attendanceServices } from '../src/modules/attendance/attendance.service';
import bcrypt from 'bcryptjs';

async function runPhase5Tests() {
  console.log('🧪 Starting Backend Phase 5 Test Suite...\n');

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
    const adminEmail = `phase5.admin.${Date.now()}@example.com`;
    const emp1Email = `phase5.emp1.${Date.now()}@example.com`;
    const emp2Email = `phase5.emp2.${Date.now()}@example.com`;
    const passwordHash = await bcrypt.hash('password123', 10);

    const admin = await prisma.user.create({
      data: { email: adminEmail, password: passwordHash, role: 'ADMIN', name: 'Phase5 Admin' },
    });

    const emp1 = await prisma.user.create({
      data: { email: emp1Email, password: passwordHash, role: 'EMPLOYEE', name: 'Rahim' },
    });

    const emp2 = await prisma.user.create({
      data: { email: emp2Email, password: passwordHash, role: 'EMPLOYEE', name: 'Karim' },
    });

    // 1. Employee Check-In
    const checkInTime1 = new Date('2026-07-10T09:00:00.000Z');
    // checkIn reports whether it actually created a session, so that checking
    // in twice in a day is no longer answered as though it wrote something.
    const { attendance: att1, created: att1Created } = await attendanceServices.checkIn(emp1.id, {
      timestamp: checkInTime1,
      source: 'WEB',
    });
    assert(att1Created === true, 'First check-in of the day creates a session');

    assert(att1 !== null && att1.employeeId === emp1.id, 'Employee 1 can check in');
    assert(new Date(att1.checkIn!).toISOString() === checkInTime1.toISOString(), 'Check-in timestamp recorded correctly');
    assert(Number(att1.requiredHours) === 8.0, 'Default required working hours snapshot set to 8.0');
    assert(att1.overtimeStatus === 'PENDING', 'Overtime status starts as PENDING');

    // 2. Duplicate Check-In Protection (returns existing state on same date)
    const { attendance: dupAtt, created: dupCreated } = await attendanceServices.checkIn(emp1.id, {
      timestamp: new Date('2026-07-10T10:00:00.000Z'),
      source: 'WEB',
    });
    assert(dupAtt.id === att1.id, 'Duplicate check-in on same date returns existing state without error');
    assert(dupCreated === false, 'Duplicate check-in reports that nothing was created');

    // 3. Cannot Check Out Without Active Check-In
    try {
      await attendanceServices.checkOut(emp2.id, {
        timestamp: new Date('2026-07-10T17:00:00.000Z'),
      });
      assert(false, 'Cannot check out without check-in');
    } catch (err: any) {
      assert(err.message.includes('without an active check-in'), 'Cannot check out without check-in');
    }

    // 4. Employee Check-Out & Worked Hours Calculation (8.5 hours worked -> 0.5 overtime)
    const checkOutTime1 = new Date('2026-07-10T17:30:00.000Z'); // 9:00 to 17:30 = 8.5 hours
    const out1 = await attendanceServices.checkOut(emp1.id, {
      timestamp: checkOutTime1,
    });

    assert(Number(out1.workedHours) === 8.5, 'Worked hours calculated as 8.5 hours (lunch included, not subtracted)');
    assert(Number(out1.overtimeHours) === 0.5, 'Overtime calculated as 0.5 hours (8.5 - 8.0)');

    // 5. Exact Hour & Overtime Calculations (8h -> 0 OT, 9h -> 1 OT, 7h -> 0 OT)
    // Employee 2 on 2026-07-11: 8 hours worked (9:00 to 17:00)
    await attendanceServices.checkIn(emp2.id, { timestamp: new Date('2026-07-11T09:00:00.000Z') });
    const out8h = await attendanceServices.checkOut(emp2.id, { timestamp: new Date('2026-07-11T17:00:00.000Z') });
    assert(Number(out8h.workedHours) === 8.0 && Number(out8h.overtimeHours) === 0.0, '8 hours worked produces 0 overtime');

    // Employee 2 on 2026-07-12: 9 hours worked (9:00 to 18:00)
    await attendanceServices.checkIn(emp2.id, { timestamp: new Date('2026-07-12T09:00:00.000Z') });
    const out9h = await attendanceServices.checkOut(emp2.id, { timestamp: new Date('2026-07-12T18:00:00.000Z') });
    assert(Number(out9h.workedHours) === 9.0 && Number(out9h.overtimeHours) === 1.0, '9 hours worked produces 1.0 overtime');

    // Employee 2 on 2026-07-13: 7 hours worked (9:00 to 16:00) -> 0 overtime (never negative)
    await attendanceServices.checkIn(emp2.id, { timestamp: new Date('2026-07-13T09:00:00.000Z') });
    const out7h = await attendanceServices.checkOut(emp2.id, { timestamp: new Date('2026-07-13T16:00:00.000Z') });
    assert(Number(out7h.workedHours) === 7.0 && Number(out7h.overtimeHours) === 0.0, '7 hours worked produces 0 overtime (never negative)');

    // 6. Admin Overtime Controls (Approve, Reject, Edit)
    // Approve out1 (0.5 OT)
    const app1 = await attendanceServices.decideOvertime(out1.id, { status: 'APPROVED' }, admin.id);
    assert(app1.overtimeStatus === 'APPROVED', 'Admin can approve overtime');

    // Reject out9h (1.0 OT)
    const rej9h = await attendanceServices.decideOvertime(out9h.id, { status: 'REJECTED', reason: 'Unapproved OT' }, admin.id);
    assert(rej9h.overtimeStatus === 'REJECTED', 'Admin can reject overtime');

    // Edit out1 overtime hours (Original: 0.5, Admin edits to 0.4)
    const edit1 = await attendanceServices.decideOvertime(
      out1.id,
      { status: 'APPROVED', adminOvertimeHours: 0.4, reason: 'Adjusted to 0.4h' },
      admin.id
    );
    assert(Number(edit1.adminOvertimeHours) === 0.4, 'Admin can edit overtime hours');
    assert(Number(edit1.overtimeHours) === 0.5, 'Admin modification preserves original calculated overtime value (0.5) for auditability');
    assert(edit1.overtimeDecidedById === admin.id, 'Admin ID recorded for overtime decision');

    // 7. Monthly Overtime Aggregation (July vs August separation)
    // Add August record for Employee 1 (2026-08-05: 10 hours worked -> 2.0 OT)
    await attendanceServices.checkIn(emp1.id, { timestamp: new Date('2026-08-05T08:00:00.000Z') });
    const augOut = await attendanceServices.checkOut(emp1.id, { timestamp: new Date('2026-08-05T18:00:00.000Z') });
    await attendanceServices.decideOvertime(augOut.id, { status: 'APPROVED' }, admin.id);

    const julyReport = await attendanceServices.getMonthlyOvertimeReport(2026, 7);
    const augReport = await attendanceServices.getMonthlyOvertimeReport(2026, 8);

    const emp1Aug = augReport.employeeSummaries.find((s) => s.employeeId === emp1.id);
    const emp2Aug = augReport.employeeSummaries.find((s) => s.employeeId === emp2.id);
    assert(julyReport.employeeSummaries.length >= 2, 'July report contains test employees');
    assert(emp1Aug !== undefined && emp2Aug === undefined, 'July and August overtime separated correctly by calendar month');

    const emp1July = julyReport.employeeSummaries.find((s) => s.employeeId === emp1.id);
    assert(emp1July && emp1July.totalWorkedHours === 8.5 && emp1July.approvedOvertime === 0.4, 'July monthly aggregation sums worked hours and approved overtime correctly');

    // 8. Admin Attendance Override (Correction with audit trail)
    const overrideRes = await attendanceServices.overrideAttendance(
      out7h.id,
      {
        checkOut: new Date('2026-07-13T17:00:00.000Z'), // Corrected check-out from 16:00 to 17:00 (7h -> 8h)
        reason: 'Employee forgot to check out at 5 PM',
      },
      admin.id
    );

    assert(overrideRes.isOverride === true, 'Admin attendance override sets isOverride = true');
    assert(overrideRes.overriddenById === admin.id, 'Admin ID recorded for override');
    assert(overrideRes.overrideReason === 'Employee forgot to check out at 5 PM', 'Override reason recorded');
    assert(Number(overrideRes.workedHours) === 8.0, 'Worked hours recalculated to 8.0 after correction');
    assert((overrideRes.overrideOldValues as any).workedHours === 7, 'Original old values preserved in audit log');

    // 9. Configurable Required Working Hours & Historical Preservation
    await attendanceServices.setRequiredWorkingHours(7.5, admin.id);

    // New check-in for Employee 1 on 2026-08-10 uses new required hours (7.5)
    const { attendance: newAtt } = await attendanceServices.checkIn(emp1.id, { timestamp: new Date('2026-08-10T09:00:00.000Z') });
    assert(Number(newAtt.requiredHours) === 7.5, 'New check-in uses updated required working hours (7.5)');

    // Historical check-in (att1) retains original required hours snapshot (8.0)
    const oldAttFresh = await prisma.attendance.findUnique({ where: { id: att1.id } });
    assert(Number(oldAttFresh?.requiredHours) === 8.0, 'Historical attendance retains its original required hours snapshot (8.0)');

    // Reset required working hours back to default 8.0 for clean system state
    await attendanceServices.setRequiredWorkingHours(8.0, admin.id);

    // 10. Security / Scoping Checks
    const emp1Records = await attendanceServices.getManyAttendance({}, { id: emp1.id, role: 'EMPLOYEE' });
    const adminRecords = await attendanceServices.getManyAttendance({}, { id: admin.id, role: 'ADMIN' });

    const allEmp1 = emp1Records.records.every((r) => r.employeeId === emp1.id);
    assert(allEmp1 === true, 'Employee query is scoped strictly to own attendance records');
    assert(adminRecords.records.length > emp1Records.records.length, 'Admin can view all employees attendance records');

    // Clean up test data
    const attIds = [att1.id, out8h.id, out9h.id, out7h.id, augOut.id, newAtt.id];
    await prisma.attendance.deleteMany({ where: { id: { in: attIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, emp1.id, emp2.id] } } });

    console.log(`\n📊 Phase 5 Test Results: ${passed} Passed, ${failed} Failed`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('💥 Phase 5 test suite crashed:', err);
    process.exit(1);
  }
}

runPhase5Tests();
