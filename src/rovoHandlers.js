// The Rovo agent's actions, as plain functions with their dependencies handed in (rovoActions.js builds the real ones).
// Each loads the saved check, calls the pure tool in agentTools.js, and returns the tool's answer (an object; Rovo turns it
// into a reply). Every handler is also a reusable `action` module, so other agents can call it too. No Forge imports here,
// so the behaviour is unit tested with fakes (rovoHandlers.test.mjs).
import { listOpenRecalls, checkDevice, recallDetails, createRemediationTasks, createRemediationTask, readInputs } from './agentTools.js';
import { createRecallPages } from './recallPageService.js';
import { whoHandlesWard } from './teamService.js';

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

/**
 * @param {object} deps
 *   loadSnapshot()                      devices + the saved check (fresh or expired)
 *   jira, confluence                    Jira and Confluence as the person chatting
 *   taskGuard, previewStore             the duplicate guard and the one-use confirmation tokens
 *   teamGraph, wardTeams, openTaskCounts  Teamwork Graph reads and the saved ward-to-team mapping
 *   taskKeyLookup(snapshot)             finds the Jira keys of existing tasks for a snapshot
 *   now()                               the current Date
 *   log                                 console-like (info, error)
 */
export function createRovoHandlers(deps) {
  const log = deps.log || console;
  const now = deps.now || (() => new Date());

  async function runTool(name, payload, tool) {
    try {
      // Log the NAMES of the inputs only, never the values.
      log.info(`Rovo action ${name}: input keys`, Object.keys(payload || {}));
      return await tool(await deps.loadSnapshot(), readInputs(payload));
    } catch (error) {
      log.error(`Rovo action ${name} failed`, error);
      return { ok: false, error: 'RecallRadar could not complete that. Please try again.' };
    }
  }
  const withTaskKeys = (snapshot) => (snapshot.result ? { getTaskKeys: deps.taskKeyLookup(snapshot) } : {});

  return {
    listOpenRecallsAction: (payload) =>
      runTool('list_open_recalls', payload, (snapshot, inputs) => listOpenRecalls({ snapshot, inputs, deps: withTaskKeys(snapshot) })),

    checkDeviceAction: (payload) => runTool('check_device', payload, (snapshot, inputs) => checkDevice({ snapshot, inputs })),

    recallDetailsAction: (payload) =>
      runTool('recall_details', payload, (snapshot, inputs) => recallDetails({ snapshot, inputs, deps: withTaskKeys(snapshot) })),

    createRemediationTasksAction: (payload, context) =>
      runTool('create_remediation_tasks', payload, (snapshot, inputs) =>
        createRemediationTasks({
          snapshot,
          inputs,
          deps: {
            jira: deps.jira,
            guard: deps.taskGuard,
            previewStore: deps.previewStore,
            now,
            defaultProjectKey: projectKeyFrom(payload, context),
            team: { store: deps.wardTeams, graph: deps.teamGraph, openCounts: deps.openTaskCounts },
          },
        }),
      ),

    // ONE task, for external agents (see the rovo:mcp module). Creates a single task as the calling user.
    createRemediationTaskAction: (payload, context) =>
      runTool('create_remediation_task', payload, (snapshot, inputs) =>
        createRemediationTask({
          snapshot,
          inputs,
          deps: { jira: deps.jira, guard: deps.taskGuard, now, defaultProjectKey: projectKeyFrom(payload, context) },
        }),
      ),

    // One Confluence page per open recall (create, or update the page that is already there).
    createRecallPageAction: (payload) =>
      runTool('create_recall_page', payload, (snapshot, inputs) =>
        createRecallPages({ snapshot, inputs, deps: { confluence: deps.confluence, ...withTaskKeys(snapshot) } }),
      ),

    // Which Teamwork Graph team handles a ward, who is in it, and who to suggest (read-only). Needs no saved
    // check, so it does not go through runTool. The mapping itself is saved on the dashboard.
    async whoHandlesWardAction(payload) {
      try {
        const inputs = readInputs(payload);
        log.info('Rovo action who_handles_ward: input keys', Object.keys(payload || {}));
        return await whoHandlesWard({ ward: inputs.ward, store: deps.wardTeams, graph: deps.teamGraph, openCounts: await deps.openTaskCounts() });
      } catch (error) {
        log.error('Rovo action who_handles_ward failed', error);
        return { ok: false, error: 'RecallRadar could not read the Teamwork Graph. Please try again.' };
      }
    },
  };
}
