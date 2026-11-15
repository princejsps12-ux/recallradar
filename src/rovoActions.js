// The Rovo agent's actions. Each is a thin Forge handler: it loads the saved check, calls the pure
// tool in agentTools.js, and returns the tool's answer (an object; Rovo turns it into a reply).
// Every handler is also a reusable `action` module, so other agents can call it too.
import {
  listOpenRecalls,
  checkDevice,
  recallDetails,
  createRemediationTasks,
  readInputs,
} from './agentTools';
import { loadSnapshot, jiraAsUser, taskGuard, previewStore } from './runtime';
import { getTaskStates, selectMatches } from './taskService';

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

// "Which of these already have a Jira task?", as the person talking to the agent.
function taskKeyLookup(snapshot) {
  return async (pairs) => {
    const { matches } = selectMatches(snapshot.result.matches, pairs);
    return getTaskStates({ matches, jira: jiraAsUser, guard: taskGuard });
  };
}

async function runTool(name, payload, context, tool) {
  try {
    // Log the NAMES of the inputs only (never the values), to see what Rovo sent.
    console.info(`Rovo action ${name}: input keys`, Object.keys(payload || {}));
    const snapshot = await loadSnapshot();
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
      },
    }),
  );
