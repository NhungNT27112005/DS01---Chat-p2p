import { validatePacket, messageKey, orderMessages } from '../../shared/protocol.js';

export function browserStorage(name) {
  try { return globalThis[name]; } catch { return undefined; }
}

export function createHistory({ storage = browserStorage('localStorage'), onError = console.error, limit = 2000 } = {}) {
  const key = owner => `ds01:history:v1:${encodeURIComponent(owner)}`;
  return {
    load(owner) {
      try {
        const value = JSON.parse(storage?.getItem(key(owner)) || 'null');
        if (!value || value.version !== 1 || !Array.isArray(value.messages)) return { messages: [], seen: [] };
        const unique = new Map();
        for (const row of value.messages) {
          if (!validatePacket(row) || row.type === 'ACK') continue;
          if (row.senderId !== owner && row.receiverId !== owner) continue;
          const deliveries = row.deliveries && typeof row.deliveries === 'object' ? Object.fromEntries(Object.entries(row.deliveries).map(([id, item]) => [id, {
            status: ['SENDING', 'SENT', 'FORWARDED'].includes(item?.status) ? 'FAILED' : item?.status === 'RECEIVED' ? 'RECEIVED' : 'FAILED',
            deliveryMode: item?.deliveryMode === 'RELAY' ? 'RELAY' : 'DIRECT',
            error: ['SENDING', 'SENT', 'FORWARDED'].includes(item?.status) ? 'Phiên trước đã kết thúc trước khi có ACK.' : typeof item?.error === 'string' ? item.error.slice(0, 300) : null,
          }])) : undefined;
          unique.set(messageKey(row), { ...row, deliveries });
        }
        return { messages: orderMessages([...unique.values()]).slice(-limit), seen: Array.isArray(value.seen) ? value.seen.filter(s => typeof s === 'string').slice(-10000) : [] };
      } catch (error) { onError('Không đọc được lịch sử cục bộ.', error); return { messages: [], seen: [] }; }
    },
    save(owner, messages, seen) {
      try {
        if (!storage) throw new Error('localStorage không khả dụng.');
        storage.setItem(key(owner), JSON.stringify({ version: 1, messages: messages.slice(-limit), seen: [...seen].slice(-10000) })); return true;
      }
      catch (error) { onError('Không lưu được lịch sử (bộ nhớ đầy hoặc bị chặn).', error); return false; }
    },
  };
}
