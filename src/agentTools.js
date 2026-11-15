// The four things the RecallRadar Rovo agent can do, as plain functions over the SAVED recall check.
//
//   listOpenRecalls          devices with exact or likely matches, filtered by ward / class
//   checkDevice              does this model / serial / device id match any recall?
//   createRemediationTasks   Jira tasks for chosen matches: PREVIEW first, then confirm
//   recallDetails            explain one recall in plain English, and what to do
//
// Rules that hold for every tool:
//   * REAL DATA ONLY. Everything returned comes from the saved check result (matches and the
//     per-recall details saved with it). Nothing is fetched from openFDA here, and nothing is made
//     up. Every answer carries `citations`: the only recall numbers and device ids the agent may
//     quote for that answer.
//   * SAVED RESULTS. If there is no saved check, the tool says so and says how to get one.
//   * Inputs are plain text, numbers or true/false (Rovo action inputs cannot be lists), and the
//     page or the model may send anything, so every input is checked here.
//
// `snapshot` is { devices, result }: the hospital's devices and the latest saved check result
// (or null). No Forge imports, so every path is unit tested with plain Node.
import { compact, tokenize, containsPhrase } from './text.js';
import { manufacturersMatch } from './matching.js';
import {
  isTaskWorthy,
  pairKey,
  dueDateFor,
  dueDaysFor,
  buildTaskSummary,
  recallRecordUrl,
  FDA_RECALL_DATABASE_URL,
} from './taskRules.js';
import { createTasks, getTaskStates, selectMatches } from './taskService.js';
import { assigneesForMatches, checkExplicitAssignees, SUGGESTION_RULE } from './teamService.js';

// --- Limits (each with its reason) ------------------------------------------------------------------

// How many rows a list answers with by default, and the most it may. An agent's answer has to fit
// in a chat message; the total is always reported so nothing is silently cut off.
export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 50;

// The most tasks one confirmed action may create. Creating a task takes about 0.6 s and an action
// should finish well inside 25 s, so 20 tasks is about 12 s. A larger selection is created in
// several rounds: the preview says how many were left out.
export const MAX_TASKS_PER_ACTION = 20;

// How long a preview stays valid. Long enough for a person to read it and reply, short enough
// that a stale preview cannot be confirmed hours later against a changed result.
export const PREVIEW_TTL_MS = 10 * 60 * 1000;

// openFDA recall statuses that mean the recall is over. Anything else (including "Ongoing", or no
// status in an older saved check) counts as open.
export const CLOSED_STATUSES = Object.freeze(['terminated', 'completed']);

// What FDA's classes mean, in the words used when explaining a recall (21 CFR 7.3).
export const CLASS_MEANINGS = Object.freeze({
  I: 'Class I: a reasonable chance the device could cause serious harm or death.',
  II: 'Class II: could cause temporary or medically reversible harm, or a remote chance of serious harm.',
  III: 'Class III: not likely to cause harm.',
});

// --- Reading inputs ----------------------------------------------------------------------------------

function text(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

// "Class II", "ii", "2" -> "II". Empty -> "" (no filter). Anything else -> null (invalid).
export function parseRecallClassInput(value) {
  const raw = text(value).toLowerCase().replace(/^class\s*/, '');
  if (!raw) return '';
  const map = { i: 'I', '1': 'I', ii: 'II', '2': 'II', iii: 'III', '3': 'III' };
  return map[raw] || null;
}

function parseConfidenceInput(value) {
  const raw = text(value).toLowerCase();
  if (!raw) return '';
  return ['exact', 'likely', 'possible'].includes(raw) ? raw : null;
}

function parseLimitInput(value) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIST_LIMIT;
  return Math.min(n, MAX_LIST_LIMIT);
}

// The inputs of a Rovo action call. Forge passes them on the payload (and may add a `context`).
export function readInputs(payload) {
  if (!payload || typeof payload !== 'object') return {};
  return payload.inputs && typeof payload.inputs === 'object' ? payload.inputs : payload;
}

// --- Shared answers ------------------------------------------------------------------------------------

const NO_SAVED_CHECK =
  'There is no saved recall check yet. Ask the user to open the RecallRadar panel on a Jira issue and click "Check devices for recalls" (or wait for the daily refresh), then ask again.';

function noData(snapshot) {
  if (snapshot.devices.length === 0) {
    return {
      ok: false,
      error: 'The hospital has no devices yet. Ask the user to open the RecallRadar panel and click "Load demo hospital", or add devices, then run a check.',
    };
  }
  return { ok: false, error: NO_SAVED_CHECK };
}

// Where the data came from, so every answer can say how fresh it is.
function basedOn(result) {
  return {
    source: 'saved RecallRadar check (no live openFDA lookup)',
    checkedAt: result.checkedAt,
    stale: Boolean(result.stale),
    devicesChecked: result.deviceCount,
    recallsConsidered: result.recallCount,
    ...(result.stale
      ? { note: 'This saved check is older than 6 hours. Tell the user; opening the RecallRadar panel refreshes it.' }
      : {}),
    ...(result.failedQueries > 0 ? { warning: 'Some FDA lookups failed, so this check may be incomplete.' } : {}),
  };
}

// The ONLY recall numbers and device ids an answer may quote.
function citationsOf(matches) {
  return {
    recallNumbers: [...new Set(matches.map((m) => m.recallNumber))],
    deviceIds: [...new Set(matches.map((m) => m.deviceId))],
    rule: 'Quote only these recall numbers and device ids, exactly as written. Never invent or guess one.',
  };
}

function isClosed(details) {
  return Boolean(details && CLOSED_STATUSES.includes(String(details.status).toLowerCase()));
}

function toItem(match, details, taskKey) {
  return {
    deviceId: match.deviceId,
    deviceName: match.deviceName,
    ward: match.ward || null,
    manufacturer: match.deviceManufacturer,
    model: match.deviceModel,
    serialOrLot: match.lotOrSerial || null,
    recallNumber: match.recallNumber,
    recallClass: match.recallClass || null,
    confidence: match.confidence,
    whyMatched: match.reason,
    recallingFirm: match.firm,
    recallDate: match.date || null,
    recallStatus: (details && details.status) || null,
    ...(taskKey ? { jiraTask: taskKey } : {}),
  };
}

// Does this ward match what the user typed? "ICU" matches "ICU"; "med-surg" matches "Med-Surg 3W".
export function wardMatches(ward, wanted) {
  const wanted_ = tokenize(wanted);
  if (wanted_.length === 0) return true;
  return containsPhrase(tokenize(ward), wanted_);
}

function filterMatches(matches, filters) {
  return matches.filter(
    (m) =>
      (!filters.ward || wardMatches(m.ward || '', filters.ward)) &&
      (!filters.recallClass || m.recallClass === filters.recallClass) &&
      (!filters.confidence || m.confidence === filters.confidence) &&
      (!filters.recallNumber || compact(m.recallNumber) === compact(filters.recallNumber)) &&
      (!filters.deviceId || compact(m.deviceId) === compact(filters.deviceId)),
  );
}

function wardsOf(matches) {
  return [...new Set(matches.map((m) => m.ward).filter(Boolean))].sort();
}

// --- 1. list_open_recalls --------------------------------------------------------------------------------------

// Devices the saved check says are affected (exact or likely) by a recall that is still open.
// inputs: ward, recallClass, confidence ("exact" | "likely"), limit.
// deps (optional): getTaskKeys(pairs) -> { "recall|device": "MOBL-1" }, to show existing tasks.
export async function listOpenRecalls({ snapshot, inputs = {}, deps = {} }) {
  const { result } = snapshot;
  if (!result) return noData(snapshot);

  const recallClass = parseRecallClassInput(inputs.recallClass);
  if (recallClass === null) return { ok: false, error: 'recallClass must be I, II or III.' };
  const confidence = parseConfidenceInput(inputs.confidence);
  if (confidence === null || confidence === 'possible') {
    return { ok: false, error: 'confidence must be "exact" or "likely" (possible matches are not listed here).' };
  }
  const filters = { ward: text(inputs.ward), recallClass, confidence };
  const limit = parseLimitInput(inputs.limit);
  const details = result.recallDetails || {};

  const worthy = result.matches.filter(isTaskWorthy);
  const open = worthy.filter((m) => !isClosed(details[m.recallNumber]));
  const selected = filterMatches(open, filters);
  const shown = selected.slice(0, limit);

  let taskKeys = {};
  if (deps.getTaskKeys && shown.length) {
    try {
      taskKeys = await deps.getTaskKeys(shown.map((m) => ({ recallNumber: m.recallNumber, deviceId: m.deviceId })));
    } catch (error) {
      taskKeys = {}; // a Jira hiccup must not stop the list
    }
  }

  const count = (key) =>
    selected.reduce((acc, m) => ({ ...acc, [m[key] || 'unknown']: (acc[m[key] || 'unknown'] || 0) + 1 }), {});
  const answer = {
    ok: true,
    basedOn: basedOn(result),
    filtersApplied: Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
    total: selected.length,
    shown: shown.length,
    summary: { byRecallClass: count('recallClass'), byConfidence: count('confidence'), devices: new Set(selected.map((m) => m.deviceId)).size },
    items: shown.map((m) => toItem(m, details[m.recallNumber], taskKeys[pairKey(m.recallNumber, m.deviceId)])),
    citations: citationsOf(shown),
  };
  if (selected.length > shown.length) {
    answer.note = `Showing the first ${shown.length} of ${selected.length}. Ask for a narrower filter (ward or class) to see the rest.`;
  }
  if (selected.length === 0) {
    answer.message = 'No device in the saved check has an open exact or likely recall match for those filters.';
    // Suggest wards that DO fit the rest of the question (class, confidence), not just any ward.
    if (filters.ward) answer.wardsWithMatches = wardsOf(filterMatches(open, { ...filters, ward: '' }));
  }
  return answer;
}

// --- 2. check_device ----------------------------------------------------------------------------------------------

function sameId(a, b) {
  return compact(a) !== '' && compact(a) === compact(b);
}

// Look a device up in the hospital's list by id, serial/lot or model (all compared ignoring case and
// punctuation), optionally narrowed by manufacturer.
// inputs: deviceId, serial, model, manufacturer. At least one of the first three is required.
export function checkDevice({ snapshot, inputs = {} }) {
  const { result, devices } = snapshot;
  const deviceId = text(inputs.deviceId);
  const serial = text(inputs.serial);
  const model = text(inputs.model);
  const manufacturer = text(inputs.manufacturer);
  if (!deviceId && !serial && !model) {
    return { ok: false, error: 'Give at least a model, a serial/lot number or a device id.' };
  }
  if (!result) return noData(snapshot);

  const found = devices.filter(
    (d) =>
      (!deviceId || sameId(d.id, deviceId)) &&
      (!serial || sameId(d.lotOrSerial, serial)) &&
      (!model || sameId(d.model, model)) &&
      (!manufacturer || manufacturersMatch(d.manufacturer, manufacturer)),
  );

  if (found.length === 0) {
    return {
      ok: true,
      basedOn: basedOn(result),
      devicesFound: 0,
      message:
        'That device is not in the hospital device list (no device matched those details), so RecallRadar cannot check it. It only checks devices in its list, against recalls from the saved check.',
      citations: { recallNumbers: [], deviceIds: [], rule: 'Nothing to cite: no device was found.' },
    };
  }

  const details = result.recallDetails || {};
  const answerDevices = found.map((device) => {
    const matches = result.matches.filter((m) => m.deviceId === device.id);
    const verdict = matches.length === 0
      ? 'no-recall-found'
      : { exact: 'affected', likely: 'likely-affected', possible: 'possible' }[matches[0].confidence];
    return {
      deviceId: device.id,
      deviceName: device.name,
      ward: device.ward || null,
      manufacturer: device.manufacturer,
      model: device.model,
      serialOrLot: device.lotOrSerial || null,
      verdict,
      matches: matches.map((m) => toItem(m, details[m.recallNumber])),
    };
  });
  const allMatches = result.matches.filter((m) => found.some((d) => d.id === m.deviceId));
  return {
    ok: true,
    basedOn: basedOn(result),
    devicesFound: found.length,
    devices: answerDevices,
    verdictMeaning: {
      affected: 'exact match: manufacturer, model and serial/lot all listed in a recall',
      'likely-affected': 'model matches but the serial/lot is not listed or not recorded: check manually',
      possible: 'weak match (same maker and kind of device, or a model number from another firm)',
      'no-recall-found': 'no recall in the saved check matches this device',
    },
    citations: {
      recallNumbers: [...new Set(allMatches.map((m) => m.recallNumber))],
      deviceIds: found.map((d) => d.id),
      rule: 'Quote only these recall numbers and device ids, exactly as written. Never invent or guess one.',
    },
  };
}

// --- 4. recall_details -----------------------------------------------------------------------------------------------

// What a hospital should do about a recall. These are the same for every recall: RecallRadar does not
// know a manufacturer's specific corrective action, so the last step is always to read the notice.
export function buildActionSteps(recallClass, anyLikely) {
  const days = dueDaysFor(recallClass);
  const steps = [
    'Find the affected device(s) listed below (ward and serial/lot) and confirm they are the same units.',
    `Act within about ${days} day${days === 1 ? '' : 's'}: RecallRadar tasks for this recall are due ${days} days after they are created${recallClass ? ` (Class ${recallClass})` : ' (class unknown, treated as Class I)'}.`,
    "Read the manufacturer's recall notice and the FDA record (links below) for the exact corrective action. RecallRadar does not know it.",
    'Follow that notice, and record what was done.',
  ];
  if (anyLikely) {
    steps.splice(1, 0, 'For a "likely" match, check the unit\'s serial/lot against the recall before acting: it was not confirmed.');
  }
  return steps;
}

// Explain one recall that matched a hospital device.
// inputs: recallNumber (required). deps (optional): getTaskKeys(pairs).
export async function recallDetails({ snapshot, inputs = {}, deps = {} }) {
  const { result } = snapshot;
  const wanted = text(inputs.recallNumber);
  if (!wanted) return { ok: false, error: 'Give the FDA recall number, for example Z-2723-2026.' };
  if (!result) return noData(snapshot);

  const matches = result.matches.filter((m) => compact(m.recallNumber) === compact(wanted));
  if (matches.length === 0) {
    return {
      ok: true,
      found: false,
      basedOn: basedOn(result),
      message: `Recall ${wanted} is not among the recalls that matched a hospital device in the saved check, so RecallRadar has no details to give. Do not guess: say so.`,
      citations: { recallNumbers: [], deviceIds: [], rule: 'Nothing to cite: this recall was not found.' },
    };
  }

  const first = matches[0];
  const info = (result.recallDetails || {})[first.recallNumber] || {};
  let taskKeys = {};
  if (deps.getTaskKeys) {
    try {
      taskKeys = await deps.getTaskKeys(matches.map((m) => ({ recallNumber: m.recallNumber, deviceId: m.deviceId })));
    } catch (error) {
      taskKeys = {};
    }
  }
  const anyLikely = matches.some((m) => m.confidence === 'likely');

  return {
    ok: true,
    found: true,
    basedOn: basedOn(result),
    recall: {
      recallNumber: first.recallNumber,
      recallClass: first.recallClass || null,
      classMeaning: CLASS_MEANINGS[first.recallClass] || 'Class not stated: treat as serious until confirmed.',
      recallingFirm: first.firm,
      product: first.product,
      reportedDate: first.date || null,
      status: info.status || null,
      recallInitiated: info.initiated || null,
      whatIsWrong:
        info.reason ||
        'The reason for this recall is not stored in this saved check (it is from an older check). Ask the user to refresh the check in the RecallRadar panel.',
    },
    affectedDevices: matches.map((m) => ({
      deviceId: m.deviceId,
      deviceName: m.deviceName,
      ward: m.ward || null,
      serialOrLot: m.lotOrSerial || null,
      confidence: m.confidence,
      whyMatched: m.reason,
      ...(taskKeys[pairKey(m.recallNumber, m.deviceId)] ? { jiraTask: taskKeys[pairKey(m.recallNumber, m.deviceId)] } : {}),
    })),
    whatToDo: buildActionSteps(first.recallClass, anyLikely),
    links: { fdaRecallRecord: recallRecordUrl(first.recallNumber), fdaRecallDatabase: FDA_RECALL_DATABASE_URL },
    citations: citationsOf(matches),
  };
}

// --- 3. create_remediation_tasks -----------------------------------------------------------------------------------------

// A preview is saved so that "confirm" creates EXACTLY what was shown, nothing more. The agent cannot
// create a task it has not previewed: confirming needs the one-time token a preview returns.
// `kv` has get/set/delete. Tokens are one-use.
export function createPreviewStore(kv, nowMs = () => Date.now(), makeToken = () => Math.random().toString(36).slice(2, 10)) {
  const key = (token) => `rovo-preview:${token}`;

  async function save(entry) {
    const token = `${nowMs().toString(36)}${makeToken()}`;
    await kv.set(key(token), { ...entry, at: nowMs() });
    return token;
  }

  // The preview for this token, once. Returns null if unknown, used, or older than PREVIEW_TTL_MS.
  async function take(token) {
    if (!token) return null;
    let entry;
    try {
      entry = await kv.get(key(token));
    } catch (error) {
      return null;
    }
    await kv.delete(key(token));
    if (!entry || typeof entry.at !== 'number') return null;
    const age = nowMs() - entry.at;
    return age >= 0 && age < PREVIEW_TTL_MS ? entry : null;
  }

  return { save, take };
}

// Jira project keys: letters, digits and underscores, starting with a letter (e.g. MOBL).
function parseProjectKey(value) {
  const raw = text(value).toUpperCase();
  return /^[A-Z][A-Z0-9_]{1,19}$/.test(raw) ? raw : '';
}

// inputs: recallNumber, deviceId, ward, recallClass, confidence ("exact"|"likely") choose the matches
// (at least one is required); projectKey; confirmed (true/false); confirmationToken.
// Without confirmed=true it only PREVIEWS. deps: { jira, guard, previewStore, now(), defaultProjectKey, team }.
// assignSuggested=true (preview only) also proposes, for each task, a member of the ward's Teamwork Graph team,
// shown in the preview; confirming then assigns exactly those people (re-checked against the team first).
// `team` is { store, graph, openCounts() } (see teamService.js); without it nobody is ever assigned.
export async function createRemediationTasks({ snapshot, inputs = {}, deps }) {
  const { result } = snapshot;
  if (!result) return noData(snapshot);
  const confirmed = inputs.confirmed === true || String(inputs.confirmed).toLowerCase() === 'true';

  // --- CONFIRM: create exactly what the preview showed ---
  if (confirmed) {
    const token = text(inputs.confirmationToken);
    if (!token) {
      return { ok: false, error: 'Nothing was created. Call this action first WITHOUT confirmed to get a preview and a confirmationToken, show the preview to the user, and only after they say yes call it again with confirmed=true and that token.' };
    }
    const entry = await deps.previewStore.take(token);
    if (!entry) {
      return { ok: false, error: 'Nothing was created: that confirmation token is unknown, already used, or older than 10 minutes. Ask for a new preview and confirm again.' };
    }
    const { matches, notFound } = selectMatches(result.matches, entry.pairs);
    // Only people the user saw in the preview, and only if they are still in the ward's team.
    let assignees = new Map();
    let assignNote;
    if (entry.assignees && Object.keys(entry.assignees).length > 0 && deps.team) {
      try {
        const explicit = Object.fromEntries(Object.entries(entry.assignees).map(([pair, a]) => [pair, a.accountId]));
        ({ assignees } = await checkExplicitAssignees({ explicit, matches, store: deps.team.store, graph: deps.team.graph }));
      } catch (error) {
        assignNote = 'The Teamwork Graph could not be reached, so the tasks were created without an assignee.';
      }
    }
    const outcome = await createTasks({ matches, jira: deps.jira, guard: deps.guard, projectKey: entry.projectKey, today: deps.now(), assignees });
    const created = outcome.created.map((c) => ({
      pair: c.pair,
      jiraTask: c.key,
      ...(assignees.has(c.pair) ? { assignedTo: assignees.get(c.pair).name } : {}),
    }));
    return {
      ok: true,
      state: 'created',
      projectKey: entry.projectKey,
      ...(assignNote ? { assignNote } : {}),
      created,
      alreadyHadTask: outcome.existing.map((e) => ({ pair: e.pair, jiraTask: e.key })),
      beingCreatedElsewhere: outcome.inProgress,
      failed: outcome.failed,
      noLongerInSavedCheck: notFound,
      citations: citationsOf(matches),
      message: `Created ${created.length} task${created.length === 1 ? '' : 's'}. Report the Jira keys exactly as returned.`,
    };
  }

  // --- PREVIEW ---
  const recallClass = parseRecallClassInput(inputs.recallClass);
  if (recallClass === null) return { ok: false, error: 'recallClass must be I, II or III.' };
  const confidence = parseConfidenceInput(inputs.confidence);
  if (confidence === null || confidence === 'possible') {
    return { ok: false, error: 'confidence must be "exact" or "likely": tasks are never created for possible matches.' };
  }
  const filters = {
    recallNumber: text(inputs.recallNumber),
    deviceId: text(inputs.deviceId),
    ward: text(inputs.ward),
    recallClass,
    confidence,
  };
  if (!Object.values(filters).some(Boolean)) {
    return { ok: false, error: 'Say which matches to create tasks for: a recall number, a device id, a ward or a recall class. Use list_open_recalls first if unsure.' };
  }
  const projectKey = parseProjectKey(inputs.projectKey) || parseProjectKey(deps.defaultProjectKey);
  if (!projectKey) {
    return { ok: false, error: 'Which Jira project should the tasks go in? Ask the user for the project key (for example MOBL) and call again with projectKey.' };
  }

  const details = result.recallDetails || {};
  const selected = filterMatches(result.matches.filter(isTaskWorthy).filter((m) => !isClosed(details[m.recallNumber])), filters);
  if (selected.length === 0) {
    return { ok: true, state: 'nothing-to-create', message: 'No open exact or likely match fits that selection, so there is nothing to create.', basedOn: basedOn(result) };
  }

  const existing = await getTaskStates({ matches: selected, jira: deps.jira, guard: deps.guard });
  const creatable = selected.filter((m) => !existing[pairKey(m.recallNumber, m.deviceId)]);
  const alreadyHave = selected.filter((m) => existing[pairKey(m.recallNumber, m.deviceId)]);
  if (creatable.length === 0) {
    return {
      ok: true,
      state: 'nothing-to-create',
      message: 'Every matching device already has a task for that recall, so nothing will be created.',
      alreadyHadTask: alreadyHave.map((m) => ({ deviceId: m.deviceId, recallNumber: m.recallNumber, jiraTask: existing[pairKey(m.recallNumber, m.deviceId)] })),
      citations: citationsOf(alreadyHave),
    };
  }

  const batch = creatable.slice(0, MAX_TASKS_PER_ACTION);
  const today = deps.now();

  // Optional: propose an assignee per task from the ward's team. Only a proposal until the user confirms.
  const wantAssignees = inputs.assignSuggested === true || String(inputs.assignSuggested).toLowerCase() === 'true';
  let proposed = new Map();
  let assignSkipped = [];
  let assignNote;
  if (wantAssignees) {
    if (!deps.team) {
      assignNote = 'Assigning is not available here, so the tasks will be created unassigned.';
    } else {
      try {
        ({ assignees: proposed, skipped: assignSkipped } = await assigneesForMatches({
          matches: batch,
          store: deps.team.store,
          graph: deps.team.graph,
          openCounts: await deps.team.openCounts(),
        }));
      } catch (error) {
        assignNote = 'The Teamwork Graph could not be reached, so no assignees are proposed.';
      }
    }
  }

  const token = await deps.previewStore.save({
    projectKey,
    pairs: batch.map((m) => ({ recallNumber: m.recallNumber, deviceId: m.deviceId })),
    ...(proposed.size ? { assignees: Object.fromEntries(proposed) } : {}),
  });
  return {
    ok: true,
    state: 'preview',
    projectKey,
    willCreate: batch.map((m) => ({
      deviceId: m.deviceId,
      deviceName: m.deviceName,
      ward: m.ward || null,
      recallNumber: m.recallNumber,
      recallClass: m.recallClass || null,
      confidence: m.confidence,
      taskTitle: buildTaskSummary(m),
      dueDate: dueDateFor(m.recallClass, today),
      whyMatched: m.reason,
      ...(wantAssignees
        ? {
            proposedAssignee: proposed.has(pairKey(m.recallNumber, m.deviceId))
              ? {
                  name: proposed.get(pairKey(m.recallNumber, m.deviceId)).name,
                  team: proposed.get(pairKey(m.recallNumber, m.deviceId)).teamName,
                  source: 'Teamwork Graph',
                }
              : null,
          }
        : {}),
    })),
    ...(wantAssignees
      ? {
          assignment: {
            rule: SUGGESTION_RULE,
            note: assignNote || (proposed.size ? 'These people are only proposed: they are assigned only if the user confirms.' : 'No one could be proposed.'),
            noAssignee: assignSkipped.map((s) => ({ pair: s.pair, reason: s.reason })),
          },
        }
      : {}),
    alreadyHadTask: alreadyHave.map((m) => ({ deviceId: m.deviceId, recallNumber: m.recallNumber, jiraTask: existing[pairKey(m.recallNumber, m.deviceId)] })),
    notIncluded: creatable.length - batch.length,
    confirmationToken: token,
    expiresInMinutes: PREVIEW_TTL_MS / 60000,
    instructions:
      'NOTHING HAS BEEN CREATED YET. Show the user this list (task titles, wards, due dates), say how many tasks will be created in project ' +
      projectKey +
      ', and ask them to confirm. Only if they clearly say yes, call this action again with confirmed=true and this confirmationToken.',
    citations: citationsOf(batch),
  };
}

// --- create_remediation_task (ONE task, for external agents over MCP) ------------------------------------------------------------

// Creates exactly ONE Jira task, for one recall and one device. This is the action external agents
// (Claude Desktop, Cursor...) get through the MCP module. It has no preview step on purpose:
//   * those clients show the user each tool call, with its inputs, and ask before running it, and
//   * one recall number plus one device id fully define the task, so there is nothing hidden to preview.
// It can never create more than one task per call, only for an exact or likely match of a recall that
// is still open, and never twice for the same recall and device.
// inputs: recallNumber, deviceId, projectKey (all required: an external client has no Jira issue to take the project from).
// deps: { jira, guard, now(), defaultProjectKey }.
export async function createRemediationTask({ snapshot, inputs = {}, deps }) {
  const { result } = snapshot;
  if (!result) return noData(snapshot);

  const recallNumber = text(inputs.recallNumber);
  const deviceId = text(inputs.deviceId);
  if (!recallNumber || !deviceId) {
    return { ok: false, error: 'Both recallNumber and deviceId are required: this action creates exactly one task, for one recall and one device.' };
  }
  const projectKey = parseProjectKey(inputs.projectKey) || parseProjectKey(deps.defaultProjectKey);
  if (!projectKey) return { ok: false, error: 'projectKey is required, for example MOBL.' };

  const match = result.matches.find((m) => compact(m.recallNumber) === compact(recallNumber) && compact(m.deviceId) === compact(deviceId));
  if (!match) {
    return {
      ok: true,
      state: 'not-found',
      message: `The saved check has no match between recall ${recallNumber} and device ${deviceId}, so no task was created. Use list_open_recalls to find real pairs.`,
      citations: { recallNumbers: [], deviceIds: [], rule: 'Nothing to cite: no such match.' },
    };
  }
  if (!isTaskWorthy(match)) {
    return { ok: false, error: `That is only a ${match.confidence} match, and tasks are created only for exact or likely matches.`, citations: citationsOf([match]) };
  }
  if (isClosed((result.recallDetails || {})[match.recallNumber])) {
    return { ok: false, error: `Recall ${match.recallNumber} is no longer open (status ${result.recallDetails[match.recallNumber].status}), so no task was created.`, citations: citationsOf([match]) };
  }

  const outcome = await createTasks({ matches: [match], jira: deps.jira, guard: deps.guard, projectKey, today: deps.now() });
  const base = { ok: true, projectKey, taskTitle: buildTaskSummary(match), dueDate: dueDateFor(match.recallClass, deps.now()), citations: citationsOf([match]) };
  if (outcome.created.length) return { ...base, state: 'created', jiraTask: outcome.created[0].key };
  if (outcome.existing.length) return { ...base, state: 'already-exists', jiraTask: outcome.existing[0].key, message: 'A task for this recall and device already exists; nothing new was created.' };
  if (outcome.inProgress.length) return { ...base, state: 'in-progress', message: 'This task is being created right now by another request. Ask again in a moment.' };
  return { ok: false, state: 'failed', error: (outcome.failed[0] && outcome.failed[0].error) || 'Jira could not create the task.', citations: citationsOf([match]) };
}
