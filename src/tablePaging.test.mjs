import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_SIZE, sortRows, pageCount, clampPage, pageOf, rangeOf } from '../static/hello-world/src/tablePaging.mjs';

const rows = (values) => values.map((v, i) => ({ v, id: i }));
const ids = (list) => list.map((r) => r.id);

test('sorting puts numbers before text and compares text the way people read it', () => {
  const out = sortRows(rows(['Z-10', 'Z-2', 'Z-1']), (r) => r.v);
  assert.deepEqual(out.map((r) => r.v), ['Z-1', 'Z-2', 'Z-10'], 'Z-2 before Z-10, not after');
  const mixed = sortRows(rows(['b', 3, 'a', 1]), (r) => r.v);
  assert.deepEqual(mixed.map((r) => r.v), [1, 3, 'a', 'b']);
});

test('descending order reverses the values but equal values keep their saved order', () => {
  const list = rows([2, 1, 2, 1]);
  assert.deepEqual(ids(sortRows(list, (r) => r.v, 'ASC')), [1, 3, 0, 2]);
  assert.deepEqual(ids(sortRows(list, (r) => r.v, 'DESC')), [0, 2, 1, 3], 'ties are not reversed');
});

test('sorting does not change the list it was given', () => {
  const list = rows([3, 1, 2]);
  sortRows(list, (r) => r.v);
  assert.deepEqual(list.map((r) => r.v), [3, 1, 2]);
});

test('text order ignores upper and lower case', () => {
  const out = sortRows(rows(['beta', 'Alpha', 'alpha']), (r) => r.v);
  assert.deepEqual(out.map((r) => r.v.toLowerCase()), ['alpha', 'alpha', 'beta']);
});

test('page counts: at least one page, a partial last page counts', () => {
  assert.equal(PAGE_SIZE, 10);
  assert.equal(pageCount(0), 1);
  assert.equal(pageCount(10), 1);
  assert.equal(pageCount(11), 2);
  assert.equal(pageCount(35), 4);
});

test('a page number is always one that exists', () => {
  assert.equal(clampPage(1, 5), 1);
  assert.equal(clampPage(9, 25), 3, 'after filtering there are fewer pages: go to the last');
  assert.equal(clampPage(0, 25), 1);
  assert.equal(clampPage(-4, 25), 1);
  assert.equal(clampPage(NaN, 25), 1);
  assert.equal(clampPage(2.7, 25), 2);
});

test('a page holds the right slice, and the last page the remainder', () => {
  const all = Array.from({ length: 23 }, (_, i) => i);
  assert.deepEqual(pageOf(all, 1), all.slice(0, 10));
  assert.deepEqual(pageOf(all, 2), all.slice(10, 20));
  assert.deepEqual(pageOf(all, 3), [20, 21, 22]);
  assert.deepEqual(pageOf(all, 7), [20, 21, 22], 'a page past the end shows the last page, not nothing');
  assert.deepEqual(pageOf([], 1), []);
});

test('the range text counts rows from 1 and stops at the total', () => {
  assert.deepEqual(rangeOf(1, 23), { from: 1, to: 10 });
  assert.deepEqual(rangeOf(3, 23), { from: 21, to: 23 });
  assert.deepEqual(rangeOf(1, 4), { from: 1, to: 4 });
  assert.deepEqual(rangeOf(1, 0), { from: 0, to: 0 });
  assert.deepEqual(rangeOf(5, 23), { from: 21, to: 23 }, 'clamped like the page itself');
});
