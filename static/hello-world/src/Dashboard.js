import React, { useState } from 'react';
import DropdownMenu, { DropdownItemGroup, DropdownItem } from '@atlaskit/dropdown-menu';
import Badge from '@atlaskit/badge';
import DeleteIcon from '@atlaskit/icon/core/delete';
import MoreIcon from '@atlaskit/icon/core/show-more-horizontal';
import Tabs, { Tab, TabList, TabPanel } from '@atlaskit/tabs';
import Button from '@atlaskit/button/new';
import Spinner from '@atlaskit/spinner';
import Skeleton from '@atlaskit/skeleton';
import SectionMessage, { SectionMessageAction } from '@atlaskit/section-message';
import Heading from '@atlaskit/heading';
import { token } from '@atlaskit/tokens';
import { FlagGroup, AutoDismissFlag } from '@atlaskit/flag';
import SuccessIcon from '@atlaskit/icon/core/success';
import WarningIcon from '@atlaskit/icon/core/warning';
import RefreshIcon from '@atlaskit/icon/core/refresh';
import PageIcon from '@atlaskit/icon/core/page';
import UploadIcon from '@atlaskit/icon/core/upload';
import DynamicTable from '@atlaskit/dynamic-table';
import VisuallyHidden from '@atlaskit/visually-hidden';
import useRecallData from './data/useRecallData';
import { pairOf } from './data/tasks';
import { sp, color, card, muted, useNarrow, Progress, formatWhen, ClassLozenge, niceFirm, sentenceCase, formatDay } from './ui/kit';
import { affectedMatches, heroStats, urgentMatches, taskProgress, screenFor } from './dashboardData.mjs';
import { Hero, UrgentList, SummaryCards } from './dash/Hero';
import DevicesTable from './dash/DevicesTable';
import DeviceDrawer from './dash/DeviceDrawer';
import WardTeamsTab from './dash/WardTeamsTab';
import FirstRun from './dash/FirstRun';
import { ImportModal, ConfluenceModal, CreateAllModal } from './dash/Modals';

// Reserved heights so nothing jumps when the data arrives.
function LoadingScreen({ quiet }) {
  return (
    <div role={quiet ? undefined : 'status'} aria-live="polite" aria-busy="true">
      {!quiet && <VisuallyHidden>Loading your devices and recalls…</VisuallyHidden>}
      <div style={{ display: 'grid', gap: sp(200) }} aria-hidden="true">
        <Skeleton height="72px" width="100%" isShimmering />
        <Skeleton height="96px" width="100%" isShimmering />
        <Skeleton height="400px" width="100%" isShimmering />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: sp(200) }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} height="132px" width="100%" isShimmering />)}
        </div>
        <Skeleton height="360px" width="100%" isShimmering />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const d = useRecallData({ withProjects: true });
  const [tab, setTab] = useState(0);
  const [drawerDevice, setDrawerDevice] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [confluenceOpen, setConfluenceOpen] = useState(false);
  const narrow = useNarrow();
  const [createAllOpen, setCreateAllOpen] = useState(false);

  const screen = screenFor({ devicesCount: d.devicesCount, result: d.result, error: d.devicesCount === null ? d.error : '', loading: false });
  const running = d.progress !== null;
  const teams = Object.fromEntries(d.wardInfo.mappings.map((m) => [m.ward, m.teamName]));
  const canCreate = Boolean(d.projectKey);

  const page = (children) => (
    <main style={{ maxWidth: '1200px', margin: '0 auto', padding: `${sp(300)} 0`, color: color.text }}>
      {children}
      <ImportModal isOpen={importOpen} onClose={() => setImportOpen(false)} onImported={d.afterDevicesChanged} />
      <ImportModal mode="remove" isOpen={removeOpen} onClose={() => setRemoveOpen(false)} onImported={d.afterDevicesChanged} />
    </main>
  );

  if (screen === 'error') {
    return page(
      <SectionMessage appearance="error" title="Something went wrong" actions={<SectionMessageAction onClick={d.load}>Try again</SectionMessageAction>}>
        {d.error}
      </SectionMessage>,
    );
  }
  if (screen === 'loading') return page(<LoadingScreen />);
  if (screen === 'first-run') return page(<FirstRun onLoadDemo={d.loadDemo} onImport={() => setImportOpen(true)} error={d.error} />);

  const ready = screen === 'ready';
  // While a check runs, its progress takes the place of the "last checked" sentence, so nothing below moves.
  const header = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(150), alignItems: 'center', justifyContent: 'space-between', marginBottom: sp(200), minHeight: '32px' }}>
      <div style={{ ...muted, fontSize: '14px' }}>
        {running ? (
          <Progress done={d.progress.done} total={d.progress.total} label="Checking FDA recalls" />
        ) : (
          <>
            FDA device recalls matched to your hospital's devices.
            {d.result && <> Last checked {formatWhen(d.result.checkedAt)}{d.result.stale ? ' (older than 6 hours)' : ''}.</>}
          </>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(100) }}>
        <Button iconBefore={RefreshIcon} onClick={() => d.begin(true)} isDisabled={!ready || running}>{running ? 'Checking…' : 'Refresh'}</Button>
        <DropdownMenu shouldRenderToParent placement="bottom-end" trigger={({ triggerRef, ...props }) => (<Button {...props} ref={triggerRef} iconBefore={MoreIcon} aria-label="More actions" />)}>
          <DropdownItemGroup>
            <DropdownItem elemBefore={<UploadIcon label="" />} onClick={() => setImportOpen(true)}>Import devices</DropdownItem>
            <DropdownItem elemBefore={<PageIcon label="" />} isDisabled={!ready} onClick={() => setConfluenceOpen(true)}>Create Confluence pages</DropdownItem>
            <DropdownItem elemBefore={<DeleteIcon label="" />} onClick={() => setRemoveOpen(true)}>Remove devices…</DropdownItem>
          </DropdownItemGroup>
        </DropdownMenu>
      </div>
    </div>
  );
  const messages = (
    <div style={{ display: 'grid', gap: sp(150), marginBottom: d.error || (d.result && d.result.failedQueries > 0) ? sp(200) : 0 }}>
      {d.error && <SectionMessage appearance="error" title="Something went wrong">{d.error}</SectionMessage>}
      {d.result && d.result.failedQueries > 0 && <SectionMessage appearance="warning" title="Result may be incomplete">{d.result.failedQueries} FDA lookups failed or timed out. Try Refresh.</SectionMessage>}
    </div>
  );

  if (screen === 'no-check') {
    return page(
      <>
        {header}
        {messages}
        {running && <LoadingScreen quiet />}
        {!running && (
          <div style={{ ...card, padding: sp(400), textAlign: 'center' }}>
            <Heading size="large">{d.devicesCount} devices, not checked yet</Heading>
            <p style={muted}>Compare them with the last year of FDA device recalls.</p>
            <Button appearance="primary" onClick={() => d.begin(false)}>Check devices for recalls</Button>
          </div>
        )}
      </>,
    );
  }

  const all = affectedMatches(d.result);
  const stats = heroStats(d.result);
  const urgent = urgentMatches(d.result, d.tasks, 5);
  const progressTasks = taskProgress(d.summary);
  const createOne = (m, assign = false) => d.createTasks([m], assign);
  const missing = all.filter((m) => !d.tasks[pairOf(m)]);
  const suggestedCount = missing.filter((m) => d.suggestions[pairOf(m)]).length;
  const projectName = (d.projects.find((p) => p.key === d.projectKey) || {}).name || d.projectKey;
  const createAll = async (assign) => {
    await d.createTasks(missing, assign);
    setCreateAllOpen(false);
  };

  // Two lines at most, with the full text on hover: some FDA product names are 300 characters long.
  const clamp = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };
  const recentRows = (d.recent.recalls || []).slice(0, 10).map((r) => ({
    key: r.recallNumber,
    cells: [
      { key: 'n', content: <span style={{ whiteSpace: 'nowrap' }}>{r.recallNumber}</span> },
      { key: 'c', content: <ClassLozenge recallClass={r.recallClass} /> },
      { key: 'f', content: niceFirm(r.firm) || 'Unknown firm' },
      { key: 'p', content: <span style={clamp} title={r.product}>{sentenceCase(r.product)}</span> },
      { key: 'd', content: <span style={{ whiteSpace: 'nowrap' }}>{r.date ? formatDay(r.date) : '–'}</span> },
    ],
  }));

  return page(
    <>
      {header}
      {messages}
      <Tabs id="rr-tabs" selected={tab} onChange={setTab}>
        <TabList>
          <Tab>Overview</Tab>
          <Tab>{d.wardLoaded ? (<span style={{ display: 'inline-flex', alignItems: 'center', gap: sp(75) }}>Ward teams <Badge>{`${d.wardInfo.mappings.length}/${d.wardInfo.wards.length}`}</Badge></span>) : 'Ward teams'}</Tab>
        </TabList>
        <TabPanel>
          <div style={{ display: 'grid', gap: sp(300), paddingTop: sp(300) }}>
            <Hero stats={stats} />
            <UrgentList matches={urgent} canCreate={canCreate} busy={d.creating.active} onCreate={createOne} onOpen={setDrawerDevice} projects={d.projects} projectKey={d.projectKey} onProject={d.setProjectKey} hasAll={all.length > 0} onCreateAll={() => setCreateAllOpen(true)} pendingCount={missing.length} deviceCount={new Set(missing.map((m) => m.deviceId)).size} loading={!d.tasksReady} />
            <SummaryCards devicesCount={d.devicesCount} stats={stats} result={d.result} summary={d.summary} summaryState={d.summaryState} progressTasks={progressTasks} />
            <section style={card} aria-labelledby="rr-affected-h">
              <div style={{ margin: `0 0 ${sp(150)}` }}><Heading size="medium" as="h2" id="rr-affected-h">Affected devices</Heading></div>
              <DevicesTable matches={all} tasks={d.tasks} teams={teams} onOpen={setDrawerDevice} tasksReady={d.tasksReady} />
            </section>
            <section style={card} aria-labelledby="rr-recent-h">
              <div style={{ margin: `0 0 calc(-1 * ${sp(200)})` }}><Heading size="medium" as="h2" id="rr-recent-h">Recent FDA device recalls</Heading></div>
              {d.recent.state === 'error' ? (
                <SectionMessage appearance="warning" title="Could not load recent recalls">The public FDA service did not answer. Try again later.</SectionMessage>
              ) : narrow ? (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(100) }} aria-label="Recent FDA device recalls">
                  {(d.recent.recalls || []).slice(0, 6).map((r) => (
                    <li key={r.recallNumber} style={{ borderTop: `1px solid ${color.border}`, paddingTop: sp(100) }}>
                      <strong>{r.recallNumber}</strong> <span style={muted}>{r.recallClass ? `Class ${r.recallClass}` : ''} · {r.date ? formatDay(r.date) : ''}</span>
                      <div style={muted}>{niceFirm(r.firm) || 'Unknown firm'}</div>
                      <div>{sentenceCase(r.product)}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <DynamicTable caption={<VisuallyHidden>The newest FDA device recalls</VisuallyHidden>} label="Recent FDA device recalls" isLoading={d.recent.state === 'loading'} head={{ cells: [{ key: 'n', content: 'Recall', width: 14 }, { key: 'c', content: 'Class', width: 10 }, { key: 'f', content: 'Firm', width: 22 }, { key: 'p', content: 'Product', width: 44 }, { key: 'd', content: 'Date', width: 10 }] }} rows={recentRows} rowsPerPage={10} isFixedSize />
              )}
            </section>
          </div>
        </TabPanel>
        <TabPanel>
          <WardTeamsTab wardInfo={d.wardInfo} onChanged={d.loadWardInfo} result={d.result} />
        </TabPanel>
      </Tabs>
      <DeviceDrawer deviceId={drawerDevice} result={d.result} tasks={d.tasks} suggestions={d.suggestions} teams={teams} canCreate={canCreate} busy={d.creating.active} onCreate={createOne} onCreateMany={(ms) => d.createTasks(ms, false)} onClose={() => setDrawerDevice(null)} />
      <CreateAllModal isOpen={createAllOpen} onClose={() => setCreateAllOpen(false)} count={missing.length} deviceCount={new Set(missing.map((m) => m.deviceId)).size} suggestedCount={suggestedCount} projectName={projectName} onConfirm={createAll} running={d.creating.active} />
      <FlagGroup onDismissed={() => d.setNote(null)}>
        {d.note ? (
          <AutoDismissFlag
            key={d.note.text}
            id="rr-note"
            appearance={d.note.kind === 'success' ? 'success' : 'warning'}
            icon={d.note.kind === 'success' ? <SuccessIcon label="Success" color={token('color.icon.success')} /> : <WarningIcon label="Warning" color={token('color.icon.warning')} />}
            title={d.note.title}
            description={d.note.text}
          />
        ) : null}
      </FlagGroup>
      <ConfluenceModal isOpen={confluenceOpen} onClose={() => setConfluenceOpen(false)} result={d.result} />
    </>,
  );
}
