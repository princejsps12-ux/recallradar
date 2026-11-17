// The Forge entry point for the resolvers: it builds the real dependencies and registers the handlers from handlers.js
// (where the behaviour lives, unit tested with fakes). Nothing else belongs here.
import Resolver from '@forge/resolver';
import { fetch } from '@forge/api';
import { Queue } from '@forge/events';
import {
  deviceStore,
  matchCache,
  checkJobs,
  taskGuard,
  jiraAsUser,
  confluenceAsUser,
  teamGraph,
  wardTeams,
  openTaskCounts,
  jiraAsApp,
  alertState,
  alertSettings,
  loadSnapshot,
  taskKeyLookup,
  CHECK_QUEUE_KEY,
} from './runtime';
import { createHandlers } from './handlers';

const checkQueue = new Queue({ key: CHECK_QUEUE_KEY });

const handlers = createHandlers({
  deviceStore,
  matchCache,
  checkJobs,
  taskGuard,
  jira: jiraAsUser,
  confluence: confluenceAsUser,
  teamGraph,
  wardTeams,
  openTaskCounts,
  jiraApp: jiraAsApp,
  alertState,
  alertSettings,
  loadSnapshot,
  taskKeyLookup,
  enqueue: (message) => checkQueue.push({ body: message }),
  fetch,
  now: () => new Date(),
  log: console,
});

const resolver = new Resolver();
for (const [name, handle] of Object.entries(handlers)) resolver.define(name, handle);

export const handler = resolver.getDefinitions();
