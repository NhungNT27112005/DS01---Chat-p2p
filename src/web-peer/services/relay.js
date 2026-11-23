import { io } from 'socket.io-client';

export function createRelayClient({ url = import.meta.env?.VITE_RELAY_URL || (import.meta.env?.PROD ? globalThis.location?.origin : 'http://localhost:4002'), log = console.info } = {}) {
  const socket = io(url, { autoConnect: false, path: import.meta.env?.VITE_RELAY_PATH || '/socket.io' });
  const messageListeners = new Set();
  const stateListeners = new Set();
  let identity = null;
  let ready = false;
  let registration = null;
  const notify = () => { for (const fn of stateListeners) fn({ ready, connected: socket.connected }); };
  const request = (event, data) => new Promise((resolve, reject) => {
    if (!socket.connected) return reject(new Error('Relay đang offline.'));
    socket.timeout(4000).emit(event, data, (error, result) => error || !result?.ok ? reject(new Error(result?.message || 'Hết thời gian chờ relay.')) : resolve(result));
  });
  const register = () => {
    if (!identity || !socket.connected) return Promise.reject(new Error('Relay chưa sẵn sàng.'));
    if (ready) return Promise.resolve();
    if (registration) return registration;
    const captured = identity;
    registration = request('relay:register', { token: captured.token }).then(() => {
      if (identity !== captured) throw new Error('Phiên relay đã đổi.');
      ready = true; notify();
    }).finally(() => { registration = null; });
    return registration;
  };
  socket.on('connect', () => { register().catch(error => { log('[relay]', error.message); notify(); }); });
  socket.on('disconnect', () => { ready = false; registration = null; notify(); });
  socket.on('connect_error', () => { ready = false; notify(); });
  socket.on('relay:packet', packet => {
    if (!identity || packet?.receiverId !== identity.peerId) return;
    log('[peer] RECEIVE RELAY', packet.type, packet.messageId);
    for (const fn of messageListeners) fn({ peerId: packet.senderId, message: packet, deliveryMode: 'RELAY' });
  });
  return {
    socket,
    async setIdentity(peerId, token) {
      const changed = identity?.peerId !== peerId;
      if (changed && socket.connected) socket.disconnect();
      identity = { peerId, token }; ready = false; notify();
      if (!socket.connected) socket.connect();
      else await register();
    },
    async send(packet) {
      await register();
      const result = await request('relay:send', { ...packet, deliveryMode: 'RELAY' });
      log('[peer] SEND RELAY', packet.type, packet.messageId);
      return result;
    },
    onMessage(fn) { messageListeners.add(fn); return () => messageListeners.delete(fn); },
    onStateChange(fn) { stateListeners.add(fn); return () => stateListeners.delete(fn); },
    isReady: () => ready,
    stop() { identity = null; ready = false; socket.disconnect(); notify(); },
  };
}
