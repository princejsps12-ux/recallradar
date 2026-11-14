import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPENFDA_BASE_URL,
  MAX_RECALLS_PER_QUERY,
  formatYmd,
  daysAgoYmd,
  phraseClause,
  buildFirmRecallsUrl,
  buildModelRecallsUrl,
  parseRecallForMatching,
} from './openfda.js';
import {
  LOOKBACK_DAYS,
  MODELS_PER_QUERY,
  planRecallQueries,
  findRecallsForDevices,
} from './recallSearch.js';

const NOW = new Date(Date.UTC(2026, 10, 14)); // 14 Nov 2026

const device = (id, manufacturer, model) => ({
  id,
  name: id,
  type: 'pump',
  manufacturer,
  model,
  lotOrSerial: '',
});

// --- Dates -------------------------------------------------------------------------------------

test('formatYmd pads month and day', () => {
  assert.equal(formatYmd(new Date(Date.UTC(2026, 0, 5))), '20260105');
  assert.equal(formatYmd(NOW), '20261114');
});

test('daysAgoYmd counts back across month and year boundaries', () => {
  assert.equal(daysAgoYmd(NOW, 0), '20261114');
  assert.equal(daysAgoYmd(NOW, 14), '20261031');
  assert.equal(daysAgoYmd(NOW, 365), '20251114');
  assert.equal(daysAgoYmd(new Date(Date.UTC(2026, 0, 10)), 20), '20251221');
});

// --- Search clauses ------------------------------------------------------------------------------

test('phraseClause builds a quoted phrase joined with +', () => {
  assert.equal(phraseClause('recalling_firm', ['Medtronic', 'MiniMed']), 'recalling_firm:"medtronic+minimed"');
});

test('phraseClause strips anything that could inject search syntax', () => {
  assert.equal(phraseClause('code_info', ['ab"c', 'd)+OR+e', '--']), 'code_info:"abc+dore"');
  assert.equal(phraseClause('code_info', ['"', '+']), '');
  assert.equal(phraseClause('code_info', []), '');
});

test('buildFirmRecallsUrl searches the firm inside the date window, newest first', () => {
  assert.equal(
    buildFirmRecallsUrl(['icu', 'medical'], '20251114', '20261114'),
    `${OPENFDA_BASE_URL}?search=recalling_firm:"icu+medical"+AND+report_date:[20251114+TO+20261114]&sort=report_date:desc&limit=${MAX_RECALLS_PER_QUERY}`,
  );
});

test('buildFirmRecallsUrl returns null when there are no usable words', () => {
  assert.equal(buildFirmRecallsUrl([], '20251114', '20261114'), null);
  assert.equal(buildFirmRecallsUrl(['---'], '20251114', '20261114'), null);
});

test('buildFirmRecallsUrl clamps the limit to the allowed maximum', () => {
  assert.ok(buildFirmRecallsUrl(['a1'], '20251114', '20261114', 5000).endsWith(`limit=${MAX_RECALLS_PER_QUERY}`));
  assert.ok(buildFirmRecallsUrl(['a1'], '20251114', '20261114', 7).endsWith('limit=7'));
});

test('buildModelRecallsUrl ORs every model over product text and code info', () => {
  const url = buildModelRecallsUrl([['aisys', 'cs2'], ['n15']], '20251114', '20261114');
  assert.equal(
    url,
    `${OPENFDA_BASE_URL}?search=(product_description:"aisys+cs2"+OR+code_info:"aisys+cs2"+OR+product_description:"n15"+OR+code_info:"n15")+AND+report_date:[20251114+TO+20261114]&sort=report_date:desc&limit=${MAX_RECALLS_PER_QUERY}`,
  );
});

test('buildModelRecallsUrl skips unusable models and returns null if none are left', () => {
  assert.equal(buildModelRecallsUrl([[], ['---']], '20251114', '20261114'), null);
  assert.ok(buildModelRecallsUrl([[], ['n15']], '20251114', '20261114').includes('"n15"'));
});

// --- Full-text parsing ---------------------------------------------------------------------------

test('parseRecallForMatching keeps the FULL product and code text', () => {
  const longCodes = Array.from({ length: 500 }, (_, i) => `SN${1000 + i}`).join(' ');
  const recall = parseRecallForMatching({
    recall_number: 'Z-1-2027',
    recalling_firm: 'Acme, Inc.',
    product_description: 'Acme   pump\nmodel X',
    code_info: longCodes,
    classification: 'Class II',
    report_date: '20261104',
  });
  assert.equal(recall.recallNumber, 'Z-1-2027');
  assert.equal(recall.recallClass, 'II');
  assert.equal(recall.productText, 'Acme pump model X');
  assert.equal(recall.codeText, longCodes); // not truncated, unlike recall.codeInfo
  assert.ok(recall.codeInfo.length < longCodes.length);
});

test('parseRecallForMatching returns null for unidentifiable records', () => {
  assert.equal(parseRecallForMatching({ recalling_firm: 'X' }), null);
  assert.equal(parseRecallForMatching(null), null);
});

// --- Planning queries -----------------------------------------------------------------------------

test('planRecallQueries makes one firm query per distinct maker, ignoring suffixes and case', () => {
  const urls = planRecallQueries(
    [device('a', 'ICU Medical', 'M-1000'), device('b', 'icu medical, Inc.', 'M-2000'), device('c', 'Masimo', 'M-3000')],
    NOW,
  );
  const firmUrls = urls.filter((u) => u.includes('recalling_firm'));
  assert.equal(firmUrls.length, 2);
  assert.ok(firmUrls.some((u) => u.includes('recalling_firm:"icu+medical"')));
  assert.ok(firmUrls.some((u) => u.includes('recalling_firm:"masimo"')));
});

test('planRecallQueries uses the look-back window ending today', () => {
  const [first] = planRecallQueries([device('a', 'Masimo', 'M-1000')], NOW);
  assert.equal(LOOKBACK_DAYS, 365);
  assert.ok(first.includes('report_date:[20251114+TO+20261114]'));
});

test('planRecallQueries groups models into small queries and de-duplicates them', () => {
  const devices = Array.from({ length: MODELS_PER_QUERY + 2 }, (_, i) => device(`d${i}`, 'Masimo', `MODEL-${i}00`));
  devices.push(device('dup', 'Masimo', 'model-000')); // same model as d0, different case
  const modelUrls = planRecallQueries(devices, NOW).filter((u) => u.includes('product_description'));
  assert.equal(modelUrls.length, 2); // 7 distinct models in groups of 5
  assert.equal((modelUrls[0].match(/product_description/g) || []).length, MODELS_PER_QUERY);
});

test('planRecallQueries leaves out models too short to search for', () => {
  const urls = planRecallQueries([device('a', 'Masimo', 'A1')], NOW);
  assert.equal(urls.filter((u) => u.includes('product_description')).length, 0);
  assert.equal(urls.filter((u) => u.includes('recalling_firm')).length, 1);
});

test('planRecallQueries returns nothing for an empty hospital', () => {
  assert.deepEqual(planRecallQueries([], NOW), []);
});

// --- Fetching and merging --------------------------------------------------------------------------

const rawRecall = (number, extra = {}) => ({
  recall_number: number,
  recalling_firm: 'Masimo Corporation',
  product_description: 'Masimo pulse oximeter',
  code_info: 'Serial 123456',
  classification: 'Class II',
  report_date: '20261001',
  ...extra,
});

test('findRecallsForDevices merges results from every query without duplicates', async () => {
  const devices = [device('a', 'Masimo', 'M-1000'), device('b', 'Philips', 'P-2000')];
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    return { results: [rawRecall('Z-1'), rawRecall(url.includes('philips') ? 'Z-2' : 'Z-3')] };
  };
  const { recalls, queryCount, failedQueries } = await findRecallsForDevices(devices, fetchJson, NOW);
  assert.equal(queryCount, calls.length);
  assert.equal(failedQueries, 0);
  assert.deepEqual(recalls.map((r) => r.recallNumber).sort(), ['Z-1', 'Z-2', 'Z-3']);
});

test('findRecallsForDevices keeps full text for matching', async () => {
  const { recalls } = await findRecallsForDevices([device('a', 'Masimo', 'M-1000')], async () => ({ results: [rawRecall('Z-1')] }), NOW);
  assert.equal(recalls[0].codeText, 'Serial 123456');
  assert.equal(recalls[0].productText, 'Masimo pulse oximeter');
});

test('findRecallsForDevices survives a failed query and counts it', async () => {
  const devices = [device('a', 'Masimo', 'M-1000'), device('b', 'Philips', 'P-2000')];
  const fetchJson = async (url) => {
    if (url.includes('philips')) throw new Error('boom');
    return { results: [rawRecall('Z-1')] };
  };
  const { recalls, failedQueries } = await findRecallsForDevices(devices, fetchJson, NOW);
  assert.ok(failedQueries >= 1);
  assert.deepEqual(recalls.map((r) => r.recallNumber), ['Z-1']);
});

test('findRecallsForDevices skips malformed answers and unidentifiable records', async () => {
  const answers = [{ results: [{ recalling_firm: 'no number' }, rawRecall('Z-1')] }, null, { error: 'x' }, { results: 'nope' }];
  let i = 0;
  const { recalls, failedQueries } = await findRecallsForDevices(
    [device('a', 'Masimo', 'M-1000')],
    async () => answers[i++ % answers.length],
    NOW,
  );
  assert.deepEqual(recalls.map((r) => r.recallNumber), ['Z-1']);
  assert.equal(failedQueries, 0);
});

test('findRecallsForDevices does no work for an empty hospital', async () => {
  let called = false;
  const out = await findRecallsForDevices([], async () => { called = true; return { results: [] }; }, NOW);
  assert.equal(called, false);
  assert.deepEqual(out, { recalls: [], queryCount: 0, failedQueries: 0 });
});
