// Which Teamwork Graph team handles which hospital ward. Saved in Forge storage (one record), edited in
// the panel. The team's NAME is stored beside its id so the panel can show "Team: ICU (from Teamwork
// Graph)" without a graph call every time; it is refreshed whenever the mapping is saved.
//
// `kv` has get(key), set(key, value). No Forge imports, so this is unit tested with plain Node.
import { compact } from './text.js';
import { isTeamAri } from './teamGraph.js';

export const WARD_TEAMS_KEY = 'ward-teams';

// Wards are free text from the device list ("ICU", "Med-Surg 3W"). Compared ignoring case, spaces and
// punctuation, so "med surg 3w" and "Med-Surg 3W" are the same ward.
export const wardKey = (ward) => compact(ward);

export const MAX_WARD_LENGTH = 60;

export function createWardTeamStore(kv, nowMs = () => Date.now()) {
  async function load() {
    try {
      const record = await kv.get(WARD_TEAMS_KEY);
      return record && typeof record === 'object' && record.mappings && typeof record.mappings === 'object' ? record.mappings : {};
    } catch (error) {
      return {};
    }
  }

  // Every mapping, as an array sorted by ward name.
  async function list() {
    return Object.values(await load()).sort((a, b) => a.ward.localeCompare(b.ward));
  }

  async function get(ward) {
    return (await load())[wardKey(ward)] || null;
  }

  // Map a ward to a team ({ ari, name }), or remove the mapping with team = null.
  async function set(ward, team) {
    const name = typeof ward === 'string' ? ward.trim() : '';
    if (!name || !wardKey(name) || name.length > MAX_WARD_LENGTH) throw new Error('A ward name is required (at most 60 characters).');
    const mappings = await load();
    if (team === null) {
      delete mappings[wardKey(name)];
    } else {
      if (!team || !isTeamAri(team.ari) || !team.name) throw new Error('A valid team is required.');
      mappings[wardKey(name)] = { ward: name, teamAri: team.ari, teamName: String(team.name), savedAt: nowMs() };
    }
    await kv.set(WARD_TEAMS_KEY, { mappings });
    return mappings[wardKey(name)] || null;
  }

  return { list, get, set };
}
