import { Request, Response } from 'express';
import { taskServices } from './tasks.service';
import ServerResponse from '../../helpers/responses/custom-response';
import catchAsync from '../../utils/catch-async/catch-async';
import ApiError from '../../utils/errors/api-error';

interface AuthedRequest extends Request {
  user?: { id: string; email: string; role: string };
}

export const createTask = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await taskServices.createTask({
    ...req.body,
    userId: req.user!.id,
  });
  ServerResponse(res, true, 201, 'Production task created successfully', result);
});

export const getTaskById = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await taskServices.getTaskById(req.params.id as string);
  if (req.user!.role === 'EMPLOYEE') {
    const isAssigned = result.assignments?.some((a: any) => a.employeeId === req.user!.id);
    if (!isAssigned) {
      throw new ApiError(403, 'Forbidden: You are not assigned to this task');
    }
  }
  ServerResponse(res, true, 200, 'Task retrieved successfully', result);
});

export const getManyTask = catchAsync(async (req: AuthedRequest, res: Response) => {
  const { tasks, totalData, totalPages, currentPage } = await taskServices.getManyTask(
    req.query,
    req.user!.id,
    req.user!.role
  );
  ServerResponse(res, true, 200, 'Tasks retrieved successfully', {
    tasks,
    totalData,
    totalPages,
    currentPage,
  });
});

export const acceptTask = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await taskServices.acceptTask(req.params.id as string, req.user!.id, req.user!.role);
  ServerResponse(res, true, 200, 'Task accepted and inventory reserved successfully', result);
});

export const startTask = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await taskServices.startTask(req.params.id as string, req.user!.id, req.user!.role);
  ServerResponse(res, true, 200, 'Task started successfully', result);
});

export const reportProduction = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await taskServices.reportProduction({
    taskId: req.params.id as string,
    completedQuantity: req.body.completedQuantity,
    notes: req.body.notes,
    userId: req.user!.id,
    userRole: req.user!.role,
  });
  ServerResponse(res, true, 200, 'Production reported and finished stock updated successfully', result);
});

export const reportDamage = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await taskServices.reportDamage({
    taskId: req.params.id as string,
    ...req.body,
    userId: req.user!.id,
    userRole: req.user!.role,
  });
  ServerResponse(res, true, 201, 'Damage reported and inventory adjusted successfully', result);
});

export const requestRefill = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await taskServices.requestRefill({
    taskId: req.params.id as string,
    ...req.body,
    userId: req.user!.id,
    userRole: req.user!.role,
  });
  ServerResponse(res, true, 201, 'Refill request submitted successfully', result);
});

export const decideRefill = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await taskServices.decideRefill({
    requestId: req.params.id as string,
    ...req.body,
    userId: req.user!.id,
  });
  ServerResponse(res, true, 200, 'Refill request updated successfully', result);
});

export const cancelTask = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await taskServices.cancelTask(req.params.id as string, req.user!.id);
  ServerResponse(res, true, 200, 'Task cancelled and reserved inventory released successfully', result);
});
