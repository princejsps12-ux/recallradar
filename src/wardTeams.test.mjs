import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWardTeamStore, wardKey, WARD_TEAMS_KEY, MAX_WARD_LENGTH } from './wardTeams.js';
import { fakeKv } from './fakeKv.mjs';

const T1 = 'ari:cloud:identity::team/11111111-aaaa-4bbb-8ccc-111111111111';
const T2 = 'ari:cloud:identity::team/22222222-aaaa-4bbb-8ccc-222222222222';
const icu = { ari: T1, name: 'ICU Team' };
const er = { ari: T2, name: 'ER Team' };

test('wards are compared ignoring case, spaces and punctuation', () => {
  assert.equal(wardKey('Med-Surg 3W'), wardKey('med surg 3w'));
  assert.notEqual(wardKey('Med-Surg 3W'), wardKey('Med-Surg 4E'));
});

test('there are no mappings at first', async () => {
  const store = createWardTeamStore(fakeKv());
  assert.deepEqual(await store.list(), []);
  assert.equal(await store.get('ICU'), null);
});

test('a ward can be mapped to a team and read back, however the ward is typed', async () => {
  const store = createWardTeamStore(fakeKv(), () => 123);
  const saved = await store.set('ICU', icu);
  assert.deepEqual(saved, { ward: 'ICU', teamAri: T1, teamName: 'ICU Team', savedAt: 123 });
  assert.equal((await store.get('icu')).teamName, 'ICU Team');
  assert.equal((await store.get(' I.C.U ')).teamName, 'ICU Team');
});

test('mapping a ward again replaces the team (one team per ward)', async () => {
  const store = createWardTeamStore(fakeKv());
  await store.set('ICU', icu);
  await store.set('icu', er);
  assert.equal((await store.list()).length, 1);
  assert.equal((await store.get('ICU')).teamName, 'ER Team');
});

test('several wards can share a team, and the list is sorted by ward', async () => {
  const store = createWardTeamStore(fakeKv());
  await store.set('ER', icu);
  await store.set('ICU', icu);
  await store.set('Cath Lab', er);
  assert.deepEqual((await store.list()).map((m) => m.ward), ['Cath Lab', 'ER', 'ICU']);
});

test('a mapping can be removed by saving null', async () => {
  const store = createWardTeamStore(fakeKv());
  await store.set('ICU', icu);
  assert.equal(await store.set('ICU', null), null);
  assert.deepEqual(await store.list(), []);
});

test('removing a ward that was never mapped is harmless', async () => {
  const store = createWardTeamStore(fakeKv());
  assert.equal(await store.set('ICU', null), null);
});

test('a bad ward name or team is refused and nothing is saved', async () => {
  const kv = fakeKv();
  const store = createWardTeamStore(kv);
  await assert.rejects(store.set('', icu), /ward name is required/);
  await assert.rejects(store.set('   ', icu), /ward name is required/);
  await assert.rejects(store.set('---', icu), /ward name is required/); // nothing letter or digit left
  await assert.rejects(store.set('x'.repeat(MAX_WARD_LENGTH + 1), icu), /ward name is required/);
  await assert.rejects(store.set('ICU', { ari: 'nope', name: 'X' }), /valid team/);
  await assert.rejects(store.set('ICU', { ari: T1, name: '' }), /valid team/);
  await assert.rejects(store.set('ICU', undefined), /valid team/);
  assert.equal(kv.data.has(WARD_TEAMS_KEY), false);
});

test('damaged stored data reads as no mappings', async () => {
  for (const bad of ['text', 5, {}, { mappings: 'x' }, null]) {
    const store = createWardTeamStore(fakeKv({ [WARD_TEAMS_KEY]: bad }));
    assert.deepEqual(await store.list(), [], JSON.stringify(bad));
  }
});

test('a storage error reads as no mappings', async () => {
  const kv = fakeKv();
  kv.get = async () => {
    throw new Error('storage down');
  };
  assert.deepEqual(await createWardTeamStore(kv).list(), []);
});

test('a record that cannot be read is never treated as empty: the change stops and the other wards keep their teams', async () => {
  const kv = fakeKv();
  const store = createWardTeamStore(kv);
  await store.set('ICU', icu);
  await store.set('ER', er);
  const realGet = kv.get.bind(kv);
  kv.get = async (key) => {
    if (key === WARD_TEAMS_KEY) throw new Error('storage down'); // only this record fails; the lock record reads fine
    return realGet(key);
  };
  await assert.rejects(() => store.set('Cath Lab', icu), /could not be read, so nothing was changed/);
  await assert.rejects(() => store.set('ICU', null), /could not be read/);
  assert.deepEqual(await store.list(), [], 'showing is tolerant: it reads as no mappings while the storage is down');
  kv.get = realGet;
  assert.deepEqual((await store.list()).map((m) => m.ward), ['ER', 'ICU'], 'and nothing was lost or written');
});

test('two changes at the same moment both survive', async () => {
  const kv = fakeKv();
  const store = createWardTeamStore(kv);
  await Promise.all([store.set('ICU', icu), store.set('ER', er), store.set('Cath Lab', icu)]);
  assert.deepEqual((await store.list()).map((m) => m.ward), ['Cath Lab', 'ER', 'ICU']);
});
