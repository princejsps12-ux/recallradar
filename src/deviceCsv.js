// Turns pasted spreadsheet text (comma or tab separated, first row = column names) into devices, so a
// hospital can load its OWN device list. All-or-nothing: if any row is wrong nothing is imported, and every
// problem is listed with its line number, so the person fixes the sheet once and pastes again.
// No Forge imports, so this is unit tested with plain Node.
import { compact } from './text.js';
import { DEVICE_SOURCES } from './deviceStore.js';
import { normalizeDi } from './udi.js';

// An import is written in batches of 25 (four batches at a time) and a UI function is cut off at 25 s, so one paste stays bounded:
// 1,000 devices at most. Only what CHANGED is written (see importDevices), so re-pasting a list with a few edits is quick.
// A paste replaces the earlier pasted list.
export const MAX_IMPORT_ROWS = 1000;
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
  // The UDI-DI printed on the device label (a GS1 GTIN). Optional, and the strongest way to match a recall.
  udiDi: ['udi', 'udidi', 'di', 'gtin', 'deviceidentifier', 'udideviceidentifier'],
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

export function fieldFor(header) {
  const key = compact(header);
  return Object.keys(COLUMN_ALIASES).find((field) => COLUMN_ALIASES[field].includes(key)) || null;
}

// A device's id comes from WHAT IT IS (maker, model and serial; for a unit with no serial also its ward and name), not from its place
// in the paste. Tasks are labelled with the device id, so a re-import in another order, or with rows added or removed, must give the
// same device the same id or its tasks would attach to the wrong device (or to none). Two identical rows get -2, -3... in the order
// they appear. The id is `own-` and 8 hex digits of a 32-bit FNV-1a hash.
/** @param {string} text */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * @param {Array<{ manufacturer: string, model: string, lotOrSerial: string, ward: string, name: string }>} rows
 * @returns {string[]} one id per row, in the same order
 */
export function stableDeviceIds(rows) {
  /** @type {Map<string, string>} id -> the identity text that owns it */
  const owner = new Map();
  /** @type {Map<string, number>} identity text -> how many rows had it so far */
  const seen = new Map();
  return rows.map((row) => {
    const identity = [row.manufacturer, row.model, row.lotOrSerial, row.lotOrSerial ? '' : row.ward, row.lotOrSerial ? '' : row.name].map(compact).join('|');
    const n = (seen.get(identity) || 0) + 1;
    seen.set(identity, n);
    const base = `own-${fnv1a(identity)}`;
    // two different devices that happen to share a hash (about 1 in 4 billion) must not share an id either
    let id = n === 1 ? base : `${base}-${n}`;
    for (let clash = 2; owner.has(id) && owner.get(id) !== `${identity}#${n}`; clash += 1) id = `${base}-c${clash}`;
    owner.set(id, `${identity}#${n}`);
    return id;
  });
}

const SAME_FIELDS = ['name', 'type', 'manufacturer', 'model', 'lotOrSerial', 'ward', 'udiDi', 'source'];
/**
 * @param {Record<string, any> | undefined} a
 * @param {Record<string, any>} b
 */
function sameDevice(a, b) {
  return Boolean(a) && SAME_FIELDS.every((field) => (a && a[field]) === b[field] || ((a && a[field]) || '') === (b[field] || ''));
}

// Returns { devices, errors }. Ids are stable (see stableDeviceIds); source is "manual".
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
    if (row.udiDi && !normalizeDi(row.udiDi, { strict: true })) problems.push(`UDI-DI "${row.udiDi}" is not a valid GTIN (8, 12, 13 or 14 digits with a correct check digit)`);
    for (const [field, value] of Object.entries(row)) {
      if (value.length > MAX_FIELD_LENGTH) problems.push(`${field} is longer than ${MAX_FIELD_LENGTH} characters`);
    }
    if (problems.length) {
      errors.push(`Line ${number}: ${problems.join(', ')}.`);
      return;
    }
    devices.push({
      id: '',
      name: row.name || `${row.manufacturer} ${row.model}`,
      type: row.type || 'medical device',
      manufacturer: row.manufacturer,
      model: row.model,
      lotOrSerial: row.lotOrSerial || '',
      ward: row.ward || '',
      udiDi: row.udiDi ? normalizeDi(row.udiDi, { strict: true }) : '',
      source: DEVICE_SOURCES.MANUAL,
    });
  });
  const ids = stableDeviceIds(devices);
  devices.forEach((device, i) => {
    device.id = ids[i];
  });
  if (errors.length > MAX_ERRORS_SHOWN) {
    const more = errors.length - MAX_ERRORS_SHOWN;
    errors.splice(MAX_ERRORS_SHOWN, errors.length, `...and ${more} more.`);
  }
  return errors.length ? { devices: [], errors } : { devices, errors: [] };
}

// --- The preview -----------------------------------------------------------------------------------------------------

// A paste is read before anything is imported, so the person sees what RecallRadar understood: which of their columns became
// which field, and the first rows as devices. It changes nothing and stores nothing.
export const PREVIEW_ROWS = 5;
// The longest paste the preview reads. 1,000 rows of about 100 characters is 100 KB (the worst case, every field at its 120-character
// limit in 7 columns, is 840 KB); more than this is refused without parsing it, so a huge paste cannot make the server work for nothing.
export const MAX_PREVIEW_TEXT = 600 * 1000;

export const FIELD_LABELS = { name: 'Name', type: 'Type', manufacturer: 'Manufacturer', model: 'Model', lotOrSerial: 'Serial or lot', ward: 'Ward', udiDi: 'UDI-DI' };

/**
 * @param {unknown} text
 * @returns {{ valid: boolean, count: number, rows: Array<Record<string, string>>, columns: Array<{ header: string, field: string | null, label: string }>, errors: string[], withoutUdi: number }}
 *   valid    true when the paste would import (no problems); the resolver's own `ok` means only that the question was answered
 *   rows     the first PREVIEW_ROWS devices as they would be imported: { name, manufacturer, model, lotOrSerial, ward, udiDi }
 *   columns  how each pasted header was read: { header, field, label }; label is '' for one that is ignored (a column RecallRadar
 *            has no use for, or a second column for a field that already has one)
 *   errors   the same line-numbered problems the import would give; with any, nothing would be imported
 */
export function previewDeviceCsv(text) {
  const raw = String(text || '');
  if (raw.length > MAX_PREVIEW_TEXT) {
    return { valid: false, count: 0, rows: [], columns: [], errors: [`That is too much text for one paste. Paste at most ${MAX_IMPORT_ROWS} devices at a time.`], withoutUdi: 0 };
  }
  const { devices, errors } = parseDeviceCsv(raw);
  const firstLine = raw.split(/\r?\n/).find((line) => line.trim() !== '');
  const seen = new Set();
  const columns = firstLine
    ? splitLine(firstLine, detectDelimiter(firstLine)).map((header) => {
        const field = fieldFor(header);
        const used = field && !seen.has(field);
        if (used) seen.add(field);
        return { header: header.slice(0, 40), field: used ? field : null, label: used ? FIELD_LABELS[field] : '' };
      })
    : [];
  return {
    valid: errors.length === 0,
    count: devices.length,
    rows: devices.slice(0, PREVIEW_ROWS).map(({ name, manufacturer, model, lotOrSerial, ward, udiDi }) => ({ name, manufacturer, model, lotOrSerial, ward, udiDi })),
    columns,
    errors,
    withoutUdi: devices.filter((device) => !device.udiDi).length,
  };
}

// Replace the earlier pasted list (manual devices) with this one; demo devices are left alone.
// Returns { ok: true, count } or { ok: false, errors }.
export async function importDevices(store, text) {
  const { devices, errors } = parseDeviceCsv(text);
  if (errors.length) return { ok: false, errors };
  // Replace the earlier pasted list, but touch only what differs: devices no longer in the paste are deleted, new or edited ones
  // are written, identical ones are left alone. Ids are stable (stableDeviceIds), so a re-paste in another order changes nothing.
  const existing = (await store.listDevices()).filter((device) => device.source === DEVICE_SOURCES.MANUAL);
  const keep = new Set(devices.map((device) => device.id));
  const byId = new Map(existing.map((device) => [device.id, device]));
  const gone = existing.filter((device) => !keep.has(device.id)).map((device) => device.id);
  const changed = devices.filter((device) => !byId.has(device.id) || !sameDevice(byId.get(device.id), device));
  if (gone.length) await store.removeDevices(gone);
  if (changed.length) await store.saveDevices(changed);
  return { ok: true, count: devices.length };
}
