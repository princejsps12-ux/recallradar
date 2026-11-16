#!/usr/bin/env node
// Regenerates the Marketplace listing screenshots (marketplace/screenshots/01-... and up) from the real production bundle,
// so they always show the current UI, in light and dark, on desktop and phone, with invented (never real) data:
//
//   (cd static/hello-world && npm run build)
//   node scripts/preview/shots.cjs                  all of them
//   node scripts/preview/shots.cjs --only=03,11      just those numbers
//   node scripts/preview/shots.cjs --out=/tmp/shots  somewhere else
//
// Desktop shots are 1440 x 900 CSS pixels, the issue panel is 680 x 262 (its real frame), phone shots are 390 x 844,
// all captured at 2x so the text is crisp. The file names are the ones LISTING.md and the README refer to.
const fs = require('fs');
const path = require('path');
const { session, open, click, waitFor, choose, scrollToText, sleep } = require('./lib.cjs');

const outDir = path.resolve(process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] || path.join(__dirname, '../../marketplace/screenshots'));
const only = (process.argv.find((a) => a.startsWith('--only='))?.split('=')[1] || '').split(',').filter(Boolean);

const DASH = { view: 'dashboard', state: 'in-progress' };
const PHONE = { width: 390, height: 844, gutter: 16 };

// Opens the first device in "Do this first" and its first recall card (the drawer).
async function openDrawer({ frame }) {
  await click(frame, 'Details for', { exact: false, selector: 'button' });
  await sleep(500);
  await frame.evaluate(() => document.querySelector('[role="dialog"] button[aria-expanded="false"]').click());
  await sleep(300);
}
const menu = async ({ frame }, item) => {
  await click(frame, 'More actions', { selector: 'button' });
  await click(frame, item, { selector: '[role="menuitem"], button' });
};

// [number, file, spec, steps]
const SHOTS = [
  ['01', 'dashboard-overview-light', { ...DASH, theme: 'light' }, async () => {}],
  ['02', 'affected-devices-light', { ...DASH, theme: 'light' }, async ({ frame }) => scrollToText(frame, 'Affected devices')],
  ['03', 'device-drawer-light', { ...DASH, theme: 'light' }, openDrawer],
  ['04', 'ward-teams-light', { ...DASH, theme: 'light' }, async ({ frame }) => {
    await click(frame, 'Ward teams', { exact: false, selector: '[role="tab"]' });
    await waitFor(frame, 'Choose the team for each ward');
    await sleep(500);
  }],
  ['05', 'import-dialog-light', { ...DASH, theme: 'light' }, async (o) => {
    await menu(o, 'Import devices');
    await sleep(400);
    await o.frame.evaluate(() => {
      const box = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(box, 'Name\tManufacturer\tModel\tSerial\tWard\nSigma Spectrum pump\tBaxter Healthcare\t35700BAX2\tSP-30977\tMed-Surg 4E\nAlaris pump module\tBecton Dickinson\t8100\tAL-55120\tICU\nVentilator\tHamilton Medical\tC1\tHM-20418\tRespiratory');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(300);
  }],
  ['06', 'confluence-dialog-light', { ...DASH, theme: 'light' }, async (o) => {
    await menu(o, 'Create Confluence pages');
    await waitFor(o.frame, 'Confluence space');
    await sleep(300);
    await choose(o.frame, 'rr-space', 'Biomedical Engineering (BIOMED)');
    await sleep(300);
  }],
  ['07', 'first-run-light', { view: 'dashboard', state: 'first-run', theme: 'light' }, async () => {}],
  ['08', 'loading-state-light', { view: 'dashboard', state: 'loading', theme: 'light', loading: true }, async () => {}],
  ['09', 'issue-panel-light', { view: 'panel', state: 'in-progress', theme: 'light' }, async () => {}],
  ['10', 'dashboard-overview-dark', { ...DASH, theme: 'dark' }, async () => {}],
  ['11', 'device-drawer-dark', { ...DASH, theme: 'dark' }, openDrawer],
  ['12', 'issue-panel-dark', { view: 'panel', state: 'in-progress', theme: 'dark' }, async () => {}],
  ['13', 'narrow-overview-dark', { ...DASH, theme: 'dark', ...PHONE }, async () => {}],
  ['14', 'narrow-devices-dark', { ...DASH, theme: 'dark', ...PHONE }, async ({ frame }) => scrollToText(frame, 'Affected devices')],
  // More than the original fourteen: how the app helps with assignment, confirms before creating, shows a refresh in progress (the
// old result stays on screen), and what it says when every device has a task or none needs action.
  ['15', 'assign-menu-light', { ...DASH, theme: 'light' }, async (o) => {
    await openDrawer(o);
    await click(o.frame, 'More ways to create the task', { exact: false, selector: 'button' });
    await sleep(400);
  }],
  ['16', 'create-all-confirm-light', { ...DASH, theme: 'light' }, async ({ frame }) => {
    await click(frame, 'Create all', { exact: false, selector: 'button' });
    await sleep(500);
  }],
  ['17', 'check-refreshing-light', { view: 'dashboard', state: 'refreshing', theme: 'light' }, async () => {}],
  ['18', 'all-tasks-created-light', { view: 'dashboard', state: 'all-done', theme: 'light' }, async () => {}],
  ['19', 'no-devices-need-action-light', { view: 'dashboard', state: 'none-affected', theme: 'light' }, async () => {}],
];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const s = await session({ scale: 2 });
  try {
    for (const [number, name, spec, steps] of SHOTS) {
      if (only.length && !only.includes(number)) continue;
      const opened = await open(s, spec);
      await steps(opened);
      await sleep(300);
      const file = path.join(outDir, `${number}-${name}.jpg`);
      await opened.page.screenshot({ path: file, type: 'jpeg', quality: 88 });
      console.log(`${path.relative(process.cwd(), file)}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
      await opened.page.close();
    }
  } finally {
    await s.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
