import React, { useState } from 'react';
import { view } from '@forge/bridge';
import Button from '@atlaskit/button/new';
import Heading from '@atlaskit/heading';
import Skeleton from '@atlaskit/skeleton';
import VisuallyHidden from '@atlaskit/visually-hidden';
import SectionMessage, { SectionMessageAction } from '@atlaskit/section-message';
import useRecallData from './data/useRecallData';
import { pairOf } from './data/tasks';
import { affectedMatches } from './dashboardData.mjs';
import { CreateAllBody } from './dash/Modals';
import { sp, color } from './ui/kit';

// The pop-up the issue panel opens for "Create all N tasks…" (a Forge Modal showing this same bundle). It is the
// dashboard's confirmation, on its own: the same facts, the same assign checkbox (off), the same batches. The project
// comes from the panel (the issue's project). `view.close({ created })` makes the panel reload its rows.
export default function CreateAllWindow({ projectKey }) {
  const d = useRecallData({ light: true, withSuggestions: true, projectKey });
  const [assign, setAssign] = useState(false);
  const [totals, setTotals] = useState(null);
  const close = (created) => view.close({ created: Boolean(created) }).catch(() => {});

  const frame = (children) => (
    <div style={{ padding: sp(300), color: color.text, boxSizing: 'border-box' }}>{children}</div>
  );

  if (d.devicesCount === null && !d.error) {
    return frame(
      <div role="status" aria-live="polite" aria-busy="true">
        <VisuallyHidden>Loading the tasks to create…</VisuallyHidden>
        <div aria-hidden="true" style={{ display: 'grid', gap: sp(150) }}>
          <Skeleton height="32px" width="50%" isShimmering />
          <Skeleton height="160px" width="100%" isShimmering />
        </div>
      </div>,
    );
  }
  if (d.devicesCount === null || !d.result) {
    return frame(
      <>
        <SectionMessage appearance="error" title="Could not load the recall check" actions={<SectionMessageAction onClick={d.load}>Try again</SectionMessageAction>}>{d.error || 'There is no saved check yet. Run it from the dashboard first.'}</SectionMessage>
        <div style={{ marginTop: sp(200), textAlign: 'right' }}><Button appearance="subtle" onClick={() => close(false)}>Close</Button></div>
      </>,
    );
  }
  if (!d.tasksReady) {
    return frame(
      <div role="status" aria-live="polite" aria-busy="true">
        <VisuallyHidden>Checking which tasks already exist…</VisuallyHidden>
        <div aria-hidden="true" style={{ display: 'grid', gap: sp(150) }}>
          <Skeleton height="32px" width="50%" isShimmering />
          <Skeleton height="160px" width="100%" isShimmering />
        </div>
      </div>,
    );
  }

  const missing = affectedMatches(d.result).filter((m) => !d.tasks[pairOf(m)]);
  const deviceCount = new Set(missing.map((m) => m.deviceId)).size;
  const suggestedCount = missing.filter((m) => d.suggestions[pairOf(m)]).length;
  const running = d.creating.active;

  const create = async () => {
    const result = await d.createTasks(missing, assign);
    setTotals(result);
  };

  if (totals) {
    return frame(
      <>
        <Heading size="medium">{totals.created ? (totals.created === 1 ? 'Task created' : 'Tasks created') : 'Nothing was created'}</Heading>
        <div style={{ marginTop: sp(150) }}>
          {d.note && (
            <SectionMessage appearance={d.note.kind === 'success' ? 'success' : 'warning'}>{d.note.text}</SectionMessage>
          )}
        </div>
        <div style={{ marginTop: sp(200), textAlign: 'right' }}><Button appearance="primary" onClick={() => close(totals.created > 0)}>Close</Button></div>
      </>,
    );
  }

  if (missing.length === 0) {
    return frame(
      <>
        <SectionMessage appearance="success" title="Every device already has a task">There is nothing left to create.</SectionMessage>
        <div style={{ marginTop: sp(200), textAlign: 'right' }}><Button appearance="primary" onClick={() => close(false)}>Close</Button></div>
      </>,
    );
  }

  return frame(
    <>
      <div style={{ marginBottom: sp(200) }}><Heading size="medium">{`Create ${missing.length} task${missing.length === 1 ? '' : 's'}?`}</Heading></div>
      <CreateAllBody count={missing.length} deviceCount={deviceCount} suggestedCount={suggestedCount} projectName={projectKey || 'the project of this issue'} assign={assign} onAssign={setAssign} running={running} progress={d.creating} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: sp(100), marginTop: sp(100) }}>
        <Button appearance="subtle" isDisabled={running} onClick={() => close(false)}>Cancel</Button>
        <Button appearance="primary" isLoading={running} onClick={create}>{`Create ${missing.length}`}</Button>
      </div>
    </>,
  );
}
