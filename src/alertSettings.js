// The administrator's choices for the daily alerts: whether they are on, which Jira project gets the tasks, and (optionally)
// one issue that gets a comment listing what was found. Project and issue keys only: no person, no text.
//
// This is configuration, not data about anyone: it stays until an administrator changes it or turns alerts off (turning them
// off keeps the choices so they can be switched on again; Clear removes the record).
// No Forge imports, so this is unit tested with plain Node.

export const ALERT_SETTINGS_KEY = 'alerts:settings';

// Jira project keys: two to ten capital letters, digits or underscores, starting with a letter. Issue keys add "-" and a number.
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,9}$/;
export const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,9}-[1-9][0-9]{0,8}$/;

export const EMPTY_SETTINGS = Object.freeze({ enabled: false, projectKey: '', commentIssueKey: '' });

// What was typed -> { ok: true, settings } or { ok: false, error }. Keys are upper-cased and trimmed first.
/**
 * @typedef {{ enabled: boolean, projectKey: string, commentIssueKey: string }} AlertSettings
 */

/**
 * @param {unknown} input
 * @returns {{ ok: true, settings: AlertSettings } | { ok: false, error: string }}
 */
export function validateSettings(input) {
  /** @type {Record<string, any>} */
  const raw = input && typeof input === 'object' ? input : {};
  const enabled = raw.enabled === true;
  const projectKey = typeof raw.projectKey === 'string' ? raw.projectKey.trim().toUpperCase() : '';
  const commentIssueKey = typeof raw.commentIssueKey === 'string' ? raw.commentIssueKey.trim().toUpperCase() : '';
  if (projectKey && !PROJECT_KEY_PATTERN.test(projectKey)) return { ok: false, error: `"${raw.projectKey}" is not a Jira project key (for example MOBL).` };
  if (commentIssueKey && !ISSUE_KEY_PATTERN.test(commentIssueKey)) return { ok: false, error: `"${raw.commentIssueKey}" is not a Jira issue key (for example MOBL-12).` };
  if (enabled && !projectKey) return { ok: false, error: 'Choose the project the new tasks go in.' };
  return { ok: true, settings: { enabled, projectKey, commentIssueKey } };
}

/** @param {import('./types.js').Kv} kv */
export function createAlertSettings(kv) {
  // The saved settings, or the empty ones. A damaged record counts as empty (alerts off) rather than guessing.
  async function get() {
    let stored;
    try {
      stored = await kv.get(ALERT_SETTINGS_KEY);
    } catch (error) {
      return { ...EMPTY_SETTINGS };
    }
    const checked = validateSettings(stored);
    return checked.ok ? checked.settings : { ...EMPTY_SETTINGS };
  }

  /** @param {AlertSettings} settings */
  async function save(settings) {
    await kv.set(ALERT_SETTINGS_KEY, settings);
  }

  const clear = () => kv.delete(ALERT_SETTINGS_KEY);

  return { get, save, clear };
}
