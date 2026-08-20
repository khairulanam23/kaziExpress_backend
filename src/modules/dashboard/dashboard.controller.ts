import { Request, Response } from 'express';
import { dashboardServices } from './dashboard.service';
import ServerResponse from '../../helpers/responses/custom-response';
import catchAsync from '../../utils/catch-async/catch-async';

interface AuthedRequest extends Request {
  user?: { id: string; email: string; role: string };
}

export const getDashboardOverview = catchAsync(async (req: AuthedRequest, res: Response) => {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const user = req.user!;

  if (user.role === 'ADMIN') {
    const data = await dashboardServices.getAdminDashboardOverview(user.id, from, to);
    return ServerResponse(res, true, 200, 'Admin dashboard overview retrieved successfully', data);
  } else {
    const data = await dashboardServices.getEmployeeDashboardOverview(user.id, from, to);
    return ServerResponse(res, true, 200, 'Employee dashboard overview retrieved successfully', data);
  }
});
