import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, router } from '@forge/bridge';

const styles = {
  list: { listStyle: 'none', margin: 0, padding: 0 },
  item: { padding: '8px 0', borderBottom: '1px solid #dfe1e6' },
  title: { fontWeight: 600 },
  meta: { color: '#5e6c84', fontSize: '12px' },
  detail: { fontSize: '12px', marginTop: '2px' },
  bar: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0 10px' },
  button: { padding: '4px 10px', cursor: 'pointer' },
  section: { padding: '0 0 12px', borderBottom: '2px solid #dfe1e6', marginBottom: '12px' },
  smallButton: { padding: '2px 8px', cursor: 'pointer', fontSize: '12px', marginTop: '2px' },
  badge: { color: '#fff', fontSize: '11px', fontWeight: 700, padding: '1px 6px', borderRadius: '3px' },
};

function Recall({ recall }) {
  return (
    <li style={styles.item}>
      <div style={styles.title}>
        {recall.recallNumber} · Class {recall.recallClass || '?'}
      </div>
      <div style={styles.meta}>
        {recall.firm || 'Unknown firm'} · {recall.date || 'No date'}
      </div>
      <div style={styles.detail}>{recall.product}</div>
      {recall.codeInfo && (
        <div style={styles.meta}>Model/lot info: {recall.codeInfo}</div>
      )}
    </li>
  );
}

// Shows how many devices the hospital has and lets the user add the demo devices.
function DevicesBar({ onLoaded }) {
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    try {
      const result = await invoke('listDevices');
      if (result && result.ok) {
        setCount(result.devices.length);
      } else {
        setMessage((result && result.error) || 'Could not load devices.');
      }
    } catch (e) {
      setMessage('Could not reach RecallRadar.');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadDemo = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await invoke('loadDemoHospital');
      if (result && result.ok) {
        setMessage(`Loaded ${result.count} demo devices.`);
        await refresh();
        if (onLoaded) onLoaded();
      } else {
        setMessage((result && result.error) || 'Could not load the demo hospital.');
      }
    } catch (e) {
      setMessage('Could not reach RecallRadar.');
    }
    setBusy(false);
  };

  return (
    <div style={styles.bar}>
      <span>Hospital devices: {count === null ? '…' : count}</span>
      <button style={styles.button} onClick={loadDemo} disabled={busy}>
        {busy ? 'Loading…' : 'Load demo hospital'}
      </button>
      {message && <span style={styles.meta}>{message}</span>}
    </div>
  );
}

// Wards are compared ignoring case, spaces and punctuation. Keep in step with wardKey() in src/wardTeams.js.
const wardKey = (ward) => String(ward || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Ward -> team mapping, edited here and saved in Forge storage. The list of teams is read from the
// Teamwork Graph (read-only) the first time the section is opened.
function WardTeams({ wardInfo, onChanged }) {
  const [teams, setTeams] = useState(null); // null = not loaded yet
  const [loadError, setLoadError] = useState('');
  const [busyWard, setBusyWard] = useState('');
  const [message, setMessage] = useState('');

  const loadTeams = async () => {
    if (teams !== null) return;
    try {
      const response = await invoke('listTeams');
      if (response && response.ok) setTeams(response.teams);
      else setLoadError((response && response.error) || 'Could not read teams from the Teamwork Graph.');
    } catch (e) {
      setLoadError('Could not reach RecallRadar.');
    }
  };

  const choose = async (ward, teamAri) => {
    setBusyWard(ward);
    setMessage('');
    try {
      const response = await invoke('setWardTeam', { ward, teamAri });
      if (response && response.ok) {
        await onChanged();
        setMessage(response.removed ? `Removed the team for ${ward}.` : `${ward} is now handled by ${response.team.name}.`);
      } else {
        setMessage((response && response.error) || 'Could not save.');
      }
    } catch (e) {
      setMessage('Could not reach RecallRadar.');
    }
    setBusyWard('');
  };

  return (
    <details style={styles.section} onToggle={(event) => event.target.open && loadTeams()}>
      <summary>
        Ward teams ({wardInfo.mappings.length} of {wardInfo.wards.length} wards mapped, from Teamwork Graph)
      </summary>
      <div style={styles.meta}>
        Pick the team that handles each ward. The team list is read from the Teamwork Graph (read-only);
        the choice is saved in RecallRadar.
      </div>
      {loadError && <div>{loadError}</div>}
      {wardInfo.wards.length === 0 && <div style={styles.meta}>No wards yet. Load the demo hospital first.</div>}
      {teams !== null && teams.length === 0 && (
        <div style={styles.meta}>The Teamwork Graph shows no teams for you yet.</div>
      )}
      {wardInfo.wards.map((ward) => {
        const mapping = wardInfo.byKey[wardKey(ward)];
        return (
          <div key={ward} style={styles.bar}>
            <span style={{ minWidth: '110px' }}>{ward}</span>
            <select
              aria-label={`Team for ${ward}`}
              disabled={busyWard === ward || (teams === null && !loadError)}
              value={mapping ? mapping.teamAri : ''}
              onChange={(event) => choose(ward, event.target.value)}
            >
              <option value="">{teams === null && !loadError ? 'Loading teams…' : 'No team'}</option>
              {/* keep a saved team selectable even if the graph list has not loaded or no longer lists it */}
              {mapping && !(teams || []).some((t) => t.ari === mapping.teamAri) && (
                <option value={mapping.teamAri}>{mapping.teamName}</option>
              )}
              {(teams || []).map((team) => (
                <option key={team.ari} value={team.ari}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        );
      })}
      {message && <div style={styles.meta}>{message}</div>}
    </details>
  );
}

// Colour AND a text label, so the confidence never depends on colour alone.
const BADGE_COLORS = { exact: '#c9372c', likely: '#b65c02', possible: '#5e6c84' };

// Only matches we are fairly sure about get a task. Keep in step with TASK_CONFIDENCES in src/taskRules.js.
const TASK_CONFIDENCES = ['exact', 'likely'];
const isTaskWorthy = (match) => TASK_CONFIDENCES.includes(match.confidence);

// How many tasks to create per request. Keep at or below MAX_PAIRS_PER_REQUEST in src/taskService.js.
const TASKS_PER_REQUEST = 10;

// One key per recall + device, the same shape as pairKey() in src/taskRules.js.
const pairOf = (match) => `${match.recallNumber}|${match.deviceId}`;
const toRequest = (match) => ({ recallNumber: match.recallNumber, deviceId: match.deviceId });

// The mapped team (read from the Teamwork Graph), a suggested assignee, and the "Create task" buttons.
// Nobody is assigned unless the person clicks "Create & assign".
function TaskAction({ match, taskUi }) {
  if (!isTaskWorthy(match)) return null;
  const pair = pairOf(match);
  const key = taskUi.tasks[pair];
  const mapping = match.ward ? taskUi.wardByKey[wardKey(match.ward)] : null;
  const suggestion = taskUi.suggestions[pair];
  const teamLine = mapping ? (
    <div style={styles.meta}>
      Team: {mapping.teamName} (from Teamwork Graph)
      {!key && suggestion && <> · Suggested assignee: {suggestion.name}</>}
    </div>
  ) : null;
  if (key) {
    return (
      <>
        {teamLine}
        <div style={styles.meta}>
          Task:{' '}
          <a
            href={`/browse/${key}`}
            onClick={(event) => {
              event.preventDefault();
              router.open(`/browse/${key}`);
            }}
          >
            {key}
          </a>
        </div>
      </>
    );
  }
  return (
    <div>
      {teamLine}
      <button style={styles.smallButton} disabled={taskUi.busy} onClick={() => taskUi.onCreate([match], false)}>
        Create task
      </button>{' '}
      {suggestion && (
        <button style={styles.smallButton} disabled={taskUi.busy} onClick={() => taskUi.onCreate([match], true)}>
          Create &amp; assign to {suggestion.name}
        </button>
      )}
    </div>
  );
}

function Match({ match, taskUi }) {
  return (
    <div style={styles.detail}>
      <span style={{ ...styles.badge, background: BADGE_COLORS[match.confidence] || '#5e6c84' }}>
        {match.confidence.toUpperCase()}
      </span>{' '}
      <strong>{match.recallNumber}</strong> · Class {match.recallClass || '?'} · {match.firm} · {match.date}
      <div style={styles.meta}>{match.reason}</div>
      <TaskAction match={match} taskUi={taskUi} />
    </div>
  );
}

// Group the matches by device. They arrive strongest-first, so the first match of a device is its best.
function groupByDevice(matches) {
  const groups = new Map();
  for (const match of matches) {
    if (!groups.has(match.deviceId)) groups.set(match.deviceId, []);
    groups.get(match.deviceId).push(match);
  }
  return [...groups.values()];
}

// How long (in hours) a saved check stays fresh. Keep in step with CACHE_TTL_HOURS in src/matchCache.js.
const SAVED_FOR_HOURS = 6;
// How often to ask the background check how far it has got, and when to give up asking.
const POLL_EVERY_MS = 2000;
const POLL_GIVE_UP_MS = 8 * 60 * 1000;

function formatChecked(result, refreshing) {
  const when = new Date(result.checkedAt).toLocaleString();
  if (result.stale) {
    return `Last checked ${when} (older than ${SAVED_FOR_HOURS} hours${refreshing ? ', refreshing now…' : ''})`;
  }
  if (result.fromCache) return `Last checked ${when} (saved result, refreshes after ${SAVED_FOR_HOURS} hours)`;
  const seconds = (result.elapsedMs / 1000).toFixed(1);
  return `Last checked ${when} (just now, took ${seconds} s)`;
}

function progressText(progress) {
  if (!progress || !progress.total) return 'Starting the background check…';
  return `Checked ${progress.done} of ${progress.total} FDA searches…`;
}

// Statuses of a recall that is no longer open. Keep in step with CLOSED_STATUSES in src/agentTools.js.
const CLOSED_STATUSES = ['terminated', 'completed'];

// "Create Confluence recall page": pick a space (the list is read from Confluence, never guessed) and a
// recall, and RecallRadar writes one page per recall (what is wrong, what to do, affected devices, task
// links), or updates the page that is already there. The pages list device ids and wards, so nothing is
// written until the person has chosen a space and clicked the button.
function RecallPages({ result }) {
  const [open, setOpen] = useState(false);
  const [spaces, setSpaces] = useState(null); // null = not loaded yet
  const [spaceKey, setSpaceKey] = useState('');
  const [recallNumber, setRecallNumber] = useState(''); // '' = every open recall
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pages, setPages] = useState([]);

  const details = result.recallDetails || {};
  const openRecalls = [
    ...new Set(
      result.matches
        .filter(isTaskWorthy)
        .filter((m) => !CLOSED_STATUSES.includes(String((details[m.recallNumber] || {}).status).toLowerCase()))
        .map((m) => m.recallNumber),
    ),
  ];
  if (openRecalls.length === 0) return null;

  const openChooser = async () => {
    setOpen(true);
    setMessage('');
    if (spaces !== null) return;
    try {
      const response = await invoke('listSpaces');
      if (response && response.ok) setSpaces(response.spaces);
      else setMessage((response && response.error) || 'Could not read Confluence spaces.');
    } catch (e) {
      setMessage('Could not reach RecallRadar.');
    }
  };

  const create = async () => {
    setBusy(true);
    setMessage('');
    setPages([]);
    try {
      const response = await invoke('createRecallPage', { spaceKey, recallNumber });
      if (response && response.ok && response.state === 'done') {
        setPages(response.pages);
        // Our own wording: response.message is written for the Rovo agent, not for a person.
        const made = response.pages.filter((p) => p.action === 'created').length;
        const updated = response.pages.filter((p) => p.action === 'updated').length;
        const parts = [`${made} page${made === 1 ? '' : 's'} created and ${updated} updated in the ${response.space.name} space.`];
        if (response.failed.length) parts.push(`${response.failed.length} failed (${response.failed[0].error})`);
        if (response.notIncluded) parts.push(`${response.notIncluded} more recalls were not included: choose them one at a time.`);
        setMessage(parts.join(' '));
      } else {
        setMessage((response && (response.message || response.error)) || 'Could not create the page.');
      }
    } catch (e) {
      setMessage('Could not reach RecallRadar.');
    }
    setBusy(false);
  };

  if (!open) {
    return (
      <div style={styles.bar}>
        <button style={styles.button} onClick={openChooser}>
          Create Confluence recall page
        </button>
      </div>
    );
  }
  return (
    <div style={styles.section}>
      <div style={styles.title}>Create Confluence recall page</div>
      <div style={styles.meta}>
        One page per recall: what is wrong, what to do, affected devices and links to the tasks. Running it again
        updates the page instead of making a second one. The pages list device ids and wards, so choose the space
        yourself.
      </div>
      <div style={styles.bar}>
        <select aria-label="Confluence space" value={spaceKey} disabled={busy || spaces === null} onChange={(event) => setSpaceKey(event.target.value)}>
          <option value="">{spaces === null ? 'Loading spaces…' : 'Choose a space'}</option>
          {(spaces || []).map((space) => (
            <option key={space.key} value={space.key}>
              {space.name} ({space.key})
            </option>
          ))}
        </select>
        <select aria-label="Recall" value={recallNumber} disabled={busy} onChange={(event) => setRecallNumber(event.target.value)}>
          <option value="">All open recalls ({openRecalls.length})</option>
          {openRecalls.map((number) => (
            <option key={number} value={number}>
              {number}
            </option>
          ))}
        </select>
        <button style={styles.button} disabled={busy || !spaceKey} onClick={create}>
          {busy ? 'Writing…' : 'Create page'}
        </button>
        <button style={styles.button} disabled={busy} onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      {message && <div style={styles.meta}>{message}</div>}
      <ul style={styles.list}>
        {pages.map((page) => (
          <li key={page.recallNumber} style={styles.detail}>
            {page.recallNumber}: page {page.action} ·{' '}
            <a
              href={page.url}
              onClick={(event) => {
                event.preventDefault();
                router.open(page.url);
              }}
            >
              {page.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MatchesSection({ wardInfo }) {
  // phase: 'starting' (reading what is saved), 'idle', 'running' (a background check) or 'error'
  const [state, setState] = useState({ phase: 'starting', result: null, progress: null, error: '' });
  const timer = useRef(null);
  const started = useRef(0);

  // Jira tasks: which matches already have one ("recall|device" -> issue key), whether a request is
  // running, a message about the last request, and whether "create for all" is waiting for a confirm.
  const [tasks, setTasks] = useState({});
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskNote, setTaskNote] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  // Suggested assignees from the Teamwork Graph: "recall|device" -> { accountId, name, teamName, ward }.
  const [suggestions, setSuggestions] = useState({});
  const [assignAll, setAssignAll] = useState(false); // the confirm step's checkbox, off by default

  const stopPolling = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  // Ask the background check how far it has got, until it finishes. Keeps showing the previous
  // result in the meantime.
  const poll = useCallback(() => {
    stopPolling();
    started.current = Date.now();
    timer.current = setInterval(async () => {
      if (Date.now() - started.current > POLL_GIVE_UP_MS) {
        stopPolling();
        setState((s) => ({ ...s, phase: 'error', error: 'The check is taking longer than expected. Reopen this panel in a minute.' }));
        return;
      }
      try {
        const response = await invoke('getCheckStatus');
        if (!response || !response.ok) return; // try again on the next tick
        const job = response.job;
        if (!job) {
          stopPolling();
          setState((s) => ({ ...s, phase: 'idle' }));
        } else if (job.status === 'running') {
          setState((s) => ({ ...s, phase: 'running', progress: job.progress }));
        } else if (job.status === 'done' && response.result) {
          stopPolling();
          setState({ phase: 'idle', result: response.result, progress: null, error: '' });
        } else {
          stopPolling();
          setState((s) => ({ ...s, phase: 'error', progress: null, error: job.error || 'The check failed.' }));
        }
      } catch (e) {
        // a dropped request is not fatal: the next tick asks again
      }
    }, POLL_EVERY_MS);
  }, [stopPolling]);

  // Start (or join) a background check, and follow it.
  const begin = useCallback(
    async (refresh) => {
      setState((s) => ({ ...s, phase: 'running', progress: null, error: '' }));
      try {
        const response = await invoke('startCheck', { refresh });
        if (!response || !response.ok) {
          setState((s) => ({ ...s, phase: 'error', error: (response && response.error) || 'Could not start the check.' }));
        } else if (response.state === 'saved') {
          setState({ phase: 'idle', result: response.result, progress: null, error: '' });
        } else if (response.state === 'no-devices') {
          setState({ phase: 'idle', result: { deviceCount: 0, matches: [], checkedAt: new Date().toISOString(), fromCache: true }, progress: null, error: '' });
        } else {
          setState((s) => ({ ...s, phase: 'running', progress: response.job ? response.job.progress : null }));
          poll();
        }
      } catch (e) {
        setState((s) => ({ ...s, phase: 'error', error: 'Could not reach RecallRadar.' }));
      }
    },
    [poll],
  );

  // When the panel opens: show what is saved, pick up a check that is still running (the page
  // may have been reloaded), and if the saved result has expired, refresh it in the background.
  useEffect(() => {
    let cancelled = false;
    Promise.all([invoke('getSavedMatches'), invoke('getCheckStatus')])
      .then(([saved, status]) => {
        if (cancelled) return;
        const result = saved && saved.ok ? saved.result : null;
        const job = status && status.ok ? status.job : null;
        if (job && job.status === 'running') {
          setState({ phase: 'running', result, progress: job.progress, error: '' });
          poll();
        } else if (result) {
          setState({ phase: 'idle', result, progress: null, error: '' });
          if (result.stale) begin(false);
        } else if (job && job.status === 'done' && status.result) {
          setState({ phase: 'idle', result: status.result, progress: null, error: '' }); // e.g. a result with failed lookups, never saved
        } else {
          setState({ phase: 'idle', result: null, progress: null, error: '' });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ phase: 'idle', result: null, progress: null, error: '' });
      });
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [begin, poll, stopPolling]);

  const running = state.phase === 'running';
  const result = state.result;
  const groups = result ? groupByDevice(result.matches) : [];

  // When a result appears, find out which of its matches already have a task.
  const checkedAt = result ? result.checkedAt : null;
  const resultMatches = result ? result.matches : null;
  useEffect(() => {
    if (!resultMatches) return undefined;
    const pairs = resultMatches.filter(isTaskWorthy).map(toRequest);
    if (pairs.length === 0) return undefined;
    let cancelled = false;
    invoke('getTaskStates', { pairs })
      .then((response) => {
        if (!cancelled && response && response.ok) setTasks(response.tasks);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Look again only when a different result arrives, not on every poll.
  }, [checkedAt]);

  // Suggested assignees: ask the server (Teamwork Graph, read-only) whenever a result arrives or the ward
  // teams change. Only matches that still need a task are asked about.
  const mappingSignature = wardInfo.mappings.map((m) => `${m.ward}:${m.teamAri}`).join(',');
  useEffect(() => {
    if (!resultMatches || wardInfo.mappings.length === 0) {
      setSuggestions({});
      return undefined;
    }
    const pairs = resultMatches.filter((m) => isTaskWorthy(m) && !tasks[pairOf(m)]).map(toRequest);
    if (pairs.length === 0) return undefined;
    let cancelled = false;
    invoke('suggestAssignees', { pairs })
      .then((response) => {
        if (!cancelled) setSuggestions(response && response.ok ? response.suggestions : {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Not on every task change: the suggestion only needs refreshing for a new result or new mappings.
  }, [checkedAt, mappingSignature]);

  // Create tasks for these matches (one or many), then remember what Jira says. Creating tasks is
  // slow (about 0.6 s each), and a request is cut off after 25 s, so a long list goes in batches
  // of TASKS_PER_REQUEST, one after another, with a running count.
  const createTasks = async (matches, assign) => {
    setTaskBusy(true);
    setTaskNote('');
    setConfirmAll(false);
    setAssignAll(false);
    const total = { created: 0, existing: 0, inProgress: 0, failed: [], notFound: 0, assigned: 0, refused: 0, assignError: '' };
    let stopped = '';
    for (let start = 0; start < matches.length; start += TASKS_PER_REQUEST) {
      if (matches.length > TASKS_PER_REQUEST) {
        setTaskNote(`Creating tasks… ${start} of ${matches.length} done.`);
      }
      try {
        const batch = matches.slice(start, start + TASKS_PER_REQUEST);
        // Only people the person agreed to: the suggestions shown on screen, for this batch. The server
        // checks each one against the ward's team again.
        const assignees = {};
        if (assign) {
          for (const match of batch) {
            const suggestion = suggestions[pairOf(match)];
            if (suggestion) assignees[pairOf(match)] = suggestion.accountId;
          }
        }
        const response = await invoke('createTasks', { pairs: batch.map(toRequest), assignees });
        if (!response || !response.ok) {
          stopped = (response && response.error) || 'Could not create the tasks.';
          break;
        }
        const known = {};
        [...response.created, ...response.existing].forEach((t) => {
          known[t.pair] = t.key;
        });
        setTasks((previous) => ({ ...previous, ...known }));
        total.created += response.created.length;
        total.existing += response.existing.length;
        total.inProgress += response.inProgress.length;
        total.failed.push(...response.failed);
        total.notFound += response.notFound.length;
        total.assigned += Object.keys(response.assignedTo || {}).length;
        total.refused += (response.assignRefused || []).length;
        if (response.assignError) total.assignError = response.assignError;
      } catch (e) {
        stopped = 'Could not reach RecallRadar.';
        break;
      }
    }
    const parts = [];
    if (total.created) parts.push(`Created ${total.created} task${total.created === 1 ? '' : 's'}`);
    if (total.assigned) parts.push(`${total.assigned} assigned to the suggested team member`);
    if (total.refused) parts.push(`${total.refused} not assigned (that person is not in the ward's team)`);
    if (total.assignError) parts.push(total.assignError);
    if (total.existing) parts.push(`${total.existing} already had a task`);
    if (total.inProgress) parts.push(`${total.inProgress} being created by another click`);
    if (total.failed.length) parts.push(`${total.failed.length} failed (${total.failed[0].error})`);
    if (total.notFound) parts.push(`${total.notFound} no longer in the result, try Refresh`);
    if (stopped) parts.push(`Stopped: ${stopped} Click again to continue`);
    setTaskNote(parts.length ? `${parts.join('. ')}.` : '');
    setTaskBusy(false);
  };

  // The matches that could get a task and do not have one yet.
  const missing = resultMatches ? resultMatches.filter((m) => isTaskWorthy(m) && !tasks[pairOf(m)]) : [];
  const suggestedCount = missing.filter((m) => suggestions[pairOf(m)]).length;
  const taskUi = { tasks, busy: taskBusy, onCreate: createTasks, suggestions, wardByKey: wardInfo.byKey };

  return (
    <div style={styles.section}>
      <button
        style={styles.button}
        onClick={() => begin(Boolean(result))}
        disabled={running || state.phase === 'starting'}
      >
        {running ? 'Checking…' : result ? 'Refresh' : 'Check devices for recalls'}
      </button>
      {running && (
        <div style={styles.meta}>
          <progress
            max={state.progress && state.progress.total ? state.progress.total : 1}
            value={state.progress ? state.progress.done : 0}
            style={{ verticalAlign: 'middle', marginRight: '6px' }}
          />
          {progressText(state.progress)} This runs in the background, so you can keep working. The result is
          saved for {SAVED_FOR_HOURS} hours.
        </div>
      )}
      {state.phase === 'error' && <div>{state.error}</div>}
      {result && (
        <div>
          <div style={styles.meta}>{formatChecked(result, running)}</div>
          {result.deviceCount === 0 ? (
            <div>No devices yet. Click “Load demo hospital” above.</div>
          ) : (
            <div style={styles.meta}>
              Checked {result.deviceCount} devices against {result.recallCount} recalls from the last
              year: {groups.length} device{groups.length === 1 ? '' : 's'} with a possible match.
              {result.cappedQueries > 0 &&
                ' Each search looks at the newest 25 recalls, so older ones in the last year may be missing.'}
              {result.failedQueries > 0 &&
                ` ${result.failedQueries} FDA lookups failed or timed out, so results may be incomplete (not saved). Try Refresh.`}
            </div>
          )}
          {missing.length > 0 && (
            <div style={styles.bar}>
              {confirmAll ? (
                <>
                  <span>Create {missing.length} task{missing.length === 1 ? '' : 's'} in this project?</span>
                  {suggestedCount > 0 && (
                    <label style={styles.meta}>
                      <input type="checkbox" checked={assignAll} onChange={(event) => setAssignAll(event.target.checked)} /> Also
                      assign the suggested team member ({suggestedCount} of {missing.length}, spread across each ward's team)
                    </label>
                  )}
                  <button style={styles.button} disabled={taskBusy} onClick={() => createTasks(missing, assignAll)}>
                    Yes, create {missing.length}
                  </button>
                  <button style={styles.button} onClick={() => { setConfirmAll(false); setAssignAll(false); }}>Cancel</button>
                </>
              ) : (
                <button style={styles.button} disabled={taskBusy} onClick={() => setConfirmAll(true)}>
                  {taskBusy ? 'Creating…' : `Create tasks for all (${missing.length})`}
                </button>
              )}
            </div>
          )}
          <RecallPages result={result} />
          {taskNote && <div style={styles.meta}>{taskNote}</div>}
          <ul style={styles.list}>
            {groups.map((matches) => {
              const best = matches[0];
              return (
                <li key={best.deviceId} style={styles.item}>
                  <div style={styles.title}>
                    {best.deviceName} · {best.deviceManufacturer} {best.deviceModel}
                  </div>
                  <div style={styles.meta}>
                    {best.ward || 'No ward'} · serial/lot {best.lotOrSerial || 'not recorded'}
                  </div>
                  <Match match={best} taskUi={taskUi} />
                  {matches.length > 1 && (
                    <details style={styles.detail}>
                      <summary>{matches.length - 1} other recall{matches.length === 2 ? '' : 's'} for this device</summary>
                      {matches.slice(1).map((m) => (
                        <Match key={m.recallNumber} match={m} taskUi={taskUi} />
                      ))}
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Recalls() {
  const [state, setState] = useState({ status: 'loading', recalls: [], error: '' });

  useEffect(() => {
    let cancelled = false;
    invoke('fetchRecalls')
      .then((result) => {
        if (cancelled) return;
        if (result && result.ok) {
          setState({ status: 'done', recalls: result.recalls, error: '' });
        } else {
          setState({ status: 'error', recalls: [], error: (result && result.error) || 'Unknown error' });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: 'error', recalls: [], error: 'Could not reach RecallRadar.' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') return <div>Loading latest FDA recalls...</div>;
  if (state.status === 'error') return <div>{state.error}</div>;
  if (state.recalls.length === 0) return <div>No recalls found.</div>;

  return (
    <div>
      <div style={styles.meta}>Latest {state.recalls.length} FDA device recalls</div>
      <ul style={styles.list}>
        {state.recalls.map((recall) => (
          <Recall key={recall.recallNumber} recall={recall} />
        ))}
      </ul>
    </div>
  );
}

function App() {
  // Ward -> team mappings (Forge storage) and the wards in the device list. Shared by the mapping
  // editor and the match rows, which show "Team: <name> (from Teamwork Graph)".
  const [wardInfo, setWardInfo] = useState({ mappings: [], wards: [], byKey: {} });
  const loadWardInfo = useCallback(async () => {
    try {
      const response = await invoke('getWardTeams');
      if (response && response.ok) {
        const byKey = {};
        response.mappings.forEach((m) => {
          byKey[wardKey(m.ward)] = m;
        });
        setWardInfo({ mappings: response.mappings, wards: response.wards, byKey });
      }
    } catch (e) {
      // the panel works without ward teams
    }
  }, []);
  useEffect(() => {
    loadWardInfo();
  }, [loadWardInfo]);

  return (
    <div>
      <DevicesBar onLoaded={loadWardInfo} />
      <WardTeams wardInfo={wardInfo} onChanged={loadWardInfo} />
      <MatchesSection wardInfo={wardInfo} />
      <Recalls />
    </div>
  );
}

export default App;
