import React, { useEffect, useState } from 'react';
import { view } from '@forge/bridge';
import App from './App';
import Dashboard from './Dashboard';

// Shared interaction styles for both views: a visible keyboard focus ring, hover and disabled states, row
// hover, a sticky table header, a loading shimmer, and a narrow-screen layout. Colours are design tokens
// with light-theme fallbacks. Motion is switched off for people who ask for reduced motion.
const GLOBAL_CSS = `
.rr button:focus-visible, .rr select:focus-visible, .rr a:focus-visible, .rr textarea:focus-visible, .rr summary:focus-visible {
  outline: 2px solid var(--ds-border-focused, #388BFF); outline-offset: 2px; }
.rr button:not(:disabled):hover { background-image: linear-gradient(rgba(9,30,66,0.08), rgba(9,30,66,0.08)); }
.rr button:disabled { opacity: 0.6; cursor: not-allowed; }
.rr tbody tr:hover { background: var(--ds-background-neutral-subtle-hovered, rgba(9,30,66,0.06)); }
.rr thead th { position: sticky; top: 0; background: var(--ds-surface-raised, #fff); z-index: 1; }
.rr .rr-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.rr .rr-skeleton { background: linear-gradient(90deg, var(--ds-background-neutral, rgba(9,30,66,0.06)) 25%, var(--ds-background-neutral-hovered, rgba(9,30,66,0.12)) 37%, var(--ds-background-neutral, rgba(9,30,66,0.06)) 63%); background-size: 400% 100%; animation: rr-shimmer 1.4s ease infinite; border-radius: 6px; }
@keyframes rr-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
@media (prefers-reduced-motion: reduce) { .rr .rr-skeleton { animation: none; } }
@media (max-width: 720px) { .rr .rr-hide-sm { display: none; } .rr table { font-size: 13px; } }
`;

// Jira's iframe does not apply a <style> element (the page's content security policy blocks inline style
// elements; only style="..." attributes work). A constructable stylesheet is not blocked, so the CSS goes in
// that way, with the <style> element only as a fallback for browsers without it.
function installStyles() {
  try {
    if (typeof CSSStyleSheet !== 'undefined' && 'adoptedStyleSheets' in document) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(GLOBAL_CSS);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      return;
    }
  } catch (error) {
    // fall through to the <style> element
  }
  const element = document.createElement('style');
  element.textContent = GLOBAL_CSS;
  document.head.appendChild(element);
}

// One bundle serves two modules: the issue panel (App) and the full-page dashboard. The module type
// says which. view.theme.enable() switches on Atlassian design tokens (light and dark).
export default function Root() {
  const [type, setType] = useState(null);
  useEffect(() => {
    installStyles();
    view.theme.enable().catch(() => {});
    view
      .getContext()
      .then((context) => setType((context && context.extension && context.extension.type) || 'jira:issuePanel'))
      .catch(() => setType('jira:issuePanel'));
  }, []);
  if (type === null) return null;
  return (
    <div className="rr">
      {type === 'jira:globalPage' ? <Dashboard /> : <App />}
    </div>
  );
}
