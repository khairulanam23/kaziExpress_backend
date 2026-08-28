import { z } from 'zod';
import { validateBody, validateQuery } from '../../handlers/zod-error-handler';

const zodCreateCustomerSchema = z
  .object({
    name: z.string({ message: 'Customer name is required' }).trim().min(1).max(160),
    type: z.enum(['RETAIL', 'WHOLESALE', 'OWN_STORE']).optional().default('RETAIL'),
    phone: z.string().trim().max(40).optional().nullable(),
    email: z.string().trim().email({ message: 'Invalid email' }).optional().nullable(),
    address: z.string().trim().max(300).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

const zodUpdateCustomerSchema = zodCreateCustomerSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict();

const zodCustomerQuerySchema = z
  .object({
    search: z.string().optional(),
    type: z.enum(['RETAIL', 'WHOLESALE', 'OWN_STORE']).optional(),
    includeInactive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  })
  .strict();

export type CreateCustomerInput = z.infer<typeof zodCreateCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof zodUpdateCustomerSchema>;

export const validateCreateCustomer = validateBody(zodCreateCustomerSchema);
export const validateUpdateCustomer = validateBody(zodUpdateCustomerSchema);
export const validateCustomerQuery = validateQuery(zodCustomerQuerySchema);
