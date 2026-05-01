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
type PresenceState = 'active' | 'viewing' | 'idle';
interface PresenceMember {
  userId: string;
  name: string;
  lastActiveAt: number;
  state: PresenceState;
}
const roomPresence = new Map<string, Map<string, PresenceMember>>();

// Per-(socket,room) typing/composing TTL timers
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const composingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const TYPING_TTL_MS = 5_000;
const COMPOSING_TTL_MS = 30_000;
const IDLE_AFTER_MS = 120_000;

function timerKey(socketId: string, room: string): string {
  return `${socketId}:${room}`;
}

// Periodically demote idle users and rebroadcast state changes.
let idleSweepStarted = false;
function startIdleSweep(): void {
  if (idleSweepStarted) return;
  idleSweepStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [room, members] of roomPresence.entries()) {
      const seenUserState = new Map<string, PresenceState>();
      // Per-user worst (newest-state-precedence) — collapse multi-tab.
      for (const m of members.values()) {
        const isIdle = now - m.lastActiveAt > IDLE_AFTER_MS;
        const next: PresenceState = isIdle ? 'idle' : m.state;
        const prior = seenUserState.get(m.userId);
        // Promote: active > viewing > idle
        const rank = (s: PresenceState) => (s === 'active' ? 2 : s === 'viewing' ? 1 : 0);
        if (!prior || rank(next) > rank(prior)) seenUserState.set(m.userId, next);
      }
      for (const [userId, state] of seenUserState.entries()) {
        // If any socket for this user has a different `state` than `state`, update + emit.
        let changed = false;
        for (const m of members.values()) {
          if (m.userId === userId && m.state !== state) {
            m.state = state;
            changed = true;
          }
        }
        if (changed) {
          ioInstance?.to(room).emit('presence:state', { userId, state });
        }
      }
    }
  }, 30_000).unref();
}

/**
 * Sets up Socket.io connection handling with session-based authentication
 * and room management for chat sessions and tasks. Unauthenticated sockets are rejected.
 */
export function setupSocketManager(
  io: SocketIOServer,
  sessionMiddleware: RequestHandler,
): void {
  ioInstance = io;
  startIdleSweep();

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
          lastActiveAt: Date.now(),
          state: 'viewing',
        });

        // Broadcast presence:join to the room
        socket.to(room).emit('presence:join', {
          userId: socket.userId,
          name: socket.userName,
        });

        // Send current members list to the joining user (with state)
        const unique = new Map<string, { userId: string; name: string; state: PresenceState }>();
        for (const m of members.values()) {
          // Promote to the strongest state any of the user's sockets reports.
          const prior = unique.get(m.userId);
          const rank = (s: PresenceState) => (s === 'active' ? 2 : s === 'viewing' ? 1 : 0);
          if (!prior || rank(m.state) > rank(prior.state)) {
            unique.set(m.userId, { userId: m.userId, name: m.name, state: m.state });
          }
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

    // Typing indicator (short TTL, no DB)
    socket.on('presence:typing', (sessionId: string) => {
      if (!socket.userId || typeof sessionId !== 'string') return;
      const room = `session:${sessionId}`;
      // Only emit if the socket is actually in the room (was access-checked at join).
      if (!socket.rooms.has(room)) return;
      socket.to(room).emit('presence:typing', { userId: socket.userId, name: socket.userName });
      bumpActive(socket as SocketWithUser, room);

      const key = timerKey(socket.id, room);
      const prior = typingTimers.get(key);
      if (prior) clearTimeout(prior);
      typingTimers.set(
        key,
        setTimeout(() => {
          typingTimers.delete(key);
          ioInstance?.to(room).emit('presence:typing:stop', { userId: socket.userId });
        }, TYPING_TTL_MS),
      );
    });

    // Composing indicator (longer TTL — signals "I'm about to send a prompt")
    socket.on('presence:composing', (payload: { sessionId: string; charCount: number }) => {
      if (!socket.userId || !payload || typeof payload.sessionId !== 'string') return;
      const room = `session:${payload.sessionId}`;
      if (!socket.rooms.has(room)) return;
      const charCount = Math.max(0, Math.min(10_000, Number(payload.charCount) || 0));
      socket.to(room).emit('presence:composing', {
        userId: socket.userId,
        name: socket.userName,
        charCount,
      });
      bumpActive(socket as SocketWithUser, room);

      const key = timerKey(socket.id, room);
      const prior = composingTimers.get(key);
      if (prior) clearTimeout(prior);
      composingTimers.set(
        key,
        setTimeout(() => {
          composingTimers.delete(key);
          ioInstance?.to(room).emit('presence:composing:stop', { userId: socket.userId });
        }, COMPOSING_TTL_MS),
      );
    });

    // Heartbeat — refresh lastActiveAt so the idle sweep doesn't demote.
    socket.on('presence:heartbeat', (sessionId: string) => {
      if (typeof sessionId !== 'string') return;
      bumpActive(socket as SocketWithUser, `session:${sessionId}`);
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
 * Updates lastActiveAt and (if changed) broadcasts state=active for the user.
 */
function bumpActive(socket: SocketWithUser, room: string): void {
  const members = roomPresence.get(room);
  if (!members || !socket.userId) return;
  const m = members.get(socket.id);
  if (!m) return;
  m.lastActiveAt = Date.now();
  if (m.state !== 'active') {
    m.state = 'active';
    ioInstance?.to(room).emit('presence:state', { userId: socket.userId, state: 'active' });
  }
}

/**
 * Handles presence leave — removes socket from room tracking and broadcasts
 * leave event if the user has no other sockets in the room.
 */
function handlePresenceLeave(socket: SocketWithUser, room: string): void {
  // Clear any TTL timers for this socket+room.
  const tKey = timerKey(socket.id, room);
  const t = typingTimers.get(tKey);
  if (t) { clearTimeout(t); typingTimers.delete(tKey); }
  const c = composingTimers.get(tKey);
  if (c) { clearTimeout(c); composingTimers.delete(tKey); }

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
 * Emits a named event to all clients in a session room.
 */
export function emitToSessionEvent(
  sessionId: string,
  eventName: string,
  payload: Record<string, unknown>,
): void {
  if (!ioInstance) {
    logger.warn('Socket.io not initialized, cannot emit session event');
    return;
  }

  ioInstance.to(`session:${sessionId}`).emit(eventName, payload);
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
