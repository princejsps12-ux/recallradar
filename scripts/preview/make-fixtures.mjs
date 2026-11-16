// Regenerates scripts/preview/fixtures/demo.json: the demo hospital, the REAL check result for it and the newest
// FDA recalls, so the preview (see README.md in this folder) shows realistic data and runs offline afterwards.
// It runs the same code the app runs (search, matching, recall details) against the LIVE openFDA API:
//
//   node scripts/preview/make-fixtures.mjs
//
// About 25 requests (the anonymous limit is about 1,000 a day). The output is committed, so the FDA text in it is
// a snapshot: run this again only when the demo data should move on. Not part of the Forge app, not run by npm test.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoDevices } from '../../src/demoHospital.js';
import { findRecallsForDevices, buildRecallDetails } from '../../src/recallSearch.js';
import { matchDevicesToRecalls } from '../../src/matching.js';
import { buildRecallsUrl, parseRecalls } from '../../src/openfda.js';

// openFDA answers 404 when a search has no hits: that is "no results".
async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return { results: [] };
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

const devices = buildDemoDevices();
const started = Date.now();
const { recalls, failedQueries, cappedQueries } = await findRecallsForDevices(devices, fetchJson);
const matches = matchDevicesToRecalls(devices, recalls);
const result = {
  deviceCount: devices.length,
  recallCount: recalls.length,
  matches,
  recallDetails: buildRecallDetails(recalls, matches),
  failedQueries,
  cappedQueries,
};
const recent = parseRecalls(await fetchJson(buildRecallsUrl()));

if (failedQueries > 0) throw new Error(`${failedQueries} FDA searches failed: not writing a fixture from an incomplete result`);

const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'demo.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), elapsedMs: Date.now() - started, devices, result, recent }, null, 1) + '\n');

const byClass = {};
for (const m of matches) byClass[m.recallClass || '?'] = (byClass[m.recallClass || '?'] || 0) + 1;
console.log(`wrote ${out}`);
console.log(`devices: ${devices.length}, matches: ${matches.length}, by class: ${JSON.stringify(byClass)}, recent recalls: ${recent.length}`);
