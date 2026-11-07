import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { getSecret, verifyTicket, socketOptions } from '../server/common.js';
import { validatePacket, MAX_PACKET_BYTES } from '../shared/protocol.js';

export function createRelayServer({ secret = getSecret(), signalingUrl = process.env.SIGNAL_INTERNAL_URL || 'http://127.0.0.1:4001', allowedOrigins, lookup, log = console.log } = {}) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, socketOptions(allowedOrigins));
  const peers = new Map();
  const metrics = { forwarded: 0, rejected: 0, bytes: 0 };
  const query = lookup || (async (kind, id) => {
    const response = await fetch(`${signalingUrl}/internal/${kind}/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(2500) });
    return response.ok ? response.json() : null;
  });
  app.get('/health', (_req, res) => res.json({ service: 'relay', status: 'ok', onlinePeers: peers.size, ...metrics }));
  io.on('connection', socket => {
    socket.on('relay:register', async (data, callback) => {
      const done = typeof callback === 'function' ? callback : () => {};
      try {
        const ticket = verifyTicket(data?.token, secret);
        if (!ticket) return done({ ok: false, message: 'Vé relay không hợp lệ hoặc hết hạn.' });
        if (socket.data.ticket && socket.data.ticket.peerId !== ticket.peerId) return done({ ok: false, message: 'Một kết nối chỉ được đăng ký một Peer ID.' });
        const active = await query('peers', ticket.peerId);
        if (!socket.connected || active?.registrationId !== ticket.registrationId) return done({ ok: false, message: 'Phiên đăng ký không còn hiệu lực.' });
        const previous = peers.get(ticket.peerId);
        if (previous && previous !== socket) previous.disconnect(true);
        socket.data.ticket = ticket;
        peers.set(ticket.peerId, socket);
        log('[relay] REGISTER', ticket.peerId);
        done({ ok: true, peerId: ticket.peerId });
      } catch { done({ ok: false, message: 'Không xác thực được với signaling.' }); }
    });
    socket.on('relay:send', async (packet, callback) => {
      const done = typeof callback === 'function' ? callback : () => {};
      const reject = message => { metrics.rejected++; done({ ok: false, message }); };
      try {
        const ticket = socket.data.ticket;
        const bytes = Buffer.byteLength(JSON.stringify(packet) || '');
        if (bytes > MAX_PACKET_BYTES || !validatePacket(packet)) return reject('Gói tin không hợp lệ hoặc quá lớn.');
        if (!ticket || ticket.expiresAt <= Date.now() || peers.get(ticket.peerId) !== socket || packet.senderId !== ticket.peerId) return reject('Không được giả mạo Peer ID.');
        // Check the current signaling registration, not just a reusable ID/token.
        const [sender, receiver] = await Promise.all([query('peers', packet.senderId), query('peers', packet.receiverId)]);
        if (sender?.registrationId !== ticket.registrationId || !socket.connected) return reject('Phiên người gửi đã kết thúc.');
        const target = peers.get(packet.receiverId);
        if (!target?.connected || target.data.ticket?.expiresAt <= Date.now() || target.data.ticket?.registrationId !== receiver?.registrationId) return reject('Peer đích chưa kết nối relay hoặc đang offline.');
        if (packet.groupId) {
          const group = await query('groups', packet.groupId);
          if (!group?.members.includes(packet.senderId) || !group.members.includes(packet.receiverId)) return reject('Peer không còn là thành viên nhóm.');
        }
        // Whitelist the envelope. The content and IDs are preserved verbatim.
        const { version, type, messageId, sessionId, senderId, receiverId, groupId, sequence, timestamp, content, ackFor } = packet;
        const forwarded = { version, type, messageId, sessionId, senderId, receiverId, groupId, sequence, timestamp, content, deliveryMode: 'RELAY', ...(type === 'ACK' ? { ackFor } : {}) };
        target.emit('relay:packet', forwarded);
        metrics.forwarded++; metrics.bytes += bytes;
        log('[relay] FORWARD', type, senderId, '->', receiverId, messageId);
        done({ ok: true, deliveryMode: 'RELAY' });
      } catch { reject('Relay hoặc signaling tạm thời không khả dụng.'); }
    });
    socket.on('disconnect', reason => {
      const id = socket.data.ticket?.peerId;
      if (peers.get(id) === socket) { peers.delete(id); log('[relay] OFFLINE', id, reason); }
    });
  });
  return { app, httpServer, io, peers, metrics, close: () => new Promise(resolve => io.close(resolve)) };
}
