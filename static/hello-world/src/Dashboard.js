import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, router } from '@forge/bridge';
import {
  CLASSES,
  UNKNOWN_CLASS,
  affectedMatches,
  openRecallsByClass,
  affectedDeviceCount,
  wardsOf,
  filterMatches,
  taskProgress,
  screenFor,
} from './dashboardData.mjs';

// The full-page RecallRadar app. Colours, spacing and type come from Atlassian design tokens
// (var(--ds-...)); view.theme.enable() in Root.js turns them on for light and dark. Each token has the
// matching light-theme value as its fallback, so the page also looks right if tokens are unavailable.
const token = (name, fallback) => `var(--ds-${name}, ${fallback})`;
const color = {
  text: token('text', '#172B4D'),
  subtle: token('text-subtle', '#44546F'),
  surface: token('surface', '#FFFFFF'),
  raised: token('surface-raised', '#FFFFFF'),
  sunken: token('surface-sunken', '#F7F8F9'),
  border: token('border', '#091E4224'),
  link: token('link', '#0C66E4'),
  brand: token('background-brand-bold', '#0C66E4'),
  onBrand: token('text-inverse', '#FFFFFF'),
  danger: token('background-danger-bold', '#C9372C'),
  warning: token('background-warning-bold', '#B65C02'),
  neutral: token('background-neutral-bold', '#44546F'),
  success: token('background-success-bold', '#1F845A'),
  dangerSubtle: token('background-danger', '#FFECEB'),
  successSubtle: token('background-success', '#DCFFF1'),
};
const space = (n) => token(`space-${n}`, `${(n / 100) * 8}px`); // space-100 = 8px

const s = {
  page: { padding: space(300), maxWidth: '1120px', margin: '0 auto', color: color.text, fontFamily: 'inherit' },
  header: { display: 'flex', flexWrap: 'wrap', gap: space(200), alignItems: 'center', justifyContent: 'space-between', marginBottom: space(300) },
  h1: { fontSize: '24px', fontWeight: 600, margin: 0 },
  h2: { fontSize: '16px', fontWeight: 600, margin: `0 0 ${space(150)}` },
  muted: { color: color.subtle, fontSize: '12px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: space(200), marginBottom: space(300) },
  card: { background: color.raised, border: `1px solid ${color.border}`, borderRadius: '8px', padding: space(200) },
  big: { fontSize: '28px', fontWeight: 600, lineHeight: 1.2 },
  section: { background: color.raised, border: `1px solid ${color.border}`, borderRadius: '8px', padding: space(200), marginBottom: space(300) },
  button: { padding: `${space(100)} ${space(200)}`, borderRadius: '4px', border: `1px solid ${color.border}`, background: color.sunken, color: color.text, cursor: 'pointer', font: 'inherit' },
  primary: { padding: `${space(100)} ${space(200)}`, borderRadius: '4px', border: 'none', background: color.brand, color: color.onBrand, cursor: 'pointer', font: 'inherit', fontWeight: 600 },
  hero: { padding: `${space(300)} ${space(200)}`, textAlign: 'center' },
  heroButton: { padding: `${space(200)} ${space(400)}`, fontSize: '18px', borderRadius: '6px', border: 'none', background: color.brand, color: color.onBrand, cursor: 'pointer', fontWeight: 600 },
  select: { padding: space(100), borderRadius: '4px', border: `1px solid ${color.border}`, background: color.surface, color: color.text, font: 'inherit' },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '14px' },
  th: { textAlign: 'left', padding: `${space(100)} ${space(150)}`, borderBottom: `2px solid ${color.border}`, color: color.subtle, fontWeight: 600, whiteSpace: 'nowrap' },
  td: { padding: `${space(100)} ${space(150)}`, borderBottom: `1px solid ${color.border}`, verticalAlign: 'top' },
  alert: { background: color.dangerSubtle, border: `1px solid ${color.danger}`, borderRadius: '4px', padding: space(150), marginBottom: space(200) },
};

const CLASS_COLOR = { I: color.danger, II: color.warning, III: color.neutral, [UNKNOWN_CLASS]: color.neutral };
const CONFIDENCE_COLOR = { exact: color.danger, likely: color.warning };

// A coloured label AND text, so meaning never rests on colour alone.
function Badge({ background, children }) {
  return (
    <span style={{ background, color: color.onBrand, fontSize: '11px', fontWeight: 700, padding: '2px 6px', borderRadius: '3px', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function SummaryCard({ label, value, note, tone, children }) {
  return (
    <div style={{ ...s.card, borderTop: `4px solid ${tone || color.border}` }}>
      <div style={s.muted}>{label}</div>
      <div style={s.big}>{value}</div>
      {note && <div style={s.muted}>{note}</div>}
      {children}
    </div>
  );
}

function openIssue(key) {
  return (event) => {
    event.preventDefault();
    router.open(`/browse/${key}`);
  };
}

const IMPORT_EXAMPLE = 'Name\tManufacturer\tModel\tSerial\tWard\nSigma Spectrum pump\tBaxter Healthcare\t35700BAX2\tSP-30977\tMed-Surg 4E';

// "Import your own devices": paste rows from a spreadsheet (or a .csv). The first row names the columns;
// "manufacturer" and "model" are required. All or nothing: any bad row is listed and nothing is imported.
function ImportDevices({ onImported, startOpen }) {
  const [open, setOpen] = useState(Boolean(startOpen));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState([]);
  const [done, setDone] = useState('');

  const submit = async () => {
    setBusy(true);
    setProblems([]);
    setDone('');
    try {
      const response = await invoke('importDevices', { text });
      if (response && response.ok) {
        setDone(`Imported ${response.count} devices. Checking them against recalls now…`);
        setText('');
        onImported(response.count);
      } else {
        setProblems((response && response.errors) || ['Could not import the devices.']);
      }
    } catch (e) {
      setProblems(['Could not reach RecallRadar. Check your connection and try again.']);
    }
    setBusy(false);
  };

  if (!open) {
    return (
      <button style={s.button} onClick={() => setOpen(true)}>
        Import your own devices
      </button>
    );
  }
  return (
    <div style={{ ...s.card, textAlign: 'left' }}>
      <h2 style={s.h2}>Import your own devices</h2>
      <p style={s.muted}>
        Copy rows from a spreadsheet (or a .csv) and paste them here. The first row names the columns: Manufacturer and
        Model are required; Name, Type, Serial (or Lot), and Ward are optional. Up to 200 devices at a time. Importing
        replaces the devices you imported before and leaves the demo hospital alone. Do not include patient data.
      </p>
      <textarea
        aria-label="Devices to import"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={IMPORT_EXAMPLE}
        rows={8}
        style={{ ...s.select, width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }}
      />
      {problems.length > 0 && (
        <div role="alert" style={{ ...s.alert, marginTop: space(100) }}>
          <strong>Nothing was imported.</strong>
          <ul style={{ margin: `${space(50)} 0 0`, paddingLeft: '20px' }}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {done && (
        <div role="status" style={s.muted}>
          {done}
        </div>
      )}
      <div style={{ display: 'flex', gap: space(100), marginTop: space(100) }}>
        <button style={s.primary} onClick={submit} disabled={busy || !text.trim()}>
          {busy ? 'Importing…' : 'Import devices'}
        </button>
        <button style={s.button} onClick={() => setOpen(false)} disabled={busy}>
          Close
        </button>
      </div>
    </div>
  );
}

const POLL_EVERY_MS = 2000;
const POLL_GIVE_UP_MS = 8 * 60 * 1000;

export default function Dashboard() {
  const [devicesCount, setDevicesCount] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null); // null = no check running
  const [busy, setBusy] = useState(false); // loading the demo hospital
  const [tasks, setTasks] = useState({});
  const [summary, setSummary] = useState(null);
  const [teams, setTeams] = useState({}); // ward -> team name, from Teamwork Graph mappings
  const [recent, setRecent] = useState({ state: 'loading', recalls: [] });
  const [filters, setFilters] = useState({ ward: '', recallClass: '' });
  const timer = useRef(null);
  const started = useRef(0);

  const stopPolling = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const poll = useCallback(() => {
    stopPolling();
    started.current = Date.now();
    timer.current = setInterval(async () => {
      if (Date.now() - started.current > POLL_GIVE_UP_MS) {
        stopPolling();
        setProgress(null);
        setError('The check is taking longer than expected. Reload this page in a minute.');
        return;
      }
      try {
        const response = await invoke('getCheckStatus');
        if (!response || !response.ok) return;
        const job = response.job;
        if (!job) {
          stopPolling();
          setProgress(null);
        } else if (job.status === 'running') {
          setProgress(job.progress || { done: 0, total: 0 });
        } else if (job.status === 'done' && response.result) {
          stopPolling();
          setProgress(null);
          setResult(response.result);
        } else {
          stopPolling();
          setProgress(null);
          setError(job.error || 'The check failed. Try again.');
        }
      } catch (e) {
        // a dropped request is not fatal: the next tick asks again
      }
    }, POLL_EVERY_MS);
  }, [stopPolling]);

  const begin = useCallback(
    async (refresh) => {
      setError('');
      setProgress({ done: 0, total: 0 });
      try {
        const response = await invoke('startCheck', { refresh });
        if (!response || !response.ok) {
          setProgress(null);
          setError((response && response.error) || 'Could not start the check.');
        } else if (response.state === 'saved') {
          setProgress(null);
          setResult(response.result);
        } else if (response.state === 'no-devices') {
          setProgress(null);
        } else {
          setProgress((response.job && response.job.progress) || { done: 0, total: 0 });
          poll();
        }
      } catch (e) {
        setProgress(null);
        setError('Could not reach RecallRadar. Check your connection and try again.');
      }
    },
    [poll],
  );

  // Everything the page needs, read once on open (and again on Retry).
  const load = useCallback(async () => {
    setError('');
    setDevicesCount(null);
    try {
      const [devices, saved, status] = await Promise.all([invoke('listDevices'), invoke('getSavedMatches'), invoke('getCheckStatus')]);
      if (!devices || !devices.ok) throw new Error('devices');
      setDevicesCount(devices.devices.length);
      const saveResult = saved && saved.ok ? saved.result : null;
      setResult(saveResult);
      const job = status && status.ok ? status.job : null;
      if (job && job.status === 'running') {
        setProgress(job.progress || { done: 0, total: 0 });
        poll();
      } else if (!saveResult && job && job.status === 'done' && status.result) {
        setResult(status.result);
      } else if (saveResult && saveResult.stale) {
        begin(false); // show the old result now, refresh in the background
      }
    } catch (e) {
      setError('Could not load RecallRadar. Check your connection and try again.');
    }
    invoke('fetchRecalls')
      .then((response) => setRecent(response && response.ok ? { state: 'done', recalls: response.recalls } : { state: 'error', recalls: [] }))
      .catch(() => setRecent({ state: 'error', recalls: [] }));
    invoke('getWardTeams')
      .then((response) => {
        if (response && response.ok) setTeams(Object.fromEntries(response.mappings.map((m) => [m.ward, m.teamName])));
      })
      .catch(() => {});
  }, [begin, poll]);

  useEffect(() => {
    load();
    return stopPolling;
  }, [load, stopPolling]);

  // Task state and counts, whenever a result arrives.
  const checkedAt = result ? result.checkedAt : null;
  useEffect(() => {
    if (!result) return undefined;
    let cancelled = false;
    const pairs = affectedMatches(result).map((m) => ({ recallNumber: m.recallNumber, deviceId: m.deviceId }));
    if (pairs.length) {
      invoke('getTaskStates', { pairs })
        .then((response) => {
          if (!cancelled && response && response.ok) setTasks(response.tasks);
        })
        .catch(() => {});
    }
    invoke('getTaskSummary')
      .then((response) => {
        if (!cancelled) setSummary(response && response.ok ? response.summary : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // a new result, not every poll tick
  }, [checkedAt]);

  const loadDemo = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await invoke('loadDemoHospital');
      if (response && response.ok) {
        setDevicesCount(response.count);
        setBusy(false);
        begin(false);
        return;
      }
      setError((response && response.error) || 'Could not load the demo hospital.');
    } catch (e) {
      setError('Could not reach RecallRadar. Check your connection and try again.');
    }
    setBusy(false);
  };

  const afterImport = (count) => {
    setDevicesCount(count);
    setSummary(null);
    begin(true);
  };

  const screen = screenFor({ devicesCount, result, error: devicesCount === null && error ? error : '', loading: false });
  const running = progress !== null;

  // --- screens that replace the dashboard ---
  if (screen === 'error') {
    return (
      <div style={s.page}>
        <div role="alert" style={s.alert}>
          <strong>Something went wrong.</strong> {error}
        </div>
        <button style={s.primary} onClick={load}>
          Try again
        </button>
      </div>
    );
  }
  if (screen === 'loading') {
    return (
      <div style={s.page} role="status" aria-live="polite">
        <h1 style={s.h1}>RecallRadar</h1>
        <p style={s.muted}>Loading your devices and recalls…</p>
      </div>
    );
  }
  if (screen === 'first-run') {
    return (
      <div style={s.page}>
        <div style={{ ...s.section, ...s.hero }}>
          <h1 style={s.h1}>Welcome to RecallRadar</h1>
          <p style={{ ...s.muted, fontSize: '14px', maxWidth: '560px', margin: `${space(150)} auto ${space(300)}` }}>
            RecallRadar checks FDA medical device recalls against your hospital&apos;s devices and tells you which ones are
            affected, how sure it is, and why. Start with a sample hospital of 30 devices that use real manufacturer and
            model names, so some of them really match recalls.
          </p>
          {error && (
            <div role="alert" style={s.alert}>
              {error}
            </div>
          )}
          <button style={s.heroButton} onClick={loadDemo} disabled={busy}>
            {busy ? 'Loading demo hospital…' : 'Load demo hospital'}
          </button>
          <p style={s.muted}>Takes a moment. Or use your own devices:</p>
          <div style={{ maxWidth: '640px', margin: '0 auto' }}>
            <ImportDevices onImported={afterImport} />
          </div>
        </div>
      </div>
    );
  }

  const header = (
    <div style={s.header}>
      <div style={{ ...s.muted, fontSize: '14px' }}>FDA device recalls matched to your hospital&apos;s devices</div>
      <div style={{ textAlign: 'right' }}>
        {result && <div style={s.muted}>Last checked {new Date(result.checkedAt).toLocaleString()}{result.stale ? ' (older than 6 hours)' : ''}</div>}
        {screen === 'ready' && (
          <button style={s.button} onClick={() => begin(true)} disabled={running}>
            {running ? 'Checking…' : 'Refresh'}
          </button>
        )}
      </div>
    </div>
  );
  const runningBar = running && (
    <div style={{ ...s.section }} role="status" aria-live="polite">
      <progress max={progress.total || 1} value={progress.done || 0} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
      {progress.total ? `Checked ${progress.done} of ${progress.total} FDA searches…` : 'Starting the background check…'}{' '}
      <span style={s.muted}>It runs in the background, so you can keep working.</span>
    </div>
  );
  const errorBar = error && (
    <div role="alert" style={s.alert}>
      {error}
    </div>
  );

  if (screen === 'no-check') {
    return (
      <div style={s.page}>
        {header}
        {errorBar}
        {runningBar}
        {!running && (
          <div style={{ ...s.section, ...s.hero }}>
            <h2 style={s.h2}>{devicesCount} devices, not checked yet</h2>
            <p style={{ ...s.muted, fontSize: '14px' }}>Compare them with the last year of FDA device recalls.</p>
            <button style={s.heroButton} onClick={() => begin(false)}>
              Check devices for recalls
            </button>
          </div>
        )}
        <div style={s.section}>
          <ImportDevices onImported={afterImport} />
        </div>
      </div>
    );
  }

  // --- the dashboard ---
  const all = affectedMatches(result);
  const byClass = openRecallsByClass(result);
  const openRecalls = Object.values(byClass).reduce((a, b) => a + b, 0);
  const progressTasks = taskProgress(summary);
  const shown = filterMatches(all, filters);
  const wards = wardsOf(all);
  const filtered = filters.ward || filters.recallClass;

  return (
    <div style={s.page}>
      {header}
      {errorBar}
      {runningBar}
      {result.failedQueries > 0 && (
        <div role="alert" style={s.alert}>
          {result.failedQueries} FDA lookups failed or timed out, so this result may be incomplete. Try Refresh.
        </div>
      )}

      <div style={s.grid}>
        <SummaryCard label="Devices" value={devicesCount} note={`${affectedDeviceCount(result)} affected by an open recall`} tone={color.brand} />
        <SummaryCard label="Open recalls (exact or likely)" value={openRecalls} note={`checked against ${result.recallCount} recalls from the last year`} tone={openRecalls ? color.danger : color.success}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: space(100), marginTop: space(100) }}>
            {CLASSES.map((cls) => (
              <Badge key={cls} background={byClass[cls] ? CLASS_COLOR[cls] : color.neutral}>
                CLASS {cls}: {byClass[cls]}
              </Badge>
            ))}
            {byClass[UNKNOWN_CLASS] > 0 && <Badge background={color.neutral}>UNKNOWN: {byClass[UNKNOWN_CLASS]}</Badge>}
          </div>
        </SummaryCard>
        <SummaryCard
          label="Tasks open"
          value={progressTasks ? progressTasks.open : '–'}
          note={progressTasks ? `${progressTasks.done} done of ${progressTasks.total}${summary.capped ? '+' : ''}` : 'task counts unavailable'}
          tone={color.warning}
        />
        <SummaryCard label="Tasks done" value={progressTasks ? progressTasks.done : '–'} note={progressTasks ? `${progressTasks.percentDone}% complete` : ' '} tone={color.success} />
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>Affected devices</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: space(150), marginBottom: space(150), alignItems: 'center' }}>
          <label style={s.muted}>
            Ward{' '}
            <select style={s.select} value={filters.ward} onChange={(e) => setFilters({ ...filters, ward: e.target.value })}>
              <option value="">All wards</option>
              {wards.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <label style={s.muted}>
            Class{' '}
            <select style={s.select} value={filters.recallClass} onChange={(e) => setFilters({ ...filters, recallClass: e.target.value })}>
              <option value="">All classes</option>
              {[...CLASSES, UNKNOWN_CLASS].map((c) => (
                <option key={c} value={c}>
                  {c === UNKNOWN_CLASS ? 'Unknown' : `Class ${c}`}
                </option>
              ))}
            </select>
          </label>
          {filtered && (
            <button style={s.button} onClick={() => setFilters({ ward: '', recallClass: '' })}>
              Clear filters
            </button>
          )}
          <span style={s.muted}>
            Showing {shown.length} of {all.length}
          </span>
        </div>
        {all.length === 0 ? (
          <p style={{ ...s.muted, fontSize: '14px' }}>
            Good news: none of your {devicesCount} devices match an open recall with an exact or likely match.
          </p>
        ) : shown.length === 0 ? (
          <p style={{ ...s.muted, fontSize: '14px' }}>No affected devices match these filters.</p>
        ) : (
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  {['Device', 'Ward', 'Team', 'Recall', 'Class', 'Match', 'Task'].map((h) => (
                    <th key={h} style={s.th} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => {
                  const key = tasks[`${m.recallNumber}|${m.deviceId}`];
                  return (
                    <tr key={`${m.recallNumber}|${m.deviceId}`}>
                      <td style={s.td}>
                        <strong>{m.deviceName}</strong>
                        <div style={s.muted}>
                          {m.deviceManufacturer} {m.deviceModel}
                        </div>
                      </td>
                      <td style={s.td}>{m.ward || 'No ward'}</td>
                      <td style={s.td}>{(m.ward && teams[m.ward]) || <span style={s.muted}>not mapped</span>}</td>
                      <td style={s.td} title={m.reason}>
                        {m.recallNumber}
                        <div style={s.muted}>{m.firm}</div>
                      </td>
                      <td style={s.td}>
                        <Badge background={CLASS_COLOR[m.recallClass] || CLASS_COLOR[UNKNOWN_CLASS]}>{m.recallClass ? `CLASS ${m.recallClass}` : 'CLASS ?'}</Badge>
                      </td>
                      <td style={s.td}>
                        <Badge background={CONFIDENCE_COLOR[m.confidence]}>{m.confidence.toUpperCase()}</Badge>
                      </td>
                      <td style={s.td}>
                        {key ? (
                          <a href={`/browse/${key}`} style={{ color: color.link }} onClick={openIssue(key)}>
                            {key}
                          </a>
                        ) : (
                          <span style={s.muted}>No task yet</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p style={s.muted}>Create tasks from the RecallRadar panel on any Jira issue. Team names come from the Teamwork Graph.</p>
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>Your devices</h2>
        <p style={s.muted}>{devicesCount} devices are loaded. Replace the ones you imported, or add the demo hospital from the Jira issue panel.</p>
        <ImportDevices onImported={afterImport} />
      </div>

      <div style={s.section}>
        <h2 style={s.h2}>Recent FDA device recalls</h2>
        {recent.state === 'loading' && <p style={s.muted}>Loading the latest recalls…</p>}
        {recent.state === 'error' && <p style={s.muted}>Could not load the latest recalls from openFDA right now.</p>}
        {recent.state === 'done' && recent.recalls.length === 0 && <p style={s.muted}>No recent recalls found.</p>}
        {recent.state === 'done' && recent.recalls.length > 0 && (
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  {['Recall', 'Class', 'Firm', 'Product', 'Date'].map((h) => (
                    <th key={h} style={s.th} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.recalls.slice(0, 10).map((r) => (
                  <tr key={r.recallNumber}>
                    <td style={s.td}>{r.recallNumber}</td>
                    <td style={s.td}>{r.recallClass ? `Class ${r.recallClass}` : '?'}</td>
                    <td style={s.td}>{r.firm || 'Unknown firm'}</td>
                    <td style={s.td}>{r.product}</td>
                    <td style={s.td}>{r.date || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
