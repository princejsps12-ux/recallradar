import React, { useMemo, useState } from 'react';
import { DynamicTableStateless } from '@atlaskit/dynamic-table';
import Select from '@atlaskit/select';
import Button from '@atlaskit/button/new';
import VisuallyHidden from '@atlaskit/visually-hidden';
import EmptyState from '@atlaskit/empty-state';
import Skeleton from '@atlaskit/skeleton';
import { router } from '@forge/bridge';
import { sp, cap, color, muted, noBreak, ClassLozenge, MatchLozenge, TaskStatusLozenge, useNarrow, NameLink, LinkLike } from '../ui/kit';
import Pager from '../ui/Pager';
import { CLASSES, UNKNOWN_CLASS, filterMatches, wardsOf, urgencyRank } from '../dashboardData.mjs';
import { PAGE_SIZE, sortRows, pageCount, clampPage, pageOf, rangeOf } from '../tablePaging.mjs';
import { pairOf } from '../data/tasks';

export const openIssue = (key) => router.open(`/browse/${key}`);

const classOptions = [{ label: 'All classes', value: '' }, ...[...CLASSES, UNKNOWN_CLASS].map((c) => ({ label: c === UNKNOWN_CLASS ? 'Unknown class' : `Class ${c}`, value: c }))];

// What each sortable column sorts by. The same values go into the cells' `key`, which is what the table's own
// header uses to show the arrow and to sort the one page it is given (a no-op: the page is already in this order).
const SORT_VALUE = {
  device: (m) => m.deviceName.toLowerCase(),
  ward: (m) => (m.ward || '').toLowerCase(),
  recall: (m) => m.recallNumber,
  class: (m) => urgencyRank({ ...m, confidence: 'exact' }),
  match: (m) => m.confidence,
  task: (m, tasks) => tasks[pairOf(m)] || '~', // "~" sorts after any task key, so devices without a task come last
};

const detailsLabel = (m) => `Details for ${cap(m.deviceName)}, recall ${m.recallNumber}`;

// The sentence under the filters. It is also a live region, so a screen reader hears "Showing 11-20 of 24" when the
// page changes.
function summaryText({ from, to, shown, all, pages }) {
  if (pages > 1) return `Showing ${from}–${to} of ${shown} device and recall matches${shown < all ? ` (${all} in all)` : ''}`;
  return `Showing ${shown} of ${all} device and recall matches`;
}

// The affected devices: filter by ward and class, sort by any column, ten per page, and open the side drawer from the
// device name (one way in per row; the whole row is clickable for mouse users as well).
export default function DevicesTable({ matches, tasks, taskInfo = {}, teams, onOpen, tasksReady = true }) {
  const [filters, setFilters] = useState({ ward: '', recallClass: '' });
  const [sort, setSort] = useState({ key: 'class', order: 'ASC' });
  const [page, setPage] = useState(1);
  const wardOptions = useMemo(() => [{ label: 'All wards', value: '' }, ...wardsOf(matches).map((w) => ({ label: w, value: w }))], [matches]);
  const narrow = useNarrow();
  const [limit, setLimit] = useState(8);
  const shown = useMemo(() => filterMatches(matches, filters), [matches, filters]);
  const filtered = Boolean(filters.ward || filters.recallClass);
  const ordered = useMemo(() => sortRows(shown, (m) => SORT_VALUE[sort.key](m, tasks), sort.order), [shown, sort, tasks]);

  // A new filter or a new sort starts again at the top: the row you were reading may no longer be on this page.
  const changeFilters = (next) => {
    setFilters(next);
    setPage(1);
    setLimit(8);
  };
  const clearFilters = () => changeFilters({ ward: '', recallClass: '' });

  const pages = pageCount(ordered.length, PAGE_SIZE);
  const current = clampPage(page, ordered.length, PAGE_SIZE);
  const { from, to } = rangeOf(current, ordered.length, PAGE_SIZE);

  const head = {
    cells: [
      { key: 'device', content: 'Device', isSortable: true, width: 28 },
      { key: 'ward', content: 'Ward', isSortable: true, width: 14 },
      { key: 'recall', content: 'Recall', isSortable: true, width: 18 },
      { key: 'class', content: 'Class', isSortable: true, width: 11 },
      { key: 'match', content: 'Match', isSortable: true, width: 15 },
      { key: 'task', content: 'Task', isSortable: true, width: 14 },
    ],
  };
  const rows = pageOf(ordered, current, PAGE_SIZE).map((m) => {
    const key = tasks[pairOf(m)];
    return {
      key: pairOf(m),
      onClick: () => onOpen(m.deviceId),
      cells: [
        { key: SORT_VALUE.device(m), content: (<div><NameLink label={detailsLabel(m)} onClick={(e) => { e.stopPropagation(); onOpen(m.deviceId); }}>{cap(m.deviceName)}</NameLink><div style={muted}>{m.deviceManufacturer} {m.deviceModel}</div></div>) },
        { key: SORT_VALUE.ward(m), content: (<div>{m.ward || 'No ward'}<div style={muted}>{m.ward && teams[m.ward] ? teams[m.ward] : 'No team yet'}</div></div>) },
        { key: SORT_VALUE.recall(m), content: (<div><span style={noBreak}>{m.recallNumber}</span><div style={muted}>{m.firm}</div></div>) },
        { key: SORT_VALUE.class(m), content: <ClassLozenge recallClass={m.recallClass} /> },
        { key: SORT_VALUE.match(m), content: <MatchLozenge confidence={m.confidence} /> },
        { key: SORT_VALUE.task(m, tasks), content: !tasksReady ? (<Skeleton height="20px" width="64px" isShimmering />) : key ? (<div><LinkLike onClick={(e) => { e.stopPropagation(); openIssue(key); }}>{key}</LinkLike><div style={{ marginTop: sp(25) }}><TaskStatusLozenge info={taskInfo[pairOf(m)]} /></div></div>) : (<span style={muted}>No task</span>) },
      ],
    };
  });

  return (
    <section aria-labelledby="rr-affected">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(200), alignItems: 'flex-end', marginBottom: sp(150) }}>
        <div style={{ minWidth: '170px' }}>
          <label style={muted} htmlFor="rr-ward-filter">Ward</label>
          <Select inputId="rr-ward-filter" aria-label="Filter by ward" spacing="compact" options={wardOptions} value={wardOptions.find((o) => o.value === filters.ward)} onChange={(o) => changeFilters({ ...filters, ward: o.value })} menuPosition="fixed" />
        </div>
        <div style={{ minWidth: '170px' }}>
          <label style={muted} htmlFor="rr-class-filter">Class</label>
          <Select inputId="rr-class-filter" aria-label="Filter by recall class" spacing="compact" options={classOptions} value={classOptions.find((o) => o.value === filters.recallClass)} onChange={(o) => changeFilters({ ...filters, recallClass: o.value })} menuPosition="fixed" />
        </div>
        {filtered && shown.length > 0 && (<Button appearance="subtle" onClick={clearFilters}>Clear filters</Button>)}
        <span style={muted} role="status" aria-live="polite">{summaryText({ from, to, shown: shown.length, all: matches.length, pages })}</span>
      </div>
      {narrow ? (
        <div>
          {shown.length === 0 ? (
            <EmptyState headingLevel={3} header="No devices match these filters" description="Try another ward or class, or clear the filters." />
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(150) }} aria-label="Affected devices">
              {ordered.slice(0, limit).map((m) => {
                const key = tasks[pairOf(m)];
                return (
                  <li key={pairOf(m)} style={{ border: `1px solid ${color.border}`, borderRadius: '8px', padding: sp(150), background: color.raised }}>
                    <NameLink label={detailsLabel(m)} onClick={() => onOpen(m.deviceId)}>{cap(m.deviceName)}</NameLink>
                    <div style={muted}>{m.deviceManufacturer} {m.deviceModel}</div>
                    <div style={muted}>{m.ward || 'No ward'} · {m.ward && teams[m.ward] ? teams[m.ward] : 'No team yet'} · <span style={noBreak}>{m.recallNumber}</span></div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(100), marginTop: sp(100), alignItems: 'center' }}>
                      <ClassLozenge recallClass={m.recallClass} />
                      <MatchLozenge confidence={m.confidence} />
                      {key ? (<><LinkLike onClick={() => openIssue(key)}>{key}</LinkLike><TaskStatusLozenge info={taskInfo[pairOf(m)]} /></>) : (<span style={muted}>No task</span>)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {shown.length > limit && (
            <div style={{ marginTop: sp(150) }}>
              <Button onClick={() => setLimit(limit + 8)}>Show more ({shown.length - limit} left)</Button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: `calc(-1 * ${sp(300)})` }}>
          <DynamicTableStateless
            caption={<VisuallyHidden id="rr-affected">Devices affected by an open FDA recall</VisuallyHidden>}
            head={head}
            rows={rows}
            sortKey={sort.key}
            sortOrder={sort.order}
            onSort={({ key, sortOrder }) => {
              setSort({ key, order: sortOrder });
              setPage(1);
            }}
            isFixedSize
            emptyView={<EmptyState headingLevel={3} header="No devices match these filters" description="Try another ward or class, or clear the filters." primaryAction={<Button onClick={clearFilters}>Clear filters</Button>} />}
            label="Affected devices"
          />
          {pages > 1 && <Pager label="Pages of affected devices" page={current} pages={pages} onChange={setPage} />}
        </div>
      )}
    </section>
  );
}

export { color };
