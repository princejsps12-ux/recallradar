// Connects the device store to Forge storage (@forge/kvs). Deliberately tiny: all real logic
// lives in deviceStore.js, which is unit tested against an in-memory fake of this same shape.
import { kvs, WhereConditions } from '@forge/kvs';

// How many keys to ask Forge for per page when listing.
const LIST_PAGE_SIZE = 100;

export const forgeKv = {
  get: (key) => kvs.get(key),
  set: (key, value) => kvs.set(key, value),
  delete: (key) => kvs.delete(key),

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
