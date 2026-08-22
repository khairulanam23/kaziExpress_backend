import { Request, Response } from 'express';
import catchAsync from '../../utils/catch-async/catch-async';
import ServerResponse from '../../helpers/responses/custom-response';
import { permissionsService } from './permissions.service';

export const getAllPermissions = catchAsync(async (_req: Request, res: Response) => {
  const data = await permissionsService.getAllPermissions();
  return ServerResponse(res, true, 200, 'Permissions retrieved successfully', data);
});

export const getUserPermissions = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const data = await permissionsService.getUserPermissions(id);
  return ServerResponse(res, true, 200, 'Employee permissions retrieved successfully', data);
});

export const replaceUserPermissions = catchAsync(async (req: any, res: Response) => {
  const id = req.params.id as string;
  const { permissions } = req.body;
  const performedById = req.user.id;

  const data = await permissionsService.replaceUserPermissions(id, permissions, performedById);
  return ServerResponse(res, true, 200, 'Employee permissions updated successfully', data);
});

export const addUserPermissions = catchAsync(async (req: any, res: Response) => {
  const id = req.params.id as string;
  const { permissions } = req.body;
  const performedById = req.user.id;

  const data = await permissionsService.addUserPermissions(id, permissions, performedById);
  return ServerResponse(res, true, 200, 'Employee permissions added successfully', data);
});

export const removeUserPermission = catchAsync(async (req: any, res: Response) => {
  const id = req.params.id as string;
  const permissionKey = req.params.permissionKey as string;
  const performedById = req.user.id;

  const data = await permissionsService.removeUserPermission(id, permissionKey, performedById);
  return ServerResponse(res, true, 200, `Permission '${permissionKey}' removed successfully`, data);
});
