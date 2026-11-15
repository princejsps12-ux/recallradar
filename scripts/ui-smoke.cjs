// A quick UI check that needs no browser or Atlassian site: it renders the real React views in jsdom with a
// stubbed @forge/bridge, clicks through the main flows and prints what it sees. Fails (exit 1) on a crash or a wrong result.
// Needs `npm install --legacy-peer-deps` in static/hello-world first (that installs jsdom and Babel).
// Run: node scripts/ui-smoke.cjs
const path = require('path');
const fs = require('fs');
const Module = require('module');
const root = path.resolve(__dirname, '../static/hello-world');
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
fs.writeFileSync(bridge, "module.exports={invoke:(n,p)=>global.__invoke(n,p),router:{open(){},navigate(){return Promise.resolve()}},view:{theme:{enable:()=>Promise.resolve()},getContext:()=>Promise.resolve({extension:{type:global.__type}})}};");
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
  getTaskStates: { ok: true, tasks: { 'Z-1|d1': 'MOBL-5' } },
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
const typeInto = async (node, value, proto) => {
  const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => { set.call(node, value); node.dispatchEvent(new window.Event(proto === window.HTMLSelectElement.prototype ? 'change' : 'input', { bubbles: true })); await wait(40); });
};

(async () => {
  // 1. first run: one big button, loads the demo hospital and starts a check
  await run('jira:globalPage', { ...base, listDevices: { ok: true, devices: [] }, getSavedMatches: { ok: true, result: null }, loadDemoHospital: { ok: true, count: 30 }, startCheck: { ok: true, state: 'saved', result } }, async (el, calls) => {
    check('first run shows the welcome, 3 steps and the demo button', /Welcome to RecallRadar/.test(text(el)) && /Step 3/.test(text(el)) && [...el.querySelectorAll('button')].some((b) => /Load demo hospital/.test(b.textContent)));
    await click(el, /^Load demo hospital/);
    check('loading the demo hospital starts a check and shows the dashboard', calls.includes('loadDemoHospital') && calls.includes('startCheck') && /Affected devices/.test(text(el)));
  });
  // 2. ready: cards, table, filter
  await run('jira:globalPage', { ...base, listDevices: { ok: true, devices: [1, 2, 3] }, getSavedMatches: { ok: true, result } }, async (el) => {
    check('ready screen shows the hero, do-this-first and summary cards', /devices? need(s)? action/.test(text(el)) && /Do this first/.test(text(el)) && /Open recalls/.test(text(el)) && /Tasks open/.test(text(el)));
    check('table has a row per affected device', el.querySelectorAll('tbody tr').length >= 3);
    check('team name from the graph is shown', /Team Atlas/.test(text(el)));
    // Atlaskit Select (react-select): open it with a mouse press on its control, then click the option
    const input = el.querySelector('#rr-ward-filter');
    await act(async () => { input.closest('div[class*="control"], div').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })); input.focus(); input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await wait(100); });
    const option = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent === 'ICU');
    check('the ward filter lists the wards', Boolean(option));
    if (option) await act(async () => { option.click(); await wait(150); });
    check('ward filter narrows the table', /Showing 2 of 3/.test(text(el)));
    check('the table has an accessible caption and a status region', !!el.querySelector('caption') && !!el.querySelector('[role="status"]'));
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
  // 5. the issue panel still renders, with its dashboard link
  await run('jira:issuePanel', { ...base, listDevices: { ok: true, devices: [1] }, getSavedMatches: { ok: true, result } }, async (el) => {
    check('issue panel renders the headline, a task button and the dashboard link', /devices? need(s)? action/.test(text(el)) && /Create task/.test(text(el)) && /Open the dashboard/.test(text(el)));
  });
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nall UI checks passed');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.stack); process.exit(1); });
