// Small text helpers shared by recall parsing, search building and matching.
// Pure functions with no Forge imports, so they can be unit tested with plain Node.

// Letters with marks, folded to the plain letters a person types on a US keyboard, so a maker is one maker however it is spelled:
// the German umlauts take their usual two-letter spelling ("Dräger" is "Draeger", "Müller" is "Mueller"), other accents are
// dropped ("José" is "Jose"). Only the few letters that do not decompose need a table of their own.
const FOLDED_LETTERS = /** @type {Record<string, string>} */ ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', å: 'a', ł: 'l', đ: 'd', ð: 'd', þ: 'th' });

/**
 * @param {string} lower  text that is already lower-case
 * @returns {string}
 */
function foldLetters(lower) {
  if (!/[\u0080-\uffff]/.test(lower)) return lower; // plain ASCII, the usual case
  return lower
    .normalize('NFC')
    .replace(/[äöüßæœøåłđðþ]/g, (letter) => FOLDED_LETTERS[letter])
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '');
}

// The lower-cased, folded form of a text, which is what tokenize splits. A long text (one real recall has 8.9 million characters of
// serial numbers) is asked for once per device it is compared with, so the last few long ones are kept: copying 9 MB for every
// pair ran the check out of memory on the live site.
const LONG_TEXT = 20000;
const LONG_TEXT_KEPT = 12;
/** @type {Map<string, string>} */
const foldedLongTexts = new Map();

/**
 * @param {string} text
 * @returns {string}
 */
export function foldedLower(text) {
  if (text.length < LONG_TEXT) return foldLetters(text.toLowerCase());
  let folded = foldedLongTexts.get(text);
  if (folded === undefined) {
    folded = foldLetters(text.toLowerCase());
    if (foldedLongTexts.size >= LONG_TEXT_KEPT) foldedLongTexts.delete(/** @type {string} */ (foldedLongTexts.keys().next().value));
    foldedLongTexts.set(text, folded);
  }
  return folded;
}

// Lower-case a string and split it into alphanumeric "words". Every other character
// (spaces, hyphens, slashes, commas, dots...) is a separator, so "MMT-1885CLW/0076" and
// "mmt 1885clw 0076" produce the same words. Letters with marks are folded first (see above), so "Dräger" gives "draeger"
// and not "dr", "ger". Non-strings give an empty list.
/**
 * @param {unknown} text
 * @returns {string[]}
 */
export function tokenize(text) {
  if (typeof text !== 'string') return [];
  return foldedLower(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// The characters of `text` that are letters or digits, lower-cased, with separators removed.
// Used to judge how "long" an identifier really is ("4-000-0080" -> "40000080").
/**
 * @param {unknown} text
 * @returns {string}
 */
export function compact(text) {
  return tokenize(text).join('');
}

// True if the words of `needle` appear next to each other, in order, as whole words inside
// `haystack`. Whole-word matching stops "N15" matching inside "N150", and "4842" matching
// inside "148421". Both inputs may be a string or an already tokenized list.
// The search expression for a phrase, built once: the same few hundred phrases (the devices' models and serials) are searched in
// thousands of texts.
/** @type {Map<string, RegExp>} */
const phraseExpressions = new Map();
const PHRASE_EXPRESSIONS_KEPT = 20000;

/**
 * @param {string} folded  a text that is already lower-case and folded (see foldedLower)
 * @param {string[]} words
 * @returns {boolean}
 */
export function containsFolded(folded, words) {
  const key = words.join(' ');
  let expression = phraseExpressions.get(key);
  if (!expression) {
    if (phraseExpressions.size >= PHRASE_EXPRESSIONS_KEPT) phraseExpressions.clear();
    expression = new RegExp(`(?<![a-z0-9])${words.join('[^a-z0-9]+')}(?![a-z0-9])`);
    phraseExpressions.set(key, expression);
  }
  return expression.test(folded);
}

/**
 * @param {string | string[]} haystack
 * @param {string | string[]} needle
 * @returns {boolean}
 */
export function containsPhrase(haystack, needle) {
  const words = Array.isArray(needle) ? needle : tokenize(needle);
  if (words.length === 0) return false;
  // A text is searched as text, not split into millions of words first: the same answer (the words next to each other, each whole,
  // with anything that is not a letter or digit between them), without a list of every word of a recall that is 9 MB long.
  if (!Array.isArray(haystack)) return containsFolded(foldedLower(haystack), words);
  const hay = haystack;
  if (hay.length < words.length) return false;
  for (let start = 0; start <= hay.length - words.length; start += 1) {
    let all = true;
    for (let i = 0; i < words.length; i += 1) {
      if (hay[start + i] !== words[i]) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}
