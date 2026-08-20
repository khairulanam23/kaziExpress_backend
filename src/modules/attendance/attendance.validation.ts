import { z } from 'zod';
import { validateBody, validateQuery } from '../../handlers/zod-error-handler';

const zodCheckInSchema = z
  .object({
    source: z.enum(['FINGERPRINT', 'MANUAL', 'WEB']).optional().default('WEB'),
    timestamp: z.coerce.date().optional(),
    date: z.string().optional(), // YYYY-MM-DD
  })
  .strict();

export type CheckInInput = z.infer<typeof zodCheckInSchema>;

const zodCheckOutSchema = z
  .object({
    source: z.enum(['FINGERPRINT', 'MANUAL', 'WEB']).optional().default('WEB'),
    timestamp: z.coerce.date().optional(),
  })
  .strict();

export type CheckOutInput = z.infer<typeof zodCheckOutSchema>;

const zodDecideOvertimeSchema = z
  .object({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
    adminOvertimeHours: z.number().nonnegative().optional(),
    reason: z.string().optional(),
  })
  .strict();

export type DecideOvertimeInput = z.infer<typeof zodDecideOvertimeSchema>;

const zodAdminAttendanceOverrideSchema = z
  .object({
    checkIn: z.coerce.date().optional(),
    checkOut: z.coerce.date().optional(),
    reason: z.string({ message: 'Reason for override is required' }).min(1),
    notes: z.string().optional(),
  })
  .strict();

export type AdminAttendanceOverrideInput = z.infer<typeof zodAdminAttendanceOverrideSchema>;

const zodUpdateRequiredHoursSchema = z
  .object({
    requiredWorkingHours: z.number({ message: 'requiredWorkingHours is required' }).positive(),
  })
  .strict();

export type UpdateRequiredHoursInput = z.infer<typeof zodUpdateRequiredHoursSchema>;

const zodAttendanceSearchQuerySchema = z
  .object({
    employeeId: z.string().uuid().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    year: z.string().optional(),
    month: z.string().optional(),
    overtimeStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
    showPerPage: z
      .string()
      .transform((val) => (val ? parseInt(val, 10) : undefined))
      .optional(),
    pageNo: z
      .string()
      .transform((val) => (val ? parseInt(val, 10) : undefined))
      .optional(),
  })
  .strict();

export type AttendanceSearchQueryInput = z.infer<typeof zodAttendanceSearchQuerySchema>;

export const validateCheckIn = validateBody(zodCheckInSchema);
export const validateCheckOut = validateBody(zodCheckOutSchema);
export const validateDecideOvertime = validateBody(zodDecideOvertimeSchema);
export const validateAdminAttendanceOverride = validateBody(zodAdminAttendanceOverrideSchema);
export const validateUpdateRequiredHours = validateBody(zodUpdateRequiredHoursSchema);
export const validateAttendanceSearchQuery = validateQuery(zodAttendanceSearchQuerySchema);
