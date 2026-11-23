export const MAX_PACKET_BYTES = 32 * 1024;
export const MAX_CONTENT_LENGTH = 8000;
export const isId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128 && value === value.trim();
export const packetKey = (m) => JSON.stringify([m.senderId, m.receiverId, m.sessionId, m.messageId]);
export const messageKey = (m) => JSON.stringify([m.senderId, m.messageId]);

export function validatePacket(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  if (m.version !== 1 || !['CHAT_MESSAGE', 'ACK'].includes(m.type)) return false;
  if (![m.messageId, m.sessionId, m.senderId, m.receiverId].every(isId)) return false;
  if (!['DIRECT', 'RELAY'].includes(m.deliveryMode) || !Number.isSafeInteger(m.timestamp) || m.timestamp < 0) return false;
  // Older private history contains groupId: null; only private packets are valid.
  if (m.groupId != null) return false;
  if (m.type === 'ACK') return isId(m.ackFor) && m.sequence === null && m.content === null;
  return Number.isSafeInteger(m.sequence) && m.sequence > 0 && typeof m.content === 'string' &&
    m.content.trim().length > 0 && m.content.length <= MAX_CONTENT_LENGTH;
}

// Sequence is authoritative within one sender/session/conversation. A missing
// message never blocks the UI; a delayed retry is inserted at its logical place.
export function compareMessages(a, b) {
  if (a.senderId === b.senderId && a.sessionId === b.sessionId && a.receiverId === b.receiverId) {
    return a.sequence - b.sequence || a.messageId.localeCompare(b.messageId);
  }
  return a.timestamp - b.timestamp || a.senderId.localeCompare(b.senderId) || a.messageId.localeCompare(b.messageId);
}

export function orderMessages(messages) {
  // A comparator mixing wall clocks and sequence is not transitive. Sort globally
  // first, then replace each sender/session's occupied slots with sequence order.
  const ordered = [...messages].sort((a, b) => a.timestamp - b.timestamp || a.messageId.localeCompare(b.messageId));
  const streams = new Map();
  ordered.forEach((m, index) => {
    const key = JSON.stringify([m.senderId, m.sessionId, m.receiverId]);
    if (!streams.has(key)) streams.set(key, { indices: [], messages: [] });
    streams.get(key).indices.push(index);
    streams.get(key).messages.push(m);
  });
  for (const stream of streams.values()) {
    stream.messages.sort((a, b) => a.sequence - b.sequence || a.messageId.localeCompare(b.messageId));
    stream.indices.forEach((index, i) => { ordered[index] = stream.messages[i]; });
  }
  return ordered;
}
