import React from 'react';
import { router, view, Modal } from '@forge/bridge';
import Button from '@atlaskit/button/new';
import Skeleton from '@atlaskit/skeleton';
import VisuallyHidden from '@atlaskit/visually-hidden';
import SectionMessage, { SectionMessageAction } from '@atlaskit/section-message';
import LinkExternalIcon from '@atlaskit/icon/core/link-external';
import RefreshIcon from '@atlaskit/icon/core/refresh';
import CheckCircleIcon from '@atlaskit/icon/core/check-circle';
import useRecallData from './data/useRecallData';
import { pairOf } from './data/tasks';
import { sp, cap, color, muted, noBreak, ClassLozenge, MatchLozenge, CheckedAt } from './ui/kit';
import { affectedMatches, heroStats, urgentMatches } from './dashboardData.mjs';

// The issue panel is a compact summary card that links to the dashboard. Its frame has a FIXED height (viewportSize
// in manifest.yml), so the card is built to a fixed height too: a header of two lines, ROWS rows of ROW_HEIGHT each
// (long names are cut with an ellipsis, never wrapped) and one row of buttons. That is why it
// neither leaves empty space nor gets clipped. All the doing (per-device buttons, details, teams) lives in the dashboard.
const ROWS = 3;
const ROW_HEIGHT = 54; // px: 48 (header) + 3 x 54 + 8 + 32 (buttons) + 4 = 254 fits the 262 px frame of viewportSize: medium
const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

const openDashboard = () => router.navigate({ target: 'module', moduleKey: 'recallradar-dashboard' }).catch(() => {});

// "Create all N tasks…" opens the same confirmation as the dashboard, as a Jira pop-up (the panel itself is too small
// for a dialog). The pop-up is this same bundle (see CreateAllWindow.js); `view.close({ created })` tells us to reload.
async function openCreateAll(onDone) {
  let projectKey;
  try {
    const context = await view.getContext();
    const extension = (context && context.extension) || {};
    const issueKey = extension.issue && extension.issue.key;
    projectKey = (extension.project && extension.project.key) || (issueKey ? issueKey.slice(0, issueKey.lastIndexOf('-')) : undefined);
  } catch (e) {
    // the server knows the issue's project as well
  }
  try {
    await new Modal({ resource: 'main', size: 'medium', context: { view: 'create-all', projectKey }, onClose: (payload) => { if (payload && payload.created) onDone(); } }).open();
  } catch (e) {
    openDashboard(); // no pop-up available: the dashboard has the same button
  }
}

function PanelSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <VisuallyHidden>Loading RecallRadar…</VisuallyHidden>
      <div aria-hidden="true" style={{ display: 'grid', gap: sp(100) }}>
        <Skeleton height="48px" width="62%" isShimmering />
        {Array.from({ length: ROWS }, (_, i) => <Skeleton key={i} height={`${ROW_HEIGHT - 8}px`} width="100%" isShimmering />)}
        <Skeleton height="32px" width="52%" isShimmering />
      </div>
    </div>
  );
}

function DeviceRow({ m }) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: sp(150), height: `${ROW_HEIGHT}px`, boxSizing: 'border-box', borderTop: `1px solid ${color.border}` }}>
      <div style={{ flex: '1 1 0', minWidth: 0 }}>
        <div style={ellipsis}><strong>{cap(m.deviceName)}</strong></div>
        <div style={{ ...muted, ...ellipsis }}>{m.ward || 'No ward'} · <span style={noBreak}>{m.recallNumber}</span></div>
      </div>
      <span style={{ display: 'inline-flex', gap: sp(100), flex: '0 0 auto' }}>
        <ClassLozenge recallClass={m.recallClass} />
        <MatchLozenge confidence={m.confidence} />
      </span>
    </li>
  );
}

export default function App() {
  const d = useRecallData({ light: true });

  if (d.devicesCount === null && !d.error) return <PanelSkeleton />;
  if (d.devicesCount === null) {
    return <SectionMessage appearance="error" title="Something went wrong" actions={<SectionMessageAction onClick={d.load}>Try again</SectionMessageAction>}>{d.error}</SectionMessage>;
  }
  if (d.devicesCount === 0) {
    return (
      <SectionMessage appearance="information" title="No devices yet" actions={[<SectionMessageAction key="d" onClick={d.loadDemo}>Load demo hospital</SectionMessageAction>, <SectionMessageAction key="o" onClick={openDashboard}>Open the dashboard to import yours</SectionMessageAction>]}>
        Add the sample hospital (30 devices with real manufacturer and model names) to see RecallRadar at work.
      </SectionMessage>
    );
  }

  const running = d.progress !== null;
  const progressText = d.progress && d.progress.total ? `Checking FDA recalls: ${d.progress.done} of ${d.progress.total} searches` : 'Starting the FDA check';
  const dashboardButton = (
    <Button appearance="primary" iconAfter={LinkExternalIcon} onClick={openDashboard}>Open dashboard</Button>
  );

  if (!d.result) {
    return (
      <div style={{ minHeight: '88px' }}>
        {d.error && <SectionMessage appearance="error">{d.error}</SectionMessage>}
        {running ? (
          <div role="status" aria-live="polite" style={muted}>{progressText}. You can keep working.</div>
        ) : (
          <div style={{ display: 'flex', gap: sp(100), alignItems: 'center', flexWrap: 'wrap' }}>
            <Button appearance="primary" onClick={() => d.begin(false)}>Check devices for recalls</Button>
            <span style={muted}>{d.devicesCount} devices, not checked yet.</span>
            <Button appearance="subtle" iconAfter={LinkExternalIcon} onClick={openDashboard}>Open dashboard</Button>
          </div>
        )}
      </div>
    );
  }

  const all = affectedMatches(d.result);
  const stats = heroStats(d.result);
  const top = urgentMatches(d.result, d.tasks, ROWS);
  const missing = all.filter((m) => !d.tasks[pairOf(m)]);

  return (
    <div style={{ color: color.text, paddingBottom: sp(50) }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: sp(100), minHeight: '48px' }}>
        <div style={{ minWidth: 0, flex: '1 1 0' }}>
          <div style={{ fontSize: '16px', lineHeight: '24px', fontWeight: 600, ...ellipsis }}>
            {stats.devices} {stats.devices === 1 ? 'device needs' : 'devices need'} action
          </div>
          <div style={{ ...muted, ...ellipsis }} role={running ? 'status' : undefined}>
            {running ? (
              progressText
            ) : (
              <>
                {stats.classIDevices > 0 && <><span style={{ color: color.danger, fontWeight: 600 }}>{stats.classIDevices} with a Class I recall</span> · </>}
                <CheckedAt iso={d.result.checkedAt} stale={d.result.stale} />
              </>
            )}
          </div>
        </div>
        <Button appearance="subtle" aria-label={running ? 'Checking…' : 'Refresh'} iconBefore={RefreshIcon} isDisabled={running} onClick={() => d.begin(true)} />
      </div>
      {d.error && <SectionMessage appearance="error">{d.error}</SectionMessage>}

      {all.length === 0 ? (
        <SectionMessage appearance="success" title="No devices need action">None of your {d.devicesCount} devices match an open recall with an exact or likely match.</SectionMessage>
      ) : (
        <>
          <div style={{ minHeight: `${ROWS * ROW_HEIGHT}px`, marginBottom: sp(100) }}>
            {!d.tasksReady ? (
              <div aria-hidden="true" style={{ display: 'grid', gap: sp(100) }}>
                {Array.from({ length: ROWS }, (_, i) => <Skeleton key={i} height={`${ROW_HEIGHT - 8}px`} width="100%" isShimmering />)}
              </div>
            ) : top.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: sp(100), height: `${ROW_HEIGHT}px`, borderTop: `1px solid ${color.border}` }}>
                <CheckCircleIcon label="" color={color.success} />
                <span>Every device already has a task.</span>
              </div>
            ) : (
              <ol aria-label="Most urgent devices without a task" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {top.map((m) => <DeviceRow key={m.deviceId} m={m} />)}
              </ol>
            )}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: sp(100), alignItems: 'center', flexWrap: 'nowrap' }}>
        {dashboardButton}
        {d.tasksReady && missing.length > 0 && (
          <Button isDisabled={running} onClick={() => openCreateAll(d.load)}>{`Create all ${missing.length} tasks…`}</Button>
        )}
      </div>
    </div>
  );
}
