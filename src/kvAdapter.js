// Connects the device store to Forge storage (@forge/kvs). Deliberately tiny: all real logic
// lives in deviceStore.js, which is unit tested against an in-memory fake of this same shape.
import { kvs, WhereConditions } from '@forge/kvs';
import { isKeyExistsError } from './lock.js';

// How many keys to ask Forge for per page when listing.
const LIST_PAGE_SIZE = 100;

export const forgeKv = {
  get: (key) => kvs.get(key),
  set: (key, value) => kvs.set(key, value),
  delete: (key) => kvs.delete(key),

  // Set `value` only when the key does not exist yet, and let it expire after `ttlMs` (the primitive under lock.js). true: taken,
  // false: it already exists, null: the storage refused for another reason, so the caller must not rely on it.
  async setIfAbsent(key, value, ttlMs) {
    try {
      await kvs.set(key, value, { keyPolicy: 'FAIL_IF_EXISTS', ttl: { value: Math.max(1, Math.ceil(ttlMs / 1000)), unit: 'SECONDS' } });
      return true;
    } catch (error) {
      if (isKeyExistsError(error)) return false;
      const text = `${(error && error.code) || ''} ${(error && error.message) || ''}`;
      console.warn('Storage could not take a lock, carrying on without one', text.slice(0, 120));
      return null;
    }
  },

  // Up to 25 records in ONE call (Forge's batch limit). Measured on the live storage: 1,000 single writes took 13 seconds and 1,000
  // deletes 10, against a 25-second limit on a UI function; a batch of 25 is one round trip. Every record must be saved or this throws.
  async setMany(entries) {
    const result = await kvs.batchSet(entries.map(({ key, value }) => ({ key, value })));
    if (result && result.failedKeys && result.failedKeys.length) throw new Error(`Storage could not save ${result.failedKeys.length} of ${entries.length} records (${result.failedKeys[0].error.code})`);
  },

  async deleteMany(keys) {
    const result = await kvs.batchDelete(keys.map((key) => ({ key })));
    if (result && result.failedKeys && result.failedKeys.length) throw new Error(`Storage could not delete ${result.failedKeys.length} of ${keys.length} records (${result.failedKeys[0].error.code})`);
  },

  // Return every { key, value } whose key starts with `prefix`, following paging cursors.
  async listByPrefix(prefix) {
    const items = [];
    let cursor;
    do {
      let query = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(LIST_PAGE_SIZE);
      if (cursor) query = query.cursor(cursor);
      const page = await query.getMany();
      items.push(...page.results);
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  },
};
