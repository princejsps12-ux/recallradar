// Saves the result of a recall check in Forge storage so repeat views are instant and openFDA
// is not asked the same question again and again.
//
// A saved result is used only while ALL of these hold:
//   1. it is younger than CACHE_TTL_MS,
//   2. it is not dated in the future (a clock problem), and
//   3. the hospital's device list is unchanged since it was saved (same fingerprint).
// Otherwise it is ignored and a fresh check runs.
//
// `kv` is any object with get(key), set(key, value) and delete(key) (see kvAdapter.js).
// No Forge imports here, so every rule is unit tested with plain Node.

export const MATCH_CACHE_KEY = 'cache:matches';

// How long a saved result stays valid. FDA publishes new recall reports about once a week, so a
// result a few hours old is as good as a fresh one for the hospital's purposes, and it spares
// openFDA's anonymous request limit (about 1,000 a day per IP; one full check uses ~24).
export const CACHE_TTL_HOURS = 6;
export const CACHE_TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000;

// A saved result is NEVER kept longer than this, even as an "old result" shown while a new check runs.
// Older than this it is treated as not there and deleted. (Privacy: nothing about the hospital is
// retained for more than a day without being refreshed.)
export const MAX_RETENTION_HOURS = 24;
export const MAX_RETENTION_MS = MAX_RETENTION_HOURS * 60 * 60 * 1000;

// Forge storage rejects any single value above 240 KiB, so a result is SAVED IN PARTS: its JSON text is cut into pieces of at most
// CHUNK_CHARS characters (at most 150 KB even if every character takes three bytes), each stored under its own key, and a small
// head record says how many there are. A result of 1,000 matches is about 10 parts. A result needing more than MAX_CHUNKS parts
// (about 3 MB, thousands of matches) is not saved, and the check still shows it; only the 6-hour reuse is lost.
//
// Every save writes its parts under a NEW generation id ("cache:matches:part:<gen>:<i>") and only then the head, which names that
// generation. A save never touches the parts the current head points at, so a reader can never put the pieces of two different
// results together (cut at the same places, two results can still read as one valid JSON text with a damaged value inside), and a
// save that dies halfway leaves orphans that nobody reads and the next save or the daily clean-up deletes. A reader that already
// holds the old head when the new one is committed finds its parts gone and recomputes. Heads written before generations existed
// have no `gen` and keep their parts at "cache:matches:part:<i>".
export const CHUNK_CHARS = 50 * 1000;
export const MAX_CHUNKS = 60;
export const MAX_CACHE_BYTES = CHUNK_CHARS * MAX_CHUNKS;
const PART_PREFIX = `${'cache:matches'}:part:`;

/** @param {any} head @param {number} i */
const partKey = (head, i) => (head && head.gen ? `${PART_PREFIX}${head.gen}:${i}` : `${PART_PREFIX}${i}`);
// Whether a part key belongs to this head (an old-style head owns the keys that are only a number).
/** @param {any} head @param {string} key */
const ownsKey = (head, key) => Boolean(head) && (head.gen ? key.startsWith(`${PART_PREFIX}${head.gen}:`) : /^\d+$/.test(key.slice(PART_PREFIX.length)));
const defaultGeneration = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Cut a string into pieces of at most `size` characters, never between the two halves of a surrogate pair.
 * @param {string} text
 * @param {number} size
 * @returns {string[]}
 */
export function splitText(text, size) {
  /** @type {string[]} */
  const pieces = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const last = text.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    }
    pieces.push(text.slice(start, end));
    start = end;
  }
  return pieces;
}

// Separators that cannot appear in normal device text, so fields cannot run together.
const FIELD_SEPARATOR = '␟';
const DEVICE_SEPARATOR = '␞';

// 32-bit FNV-1a hash of a string, as hex. Not secure, just a compact "has anything changed"
// signal: a collision would only make a stale result look fresh for up to CACHE_TTL_HOURS.
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// A short signature of the device list. Changes if a device is added, removed or edited in any
// field that affects the result or its display. Does not depend on the order of the list.
export function fingerprintDevices(devices) {
  const rows = devices
    .map((d) =>
      [d.id, d.name, d.type, d.manufacturer, d.model, d.lotOrSerial, d.ward, d.udiDi || ''].join(FIELD_SEPARATOR),
    )
    .sort();
  return `${devices.length}:${fnv1a(rows.join(DEVICE_SEPARATOR))}`;
}

export function createMatchCache(kv, nowMs = () => Date.now(), makeGeneration = defaultGeneration) {
  // The saved entry for this device list plus whether it is still fresh, or null if there is
  // none or it cannot be used at all. An EXPIRED entry for the same devices is returned as
  // { fresh: false } so the panel can show it while a new check runs ("stale while revalidate").
  // Damaged data, a different device list, or a date in the future still give null.
  // The head record: an older entry kept the whole result inline (`result`), a newer one says how many parts hold it (`chunks`).
  /** @param {any} head */
  const isHead = (head) => Boolean(head) && typeof head === 'object' && typeof head.checkedAt === 'string' && (Boolean(head.result) || (head.v === 2 && Number.isInteger(head.chunks) && head.chunks >= 1 && head.chunks <= MAX_CHUNKS && (head.gen === undefined || (typeof head.gen === 'string' && /^[a-z0-9]{4,40}$/.test(head.gen)))));

  // Delete every part that does NOT belong to `keep` (nothing is kept when it is null): the parts of the result that was just
  // replaced, and those a save that died halfway left behind.
  /** @param {any} keep */
  async function sweepParts(keep) {
    if (typeof kv.listByPrefix !== 'function') return;
    for (const { key } of await kv.listByPrefix(PART_PREFIX).catch(() => [])) {
      if (!ownsKey(keep, key)) await kv.delete(key).catch(() => {});
    }
  }

  // Delete a saved result: its parts (and any orphans), then its head.
  /** @param {any} head */
  async function deleteEntry(head) {
    if (head && head.v === 2 && Number.isInteger(head.chunks)) {
      for (let i = 0; i < Math.min(head.chunks, MAX_CHUNKS); i += 1) await kv.delete(partKey(head, i)).catch(() => {});
    }
    await sweepParts(null);
    await kv.delete(MATCH_CACHE_KEY);
  }

  // The whole result of a head: inline, or put together from its parts. Null when a part is missing or damaged.
  /** @param {any} head */
  async function assemble(head) {
    if (head.result) return head.result;
    const parts = await Promise.all(Array.from({ length: head.chunks }, (_, i) => kv.get(partKey(head, i))));
    if (parts.some((part) => typeof part !== 'string')) return null;
    try {
      return JSON.parse(parts.join(''));
    } catch (error) {
      return null;
    }
  }

  async function peek(devices) {
    let head;
    try {
      head = await kv.get(MATCH_CACHE_KEY);
    } catch (error) {
      return null; // storage trouble is never fatal: just recompute
    }
    if (!isHead(head)) return null;
    if (head.fingerprint !== fingerprintDevices(devices)) return null;
    const age = nowMs() - Date.parse(head.checkedAt);
    if (!Number.isFinite(age) || age < 0) return null;
    if (age >= MAX_RETENTION_MS) {
      await deleteEntry(head).catch(() => {}); // too old to keep, even as an old result
      return null;
    }
    // Only now, when the entry is usable, are its parts read.
    let result;
    try {
      result = await assemble(head);
    } catch (error) {
      return null;
    }
    if (!result) return null;
    return { entry: { checkedAt: head.checkedAt, fingerprint: head.fingerprint, result }, fresh: age < CACHE_TTL_MS };
  }

  // Delete the saved result if it is older than MAX_RETENTION_MS (or damaged). Returns true if deleted.
  async function purgeExpired() {
    let entry;
    try {
      entry = await kv.get(MATCH_CACHE_KEY);
    } catch (error) {
      return false;
    }
    if (entry === undefined || entry === null) return false;
    const age = entry && typeof entry.checkedAt === 'string' ? nowMs() - Date.parse(entry.checkedAt) : NaN;
    if (Number.isFinite(age) && age >= 0 && age < MAX_RETENTION_MS) return false;
    await deleteEntry(entry);
    return true;
  }

  // The saved entry only while it is still fresh, otherwise null.
  async function read(devices) {
    const found = await peek(devices);
    return found && found.fresh ? found.entry : null;
  }

  // Save a result, in parts (see CHUNK_CHARS). Returns true if saved, false if it needed more than MAX_CHUNKS parts or storage failed.
  // A failed save leaves the result that was there untouched.
  async function write(devices, result, checkedAt = new Date(nowMs()).toISOString()) {
    const pieces = splitText(JSON.stringify(result), CHUNK_CHARS);
    if (pieces.length > MAX_CHUNKS) return false;
    /** @type {any} */
    let before = null;
    try {
      before = await kv.get(MATCH_CACHE_KEY);
    } catch (error) {
      before = null;
    }
    const gen = makeGeneration();
    const head = { v: 2, gen, checkedAt, fingerprint: fingerprintDevices(devices), chunks: pieces.length };
    try {
      for (let i = 0; i < pieces.length; i += 1) await kv.set(partKey(head, i), pieces[i]);
      await kv.set(MATCH_CACHE_KEY, head);
    } catch (error) {
      await sweepParts(isHead(before) ? before : null).catch(() => {}); // the parts of this failed save; the earlier result stays
      return false;
    }
    await sweepParts(head).catch(() => {}); // the replaced result's parts and any orphans
    return true;
  }

  async function clear() {
    let head = null;
    try {
      head = await kv.get(MATCH_CACHE_KEY);
    } catch (error) {
      head = null;
    }
    await deleteEntry(head);
  }

  return { peek, read, write, clear, purgeExpired };
}
