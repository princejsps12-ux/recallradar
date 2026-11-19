import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTeamRouter, teamLabel, TEAM_OPEN_TASK_LIMIT, ESCALATED_LABEL } from './teamRouting.js';

const store = (map) => ({ async get(ward) { return map[ward] || null; } });
const m = (n, ward) => ({ recallNumber: 'Z-1', deviceId: `d${n}`, ward });

test('team labels are Jira-safe', () => {
  assert.equal(teamLabel('Team Atlas'), 'recallradar-team-team-atlas');
  assert.equal(teamLabel('  ICU & Co. '), 'recallradar-team-icu-co');
  assert.equal(teamLabel('???'), '');
  assert.equal(teamLabel(undefined), '');
});

test('a task for a ward with a team is routed to it; a ward without one is left alone', async () => {
  const router = createTeamRouter({ store: store({ ICU: { teamName: 'Team Atlas' } }), countOpen: async () => 2 });
  const routes = await router.route([m(1, 'ICU'), m(2, 'ER'), m(3, '')]);
  assert.deepEqual([...routes.keys()], ['Z-1|d1']);
  const r = routes.get('Z-1|d1');
  assert.equal(r.teamName, 'Team Atlas');
  assert.equal(r.label, 'recallradar-team-team-atlas');
  assert.equal(r.escalated, false);
});

test('a team that already holds the limit gets the new task escalated', async () => {
  const router = createTeamRouter({ store: store({ ICU: { teamName: 'Team Atlas' } }), countOpen: async () => TEAM_OPEN_TASK_LIMIT });
  assert.equal((await router.route([m(1, 'ICU')])).get('Z-1|d1').escalated, true);
});

test('tasks planned in the same batch count, so only the overflow is escalated', async () => {
  const router = createTeamRouter({ store: store({ ICU: { teamName: 'T' } }), countOpen: async () => 8, limit: 10 });
  const routes = await router.route([m(1, 'ICU'), m(2, 'ICU'), m(3, 'ICU'), m(4, 'ICU')]);
  assert.deepEqual([...routes.values()].map((r) => r.escalated), [false, false, true, true]);
});

test('the open count is read once per team', async () => {
  let calls = 0;
  const router = createTeamRouter({ store: store({ ICU: { teamName: 'T' }, ER: { teamName: 'T' } }), countOpen: async () => { calls += 1; return 0; } });
  await router.route([m(1, 'ICU'), m(2, 'ER'), m(3, 'ICU')]);
  assert.equal(calls, 1);
});

test('when the count cannot be read the task is routed but not escalated', async () => {
  const router = createTeamRouter({ store: store({ ICU: { teamName: 'T' } }), countOpen: async () => { throw new Error('Jira down'); } });
  const r = (await router.route([m(1, 'ICU')])).get('Z-1|d1');
  assert.equal(r.escalated, false);
  assert.equal(r.label, 'recallradar-team-t');
});

test('the escalation label has a fixed name', () => assert.equal(ESCALATED_LABEL, 'recallradar-escalated'));
