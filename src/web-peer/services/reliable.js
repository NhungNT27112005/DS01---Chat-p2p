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
