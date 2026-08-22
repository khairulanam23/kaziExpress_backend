import { NextFunction, Response } from 'express';
import ServerResponse from '../helpers/responses/custom-response';
import { getEffectivePermissions } from '../utils/permissions/permission-resolver';

/**
 * Middleware requiring a single specific permission key.
 * ADMIN users automatically satisfy all permission checks.
 */
export const requirePermission = (permissionKey: string) => {
  return async (req: any, res: Response, next: NextFunction) => {
    if (!req.user) {
      return ServerResponse(res, false, 401, 'Unauthorized');
    }

    if (req.user.role === 'ADMIN') {
      return next();
    }

    // Resolve or reuse cached effective permissions on the request object
    if (!req.user.permissions) {
      req.user.permissions = await getEffectivePermissions(req.user.id, req.user.role);
    }

    if (!req.user.permissions.includes(permissionKey)) {
      return ServerResponse(res, false, 403, `Forbidden: Missing required permission '${permissionKey}'`);
    }

    next();
  };
};

/**
 * Middleware requiring ANY ONE of the provided permission keys.
 */
export const requireAnyPermission = (permissionKeys: string[]) => {
  return async (req: any, res: Response, next: NextFunction) => {
    if (!req.user) {
      return ServerResponse(res, false, 401, 'Unauthorized');
    }

    if (req.user.role === 'ADMIN') {
      return next();
    }

    if (!req.user.permissions) {
      req.user.permissions = await getEffectivePermissions(req.user.id, req.user.role);
    }

    const hasAny = permissionKeys.some((key) => req.user.permissions.includes(key));
    if (!hasAny) {
      return ServerResponse(
        res,
        false,
        403,
        `Forbidden: Requires at least one permission from [${permissionKeys.join(', ')}]`
      );
    }

    next();
  };
};

/**
 * Middleware requiring ALL of the provided permission keys.
 */
export const requireAllPermissions = (permissionKeys: string[]) => {
  return async (req: any, res: Response, next: NextFunction) => {
    if (!req.user) {
      return ServerResponse(res, false, 401, 'Unauthorized');
    }

    if (req.user.role === 'ADMIN') {
      return next();
    }

    if (!req.user.permissions) {
      req.user.permissions = await getEffectivePermissions(req.user.id, req.user.role);
    }

    const hasAll = permissionKeys.every((key) => req.user.permissions.includes(key));
    if (!hasAll) {
      return ServerResponse(
        res,
        false,
        403,
        `Forbidden: Missing one or more required permissions from [${permissionKeys.join(', ')}]`
      );
    }

    next();
  };
};
