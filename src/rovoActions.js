// The Rovo agent's actions. Each is a thin Forge handler: it loads the saved check, calls the pure
// tool in agentTools.js, and returns the tool's answer (an object; Rovo turns it into a reply).
// Every handler is also a reusable `action` module, so other agents can call it too.
import {
  listOpenRecalls,
  checkDevice,
  recallDetails,
  createRemediationTasks,
  createRemediationTask,
  readInputs,
  installProduct,
  notVisibleHere,
} from './agentTools';
import { createRecallPages } from './recallPageService';
import { whoHandlesWard } from './teamService';
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

// Where the conversation happens, if Rovo says (for example inside a Jira issue): used as the
// default Jira project for new tasks. Rovo's exact context shape is not guaranteed, so look in the
// places it is documented to appear and fall back to "unknown" (the agent then asks the user).
export function projectKeyFrom(payload, context) {
  const jira = (payload && payload.context && payload.context.jira) || {};
  if (jira.projectKey) return jira.projectKey;
  const issueKey = jira.issueKey || (context && context.extension && context.extension.issue && context.extension.issue.key);
  if (issueKey && issueKey.includes('-')) return issueKey.slice(0, issueKey.lastIndexOf('-'));
  return (context && context.extension && context.extension.project && context.extension.project.key) || '';
}

async function runTool(name, payload, context, tool) {
  try {
    // Log the NAMES of the inputs only (never the values) and the product whose installation runs this call (never the
    // site id): "runs in confluence" is how a chat in Rovo Home looks in the logs, "runs in jira" a chat inside Jira.
    const product = installProduct(context);
    console.info(`Rovo action ${name}: input keys`, Object.keys(payload || {}), 'runs in', product);
    // The product rides on the snapshot so that "no devices" can say whether this is simply not the Jira installation.
    const snapshot = { ...(await loadSnapshot()), product };
    return await tool(snapshot, readInputs(payload));
  } catch (error) {
    console.error(`Rovo action ${name} failed`, error);
    return { ok: false, error: 'RecallRadar could not complete that. Please try again.' };
  }
}

export const listOpenRecallsAction = (payload, context) =>
  runTool('list_open_recalls', payload, context, (snapshot, inputs) =>
    snapshot.result
      ? listOpenRecalls({ snapshot, inputs, deps: { getTaskKeys: taskKeyLookup(snapshot) } })
      : listOpenRecalls({ snapshot, inputs }),
  );

export const checkDeviceAction = (payload, context) =>
  runTool('check_device', payload, context, (snapshot, inputs) => checkDevice({ snapshot, inputs }));

export const recallDetailsAction = (payload, context) =>
  runTool('recall_details', payload, context, (snapshot, inputs) =>
    snapshot.result
      ? recallDetails({ snapshot, inputs, deps: { getTaskKeys: taskKeyLookup(snapshot) } })
      : recallDetails({ snapshot, inputs }),
  );

export const createRemediationTasksAction = (payload, context) =>
  runTool('create_remediation_tasks', payload, context, (snapshot, inputs) =>
    createRemediationTasks({
      snapshot,
      inputs,
      deps: {
        jira: jiraAsUser,
        guard: taskGuard,
        previewStore,
        now: () => new Date(),
        defaultProjectKey: projectKeyFrom(payload, context),
        team: { store: wardTeams, graph: teamGraph, openCounts: openTaskCounts },
      },
    }),
  );

// ONE task, for external agents (see the rovo:mcp module). Creates a single task as the calling user.
export const createRemediationTaskAction = (payload, context) =>
  runTool('create_remediation_task', payload, context, (snapshot, inputs) =>
    createRemediationTask({
      snapshot,
      inputs,
      deps: { jira: jiraAsUser, guard: taskGuard, now: () => new Date(), defaultProjectKey: projectKeyFrom(payload, context) },
    }),
  );

// One Confluence page per open recall (create, or update the page that is already there).
export const createRecallPageAction = (payload, context) =>
  runTool('create_recall_page', payload, context, (snapshot, inputs) =>
    createRecallPages({
      snapshot,
      inputs,
      deps: { confluence: confluenceAsUser, ...(snapshot.result ? { getTaskKeys: taskKeyLookup(snapshot) } : {}) },
    }),
  );

// Which Teamwork Graph team handles a ward, who is in it, and who to suggest (read-only). Needs no saved
// check, so it does not go through runTool. The mapping itself is saved in the RecallRadar panel.
export const whoHandlesWardAction = async (payload, context) => {
  try {
    const inputs = readInputs(payload);
    const product = installProduct(context);
    console.info('Rovo action who_handles_ward: input keys', Object.keys(payload || {}), 'runs in', product);
    // The ward-to-team mapping is saved in the Jira installation: anywhere else it would wrongly say "no team is mapped".
    if (product !== 'jira' && product !== 'unknown') return notVisibleHere(product);
    return await whoHandlesWard({ ward: inputs.ward, store: wardTeams, graph: teamGraph, openCounts: await openTaskCounts() });
  } catch (error) {
    console.error('Rovo action who_handles_ward failed', error);
    return { ok: false, error: 'RecallRadar could not read the Teamwork Graph. Please try again.' };
  }
};
