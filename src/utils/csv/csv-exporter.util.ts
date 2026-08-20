const escapeCSV = (val: any): string => {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
};

export const csvExporters = {
  /**
   * Export Stock Movements to CSV.
   */
  exportStockMovementsCSV: (rows: any[]): string => {
    const headers = [
      'Timestamp',
      'Product Name',
      'SKU',
      'Movement Type',
      'Quantity Diff',
      'Previous Qty',
      'New Qty',
      'Unit Cost (BDT)',
      'Total Cost (BDT)',
      'Reason / Notes',
      'Batch Number',
      'Performed By',
    ];

    const csvLines = [headers.map(escapeCSV).join(',')];

    for (const r of rows) {
      const line = [
        r.createdAt ? new Date(r.createdAt).toISOString() : '',
        r.product?.name || '',
        r.product?.sku || '',
        r.type || '',
        r.quantity || 0,
        r.previousQuantity ?? '',
        r.newQuantity ?? '',
        r.unitCost ?? 0,
        r.totalCost ?? 0,
        r.reason || r.notes || '',
        r.batch?.batchNumber || '',
        r.performedBy?.name || r.performedBy?.email || '',
      ];
      csvLines.push(line.map(escapeCSV).join(','));
    }

    return csvLines.join('\n');
  },

  /**
   * Export Production Tasks to CSV.
   */
  exportProductionCSV: (tasks: any[]): string => {
    const headers = [
      'Task ID',
      'Title',
      'Product Name',
      'Product SKU',
      'Status',
      'Planned Qty',
      'Completed Qty',
      'Remaining Qty',
      'Completion %',
      'Created By',
      'Created At',
      'Completed At',
    ];

    const csvLines = [headers.map(escapeCSV).join(',')];

    for (const t of tasks) {
      const planned = Number(t.productionQuantity || 0);
      const completed = Number(t.completedQuantity || 0);
      const remaining = Number(t.remainingQuantity || 0);
      const pct = planned > 0 ? ((completed / planned) * 100).toFixed(1) : '0';

      const line = [
        t.id,
        t.title,
        t.product?.name || '',
        t.product?.sku || '',
        t.status,
        planned,
        completed,
        remaining,
        `${pct}%`,
        t.createdBy?.name || t.createdBy?.email || '',
        t.createdAt ? new Date(t.createdAt).toISOString() : '',
        t.completedAt ? new Date(t.completedAt).toISOString() : '',
      ];
      csvLines.push(line.map(escapeCSV).join(','));
    }

    return csvLines.join('\n');
  },

  /**
   * Export Attendance to CSV.
   */
  exportAttendanceCSV: (summaries: any[]): string => {
    const headers = [
      'Employee Name',
      'Email',
      'Days Attended',
      'Worked Hours',
      'Required Hours',
      'Overtime Hours',
      'Approved OT Hours',
      'Rejected OT Hours',
      'Pending OT Hours',
    ];

    const csvLines = [headers.map(escapeCSV).join(',')];

    for (const s of summaries) {
      const line = [
        s.employeeName,
        s.email,
        s.daysAttended,
        s.workedHours,
        s.requiredHours,
        s.overtimeHours,
        s.approvedOvertimeHours,
        s.rejectedOvertimeHours,
        s.pendingOvertimeHours,
      ];
      csvLines.push(line.map(escapeCSV).join(','));
    }

    return csvLines.join('\n');
  },

  /**
   * Export Payroll Overview to CSV.
   */
  exportPayrollCSV: (breakdown: any[], period: { year: number; month: number }): string => {
    const headers = [
      'Year',
      'Month',
      'Employee Name',
      'Email',
      'Hourly Rate (BDT)',
      'Worked Hours',
      'Regular Earnings (BDT)',
      'Approved OT Hours',
      'Overtime Earnings (BDT)',
      'Total Earned (BDT)',
      'Paid Amount (BDT)',
      'Remaining Balance (BDT)',
      'Payment Status',
    ];

    const csvLines = [headers.map(escapeCSV).join(',')];

    for (const b of breakdown) {
      const line = [
        period.year,
        period.month,
        b.employee?.name || '',
        b.employee?.email || '',
        b.hourlyRate,
        b.workedHours,
        b.regularEarnings,
        b.approvedOvertimeHours,
        b.overtimeEarnings,
        b.totalEarned,
        b.totalPaid,
        b.remainingBalance,
        b.paymentStatus,
      ];
      csvLines.push(line.map(escapeCSV).join(','));
    }

    return csvLines.join('\n');
  },
};
