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

    // Join a room per permission the client holds, so change announcements can
    // be delivered only to sessions that could act on them.
    //
    // This is a traffic optimisation, NOT an authorization boundary: the
    // announcements carry a model name and nothing else, and every client still
    // has to fetch the data through the authorized API. A client that joined a
    // room it should not be in learns only that *something* changed.
    socket.on('join_permissions', (permissions: string[]) => {
      if (!Array.isArray(permissions)) return;
      // Replace rather than add: a session whose permissions were revoked must
      // stop hearing about the modules it lost, and clients re-send this list
      // whenever their permission set changes.
      for (const room of socket.rooms) {
        if (room.startsWith('perm:')) socket.leave(room);
      }
      for (const key of permissions.slice(0, 200)) {
        if (typeof key === 'string' && /^[A-Z_]{1,64}$/.test(key)) socket.join(`perm:${key}`);
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
 * Safely emit an event to every session holding any of the given permissions.
 * Falls back to a global broadcast when no audience is known, so a new model
 * is over-delivered rather than silently undelivered.
 */
export const emitToPermissions = (permissions: string[], event: string, payload: any) => {
  try {
    if (!io) return;
    if (permissions.length === 0) {
      io.emit(event, payload);
      return;
    }
    io.to(permissions.map((key) => `perm:${key}`)).emit(event, payload);
  } catch (err) {
    console.error(`[Socket] Non-fatal error emitting ${event} to permission rooms:`, err);
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
