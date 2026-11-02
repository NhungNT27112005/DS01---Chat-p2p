import { io } from 'socket.io-client';
import { WEBRTC_EVENTS } from '../../shared/webrtc-events.js';

const SIGNAL_URL =
  import.meta.env.VITE_SIGNAL_URL || 'http://localhost:4001';

export const signalingSocket = io(SIGNAL_URL, {
  autoConnect: false,
});

export function registerPeer(peerId, displayName) {
  signalingSocket.emit('peer:register', {
    peerId,
    displayName,
  });
}

export function sendOffer(receiverId, sessionId, offer) {
  if (!signalingSocket.connected) {
    throw new Error('Chưa kết nối tới signaling server.');
  }

  signalingSocket.emit(WEBRTC_EVENTS.OFFER, {
    receiverId,
    sessionId,
    offer,
  });
}

export function sendAnswer(receiverId, sessionId, answer) {
  if (!signalingSocket.connected) {
    throw new Error('Chưa kết nối tới signaling server.');
  }

  signalingSocket.emit(WEBRTC_EVENTS.ANSWER, {
    receiverId,
    sessionId,
    answer,
  });
}
