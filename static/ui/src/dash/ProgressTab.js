import React, { useState } from 'react';
import Heading from '@atlaskit/heading';
import Button from '@atlaskit/button/new';
import Skeleton from '@atlaskit/skeleton';
import SectionMessage from '@atlaskit/section-message';
import VisuallyHidden from '@atlaskit/visually-hidden';
import CheckCircleIcon from '@atlaskit/icon/core/check-circle';
import { token } from '@atlaskit/tokens';
import { sp, cap, color, card, muted, noBreak, ClassLozenge } from '../ui/kit';
import { progressParts, progressText } from '../dashboardData.mjs';

// The colour of each part of a bar. Every part is also named in words next to the bar, so colour is never the only cue.
const FILL = {
  done: token('color.background.success.bold'),
  inProgress: token('color.background.information.bold'),
  open: color.borderBold, // a mid grey: clearly "started on paper", clearly not green or blue, and not the dark of a finished bar
  noTask: color.track,
};

// A bar made of the four parts. role="img" with the numbers as its label, because the segments carry no text.
function Bar({ group, height = '8px' }) {
  const parts = progressParts(group);
  const label = group.pairs ? `${progressText(group)} of ${group.pairs}` : 'Nothing to do';
  return (
    <div role="img" aria-label={label} style={{ display: 'flex', height, borderRadius: '4px', overflow: 'hidden', background: color.track }}>
      {parts.filter((part) => part.count > 0).map((part) => (
        <div key={part.key} style={{ width: `${part.share}%`, background: FILL[part.key] }} />
      ))}
    </div>
  );
}

// The legend names every part with its count, so the bar can be read without colour.
function Legend({ group }) {
  return (
    <ul aria-label="Legend" style={{ listStyle: 'none', margin: `${sp(100)} 0 0`, padding: 0, display: 'flex', flexWrap: 'wrap', gap: `${sp(50)} ${sp(250)}` }}>
      {progressParts(group).map((part) => (
        <li key={part.key} style={{ display: 'inline-flex', alignItems: 'center', gap: sp(75) }}>
          <span aria-hidden="true" style={{ width: '12px', height: '12px', borderRadius: '2px', background: FILL[part.key], border: `1px solid ${color.border}`, flex: '0 0 auto' }} />
          <span><strong>{part.count}</strong> {part.label}</span>
        </li>
      ))}
    </ul>
  );
}

// One row of a list: a title, what it is about, the bar and the counts in words.
function Row({ title, extra, subtitle, group, first }) {
  return (
    <li style={{ padding: `${sp(150)} 0`, borderTop: first ? 'none' : `1px solid ${color.border}` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: `${sp(50)} ${sp(150)}`, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: sp(100), minWidth: 0 }}>
          {title}
          {extra}
        </div>
        <strong style={noBreak}>{group.resolvedPercent}% resolved</strong>
      </div>
      {subtitle && <div title={subtitle} style={{ ...muted, marginTop: sp(25), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>}
      <div style={{ margin: `${sp(100)} 0 ${sp(50)}` }}><Bar group={group} height="6px" /></div>
      <div style={muted}>
        {progressText(group) || 'Nothing to do'} · {group.pairs} {group.pairs === 1 ? 'task' : 'tasks'} needed for {group.devices} {group.devices === 1 ? 'device' : 'devices'}
      </div>
    </li>
  );
}

function Loading() {
  return (
    <div aria-hidden="true" style={{ display: 'grid', gap: sp(300), paddingTop: sp(300) }}>
      <section style={card}>
        <Skeleton height="32px" width="220px" isShimmering />
        <div style={{ height: sp(150) }} />
        <Skeleton height="12px" width="100%" isShimmering />
      </section>
      {[0, 1].map((i) => (
        <section key={i} style={card}>
          <Skeleton height="24px" width="160px" isShimmering />
          <div style={{ height: sp(150) }} />
          {[0, 1, 2].map((j) => <div key={j} style={{ padding: `${sp(100)} 0` }}><Skeleton height="40px" width="100%" isShimmering /></div>)}
        </section>
      ))}
    </div>
  );
}

// Long lists show the first rows and a button for the rest. The rows are already in the order that matters (see progress.js).
const ROWS_SHOWN = 8;
function RowList({ label, noun, items, render }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, ROWS_SHOWN);
  return (
    <>
      <ul aria-label={label} style={{ listStyle: 'none', margin: `${sp(100)} 0 0`, padding: 0 }}>{shown.map(render)}</ul>
      {items.length > ROWS_SHOWN && (
        <div style={{ marginTop: sp(100) }}>
          <Button aria-expanded={all} onClick={() => setAll(!all)}>{all ? `Show only the first ${ROWS_SHOWN}` : `Show all ${items.length} ${noun}`}</Button>
        </div>
      )}
    </>
  );
}

// How far along the work is: the overall share resolved, then each open recall and each ward with its own bar. "Resolved" means
// the task is in a done status in Jira; a device with no task yet counts as not resolved and is shown as such.
export default function ProgressTab({ progress, hasResult = true, teams = {}, onRetry }) {
  const { state, data } = progress;
  if (!hasResult) {
    return <section style={{ ...card, marginTop: sp(300) }}><span style={muted}>Progress appears after the first check: it shows how many of the tasks are done.</span></section>;
  }
  if (!data && state === 'error') {
    return (
      <div style={{ paddingTop: sp(300) }}>
        <SectionMessage appearance="error" title="Could not read the status of the tasks" actions={<Button onClick={onRetry}>Try again</Button>}>
          Jira did not answer. Your tasks and recalls are not affected.
        </SectionMessage>
      </div>
    );
  }
  if (!data) return <Loading />;
  const { overall, byRecall, byWard } = data;
  if (overall.pairs === 0) {
    return (
      <section style={{ ...card, marginTop: sp(300), display: 'flex', alignItems: 'center', gap: sp(100) }}>
        <CheckCircleIcon label="" color={color.success} />
        <span>No device needs a task right now, so there is no progress to show.</span>
      </section>
    );
  }
  return (
    // minmax(0, 1fr): a grid column is as wide as its widest content unless told it may shrink, and a one-line row of text
    // would then push the whole page wider than a phone.
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: sp(300), paddingTop: sp(300), width: '100%' }}>
      {state === 'error' && <SectionMessage appearance="warning" title="Showing the last numbers" actions={<Button onClick={onRetry}>Try again</Button>}>Jira did not answer this time.</SectionMessage>}
      <section aria-labelledby="rr-progress-h" style={{ ...card, borderLeft: `4px solid ${overall.resolvedPercent === 100 ? color.borderSuccess : color.borderBrand}` }}>
        <div style={{ display: 'flex', gap: sp(300), alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '56px', fontWeight: 700, lineHeight: 1, color: color.text, flex: '0 0 auto' }} aria-hidden="true">{overall.resolvedPercent}%</div>
          <div style={{ minWidth: 0 }}>
            {/* The big number is decoration for the eye; the heading carries it for a screen reader. */}
            <Heading size="large" as="h2" id="rr-progress-h"><VisuallyHidden>{`${overall.resolvedPercent}% `}</VisuallyHidden>resolved</Heading>
            <div style={{ marginTop: sp(50) }}>
              {overall.done} of {overall.pairs} {overall.pairs === 1 ? 'task' : 'tasks'} done, for {overall.devices} {overall.devices === 1 ? 'device' : 'devices'}.
              {overall.noTask > 0 && <> <strong>{overall.noTask}</strong> {overall.noTask === 1 ? 'has' : 'have'} no task yet.</>}
            </div>
          </div>
        </div>
        <div style={{ marginTop: sp(200) }}><Bar group={overall} height="12px" /></div>
        <Legend group={overall} />
      </section>
      <section aria-labelledby="rr-progress-recalls" style={card}>
        <div style={{ margin: `0 0 ${sp(50)}` }}><Heading size="medium" as="h2" id="rr-progress-recalls">By recall</Heading></div>
        <div style={muted}>Class I first, then the recalls with the least done.</div>
        <RowList
          label="Progress by recall"
          noun="recalls"
          items={byRecall}
          render={(r, i) => (
            <Row
              key={r.recallNumber}
              first={i === 0}
              title={<><strong style={noBreak}>{r.recallNumber}</strong><ClassLozenge recallClass={r.recallClass} /></>}
              subtitle={`${r.firm}${r.product ? `: ${r.product}` : ''}`}
              group={r}
            />
          )}
        />
      </section>
      <section aria-labelledby="rr-progress-wards" style={card}>
        <div style={{ margin: `0 0 ${sp(50)}` }}><Heading size="medium" as="h2" id="rr-progress-wards">By ward</Heading></div>
        <div style={muted}>The wards with the least done first.</div>
        <RowList
          label="Progress by ward"
          noun="wards"
          items={byWard}
          render={(w, i) => <Row key={w.ward} first={i === 0} title={<strong>{cap(w.ward)}</strong>} subtitle={teams[w.ward] ? `Team: ${teams[w.ward]}` : 'No team yet'} group={w} />}
        />
      </section>
    </div>
  );
}
