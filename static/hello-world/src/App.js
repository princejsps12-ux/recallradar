import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';

const styles = {
  list: { listStyle: 'none', margin: 0, padding: 0 },
  item: { padding: '8px 0', borderBottom: '1px solid #dfe1e6' },
  title: { fontWeight: 600 },
  meta: { color: '#5e6c84', fontSize: '12px' },
  detail: { fontSize: '12px', marginTop: '2px' },
  bar: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0 10px' },
  button: { padding: '4px 10px', cursor: 'pointer' },
  section: { padding: '0 0 12px', borderBottom: '2px solid #dfe1e6', marginBottom: '12px' },
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

function Match({ match }) {
  return (
    <div style={styles.detail}>
      <span style={{ ...styles.badge, background: BADGE_COLORS[match.confidence] || '#5e6c84' }}>
        {match.confidence.toUpperCase()}
      </span>{' '}
      <strong>{match.recallNumber}</strong> · Class {match.recallClass || '?'} · {match.firm} · {match.date}
      <div style={styles.meta}>{match.reason}</div>
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

// How long (in hours) a saved check stays valid. Keep in step with CACHE_TTL_HOURS in src/matchCache.js.
const SAVED_FOR_HOURS = 6;

function formatChecked(result) {
  const when = new Date(result.checkedAt).toLocaleString();
  if (result.fromCache) return `Last checked ${when} (saved result, refreshes after ${SAVED_FOR_HOURS} hours)`;
  const seconds = (result.elapsedMs / 1000).toFixed(1);
  return `Last checked ${when} (just now, took ${seconds} s)`;
}

function MatchesSection() {
  // status: 'starting' (looking for a saved result), 'idle', 'loading', 'done' or 'error'
  const [state, setState] = useState({ status: 'starting', result: null, error: '' });

  // When the panel opens, show the saved result if there is one. This never starts a check.
  useEffect(() => {
    let cancelled = false;
    invoke('findMatches', { cachedOnly: true })
      .then((response) => {
        if (cancelled) return;
        if (response && response.ok && response.result) {
          setState({ status: 'done', result: response.result, error: '' });
        } else {
          setState({ status: 'idle', result: null, error: '' });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'idle', result: null, error: '' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const check = async (refresh) => {
    setState((previous) => ({ status: 'loading', result: previous.result, error: '' }));
    try {
      const response = await invoke('findMatches', { refresh });
      if (response && response.ok) {
        setState({ status: 'done', result: response.result, error: '' });
      } else {
        setState({ status: 'error', result: null, error: (response && response.error) || 'Unknown error' });
      }
    } catch (e) {
      setState({ status: 'error', result: null, error: 'Could not reach RecallRadar.' });
    }
  };

  const loading = state.status === 'loading';
  const result = state.result;
  const groups = result ? groupByDevice(result.matches) : [];

  return (
    <div style={styles.section}>
      <button style={styles.button} onClick={() => check(Boolean(result))} disabled={loading || state.status === 'starting'}>
        {loading ? 'Checking…' : result ? 'Refresh' : 'Check devices for recalls'}
      </button>
      {loading && (
        <div style={styles.meta}>
          Checking your devices against FDA recalls… The first check can take up to a minute. The result
          is saved for {SAVED_FOR_HOURS} hours, so the next one is instant.
        </div>
      )}
      {state.status === 'error' && <div>{state.error}</div>}
      {result && (
        <div>
          <div style={styles.meta}>{formatChecked(result)}</div>
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
                  <Match match={best} />
                  {matches.length > 1 && (
                    <details style={styles.detail}>
                      <summary>{matches.length - 1} other recall{matches.length === 2 ? '' : 's'} for this device</summary>
                      {matches.slice(1).map((m) => (
                        <Match key={m.recallNumber} match={m} />
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
