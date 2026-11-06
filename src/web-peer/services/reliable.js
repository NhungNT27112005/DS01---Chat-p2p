const ACK_TIMEOUT_MS = 5000;
const MAX_RETRIES = 3;

const pendingMessages = new Map();

function getMessageKey(message) {
  return JSON.stringify([
    message.senderId,
    message.receiverId,
    message.sessionId,
    message.messageId,
  ]);
}

function registerPendingMessage(message) {
  const key = getMessageKey(message);

  if (pendingMessages.has(key)) {
    throw new Error('Tin nhắn này đang chờ ACK.');
  }

  const pending = {
    key,
    message: { ...message },
    retries: 0,
    timer: null,
    lastError: null,
  };

  pendingMessages.set(key, pending);

  return pending;
}

function startAckTimer(pending, onTimeout) {
  if (pendingMessages.get(pending.key) !== pending) {
    return;
  }

  clearTimeout(pending.timer);

  pending.timer = setTimeout(() => {
    if (pendingMessages.get(pending.key) !== pending) {
      return;
    }

    pending.timer = null;

    onTimeout(pending);
  }, ACK_TIMEOUT_MS);
}

function removePendingMessage(pending) {
  if (pendingMessages.get(pending.key) !== pending) {
    return false;
  }

  clearTimeout(pending.timer);
  pending.timer = null;

  pendingMessages.delete(pending.key);

  return true;
}

async function handleAckTimeout(
  pending,
  sendPacket,
  onFailed,
) {
  if (pendingMessages.get(pending.key) !== pending) {
    return;
  }

  if (pending.retries >= MAX_RETRIES) {
    if (removePendingMessage(pending)) {
      onFailed(
        pending.message,
        pending.lastError ||
          `Không nhận được ACK sau ${MAX_RETRIES} lần gửi lại.`,
      );
    }

    return;
  }

  pending.retries += 1;

  let lastError = null;

  try {
    await sendPacket({ ...pending.message });
  } catch (error) {
    lastError =
      error?.message || 'Không thể gửi lại tin nhắn.';
  }

  if (pendingMessages.get(pending.key) !== pending) {
    return;
  }

  pending.lastError = lastError;

  startAckTimer(pending, () => {
    handleAckTimeout(pending, sendPacket, onFailed).catch(
      (error) =>
        console.error('[reliable] Lỗi xử lý timeout:', error),
    );
  });
}

export async function sendReliable(
  message,
  sendPacket,
  onFailed,
) {
  const ids = [
    message?.senderId,
    message?.receiverId,
    message?.sessionId,
    message?.messageId,
  ];

  if (
    message?.version !== 1 ||
    !['CHAT_MESSAGE', 'GROUP_MESSAGE'].includes(message.type) ||
    ids.some(
      (id) => typeof id !== 'string' || !id.trim(),
    )
  ) {
    throw new Error('Gói tin chờ ACK không hợp lệ.');
  }

  if (
    typeof sendPacket !== 'function' ||
    typeof onFailed !== 'function'
  ) {
    throw new Error('Phải cung cấp hàm gửi và hàm báo thất bại.');
  }

  const pending = registerPendingMessage(message);

  let accepted = false;
  let deliveryMode = null;

  try {
    const result = await sendPacket({ ...pending.message });

    accepted = true;
    deliveryMode = result?.deliveryMode || null;
  } catch (error) {
    if (pendingMessages.get(pending.key) === pending) {
      pending.lastError =
        error?.message || 'Không thể gửi tin nhắn.';
    }
  }

  startAckTimer(pending, () => {
    handleAckTimeout(pending, sendPacket, onFailed).catch(
      (error) =>
        console.error('[reliable] Lỗi xử lý timeout:', error),
    );
  });

  return { accepted, deliveryMode };
}

export function acknowledgeMessage(ack) {
  if (ack?.type !== 'ACK') {
    return false;
  }

  const key = getMessageKey({
    senderId: ack.receiverId,
    receiverId: ack.senderId,
    sessionId: ack.sessionId,
    messageId: ack.ackFor,
  });

  const pending = pendingMessages.get(key);

  if (
    !pending ||
    pending.message.groupId !== ack.groupId
  ) {
    return false;
  }

  return removePendingMessage(pending);
}
