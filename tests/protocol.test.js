import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatMessage, createAckMessage } from '../src/shared/messages.js';
import { validatePacket } from '../src/shared/protocol.js';

test('private chat and ACK envelopes omit group metadata', () => {
  const message = createChatMessage({ senderId: 'a', receiverId: 'b', sessionId: 's', sequence: 1, content: 'hello' });
  const ack = createAckMessage({ senderId: 'b', receiverId: 'a', sessionId: 's', ackFor: message.messageId });
  for (const packet of [message, ack]) {
    assert.equal(validatePacket(packet), true);
    assert.equal(Object.hasOwn(packet, 'groupId'), false);
    assert.equal(validatePacket({ ...packet, groupId: null }), true);
    assert.equal(validatePacket({ ...packet, groupId: 'old-group' }), false);
    assert.equal(validatePacket({ ...packet, type: 'GROUP_MESSAGE', groupId: 'old-group' }), false);
  }
});
