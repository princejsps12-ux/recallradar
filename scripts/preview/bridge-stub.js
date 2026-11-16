// The preview's stand-in for the Forge host. @forge/bridge only needs globalThis.__bridge.callBridge(name, payload), so
// the REAL production bundle runs here unchanged and its resolver calls are answered by backend.js.
// Loaded before the bundle (see server.cjs). The page address says what to show:
//   ?view=dashboard|panel|create-all   which Forge module this is (the dashboard page, the issue panel, the pop-up)
//   &state=<scenario>                  a starting state from backend.js (ready, first-run, loading, error, ...)
//   &theme=light|dark
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const view = ['dashboard', 'panel', 'create-all'].includes(params.get('view')) ? params.get('view') : 'dashboard';
  const scenario = params.get('state') || 'ready';
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';

  // What the preview exists to catch: anything the Forge iframe's content security policy would block. The server
  // sends a policy with no 'unsafe-inline' for styles, like Forge does, so a component that writes <style> tags at run
  // time (Atlaskit's legacy Button, emotion) shows up here and in the console instead of silently looking unstyled.
  const violations = [];
  document.addEventListener('securitypolicyviolation', (event) => {
    violations.push({ directive: event.violatedDirective, blocked: event.blockedURI, sample: (event.sample || '').slice(0, 80) });
    console.warn('CSP violation:', event.violatedDirective, event.blockedURI, event.sample || '');
  });

  const calls = []; // navigation, modals and closes the app asked the host for
  const rr = { view, scenario, theme, violations, calls, backend: null, ready: null };
  window.__rr = rr;

  rr.ready = fetch('/preview/fixtures/demo.json')
    .then((response) => response.json())
    .then((fixtures) => {
      rr.backend = window.RRPreviewBackend.createBackend({ fixtures, scenario, duration: Number(params.get('duration')) || 5000 });
    });

  function context() {
    const extension = view === 'dashboard'
      ? { type: 'jira:globalPage' }
      : { type: 'jira:issuePanel', issue: { key: 'BIOMED-41', id: '10041', type: 'Task', typeId: '10002' }, project: { key: 'BIOMED', id: '10001', type: 'software' } };
    if (view === 'create-all') extension.modal = { view: 'create-all', projectKey: 'BIOMED' };
    return { accountId: 'preview-account', cloudId: 'preview-cloud', locale: 'en-US', timezone: 'UTC', environmentType: 'DEVELOPMENT', siteUrl: location.origin, theme: { colorMode: theme }, extension };
  }

  // What the Forge host does for view.theme.enable(): switch the design tokens on for this colour mode.
  function applyTheme() {
    document.documentElement.setAttribute('data-color-mode', theme);
    document.documentElement.setAttribute('data-theme', 'dark:dark light:light spacing:spacing shape:shape typography:typography');
  }

  globalThis.__bridge = {
    async callBridge(name, payload) {
      switch (name) {
        case 'invoke':
          await rr.ready;
          return rr.backend.invoke(payload.functionKey, payload.payload, { accountId: 'preview-account' });
        case 'getContext':
          return context();
        case 'enableTheming':
          applyTheme();
          return undefined;
        case 'navigate':
          calls.push({ name, payload });
          // "Open dashboard" in the panel: go to the dashboard view, the way the Jira page would.
          if (payload && payload.target === 'module' && payload.moduleKey === 'recallradar-dashboard') {
            const next = new URLSearchParams(location.search);
            next.set('view', 'dashboard');
            location.search = next.toString();
          }
          return undefined;
        case 'openModal':
          calls.push({ name, payload: { size: payload.size, context: payload.context } });
          return true;
        case 'close':
          calls.push({ name, payload });
          window.parent.postMessage({ recallRadarPreviewClose: payload }, location.origin);
          return true;
        case 'reload':
          location.reload();
          return undefined;
        case 'getUrl':
          return location.href;
        default:
          console.warn(`The preview host has no answer for "${name}".`);
          return undefined;
      }
    },
  };
})();
