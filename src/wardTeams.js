// Which Teamwork Graph team handles which hospital ward. Saved in Forge storage (one record), edited in
// the panel. The team's NAME is stored beside its id so the panel can show "Team: ICU (from Teamwork
// Graph)" without a graph call every time; it is refreshed whenever the mapping is saved.
//
// `kv` has get(key), set(key, value). No Forge imports, so this is unit tested with plain Node.
import { compact } from './text.js';
import { isTeamAri } from './teamGraph.js';
import { createLock } from './lock.js';

export const WARD_TEAMS_KEY = 'ward-teams';

// Wards are free text from the device list ("ICU", "Med-Surg 3W"). Compared ignoring case, spaces and
// punctuation, so "med surg 3w" and "Med-Surg 3W" are the same ward.
export const wardKey = (ward) => compact(ward);

export const MAX_WARD_LENGTH = 60;

export function createWardTeamStore(kv, nowMs = () => Date.now()) {
  const lock = createLock(kv);
  const mappingsOf = (record) => (record && typeof record === 'object' && record.mappings && typeof record.mappings === 'object' ? record.mappings : {});

  // For showing: a record that cannot be read looks like "no mappings", and the page still works.
  async function load() {
    try {
      return mappingsOf(await kv.get(WARD_TEAMS_KEY));
    } catch (error) {
      return {};
    }
  }

  // For changing: a record that cannot be READ is not an empty one. Writing back "the one mapping just made" would drop the team of
  // every other ward, so the change stops here and nothing is written.
  async function loadForChange() {
    try {
      return mappingsOf(await kv.get(WARD_TEAMS_KEY));
    } catch (error) {
      throw new Error('The ward-to-team record could not be read, so nothing was changed. Please try again.');
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
    if (team !== null && (!team || !isTeamAri(team.ari) || !team.name)) throw new Error('A valid team is required.');
    // The record is read whole and written whole, so two changes at the same moment run one after the other.
    return lock.run('ward-teams', async () => {
      const mappings = await loadForChange();
      if (team === null) {
        delete mappings[wardKey(name)];
      } else {
        mappings[wardKey(name)] = { ward: name, teamAri: team.ari, teamName: String(team.name), savedAt: nowMs() };
      }
      await kv.set(WARD_TEAMS_KEY, { mappings });
      return mappings[wardKey(name)] || null;
    });
  }

  return { list, get, set };
}
