import React, { useState } from 'react';
import Heading from '@atlaskit/heading';
import Button from '@atlaskit/button/new';
import Badge from '@atlaskit/badge';
import { sp, cap, color, card, muted, noBreak, ClassLozenge, TaskStatusLozenge, NameLink, LinkLike, ago } from '../ui/kit';
import { pairOf } from '../data/tasks';
import { openIssue } from './DevicesTable';

const ROWS_SHOWN = 5;

// "New since yesterday": the devices a recall started to affect in the last 24 hours, newest first. It is the first thing under
// the headline because it is the part that changed. A device that already has a task (the daily alert made it, or somebody
// did) shows the task and its status; one without says so, and the "Do this first" list below has the button for it.
export default function NewSince({ items, tasks, taskInfo, onOpen, alertsOn }) {
  const [all, setAll] = useState(false);
  if (!items || items.length === 0) return null;
  const shown = all ? items : items.slice(0, ROWS_SHOWN);
  return (
    <section aria-labelledby="rr-new-h" style={{ ...card, borderLeft: `4px solid ${color.borderBrand}` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: sp(100), margin: `0 0 ${sp(50)}` }}>
        <Heading size="medium" as="h2" id="rr-new-h">New since yesterday</Heading>
        <Badge appearance="primary">{items.length}</Badge>
      </div>
      <div style={muted}>
        {items.length === 1 ? 'A recall started to affect this device' : 'Recalls started to affect these devices'} in the last 24 hours.
        {alertsOn ? ' The daily alert creates their tasks.' : ''}
      </div>
      <ul aria-label="New since yesterday" style={{ listStyle: 'none', margin: `${sp(100)} 0 0`, padding: 0 }}>
        {shown.map(({ match: m, firstSeen }, i) => {
          const key = tasks[pairOf(m)];
          return (
            <li key={pairOf(m)} style={{ display: 'flex', flexWrap: 'wrap', gap: `${sp(50)} ${sp(200)}`, alignItems: 'center', justifyContent: 'space-between', padding: `${sp(100)} 0`, borderTop: i ? `1px solid ${color.border}` : 'none' }}>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <NameLink label={`Details for ${cap(m.deviceName)}, recall ${m.recallNumber}`} onClick={() => onOpen(m.deviceId)}>{cap(m.deviceName)}</NameLink>
                <div style={muted}>{m.ward || 'No ward'} · <span style={noBreak}>{m.recallNumber}</span> · found {ago(firstSeen)}</div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: sp(100) }}>
                <ClassLozenge recallClass={m.recallClass} />
                {key ? (
                  <>
                    <LinkLike onClick={() => openIssue(key)}>{key}</LinkLike>
                    <TaskStatusLozenge info={taskInfo[pairOf(m)]} />
                  </>
                ) : (
                  <span style={muted}>No task yet</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {items.length > ROWS_SHOWN && (
        <div style={{ marginTop: sp(100) }}>
          <Button aria-expanded={all} onClick={() => setAll(!all)}>{all ? `Show only the first ${ROWS_SHOWN}` : `Show all ${items.length}`}</Button>
        </div>
      )}
    </section>
  );
}
