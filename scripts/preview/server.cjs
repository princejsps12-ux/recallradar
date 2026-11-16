#!/usr/bin/env node
// The preview server: runs the REAL production bundle (static/hello-world/build) with a stubbed Forge host, so every
// screen and state can be seen, captured and checked without Jira and without touching any real data.
//
//   (cd static/hello-world && npm run build)     the bundle, the same one forge deploy ships
//   node scripts/preview/server.cjs               then open http://localhost:4173/
//
// /frame.html?view=dashboard&state=ready&theme=light&width=1440&height=900 is the page to open (it shows the app in an
// iframe of that size, so phone widths behave like a phone). See README.md in this folder for every parameter.
const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.PORT || 4173);
const here = __dirname;
const app = path.resolve(here, '../../static/hello-world');
const build = path.join(app, 'build');

// The policy the Forge iframe applies, as far as styling goes: NO 'unsafe-inline' for styles (so <style> tags written
// at run time are blocked, which is what leaves legacy Atlaskit components unstyled), and scripts only from this origin.
// Inline style="..." set through the DOM (what React does) is still allowed, exactly as in Jira.
// 'report-sample' makes a violation say which style or script it was, so it can be traced to a component.
const CSP = "default-src 'none'; script-src 'self' 'report-sample'; style-src 'self' 'report-sample'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

// The design-token stylesheets the Forge host switches on for view.theme.enable(): colours for light and dark, spacing,
// type and shape. They are strings inside @atlaskit/tokens; served as one real stylesheet because inline <style> is blocked.
let themeCss = null;
function theme() {
  if (themeCss) return themeCss;
  const dir = path.join(app, 'node_modules/@atlaskit/tokens/dist/cjs/artifacts/themes');
  themeCss = ['atlassian-light', 'atlassian-dark', 'atlassian-spacing', 'atlassian-typography', 'atlassian-shape']
    .map((name) => require(path.join(dir, `${name}.js`)).default)
    .join('\n');
  return themeCss;
}

const send = (res, status, type, body, extra = {}) => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(body);
};

function appPage(query) {
  const manifest = JSON.parse(fs.readFileSync(path.join(build, 'asset-manifest.json'), 'utf8'));
  const files = manifest.entrypoints;
  const mode = query.get('theme') === 'dark' ? 'dark' : 'light';
  return `<!doctype html>
<html lang="en" data-color-mode="${mode}" data-theme="dark:dark light:light spacing:spacing shape:shape typography:typography">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RecallRadar (preview)</title>
<link rel="stylesheet" href="/preview/theme.css">
${files.filter((f) => f.endsWith('.css')).map((f) => `<link rel="stylesheet" href="/${f}">`).join('\n')}
<script src="/preview/backend.js"></script>
<script src="/preview/bridge-stub.js"></script>
${query.get('axe') ? '<script src="/axe.js"></script>' : ''}
${files.filter((f) => f.endsWith('.js')).map((f) => `<script defer src="/${f}"></script>`).join('\n')}
</head>
<body><div id="root"></div></body>
</html>
`;
}

// The page you open: the app inside an iframe of an exact size. Panel: 680 x 262 (the panel's real height, set by
// viewportSize in manifest.yml). Dashboard: 1440 x 900. width= and height= override.
const FRAME = `<!doctype html>
<meta charset="utf-8">
<title>RecallRadar preview</title>
<style>html,body{margin:0;padding:0;height:100%}</style>
<body>
<script>
  const q = new URLSearchParams(location.search);
  const view = q.get('view') || 'dashboard';
  const size = { dashboard: [1440, 900], panel: [680, 262], 'create-all': [600, 460] }[view] || [1440, 900];
  const width = Number(q.get('width')) || size[0];
  const height = Number(q.get('height')) || size[1];
  // gutter: space either side of the app (Jira's page has its own, so a phone-width shot looks like it does in Jira).
  const gutter = Number(q.get('gutter')) || 0;
  const inner = new URLSearchParams(q);
  inner.delete('width');
  inner.delete('height');
  inner.delete('gutter');
  document.body.style.background = q.get('theme') === 'dark' ? '#1f1f21' : '#ffffff';
  const frame = document.createElement('iframe');
  frame.id = 'app';
  frame.title = 'RecallRadar preview';
  frame.src = '/app.html?' + inner;
  frame.style.cssText = 'border:0;display:block;margin-left:' + gutter + 'px;width:' + (width - 2 * gutter) + 'px;height:' + height + 'px';
  document.body.appendChild(frame);
</script>
`;

const PROBE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>CSP probe</title><link rel="stylesheet" href="/preview/probe.css"></head>
<body><h1>Which ways of styling survive the preview's content security policy?</h1><pre id="results">running…</pre><script src="/preview/csp-probe.js"></script></body></html>
`;

function file(res, filePath, extra) {
  fs.readFile(filePath, (error, data) => {
    if (error) return send(res, 404, 'text/plain', `Not found: ${path.basename(filePath)}`);
    return send(res, 200, TYPES[path.extname(filePath)] || 'application/octet-stream', data, extra);
  });
}

// A file inside `dir` only: no way out with "..".
function inside(dir, relative) {
  const full = path.resolve(dir, '.' + path.sep + relative);
  return full.startsWith(dir + path.sep) ? full : null;
}

function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname;
  const csp = { 'Content-Security-Policy': CSP };
  if (route === '/') {
    res.writeHead(302, { Location: '/frame.html?view=dashboard&state=ready&theme=light' });
    return res.end();
  }
  if (route === '/favicon.ico') return send(res, 204, 'image/x-icon', '');
  if (route === '/frame.html') return send(res, 200, TYPES['.html'], FRAME);
  if (route === '/app.html') {
    if (!fs.existsSync(path.join(build, 'asset-manifest.json'))) return send(res, 500, 'text/plain', 'No build yet: run "npm run build" in static/hello-world first.');
    return send(res, 200, TYPES['.html'], appPage(url.searchParams), csp);
  }
  if (route === '/csp-probe.html') return send(res, 200, TYPES['.html'], PROBE, csp);
  if (route === '/preview/theme.css') return send(res, 200, TYPES['.css'], theme());
  if (route === '/preview/probe.css') return send(res, 200, TYPES['.css'], '.probe{margin:4px 0}.p6{color:rgb(255,0,0)}');
  if (route === '/axe.js') return file(res, path.join(app, 'node_modules/axe-core/axe.min.js'));
  if (route.startsWith('/preview/')) {
    const target = inside(here, route.slice('/preview/'.length));
    return target && !/server\.cjs$|make-fixtures/.test(target) ? file(res, target) : send(res, 404, 'text/plain', 'Not found');
  }
  if (route.startsWith('/static/')) {
    const target = inside(build, route.slice(1));
    return target ? file(res, target, csp) : send(res, 404, 'text/plain', 'Not found');
  }
  return send(res, 404, 'text/plain', 'Not found');
}

// Starts the server (port 0 picks a free one) and resolves to { server, port }. The check and capture scripts use this.
function start(port = PORT) {
  return new Promise((resolve) => {
    const server = http.createServer(handle);
    server.listen(port, () => resolve({ server, port: server.address().port }));
  });
}

module.exports = { start };

if (require.main === module) {
  start().then(({ port }) => {
    console.log(`RecallRadar preview: http://localhost:${port}/  (bundle: ${path.relative(process.cwd(), build) || build})`);
  });
}
