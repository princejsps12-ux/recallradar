// Finds the FDA recalls worth checking against a hospital's devices.
//
// Asking openFDA for "all recalls" is not practical (tens of thousands, and the newest 100 only
// span about a week). Instead we ask two narrow questions inside a date window:
//   1. FIRM queries:  recalls issued by each manufacturer the hospital owns devices from.
//   2. MODEL queries: recalls that mention any of the hospital's model numbers, whoever issued
//      them. This catches recalls filed under a parent company or distributor, and keeps
//      matching working even for manufacturers with more recalls than fit in one answer.
//
// `fetchJson(url)` is injected: Forge uses @forge/api's fetch, scripts and tests use their own.
// It must resolve to the parsed openFDA response, or { results: [] } when there were no hits.
//
// No Forge imports here, so this is unit tested with plain Node.
import {
  buildFirmRecallsUrl,
  buildModelRecallsUrl,
  buildUdiRecallsUrl,
  withSkip,
  daysAgoYmd,
  formatYmd,
  parseRecallForMatching,
} from './openfda.js';
import { makerWords } from './matching.js';
import { familySearchNames } from './makerAliases.js';
import { normalizeDi } from './udi.js';
import { tokenize, compact } from './text.js';

// How far back to look for recalls. Recalls often stay open for years (the FDA lists them as "Ongoing" long after they
// were issued), so three years catches the ones a hospital still has devices for; a recall that was closed out earlier
// than that no longer needs anyone's attention.
export const LOOKBACK_DAYS = 3 * 365;

// How many UDI-DIs to put in one search. Each is written in up to three forms, so five keeps the URL short.
export const UDIS_PER_QUERY = 5;

// A query that has more matches than one answer holds is read page by page, up to this many pages of
// SEARCH_LIMIT_PER_QUERY (so up to 100 recalls per query). Queries with still more matches are counted as capped and the
// dashboard says so.
export const MAX_PAGES_PER_QUERY = 4;

// How many requests run at the same time. openFDA allows about 240 a minute per address; a handful at a time keeps a
// check well inside that while still finishing in seconds, and stops one big hospital from sending dozens at once.
export const MAX_CONCURRENT_REQUESTS = 3;

// How many model numbers to put in one search. Every model adds two clauses to the URL, so
// small groups keep URLs short and stop one very common model from crowding out the others.
export const MODELS_PER_QUERY = 5;

// How many recalls to ask for in each query (newest first). Smaller answers are faster:
// measured against the demo hospital, 100 -> 25 cut a check from about 6.5 s to about 1.7 s on
// a laptop while keeping every match (10 was faster still but lost 35 of 101 secondary matches).
// The cost of a small answer is that a busy query needs more than one: a query that has more matches is read page by page
// (MAX_PAGES_PER_QUERY), and one that still has more is counted in `cappedQueries` so the panel can say so. See README, "Speed".
export const SEARCH_LIMIT_PER_QUERY = 25;

// How long to wait for openFDA before giving up on the searches still running. The check runs
// in the background (a Forge queue consumer with timeoutSeconds: 300), so this sits 60 s inside
// that limit, leaving time to match, save and report. Searches abandoned at the deadline count
// as failed, so the result is shown with a warning and is not saved.
export const SEARCH_DEADLINE_MS = 240 * 1000;

// Models shorter than this are too common to search for (same reason as MIN_MODEL_LENGTH in
// matching.js). Kept separate so the search layer does not depend on matching thresholds.
export const MIN_SEARCHABLE_MODEL_LENGTH = 3;

// Reject if `promise` has not settled after `ms`. The timer is always cleared.
function withDeadline(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Search timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function unique(list) {
  return [...new Set(list)];
}

// The list of openFDA URLs to run for these devices.
export function planRecallQueries(devices, now = new Date(), limit = SEARCH_LIMIT_PER_QUERY) {
  const from = daysAgoYmd(now, LOOKBACK_DAYS);
  const to = formatYmd(now);

  // One firm query per distinct maker (compared by its identifying words).
  const firmKeys = new Map();
  for (const device of devices) {
    const words = makerWords(device.manufacturer);
    if (words.length) firmKeys.set(words.join(' '), words);
  }
  // A maker that belongs to a company family is also searched under the family's main name ("BD" under "Becton Dickinson", "Hill-Rom"
  // under "Baxter"): the FDA files a recall under the firm that is responsible today. One more search per family at most.
  for (const words of [...firmKeys.values()]) {
    for (const name of familySearchNames(words)) if (!firmKeys.has(name.join(' '))) firmKeys.set(name.join(' '), name);
  }
  const firmUrls = [...firmKeys.values()].map((words) => buildFirmRecallsUrl(words, from, to, limit));

  // Model queries in small groups, one list of words per distinct model.
  const modelKeys = new Map();
  for (const device of devices) {
    if (compact(device.model).length >= MIN_SEARCHABLE_MODEL_LENGTH) {
      modelKeys.set(tokenize(device.model).join(' '), tokenize(device.model));
    }
  }
  const models = [...modelKeys.values()];
  const modelUrls = [];
  for (let i = 0; i < models.length; i += MODELS_PER_QUERY) {
    modelUrls.push(buildModelRecallsUrl(models.slice(i, i + MODELS_PER_QUERY), from, to, limit));
  }

  // UDI queries: the identifier is the one thing in a recall text that names a product version exactly, so a device that has
  // one is searched by it too (catching recalls filed under a parent company, a distributor or another brand).
  const udis = unique(devices.map((device) => normalizeDi(device.udiDi)).filter(Boolean));
  const udiUrls = [];
  for (let i = 0; i < udis.length; i += UDIS_PER_QUERY) {
    udiUrls.push(buildUdiRecallsUrl(udis.slice(i, i + UDIS_PER_QUERY), from, to, limit));
  }

  return unique([...firmUrls, ...modelUrls, ...udiUrls].filter(Boolean));
}

// What a saved check keeps about each recall that matched a device with exact or likely confidence:
// { "Z-2723-2026": { status, initiated, reason } }. Kept once per recall (not once per device) so a
// saved result stays small, and used to explain a recall without asking openFDA again.
export function buildRecallDetails(recalls, matches) {
  const byNumber = new Map(recalls.map((recall) => [recall.recallNumber, recall]));
  const details = {};
  for (const match of matches) {
    if (match.confidence === 'possible' || details[match.recallNumber]) continue;
    const recall = byNumber.get(match.recallNumber);
    if (!recall) continue;
    details[match.recallNumber] = {
      status: recall.status || '',
      initiated: recall.initiated || '',
      reason: recall.reasonForRecall || '',
    };
  }
  return details;
}

// Runs `worker` over `items`, at most `limit` at a time. Results come back in the order of `items`.
async function mapWithLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

// Run the planned queries and merge the answers into one list of recalls (no duplicates,
// full text kept for matching). A failed query never loses the others: it is counted in
// `failedQueries` so the caller can warn the user; so is one still running after the deadline. A query that matched more
// recalls than all its pages hold (openFDA reports the real total in meta.results.total) is counted in `cappedQueries`.
//
// The first page of every query runs first, a few at a time; a query whose total is larger than one page then has its next
// pages (up to MAX_PAGES_PER_QUERY) read the same way. The deadline is one moment for the whole check.
export async function findRecallsForDevices(devices, fetchJson, options = {}) {
  const {
    now = new Date(),
    limit = SEARCH_LIMIT_PER_QUERY,
    deadlineMs = SEARCH_DEADLINE_MS,
    maxPages = MAX_PAGES_PER_QUERY,
    concurrency = MAX_CONCURRENT_REQUESTS,
    onProgress = null,
  } = options;
  const firstPages = planRecallQueries(devices, now, limit);
  const startedAt = Date.now();

  // Tell the caller how far along we are (searches finished, searches in total; the total grows when a query turns out to
  // have more pages). A broken progress callback must never break the check itself.
  let finished = 0;
  let total = firstPages.length;
  const report = () => {
    if (!onProgress) return;
    try {
      onProgress(finished, total);
    } catch (error) {
      // progress is best effort
    }
  };
  report();

  const byNumber = new Map();
  let failedQueries = 0;
  let cappedQueries = 0;

  // Each answer is turned into recalls THE MOMENT it arrives and then let go: only how many records it held and how many there are
  // in all are kept. Holding every raw answer until the last search was done (tens of megabytes of text, a few recalls of several
  // megabytes each) ran the function out of memory on the live site.
  const absorb = (value) => {
    const results = value && Array.isArray(value.results) ? value.results : [];
    for (const raw of results) {
      const recall = parseRecallForMatching(raw);
      if (recall && !byNumber.has(recall.recallNumber)) byNumber.set(recall.recallNumber, recall);
    }
    const all = value && value.meta && value.meta.results ? value.meta.results.total : 0;
    return { count: results.length, all };
  };

  const run = (url) => {
    const remaining = deadlineMs - (Date.now() - startedAt);
    const attempt = remaining <= 0 ? Promise.reject(new Error('Search timed out before it started')) : withDeadline(Promise.resolve().then(() => fetchJson(url)), remaining);
    return attempt.then(
      (value) => ({ status: 'fulfilled', ...absorb(value) }),
      (reason) => ({ status: 'rejected', reason }),
    ).finally(() => {
      finished += 1;
      report();
    });
  };

  const first = await mapWithLimit(firstPages, concurrency, run);
  const morePages = [];
  first.forEach((outcome, index) => {
    if (outcome.status !== 'fulfilled') {
      failedQueries += 1;
      return;
    }
    const matches = outcome.all;
    if (!Number.isFinite(matches) || matches <= outcome.count) return;
    const pages = Math.min(maxPages, Math.ceil(matches / limit));
    for (let page = 1; page < pages; page += 1) morePages.push(withSkip(firstPages[index], page * limit));
    if (matches > maxPages * limit) cappedQueries += 1;
  });

  if (morePages.length) {
    total += morePages.length;
    report();
    const rest = await mapWithLimit(morePages, concurrency, run);
    for (const outcome of rest) if (outcome.status !== 'fulfilled') failedQueries += 1;
  }
  return { recalls: [...byNumber.values()], queryCount: total, failedQueries, cappedQueries };
}
