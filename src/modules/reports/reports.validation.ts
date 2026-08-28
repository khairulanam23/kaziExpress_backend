import { z } from 'zod';
import { validateQuery } from '../../handlers/zod-error-handler';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const zodInventoryReportQuerySchema = z
  .object({
    itemType: z.enum(['COMPONENT', 'PRODUCT']).optional(),
    categoryId: z.string().optional(),
    vendorId: z.string().optional(),
    status: z.enum(['ACTIVE', 'DISCONTINUED', 'ALL']).optional(),
  })
  .strict();

export const zodStockMovementReportQuerySchema = z
  .object({
    from: z.string().regex(dateRegex).optional(),
    to: z.string().regex(dateRegex).optional(),
    productId: z.string().optional(),
    type: z.string().optional(),
    performedById: z.string().optional(),
    taskId: z.string().optional(),
    batchId: z.string().optional(),
    page: z.string().transform((v) => (v ? parseInt(v, 10) : 1)).optional(),
    limit: z.string().transform((v) => (v ? parseInt(v, 10) : 20)).optional(),
  })
  .strict();

export const zodProductionReportQuerySchema = z
  .object({
    from: z.string().regex(dateRegex).optional(),
    to: z.string().regex(dateRegex).optional(),
    employeeId: z.string().optional(),
    productId: z.string().optional(),
    status: z.enum(['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED', 'COMPLETED', 'CANCELLED']).optional(),
  })
  .strict();

export const zodAttendanceReportQuerySchema = z
  .object({
    from: z.string().regex(dateRegex).optional(),
    to: z.string().regex(dateRegex).optional(),
    employeeId: z.string().optional(),
  })
  .strict();

export const zodPayrollReportQuerySchema = z
  .object({
    year: z.string().transform((v) => parseInt(v, 10)).optional(),
    month: z.string().transform((v) => parseInt(v, 10)).optional(),
    employeeId: z.string().optional(),
  })
  .strict();

export const zodEmployeePerformanceQuerySchema = z
  .object({
    from: z.string().regex(dateRegex).optional(),
    to: z.string().regex(dateRegex).optional(),
  })
  .strict();

// ── Analytical reports (roadmap items 4, 5, 7, 11, 12) ─────────────────────

export const zodWasteReportQuerySchema = z
  .object({
    from: z.string().regex(dateRegex).optional(),
    to: z.string().regex(dateRegex).optional(),
    productId: z.string().uuid().optional(),
  })
  .strict();

export const zodReorderReportQuerySchema = z
  .object({
    lookbackDays: z.string().transform((v) => (v ? parseInt(v, 10) : undefined)).optional(),
    horizonDays: z.string().transform((v) => (v ? parseInt(v, 10) : undefined)).optional(),
  })
  .strict();

export const zodProductionCostQuerySchema = z
  .object({
    from: z.string().regex(dateRegex).optional(),
    to: z.string().regex(dateRegex).optional(),
    productId: z.string().uuid().optional(),
  })
  .strict();

export const zodValuationQuerySchema = z
  .object({ categoryId: z.string().uuid().optional() })
  .strict();

export const zodLabourEfficiencyQuerySchema = z
  .object({
    from: z.string().regex(dateRegex).optional(),
    to: z.string().regex(dateRegex).optional(),
  })
  .strict();

export const zodVendorPerformanceQuerySchema = z
  .object({
    from: z.string().regex(dateRegex).optional(),
    to: z.string().regex(dateRegex).optional(),
    vendorId: z.string().uuid().optional(),
  })
  .strict();

export const validateInventoryReportQuery = validateQuery(zodInventoryReportQuerySchema);
export const validateVendorPerformanceQuery = validateQuery(zodVendorPerformanceQuerySchema);
export const validateWasteReportQuery = validateQuery(zodWasteReportQuerySchema);
export const validateReorderReportQuery = validateQuery(zodReorderReportQuerySchema);
export const validateProductionCostQuery = validateQuery(zodProductionCostQuerySchema);
export const validateValuationQuery = validateQuery(zodValuationQuerySchema);
export const validateLabourEfficiencyQuery = validateQuery(zodLabourEfficiencyQuerySchema);
export const validateStockMovementReportQuery = validateQuery(zodStockMovementReportQuerySchema);
export const validateProductionReportQuery = validateQuery(zodProductionReportQuerySchema);
export const validateAttendanceReportQuery = validateQuery(zodAttendanceReportQuerySchema);
export const validatePayrollReportQuery = validateQuery(zodPayrollReportQuerySchema);
export const validateEmployeePerformanceQuery = validateQuery(zodEmployeePerformanceQuerySchema);
