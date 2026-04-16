import { io, Socket } from 'socket.io-client';
import type { AgentEvent, PresenceUser, CollaboratorAddedEvent } from '@hearth/shared';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io('/', {
      path: '/ws',
      transports: ['websocket', 'polling'],
      withCredentials: true,
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }
  return socket;
}

export function connectSocket(): Socket {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
  return s;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function joinSession(sessionId: string): void {
  const s = getSocket();
  if (s.connected) {
    s.emit('join:session', sessionId);
  } else {
    s.once('connect', () => s.emit('join:session', sessionId));
  }
}

export function leaveSession(sessionId: string): void {
  const s = getSocket();
  if (s.connected) {
    s.emit('leave:session', sessionId);
  }
}

export function onSessionEvent(
  _sessionId: string,
  callback: (event: AgentEvent) => void,
): () => void {
  const s = getSocket();
  s.on('agent:event', callback);
  return () => {
    s.off('agent:event', callback);
  };
}

// Presence events
export function onPresenceList(callback: (members: PresenceUser[]) => void): () => void {
  const s = getSocket();
  s.on('presence:list', callback);
  return () => {
    s.off('presence:list', callback);
  };
}

export function onPresenceJoin(callback: (user: PresenceUser) => void): () => void {
  const s = getSocket();
  s.on('presence:join', callback);
  return () => {
    s.off('presence:join', callback);
  };
}

export function onPresenceLeave(callback: (user: PresenceUser) => void): () => void {
  const s = getSocket();
  s.on('presence:leave', callback);
  return () => {
    s.off('presence:leave', callback);
  };
}

// Collaborator notification
export function onCollaboratorAdded(callback: (event: CollaboratorAddedEvent) => void): () => void {
  const s = getSocket();
  s.on('collaborator:added', callback);
  return () => {
    s.off('collaborator:added', callback);
  };
}
