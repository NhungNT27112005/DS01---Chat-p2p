import { io } from 'socket.io-client';

const SIGNAL_URL =
  import.meta.env.VITE_SIGNAL_URL || 'http://localhost:4001';

export const signalingSocket = io(SIGNAL_URL, {
  autoConnect: false,
});
