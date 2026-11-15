import React from 'react';
import Heading from '@atlaskit/heading';
import Button from '@atlaskit/button/new';
import Select from '@atlaskit/select';
import ProgressBar from '@atlaskit/progress-bar';
import CheckCircleIcon from '@atlaskit/icon/core/check-circle';
import { sp, color, card, muted, noBreak, ClassLozenge, MatchLozenge, DetailsButton, useNarrow } from '../ui/kit';
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
          <div style={{ fontSize: '56px', fontWeight: 700, lineHeight: 1, color: stats.classIDevices ? color.danger : color.text, flex: '0 0 auto' }} aria-hidden="true">
            {stats.devices}
          </div>
          <div style={{ minWidth: 0 }}>
            <Heading size="large">{stats.devices === 1 ? 'device needs action' : 'devices need action'}</Heading>
            <div style={{ marginTop: sp(50) }}>
              {stats.classIDevices > 0 ? (
                <span style={{ color: color.danger, fontWeight: 600 }}>
                  {stats.classIDevices} {stats.classIDevices === 1 ? 'device has' : 'devices have'} a Class I recall, the most serious.
                </span>
              ) : (
                <span style={muted}>No device has a Class I recall.</span>
              )}{' '}
              <span style={muted}>
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
export function UrgentList({ matches, canCreate, busy, onCreate, onOpen, projects, projectKey, onProject, hasAll, onCreateAll, pendingCount }) {
  const options = projects.map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }));
  return (
    <section aria-labelledby="rr-urgent" style={{ ...card, minHeight: '120px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(200), justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: sp(200) }}>
        <div>
          <div style={{ margin: 0 }}>
            <Heading size="medium" as="h2" id="rr-urgent">Do this first</Heading>
          </div>
          <div style={muted}>The most urgent devices that have no task yet.</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(150), alignItems: 'flex-end' }}>
          <div style={{ minWidth: '240px' }}>
            <label style={muted} htmlFor="rr-project">Create tasks in project</label>
            <Select inputId="rr-project" aria-label="Jira project for new tasks" spacing="compact" options={options} value={options.find((o) => o.value === projectKey) || null} placeholder="Choose a project" onChange={(o) => onProject(o.value)} menuPosition="fixed" />
          </div>
          {pendingCount > 0 && (
            <Button appearance="primary" isDisabled={!canCreate || busy} onClick={onCreateAll}>
              {`Create all ${pendingCount} tasks…`}
            </Button>
          )}
        </div>
      </div>
      {matches.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: sp(100) }}>
          <CheckCircleIcon label="" color={color.success} />
          <span>{hasAll ? 'Every urgent device already has a task.' : 'Nothing urgent right now.'}</span>
        </div>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {matches.map((m, i) => (
            <li key={m.deviceId} style={{ display: 'flex', flexWrap: 'wrap', gap: sp(150), alignItems: 'center', padding: `${sp(150)} 0`, borderTop: i ? `1px solid ${color.border}` : 'none' }}>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <strong>{m.deviceName}</strong>
                <div style={muted}>
                  {m.ward || 'No ward'} · {m.deviceManufacturer} {m.deviceModel} · <span style={noBreak}>{m.recallNumber}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: sp(100) }}>
                <ClassLozenge recallClass={m.recallClass} />
                <MatchLozenge confidence={m.confidence} />
              </div>
              <div style={{ display: 'flex', gap: sp(100) }}>
                <Button spacing="compact" isDisabled={!canCreate || busy} onClick={() => onCreate(m)}>Create task</Button>
                <DetailsButton onClick={() => onOpen(m.deviceId)} />
              </div>
            </li>
          ))}
        </ol>
      )}
      {!canCreate && matches.length > 0 && <div style={{ ...muted, marginTop: sp(100) }}>Choose a project above to create tasks.</div>}
    </section>
  );
}

function StatCard({ label, value, children, accent }) {
  return (
    <div style={{ ...card, borderTop: `4px solid ${accent || color.borderBold}`, minHeight: '132px' }} role="group" aria-label={label}>
      <div style={muted}>{label}</div>
      <div style={{ fontSize: '32px', fontWeight: 600, lineHeight: 1.2 }}>{value}</div>
      {children}
    </div>
  );
}

export function SummaryCards({ devicesCount, stats, result, summary, progressTasks }) {
  const byClass = openRecallsByClass(result);
  const narrow = useNarrow();
  const none = !progressTasks || progressTasks.total === 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'repeat(auto-fit, minmax(210px, 1fr))', gap: sp(200) }}>
      <StatCard label="Devices" value={devicesCount} accent={color.borderBrand}>
        <div style={muted}>{stats.devices} of them need action</div>
      </StatCard>
      <StatCard label="Open recalls" value={stats.openRecalls} accent={stats.openRecalls ? color.borderDanger : color.borderSuccess}>
        <div style={muted}>recalls, by class:</div>
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
      <StatCard label="Tasks open" value={progressTasks ? progressTasks.open : '–'}>
        <div style={muted}>
          {none ? 'No tasks yet. Start with Do this first.' : `of ${progressTasks.total}${summary && summary.capped ? '+' : ''} RecallRadar tasks`}
        </div>
      </StatCard>
      <StatCard label="Tasks done" value={progressTasks ? progressTasks.done : '–'}>
        {!none ? (
          <div style={{ marginTop: sp(100) }}>
            <ProgressBar ariaLabel={`${progressTasks.percentDone}% of tasks done`} value={progressTasks.percentDone / 100} appearance="success" />
            <div style={muted}>{progressTasks.percentDone}% complete</div>
          </div>
        ) : (
          <div style={muted}>Nothing to complete yet.</div>
        )}
      </StatCard>
    </div>
  );
}
