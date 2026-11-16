import React, { useState } from 'react';
import DropdownMenu, { DropdownItemGroup, DropdownItem } from '@atlaskit/dropdown-menu';
import Badge from '@atlaskit/badge';
import DeleteIcon from '@atlaskit/icon/core/delete';
import MoreIcon from '@atlaskit/icon/core/show-more-horizontal';
import Tabs, { Tab, TabList, TabPanel } from '@atlaskit/tabs';
import Button from '@atlaskit/button/new';
import Skeleton from '@atlaskit/skeleton';
import SectionMessage from '@atlaskit/section-message';
import Heading from '@atlaskit/heading';
import { token } from '@atlaskit/tokens';
import { FlagGroup, AutoDismissFlag } from '@atlaskit/flag';
import SuccessIcon from '@atlaskit/icon/core/success';
import WarningIcon from '@atlaskit/icon/core/warning';
import RefreshIcon from '@atlaskit/icon/core/refresh';
import PageIcon from '@atlaskit/icon/core/page';
import UploadIcon from '@atlaskit/icon/core/upload';
import VisuallyHidden from '@atlaskit/visually-hidden';
import useRecallData from './data/useRecallData';
import { pairOf } from './data/tasks';
import { sp, color, card, muted, Progress, CheckedAt } from './ui/kit';
import { affectedMatches, heroStats, urgentMatches, taskProgress, screenFor } from './dashboardData.mjs';
import { Hero, UrgentList } from './dash/Hero';
import DevicesTable from './dash/DevicesTable';
import RecentRecalls from './dash/RecentRecalls';
import DeviceDrawer from './dash/DeviceDrawer';
import WardTeamsTab from './dash/WardTeamsTab';
import FirstRun from './dash/FirstRun';
import { ImportModal, ConfluenceModal, CreateAllModal } from './dash/Modals';

// The loading screen has the shape of the page it stands in for (the big number and its line, the "Do this first" rows with
// their two labels and a button, the table), so it reads as "the dashboard is coming" and nothing jumps when the data arrives.
function LoadingScreen({ quiet }) {
  const row = { display: 'flex', alignItems: 'center', gap: sp(150), padding: `${sp(150)} 0` };
  return (
    <div role={quiet ? undefined : 'status'} aria-live="polite" aria-busy="true">
      {!quiet && <div style={{ ...muted, marginBottom: sp(150) }}>Loading your devices and recalls…</div>}
      <div style={{ display: 'grid', gap: sp(200) }} aria-hidden="true">
        <section style={card}>
          <div style={{ display: 'grid', gap: sp(100) }}>
            <Skeleton height="40px" width="240px" isShimmering />
            <Skeleton height="16px" width="320px" isShimmering />
            <Skeleton height="20px" width="60%" isShimmering />
          </div>
        </section>
        <section style={card}>
          <Skeleton height="24px" width="160px" isShimmering />
          <div style={{ height: sp(150) }} />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={row}>
              <div style={{ flex: 1, display: 'grid', gap: sp(50) }}>
                <Skeleton height="18px" width="45%" isShimmering />
                <Skeleton height="14px" width="65%" isShimmering />
              </div>
              <Skeleton height="24px" width="64px" isShimmering />
              <Skeleton height="24px" width="96px" isShimmering />
              <Skeleton height="32px" width="96px" isShimmering />
            </div>
          ))}
        </section>
        <section style={card}>
          <Skeleton height="24px" width="180px" isShimmering />
          <div style={{ height: sp(150) }} />
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} style={{ padding: `${sp(100)} 0` }}><Skeleton height="20px" width="100%" isShimmering /></div>)}
        </section>
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
  const [createAllOpen, setCreateAllOpen] = useState(false);

  const screen = screenFor({ devicesCount: d.devicesCount, result: d.result, error: d.devicesCount === null ? d.error : '', loading: false });
  const running = d.progress !== null;
  const teams = Object.fromEntries(d.wardInfo.mappings.map((m) => [m.ward, m.teamName]));
  const canCreate = Boolean(d.projectKey);

  const page = (children) => (
    <main style={{ maxWidth: '1200px', margin: '0 auto', padding: `${sp(300)} 0`, color: color.text }}>
      {children}
      <ImportModal isOpen={importOpen} onClose={() => setImportOpen(false)} onImported={d.afterDevicesChanged} />
      <ImportModal mode="remove" isOpen={removeOpen} onClose={() => setRemoveOpen(false)} onImported={d.afterDevicesChanged} importedCount={d.importedCount} total={d.devicesCount || 0} />
    </main>
  );

  if (screen === 'error') {
    return page(
      <>
        <SectionMessage appearance="error" title="Something went wrong">{d.error}</SectionMessage>
        <div style={{ marginTop: sp(150) }}><Button onClick={d.load}>Try again</Button></div>
      </>,
    );
  }
  if (screen === 'loading') return page(<LoadingScreen />);
  if (screen === 'first-run') return page(<FirstRun onLoadDemo={d.loadDemo} onImport={() => setImportOpen(true)} error={d.error} canManage={d.canManage} />);

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
            {d.result && <> <CheckedAt prefix="Last checked" iso={d.result.checkedAt} stale={d.result.stale} />.</>}
          </>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(100) }}>
        <Button iconBefore={RefreshIcon} onClick={() => d.begin(true)} isDisabled={!ready || running}>{running ? 'Checking…' : 'Refresh'}</Button>
        <DropdownMenu shouldRenderToParent placement="bottom-end" trigger={({ triggerRef, ...props }) => (<Button {...props} ref={triggerRef} iconBefore={MoreIcon} aria-label="More actions" />)}>
          <DropdownItemGroup>
            <DropdownItem elemBefore={<UploadIcon label="" />} isDisabled={!d.canManage} description={d.canManage ? undefined : 'Jira administrators only'} onClick={() => setImportOpen(true)}>Import devices</DropdownItem>
            <DropdownItem elemBefore={<PageIcon label="" />} isDisabled={!ready} onClick={() => setConfluenceOpen(true)}>Create Confluence pages</DropdownItem>
            <DropdownItem elemBefore={<DeleteIcon label="" />} isDisabled={!d.canManage} description={d.canManage ? undefined : 'Jira administrators only'} onClick={() => setRemoveOpen(true)}>Remove devices…</DropdownItem>
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
          <div style={{ display: 'grid', gap: sp(300), paddingTop: sp(300), width: '100%' }}>
            <Hero stats={stats} devicesCount={d.devicesCount} result={d.result} progressTasks={progressTasks} summaryState={d.summaryState} capped={Boolean(d.summary && d.summary.capped)} covered={d.tasksReady && missing.length === 0} />
            {/* Nothing matches an open recall: the hero says so. A "do this first" list and a table of zero rows with
                filters would only repeat it (the table's empty state even asked to "clear filters" when none was set). */}
            {all.length > 0 && <UrgentList matches={urgent} canCreate={canCreate} busy={d.creating.active} onCreate={createOne} onOpen={setDrawerDevice} projects={d.projects} projectKey={d.projectKey} onProject={d.setProjectKey} hasAll={all.length > 0} onCreateAll={() => setCreateAllOpen(true)} pendingCount={missing.length} deviceCount={new Set(missing.map((m) => m.deviceId)).size} loading={!d.tasksReady} />}
            {all.length > 0 && (
              <section style={card} aria-labelledby="rr-affected-h">
                <div style={{ margin: `0 0 ${sp(150)}` }}><Heading size="medium" as="h2" id="rr-affected-h">Affected devices</Heading></div>
                <DevicesTable matches={all} tasks={d.tasks} teams={teams} onOpen={setDrawerDevice} tasksReady={d.tasksReady} />
              </section>
            )}
            <RecentRecalls recent={d.recent} onOpen={d.loadRecent} />
          </div>
        </TabPanel>
        <TabPanel>
          <WardTeamsTab wardInfo={d.wardInfo} onChanged={d.loadWardInfo} result={d.result} canManage={d.canManageTeams} />
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
