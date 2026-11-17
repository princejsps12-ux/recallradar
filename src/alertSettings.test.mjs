import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAlertSettings, validateSettings, ALERT_SETTINGS_KEY, EMPTY_SETTINGS } from './alertSettings.js';
import { fakeKv } from './fakeKv.mjs';

test('validateSettings accepts project and issue keys, upper-cases and trims them', () => {
  assert.deepEqual(validateSettings({ enabled: true, projectKey: ' mobl ', commentIssueKey: ' mobl-12 ' }), { ok: true, settings: { enabled: true, projectKey: 'MOBL', commentIssueKey: 'MOBL-12' } });
  assert.deepEqual(validateSettings({ enabled: false }), { ok: true, settings: { enabled: false, projectKey: '', commentIssueKey: '' } });
  assert.deepEqual(validateSettings({ enabled: true, projectKey: 'KAN_2' }).settings, { enabled: true, projectKey: 'KAN_2', commentIssueKey: '' });
});

test('validateSettings refuses what is not a key, and "on" without a project', () => {
  for (const projectKey of ['m', 'a-b', '1ABC', 'WAYTOOLONGKEY', 'MO BL', 'MOBL/1']) assert.equal(validateSettings({ enabled: false, projectKey }).ok, false, projectKey);
  for (const commentIssueKey of ['MOBL', '12', 'MOBL-', 'MOBL-0', 'MOBL-1a', 'x y-1']) assert.equal(validateSettings({ enabled: false, commentIssueKey }).ok, false, commentIssueKey);
  const on = validateSettings({ enabled: true });
  assert.equal(on.ok, false);
  assert.match(on.error, /Choose the project/);
  assert.equal(validateSettings(null).ok, true, 'nothing at all is the empty setting');
  assert.equal(validateSettings({ enabled: 'yes' }).settings.enabled, false, 'only a real true turns it on');
});

test('the store saves, reads back and clears; a missing or damaged record means alerts are off', async () => {
  const kv = fakeKv();
  const store = createAlertSettings(kv);
  assert.deepEqual(await store.get(), EMPTY_SETTINGS);
  await store.save({ enabled: true, projectKey: 'MOBL', commentIssueKey: '' });
  assert.deepEqual(await store.get(), { enabled: true, projectKey: 'MOBL', commentIssueKey: '' });
  kv.data.set(ALERT_SETTINGS_KEY, { enabled: true, projectKey: 'not valid!' });
  assert.deepEqual(await store.get(), EMPTY_SETTINGS, 'a damaged record is never guessed at');
  await store.clear();
  assert.equal(kv.data.has(ALERT_SETTINGS_KEY), false);
  const broken = createAlertSettings({ get: async () => { throw new Error('down'); }, set: async () => {}, delete: async () => {} });
  assert.deepEqual(await broken.get(), EMPTY_SETTINGS);
});
