#!/usr/bin/env node
// Builds the labeled accuracy set: real FDA recalls (eval/recalls.json) crossed with devices made from them, each pair with
// the right answer decided BEFORE the matcher is asked.
//
//   node scripts/make-eval-set.mjs --pull    fetch the real recalls named in SPEC from openFDA into eval/recalls.json (about 40 requests)
//   node scripts/make-eval-set.mjs           build eval/cases.json from eval/recalls.json and the SPEC below
//
// How the labels come about. Each SPEC line was written by a person reading the real recall text: the recalling firm's
// products (the maker and model a hospital would own), what the recall lists (a serial, a lot, a UDI-DI, "all serial numbers",
// a range) and what it does not. From that, the templates below build devices whose right answer follows from the text:
//
//   listed-unit                    the maker, model and a serial/lot the recall lists          -> affected
//   udi-listed-unit                only the UDI-DI and a listed serial/lot (other maker, other model) -> affected
//   model-serial-not-listed        the right model, a serial the recall does not list           -> product-covered (affected if it covers all units)
//   model-no-serial                the right model, no serial recorded                          -> product-covered (affected if all units)
//   udi-no-serial / -unlisted      only the UDI-DI, no or an unlisted serial                    -> product-covered (affected if all units)
//   same-maker-other-model         same maker and kind of device, a different model             -> related
//   same-maker-other-kind          same maker, a different model and kind of device             -> unrelated
//   other-maker-same-model         the same model number from a different firm                  -> related
//   unrelated-device               nothing in common                                            -> unrelated
//   udi-off-by-one                 a different, valid UDI-DI                                    -> unrelated
//   range-inside / range-outside   a serial inside / outside the range the recall states        -> affected / excluded
//   lot-code-lookalike             a serial that is "inside" a hyphenated LOT code             -> product-covered
//   qualified-all                  "all serial numbers WITH software x": the unit is not confirmed -> product-covered
//
// The matcher is not consulted here. The cases measure whether it applies the stated rules to real recall wording; they are a
// regression set and a sanity check, not a measure of how often it is right in a hospital (see docs/ACCURACY.md).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDi, gs1CheckDigitValid } from '../src/udi.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RECALLS_FILE = join(root, 'eval', 'recalls.json');
const CASES_FILE = join(root, 'eval', 'cases.json');

// unit: 'serial' | 'lot' | '21' read from the text by a simple pattern, a literal value, or null (nothing usable listed).
const SPEC = [
  { recall: 'Z-2723-2026', maker: 'ICU Medical', model: '400020401', type: 'infusion pump', unit: 'serial' },
  { recall: 'Z-2579-2026', maker: 'Philips', model: '867232', type: 'telemetry monitor', unit: 'serial', udi: '00884838102842' },
  { recall: 'Z-2735-2026', maker: 'ResMed', model: 'Astral 100', type: 'ventilator', unit: null, udi: '00619498003259', range: { inside: '22241800001', outside: '22250000001' } },
  { recall: 'Z-3065-2026', maker: 'Baxter Healthcare', model: '40800BAXUS', type: 'syringe pump', unit: null, udi: '05413765852428', allUnits: true },
  { recall: 'Z-2333-2025', maker: 'Baxter Healthcare', model: '40800BAXUS', type: 'infusion pump', unit: null, udi: '05413765852428', allUnits: true },
  { recall: 'Z-2582-2024', maker: 'Baxter Healthcare', model: '36010', type: 'battery modules', unit: null, udi: '00085412498683', qualifiedAll: true },
  { recall: 'Z-2096-2025', maker: 'Baxter Healthcare', model: '35700BAX2', type: 'infusion pump', unit: 'serial', udi: '00085412498683' },
  { recall: 'Z-1121-2026', maker: 'Baxter Healthcare', model: '35700BAX2', type: 'infusion pump', unit: 'serial', udi: '00085412498683' },
  { recall: 'Z-0228-2025', maker: 'Baxter Healthcare', model: 'P7900B000001', type: 'hospital bed', unit: null, udi: '00887761985162', qualifiedAll: true },
  { recall: 'Z-0208-2027', maker: 'Abiomed', model: '0042-0000-US', type: 'automated impella controller', unit: null, udi: '00813502010022' },
  { recall: 'Z-3148-2026', maker: 'Abiomed', model: '0042-0000-CA', type: 'impella controller', unit: 'serial', udi: '00813502010022' },
  { recall: 'Z-2211-2026', maker: 'Abiomed', model: '0042-0000-US', type: 'automated impella controller', unit: 'serial', udi: '00813502010022' },
  { recall: 'Z-1877-2024', maker: 'Getinge', model: '6682282', type: 'vaporizer', unit: null, udi: '07325710000212', range: { inside: '20000', outside: '30000' } },
  { recall: 'Z-2179-2025', maker: 'CareFusion 303', model: '8100', type: 'pump module', unit: null, udi: '10885403222054', allUnits: true },
  { recall: 'Z-1485-2026', maker: 'Aesculap', model: 'FF399R', type: 'trocar', unit: 'serial', udi: '04038653065547' },
  { recall: 'Z-0289-2024', maker: 'Carestream Health', model: 'DRX-Revolution', type: 'x-ray system', unit: 'serial', udi: '60889971019394' },
  { recall: 'Z-3183-2026', maker: 'Stryker Sustainability', model: '2B5ST', type: 'trocar', unit: 'lot', udi: '00885825017231' },
  { recall: 'Z-3057-2026', maker: 'Medline Industries', model: 'DYNDH1193', type: 'convenience kits', unit: 'lot', udi: '10889942499953' },
  { recall: 'Z-2953-2026', maker: 'Intersurgical', model: '1000035', type: 'airway', unit: 'lot', udi: '05030267049844' },
  { recall: 'Z-0966-2025', maker: 'Adept Medical', model: 'NZ3309', type: 'ventilation tube', unit: 'lot', udi: '09421901970369', lotCodeLookalike: '2100' },
  { recall: 'Z-1219-2026', maker: 'LSL Healthcare', model: '2519CP', type: 'dressing kit', unit: '5G3119', udi: '00661392048157' },
  { recall: 'Z-2285-2026', maker: 'Philips Medical Systems', model: '722064', type: 'azurion', unit: '21', udi: '00884838085282' },
  { recall: 'Z-2053-2025', maker: 'Philips Ultrasound', model: '989605431531', type: 'transducer', unit: 'B29W3Y', udi: '00884838070806' },
  { recall: 'Z-2660-2025', maker: 'Siemens Medical Solutions', model: '10432915', type: 'magnetom skyra', unit: '21', udi: '04056869006703' },
  { recall: 'Z-1966-2026', maker: 'Philips', model: '782145', type: 'smartpath', unit: '17385', udi: '00884838108684' },
  { recall: 'Z-1767-2026', maker: 'GE Healthcare', model: 'SIGNA Premier', type: 'systems', unit: '415353UMR2', udi: '00840682135269' },
  { recall: 'Z-2535-2025', maker: 'Boston Scientific', model: 'M0062101180', type: 'nephromax kit', unit: 'lot', udi: '08714729077589' },
  { recall: 'Z-0815-2025', maker: 'GE Medical Systems', model: '1177-9820-ISO', type: 'anesthesia vaporizer', unit: 'serial', udi: '00840682124744' },
  { recall: 'Z-3190-2026', maker: 'Datex-Ohmeda', model: '1011-9055-000', type: 'anesthesia system', unit: 'serial', udi: '00195278588128' },
  { recall: 'Z-0083-2025', maker: 'Datex-Ohmeda', model: '1011-9055-000', type: 'anesthesia gas machine', unit: null, udi: '00195278588128', allUnits: true },
  { recall: 'Z-3143-2026', maker: 'GE Medical Systems Information Technologies', model: '5867474-04', type: 'central station', unit: null, udi: '00195278343512' },
  { recall: 'Z-0213-2026', maker: 'Wipro GE Healthcare', model: 'MAS800', type: 'central station', unit: 'serial', udi: '00195278343512' },
  { recall: 'Z-1537-2024', maker: 'Masimo', model: '9847', type: 'pulse oximeter', unit: 'serial', udi: '00843997013284' },
  { recall: 'Z-3218-2026', maker: 'Midmark', model: '1-200-0330', type: 'iqvitals zone', unit: 'serial', udi: '00841709105807' },
  { recall: 'Z-3013-2026', maker: 'Midmark', model: '4-000-0080', type: 'digital ecg', unit: null },
  { recall: 'Z-1820-2024', maker: 'HeartSine Technologies', model: '350P', type: 'defibrillator', unit: null, udi: '5060167125379' },
  { recall: 'Z-3120-2026', maker: 'HeartSine Technologies', model: '350P', type: 'defibrillator', unit: 'serial' },
  { recall: 'Z-0496-2025', maker: 'Siemens Healthcare Diagnostics', model: 'Atellica CH', type: 'cuvette segment', unit: 'N1527024', udi: '00630414596143' },
  { recall: 'Z-2982-2026', maker: 'Medtronic MiniMed', model: 'MMT-1885CLW', type: 'insulin pump', unit: 'NG3150737H', udi: '00763000974374' },
  { recall: 'Z-2623-2026', maker: 'Remel', model: 'R01460', type: 'agar base', unit: 'lot', udi: '848838001796' },
];

const FIELDS = ['recall_number', 'recalling_firm', 'product_description', 'code_info', 'more_code_info', 'classification', 'report_date', 'status'];

async function pull() {
  mkdirSync(dirname(RECALLS_FILE), { recursive: true });
  const out = {};
  for (const { recall } of SPEC) {
    const url = `https://api.fda.gov/device/enforcement.json?search=recall_number:"${recall}"&limit=3`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`openFDA answered ${res.status} for ${recall}`);
    const record = (await res.json()).results.find((r) => r.recall_number === recall);
    if (!record) throw new Error(`${recall} was not found`);
    out[recall] = Object.fromEntries(FIELDS.filter((f) => record[f] != null).map((f) => [f, record[f]]));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  writeFileSync(RECALLS_FILE, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`${Object.keys(out).length} recalls written to eval/recalls.json`);
}

const tidy = (text) => String(text || '').replace(/\s+/g, ' ').trim();

// What the recall lists, read with plain patterns (deliberately not the matcher's own code).
function listedUnit(raw, kind) {
  const text = tidy(`${raw.code_info || ''} ${raw.more_code_info || ''}`);
  const patterns = {
    serial: /serial\s*(?:numbers?|nos?\.?)\s*:?\s*([A-Za-z0-9][A-Za-z0-9-]*)/i,
    lot: /\blots?\s*(?:numbers?|nos?\.?|#)?\s*:?\s*([A-Za-z0-9][A-Za-z0-9-]*)/i,
    21: /\(21\)\s*([A-Za-z0-9]+)/,
  };
  const found = patterns[kind].exec(text);
  return found ? found[1] : null;
}

// A different, valid GTIN: change one digit in the middle and recompute the check digit.
function otherGtin(di) {
  const digits = di.split('');
  const at = 6;
  digits[at] = String((Number(digits[at]) + 3) % 10);
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  digits[digits.length - 1] = String((10 - (sum % 10)) % 10);
  return digits.join('');
}

function build() {
  const recalls = JSON.parse(readFileSync(RECALLS_FILE, 'utf8'));
  const cases = [];
  const notes = [];
  for (const spec of SPEC) {
    const raw = recalls[spec.recall];
    if (!raw) throw new Error(`Run with --pull first: ${spec.recall} is missing`);
    const text = `${tidy(raw.product_description)} ${tidy(raw.code_info)} ${tidy(raw.more_code_info)}`.toLowerCase();
    const unit = spec.unit === 'serial' || spec.unit === 'lot' || spec.unit === '21' ? listedUnit(raw, spec.unit) : spec.unit;
    const udi = spec.udi ? normalizeDi(spec.udi, { strict: true }) : null;
    if (spec.udi && !udi) notes.push(`${spec.recall}: UDI-DI ${spec.udi} is not a valid GTIN, so its UDI cases are skipped`);
    if (spec.unit && !unit) notes.push(`${spec.recall}: no ${spec.unit} could be read from the text, so its unit cases are skipped`);
    if (unit && !text.includes(unit.toLowerCase())) throw new Error(`${spec.recall}: "${unit}" is not in the recall text`);
    const unlisted = 'ZQ-0042-X';
    if (text.includes(unlisted.toLowerCase())) throw new Error(`${spec.recall}: the made-up serial is in the text`);
    const base = { manufacturer: spec.maker, model: spec.model, type: spec.type };
    let n = 0;
    const add = (template, truth, device, extra = {}) => {
      n += 1;
      cases.push({
        id: `${spec.recall}/${template}`, recall: spec.recall, template, truth,
        device: { id: `${spec.recall}-${n}`, name: `${spec.maker} ${spec.model}`, ward: 'ICU', lotOrSerial: '', udiDi: '', ...base, ...device }, ...extra,
      });
    };
    const coversAll = Boolean(spec.allUnits);
    // "the unit is not confirmed" is affected when the recall covers every unit, product-covered otherwise.
    const unconfirmed = coversAll ? 'affected' : 'product-covered';

    // Kept even when the serial is very short ("209"): the recall does list it, so the unit is affected. The matcher deliberately
    // does not trust a serial of fewer than four characters without a UDI-DI (MIN_LOT_LENGTH), so such a case is a known miss
    // and shows up in the report as one instead of being left out of the set.
    if (unit) add('listed-unit', 'affected', { lotOrSerial: unit });
    if (unit && udi) add('udi-listed-unit', 'affected', { manufacturer: 'Zenith Biomedical', model: 'ZX-9000-ZZ', type: spec.type, lotOrSerial: unit, udiDi: udi });
    add('model-serial-not-listed', unconfirmed, { lotOrSerial: unlisted });
    add('model-no-serial', unconfirmed, {});
    if (udi) {
      add('udi-no-serial', unconfirmed, { manufacturer: 'Zenith Biomedical', model: 'ZX-9000-ZZ', type: 'dental chair', udiDi: udi });
      add('udi-unlisted-serial', unconfirmed, { manufacturer: 'Zenith Biomedical', model: 'ZX-9000-ZZ', type: 'dental chair', lotOrSerial: unlisted, udiDi: udi });
      const other = otherGtin(normalizeDi(udi));
      if (gs1CheckDigitValid(other) && !text.includes(other)) add('udi-off-by-one', 'unrelated', { manufacturer: 'Zenith Biomedical', model: 'ZX-9000-ZZ', type: 'dental chair', lotOrSerial: unlisted, udiDi: other });
    }
    const otherModel = `${spec.model}9`;
    if (!text.includes(otherModel.toLowerCase())) {
      add('same-maker-other-model', 'related', { model: otherModel, type: spec.type });
      add('same-maker-other-kind', 'unrelated', { model: otherModel, type: 'dental chair' });
    }
    if (spec.model.replace(/[^A-Za-z0-9]/g, '').length >= 5) add('other-maker-same-model', 'related', { manufacturer: 'Zenith Biomedical', type: 'dental chair' });
    add('unrelated-device', 'unrelated', { manufacturer: 'Zenith Biomedical', model: 'QX-5150', type: 'dental chair', lotOrSerial: 'QX-77-1234' });
    if (spec.range) {
      add('range-inside', 'affected', { lotOrSerial: spec.range.inside });
      add('range-outside', 'excluded', { lotOrSerial: spec.range.outside });
      if (udi) add('udi-range-inside', 'affected', { manufacturer: 'Zenith Biomedical', model: 'ZX-9000-ZZ', type: 'dental chair', lotOrSerial: spec.range.inside, udiDi: udi });
    }
    if (spec.lotCodeLookalike) add('lot-code-lookalike', 'product-covered', { lotOrSerial: spec.lotCodeLookalike });
    if (spec.qualifiedAll) add('qualified-all', 'product-covered', { lotOrSerial: 'ZQ-0042-X' });
  }
  writeFileSync(CASES_FILE, `${JSON.stringify({ about: 'Generated by scripts/make-eval-set.mjs from eval/recalls.json (real openFDA recalls). Do not edit by hand.', cases }, null, 1)}\n`);
  console.log(`${cases.length} labeled cases for ${SPEC.length} recalls written to eval/cases.json`);
  for (const note of notes) console.log(`note: ${note}`);
}

if (process.argv.includes('--pull')) await pull();
else if (!existsSync(RECALLS_FILE)) throw new Error('eval/recalls.json is missing: run with --pull first');
else build();
