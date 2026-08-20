import { z } from 'zod';
import { validateBody, validateQuery } from '../../handlers/zod-error-handler';

const zodCreateSalaryPaymentSchema = z
  .object({
    employeeId: z.string({ message: 'employeeId is required' }).uuid(),
    year: z.number({ message: 'year is required' }).int().min(2000).max(2100),
    month: z.number({ message: 'month is required' }).int().min(1).max(12),
    amount: z.number({ message: 'amount is required' }).positive(),
    note: z.string().optional(),
  })
  .strict();

export type CreateSalaryPaymentInput = z.infer<typeof zodCreateSalaryPaymentSchema>;

const zodUpdateHourlyRateSchema = z
  .object({
    hourlyRate: z.number({ message: 'hourlyRate is required' }).positive(),
  })
  .strict();

export type UpdateHourlyRateInput = z.infer<typeof zodUpdateHourlyRateSchema>;

const zodPayrollQuerySchema = z
  .object({
    employeeId: z.string().uuid().optional(),
    year: z
      .string()
      .transform((val) => (val ? parseInt(val, 10) : undefined))
      .optional(),
    month: z
      .string()
      .transform((val) => (val ? parseInt(val, 10) : undefined))
      .optional(),
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

export type PayrollQueryInput = z.infer<typeof zodPayrollQuerySchema>;

export const validateCreateSalaryPayment = validateBody(zodCreateSalaryPaymentSchema);
export const validateUpdateHourlyRate = validateBody(zodUpdateHourlyRateSchema);
export const validatePayrollQuery = validateQuery(zodPayrollQuerySchema);
