// Atlassian Sans, the typeface Jira draws this app in, for SCREENSHOTS only.
//
// The preview runs in a plain browser, where "Atlassian Sans" (the first font in the design tokens' font stack) does not exist,
// so it falls back to the system font and the pictures look unlike Jira. This fetches the Latin subset of the variable font from
// the design-system CDN that Jira's own pages load it from, keeps it in scripts/preview/.cache/ (git-ignored: the font is not
// ours and is never committed), and returns an @font-face rule for it.
//
// Nothing that checks the app uses it (npm run test:preview must not depend on a network or on a font); only `npm run shots`
// and shot.cjs do, and when the font cannot be fetched they say so and use the system font instead.
'use strict';
const fs = require('fs');
const path = require('path');

const FONT_URL = 'https://ds-cdn.prod-east.frontend.public.atl-paas.net/assets/fonts/atlassian-sans/v4/AtlassianSans-latin.woff2';
// The same range Atlassian declares for this file; anything outside it (an arrow, say) falls back to the system font.
const UNICODE_RANGE = 'U+0-FF, U+131, U+152-153, U+2BB-2BC, U+2C6, U+2DA, U+2DC, U+304, U+308, U+329, U+2000-206F';
const CACHE_DIR = path.join(__dirname, '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'AtlassianSans-latin.woff2');
// A woff2 file starts with these four bytes; anything else (an error page) is not a font.
const MAGIC = Buffer.from('wOF2');

async function readFont() {
  if (fs.existsSync(CACHE_FILE)) {
    const cached = fs.readFileSync(CACHE_FILE);
    if (cached.subarray(0, 4).equals(MAGIC)) return cached;
  }
  const response = await fetch(FONT_URL, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`the font server answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.subarray(0, 4).equals(MAGIC)) throw new Error('what came back was not a woff2 font');
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, bytes);
  return bytes;
}

// The @font-face CSS, or '' (after saying why) when the font is not available.
async function fontCss() {
  try {
    const bytes = await readFont();
    return `@font-face { font-family: "Atlassian Sans"; font-style: normal; font-weight: 100 900; font-display: block; src: url(data:font/woff2;base64,${bytes.toString('base64')}) format("woff2"); unicode-range: ${UNICODE_RANGE}; }`;
  } catch (error) {
    console.warn(`Atlassian Sans could not be loaded (${error.message}): the pictures use the system font.`);
    return '';
  }
}

module.exports = { fontCss, FONT_URL };
