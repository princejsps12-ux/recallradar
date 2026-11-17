// Serial-number ranges in recall texts: "serial numbers 1000 through 1500", "SN 2001-2500", "serial number < 2224",
// "serial numbers 3000 and above". Real recalls often describe the affected units this way instead of listing them,
// and a device inside such a range used to show up only as "likely".
//
// The one trap is that lot codes look like ranges too ("Lots: 2008-1459; 2011-2331" are single lot codes). So a range is
// only read from text that follows the word "serial" (or "S/N", "SN") and stops before the next "lot": inside a serial
// clause "2001-2500" is a range, anywhere else it is left alone. A range whose end is below its start ("2008-1459") is
// not a range either.
//
// A recall often has several products with a limit each ("Ventilators: serial number < 22241890149; spare parts: serial number
// < 2707658"). So a limit is only applied to a serial with the same number of digits as the limit, and a range to a serial
// whose length lies between the lengths of its ends: a 7-digit part serial is never judged by the 11-digit ventilator limit.
//
// A device's serial is comparable when it is letters (at most four) followed by at least three digits ("AB1500", "2100");
// a serial with letters after the digits or in the middle ("US001A00AW") is not a number and is never judged by a range.
// No Forge imports, so this is unit tested with plain Node.

// Serial numbers shorter than this are too short to judge by "below/above" ("serial < 2224" must not catch a serial "7").
export const MIN_SERIAL_DIGITS = 3;

const SERIAL_WORD = /\b(?:serial(?:\s*(?:numbers?|nos?\.?|#|range))?|s\/n|sn)\b[\s:#.]*/gi;
// A serial clause ends at ";", at a sentence end, at a new line, or where the lot numbers begin.
const CLAUSE_END = /;|\.\s|\n|\blots?\b|\bbatch\b/i;

const PREFIXED_NUMBER = '([A-Za-z]{0,4})[-\\s]?(\\d{3,})';
const RANGE = new RegExp(`(?<![\\w])${PREFIXED_NUMBER}\\s*(?:-|–|—|\\bto\\b|\\bthrough\\b|\\bthru\\b)\\s*${PREFIXED_NUMBER}(?![\\w])`, 'gi');
const BELOW_BEFORE = new RegExp(`(<=|≤|<|less\\s+than(?:\\s+or\\s+equal\\s+to)?|lower\\s+than|below|under|prior\\s+to|before|up\\s+to(?:\\s+and\\s+including)?|through|thru)\\s*${PREFIXED_NUMBER}`, 'gi');
const BELOW_AFTER = new RegExp(`${PREFIXED_NUMBER}\\s*(?:and|or)\\s*(?:below|lower|earlier|less)\\b`, 'gi');
const ABOVE_BEFORE = new RegExp(`(>=|≥|>|greater\\s+than(?:\\s+or\\s+equal\\s+to)?|higher\\s+than|above|over|after|from|starting\\s+(?:at|with|from))\\s*${PREFIXED_NUMBER}`, 'gi');
const ABOVE_AFTER = new RegExp(`${PREFIXED_NUMBER}\\s*(?:and|or)\\s*(?:above|higher|later|greater|up|onwards?)\\b`, 'gi');

const INCLUSIVE_BELOW = /=|≤|equal|including|^up\s+to|^through|^thru/i;
const INCLUSIVE_ABOVE = /=|≥|equal|from|starting/i;

// "AB1500" -> { prefix: 'AB', digits: '1500', n: 1500n }; null when it is not letters-then-digits.
/**
 * @typedef {{ prefix: string, from: bigint, to: bigint, shortest: number, longest: number, text: string }} SerialRange
 * @typedef {{ prefix: string, limit: bigint, digits: number, inclusive: boolean, text: string }} SerialLimit
 * @typedef {{ ranges: SerialRange[], below: SerialLimit[], above: SerialLimit[] }} SerialConstraints
 */

/**
 * @param {unknown} value
 * @returns {{ prefix: string, digits: string, n: bigint } | null}
 */
export function splitSerial(value) {
  if (typeof value !== 'string') return null;
  const m = /^([A-Za-z]{0,4})[-\s]?(\d{3,})$/.exec(value.trim());
  if (!m || m[2].length < MIN_SERIAL_DIGITS) return null;
  return { prefix: m[1].toUpperCase(), digits: m[2], n: BigInt(m[2]) };
}

/** @param {string | undefined} p */
const prefixOf = (p) => (p || '').toUpperCase();
/**
 * @param {string} text
 * @param {RegExp} regex
 */
const stripSpans = (text, regex) => text.replace(regex, (/** @type {string} */ m) => ' '.repeat(m.length));

/**
 * The serial ranges and limits a recall text states: { ranges, below, above } (empty arrays when there are none).
 * Each carries `text`, the words as the recall wrote them, to show in the reason.
 * @param {unknown} text
 * @returns {SerialConstraints}
 */
export function parseSerialConstraints(text) {
  /** @type {SerialConstraints} */
  const out = { ranges: [], below: [], above: [] };
  if (typeof text !== 'string' || text.length === 0) return out;
  for (const word of text.matchAll(SERIAL_WORD)) {
    const after = text.slice(word.index + word[0].length, word.index + word[0].length + 220);
    const end = after.search(CLAUSE_END);
    let clause = end === -1 ? after : after.slice(0, end);

    for (const m of clause.matchAll(RANGE)) {
      const [whole, p1, d1, p2, d2] = m;
      if (p1 && p2 && prefixOf(p1) !== prefixOf(p2)) continue;
      const from = BigInt(d1);
      const to = BigInt(d2);
      if (to <= from) continue; // "2008-1459" is a code, not a range
      out.ranges.push({ prefix: prefixOf(p1 || p2), from, to, shortest: d1.length, longest: d2.length, text: whole.trim() });
    }
    clause = stripSpans(clause, RANGE); // "1000 through 1500" must not also read as "through 1500"

    for (const m of clause.matchAll(BELOW_BEFORE)) out.below.push({ prefix: prefixOf(m[2]), limit: BigInt(m[3]), digits: m[3].length, inclusive: INCLUSIVE_BELOW.test(m[1]), text: m[0].trim() });
    for (const m of clause.matchAll(BELOW_AFTER)) out.below.push({ prefix: prefixOf(m[1]), limit: BigInt(m[2]), digits: m[2].length, inclusive: true, text: m[0].trim() });
    for (const m of clause.matchAll(ABOVE_BEFORE)) out.above.push({ prefix: prefixOf(m[2]), limit: BigInt(m[3]), digits: m[3].length, inclusive: INCLUSIVE_ABOVE.test(m[1]), text: m[0].trim() });
    for (const m of clause.matchAll(ABOVE_AFTER)) out.above.push({ prefix: prefixOf(m[1]), limit: BigInt(m[2]), digits: m[2].length, inclusive: true, text: m[0].trim() });
  }
  return out;
}

/**
 * @param {SerialConstraints | null | undefined} constraints
 * @returns {constraints is SerialConstraints}
 */
export function hasSerialConstraints(constraints) {
  return Boolean(constraints) && /** @type {SerialConstraints} */ (constraints).ranges.length + /** @type {SerialConstraints} */ (constraints).below.length + /** @type {SerialConstraints} */ (constraints).above.length > 0;
}

/**
 * Is this serial inside one of the stated ranges or limits? Returns { text } (the recall's own words for it) or null.
 */
/**
 * @param {unknown} serial
 * @param {SerialConstraints | null | undefined} constraints
 * @returns {{ text: string } | null}
 */
export function serialInConstraints(serial, constraints) {
  const s = splitSerial(serial);
  if (!s || !hasSerialConstraints(constraints)) return null;
  const length = s.digits.length;
  for (const r of constraints.ranges) if (r.prefix === s.prefix && length >= r.shortest && length <= r.longest && s.n >= r.from && s.n <= r.to) return { text: r.text };
  for (const b of constraints.below) if (b.prefix === s.prefix && length === b.digits && (b.inclusive ? s.n <= b.limit : s.n < b.limit)) return { text: b.text };
  for (const a of constraints.above) if (a.prefix === s.prefix && length === a.digits && (a.inclusive ? s.n >= a.limit : s.n > a.limit)) return { text: a.text };
  return null;
}
