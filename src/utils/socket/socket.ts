import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';

let io: SocketIOServer | undefined;

export const initSocket = (server: HttpServer) => {
  io = new SocketIOServer(server, {
    cors: {
      origin: '*', // For production, restricted to config.CORS_ORIGIN
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    },
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // Join user channel room
    socket.on('join_user', (userId: string) => {
      if (userId) {
        socket.join(`user:${userId}`);
      }
    });

    // Join role channel room
    socket.on('join_role', (role: string) => {
      if (role) {
        socket.join(`role:${role}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  return io;
};

export const getIO = (): SocketIOServer => {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
};

/**
 * Safely emit event to a specific user.
 * Socket failure will NEVER throw or interrupt underlying business logic.
 */
export const emitToUser = (userId: string, event: string, payload: any) => {
  try {
    if (io) {
      io.to(`user:${userId}`).emit(event, payload);
    }
  } catch (err) {
    console.error(`[Socket] Non-fatal error emitting ${event} to user ${userId}:`, err);
  }
};

/**
 * Safely emit event to all users in a role room (e.g. ADMIN).
 * Socket failure will NEVER throw or interrupt underlying business logic.
 */
export const emitToRole = (role: string, event: string, payload: any) => {
  try {
    if (io) {
      io.to(`role:${role}`).emit(event, payload);
    }
  } catch (err) {
    console.error(`[Socket] Non-fatal error emitting ${event} to role ${role}:`, err);
  }
};
