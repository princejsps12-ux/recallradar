// The few Confluence calls the recall pages need, behind a small interface.
//
//   listSpaces()              -> [{ id, key, name }]   team spaces the user can see
//   findSpace(key)            -> { id, key, name } or null
//   upsertPage({ spaceId, title, body }) -> { action: 'created' | 'updated', id, url }
//
// `request(path, options)` is Confluence as the CLICKING USER (asUser), so Confluence applies that
// user's permissions: someone who may not create pages in a space just gets an error. `route` is
// Forge's route tag. Both are injected so the response handling is unit tested without Forge.

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

// How many spaces to list when the user has not said which one to use.
export const SPACE_LIST_LIMIT = 25;

// What the app says about a site where it is installed in Jira but NOT connected to Confluence (Confluence is an optional
// connection, see `app.compatibility` in manifest.yml, so a site that only installed it in Jira is the normal case).
// Confluence's own answer is only "403 The app is not installed on this instance", which means nothing to a person, so it
// is recognised (isNotConnected) and replaced by this. The dashboard shows it, and the agent repeats it. The admin
// steps are the real ones in Atlassian Administration, checked on the demo site on 2026-11-16.
export const NOT_CONNECTED_MESSAGE =
  'RecallRadar is not connected to Confluence on this site yet, so it cannot write recall pages. A site admin connects it in Atlassian Administration: Apps → Sites → this site → Connected apps → RecallRadar → View app details → Connections → Connect (next to Confluence). Everything else in RecallRadar works without it.';

// The text Forge's gateway answers with in that case (HTTP 403, body {"code":403,"message":"The app is not installed on
// this instance"}). It is matched on the sentence, not on 403 alone: a 403 also means "you may not write in this space".
const NOT_CONNECTED_ANSWER = /app is not installed on this instance/i;

export function isNotConnected(error) {
  return Boolean(error && error.notConnected);
}

async function readError(response) {
  let detail = '';
  try {
    detail = (await response.text()).slice(0, 200);
  } catch (error) {
    // no body is fine
  }
  const failure = new Error(`Confluence answered ${response.status}${detail ? `: ${detail}` : ''}`);
  if (response.status === 403 && NOT_CONNECTED_ANSWER.test(detail)) failure.notConnected = true;
  return failure;
}

// The full address of a page. Confluence gives each page only a relative path (`webui`); the site's
// base address (https://site.atlassian.net/wiki) comes on the LIST response, so it is passed in.
export function pageUrl(page, base = '') {
  const links = (page && page._links) || {};
  const root = links.base || base;
  if (!links.webui) return '';
  return /^https?:/.test(links.webui) ? links.webui : `${root}${links.webui}`;
}

export function createConfluenceClient({ request, route }) {
  const space = (s) => ({ id: String(s.id), key: s.key, name: s.name });

  async function listSpaces() {
    const response = await request(route`/wiki/api/v2/spaces?type=global&limit=${SPACE_LIST_LIMIT}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw await readError(response);
    return ((await response.json()).results || []).map(space);
  }

  async function findSpace(key) {
    const response = await request(route`/wiki/api/v2/spaces?keys=${key}&limit=1`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw await readError(response);
    const found = ((await response.json()).results || [])[0];
    return found ? space(found) : null;
  }

  async function findPage(spaceId, title) {
    const response = await request(route`/wiki/api/v2/spaces/${spaceId}/pages?title=${title}&limit=1`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw await readError(response);
    const body = await response.json();
    return { page: (body.results || [])[0] || null, base: (body._links && body._links.base) || '' };
  }

  // Create the page, or update it (new version) if a page with this title is already in the space.
  async function upsertPage({ spaceId, title, body }) {
    const { page: existing, base } = await findPage(spaceId, title);
    const content = { representation: 'storage', value: body };
    if (!existing) {
      const response = await request(route`/wiki/api/v2/pages`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ spaceId, status: 'current', title, body: content }),
      });
      if (!response.ok) throw await readError(response);
      const page = await response.json();
      return { action: 'created', id: String(page.id), url: pageUrl(page, base) };
    }
    const nextVersion = ((existing.version && existing.version.number) || 1) + 1;
    const response = await request(route`/wiki/api/v2/pages/${existing.id}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        id: existing.id,
        status: 'current',
        title,
        body: content,
        version: { number: nextVersion, message: 'Updated by RecallRadar' },
      }),
    });
    if (!response.ok) throw await readError(response);
    const page = await response.json();
    return { action: 'updated', id: String(page.id), url: pageUrl(page, base) || pageUrl(existing, base) };
  }

  return { listSpaces, findSpace, upsertPage };
}
