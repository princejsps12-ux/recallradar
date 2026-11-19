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
  routingAsUser,
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
  routing: routingAsUser,
  openTaskCounts,
  taskKeyLookup,
  now: () => new Date(),
  log: console,
});

// Explicit functions (not a destructuring export): the Forge linter looks for them by name. Only the actions that create tasks need the
// Forge context (to know the project of the page the chat is on); the rest read the saved check and ignore it.
export const listOpenRecallsAction = (payload) => actions.listOpenRecallsAction(payload);
export const checkDeviceAction = (payload) => actions.checkDeviceAction(payload);
export const recallDetailsAction = (payload) => actions.recallDetailsAction(payload);
export const createRemediationTasksAction = (payload, context) => actions.createRemediationTasksAction(payload, context);
export const createRemediationTaskAction = (payload, context) => actions.createRemediationTaskAction(payload, context);
export const createRecallPageAction = (payload) => actions.createRecallPageAction(payload);
export const whoHandlesWardAction = (payload) => actions.whoHandlesWardAction(payload);
