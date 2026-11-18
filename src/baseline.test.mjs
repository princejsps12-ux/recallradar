import test from 'node:test';
import assert from 'node:assert/strict';
import { keywordFlags, scoreFlags } from './baseline.js';

const recall = { firm: 'Acme Medical Inc', productText: 'Acme Infusion Pump Model P-100', codeText: 'Serial numbers 1000-2000' };

test('a keyword search flags a device by the maker\'s name', () => {
  assert.equal(keywordFlags({ manufacturer: 'ACME Medical', model: 'ZZZ-9' }, recall), true);
});
test('a keyword search flags a device by its model in the text', () => {
  assert.equal(keywordFlags({ manufacturer: 'Other Co', model: 'P-100' }, recall), true);
});
test('short words and short models match nothing', () => {
  assert.equal(keywordFlags({ manufacturer: 'Co of', model: 'P1' }, { ...recall, firm: 'Co of' }), false);
});
test('an unrelated device is not flagged', () => {
  assert.equal(keywordFlags({ manufacturer: 'Zeta Devices', model: 'Q-7' }, recall), false);
});
test('flags are scored against "needs a task", excluded rows left out', () => {
  const s = scoreFlags([
    { truth: 'affected', flagged: true },
    { truth: 'product-covered', flagged: false },
    { truth: 'related', flagged: true },
    { truth: 'unrelated', flagged: false },
    { truth: 'excluded', flagged: true },
  ]);
  assert.deepEqual([s.total, s.tp, s.flagged, s.actual, s.falsePositives, s.missed], [4, 1, 2, 2, 1, 1]);
  assert.equal(s.precision, 0.5);
  assert.equal(s.recall, 0.5);
});
