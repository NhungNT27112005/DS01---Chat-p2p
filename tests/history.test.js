import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, browserStorage } from '../src/web-peer/services/history.js';
import { createChatMessage } from '../src/shared/messages.js';
import { orderMessages, validatePacket } from '../src/shared/protocol.js';
const packet = (sequence, timestamp = sequence) => ({ ...createChatMessage({ senderId: 'a', receiverId: 'b', sessionId: 's', sequence, content: `message ${sequence}` }), timestamp });
test('history is isolated by owner, deduplicated, ordered and interrupted sends become FAILED', () => {
  const values = new Map(); const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }; const history = createHistory({ storage });
  const first = packet(1, 30); const second = packet(2, 10);
  history.save('a', [second, first, { ...first, deliveries: { b: { status: 'SENT', deliveryMode: 'DIRECT' } } }], ['seen']);
  const loaded = history.load('a'); assert.equal(loaded.messages.length, 2); assert.equal(loaded.messages[0].sequence, 1);
  assert.equal(loaded.messages[0].deliveries.b.status, 'FAILED'); assert.deepEqual(history.load('c').messages, []);
  assert.deepEqual(loaded.seen, ['seen']);
});
test('a browser denying access to storage still permits in-memory chat', () => {
  Object.defineProperty(globalThis,'ds01DeniedStorage',{ configurable:true, get() { throw new Error('SecurityError'); } });
  assert.equal(browserStorage('ds01DeniedStorage'),undefined);
  delete globalThis.ds01DeniedStorage;
  let errors = 0; const history = createHistory({ storage: null, onError: () => errors++ });
  assert.deepEqual(history.load('a').messages,[]); assert.equal(history.save('a',[],[]),false); assert.equal(errors,1);
});
test('sequence ordering survives clock skew and missing messages do not block rendering', () => {
  const messages = [packet(3, 1), { ...packet(1, 2), senderId: 'c' }, packet(1, 99)];
  const ordered = orderMessages(messages); assert.deepEqual(ordered.filter(m => m.senderId === 'a').map(m => m.sequence), [1, 3]); assert.equal(ordered.length, 3);
});

test('history restores older private messages and excludes removed group conversations', () => {
  const privateMessage = { ...packet(1), groupId: null };
  const groupMessage = { ...packet(2), type: 'GROUP_MESSAGE', groupId: 'old-group' };
  const storage = { getItem: () => JSON.stringify({ version: 1, messages: [privateMessage, groupMessage] }) };
  const loaded = createHistory({ storage }).load('a');
  assert.deepEqual(loaded.messages.map(message => message.messageId), [privateMessage.messageId]);
});

test('sequence ordering is independent for each private recipient', () => {
  const messages = [packet(2, 10), { ...packet(1, 20), receiverId: 'c' }, packet(1, 30)];
  const ordered = orderMessages(messages);
  assert.deepEqual(ordered.filter(message => message.receiverId === 'b').map(message => message.sequence), [1, 2]);
  assert.equal(ordered[1].receiverId, 'c');
});
test('malformed storage, quota errors and malformed envelopes are handled', () => {
  let errors = 0;
  const history = createHistory({ storage: { getItem: () => '{', setItem: () => { throw new Error('quota'); } }, onError: () => errors++ });
  assert.deepEqual(history.load('a').messages, []); assert.equal(history.save('a', [], []), false); assert.equal(errors, 2);
  assert.equal(validatePacket({ ...packet(1), sequence: 0 }), false); assert.equal(validatePacket({ ...packet(1), content: 'x'.repeat(8001) }), false);
});
