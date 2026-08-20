import { z } from 'zod';
import { validateBody, validateQuery } from '../../handlers/zod-error-handler';

const zodBatchAllocationSchema = z.object({
  batchId: z.string({ message: 'batchId is required' }).uuid(),
  quantity: z.number({ message: 'quantity is required' }).positive(),
});

const zodCreateTaskSchema = z
  .object({
    title: z.string({ message: 'Title is required' }).min(1),
    description: z.string().optional(),
    productId: z.string({ message: 'productId is required' }).uuid(),
    productionQuantity: z.number({ message: 'productionQuantity is required' }).positive(),
    assignedEmployeeIds: z.array(z.string().uuid()).optional().default([]),
    deadline: z.string().optional(), // Date string YYYY-MM-DD
    parentTaskId: z.string().uuid().optional().nullable(),
    batchAllocations: z.array(zodBatchAllocationSchema).optional().default([]),
  })
  .strict();

export type CreateTaskInput = z.infer<typeof zodCreateTaskSchema>;

const zodUpdateTaskSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    deadline: z.string().optional(),
    productionQuantity: z.number().positive().optional(),
    status: z.enum(['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED', 'COMPLETED', 'CANCELLED']).optional(),
  })
  .strict();

export type UpdateTaskInput = z.infer<typeof zodUpdateTaskSchema>;

const zodAssignTaskSchema = z
  .object({
    addEmployeeIds: z.array(z.string().uuid()).optional().default([]),
    removeEmployeeIds: z.array(z.string().uuid()).optional().default([]),
  })
  .strict();

export type AssignTaskInput = z.infer<typeof zodAssignTaskSchema>;

const zodReportProductionSchema = z
  .object({
    completedQuantity: z.number({ message: 'completedQuantity is required' }).positive(),
    notes: z.string().optional(),
  })
  .strict();

export type ReportProductionInput = z.infer<typeof zodReportProductionSchema>;

const zodReportDamageSchema = z
  .object({
    productId: z.string({ message: 'productId is required' }).uuid(),
    batchId: z.string().uuid().optional(),
    quantity: z.number({ message: 'quantity is required' }).positive(),
    reason: z.string({ message: 'Reason for damage is required' }).min(1),
  })
  .strict();

export type ReportDamageInput = z.infer<typeof zodReportDamageSchema>;

const zodRefillRequestSchema = z
  .object({
    productId: z.string({ message: 'productId is required' }).uuid(),
    quantity: z.number({ message: 'quantity is required' }).positive(),
    reason: z.string().optional(),
  })
  .strict();

export type RefillRequestInput = z.infer<typeof zodRefillRequestSchema>;

const zodRefillDecisionSchema = z
  .object({
    status: z.enum(['APPROVED', 'REJECTED'], { message: 'status must be APPROVED or REJECTED' }),
    rejectionReason: z.string().optional(),
    allocatedBatchId: z.string().uuid().optional(),
  })
  .strict();

export type RefillDecisionInput = z.infer<typeof zodRefillDecisionSchema>;

const zodTaskSearchQuerySchema = z
  .object({
    status: z.enum(['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED', 'COMPLETED', 'CANCELLED']).optional(),
    assigneeId: z.string().uuid().optional(),
    createdBy: z.string().uuid().optional(),
    productId: z.string().uuid().optional(),
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

export type TaskSearchQueryInput = z.infer<typeof zodTaskSearchQuerySchema>;

export const validateCreateTask = validateBody(zodCreateTaskSchema);
export const validateUpdateTask = validateBody(zodUpdateTaskSchema);
export const validateAssignTask = validateBody(zodAssignTaskSchema);
export const validateReportProduction = validateBody(zodReportProductionSchema);
export const validateReportDamage = validateBody(zodReportDamageSchema);
export const validateRefillRequest = validateBody(zodRefillRequestSchema);
export const validateRefillDecision = validateBody(zodRefillDecisionSchema);
export const validateTaskSearchQuery = validateQuery(zodTaskSearchQuerySchema);
