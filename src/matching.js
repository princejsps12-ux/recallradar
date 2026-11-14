// Matches FDA device recalls to a hospital's devices and says HOW SURE each match is and WHY.
//
// A match is built from three facts, each checked on its own:
//   1. MANUFACTURER  does the device's maker equal the recall's "recalling firm"?
//   2. MODEL         is the device's model number written in the recall's product text?
//   3. LOT/SERIAL    is this physical unit's lot/serial listed in the recall (or does the
//                    recall cover every unit)?
//
// Every pair of (device, recall) gets AT MOST ONE result: the strongest rule that applies.
//
//   confidence  rule                              needs
//   ----------  --------------------------------  -----------------------------------------
//   exact       exact-manufacturer-model-lot      manufacturer + model + this unit's lot/serial listed
//   exact       exact-manufacturer-model-all      manufacturer + model + recall covers ALL units
//   likely      likely-manufacturer-model         manufacturer + model (lot/serial not listed)
//   likely      likely-manufacturer-lot           manufacturer + lot/serial (model not written)
//   possible    possible-model-other-maker        model only, from a DIFFERENT firm (relabel/parent)
//   possible    possible-manufacturer-type        manufacturer + same kind of device (no model)
//
// No match is reported when none of these rules applies.
//
// Known limits (also in the README): serial ranges such as "serial number < 2224" are not
// understood, so a device inside such a range shows up as "likely" and needs a human check.
// Plurals and spelling variants are not folded together ("monitor" vs "monitors").
//
// This file has no Forge imports so every rule can be unit tested with plain Node.
import { tokenize, compact, containsPhrase } from './text.js';

export const CONFIDENCE = Object.freeze({
  EXACT: 'exact',
  LIKELY: 'likely',
  POSSIBLE: 'possible',
});

export const RULES = Object.freeze({
  EXACT_MODEL_AND_LOT: 'exact-manufacturer-model-lot',
  EXACT_MODEL_ALL_UNITS: 'exact-manufacturer-model-all',
  LIKELY_MODEL: 'likely-manufacturer-model',
  LIKELY_LOT: 'likely-manufacturer-lot',
  POSSIBLE_MODEL_OTHER_MAKER: 'possible-model-other-maker',
  POSSIBLE_TYPE: 'possible-manufacturer-type',
});

// Strongest first. Used to sort results and to pick the best rule.
export const CONFIDENCE_ORDER = Object.freeze([
  CONFIDENCE.EXACT,
  CONFIDENCE.LIKELY,
  CONFIDENCE.POSSIBLE,
]);

// --- Thresholds (every number the rules depend on, and why) ----------------------------

// A model shorter than this (after removing spaces/hyphens) is too common to mean anything:
// a model called "A" or "10" would "appear" in almost every recall.
export const MIN_MODEL_LENGTH = 3;

// Same idea for lot/serial numbers: "12" or "A1" would be found in many recalls by chance.
export const MIN_LOT_LENGTH = 4;

// The "possible-model-other-maker" rule skips the manufacturer check, so the model number
// alone must be distinctive. Seven-digit catalogue numbers pass; short names like "N15" do not.
export const MIN_MODEL_LENGTH_OTHER_MAKER = 5;

// Words that only describe a company's legal form, not who it is. "Baxter Healthcare
// Corporation" and "Baxter Healthcare" are the same maker.
export const COMPANY_SUFFIX_WORDS = Object.freeze([
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company',
  'gmbh', 'ag', 'ab', 'plc', 'lp', 'sa', 'sarl', 'nv', 'bv', 'kg',
]);

// Words too general to identify a maker on their own. Two makers do not "match" just because
// both are called "... Medical Systems". At least one shared word must NOT be in this list.
export const GENERIC_NAME_WORDS = Object.freeze([
  'medical', 'healthcare', 'health', 'systems', 'system', 'group', 'international',
  'technologies', 'technology', 'industries', 'holdings', 'solutions', 'devices', 'device',
  'products', 'america', 'north', 'usa', 'us', 'the', 'of', 'and',
]);

// Phrases in a recall's code/lot text that mean "every unit is affected".
export const ALL_UNITS_PHRASES = Object.freeze([
  ['all', 'serial'], // "all serial numbers"
  ['all', 'lot'], // "all lot numbers"
  ['all', 'unexpired'], // "Lot Numbers: All unexpired"
  ['all', 'units'],
]);

const SUFFIX_SET = new Set(COMPANY_SUFFIX_WORDS);
const GENERIC_SET = new Set(GENERIC_NAME_WORDS);

// --- The three facts ------------------------------------------------------------------

// The identifying words of a maker's name: lower-case words minus legal suffixes.
export function makerWords(name) {
  return tokenize(name).filter((word) => !SUFFIX_SET.has(word));
}

// Fact 1. Two makers match when ALL the words of the shorter name appear in the longer one
// ("Philips" is inside "Philips North America Llc"), and at least one shared word is specific
// (not in GENERIC_NAME_WORDS). Order does not matter; the rule is symmetric.
export function manufacturersMatch(deviceMaker, recallFirm) {
  const a = makerWords(deviceMaker);
  const b = makerWords(recallFirm);
  if (a.length === 0 || b.length === 0) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const longerSet = new Set(longer);
  if (!shorter.every((word) => longerSet.has(word))) return false;
  return shorter.some((word) => !GENERIC_SET.has(word));
}

// Fact 2. The model's words must appear in order, as whole words, in the recall's product
// text or code text. "MMT-1885CLW" matches "MMT-1885CLW/00763000" because both reduce to the
// words "mmt 1885clw". Models shorter than `minLength` never match.
export function modelInRecall(model, recall, minLength = MIN_MODEL_LENGTH) {
  if (compact(model).length < minLength) return false;
  const text = tokenize(`${recall.productText || ''} ${recall.codeText || ''}`);
  return containsPhrase(text, model);
}

// Fact 3a. This unit's lot/serial appears, as whole words, in the recall's code text.
// Lots shorter than MIN_LOT_LENGTH never match.
export function lotInRecall(lotOrSerial, recall) {
  if (compact(lotOrSerial).length < MIN_LOT_LENGTH) return false;
  return containsPhrase(recall.codeText || '', lotOrSerial);
}

// Fact 3b. The recall says every unit is affected ("all serial numbers").
export function recallCoversAllUnits(recall) {
  const text = tokenize(recall.codeText || '');
  return ALL_UNITS_PHRASES.some((phrase) => containsPhrase(text, phrase));
}

// Used only by the "same kind of device" rule: every word of the device's type
// ("infusion pump") appears in the recall's product text.
export function typeInRecall(deviceType, recall) {
  const words = tokenize(deviceType);
  if (words.length === 0) return false;
  const text = new Set(tokenize(recall.productText || ''));
  return words.every((word) => text.has(word));
}

// --- Rules ------------------------------------------------------------------------------

function result(confidence, rule, reason) {
  return { confidence, rule, reason };
}

// Decide how (and whether) one device matches one recall. Returns
// { confidence, rule, reason } for the strongest rule that applies, or null.
export function evaluateMatch(device, recall) {
  const sameMaker = manufacturersMatch(device.manufacturer, recall.firm);
  const hasModel = modelInRecall(device.model, recall);
  const hasLot = lotInRecall(device.lotOrSerial, recall);

  if (sameMaker && hasModel) {
    // RULE exact-manufacturer-model-lot: maker, model AND this unit's number are all listed.
    if (hasLot) {
      return result(
        CONFIDENCE.EXACT,
        RULES.EXACT_MODEL_AND_LOT,
        `Manufacturer, model "${device.model}" and serial/lot "${device.lotOrSerial}" are all listed in this recall.`,
      );
    }
    // RULE exact-manufacturer-model-all: maker and model match and the recall covers every unit.
    if (recallCoversAllUnits(recall)) {
      return result(
        CONFIDENCE.EXACT,
        RULES.EXACT_MODEL_ALL_UNITS,
        `Manufacturer and model "${device.model}" match, and the recall covers all serial/lot numbers.`,
      );
    }
    // RULE likely-manufacturer-model: maker and model match but the unit's number is not listed.
    // Either we do not know the number, or the recall lists numbers in a form we cannot read
    // (ranges, partial lists), so a person should check.
    const why = device.lotOrSerial
      ? `serial/lot "${device.lotOrSerial}" is not among the numbers listed (the recall may use ranges or a partial list), so check it manually`
      : 'this device has no serial/lot recorded, so it cannot be checked against the recall';
    return result(
      CONFIDENCE.LIKELY,
      RULES.LIKELY_MODEL,
      `Manufacturer and model "${device.model}" match, but ${why}.`,
    );
  }

  // RULE likely-manufacturer-lot: maker and this unit's number match, but the recall text does
  // not mention the model (some recalls list only serial numbers).
  if (sameMaker && hasLot) {
    return result(
      CONFIDENCE.LIKELY,
      RULES.LIKELY_LOT,
      `Manufacturer and serial/lot "${device.lotOrSerial}" are listed in this recall, but the model "${device.model}" is not mentioned.`,
    );
  }

  // RULE possible-model-other-maker: the model number is written in the recall but the firm
  // is a different company. Happens with parent companies, distributors and relabelled
  // products (e.g. a device sold under one brand and recalled under its subsidiary).
  if (!sameMaker && modelInRecall(device.model, recall, MIN_MODEL_LENGTH_OTHER_MAKER)) {
    return result(
      CONFIDENCE.POSSIBLE,
      RULES.POSSIBLE_MODEL_OTHER_MAKER,
      `Model "${device.model}" appears in this recall, but the recalling firm "${recall.firm}" differs from "${device.manufacturer}" (possibly a parent company, distributor or relabelled product).`,
    );
  }

  // RULE possible-manufacturer-type: same maker and the recall is for the same kind of device,
  // but it does not mention the model. Worth a look, nothing more.
  if (sameMaker && typeInRecall(device.type, recall)) {
    return result(
      CONFIDENCE.POSSIBLE,
      RULES.POSSIBLE_TYPE,
      `Same manufacturer and the recall is for the same kind of device ("${device.type}"), but model "${device.model}" is not mentioned.`,
    );
  }

  return null;
}

// --- Whole lists ------------------------------------------------------------------------

// Recall class I is the most serious. Unknown classes sort last.
const CLASS_RANK = Object.freeze({ I: 1, II: 2, III: 3 });
const UNKNOWN_CLASS_RANK = 4;

function classRank(recallClass) {
  return CLASS_RANK[recallClass] || UNKNOWN_CLASS_RANK;
}

// A match, flattened for the UI: the verdict plus the facts needed to show it.
export function matchDeviceToRecall(device, recall) {
  const verdict = evaluateMatch(device, recall);
  if (!verdict) return null;
  return {
    ...verdict,
    deviceId: device.id,
    deviceName: device.name,
    ward: device.ward,
    deviceManufacturer: device.manufacturer,
    deviceModel: device.model,
    lotOrSerial: device.lotOrSerial,
    recallNumber: recall.recallNumber,
    recallClass: recall.recallClass,
    firm: recall.firm,
    product: recall.product,
    date: recall.date,
  };
}

// Compare two matches: strongest confidence first, then the most serious recall class,
// then the newest recall, then device id so the order is always the same.
function compareMatches(a, b) {
  return (
    CONFIDENCE_ORDER.indexOf(a.confidence) - CONFIDENCE_ORDER.indexOf(b.confidence) ||
    classRank(a.recallClass) - classRank(b.recallClass) ||
    b.date.localeCompare(a.date) ||
    a.deviceId.localeCompare(b.deviceId) ||
    a.recallNumber.localeCompare(b.recallNumber)
  );
}

// Match every device against every recall. Returns matches sorted as described above.
export function matchDevicesToRecalls(devices, recalls) {
  const matches = [];
  for (const device of devices) {
    for (const recall of recalls) {
      const match = matchDeviceToRecall(device, recall);
      if (match) matches.push(match);
    }
  }
  return matches.sort(compareMatches);
}
