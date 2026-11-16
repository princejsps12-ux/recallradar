// The Forge entry points of the Rovo agent's actions (manifest.yml `function` handlers): the real dependencies are built
// here, the behaviour is in rovoHandlers.js.
import {
  loadSnapshot,
  jiraAsUser,
  confluenceAsUser,
  taskGuard,
  previewStore,
  teamGraph,
  wardTeams,
  openTaskCounts,
  taskKeyLookup,
} from './runtime';
import { createRovoHandlers, projectKeyFrom } from './rovoHandlers';

export { projectKeyFrom };

const actions = createRovoHandlers({
  loadSnapshot,
  jira: jiraAsUser,
  confluence: confluenceAsUser,
  taskGuard,
  previewStore,
  teamGraph,
  wardTeams,
  openTaskCounts,
  taskKeyLookup,
  now: () => new Date(),
  log: console,
});

// Explicit functions (not a destructuring export): the Forge linter looks for them by name.
export const listOpenRecallsAction = (payload, context) => actions.listOpenRecallsAction(payload, context);
export const checkDeviceAction = (payload, context) => actions.checkDeviceAction(payload, context);
export const recallDetailsAction = (payload, context) => actions.recallDetailsAction(payload, context);
export const createRemediationTasksAction = (payload, context) => actions.createRemediationTasksAction(payload, context);
export const createRemediationTaskAction = (payload, context) => actions.createRemediationTaskAction(payload, context);
export const createRecallPageAction = (payload, context) => actions.createRecallPageAction(payload, context);
export const whoHandlesWardAction = (payload, context) => actions.whoHandlesWardAction(payload, context);
