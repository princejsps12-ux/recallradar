import React, { useState } from 'react';
import { router } from '@forge/bridge';
import Button from '@atlaskit/button/new';
import Spinner from '@atlaskit/spinner';
import Checkbox from '@atlaskit/checkbox';
import ProgressBar from '@atlaskit/progress-bar';
import SectionMessage, { SectionMessageAction } from '@atlaskit/section-message';
import Avatar from '@atlaskit/avatar';
import LinkExternalIcon from '@atlaskit/icon/core/link-external';
import useRecallData from './data/useRecallData';
import { pairOf } from './data/tasks';
import { sp, color, muted, ClassLozenge, MatchLozenge } from './ui/kit';
import { affectedMatches, heroStats, sortByUrgency } from './dashboardData.mjs';

const PANEL_ROWS = 5; // the panel stays compact: the rest lives in the dashboard

const openDashboard = () => router.navigate({ target: 'module', moduleKey: 'recallradar-dashboard' }).catch(() => {});
const openIssue = (key) => router.open(`/browse/${key}`);

// The compact issue panel: the headline, the most urgent devices with one-click tasks, and a link to the dashboard.
// (The panel's frame grows with its content, so confirmations are inline, not pop-ups.)
export default function App() {
  const d = useRecallData();
  const [confirmAll, setConfirmAll] = useState(false);
  const [assignAll, setAssignAll] = useState(false);

  if (d.devicesCount === null && !d.error) {
    return (
      <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: sp(100), minHeight: '88px', color: color.subtle }}>
        <Spinner size="small" label="" /> Loading RecallRadar…
      </div>
    );
  }
  if (d.devicesCount === null) {
    return <SectionMessage appearance="error" title="Something went wrong" actions={<SectionMessageAction onClick={d.load}>Try again</SectionMessageAction>}>{d.error}</SectionMessage>;
  }

  const running = d.progress !== null;
  const link = (
    <Button appearance="subtle" spacing="compact" iconAfter={LinkExternalIcon} onClick={openDashboard}>Open the dashboard</Button>
  );

  if (d.devicesCount === 0) {
    return (
      <SectionMessage appearance="information" title="No devices yet" actions={[<SectionMessageAction key="d" onClick={d.loadDemo}>Load demo hospital</SectionMessageAction>, <SectionMessageAction key="o" onClick={openDashboard}>Open the dashboard to import yours</SectionMessageAction>]}>
        Add the sample hospital (30 devices with real manufacturer and model names) to see RecallRadar at work.
      </SectionMessage>
    );
  }
  if (!d.result) {
    return (
      <div style={{ minHeight: '88px' }}>
        {d.error && <SectionMessage appearance="error">{d.error}</SectionMessage>}
        {running ? (
          <div role="status" aria-live="polite"><ProgressBar ariaLabel="Checking FDA recalls" value={d.progress.total ? d.progress.done / d.progress.total : 0} isIndeterminate={!d.progress.total} /><span style={muted}>Checking {d.devicesCount} devices against FDA recalls in the background…</span></div>
        ) : (
          <div style={{ display: 'flex', gap: sp(100), alignItems: 'center', flexWrap: 'wrap' }}>
            <Button appearance="primary" onClick={() => d.begin(false)}>Check devices for recalls</Button>
            <span style={muted}>{d.devicesCount} devices, not checked yet.</span>
            {link}
          </div>
        )}
      </div>
    );
  }

  const all = affectedMatches(d.result);
  const stats = heroStats(d.result);
  const sorted = sortByUrgency(all);
  const seenDevice = new Set();
  const top = sorted.filter((m) => (seenDevice.has(m.deviceId) ? false : seenDevice.add(m.deviceId))).slice(0, PANEL_ROWS);
  const missing = all.filter((m) => !d.tasks[pairOf(m)]);
  const suggestedCount = missing.filter((m) => d.suggestions[pairOf(m)]).length;
  const teamOf = (ward) => (ward && d.wardInfo.byKey[String(ward).toLowerCase().replace(/[^a-z0-9]/g, '')]) || null;

  return (
    <div style={{ color: color.text, paddingBottom: sp(300) }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(100), alignItems: 'center', justifyContent: 'space-between', minHeight: '40px' }}>
        <div>
          <strong style={{ fontSize: '16px' }}>{stats.devices} {stats.devices === 1 ? 'device needs' : 'devices need'} action</strong>
          {stats.classIDevices > 0 && <span style={{ color: color.danger, fontWeight: 600 }}> · {stats.classIDevices} in Class I</span>}
          <div style={muted}>Checked {new Date(d.result.checkedAt).toLocaleString()}{d.result.stale ? ' (older than 6 hours)' : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: sp(50) }}>
          <Button appearance="subtle" spacing="compact" isDisabled={running} onClick={() => d.begin(true)}>{running ? 'Checking…' : 'Refresh'}</Button>
          {link}
        </div>
      </div>
      <div style={{ minHeight: '8px' }} role="status" aria-live="polite">
        {running && <ProgressBar ariaLabel="Checking FDA recalls" value={d.progress.total ? d.progress.done / d.progress.total : 0} isIndeterminate={!d.progress.total} />}
      </div>
      {d.error && <SectionMessage appearance="error">{d.error}</SectionMessage>}
      {d.note && <SectionMessage appearance={d.note.kind === 'success' ? 'success' : 'warning'} actions={<SectionMessageAction onClick={() => d.setNote(null)}>Dismiss</SectionMessageAction>}>{d.note.text}</SectionMessage>}

      {all.length === 0 ? (
        <SectionMessage appearance="success" title="No devices need action">None of your {d.devicesCount} devices match an open recall with an exact or likely match.</SectionMessage>
      ) : (
        <ol style={{ listStyle: 'none', margin: `${sp(100)} 0 0`, padding: 0 }}>
          {top.map((m, i) => {
            const key = d.tasks[pairOf(m)];
            const suggestion = d.suggestions[pairOf(m)];
            const team = teamOf(m.ward);
            return (
              <li key={m.deviceId} style={{ padding: `${sp(100)} 0`, borderTop: i ? `1px solid ${color.border}` : `1px solid ${color.border}` }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(100), alignItems: 'center' }}>
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <strong>{m.deviceName}</strong>
                    <div style={muted}>{m.ward || 'No ward'} · {m.recallNumber}{team ? ` · Team: ${team.teamName} (from Teamwork Graph)` : ''}</div>
                  </div>
                  <ClassLozenge recallClass={m.recallClass} />
                  <MatchLozenge confidence={m.confidence} />
                </div>
                <div style={{ marginTop: sp(75), display: 'flex', flexWrap: 'wrap', gap: sp(100), alignItems: 'center' }}>
                  {key ? (
                    <><span style={muted}>Task:</span><Button appearance="link" spacing="none" onClick={() => openIssue(key)}>{key}</Button></>
                  ) : (
                    <>
                      <Button appearance="primary" spacing="compact" isDisabled={d.creating.active} onClick={() => d.createTasks([m], false)}>Create task</Button>
                      {suggestion && (
                        <Button spacing="compact" isDisabled={d.creating.active} onClick={() => d.createTasks([m], true)}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: sp(75) }}><Avatar size="xsmall" name={suggestion.name} />Create and assign to {suggestion.name}</span>
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {all.length > 0 && (
        <div style={{ marginTop: sp(150), display: 'grid', gap: sp(100) }}>
          {confirmAll ? (
            <SectionMessage appearance="warning" title={`Create ${missing.length} task${missing.length === 1 ? '' : 's'} in this project?`}>
              {suggestedCount > 0 && (
                <Checkbox label={`Also assign the suggested team member (${suggestedCount} of ${missing.length}, spread across each ward's team)`} isChecked={assignAll} onChange={(e) => setAssignAll(e.target.checked)} />
              )}
              <div style={{ display: 'flex', gap: sp(100), marginTop: sp(100) }}>
                <Button appearance="primary" spacing="compact" isLoading={d.creating.active} onClick={async () => { await d.createTasks(missing, assignAll); setConfirmAll(false); setAssignAll(false); }}>Yes, create {missing.length}</Button>
                <Button appearance="subtle" spacing="compact" isDisabled={d.creating.active} onClick={() => { setConfirmAll(false); setAssignAll(false); }}>Cancel</Button>
              </div>
              {d.creating.active && <div role="status" style={muted}>Creating tasks… {d.creating.done} of {d.creating.total} done.</div>}
            </SectionMessage>
          ) : (
            missing.length > 0 && <div><Button spacing="compact" onClick={() => setConfirmAll(true)}>Create tasks for all ({missing.length})</Button></div>
          )}
          <div style={muted}>
            {all.length > top.length ? `Showing the ${top.length} most urgent of ${stats.devices} devices. ` : ''}
            Filters, details, ward teams and Confluence pages are in the dashboard.
          </div>
        </div>
      )}
    </div>
  );
}
