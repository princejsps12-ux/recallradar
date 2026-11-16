import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@forge/bridge';
import { affectedMatches } from '../dashboardData.mjs';
import { createInBatches, summarize, pairOf } from './tasks';

const POLL_EVERY_MS = 2000;
const POLL_GIVE_UP_MS = 8 * 60 * 1000;
const PROJECT_STORAGE_KEY = 'recallradar-project';

const remembered = () => {
  try {
    return window.localStorage.getItem(PROJECT_STORAGE_KEY) || '';
  } catch (e) {
    return ''; // storage can be blocked: the choice just is not remembered
  }
};

// Everything the dashboard and the panel share: the device count, the saved check and its background
// refresh, which matches already have tasks, suggested assignees, ward-team mappings, projects, and creating tasks.
// `light` is for the issue panel (it shows on every issue, so it asks for as little as possible): no task counts, and
// no ward teams or assignee suggestions (those call the Teamwork Graph) unless `withSuggestions` says so. The newest FDA
// recalls load only when the dashboard calls `loadRecent`. `projectKey` fixes the project for tasks (the create-all
// pop-up gets it from the panel).
export default function useRecallData({ withProjects = false, light = false, withSuggestions, projectKey: fixedProjectKey } = {}) {
  const wantSuggestions = withSuggestions === undefined ? !light : withSuggestions;
  const wantWards = !light || wantSuggestions;
  const [devicesCount, setDevicesCount] = useState(null);
  const [canManageTeams, setCanManageTeams] = useState(true); // may this person change the ward-to-team mapping? (Jira or project administrator)
  const [canManage, setCanManage] = useState(true); // may this person change the device list? (a Jira administrator may; the server decides)
  const [importedCount, setImportedCount] = useState(0); // devices the person pasted in (the rest are the demo hospital)
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null); // null = no check running
  const [tasks, setTasks] = useState({});
  const [summary, setSummary] = useState(null);
  const [summaryState, setSummaryState] = useState('loading'); // 'loading' | 'ok' | 'error'
  const [tasksReady, setTasksReady] = useState(false); // task links known (so rows do not change after they appear)
  const [wardLoaded, setWardLoaded] = useState(false);
  const [suggestions, setSuggestions] = useState({});
  const [wardInfo, setWardInfo] = useState({ mappings: [], wards: [], byKey: {} });
  const [recent, setRecent] = useState({ state: 'idle', recalls: [] }); // 'idle' until the person opens the list
  const [projects, setProjects] = useState([]);
  const [projectKey, setProjectKeyState] = useState(fixedProjectKey || remembered());
  const [creating, setCreating] = useState({ active: false, done: 0, total: 0 });
  const [note, setNote] = useState(null); // { kind: 'success' | 'warning', text }
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
        setError('The check is taking longer than expected. Reload in a minute.');
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

  const loadWardInfo = useCallback(async () => {
    try {
      const response = await invoke('getWardTeams');
      if (response && response.ok) {
        const byKey = {};
        response.mappings.forEach((m) => {
          byKey[String(m.ward || '').toLowerCase().replace(/[^a-z0-9]/g, '')] = m;
        });
        setWardInfo({ mappings: response.mappings, wards: response.wards, byKey });
      }
    } catch (e) {
      // works without ward teams
    }
    setWardLoaded(true);
  }, []);

  const load = useCallback(async () => {
    setError('');
    setDevicesCount(null);
    try {
      const [devices, saved, status] = await Promise.all([invoke('listDevices'), invoke('getSavedMatches'), invoke('getCheckStatus')]);
      if (!devices || !devices.ok) throw new Error('devices');
      setDevicesCount(devices.devices.length);
      setImportedCount(devices.devices.filter((d) => d.source === 'manual').length);
      if (!light) invoke('getCapabilities').then((r) => { if (r && r.ok) { setCanManage(Boolean(r.canManageDevices)); setCanManageTeams(r.canManageTeams !== false); } }).catch(() => {});
      const savedResult = saved && saved.ok ? saved.result : null;
      setResult(savedResult);
      const job = status && status.ok ? status.job : null;
      if (job && job.status === 'running') {
        setProgress(job.progress || { done: 0, total: 0 });
        poll();
      } else if (!savedResult && job && job.status === 'done' && status.result) {
        setResult(status.result);
      } else if (savedResult && savedResult.stale) {
        begin(false);
      }
    } catch (e) {
      setError('Could not load RecallRadar. Check your connection and try again.');
    }
    if (wantWards) loadWardInfo();
    if (withProjects) {
      invoke('listProjects')
        .then((response) => {
          if (!response || !response.ok) return;
          setProjects(response.projects);
          // Keep the person's earlier choice; otherwise start on the project they viewed most recently. Never an
          // arbitrary project: with no recent one nothing is preselected and they must choose.
          setProjectKeyState((current) => {
            if (current && response.projects.some((p) => p.key === current)) return current;
            return (response.recent || []).find((k) => response.projects.some((p) => p.key === k)) || '';
          });
        })
        .catch(() => {});
    }
  }, [begin, poll, loadWardInfo, withProjects, wantWards]);

  useEffect(() => {
    load();
    return stopPolling;
  }, [load, stopPolling]);

  // The newest FDA recalls are only context, and every load is a request to the public FDA service, so they are
  // fetched when the person opens the list on the dashboard, not on every page view. Asking again after an error is allowed.
  const loadRecent = useCallback(() => {
    setRecent((current) => (current.state === 'idle' || current.state === 'error' ? { state: 'loading', recalls: [] } : current));
    invoke('fetchRecalls')
      .then((response) => setRecent(response && response.ok ? { state: 'done', recalls: response.recalls } : { state: 'error', recalls: [] }))
      .catch(() => setRecent({ state: 'error', recalls: [] }));
  }, []);

  // Task state, counts and assignee suggestions whenever a result (or the ward teams) change.
  const checkedAt = result ? result.checkedAt : null;
  const mappingSignature = wardInfo.mappings.map((m) => `${m.ward}:${m.teamAri}`).join(',');
  useEffect(() => {
    if (!result) return undefined;
    let cancelled = false;
    const pairs = affectedMatches(result).map((m) => ({ recallNumber: m.recallNumber, deviceId: m.deviceId }));
    const states = pairs.length
      ? invoke('getTaskStates', { pairs })
          .then((r) => {
            if (!cancelled && r && r.ok) setTasks(r.tasks);
          })
          .catch(() => {})
      : Promise.resolve();
    states.then(() => {
      if (!cancelled) setTasksReady(true);
    });
    if (!light) {
      invoke('getTaskSummary')
        .then((r) => {
          if (cancelled) return;
          setSummary(r && r.ok ? r.summary : null);
          setSummaryState(r && r.ok ? 'ok' : 'error');
        })
        .catch(() => {
          if (!cancelled) setSummaryState('error');
        });
    }
    return () => {
      cancelled = true;
    };
  }, [checkedAt]); // eslint-disable-line

  useEffect(() => {
    if (!wantSuggestions || !result || wardInfo.mappings.length === 0) {
      setSuggestions({});
      return undefined;
    }
    let cancelled = false;
    const pairs = affectedMatches(result).filter((m) => !tasks[pairOf(m)]).map((m) => ({ recallNumber: m.recallNumber, deviceId: m.deviceId }));
    if (pairs.length === 0) return undefined;
    invoke('suggestAssignees', { pairs })
      .then((r) => {
        if (!cancelled) setSuggestions(r && r.ok ? r.suggestions : {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [checkedAt, mappingSignature]); // eslint-disable-line

  const setProjectKey = (key) => {
    setProjectKeyState(key);
    try {
      window.localStorage.setItem(PROJECT_STORAGE_KEY, key);
    } catch (e) {
      // not remembered
    }
  };

  // Create tasks for matches; resolves when done. `assign` only for people the person agreed to.
  const createTasks = async (matches, assign) => {
    setCreating({ active: true, done: 0, total: matches.length });
    setNote(null);
    const totals = await createInBatches({
      matches,
      assign,
      suggestions,
      projectKey: withProjects || fixedProjectKey ? projectKey : undefined,
      onProgress: (done, total) => setCreating({ active: true, done, total }),
      onTasks: (known) => setTasks((previous) => ({ ...previous, ...known })),
    });
    setCreating({ active: false, done: 0, total: 0 });
    const text = summarize(totals);
    if (text) setNote({ kind: totals.stopped || totals.failed.length ? 'warning' : 'success', title: totals.stopped || totals.failed.length ? 'Some tasks were not created' : totals.created ? (totals.created === 1 ? 'Task created' : 'Tasks created') : 'Nothing new to create', text });
    if (totals.created && !light) invoke('getTaskSummary').then((r) => { setSummary(r && r.ok ? r.summary : null); setSummaryState(r && r.ok ? 'ok' : 'error'); }).catch(() => {});
    return totals;
  };

  const loadDemo = async () => {
    setError('');
    try {
      const response = await invoke('loadDemoHospital');
      if (response && response.ok) {
        setDevicesCount(response.count);
        begin(false);
        loadWardInfo();
        return true;
      }
      setError((response && response.error) || 'Could not load the demo hospital.');
    } catch (e) {
      setError('Could not reach RecallRadar. Check your connection and try again.');
    }
    return false;
  };

  // After an import or a removal: read the real device list again (an import answers with how many rows it added, not
  // with how many devices there are now), say what happened, and check again.
  const afterDevicesChanged = async (change = {}) => {
    const before = devicesCount;
    setSummary(null);
    setSummaryState('loading');
    let total = change.cleared ? 0 : before || 0;
    try {
      const listed = await invoke('listDevices');
      if (listed && listed.ok) {
        total = listed.devices.length;
        setImportedCount(listed.devices.filter((d) => d.source === 'manual').length);
      }
    } catch (e) {
      // keep the best guess above; the next load corrects it
    }
    setDevicesCount(total);
    const plural = (n) => `${n} ${n === 1 ? 'device' : 'devices'}`;
    if (change.imported) {
      setNote({ kind: 'success', title: `${plural(change.imported)} imported`, text: 'Checking them against the last year of FDA recalls now.' });
    } else if (change.removed && before != null && before > total) {
      setNote({ kind: 'success', title: `${plural(before - total)} removed`, text: total > 0 ? 'Checking the rest again.' : 'Nothing is left to check.' });
    }
    if (total > 0) begin(true);
    else setResult(null);
    loadWardInfo();
  };

  return {
    devicesCount, importedCount, canManage, canManageTeams, result, error, progress, tasks, summary, summaryState, tasksReady, wardLoaded, suggestions, wardInfo, recent, loadRecent, projects, projectKey, creating, note,
    setProjectKey, setNote, load, begin, createTasks, loadDemo, loadWardInfo, afterDevicesChanged,
  };
}
