import * as nativeWebRTC from './webrtc.js';
import { createRelayClient } from './relay.js';

export function createConnectionManager({ webrtc = nativeWebRTC, relay = createRelayClient(), log = console.info } = {}) {
  const modes = new Map();
  const connecting = new Map();
  const listeners = new Set();
  const receivers = new Set();
  let stops = [];
  let generation = 0;
  const report = (peerId, state, reason = null, sessionId = null) => {
    const mode = state === 'DIRECT_READY' ? 'DIRECT' : state === 'RELAY_READY' ? 'RELAY' : modes.get(peerId)?.mode;
    const event = { peerId, state, mode, reason, sessionId };
    modes.set(peerId, event);
    for (const fn of listeners) fn(event);
  };
  const fallback = (peerId, reason) => report(peerId, relay.isReady() ? 'RELAY_READY' : 'UNAVAILABLE', reason);
  return {
    relay,
    start() {
      if (stops.length) return;
      stops = [webrtc.startWebRTC(), webrtc.onStateChange(event => {
        if (event.state === 'DIRECT_READY' || event.state === 'CONNECTING' || event.state === 'DISCONNECTED') report(event.peerId, event.state, event.reason, event.sessionId);
        else if (['FAILED', 'CLOSED'].includes(event.state)) {
          if (event.intentional) report(event.peerId, 'CLOSED', event.reason);
          else { log('[peer] FALLBACK', event.peerId, event.reason); fallback(event.peerId, event.reason); }
        }
      }), webrtc.onMessage(event => {
        log('[peer] RECEIVE DIRECT', event.message.type, event.message.messageId);
        for (const fn of receivers) fn({ ...event, deliveryMode: 'DIRECT' });
      }), relay.onMessage(event => {
        // Both peers learn the relay route when either side falls back.
        if (modes.get(event.peerId)?.state !== 'DIRECT_READY') report(event.peerId, 'RELAY_READY');
        for (const fn of receivers) fn(event);
      }), relay.onStateChange(() => {
        for (const [peerId, event] of modes) if (event.state === 'RELAY_READY' || event.state === 'UNAVAILABLE') fallback(peerId, 'Trạng thái relay thay đổi.');
      })];
    },
    setIdentity: (peerId, token) => relay.setIdentity(peerId, token),
    async connect(peerId, { force = false } = {}) {
      if (connecting.has(peerId)) return connecting.get(peerId);
      const current = modes.get(peerId);
      if (!force && ['DIRECT_READY', 'RELAY_READY'].includes(current?.state)) return current;
      const version = generation;
      const attempt = (async () => {
        try {
          const result = await webrtc.connect(peerId, crypto.randomUUID());
          if (generation !== version) throw new Error('Phiên đã kết thúc.');
          report(peerId, 'DIRECT_READY', null, result.sessionId);
        } catch (error) {
          if (generation !== version) throw error;
          fallback(peerId, error.message);
          if (!relay.isReady()) throw new Error('DIRECT thất bại và relay chưa sẵn sàng.');
        }
        return modes.get(peerId);
      })().finally(() => { if (connecting.get(peerId) === attempt) connecting.delete(peerId); });
      connecting.set(peerId, attempt);
      return attempt;
    },
    async sendToPeer(packet, { preferRelay = false } = {}) {
      const version = generation;
      let route = modes.get(packet.receiverId);
      if ((!route || ['CONNECTING', 'UNAVAILABLE'].includes(route.state)) && !preferRelay) route = await this.connect(packet.receiverId);
      if (version !== generation) throw new Error('Phiên đã kết thúc.');
      if (!preferRelay && route?.state === 'DIRECT_READY') {
        try {
          const result = webrtc.send(packet.receiverId, { ...packet, deliveryMode: 'DIRECT' });
          log('[peer] SEND DIRECT', packet.type, packet.messageId);
          return result;
        } catch (error) {
          webrtc.close(packet.receiverId, error.message, false);
          fallback(packet.receiverId, error.message);
        }
      }
      const result = await relay.send(packet);
      if (version !== generation) throw new Error('Phiên đã kết thúc.');
      report(packet.receiverId, 'RELAY_READY');
      return result;
    },
    onMessage(fn) { receivers.add(fn); return () => receivers.delete(fn); },
    onStateChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    peerOffline(peerId) { webrtc.close(peerId, 'Peer đã offline.', true); modes.delete(peerId); },
    stop() {
      generation++; stops.forEach(stop => stop()); stops = [];
      webrtc.closeAll('Phiên peer đã kết thúc.'); relay.stop(); modes.clear(); connecting.clear();
    },
  };
}
