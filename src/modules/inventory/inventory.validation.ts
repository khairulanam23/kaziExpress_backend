import { z } from 'zod';
import { validateBody, validateQuery } from '../../handlers/zod-error-handler';

const zodAddStockSchema = z
  .object({
    productId: z.string({ message: 'productId is required' }).uuid(),
    quantity: z.number({ message: 'quantity is required' }).positive(),
    unitCost: z.number().nonnegative().optional(),
    notes: z.string().optional(),
    vendorId: z.string().uuid({ message: 'Invalid vendorId' }).optional(),
  })
  .strict();

export type AddStockInput = z.infer<typeof zodAddStockSchema>;

const zodAdjustStockSchema = z
  .object({
    productId: z.string({ message: 'productId is required' }).uuid(),
    newQuantity: z.number().optional(),
    quantityDifference: z.number().optional(),
    batchId: z.string().uuid().optional(),
    reason: z.string({ message: 'Administrative note/reason is required' }).min(1),
  })
  .strict();

export type AdjustStockInput = z.infer<typeof zodAdjustStockSchema>;

const zodMovementQuerySchema = z
  .object({
    productId: z.string().uuid().optional(),
    type: z.string().optional(),
    batchId: z.string().uuid().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
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

export type MovementQueryInput = z.infer<typeof zodMovementQuerySchema>;

export const validateAddStock = validateBody(zodAddStockSchema);
export const validateAdjustStock = validateBody(zodAdjustStockSchema);
export const validateMovementQuery = validateQuery(zodMovementQuerySchema);
