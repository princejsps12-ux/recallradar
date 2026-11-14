import Resolver from '@forge/resolver';
import { fetch } from '@forge/api';
import { buildRecallsUrl, parseRecalls, DEFAULT_LIMIT } from './openfda';
import { createDeviceStore } from './deviceStore';
import { forgeKv } from './kvAdapter';
import { loadDemoHospital } from './demoHospital';
import { findRecallsForDevices } from './recallSearch';
import { matchDevicesToRecalls } from './matching';
import { createMatchCache } from './matchCache';
import { getMatches, getCachedMatches } from './matchService';

const resolver = new Resolver();
const deviceStore = createDeviceStore(forgeKv);
const matchCache = createMatchCache(forgeKv);

// Fetch the latest device recalls from openFDA and return them in a small, UI-friendly shape.
export async function getLatestRecalls(limit = DEFAULT_LIMIT) {
  const response = await fetch(buildRecallsUrl(limit), {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`openFDA request failed with status ${response.status}`);
  }
  return parseRecalls(await response.json());
}

// Resolver called by the issue panel. Errors are returned (not thrown) so the panel can show them.
resolver.define('fetchRecalls', async () => {
  try {
    return { ok: true, recalls: await getLatestRecalls() };
  } catch (error) {
    console.error('Failed to fetch recalls from openFDA', error);
    return { ok: false, error: 'Could not load recalls from openFDA. Please try again later.' };
  }
});

// The hospital's devices, from Forge storage.
resolver.define('listDevices', async () => {
  try {
    return { ok: true, devices: await deviceStore.listDevices() };
  } catch (error) {
    console.error('Failed to list devices', error);
    return { ok: false, error: 'Could not load the device list.' };
  }
});

// "Load demo hospital": adds the 30 sample devices (replacing only earlier demo devices).
resolver.define('loadDemoHospital', async () => {
  try {
    return { ok: true, count: await loadDemoHospital(deviceStore) };
  } catch (error) {
    console.error('Failed to load demo hospital', error);
    return { ok: false, error: 'Could not load the demo hospital.' };
  }
});

// Fetch one openFDA URL as JSON. openFDA answers 404 when a search has no hits: that is
// "no results", not an error.
async function fetchOpenFdaJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (response.status === 404) return { results: [] };
  if (!response.ok) throw new Error(`openFDA request failed with status ${response.status}`);
  return response.json();
}

// The real check: find recent recalls for the hospital's manufacturers and models, then match
// them to the devices.
async function computeMatches(devices) {
  const { recalls, failedQueries, cappedQueries } = await findRecallsForDevices(devices, fetchOpenFdaJson);
  return {
    deviceCount: devices.length,
    recallCount: recalls.length,
    matches: matchDevicesToRecalls(devices, recalls),
    failedQueries,
    cappedQueries,
  };
}

// "Check devices for recalls". One check makes about two dozen openFDA requests and can take a
// while, so the result is saved in Forge storage (see matchCache.js).
//   payload.cachedOnly  return the saved result if there is one, never start a check
//   payload.refresh     ignore the saved result and check again
resolver.define('findMatches', async ({ payload }) => {
  try {
    const options = payload || {};
    const devices = await deviceStore.listDevices();
    if (options.cachedOnly) {
      const saved = await getCachedMatches({ devices, cache: matchCache });
      return saved ? { ok: true, result: saved } : { ok: true, result: null };
    }
    const result = await getMatches({
      devices,
      cache: matchCache,
      compute: computeMatches,
      refresh: Boolean(options.refresh),
    });
    return { ok: true, result };
  } catch (error) {
    console.error('Failed to find matches', error);
    return { ok: false, error: 'Could not check devices against FDA recalls.' };
  }
});

export const handler = resolver.getDefinitions();

// Rovo action: returns a fixed greeting so we can test that Rovo works on the site.
export const hello = async () => {
  return 'Hello from RecallRadar';
};
