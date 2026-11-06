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
