#!/usr/bin/env node
// One screenshot of one view in one state, for looking at it (or for a bug report):
//
//   node scripts/preview/shot.cjs <view> <state> <theme> [width height] [--out=path.png] [--scale=2] [--full]
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
  const s = await session({ scale: Number(flag('scale')) || 1 });
  try {
    const opened = await open(s, { view, state, theme, width: Number(width) || undefined, height: Number(height) || undefined });
    await opened.page.screenshot({ path: out, fullPage: args.includes('--full') });
    console.log(out);
  } finally {
    await s.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
