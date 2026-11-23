export function createGroupStorage(storage, peerId) {
  const key = `ds01:groups:v1:${peerId}`;
  return {
    load() {
      try { const raw = storage.getItem(key); return raw === null ? null : JSON.parse(raw); }
      catch (cause) { throw new Error('STORAGE_READ_FAILED', { cause }); }
    },
    save(state) {
      try { storage.setItem(key, JSON.stringify(state)); }
      catch (cause) { throw new Error('STORAGE_WRITE_FAILED', { cause }); }
    }
  };
}
