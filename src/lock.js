// A short lease lock on top of the storage's atomic "set only if absent" (see kvAdapter.js setIfAbsent), so two invocations that
// read, change and write the same record (the alert state, the check job) cannot lose each other's update. The lock key expires on
// its own (ttl), so a function that dies while holding it never blocks anyone for long.
//
// `kv.setIfAbsent(key, value, ttlMs)` answers true (taken), false (somebody else holds it) or null (the storage cannot lock): then the
// work runs unlocked, as it did before locks existed, rather than failing. If the lock is still held after the last attempt this
// THROWS: the caller reports a failure and tries again at its next run, and never writes without the lock when one is available.
// No Forge imports, so this is unit tested with plain Node.

export const LOCK_TTL_MS = 30 * 1000;
export const LOCK_ATTEMPTS = 20;
export const LOCK_WAIT_MS = 150;

const defaultSleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));
const defaultToken = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * @param {import('./types.js').Kv & { setIfAbsent?: (key: string, value: any, ttlMs: number) => Promise<boolean | null> }} kv
 * @param {{ ttlMs?: number, attempts?: number, waitMs?: number, sleep?: (ms: number) => Promise<void>, makeToken?: () => string }} [options]
 */
export function createLock(kv, { ttlMs = LOCK_TTL_MS, attempts = LOCK_ATTEMPTS, waitMs = LOCK_WAIT_MS, sleep = defaultSleep, makeToken = defaultToken } = {}) {
  /**
   * Run `work` while holding the lock called `name`.
   * @template T
   * @param {string} name
   * @param {() => Promise<T>} work
   * @returns {Promise<T>}
   */
  async function run(name, work) {
    if (typeof kv.setIfAbsent !== 'function') return work();
    const key = `lock:${name}`;
    const token = makeToken();
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const taken = await kv.setIfAbsent(key, { token }, ttlMs);
      if (taken === null) return work(); // the storage cannot lock: carry on as before
      if (taken) {
        try {
          return await work();
        } finally {
          try {
            const held = await kv.get(key);
            if (held && held.token === token) await kv.delete(key);
          } catch (error) {
            // the lock expires by itself
          }
        }
      }
      await sleep(waitMs);
    }
    throw new Error(`Could not get the "${name}" lock: another run is changing the same record.`);
  }
  return { run };
}
