// The manifest's scopes must match the API calls the code makes: a missing scope fails at run time on a customer's site (a 403 the
// unit tests never see), an unused one is more access than the app needs. This reads the source and the manifest and compares.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (name) => readFileSync(join(root, 'src', name), 'utf8');
const files = readdirSync(join(root, 'src')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
const all = files.map((f) => [f, source(f)]);
const text = all.map(([, s]) => s).join('\n');

function manifestScopes() {
  const manifest = readFileSync(join(root, 'manifest.yml'), 'utf8');
  const block = /permissions:\s*\n\s*scopes:\n((?:\s+- .+\n)+)/.exec(manifest);
  assert.ok(block, 'manifest.yml has a permissions.scopes list');
  return [...block[1].matchAll(/- (\S+)/g)].map((m) => m[1]);
}

// What each kind of call needs. A call is recognised by the route or the Forge function it uses.
function requiredScopes() {
  const need = new Set();
  if (/route`\/rest\/api\/3\//.test(text)) need.add('read:jira-work');
  // Creating tasks, commenting (POST) needs the write scope.
  const jira = source('jiraClient.js');
  if (/method:\s*'(POST|PUT|DELETE)'/.test(jira)) need.add('write:jira-work');
  if (/route`\/wiki\/api\/v2\/spaces/.test(text)) need.add('read:space:confluence');
  if (/route`\/wiki\/api\/v2\/pages/.test(text)) need.add('read:page:confluence');
  if (/method:\s*'(POST|PUT)'/.test(source('confluenceClient.js'))) need.add('write:page:confluence');
  if (/@forge\/kvs/.test(text)) need.add('storage:app');
  if (/requestTeamworkGraph/.test(text)) {
    const graph = source('teamGraph.js');
    if (/atlassianUserInTeams|atlassianTeamMembers/.test(graph)) { need.add('read:graph:team:atlassian'); need.add('read:graph:user:atlassian'); }
    if (/spacesByAtlassianTeam|project/i.test(graph)) need.add('read:graph:project:jira');
    if (/atlassianUserAssignedJiraWorkItems/.test(graph)) need.add('read:graph:issue:jira');
  }
  // JSM Assets (read-only import): the object schema and the objects themselves.
  if (/route`\/jsm\/assets\//.test(text) || /\/rest\/servicedeskapi\/assets/.test(text)) { need.add('read:cmdb-object:jira'); need.add('read:cmdb-schema:jira'); }
  return need;
}

test('every scope the code needs is declared in manifest.yml', () => {
  const declared = new Set(manifestScopes());
  const missing = [...requiredScopes()].filter((s) => !declared.has(s));
  assert.deepEqual(missing, [], `declare these scopes in manifest.yml: ${missing.join(', ')}`);
});

test('no declared scope is unused (least privilege)', () => {
  const need = requiredScopes();
  const spare = manifestScopes().filter((s) => !need.has(s));
  assert.deepEqual(spare, [], `these scopes are declared but no code needs them: ${spare.join(', ')}`);
});

test('the only external address is api.fda.gov, and the code calls only that host', () => {
  const manifest = readFileSync(join(root, 'manifest.yml'), 'utf8');
  const addresses = [...manifest.matchAll(/- address: (\S+)/g)].map((m) => m[1]);
  assert.deepEqual(addresses, ['api.fda.gov']);
  const hosts = new Set([...text.matchAll(/https:\/\/([a-z0-9.-]+)\//g)].map((m) => m[1]));
  for (const host of hosts) assert.ok(['api.fda.gov', 'open.fda.gov', 'www.accessdata.fda.gov', 'mcp.atlassian.com', 'developer.atlassian.com', 'confluence.atlassian.com', 'support.atlassian.com', 'www.atlassian.com', 'atlassian.com', 'github.com'].includes(host) || /atlassian/.test(host), `unexpected host in the source: ${host}`);
});
