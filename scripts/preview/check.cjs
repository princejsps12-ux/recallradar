#!/usr/bin/env node
// Objective checks of the real production bundle in a real browser, over every view, state and theme, and over a tour
// of the interactions (drawer, menus, dialogs, tabs, selects). It fails (exit 1) on:
//   - a content security policy violation (something the Forge iframe would leave unstyled or block),
//   - a console error or an uncaught exception,
//   - an axe-core violation of impact serious or critical (contrast, names, roles, ...),
//   - issue-panel content taller than its fixed frame (262 px), or anything wider than the screen.
// Lesser axe findings and targets under 24 x 24 px are listed as warnings.
//
//   (cd static/ui && npm run build)
//   node scripts/preview/check.cjs            the full matrix, a few minutes
//   node scripts/preview/check.cjs --quick    light theme, fewer states
const { session, open, click, waitFor, press, choose, axe, measure, sleep } = require('./lib.cjs');

const quick = process.argv.includes('--quick');
const DASHBOARD_STATES = ['ready', 'in-progress', 'new-since', 'alerts-on', 'alerts-refused', 'all-done', 'first-run', 'no-check', 'running', 'refreshing', 'stale', 'failed-lookups', 'none-affected', 'no-graph', 'not-admin', 'project-admin', 'first-run-not-admin', 'refresh-error', 'error', 'loading'];
const PANEL_STATES = ['ready', 'in-progress', 'all-done', 'first-run', 'no-check', 'running', 'stale', 'failed-lookups', 'none-affected', 'refresh-error', 'error', 'loading'];

function matrix() {
  const list = [];
  for (const theme of quick ? ['light'] : ['light', 'dark']) {
    for (const state of quick ? ['ready', 'in-progress', 'first-run', 'error'] : DASHBOARD_STATES) list.push({ view: 'dashboard', state, theme, loading: state === 'loading' });
    for (const state of quick ? ['ready', 'all-done', 'first-run'] : PANEL_STATES) list.push({ view: 'panel', state, theme, loading: state === 'loading' });
    list.push({ view: 'create-all', state: 'ready', theme });
    for (const state of quick ? ['in-progress'] : ['in-progress', 'first-run', 'all-done']) list.push({ view: 'dashboard', state, theme, width: 390, height: 844 });
    for (const state of quick ? ['in-progress'] : ['in-progress', 'all-done']) list.push({ view: 'panel', state, theme, width: 360, height: 262 });
  }
  return list;
}

// Known and accepted: @atlaskit/modal-dialog locks the page's scroll with react-scrolllock, which writes this one style
// into a <style> tag. The Forge iframe's policy blocks it, so the page behind an open dialog can still scroll. Nothing
// else is allowed: any other violation fails the check.
// (The browser cuts a reported sample at 40 characters, hence the short pattern.)
const KNOWN_CSP = [/^body \{\s*box-sizing: border-box/];
const known = (violation) => KNOWN_CSP.some((pattern) => pattern.test(violation.sample || ''));

const label = (spec) => `${spec.view}/${spec.state}/${spec.theme}${spec.width ? `/${spec.width}px` : ''}`;
const results = [];

// Looks at the current screen of an opened view and records what is wrong with it.
async function inspect(opened, name, { checkHeight = false } = {}) {
  const { frame, messages } = opened;
  const m = await measure(frame);
  const violations = await axe(frame);
  const problems = [];
  const warnings = [];
  const unexpected = m.csp.filter((v) => !known(v));
  if (unexpected.length) problems.push(`CSP: ${unexpected.map((v) => `${v.directive} ${v.sample || v.blocked}`).join(' | ')}`);
  messages.splice(0).forEach((x) => {
    // The browser also logs every CSP violation as a console error: those are counted above, from the event.
    if (/violates the following Content Security Policy/.test(x.text)) return;
    if (x.type === 'pageerror' || x.type === 'error') problems.push(`console ${x.type}: ${x.text.slice(0, 160)}`);
  });
  if (checkHeight && m.scrollHeight > m.clientHeight + 1) problems.push(`panel content is ${m.scrollHeight}px in a ${m.clientHeight}px frame`);
  if (m.scrollWidth > m.clientWidth + 1) problems.push(`wider than the screen: ${m.scrollWidth}px in ${m.clientWidth}px`);
  // Guards the check itself: a phone-width run must really be a phone-width frame.
  const wanted = opened.spec.width ? opened.spec.width - 2 * (opened.spec.gutter || 0) : null;
  if (wanted && m.clientWidth !== wanted) problems.push(`the app frame is ${m.clientWidth}px wide, not the ${wanted}px asked for`);
  violations.forEach((v) => {
    const line = `axe ${v.id} (${v.impact}, ${v.nodes} node${v.nodes === 1 ? '' : 's'}): ${v.samples[0] ? `${v.samples[0].target} ${v.samples[0].why}`.slice(0, 200) : v.help}`;
    (v.impact === 'serious' || v.impact === 'critical' ? problems : warnings).push(line);
  });
  if (m.smallTargets.length) warnings.push(`targets under 24px: ${m.smallTargets.join('; ')}`);
  results.push({ name, problems, warnings });
  const status = problems.length ? 'FAIL' : warnings.length ? 'warn' : 'ok  ';
  console.log(`${status} ${name}${problems.length ? `\n       ${problems.join('\n       ')}` : ''}${warnings.length && process.argv.includes('--verbose') ? `\n       ${warnings.join('\n       ')}` : ''}`);
}

// A walk through the interactions people use, on the dashboard with some tasks created.
async function tour(s, theme) {
  const opened = await open(s, { view: 'dashboard', state: 'in-progress', theme, axe: true });
  const { frame } = opened;
  const step = async (name, action, options) => {
    try {
      await action();
      await sleep(350);
      await inspect(opened, `tour/${theme}/${name}`, options);
    } catch (error) {
      results.push({ name: `tour/${theme}/${name}`, problems: [`step failed: ${error.message}`], warnings: [] });
      console.log(`FAIL tour/${theme}/${name}\n       step failed: ${error.message}`);
    }
  };
  const escape = () => press(frame, 'Escape');

  await step('overview', async () => {});
  await step('ward filter', () => choose(frame, 'rr-ward-filter', 'ICU'));
  await step('page 2 of the table', async () => {
    await click(frame, 'Clear filters');
    await click(frame, 'Page 2');
  });
  await step('sorted by device', () => click(frame, 'Device', { selector: 'th button, th [role="button"], th' }));
  await step('recent recalls open', async () => {
    await click(frame, 'Recent FDA device recalls', { selector: 'button' });
    await waitFor(frame, 'Z-');
  });
  await step('device drawer', () => click(frame, 'Details for', { exact: false, selector: 'button' }));
  await step('drawer card open', () => frame.evaluate(() => document.querySelector('[role="dialog"] section[aria-label^="Recall"] button[aria-expanded="false"]').click()));
  await step('drawer: who handles this ward', async () => {
    await click(frame, 'Who handles this ward', { exact: false, selector: 'button' });
    await frame.waitForFunction(() => /Team: |No team is set/.test(document.body.innerText), { timeout: 8000 });
  });
  await step('drawer split button menu', () => click(frame, 'More ways to create the task', { exact: false, selector: 'button' }));
  await step('drawer closed', async () => { await escape(); await escape(); });
  await step('more actions menu', () => click(frame, 'More actions', { selector: 'button' }));
  await step('import dialog', () => click(frame, 'Import devices', { selector: '[role="menuitem"], button' }));
  await step('import dialog closed', escape);
  await step('confluence dialog', async () => {
    await click(frame, 'More actions', { selector: 'button' });
    await click(frame, 'Create Confluence pages', { selector: '[role="menuitem"], button' });
    await waitFor(frame, 'Confluence space');
    await sleep(300);
    await choose(frame, 'rr-space', 'Biomedical Engineering (BIOMED)');
  });
  await step('confluence dialog closed', escape);
  await step('remove dialog', async () => {
    await click(frame, 'More actions', { selector: 'button' });
    await click(frame, 'Remove devices…', { selector: '[role="menuitem"], button' });
  });
  await step('remove dialog closed', escape);
  await step('create all dialog', () => click(frame, 'Create all', { exact: false, selector: 'button' }));
  await step('create all dialog closed', escape);
  await step('daily alerts dialog', async () => {
    await click(frame, 'More actions', { selector: 'button' });
    await click(frame, 'Daily alerts', { exact: false, selector: '[role="menuitem"], button' });
    await waitFor(frame, 'Create tasks for new recalls every day');
  });
  await step('daily alerts dialog closed', escape);
  await step('progress tab', async () => {
    await click(frame, 'Progress', { selector: '[role="tab"]' });
    await waitFor(frame, 'By recall');
  });
  await step('progress: all recalls', () => click(frame, 'Show all', { exact: false, selector: 'button' }));
  await step('ward teams tab', async () => {
    await click(frame, 'Ward teams', { exact: false, selector: '[role="tab"]' });
    await waitFor(frame, 'Choose the team for each ward');
  });
  await step('team select open', () => frame.evaluate(() => {
    const input = document.querySelector('[id^="rr-team-"]');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  }));
  await opened.page.close();
}

// The daily alerts dialog where the alerts are on, and where Jira refuses the app user: the last run, the problem and what to do
// about it must all be on screen, and saving again says what to fix.
async function alertsTour(s, theme) {
  for (const state of ['alerts-on', 'alerts-refused']) {
    const name = `tour/${theme}/daily alerts dialog, ${state}`;
    try {
      const opened = await open(s, { view: 'dashboard', state, theme, axe: true });
      const { frame } = opened;
      await click(frame, 'More actions', { selector: 'button' });
      await click(frame, 'Daily alerts', { exact: false, selector: '[role="menuitem"], button' });
      await waitFor(frame, 'Last daily run');
      await sleep(350);
      await inspect(opened, name);
      if (state === 'alerts-refused') {
        await waitFor(frame, 'RecallRadar app user');
        await click(frame, 'Run now', { selector: 'button' });
        await waitFor(frame, 'Ran just now');
        await sleep(300);
        await inspect(opened, `${name}, after Run now`);
      }
      await opened.page.close();
    } catch (error) {
      results.push({ name, problems: [`step failed: ${error.message}`], warnings: [] });
      console.log(`FAIL ${name}\n       step failed: ${error.message}`);
    }
  }
}

// The "Who handles this ward" card for a ward with two projects, one with no project and a person whose work cannot be read, and
// for a graph that refuses: every state must be readable, keyboard reachable and inside the drawer.
async function peopleTour(s, theme) {
  const cases = [['in-progress', 'Details for Impella Controller', 'Cath Lab, two projects'], ['in-progress', 'Details for Digital ECG', 'Cardiology, no project and one person unread'], ['no-graph', 'Details for Impella Controller', 'the graph refuses']];
  for (const [state, label, what] of cases) {
    const name = `tour/${theme}/who handles this ward, ${what}`;
    try {
      const opened = await open(s, { view: 'dashboard', state, theme, axe: true });
      const { frame } = opened;
      await click(frame, label, { exact: false, selector: 'button' });
      await sleep(400);
      await click(frame, 'Who handles this ward', { exact: false, selector: 'button' });
      await frame.waitForFunction(() => /Team: |No team is set|Could not read the Teamwork Graph/.test(document.body.innerText), { timeout: 8000 });
      await sleep(350);
      await inspect(opened, name);
      await opened.page.close();
    } catch (error) {
      results.push({ name, problems: [`step failed: ${error.message}`], warnings: [] });
      console.log(`FAIL ${name}\n       step failed: ${error.message}`);
    }
  }
}

// The Progress tab on a phone: long product text must be cut with an ellipsis, never push the page wider than the screen.
async function progressPhone(s, theme) {
  const spec = { view: 'dashboard', state: 'in-progress', theme, width: 390, height: 844, axe: true };
  const name = `progress tab/${theme}/390px`;
  try {
    const opened = await open(s, spec);
    await click(opened.frame, 'Progress', { selector: '[role="tab"]' });
    await waitFor(opened.frame, 'By recall');
    await sleep(350);
    await inspect(opened, name);
    await opened.page.close();
  } catch (error) {
    results.push({ name, problems: [`step failed: ${error.message}`], warnings: [] });
    console.log(`FAIL ${name}\n       step failed: ${error.message}`);
  }
}

// The Confluence dialog on a site where the app is installed in Jira only (Confluence is an optional connection): it must say
// how to connect it and offer nothing to choose, instead of an empty form or a failure.
async function notConnectedTour(s, theme) {
  const opened = await open(s, { view: 'dashboard', state: 'no-confluence', theme, axe: true });
  const { frame } = opened;
  const name = `tour/${theme}/confluence dialog, not connected`;
  try {
    await click(frame, 'More actions', { selector: 'button' });
    await click(frame, 'Create Confluence pages', { selector: '[role="menuitem"], button' });
    await waitFor(frame, 'Connect RecallRadar to Confluence first');
    await sleep(350);
    const offersChoices = await frame.evaluate(() => /Choose a space|Confluence space/.test(document.body.innerText));
    await inspect(opened, name);
    if (offersChoices) {
      const entry = results.find((r) => r.name === name);
      entry.problems.push('the dialog still offers a space to choose although Confluence is not connected');
      console.log(`FAIL ${name}\n       the dialog still offers a space to choose although Confluence is not connected`);
    }
  } catch (error) {
    results.push({ name, problems: [`step failed: ${error.message}`], warnings: [] });
    console.log(`FAIL ${name}\n       step failed: ${error.message}`);
  }
  await opened.page.close();
}

(async () => {
  const s = await session({ scale: 1 });
  try {
    for (const spec of matrix()) {
      try {
        const opened = await open(s, { ...spec, axe: true });
        await inspect(opened, label(spec), { checkHeight: spec.view === 'panel' });
        await opened.page.close();
      } catch (error) {
        results.push({ name: label(spec), problems: [`did not open or settle: ${error.message}`], warnings: [] });
        console.log(`FAIL ${label(spec)}\n       did not open or settle: ${error.message}`);
      }
    }
    for (const theme of quick ? ['light'] : ['light', 'dark']) {
      await tour(s, theme);
      await progressPhone(s, theme);
      await peopleTour(s, theme);
      await alertsTour(s, theme);
      await notConnectedTour(s, theme);
    }
  } finally {
    await s.close();
  }
  const failed = results.filter((r) => r.problems.length);
  const warned = results.filter((r) => !r.problems.length && r.warnings.length);
  console.log(`\n${results.length} screens checked: ${results.length - failed.length - warned.length} clean, ${warned.length} with warnings, ${failed.length} failing`);
  if (warned.length && !process.argv.includes('--verbose')) console.log('(run with --verbose to list the warnings)');
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error('CHECK CRASHED', error);
  process.exit(2);
});
