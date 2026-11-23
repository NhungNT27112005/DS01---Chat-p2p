import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { WEBRTC_EVENTS } from '../shared/webrtc-events.js';
import { isId } from '../shared/protocol.js';
import { getSecret, issueTicket, socketOptions } from '../server/common.js';

export function createSignalingServer({ secret = getSecret(), allowedOrigins, log = console.log } = {}) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, socketOptions(allowedOrigins));
  const peers = new Map();
  const publicPeer = p => ({ peerId: p.peerId, displayName: p.displayName, status: 'ONLINE', connectivity: p.connectivity });
  const broadcastPeers = () => io.emit('peers:list', [...peers.values()].map(publicPeer));
  app.get('/health', (_req, res) => res.json({ service: 'signaling', status: 'ok', onlinePeers: peers.size }));
  app.get('/internal/peers/:id', (req, res) => {
    if (req.headers.authorization !== `Bearer ${secret}`) return res.sendStatus(403);
    const peer = peers.get(req.params.id);
    return peer ? res.json({ peerId: peer.peerId, registrationId: peer.socketId }) : res.sendStatus(404);
  });
  io.on('connection', socket => {
    socket.emit('peers:list', [...peers.values()].map(publicPeer));
    const registered = () => socket.data.peerId && peers.get(socket.data.peerId)?.socketId === socket.id;
    socket.on('peer:register', data => {
      const peerId = typeof data?.peerId === 'string' ? data.peerId.trim() : '';
      const displayName = typeof data?.displayName === 'string' ? data.displayName.trim() : '';
      const reject = message => socket.emit('peer:register:result', { ok: false, message });
      if (!isId(peerId) || !displayName || displayName.length > 80) return reject('Peer ID hoặc tên hiển thị không hợp lệ.');
      if (socket.data.peerId || peers.has(peerId)) return reject('Peer ID đang được sử dụng hoặc kết nối đã đăng ký.');
      const peer = { peerId, displayName, socketId: socket.id, connectivity: { webRTC: true, relay: true } };
      peers.set(peerId, peer);
      socket.data.peerId = peerId;
      const relayToken = issueTicket(peerId, socket.id, secret);
      socket.emit('peer:register:result', { ok: true, message: 'Tham gia mạng thành công.', peer: publicPeer(peer), relayToken });
      broadcastPeers();
      log('[signaling] REGISTER', peerId);
    });
    socket.on('peer:ticket', (_data, callback) => {
      if (registered() && typeof callback === 'function') callback({ ok: true, token: issueTicket(socket.data.peerId, socket.id, secret) });
    });
    // Socket.IO heartbeat removes dead sockets after pingInterval + pingTimeout.
    socket.on('peers:refresh', () => socket.emit('peers:list', [...peers.values()].map(publicPeer)));
    // Signaling forwards metadata only; chat packets are never routed here.
    for (const [event, field, type] of [
      [WEBRTC_EVENTS.OFFER, 'offer', 'offer'], [WEBRTC_EVENTS.ANSWER, 'answer', 'answer'], [WEBRTC_EVENTS.ICE_CANDIDATE, 'candidate', null],
    ]) {
      socket.on(event, data => {
        const receiverId = data?.receiverId;
        const sessionId = data?.sessionId;
        const value = data?.[field];
        const error = (code, message) => socket.emit(WEBRTC_EVENTS.ERROR, { code, message, receiverId, sessionId });
        if (!registered()) return error('NOT_REGISTERED', 'Bạn cần tham gia mạng trước khi kết nối.');
        if (!isId(receiverId) || receiverId === socket.data.peerId || !isId(sessionId) || !value || typeof value !== 'object' || Array.isArray(value)) return error('INVALID_SIGNAL', 'Gói signaling không hợp lệ.');
        if (type ? value.type !== type || typeof value.sdp !== 'string' || !value.sdp.trim() || value.sdp.length > 48000 : typeof value.candidate !== 'string' || value.candidate.length > 4096) return error('INVALID_SIGNAL', 'SDP hoặc ICE không hợp lệ.');
        const receiver = peers.get(receiverId);
        if (!receiver) return error('PEER_OFFLINE', 'Peer đích hiện không online.');
        const clean = type ? { type, sdp: value.sdp } : { candidate: value.candidate, sdpMid: value.sdpMid ?? null, sdpMLineIndex: value.sdpMLineIndex ?? null, usernameFragment: value.usernameFragment ?? null };
        io.to(receiver.socketId).emit(event, { senderId: socket.data.peerId, receiverId, sessionId, [field]: clean });
      });
    }
    socket.on('disconnect', reason => {
      const id = socket.data.peerId;
      if (peers.get(id)?.socketId === socket.id) {
        peers.delete(id); broadcastPeers(); log('[signaling] OFFLINE', id, reason);
      }
    });
  });
  return { app, httpServer, io, peers, close: () => new Promise(resolve => io.close(resolve)) };
}
