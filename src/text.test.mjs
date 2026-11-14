import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, compact, containsPhrase } from './text.js';

test('tokenize lower-cases and splits on every non-alphanumeric character', () => {
  assert.deepEqual(tokenize('MMT-1885CLW/00763, NG315H.'), ['mmt', '1885clw', '00763', 'ng315h']);
});

test('tokenize gives an empty list for non-strings and empty text', () => {
  assert.deepEqual(tokenize(undefined), []);
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize(42), []);
  assert.deepEqual(tokenize('  -- // '), []);
});

test('compact removes separators so identifier length can be judged', () => {
  assert.equal(compact('4-000-0080'), '40000080');
  assert.equal(compact('N 15'), 'n15');
  assert.equal(compact(undefined), '');
});

test('containsPhrase finds words in order as whole words', () => {
  assert.equal(containsPhrase('Aisys CS2 with Et Control', 'aisys cs2'), true);
  assert.equal(containsPhrase('Model: N12/N15/N17', 'N15'), true);
});

test('containsPhrase does not match inside a longer word', () => {
  assert.equal(containsPhrase('Model N150', 'N15'), false);
  assert.equal(containsPhrase('serial 148421', '4842'), false);
});

test('containsPhrase needs the words next to each other and in order', () => {
  assert.equal(containsPhrase('cs2 aisys', 'aisys cs2'), false);
  assert.equal(containsPhrase('aisys big cs2', 'aisys cs2'), false);
});

test('containsPhrase handles empty needles, short haystacks and pre-tokenized input', () => {
  assert.equal(containsPhrase('anything', ''), false);
  assert.equal(containsPhrase('', 'x'), false);
  assert.equal(containsPhrase('one', 'one two'), false);
  assert.equal(containsPhrase(['a', 'b', 'c'], ['b', 'c']), true);
});
