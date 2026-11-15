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
function DevicesBar() {
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

// The "Create task" button, or the link to the task that already exists.
function TaskAction({ match, taskUi }) {
  if (!isTaskWorthy(match)) return null;
  const key = taskUi.tasks[pairOf(match)];
  if (key) {
    return (
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
    );
  }
  return (
    <div>
      <button style={styles.smallButton} disabled={taskUi.busy} onClick={() => taskUi.onCreate([match])}>
        Create task
      </button>
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

function MatchesSection() {
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

  // Create tasks for these matches (one or many), then remember what Jira says. Creating tasks is
  // slow (about 0.6 s each), and a request is cut off after 25 s, so a long list goes in batches
  // of TASKS_PER_REQUEST, one after another, with a running count.
  const createTasks = async (matches) => {
    setTaskBusy(true);
    setTaskNote('');
    setConfirmAll(false);
    const total = { created: 0, existing: 0, inProgress: 0, failed: [], notFound: 0 };
    let stopped = '';
    for (let start = 0; start < matches.length; start += TASKS_PER_REQUEST) {
      if (matches.length > TASKS_PER_REQUEST) {
        setTaskNote(`Creating tasks… ${start} of ${matches.length} done.`);
      }
      try {
        const response = await invoke('createTasks', {
          pairs: matches.slice(start, start + TASKS_PER_REQUEST).map(toRequest),
        });
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
      } catch (e) {
        stopped = 'Could not reach RecallRadar.';
        break;
      }
    }
    const parts = [];
    if (total.created) parts.push(`Created ${total.created} task${total.created === 1 ? '' : 's'}`);
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
  const taskUi = { tasks, busy: taskBusy, onCreate: createTasks };

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
                  <button style={styles.button} disabled={taskBusy} onClick={() => createTasks(missing)}>
                    Yes, create {missing.length}
                  </button>
                  <button style={styles.button} onClick={() => setConfirmAll(false)}>Cancel</button>
                </>
              ) : (
                <button style={styles.button} disabled={taskBusy} onClick={() => setConfirmAll(true)}>
                  {taskBusy ? 'Creating…' : `Create tasks for all (${missing.length})`}
                </button>
              )}
            </div>
          )}
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
  return (
    <div>
      <DevicesBar />
      <MatchesSection />
      <Recalls />
    </div>
  );
}

export default App;
