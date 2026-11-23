import { createGroupManager, validateGroup, peer, fail } from './groupManager.js';
const copy = x => structuredClone(x);
const types = new Set(['GROUP_STATE', 'GROUP_SYNC_REQUEST', 'GROUP_MESSAGE']);
const idValid = x => typeof x === 'string' && x.length > 0 && x.length <= 200;
const fingerprint = m => JSON.stringify([m.type, m.messageId, m.groupId, m.sessionId,
  m.senderId, m.receiverId, m.timestamp, m.groupVersion, m.content]);

export function createGroupChat({ peerId, sendToPeer, storage, onMessage = () => {},
  onCallbackError = () => {}, timeoutMs = 2000, retries = 1, transportHandlesRetry = false }) {
  peer(peerId);
  if (typeof sendToPeer !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
      !Number.isInteger(retries) || retries < 0 || retries > 5) fail('INVALID_OPTIONS');
  let state = storage?.load() ?? { schema: 1, groups: [], messages: [] };
  function validateState(s) {
    if (!s || s.schema !== 1 || !Array.isArray(s.groups) || !Array.isArray(s.messages)) fail('INVALID_STORED_STATE');
    s.groups.forEach(validateGroup);
    if (new Set(s.groups.map(g => g.groupId)).size !== s.groups.length) fail('INVALID_STORED_STATE');
    for (const m of s.messages) {
      validateMessage(m);
      if (!['in', 'out'].includes(m.direction) || !Array.isArray(m.deliveries) ||
          (m.direction === 'in' ? m.receiverId !== peerId : m.senderId !== peerId)) fail('INVALID_STORED_STATE');
    }
    if (new Set(s.messages.map(m => `${m.direction}:${m.messageId}`)).size !== s.messages.length) fail('INVALID_STORED_STATE');
  }
  function validateMessage(m) {
    if (!m || m.type !== 'GROUP_MESSAGE' || !idValid(m.messageId) || !idValid(m.groupId) ||
        m.sessionId !== m.groupId || !Number.isFinite(m.timestamp) || m.timestamp < 0 ||
        !Number.isSafeInteger(m.groupVersion) || m.groupVersion < 1 ||
        typeof m.content !== 'string' || !m.content.trim() || new TextEncoder().encode(m.content).length > 16384) fail('INVALID_MESSAGE');
    peer(m.senderId); peer(m.receiverId);
  }
  try { validateState(state); } catch (cause) { throw new Error('INVALID_STORED_STATE', { cause }); }
  state = copy(state);
  let queue = Promise.resolve();
  // Publish only after persistence succeeds. Failed writes leave memory untouched.
  function transaction(fn) {
    const pending = queue.then(() => {
      const draft = copy(state), manager = createGroupManager(draft.groups);
      const result = fn(draft, manager);
      draft.groups = manager.listGroups();
      storage?.save(draft);
      state = draft;
      return copy(result);
    });
    queue = pending.catch(() => {});
    return pending;
  }
  const envelope = (type, groupId, receiverId, fields = {}) => ({ type, groupId, sessionId: groupId,
    senderId: peerId, receiverId, messageId: crypto.randomUUID(), timestamp: Date.now(), ...fields });
  async function deliver(receiverId, message) {
    let error;
    for (let attempt = 0; attempt <= (transportHandlesRetry ? 0 : retries); attempt++) {
      let timer;
      try {
        const ack = await Promise.race([
          Promise.resolve().then(() => sendToPeer(receiverId, copy(message))),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs); })
        ]);
        if (ack?.ok !== true || ack.messageId !== message.messageId) fail(ack?.error ?? 'INVALID_ACK');
        return { receiverId, status: 'received', ...(ack.deliveryMode ? { deliveryMode: ack.deliveryMode } : {}), ack };
      } catch (e) { error = e.message; }
      finally { clearTimeout(timer); }
    }
    return { receiverId, status: 'failed', error };
  }
  async function broadcast(group) {
    return Promise.all([...new Set([...group.members, ...group.formerMembers])]
      .filter(id => id !== peerId).map(id => deliver(id, envelope('GROUP_STATE', group.groupId, id, { group }))));
  }
  async function createGroup(name, members) {
    const group = await transaction((_, manager) => manager.createGroup(name, peerId, members));
    return { group, deliveries: await broadcast(group) };
  }
  async function updateMembers(groupId, changes) {
    const group = await transaction((_, manager) => manager.updateMembers(groupId, peerId, changes));
    return { group, deliveries: await broadcast(group) };
  }
  async function receive(m, authenticatedSenderId) {
    if (!m || !types.has(m.type) || !idValid(m.messageId) || !idValid(m.groupId) ||
        m.sessionId !== m.groupId || m.receiverId !== peerId || m.senderId !== authenticatedSenderId) fail('INVALID_ENVELOPE');
    peer(authenticatedSenderId);
    const result = await transaction((draft, manager) => {
      if (m.type === 'GROUP_STATE') {
        if (m.group?.groupId !== m.groupId) fail('GROUP_IDENTITY_CONFLICT');
        const g = validateGroup(m.group);
        if (![...g.members, ...g.formerMembers].includes(peerId)) fail('UNRELATED_GROUP');
        manager.saveReceivedGroup(g, authenticatedSenderId);
        return { ok: true, messageId: m.messageId };
      }
      const g = manager.getGroup(m.groupId);
      if (!g) fail('GROUP_SYNC_REQUIRED');
      if (m.type === 'GROUP_SYNC_REQUEST') {
        if (g.createdBy !== peerId || ![...g.members, ...g.formerMembers].includes(authenticatedSenderId)) fail('SYNC_FORBIDDEN');
        return { ok: true, messageId: m.messageId, group: g };
      }
      validateMessage(m);
      const old = draft.messages.find(x => x.messageId === m.messageId);
      if (old && fingerprint(old) !== fingerprint(m)) fail('MESSAGE_ID_CONFLICT');
      if (!g.members.includes(peerId) || !g.members.includes(authenticatedSenderId)) fail('NOT_MEMBER');
      if (m.groupVersion !== g.version) fail('GROUP_SYNC_REQUIRED');
      if (old) return { ok: true, messageId: m.messageId, duplicate: true };
      draft.messages.push({ ...copy(m), direction: 'in', deliveries: [] });
      return { ok: true, messageId: m.messageId, notify: true };
    });
    if (result.notify) {
      try { onMessage(copy(m)); } catch (e) { try { onCallbackError(e); } catch { /* ACK remains durable */ } }
    }
    delete result.notify;
    return result;
  }
  async function sendGroupMessage(groupId, content) {
    const message = await transaction((draft, manager) => {
      const g = manager.getGroup(groupId);
      if (!g) fail('GROUP_NOT_FOUND');
      const recipients = manager.getRecipients(groupId, peerId);
      const m = envelope('GROUP_MESSAGE', groupId, peerId, { content, groupVersion: g.version });
      validateMessage(m);
      const record = { ...m, direction: 'out', deliveries: recipients.map(receiverId => ({ receiverId, status: 'pending' })) };
      draft.messages.push(record);
      return record;
    });
    return retryMessage(message.messageId);
  }
  async function retryMessage(messageId) {
    // Queue read behind pending mutations; no locks are held during network I/O.
    await queue;
    const message = copy(state.messages.find(m => m.messageId === messageId && m.direction === 'out'));
    if (!message) fail('MESSAGE_NOT_FOUND');
    const g = createGroupManager(state.groups).getGroup(message.groupId);
    if (!g.members.includes(peerId)) fail('NOT_MEMBER');
    const results = await Promise.all(message.deliveries.filter(d => d.status !== 'received').map(async d => {
      if (!g.members.includes(d.receiverId)) return { receiverId: d.receiverId, status: 'failed', error: 'NOT_MEMBER' };
      const { direction, deliveries, ...wire } = message;
      const result = await deliver(d.receiverId, { ...wire, receiverId: d.receiverId });
      delete result.ack;
      return result;
    }));
    return transaction(draft => {
      const record = draft.messages.find(m => m.messageId === messageId && m.direction === 'out');
      for (const result of results) {
        const index = record.deliveries.findIndex(d => d.receiverId === result.receiverId);
        if (record.deliveries[index].status !== 'received') record.deliveries[index] = result;
      }
      return { message: record, deliveries: record.deliveries };
    });
  }
  async function syncGroup(groupId, creatorId) {
    peer(creatorId);
    if (creatorId === peerId) return { group: createGroupManager(state.groups).getGroup(groupId) };
    const request = envelope('GROUP_SYNC_REQUEST', groupId, creatorId);
    const result = await deliver(creatorId, request);
    if (result.status === 'failed') fail(result.error);
    // sendToPeer must bind the ACK to the authenticated intended recipient.
    const g = result.ack.group;
    await receive({ ...envelope('GROUP_STATE', groupId, peerId, { group: g }), senderId: creatorId }, creatorId);
    return { group: getGroup(groupId) };
  }
  const getGroup = id => createGroupManager(state.groups).getGroup(id);
  const listGroups = () => copy(state.groups.filter(g => g.members.includes(peerId)));
  const getHistory = id => copy(state.messages.filter(m => m.groupId === id)
    .sort((a, b) => a.timestamp - b.timestamp || a.messageId.localeCompare(b.messageId)));
  async function reconnect() {
    const results = [];
    for (const g of copy(state.groups)) {
      try { results.push(g.createdBy === peerId ? { group: g, deliveries: await broadcast(g) } : await syncGroup(g.groupId, g.createdBy)); }
      catch (error) { results.push({ groupId: g.groupId, error: error.message }); }
    }
    return results;
  }
  return { createGroup, updateMembers, sendGroupMessage, retryMessage, receive, syncGroup, reconnect, getGroup, listGroups, getHistory };
}
