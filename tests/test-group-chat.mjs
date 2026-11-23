import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupChat } from '../src/web-peer/services/groupChat.js';
import { createGroupStorage } from '../src/web-peer/services/groupStorage.js';

function network(options = {}) {
  const peers = new Map(), offline = new Set(), calls = [], callbacks = new Map(), stores = new Map();
  const modes = { b: 'DIRECT', c: 'RELAY' };
  let hook;
  function boot(id) {
    if (!stores.has(id)) {
      const map = new Map();
      stores.set(id, { map, broken: false, getItem: k => map.get(k) ?? null,
        setItem(k, value) { if (this.broken) throw new Error('disk'); map.set(k, value); } });
    }
    callbacks.set(id, []);
    const service = createGroupChat({ peerId: id, timeoutMs: 25, retries: 1,
      storage: createGroupStorage(stores.get(id), id),
      onMessage: m => callbacks.get(id).push(m),
      sendToPeer: async (to, m) => {
        calls.push({ from: id, to, m: structuredClone(m) });
        if (offline.has(to) || !peers.has(to)) throw new Error('PEER_OFFLINE');
        if (hook) {
          const override = await hook(id, to, m);
          if (override) return override;
        }
        const ack = await peers.get(to).receive(m, id);
        return { ...ack, deliveryMode: modes[to] ?? 'DIRECT' };
      }, ...options });
    peers.set(id, service);
    return service;
  }
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(boot);
  return { a, b, c, d, boot, peers, offline, calls, callbacks, stores, setHook: h => { hook = h; } };
}
const wire = (g, senderId = 'a', receiverId = 'b', content = 'hello') => ({
  type: 'GROUP_MESSAGE', groupId: g.groupId, sessionId: g.groupId,
  messageId: crypto.randomUUID(), senderId, receiverId, groupVersion: g.version,
  timestamp: Date.now(), content
});

test('three peers synchronize, fan out with modes, concurrent sends and separate groups', async () => {
  const n = network();
  const { group: g } = await n.a.createGroup('ABC', ['b', 'c']);
  for (const p of [n.b, n.c]) assert.deepEqual(p.getGroup(g.groupId), g);
  const result = await n.a.sendGroupMessage(g.groupId, 'first');
  assert.deepEqual(result.deliveries.map(d => [d.receiverId, d.status, d.deliveryMode]),
    [['b', 'received', 'DIRECT'], ['c', 'received', 'RELAY']]);
  await Promise.all([n.a.sendGroupMessage(g.groupId, 'from A'), n.b.sendGroupMessage(g.groupId, 'from B')]);
  for (const p of [n.a, n.b, n.c]) assert.equal(p.getHistory(g.groupId).length, 3);
  assert.equal(n.c.getHistory(g.groupId).find(m => m.content === 'from B').senderId, 'b');
  assert.equal(n.callbacks.get('c').length, 3);
  const { group: other } = await n.a.createGroup('AB', ['b']);
  await n.b.sendGroupMessage(other.groupId, 'other group');
  assert.equal(n.a.getHistory(other.groupId).length, 1);
  assert.equal(n.c.getHistory(other.groupId).length, 0);
});

test('concurrent membership updates, no-op, add, online removal and old snapshot', async () => {
  const n = network();
  const { group: g } = await n.a.createGroup('ABC', ['b', 'c']);
  await Promise.all([n.a.updateMembers(g.groupId, { add: ['d'] }), n.a.updateMembers(g.groupId, { remove: ['c'] })]);
  const current = n.a.getGroup(g.groupId);
  assert.equal(current.version, 3);
  assert.deepEqual(current.members, ['a', 'b', 'd']);
  for (const p of [n.b, n.c, n.d]) assert.deepEqual(p.getGroup(g.groupId), current);
  assert.equal(n.c.listGroups().length, 0);
  await assert.rejects(n.c.sendGroupMessage(g.groupId, 'no'), /NOT_MEMBER/);
  await assert.rejects(n.b.updateMembers(g.groupId, { add: ['c'] }), /CREATOR_REQUIRED/);
  await n.a.updateMembers(g.groupId, { add: ['d'] });
  assert.equal(n.a.getGroup(g.groupId).version, 3);
  const state = { ...wire(g), type: 'GROUP_STATE', receiverId: 'c', group: g };
  await n.c.receive(state, 'a');
  assert.equal(n.c.getGroup(g.groupId).version, 3);
});

test('offline removal survives restart and reconnect, outsider sync does not disclose group', async () => {
  const n = network();
  const { group: g } = await n.a.createGroup('ABC', ['b', 'c']);
  n.offline.add('c');
  await n.a.updateMembers(g.groupId, { remove: ['c'] });
  n.boot('a');
  assert.equal(n.c.getGroup(g.groupId).version, 1);
  n.offline.delete('c');
  await n.c.reconnect();
  assert.equal(n.c.getGroup(g.groupId).version, 2);
  assert.deepEqual(n.c.listGroups(), []);
  await assert.rejects(n.d.syncGroup(g.groupId, 'a'), /SYNC_FORBIDDEN/);
  n.offline.add('a');
  await n.b.sendGroupMessage(g.groupId, 'creator offline');
  assert.equal(n.b.getHistory(g.groupId).length, 1);
  const reconnect = await n.b.reconnect();
  assert.equal(reconnect[0].error, 'PEER_OFFLINE');
});

test('unknown group controlled error and explicit sync; spoof, receiver, version and session rejected', async () => {
  const n = network();
  n.offline.add('b');
  const { group: g } = await n.a.createGroup('AB', ['b']);
  n.offline.delete('b');
  const m = wire(g);
  await assert.rejects(n.b.receive(m, 'a'), /GROUP_SYNC_REQUIRED/);
  await n.b.syncGroup(g.groupId, 'a');
  await assert.rejects(n.b.receive(m, 'c'), /INVALID_ENVELOPE/);
  await assert.rejects(n.b.receive({ ...m, receiverId: 'c' }, 'a'), /INVALID_ENVELOPE/);
  await assert.rejects(n.b.receive({ ...m, sessionId: 'wrong' }, 'a'), /INVALID_ENVELOPE/);
  await assert.rejects(n.b.receive({ ...m, groupVersion: 9 }, 'a'), /GROUP_SYNC_REQUIRED/);
  await assert.rejects(n.b.receive({ ...m, senderId: 'd' }, 'd'), /NOT_MEMBER/);
  await assert.rejects(n.b.receive({ ...m, content: '' }, 'a'), /INVALID_MESSAGE/);
  await assert.rejects(n.b.receive({ ...m, type: 'GROUP_STATE', group: { ...g, version: 2 }, senderId: 'd' }, 'd'), /CREATOR_REQUIRED/);
  await n.b.receive(m, 'a');
  assert.equal(n.b.getHistory(g.groupId).length, 1);
});

test('lost ACK retries same ID, dedup persists across restart, conflict rejected', async () => {
  const n = network();
  const { group: g } = await n.a.createGroup('AB', ['b']);
  let lost = false;
  n.setHook(async (from, to, m) => {
    if (m.type === 'GROUP_MESSAGE' && !lost) {
      lost = true;
      await n.peers.get(to).receive(m, from);
      throw new Error('ACK_LOST');
    }
  });
  const r = await n.a.sendGroupMessage(g.groupId, 'one');
  assert.equal(r.deliveries[0].status, 'received');
  const sent = n.calls.filter(c => c.m.type === 'GROUP_MESSAGE');
  assert.equal(sent.length, 2);
  assert.equal(sent[0].m.messageId, sent[1].m.messageId);
  assert.equal(n.b.getHistory(g.groupId).length, 1);
  assert.equal(n.callbacks.get('b').length, 1);
  const b = n.boot('b');
  assert.equal(b.getHistory(g.groupId).length, 1);
  assert.equal((await b.receive(sent[0].m, 'a')).duplicate, true);
  assert.equal(n.callbacks.get('b').length, 0);
  await assert.rejects(b.receive({ ...sent[0].m, content: 'changed' }, 'a'), /MESSAGE_ID_CONFLICT/);
});

test('partial failure and explicit retry only sends to unacknowledged recipients', async () => {
  const n = network();
  const { group: g } = await n.a.createGroup('ABC', ['b', 'c']);
  n.offline.add('c');
  const r = await n.a.sendGroupMessage(g.groupId, 'partial');
  assert.deepEqual(r.deliveries.map(d => d.status), ['received', 'failed']);
  assert.equal(r.deliveries[1].error, 'PEER_OFFLINE');
  const count = n.calls.length;
  n.offline.delete('c');
  const next = await n.a.retryMessage(r.message.messageId);
  assert.deepEqual(next.deliveries.map(d => d.status), ['received', 'received']);
  assert.deepEqual(n.calls.slice(count).map(c => c.to), ['c']);
  assert.equal(n.b.getHistory(g.groupId).length, 1);
});

test('bounded timeout, delayed delivery, invalid ACK and delegated transport retries', async () => {
  const n = network();
  const { group: g } = await n.a.createGroup('AB', ['b']);
  n.setHook(() => new Promise(() => {}));
  const r = await n.a.sendGroupMessage(g.groupId, 'timeout');
  assert.equal(r.deliveries[0].error, 'TIMEOUT');
  assert.equal(n.calls.filter(c => c.m.type === 'GROUP_MESSAGE').length, 2);
  n.setHook(async () => { await new Promise(resolve => setTimeout(resolve, 2)); });
  assert.equal((await n.a.retryMessage(r.message.messageId)).deliveries[0].status, 'received');
  n.setHook(async () => ({ ok: true, messageId: 'wrong' }));
  assert.equal((await n.a.sendGroupMessage(g.groupId, 'bad ack')).deliveries[0].error, 'INVALID_ACK');
  const delegated = network({ transportHandlesRetry: true });
  const { group: other } = await delegated.a.createGroup('AB', ['b']);
  delegated.offline.add('b');
  await delegated.a.sendGroupMessage(other.groupId, 'one attempt');
  assert.equal(delegated.calls.filter(c => c.m.type === 'GROUP_MESSAGE').length, 1);
});

test('failed writes do not publish memory or callback, corrupt storage reports explicit error', async () => {
  const n = network();
  const { group: g } = await n.a.createGroup('AB', ['b']);
  n.stores.get('b').broken = true;
  const r = await n.a.sendGroupMessage(g.groupId, 'disk failure');
  assert.equal(r.deliveries[0].error, 'STORAGE_WRITE_FAILED');
  assert.equal(n.b.getHistory(g.groupId).length, 0);
  assert.equal(n.callbacks.get('b').length, 0);
  n.stores.get('b').broken = false;
  await n.a.retryMessage(r.message.messageId);
  assert.equal(n.b.getHistory(g.groupId).length, 1);
  n.stores.get('a').broken = true;
  await assert.rejects(n.a.updateMembers(g.groupId, { add: ['d'] }), /STORAGE_WRITE_FAILED/);
  assert.equal(n.a.getGroup(g.groupId).version, 1);
  assert.throws(() => createGroupChat({ peerId: 'z', sendToPeer() {}, storage: { load: () => ({ schema: 1 }) } }), /INVALID_STORED_STATE/);
  const bad = { getItem: () => '{bad' };
  assert.throws(() => createGroupStorage(bad, 'z').load(), /STORAGE_READ_FAILED/);
});
