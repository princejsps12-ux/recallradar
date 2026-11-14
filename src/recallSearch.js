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

// Models shorter than this are too common to search for (same reason as MIN_MODEL_LENGTH in
// matching.js). Kept separate so the search layer does not depend on matching thresholds.
export const MIN_SEARCHABLE_MODEL_LENGTH = 3;

function unique(list) {
  return [...new Set(list)];
}

// The list of openFDA URLs to run for these devices.
export function planRecallQueries(devices, now = new Date()) {
  const from = daysAgoYmd(now, LOOKBACK_DAYS);
  const to = formatYmd(now);

  // One firm query per distinct maker (compared by its identifying words).
  const firmKeys = new Map();
  for (const device of devices) {
    const words = makerWords(device.manufacturer);
    if (words.length) firmKeys.set(words.join(' '), words);
  }
  const firmUrls = [...firmKeys.values()].map((words) => buildFirmRecallsUrl(words, from, to));

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
    modelUrls.push(buildModelRecallsUrl(models.slice(i, i + MODELS_PER_QUERY), from, to));
  }

  return unique([...firmUrls, ...modelUrls].filter(Boolean));
}

// Run the planned queries and merge the answers into one list of recalls (no duplicates,
// full text kept for matching). A failed query never loses the others: it is counted in
// `failedQueries` so the caller can warn the user.
export async function findRecallsForDevices(devices, fetchJson, now = new Date()) {
  const urls = planRecallQueries(devices, now);
  const settled = await Promise.allSettled(urls.map((url) => fetchJson(url)));

  const byNumber = new Map();
  let failedQueries = 0;
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') {
      failedQueries += 1;
      continue;
    }
    const results = outcome.value && Array.isArray(outcome.value.results) ? outcome.value.results : [];
    for (const raw of results) {
      const recall = parseRecallForMatching(raw);
      if (recall && !byNumber.has(recall.recallNumber)) {
        byNumber.set(recall.recallNumber, recall);
      }
    }
  }
  return { recalls: [...byNumber.values()], queryCount: urls.length, failedQueries };
}
