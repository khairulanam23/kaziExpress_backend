import { Request, Response } from 'express';
import { dashboardServices } from './dashboard.service';
import ServerResponse from '../../helpers/responses/custom-response';
import catchAsync from '../../utils/catch-async/catch-async';

import { getEffectivePermissions } from '../../utils/permissions/permission-resolver';

interface AuthedRequest extends Request {
  user?: { id: string; email: string; role: string; permissions?: string[] };
}

export const getDashboardOverview = catchAsync(async (req: AuthedRequest, res: Response) => {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const user = req.user!;

  const permissions = user.permissions || (await getEffectivePermissions(user.id, user.role));

  if (user.role === 'ADMIN' || permissions.includes('DASHBOARD_ADMIN_VIEW')) {
    const data = await dashboardServices.getAdminDashboardOverview(user.id, from, to);
    return ServerResponse(res, true, 200, 'Admin dashboard overview retrieved successfully', data);
  } else {
    const data = await dashboardServices.getEmployeeDashboardOverview(user.id, from, to);
    return ServerResponse(res, true, 200, 'Employee dashboard overview retrieved successfully', data);
  }
});
