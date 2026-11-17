import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAlerts, buildAlertComment, friendlyJiraError, friendlyIssueError, MAX_ALERT_TASKS_PER_RUN, MAX_COMMENT_ITEMS } from './alertService.js';
import { createAlertState, ALERT_WINDOW_MS } from './alertState.js';
import { createAlertSettings } from './alertSettings.js';
import { createTaskGuard } from './taskService.js';
import { taskLabel, pairKey } from './taskRules.js';
import { fakeKv } from './fakeKv.mjs';

const T0 = Date.UTC(2026, 10, 17, 3, 0, 0);
const HOUR = 3600 * 1000;

const match = (deviceId, recallNumber, extra = {}) => ({
  confidence: 'exact', rule: 'exact-manufacturer-model-lot', reason: 'all listed', deviceId, deviceName: `Pump ${deviceId}`,
  deviceManufacturer: 'ICU Medical', deviceModel: 'M1', lotOrSerial: 'SN1', ward: 'ICU', recallNumber, recallClass: 'II',
  firm: 'ICU Medical, Inc.', product: 'Plum Duo pump', date: '2026-11-10', ...extra,
});
const resultOf = (matches, extra = {}) => ({ deviceCount: 5, recallCount: 3, matches, recallDetails: {}, failedQueries: 0, cappedQueries: 0, ...extra });
const pairsOf = (matches) => matches.map((m) => pairKey(m.recallNumber, m.deviceId));

// A Jira that numbers new issues AL-1, AL-2, ... and records every comment.
function fakeJira({ existing = {}, typeError = null, failIndexes = [], commentError = null, baseUrl = 'https://example.atlassian.net' } = {}) {
  const state = { existing: new Map(Object.entries(existing)), next: 1, comments: [], bulkCalls: 0 };
  const jira = {
    async findByLabels(labels) { return new Map(labels.filter((l) => state.existing.has(l)).map((l) => [l, state.existing.get(l)])); },
    async taskIssueTypeId() { if (typeError) throw typeError; return '10001'; },
    async bulkCreate(fieldsList) {
      state.bulkCalls += 1;
      const created = [];
      const errors = [];
      fieldsList.forEach((fields, index) => {
        if (failIndexes.includes(index)) { errors.push({ index, message: 'Jira said no.' }); return; }
        const key = `AL-${state.next++}`;
        state.existing.set(fields.labels[1], key);
        created.push({ index, key });
      });
      return { created, errors };
    },
    async addComment(issueKey, body) { if (commentError) throw commentError; state.comments.push({ issueKey, body }); },
    async baseUrl() { return baseUrl; },
  };
  return { jira, state };
}

function setup({ settings = { enabled: true, projectKey: 'AL', commentIssueKey: 'AL-100' }, jiraOptions } = {}) {
  const clock = { now: T0 };
  const kv = fakeKv();
  const state = createAlertState(kv, () => clock.now);
  const store = createAlertSettings(kv);
  const guard = createTaskGuard(fakeKv(), () => clock.now);
  const fake = fakeJira(jiraOptions);
  const logged = [];
  const ready = settings ? store.save(settings) : Promise.resolve();
  const run = async (result) => { await ready; return runAlerts({ state, settings: store, result, jira: fake.jira, guard, now: () => new Date(clock.now), log: { error: (...a) => logged.push(a) } }); };
  return { clock, state, store, guard, fake, run, logged, ready };
}

// The hospital has d0 affected at the start (the baseline); then news arrives.
async function withNews(s, news) {
  const base = [match('d0', 'Z-0')];
  await s.state.track(pairsOf(base));
  s.clock.now += 21 * HOUR;
  const all = [...base, ...news];
  await s.state.track(pairsOf(all));
  return resultOf(all);
}

test('alerts off, no project, or an incomplete check: nothing is touched', async () => {
  const off = setup({ settings: { enabled: false, projectKey: 'AL', commentIssueKey: '' } });
  const result = await withNews(off, [match('d1', 'Z-1')]);
  assert.deepEqual(await off.run(result), { ran: false, reason: 'off' });
  assert.equal(off.fake.state.bulkCalls, 0);
  const none = setup({ settings: null });
  assert.deepEqual(await none.run(resultOf([])), { ran: false, reason: 'off' });
  const on = setup();
  const incomplete = { ...(await withNews(on, [match('d1', 'Z-1')])), failedQueries: 2 };
  assert.deepEqual(await on.run(incomplete), { ran: false, reason: 'incomplete' });
  assert.equal(on.fake.state.bulkCalls, 0, 'a partial result is never acted on');
  assert.deepEqual(await on.run(null), { ran: false, reason: 'incomplete' });
});

test('news becomes tasks and ONE comment; the baseline pair gets nothing; a second run does nothing', async () => {
  const s = setup();
  const result = await withNews(s, [match('d1', 'Z-1', { recallClass: 'I' }), match('d2', 'Z-1', { recallClass: 'I' }), match('d3', 'Z-2')]);
  const out = await s.run(result);
  assert.equal(out.ran, true);
  assert.deepEqual(out.summary, { at: new Date(s.clock.now).toISOString(), news: 3, created: ['AL-1', 'AL-2', 'AL-3'], existing: 0, failed: 0, left: 0, comment: 'posted', error: '' });
  assert.ok(!s.fake.state.existing.has(taskLabel('Z-0', 'd0')), 'the pair that was there from the start is not news');
  assert.equal(s.fake.state.comments.length, 1);
  assert.equal(s.fake.state.comments[0].issueKey, 'AL-100');
  assert.deepEqual((await s.state.overview()).last, out.summary, 'the summary is kept as the last run');
  const again = await s.run(result);
  assert.equal(again.summary.news, 0);
  assert.equal(s.fake.state.bulkCalls, 1, 'nothing is created twice');
  assert.equal(s.fake.state.comments.length, 1, 'and nothing is announced twice');
});

test('a pair that already has a task (made by hand) is not created again, and the comment still links it', async () => {
  const s = setup({ jiraOptions: { existing: { [taskLabel('Z-1', 'd1')]: 'AL-77' } } });
  const result = await withNews(s, [match('d1', 'Z-1'), match('d2', 'Z-1')]);
  const out = await s.run(result);
  assert.equal(out.summary.existing, 1);
  assert.deepEqual(out.summary.created, ['AL-1']);
  const text = JSON.stringify(s.fake.state.comments[0].body);
  assert.ok(text.includes('AL-77') && text.includes('AL-1'));
});

test('a recall that is already closed, and a weak ("possible") match, are not news for the alert', async () => {
  const s = setup();
  const base = [match('d0', 'Z-0')];
  await s.state.track(pairsOf(base));
  s.clock.now += HOUR;
  const matches = [...base, match('d1', 'Z-1'), match('d2', 'Z-2', { confidence: 'possible' })];
  const result = resultOf(matches, { recallDetails: { 'Z-1': { status: 'Terminated' } } });
  await s.state.track(pairsOf(matches.filter((m) => m.confidence !== 'possible' && m.recallNumber !== 'Z-1')));
  const out = await s.run(result);
  assert.equal(out.summary.news, 0);
  assert.equal(s.fake.state.bulkCalls, 0);
});

test('Jira refuses the app user: the run says so in plain words, creates nothing, and tries again next time', async () => {
  const s = setup({ jiraOptions: { typeError: new Error('Jira answered 403: no permission') } });
  const result = await withNews(s, [match('d1', 'Z-1')]);
  const out = await s.run(result);
  assert.equal(out.summary.created.length, 0);
  assert.match(out.summary.error, /RecallRadar app user/);
  assert.match(out.summary.error, /AL/);
  assert.equal(s.fake.state.comments.length, 0);
  assert.equal(s.logged.length, 1);
  assert.deepEqual((await s.state.pendingAlerts(new Set(pairsOf(result.matches)))).due, ['Z-1|d1'], 'the pair is still due');
  // permission fixed: the next run creates it
  s.fake.jira.taskIssueTypeId = async () => '10001';
  assert.equal((await s.run(result)).summary.created.length, 1);
});

test('tasks Jira could not create stay due; the ones that worked are handled', async () => {
  const s = setup({ jiraOptions: { failIndexes: [1] } });
  const result = await withNews(s, [match('d1', 'Z-1'), match('d2', 'Z-2'), match('d3', 'Z-3')]);
  const out = await s.run(result);
  assert.equal(out.summary.created.length, 2);
  assert.equal(out.summary.failed, 1);
  assert.match(out.summary.error, /RecallRadar app user|Jira did not accept/);
  assert.equal((await s.state.pendingAlerts(new Set(pairsOf(result.matches)))).due.length, 1);
});

test('a comment that cannot be posted is reported, and does not make the tasks be created again', async () => {
  const s = setup({ jiraOptions: { commentError: new Error('Jira answered 404: no such issue') } });
  const result = await withNews(s, [match('d1', 'Z-1')]);
  const out = await s.run(result);
  assert.equal(out.summary.comment, 'failed');
  assert.equal(out.summary.created.length, 1);
  assert.match(out.summary.error, /AL-100.*add comments/s);
  assert.equal((await s.run(result)).summary.news, 0, 'the task exists and is handled');
});

test('without a comment issue the alert only creates tasks', async () => {
  const s = setup({ settings: { enabled: true, projectKey: 'AL', commentIssueKey: '' } });
  const out = await s.run(await withNews(s, [match('d1', 'Z-1')]));
  assert.equal(out.summary.comment, 'none');
  assert.equal(s.fake.state.comments.length, 0);
  assert.equal(out.summary.created.length, 1);
});

test('a run creates at most MAX_ALERT_TASKS_PER_RUN, oldest news first, and says how many are left', async () => {
  const s = setup();
  const news = Array.from({ length: MAX_ALERT_TASKS_PER_RUN + 5 }, (_, i) => match(`d${i + 1}`, 'Z-1'));
  const result = await withNews(s, news);
  const out = await s.run(result);
  assert.equal(out.summary.created.length, MAX_ALERT_TASKS_PER_RUN);
  assert.equal(out.summary.left, 5);
  assert.match(JSON.stringify(s.fake.state.comments[0].body), /5 more will be handled at the next daily run/);
  const next = await s.run(result);
  assert.equal(next.summary.created.length, 5, 'the rest are taken at the next run');
});

test('news the alert came to late for (older than the window) is marked handled without a task', async () => {
  const s = setup();
  const result = await withNews(s, [match('d1', 'Z-1')]);
  s.clock.now += ALERT_WINDOW_MS;
  const out = await s.run(result);
  assert.equal(out.summary.news, 0);
  assert.equal(s.fake.state.bulkCalls, 0);
});

test('buildAlertComment: counts, one line per task with a link when the site address is known, and a cut list', () => {
  const items = [{ match: match('d1', 'Z-1', { recallClass: 'I' }), key: 'AL-1' }, { match: match('d2', 'Z-1', { recallClass: 'I' }), key: 'AL-2' }, { match: match('d3', 'Z-2', { recallClass: '' }), key: 'AL-3' }];
  const doc = buildAlertComment({ items, dateText: '2026-11-17', baseUrl: 'https://example.atlassian.net' });
  assert.equal(doc.version, 1);
  assert.equal(doc.type, 'doc');
  const text = JSON.stringify(doc);
  assert.match(text, /2 new recalls affect 3 devices \(2026-11-17\)/);
  assert.match(text, /Z-1 \(Class I\)/);
  assert.match(text, /class not stated/);
  assert.match(text, /https:\/\/example\.atlassian\.net\/browse\/AL-2/);
  const plain = JSON.stringify(buildAlertComment({ items: items.slice(0, 1), dateText: 'today' }));
  assert.match(plain, /1 new recall affects 1 device/);
  assert.ok(!plain.includes('"link"'), 'no site address, no link: the key is plain text');
  const many = Array.from({ length: MAX_COMMENT_ITEMS + 3 }, (_, i) => ({ match: match(`d${i}`, 'Z-1'), key: `AL-${i}` }));
  const cut = buildAlertComment({ items: many, dateText: 'today' });
  assert.equal(cut.content[1].content.length, MAX_COMMENT_ITEMS);
  assert.match(JSON.stringify(cut), /\.\.\.and 3 more/);
});

test('friendlyJiraError names the permission to fix, for the errors Jira gives an app user', () => {
  for (const status of ['401', '403', '404']) assert.match(friendlyJiraError(new Error(`Jira answered ${status}`), 'MOBL'), /MOBL.*app user/s);
  assert.match(friendlyJiraError(new Error('Jira answered 429')), /slow down/);
  assert.match(friendlyJiraError(new Error('boom')), /try again/);
  assert.match(friendlyJiraError(undefined), /try again/);
  assert.match(friendlyIssueError(new Error('Jira answered 404'), 'MOBL-9'), /MOBL-9.*app user/s);
  assert.match(friendlyIssueError(new Error('boom'), 'MOBL-9'), /try again/);
});
