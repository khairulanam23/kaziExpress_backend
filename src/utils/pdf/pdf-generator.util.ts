import prisma from '../prisma/prisma-client';
import {
  PdfBuilder,
  fmtDate,
  fmtHours,
  fmtLabel,
  fmtMoney,
  fmtMonth,
  fmtNumber,
  fmtPercent,
  fmtQty,
  loadOrganizationHeader,
} from './pdf-theme.util';

/**
 * Report PDFs.
 *
 * Every generator describes only its content; the letterhead, KPI strip, table
 * engine, pagination and footer come from `pdf-theme.util`. Reports render the
 * full dataset — the previous implementation silently stopped at 30 rows.
 */

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export const pdfGenerators = {
  /** 1. Inventory status & valuation */
  generateInventoryPDF: async (data: any): Promise<Buffer> => {
    const org = await loadOrganizationHeader(prisma);
    const s = data.summary ?? {};

    const pdf = new PdfBuilder({
      title: 'Inventory Report',
      subtitle: 'Stock status & valuation',
      organization: org,
      meta: [
        ['Total items', fmtNumber(s.totalItems)],
        ['Total quantity', fmtQty(s.totalQuantity)],
        ['Valuation', fmtMoney(s.totalValue)],
        ['Report date', fmtDate(new Date())],
      ],
    });

    pdf.section('Summary').kpis([
      { label: 'Components', value: fmtNumber(s.totalComponents) },
      { label: 'Finished products', value: fmtNumber(s.totalProducts) },
      { label: 'Low stock', value: fmtNumber(s.lowStockCount), tone: s.lowStockCount ? 'warning' : 'success' },
      { label: 'Out of stock', value: fmtNumber(s.outOfStockCount), tone: s.outOfStockCount ? 'danger' : 'success' },
    ]);

    const byCategory = (data.byCategory ?? []).slice().sort((a: any, b: any) => num(b.value) - num(a.value));
    if (byCategory.length) {
      pdf.section('Value by category').table({
        columns: [
          { header: 'Category', width: 46 },
          { header: 'Items', width: 18, align: 'right' },
          { header: 'Value', width: 22, align: 'right' },
          { header: 'Share', width: 14, align: 'right' },
        ],
        rows: byCategory.map((c: any) => [
          c.name,
          fmtNumber(c.count),
          fmtMoney(c.value),
          fmtPercent(num(s.totalValue) ? (num(c.value) / num(s.totalValue)) * 100 : 0),
        ]),
      });
    }

    const byVendor = (data.byVendor ?? []).slice().sort((a: any, b: any) => num(b.value) - num(a.value));
    if (byVendor.length) {
      pdf.section('Value by vendor').table({
        columns: [
          { header: 'Vendor', width: 46 },
          { header: 'Items', width: 18, align: 'right' },
          { header: 'Value', width: 22, align: 'right' },
          { header: 'Share', width: 14, align: 'right' },
        ],
        rows: byVendor.map((v: any) => [
          v.name,
          fmtNumber(v.count),
          fmtMoney(v.value),
          fmtPercent(num(s.totalValue) ? (num(v.value) / num(s.totalValue)) * 100 : 0),
        ]),
      });
    }

    const items = data.items ?? [];
    pdf.section(`Items (${fmtNumber(items.length)})`).table({
      columns: [
        { header: 'SKU', width: 15 },
        { header: 'Item', width: 27 },
        { header: 'Type', width: 12 },
        { header: 'Stock', width: 15, align: 'right' },
        { header: 'Unit price', width: 15, align: 'right' },
        { header: 'Value', width: 16, align: 'right' },
      ],
      rows: items.map((item: any) => [
        item.sku || '—',
        item.name || '',
        fmtLabel(item.itemType),
        fmtQty(item.currentStock, item.unit),
        fmtMoney(item.unitPrice),
        fmtMoney(num(item.currentStock) * num(item.unitPrice)),
      ]),
      totals: ['', 'Total', '', fmtQty(s.totalQuantity), '', fmtMoney(s.totalValue)],
    });

    return pdf.finish();
  },

  /** 2. Production tasks & yield */
  generateProductionPDF: async (data: any): Promise<Buffer> => {
    const org = await loadOrganizationHeader(prisma);
    const s = data.summary ?? {};

    const pdf = new PdfBuilder({
      title: 'Production Report',
      subtitle: 'Tasks & output',
      organization: org,
      meta: [
        ['Total tasks', fmtNumber(s.totalTasks)],
        ['Planned qty', fmtQty(s.totalPlannedQuantity)],
        ['Produced qty', fmtQty(s.totalCompletedQuantity)],
        ['Completion', fmtPercent(s.completionPercentage)],
      ],
    });

    pdf.section('Summary').kpis([
      { label: 'Completed', value: fmtNumber(s.completedTasks), tone: 'success' },
      { label: 'Partially completed', value: fmtNumber(s.partiallyCompletedTasks), tone: 'warning' },
      { label: 'In progress', value: fmtNumber(s.inProgressTasks) },
      { label: 'Cancelled', value: fmtNumber(s.cancelledTasks), tone: s.cancelledTasks ? 'danger' : 'success' },
      { label: 'Pending', value: fmtNumber(s.pendingTasks) },
      { label: 'Remaining qty', value: fmtQty(s.totalRemainingQuantity) },
    ]);

    const employees = data.employeeSummaries ?? [];
    if (employees.length) {
      pdf.section('Output by employee').table({
        columns: [
          { header: 'Employee', width: 30 },
          { header: 'Tasks', width: 12, align: 'right' },
          { header: 'Completed', width: 14, align: 'right' },
          { header: 'Planned qty', width: 15, align: 'right' },
          { header: 'Produced qty', width: 15, align: 'right' },
          { header: 'Rate', width: 14, align: 'right' },
        ],
        rows: employees.map((e: any) => [
          e.employeeName || e.email || '—',
          fmtNumber(e.assignedTasks),
          fmtNumber(e.completedTasks),
          fmtQty(e.plannedQty),
          fmtQty(e.completedQty),
          fmtPercent(e.completionPercentage),
        ]),
      });
    }

    const tasks = data.tasks ?? [];
    pdf.section(`Tasks (${fmtNumber(tasks.length)})`).table({
      columns: [
        { header: 'Task', width: 26 },
        { header: 'Product', width: 22 },
        { header: 'Status', width: 16 },
        { header: 'Planned', width: 12, align: 'right' },
        { header: 'Done', width: 12, align: 'right' },
        { header: 'Progress', width: 12, align: 'right' },
      ],
      rows: tasks.map((t: any) => {
        const planned = num(t.productionQuantity);
        const done = num(t.completedQuantity);
        return [
          t.title || '',
          t.product?.name || '—',
          fmtLabel(t.status),
          fmtQty(planned),
          fmtQty(done),
          fmtPercent(planned > 0 ? (done / planned) * 100 : 0),
        ];
      }),
      totals: [
        'Total', '', '',
        fmtQty(s.totalPlannedQuantity),
        fmtQty(s.totalCompletedQuantity),
        fmtPercent(s.completionPercentage),
      ],
    });

    return pdf.finish();
  },

  /** 3. Attendance & overtime */
  generateAttendancePDF: async (data: any): Promise<Buffer> => {
    const org = await loadOrganizationHeader(prisma);
    const s = data.summary ?? {};
    const period = data.period ?? {};

    const pdf = new PdfBuilder({
      title: 'Attendance Report',
      subtitle: 'Working hours & overtime',
      organization: org,
      meta: [
        ['Period', `${fmtDate(period.from)} — ${fmtDate(period.to)}`],
        ['Employees', fmtNumber(s.totalEmployees)],
        ['Days attended', fmtNumber(s.totalDaysAttended)],
        ['Hours worked', fmtHours(s.totalWorkedHours)],
      ],
    });

    pdf.section('Summary').kpis([
      { label: 'Total employees', value: fmtNumber(s.totalEmployees) },
      { label: 'Days attended', value: fmtNumber(s.totalDaysAttended) },
      { label: 'Hours worked', value: fmtHours(s.totalWorkedHours) },
      { label: 'Approved overtime', value: fmtHours(s.totalApprovedOvertime), tone: 'success' },
    ]);

    const rows = data.employeeSummaries ?? [];
    pdf.section('Per-employee summary').table({
      columns: [
        { header: 'Employee', width: 26 },
        { header: 'Days', width: 9, align: 'right' },
        { header: 'Worked', width: 13, align: 'right' },
        { header: 'Required', width: 13, align: 'right' },
        { header: 'Approved OT', width: 14, align: 'right' },
        { header: 'Pending OT', width: 13, align: 'right' },
        { header: 'Late', width: 8, align: 'right' },
      ],
      rows: rows.map((e: any) => [
        e.employeeName || e.email || '—',
        fmtNumber(e.daysAttended),
        fmtHours(e.workedHours),
        fmtHours(e.requiredHours),
        fmtHours(e.approvedOvertimeHours),
        fmtHours(e.pendingOvertimeHours),
        fmtNumber(e.lateOccurrences),
      ]),
      totals: [
        'Total',
        fmtNumber(s.totalDaysAttended),
        fmtHours(s.totalWorkedHours),
        '',
        fmtHours(s.totalApprovedOvertime),
        '',
        '',
      ],
    });

    pdf.note('Only overtime approved by an administrator is included in payroll. Pending hours are shown for visibility.');
    return pdf.finish();
  },

  /** 4. Payroll register */
  generatePayrollPDF: async (data: any): Promise<Buffer> => {
    const org = await loadOrganizationHeader(prisma);
    const s = data.summary ?? {};
    const period = data.period ?? {};

    const pdf = new PdfBuilder({
      title: 'Payroll Report',
      subtitle: `Billing period ${fmtMonth(period.year, period.month)}`,
      organization: org,
      meta: [
        ['Period', fmtMonth(period.year, period.month)],
        ['Employees', fmtNumber(s.totalEmployees)],
        ['Total earned', fmtMoney(s.totalEarned)],
        ['Outstanding', fmtMoney(s.totalRemaining)],
      ],
    });

    pdf.section('Summary').kpis([
      { label: 'Total earned', value: fmtMoney(s.totalEarned) },
      { label: 'Total paid', value: fmtMoney(s.totalPaid), tone: 'success' },
      { label: 'Outstanding', value: fmtMoney(s.totalRemaining), tone: num(s.totalRemaining) ? 'danger' : 'success' },
      { label: 'Overtime earnings', value: fmtMoney(s.totalApprovedOvertimeEarnings) },
      { label: 'Fully paid', value: fmtNumber(s.fullyPaidEmployees), tone: 'success' },
      { label: 'Partially paid', value: fmtNumber(s.partiallyPaidEmployees), tone: 'warning' },
      { label: 'Unpaid', value: fmtNumber(s.unpaidEmployees), tone: num(s.unpaidEmployees) ? 'danger' : 'success' },
    ]);

    const rows = data.employeeBreakdown ?? [];
    pdf.section('Employee breakdown').table({
      columns: [
        { header: 'Employee', width: 24 },
        { header: 'Rate', width: 12, align: 'right' },
        { header: 'Hours', width: 10, align: 'right' },
        { header: 'Regular', width: 13, align: 'right' },
        { header: 'OT pay', width: 12, align: 'right' },
        { header: 'Earned', width: 13, align: 'right' },
        { header: 'Paid', width: 13, align: 'right' },
        { header: 'Status', width: 13 },
      ],
      rows: rows.map((e: any) => [
        e.employee?.name || e.employee?.email || '—',
        fmtMoney(e.hourlyRate),
        fmtHours(e.workedHours),
        fmtMoney(e.regularEarnings),
        fmtMoney(e.overtimeEarnings),
        fmtMoney(e.totalEarned),
        fmtMoney(e.totalPaid),
        fmtLabel(e.paymentStatus),
      ]),
      totals: [
        'Total', '', '', '', '',
        fmtMoney(s.totalEarned),
        fmtMoney(s.totalPaid),
        '',
      ],
    });

    pdf.highlight('Outstanding balance', fmtMoney(s.totalRemaining), num(s.totalRemaining) ? 'danger' : 'success');
    return pdf.finish();
  },

  /** 5. Employee performance */
  generateEmployeePerformancePDF: async (data: any): Promise<Buffer> => {
    const org = await loadOrganizationHeader(prisma);
    const emp = data.employee ?? {};
    const att = data.attendance ?? {};
    const prod = data.production ?? {};
    const pay = data.payroll ?? {};
    const period = data.period ?? {};

    const pdf = new PdfBuilder({
      title: 'Performance Report',
      subtitle: emp.name || emp.email || 'Employee',
      organization: org,
      meta: [
        ['Employee', emp.name || '—'],
        ['Email', emp.email || '—'],
        ['Period', `${fmtDate(period.from)} — ${fmtDate(period.to)}`],
        ['Status', emp.isActive ? 'Active' : 'Inactive'],
      ],
    });

    pdf.section('Attendance').kpis([
      { label: 'Days attended', value: fmtNumber(att.daysAttended) },
      { label: 'Hours worked', value: fmtHours(att.totalWorkedHours) },
      { label: 'Approved overtime', value: fmtHours(att.approvedOvertimeHours), tone: 'success' },
      { label: 'Late arrivals', value: fmtNumber(att.lateOccurrences), tone: num(att.lateOccurrences) ? 'warning' : 'success' },
    ]);

    pdf.section('Production').kpis([
      { label: 'Assigned tasks', value: fmtNumber(prod.assignedTasks) },
      { label: 'Completed tasks', value: fmtNumber(prod.completedTasks), tone: 'success' },
      { label: 'Produced quantity', value: fmtQty(prod.completedQuantity) },
      { label: 'Completion rate', value: fmtPercent(prod.completionRate) },
    ]);

    pdf.section('Payroll').table({
      columns: [
        { header: 'Description', width: 60 },
        { header: 'Amount', width: 40, align: 'right' },
      ],
      rows: [
        [`Total earned (${fmtMonth(pay.year, pay.month)})`, fmtMoney(pay.totalEarned)],
        ['Paid to date', fmtMoney(pay.paidAmount)],
      ],
      zebra: false,
    });

    pdf.highlight('Remaining balance', fmtMoney(pay.remainingBalance), num(pay.remainingBalance) ? 'danger' : 'success');
    return pdf.finish();
  },

  /** 6. Stock movement audit trail */
  generateStockMovementPDF: async (data: any): Promise<Buffer> => {
    const org = await loadOrganizationHeader(prisma);
    const movements = data.movements ?? [];
    const meta = data.meta ?? {};

    const pdf = new PdfBuilder({
      title: 'Stock Movement Report',
      subtitle: 'Inventory audit trail',
      organization: org,
      meta: [
        ['Movements', fmtNumber(meta.total ?? movements.length)],
        ['Shown', fmtNumber(movements.length)],
        ['Report date', fmtDate(new Date())],
      ],
    });

    pdf.section('Movements').table({
      columns: [
        { header: 'Date', width: 16 },
        { header: 'Item', width: 24 },
        { header: 'Type', width: 15 },
        { header: 'Quantity', width: 13, align: 'right' },
        { header: 'Value', width: 15, align: 'right' },
        { header: 'By', width: 17 },
      ],
      rows: movements.map((m: any) => [
        fmtDate(m.createdAt),
        m.product?.name || '—',
        fmtLabel(m.type),
        fmtQty(m.quantity, m.product?.unit),
        fmtMoney(m.totalCost),
        m.performedBy?.name || 'System',
      ]),
    });

    return pdf.finish();
  },
};
