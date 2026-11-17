// What RecallRadar has seen of the affected (recall, device) pairs, so it can tell which ones are NEW: a recall that started to
// affect a device since the last look. It feeds the dashboard's "New since yesterday" and the daily alerts.
//
// ONE record in Forge storage, ids and times only (no name, no account, no text from a recall):
//
//   { v, baselineAt, updatedAt, baselineNext, pairs: { "recall|device": [firstSeen, lastSeen, alerted, kind] }, last }
//
//   kind 0   a pair that was already there when watching started (or when devices were imported): not news, never alerted
//   kind 1   a pair that appeared later: news. It is "new" for 24 hours and is alerted once.
//   alerted  1 when the daily alert has handled the pair (task made or found, comment posted)
//
// Rules that keep it honest:
//   * The first look is a BASELINE: everything affected today is the starting point. Nothing is "new" and nothing is alerted,
//     so switching this on never floods a project with tasks. The same happens right after devices are imported or the demo
//     hospital is loaded (the pairs those devices bring are not news): see devicesChanged().
//   * Only a COMPLETE check is tracked (the caller passes results with no failed lookups), so a partial result can never make
//     pairs look gone and then new again.
//   * A pair that stops being affected is kept for FORGET_AFTER_MS before it is forgotten, so a search that misses a recall one
//     day (openFDA capped it) does not raise the same alert again the next day.
//   * The record is deleted when nobody has updated it for STATE_TTL_MS (the daily trigger updates it every day), and by the
//     daily cleanup. Its "last run" summary holds Jira issue keys and counts only.
//
// Two rules about the storage itself:
//   * Every change (track, markAlerted, setLast, ...) reads the whole record, changes it and writes it back, so two invocations at
//     the same moment could lose one update. Each change therefore runs inside a short lease lock (lock.js, on the storage's
//     atomic set-if-absent): they take turns instead.
//   * A record that CANNOT BE READ is not the same as one that is not there. "Not there" (or too old, or damaged) starts a new
//     baseline; "could not be read" throws and writes nothing, so a storage hiccup can never reset the baseline or drop the
//     alerts that were waiting.
//
// `kv` is any object with get(key), set(key, value) and delete(key) (see kvAdapter.js). No Forge imports, so this is unit tested.

export const ALERT_STATE_KEY = 'alerts:state';

const DAY_MS = 24 * 60 * 60 * 1000;

// How long the record may go without an update before it counts as gone. The daily trigger refreshes it every day, so a record
// this old means watching stopped, and starting again is a new baseline.
export const STATE_TTL_DAYS = 7;
export const STATE_TTL_MS = STATE_TTL_DAYS * DAY_MS;

// A pair is "new" on the dashboard for this long after it first appeared: "since yesterday".
export const NEW_WINDOW_MS = DAY_MS;

// The daily alert acts on a new pair for this long. A pair older than this that was never alerted (alerts were off, or Jira
// refused) is marked handled without a task: the alert is about news, and a task for something found three days ago while
// alerts were off would be a surprise.
export const ALERT_WINDOW_MS = 2 * DAY_MS;

// A pair that is no longer affected is forgotten after this long (see above).
export const FORGET_AFTER_MS = STATE_TTL_MS;

// Forge storage rejects a single value over 240 KiB. At about 70 bytes a pair, 2,500 pairs are about 175 KB, so the record stays under
// the limit; a hospital with more affected pairs than that has the first 2,500 tracked (the check itself is not limited by this).
export const MAX_TRACKED_PAIRS = 2500;

import { createLock } from './lock.js';

const FIRST_SEEN = 0;
const LAST_SEEN = 1;
const ALERTED = 2;
const KIND = 3;

/**
 * One pair's record: [firstSeen (ms), lastSeen (ms), alerted (0 or 1), kind (0 baseline, 1 news)].
 * @typedef {[number, number, number, number]} PairEntry
 * @typedef {object} AlertRecord
 * @property {1} v
 * @property {number} baselineAt
 * @property {number} updatedAt
 * @property {boolean} baselineNext
 * @property {Record<string, PairEntry>} pairs
 * @property {Record<string, unknown> | null} last
 */

/**
 * @param {import('./types.js').Kv} kv
 * @param {() => number} [nowMs]
 */
export function createAlertState(kv, nowMs = () => Date.now()) {
  const lock = createLock(kv);
  /**
   * @template {any[]} A
   * @template R
   * @param {(...args: A) => Promise<R>} change
   * @returns {(...args: A) => Promise<R>}
   */
  const locked = (change) => (...args) => lock.run('alert-state', () => change(...args));

  // The stored record if it is intact and not too old; otherwise null (and an old or damaged one is deleted).
  /** @returns {Promise<AlertRecord | null>} */
  async function read() {
    /** @type {any} */
    let state;
    try {
      state = await kv.get(ALERT_STATE_KEY);
    } catch (error) {
      throw new Error('The alert record could not be read, so nothing was changed.'); // never "no record": that would reset it
    }
    if (!state || typeof state !== 'object' || state.v !== 1 || typeof state.updatedAt !== 'number' || !state.pairs || typeof state.pairs !== 'object') {
      if (state) kv.delete(ALERT_STATE_KEY).catch(() => {});
      return null;
    }
    const age = nowMs() - state.updatedAt;
    if (age >= 0 && age < STATE_TTL_MS) return state;
    kv.delete(ALERT_STATE_KEY).catch(() => {});
    return null;
  }

  /** @param {AlertRecord} state */
  async function write(state) {
    await kv.set(ALERT_STATE_KEY, state);
  }

  /**
   * Record the pairs that are affected right now (exact or likely match of a recall that is still open).
   * @param {string[]} pairs  ["recall|device", ...]
   * @returns {Promise<{ baseline: boolean, added: string[] }>}  `baseline` is true when this look only set the starting point; `added` are the news.
   */
  async function track(pairs) {
    const now = nowMs();
    const current = [...new Set(pairs)].slice(0, MAX_TRACKED_PAIRS);
    const state = await read();
    if (!state) {
      /** @type {AlertRecord} */
      const fresh = { v: 1, baselineAt: now, updatedAt: now, baselineNext: false, pairs: {}, last: null };
      for (const pair of current) fresh.pairs[pair] = [now, now, 1, 0];
      await write(fresh);
      return { baseline: true, added: [] };
    }
    const baseline = state.baselineNext === true;
    /** @type {string[]} */
    const added = [];
    // Forget first: a pair that was not seen for a whole week and is back is news again (a recall that was closed and reopened).
    for (const [pair, entry] of Object.entries(state.pairs)) {
      if (now - entry[LAST_SEEN] >= FORGET_AFTER_MS) delete state.pairs[pair];
    }
    for (const pair of current) {
      const known = state.pairs[pair];
      if (known) {
        known[LAST_SEEN] = now;
        continue;
      }
      state.pairs[pair] = baseline ? [now, now, 1, 0] : [now, now, 0, 1];
      if (!baseline) added.push(pair);
    }
    if (baseline) state.baselineAt = now;
    state.baselineNext = false;
    state.updatedAt = now;
    await write(state);
    return { baseline, added };
  }

  // The hospital's devices were imported, removed or replaced: pairs that appear because of that are not news. The next
  // tracked check takes them as part of the baseline.
  async function devicesChanged() {
    const state = await read();
    if (!state) return; // nothing is watched yet: the next check is a baseline anyway
    state.baselineNext = true;
    await write(state);
  }

  // Alerts were just switched on: everything affected today is the starting point, so only later news is alerted.
  /** @param {string[]} pairs */
  async function rebaseline(pairs) {
    const now = nowMs();
    /** @type {AlertRecord} */
    const state = (await read()) || { v: 1, baselineAt: now, updatedAt: now, baselineNext: false, pairs: {}, last: null };
    for (const pair of new Set(pairs)) {
      const known = state.pairs[pair];
      if (known) known[ALERTED] = 1;
      else state.pairs[pair] = [now, now, 1, 0];
    }
    state.updatedAt = now;
    await write(state);
  }

  // The pairs the daily alert should handle now, out of those affected at this moment:
  //   due      news (kind 1) not alerted yet and first seen within ALERT_WINDOW_MS
  //   expired  news not alerted yet but older than that: to be marked handled without a task
  /**
   * @param {Iterable<string>} currentPairs
   * @returns {Promise<{ due: string[], expired: string[] }>}
   */
  async function pendingAlerts(currentPairs) {
    const state = await read();
    if (!state) return { due: [], expired: [] };
    const now = nowMs();
    /** @type {string[]} */
    const due = [];
    /** @type {string[]} */
    const expired = [];
    for (const pair of currentPairs) {
      const entry = state.pairs[pair];
      if (!entry || entry[ALERTED] === 1 || entry[KIND] !== 1) continue;
      (now - entry[FIRST_SEEN] < ALERT_WINDOW_MS ? due : expired).push(pair);
    }
    // Oldest news first, so a run that can only take some of them takes the ones waiting longest.
    due.sort((a, b) => state.pairs[a][FIRST_SEEN] - state.pairs[b][FIRST_SEEN] || a.localeCompare(b));
    return { due, expired };
  }

  /** @param {string[]} pairs */
  async function markAlerted(pairs) {
    if (!pairs.length) return;
    const state = await read();
    if (!state) return;
    for (const pair of pairs) if (state.pairs[pair]) state.pairs[pair][ALERTED] = 1;
    await write(state);
  }

  // The news of the last 24 hours: [{ pair, firstSeen (ISO) }], newest first. Whether a pair is still affected is for the caller
  // to check against the current result.
  async function newSince(windowMs = NEW_WINDOW_MS) {
    const state = await read();
    if (!state) return [];
    const now = nowMs();
    return Object.entries(state.pairs)
      .filter(([, entry]) => entry[KIND] === 1 && now - entry[FIRST_SEEN] < windowMs && now - entry[LAST_SEEN] < DAY_MS)
      .map(([pair, entry]) => ({ pair, firstSeen: new Date(entry[FIRST_SEEN]).toISOString() }))
      .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen) || a.pair.localeCompare(b.pair));
  }

  // What the dashboard needs about watching: since when, and what the last daily alert did.
  async function overview() {
    const state = await read();
    if (!state) return { watching: false, since: null, last: null };
    return { watching: true, since: new Date(state.baselineAt).toISOString(), last: state.last || null };
  }

  // The summary of the last alert run: counts and Jira issue keys, nothing about a person.
  /** @param {Record<string, unknown>} summary */
  async function setLast(summary) {
    const state = await read();
    if (!state) return;
    state.last = summary;
    await write(state);
  }

  const clear = () => kv.delete(ALERT_STATE_KEY);

  // Delete the record when it is too old or damaged. Returns 1 when something was deleted.
  async function purgeExpired() {
    let state;
    try {
      state = await kv.get(ALERT_STATE_KEY);
    } catch (error) {
      return 0;
    }
    if (state === undefined || state === null) return 0;
    const valid = typeof state === 'object' && state.v === 1 && typeof state.updatedAt === 'number' && nowMs() - state.updatedAt >= 0 && nowMs() - state.updatedAt < STATE_TTL_MS;
    if (valid) return 0;
    await kv.delete(ALERT_STATE_KEY);
    return 1;
  }

  return { track: locked(track), devicesChanged: locked(devicesChanged), rebaseline: locked(rebaseline), pendingAlerts, markAlerted: locked(markAlerted), newSince, overview, setLast: locked(setLast), clear, purgeExpired };
}
