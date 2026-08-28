import { z } from 'zod';
import { validateBody, validateQuery } from '../../handlers/zod-error-handler';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A disposition is a sale, an onward transfer to the company's own store, or a
 * write-off. The shape differs by type, so the rules are enforced here rather
 * than left to the caller:
 *
 *   • a sale or transfer needs a buyer and a price
 *   • a write-off has neither, and needs a reason instead
 */
const zodCreateDispositionSchema = z
  .object({
    type: z.enum(['CUSTOMER_SALE', 'STORE_TRANSFER', 'WRITE_OFF'], {
      message: 'type must be CUSTOMER_SALE, STORE_TRANSFER or WRITE_OFF',
    }),
    quantity: z.number({ message: 'quantity is required' }).positive({ message: 'quantity must be greater than 0' }),
    customerId: z.string().uuid({ message: 'Invalid customerId' }).optional().nullable(),
    unitSellingPrice: z.number().nonnegative({ message: 'unitSellingPrice cannot be negative' }).optional(),
    reason: z.string().trim().max(300).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const isSale = data.type === 'CUSTOMER_SALE' || data.type === 'STORE_TRANSFER';

    if (isSale && !data.customerId) {
      ctx.addIssue({ code: 'custom', path: ['customerId'], message: 'A buyer is required for a sale or store transfer' });
    }
    if (isSale && (data.unitSellingPrice === undefined || data.unitSellingPrice === null)) {
      ctx.addIssue({ code: 'custom', path: ['unitSellingPrice'], message: 'A selling price is required for a sale or store transfer' });
    }
    if (data.type === 'WRITE_OFF' && !data.reason?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A reason is required when writing finished goods off' });
    }
    if (data.type === 'WRITE_OFF' && data.customerId) {
      ctx.addIssue({ code: 'custom', path: ['customerId'], message: 'A write-off has no buyer' });
    }
  });

const zodReverseDispositionSchema = z
  .object({
    reason: z.string({ message: 'A reason is required to reverse a disposition' }).trim().min(1).max(300),
  })
  .strict();

const zodDispositionQuerySchema = z
  .object({
    from: z.string().regex(dateRegex).optional(),
    to: z.string().regex(dateRegex).optional(),
    type: z.enum(['CUSTOMER_SALE', 'STORE_TRANSFER', 'WRITE_OFF']).optional(),
    customerId: z.string().uuid().optional(),
    productId: z.string().uuid().optional(),
    includeReversed: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    showPerPage: z.string().transform((v) => (v ? parseInt(v, 10) : undefined)).optional(),
    pageNo: z.string().transform((v) => (v ? parseInt(v, 10) : undefined)).optional(),
  })
  .strict();

const zodFinishedGoodsQuerySchema = z
  .object({
    search: z.string().optional(),
    productId: z.string().uuid().optional(),
    status: z.enum(['UNSOLD', 'PARTLY_SOLD', 'FULLY_DISPOSED', 'ALL']).optional(),
  })
  .strict();

const zodSellingPriceSchema = z
  .object({
    sellingPrice: z.number({ message: 'sellingPrice is required' }).nonnegative().nullable(),
  })
  .strict();

const zodProfitQuerySchema = z
  .object({
    from: z.string().regex(dateRegex).optional(),
    to: z.string().regex(dateRegex).optional(),
    productId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    includeStoreTransfers: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  })
  .strict();

export type CreateDispositionInput = z.infer<typeof zodCreateDispositionSchema>;

export const validateCreateDisposition = validateBody(zodCreateDispositionSchema);
export const validateReverseDisposition = validateBody(zodReverseDispositionSchema);
export const validateDispositionQuery = validateQuery(zodDispositionQuerySchema);
export const validateFinishedGoodsQuery = validateQuery(zodFinishedGoodsQuerySchema);
export const validateSellingPrice = validateBody(zodSellingPriceSchema);
export const validateProfitQuery = validateQuery(zodProfitQuerySchema);
