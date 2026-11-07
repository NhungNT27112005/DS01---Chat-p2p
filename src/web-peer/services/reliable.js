import { validatePacket } from '../../shared/protocol.js';

export function createReliableService({ ackTimeoutMs = 5000, maxRetries = 3, sendTimeoutMs = 16000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const ACK_TIMEOUT_MS = ackTimeoutMs;
  const MAX_RETRIES = maxRetries;

  const pendingMessages = new Map();
  async function boundedSend(pending, sendPacket) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          if (pendingMessages.get(pending.key) !== pending) throw new Error('Đã hủy theo dõi tin nhắn.');
          return sendPacket({ ...pending.message }, { attempt: pending.retries });
        }),
        new Promise((_, reject) => { timer = setTimer(() => reject(new Error('Hết thời gian chờ đường truyền.')), sendTimeoutMs); }),
        new Promise((_, reject) => { pending.cancelSend = () => reject(new Error('Đã hủy theo dõi tin nhắn.')); }),
      ]);
    } finally { clearTimer(timer); pending.cancelSend = null; }
  }

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

    clearTimer(pending.timer);

    pending.timer = setTimer(() => {
      if (pendingMessages.get(pending.key) !== pending) {
        return;
      }

      pending.timer = null;

      onTimeout(pending);
    }, ACK_TIMEOUT_MS);
  }

  function removePendingMessage(pending, cancelSend = false) {
    if (pendingMessages.get(pending.key) !== pending) {
      return false;
    }

    clearTimer(pending.timer);
    pending.timer = null;

    pendingMessages.delete(pending.key);
    if (cancelSend) pending.cancelSend?.();

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
      await boundedSend(pending, sendPacket);
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

  async function sendReliable(
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
      !validatePacket(message) || message?.version !== 1 ||
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
      const result = await boundedSend(pending, sendPacket);

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

  function acknowledgeMessage(ack) {
    if (!validatePacket(ack) || ack?.type !== 'ACK') {
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

  function cancelPendingMessages(senderId) {
    if (
      typeof senderId !== 'string' ||
      !senderId.trim()
    ) {
      return 0;
    }

    let cancelled = 0;

    for (const pending of pendingMessages.values()) {
      if (
        pending.message.senderId === senderId &&
        removePendingMessage(pending, true)
      ) {
        cancelled += 1;
      }
    }

    return cancelled;
  }
  return { sendReliable, acknowledgeMessage, cancelPendingMessages, pendingCount: () => pendingMessages.size };
}

const defaultService = createReliableService();
export const sendReliable = defaultService.sendReliable;
export const acknowledgeMessage = defaultService.acknowledgeMessage;
export const cancelPendingMessages = defaultService.cancelPendingMessages;
