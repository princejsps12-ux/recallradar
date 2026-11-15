// Turns pasted spreadsheet text (comma or tab separated, first row = column names) into devices, so a
// hospital can load its OWN device list. All-or-nothing: if any row is wrong nothing is imported, and every
// problem is listed with its line number, so the person fixes the sheet once and pastes again.
// No Forge imports, so this is unit tested with plain Node.
import { compact } from './text.js';
import { DEVICE_SOURCES } from './deviceStore.js';

// An import is written in batches of 25 and a UI function is cut off at 25 s, so one paste stays small.
// A larger hospital imports in several pastes (each import ADDS to the manual devices only when
// `mode` is "add"; by default it replaces the earlier pasted list).
export const MAX_IMPORT_ROWS = 200;
export const MAX_FIELD_LENGTH = 120;
export const MAX_ERRORS_SHOWN = 8;

// Column names people actually use, mapped to our fields. Compared with compact() (case, spaces and
// punctuation ignored), so "Serial / Lot #" and "serial_lot" both work.
const COLUMN_ALIASES = {
  name: ['name', 'device', 'devicename', 'description', 'asset'],
  type: ['type', 'kind', 'category', 'devicetype'],
  manufacturer: ['manufacturer', 'maker', 'make', 'vendor', 'brand', 'firm'],
  model: ['model', 'modelnumber', 'modelno', 'catalog', 'catalognumber', 'catalogno', 'partnumber'],
  lotOrSerial: ['serial', 'lot', 'serialnumber', 'lotnumber', 'seriallot', 'lotserial', 'lotorserial', 'serialno'],
  ward: ['ward', 'location', 'unit', 'department', 'room', 'area'],
};

// Split one line into cells. Handles "quoted, cells" and doubled quotes inside them.
export function splitLine(line, delimiter) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      cells.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

// A pasted spreadsheet uses tabs; a saved .csv uses commas.
export function detectDelimiter(headerLine) {
  return headerLine.includes('\t') ? '\t' : ',';
}

function fieldFor(header) {
  const key = compact(header);
  return Object.keys(COLUMN_ALIASES).find((field) => COLUMN_ALIASES[field].includes(key)) || null;
}

// Returns { devices, errors }. Ids are own-001, own-002...; source is "manual".
export function parseDeviceCsv(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line.trim() !== '');
  if (lines.length === 0) return { devices: [], errors: ['Paste your device list first: one row per device, with a header row.'] };

  const delimiter = detectDelimiter(lines[0].line);
  const columns = splitLine(lines[0].line, delimiter).map(fieldFor);
  const errors = [];
  for (const need of ['manufacturer', 'model']) {
    if (!columns.includes(need)) errors.push(`The header row needs a "${need}" column (found: ${splitLine(lines[0].line, delimiter).join(', ') || 'nothing'}).`);
  }
  if (errors.length) return { devices: [], errors };

  const rows = lines.slice(1);
  if (rows.length === 0) return { devices: [], errors: ['There is a header row but no devices under it.'] };
  if (rows.length > MAX_IMPORT_ROWS) return { devices: [], errors: [`Too many rows (${rows.length}). Paste at most ${MAX_IMPORT_ROWS} devices at a time.`] };

  const devices = [];
  rows.forEach(({ line, number }, index) => {
    const cells = splitLine(line, delimiter);
    const row = {};
    columns.forEach((field, i) => {
      if (field && !(field in row)) row[field] = cells[i] || '';
    });
    const problems = [];
    if (!row.manufacturer) problems.push('manufacturer is empty');
    if (!row.model) problems.push('model is empty');
    for (const [field, value] of Object.entries(row)) {
      if (value.length > MAX_FIELD_LENGTH) problems.push(`${field} is longer than ${MAX_FIELD_LENGTH} characters`);
    }
    if (problems.length) {
      errors.push(`Line ${number}: ${problems.join(', ')}.`);
      return;
    }
    devices.push({
      id: `own-${String(index + 1).padStart(3, '0')}`,
      name: row.name || `${row.manufacturer} ${row.model}`,
      type: row.type || 'medical device',
      manufacturer: row.manufacturer,
      model: row.model,
      lotOrSerial: row.lotOrSerial || '',
      ward: row.ward || '',
      source: DEVICE_SOURCES.MANUAL,
    });
  });
  if (errors.length > MAX_ERRORS_SHOWN) {
    const more = errors.length - MAX_ERRORS_SHOWN;
    errors.splice(MAX_ERRORS_SHOWN, errors.length, `...and ${more} more.`);
  }
  return errors.length ? { devices: [], errors } : { devices, errors: [] };
}

// Replace the earlier pasted list (manual devices) with this one; demo devices are left alone.
// Returns { ok: true, count } or { ok: false, errors }.
export async function importDevices(store, text) {
  const { devices, errors } = parseDeviceCsv(text);
  if (errors.length) return { ok: false, errors };
  await store.removeBySource(DEVICE_SOURCES.MANUAL);
  const count = await store.saveDevices(devices);
  return { ok: true, count };
}
