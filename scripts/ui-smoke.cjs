// A quick UI check that needs no browser or Atlassian site: it renders the real React views in jsdom with a
// stubbed @forge/bridge, clicks through the main flows and prints what it sees. Fails (exit 1) on a crash or a wrong result.
// Needs `npm install --legacy-peer-deps` in static/ui first (that installs jsdom and Babel).
// Run: node scripts/ui-smoke.cjs
const path = require('path');
const fs = require('fs');
const Module = require('module');
const root = path.resolve(__dirname, '../static/ui');
const { JSDOM } = require(root + '/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/', pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT = true; // React 18 needs this for act()
for (const name of ['Node', 'Element', 'SVGElement', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'CSSStyleSheet']) {
  if (dom.window[name] && !(name in global)) global[name] = dom.window[name];
}
// Every DOM class jsdom has (HTMLIFrameElement, DocumentFragment, ...): libraries check against them.
for (const name of Object.getOwnPropertyNames(dom.window)) {
  if (/^[A-Z]/.test(name) && typeof dom.window[name] === 'function' && !(name in global)) global[name] = dom.window[name];
}
// Node has its own Event classes; Atlaskit must dispatch jsdom's, so these are replaced outright.
for (const name of ['Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'InputEvent']) global[name] = dom.window[name];
dom.window.matchMedia = dom.window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
global.ResizeObserver = global.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
dom.window.ResizeObserver = global.ResizeObserver;
dom.window.scrollTo = () => {};
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true }); // newer Node has a read-only navigator

const bridge = path.join(require('os').tmpdir(), 'rr-bridge-stub.js');
fs.writeFileSync(bridge, "module.exports={invoke:(n,p)=>global.__invoke(n,p),router:{open(){},navigate(){return Promise.resolve()}},Modal:class{constructor(o){global.__modalOpts=o;}open(){global.__modalOpened=true;return Promise.resolve();}},view:{theme:{enable:()=>Promise.resolve()},close:(p)=>{global.__closed=p;return Promise.resolve();},getContext:()=>Promise.resolve({extension:{type:global.__type,modal:global.__modal}})}};");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return request === '@forge/bridge' ? bridge : resolve.call(this, request, ...rest); };

const babel = require(root + '/node_modules/@babel/core');
const presets = [[root + '/node_modules/@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }], root + '/node_modules/@babel/preset-react'];
const transpile = (module, filename) => {
  if (!filename.startsWith(root + '/src/')) return Module._extensions['.__orig'](module, filename);
  module._compile(babel.transformSync(fs.readFileSync(filename, 'utf8'), { presets, filename }).code, filename);
};
Module._extensions['.__orig'] = Module._extensions['.js'];
Module._extensions['.js'] = transpile;
Module._extensions['.mjs'] = transpile;
Module._extensions['.css'] = (module) => { module.exports = {}; }; // Atlaskit imports its CSS; jsdom needs none of it

const React = require(root + '/node_modules/react');
const { createRoot } = require(root + '/node_modules/react-dom/client');
const { act } = React;
const Root = require(root + '/src/Root.js').default;

const mk = (id, recall, cls, ward, conf = 'exact') => ({ confidence: conf, reason: 'because', deviceId: id, deviceName: 'Pump ' + id, deviceManufacturer: 'ICU Medical', deviceModel: 'M1', lotOrSerial: 'S', ward, recallNumber: recall, recallClass: cls, firm: 'Firm', product: 'p', date: '2026-01-01' });
const result = { deviceCount: 3, recallCount: 40, checkedAt: new Date().toISOString(), failedQueries: 0, matches: [mk('d1', 'Z-1', 'I', 'ICU'), mk('d2', 'Z-2', 'II', 'ER', 'likely'), mk('d3', 'Z-3', 'III', 'ICU')], recallDetails: {} };
const base = {
  fetchRecalls: { ok: true, recalls: [{ recallNumber: 'Z-77', recallClass: 'II', firm: 'ACME', product: 'Widget', date: '2026-11-01' }] },
  getWardTeams: { ok: true, mappings: [{ ward: 'ICU', teamAri: 'ari:cloud:identity::team/11111111-aaaa-4bbb-8ccc-111111111111', teamName: 'Team Atlas' }], wards: ['ER', 'ICU'] },
  getCheckStatus: { ok: true, job: null },
  getTaskStates: { ok: true, tasks: { 'Z-1|d1': 'MOBL-5' }, states: { 'Z-1|d1': { key: 'MOBL-5', status: 'In review', category: 'indeterminate' } } },
  getProgress: { ok: true, progress: {
    overall: { pairs: 3, devices: 3, noTask: 2, open: 0, inProgress: 1, done: 0, withTask: 1, resolvedPercent: 0 },
    byRecall: [
      { recallNumber: 'Z-1', recallClass: 'I', firm: 'Firm', product: 'p', pairs: 1, devices: 1, noTask: 0, open: 0, inProgress: 1, done: 0, withTask: 1, resolvedPercent: 0 },
      { recallNumber: 'Z-2', recallClass: 'II', firm: 'Firm', product: 'p', pairs: 1, devices: 1, noTask: 1, open: 0, inProgress: 0, done: 0, withTask: 0, resolvedPercent: 0 },
    ],
    byWard: [{ ward: 'ER', pairs: 1, devices: 1, noTask: 1, open: 0, inProgress: 0, done: 0, withTask: 0, resolvedPercent: 0 }, { ward: 'ICU', pairs: 2, devices: 2, noTask: 1, open: 0, inProgress: 1, done: 0, withTask: 1, resolvedPercent: 0 }],
  } },
  getTaskSummary: { ok: true, summary: { open: 3, done: 1, capped: false } },
  listProjects: { ok: true, projects: [{ key: 'MOBL', name: 'Mobile' }], recent: ['MOBL'] },
  suggestAssignees: { ok: true, suggestions: {}, skipped: [] },
};
const text = (el) => el.textContent.replace(/\s+/g, ' ');
const failures = [];
const check = (label, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + label + (detail ? ' ' + detail : '')); if (!ok) failures.push(label); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(type, answers, steps) {
  const calls = [];
  global.__type = type;
  global.__invoke = async (name, payload) => { calls.push(name); return typeof answers[name] === 'function' ? answers[name](payload) : answers[name]; };
  const host = document.getElementById('root');
  host.innerHTML = '<div></div>';
  const el = host.firstChild;
  const reactRoot = createRoot(el);
  await act(async () => { reactRoot.render(React.createElement(Root)); });
  await act(async () => { await wait(300); });
  await steps(el, calls);
}
const click = async (el, re) => {
  const b = [...el.querySelectorAll('button')].find((x) => re.test(x.textContent));
  if (!b) throw new Error('no button ' + re);
  await act(async () => { b.click(); await wait(150); });
};
// A button by its accessible name: an aria-label, or (icon buttons) its visually hidden text.
const clickLabel = async (el, label) => {
  const b = [...el.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === label || x.textContent.trim() === label);
  if (!b) throw new Error('no button labelled ' + label);
  await act(async () => { b.click(); await wait(150); });
};
// Atlaskit Select (react-select): open it with a mouse press on its control, then click the option
const pickOption = async (el, inputId, optionText) => {
  const input = el.querySelector('#' + inputId);
  await act(async () => { input.closest('div[class*="control"], div').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })); input.focus(); input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await wait(100); });
  const option = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent === optionText);
  if (option) await act(async () => { option.click(); await wait(150); });
  return Boolean(option);
};

(async () => {
  // 1. first run: one big button, loads the demo hospital and starts a check
  await run('jira:globalPage', { ...base, listDevices: { ok: true, devices: [] }, getSavedMatches: { ok: true, result: null }, loadDemoHospital: { ok: true, count: 30 }, startCheck: { ok: true, state: 'saved', result } }, async (el, calls) => {
    check('first run shows the welcome, 3 steps and the demo button', /Welcome to RecallRadar/.test(text(el)) && /Step 3/.test(text(el)) && [...el.querySelectorAll('button')].some((b) => /Load demo hospital/.test(b.textContent)));
    await click(el, /^Load demo hospital/);
    check('loading the demo hospital starts a check and shows the dashboard', calls.includes('loadDemoHospital') && calls.includes('startCheck') && /Affected devices/.test(text(el)));
  });
  // 2. ready: one hero with a summary line (no stat cards), the table, the filter, the collapsed recent list
  await run('jira:globalPage', { ...base, listDevices: { ok: true, devices: [1, 2, 3] }, getSavedMatches: { ok: true, result } }, async (el, calls) => {
    check('ready screen shows the hero and do-this-first', /devices? need(s)? action/.test(text(el)) && /Do this first/.test(text(el)));
    const summary = el.querySelector('ul[aria-label="Summary"]');
    check('the hero holds one summary line: devices, open recalls by class, task counts', Boolean(summary) && /3 devices monitored/.test(text(summary)) && /3 open recalls/.test(text(summary)) && /Class I/.test(text(summary)) && /Class III/.test(text(summary)) && /3 tasks open, 1 done/.test(text(summary)));
    check('there are no separate stat cards any more', !el.querySelector('[role="group"][aria-label="Open recalls"]') && !el.querySelector('[role="group"][aria-label="Tasks open"]'));
    check('table has a row per affected device and, with 3 rows, no pager', el.querySelectorAll('tbody tr').length === 3 && !el.querySelector('nav[aria-label="Pages of affected devices"]'));
    check('team name from the graph is shown', /Team Atlas/.test(text(el)));
    const taskRow = [...el.querySelectorAll('tbody tr')].find((r) => /MOBL-5/.test(r.textContent));
    check('a task shows Jira\'s own status next to its key', Boolean(taskRow) && /In review/.test(taskRow.textContent) && !calls.includes('getProgress'));
    check('every row has one way in: no "Details" buttons, the device name opens the details', ![...el.querySelectorAll('button')].some((b) => /^Details$/.test(b.textContent.trim())) && el.querySelectorAll('button[aria-label="Details for Pump d2, recall Z-2"]').length >= 1);
    check('the ward filter lists the wards', await pickOption(el, 'rr-ward-filter', 'ICU'));
    check('ward filter narrows the table', /Showing 2 of 3/.test(text(el)));
    check('the table has an accessible caption and a status region', !!el.querySelector('caption') && !!el.querySelector('[role="status"]'));
    // the least important section starts closed and asks the FDA only when opened
    const recent = [...el.querySelectorAll('button')].find((b) => /^Recent FDA device recalls$/.test(b.textContent.trim()));
    check('"Recent FDA device recalls" is a collapsed disclosure and has not asked the FDA yet', Boolean(recent) && recent.getAttribute('aria-expanded') === 'false' && !calls.includes('fetchRecalls') && !/Z-77/.test(text(el)));
    await act(async () => { recent.click(); await wait(250); });
    check('opening it loads the list once and shows it', recent.getAttribute('aria-expanded') === 'true' && calls.filter((c) => c === 'fetchRecalls').length === 1 && /Z-77/.test(text(el)));
    // the drawer: the name opens it, the whole recall header is the toggle
    const nameLink = el.querySelector('button[aria-label="Details for Pump d2, recall Z-2"]');
    await act(async () => { nameLink.click(); await wait(250); });
    const drawer = el.querySelector('[role="dialog"]');
    check('the device name opens the drawer', Boolean(drawer) && drawer.getAttribute('aria-label') === 'Details for Pump d2');
    if (drawer) {
      const toggle = [...drawer.querySelectorAll('button[aria-expanded]')].find((b) => /Z-2/.test(b.textContent));
      check('the whole recall header is one toggle holding the number and both lozenges', Boolean(toggle) && /Class II/.test(toggle.textContent) && /Likely match/.test(toggle.textContent) && toggle.getAttribute('aria-expanded') === 'false');
      await act(async () => { toggle.click(); await wait(100); });
      check('opening it shows why the device matches', toggle.getAttribute('aria-expanded') === 'true' && /Why we think it matches/.test(text(drawer)));
      check('without a suggested person the drawer offers a plain "Create task" and no menu', [...drawer.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create task') && ![...drawer.querySelectorAll('button')].some((b) => /More ways to create/.test(b.textContent)));
    }
    // the Progress tab: read from Jira only when it is opened
    const progressTab = [...el.querySelectorAll('[role="tab"]')].find((t) => /^Progress$/.test(t.textContent.trim()));
    check('there is a Progress tab', Boolean(progressTab));
    await act(async () => { progressTab.click(); await wait(400); });
    check('opening it reads the progress once', calls.filter((c) => c === 'getProgress').length === 1);
    const lists = [...el.querySelectorAll('ul[aria-label^="Progress by"]')];
    check('it shows the overall share and a list per recall and per ward', /0% resolved/.test(text(el)) && lists.length === 2 && /Z-1/.test(text(lists[0])) && /ICU/.test(text(lists[1])) && /2 no task yet/.test(text(el)));
    check('every bar has a text label and the legend names the four parts', el.querySelectorAll('[role="img"][aria-label]').length >= 3 && ['done', 'in progress', 'to do', 'no task yet'].every((w) => new RegExp(w).test(text(el.querySelector('ul[aria-label="Legend"]')))));
  });
  // 2b. a long list: ten per page with the standalone pager, sorting covers ALL rows, filters go back to page 1
  const many = { ...result, matches: Array.from({ length: 23 }, (_, i) => mk('d' + (i + 1), 'Z-' + (i + 1), i < 2 ? 'I' : 'II', i % 2 ? 'ER' : 'ICU')) };
  await run('jira:globalPage', { ...base, listDevices: { ok: true, devices: new Array(23).fill(1) }, getSavedMatches: { ok: true, result: many } }, async (el) => {
    const pager = () => el.querySelector('nav[aria-label="Pages of affected devices"]');
    const rows = () => el.querySelectorAll('tbody tr');
    check('23 matches show ten rows and a pager', rows().length === 10 && Boolean(pager()) && /Showing 1–10 of 23 device and recall matches/.test(text(el)));
    const current = () => [...pager().querySelectorAll('button[aria-current="page"]')].map((b) => b.textContent.trim());
    check('the pager marks exactly one current page, and it is page 1', current().length === 1 && current()[0] === '1');
    await clickLabel(el, 'Page 2');
    check('page 2 shows rows 11 to 20, says so and becomes the current page', rows().length === 10 && /Showing 11–20 of 23/.test(text(el)) && current()[0] === '2');
    await clickLabel(el, 'Next page');
    check('the last page holds the remaining three', rows().length === 3 && /Showing 21–23 of 23/.test(text(el)));
    const header = [...el.querySelectorAll('th')].find((t) => /^Device/.test(t.textContent.trim()));
    const sortBy = async () => act(async () => { (header.querySelector('button') || header).click(); await wait(150); });
    await sortBy();
    await sortBy();
    check('sorting covers all rows (the last name comes first, descending) and goes back to page 1', /^Pump d23/.test(text(rows()[0])) && /Showing 1–10 of 23/.test(text(el)));
    check('the filter lists the wards', await pickOption(el, 'rr-ward-filter', 'ER'));
    check('a filter starts again at page 1 and says how many there are in all', /Showing 1–10 of 11 device and recall matches \(23 in all\)/.test(text(el)) && rows().length === 10);
  });
  // 2c. a suggested person: "Create task" assigns nobody, the menu offers the one suggested person
  const suggestions = { 'Z-2|d2': { accountId: 'acc-1', name: 'Casey Morgan', teamName: 'Team Atlas' } };
  await run('jira:globalPage', { ...base, listDevices: { ok: true, devices: [1, 2, 3] }, getSavedMatches: { ok: true, result }, suggestAssignees: { ok: true, suggestions, skipped: [] }, createTasks: (payload) => { global.__createPayload = payload; return { ok: true, created: [{ pair: 'Z-2|d2', key: 'MOBL-6' }], existing: [], inProgress: [], failed: [], notFound: [], assignedTo: {}, assignRefused: [] }; } }, async (el, calls) => {
    await clickLabel(el, 'Details for Pump d2, recall Z-2');
    const drawer = el.querySelector('[role="dialog"]');
    check('the drawer opened for the device', Boolean(drawer));
    const more = drawer && [...drawer.querySelectorAll('button')].find((b) => /More ways to create the task for Z-2/.test(b.textContent));
    check('with a suggested person the card has a split button: "Create task" plus a menu', Boolean(more) && [...drawer.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Create task'));
    if (more) {
      await act(async () => { more.click(); await wait(200); });
      const item = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], button, a')].find((n) => /Create and assign to Casey Morgan/.test(n.textContent));
      check('the menu offers "Create and assign to" the suggested person, with the team as the reason', Boolean(item) && /Fewest open RecallRadar tasks in Team Atlas/.test(document.body.textContent));
      check('nothing was created just by opening the menu', !calls.includes('createTasks'));
      if (item) {
        await act(async () => { item.click(); await wait(250); });
        check('choosing it creates the task and sends exactly that person for exactly that device and recall', calls.includes('createTasks') && global.__createPayload && global.__createPayload.assignees && global.__createPayload.assignees['Z-2|d2'] === 'acc-1');
      }
    }
  });
  // 2d. the remove dialog uses Atlaskit radios and a danger button that names what it removes
  const someImported = [{ source: 'manual' }, { source: 'manual' }, { source: 'demo' }];
  await run('jira:globalPage', { ...base, listDevices: { ok: true, devices: someImported }, getSavedMatches: { ok: true, result } }, async (el) => {
    await clickLabel(el, 'More actions');
    const item = [...document.querySelectorAll('[role="menuitem"], button, a')].find((n) => /^Remove devices…$/.test(n.textContent.trim()));
    check('the "..." menu offers "Remove devices…"', Boolean(item));
    if (item) {
      await act(async () => { item.click(); await wait(250); });
      const group = document.querySelector('[role="radiogroup"]');
      const radios = group ? [...group.querySelectorAll('input[type="radio"]')] : [];
      check('the remove dialog has a radio group with two choices, "only imported" selected', radios.length === 2 && radios[0].checked && !radios[1].checked && /Only the devices I imported \(2\)/.test(group.textContent) && /All devices, including the demo hospital \(3\)/.test(group.textContent));
      check('the danger button names the choice', [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Remove 2 imported devices'));
      if (radios[1]) {
        await act(async () => { radios[1].click(); await wait(150); });
        check('choosing "all devices" changes the danger button to "Remove all 3 devices"', [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Remove all 3 devices'));
      }
    }
  });
  // Nothing imported: the "only imported" choice is shut and "all devices" is the preselected one.
  await run('jira:globalPage', { ...base, listDevices: { ok: true, devices: [{ source: 'demo' }, { source: 'demo' }] }, getSavedMatches: { ok: true, result } }, async (el) => {
    await clickLabel(el, 'More actions');
    const item = [...document.querySelectorAll('[role="menuitem"], button, a')].find((n) => /^Remove devices…$/.test(n.textContent.trim()));
    if (item) await act(async () => { item.click(); await wait(250); });
    // the previous run's dialog may still be in the document: this run's radios are the last two
    const radios = [...document.querySelectorAll('[role="radiogroup"] input[type="radio"]')].slice(-2);
    check('with nothing imported the "only imported" choice is disabled and "all devices" is chosen', radios.length === 2 && radios[0].disabled && radios[1].checked);
  });
  // Not a Jira administrator: the welcome screen says who can add devices and its two buttons are shut.
  await run('jira:globalPage', { ...base, listDevices: { ok: true, devices: [] }, getSavedMatches: { ok: true, result: null }, getCapabilities: { ok: true, canManageDevices: false } }, async (el) => {
    const buttons = [...el.querySelectorAll('button')].filter((b) => /Load demo hospital|Import your own devices/.test(b.textContent));
    check('a person who is not a Jira administrator is told who can add devices, and both buttons are shut', /A Jira administrator adds the devices/.test(text(el)) && buttons.length === 2 && buttons.every((b) => b.disabled));
  });
  // Not allowed to choose teams: the Ward teams tab says so and its selects are shut.
  await run('jira:globalPage', { ...base, listDevices: { ok: true, devices: [1, 2, 3] }, getSavedMatches: { ok: true, result }, getCapabilities: { ok: true, canManageDevices: false, canManageTeams: false } }, async (el) => {
    const tab = [...el.querySelectorAll('[role="tab"]')].find((t) => /^Ward teams/.test(t.textContent.trim()));
    await act(async () => { tab.click(); await wait(400); });
    check('a person who may not choose teams is told who may, and the team choices are shut', /A Jira or project administrator chooses the teams/.test(text(el)) && [...el.querySelectorAll('input[id^="rr-team-"]')].every((i) => i.disabled));
  });
  // 3. error screen
  await run('jira:globalPage', { ...base, listDevices: { ok: false }, getSavedMatches: { ok: true, result: null } }, async (el) => {
    check('error screen offers Try again', /Something went wrong/.test(text(el)) && [...el.querySelectorAll('button')].some((b) => /Try again/.test(b.textContent)));
  });
  // 4. import: the dialog opens from the first-run screen, with its remove options (the paste parsing itself is unit tested)
  const imp = { ...base, listDevices: { ok: true, devices: [] }, getSavedMatches: { ok: true, result: null }, startCheck: { ok: true, state: 'saved', result } };
  await run('jira:globalPage', imp, async (el) => {
    await click(el, /^Import your own devices/);
    const body = document.body.textContent.replace(/\s+/g, ' ');
    check('the import dialog opens with its options', /Import your own devices/.test(body) && /Do not include patient data/.test(body));
    check('the import button is disabled until something is pasted', [...document.querySelectorAll('button')].find((b) => b.textContent === 'Import devices').disabled);
  });
  // 5. the issue panel is a compact summary card: headline, rows without buttons, a dashboard link, "Create all" as a pop-up
  const panelAnswers = { ...base, listDevices: { ok: true, devices: [1] }, getSavedMatches: { ok: true, result } };
  await run('jira:issuePanel', panelAnswers, async (el, calls) => {
    const t = text(el);
    check('issue panel shows the headline, the urgent devices and the dashboard link', /devices? need(s)? action/.test(t) && /Open dashboard/.test(t) && /Pump d2/.test(t) && /Checked/.test(t));
    check('issue panel rows have no per-device buttons', ![...el.querySelectorAll('button')].some((b) => /^(Create task|Details)$/.test(b.textContent.trim())));
    check('the light panel does not call the Teamwork Graph, the recent FDA list or the task counts', !calls.includes('suggestAssignees') && !calls.includes('fetchRecalls') && !calls.includes('getTaskSummary') && !calls.includes('getWardTeams'));
    await click(el, /^Create all/);
    check('"Create all" opens the pop-up with the create-all context', global.__modalOpened === true && global.__modalOpts.context.view === 'create-all');
  });
  // 6. the pop-up itself: it asks first, creates, says what happened, and tells the panel to reload
  global.__modal = { view: 'create-all', projectKey: 'MOBL' };
  const created = { ok: true, created: [{ pair: 'Z-2|d2', key: 'MOBL-6' }, { pair: 'Z-3|d3', key: 'MOBL-7' }], existing: [], inProgress: [], failed: [], notFound: [], assignedTo: {}, assignRefused: [] };
  await run('jira:issuePanel', { ...panelAnswers, createTasks: created }, async (el, calls) => {
    check('the create-all pop-up asks before creating anything', /Create 2 tasks\?/.test(text(el)) && /MOBL/.test(text(el)) && !calls.includes('createTasks'));
    await click(el, /^Create 2$/);
    check('confirming creates the tasks and says so', calls.includes('createTasks') && /Created 2 tasks/.test(text(el)));
    await click(el, /^Close$/);
    check('closing the pop-up tells the panel to reload', global.__closed && global.__closed.created === true);
  });
  global.__modal = undefined;
  // 7. nothing matches an open recall: the hero says so and there is no empty table with "Clear filters" to confuse
  const quiet = { ...result, matches: [mk('d9', 'Z-9', 'II', 'ER', 'possible')] };
  await run('jira:globalPage', { ...base, listDevices: { ok: true, devices: [1, 2, 3] }, getSavedMatches: { ok: true, result: quiet } }, async (el) => {
    check('with no affected devices the hero says so', /No devices need action/.test(text(el)));
    check('with no affected devices there is no "do this first" list, no table and no filters', !/Do this first/.test(text(el)) && !/Affected devices/.test(text(el)) && !/Clear filters/.test(text(el)) && !el.querySelector('table'));
  });
  // 8. the issue panel with no devices: the main action is a real button
  await run('jira:issuePanel', { ...base, listDevices: { ok: true, devices: [] }, getSavedMatches: { ok: true, result: null } }, async (el, calls) => {
    check('an empty panel offers "Load demo hospital" as a button', /No devices yet/.test(text(el)) && [...el.querySelectorAll('button')].some((b) => /^Load demo hospital$/.test(b.textContent.trim())));
  });
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nall UI checks passed');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.stack); process.exit(1); });
