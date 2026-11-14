import Resolver from '@forge/resolver';
import { fetch } from '@forge/api';
import { buildRecallsUrl, parseRecalls, DEFAULT_LIMIT } from './openfda';

const resolver = new Resolver();

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

export const handler = resolver.getDefinitions();

// Rovo action: returns a fixed greeting so we can test that Rovo works on the site.
export const hello = async () => {
  return 'Hello from RecallRadar';
};
