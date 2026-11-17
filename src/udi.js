// UDI (Unique Device Identification) support: the device identifier (UDI-DI, a GS1 GTIN) is the one number that says
// exactly which product version a device is, whoever sold it. FDA recall texts list it in several shapes, all seen in
// real openFDA records:
//
//   (01)00884838085282(21)209            GS1 element string: GTIN, then serial (21), lot (10), expiry (17)
//   UDI: (01)00885825017231/ Lots: ...   the same, after a label
//   UDI-DI: 10889942499953(each), 40889942499954(case)    labelled list with a package level in brackets
//   GTIN: 00840682123129, 00195278117021                    labelled list
//   UDI-DI 848838001796                                      12 digits (UPC-A): the same GTIN without leading zeros
//
// A GTIN is 8, 12, 13 or 14 digits. They are all compared as 14 digits with leading zeros, the way GS1 defines it.
// No Forge imports, so this is unit tested with plain Node.

// The GS1 check digit (the last digit): weights 3 and 1 from the right, the sum rounded up to a multiple of ten.
/**
 * @param {string} digits
 * @returns {boolean}
 */
export function gs1CheckDigitValid(digits) {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

// "(01)00884838085282", "0088 4838 0852 82", "884838085282" -> "00884838085282". Anything that is not a GTIN of 8, 12, 13
// or 14 digits gives null. With `strict` the check digit must be right too (used for a person's own device list, where
// a typo should be caught at import; recall texts are compared without it because they contain typos of their own).
/**
 * @param {unknown} value
 * @param {{ strict?: boolean }} [options]
 * @returns {string | null}
 */
export function normalizeDi(value, { strict = false } = {}) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  let text = String(value).trim();
  const element = /\(01\)\s*([\d\s-]+)/.exec(text);
  if (element) text = element[1];
  const digits = text.replace(/[\s-]/g, '');
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return null;
  if (strict && !gs1CheckDigitValid(digits)) return null;
  return digits.padStart(14, '0');
}

// The forms a GTIN is written in inside recall texts: 14 digits, or with one or two leading zeros dropped (13, 12).
// Used to build the openFDA search, which compares text, not numbers.
/**
 * @param {unknown} di
 * @returns {string[]}
 */
export function diVariants(di) {
  const full = normalizeDi(di);
  if (!full) return [];
  const variants = [full];
  for (const drop of [1, 2]) {
    const shorter = full.slice(drop);
    if (/^\d{12,13}$/.test(shorter) && full.slice(0, drop) === '0'.repeat(drop)) variants.push(shorter);
  }
  return variants;
}

// A GS1 element string: (01) GTIN, then any of (10) lot, (21) serial, (17) expiry, (11) production date.
const ELEMENT_STRING = /\(01\)\s*(\d{8,14})((?:\s*\((?:10|11|17|21|240)\)\s*[^\s,;/()]*)*)/g;
const AI_VALUE = /\((10|21)\)\s*([^\s,;/()]*)/g;

// A label that introduces identifiers: "UDI-DI", "UDI/DI", "UDI", "GTIN", "UDI-DI/GTIN", "Device Identifier", "DI:", with an
// optional "code" or "number" after it ("UDI-DI code: 00619498003259"), then ":", "#", "=" or a dash ("UDI - 04037691643526",
// as in the real Maquet recall Z-0420-2024).
const LABEL = /(?:\b(?:udi[-\s/]?di|udi|gtin|device identifier)(?:\s*\/\s*(?:gtin|udi|di))?|\bdi(?=\s*:))(?:\s+(?:codes?|numbers?|nos?\.?))?\s*(?:\([^)]{0,30}\))?\s*[:#=\u2013\u2014-]?\s*/gi;
// Then one or more numbers, each optionally followed by a package level in brackets, separated by , ; / & or "and".
const LABELLED_NUMBER = /^(\d{8,14})\b(?:\s*\((?:each|case|box|pack|carton|unit|inner|outer|pallet)[^)]{0,10}\))?\s*(?:[,;/&]|\band\b)?\s*/i;

// Pairs written without any label, as in "MMT-1885CLW/00763000442187, 00763000974374/NG3150737H": <DI>/<serial> and
// <model>/<DI>. Digits next to a slash are only taken for a DI when the GS1 check digit is right (a random number passes one
// time in ten, and it must also sit next to a slash).
const DI_SLASH_SERIAL = /(?<![\w])(\d{12,14})\/([A-Za-z0-9][A-Za-z0-9-]{2,})/g;
const MODEL_SLASH_DI = /(?<![\w])([A-Za-z0-9][A-Za-z0-9-]{1,})\/(\d{12,14})(?![\w])/g;

/**
 * Every UDI-DI named in a recall's code text, as { di (14 digits), serials, lots }.
 * `serials` and `lots` are the numbers the text ties to that DI: (01)GTIN(21)serial, (01)GTIN(10)lot, or <DI>/<serial>.
 * @param {unknown} text
 * @returns {Array<{ di: string, serials: string[], lots: string[] }>}
 */
export function extractUdis(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  /** @type {Map<string, { di: string, serials: Set<string>, lots: Set<string> }>} */
  const found = new Map();
  /**
   * @param {string} di
   * @param {string} serial
   * @param {string} lot
   */
  const note = (di, serial, lot) => {
    const entry = found.get(di) || { di, serials: new Set(), lots: new Set() };
    if (serial) entry.serials.add(serial);
    if (lot) entry.lots.add(lot);
    found.set(di, entry);
  };

  for (const m of text.matchAll(ELEMENT_STRING)) {
    const di = normalizeDi(m[1]);
    if (!di) continue;
    let serial = '';
    let lot = '';
    for (const ai of (m[2] || '').matchAll(AI_VALUE)) {
      if (ai[1] === '21') serial = ai[2];
      else lot = ai[2];
    }
    note(di, serial, lot);
  }

  for (const label of text.matchAll(LABEL)) {
    let rest = text.slice(label.index + label[0].length);
    // (01) element strings after the label were read above; plain numbers are read here.
    for (let guard = 0; guard < 60; guard += 1) {
      const n = LABELLED_NUMBER.exec(rest);
      if (!n) break;
      const di = normalizeDi(n[1]);
      if (di) note(di, '', '');
      rest = rest.slice(n[0].length);
    }
  }
  for (const m of text.matchAll(DI_SLASH_SERIAL)) {
    const di = normalizeDi(m[1], { strict: true });
    if (di) note(di, m[2], '');
  }
  for (const m of text.matchAll(MODEL_SLASH_DI)) {
    const di = normalizeDi(m[2], { strict: true });
    if (di) note(di, '', '');
  }
  return [...found.values()].map(({ di, serials, lots }) => ({ di, serials: [...serials], lots: [...lots] }));
}
