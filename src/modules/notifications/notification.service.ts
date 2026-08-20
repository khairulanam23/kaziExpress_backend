import prisma from '../../utils/prisma/prisma-client';
import ApiError from '../../utils/errors/api-error';
import { emitToUser, emitToRole } from '../../utils/socket/socket';

export const notificationServices = {
  /**
   * Create a persistent notification for a user.
   * Enforces duplicate protection via eventKey.
   * Emits real-time socket event safely without affecting DB transaction.
   */
  create: async (
    userId: string,
    title: string,
    message: string,
    targetUrl?: string,
    eventKey?: string
  ) => {
    // Idempotency check to prevent duplicate notifications
    if (eventKey) {
      const existing = await prisma.notification.findUnique({
        where: { userId_eventKey: { userId, eventKey } },
      });
      if (existing) {
        return existing;
      }
    }

    const notification = await prisma.notification.create({
      data: {
        userId,
        title,
        message,
        targetUrl,
        eventKey,
      },
    });

    // Safely emit real-time event (failure will NEVER corrupt or fail business operation)
    try {
      emitToUser(userId, 'notification:new', notification);
    } catch (err) {
      console.error('[NotificationService] Socket emission error:', err);
    }

    return notification;
  },

  /**
   * Notify all active ADMIN users.
   */
  notifyAdmins: async (
    title: string,
    message: string,
    targetUrl?: string,
    eventKeyPrefix?: string
  ) => {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true },
      select: { id: true },
    });

    const notifications = await Promise.all(
      admins.map((admin) =>
        notificationServices.create(
          admin.id,
          title,
          message,
          targetUrl,
          eventKeyPrefix ? `${eventKeyPrefix}:admin:${admin.id}` : undefined
        )
      )
    );

    try {
      emitToRole('ADMIN', 'notification:new', { title, message, targetUrl });
    } catch (err) {
      console.error('[NotificationService] Socket role emission error:', err);
    }

    return notifications;
  },

  /**
   * Retrieve notifications for authenticated user.
   * Enforces 28-day retention policy and supports pagination and unread filter.
   */
  getUserNotifications: async (
    userId: string,
    query: { page?: number; limit?: number; unreadOnly?: boolean }
  ) => {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const skip = (page - 1) * limit;

    // 28-day retention filter
    const retentionCutoff = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);

    const where: any = {
      userId,
      createdAt: { gte: retentionCutoff },
    };

    if (query.unreadOnly) {
      where.isRead = false;
    }

    const [data, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Return top 5 newest notifications for header dropdown (within 28-day retention).
   */
  getQuickNotifications: async (userId: string) => {
    const retentionCutoff = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);

    return prisma.notification.findMany({
      where: {
        userId,
        createdAt: { gte: retentionCutoff },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
  },

  /**
   * Return count of non-expired unread notifications.
   */
  getUnreadCount: async (userId: string) => {
    const retentionCutoff = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);

    const count = await prisma.notification.count({
      where: {
        userId,
        isRead: false,
        createdAt: { gte: retentionCutoff },
      },
    });

    return { count };
  },

  /**
   * Mark single notification as read (Ownership verified).
   */
  markAsRead: async (id: string, userId: string) => {
    const notification = await prisma.notification.findUnique({ where: { id } });

    if (!notification) {
      throw ApiError.notFound('Notification not found');
    }

    if (notification.userId !== userId) {
      throw new ApiError(403, 'Unauthorized to modify this notification');
    }

    return prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  },

  /**
   * Mark all non-expired notifications as read for user.
   */
  markAllAsRead: async (userId: string) => {
    const retentionCutoff = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);

    return prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
        createdAt: { gte: retentionCutoff },
      },
      data: { isRead: true },
    });
  },

  /**
   * Delete single notification (Ownership verified).
   */
  deleteNotification: async (id: string, userId: string) => {
    const notification = await prisma.notification.findUnique({ where: { id } });

    if (!notification) {
      throw ApiError.notFound('Notification not found');
    }

    if (notification.userId !== userId) {
      throw new ApiError(403, 'Unauthorized to delete this notification');
    }

    return prisma.notification.delete({ where: { id } });
  },

  /**
   * Safe cleanup operation: Purges notifications older than 28 days.
   */
  deleteExpiredNotifications: async () => {
    const retentionCutoff = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);

    const result = await prisma.notification.deleteMany({
      where: {
        createdAt: { lt: retentionCutoff },
      },
    });

    return { deletedCount: result.count };
  },
};
