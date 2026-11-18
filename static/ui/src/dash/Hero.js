import React from 'react';
import Heading from '@atlaskit/heading';
import Button from '@atlaskit/button/new';
import Select from '@atlaskit/select';
import Skeleton from '@atlaskit/skeleton';
import CheckCircleIcon from '@atlaskit/icon/core/check-circle';
import { Stack, Inline } from '../ui/layout';
import { sp, cap, color, card, muted, noBreak, ClassLozenge, MatchLozenge, NameLink, useNarrow } from '../ui/kit';
import { openRecallsByClass, UNKNOWN_CLASS, CLASSES, taskSummaryParts } from '../dashboardData.mjs';

// One line of facts under the big number. It replaces three separate stat cards: devices monitored, open recalls by
// class (the class is text AND colour) and the Jira task counts. Each number says what it counts.
function SummaryLine({ devicesCount, stats, result, progressTasks, summaryState, capped }) {
  const byClass = openRecallsByClass(result);
  const tasks = taskSummaryParts(progressTasks, summaryState, capped);
  const item = { display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: sp(75) };
  return (
    <div role="group" aria-label="Summary" style={{ margin: `${sp(200)} 0 0`, padding: `${sp(150)} 0 0`, borderTop: `1px solid ${color.border}` }}>
      <Inline as="div" role="list" space="space.400" rowSpace="space.100" shouldWrap>
      <li style={item}>
        <strong>{devicesCount}</strong> {devicesCount === 1 ? 'device' : 'devices'} monitored
      </li>
      <li style={item}>
        <span><strong>{stats.openRecalls}</strong> open {stats.openRecalls === 1 ? 'recall' : 'recalls'}</span>
        {CLASSES.filter((cls) => byClass[cls] > 0).map((cls) => (
          <span key={cls} style={{ display: 'inline-flex', alignItems: 'center', gap: sp(50), ...noBreak }}>
            <ClassLozenge recallClass={cls} />
            <strong>{byClass[cls]}</strong>
          </span>
        ))}
        {byClass[UNKNOWN_CLASS] > 0 && <span style={muted}>+{byClass[UNKNOWN_CLASS]} unknown class</span>}
      </li>
      <li style={item}>
        {tasks === null ? (
          <Skeleton height="20px" width="150px" isShimmering />
        ) : (
          <>
            {tasks.lead && <strong>{tasks.lead}</strong>} {tasks.rest}
          </>
        )}
      </li>
      </Inline>
    </div>
  );
}

// The one big number: how many devices need action, with Class I called out in red, then the summary line.
// Every number says what it counts.
export function Hero({ stats, devicesCount, result, progressTasks, summaryState, capped, covered = false }) {
  const none = stats.devices === 0;
  // Every device that needs action already has a task: the work is tracked, so no alarm colour and no "need action".
  const tracked = covered && !none;
  return (
    <section aria-label="What needs action" style={{ ...card, borderLeft: `4px solid ${none ? color.borderSuccess : tracked ? color.borderBrand : stats.classIDevices ? color.borderDanger : color.borderBrand}` }}>
      <Inline space="space.300" alignBlock="center">
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
            <Stack space="space.050">
              <Heading size="large">{tracked ? (stats.devices === 1 ? 'device has a task' : 'devices have a task') : stats.devices === 1 ? 'device needs action' : 'devices need action'}</Heading>
              <div>
                {stats.classIDevices > 0 ? (
                  <span style={{ fontWeight: 600 }}>
                    {stats.classIDevices} {stats.classIDevices === 1 ? 'device has' : 'devices have'} a Class I recall, the most serious.
                  </span>
                ) : (
                  <span style={muted}>No device has a Class I recall.</span>
                )}
              </div>
            </Stack>
          </>
        )}
      </Inline>
      <SummaryLine devicesCount={devicesCount} stats={stats} result={result} progressTasks={progressTasks} summaryState={summaryState} capped={capped} />
    </section>
  );
}

// "Do this first": the most urgent devices that have no task yet. One primary action for the whole block
// (create them all, with a confirmation). Each row has ONE action, "Create task"; the device name opens its details.
export function UrgentList({ matches, canCreate, busy, onCreate, onOpen, projects, projectKey, onProject, hasAll, onCreateAll, pendingCount, deviceCount, loading }) {
  const options = projects.map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }));
  // On a phone the project choice and the button fill the width, one under the other, instead of a narrow box with a button
  // hanging off its left edge.
  const narrow = useNarrow();
  return (
    <section aria-labelledby="rr-urgent" style={{ ...card, minHeight: '120px' }}>
      <div style={{ marginBottom: sp(200) }}><Inline space="space.200" rowSpace="space.200" spread="space-between" alignBlock="end" shouldWrap>
        <div>
          <div style={{ margin: 0 }}>
            <Heading size="medium" as="h2" id="rr-urgent">Do this first</Heading>
          </div>
          {(loading || pendingCount > 0) && <div style={muted}>{`Most urgent first. ${pendingCount} ${pendingCount === 1 ? 'task' : 'tasks'} for ${deviceCount} ${deviceCount === 1 ? 'device' : 'devices'}, one per device and recall.`}</div>}
        </div>
        <div style={{ ...(narrow ? { width: '100%' } : {}) }}><Inline space="space.150" rowSpace="space.150" alignBlock="end" shouldWrap>
          {(loading || pendingCount > 0) && <div style={{ minWidth: '240px', ...(narrow ? { width: '100%' } : {}) }}>
            <label style={muted} htmlFor="rr-project">Create tasks in project</label>
            <Select inputId="rr-project" aria-label="Jira project for new tasks" spacing="compact" options={options} value={options.find((o) => o.value === projectKey) || null} placeholder="Choose a project" onChange={(o) => onProject(o.value)} menuPosition="fixed" />
          </div>}
          {pendingCount > 0 && (
            <Button appearance="primary" shouldFitContainer={narrow} isDisabled={loading || !canCreate || busy} onClick={onCreateAll}>
              {`Create all ${pendingCount} tasks…`}
            </Button>
          )}
        </Inline></div>
      </Inline></div>
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
            <li key={m.deviceId} style={{ padding: `${sp(150)} 0`, borderTop: i ? `1px solid ${color.border}` : 'none' }}>
              <Inline space="space.150" rowSpace="space.100" alignBlock="center" shouldWrap>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <NameLink label={`Details for ${cap(m.deviceName)}, recall ${m.recallNumber}`} onClick={() => onOpen(m.deviceId)}>{cap(m.deviceName)}</NameLink>
                <div style={muted}>
                  {m.ward || 'No ward'} · {m.deviceManufacturer} {m.deviceModel} · <span style={noBreak}>{m.recallNumber}</span>
                </div>
              </div>
              <Inline space="space.100">
                <div style={{ minWidth: '64px' }}><ClassLozenge recallClass={m.recallClass} /></div>
                <div style={{ minWidth: '96px' }}><MatchLozenge confidence={m.confidence} /></div>
              </Inline>
              <Button isDisabled={!canCreate || busy} onClick={() => onCreate(m)}>Create task</Button>
              </Inline>
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
