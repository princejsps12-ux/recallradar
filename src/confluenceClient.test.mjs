import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfluenceClient, pageUrl, SPACE_LIST_LIMIT } from './confluenceClient.js';

// A stand-in for Forge's route`...` tag: glue the pieces together, encoding interpolated values like Forge does.
const route = (strings, ...values) => strings.reduce((out, s, i) => out + s + (i < values.length ? encodeURIComponent(values[i]) : ''), '');

function fakeRequest(answers) {
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push({ path, options, body: options.body ? JSON.parse(options.body) : undefined });
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.json,
      text: async () => answer.text ?? JSON.stringify(answer.json ?? ''),
    };
  };
  return { request, calls };
}

test('pageUrl joins the base address and the page path', () => {
  assert.equal(pageUrl({ _links: { base: 'https://x.atlassian.net/wiki', webui: '/spaces/MD/pages/1/T' } }), 'https://x.atlassian.net/wiki/spaces/MD/pages/1/T');
  assert.equal(pageUrl({ _links: { webui: '/spaces/MD/pages/1/T' } }, 'https://x.atlassian.net/wiki'), 'https://x.atlassian.net/wiki/spaces/MD/pages/1/T');
  assert.equal(pageUrl({}, 'https://x.atlassian.net/wiki'), '');
  assert.equal(pageUrl(undefined), '');
});

test('pageUrl leaves an address that is already complete alone', () => {
  assert.equal(pageUrl({ _links: { webui: 'https://other.example/p/1' } }, 'https://x/wiki'), 'https://other.example/p/1');
});

test('listSpaces returns id, key and name of the team spaces', async () => {
  const { request, calls } = fakeRequest([{ status: 200, json: { results: [{ id: 7, key: 'MD', name: 'Mobile Development', type: 'global' }] } }]);
  assert.deepEqual(await createConfluenceClient({ request, route }).listSpaces(), [{ id: '7', key: 'MD', name: 'Mobile Development' }]);
  assert.equal(calls[0].path, `/wiki/api/v2/spaces?type=global&limit=${SPACE_LIST_LIMIT}`.replace('limit=25', 'limit=25'));
});

test('findSpace looks a space up by key and returns null when there is none', async () => {
  const { request, calls } = fakeRequest([
    { status: 200, json: { results: [{ id: 9, key: 'MD', name: 'Mobile Development' }] } },
    { status: 200, json: { results: [] } },
  ]);
  const client = createConfluenceClient({ request, route });
  assert.deepEqual(await client.findSpace('MD'), { id: '9', key: 'MD', name: 'Mobile Development' });
  assert.equal(await client.findSpace('NOPE'), null);
  assert.ok(calls[0].path.includes('keys=MD'));
});

test('findSpace encodes the key so it cannot change the query', async () => {
  const { request, calls } = fakeRequest([{ status: 200, json: { results: [] } }]);
  await createConfluenceClient({ request, route }).findSpace('A&limit=999');
  assert.ok(calls[0].path.includes('keys=A%26limit%3D999'));
});

test('a new page is created in the space with the storage-format body', async () => {
  const { request, calls } = fakeRequest([
    { status: 200, json: { results: [], _links: { base: 'https://x/wiki' } } }, // no page with that title yet
    { status: 200, json: { id: 55, _links: { webui: '/spaces/MD/pages/55/T' } } }, // like the real API: relative path only
  ]);
  const out = await createConfluenceClient({ request, route }).upsertPage({ spaceId: '9', title: 'FDA recall Z-1', body: '<p>hi</p>' });
  assert.deepEqual(out, { action: 'created', id: '55', url: 'https://x/wiki/spaces/MD/pages/55/T' });
  assert.equal(calls[1].path, '/wiki/api/v2/pages');
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(calls[1].body, { spaceId: '9', status: 'current', title: 'FDA recall Z-1', body: { representation: 'storage', value: '<p>hi</p>' } });
});

test('the title is searched inside the space, so a title in another space is not touched', async () => {
  const { request, calls } = fakeRequest([{ status: 200, json: { results: [] } }, { status: 200, json: { id: 1, _links: {} } }]);
  await createConfluenceClient({ request, route }).upsertPage({ spaceId: '9', title: 'FDA recall Z-1', body: 'b' });
  assert.ok(calls[0].path.startsWith('/wiki/api/v2/spaces/9/pages?title=FDA%20recall%20Z-1'));
});

test('an existing page is updated with the next version, not duplicated', async () => {
  const { request, calls } = fakeRequest([
    { status: 200, json: { results: [{ id: 55, version: { number: 3 }, _links: { webui: '/spaces/MD/pages/55/T' } }], _links: { base: 'https://x/wiki' } } },
    { status: 200, json: { id: 55, _links: {} } },
  ]);
  const out = await createConfluenceClient({ request, route }).upsertPage({ spaceId: '9', title: 'FDA recall Z-1', body: '<p>new</p>' });
  assert.equal(out.action, 'updated');
  assert.equal(out.id, '55');
  assert.equal(out.url, 'https://x/wiki/spaces/MD/pages/55/T'); // falls back to the page it found
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, '/wiki/api/v2/pages/55');
  assert.equal(calls[1].options.method, 'PUT');
  assert.equal(calls[1].body.version.number, 4);
  assert.equal(calls[1].body.body.value, '<p>new</p>');
});

test('an existing page with no version number is treated as version 1', async () => {
  const { request, calls } = fakeRequest([{ status: 200, json: { results: [{ id: 5 }] } }, { status: 200, json: { id: 5, _links: {} } }]);
  await createConfluenceClient({ request, route }).upsertPage({ spaceId: '9', title: 't', body: 'b' });
  assert.equal(calls[1].body.version.number, 2);
});

test('Confluence errors become Errors carrying the status and a short detail', async () => {
  const client = (answers) => createConfluenceClient({ request: fakeRequest(answers).request, route });
  await assert.rejects(client([{ status: 403, text: 'no permission' }]).listSpaces(), /403.*no permission/);
  await assert.rejects(client([{ status: 500, text: 'boom' }]).findSpace('MD'), /500/);
  await assert.rejects(client([{ status: 200, json: { results: [] } }, { status: 400, text: 'bad body' }]).upsertPage({ spaceId: '9', title: 't', body: 'b' }), /400.*bad body/);
  await assert.rejects(client([{ status: 200, json: { results: [{ id: 5 }] } }, { status: 409, text: 'version conflict' }]).upsertPage({ spaceId: '9', title: 't', body: 'b' }), /409/);
});
