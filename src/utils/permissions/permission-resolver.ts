import prisma from '../prisma/prisma-client';
import { SYSTEM_PERMISSIONS, DEFAULT_EMPLOYEE_PERMISSIONS } from '../../config/permissions';

/**
 * Seed or update all system permission definitions in the database.
 * Safe to call on application startup or test environment setup.
 */
export async function seedSystemPermissions() {
  try {
    for (const perm of SYSTEM_PERMISSIONS) {
      await (prisma as any).permission.upsert({
        where: { key: perm.key },
        update: {
          name: perm.name,
          description: perm.description,
          category: perm.category,
        },
        create: {
          key: perm.key,
          name: perm.name,
          description: perm.description,
          category: perm.category,
        },
      });
    }
  } catch (err) {
    console.error('[Permissions] Failed to seed system permissions:', err);
  }
}

/**
 * Resolve effective permissions for a user.
 * - ADMIN: possess ALL system permission keys.
 * - EMPLOYEE: possess default employee permissions + explicitly assigned permissions.
 */
export async function getEffectivePermissions(userId: string, role: string): Promise<string[]> {
  if (role === 'ADMIN') {
    return SYSTEM_PERMISSIONS.map((p) => p.key);
  }

  // Fetch explicitly assigned permissions for this user
  const userPerms = await (prisma as any).userPermission.findMany({
    where: { userId },
    include: {
      permission: { select: { key: true } },
    },
  });

  const explicitKeys: string[] = userPerms.map((up: any) => up.permission.key);

  // Combine default employee permissions with explicit permissions (deduplicated)
  const combined = Array.from(new Set([...DEFAULT_EMPLOYEE_PERMISSIONS, ...explicitKeys]));
  return combined;
}
