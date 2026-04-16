import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { RequestHandler } from 'express';
import type { ChatEvent } from '@hearth/shared';
import { logger } from '../lib/logger.js';
import { getSession } from '../services/chat-service.js';

let ioInstance: SocketIOServer | null = null;

interface SocketWithUser extends Socket {
  userId?: string;
  userName?: string;
}

// In-memory presence tracking per session room
const roomPresence = new Map<string, Map<string, { userId: string; name: string }>>();

/**
 * Sets up Socket.io connection handling with session-based authentication
 * and room management for chat sessions and tasks. Unauthenticated sockets are rejected.
 */
export function setupSocketManager(
  io: SocketIOServer,
  sessionMiddleware: RequestHandler,
): void {
  ioInstance = io;

  // Share the Express session middleware with Socket.io for cookie-based auth
  io.engine.use(sessionMiddleware);

  // Authenticate the handshake — reject unauthenticated connections
  io.use(async (socket, next) => {
    const req = socket.request as unknown as {
      session?: { userId?: string };
    };
    const userId = req.session?.userId;

    if (!userId) {
      return next(new Error('Unauthorized'));
    }

    (socket as SocketWithUser).userId = userId;

    // Look up user name for presence
    try {
      const { prisma } = await import('../lib/prisma.js');
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      (socket as SocketWithUser).userName = user?.name ?? 'Unknown';
    } catch {
      (socket as SocketWithUser).userName = 'Unknown';
    }

    next();
  });

  io.on('connection', (socket: SocketWithUser) => {
    logger.info({ socketId: socket.id, userId: socket.userId }, 'Client connected');

    // Join a session room — allows owner, collaborators, and org members for org-visible sessions
    socket.on('join:session', async (sessionId: string) => {
      if (!socket.userId) {
        socket.emit('error', { message: 'Not authenticated' });
        return;
      }

      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        socket.emit('error', { message: 'Invalid sessionId' });
        return;
      }

      try {
        // getSession now checks owner, collaborator, and org-visibility
        const session = await getSession(sessionId, socket.userId);
        if (!session) {
          socket.emit('error', { message: 'Session not found' });
          logger.warn(
            { socketId: socket.id, userId: socket.userId, sessionId },
            'Rejected join:session (no access)',
          );
          return;
        }

        const room = `session:${sessionId}`;
        socket.join(room);
        logger.info({ socketId: socket.id, sessionId }, 'Joined session room');

        // Presence tracking
        if (!roomPresence.has(room)) {
          roomPresence.set(room, new Map());
        }
        const members = roomPresence.get(room)!;
        members.set(socket.id, {
          userId: socket.userId,
          name: socket.userName ?? 'Unknown',
        });

        // Broadcast presence:join to the room
        socket.to(room).emit('presence:join', {
          userId: socket.userId,
          name: socket.userName,
        });

        // Send current members list to the joining user
        const currentMembers = Array.from(members.values());
        // Deduplicate by userId (a user may have multiple tabs/sockets)
        const unique = new Map<string, { userId: string; name: string }>();
        for (const m of currentMembers) {
          unique.set(m.userId, m);
        }
        socket.emit('presence:list', Array.from(unique.values()));
      } catch (err) {
        logger.error({ err, sessionId }, 'Failed to verify session access');
        socket.emit('error', { message: 'Failed to join session' });
      }
    });

    // Leave a session room
    socket.on('leave:session', (sessionId: string) => {
      if (typeof sessionId !== 'string') return;
      const room = `session:${sessionId}`;
      socket.leave(room);

      // Update presence
      handlePresenceLeave(socket as SocketWithUser, room);

      logger.info({ socketId: socket.id, sessionId }, 'Left session room');
    });

    // Join a task room for real-time task updates — verifies ownership
    socket.on('join:task', async (taskId: string) => {
      if (!socket.userId) {
        socket.emit('error', { message: 'Not authenticated' });
        return;
      }
      if (typeof taskId !== 'string' || taskId.length === 0) {
        socket.emit('error', { message: 'Invalid taskId' });
        return;
      }

      try {
        const { prisma } = await import('../lib/prisma.js');
        const task = await prisma.task.findFirst({
          where: { id: taskId, userId: socket.userId },
          select: { id: true },
        });
        if (!task) {
          socket.emit('error', { message: 'Task not found' });
          logger.warn(
            { socketId: socket.id, userId: socket.userId, taskId },
            'Rejected join:task (not owner)',
          );
          return;
        }

        const room = `task:${taskId}`;
        socket.join(room);
        logger.info({ socketId: socket.id, taskId }, 'Joined task room');
      } catch (err) {
        logger.error({ err, taskId }, 'Failed to verify task ownership');
        socket.emit('error', { message: 'Failed to join task' });
      }
    });

    // Leave a task room
    socket.on('leave:task', (taskId: string) => {
      if (typeof taskId !== 'string') return;
      const room = `task:${taskId}`;
      socket.leave(room);
      logger.info({ socketId: socket.id, taskId }, 'Left task room');
    });

    // Auto-join user-specific room for notifications
    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
    }

    // Join org room for activity feed
    socket.on('join:org', async (orgId: string) => {
      if (!socket.userId) {
        socket.emit('error', { message: 'Not authenticated' });
        return;
      }
      if (typeof orgId !== 'string' || orgId.length === 0) {
        socket.emit('error', { message: 'Invalid orgId' });
        return;
      }

      try {
        const { prisma } = await import('../lib/prisma.js');
        const user = await prisma.user.findFirst({
          where: { id: socket.userId },
          include: { team: { select: { orgId: true } } },
        });
        if (!user || user.team?.orgId !== orgId) {
          socket.emit('error', { message: 'Not a member of this org' });
          return;
        }

        socket.join(`org:${orgId}`);
        logger.info({ socketId: socket.id, orgId }, 'Joined org room');
      } catch (err) {
        logger.error({ err, orgId }, 'Failed to join org room');
        socket.emit('error', { message: 'Failed to join org' });
      }
    });

    socket.on('leave:org', (orgId: string) => {
      if (typeof orgId !== 'string') return;
      socket.leave(`org:${orgId}`);
    });

    socket.on('disconnect', () => {
      // Clean up presence from all session rooms this socket was in
      for (const [room, members] of roomPresence.entries()) {
        if (members.has(socket.id)) {
          handlePresenceLeave(socket as SocketWithUser, room);
        }
      }

      logger.info({ socketId: socket.id }, 'Client disconnected');
    });
  });
}

/**
 * Handles presence leave — removes socket from room tracking and broadcasts
 * leave event if the user has no other sockets in the room.
 */
function handlePresenceLeave(socket: SocketWithUser, room: string): void {
  const members = roomPresence.get(room);
  if (!members) return;

  members.delete(socket.id);

  // Check if the user still has other sockets in the room
  const stillPresent = Array.from(members.values()).some(
    (m) => m.userId === socket.userId,
  );

  if (!stillPresent && socket.userId) {
    // Broadcast leave to remaining room members
    ioInstance?.to(room).emit('presence:leave', {
      userId: socket.userId,
      name: socket.userName,
    });
  }

  // Clean up empty rooms
  if (members.size === 0) {
    roomPresence.delete(room);
  }
}

/**
 * Emits a ChatEvent to all clients in a session room.
 */
export function emitToSession(sessionId: string, event: ChatEvent): void {
  if (!ioInstance) {
    logger.warn('Socket.io not initialized, cannot emit event');
    return;
  }

  ioInstance.to(`session:${sessionId}`).emit('agent:event', event);
}

/**
 * Emits a task event to all clients in a task room.
 */
export function emitToTask(taskId: string, event: Record<string, unknown>): void {
  if (!ioInstance) {
    logger.warn('Socket.io not initialized, cannot emit task event');
    return;
  }

  ioInstance.to(`task:${taskId}`).emit('task:event', event);
}

/**
 * Emits an event to a specific user (all their connected sockets).
 */
export function emitToUser(userId: string, eventName: string, event: Record<string, unknown>): void {
  if (!ioInstance) {
    logger.warn('Socket.io not initialized, cannot emit user event');
    return;
  }

  ioInstance.to(`user:${userId}`).emit(eventName, event);
}

/**
 * Emits an event to all members of an org.
 */
export function emitToOrg(orgId: string, eventName: string, event: Record<string, unknown>): void {
  if (!ioInstance) {
    logger.warn('Socket.io not initialized, cannot emit org event');
    return;
  }

  ioInstance.to(`org:${orgId}`).emit(eventName, event);
}
