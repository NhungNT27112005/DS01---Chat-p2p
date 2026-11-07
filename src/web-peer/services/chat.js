import { signalingSocket, registerPeer, request } from './signaling.js';
import { createConnectionManager } from './connection-manager.js';
import { createReliableService } from './reliable.js';
import { createHistory, browserStorage } from './history.js';
import { createChatMessage, createGroupMessage, createAckMessage } from '../../shared/messages.js';
import { validatePacket, messageKey, orderMessages } from '../../shared/protocol.js';

export function createChatClient({ socket = signalingSocket, manager = createConnectionManager(), reliable = createReliableService(), storage = browserStorage('localStorage'), sessionStorage = browserStorage('sessionStorage') } = {}) {
  let state = { connectionStatus: 'Đang kết nối signaling...', registrationStatus: '', currentPeer: null, onlinePeers: [], groups: [], messages: [], routes: {}, relayReady: false, error: '' };
  const listeners = new Set();
  let seen = new Set();
  let owner = null;
  let desired = null;
  let messageSession = crypto.randomUUID();
  let epoch = 0;
  let stops = [];
  let ticketTimer;
  const sequences = new Map();
  try { desired = JSON.parse(sessionStorage?.getItem('ds01:identity') || 'null'); } catch { /* Private browsing may disable storage. */ }
  const publish = changes => { state = { ...state, ...changes }; for (const fn of listeners) fn(); };
  const history = createHistory({ storage, onError: message => publish({ error: message }) });
  const persist = () => { if (owner) history.save(owner, state.messages, seen); };
  const setMessages = messages => { publish({ messages: orderMessages(messages).slice(-2000) }); persist(); };
  const updateDelivery = (packet, status, error = null, deliveryMode = null) => {
    setMessages(state.messages.map(row => {
      if (row.senderId !== packet.senderId || row.messageId !== packet.messageId || row.sessionId !== packet.sessionId || row.groupId !== packet.groupId || !row.deliveries?.[packet.receiverId]) return row;
      const old = row.deliveries[packet.receiverId];
      if (old.status === 'RECEIVED' || (['SENT', 'FORWARDED'].includes(status) && old.status === 'FAILED')) return row;
      return { ...row, deliveries: { ...row.deliveries, [packet.receiverId]: { status, error, deliveryMode: deliveryMode || old.deliveryMode } } };
    }));
  };
  const nextSequence = conversation => { const next = (sequences.get(conversation) || 0) + 1; sequences.set(conversation, next); return next; };
  const invalidateSession = () => {
    epoch++;
    if (owner) reliable.cancelPendingMessages(owner);
    setMessages(state.messages.map(row => ({ ...row, deliveries: row.deliveries ? Object.fromEntries(Object.entries(row.deliveries).map(([id, item]) => [id, ['SENDING', 'SENT', 'FORWARDED'].includes(item.status) ? { ...item, status: 'FAILED', error: 'Phiên peer đã kết thúc.' } : item])) : undefined })));
    manager.stop();
  };
  const receive = async ({ peerId, message, deliveryMode }) => {
    if (!state.currentPeer || !validatePacket(message) || message.senderId !== peerId || message.receiverId !== owner || message.deliveryMode !== deliveryMode) return;
    if (message.type === 'ACK') {
      const row = state.messages.find(row => row.messageId === message.ackFor && row.senderId === owner && row.sessionId === message.sessionId && row.groupId === message.groupId && row.deliveries?.[peerId]);
      if (!row) return;
      reliable.acknowledgeMessage(message);
      updateDelivery({ ...row, receiverId: peerId }, 'RECEIVED', null, deliveryMode);
      return;
    }
    if (message.type === 'GROUP_MESSAGE') {
      const group = state.groups.find(group => group.groupId === message.groupId);
      if (!group?.members.includes(owner) || !group.members.includes(peerId)) return;
    }
    const key = messageKey(message);
    if (!seen.has(key)) {
      seen.add(key);
      if (seen.size > 10000) seen.delete(seen.values().next().value);
      setMessages([...state.messages, message]);
    }
    // ACK again for duplicates, after the message has entered local history.
    const ack = createAckMessage({ senderId: owner, receiverId: peerId, sessionId: message.sessionId, ackFor: message.messageId, groupId: message.groupId });
    try { await manager.sendToPeer(ack, { preferRelay: deliveryMode === 'RELAY' }); }
    catch (error) { publish({ error: `Không thể gửi ACK: ${error.message}` }); }
  };
  const dispatch = (packet, version) => reliable.sendReliable(packet, async (copy, { attempt }) => {
    if (version !== epoch || copy.senderId !== owner || !state.currentPeer) throw new Error('Phiên đã kết thúc.');
    if (!state.onlinePeers.some(peer => peer.peerId === copy.receiverId)) throw new Error('Peer đích đang offline.');
    if (copy.groupId) {
      const group = state.groups.find(group => group.groupId === copy.groupId);
      if (!group?.members.includes(copy.senderId) || !group.members.includes(copy.receiverId)) throw new Error('Thành viên nhóm đã thay đổi.');
    }
    const result = await manager.sendToPeer(copy, { preferRelay: attempt > 0 });
    if (version === epoch) updateDelivery(copy, result.deliveryMode === 'RELAY' ? 'FORWARDED' : 'SENT', null, result.deliveryMode);
    return result;
  }, (failed, reason) => { if (version === epoch) updateDelivery(failed, 'FAILED', reason); }).catch(error => { if (version === epoch) updateDelivery(packet, 'FAILED', error.message); });
  const onConnect = () => {
    publish({ connectionStatus: 'Đã kết nối signaling' });
    if (desired) registerPeer(desired.peerId, desired.displayName);
  };
  const onDisconnect = () => {
    invalidateSession(); manager.start();
    publish({ connectionStatus: 'Mất kết nối signaling; đang kết nối lại...', currentPeer: null, onlinePeers: [], groups: [], routes: {}, relayReady: false });
  };
  const onRegistered = result => {
    publish({ registrationStatus: result.message });
    if (!result.ok) return;
    epoch++; messageSession = crypto.randomUUID(); sequences.clear();
    owner = result.peer.peerId;
    const loaded = history.load(owner);
    seen = new Set([...loaded.seen, ...loaded.messages.filter(m => m.senderId !== owner).map(messageKey)]);
    publish({ currentPeer: result.peer, messages: loaded.messages, error: '', routes: {} });
    desired = { peerId: result.peer.peerId, displayName: result.peer.displayName };
    try { sessionStorage?.setItem('ds01:identity', JSON.stringify(desired)); } catch { /* Identity remains in memory. */ }
    manager.setIdentity(owner, result.relayToken).catch(error => publish({ error: error.message }));
  };
  const onPeers = peers => {
    for (const old of state.onlinePeers) if (!peers.some(peer => peer.peerId === old.peerId)) manager.peerOffline(old.peerId);
    publish({ onlinePeers: peers, routes: Object.fromEntries(Object.entries(state.routes).filter(([id]) => peers.some(peer => peer.peerId === id))) });
  };
  return {
    getState: () => state,
    getIdentity: () => desired,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() {
      if (stops.length) return;
      manager.start();
      const bindings = [['connect', onConnect], ['disconnect', onDisconnect], ['connect_error', error => publish({ connectionStatus: `Lỗi kết nối: ${error.message}` })], ['peer:register:result', onRegistered], ['peers:list', onPeers], ['groups:list', groups => publish({ groups })]];
      bindings.forEach(([event, fn]) => socket.on(event, fn));
      stops = [() => bindings.forEach(([event, fn]) => socket.off(event, fn)), manager.onMessage(event => { receive(event).catch(error => publish({ error: error.message })); }), manager.onStateChange(event => publish({ routes: { ...state.routes, [event.peerId]: event } })), manager.relay.onStateChange(({ ready }) => publish({ relayReady: ready }))];
      ticketTimer = setInterval(async () => {
        if (!state.currentPeer || !socket.connected) return;
        try { const result = await request('peer:ticket', {}); await manager.setIdentity(owner, result.token); } catch (error) { publish({ error: error.message }); }
      }, 20 * 60 * 1000);
      if (socket.connected) onConnect(); else socket.connect();
    },
    stop() {
      clearInterval(ticketTimer); stops.forEach(stop => stop()); stops = []; invalidateSession(); socket.disconnect();
      publish({ currentPeer: null, onlinePeers: [], groups: [], routes: {}, relayReady: false, connectionStatus: 'Đang kết nối signaling...' });
    },
    register(peerId, displayName) {
      if (state.currentPeer) throw new Error('Bạn đã tham gia mạng.');
      if (!socket.connected) throw new Error('Signaling đang offline.');
      desired = { peerId: peerId.trim(), displayName: displayName.trim() };
      registerPeer(desired.peerId, desired.displayName);
    },
    async connect(peerId) { if (!state.currentPeer) throw new Error('Chưa tham gia mạng.'); return manager.connect(peerId, { force: true }); },
    sendPrivate(receiverId, content) {
      if (!state.currentPeer || receiverId === owner) throw new Error('Người nhận không hợp lệ.');
      const packet = createChatMessage({ senderId: owner, receiverId, sessionId: messageSession, sequence: nextSequence(`peer:${receiverId}`), content });
      setMessages([...state.messages, { ...packet, deliveries: { [receiverId]: { status: 'SENDING', deliveryMode: 'DIRECT', error: null } } }]);
      dispatch(packet, epoch);
      return packet.messageId;
    },
    sendGroup(groupId, content) {
      const group = state.groups.find(group => group.groupId === groupId);
      if (!state.currentPeer || !group?.members.includes(owner)) throw new Error('Bạn không thuộc nhóm này.');
      const recipients = group.members.filter(id => id !== owner);
      const packet = createGroupMessage({ senderId: owner, receiverId: recipients[0] || owner, groupId, sessionId: messageSession, sequence: nextSequence(`group:${groupId}`), content });
      const deliveries = Object.fromEntries(recipients.map(id => [id, { status: state.onlinePeers.some(peer => peer.peerId === id) ? 'SENDING' : 'FAILED', deliveryMode: 'DIRECT', error: state.onlinePeers.some(peer => peer.peerId === id) ? null : 'Thành viên offline; không lưu chuyển tiếp trên server.' }]));
      setMessages([...state.messages, { ...packet, deliveries }]);
      for (const id of recipients) if (deliveries[id].status === 'SENDING') dispatch({ ...packet, receiverId: id }, epoch);
      return packet.messageId;
    },
    createGroup: (name, members) => request('group:create', { name, members }),
    updateGroup: (groupId, members) => {
      const group = state.groups.find(group => group.groupId === groupId);
      return request('group:update', { groupId, members, revision: group?.revision });
    },
    clearError: () => publish({ error: '' }),
  };
}

export const chatClient = createChatClient();
