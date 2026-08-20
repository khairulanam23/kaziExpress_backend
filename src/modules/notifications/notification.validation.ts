import { z } from 'zod';
import { validateQuery } from '../../handlers/zod-error-handler';

const zodNotificationQuerySchema = z
  .object({
    page: z
      .string()
      .transform((val) => (val ? parseInt(val, 10) : 1))
      .optional(),
    limit: z
      .string()
      .transform((val) => (val ? parseInt(val, 10) : 20))
      .optional(),
    unreadOnly: z
      .string()
      .transform((val) => val === 'true')
      .optional(),
  })
  .strict();

export type NotificationQueryInput = z.infer<typeof zodNotificationQuerySchema>;

export const validateNotificationQuery = validateQuery(zodNotificationQuerySchema);
