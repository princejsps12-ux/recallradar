// In-memory stand-in for the Forge storage adapter, shared by tests.
// Also records the highest number of writes that were in flight at the same time.
export function fakeKv(initial = {}) {
  const data = new Map(Object.entries(initial));
  let inFlight = 0;
  const kv = {
    data,
    maxInFlight: 0,
    async set(key, value) {
      inFlight += 1;
      kv.maxInFlight = Math.max(kv.maxInFlight, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      data.set(key, value);
      inFlight -= 1;
    },
    async delete(key) {
      data.delete(key);
    },
    async listByPrefix(prefix) {
      return [...data.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value }));
    },
  };
  return kv;
}
