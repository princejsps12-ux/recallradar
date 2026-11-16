// A fake of RecallRadar's Forge resolvers (src/index.js) for the preview, with named starting states ("scenarios").
// One file, two homes: the browser loads it as a classic script (window.RRPreviewBackend) and Node tests require() it.
// It is data in, data out: no DOM and no network, so src/previewBackend.test.mjs can check it against the real
// resolver list and its behaviour. Nothing here is real: people, teams, projects and task keys are invented.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRPreviewBackend = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The real check makes about this many openFDA searches for the demo hospital (see the README).
  const SEARCHES = 24;
  const PROJECTS = [
    { key: 'BIOMED', name: 'Biomedical Engineering' },
    { key: 'FAC', name: 'Facilities' },
    { key: 'QA', name: 'Quality and Compliance' },
  ];
  const SPACES = [
    { key: 'BIOMED', name: 'Biomedical Engineering' },
    { key: 'QA', name: 'Quality and Compliance' },
  ];
  const team = (n, name) => ({ ari: `ari:cloud:identity::team/00000000-0000-4000-8000-00000000000${n}`, name });
  const TEAMS = [team(1, 'ICU Nursing'), team(2, 'Cath Lab Team'), team(3, 'Cardiology Team'), team(4, 'Respiratory Therapy'), team(5, 'Biomedical Engineering')];
  const person = (n, name) => ({ accountId: `preview-account-${n}`, name });
  const MEMBERS = {
    [TEAMS[0].ari]: [person(1, 'Priya Raman'), person(2, 'Tomas Weber')],
    [TEAMS[1].ari]: [person(3, 'Ayesha Khan'), person(4, 'Lucas Moreau')],
    [TEAMS[2].ari]: [person(5, 'Nia Johnson'), person(6, 'Daniel Park')],
    [TEAMS[3].ari]: [person(7, 'Elena Petrova'), person(8, 'Sam Rivera')],
    [TEAMS[4].ari]: [person(9, 'Hana Sato'), person(10, 'Omar Haddad')],
  };
  const MAPPED_WARDS = [['ICU', TEAMS[0]], ['Cath Lab', TEAMS[1]], ['Cardiology', TEAMS[2]]];
  const TASK_PREFIX = 'BIOMED';

  // Every resolver the real app defines in src/index.js. src/previewBackend.test.mjs fails when the app gets a resolver
  // that is not in this list, so the preview cannot quietly fall behind the app.
  const RESOLVERS = [
    'listDevices', 'loadDemoHospital', 'importDevices', 'removeImportedDevices', 'clearDevices', 'getSavedMatches', 'startCheck', 'getCheckStatus',
    'getTaskStates', 'getTaskSummary', 'createTasks', 'getWardTeams', 'listTeams', 'setWardTeam', 'suggestAssignees', 'listProjects', 'fetchRecalls',
    'listSpaces', 'createRecallPage', 'getCapabilities',
  ];

  const HOUR = 3600000;
  const pairKey = (recallNumber, deviceId) => `${recallNumber}|${deviceId}`;
  const matchPair = (m) => pairKey(m.recallNumber, m.deviceId);
  const compact = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const isAffected = (m) => m.confidence === 'exact' || m.confidence === 'likely';
  // Most urgent first, like the dashboard: Class I before II before III, exact before likely.
  const urgency = (m) => ({ I: 0, II: 1, III: 2 }[m.recallClass] ?? 0) * 2 + (m.confidence === 'exact' ? 0 : 1);
  const byUrgency = (matches) => matches.map((m, i) => [m, i]).sort((a, b) => urgency(a[0]) - urgency(b[0]) || a[1] - b[1]).map(([m]) => m);

  // What a site where the app is installed in Jira but not connected to Confluence is told (the same words as
  // NOT_CONNECTED_MESSAGE in src/confluenceClient.js; src/previewBackend.test.mjs fails when they drift apart).
  const NOT_CONNECTED_MESSAGE =
    'RecallRadar is not connected to Confluence on this site yet, so it cannot write recall pages. A site admin connects it in Atlassian Administration: Apps → Sites → this site → Connected apps → RecallRadar → View app details → Connections → Connect (next to Confluence). Everything else in RecallRadar works without it.';

  // What a person who is not a Jira administrator is told when they try to change the device list (the same words as
  // NOT_ADMIN_MESSAGE in src/permissions.js; src/previewBackend.test.mjs fails when they drift apart).
  const NOT_ADMIN_MESSAGE =
    "Only a Jira administrator can change the hospital's device list, because it is shared by the whole site. Ask one to do it, or to make you an administrator.";

  // Starting states. `flags`: hang (nothing ever answers: the loading screen), freeze (a running check stays where it
  // is), startFails, listDevicesFails, suggestFails (the Teamwork Graph says no), recentFails, keepStaleOnce,
  // confluenceOff (the app is not connected to Confluence), notAdmin (the signed-in person is not a Jira administrator).
  const SCENARIOS = {
    ready: { about: 'Saved result 8 minutes old, no tasks yet, three wards have a team, the Graph suggests people.', ageMs: 8 * 60000 },
    'in-progress': { about: 'Like ready, with eight tasks created (three done): what a hospital using it for a few days sees.', ageMs: 25 * 60000, tasks: [0, 1, 3, 6, 9, 14, 20, 26], done: 3 },
    'all-done': { about: 'Every device that needs action already has a task.', ageMs: 40 * 60000, tasks: 'all', done: 12 },
    'first-run': { about: 'No devices at all: the welcome screen with Load demo hospital.', devices: 'none' },
    'no-check': { about: 'Devices, but no check has run yet.', ageMs: null },
    running: { about: 'The first check is running, 9 of 24 searches done (the progress stays there).', ageMs: null, job: { done: 9 }, flags: { freeze: true } },
    refreshing: { about: 'Refresh was clicked: the saved result stays on screen while a new check is at 14 of 24 searches.', ageMs: 4 * HOUR, job: { done: 14 }, flags: { freeze: true } },
    stale: { about: 'The saved result is 9 hours old, so it is shown flagged "older than 6 hours".', ageMs: 9 * HOUR, stale: true, flags: { keepStaleOnce: true } },
    'failed-lookups': { about: 'Three FDA searches failed: the result may be incomplete.', ageMs: 6 * 60000, failedQueries: 3 },
    'none-affected': { about: 'Nothing matches an open recall with an exact or likely match.', ageMs: 8 * 60000, onlyPossible: true },
    'no-graph': { about: 'Like ready, but the Teamwork Graph refuses (no suggestions, no team list): what the demo site did on 2026-11-16.', ageMs: 8 * 60000, flags: { suggestFails: true } },
    'no-confluence': { about: 'Like ready, but the app is installed in Jira only, not connected to Confluence: the Confluence dialog says how to connect it.', ageMs: 8 * 60000, flags: { confluenceOff: true } },
    'not-admin': { about: 'Like ready, but the signed-in person is not a Jira administrator: the devices menu items are shut and the server would refuse them.', ageMs: 8 * 60000, flags: { notAdmin: true } },
    'first-run-not-admin': { about: 'No devices yet, and the person is not a Jira administrator: the welcome screen says who can add devices.', devices: 'none', flags: { notAdmin: true } },
    'refresh-error': { about: 'Like ready, but Refresh cannot start a check.', ageMs: 8 * 60000, flags: { startFails: true } },
    error: { about: 'The device list cannot be read: the error screen.', flags: { listDevicesFails: true } },
    loading: { about: 'Nothing ever answers: the loading skeleton.', flags: { hang: true } },
  };

  function createBackend(options) {
    const fx = options.fixtures;
    const name = options.scenario || 'ready';
    const spec = SCENARIOS[name];
    if (!spec) throw new Error(`Unknown preview state "${name}". Known: ${Object.keys(SCENARIOS).join(', ')}`);
    const now = options.now || Date.now;
    const duration = options.duration === undefined ? 5000 : options.duration; // ms a started check takes
    const delay = options.delay === undefined ? 30 : options.delay; // ms every answer takes, so spinners are real
    const flags = Object.assign({}, spec.flags);

    const st = {
      devices: spec.devices === 'none' ? [] : fx.devices.slice(),
      result: null,
      tasks: {},
      done: spec.done || 0,
      job: null,
      mappings: MAPPED_WARDS.map(([ward, t]) => ({ ward, teamAri: t.ari, teamName: t.name })),
      assigned: {}, // accountId -> tasks given to them in this session
      nextTask: 101,
      log: [],
    };

    function freshResult(ageMs) {
      let matches = fx.result.matches;
      if (spec.onlyPossible) matches = matches.filter((m) => !isAffected(m));
      return Object.assign({}, fx.result, {
        matches,
        checkedAt: new Date(now() - ageMs).toISOString(),
        fromCache: true,
        stale: Boolean(spec.stale),
        failedQueries: spec.failedQueries || 0,
        elapsedMs: 11800,
      });
    }
    if (spec.ageMs !== undefined && spec.ageMs !== null && st.devices.length) st.result = freshResult(spec.ageMs);
    if (spec.job) st.job = { id: 'preview-job', status: 'running', trigger: 'user', startedAt: now(), progress: { done: spec.job.done, total: SEARCHES } };

    function newTask() {
      const key = `${TASK_PREFIX}-${st.nextTask}`;
      st.nextTask += 1;
      return key;
    }
    if (st.result && spec.tasks) {
      const ordered = byUrgency(st.result.matches.filter(isAffected));
      const picks = spec.tasks === 'all' ? ordered : spec.tasks.map((i) => ordered[i]).filter(Boolean);
      picks.forEach((m) => { st.tasks[matchPair(m)] = newTask(); });
    }

    const findMatch = (recallNumber, deviceId) => (st.result ? st.result.matches.find((m) => m.recallNumber === recallNumber && m.deviceId === deviceId) : null);
    const wards = () => [...new Set(st.devices.map((d) => d.ward).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const summary = () => {
      const total = Object.keys(st.tasks).length;
      const done = Math.min(st.done, total);
      return { open: total - done, done, capped: false };
    };
    const jobSummary = (job) => { const { result, ...rest } = job; return rest; }; // eslint-disable-line no-unused-vars

    // A started check advances with the clock and finishes by itself, like the background job does.
    function currentJob() {
      const job = st.job;
      if (job && job.status === 'running' && !flags.freeze) {
        const done = Math.min(SEARCHES, duration === 0 ? SEARCHES : Math.floor(((now() - job.startedAt) / duration) * SEARCHES));
        job.progress = { done, total: SEARCHES };
        if (done >= SEARCHES) {
          job.status = 'done';
          st.result = freshResult(0);
          st.result.stale = false;
          st.result.fromCache = false;
        }
      }
      return job;
    }

    const pickMember = (teamAri, planned) => {
      const members = MEMBERS[teamAri] || [];
      const load = (m) => (st.assigned[m.accountId] || 0) + (planned[m.accountId] || 0);
      return members.slice().sort((a, b) => load(a) - load(b) || a.name.localeCompare(b.name))[0] || null;
    };
    const memberById = (accountId) => Object.values(MEMBERS).flat().find((m) => m.accountId === accountId) || null;

    // --- the resolvers, one function each, named like src/index.js ----------------------------------------------
    const handlers = {
      listDevices() {
        if (flags.listDevicesFails) return { ok: false, error: 'Could not load the device list.' };
        return { ok: true, devices: st.devices };
      },
      getCapabilities() {
        return { ok: true, canManageDevices: !flags.notAdmin };
      },
      loadDemoHospital() {
        if (flags.notAdmin) return { ok: false, notAllowed: true, error: NOT_ADMIN_MESSAGE };
        st.devices = fx.devices.slice();
        st.result = null;
        st.job = null;
        st.tasks = {};
        return { ok: true, count: st.devices.length };
      },
      importDevices({ payload }) {
        if (flags.notAdmin) return { ok: false, notAllowed: true, error: NOT_ADMIN_MESSAGE };
        const lines = String((payload && payload.text) || '').split(/\r?\n/).filter((l) => l.trim());
        const header = (lines[0] || '').toLowerCase();
        if (lines.length < 2 || !header.includes('manufacturer') || !header.includes('model')) {
          return { ok: false, errors: ['Line 1: the first row must name the columns, and Manufacturer and Model are required.'] };
        }
        const added = lines.slice(1).map((line, i) => {
          const cells = line.split(/\t|,/);
          return { id: `own-${String(st.devices.filter((d) => d.source === 'manual').length + i + 1).padStart(3, '0')}`, name: cells[0] || 'Imported device', manufacturer: cells[1] || 'Unknown', model: cells[2] || 'Unknown', serial: cells[3] || '', ward: cells[4] || '', source: 'manual' };
        });
        st.devices = st.devices.concat(added);
        st.result = null;
        st.job = null;
        return { ok: true, count: added.length };
      },
      removeImportedDevices() {
        if (flags.notAdmin) return { ok: false, notAllowed: true, error: NOT_ADMIN_MESSAGE };
        st.devices = st.devices.filter((d) => d.source !== 'manual');
        st.result = null;
        st.job = null;
        return { ok: true, count: st.devices.length };
      },
      clearDevices() {
        if (flags.notAdmin) return { ok: false, notAllowed: true, error: NOT_ADMIN_MESSAGE };
        st.devices = [];
        st.result = null;
        st.job = null;
        st.tasks = {};
        return { ok: true, count: 0 };
      },
      getSavedMatches() {
        return { ok: true, result: st.result };
      },
      startCheck({ payload }) {
        if (flags.startFails) return { ok: false, error: 'Could not start the check. Please try again.' };
        if (!st.devices.length) return { ok: true, state: 'no-devices' };
        if (st.result && flags.keepStaleOnce) {
          flags.keepStaleOnce = false;
          return { ok: true, state: 'saved', result: st.result };
        }
        if (st.result && !st.result.stale && !(payload && payload.refresh)) return { ok: true, state: 'saved', result: st.result };
        const running = st.job && currentJob().status === 'running';
        if (!running) st.job = { id: `preview-job-${st.nextTask}`, status: 'running', trigger: 'user', startedAt: now(), progress: { done: 0, total: SEARCHES } };
        return { ok: true, state: 'running', job: jobSummary(st.job) };
      },
      getCheckStatus() {
        const job = st.job ? currentJob() : null;
        if (!job) return { ok: true, job: null, result: null };
        return { ok: true, job: jobSummary(job), result: job.status === 'done' ? st.result : null };
      },
      getTaskStates({ payload }) {
        const tasks = {};
        ((payload && payload.pairs) || []).forEach((p) => {
          const key = st.tasks[pairKey(p.recallNumber, p.deviceId)];
          if (key) tasks[pairKey(p.recallNumber, p.deviceId)] = key;
        });
        return { ok: true, tasks };
      },
      getTaskSummary() {
        return { ok: true, summary: summary() };
      },
      createTasks({ payload }) {
        const out = { ok: true, created: [], existing: [], inProgress: [], failed: [], notFound: [], assignedTo: {}, assignRefused: [], assignError: null };
        const assignees = (payload && payload.assignees) || {};
        ((payload && payload.pairs) || []).forEach((p) => {
          const pair = pairKey(p.recallNumber, p.deviceId);
          if (!findMatch(p.recallNumber, p.deviceId)) return out.notFound.push(pair);
          if (st.tasks[pair]) return out.existing.push({ pair, key: st.tasks[pair] });
          st.tasks[pair] = newTask();
          out.created.push({ pair, key: st.tasks[pair] });
          const who = assignees[pair] && memberById(assignees[pair]);
          if (who) {
            out.assignedTo[pair] = who.name;
            st.assigned[who.accountId] = (st.assigned[who.accountId] || 0) + 1;
          }
        });
        return out;
      },
      getWardTeams() {
        return { ok: true, mappings: st.mappings.slice(), wards: wards() };
      },
      listTeams() {
        if (flags.suggestFails) return { ok: false, error: 'Could not read teams from the Teamwork Graph.' };
        return { ok: true, teams: TEAMS.map(({ ari, name }) => ({ ari, name })) };
      },
      setWardTeam({ payload }) {
        const ward = payload && payload.ward;
        if (!payload || !payload.teamAri) {
          st.mappings = st.mappings.filter((m) => compact(m.ward) !== compact(ward));
          return { ok: true, ward, removed: true };
        }
        const found = TEAMS.find((t) => t.ari === payload.teamAri);
        if (!found) return { ok: false, error: 'That team was not found in the Teamwork Graph (it must be a team you belong to).' };
        st.mappings = st.mappings.filter((m) => compact(m.ward) !== compact(ward)).concat([{ ward, teamAri: found.ari, teamName: found.name }]);
        return { ok: true, ward, team: { ari: found.ari, name: found.name } };
      },
      suggestAssignees({ payload }) {
        if (flags.suggestFails) return { ok: false, error: 'Could not read team members from the Teamwork Graph.' };
        const suggestions = {};
        const skipped = [];
        const planned = {};
        ((payload && payload.pairs) || []).forEach((p) => {
          const pair = pairKey(p.recallNumber, p.deviceId);
          const m = findMatch(p.recallNumber, p.deviceId);
          if (!m) return;
          const mapping = st.mappings.find((x) => compact(x.ward) === compact(m.ward));
          if (!mapping) return skipped.push({ pair, reason: m.ward ? `ward ${m.ward} has no team yet` : 'no ward recorded' });
          const chosen = pickMember(mapping.teamAri, planned);
          if (!chosen) return skipped.push({ pair, reason: `team ${mapping.teamName} has no members you can see` });
          planned[chosen.accountId] = (planned[chosen.accountId] || 0) + 1;
          suggestions[pair] = { accountId: chosen.accountId, name: chosen.name, teamName: mapping.teamName, ward: m.ward };
        });
        return { ok: true, suggestions, skipped };
      },
      listProjects() {
        return { ok: true, projects: PROJECTS, recent: [PROJECTS[0].key] };
      },
      fetchRecalls() {
        if (flags.recentFails) return { ok: false, error: 'Could not load recalls from openFDA. Please try again later.' };
        return { ok: true, recalls: fx.recent };
      },
      listSpaces() {
        if (flags.confluenceOff) return { ok: false, notConnected: true, error: NOT_CONNECTED_MESSAGE };
        return { ok: true, spaces: SPACES };
      },
      createRecallPage({ payload }) {
        if (flags.confluenceOff) return { ok: false, notConnected: true, error: NOT_CONNECTED_MESSAGE };
        const space = SPACES.find((s) => s.key === (payload && payload.spaceKey));
        if (!space) return { ok: false, error: 'Choose a Confluence space first.' };
        const open = [...new Set((st.result ? st.result.matches.filter(isAffected) : []).map((m) => m.recallNumber))];
        const wanted = payload && payload.recallNumber ? open.filter((n) => n === payload.recallNumber) : open;
        const MAX_PAGES = 10;
        const pages = wanted.slice(0, MAX_PAGES).map((n) => ({ recallNumber: n, action: 'created', title: `FDA recall ${n}`, url: `https://example.invalid/wiki/spaces/${space.key}/pages/${n}` }));
        return { ok: true, state: 'done', space, pages, failed: [], notIncluded: Math.max(0, wanted.length - MAX_PAGES) };
      },
    };

    async function invoke(functionKey, payload, context) {
      st.log.push({ functionKey, payload });
      if (flags.hang) return new Promise(() => {});
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const handler = handlers[functionKey];
      if (!handler) return { ok: false, error: `The preview has no answer for "${functionKey}".` };
      return handler({ payload, context });
    }

    return { invoke, state: st, flags, scenario: name };
  }

  return { createBackend, SCENARIOS, RESOLVERS, TEAMS, MEMBERS, PROJECTS, SEARCHES, NOT_CONNECTED_MESSAGE, NOT_ADMIN_MESSAGE };
});
