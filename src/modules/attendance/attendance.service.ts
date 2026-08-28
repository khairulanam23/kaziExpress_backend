import prisma from '../../utils/prisma/prisma-client';
import ApiError from '../../utils/errors/api-error';
import { notificationServices } from '../notifications/notification.service';
import {
  CheckInInput,
  CheckOutInput,
  AttendanceSearchQueryInput,
  AdminAttendanceOverrideInput,
  DecideOvertimeInput,
} from './attendance.validation';

const startOfDay = (date: Date) => new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

export const attendanceServices = {
  /**
   * Get configured required working hours per day (Default: 8.0).
   */
  getRequiredWorkingHours: async (): Promise<number> => {
    const config = await prisma.systemConfig.findUnique({
      where: { key: 'required_working_hours' },
    });
    if (!config || !config.value) return 8.0;
    const val = typeof config.value === 'number' ? config.value : parseFloat(String(config.value));
    return isNaN(val) || val <= 0 ? 8.0 : val;
  },

  /**
   * Admin sets configured required working hours per day.
   * Future check-ins will use the new value, while historical records retain their snapshot.
   */
  setRequiredWorkingHours: async (hours: number, userId: string) => {
    if (hours <= 0) {
      throw new ApiError(400, 'Required working hours must be greater than 0');
    }

    return prisma.systemConfig.upsert({
      where: { key: 'required_working_hours' },
      update: {
        value: hours,
        updatedById: userId,
      },
      create: {
        key: 'required_working_hours',
        value: hours,
        description: 'Required daily working hours for overtime calculations',
        updatedById: userId,
      },
    });
  },

  /**
   * Employee check-in.
   * Only 1 attendance record allowed per calendar date per employee.
   * If already checked in, returns existing state without creating duplicate or throwing error.
   */
  checkIn: async (employeeId: string, data: { source?: 'FINGERPRINT' | 'MANUAL' | 'WEB'; timestamp?: Date | string; date?: string }) => {
    const timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
    const date = startOfDay(timestamp);

    const existing = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date } },
    });

    if (existing) {
      // One attendance record per employee per day, enforced by the unique
      // constraint — so this is deliberately idempotent. It returns the
      // existing session flagged as unchanged, because reporting "created" for
      // a request that wrote nothing made the UI celebrate a no-op.
      return { attendance: existing, created: false };
    }

    const currentRequiredHours = await attendanceServices.getRequiredWorkingHours();

    const attendance = await prisma.attendance.create({
      data: {
        employeeId,
        date,
        checkIn: timestamp,
        requiredHours: currentRequiredHours,
        source: data.source || 'WEB',
        overtimeStatus: 'PENDING',
      },
    });

    return { attendance, created: true };
  },

  /**
   * Employee check-out.
   * Computes worked hours = checkOut - checkIn, and overtime = max(0, workedHours - requiredHours).
   */
  checkOut: async (employeeId: string, data: { source?: 'FINGERPRINT' | 'MANUAL' | 'WEB'; timestamp?: Date | string }) => {
    const timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
    const date = startOfDay(timestamp);

    // Find active attendance for today (or latest record without checkOut)
    let existing = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date } },
    });

    if (!existing || !existing.checkIn) {
      // Fallback: search for latest attendance record without checkOut
      existing = await prisma.attendance.findFirst({
        where: { employeeId, checkOut: null },
        orderBy: { date: 'desc' },
      });
    }

    if (!existing || !existing.checkIn) {
      throw new ApiError(400, 'Cannot check out without an active check-in');
    }

    if (existing.checkOut) {
      throw new ApiError(400, 'Already checked out for this attendance session');
    }

    const checkInTime = new Date(existing.checkIn).getTime();
    const checkOutTime = timestamp.getTime();

    if (checkOutTime < checkInTime) {
      throw new ApiError(400, 'Check-out time cannot be earlier than check-in time');
    }

    const diffMs = checkOutTime - checkInTime;
    const workedHours = Number((diffMs / 3_600_000).toFixed(2));
    const reqHours = Number(existing.requiredHours || 8.0);
    const overtimeHours = Math.max(0, Number((workedHours - reqHours).toFixed(2)));

    return prisma.attendance.update({
      where: { id: existing.id },
      data: {
        checkOut: timestamp,
        workedHours,
        calculatedHours: workedHours,
        overtimeHours,
        overtimeStatus: 'PENDING',
      },
    });
  },

  /**
   * Get employee's today attendance status.
   */
  getMyTodayStatus: async (employeeId: string) => {
    const date = startOfDay(new Date());
    const record = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date } },
    });

    let hoursSoFar = 0;
    if (record?.checkIn) {
      const end = record.checkOut ? new Date(record.checkOut) : new Date();
      hoursSoFar = Number(((end.getTime() - new Date(record.checkIn).getTime()) / 3_600_000).toFixed(2));
    }

    return {
      date: date.toISOString().slice(0, 10),
      checkedIn: !!record?.checkIn,
      checkedOut: !!record?.checkOut,
      checkIn: record?.checkIn ?? null,
      checkOut: record?.checkOut ?? null,
      workedHours: record?.workedHours ? Number(record.workedHours) : hoursSoFar,
      requiredHours: record?.requiredHours ? Number(record.requiredHours) : await attendanceServices.getRequiredWorkingHours(),
      overtimeHours: record?.overtimeHours ? Number(record.overtimeHours) : 0,
      adminOvertimeHours: record?.adminOvertimeHours ? Number(record.adminOvertimeHours) : null,
      overtimeStatus: record?.overtimeStatus ?? 'PENDING',
      attendance: record,
    };
  },

  /**
   * Admin approves, rejects, or edits overtime for an attendance record.
   */
  decideOvertime: async (attendanceId: string, payload: DecideOvertimeInput, adminId: string) => {
    const existing = await prisma.attendance.findUnique({ where: { id: attendanceId } });
    if (!existing) throw ApiError.notFound('Attendance record not found');

    const updateData: any = {
      overtimeDecidedById: adminId,
      overtimeDecidedAt: new Date(),
    };

    if (payload.status) updateData.overtimeStatus = payload.status;
    if (payload.reason) updateData.overtimeReason = payload.reason;
    if (payload.adminOvertimeHours !== undefined) {
      updateData.adminOvertimeHours = payload.adminOvertimeHours;
    }

    const updatedRecord = await prisma.attendance.update({
      where: { id: attendanceId },
      data: updateData,
      include: {
        employee: { select: { id: true, name: true, email: true } },
        overtimeDecidedBy: { select: { id: true, name: true, email: true } },
      },
    });

    const dateStr = new Date(updatedRecord.date).toISOString().split('T')[0];
    const finalOt = updatedRecord.adminOvertimeHours ?? updatedRecord.overtimeHours ?? 0;

    await notificationServices.create(
      updatedRecord.employeeId,
      'Overtime Decision Updated',
      `Your overtime for ${dateStr} has been set to ${updatedRecord.overtimeStatus} (${finalOt} hrs)`,
      '/attendance',
      `OT_DECISION:${updatedRecord.id}:${updatedRecord.updatedAt.getTime()}`
    );

    return updatedRecord;
  },

  /**
   * Admin overrides/corrects check-in or check-out times for an attendance record.
   * Preserves audit log of old values.
   */
  overrideAttendance: async (attendanceId: string, payload: AdminAttendanceOverrideInput, adminId: string) => {
    const existing = await prisma.attendance.findUnique({ where: { id: attendanceId } });
    if (!existing) throw ApiError.notFound('Attendance record not found');

    const newCheckIn = payload.checkIn ? new Date(payload.checkIn) : existing.checkIn;
    const newCheckOut = payload.checkOut ? new Date(payload.checkOut) : existing.checkOut;

    let workedHours: number | null = null;
    let overtimeHours: number | null = null;

    if (newCheckIn && newCheckOut) {
      const diffMs = newCheckOut.getTime() - newCheckIn.getTime();
      workedHours = Number((diffMs / 3_600_000).toFixed(2));
      const reqHours = Number(existing.requiredHours || 8.0);
      overtimeHours = Math.max(0, Number((workedHours - reqHours).toFixed(2)));
    }

    const oldValues = {
      checkIn: existing.checkIn,
      checkOut: existing.checkOut,
      workedHours: existing.workedHours ? Number(existing.workedHours) : null,
      overtimeHours: existing.overtimeHours ? Number(existing.overtimeHours) : null,
      source: existing.source,
    };

    return prisma.attendance.update({
      where: { id: attendanceId },
      data: {
        checkIn: newCheckIn,
        checkOut: newCheckOut,
        workedHours,
        calculatedHours: workedHours,
        overtimeHours,
        isOverride: true,
        source: 'MANUAL',
        overriddenById: adminId,
        overrideReason: payload.reason,
        overrideOldValues: oldValues,
        notes: payload.notes || existing.notes,
      },
      include: {
        employee: { select: { id: true, name: true, email: true } },
        overriddenBy: { select: { id: true, name: true, email: true } },
      },
    });
  },

  /**
   * Get monthly aggregated overtime report by calendar month.
   */
  getMonthlyOvertimeReport: async (year: number, month: number) => {
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const rawRecords = await prisma.attendance.findMany({
      where: {
        date: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      include: {
        employee: { select: { id: true, name: true, email: true } },
      },
    });

    const records = rawRecords.filter((rec) => {
      const d = new Date(rec.date);
      return d.getUTCFullYear() === year && d.getUTCMonth() === (month - 1);
    });

    const summaryMap = new Map<string, any>();

    for (const rec of records) {
      const empId = rec.employeeId;
      if (!summaryMap.has(empId)) {
        summaryMap.set(empId, {
          employeeId: empId,
          employeeName: rec.employee?.name || 'Unknown',
          employeeEmail: rec.employee?.email || '',
          year,
          month,
          totalWorkedHours: 0,
          totalOvertime: 0,
          approvedOvertime: 0,
          rejectedOvertime: 0,
          pendingOvertime: 0,
          recordCount: 0,
        });
      }

      const summary = summaryMap.get(empId);
      summary.recordCount++;

      if (rec.workedHours) {
        summary.totalWorkedHours += Number(rec.workedHours);
      }

      // Effective overtime: adminOvertimeHours takes precedence if set
      const effectiveOt = rec.adminOvertimeHours !== null && rec.adminOvertimeHours !== undefined
        ? Number(rec.adminOvertimeHours)
        : Number(rec.overtimeHours || 0);

      summary.totalOvertime += effectiveOt;

      if (rec.overtimeStatus === 'APPROVED') {
        summary.approvedOvertime += effectiveOt;
      } else if (rec.overtimeStatus === 'REJECTED') {
        summary.rejectedOvertime += effectiveOt;
      } else {
        summary.pendingOvertime += effectiveOt;
      }
    }

    const report = Array.from(summaryMap.values()).map((s) => ({
      ...s,
      totalWorkedHours: Number(s.totalWorkedHours.toFixed(2)),
      totalOvertime: Number(s.totalOvertime.toFixed(2)),
      approvedOvertime: Number(s.approvedOvertime.toFixed(2)),
      rejectedOvertime: Number(s.rejectedOvertime.toFixed(2)),
      pendingOvertime: Number(s.pendingOvertime.toFixed(2)),
    }));

    return {
      year,
      month,
      employeeSummaries: report,
    };
  },

  /**
   * Search & filter attendance records.
   */
  getManyAttendance: async (query: any, requester: { id: string; role: string }) => {
    const pageNo = typeof query.pageNo === 'number' ? query.pageNo : (query.pageNo ? parseInt(String(query.pageNo), 10) : 1);
    const showPerPage = typeof query.showPerPage === 'number' ? query.showPerPage : (query.showPerPage ? parseInt(String(query.showPerPage), 10) : 20);
    const skip = (pageNo - 1) * showPerPage;

    const where: any = {};

    if (requester.role === 'ADMIN') {
      if (query.employeeId) where.employeeId = query.employeeId;
    } else {
      where.employeeId = requester.id;
    }

    if (query.from || query.to) {
      where.date = {
        ...(query.from && { gte: new Date(query.from) }),
        ...(query.to && { lte: new Date(query.to) }),
      };
    } else if (query.year && query.month) {
      const y = parseInt(query.year, 10);
      const m = parseInt(query.month, 10);
      where.date = {
        gte: new Date(Date.UTC(y, m - 1, 1)),
        lte: new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)),
      };
    }

    if (query.overtimeStatus) {
      where.overtimeStatus = query.overtimeStatus;
    }

    const [totalData, records] = await Promise.all([
      prisma.attendance.count({ where }),
      prisma.attendance.findMany({
        where,
        skip,
        take: showPerPage,
        include: {
          employee: { select: { id: true, name: true, email: true } },
          overtimeDecidedBy: { select: { id: true, name: true, email: true } },
          overriddenBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { date: 'desc' },
      }),
    ]);

    const totalPages = Math.ceil(totalData / showPerPage) || 1;
    return { records, totalData, totalPages, currentPage: pageNo };
  },
};
