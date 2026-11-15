import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecallPages, MAX_PAGES_PER_CALL } from './recallPageService.js';
import { pairKey } from './taskRules.js';

const match = (deviceId, recallNumber, extra = {}) => ({
  confidence: 'exact',
  reason: 'all listed',
  deviceId,
  deviceName: `Device ${deviceId}`,
  deviceManufacturer: 'Abiomed',
  deviceModel: 'M1',
  lotOrSerial: `SN-${deviceId}`,
  ward: 'ICU',
  recallNumber,
  recallClass: 'I',
  firm: 'Abiomed, Inc.',
  product: 'Impella',
  date: '2026-11-04',
  ...extra,
});

const result = (extra = {}) => ({
  checkedAt: '2026-11-15T09:00:23.000Z',
  matches: [
    match('d1', 'Z-1-2026'),
    match('d2', 'Z-1-2026', { ward: 'ER' }),
    match('d3', 'Z-2-2026', { recallClass: 'II', confidence: 'likely' }),
    match('d4', 'Z-3-2026', { confidence: 'possible' }),
    match('d5', 'Z-9-2026'),
  ],
  recallDetails: {
    'Z-1-2026': { status: 'Ongoing', initiated: '2026-06-01', reason: 'Leaks.' },
    'Z-2-2026': { status: 'Ongoing', initiated: '2026-07-01', reason: 'Label.' },
    'Z-9-2026': { status: 'Terminated', initiated: '', reason: 'Old.' },
  },
  ...extra,
});

const snapshot = (extra) => ({ devices: [], result: extra === null ? null : result(extra) });

// A fake Confluence: records writes and remembers pages by title so a second run updates them.
function fakeConfluence({ spaces = [{ id: '9', key: 'MD', name: 'Mobile Development' }], failFor = [] } = {}) {
  const pages = new Map();
  const state = { writes: [] };
  return {
    state,
    confluence: {
      async listSpaces() {
        return spaces;
      },
      async findSpace(key) {
        return spaces.find((s) => s.key === key) || null;
      },
      async upsertPage({ spaceId, title, body }) {
        if (failFor.some((f) => title.includes(f))) throw new Error('Confluence answered 403');
        const had = pages.has(`${spaceId}|${title}`);
        const id = had ? pages.get(`${spaceId}|${title}`) : String(100 + pages.size);
        pages.set(`${spaceId}|${title}`, id);
        state.writes.push({ spaceId, title, body, action: had ? 'updated' : 'created' });
        return { action: had ? 'updated' : 'created', id, url: `https://x/wiki/pages/${id}` };
      },
    },
  };
}

const run = (fake, inputs, snap = snapshot(), extraDeps = {}) =>
  createRecallPages({ snapshot: snap, inputs, deps: { confluence: fake.confluence, ...extraDeps } });

test('without a saved check it says how to get one', async () => {
  assert.match((await run(fakeConfluence(), { spaceKey: 'MD' }, snapshot(null))).error, /saved recall check/);
});

test('without a space it lists the spaces and asks, instead of guessing', async () => {
  const fake = fakeConfluence();
  const out = await run(fake, {});
  assert.equal(out.ok, false);
  assert.equal(out.needsSpace, true);
  assert.deepEqual(out.availableSpaces, [{ key: 'MD', name: 'Mobile Development' }]);
  assert.equal(fake.state.writes.length, 0);
});

test('an unknown space is refused and the real ones are offered', async () => {
  const fake = fakeConfluence();
  const out = await run(fake, { spaceKey: 'nope' });
  assert.equal(out.needsSpace, true);
  assert.match(out.error, /no Confluence space with the key NOPE/);
  assert.deepEqual(out.availableSpaces.map((s) => s.key), ['MD']);
  assert.equal(fake.state.writes.length, 0);
});

test('the space key is accepted in any case', async () => {
  assert.equal((await run(fakeConfluence(), { spaceKey: 'md' })).state, 'done');
});

test('it writes one page per open recall with an exact or likely match', async () => {
  const fake = fakeConfluence();
  const out = await run(fake, { spaceKey: 'MD' });
  assert.deepEqual(out.pages.map((p) => p.title), ['FDA recall Z-1-2026', 'FDA recall Z-2-2026']);
  assert.deepEqual(out.pages.map((p) => p.action), ['created', 'created']);
  assert.equal(fake.state.writes.length, 2);
  assert.equal(out.space.key, 'MD');
});

test('possible matches and closed recalls never get a page', async () => {
  const out = await run(fakeConfluence(), { spaceKey: 'MD' });
  const numbers = out.pages.map((p) => p.recallNumber);
  assert.ok(!numbers.includes('Z-3-2026')); // only a possible match
  assert.ok(!numbers.includes('Z-9-2026')); // terminated
});

test('the page lists every affected device of that recall', async () => {
  const fake = fakeConfluence();
  const out = await run(fake, { spaceKey: 'MD' });
  assert.deepEqual(out.pages[0].devices, ['d1', 'd2']);
  assert.match(fake.state.writes[0].body, /<td>d1<\/td>/);
  assert.match(fake.state.writes[0].body, /<td>d2<\/td>/);
  assert.ok(!fake.state.writes[0].body.includes('<td>d3</td>'));
});

test('one recall can be chosen by number, however it is typed', async () => {
  const fake = fakeConfluence();
  const out = await run(fake, { spaceKey: 'MD', recallNumber: ' z-2-2026 ' });
  assert.deepEqual(out.pages.map((p) => p.recallNumber), ['Z-2-2026']);
  assert.equal(fake.state.writes.length, 1);
});

test('a recall that is not in the saved check is not guessed at', async () => {
  const fake = fakeConfluence();
  const out = await run(fake, { spaceKey: 'MD', recallNumber: 'Z-4242-2026' });
  assert.equal(out.state, 'not-found');
  assert.match(out.message, /Do not guess/);
  assert.deepEqual(out.citations.recallNumbers, []);
  assert.equal(fake.state.writes.length, 0);
});

test('running it again updates the same pages instead of making new ones', async () => {
  const fake = fakeConfluence();
  await run(fake, { spaceKey: 'MD' });
  const again = await run(fake, { spaceKey: 'MD' });
  assert.deepEqual(again.pages.map((p) => p.action), ['updated', 'updated']);
  assert.equal(new Set(again.pages.map((p) => p.url)).size, 2);
});

test('existing Jira tasks are linked in the page, and counted', async () => {
  const fake = fakeConfluence();
  const getTaskKeys = async () => ({ [pairKey('Z-1-2026', 'd1')]: 'MOBL-93' });
  const out = await run(fake, { spaceKey: 'MD', recallNumber: 'Z-1-2026' }, snapshot(), { getTaskKeys });
  assert.match(fake.state.writes[0].body, /ac:name="key">MOBL-93</);
  assert.equal(out.pages[0].tasksLinked, 1);
});

test('a Jira lookup failure does not stop the page: it says "no task yet"', async () => {
  const fake = fakeConfluence();
  const getTaskKeys = async () => {
    throw new Error('jira down');
  };
  const out = await run(fake, { spaceKey: 'MD' }, snapshot(), { getTaskKeys });
  assert.equal(out.pages.length, 2);
  assert.match(fake.state.writes[0].body, /no task yet/);
});

test('a page that fails is reported, and the others are still written', async () => {
  const fake = fakeConfluence({ failFor: ['Z-1-2026'] });
  const out = await run(fake, { spaceKey: 'MD' });
  assert.deepEqual(out.pages.map((p) => p.recallNumber), ['Z-2-2026']);
  assert.deepEqual(out.failed, [{ recallNumber: 'Z-1-2026', error: 'Confluence answered 403' }]);
});

test('a big job is written in rounds, and says how many were left', async () => {
  const many = Array.from({ length: MAX_PAGES_PER_CALL + 4 }, (_, i) => match(`m${i}`, `Z-${i + 100}-2026`));
  const fake = fakeConfluence();
  const out = await run(fake, { spaceKey: 'MD' }, { devices: [], result: result({ matches: many, recallDetails: {} }) });
  assert.equal(out.pages.length, MAX_PAGES_PER_CALL);
  assert.equal(out.notIncluded, 4);
  assert.equal(fake.state.writes.length, MAX_PAGES_PER_CALL);
});

test('with no open recalls there is nothing to write', async () => {
  const out = await run(fakeConfluence(), { spaceKey: 'MD' }, { devices: [], result: result({ matches: [match('d4', 'Z-3-2026', { confidence: 'possible' })] }) });
  assert.equal(out.state, 'nothing-to-do');
});

test('the answer cites exactly the recall numbers and device ids it wrote', async () => {
  const out = await run(fakeConfluence(), { spaceKey: 'MD' });
  assert.deepEqual(out.citations.recallNumbers, ['Z-1-2026', 'Z-2-2026']);
  assert.deepEqual(out.citations.deviceIds, ['d1', 'd2', 'd3']);
});

test('the summary counts created and updated pages and names the space', async () => {
  const fake = fakeConfluence();
  await run(fake, { spaceKey: 'MD', recallNumber: 'Z-1-2026' });
  const out = await run(fake, { spaceKey: 'MD' });
  assert.match(out.message, /1 page\(s\) created and 1 updated in the Mobile Development space/);
});
