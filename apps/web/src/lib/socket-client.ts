import { io, Socket } from 'socket.io-client';
import type {
  AgentEvent,
  PresenceUser,
  PresenceState,
  ComposingUser,
  CollaboratorAddedEvent,
  NotificationItem,
  TaskCreatedFromChatEvent,
  TaskSuggestionEvent,
  TaskSuggestionResolvedEvent,
} from '@hearth/shared';

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

// Typing & composing & state
export function emitTyping(sessionId: string): void {
  const s = getSocket();
  if (s.connected) s.emit('presence:typing', sessionId);
}

export function emitComposing(sessionId: string, charCount: number): void {
  const s = getSocket();
  if (s.connected) s.emit('presence:composing', { sessionId, charCount });
}

export function emitHeartbeat(sessionId: string): void {
  const s = getSocket();
  if (s.connected) s.emit('presence:heartbeat', sessionId);
}

export function onTyping(callback: (user: { userId: string; name: string }) => void): () => void {
  const s = getSocket();
  s.on('presence:typing', callback);
  return () => { s.off('presence:typing', callback); };
}

export function onTypingStop(callback: (payload: { userId: string }) => void): () => void {
  const s = getSocket();
  s.on('presence:typing:stop', callback);
  return () => { s.off('presence:typing:stop', callback); };
}

export function onComposing(callback: (user: ComposingUser) => void): () => void {
  const s = getSocket();
  s.on('presence:composing', callback);
  return () => { s.off('presence:composing', callback); };
}

export function onComposingStop(callback: (payload: { userId: string }) => void): () => void {
  const s = getSocket();
  s.on('presence:composing:stop', callback);
  return () => { s.off('presence:composing:stop', callback); };
}

export function onPresenceState(callback: (payload: { userId: string; state: PresenceState }) => void): () => void {
  const s = getSocket();
  s.on('presence:state', callback);
  return () => { s.off('presence:state', callback); };
}

export interface MessageReactionEvent {
  messageId: string;
  userId: string;
  emoji: string;
  op: 'add' | 'remove';
}

export function onMessageReaction(callback: (event: MessageReactionEvent) => void): () => void {
  const s = getSocket();
  s.on('message:reaction', callback);
  return () => { s.off('message:reaction', callback); };
}

export function onNotification(callback: (n: NotificationItem) => void): () => void {
  const s = getSocket();
  s.on('notification:new', callback);
  return () => { s.off('notification:new', callback); };
}

export function onTaskCreatedFromChat(callback: (e: TaskCreatedFromChatEvent) => void): () => void {
  const s = getSocket();
  s.on('task:created_from_chat', callback);
  return () => { s.off('task:created_from_chat', callback); };
}

export function onTaskSuggested(callback: (e: TaskSuggestionEvent) => void): () => void {
  const s = getSocket();
  s.on('task:suggested', callback);
  return () => { s.off('task:suggested', callback); };
}

export function onTaskSuggestionResolved(callback: (e: TaskSuggestionResolvedEvent) => void): () => void {
  const s = getSocket();
  s.on('task:suggestion_resolved', callback);
  return () => { s.off('task:suggestion_resolved', callback); };
}

export interface TaskProgressEvent {
  taskId: string;
  milestone: 'started' | 'executing' | 'review' | 'done' | 'failed';
  taskTitle: string;
  taskStatus: string;
}

export function onTaskProgress(callback: (e: TaskProgressEvent) => void): () => void {
  const s = getSocket();
  s.on('task:progress', callback);
  return () => { s.off('task:progress', callback); };
}
