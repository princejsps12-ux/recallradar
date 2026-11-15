// Pure helpers for the openFDA device recall (enforcement) API.
// No Forge imports here so everything can be unit tested with plain Node.

export const OPENFDA_BASE_URL = 'https://api.fda.gov/device/enforcement.json';
export const DEFAULT_LIMIT = 20;
// code_info can list thousands of serial numbers; keep what we send to the UI small.
export const MAX_CODE_INFO_LENGTH = 300;
// Product descriptions can also run to whole paragraphs.
export const MAX_PRODUCT_LENGTH = 200;

// Newest recalls first, by the date FDA published them.
export function buildRecallsUrl(limit = DEFAULT_LIMIT) {
  const n = Math.min(Math.max(Math.trunc(Number(limit)) || DEFAULT_LIMIT, 1), 100);
  return `${OPENFDA_BASE_URL}?sort=report_date:desc&limit=${n}`;
}

// Collapse runs of whitespace (the API has lots of padding) and trim.
export function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

export function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

// openFDA dates look like "20261104". Returns "2026-11-04", or '' if invalid.
export function formatFdaDate(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return '';
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const d = new Date(Date.UTC(year, month - 1, day));
  const valid =
    d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  return valid ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : '';
}

// "Class II" -> "II". Falls back to the cleaned original, or '' if missing.
export function parseClass(value) {
  const text = cleanText(value);
  const match = /^class\s+(i{1,3})$/i.exec(text);
  return match ? match[1].toUpperCase() : text;
}

// Turn one raw openFDA record into the small shape the UI needs.
// Returns null if the record has no recall number (nothing to identify it by).
export function parseRecall(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const recallNumber = cleanText(raw.recall_number);
  if (!recallNumber) return null;
  return {
    recallNumber,
    firm: cleanText(raw.recalling_firm),
    product: truncate(cleanText(raw.product_description), MAX_PRODUCT_LENGTH),
    codeInfo: truncate(cleanText(raw.code_info), MAX_CODE_INFO_LENGTH),
    recallClass: parseClass(raw.classification),
    date: formatFdaDate(raw.report_date),
  };
}

// Parse a full API response body. Records we cannot identify are dropped.
// An empty/unknown shape gives an empty list rather than throwing.
export function parseRecalls(body) {
  const results = body && Array.isArray(body.results) ? body.results : [];
  return results.map(parseRecall).filter(Boolean);
}

// ---------------------------------------------------------------------------------------
// Matching support: full-text parsing and targeted searches
// ---------------------------------------------------------------------------------------

// The "reason for recall" can run to a page; keep enough to explain the problem in plain English.
export const MAX_REASON_LENGTH = 500;

// Same as parseRecall, plus the FULL product and code_info text (the display fields above
// are shortened). Matching needs the full text because a serial number can sit anywhere in a
// list of thousands. Keep these two fields on the server; do not send them to the panel.
export function parseRecallForMatching(raw) {
  const recall = parseRecall(raw);
  if (!recall) return null;
  return {
    ...recall,
    productText: cleanText(raw.product_description),
    codeText: cleanText(raw.code_info),
    // Used to explain a recall (see recallDetails below), not for matching.
    reasonForRecall: truncate(cleanText(raw.reason_for_recall), MAX_REASON_LENGTH),
    status: cleanText(raw.status), // "Ongoing", "Completed" or "Terminated"
    initiated: formatFdaDate(raw.recall_initiation_date),
  };
}

// openFDA returns at most this many records per request without paging. Enough for one
// manufacturer's recalls inside our date window in nearly all cases.
export const MAX_RECALLS_PER_QUERY = 100;

// openFDA's search syntax is "field:term", joined with +AND+ / +OR+, with + standing in
// for a space inside quoted phrases and +TO+ inside ranges.

// Today as an openFDA date: 20261114.
export function formatYmd(date) {
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// The date `days` before `now`, as an openFDA date.
export function daysAgoYmd(now, days) {
  return formatYmd(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
}

// Keep only letters and digits so a user-supplied name can never inject search syntax.
function safeWords(words) {
  return words.map((w) => String(w).toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
}

// field:"word1+word2" -- an exact phrase on one field. Returns '' if there are no usable words.
export function phraseClause(field, words) {
  const safe = safeWords(words);
  return safe.length ? `${field}:"${safe.join('+')}"` : '';
}

function reportDateRange(fromYmd, toYmd) {
  return `report_date:[${fromYmd}+TO+${toYmd}]`;
}

function searchUrl(expression, limit) {
  const n = Math.min(Math.max(Math.trunc(Number(limit)) || MAX_RECALLS_PER_QUERY, 1), MAX_RECALLS_PER_QUERY);
  return `${OPENFDA_BASE_URL}?search=${expression}&sort=report_date:desc&limit=${n}`;
}

// Recalls whose recalling_firm contains these words, inside the date window.
// Returns null if there are no usable words.
export function buildFirmRecallsUrl(firmWords, fromYmd, toYmd, limit = MAX_RECALLS_PER_QUERY) {
  const firm = phraseClause('recalling_firm', firmWords);
  if (!firm) return null;
  return searchUrl(`${firm}+AND+${reportDateRange(fromYmd, toYmd)}`, limit);
}

// Recalls that mention any of these models in the product description or code info, inside
// the date window. `modelWordLists` is a list of word lists, one per model.
// Returns null if there are no usable models.
export function buildModelRecallsUrl(modelWordLists, fromYmd, toYmd, limit = MAX_RECALLS_PER_QUERY) {
  const clauses = modelWordLists
    .map((words) => [phraseClause('product_description', words), phraseClause('code_info', words)])
    .map(([product, code]) => (product && code ? `${product}+OR+${code}` : ''))
    .filter(Boolean);
  if (clauses.length === 0) return null;
  return searchUrl(`(${clauses.join('+OR+')})+AND+${reportDateRange(fromYmd, toYmd)}`, limit);
}
