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

  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Nội dung tin nhắn không được để trống.');
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
