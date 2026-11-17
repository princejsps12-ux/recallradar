// Connects the device store to Forge storage (@forge/kvs). Deliberately tiny: all real logic
// lives in deviceStore.js, which is unit tested against an in-memory fake of this same shape.
import { kvs, WhereConditions } from '@forge/kvs';

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
      const text = `${(error && error.code) || ''} ${(error && error.message) || ''}`;
      if (/exist/i.test(text)) return false;
      console.warn('Storage could not take a lock, carrying on without one', text.slice(0, 120));
      return null;
    }
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
