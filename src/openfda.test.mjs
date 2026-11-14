import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRecallsUrl,
  cleanText,
  truncate,
  formatFdaDate,
  parseClass,
  parseRecall,
  parseRecalls,
  MAX_CODE_INFO_LENGTH,
  MAX_PRODUCT_LENGTH,
} from './openfda.js';

// A trimmed-down record shaped like a real openFDA /device/enforcement result.
const rawRecord = {
  recall_number: 'Z-0285-2027',
  recalling_firm: 'Medtronic, Inc.',
  product_description: 'OmniaSecure Model 3930M,    LEAD 3930M74 74 CM DF4 MR  3930M74',
  code_info: '3930M74 UDI-DI 00763000643430 Serial Nos. CDD401008V',
  classification: 'Class II',
  report_date: '20261104',
  status: 'Ongoing',
};

test('buildRecallsUrl sorts newest first and defaults to 20', () => {
  assert.equal(
    buildRecallsUrl(),
    'https://api.fda.gov/device/enforcement.json?sort=report_date:desc&limit=20',
  );
});

test('buildRecallsUrl clamps the limit and ignores junk', () => {
  assert.ok(buildRecallsUrl(500).endsWith('limit=100'));
  assert.ok(buildRecallsUrl(0).endsWith('limit=20'));
  assert.ok(buildRecallsUrl(-5).endsWith('limit=1'));
  assert.ok(buildRecallsUrl('abc').endsWith('limit=20'));
  assert.ok(buildRecallsUrl(7.9).endsWith('limit=7'));
});

test('cleanText collapses whitespace and handles non-strings', () => {
  assert.equal(cleanText('  a   b\n\tc  '), 'a b c');
  assert.equal(cleanText(undefined), '');
  assert.equal(cleanText(null), '');
  assert.equal(cleanText(42), '');
});

test('truncate leaves short text alone and shortens long text with an ellipsis', () => {
  assert.equal(truncate('short', 10), 'short');
  assert.equal(truncate('exactly10!', 10), 'exactly10!');
  const out = truncate('abcdefghijklmnop', 10);
  assert.equal(out.length, 10);
  assert.ok(out.endsWith('…'));
});

test('formatFdaDate converts YYYYMMDD to YYYY-MM-DD', () => {
  assert.equal(formatFdaDate('20261104'), '2026-11-04');
  assert.equal(formatFdaDate('20240229'), '2024-02-29'); // leap day
});

test('formatFdaDate rejects bad dates', () => {
  assert.equal(formatFdaDate('20261340'), '');
  assert.equal(formatFdaDate('20250229'), ''); // not a leap year
  assert.equal(formatFdaDate('2026-11-04'), '');
  assert.equal(formatFdaDate('2026110'), '');
  assert.equal(formatFdaDate(undefined), '');
  assert.equal(formatFdaDate(20261104), '');
});

test('parseClass extracts the roman numeral', () => {
  assert.equal(parseClass('Class I'), 'I');
  assert.equal(parseClass('Class II'), 'II');
  assert.equal(parseClass('class iii'), 'III');
  assert.equal(parseClass('  Class   II '), 'II');
});

test('parseClass keeps unexpected values and handles missing', () => {
  assert.equal(parseClass('Unclassified'), 'Unclassified');
  assert.equal(parseClass(undefined), '');
});

test('parseRecall maps and cleans a normal record', () => {
  assert.deepEqual(parseRecall(rawRecord), {
    recallNumber: 'Z-0285-2027',
    firm: 'Medtronic, Inc.',
    product: 'OmniaSecure Model 3930M, LEAD 3930M74 74 CM DF4 MR 3930M74',
    codeInfo: '3930M74 UDI-DI 00763000643430 Serial Nos. CDD401008V',
    recallClass: 'II',
    date: '2026-11-04',
  });
});

test('parseRecall truncates very long code_info', () => {
  const serials = Array.from({ length: 2000 }, (_, i) => `SN${i}`).join(' ');
  const recall = parseRecall({ ...rawRecord, code_info: serials });
  assert.equal(recall.codeInfo.length, MAX_CODE_INFO_LENGTH);
  assert.ok(recall.codeInfo.endsWith('…'));
});

test('parseRecall truncates very long product descriptions', () => {
  const recall = parseRecall({ ...rawRecord, product_description: 'word '.repeat(200) });
  assert.equal(recall.product.length, MAX_PRODUCT_LENGTH);
  assert.ok(recall.product.endsWith('…'));
});

test('parseRecall tolerates missing optional fields', () => {
  const recall = parseRecall({ recall_number: 'Z-1-2027' });
  assert.deepEqual(recall, {
    recallNumber: 'Z-1-2027',
    firm: '',
    product: '',
    codeInfo: '',
    recallClass: '',
    date: '',
  });
});

test('parseRecall returns null when there is no recall number or input is not an object', () => {
  assert.equal(parseRecall({ ...rawRecord, recall_number: '   ' }), null);
  assert.equal(parseRecall({ recalling_firm: 'X' }), null);
  assert.equal(parseRecall(null), null);
  assert.equal(parseRecall('nope'), null);
});

test('parseRecalls parses every valid record and keeps order', () => {
  const body = {
    meta: { results: { total: 2 } },
    results: [rawRecord, { ...rawRecord, recall_number: 'Z-0286-2027' }],
  };
  const recalls = parseRecalls(body);
  assert.deepEqual(
    recalls.map((r) => r.recallNumber),
    ['Z-0285-2027', 'Z-0286-2027'],
  );
});

test('parseRecalls drops unidentifiable records', () => {
  const recalls = parseRecalls({ results: [rawRecord, {}, null, { recall_number: '' }] });
  assert.equal(recalls.length, 1);
});

test('parseRecalls returns an empty list for missing or malformed bodies', () => {
  assert.deepEqual(parseRecalls(undefined), []);
  assert.deepEqual(parseRecalls(null), []);
  assert.deepEqual(parseRecalls({}), []);
  assert.deepEqual(parseRecalls({ results: 'nope' }), []);
  assert.deepEqual(parseRecalls({ error: { code: 'NOT_FOUND' } }), []);
});
