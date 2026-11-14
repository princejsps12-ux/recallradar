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
