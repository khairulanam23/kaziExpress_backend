import { Router } from 'express';
import {
  getUserNotifications,
  getQuickNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} from './notification.controller';
import { validateNotificationQuery } from './notification.validation';
import { validateId } from '../../handlers/common-zod-validator';
import isAuthorized from '../../middlewares/is-authorized';

const router = Router();

router.use(isAuthorized);

/** @route GET /api/v1/notifications — Authenticated user's notifications */
router.get('/', validateNotificationQuery, getUserNotifications);

/** @route GET /api/v1/notifications/quick — Top 5 newest notifications for header */
router.get('/quick', getQuickNotifications);

/** @route GET /api/v1/notifications/unread-count — Unread non-expired count */
router.get('/unread-count', getUnreadCount);

/** @route PATCH /api/v1/notifications/read-all — Mark all notifications read */
router.patch('/read-all', markAllAsRead);

/** @route PATCH /api/v1/notifications/:id/read — Mark 1 notification read */
router.patch('/:id/read', validateId, markAsRead);

/** @route DELETE /api/v1/notifications/:id — Delete notification */
router.delete('/:id', validateId, deleteNotification);

module.exports = router;
