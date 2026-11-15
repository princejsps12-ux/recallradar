import React, { useMemo, useState } from 'react';
import DynamicTable from '@atlaskit/dynamic-table';
import Select from '@atlaskit/select';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import VisuallyHidden from '@atlaskit/visually-hidden';
import EmptyState from '@atlaskit/empty-state';
import Skeleton from '@atlaskit/skeleton';
import { router } from '@forge/bridge';
import { sp, cap, color, muted, noBreak, ClassLozenge, MatchLozenge, useNarrow, DetailsButton, LinkLike } from '../ui/kit';
import { CLASSES, UNKNOWN_CLASS, filterMatches, wardsOf, urgencyRank } from '../dashboardData.mjs';
import { pairOf } from '../data/tasks';

export const openIssue = (key) => router.open(`/browse/${key}`);

const classOptions = [{ label: 'All classes', value: '' }, ...[...CLASSES, UNKNOWN_CLASS].map((c) => ({ label: c === UNKNOWN_CLASS ? 'Unknown class' : `Class ${c}`, value: c }))];

// The affected devices: filter by ward and class, sort by any column, click a row (or Details) for the side drawer.
export default function DevicesTable({ matches, tasks, teams, onOpen, tasksReady = true }) {
  const [filters, setFilters] = useState({ ward: '', recallClass: '' });
  const wardOptions = useMemo(() => [{ label: 'All wards', value: '' }, ...wardsOf(matches).map((w) => ({ label: w, value: w }))], [matches]);
  const narrow = useNarrow();
  const [limit, setLimit] = useState(8);
  const shown = filterMatches(matches, filters);
  const filtered = Boolean(filters.ward || filters.recallClass);

  const head = {
    cells: [
      { key: 'device', content: 'Device', isSortable: true, width: 24 },
      { key: 'ward', content: 'Ward', isSortable: true, width: 11 },
      { key: 'recall', content: 'Recall', isSortable: true, width: 15 },
      { key: 'class', content: 'Class', isSortable: true, width: 11 },
      { key: 'match', content: 'Match', isSortable: true, width: 13 },
      { key: 'task', content: 'Task', isSortable: true, width: 11 },
      { key: 'actions', content: <VisuallyHidden>Actions</VisuallyHidden>, width: 15 },
    ],
  };
  const rows = shown.map((m) => {
    const key = tasks[pairOf(m)];
    return {
      key: pairOf(m),
      onClick: () => onOpen(m.deviceId),
      cells: [
        { key: m.deviceName.toLowerCase(), content: (<div><strong>{cap(m.deviceName)}</strong><div style={muted}>{m.deviceManufacturer} {m.deviceModel}</div></div>) },
        { key: (m.ward || '').toLowerCase(), content: (<div>{m.ward || 'No ward'}<div style={muted}>{m.ward && teams[m.ward] ? teams[m.ward] : 'No team yet'}</div></div>) },
        { key: m.recallNumber, content: (<div><span style={noBreak}>{m.recallNumber}</span><div style={muted}>{m.firm}</div></div>) },
        { key: urgencyRank({ ...m, confidence: 'exact' }), content: <ClassLozenge recallClass={m.recallClass} /> },
        { key: m.confidence, content: <MatchLozenge confidence={m.confidence} /> },
        { key: key || '~', content: !tasksReady ? (<Skeleton height="20px" width="64px" isShimmering />) : key ? (<LinkLike onClick={(e) => { e.stopPropagation(); openIssue(key); }}>{key}</LinkLike>) : (<span style={muted}><span aria-hidden="true">–</span><VisuallyHidden>No task</VisuallyHidden></span>) },
        { key: 'a', content: <DetailsButton onClick={(e) => { e.stopPropagation(); onOpen(m.deviceId); }} /> },
      ],
    };
  });

  return (
    <section aria-labelledby="rr-affected">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(200), alignItems: 'flex-end', marginBottom: sp(150) }}>
        <div style={{ minWidth: '170px' }}>
          <label style={muted} htmlFor="rr-ward-filter">Ward</label>
          <Select inputId="rr-ward-filter" aria-label="Filter by ward" spacing="compact" options={wardOptions} value={wardOptions.find((o) => o.value === filters.ward)} onChange={(o) => setFilters({ ...filters, ward: o.value })} menuPosition="fixed" />
        </div>
        <div style={{ minWidth: '170px' }}>
          <label style={muted} htmlFor="rr-class-filter">Class</label>
          <Select inputId="rr-class-filter" aria-label="Filter by recall class" spacing="compact" options={classOptions} value={classOptions.find((o) => o.value === filters.recallClass)} onChange={(o) => setFilters({ ...filters, recallClass: o.value })} menuPosition="fixed" />
        </div>
        {filtered && shown.length > 0 && (<Button appearance="subtle" onClick={() => setFilters({ ward: '', recallClass: '' })}>Clear filters</Button>)}
        <span style={muted} role="status" aria-live="polite">Showing {shown.length} of {matches.length} device and recall matches</span>
      </div>
      {narrow ? (
        <div>
          {shown.length === 0 ? (
            <EmptyState header="No devices match these filters" description="Try another ward or class, or clear the filters." />
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(150) }} aria-label="Affected devices">
              {shown.slice(0, limit).map((m) => {
                const key = tasks[pairOf(m)];
                return (
                  <li key={pairOf(m)} style={{ border: `1px solid ${color.border}`, borderRadius: '8px', padding: sp(150), background: color.raised }}>
                    <strong>{cap(m.deviceName)}</strong>
                    <div style={muted}>{m.deviceManufacturer} {m.deviceModel}</div>
                    <div style={muted}>{m.ward || 'No ward'} · {m.ward && teams[m.ward] ? teams[m.ward] : 'No team yet'} · <span style={noBreak}>{m.recallNumber}</span></div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(100), margin: `${sp(100)} 0`, alignItems: 'center' }}>
                      <ClassLozenge recallClass={m.recallClass} />
                      <MatchLozenge confidence={m.confidence} />
                      {key ? (<LinkLike onClick={() => openIssue(key)}>{key}</LinkLike>) : (<span style={muted}><span aria-hidden="true">–</span><VisuallyHidden>No task</VisuallyHidden></span>)}
                    </div>
                    <DetailsButton onClick={() => onOpen(m.deviceId)} />
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
        <DynamicTable
          caption={<VisuallyHidden id="rr-affected">Devices affected by an open FDA recall</VisuallyHidden>}
          head={head}
          rows={rows}
          rowsPerPage={10}
          defaultSortKey="class"
          defaultSortOrder="ASC"
          isFixedSize
          emptyView={<EmptyState header="No devices match these filters" description="Try another ward or class, or clear the filters." primaryAction={<Button onClick={() => setFilters({ ward: '', recallClass: '' })}>Clear filters</Button>} />}
          label="Affected devices"
        />
        </div>
      )}
    </section>
  );
}

export { color };
