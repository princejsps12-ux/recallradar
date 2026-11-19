// A read-only import of devices from Jira Service Management Assets: the person picks an object type (for example "Medical devices"),
// RecallRadar reads its objects and attributes, matches the attribute names to its own fields the same way the pasted spreadsheet's
// column names are matched, and hands the rows to the SAME import as a paste (deviceCsv.js: preview, all-or-nothing, stable ids).
// Nothing is ever written to Assets. `request(path, options)` is Jira's requestJira as the signed-in person and `route` Forge's route
// tag (both injected, so this is unit tested with a fake); the ids put into a route are single path segments.
import { fieldFor, FIELD_LABELS, MAX_IMPORT_ROWS, MAX_FIELD_LENGTH } from './deviceCsv.js';

export const ASSETS_PAGE_SIZE = 100;
/** Pages read at most: the import stops at MAX_IMPORT_ROWS + 1 objects (one more than allowed, so the all-or-nothing check can refuse). */
const MAX_PAGES = Math.ceil((MAX_IMPORT_ROWS + 1) / ASSETS_PAGE_SIZE);

// The header RecallRadar writes for each field, one the pasted-spreadsheet reader knows.
const CANONICAL_HEADER = { name: 'Name', type: 'Type', manufacturer: 'Manufacturer', model: 'Model', lotOrSerial: 'Serial', ward: 'Ward', udiDi: 'UDI' };

export class AssetsError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** A sentence for the person: what went wrong reading Assets and what to do. */
export function friendlyAssetsError(error) {
  const status = error && /** @type {any} */ (error).status;
  if (status === 401) return 'Jira did not accept RecallRadar\'s request to read Assets. A site administrator may need to approve the new permissions (Apps, Manage apps, RecallRadar).';
  if (status === 403) return 'You do not have permission to read Assets here. Ask an Assets administrator to give you view access to the object type, or paste the devices instead.';
  if (status === 404) return 'Assets was not found on this site (it needs Jira Service Management Premium or Enterprise, or an Assets-enabled plan). You can still paste the devices.';
  return `Could not read Assets${status ? ` (Jira answered ${status})` : ''}. Please try again, or paste the devices instead.`;
}

export function createAssetsClient({ request, route }) {
  async function get(response) {
    if (!response.ok) throw new AssetsError(`Assets answered ${response.status}`, response.status);
    return response.json();
  }
  /** @type {string | null} */
  let workspace = null;
  async function workspaceId() {
    if (workspace) return workspace;
    const body = await get(await request(route`/rest/servicedeskapi/assets/workspace`, { headers: { Accept: 'application/json' } }));
    const id = body && body.values && body.values[0] && body.values[0].workspaceId;
    if (!id) throw new AssetsError('This site has no Assets workspace.', 404);
    workspace = String(id);
    return workspace;
  }
  const json = { headers: { Accept: 'application/json' } };

  return {
    // [{ id, name, objectCount }] of the schemas the person can see.
    async schemas() {
      const wid = await workspaceId();
      const body = await get(await request(route`/jsm/assets/workspace/${wid}/v1/objectschema/list`, json));
      return (body.values || []).map((s) => ({ id: String(s.id), name: String(s.displayName || s.name || s.id), objectCount: Number(s.objectCount) || 0 }));
    },
    // [{ id, name, objectCount }] of one schema's object types.
    async objectTypes(schemaId) {
      const wid = await workspaceId();
      const body = await get(await request(route`/jsm/assets/workspace/${wid}/v1/objectschema/${String(schemaId)}/objecttypes/flat`, json));
      return (Array.isArray(body) ? body : body.values || []).map((t) => ({ id: String(t.id), name: String(t.name || t.id), objectCount: Number(t.objectCount) || 0 }));
    },
    // [{ id, name }] of one object type's attributes.
    async attributes(typeId) {
      const wid = await workspaceId();
      const body = await get(await request(route`/jsm/assets/workspace/${wid}/v1/objecttype/${String(typeId)}/attributes`, json));
      return (Array.isArray(body) ? body : body.values || []).map((a) => ({ id: String(a.id), name: String(a.name || a.label || a.id) }));
    },
    // The objects of one type: { objects, total, truncated }. At most MAX_IMPORT_ROWS + 1 are read.
    async objects(typeId) {
      const wid = await workspaceId();
      const objects = [];
      let total = 0;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const startAt = page * ASSETS_PAGE_SIZE;
        const response = await request(route`/jsm/assets/workspace/${wid}/v1/object/aql?startAt=${startAt}&maxResults=${ASSETS_PAGE_SIZE}&includeAttributes=true`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ qlQuery: `objectTypeId = ${Number(typeId)}` }),
        });
        const body = await get(response);
        const values = body.values || [];
        total = Number(body.total) || startAt + values.length;
        objects.push(...values);
        if (values.length < ASSETS_PAGE_SIZE || objects.length >= total) break;
      }
      return { objects: objects.slice(0, MAX_IMPORT_ROWS + 1), total, truncated: total > MAX_IMPORT_ROWS + 1 };
    },
  };
}

// --- Pure part -------------------------------------------------------------------------------------------------------------------

/**
 * Which attribute feeds which field: the attribute's NAME is read like a spreadsheet's column header ("Serial Number", "Maker", "Location").
 * A field is fed by the first attribute with a matching name; later ones are ignored, as in the paste. The object's own name (its label)
 * is the device name unless an attribute already gives one.
 * @param {{ id: string, name: string }[]} attributes
 * @returns {{ byAttribute: Map<string, string>, columns: { attribute: string, field: string | null, label: string }[], labelIsName: boolean }}
 */
export function mapAttributes(attributes) {
  const byAttribute = new Map();
  const used = new Set();
  const columns = attributes.map((a) => {
    const field = fieldFor(a.name);
    if (field && !used.has(field)) {
      used.add(field);
      byAttribute.set(a.id, field);
      return { attribute: a.name, field, label: FIELD_LABELS[field] };
    }
    return { attribute: a.name, field: null, label: '' };
  });
  return { byAttribute, columns, labelIsName: !used.has('name') };
}

const clean = (value) => String(value == null ? '' : value).replace(/[\t\r\n]+/g, ' ').trim().slice(0, MAX_FIELD_LENGTH);

/**
 * The objects of one type as tab-separated text the pasted-spreadsheet reader understands (first row = headers).
 * @param {{ id: string, name: string }[]} attributes
 * @param {{ label?: string, attributes?: { objectTypeAttributeId: string | number, objectAttributeValues?: { value?: unknown, displayValue?: unknown }[] }[] }[]} objects
 */
export function objectsToTsv(attributes, objects) {
  const { byAttribute, labelIsName } = mapAttributes(attributes);
  const fields = [...new Set(byAttribute.values())];
  if (labelIsName) fields.unshift('name');
  const header = fields.map((f) => CANONICAL_HEADER[f]);
  const lines = [header.join('\t')];
  for (const object of objects) {
    const values = {};
    if (labelIsName) values.name = clean(object.label);
    for (const attribute of object.attributes || []) {
      const field = byAttribute.get(String(attribute.objectTypeAttributeId));
      if (!field) continue;
      const first = (attribute.objectAttributeValues || [])[0];
      // A reference (a location, a vendor) carries the other object's name as its display value; plain text only a value.
      values[field] = clean(first && (first.displayValue != null && first.displayValue !== '' ? first.displayValue : first.value));
    }
    lines.push(fields.map((f) => values[f] || '').join('\t'));
  }
  return lines.join('\n');
}

/**
 * Read one object type and return what the import needs: the text, how the attributes were read, and how many objects there are.
 * @param {ReturnType<typeof createAssetsClient>} client
 * @param {string} typeId
 */
export async function readAssetsDevices(client, typeId) {
  const attributes = await client.attributes(typeId);
  const { objects, total, truncated } = await client.objects(typeId);
  return { text: objectsToTsv(attributes, objects), columns: mapAttributes(attributes).columns, total, truncated };
}
