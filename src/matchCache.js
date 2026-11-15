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

// Forge storage rejects values above 240 KiB. Stay well under it so a larger hospital's result
// is skipped (and simply recomputed next time) instead of failing the check.
export const MAX_CACHE_BYTES = 200 * 1024;

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
      [d.id, d.name, d.type, d.manufacturer, d.model, d.lotOrSerial, d.ward].join(FIELD_SEPARATOR),
    )
    .sort();
  return `${devices.length}:${fnv1a(rows.join(DEVICE_SEPARATOR))}`;
}

function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

export function createMatchCache(kv, nowMs = () => Date.now()) {
  // The saved entry for this device list plus whether it is still fresh, or null if there is
  // none or it cannot be used at all. An EXPIRED entry for the same devices is returned as
  // { fresh: false } so the panel can show it while a new check runs ("stale while revalidate").
  // Damaged data, a different device list, or a date in the future still give null.
  async function peek(devices) {
    let entry;
    try {
      entry = await kv.get(MATCH_CACHE_KEY);
    } catch (error) {
      return null; // storage trouble is never fatal: just recompute
    }
    if (!entry || typeof entry !== 'object' || !entry.result || typeof entry.checkedAt !== 'string') {
      return null;
    }
    if (entry.fingerprint !== fingerprintDevices(devices)) return null;
    const age = nowMs() - Date.parse(entry.checkedAt);
    if (!Number.isFinite(age) || age < 0) return null;
    return { entry, fresh: age < CACHE_TTL_MS };
  }

  // The saved entry only while it is still fresh, otherwise null.
  async function read(devices) {
    const found = await peek(devices);
    return found && found.fresh ? found.entry : null;
  }

  // Save a result. Returns true if saved, false if it was too large or storage failed.
  async function write(devices, result, checkedAt = new Date(nowMs()).toISOString()) {
    const entry = { checkedAt, fingerprint: fingerprintDevices(devices), result };
    if (byteLength(JSON.stringify(entry)) > MAX_CACHE_BYTES) return false;
    try {
      await kv.set(MATCH_CACHE_KEY, entry);
      return true;
    } catch (error) {
      return false;
    }
  }

  async function clear() {
    await kv.delete(MATCH_CACHE_KEY);
  }

  return { peek, read, write, clear };
}
