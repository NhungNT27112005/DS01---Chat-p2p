import { MAX_CONTENT_LENGTH } from './protocol.js';

export function createChatMessage({
  senderId,
  receiverId,
  sessionId,
  sequence,
  content,
}) {
  const ids = [senderId, receiverId, sessionId];

  if (
    ids.some(
      (id) => typeof id !== 'string' || !id.trim(),
    )
  ) {
    throw new Error(
      'Sender ID, Receiver ID và Session ID không được để trống.',
    );
  }

  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error('Số thứ tự tin nhắn phải là số nguyên dương.');
  }

  if (typeof content !== 'string' || !content.trim() || content.length > MAX_CONTENT_LENGTH) {
    throw new Error(`Tin nhắn phải có nội dung và không quá ${MAX_CONTENT_LENGTH} ký tự.`);
  }

  return {
    version: 1,
    type: 'CHAT_MESSAGE',
    messageId: crypto.randomUUID(),
    sessionId,
    senderId,
    receiverId,
    groupId: null,
    sequence,
    timestamp: Date.now(),
    content: content.trim(),
    deliveryMode: 'DIRECT',
  };
}

export function createAckMessage({
  senderId,
  receiverId,
  sessionId,
  ackFor,
  groupId = null,
}) {
  const ids = [
    senderId,
    receiverId,
    sessionId,
    ackFor,
  ];

  if (
    ids.some(
      (id) => typeof id !== 'string' || !id.trim(),
    )
  ) {
    throw new Error(
      'Sender ID, Receiver ID, Session ID và ackFor không được để trống.',
    );
  }

  return {
    version: 1,
    type: 'ACK',
    messageId: crypto.randomUUID(),
    sessionId,
    senderId,
    receiverId,
    groupId,
    sequence: null,
    timestamp: Date.now(),
    content: null,
    deliveryMode: 'DIRECT',
    ackFor,
  };
}

export function createGroupMessage(options) {
  const message = createChatMessage(options);
  if (typeof options.groupId !== 'string' || !options.groupId.trim()) throw new Error('Group ID không hợp lệ.');
  return { ...message, type: 'GROUP_MESSAGE', groupId: options.groupId, ...(options.messageId ? { messageId: options.messageId } : {}) };
}
