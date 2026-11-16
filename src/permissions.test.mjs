import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refuseUnlessAdministrator, NOT_ADMIN_MESSAGE, PERMISSION_CHECK_FAILED } from './permissions.js';
import { createJiraClient } from './jiraClient.js';

const route = (strings, ...values) => strings.reduce((out, s, i) => out + s + (i < values.length ? encodeURIComponent(values[i]) : ''), '');
const answering = (status, body) => ({ async request(path) { this.asked = path; return { ok: status >= 200 && status < 300, status, json: async () => body }; } });

test('an administrator is let through', async () => {
  assert.equal(await refuseUnlessAdministrator({ isAdministrator: async () => true }), null);
});

test('anyone else is refused with the plain message, and flagged so the page can say so', async () => {
  const out = await refuseUnlessAdministrator({ isAdministrator: async () => false });
  assert.deepEqual(out, { ok: false, notAllowed: true, error: NOT_ADMIN_MESSAGE });
});

test('a failed permission check refuses too, without claiming the person lacks the permission', async () => {
  const out = await refuseUnlessAdministrator({ isAdministrator: async () => { throw new Error('Jira answered 500'); } });
  assert.equal(out.ok, false);
  assert.equal(out.error, PERMISSION_CHECK_FAILED);
  assert.notEqual(out.notAllowed, true);
});

test('the Jira client reads the ADMINISTER permission, and only a clear "true" counts', async () => {
  const ask = async (status, body) => {
    const fake = answering(status, body);
    const client = createJiraClient({ request: (p, o) => fake.request.call(fake, p, o), route });
    return { result: await client.isAdministrator().then((v) => v, (e) => e), fake };
  };
  const yes = await ask(200, { permissions: { ADMINISTER: { havePermission: true } } });
  assert.equal(yes.result, true);
  assert.equal(yes.fake.asked, '/rest/api/3/mypermissions?permissions=ADMINISTER');
  assert.equal((await ask(200, { permissions: { ADMINISTER: { havePermission: false } } })).result, false);
  assert.equal((await ask(200, { permissions: {} })).result, false);
  assert.equal((await ask(200, null)).result, false);
  assert.equal((await ask(200, { permissions: { ADMINISTER: { havePermission: 'true' } } })).result, false, 'a string is not a yes');
  assert.match((await ask(403, {})).result.message, /403/);
});
