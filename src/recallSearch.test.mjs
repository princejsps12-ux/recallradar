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
  buildUdiRecallsUrl,
  withSkip,
  withApiKey,
  parseRecallForMatching,
} from './openfda.js';
import {
  LOOKBACK_DAYS,
  MODELS_PER_QUERY,
  UDIS_PER_QUERY,
  MAX_PAGES_PER_QUERY,
  MAX_CONCURRENT_REQUESTS,
  SEARCH_LIMIT_PER_QUERY,
  SEARCH_DEADLINE_MS,
  planRecallQueries,
  findRecallsForDevices,
  buildRecallDetails,
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

test('a maker that belongs to a company family is also searched under the family\'s main name, once, and other makers are not', () => {
  const firmQueries = (devices) => planRecallQueries(devices, NOW).filter((url) => url.includes('recalling_firm'));
  const hillRom = firmQueries([device('a', 'Hill-Rom', 'P7900B000001')]);
  assert.equal(hillRom.length, 2, 'Hill-Rom as written, and Baxter');
  assert.ok(hillRom.some((url) => /recalling_firm.*baxter/i.test(decodeURIComponent(url))), 'Baxter is searched');
  // Several makers of one family add the main name once, and a maker already written as the main name adds nothing.
  const family = firmQueries([device('a', 'Hill-Rom', 'P7900B000001'), device('b', 'Baxter Healthcare', '35700BAX2'), device('c', 'Welch Allyn', 'ABC-123')]);
  assert.equal(family.length, 4, 'hill rom, baxter healthcare, welch allyn, and "baxter" once');
  assert.equal(firmQueries([device('a', 'Baxter', '35700BAX2')]).length, 1);
  assert.equal(firmQueries([device('a', 'Acme Medical', 'AC-100')]).length, 1, 'a maker with no family: one query, as before');
});

test('planRecallQueries uses the look-back window ending today', () => {
  const [first] = planRecallQueries([device('a', 'Masimo', 'M-1000')], NOW);
  assert.equal(LOOKBACK_DAYS, 3 * 365, 'three years: recalls stay open that long');
  assert.ok(first.includes(`report_date:[${daysAgoYmd(NOW, LOOKBACK_DAYS)}+TO+20261114]`));
  assert.equal(daysAgoYmd(NOW, LOOKBACK_DAYS), '20231115');
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
  const { recalls, queryCount, failedQueries } = await findRecallsForDevices(devices, fetchJson, { now: NOW });
  assert.equal(queryCount, calls.length);
  assert.equal(failedQueries, 0);
  assert.deepEqual(recalls.map((r) => r.recallNumber).sort(), ['Z-1', 'Z-2', 'Z-3']);
});

test('findRecallsForDevices keeps full text for matching', async () => {
  const { recalls } = await findRecallsForDevices([device('a', 'Masimo', 'M-1000')], async () => ({ results: [rawRecall('Z-1')] }), { now: NOW });
  assert.equal(recalls[0].codeText, 'Serial 123456');
  assert.equal(recalls[0].productText, 'Masimo pulse oximeter');
});

test('findRecallsForDevices survives a failed query and counts it', async () => {
  const devices = [device('a', 'Masimo', 'M-1000'), device('b', 'Philips', 'P-2000')];
  const fetchJson = async (url) => {
    if (url.includes('philips')) throw new Error('boom');
    return { results: [rawRecall('Z-1')] };
  };
  const { recalls, failedQueries } = await findRecallsForDevices(devices, fetchJson, { now: NOW });
  assert.ok(failedQueries >= 1);
  assert.deepEqual(recalls.map((r) => r.recallNumber), ['Z-1']);
});

test('findRecallsForDevices skips malformed answers and unidentifiable records', async () => {
  const answers = [{ results: [{ recalling_firm: 'no number' }, rawRecall('Z-1')] }, null, { error: 'x' }, { results: 'nope' }];
  let i = 0;
  const { recalls, failedQueries } = await findRecallsForDevices(
    [device('a', 'Masimo', 'M-1000')],
    async () => answers[i++ % answers.length],
    { now: NOW },
  );
  assert.deepEqual(recalls.map((r) => r.recallNumber), ['Z-1']);
  assert.equal(failedQueries, 0);
});

test('findRecallsForDevices does no work for an empty hospital', async () => {
  let called = false;
  const out = await findRecallsForDevices([], async () => { called = true; return { results: [] }; }, { now: NOW });
  assert.equal(called, false);
  assert.deepEqual(out, { recalls: [], queryCount: 0, failedQueries: 0, cappedQueries: 0 });
});

// --- Query size and the cap ----------------------------------------------------------------------------

test('queries ask for the newest SEARCH_LIMIT_PER_QUERY recalls by default', () => {
  assert.equal(SEARCH_LIMIT_PER_QUERY, 25);
  const urls = planRecallQueries([device('a', 'Masimo', 'M-1000')], NOW);
  assert.ok(urls.length >= 2);
  for (const url of urls) assert.ok(url.endsWith(`limit=${SEARCH_LIMIT_PER_QUERY}`), url);
});

test('planRecallQueries accepts a different limit', () => {
  for (const url of planRecallQueries([device('a', 'Masimo', 'M-1000')], NOW, 10)) {
    assert.ok(url.endsWith('limit=10'), url);
  }
});

test('findRecallsForDevices counts queries whose real total is larger than ALL their pages hold', async () => {
  const total = MAX_PAGES_PER_QUERY * SEARCH_LIMIT_PER_QUERY + 1; // one more than the pages can hold
  const answers = [
    { meta: { results: { total } }, results: [rawRecall('Z-1')] }, // capped
    { meta: { results: { total: 1 } }, results: [rawRecall('Z-2')] }, // complete
  ];
  let first = true;
  const { cappedQueries } = await findRecallsForDevices(
    [device('a', 'Masimo', 'M-1000')],
    async (url) => (url.includes('skip=') ? { results: [] } : answers[first ? ((first = false), 0) : 1]),
    { now: NOW },
  );
  assert.equal(cappedQueries, 1);
});

// --- Paging, UDI queries and the rate of requests --------------------------------------------------------------------

const page = (url) => Number((/skip=(\d+)/.exec(url) || [0, 0])[1]) / SEARCH_LIMIT_PER_QUERY;
const manyRecalls = (prefix, count) => Array.from({ length: count }, (_, i) => rawRecall(`${prefix}-${i}`));

test('a query with more matches than one answer holds is read page by page, and the pages are merged', async () => {
  const total = 60; // 25 + 25 + 10
  const seen = [];
  const out = await findRecallsForDevices([device('a', 'Masimo', 'xx')], async (url) => {
    seen.push(url);
    const n = page(url);
    return { meta: { results: { total } }, results: manyRecalls(`P${n}`, n === 2 ? 10 : SEARCH_LIMIT_PER_QUERY) };
  }, { now: NOW });
  const firstPages = seen.filter((url) => !url.includes('skip='));
  assert.equal(firstPages.length, 1, 'one firm query (the model is too short to search)');
  assert.deepEqual(seen.filter((url) => url.includes('skip=')).map((url) => /skip=(\d+)/.exec(url)[1]).sort(), ['25', '50']);
  assert.equal(out.recalls.length, 60);
  assert.equal(out.cappedQueries, 0, 'everything was read');
  assert.equal(out.queryCount, 3, 'the count includes the extra pages');
  assert.equal(out.failedQueries, 0);
});

test('paging stops at MAX_PAGES_PER_QUERY and says the query was capped', async () => {
  const seen = [];
  const out = await findRecallsForDevices([device('a', 'Masimo', 'xx')], async (url) => {
    seen.push(url);
    return { meta: { results: { total: 5000 } }, results: manyRecalls(`P${page(url)}`, SEARCH_LIMIT_PER_QUERY) };
  }, { now: NOW });
  assert.equal(seen.length, MAX_PAGES_PER_QUERY);
  assert.equal(out.recalls.length, MAX_PAGES_PER_QUERY * SEARCH_LIMIT_PER_QUERY);
  assert.equal(out.cappedQueries, 1);
});

test('a page that fails counts as a failed search and keeps the pages that came', async () => {
  const out = await findRecallsForDevices([device('a', 'Masimo', 'xx')], async (url) => {
    if (page(url) === 1) throw new Error('boom');
    return { meta: { results: { total: 60 } }, results: manyRecalls(`P${page(url)}`, SEARCH_LIMIT_PER_QUERY) };
  }, { now: NOW });
  assert.equal(out.failedQueries, 1);
  assert.equal(out.recalls.length, 50);
});

test('requests never run more than MAX_CONCURRENT_REQUESTS at a time', async () => {
  const devices = Array.from({ length: 30 }, (_, i) => device(`d${i}`, `Maker${i} Corp`, `m${i}`));
  let running = 0;
  let peak = 0;
  const out = await findRecallsForDevices(devices, async () => {
    running += 1;
    peak = Math.max(peak, running);
    await sleep(2);
    running -= 1;
    return { results: [] };
  }, { now: NOW });
  assert.ok(out.queryCount > MAX_CONCURRENT_REQUESTS, 'enough searches to need the limit');
  assert.equal(peak, MAX_CONCURRENT_REQUESTS);
  assert.equal(out.failedQueries, 0);
});

test('progress: the total grows when a query turns out to have more pages, and ends at N of N', async () => {
  const steps = [];
  await findRecallsForDevices([device('a', 'Masimo', 'xx')], async (url) => ({ meta: { results: { total: 60 } }, results: manyRecalls(`P${page(url)}`, SEARCH_LIMIT_PER_QUERY) }), {
    now: NOW,
    onProgress: (done, total) => steps.push([done, total]),
  });
  assert.deepEqual(steps[0], [0, 1]);
  assert.deepEqual(steps[steps.length - 1], [3, 3]);
  assert.ok(steps.some(([, total]) => total === 3));
});

test('a device with a UDI-DI is also searched by it, in every written form, five DIs to a query', () => {
  const withUdi = (id, udiDi) => ({ ...device(id, 'Acme', 'xx'), udiDi });
  const urls = planRecallQueries([withUdi('a', '00848838001796'), withUdi('b', '00884838102842')], NOW);
  const udiUrl = urls.find((url) => url.includes('code_info:%2200848838001796') || url.includes('code_info:"00848838001796"'));
  assert.ok(udiUrl, 'a UDI query exists');
  for (const form of ['00848838001796', '0848838001796', '848838001796', '00884838102842']) assert.ok(udiUrl.includes(`code_info:"${form}"`), form);
  const many = Array.from({ length: UDIS_PER_QUERY + 1 }, (_, i) => withUdi(`d${i}`, ['10889942499953', '05030267044528', '00661392048157', '00885825017231', '00195278010797', '09421901970369'][i]));
  const udiQueries = planRecallQueries(many, NOW).filter((url) => url.includes('code_info:"10889942499953"') || url.includes('code_info:"09421901970369"'));
  assert.equal(udiQueries.length, 2, 'six DIs are two queries');
  assert.equal(planRecallQueries([device('plain', 'Acme', 'xx')], NOW).filter((url) => url.includes('code_info:"0')).length, 0, 'no DI, no UDI query');
});

test('a device whose UDI-DI is not a GTIN adds no query', () => {
  assert.equal(planRecallQueries([{ ...device('a', 'Acme', 'xx'), udiDi: 'not a gtin' }], NOW).length, 1);
});

test('buildUdiRecallsUrl, withSkip and withApiKey', () => {
  const url = buildUdiRecallsUrl(['00848838001796'], '20231115', '20261114');
  assert.ok(url.startsWith(`${OPENFDA_BASE_URL}?search=(`));
  assert.ok(url.includes('+AND+report_date:[20231115+TO+20261114]'));
  assert.equal(buildUdiRecallsUrl(['nonsense'], '20231115', '20261114'), null);
  assert.equal(withSkip(url, 0), url);
  assert.equal(withSkip(url, 50), `${url}&skip=50`);
  const key = 'abcdefghijklmnopqrstuvwxyz0123456789ABCD';
  assert.equal(withApiKey(url, key), `${url}&api_key=${key}`);
  for (const bad of [undefined, '', 'short', 'has spaces in it and more than twenty characters', 'x&search=other_field:evil_value_goes_here']) assert.equal(withApiKey(url, bad), url, String(bad));
});

test('parseRecallForMatching reads more_code_info too, where the FDA put the rest of the numbers', () => {
  const recall = parseRecallForMatching({ recall_number: 'Z-1', recalling_firm: 'Acme', product_description: 'p', code_info: 'Serial Numbers: 1, 2', more_code_info: 'UDI-DI 00848838001796' });
  assert.equal(recall.codeText, 'Serial Numbers: 1, 2 UDI-DI 00848838001796');
  assert.equal(parseRecallForMatching({ recall_number: 'Z-2', recalling_firm: 'Acme', product_description: 'p', code_info: 'x' }).codeText, 'x');
});

test('a query with no meta, or an empty answer, is not counted as capped', async () => {
  const answers = [{ results: [rawRecall('Z-1')] }, { results: [] }, { meta: {}, results: [] }];
  let i = 0;
  const { cappedQueries } = await findRecallsForDevices(
    [device('a', 'Masimo', 'M-1000')],
    async () => answers[i++ % answers.length],
    { now: NOW },
  );
  assert.equal(cappedQueries, 0);
});

// --- Deadline ----------------------------------------------------------------------------------------------

const sleep = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

test('the deadline is 240 seconds, 60 s inside the 300 s limit of the background function', () => {
  assert.equal(SEARCH_DEADLINE_MS, 240000);
});

test('a search still running at the deadline counts as failed; the others are kept', async () => {
  const devices = [device('a', 'Masimo', 'M-1000'), device('b', 'Philips', 'P-2000')];
  const fetchJson = (url) =>
    url.includes('philips') ? sleep(300, { results: [rawRecall('Z-SLOW')] }) : Promise.resolve({ results: [rawRecall('Z-FAST')] });
  const { recalls, failedQueries } = await findRecallsForDevices(devices, fetchJson, { now: NOW, limit: 25, deadlineMs: 50 });
  assert.deepEqual(recalls.map((r) => r.recallNumber), ['Z-FAST']);
  assert.ok(failedQueries >= 1);
});

test('searches that finish before the deadline are unaffected by it', async () => {
  const fetchJson = () => sleep(10, { results: [rawRecall('Z-1')] });
  const { recalls, failedQueries } = await findRecallsForDevices([device('a', 'Masimo', 'M-1000')], fetchJson, { now: NOW, limit: 25, deadlineMs: 1000 });
  assert.equal(failedQueries, 0);
  assert.deepEqual(recalls.map((r) => r.recallNumber), ['Z-1']);
});

test('when every search is too slow the result is empty and all are counted as failed', async () => {
  const fetchJson = () => sleep(300, { results: [rawRecall('Z-1')] });
  const out = await findRecallsForDevices([device('a', 'Masimo', 'M-1000')], fetchJson, { now: NOW, limit: 25, deadlineMs: 30 });
  assert.deepEqual(out.recalls, []);
  assert.equal(out.failedQueries, out.queryCount);
});

// --- Progress ---------------------------------------------------------------------------------------------

test('onProgress reports 0 of N first, then one step per finished search, ending at N of N', async () => {
  const devices = [device('a', 'Masimo', 'M-1000'), device('b', 'Philips', 'P-2000')];
  const calls = [];
  const out = await findRecallsForDevices(devices, async () => ({ results: [] }), {
    now: NOW,
    onProgress: (done, total) => calls.push([done, total]),
  });
  const total = out.queryCount;
  assert.deepEqual(calls[0], [0, total]);
  assert.deepEqual(calls[calls.length - 1], [total, total]);
  assert.equal(calls.length, total + 1);
  assert.deepEqual(calls.map(([done]) => done), calls.map(([done]) => done).sort((a, b) => a - b));
});

test('failed and timed-out searches still count as finished for progress', async () => {
  const calls = [];
  const out = await findRecallsForDevices([device('a', 'Masimo', 'M-1000')], async () => { throw new Error('x'); }, {
    now: NOW,
    onProgress: (done, total) => calls.push([done, total]),
  });
  assert.deepEqual(calls[calls.length - 1], [out.queryCount, out.queryCount]);
});

test('a throwing progress callback does not break the check', async () => {
  const out = await findRecallsForDevices([device('a', 'Masimo', 'M-1000')], async () => ({ results: [rawRecall('Z-1')] }), {
    now: NOW,
    onProgress: () => { throw new Error('ui exploded'); },
  });
  assert.deepEqual(out.recalls.map((r) => r.recallNumber), ['Z-1']);
});

// --- Details saved with a check --------------------------------------------------------------------------------

test('parseRecallForMatching keeps status, initiation date and a capped reason', () => {
  const recall = parseRecallForMatching({
    recall_number: 'Z-1-2027',
    recalling_firm: 'Acme',
    status: 'Ongoing',
    recall_initiation_date: '20260917',
    reason_for_recall: 'x'.repeat(2000),
  });
  assert.equal(recall.status, 'Ongoing');
  assert.equal(recall.initiated, '2026-09-17');
  assert.ok(recall.reasonForRecall.length <= 500);
  assert.ok(recall.reasonForRecall.endsWith('…'));
});

test('parseRecallForMatching tolerates a record with none of those fields', () => {
  const recall = parseRecallForMatching({ recall_number: 'Z-2-2027' });
  assert.deepEqual([recall.status, recall.initiated, recall.reasonForRecall], ['', '', '']);
});

test('buildRecallDetails keeps one entry per exact or likely recall, and skips possible ones', () => {
  const recalls = [
    { recallNumber: 'Z-1', status: 'Ongoing', initiated: '2026-01-02', reasonForRecall: 'Leaks' },
    { recallNumber: 'Z-2', status: 'Terminated', initiated: '', reasonForRecall: '' },
    { recallNumber: 'Z-3', status: 'Ongoing', initiated: '', reasonForRecall: 'Weak match only' },
  ];
  const matches = [
    { recallNumber: 'Z-1', confidence: 'exact' },
    { recallNumber: 'Z-1', confidence: 'likely' }, // same recall, second device: still one entry
    { recallNumber: 'Z-2', confidence: 'likely' },
    { recallNumber: 'Z-3', confidence: 'possible' },
    { recallNumber: 'Z-9', confidence: 'exact' }, // recall not fetched: skipped, not a crash
  ];
  assert.deepEqual(buildRecallDetails(recalls, matches), {
    'Z-1': { status: 'Ongoing', initiated: '2026-01-02', reason: 'Leaks' },
    'Z-2': { status: 'Terminated', initiated: '', reason: '' },
  });
});

test('buildRecallDetails of nothing is empty', () => {
  assert.deepEqual(buildRecallDetails([], []), {});
});

test('withTimeout fails a request that stalls, passes one that answers, and clears its timer', async () => {
  const { withTimeout } = await import('./openfda.js');
  await assert.rejects(() => withTimeout(() => new Promise(() => {}), 20), /did not answer/);
  assert.equal(await withTimeout(async () => 'ok', 1000), 'ok');
  await assert.rejects(() => withTimeout(async () => { throw new Error('boom'); }, 1000), /boom/);
});

test('a recall with millions of characters of serial numbers keeps only the first 150,000 of its code text', async () => {
  const { parseRecallForMatching, MAX_CODE_TEXT_LENGTH } = await import('./openfda.js');
  const raw = { recall_number: 'Z-1-2026', recalling_firm: 'Acme', product_description: 'Pump', code_info: `Serial Numbers: ${'1234567, '.repeat(900000)}`, classification: 'Class II', report_date: '20261101' };
  const recall = parseRecallForMatching(raw);
  assert.equal(recall.codeText.length <= MAX_CODE_TEXT_LENGTH, true);
  assert.match(recall.codeText, /^Serial Numbers: 1234567/);
});
