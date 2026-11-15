import React, { useEffect, useState } from 'react';
import { view } from '@forge/bridge';
import App from './App';
import Dashboard from './Dashboard';

// One bundle serves two modules: the issue panel (App) and the full-page dashboard. The module type
// says which. view.theme.enable() switches on Atlassian design tokens (light and dark).
export default function Root() {
  const [type, setType] = useState(null);
  useEffect(() => {
    view.theme.enable().catch(() => {});
    view
      .getContext()
      .then((context) => setType((context && context.extension && context.extension.type) || 'jira:issuePanel'))
      .catch(() => setType('jira:issuePanel'));
  }, []);
  if (type === null) return null;
  return type === 'jira:globalPage' ? <Dashboard /> : <App />;
}
