import { io } from 'socket.io-client';
import { WEBRTC_EVENTS } from '../../shared/webrtc-events.js';

const SIGNAL_URL =
  import.meta.env?.VITE_SIGNAL_URL || (import.meta.env?.PROD ? globalThis.location?.origin : 'http://localhost:4001');

export const signalingSocket = io(SIGNAL_URL, {
  autoConnect: false,
  path: import.meta.env?.VITE_SIGNAL_PATH || '/socket.io',
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

export function sendIceCandidate(receiverId, sessionId, candidate) {
  if (candidate === null) {
    return;
  }

  if (!signalingSocket.connected) {
    throw new Error('Chưa kết nối tới signaling server.');
  }

  signalingSocket.emit(WEBRTC_EVENTS.ICE_CANDIDATE, {
    receiverId,
    sessionId,
    candidate,
  });
}

export function onOffer(handler) {
  signalingSocket.on(WEBRTC_EVENTS.OFFER, handler);

  return () => {
    signalingSocket.off(WEBRTC_EVENTS.OFFER, handler);
  };
}

export function onAnswer(handler) {
  signalingSocket.on(WEBRTC_EVENTS.ANSWER, handler);

  return () => {
    signalingSocket.off(WEBRTC_EVENTS.ANSWER, handler);
  };
}

export function onIceCandidate(handler) {
  signalingSocket.on(WEBRTC_EVENTS.ICE_CANDIDATE, handler);

  return () => {
    signalingSocket.off(WEBRTC_EVENTS.ICE_CANDIDATE, handler);
  };
}

export function onWebRTCError(handler) {
  signalingSocket.on(WEBRTC_EVENTS.ERROR, handler);

  return () => {
    signalingSocket.off(WEBRTC_EVENTS.ERROR, handler);
  };
}

export function request(event, data, timeout = 4000) {
  if (!signalingSocket.connected) return Promise.reject(new Error('Signaling đang offline.'));
  return new Promise((resolve, reject) => {
    signalingSocket.timeout(timeout).emit(event, data, (error, result) => {
      if (error || !result?.ok) reject(new Error(result?.message || 'Hết thời gian chờ signaling.'));
      else resolve(result);
    });
  });
}
