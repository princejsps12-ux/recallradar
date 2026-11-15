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
  daysAgoYmd,
  formatYmd,
  parseRecallForMatching,
} from './openfda.js';
import { makerWords } from './matching.js';
import { tokenize, compact } from './text.js';

// How far back to look for recalls. A year keeps recent, still-relevant recalls without
// pulling in recalls that were closed out long ago.
export const LOOKBACK_DAYS = 365;

// How many model numbers to put in one search. Every model adds two clauses to the URL, so
// small groups keep URLs short and stop one very common model from crowding out the others.
export const MODELS_PER_QUERY = 5;

// How many recalls to ask for in each query (newest first). Smaller answers are faster:
// measured against the demo hospital, 100 -> 25 cut a check from about 6.5 s to about 1.7 s on
// a laptop while keeping every match (10 was faster still but lost 35 of 101 secondary matches).
// The cost of a small cap is that older recalls inside the window may be left out; queries that
// hit the cap are counted in `cappedQueries` so the panel can say so. See README, "Speed".
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

  return unique([...firmUrls, ...modelUrls].filter(Boolean));
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

// Run the planned queries and merge the answers into one list of recalls (no duplicates,
// full text kept for matching). A failed query never loses the others: it is counted in
// `failedQueries` so the caller can warn the user; so is one still running after the deadline. A query that matched more recalls than it
// returned (openFDA reports the real total in meta.results.total) is counted in `cappedQueries`.
export async function findRecallsForDevices(devices, fetchJson, options = {}) {
  const {
    now = new Date(),
    limit = SEARCH_LIMIT_PER_QUERY,
    deadlineMs = SEARCH_DEADLINE_MS,
    onProgress = null,
  } = options;
  const urls = planRecallQueries(devices, now, limit);

  // Tell the caller how far along we are (searches finished, searches in total). A broken
  // progress callback must never break the check itself.
  let finished = 0;
  const report = () => {
    if (!onProgress) return;
    try {
      onProgress(finished, urls.length);
    } catch (error) {
      // progress is best effort
    }
  };
  report();
  const settled = await Promise.allSettled(
    urls.map((url) =>
      withDeadline(fetchJson(url), deadlineMs).finally(() => {
        finished += 1;
        report();
      }),
    ),
  );
  const byNumber = new Map();
  let failedQueries = 0;
  let cappedQueries = 0;
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') {
      failedQueries += 1;
      continue;
    }
    const results = outcome.value && Array.isArray(outcome.value.results) ? outcome.value.results : [];
    const total = outcome.value && outcome.value.meta && outcome.value.meta.results
      ? outcome.value.meta.results.total
      : 0;
    if (Number.isFinite(total) && total > results.length) cappedQueries += 1;
    for (const raw of results) {
      const recall = parseRecallForMatching(raw);
      if (recall && !byNumber.has(recall.recallNumber)) {
        byNumber.set(recall.recallNumber, recall);
      }
    }
  }
  return { recalls: [...byNumber.values()], queryCount: urls.length, failedQueries, cappedQueries };
}
