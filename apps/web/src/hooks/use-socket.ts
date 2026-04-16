import { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { connectSocket, disconnectSocket, getSocket } from '@/lib/socket-client';

export function useSocket(): Socket {
  const socketRef = useRef<Socket>(getSocket());

  useEffect(() => {
    const s = connectSocket();
    socketRef.current = s;

    return () => {
      disconnectSocket();
    };
  }, []);

  return socketRef.current;
}
