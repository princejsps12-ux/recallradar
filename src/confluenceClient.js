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

async function readError(response) {
  let detail = '';
  try {
    detail = (await response.text()).slice(0, 200);
  } catch (error) {
    // no body is fine
  }
  return new Error(`Confluence answered ${response.status}${detail ? `: ${detail}` : ''}`);
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
