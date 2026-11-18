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
//   exact       exact-udi-unit                    the device's UDI-DI is listed + this unit's lot/serial (listed or in a range)
//   exact       exact-udi-all                     the device's UDI-DI is listed + recall covers ALL units
//   exact       exact-manufacturer-model-lot      manufacturer + model + this unit's lot/serial listed
//   exact       exact-manufacturer-model-range    manufacturer + model + this unit's serial inside a stated range
//   exact       exact-manufacturer-model-all      manufacturer + model + recall covers ALL units
//   likely      likely-udi                        the device's UDI-DI is listed (the unit itself not confirmed)
//   likely      likely-manufacturer-model         manufacturer + model (lot/serial not listed)
//   likely      likely-manufacturer-lot           manufacturer + lot/serial (model not written)
//   possible    possible-model-other-maker        model only, from a DIFFERENT firm (relabel/parent)
//   possible    possible-manufacturer-type        manufacturer + same kind of device (no model)
//
// The UDI-DI rules come first: a UDI-DI (a GS1 GTIN) says exactly which product version a device is, whoever sold it, so
// no manufacturer or model text is needed and a recall filed under a parent company or distributor is still found. Serial
// ranges ("serial numbers 1000 through 1500", "serial number < 2224") are read only from text that follows the word
// "serial" (see serials.js), so lot codes such as "2011-2331" are never mistaken for ranges.
//
// No match is reported when none of these rules applies.
//
// Known limits (also in the README): plurals and spelling variants are not folded together
// ("monitor" vs "monitors"); a serial with letters after its digits ("US001A00AW") is never judged by a range.
//
// This file has no Forge imports so every rule can be unit tested with plain Node.
import { tokenize, compact, containsPhrase, containsFolded, foldedLower } from './text.js';
import { sameMakerFamily } from './makerAliases.js';
import { extractUdis, normalizeDi, diVariants } from './udi.js';
import { parseSerialConstraints, serialInConstraints, serialOutsideConstraints } from './serials.js';

export const CONFIDENCE = Object.freeze({
  EXACT: 'exact',
  LIKELY: 'likely',
  POSSIBLE: 'possible',
});

export const RULES = Object.freeze({
  EXACT_UDI_UNIT: 'exact-udi-unit',
  EXACT_UDI_ALL_UNITS: 'exact-udi-all',
  EXACT_MODEL_AND_LOT: 'exact-manufacturer-model-lot',
  EXACT_MODEL_AND_RANGE: 'exact-manufacturer-model-range',
  EXACT_MODEL_ALL_UNITS: 'exact-manufacturer-model-all',
  LIKELY_UDI: 'likely-udi',
  LIKELY_MODEL: 'likely-manufacturer-model',
  LIKELY_LOT: 'likely-manufacturer-lot',
  POSSIBLE_MODEL_OTHER_MAKER: 'possible-model-other-maker',
  POSSIBLE_TYPE: 'possible-manufacturer-type',
  POSSIBLE_UNIT_OUT: 'possible-unit-ruled-out',
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
/**
 * @param {unknown} name
 * @returns {string[]}
 */
export function makerWords(name) {
  if (typeof name !== 'string') return tokenize(name).filter((word) => !SUFFIX_SET.has(word));
  let words = makerWordsKnown.get(name);
  if (!words) {
    if (makerWordsKnown.size >= 20000) makerWordsKnown.clear();
    words = tokenize(name).filter((word) => !SUFFIX_SET.has(word));
    makerWordsKnown.set(name, words);
  }
  return words;
}
// Makers are compared in every pair of device and recall, so their words are worked out once per name.
/** @type {Map<string, string[]>} */
const makerWordsKnown = new Map();

// Fact 1. Two makers match when ALL the words of the shorter name appear in the longer one
// ("Philips" is inside "Philips North America Llc"), and at least one shared word is specific
// (not in GENERIC_NAME_WORDS). Order does not matter; the rule is symmetric.
/**
 * @param {unknown} deviceMaker
 * @param {unknown} recallFirm
 * @returns {boolean}
 */
export function manufacturersMatch(deviceMaker, recallFirm) {
  return manufacturerLink(deviceMaker, recallFirm) !== null;
}

// How two makers are the same: by their words ("Philips" inside "Philips North America"), because they are two names of one company
// on the list in makerAliases.js ("BD" and "Becton, Dickinson and Company", "Hill-Rom" and "Baxter Healthcare"), or not at all (null).
/**
 * @param {unknown} deviceMaker
 * @param {unknown} recallFirm
 * @returns {'words' | 'family' | null}
 */
export function manufacturerLink(deviceMaker, recallFirm) {
  if (typeof deviceMaker !== 'string' || typeof recallFirm !== 'string') return linkOf(deviceMaker, recallFirm);
  const key = `${deviceMaker}\u0000${recallFirm}`;
  let link = linksKnown.get(key);
  if (link === undefined) {
    if (linksKnown.size >= 50000) linksKnown.clear();
    link = linkOf(deviceMaker, recallFirm);
    linksKnown.set(key, link);
  }
  return link;
}

// The answer for a pair of names is the same for every device of that maker, so it is worked out once.
/** @type {Map<string, 'words' | 'family' | null>} */
const linksKnown = new Map();

/**
 * @param {unknown} deviceMaker
 * @param {unknown} recallFirm
 * @returns {'words' | 'family' | null}
 */
function linkOf(deviceMaker, recallFirm) {
  const a = makerWords(deviceMaker);
  const b = makerWords(recallFirm);
  if (a.length === 0 || b.length === 0) return null;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const longerSet = new Set(longer);
  if (shorter.every((word) => longerSet.has(word)) && shorter.some((word) => !GENERIC_SET.has(word))) return 'words';
  return sameMakerFamily(a, b) ? 'family' : null;
}

// Every device is compared with every recall (a thousand devices and a thousand recalls are a million pairs), and almost every pair
// has nothing in common. The words of a recall's text are kept in a set, once per recall, so a model or serial that is not even a word
// of the text is turned away without searching the text (400,000 characters at the most). Measured: matching 1,000 devices took 43 s
// locally, and this platform runs about twenty times slower than a laptop.
/** @type {WeakMap<object, Set<string>>} */
const wordSets = new WeakMap();

/**
 * @param {import('./types.js').Recall} recall
 * @param {string} phrase
 * @returns {boolean} false when the first word of the phrase is not a word of the recall's product or code text
 */
function mayContain(recall, phrase) {
  const first = tokenize(phrase)[0];
  if (!first) return false;
  let words = wordSets.get(recall);
  if (!words) {
    words = new Set([...tokenize(recall.productText || ''), ...tokenize(recall.codeText || '')]);
    wordSets.set(recall, words);
  }
  return words.has(first);
}

// Fact 2. The model's words must appear in order, as whole words, in the recall's product
// text or code text. "MMT-1885CLW" matches "MMT-1885CLW/00763000" because both reduce to the
// words "mmt 1885clw". Models shorter than `minLength` never match.
/**
 * @param {string} model
 * @param {import('./types.js').Recall} recall
 * @param {number} [minLength]
 * @returns {boolean}
 */
export function modelInRecall(model, recall, minLength = MIN_MODEL_LENGTH) {
  if (compact(model).length < minLength) return false;
  if (!mayContain(recall, model)) return false;
  return containsPhrase(recall.productText || '', model) || containsPhrase(recall.codeText || '', model);
}

// Fact 3a. This unit's lot/serial appears, as whole words, in the recall's code text.
// Lots shorter than MIN_LOT_LENGTH never match.
/**
 * @param {string} lotOrSerial
 * @param {import('./types.js').Recall} recall
 * @returns {boolean}
 */
export function lotInRecall(lotOrSerial, recall) {
  if (compact(lotOrSerial).length < MIN_LOT_LENGTH) return false;
  if (!mayContain(recall, lotOrSerial)) return false;
  return containsPhrase(recall.codeText || '', lotOrSerial);
}

// Words that turn "all serial numbers" into "all serial numbers THAT...": the recall then covers some units only.
// ("All serial numbers with radio software versions 22D28, 22D29 and 22D30" is not every unit.)
export const ALL_UNITS_QUALIFIERS = Object.freeze([
  'with', 'having', 'running', 'configured', 'manufactured', 'between', 'software', 'firmware', 'version', 'versions',
  'installed', 'equipped', 'after', 'before', 'prior', 'starting', 'beginning',
  // "all units FROM lot 12345", "all serial numbers FROM 5000 onward", "all units BUILT in 2019", "all units THAT were...": each one
  // narrows "all" to some of the units. ("All units distributed" is deliberately NOT here: that is every unit that was sold.)
  'from', 'since', 'until', 'through', 'built', 'produced', 'made', 'that', 'which', 'where', 'whose',
]);
const QUALIFIER_SET = new Set(ALL_UNITS_QUALIFIERS);
// How many words after the phrase may carry such a qualifier, and how many characters are enough to hold them.
const QUALIFIER_WINDOW = 4;
const QUALIFIER_LOOK_AHEAD_CHARS = 200;
/** @type {WeakMap<object, boolean>} */
const coversAllCache = new WeakMap();

// Fact 3b. The recall says every unit is affected ("all serial numbers"), without a condition on which ones.
/**
 * @param {import('./types.js').Recall} recall
 * @returns {boolean}
 */
export function recallCoversAllUnits(recall) {
  const known = coversAllCache.get(recall);
  if (known !== undefined) return known;
  const text = foldedLower(recall.codeText || '');
  let covers = false;
  for (const phrase of ALL_UNITS_PHRASES) {
    // Searched as text (see containsPhrase), then only the few words after each hit are split.
    const found = new RegExp(`(?<![a-z0-9])${phrase.join('[^a-z0-9]+')}(?![a-z0-9])`, 'g');
    for (const hit of text.matchAll(found)) {
      const from = (hit.index || 0) + hit[0].length;
      const following = tokenize(text.slice(from, from + QUALIFIER_LOOK_AHEAD_CHARS)).slice(0, QUALIFIER_WINDOW);
      // "all serial numbers" or "all lot numbers" may be followed by "numbers"/"number"; skip that word before looking.
      const after = following[0] === 'numbers' || following[0] === 'number' ? following.slice(1) : following;
      if (!after.some((word) => QUALIFIER_SET.has(word))) {
        covers = true;
        break;
      }
    }
    if (covers) break;
  }
  coversAllCache.set(recall, covers);
  return covers;
}

// What a recall's code text says in a form a program can use, worked out once per recall: the UDI-DIs it names and the
// serial ranges it states. (A WeakMap, so it goes away with the recall and never has to be stored or sent anywhere.)
/** @type {WeakMap<object, { udis: ReturnType<typeof extractUdis>, constraints: ReturnType<typeof parseSerialConstraints> }>} */
const parsedRecalls = new WeakMap();
/** @param {import('./types.js').Recall} recall */
function parsedRecall(recall) {
  let parsed = parsedRecalls.get(recall);
  if (!parsed) {
    const text = recall.codeText || '';
    parsed = { udis: extractUdis(text), constraints: parseSerialConstraints(text) };
    parsedRecalls.set(recall, parsed);
  }
  return parsed;
}

// Fact 4. The device's own UDI-DI (a GS1 GTIN) is named in the recall. Returns { di, serials, lots } or null; the serials and
// lots are the ones the text ties to that DI ("(01)GTIN(21)serial"), which is why a short serial can be trusted there.
/**
 * @param {unknown} deviceUdi
 * @param {import('./types.js').Recall} recall
 * @returns {{ di: string, serials: string[], lots: string[] } | null}
 */
export function udiInRecall(deviceUdi, recall) {
  const di = normalizeDi(deviceUdi);
  if (!di) return null;
  return parsedRecall(recall).udis.find((u) => u.di === di) || null;
}

// Fact 3c. This unit's serial falls inside a range or limit the recall states ("serial numbers 1000 through 1500").
// Returns the recall's own words for it ("1000 through 1500"), or null.
/**
 * @param {string} serial
 * @param {import('./types.js').Recall} recall
 * @returns {string | null}
 */
export function serialInRecallRange(serial, recall) {
  const hit = serialInConstraints(serial, parsedRecall(recall).constraints);
  return hit ? hit.text : null;
}

// Ruling a unit OUT. The product matches (maker and model, or the UDI-DI) but this unit is not covered, in one of two ways that
// leave no room for a guess, and only then does the answer drop from "likely" (a task) to "possible" (no task):
//   1. its serial is named after an exclusion word ("excluding 90425438", "all serial numbers except K17160001") and appears
//      nowhere else in the product's text, or
//   2. the product's text states serial ranges or limits that apply to this serial (same letters, a length they can judge), the
//      serial is outside all of them, and the text has no other way to cover a unit (no lot or batch list, no "all units",
//      no exclusion words that could turn the range into the excluded part: "all serials except 1000-1500").
// Anything else stays "likely" and a person checks, because a wrongly read range would hide a real recall.
// ("additionally included", "updated to include": the text adds units that may lie outside the range.)
const RANGE_OUT_BLOCKERS = /\b(lots?|batch(?:es)?|all\s+(?:serial|units|devices|lots)|includ(?:e|es|ed|ing)|additional(?:ly)?|also|added|updated|expanded)\b/i;
// What may sit between an exclusion word and a serial in a plain list of excluded units. Numbers and codes (anything with a digit)
// and punctuation are dropped before this is applied.
const LIST_FILLER = /\b(?:serial|numbers?|nos?|s\/n|sn|units?|devices?|and|or|the|following|of|lots?)\b|\b\w*\d\w*\b/gi;
/**
 * @param {string} serial
 * @param {string} text  the code text of the product the device was matched to
 * @returns {boolean}
 */
function serialNamedAsExcluded(serial, text) {
  const own = compact(serial);
  if (own.length < 4) return false;
  let found = false;
  for (const sentence of text.split(/\n+|(?<=[.;])\s+/)) {
    const tokens = [...sentence.matchAll(/[A-Za-z0-9-]+/g)];
    const hits = tokens.filter((t) => compact(t[0]) === own);
    if (hits.length === 0) continue;
    const word = EXCLUSION.exec(sentence);
    if (!word || hits.some((t) => t.index < word.index)) return false; // listed as affected somewhere
    // Only a plain list may stand between the exclusion word and the serial ("Excluding 90425438, 90425443, 90425716"): a word
    // such as "include" or "updated" there ("... [Updated to include serial numbers 90421507]") may turn it back into an affected unit.
    for (const t of hits) {
      const between = sentence.slice(word.index + word[0].length, t.index);
      const leftover = between.replace(LIST_FILLER, ' ').replace(/[^A-Za-z]+/g, ' ').trim();
      if (leftover) return false;
    }
    found = true;
  }
  return found;
}

/**
 * @param {string} serial
 * @param {import('./types.js').Recall} scoped
 * @param {boolean} excluded
 * @param {import('./types.js').Recall} whole  the recall as a whole
 * @returns {string | null}  why the unit is ruled out, in the recall's own words, or null
 */
function unitRuledOut(serial, scoped, excluded, whole) {
  if (!serial) return null;
  const text = scoped.codeText || '';
  if (excluded) return serialNamedAsExcluded(serial, text) ? `serial "${serial}" is named as excluded in the recall` : null;
  // The blockers are looked for in the WHOLE code text, not only in the part cut for this product: a closing sentence that adds
  // units ("updated to also include ...") does not name the model, so the cut leaves it out.
  if (recallCoversAllUnits(scoped) || RANGE_OUT_BLOCKERS.test(whole.codeText || '')) return null;
  const outside = serialOutsideConstraints(serial, parsedRecall(scoped).constraints);
  return outside ? `serial "${serial}" is outside the range the recall gives ("${outside.text}")` : null;
}

// Used only by the "same kind of device" rule: every word of the device's type
// ("infusion pump") appears in the recall's product text.
/**
 * @param {string} deviceType
 * @param {import('./types.js').Recall} recall
 * @returns {boolean}
 */
export function typeInRecall(deviceType, recall) {
  const words = tokenize(deviceType);
  if (words.length === 0) return false;
  const text = new Set(tokenize(recall.productText || ''));
  return words.every((word) => text.has(word));
}

// --- One recall, several products --------------------------------------------------------
// A recall often covers several models in one code text ("WX-200: all serial numbers. WX-300: serial numbers 12345-12400").
// "All serial numbers", a listed lot or a range belongs to the product named beside it, not to every model of the recall, so
// a device is judged only against the part of the code text that names ITS model (or UDI-DI). Two ways of cutting the text up,
// tried in this order:
//   1. ENTRIES (how real recalls are written): each product has an entry that starts at a label with its number ("Model No
//      1500-1030", "Part No. 701076205", "REF MPX5305-C", "Product Code 1480") or at a list number ("2." / "3)"). The model, the
//      UDI-DI and the lots then sit in separate sentences of ONE entry, so cutting at every full stop would separate them.
//   2. SENTENCES (no labels, "WX-200: all serial numbers. WX-300: lots C9999."): each sentence that carries unit words.
// Either way the cut only counts when the text has two or more parts that carry unit words AND one of them names this device;
// otherwise nothing can be told apart and the whole text is used as before. Known limits: a model named only in the product
// description (not in the code text) cannot be scoped, and neither can an entry that starts with a bare number and a name
// ("5855300 Slim-Cath ... Lot Number: REKY1364"): there the lots of one product can still be read as another's.
const EXCLUSION = /\b(except|excepting|exception|excludes?|excluding|excluded|exclusive of|other than|not including|apart from)\b/i;
// "Lots 12345 and 67890 are not affected", "serial numbers 1000 through 1500 are not included": a list of units that are NOT
// recalled, and the plain list or range must not be read as "affected". The same words in a closing remark about the OTHER units
// ("units with other serial numbers are not affected") say nothing about the units that are listed, so a sentence that speaks of
// other, remaining or unlisted units does not count.
const NEGATION = /\b(not (?:affected|included|impacted|covered|recalled|subject to|part of|in scope)|unaffected|does not include|do not include|out of scope|outside (?:of )?(?:the )?scope)\b/i;
const OTHER_UNITS = /\b(other|others|remaining|rest|outside|beyond|not (?:listed|shown|named|mentioned|identified))\b/i;

/**
 * @param {string} text
 * @returns {boolean}
 */
function leavesUnitsOut(text) {
  if (EXCLUSION.test(text)) return true;
  return text.split(/\n+|(?<=[.;])\s+/).some((sentence) => NEGATION.test(sentence) && !OTHER_UNITS.test(sentence));
}

// The same, for the whole code text of a recall, once per recall (it is asked for every device).
/** @type {WeakMap<object, boolean>} */
const leavesOutCache = new WeakMap();

/**
 * @param {import('./types.js').Recall} recall  the recall itself, or a part of it cut by scopedRecall
 * @param {import('./types.js').Recall} whole
 * @returns {boolean}
 */
function recallLeavesUnitsOut(recall, whole) {
  if (recall !== whole) return leavesUnitsOut(recall.codeText || '');
  let known = leavesOutCache.get(whole);
  if (known === undefined) {
    known = leavesUnitsOut(whole.codeText || '');
    leavesOutCache.set(whole, known);
  }
  return known;
}
const UNIT_CUE = /\b(serial|lots?|batch(?:es)?|all)\b|\((?:10|21)\)/i;
// A label that names a product and is followed by its number (the number has a digit: "Model No." alone, or "part of", is not one),
// or a list number. "(1)" is not a list number: "(01)", "(10)" and "(21)" are GS1 identifiers.
const ENTRY_START = /(?<![\w.(])\d{1,2}[.)]\s+(?=\S)|\b(?:model|part|catalog(?:ue)?|cat|ref|reference|item|sku|article|product)\b(?:\s*\/\s*[a-z]+)?(?:\s+(?:no|nos|number|numbers|code|codes)\b)?\.?\s*[:#]?\s*(?=\S*\d)/gi;

// The entries of a code text that describes several products, or null. A label or list number starts a NEW entry only when the
// entry before it has already said something about units (a lot, a serial, "all"): a second label inside one product's own header
// ("Model No 123, Catalog No 456, Lot Numbers A1234") must not split it.
/**
 * @param {string} text
 * @returns {string[] | null}
 */
function entryBlocks(text) {
  const starts = [...text.matchAll(ENTRY_START)].map((m) => m.index);
  if (starts.length < 2) return null;
  /** @type {string[]} */
  const blocks = [];
  let from = 0;
  for (const at of starts) {
    if (at > from && UNIT_CUE.test(text.slice(from, at))) {
      blocks.push(text.slice(from, at));
      from = at;
    }
  }
  blocks.push(text.slice(from));
  return blocks.length >= 2 ? blocks : null;
}

/**
 * @param {import('./types.js').Recall} recall
 * @param {string[]} phrases  the device's model and the written forms of its UDI-DI
 * @returns {import('./types.js').Recall}
 */
function scopedRecall(recall, phrases) {
  const wanted = phrases.map((p) => tokenize(p)).filter((words) => words.length > 0);
  for (const withCue of cuePartsOf(recall)) {
    const mine = withCue.filter((part) => wanted.some((words) => containsFolded(part.folded, words)));
    if (mine.length > 0) return { ...recall, codeText: mine.map((part) => part.text).join(' ') };
  }
  return recall;
}

// The parts of a recall's code text that carry unit words, cut by entries and by sentences (see above), worked out ONCE per recall:
// the same text is compared with every device, and a text of millions of characters is cut up in a moment but not thirty times over.
// Only the cuts that have two or more such parts are kept.
/** @type {WeakMap<object, Array<Array<{ text: string, folded: string }>>>} */
const cuePartsCache = new WeakMap();

/**
 * @param {import('./types.js').Recall} recall
 * @returns {Array<Array<{ text: string, folded: string }>>}
 */
function cuePartsOf(recall) {
  let cuts = cuePartsCache.get(recall);
  if (!cuts) {
    const text = recall.codeText || '';
    const sentences = text.split(/\n+|(?<=[.;])\s+/).map((s) => s.trim()).filter(Boolean);
    cuts = [entryBlocks(text), sentences]
      .map((parts) => (parts || []).filter((s) => UNIT_CUE.test(s)).map((text) => ({ text, folded: foldedLower(text) })))
      .filter((withCue) => withCue.length >= 2);
    cuePartsCache.set(recall, cuts);
  }
  return cuts;
}

// --- Rules ------------------------------------------------------------------------------

/**
 * @param {import('./types.js').Confidence} confidence
 * @param {string} rule
 * @param {string} reason
 * @returns {import('./types.js').Verdict}
 */
function result(confidence, rule, reason) {
  return { confidence, rule, reason };
}

// Decide how (and whether) one device matches one recall. Returns
// { confidence, rule, reason } for the strongest rule that applies, or null.
/**
 * @param {import('./types.js').Device} device
 * @param {import('./types.js').Recall} recall
 * @returns {import('./types.js').Verdict | null}
 */
export function evaluateMatch(device, recall) {
  const link = manufacturerLink(device.manufacturer, recall.firm);
  const sameMaker = link !== null;
  // Two names of one company (see makerAliases.js): the reason says so, so nobody wonders why "BD" matched "Becton, Dickinson and Company".
  const company = link === 'family' ? ` "${device.manufacturer}" and the recalling firm "${recall.firm}" are the same company.` : '';
  const hasModel = modelInRecall(device.model, recall);
  const scoped = scopedRecall(recall, [device.model, ...diVariants(device.udiDi)]);
  // "All lot numbers except lot 123" and "1000-1500, excluding 1200" name units that are NOT affected: the text cannot be read as
  // a plain list, range or "all units", so the unit-level rules are off and a person checks (the answer stays "likely").
  const excluded = recallLeavesUnitsOut(scoped, recall);
  const hasLot = !excluded && lotInRecall(device.lotOrSerial, scoped);
  const range = hasLot || excluded ? null : serialInRecallRange(device.lotOrSerial, scoped);
  const unitListed = hasLot || Boolean(range);
  const unitHow = hasLot ? `serial/lot "${device.lotOrSerial}" is listed` : `serial "${device.lotOrSerial}" falls inside the range the recall gives ("${range}")`;
  const whyNotListed = device.lotOrSerial
    ? `serial/lot "${device.lotOrSerial}" is not among the numbers listed (the recall may use a form we cannot read), so check it manually`
    : 'this device has no serial/lot recorded, so it cannot be checked against the recall';

  // RULES with the UDI-DI: the identifier names the product version exactly, so no maker or model text is needed.
  const udi = udiInRecall(device.udiDi, recall);
  if (udi) {
    // A number the text ties to THIS UDI-DI is a stronger statement than the same digits somewhere in the text, so it counts
    // at any length ("(01)00884838085282(21)209": serial 209 of that product).
    const own = compact(device.lotOrSerial);
    const tied = own.length > 0 && [...udi.serials, ...udi.lots].some((n) => compact(n) === own);
    // (A serial the text ties to the DI is a listed unit, unless the text says it is one of the units that are left out.)
    if (unitListed || (tied && !excluded)) {
      return result(CONFIDENCE.EXACT, RULES.EXACT_UDI_UNIT, `UDI-DI ${udi.di} is listed in this recall, and this unit's ${tied && !unitListed ? `serial/lot "${device.lotOrSerial}" is listed with it` : unitHow}.`);
    }
    if (!excluded && recallCoversAllUnits(scoped)) {
      return result(CONFIDENCE.EXACT, RULES.EXACT_UDI_ALL_UNITS, `UDI-DI ${udi.di} is listed in this recall, and the recall covers all serial/lot numbers.`);
    }
    const outUdi = unitRuledOut(device.lotOrSerial, scoped, excluded, recall);
    if (outUdi) return result(CONFIDENCE.POSSIBLE, RULES.POSSIBLE_UNIT_OUT, `UDI-DI ${udi.di} is listed in this recall, but ${outUdi}, so this unit is not covered. No task is created; check the recall notice if you doubt it.`);
    return result(CONFIDENCE.LIKELY, RULES.LIKELY_UDI, `UDI-DI ${udi.di} is listed in this recall, but ${whyNotListed}.`);
  }

  if (sameMaker && hasModel) {
    // RULE exact-manufacturer-model-lot: maker, model AND this unit's number are all listed.
    if (hasLot) {
      return result(
        CONFIDENCE.EXACT,
        RULES.EXACT_MODEL_AND_LOT,
        `Manufacturer, model "${device.model}" and serial/lot "${device.lotOrSerial}" are all listed in this recall.${company}`,
      );
    }
    // RULE exact-manufacturer-model-range: maker and model match and this unit's serial is inside a stated range.
    if (range) {
      return result(
        CONFIDENCE.EXACT,
        RULES.EXACT_MODEL_AND_RANGE,
        `Manufacturer and model "${device.model}" match, and serial "${device.lotOrSerial}" falls inside the range the recall gives ("${range}").${company}`,
      );
    }
    // RULE exact-manufacturer-model-all: maker and model match and the recall covers every unit.
    if (!excluded && recallCoversAllUnits(scoped)) {
      return result(
        CONFIDENCE.EXACT,
        RULES.EXACT_MODEL_ALL_UNITS,
        `Manufacturer and model "${device.model}" match, and the recall covers all serial/lot numbers.${company}`,
      );
    }
    // RULE possible-unit-ruled-out: maker and model match, but the recall itself leaves this unit out (see unitRuledOut).
    const outModel = unitRuledOut(device.lotOrSerial, scoped, excluded, recall);
    if (outModel) {
      return result(CONFIDENCE.POSSIBLE, RULES.POSSIBLE_UNIT_OUT, `Manufacturer and model "${device.model}" match, but ${outModel}, so this unit is not covered. No task is created; check the recall notice if you doubt it.${company}`);
    }
    // RULE likely-manufacturer-model: maker and model match but the unit's number is not listed.
    // Either we do not know the number, or the recall lists numbers in a form we cannot read
    // (partial lists, ranges of a kind we do not parse), so a person should check.
    return result(
      CONFIDENCE.LIKELY,
      RULES.LIKELY_MODEL,
      `Manufacturer and model "${device.model}" match, but ${whyNotListed}.${company}`,
    );
  }

  // RULE likely-manufacturer-lot: maker and this unit's number match, but the recall text does not mention the
  // model (some recalls list only serial numbers). There is deliberately NO such rule for a serial inside a RANGE: a number
  // in a range, with no model or product to tie it to, is too weak (a real Getinge vaporizer recall lists "Serial Numbers:
  // 17003 - 23454", and a ventilator with serial 21500 is not affected by it).
  if (sameMaker && hasLot) {
    return result(
      CONFIDENCE.LIKELY,
      RULES.LIKELY_LOT,
      `Manufacturer and serial/lot "${device.lotOrSerial}" are listed in this recall, but the model "${device.model}" is not mentioned.${company}`,
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
      `Same manufacturer and the recall is for the same kind of device ("${device.type}"), but model "${device.model}" is not mentioned.${company}`,
    );
  }

  return null;
}

// --- Whole lists ------------------------------------------------------------------------

// Recall class I is the most serious. Unknown classes sort last.
const CLASS_RANK = Object.freeze({ I: 1, II: 2, III: 3 });
const UNKNOWN_CLASS_RANK = 4;

/** @param {string} recallClass */
function classRank(recallClass) {
  return /** @type {Record<string, number>} */ (CLASS_RANK)[recallClass] || UNKNOWN_CLASS_RANK;
}

// A match, flattened for the UI: the verdict plus the facts needed to show it.
/**
 * @param {import('./types.js').Device} device
 * @param {import('./types.js').Recall} recall
 * @returns {import('./types.js').Match | null}
 */
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
    deviceUdiDi: device.udiDi || '',
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
/**
 * @param {import('./types.js').Match} a
 * @param {import('./types.js').Match} b
 */
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
/**
 * @param {import('./types.js').Device[]} devices
 * @param {import('./types.js').Recall[]} recalls
 * @returns {import('./types.js').Match[]}
 */
export function matchDevicesToRecalls(devices, recalls) {
  /** @type {import('./types.js').Match[]} */
  const matches = [];
  // A pair can only match when the makers are the same company, or the device's UDI-DI is in the recall, or its model number (five
  // characters or more) is: every rule in evaluateMatch starts from one of these. So devices with the same maker, model and UDI-DI
  // (a hospital owns many of one pump) share ONE pass over the recalls, and each device is then compared only with the recalls that
  // passed. Same answers as comparing every pair, a lot fewer comparisons (a thousand devices took minutes on the platform).
  /** @type {Map<string, import('./types.js').Recall[]>} */
  const candidatesOf = new Map();
  for (const device of devices) {
    const key = `${device.manufacturer}\u0000${device.model}\u0000${device.udiDi || ''}`;
    let candidates = candidatesOf.get(key);
    if (!candidates) {
      candidates = recalls.filter(
        (recall) => manufacturersMatch(device.manufacturer, recall.firm) || Boolean(udiInRecall(device.udiDi, recall)) || modelInRecall(device.model, recall, MIN_MODEL_LENGTH_OTHER_MAKER),
      );
      candidatesOf.set(key, candidates);
    }
    for (const recall of candidates) {
      const match = matchDeviceToRecall(device, recall);
      if (match) matches.push(match);
    }
  }
  return matches.sort(compareMatches);
}
