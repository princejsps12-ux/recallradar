#!/usr/bin/env node
// One screenshot of one view in one state, for looking at it (or for a bug report):
//
//   node scripts/preview/shot.cjs <view> <state> <theme> [width height] [--out=path.png] [--scale=2] [--full] [--system-font] [--tab=Progress] [--menu="Daily alerts"] [--paste="csv text, \\n for new lines"] [--run="Run now"] [--drawer="Impella Controller" [--people]]
//   node scripts/preview/shot.cjs dashboard none-affected light
//   node scripts/preview/shot.cjs panel first-run dark 360 262 --out=/tmp/panel.png
//
// view: dashboard | panel | create-all    state: see STATES in README.md    theme: light | dark
// Needs the bundle built first (cd static/ui && npm run build) and Chrome. Prints where the image went.
const path = require('path');
const { session, open } = require('./lib.cjs');

const args = process.argv.slice(2);
const flag = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1];
const positional = args.filter((a) => !a.startsWith('--'));
const [view = 'dashboard', state = 'ready', theme = 'light', width, height] = positional;

(async () => {
  const out = path.resolve(flag('out') || `/tmp/recallradar-${view}-${state}-${theme}.png`);
  const s = await session({ scale: Number(flag('scale')) || 1, font: !args.includes('--system-font') });
  try {
    const opened = await open(s, { view, state, theme, width: Number(width) || undefined, height: Number(height) || undefined });
    if (flag('tab')) {
      // Opens a dashboard tab by its name ("Progress", "Ward teams") before the picture is taken.
      await opened.frame.evaluate((name) => {
        const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim().startsWith(name));
        if (!tab) throw new Error(`No tab called "${name}"`);
        tab.click();
      }, flag('tab'));
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    if (flag('menu')) {
      // Opens a dialog from the "..." menu by the item's name before the picture is taken.
      await opened.frame.evaluate(() => document.querySelector('button[aria-label="More actions"]').click());
      await new Promise((resolve) => setTimeout(resolve, 400));
      await opened.frame.evaluate((name) => {
        const item = [...document.querySelectorAll('[role="menuitem"], button')].find((n) => n.textContent.trim().startsWith(name));
        if (!item) throw new Error(`No menu item "${name}"`);
        item.click();
      }, flag('menu'));
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    if (flag('paste')) {
      // Types into the import dialog's text box (a literal \\n in the text is a new line) and waits for the preview to be read.
      await opened.frame.type('textarea[aria-label="Devices to import"]', flag('paste').replace(/\\n/g, '\n'));
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
    if (flag('drawer')) {
      // Opens the details drawer of a device by its name, and with --people also expands "Who handles this ward".
      await opened.frame.evaluate((name) => {
        const button = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith(`Details for ${name}`));
        if (!button) throw new Error(`No device "${name}"`);
        button.click();
      }, flag('drawer'));
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (args.includes('--people')) {
        await opened.frame.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /Who handles this ward/.test(b.textContent)).click());
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    }
    if (flag('run')) {
      await opened.frame.evaluate((name) => {
        const button = [...document.querySelectorAll('[role="dialog"] button')].find((n) => n.textContent.trim() === name);
        if (!button) throw new Error(`No button "${name}"`);
        button.click();
      }, flag('run'));
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    await opened.page.screenshot({ path: out, fullPage: args.includes('--full') });
    console.log(out);
  } finally {
    await s.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
