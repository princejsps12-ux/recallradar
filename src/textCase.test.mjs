import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceFirm, softCase, ago, formatDay } from '../static/ui/src/textCase.mjs';

test('firm names in capitals keep dotted abbreviations and short capitals', () => {
  assert.equal(niceFirm('PHILIPS MEDICAL SYSTEMS NEDERLAND B.V.'), 'Philips Medical Systems Nederland B.V.');
  assert.equal(niceFirm('GE MEDICAL SYSTEMS, USA'), 'GE Medical Systems, USA');
  assert.equal(niceFirm('3M COMPANY'), '3M Company');
  assert.equal(niceFirm('SIEMENS HEALTHINEERS AG'), 'Siemens Healthineers AG');
});

test('company endings and small words are cased the way people write them', () => {
  assert.equal(niceFirm('ABIOMED, INC.'), 'Abiomed, Inc.');
  assert.equal(niceFirm('ICU MEDICAL, INC.'), 'ICU Medical, Inc.');
  assert.equal(niceFirm('SMITH-NEPHEW INC'), 'Smith-Nephew Inc');
  assert.equal(niceFirm('DRAEGER MEDICAL GMBH'), 'Draeger Medical GmbH');
  assert.equal(niceFirm('ABBOTT LABORATORIES OF AMERICA'), 'Abbott Laboratories of America');
  assert.equal(niceFirm('JOHNSON & JOHNSON'), 'Johnson & Johnson');
});

test('firm names already in mixed case, or that are not text, are left alone', () => {
  assert.equal(niceFirm('Canon Medical System, USA, INC.'), 'Canon Medical System, USA, INC.');
  assert.equal(niceFirm('Abiomed, Inc.'), 'Abiomed, Inc.');
  assert.equal(niceFirm(''), '');
  assert.equal(niceFirm(undefined), undefined);
  assert.equal(niceFirm('GE'), 'GE'); // too short to be shouting
});

test('all-capital product text becomes a sentence, but part and model numbers stay exactly as written', () => {
  assert.equal(softCase('ALPHENIX INTERVENTIONAL ANGIOGRAPHY SYSTEM REF: INFX-8000F'), 'Alphenix interventional angiography system REF: INFX-8000F');
  assert.equal(softCase('CARELINK SMARTSYNC PROGRAMMER, MODEL 24970A'), 'Carelink smartsync programmer, model 24970A');
});

test('product text in mixed case, or short, is never changed', () => {
  const mixed = 'OmniaSecure Model 3930M, LEAD 3930M74 74 CM DF4 MR';
  assert.equal(softCase(mixed), mixed);
  assert.equal(softCase('PUMP 1'), 'PUMP 1');
  assert.equal(softCase(undefined), undefined);
  assert.equal(softCase(''), '');
});

test('ages read as "3 h ago" and an unreadable date is an empty string', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  assert.equal(ago('2026-11-16T11:59:30Z', now), 'just now');
  assert.equal(ago('2026-11-16T11:30:00Z', now), '30 min ago');
  assert.equal(ago('2026-11-16T09:00:00Z', now), '3 h ago');
  assert.equal(ago('2026-11-12T12:00:00Z', now), '4 days ago');
  assert.equal(ago('not a date', now), '');
  assert.equal(ago('2026-11-16T13:00:00Z', now), 'just now'); // a clock slightly ahead never shows a negative age
});

test('dates are always "4 Nov 2026", whatever the locale', () => {
  assert.equal(formatDay('2026-11-04'), '4 Nov 2026');
  assert.equal(formatDay('2026-09-18T10:00:00Z'), '18 Sep 2026');
  assert.equal(formatDay('soon'), 'soon');
  assert.equal(formatDay(undefined), '');
});

test('niceFirm fixes a company ending written in the wrong case, and nothing else in a mixed-case name', () => {
  assert.equal(niceFirm('Philips North America Llc'), 'Philips North America LLC');
  assert.equal(niceFirm('Acme Medical Gmbh'), 'Acme Medical GmbH');
  assert.equal(niceFirm('Acme, Llp.'), 'Acme, LLP.');
  assert.equal(niceFirm('Llc Holdings Inc'), 'Llc Holdings Inc', 'only an ending is touched');
  assert.equal(niceFirm('Abiomed, Inc.'), 'Abiomed, Inc.');
});
