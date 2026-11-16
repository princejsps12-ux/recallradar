// Who may change the hospital's device list. The list is shared by the whole site (every person who opens the issue
// panel or the dashboard reads it), so loading the demo hospital, importing devices and removing them are for Jira
// administrators. Reading, checking for recalls and creating tasks stay open to everyone who can use the app (Jira's
// own permissions decide who may create issues). The check runs on the server: the dashboard only reflects it.
//
// `jira` is the Jira client as the signed-in person (see jiraClient.js): it needs isAdministrator().
// No Forge imports here, so it is unit tested with plain Node.

export const NOT_ADMIN_MESSAGE =
  "Only a Jira administrator can change the hospital's device list, because it is shared by the whole site. Ask one to do it, or to make you an administrator.";

export const PERMISSION_CHECK_FAILED = 'Could not check your Jira permissions. Please try again.';

// null = allowed; otherwise the answer to send back instead of doing the work. A failed check is refused too (it is
// safer to stop than to guess), with its own message so a person is not told they lack a permission they may have.
export async function refuseUnlessAdministrator(jira) {
  try {
    if (await jira.isAdministrator()) return null;
  } catch (error) {
    return { ok: false, error: PERMISSION_CHECK_FAILED };
  }
  return { ok: false, notAllowed: true, error: NOT_ADMIN_MESSAGE };
}
