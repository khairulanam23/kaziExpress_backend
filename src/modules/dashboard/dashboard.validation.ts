import { z } from 'zod';
import { validateQuery } from '../../handlers/zod-error-handler';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const zodDashboardQuerySchema = z
  .object({
    from: z
      .string()
      .regex(dateRegex, { message: 'from date must be in YYYY-MM-DD format' })
      .optional(),
    to: z
      .string()
      .regex(dateRegex, { message: 'to date must be in YYYY-MM-DD format' })
      .optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.from && data.to) {
        return new Date(data.from) <= new Date(data.to);
      }
      return true;
    },
    { message: "'from' date must be less than or equal to 'to' date", path: ['from'] }
  );

export type DashboardQueryInput = z.infer<typeof zodDashboardQuerySchema>;

export const validateDashboardQuery = validateQuery(zodDashboardQuerySchema);
