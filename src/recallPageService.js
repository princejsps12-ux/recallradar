// Creates (or updates) the Confluence page for each open recall that affects the hospital's devices.
//
//   * One page per recall, found again by its title, so running it twice updates the page instead of
//     making a second one.
//   * It reads the SAVED check, like every other tool: no live openFDA calls.
//   * Only exact and likely matches of recalls that are still open are shown as "affected".
//   * Without a space it does not guess: it lists the spaces so the person can choose.
//
// `deps` (injected, so this is unit tested without Confluence):
//   confluence   { listSpaces, findSpace, upsertPage }          (see confluenceClient.js)
//   getTaskKeys  async (pairs) -> { "recall|device": "MOBL-1" } existing Jira tasks (optional)
// No Forge imports here.
import { compact } from './text.js';
import { isTaskWorthy, pairKey } from './taskRules.js';
import { CLOSED_STATUSES, noData } from './agentTools.js';
import { recallPageTitle, buildRecallPageBody } from './recallPage.js';
import { isNotConnected, NOT_CONNECTED_MESSAGE } from './confluenceClient.js';

// Each page costs two Confluence calls (look for it, then write it), roughly a second. Ten per call keeps
// a request well inside the time a function gets; the answer says how many were left for another call.
export const MAX_PAGES_PER_CALL = 10;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isClosed(details) {
  return Boolean(details && CLOSED_STATUSES.includes(String(details.status).toLowerCase()));
}

// inputs: spaceKey (the Confluence space to write in), recallNumber (optional: just that recall).
// A site where the app is not connected to Confluence gets one plain answer (the first Confluence call is where it shows).
export async function createRecallPages(args) {
  try {
    return await writeRecallPages(args);
  } catch (error) {
    if (isNotConnected(error)) return { ok: false, notConnected: true, error: NOT_CONNECTED_MESSAGE };
    throw error;
  }
}

async function writeRecallPages({ snapshot, inputs = {}, deps }) {
  const { result } = snapshot;
  if (!result) return noData(snapshot);

  const spaceKey = text(inputs.spaceKey).toUpperCase();
  if (!spaceKey) {
    const spaces = await deps.confluence.listSpaces();
    return {
      ok: false,
      needsSpace: true,
      availableSpaces: spaces.map((s) => ({ key: s.key, name: s.name })),
      error: 'Which Confluence space should the recall pages go in? Ask the user to pick one of availableSpaces and call again with spaceKey.',
    };
  }
  const space = await deps.confluence.findSpace(spaceKey);
  if (!space) {
    const spaces = await deps.confluence.listSpaces();
    return {
      ok: false,
      needsSpace: true,
      availableSpaces: spaces.map((s) => ({ key: s.key, name: s.name })),
      error: `There is no Confluence space with the key ${spaceKey} (or you cannot see it). Pick one of availableSpaces.`,
    };
  }

  // The open recalls, each with its exact/likely matches, in the saved check's order (most serious first).
  const details = result.recallDetails || {};
  const byRecall = new Map();
  for (const match of result.matches.filter(isTaskWorthy)) {
    if (isClosed(details[match.recallNumber])) continue;
    if (!byRecall.has(match.recallNumber)) byRecall.set(match.recallNumber, []);
    byRecall.get(match.recallNumber).push(match);
  }
  let recalls = [...byRecall.entries()];
  const wanted = text(inputs.recallNumber);
  if (wanted) {
    recalls = recalls.filter(([number]) => compact(number) === compact(wanted));
    if (recalls.length === 0) {
      return {
        ok: true,
        state: 'not-found',
        message: `Recall ${wanted} is not among the open recalls with an exact or likely match in the saved check, so no page was made. Do not guess a recall number.`,
        citations: { recallNumbers: [], deviceIds: [], rule: 'Nothing to cite: this recall was not found.' },
      };
    }
  }
  if (recalls.length === 0) {
    return { ok: true, state: 'nothing-to-do', message: 'No open recall has an exact or likely match in the saved check, so there is nothing to write.' };
  }

  const batch = recalls.slice(0, MAX_PAGES_PER_CALL);
  const pages = [];
  const failed = [];
  for (const [recallNumber, matches] of batch) {
    try {
      let taskKeys = {};
      if (deps.getTaskKeys) {
        try {
          taskKeys = await deps.getTaskKeys(matches.map((m) => ({ recallNumber: m.recallNumber, deviceId: m.deviceId })));
        } catch (error) {
          taskKeys = {}; // a Jira hiccup must not stop the page: it just says "no task yet"
        }
      }
      const title = recallPageTitle(recallNumber);
      const body = buildRecallPageBody({ matches, info: details[recallNumber] || {}, taskKeys, checkedAt: result.checkedAt });
      const page = await deps.confluence.upsertPage({ spaceId: space.id, title, body });
      pages.push({
        recallNumber,
        recallClass: matches[0].recallClass || null,
        title,
        action: page.action,
        url: page.url,
        devices: matches.map((m) => m.deviceId),
        tasksLinked: matches.filter((m) => taskKeys[pairKey(m.recallNumber, m.deviceId)]).length,
      });
    } catch (error) {
      failed.push({ recallNumber, error: error.message || 'Confluence could not write the page.' });
    }
  }

  const written = new Set(pages.map((p) => p.recallNumber));
  return {
    ok: true,
    state: 'done',
    space: { key: space.key, name: space.name },
    pages,
    failed,
    notIncluded: recalls.length - batch.length,
    citations: {
      recallNumbers: [...written],
      deviceIds: [...new Set(pages.flatMap((p) => p.devices))],
      rule: 'Quote only these recall numbers and device ids, exactly as written. Never invent or guess one.',
    },
    message: `${pages.filter((p) => p.action === 'created').length} page(s) created and ${pages.filter((p) => p.action === 'updated').length} updated in the ${space.name} space. Give the user the page links exactly as returned.`,
  };
}
