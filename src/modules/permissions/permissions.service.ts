import prisma from '../../utils/prisma/prisma-client';
import ApiError from '../../utils/errors/api-error';
import { SYSTEM_PERMISSIONS, DEFAULT_EMPLOYEE_PERMISSIONS, PERMISSION_PRESETS, PERMISSION_CATEGORIES } from '../../config/permissions';
import { getEffectivePermissions } from '../../utils/permissions/permission-resolver';

async function validatePermissionManager(performedById: string, targetUserId: string) {
  if (performedById === targetUserId) {
    throw new ApiError(403, 'Security Violation: Users cannot modify their own permissions');
  }

  const performedUser = await (prisma as any).user.findUnique({
    where: { id: performedById },
  });

  if (!performedUser || !performedUser.isActive) {
    throw new ApiError(401, 'Unauthorized');
  }

  if (performedUser.role !== 'ADMIN') {
    const performedUserPerms = await getEffectivePermissions(performedUser.id, performedUser.role);
    if (!performedUserPerms.includes('EMPLOYEE_MANAGE_PERMISSIONS')) {
      throw new ApiError(403, 'Forbidden: Insufficient permissions to manage employee permissions');
    }
  }
}

export const permissionsService = {
  /**
   * Get all system permissions grouped by category + preset configurations.
   */
  getAllPermissions: async () => {
    // Ensure all permissions are seeded in DB
    const dbPermissions = await (prisma as any).permission.findMany({
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });

    const grouped: Record<string, any[]> = {};
    for (const p of dbPermissions) {
      if (!grouped[p.category]) grouped[p.category] = [];
      grouped[p.category].push(p);
    }

    return {
      permissions: dbPermissions,
      categories: PERMISSION_CATEGORIES,
      grouped,
      presets: PERMISSION_PRESETS,
      defaultEmployeePermissions: DEFAULT_EMPLOYEE_PERMISSIONS,
    };
  },

  /**
   * Get target user's default, assigned, and effective permissions.
   */
  getUserPermissions: async (targetUserId: string) => {
    const user = await (prisma as any).user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });

    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    const assignedUserPerms = await (prisma as any).userPermission.findMany({
      where: { userId: targetUserId },
      include: {
        permission: true,
        assignedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const explicitKeys = assignedUserPerms.map((up: any) => up.permission.key);
    const effectivePermissions = await getEffectivePermissions(targetUserId, user.role);

    const auditLogs = await (prisma as any).permissionAuditLog.findMany({
      where: { targetUserId },
      include: {
        performedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return {
      user,
      defaultPermissions: DEFAULT_EMPLOYEE_PERMISSIONS,
      assignedPermissions: assignedUserPerms,
      explicitPermissionKeys: explicitKeys,
      effectivePermissions,
      auditLogs,
    };
  },

  /**
   * Replace employee's assigned permissions with the provided list.
   */
  replaceUserPermissions: async (targetUserId: string, permissionKeys: string[], performedById: string) => {
    await validatePermissionManager(performedById, targetUserId);

    const targetUser = await (prisma as any).user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      throw new ApiError(404, 'User not found');
    }

    if (!targetUser.isActive) {
      throw new ApiError(400, 'Cannot assign permissions to a deactivated employee');
    }

    // Validate permission keys
    const validKeysMap = new Map(SYSTEM_PERMISSIONS.map((p) => [p.key, p]));
    const uniqueKeys = Array.from(new Set(permissionKeys));

    for (const key of uniqueKeys) {
      if (!validKeysMap.has(key)) {
        throw new ApiError(400, `Unknown permission key '${key}'`);
      }
    }

    // Fetch DB permission records
    const permRecords = await (prisma as any).permission.findMany({
      where: { key: { in: uniqueKeys } },
    });

    return await (prisma as any).$transaction(async (tx: any) => {
      // Delete existing assignments
      await tx.userPermission.deleteMany({
        where: { userId: targetUserId },
      });

      // Insert new assignments
      if (permRecords.length > 0) {
        await tx.userPermission.createMany({
          data: permRecords.map((p: any) => ({
            userId: targetUserId,
            permissionId: p.id,
            assignedById: performedById,
          })),
        });
      }

      // Record audit log
      await tx.permissionAuditLog.create({
        data: {
          targetUserId,
          performedById,
          action: 'REPLACE',
          permissionKey: uniqueKeys.join(', ') || 'NONE',
          details: { replacedWith: uniqueKeys },
        },
      });

      const effectivePermissions = await getEffectivePermissions(targetUserId, targetUser.role);
      return {
        targetUserId,
        assignedPermissions: uniqueKeys,
        effectivePermissions,
      };
    });
  },

  /**
   * Add one or more permissions to an employee.
   */
  addUserPermissions: async (targetUserId: string, permissionKeys: string[], performedById: string) => {
    await validatePermissionManager(performedById, targetUserId);

    const targetUser = await (prisma as any).user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      throw new ApiError(404, 'User not found');
    }

    if (!targetUser.isActive) {
      throw new ApiError(400, 'Cannot assign permissions to a deactivated employee');
    }

    const validKeysMap = new Map(SYSTEM_PERMISSIONS.map((p) => [p.key, p]));
    const uniqueKeys = Array.from(new Set(permissionKeys));

    for (const key of uniqueKeys) {
      if (!validKeysMap.has(key)) {
        throw new ApiError(400, `Unknown permission key '${key}'`);
      }
    }

    const permRecords = await (prisma as any).permission.findMany({
      where: { key: { in: uniqueKeys } },
    });

    return await (prisma as any).$transaction(async (tx: any) => {
      for (const p of permRecords) {
        await tx.userPermission.upsert({
          where: {
            userId_permissionId: {
              userId: targetUserId,
              permissionId: p.id,
            },
          },
          update: { assignedById: performedById },
          create: {
            userId: targetUserId,
            permissionId: p.id,
            assignedById: performedById,
          },
        });

        await tx.permissionAuditLog.create({
          data: {
            targetUserId,
            performedById,
            action: 'ASSIGN',
            permissionKey: p.key,
          },
        });
      }

      const effectivePermissions = await getEffectivePermissions(targetUserId, targetUser.role);
      return {
        targetUserId,
        addedPermissions: uniqueKeys,
        effectivePermissions,
      };
    });
  },

  /**
   * Remove a specific assigned permission from an employee.
   */
  removeUserPermission: async (targetUserId: string, permissionKey: string, performedById: string) => {
    await validatePermissionManager(performedById, targetUserId);

    const targetUser = await (prisma as any).user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      throw new ApiError(404, 'User not found');
    }

    const perm = await (prisma as any).permission.findUnique({
      where: { key: permissionKey },
    });

    if (!perm) {
      throw new ApiError(400, `Unknown permission key '${permissionKey}'`);
    }

    return await (prisma as any).$transaction(async (tx: any) => {
      await tx.userPermission.deleteMany({
        where: {
          userId: targetUserId,
          permissionId: perm.id,
        },
      });

      await tx.permissionAuditLog.create({
        data: {
          targetUserId,
          performedById,
          action: 'REMOVE',
          permissionKey,
        },
      });

      const effectivePermissions = await getEffectivePermissions(targetUserId, targetUser.role);
      return {
        targetUserId,
        removedPermission: permissionKey,
        effectivePermissions,
      };
    });
  },
};
