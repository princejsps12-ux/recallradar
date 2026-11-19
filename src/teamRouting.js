// Routing a new task to the team that owns the ward, and escalating when that team is already swamped.
//
// A Jira task cannot be assigned to a team, only to a person, and the app assigns nobody unless a person asked (see teamService.js).
// So routing means: the task is LABELLED for the owning team (a board or filter per team: `labels = recallradar-team-<name>`) and
// says so in its description. Escalation is the same, louder: when the team already has more open RecallRadar tasks than it can
// take, the new task also carries the label `recallradar-escalated` and its description says why, so a lead can rebalance.
// The ward-to-team mapping is the one a person made on the Ward teams tab (Teamwork Graph team, read-only); nothing about a person is
// stored or written here, only the team's name.
import { pairKey } from './taskRules.js';

/** Open RecallRadar tasks one team may hold before new ones are escalated. A ward team of a few people cannot work more than about
 *  this many Class I/II recall tasks at once (Class I is due in 2 days), and the number is a setting-sized constant, not a guess
 *  per site: change it here and in docs/TASKS.md together. */
export const TEAM_OPEN_TASK_LIMIT = 10;

export const TEAM_LABEL_PREFIX = 'recallradar-team-';
export const ESCALATED_LABEL = 'recallradar-escalated';

/** Jira labels have no spaces: "Team Atlas" -> "recallradar-team-team-atlas". */
export function teamLabel(teamName) {
  const slug = String(teamName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return slug ? `${TEAM_LABEL_PREFIX}${slug}` : '';
}

/**
 * @param {{ store: { get(ward: string): Promise<{ teamName: string } | null> }, countOpen: (label: string) => Promise<number>, limit?: number }} deps
 *   `countOpen(label)` is how many tasks with that label are not done yet.
 * @returns {{ route(matches: object[]): Promise<Map<string, { teamName: string, label: string, open: number, escalated: boolean, limit: number }>> }}
 */
export function createTeamRouter({ store, countOpen, limit = TEAM_OPEN_TASK_LIMIT }) {
  return {
    // Pair key -> route, for the matches whose ward has a team. Wards without a team get nothing (the task is created as before).
    // The count is read once per team, and the tasks planned in THIS batch count too, so "create all 40" for one team escalates the
    // ones beyond the limit instead of all of them looking fine against an empty board.
    async route(matches) {
      const routes = new Map();
      const open = new Map();
      const planned = new Map();
      for (const match of matches) {
        const mapping = match.ward ? await store.get(match.ward) : null;
        const label = mapping ? teamLabel(mapping.teamName) : '';
        if (!mapping || !label) continue;
        if (!open.has(label)) {
          let count = 0;
          try {
            count = await countOpen(label);
          } catch (error) {
            count = 0; // no load data: route without escalating, never block a task
          }
          open.set(label, count);
        }
        const before = open.get(label) + (planned.get(label) || 0);
        planned.set(label, (planned.get(label) || 0) + 1);
        routes.set(pairKey(match.recallNumber, match.deviceId), { teamName: mapping.teamName, label, open: before, escalated: before >= limit, limit });
      }
      return routes;
    },
  };
}
