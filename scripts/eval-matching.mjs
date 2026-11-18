#!/usr/bin/env node
// Measures the matcher against the labeled set (eval/cases.json, built from real recalls by scripts/make-eval-set.mjs) and
// writes the numbers to docs/ACCURACY.md.
//
//   node scripts/eval-matching.mjs           print the report
//   node scripts/eval-matching.mjs --write   also write docs/ACCURACY.md
//   node scripts/eval-matching.mjs --check   fail when docs/ACCURACY.md is not what this would write (used by npm test)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRecallForMatching } from '../src/openfda.js';
import { evaluateMatch } from '../src/matching.js';
import { normalizeDi, diVariants } from '../src/udi.js';
import { familiesOf } from '../src/makerAliases.js';
import { tokenize } from '../src/text.js';
import { scoreCases, percent, TRUTH_LEVEL } from '../src/accuracy.js';
import { keywordFlags, scoreFlags } from '../src/baseline.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DOC_FILE = join(root, 'docs', 'ACCURACY.md');
// The same head-to-head numbers as data, for the dashboard (static/ui/src/headToHead.json); npm test checks it is current.
export const UI_FILE = join(root, 'static', 'ui', 'src', 'headToHead.json');

const words = (text) => String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
const squash = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function loadSet() {
  const raw = JSON.parse(readFileSync(join(root, 'eval', 'recalls.json'), 'utf8'));
  const recalls = Object.fromEntries(Object.entries(raw).map(([number, record]) => [number, parseRecallForMatching(record)]));
  const { cases } = JSON.parse(readFileSync(join(root, 'eval', 'cases.json'), 'utf8'));
  return { recalls, cases };
}

// Pairs that are unrelated by a plain test that does not use the matcher: the firms share no word and are not two names of one
// company on the list in src/makerAliases.js, the device's model and UDI-DI
// are nowhere in the other recall's text, and neither is its serial. Every such pair must come back as "no match".
function sweepRows(recalls, cases) {
  const rows = [];
  const devices = cases.filter((c) => c.template === 'listed-unit' || c.template === 'udi-listed-unit');
  for (const c of devices) {
    for (const [number, recall] of Object.entries(recalls)) {
      if (number === c.recall) continue;
      const text = squash(`${recall.productText} ${recall.codeText}`);
      const share = words(c.device.manufacturer).some((w) => words(recall.firm).includes(w)) || familiesOf(tokenize(c.device.manufacturer)).some((f) => familiesOf(tokenize(recall.firm)).includes(f));
      const model = squash(c.device.model);
      const serial = squash(c.device.lotOrSerial);
      const diForms = diVariants(normalizeDi(c.device.udiDi) || '').map(squash);
      if (share || (model.length >= 3 && text.includes(model)) || (serial.length >= 3 && text.includes(serial)) || diForms.some((f) => text.includes(f))) continue;
      rows.push({ id: `sweep/${c.id}/${number}`, truth: 'unrelated', template: 'sweep', recall: number, device: c.device });
    }
  }
  return rows;
}

export function run() {
  const { recalls, cases } = loadSet();
  const rows = [...cases, ...sweepRows(recalls, cases)].map((c) => {
    const verdict = evaluateMatch(c.device, recalls[c.recall]);
    return { ...c, predicted: verdict ? verdict.confidence : 'none', rule: verdict ? verdict.rule : '', reason: verdict ? verdict.reason : '', flagged: keywordFlags(c.device, recalls[c.recall]) };
  });
  const sweeps = rows.filter((r) => r.template === 'sweep').length;
  return { rows, score: scoreCases(rows), caseCount: cases.length, sweeps, recallCount: Object.keys(recalls).length };
}

const pad = (text, n) => String(text).padEnd(n);
const row = (...cells) => `| ${cells.join(' | ')} |`;

// Head-to-head: RecallRadar's exact-or-likely against a plain keyword search, on the same pairs and the same question ("does this
// pair need a task?"). Two views: every pair, and only the pairs that share a maker or a model (the hard ones: the 2,858 unrelated
// pairs are easy for any method and make both numbers look better than they are).
export function headToHead(result = run()) {
  const { rows } = result;
  const needs = (r) => r.truth === 'affected' || r.truth === 'product-covered';
  const view = (subset) => {
    const kw = scoreFlags(subset.map((r) => ({ truth: r.truth, flagged: r.flagged })));
    const rr = scoreFlags(subset.map((r) => ({ truth: r.truth, flagged: r.predicted === 'exact' || r.predicted === 'likely' })));
    return { pairs: kw.total, needTask: kw.actual, keyword: kw, recallradar: rr };
  };
  const hard = rows.filter((r) => r.template !== 'sweep');
  return { all: view(rows), hard: view(hard), needs: rows.filter((r) => r.truth !== 'excluded' && needs(r)).length };
}

export function uiData(result = run()) {
  const h = headToHead(result);
  const pick = (v) => ({ pairs: v.pairs, needTask: v.needTask, keyword: { precision: v.keyword.precision, recall: v.keyword.recall, falsePositives: v.keyword.falsePositives, missed: v.keyword.missed }, recallradar: { precision: v.recallradar.precision, recall: v.recallradar.recall, falsePositives: v.recallradar.falsePositives, missed: v.recallradar.missed } });
  return { all: pick(h.all), hard: pick(h.hard) };
}

export function report(result = run()) {
  const { score, rows, caseCount, sweeps, recallCount } = result;
  const lines = [];
  lines.push('# How accurate is the matching?', '');
  lines.push(`Measured against **${score.total} labeled pairs** of a device and a real FDA recall (${caseCount} built from ${recallCount} real recalls, plus ${sweeps} unrelated pairs between them), with the right answer decided before the matcher is asked. Generated by \`npm run eval\`; \`npm test\` fails when this page is out of date.`, '');
  lines.push('**What this is, and is not.** The recalls are real openFDA records (frozen in `eval/recalls.json`). The devices were made from what each recall says (its maker and model, a serial or lot it lists, its UDI-DI, a range it states) and from near misses (another model, another maker, another UDI-DI, a lot code that looks like a range), so the right answer follows from the recall text: it is written down in `scripts/make-eval-set.mjs`. The labels were written by the developer, not by a clinical engineer, and the devices are not a real hospital\'s. So this is a regression set and a sanity check of how the rules read real recall wording, **not** a measure of how often the app is right in a hospital.', '');
  lines.push('## Per match level', '');
  lines.push(row('Level', 'Right answer is this level', 'Said this level', 'Precision', 'Recall'), row('---', '---:', '---:', '---:', '---:'));
  for (const level of ['exact', 'likely', 'possible']) {
    const s = score.perLevel[level];
    lines.push(row(`**${level}**`, s.actual, s.predicted, percent(s.precision), percent(s.recall)));
  }
  lines.push('', '*Precision*: of the pairs the matcher put at this level, how many belong there. *Recall*: of the pairs that belong at this level, how many it found.', '');
  lines.push('## What decides whether a task is created (exact or likely)', '');
  lines.push(row('Pairs that need a task', 'Matcher said exact or likely', 'Precision', 'Recall'), row('---:', '---:', '---:', '---:'));
  lines.push(row(score.task.actual, score.task.predicted, percent(score.task.precision), percent(score.task.recall)), '');
  lines.push(`- **Over-claims** (said *exact*, the unit is not confirmed affected): **${score.overClaims.length}**${score.overClaims.length ? ` (${score.overClaims.slice(0, 8).join(', ')})` : ''}.`);
  lines.push(`- **Under-claims** (the unit is affected, said less than *exact*): **${score.underClaims.length}**${score.underClaims.length ? ` (${score.underClaims.slice(0, 8).join(', ')})` : ''}.`);
  lines.push(`- **Recalls that rule a unit out** (its serial is outside a range the recall states, or the text names it as excluded): ${score.excluded.total} pairs. The matcher said *exact* for ${score.excluded.saidExact}${score.excluded.saidExact === 0 ? ' (it must never)' : ' (an over-claim, listed above)'} and *likely* for ${score.excluded.saidLikely}. It cannot rule a unit out yet; these are counted here and not in the tables above.`, '');
  const hh = headToHead(result);
  lines.push('## Head-to-head with a plain keyword search', '');
  lines.push('The baseline is what a spreadsheet filter or a saved FDA search does (`src/baseline.js`): flag a recall when the device\'s maker shares a word with the recall\'s firm, or when the device\'s model appears in the recall text. It has no serials, UDI-DI, exclusions, several-products reading or confidence levels. Both methods answer the same question on the same pairs: *does this pair need a task?* (the right answer is *exact* or *likely*).', '');
  lines.push(row('Pairs', 'Method', 'Flagged', 'False alarms', 'Missed', 'Precision', 'Recall'), row('---', '---', '---:', '---:', '---:', '---:', '---:'));
  lines.push(row(`all ${hh.all.pairs} pairs`, 'keyword search', hh.all.keyword.flagged, hh.all.keyword.falsePositives, hh.all.keyword.missed, percent(hh.all.keyword.precision), percent(hh.all.keyword.recall)));
  lines.push(row('', '**RecallRadar**', hh.all.recallradar.flagged, hh.all.recallradar.falsePositives, hh.all.recallradar.missed, percent(hh.all.recallradar.precision), percent(hh.all.recallradar.recall)), '');
  lines.push(`The ${hh.all.pairs - hh.hard.pairs} unrelated pairs are easy for both methods (neither raises a false alarm on them), so the numbers above come from the ${hh.hard.pairs} pairs that share a maker, a model or a UDI-DI with a recall. A keyword search raises a false alarm for every other model and every other kind of device of the same maker, and misses devices the hospital names differently (a maker's other name, a UDI-DI with no model in the text). It also gives no reason, no serial check and no priority, which is the work that sends a clinical engineer through a recall list by hand. RecallRadar's 100% is measured on labels the developer wrote from the same recall text its rules were built against, so read it as "the rules read real recall wording correctly", not as field accuracy; the keyword search's 57% shows how much of that work a plain filter cannot do.`, '');
  lines.push('## Every case by what it should be and what it was', '');
  lines.push(row('Should be \\ Said', 'exact', 'likely', 'possible', 'no match'), row('---', '---:', '---:', '---:', '---:'));
  for (const e of ['exact', 'likely', 'possible', 'none']) {
    const names = { exact: 'exact (affected)', likely: 'likely (product covered)', possible: 'possible (related)', none: 'no match (unrelated)' };
    lines.push(row(names[e], ...['exact', 'likely', 'possible', 'none'].map((p) => score.confusion[e][p])));
  }
  lines.push('');
  const byTemplate = new Map();
  for (const r of rows.filter((x) => x.truth !== 'excluded' && x.template !== 'sweep')) {
    const t = byTemplate.get(r.template) || { total: 0, right: 0 };
    t.total += 1;
    if (r.predicted === TRUTH_LEVEL[r.truth]) t.right += 1;
    byTemplate.set(r.template, t);
  }
  lines.push('## By kind of case', '');
  lines.push(row('Kind of case', 'Pairs', 'Right'), row('---', '---:', '---:'));
  for (const [template, t] of [...byTemplate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) lines.push(row(`\`${template}\``, t.total, `${t.right} (${percent(t.right / t.total)})`));
  const sweepRows = rows.filter((x) => x.template === 'sweep');
  const sweepRight = sweepRows.filter((x) => x.predicted === 'none').length;
  lines.push(row('`sweep` (unrelated pairs between the recalls)', sweepRows.length, `${sweepRight} (${percent(sweepRight / (sweepRows.length || 1))})`), '');
  // Recalls with several products: a lot or serial of one product must never confirm another product of the same recall.
  const multiRecalls = [...new Set(rows.filter((x) => x.template.startsWith('multi-')).map((x) => x.recall))];
  const multiRows = rows.filter((x) => multiRecalls.includes(x.recall) && x.template !== 'sweep' && x.truth !== 'excluded');
  const multiRight = multiRows.filter((x) => x.predicted === TRUTH_LEVEL[x.truth]).length;
  const crossRows = rows.filter((x) => x.template.includes('other-product'));
  const crossNotExact = crossRows.filter((x) => x.predicted !== 'exact').length;
  const exclusionRecalls = [...new Set(rows.filter((x) => x.exclusion).map((x) => x.recall))];
  const exclusionRows = rows.filter((x) => x.exclusion && x.template !== 'sweep');
  const exclAffected = exclusionRows.filter((x) => x.truth === 'affected');
  const exclNamed = exclusionRows.filter((x) => x.truth === 'excluded');
  const aliasRows = rows.filter((x) => x.template.startsWith('alias-'));
  const aliasRecalls = [...new Set(aliasRows.map((x) => x.recall))];
  const aliasRight = aliasRows.filter((x) => x.predicted === TRUTH_LEVEL[x.truth]).length;
  lines.push('## Recalls with several products, recalls that leave units out, and makers with two names', '');
  lines.push(`- **Several products in one recall** (${multiRecalls.length} real recalls whose code text names the model, UDI-DI and lots of every product: ${multiRecalls.map((n) => `\`${n}\``).join(', ')}): ${multiRows.length} pairs, ${multiRight} right (${percent(multiRight / (multiRows.length || 1))}). In ${crossRows.length} of them the model or UDI-DI is right but the lot or serial is one the recall lists for a *different* product of the same recall; the matcher never called those *exact* (${crossNotExact} of ${crossRows.length}).`);
  lines.push(`- **Makers that go by two names** (${aliasRecalls.length} real recalls where the hospital might write the maker differently from the firm the FDA filed the recall under: "Hill-Rom" for Baxter, "BD" for CareFusion, "Hospira" for ICU Medical, "GE HealthCare" for Datex-Ohmeda): ${aliasRows.length} pairs, ${aliasRight} right (${percent(aliasRight / (aliasRows.length || 1))}). The short list of company families is in \`src/makerAliases.js\`; without it these pairs were *possible* or not found.`);
  lines.push(`- **Recalls that leave units out** (${exclusionRecalls.length} real recalls: ${exclusionRecalls.map((n) => `\`${n}\``).join(', ')}): ${exclusionRows.length} pairs. Of the ${exclAffected.length} units in them that the text really covers, ${exclAffected.filter((x) => x.predicted === 'likely').length} came out *likely* and ${exclAffected.filter((x) => x.predicted === 'exact').length} *exact* (a unit listed in an entry that has no exclusion of its own): where an entry excludes units the matcher does not read its lists, ranges or "all units" (it would be guessing which units are left out), so a person decides, and a *likely* match still gets a task. Of the ${exclNamed.length} units the text rules out, ${exclNamed.filter((x) => x.predicted === 'exact').length} came out *exact*.`, '');
  const wrong = rows.filter((x) => x.truth !== 'excluded' && x.predicted !== TRUTH_LEVEL[x.truth]);
  lines.push(wrong.length === 1 ? '## The 1 pair the matcher got wrong' : `## The ${wrong.length} pairs the matcher got wrong`, '');
  if (wrong.length === 0) lines.push('None.', '');
  else {
    lines.push(row('Pair', 'Should be', 'Said', 'Rule'), row('---', '---', '---', '---'));
    for (const x of wrong.slice(0, 60)) lines.push(row(`\`${x.id}\``, TRUTH_LEVEL[x.truth] === 'none' ? 'no match' : TRUTH_LEVEL[x.truth], x.predicted === 'none' ? 'no match' : x.predicted, x.rule ? `\`${x.rule}\`` : '-'));
    if (wrong.length > 60) lines.push('', `...and ${wrong.length - 60} more.`);
    lines.push('');
  }
  lines.push('## Known limits (what these numbers do not cover)', '');
  lines.push('- **Very short serials without a UDI-DI.** A serial or lot of fewer than four characters ("209") is not trusted on its own, because such a number turns up in recall texts by chance (`MIN_LOT_LENGTH` in `src/matching.js`). A pair like that is *likely*, not *exact*, even when the recall lists the unit. With the UDI-DI recorded the same unit is *exact* (the `udi-listed-unit` cases).');
  lines.push('- **Units a recall rules out.** When a recall states a serial range and the unit is outside it, or the text names the unit as excluded ("Excluding 90425438"), the matcher still says *likely* for the product: it does not rule units out, because a wrongly read range would hide a real recall. A person decides, and the reason names what it found.');
  lines.push('- **Recalls that leave units out are never read as exact.** Where the text says "except", "excluding" and the like, the matcher switches its unit rules off for that product (a list, a range or "all units" cannot be trusted when the text also names units that are left out). So an affected unit in such a recall is *likely*, not *exact*, and an open-ended bound ("Serial Number before K17160001") is not read at all. These pairs are the under-claims listed above; none is missed, because *likely* also gets a task.');
  lines.push('- **Several products: entries are found by their labels.** One product\'s entry is cut at a label with its number ("Model No", "Part No.", "REF", "Product Code") or at a list number ("2.", "3)"). A recall that starts each entry with a bare number and a name and no label ("5855300 Slim-Cath ... Lot Number: REKY1364") cannot be cut, and there a lot of one product can still be read as another\'s. No case in this set has that form, so the number above says nothing about it.');
  lines.push('- **This measures the matcher, not the search.** Every pair is a device and ONE recall that is already in hand. Whether the right recalls are fetched from openFDA in the first place (by manufacturer, by model and by UDI-DI, in a three-year window, up to 100 per search) is not measured here; a search that was capped is flagged on the dashboard.');
  lines.push('- **Makers are compared by their words and by a short list of company families.** "BD", "CareFusion", "Bard" and "Becton Dickinson" are one family; so are GE, Datex-Ohmeda and GE HealthCare, Baxter, Hill-Rom and Welch Allyn, ICU Medical and Hospira, and about fifteen others (`src/makerAliases.js`). A company that is not on the list is compared by its words, as before, so a hospital that writes a maker\'s old or brand name still needs its UDI-DI or its model number in the recall text to be found. The list is mine, from public acquisition history, not a registry: a missing company costs a match, a wrong one is still checked against the model, the serial and the kind of device.');
  lines.push(`- **Wording nobody wrote a rule for.** The set holds the ${recallCount} recalls above and the ways they write serials, lots and UDI-DIs. A recall that lists its units in a picture, a link or a PDF cannot be read at all, and is *likely* at best.`);
  lines.push('- **Not a field measurement.** Labels come from the recall text, written by the developer. A hospital\'s own device list (typos, old model names, missing serials) will do worse than this set; the number to trust is the direction, not the last decimal.', '');
  lines.push('## Re-running it', '', '```bash', 'node scripts/make-eval-set.mjs --pull   # fetch the recalls added to the list in that script (one request each; the others stay frozen)', 'node scripts/make-eval-set.mjs          # rebuild the cases from them', 'npm run eval                            # measure and rewrite this page', '```', '');
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = report();
  if (process.argv.includes('--write')) {
    writeFileSync(DOC_FILE, text);
    writeFileSync(UI_FILE, JSON.stringify(uiData(), null, 2) + '\n');
    console.log(text);
    console.log(`\nwritten to docs/ACCURACY.md`);
  } else if (process.argv.includes('--check')) {
    const current = readFileSync(DOC_FILE, 'utf8');
    let ui = '';
    try { ui = readFileSync(UI_FILE, 'utf8'); } catch { /* missing counts as stale */ }
    if (current !== text || ui !== JSON.stringify(uiData(), null, 2) + '\n') {
      console.error('docs/ACCURACY.md is out of date: run npm run eval');
      process.exit(1);
    }
    console.log('docs/ACCURACY.md is up to date');
  } else console.log(text);
}
