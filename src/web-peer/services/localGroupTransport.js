// Chỉ là bản demo nhiều tab cục bộ. BroadcastChannel không xác thực danh tính.
export function createLocalGroupTransport(peerId, { onReceive, onChange = () => {}, timeoutMs = 1500 }) {
  const channel = new BroadcastChannel('ds01:group-demo:v1');
  const pending = new Map();
  let closed = false;
  channel.onmessage = async ({ data }) => {
    if (!data || data.to !== peerId || closed) return;
    if (data.kind === 'ack') {
      const request = pending.get(data.requestId);
      if (!request || request.to !== data.from) return;
      clearTimeout(request.timer);
      pending.delete(data.requestId);
      request.resolve(data.ack);
      return;
    }
    if (data.kind !== 'request') return;
    let ack;
    try {
      ack = await onReceive(data.envelope, data.from);
      onChange();
    } catch (error) {
      ack = { ok: false, messageId: data.envelope?.messageId, error: error.message };
    }
    if (!closed) channel.postMessage({ kind: 'ack', requestId: data.requestId,
      from: peerId, to: data.from, ack: { ...ack, deliveryMode: 'LOCAL_DEMO' } });
  };
  return {
    sendToPeer(to, envelope) {
      if (closed) return Promise.reject(new Error('TRANSPORT_CLOSED'));
      return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error('PEER_OFFLINE_OR_NOT_IN_THIS_BROWSER'));
        }, timeoutMs);
        pending.set(requestId, { to, resolve, reject, timer });
        try { channel.postMessage({ kind: 'request', requestId, from: peerId, to, envelope }); }
        catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
      });
    },
    close() {
      closed = true;
      channel.close();
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('TRANSPORT_CLOSED'));
      }
      pending.clear();
    }
  };
}
