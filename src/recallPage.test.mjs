import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, recallPageTitle, buildRecallPageBody } from './recallPage.js';
import { pairKey } from './taskRules.js';

const match = (deviceId, extra = {}) => ({
  confidence: 'exact',
  reason: 'all listed',
  deviceId,
  deviceName: `Device ${deviceId}`,
  ward: 'Cath Lab',
  lotOrSerial: `SN-${deviceId}`,
  recallNumber: 'Z-0208-2027',
  recallClass: 'I',
  firm: 'Abiomed, Inc.',
  product: 'Impella Controller',
  date: '2026-11-04',
  ...extra,
});

const info = { status: 'Ongoing', initiated: '2026-09-17', reason: 'RFID firmware may fail to recognise the purge cassette.' };

test('escapeHtml neutralises markup and quotes', () => {
  assert.equal(escapeHtml('<b>"A" & B</b>'), '&lt;b&gt;&quot;A&quot; &amp; B&lt;/b&gt;');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(5), '5');
});

test('the page title is the recall number, so the page can be found again', () => {
  assert.equal(recallPageTitle('Z-0208-2027'), 'FDA recall Z-0208-2027');
});

test('the page says what is wrong, using the recall\'s own reason text', () => {
  const body = buildRecallPageBody({ matches: [match('d1')], info });
  assert.match(body, /<h2>What is wrong<\/h2><p>RFID firmware may fail to recognise the purge cassette\.<\/p>/);
});

test('the page says what to do, with the class meaning and the due days', () => {
  const body = buildRecallPageBody({ matches: [match('d1')], info });
  assert.match(body, /<h2>What to do<\/h2><ol>/);
  assert.match(body, /Class I: a reasonable chance the device could cause serious harm or death/);
  assert.match(body, /due 2 days after they are created/);
  assert.match(body, /manufacturer&#39;?s recall notice|manufacturer's recall notice/);
});

test('class II recalls are due in 7 days', () => {
  const body = buildRecallPageBody({ matches: [match('d1', { recallClass: 'II' })], info });
  assert.match(body, /Class II recall are due 7 days/);
});

test('an unknown class is described honestly', () => {
  const body = buildRecallPageBody({ matches: [match('d1', { recallClass: '' })], info });
  assert.match(body, /Class not stated: treat as serious until confirmed/);
  assert.match(body, /Class unknown recall are due 2 days/);
});

test('the affected-devices table has one row per device with id, ward, serial and match', () => {
  const body = buildRecallPageBody({ matches: [match('d1'), match('d2', { ward: 'ER', confidence: 'likely' })], info });
  assert.match(body, /<td>d1<\/td><td>Device d1<\/td><td>Cath Lab<\/td><td>SN-d1<\/td><td>Exact<\/td>/);
  assert.match(body, /<td>d2<\/td><td>Device d2<\/td><td>ER<\/td><td>SN-d2<\/td><td>Likely \(check manually\)<\/td>/);
});

test('a missing ward or serial is shown as "not recorded"', () => {
  const body = buildRecallPageBody({ matches: [match('d1', { ward: '', lotOrSerial: '' })], info });
  assert.match(body, /<td>not recorded<\/td><td>not recorded<\/td>/);
});

test('task links are Jira macros for existing tasks and "no task yet" otherwise', () => {
  const body = buildRecallPageBody({
    matches: [match('d1'), match('d2')],
    info,
    taskKeys: { [pairKey('Z-0208-2027', 'd1')]: 'MOBL-93' },
  });
  assert.match(body, /<ac:structured-macro ac:name="jira" ac:schema-version="1"><ac:parameter ac:name="key">MOBL-93<\/ac:parameter><\/ac:structured-macro>/);
  assert.match(body, /<td>no task yet<\/td>/);
});

test('a task key that does not look like a Jira key is never put in a macro', () => {
  const body = buildRecallPageBody({
    matches: [match('d1')],
    info,
    taskKeys: { [pairKey('Z-0208-2027', 'd1')]: '</ac:parameter><script>x</script>' },
  });
  assert.ok(!body.includes('<script>'));
  assert.ok(!body.includes('ac:name="key"'));
  assert.match(body, /&lt;script&gt;/);
});

test('every piece of FDA or hospital text is escaped', () => {
  const body = buildRecallPageBody({
    matches: [match('<d1>', { deviceName: '<img src=x onerror=alert(1)>', ward: 'ICU & "Step-down"', firm: 'A <b>Co</b>', product: '<script>p</script>' })],
    info: { status: '<s>', initiated: '', reason: '<script>alert(1)</script> & more' },
  });
  for (const bad of ['<script>', '<img', '<b>Co', '<d1>', '<s>']) assert.ok(!body.includes(bad), bad);
  assert.match(body, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; more/);
  assert.match(body, /ICU &amp; &quot;Step-down&quot;/);
});

test('the page links to the real FDA record for the recall and the FDA database', () => {
  const body = buildRecallPageBody({ matches: [match('d1')], info });
  assert.match(body, /href="https:\/\/api\.fda\.gov\/device\/enforcement\.json\?search=recall_number:%22Z-0208-2027%22"/);
  assert.match(body, /href="https:\/\/www\.accessdata\.fda\.gov\/scripts\/cdrh\/cfdocs\/cfRES\/res\.cfm"/);
});

test('without saved details it says so rather than inventing a reason', () => {
  const body = buildRecallPageBody({ matches: [match('d1')], info: {} });
  assert.match(body, /The reason for this recall is not stored in the saved check/);
  assert.match(body, /<th>Status<\/th><td>Not stated<\/td>/);
});

test('a likely match adds the "check it by hand" step', () => {
  const body = buildRecallPageBody({ matches: [match('d1', { confidence: 'likely' })], info });
  assert.match(body, /For a &quot;likely&quot; match|For a "likely" match/);
});

test('the footer says when the saved check ran and that re-running updates the page', () => {
  const body = buildRecallPageBody({ matches: [match('d1')], info, checkedAt: '2026-11-15T09:00:23.000Z' });
  assert.match(body, /saved check of 2026-11-15T09:00:23\.000Z/);
  assert.match(body, /Re-running it updates this page/);
});

test('the facts table covers class, firm, product, dates and status', () => {
  const body = buildRecallPageBody({ matches: [match('d1')], info });
  for (const fragment of ['<th>Recall class</th><td>Class I</td>', '<th>Recalling firm</th><td>Abiomed, Inc.</td>', '<th>Product</th><td>Impella Controller</td>', '<th>Reported to FDA</th><td>2026-11-04</td>', '<th>Recall started</th><td>2026-09-17</td>', '<th>Status</th><td>Ongoing</td>']) {
    assert.ok(body.includes(fragment), fragment);
  }
});
