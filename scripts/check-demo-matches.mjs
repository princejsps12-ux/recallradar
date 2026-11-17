// Developer check: runs the demo hospital against the LIVE openFDA API and prints what matches.
// Usage: node scripts/check-demo-matches.mjs
// Not part of the Forge app and not run by `npm test` (it needs the network).
import { buildDemoDevices } from '../src/demoHospital.js';
import { findRecallsForDevices } from '../src/recallSearch.js';
import { matchDevicesToRecalls } from '../src/matching.js';
import { fetchJson } from './fetchJson.mjs'; // a 404 is "no results"; also works where the system cannot resolve api.fda.gov

const devices = buildDemoDevices();
const { recalls, queryCount, failedQueries } = await findRecallsForDevices(devices, fetchJson);
const matches = matchDevicesToRecalls(devices, recalls);

console.log(`devices: ${devices.length}, queries: ${queryCount} (failed: ${failedQueries}), recalls fetched: ${recalls.length}`);
const byDevice = new Map();
for (const m of matches) {
  if (!byDevice.has(m.deviceId)) byDevice.set(m.deviceId, []);
  byDevice.get(m.deviceId).push(m);
}
for (const d of devices) {
  const ms = byDevice.get(d.id) || [];
  const best = ms[0];
  console.log(
    `${d.id} ${d.manufacturer} | ${d.model} | ${d.lotOrSerial || '-'} -> ` +
      (best ? `${best.confidence.toUpperCase()} (${best.rule}) ${best.recallNumber}${ms.length > 1 ? ` +${ms.length - 1} more` : ''}${process.argv.includes('--why') ? `\n      ${best.reason}` : ''}` : 'no match'),
  );
}
const counts = {};
for (const ms of byDevice.values()) counts[ms[0].confidence] = (counts[ms[0].confidence] || 0) + 1;
console.log('best-confidence counts:', counts, 'devices with no match:', devices.length - byDevice.size);
