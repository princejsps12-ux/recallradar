import React from 'react';
import Heading from '@atlaskit/heading';
import Button from '@atlaskit/button/new';
import Select from '@atlaskit/select';
import ProgressBar from '@atlaskit/progress-bar';
import Skeleton from '@atlaskit/skeleton';
import CheckCircleIcon from '@atlaskit/icon/core/check-circle';
import { sp, cap, color, card, muted, noBreak, ClassLozenge, MatchLozenge, DetailsButton, useNarrow } from '../ui/kit';
import { openRecallsByClass, UNKNOWN_CLASS, CLASSES } from '../dashboardData.mjs';

// The one big number: how many devices need action, with Class I called out in red. Every number says what it counts.
export function Hero({ stats }) {
  const none = stats.devices === 0;
  return (
    <section aria-label="What needs action" style={{ ...card, borderLeft: `4px solid ${none ? color.borderSuccess : stats.classIDevices ? color.borderDanger : color.borderBrand}`, display: 'flex', gap: sp(300), alignItems: 'center', flexWrap: 'nowrap', minHeight: '112px' }}>
      {none ? (
        <>
          <CheckCircleIcon label="" color={color.success} />
          <div>
            <Heading size="large">No devices need action</Heading>
            <div style={muted}>None of your devices match an open recall with an exact or likely match.</div>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: '56px', fontWeight: 700, lineHeight: 1, color: color.text, flex: '0 0 auto' }} aria-hidden="true">
            {stats.devices}
          </div>
          <div style={{ minWidth: 0 }}>
            <Heading size="large">{stats.devices === 1 ? 'device needs action' : 'devices need action'}</Heading>
            <div style={{ marginTop: sp(50) }}>
              {stats.classIDevices > 0 ? (
                <span style={{ fontWeight: 600 }}>
                  {stats.classIDevices} {stats.classIDevices === 1 ? 'device has' : 'devices have'} a Class I recall, the most serious.
                </span>
              ) : (
                <span style={muted}>No device has a Class I recall.</span>
              )}{' '}
              <span>
                {stats.openRecalls} open recall{stats.openRecalls === 1 ? '' : 's'} affect{stats.openRecalls === 1 ? 's' : ''} them.
              </span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

// "Do this first": the most urgent devices that have no task yet. One primary action for the whole block
// (create them all, with a confirmation), and a quiet default button on each row.
export function UrgentList({ matches, canCreate, busy, onCreate, onOpen, projects, projectKey, onProject, hasAll, onCreateAll, pendingCount, deviceCount, loading }) {
  const options = projects.map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }));
  return (
    <section aria-labelledby="rr-urgent" style={{ ...card, minHeight: '120px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(200), justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: sp(200) }}>
        <div>
          <div style={{ margin: 0 }}>
            <Heading size="medium" as="h2" id="rr-urgent">Do this first</Heading>
          </div>
          <div style={muted}>Most urgent first. {pendingCount} {pendingCount === 1 ? 'task' : 'tasks'} for {deviceCount} {deviceCount === 1 ? 'device' : 'devices'}, one per device and recall.</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(150), alignItems: 'flex-end' }}>
          <div style={{ minWidth: '240px' }}>
            <label style={muted} htmlFor="rr-project">Create tasks in project</label>
            <Select inputId="rr-project" aria-label="Jira project for new tasks" spacing="compact" options={options} value={options.find((o) => o.value === projectKey) || null} placeholder="Choose a project" onChange={(o) => onProject(o.value)} menuPosition="fixed" />
          </div>
          {pendingCount > 0 && (
            <Button appearance="primary" isDisabled={loading || !canCreate || busy} onClick={onCreateAll}>
              {`Create all ${pendingCount} tasks…`}
            </Button>
          )}
        </div>
      </div>
      {loading ? (
        <div aria-hidden="true" style={{ display: 'grid', gap: sp(150), minHeight: '340px' }}>
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height="58px" width="100%" isShimmering />)}
        </div>
      ) : matches.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: sp(100) }}>
          <CheckCircleIcon label="" color={color.success} />
          <span>{hasAll ? 'Every urgent device already has a task.' : 'Nothing urgent right now.'}</span>
        </div>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {matches.map((m, i) => (
            <li key={m.deviceId} style={{ display: 'flex', flexWrap: 'wrap', gap: sp(150), alignItems: 'center', padding: `${sp(150)} 0`, borderTop: i ? `1px solid ${color.border}` : 'none' }}>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <strong>{cap(m.deviceName)}</strong>
                <div style={muted}>
                  {m.ward || 'No ward'} · {m.deviceManufacturer} {m.deviceModel} · <span style={noBreak}>{m.recallNumber}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: sp(100) }}>
                <div style={{ minWidth: '64px' }}><ClassLozenge recallClass={m.recallClass} /></div>
                <div style={{ minWidth: '96px' }}><MatchLozenge confidence={m.confidence} /></div>
              </div>
              <div style={{ display: 'flex', gap: sp(100) }}>
                <Button isDisabled={!canCreate || busy} onClick={() => onCreate(m)}>Create task</Button>
                <DetailsButton onClick={() => onOpen(m.deviceId)} />
              </div>
            </li>
          ))}
        </ol>
      )}
      {!loading && deviceCount > matches.length && matches.length > 0 && (
        <div style={{ ...muted, marginTop: sp(100) }}>Showing the {matches.length} most urgent of {deviceCount} devices without a task. All of them are in the list below.</div>
      )}
      {!canCreate && matches.length > 0 && <div style={{ ...muted, marginTop: sp(100) }}>Choose a project above to create tasks.</div>}
    </section>
  );
}

function StatCard({ label, value, children, accent }) {
  return (
    <div style={{ ...card, minHeight: '132px' }} role="group" aria-label={label}>
      <div style={muted}>{label}</div>
      <div style={{ fontSize: '32px', fontWeight: 600, lineHeight: 1.2 }}>{value}</div>
      {children}
    </div>
  );
}

export function SummaryCards({ devicesCount, stats, result, summary, summaryState, progressTasks }) {
  const byClass = openRecallsByClass(result);
  const narrow = useNarrow();
  const none = !progressTasks || progressTasks.total === 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'repeat(auto-fit, minmax(210px, 1fr))', gap: sp(200) }}>
      <StatCard label="Devices" value={devicesCount} accent={color.borderBrand}>
        <div style={muted}>monitored for recalls</div>
      </StatCard>
      <StatCard label="Open recalls" value={stats.openRecalls} accent={stats.openRecalls ? color.borderDanger : color.borderSuccess}>
        <div style={muted}>By class</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(150), marginTop: sp(50) }}>
          {CLASSES.map((cls) => (
            <span key={cls} style={{ display: 'inline-flex', alignItems: 'center', gap: sp(100), ...noBreak }}>
              <ClassLozenge recallClass={cls} />
              <strong aria-label={`${byClass[cls]} recalls in class ${cls}`}>{byClass[cls]}</strong>
            </span>
          ))}
          {byClass[UNKNOWN_CLASS] > 0 && <span style={muted}>+{byClass[UNKNOWN_CLASS]} unknown class</span>}
        </div>
      </StatCard>
      <StatCard label="Tasks open" value={summaryState === 'loading' ? <Skeleton height="32px" width="48px" isShimmering /> : progressTasks ? progressTasks.open : '–'}>
        <div style={muted}>
          {summaryState === 'loading' ? ' ' : summaryState === 'error' ? 'Could not read the task counts.' : none ? 'None created yet.' : `${progressTasks.done} done, of ${progressTasks.total}${summary && summary.capped ? '+' : ''} RecallRadar tasks`}
        </div>
        {!none && summaryState === 'ok' && <div style={{ marginTop: sp(100) }}><ProgressBar ariaLabel={`${progressTasks.percentDone}% of tasks done`} value={progressTasks.percentDone / 100} appearance="success" /></div>}
      </StatCard>
    </div>
  );
}
