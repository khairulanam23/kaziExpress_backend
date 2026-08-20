import {
  PdfBuilder,
  fmtDate,
  fmtHours,
  fmtLabel,
  fmtMoney,
  fmtMonth,
  loadOrganizationHeader,
} from '../../utils/pdf/pdf-theme.util';
import prisma from '../../utils/prisma/prisma-client';
import ApiError from '../../utils/errors/api-error';
import { CreateSalaryPaymentInput } from './payroll.validation';
import { notificationServices } from '../notifications/notification.service';

export const payrollServices = {
  /**
   * Get overtime multiplier from SystemConfig (Default 1.5).
   */
  getOvertimeMultiplier: async (): Promise<number> => {
    const config = await prisma.systemConfig.findUnique({
      where: { key: 'overtime_multiplier' },
    });
    if (!config || !config.value) return 1.5;
    const val = typeof config.value === 'number' ? config.value : parseFloat(String(config.value));
    return isNaN(val) || val <= 0 ? 1.5 : val;
  },

  /**
   * Calculate comprehensive payroll summary for an employee for a specific billing month.
   */
  getEmployeePayrollSummary: async (employeeId: string, year: number, month: number) => {
    const employee = await prisma.user.findUnique({
      where: { id: employeeId },
      include: { employeeProfile: true },
    });

    if (!employee) {
      throw ApiError.notFound('Employee not found');
    }

    // Determine historical rate snapshot or current rates
    const snapshot = await prisma.monthlyPayrollSnapshot.findUnique({
      where: { employeeId_year_month: { employeeId, year, month } },
    });

    let hourlyRate = employee.employeeProfile ? Number(employee.employeeProfile.hourlyRate) : 100;
    let overtimeMultiplier = employee.employeeProfile ? Number(employee.employeeProfile.overtimeMultiplier) : 1.5;
    let requiredDailyHours = 8.0;

    if (snapshot) {
      hourlyRate = Number(snapshot.hourlyRate);
      overtimeMultiplier = Number(snapshot.overtimeMultiplier);
      requiredDailyHours = Number(snapshot.requiredDailyHours);
    } else {
      const configMult = await payrollServices.getOvertimeMultiplier();
      if (employee.employeeProfile?.overtimeMultiplier) {
        overtimeMultiplier = Number(employee.employeeProfile.overtimeMultiplier);
      } else {
        overtimeMultiplier = configMult;
      }
    }

    // Date range for billing month (UTC midnight to midnight)
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const rawAttendances = await prisma.attendance.findMany({
      where: {
        employeeId,
        date: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      orderBy: { date: 'asc' },
    });

    // Exact UTC month filter
    const attendances = rawAttendances.filter((rec) => {
      const d = new Date(rec.date);
      return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1;
    });

    let workedHoursTotal = 0;
    let regularHoursTotal = 0;
    let overtimeWorkedTotal = 0;
    let approvedOvertimeTotal = 0;
    let pendingOvertimeTotal = 0;
    let rejectedOvertimeTotal = 0;

    for (const rec of attendances) {
      const worked = rec.workedHours ? Number(rec.workedHours) : 0;
      workedHoursTotal += worked;

      const reqHours = rec.requiredHours ? Number(rec.requiredHours) : requiredDailyHours;
      const regHours = Math.min(worked, reqHours);
      regularHoursTotal += regHours;

      const otWorked = rec.overtimeHours ? Number(rec.overtimeHours) : 0;
      overtimeWorkedTotal += otWorked;

      const effectiveOt = rec.adminOvertimeHours !== null && rec.adminOvertimeHours !== undefined
        ? Number(rec.adminOvertimeHours)
        : otWorked;

      if (rec.overtimeStatus === 'APPROVED') {
        approvedOvertimeTotal += effectiveOt;
      } else if (rec.overtimeStatus === 'REJECTED') {
        rejectedOvertimeTotal += effectiveOt;
      } else {
        pendingOvertimeTotal += effectiveOt;
      }
    }

    const regularEarnings = Number((regularHoursTotal * hourlyRate).toFixed(2));
    const overtimeRate = Number((hourlyRate * overtimeMultiplier).toFixed(2));
    const overtimeEarnings = Number((approvedOvertimeTotal * overtimeRate).toFixed(2));
    const totalEarned = Number((regularEarnings + overtimeEarnings).toFixed(2));

    // Fetch salary payments for this billing month
    const payments = await prisma.salaryPayment.findMany({
      where: { employeeId, year, month },
      include: { paidBy: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const salaryPaid = payments.reduce((acc, p) => acc + Number(p.amount), 0);
    const remainingBalance = Math.max(0, Number((totalEarned - salaryPaid).toFixed(2)));

    let status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID';
    if (salaryPaid >= totalEarned && totalEarned > 0) {
      status = 'PAID';
    } else if (salaryPaid > 0) {
      status = 'PARTIALLY_PAID';
    }

    return {
      employee: {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        role: employee.role,
      },
      year,
      month,
      hourlyRate,
      overtimeMultiplier,
      overtimeRate,
      workedHoursTotal: Number(workedHoursTotal.toFixed(2)),
      regularHours: Number(regularHoursTotal.toFixed(2)),
      regularEarnings,
      overtimeWorkedHours: Number(overtimeWorkedTotal.toFixed(2)),
      approvedOvertimeHours: Number(approvedOvertimeTotal.toFixed(2)),
      pendingOvertimeHours: Number(pendingOvertimeTotal.toFixed(2)),
      rejectedOvertimeHours: Number(rejectedOvertimeTotal.toFixed(2)),
      overtimeEarnings,
      totalEarned,
      salaryPaid: Number(salaryPaid.toFixed(2)),
      remainingBalance,
      status,
      payments,
      attendanceCount: attendances.length,
    };
  },

  /**
   * Admin updates an employee's hourly rate.
   * Locked/snapshotted historical billing periods retain their historical rate,
   * while future/unlocked billing cycles use the updated rate.
   */
  updateEmployeeHourlyRate: async (employeeId: string, newRate: number, adminId: string) => {
    if (newRate <= 0) {
      throw new ApiError(400, 'Hourly rate must be greater than 0');
    }

    const profile = await prisma.employeeProfile.findUnique({ where: { userId: employeeId } });
    if (!profile) {
      throw ApiError.notFound('Employee profile not found');
    }

    // Update profile hourly rate (applies to future / un-snapshotted billing cycles)
    const updatedProfile = await prisma.employeeProfile.update({
      where: { userId: employeeId },
      data: { hourlyRate: newRate },
    });

    return updatedProfile;
  },

  /**
   * Admin records a salary payment for an employee for a billing month.
   * Locks the historical rate for that month.
   * Enforces Overpayment Protection (payment <= remainingBalance).
   */
  createSalaryPayment: async (payload: CreateSalaryPaymentInput, paidById: string) => {
    const { employeeId, year, month, amount, note } = payload;

    if (amount <= 0) {
      throw new ApiError(400, 'Salary payment amount must be greater than 0');
    }

    const summary = await payrollServices.getEmployeePayrollSummary(employeeId, year, month);

    if (amount > summary.remainingBalance) {
      throw new ApiError(
        400,
        `Payment amount (${amount} BDT) exceeds remaining unpaid balance (${summary.remainingBalance} BDT)`
      );
    }

    // Lock historical rate snapshot for this billing month
    await prisma.monthlyPayrollSnapshot.upsert({
      where: { employeeId_year_month: { employeeId, year, month } },
      update: { isLocked: true, lockedAt: new Date() },
      create: {
        employeeId,
        year,
        month,
        hourlyRate: summary.hourlyRate,
        overtimeMultiplier: summary.overtimeMultiplier,
        isLocked: true,
        lockedAt: new Date(),
      },
    });

    const payment = await prisma.salaryPayment.create({
      data: {
        employeeId,
        year,
        month,
        amount,
        note,
        paidById,
      },
      include: {
        paidBy: { select: { id: true, name: true, email: true } },
      },
    });

    const updatedSummary = await payrollServices.getEmployeePayrollSummary(employeeId, year, month);

    await notificationServices.create(
      employeeId,
      'Salary Payment Received',
      `Payment of ${amount} BDT recorded for billing period ${year}-${String(month).padStart(2, '0')}. Remaining balance: ${updatedSummary.remainingBalance} BDT`,
      '/payroll/me',
      `SALARY_PAYMENT:${payment.id}`
    );

    return {
      payment,
      summary: updatedSummary,
    };
  },

  /**
   * Admin views overall monthly payroll overview for all employees.
   */
  getMonthlyPayrollOverview: async (year: number, month: number) => {
    const employees = await prisma.user.findMany({
      where: { role: 'EMPLOYEE', isActive: true },
      include: { employeeProfile: true },
      orderBy: { name: 'asc' },
    });

    const summaries = await Promise.all(
      employees.map((emp) => payrollServices.getEmployeePayrollSummary(emp.id, year, month))
    );

    const totals = summaries.reduce(
      (acc, s) => {
        acc.totalRegularEarnings += s.regularEarnings;
        acc.totalOvertimeEarnings += s.overtimeEarnings;
        acc.totalEarned += s.totalEarned;
        acc.totalPaid += s.salaryPaid;
        acc.totalRemaining += s.remainingBalance;
        return acc;
      },
      {
        totalRegularEarnings: 0,
        totalOvertimeEarnings: 0,
        totalEarned: 0,
        totalPaid: 0,
        totalRemaining: 0,
      }
    );

    return {
      year,
      month,
      summaries,
      totals: {
        totalRegularEarnings: Number(totals.totalRegularEarnings.toFixed(2)),
        totalOvertimeEarnings: Number(totals.totalOvertimeEarnings.toFixed(2)),
        totalEarned: Number(totals.totalEarned.toFixed(2)),
        totalPaid: Number(totals.totalPaid.toFixed(2)),
        totalRemaining: Number(totals.totalRemaining.toFixed(2)),
      },
    };
  },

  /**
   * Get salary payment history for an employee or all employees.
   */
  getSalaryPaymentHistory: async (employeeId?: string, year?: number, month?: number) => {
    const where: any = {};
    if (employeeId) where.employeeId = employeeId;
    if (year) where.year = year;
    if (month) where.month = month;

    return prisma.salaryPayment.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, email: true } },
        paidBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * Professional payroll statement PDF.
   *
   * Laid out as a real salary slip — organisation letterhead, employee and
   * period details, an earnings table that separates regular from approved
   * overtime, the net payable, and the payment history for the period.
   */
  generatePayrollStatementPdf: async (employeeId: string, year: number, month: number): Promise<Buffer> => {
    const summary = await payrollServices.getEmployeePayrollSummary(employeeId, year, month);
    const org = await loadOrganizationHeader(prisma);

    const employee = await prisma.user.findUnique({
      where: { id: employeeId },
      select: {
        phone: true,
        employeeProfile: { select: { department: true, designation: true, joinDate: true } },
      },
    });

    const pdf = new PdfBuilder({
      title: 'Payroll Statement',
      subtitle: fmtMonth(year, month),
      organization: org,
      meta: [
        ['Employee', summary.employee.name || '—'],
        ['Billing period', fmtMonth(year, month)],
        ['Payment status', fmtLabel(summary.status)],
        ['Issued', fmtDate(new Date())],
      ],
    });

    pdf.section('Employee details').keyValues([
      ['Name', summary.employee.name || '—'],
      ['Employee ID', summary.employee.id.slice(0, 8).toUpperCase()],
      ['Email', summary.employee.email],
      ['Phone', employee?.phone || '—'],
      ['Designation', employee?.employeeProfile?.designation || '—'],
      ['Department', employee?.employeeProfile?.department || '—'],
      ['Joined', employee?.employeeProfile?.joinDate ? fmtDate(employee.employeeProfile.joinDate) : '—'],
      ['Days attended', String(summary.attendanceCount)],
    ]);

    pdf.section('Earnings').table({
      columns: [
        { header: 'Description', width: 40 },
        { header: 'Hours', width: 16, align: 'right' },
        { header: 'Rate', width: 20, align: 'right' },
        { header: 'Amount', width: 24, align: 'right' },
      ],
      rows: [
        ['Regular hours', fmtHours(summary.regularHours), fmtMoney(summary.hourlyRate), fmtMoney(summary.regularEarnings)],
        [
          `Approved overtime (x${summary.overtimeMultiplier})`,
          fmtHours(summary.approvedOvertimeHours),
          fmtMoney(summary.overtimeRate),
          fmtMoney(summary.overtimeEarnings),
        ],
      ],
      totals: ['Gross earnings', fmtHours(summary.workedHoursTotal), '', fmtMoney(summary.totalEarned)],
      zebra: false,
    });

    pdf.section('Settlement').table({
      columns: [
        { header: 'Description', width: 76 },
        { header: 'Amount', width: 24, align: 'right' },
      ],
      rows: [
        ['Total earned this period', fmtMoney(summary.totalEarned)],
        ['Less: paid to date', `- ${fmtMoney(summary.salaryPaid)}`],
      ],
      zebra: false,
    });

    pdf.highlight(
      'Net payable',
      fmtMoney(summary.remainingBalance),
      summary.remainingBalance > 0 ? 'danger' : 'success',
    );

    pdf.section('Payment history').table({
      columns: [
        { header: 'Date', width: 22 },
        { header: 'Amount', width: 22, align: 'right' },
        { header: 'Recorded by', width: 26 },
        { header: 'Note', width: 30 },
      ],
      rows: summary.payments.map((p: any) => [
        fmtDate(p.createdAt),
        fmtMoney(p.amount),
        p.paidBy?.name || '—',
        p.note || '—',
      ]),
      emptyMessage: 'No payments have been recorded for this period.',
    });

    if (summary.pendingOvertimeHours > 0) {
      pdf.note(
        `${fmtHours(summary.pendingOvertimeHours)} of overtime is awaiting approval and is not included in the figures above.`,
      );
    }

    pdf.note('This statement is generated from attendance and payroll records. Only administrator-approved overtime is paid.');

    return pdf.finish();
  },
};
