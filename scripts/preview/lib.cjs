// Shared helpers for the preview scripts (check.cjs, shots.cjs): start the preview server, drive headless Chrome with
// puppeteer-core (installed in static/hello-world, it uses the Chrome you already have), open a view in a state, wait
// until it has settled, click things by their visible text, run axe-core.
'use strict';
const fs = require('fs');
const path = require('path');
const { start } = require('./server.cjs');

const app = path.resolve(__dirname, '../../static/hello-world');
const puppeteer = require(path.join(app, 'node_modules/puppeteer-core'));

const SIZES = { dashboard: [1440, 900], panel: [680, 262], 'create-all': [600, 460] };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chromePath() {
  const candidates = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Chrome was not found. Install it or set CHROME=/path/to/chrome.');
  return found;
}

// One server and one browser for the whole run. `scale` is the device pixel ratio (2 = crisp screenshots).
async function session({ scale = 1 } = {}) {
  if (!fs.existsSync(path.join(app, 'build', 'asset-manifest.json'))) throw new Error('No build yet: run "npm run build" in static/hello-world first.');
  const { server, port } = await start(0);
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--hide-scrollbars'] });
  return { port, scale, browser, close: async () => { await browser.close(); server.close(); } };
}

// Opens one view in one state and waits until it has settled.
//   spec: { view, state, theme, width, height, axe, scale, loading }
// Returns { page, frame, messages, spec }: `frame` is the app's own frame (all clicks and checks happen there).
async function open(s, spec) {
  const view = spec.view || 'dashboard';
  const [defaultWidth, defaultHeight] = SIZES[view] || SIZES.dashboard;
  const page = await s.browser.newPage();
  await page.setViewport({ width: spec.width || defaultWidth, height: spec.height || defaultHeight, deviceScaleFactor: spec.scale || s.scale });
  const messages = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') messages.push({ type: message.type(), text: message.text() });
  });
  page.on('pageerror', (error) => messages.push({ type: 'pageerror', text: String((error && error.message) || error) }));
  const query = new URLSearchParams({ view, state: spec.state || 'ready', theme: spec.theme || 'light' });
  // The frame page sizes the app's iframe from these two (so a phone width really is a phone-width layout).
  if (spec.width) query.set('width', String(spec.width));
  if (spec.height) query.set('height', String(spec.height));
  if (spec.gutter) query.set('gutter', String(spec.gutter));
  if (spec.axe) query.set('axe', '1');
  if (spec.duration) query.set('duration', String(spec.duration));
  await page.goto(`http://localhost:${s.port}/frame.html?${query}`, { waitUntil: 'load' });
  const frame = await page.waitForFrame((f) => f.url().includes('/app.html'), { timeout: 20000 });
  await frame.waitForFunction(() => window.__rr && window.__rr.backend, { timeout: 20000 });
  await frame.waitForFunction(() => document.getElementById('root') && document.getElementById('root').children.length > 0, { timeout: 20000 });
  // Two states are busy on purpose: the loading skeleton, and the dashboard while a check runs (a skeleton under the progress).
  const staysBusy = spec.loading || spec.state === 'loading' || spec.state === 'running';
  // ('refreshing' is not busy in this sense: it keeps the saved result on screen, with the progress in the header.)
  if (!staysBusy) await frame.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), { timeout: 20000 });
  await sleep(spec.settleMs === undefined ? 600 : spec.settleMs);
  return { page, frame, messages, spec };
}

// --- driving the app by what a person sees -----------------------------------------------------------------------

// Clicks the first element matching `selector` whose visible text or aria-label is `text` (exact by default).
async function click(frame, text, { selector = 'button, [role="menuitem"], [role="tab"], a, [role="option"]', exact = true } = {}) {
  const found = await frame.evaluate((wanted, sel, strict) => {
    const same = (value) => (strict ? value.trim() === wanted : value.includes(wanted));
    const el = [...document.querySelectorAll(sel)].find((node) => same(node.textContent || '') || same(node.getAttribute('aria-label') || ''));
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  }, text, selector, exact);
  if (!found) throw new Error(`Nothing to click with the text "${text}"`);
  await sleep(250);
}

async function exists(frame, text, { selector = 'button, [role="menuitem"], [role="tab"], a, [role="option"], h1, h2, h3, p, div, span, li', exact = false } = {}) {
  return frame.evaluate((wanted, sel, strict) => [...document.querySelectorAll(sel)].some((node) => (strict ? node.textContent.trim() === wanted : (node.textContent || '').includes(wanted))), text, selector, exact);
}

async function waitFor(frame, text, timeout = 8000) {
  await frame.waitForFunction((wanted) => document.body.innerText.includes(wanted), { timeout }, text);
}

async function press(frame, key) {
  await frame.evaluate((k) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    (document.activeElement || document.body).dispatchEvent(event);
  }, key);
  await sleep(350);
}

// Opens a react-select (Atlaskit Select) by its input id and picks the option with this text.
async function choose(frame, inputId, optionText) {
  await frame.evaluate((id) => {
    const input = document.getElementById(id);
    input.scrollIntoView({ block: 'center' });
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  }, inputId);
  await sleep(250);
  await click(frame, optionText, { selector: '[role="option"]' });
}

async function scrollToText(frame, text, block = 'start') {
  const ok = await frame.evaluate((wanted, where) => {
    const el = [...document.querySelectorAll('h1, h2, h3, h4')].find((h) => h.textContent.trim() === wanted);
    if (!el) return false;
    el.scrollIntoView({ block: where });
    return true;
  }, text, block);
  if (!ok) throw new Error(`No heading "${text}" to scroll to`);
  await sleep(300);
}

// --- checks ------------------------------------------------------------------------------------------------------

// axe-core inside the app's frame (the page must have been opened with axe: true).
async function axe(frame) {
  const whole = await frame.evaluate(() => window.__rr.view === 'dashboard');
  return frame.evaluate(async (wholePage) => {
    const result = await window.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
      // The app is an iframe inside a Jira page, and Jira's page has the level-one heading (the page title). The panel and
      // the pop-up are only fragments of that page, so "one main landmark" and "everything inside a landmark" are
      // judged on the dashboard alone.
      rules: { 'page-has-heading-one': { enabled: false }, 'landmark-one-main': { enabled: wholePage }, region: { enabled: wholePage } },
    });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
      samples: v.nodes.slice(0, 3).map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 140), why: (n.failureSummary || '').split('\n').slice(1, 3).join(' ').trim() })),
    }));
  }, whole);
}

// Everything measurable about the current screen of the app.
async function measure(frame) {
  return frame.evaluate(() => ({
    csp: window.__rr.violations.slice(),
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    // Interactive things smaller than WCAG 2.2's 24 x 24 px minimum (inline text links excepted: they sit in a sentence).
    smallTargets: [...document.querySelectorAll('button, a[href], input[type="checkbox"], input[type="radio"], [role="button"], [role="tab"], [role="menuitem"]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && (r.width < 24 || r.height < 24) && !el.closest('p, li > span, label');
      })
      .slice(0, 6)
      .map((el) => `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`),
  }));
}

module.exports = { session, open, click, exists, waitFor, press, choose, scrollToText, axe, measure, sleep, SIZES };
