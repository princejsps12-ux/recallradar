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
export default function useRecallData({ withProjects = false } = {}) {
  const [devicesCount, setDevicesCount] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null); // null = no check running
  const [tasks, setTasks] = useState({});
  const [summary, setSummary] = useState(null);
  const [suggestions, setSuggestions] = useState({});
  const [wardInfo, setWardInfo] = useState({ mappings: [], wards: [], byKey: {} });
  const [recent, setRecent] = useState({ state: 'loading', recalls: [] });
  const [projects, setProjects] = useState([]);
  const [projectKey, setProjectKeyState] = useState(remembered());
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
  }, []);

  const load = useCallback(async () => {
    setError('');
    setDevicesCount(null);
    try {
      const [devices, saved, status] = await Promise.all([invoke('listDevices'), invoke('getSavedMatches'), invoke('getCheckStatus')]);
      if (!devices || !devices.ok) throw new Error('devices');
      setDevicesCount(devices.devices.length);
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
    loadWardInfo();
    invoke('fetchRecalls')
      .then((response) => setRecent(response && response.ok ? { state: 'done', recalls: response.recalls } : { state: 'error', recalls: [] }))
      .catch(() => setRecent({ state: 'error', recalls: [] }));
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
  }, [begin, poll, loadWardInfo, withProjects]);

  useEffect(() => {
    load();
    return stopPolling;
  }, [load, stopPolling]);

  // Task state, counts and assignee suggestions whenever a result (or the ward teams) change.
  const checkedAt = result ? result.checkedAt : null;
  const mappingSignature = wardInfo.mappings.map((m) => `${m.ward}:${m.teamAri}`).join(',');
  useEffect(() => {
    if (!result) return undefined;
    let cancelled = false;
    const pairs = affectedMatches(result).map((m) => ({ recallNumber: m.recallNumber, deviceId: m.deviceId }));
    if (pairs.length) {
      invoke('getTaskStates', { pairs })
        .then((r) => {
          if (!cancelled && r && r.ok) setTasks(r.tasks);
        })
        .catch(() => {});
    }
    invoke('getTaskSummary')
      .then((r) => {
        if (!cancelled) setSummary(r && r.ok ? r.summary : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [checkedAt]); // eslint-disable-line

  useEffect(() => {
    if (!result || wardInfo.mappings.length === 0) {
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
      projectKey: withProjects ? projectKey : undefined,
      onProgress: (done, total) => setCreating({ active: true, done, total }),
      onTasks: (known) => setTasks((previous) => ({ ...previous, ...known })),
    });
    setCreating({ active: false, done: 0, total: 0 });
    const text = summarize(totals);
    if (text) setNote({ kind: totals.stopped || totals.failed.length ? 'warning' : 'success', text });
    if (totals.created) invoke('getTaskSummary').then((r) => setSummary(r && r.ok ? r.summary : null)).catch(() => {});
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

  const afterDevicesChanged = (count) => {
    setDevicesCount(count);
    setSummary(null);
    if (count > 0) begin(true);
    else setResult(null);
    loadWardInfo();
  };

  return {
    devicesCount, result, error, progress, tasks, summary, suggestions, wardInfo, recent, projects, projectKey, creating, note,
    setProjectKey, setNote, load, begin, createTasks, loadDemo, loadWardInfo, afterDevicesChanged,
  };
}
