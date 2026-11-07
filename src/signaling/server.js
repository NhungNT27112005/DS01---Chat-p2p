import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { WEBRTC_EVENTS } from '../shared/webrtc-events.js';
import { isId } from '../shared/protocol.js';
import { getSecret, issueTicket, socketOptions } from '../server/common.js';

export function createSignalingServer({ secret = getSecret(), allowedOrigins, groupFile = null, log = console.log } = {}) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, socketOptions(allowedOrigins));
  const peers = new Map();
  const groups = new Map();
  if (groupFile) {
    try { for (const group of JSON.parse(readFileSync(groupFile, 'utf8'))) if (isId(group.groupId) && isId(group.ownerId) && Array.isArray(group.members) && group.members.includes(group.ownerId) && group.members.every(isId)) groups.set(group.groupId, group); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot load groups: ${error.message}`); }
  }
  const saveGroups = () => {
    if (!groupFile) return;
    mkdirSync(dirname(groupFile), { recursive: true });
    writeFileSync(`${groupFile}.tmp`, JSON.stringify([...groups.values()], null, 2));
    renameSync(`${groupFile}.tmp`, groupFile);
  };
  const publicPeer = p => ({ peerId: p.peerId, displayName: p.displayName, status: 'ONLINE', connectivity: p.connectivity });
  const broadcastPeers = () => io.emit('peers:list', [...peers.values()].map(publicPeer));
  const groupsFor = id => [...groups.values()].filter(g => g.members.includes(id));
  const broadcastGroups = () => {
    for (const peer of peers.values()) io.to(peer.socketId).emit('groups:list', groupsFor(peer.peerId));
  };
  app.get('/health', (_req, res) => res.json({ service: 'signaling', status: 'ok', onlinePeers: peers.size }));
  app.get('/internal/peers/:id', (req, res) => {
    if (req.headers.authorization !== `Bearer ${secret}`) return res.sendStatus(403);
    const peer = peers.get(req.params.id);
    return peer ? res.json({ peerId: peer.peerId, registrationId: peer.socketId }) : res.sendStatus(404);
  });
  app.get('/internal/groups/:id', (req, res) => {
    if (req.headers.authorization !== `Bearer ${secret}`) return res.sendStatus(403);
    const group = groups.get(req.params.id);
    return group ? res.json(group) : res.sendStatus(404);
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
      socket.emit('groups:list', groupsFor(peerId));
      broadcastPeers();
      log('[signaling] REGISTER', peerId);
    });
    socket.on('peer:ticket', (_data, callback) => {
      if (registered() && typeof callback === 'function') callback({ ok: true, token: issueTicket(socket.data.peerId, socket.id, secret) });
    });
    // Socket.IO heartbeat removes dead sockets after pingInterval + pingTimeout.
    socket.on('peers:refresh', () => socket.emit('peers:list', [...peers.values()].map(publicPeer)));
    socket.on('groups:refresh', () => { if (registered()) socket.emit('groups:list', groupsFor(socket.data.peerId)); });
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
    socket.on('group:create', (data, callback) => {
      const done = typeof callback === 'function' ? callback : () => {};
      if (!registered()) return done({ ok: false, message: 'Chưa đăng ký peer.' });
      const name = typeof data?.name === 'string' ? data.name.trim() : '';
      const members = [...new Set([socket.data.peerId, ...(Array.isArray(data?.members) ? data.members : [])])];
      if (!name || name.length > 80 || members.length > 50 || !members.every(id => isId(id) && peers.has(id))) return done({ ok: false, message: 'Tên nhóm hoặc thành viên không hợp lệ (tối đa 50 người).' });
      const group = { groupId: randomUUID(), name, ownerId: socket.data.peerId, members, revision: 1 };
      groups.set(group.groupId, group);
      try { saveGroups(); } catch { groups.delete(group.groupId); return done({ ok: false, message: 'Không thể lưu nhóm.' }); }
      broadcastGroups(); done({ ok: true, group });
    });
    socket.on('group:update', (data, callback) => {
      const done = typeof callback === 'function' ? callback : () => {};
      const group = groups.get(data?.groupId);
      if (!registered() || !group || group.ownerId !== socket.data.peerId) return done({ ok: false, message: 'Chỉ chủ nhóm được đổi thành viên.' });
      if (data.revision !== group.revision) return done({ ok: false, message: 'Nhóm vừa thay đổi. Hãy thử lại.' });
      const members = [...new Set(Array.isArray(data.members) ? data.members : [])];
      if (!members.includes(group.ownerId) || members.length > 50 || !members.every(isId) || members.some(id => !group.members.includes(id) && !peers.has(id))) return done({ ok: false, message: 'Danh sách thành viên không hợp lệ.' });
      const updated = { ...group, members, revision: group.revision + 1 };
      groups.set(group.groupId, updated);
      try { saveGroups(); } catch { groups.set(group.groupId, group); return done({ ok: false, message: 'Không thể lưu nhóm.' }); }
      broadcastGroups(); done({ ok: true, group: updated });
    });
    socket.on('disconnect', reason => {
      const id = socket.data.peerId;
      if (peers.get(id)?.socketId === socket.id) {
        peers.delete(id); broadcastPeers(); log('[signaling] OFFLINE', id, reason);
      }
    });
  });
  return { app, httpServer, io, peers, groups, close: () => new Promise(resolve => io.close(resolve)) };
}
