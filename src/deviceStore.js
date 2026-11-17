// The hospital's device list sits behind this one small interface, so the rest of the app
// never knows where devices are kept. Today devices live in Forge storage (see kvAdapter.js).
// A read-only import from JSM Assets can later be added as another source that produces the
// same device shape and calls saveDevices / replaceAll.
//
// Device shape (all strings):
//   id            required  unique, e.g. "dev-001"
//   name          required  human name, e.g. "Alaris infusion pump"
//   type          required  kind of device, e.g. "infusion pump" (used by "possible" matches)
//   manufacturer  required  e.g. "Becton Dickinson"
//   model         required  model / catalog number, e.g. "8015"
//   lotOrSerial   optional  lot or serial number of this physical unit ("" if unknown)
//   udiDi         optional  the device's UDI-DI, a GS1 GTIN, stored as 14 digits ("" if unknown). The strongest way to
//                           match a recall: it names the product version exactly, whoever sold it (see udi.js)
//   ward          optional  where it is, e.g. "ICU"
//   source        optional  where the record came from: see DEVICE_SOURCES
//
// This file has no Forge imports so it can be unit tested with plain Node.
import { normalizeDi } from './udi.js';

// Every device is stored under its own key so the list can grow past one storage value's size limit.
export const DEVICE_KEY_PREFIX = 'device:';

export const DEVICE_SOURCES = Object.freeze({
  DEMO: 'demo', // created by "Load demo hospital"
  MANUAL: 'manual', // entered by a user
  ASSETS: 'assets', // imported from JSM Assets (future)
});

// Forge storage accepts at most 25 items per batch call; we write in groups of the same size
// so one big import cannot flood storage with hundreds of parallel requests.
export const WRITE_BATCH_SIZE = 25;

const REQUIRED_FIELDS = ['id', 'name', 'type', 'manufacturer', 'model'];
const OPTIONAL_FIELDS = ['lotOrSerial', 'ward'];

export function deviceKey(id) {
  return `${DEVICE_KEY_PREFIX}${id}`;
}

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Validate and tidy one device. Throws an Error naming the problem, so bad data is rejected
// before anything is written.
export function normalizeDevice(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Device must be an object');
  }
  const device = {};
  for (const field of REQUIRED_FIELDS) {
    const value = asTrimmedString(input[field]);
    if (!value) {
      throw new Error(`Device is missing required field "${field}"`);
    }
    device[field] = value;
  }
  for (const field of OPTIONAL_FIELDS) {
    device[field] = asTrimmedString(input[field]);
  }
  const udi = asTrimmedString(input.udiDi);
  if (udi) {
    const di = normalizeDi(udi, { strict: true });
    if (!di) throw new Error(`Device has an invalid UDI-DI "${udi}" (it must be a GTIN: 8, 12, 13 or 14 digits with a correct check digit)`);
    device.udiDi = di;
  } else {
    device.udiDi = '';
  }
  const source = asTrimmedString(input.source);
  device.source = /** @type {string[]} */ (Object.values(DEVICE_SOURCES)).includes(source) ? source : DEVICE_SOURCES.MANUAL;
  return device;
}

// Normalize a whole list and make sure ids are unique. All-or-nothing: throws before any write.
export function normalizeDevices(inputs) {
  if (!Array.isArray(inputs)) {
    throw new Error('Devices must be an array');
  }
  const devices = inputs.map(normalizeDevice);
  const seen = new Set();
  for (const { id } of devices) {
    if (seen.has(id)) {
      throw new Error(`Duplicate device id "${id}"`);
    }
    seen.add(id);
  }
  return devices;
}

// How many groups of WRITE_BATCH_SIZE run at the same time. 1,000 devices are 40 groups: one after another that is slow enough to
// come near the 25-second limit of a resolver, so a few run together (100 requests in flight at most).
export const WRITE_CONCURRENCY = 4;

async function inBatches(items, size, worker) {
  const step = size * WRITE_CONCURRENCY;
  for (let i = 0; i < items.length; i += step) {
    const slice = items.slice(i, i + step);
    const groups = [];
    for (let j = 0; j < slice.length; j += size) groups.push(Promise.all(slice.slice(j, j + size).map(worker)));
    await Promise.all(groups);
  }
}

// `kv` is any object with:
//   set(key, value)            -> Promise
//   delete(key)                -> Promise
//   listByPrefix(prefix)       -> Promise<Array<{ key, value }>>
export function createDeviceStore(kv) {
  async function listDevices() {
    const items = await kv.listByPrefix(DEVICE_KEY_PREFIX);
    return items.map((item) => item.value).sort((a, b) => a.id.localeCompare(b.id));
  }

  async function saveDevices(inputs) {
    const devices = normalizeDevices(inputs);
    await inBatches(devices, WRITE_BATCH_SIZE, (device) => kv.set(deviceKey(device.id), device));
    return devices.length;
  }

  async function clear() {
    const items = await kv.listByPrefix(DEVICE_KEY_PREFIX);
    await inBatches(items, WRITE_BATCH_SIZE, (item) => kv.delete(item.key));
    return items.length;
  }

  // Delete the devices with these ids (the ones not in a new import). Returns how many were removed.
  async function removeDevices(ids) {
    const wanted = new Set(ids);
    const items = (await kv.listByPrefix(DEVICE_KEY_PREFIX)).filter((item) => item.value && wanted.has(item.value.id));
    await inBatches(items, WRITE_BATCH_SIZE, (item) => kv.delete(item.key));
    return items.length;
  }

  // Delete only the devices that came from one source (e.g. just the demo ones) and leave the
  // rest untouched. Returns how many were removed.
  async function removeBySource(source) {
    const items = await kv.listByPrefix(DEVICE_KEY_PREFIX);
    const matching = items.filter((item) => item.value && item.value.source === source);
    await inBatches(matching, WRITE_BATCH_SIZE, (item) => kv.delete(item.key));
    return matching.length;
  }

  // Replace the whole device list. Input is validated first, so invalid data never wipes
  // the existing list.
  async function replaceAll(inputs) {
    const devices = normalizeDevices(inputs);
    await clear();
    await saveDevices(devices);
    return devices.length;
  }

  return { listDevices, saveDevices, clear, removeBySource, removeDevices, replaceAll };
}
