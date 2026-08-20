import { Request, Response } from 'express';
import { notificationServices } from './notification.service';
import ServerResponse from '../../helpers/responses/custom-response';
import catchAsync from '../../utils/catch-async/catch-async';

interface AuthedRequest extends Request {
  user?: { id: string; email: string; role: string };
}

export const getUserNotifications = catchAsync(async (req: AuthedRequest, res: Response) => {
  const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
  const unreadOnly = req.query.unreadOnly === 'true';

  const result = await notificationServices.getUserNotifications(req.user!.id, {
    page,
    limit,
    unreadOnly,
  });

  ServerResponse(res, true, 200, 'Notifications retrieved successfully', result);
});

export const getQuickNotifications = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await notificationServices.getQuickNotifications(req.user!.id);
  ServerResponse(res, true, 200, 'Quick notifications retrieved successfully', result);
});

export const getUnreadCount = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await notificationServices.getUnreadCount(req.user!.id);
  ServerResponse(res, true, 200, 'Unread notification count retrieved successfully', result);
});

export const markAsRead = catchAsync(async (req: AuthedRequest, res: Response) => {
  const id = req.params.id as string;
  const result = await notificationServices.markAsRead(id, req.user!.id);
  ServerResponse(res, true, 200, 'Notification marked as read', result);
});

export const markAllAsRead = catchAsync(async (req: AuthedRequest, res: Response) => {
  const result = await notificationServices.markAllAsRead(req.user!.id);
  ServerResponse(res, true, 200, 'All notifications marked as read', result);
});

export const deleteNotification = catchAsync(async (req: AuthedRequest, res: Response) => {
  const id = req.params.id as string;
  const result = await notificationServices.deleteNotification(id, req.user!.id);
  ServerResponse(res, true, 200, 'Notification deleted successfully', result);
});
