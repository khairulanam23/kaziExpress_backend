import { z } from 'zod';
import { validateBody } from '../../handlers/zod-error-handler';

export const permissionSchema = z.object({
  permissions: z.array(z.string()).min(0, 'Permissions array must be provided'),
});

export const validatePermissionsPayload = validateBody(permissionSchema);
