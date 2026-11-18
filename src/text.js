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
  return foldLetters(text.toLowerCase())
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
/**
 * @param {string | string[]} haystack
 * @param {string | string[]} needle
 * @returns {boolean}
 */
export function containsPhrase(haystack, needle) {
  const hay = Array.isArray(haystack) ? haystack : tokenize(haystack);
  const words = Array.isArray(needle) ? needle : tokenize(needle);
  if (words.length === 0 || hay.length < words.length) return false;
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
