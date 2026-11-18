import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAKER_FAMILIES, familiesOf, sameMakerFamily, familySearchNames } from './makerAliases.js';
import { makerWords } from './matching.js';
import { tokenize } from './text.js';

test('every family has a name, a search name that is one of its names, and at least two names', () => {
  assert.ok(MAKER_FAMILIES.length >= 20);
  for (const family of MAKER_FAMILIES) {
    assert.ok(family.name && family.search && family.names.length >= 2, family.name);
    const names = family.names.map((n) => tokenize(n).join(' '));
    assert.ok(names.includes(tokenize(family.search).join(' ')), `${family.name}: the search name "${family.search}" is one of its names`);
    for (const name of family.names) assert.ok(tokenize(name).length >= 1, `${family.name}: "${name}" has words`);
  }
});

test('no name is on two lists: a maker is never in two families by one word', () => {
  const seen = new Map();
  for (const family of MAKER_FAMILIES) {
    for (const name of family.names) {
      const key = tokenize(name).join(' ');
      assert.ok(!seen.has(key), `"${key}" is in both "${seen.get(key)}" and "${family.name}"`);
      seen.set(key, family.name);
    }
  }
});

test('a maker belongs to a family when its words contain a name of the family as a run of whole words', () => {
  const families = (maker) => familiesOf(makerWords(maker)).map((i) => MAKER_FAMILIES[i].name);
  assert.deepEqual(families('Becton, Dickinson and Company'), ['BD (Becton Dickinson)']);
  assert.deepEqual(families('BD Medical - Diabetes Care'), ['BD (Becton Dickinson)']);
  assert.deepEqual(families('Datex-Ohmeda, Inc.'), ['GE HealthCare']);
  assert.deepEqual(families('Hill-Rom Holdings'), ['Baxter']);
  assert.deepEqual(families('Acme Medical'), []);
  assert.deepEqual(families(''), []);
  assert.deepEqual(families('Bardex'), [], 'whole words only');
});

test('names of three letters or fewer count only at the start of the maker', () => {
  const families = (maker) => familiesOf(makerWords(maker)).length;
  assert.equal(families('GE Healthcare'), 1);
  assert.equal(families('Acme GE Supply'), 0);
  assert.equal(families('3M Health Care'), 1);
  assert.equal(families('Wipro GE Healthcare'), 1, '"wipro ge" is a longer name on the list');
});

test('sameMakerFamily needs both makers to share a family; makers with no family never share one', () => {
  assert.equal(sameMakerFamily(makerWords('BD'), makerWords('CareFusion 303, Inc.')), true);
  assert.equal(sameMakerFamily(makerWords('BD'), makerWords('Baxter')), false);
  assert.equal(sameMakerFamily(makerWords('Acme'), makerWords('Acme Medical')), false);
  assert.equal(sameMakerFamily([], makerWords('BD')), false);
});

test('familySearchNames gives the main name of each family the maker is in, and nothing for other makers', () => {
  assert.deepEqual(familySearchNames(makerWords('BD')), [['becton', 'dickinson']]);
  assert.deepEqual(familySearchNames(makerWords('Hill-Rom')), [['baxter']]);
  assert.deepEqual(familySearchNames(makerWords('Acme Medical')), []);
});
