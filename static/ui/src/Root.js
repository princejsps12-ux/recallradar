import React, { useEffect, useState } from 'react';
import { view } from '@forge/bridge';
import { token } from '@atlaskit/tokens';
import App from './App';
import Dashboard from './Dashboard';
import CreateAllWindow from './CreateAllWindow';

// One bundle serves three views: the issue panel (App), the full-page dashboard (Dashboard), and the "Create all"
// pop-up the panel opens (CreateAllWindow, told apart by the context the panel passes to the Forge Modal).
// view.theme.enable() switches on Atlassian design tokens (light and dark); the page background and text come
// from tokens too.
export default function Root() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    view.theme.enable().catch(() => {});
    document.body.style.background = token('elevation.surface');
    document.body.style.color = token('color.text');
    document.body.style.margin = '0';
    view
      .getContext()
      .then((context) => {
        const extension = (context && context.extension) || {};
        setInfo({ type: extension.type || 'jira:issuePanel', modal: extension.modal || (context && context.modal) || null });
      })
      .catch(() => setInfo({ type: 'jira:issuePanel', modal: null }));
  }, []);
  if (info === null) return null;
  if (info.modal && info.modal.view === 'create-all') return <CreateAllWindow projectKey={info.modal.projectKey} />;
  return info.type === 'jira:globalPage' ? <Dashboard /> : <App />;
}
