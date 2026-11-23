import test from 'node:test';
import assert from 'node:assert/strict';
import { createReliableService } from '../src/web-peer/services/reliable.js';
import { createChatMessage, createAckMessage } from '../src/shared/messages.js';
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function clock() {
  let now = 0, id = 0;
  const timers = new Map();
  return {
    setTimer(fn, delay) { timers.set(++id, { fn, due: now + delay }); return id; },
    clearTimer(key) { timers.delete(key); },
    async tick(ms) {
      await settle();
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        now = next[1].due; timers.delete(next[0]); next[1].fn(); await settle();
      }
      now = end; await settle();
    },
    count: () => timers.size,
  };
}
const message = () => createChatMessage({ senderId: 'a', receiverId: 'b', sessionId: 'session', sequence: 1, content: 'hello' });
const ack = m => createAckMessage({ senderId: m.receiverId, receiverId: m.senderId, sessionId: m.sessionId, ackFor: m.messageId });
test('ACK association, duplicate ACK and ACK arriving before send resolves', async () => {
  const time = clock(); const service = createReliableService({ ...time }); const m = message();
  await service.sendReliable(m, async packet => {
    assert.equal(service.acknowledgeMessage({ ...ack(packet), senderId: 'wrong' }), false);
    assert.equal(service.acknowledgeMessage({ ...ack(packet), sessionId: 'wrong' }), false);
    assert.equal(service.acknowledgeMessage(ack(packet)), true);
    return { deliveryMode: 'DIRECT' };
  }, () => assert.fail('unexpected failure'));
  await time.tick(60000); assert.equal(service.pendingCount(), 0); assert.equal(time.count(), 0);
  assert.equal(service.acknowledgeMessage(ack(m)), false);
});
test('bounded retry preserves entire envelope and stops after four attempts', async () => {
  const time = clock(); const service = createReliableService({ ...time }); const m = message(); const sent = []; let failures = 0;
  await service.sendReliable(m, async packet => { sent.push(packet); return { deliveryMode: 'RELAY' }; }, () => failures++);
  await time.tick(20000); assert.equal(sent.length, 4); sent.forEach(packet => assert.deepEqual(packet, m));
  assert.equal(failures, 1); await time.tick(60000); assert.equal(sent.length, 4); assert.equal(service.pendingCount(), 0);
});
test('initial transport failure retries, then late ACK cancels during retry', async () => {
  const time = clock(); const service = createReliableService({ ...time }); const m = message(); let attempts = 0; let release;
  await service.sendReliable(m, () => { attempts++; if (attempts === 1) throw new Error('offline'); return new Promise(resolve => { release = resolve; }); }, () => assert.fail('unexpected failure'));
  await time.tick(5000); assert.equal(attempts, 2); assert.equal(service.acknowledgeMessage(ack(m)), true);
  release({ deliveryMode: 'RELAY' }); await time.tick(60000); assert.equal(attempts, 2); assert.equal(time.count(), 0);
});
test('a hanging transport is bounded and cancellation never rearms retry', async () => {
  const time = clock(); const service = createReliableService({ ...time, sendTimeoutMs: 100 }); const m = message(); let attempts = 0;
  const sending = service.sendReliable(m, () => { attempts++; return new Promise(() => {}); }, () => assert.fail('cancelled'));
  await time.tick(100); await sending; assert.equal(service.cancelPendingMessages('other'), 0); assert.equal(service.cancelPendingMessages('a'), 1);
  await time.tick(60000); assert.equal(attempts, 1); assert.equal(time.count(), 0);
});
test('cancelling immediately prevents a queued first send and cancels a hanging send timer', async () => {
  const time = clock(); const service = createReliableService({ ...time }); let sends = 0;
  const first = service.sendReliable(message(), () => { sends++; return new Promise(() => {}); }, () => assert.fail('cancelled'));
  assert.equal(service.cancelPendingMessages('a'), 1); await first; assert.equal(sends, 0); assert.equal(time.count(), 0);
  const second = service.sendReliable(message(), () => { sends++; return new Promise(() => {}); }, () => assert.fail('cancelled'));
  await settle(); assert.equal(sends, 1); assert.equal(service.cancelPendingMessages('a'), 1); await second; assert.equal(time.count(), 0);
});
