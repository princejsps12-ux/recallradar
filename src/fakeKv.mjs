// In-memory stand-in for the Forge storage adapter, shared by tests.
// Also records the highest number of writes that were in flight at the same time.
// Values are COPIED on the way in and out, like the real storage (which serialises them): a reader gets its own object, so a
// read-change-write race between two callers really loses an update here, and a test of a lock fails when the lock is removed.
// (Handing out the stored object itself let every caller change the same one in place and hid every such race.)
const copy = (value) => (value === undefined ? undefined : structuredClone(value));

export function fakeKv(initial = {}) {
  const data = new Map(Object.entries(initial).map(([key, value]) => [key, copy(value)]));
  let inFlight = 0;
  const kv = {
    data,
    maxInFlight: 0,
    async get(key) {
      return copy(data.get(key));
    },
    async set(key, value) {
      inFlight += 1;
      kv.maxInFlight = Math.max(kv.maxInFlight, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      data.set(key, copy(value));
      inFlight -= 1;
    },
    async delete(key) {
      data.delete(key);
    },
    // Like the real storage: set only when absent. (The real one also expires the key after ttlMs; tests delete it by hand.)
    async setIfAbsent(key, value) {
      await new Promise((resolve) => setImmediate(resolve));
      if (data.has(key)) return false;
      data.set(key, copy(value));
      return true;
    },
    async listByPrefix(prefix) {
      return [...data.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value: copy(value) }));
    },
  };
  return kv;
}
