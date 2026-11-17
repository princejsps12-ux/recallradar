import React, { useEffect, useRef, useState } from 'react';
import { token } from '@atlaskit/tokens';
import { SlideIn, ExitingPersistence } from '@atlaskit/motion';
import Heading from '@atlaskit/heading';
import Button, { IconButton, SplitButton } from '@atlaskit/button/new';
import DropdownMenu, { DropdownItemGroup, DropdownItem } from '@atlaskit/dropdown-menu';
import Avatar from '@atlaskit/avatar';
import SectionMessage from '@atlaskit/section-message';
import CrossIcon from '@atlaskit/icon/core/cross';
import ChevronDownIcon from '@atlaskit/icon/core/chevron-down';
import ChevronRightIcon from '@atlaskit/icon/core/chevron-right';
import VisuallyHidden from '@atlaskit/visually-hidden';
import LinkExternalIcon from '@atlaskit/icon/core/link-external';
import { router } from '@forge/bridge';
import { sp, cap, color, muted, ClassLozenge, MatchLozenge, LinkLike, formatDay } from '../ui/kit';
import { matchesForDevice } from '../dashboardData.mjs';
import { pairOf } from '../data/tasks';
import { openIssue } from './DevicesTable';

const recallUrl = (n) => `https://api.fda.gov/device/enforcement.json?search=recall_number:%22${encodeURIComponent(n)}%22`;
// Long FDA text starts collapsed: a dense block of 600 characters is hard to scan.
const SHORT = 220;
function ExpandableText({ text }) {
  const [open, setOpen] = useState(false);
  const long = text.length > SHORT;
  return (
    <p style={{ margin: 0 }}>
      {long && !open ? `${text.slice(0, SHORT).trimEnd()}…` : text}{' '}
      {long && (
        <LinkLike onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show more'}</LinkLike>
      )}
    </p>
  );
}

const FOCUSABLE = 'button, a[href], select, input, textarea, [tabindex]:not([tabindex="-1"])';

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: sp(100) }}>
      <div style={muted}>{label}</div>
      <div>{children || <span style={muted}>not recorded</span>}</div>
    </div>
  );
}

// One recall for this device. The WHOLE header row is the toggle (recall number, class and match included), so the
// click target is the full width of the card; the task link or the Create button sits beside it, not inside it
// (a button cannot hold another button). Expanded, it shows the facts and the reasons.
function RecallCard({ m, result, tasks, suggestion, canCreate, busy, isOpen, onToggle, onCreate }) {
  const [hover, setHover] = useState(false);
  const key = tasks[pairOf(m)];
  const details = (result.recallDetails || {})[m.recallNumber] || {};
  const bodyId = `rr-card-${m.recallNumber}`;
  const disabled = !canCreate || busy;
  return (
    <section aria-label={`Recall ${m.recallNumber}`} style={{ border: `1px solid ${color.border}`, borderRadius: '8px', padding: `${sp(100)} ${sp(200)}`, marginTop: sp(100), background: hover ? token('elevation.surface.raised.hovered') : color.raised }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: sp(100) }}>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={bodyId}
          onClick={onToggle}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{ flex: '1 1 0', minWidth: 0, minHeight: '32px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: sp(100), textAlign: 'left', background: 'none', border: 0, padding: 0, margin: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}
        >
          {isOpen ? <ChevronDownIcon label="" size="small" /> : <ChevronRightIcon label="" size="small" />}
          <strong>{m.recallNumber}</strong>
          <VisuallyHidden>{isOpen ? 'Hide details' : 'Show details'}</VisuallyHidden>
          <ClassLozenge recallClass={m.recallClass} />
          <MatchLozenge confidence={m.confidence} />
        </button>
        <span style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: sp(100) }}>
          {key ? (
            <>
              <span>Task:</span>
              <LinkLike onClick={() => openIssue(key)}>{key}</LinkLike>
            </>
          ) : suggestion ? (
            // "Create task" is the main action and assigns nobody. The menu offers the one suggested person: people are
            // only ever assigned when the user picks that item.
            <SplitButton>
              <Button isDisabled={disabled} onClick={() => onCreate(m, false)}>Create task</Button>
              <DropdownMenu
                shouldRenderToParent
                placement="bottom-end"
                trigger={({ triggerRef, ...props }) => (
                  <IconButton {...props} ref={triggerRef} isDisabled={disabled} label={`More ways to create the task for ${m.recallNumber}`} icon={ChevronDownIcon} />
                )}
              >
                <DropdownItemGroup>
                  <DropdownItem
                    elemBefore={<Avatar size="xsmall" name={suggestion.name} />}
                    description={`Fewest open RecallRadar tasks in ${suggestion.teamName}`}
                    onClick={() => onCreate(m, true)}
                  >
                    {`Create and assign to ${suggestion.name}`}
                  </DropdownItem>
                </DropdownItemGroup>
              </DropdownMenu>
            </SplitButton>
          ) : (
            <Button isDisabled={disabled} onClick={() => onCreate(m, false)}>Create task</Button>
          )}
        </span>
      </div>
      {isOpen && (
        <div id={bodyId} style={{ marginTop: sp(100) }}>
          <div style={muted}>{m.firm}{details.status ? ` · ${details.status}` : ''}{details.initiated ? ` · started ${formatDay(details.initiated)}` : ''}{m.date ? ` · reported ${formatDay(m.date)}` : ''}</div>
          <div style={{ marginTop: sp(50) }}><LinkLike iconAfter={LinkExternalIcon} onClick={() => router.open(recallUrl(m.recallNumber))}>Full FDA record</LinkLike></div>
          <div style={{ margin: `${sp(150)} 0 ${sp(50)}` }}><Heading size="xsmall" as="h3">Why we think it matches</Heading></div>
          <p style={{ margin: 0 }}>{m.reason}</p>
          {details.reason && (
            <>
              <div style={{ margin: `${sp(150)} 0 ${sp(50)}` }}><Heading size="xsmall" as="h3">What the FDA says is wrong</Heading></div>
              <ExpandableText text={details.reason} />
            </>
          )}
        </div>
      )}
      {!key && !canCreate && <div style={{ ...muted, marginTop: sp(50) }}>Choose a project on the Overview tab first.</div>}
    </section>
  );
}

// The side drawer for one device: its details, each affected recall with the reason we matched it and what the
// FDA says is wrong, and the Jira task (or the buttons to create one). It slides in from the right (Atlaskit's own
// Drawer is always left-anchored). Keyboard: focus moves in when it opens, Tab stays inside, Escape closes it,
// and focus returns to what opened it.
export default function DeviceDrawer({ deviceId, result, tasks, suggestions, teams, canCreate, busy, onCreate, onCreateMany, onClose }) {
  const matches = deviceId ? matchesForDevice(result, deviceId) : [];
  const first = matches[0];
  const panel = useRef(null);
  const closeWrap = useRef(null);
  const opener = useRef(null);
  const [openCards, setOpenCards] = useState({});
  useEffect(() => setOpenCards({}), [deviceId]);
  const missing = matches.filter((m) => !tasks[pairOf(m)]);

  useEffect(() => {
    if (!deviceId) return undefined;
    opener.current = document.activeElement;
    const timer = setTimeout(() => {
      const button = closeWrap.current && closeWrap.current.querySelector('button');
      if (button) button.focus();
    }, 80);
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll(FOCUSABLE)].filter((n) => !n.disabled);
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      if (opener.current && opener.current.focus) opener.current.focus();
    };
  }, [deviceId]); // eslint-disable-line

  return (
    <ExitingPersistence appear>
      {first && (
        <div key="drawer" style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={onClose} aria-hidden="true" style={{ position: 'absolute', inset: 0, background: token('color.blanket') }}><div style={{ position: 'absolute', inset: 0, background: token('color.blanket') }} /></div>
          <SlideIn enterFrom="right" fade="none" duration="medium">
            {(motion) => (
              <div
                {...motion}
                ref={(node) => {
                  panel.current = node;
                  if (motion.ref) motion.ref.current = node;
                }}
                role="dialog"
                aria-modal="true"
                aria-label={`Details for ${first.deviceName}`}
                style={{ position: 'relative', width: 'min(520px, 100%)', height: '100%', overflowY: 'auto', boxSizing: 'border-box', background: token('elevation.surface.overlay'), boxShadow: token('elevation.shadow.overlay'), borderLeft: `1px solid ${color.border}`, color: color.text }}
              >
                <div style={{ padding: `0 ${sp(300)} ${sp(300)}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: sp(100), position: 'sticky', top: 0, zIndex: 1, background: token('elevation.surface.overlay'), padding: `${sp(300)} 0 ${sp(150)}` }}>
                    <div style={{ minWidth: 0 }}>
                      <Heading size="large">{cap(first.deviceName)}</Heading>
                      <div style={muted}>{first.deviceManufacturer} {first.deviceModel}</div>
                    </div>
                    <span ref={closeWrap}>
                      <Button appearance="subtle" aria-label="Close details" onClick={onClose} iconBefore={CrossIcon} />
                    </span>
                  </div>
                  <div role="group" aria-label="Device facts" style={{ margin: `0 0 ${sp(300)}`, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: sp(200) }}>
                    <Field label="Ward">{first.ward}</Field>
                    <Field label="Team">{first.ward && teams[first.ward] ? teams[first.ward] : 'No team yet'}</Field>
                    <Field label="Serial or lot">{first.lotOrSerial}</Field>
                    {first.deviceUdiDi ? <Field label="UDI-DI">{first.deviceUdiDi}</Field> : null}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: sp(100) }}>
                    <Heading size="medium">Recalls that affect it ({matches.length})</Heading>
                    {missing.length > 1 && (
                      <Button appearance="primary" isDisabled={!canCreate || busy} onClick={() => onCreateMany(missing)}>{`Create ${missing.length} tasks`}</Button>
                    )}
                  </div>
                  {matches.map((m) => (
                    <RecallCard
                      key={m.recallNumber}
                      m={m}
                      result={result}
                      tasks={tasks}
                      suggestion={suggestions[pairOf(m)]}
                      canCreate={canCreate}
                      busy={busy}
                      isOpen={Boolean(openCards[m.recallNumber])}
                      onToggle={() => setOpenCards({ ...openCards, [m.recallNumber]: !openCards[m.recallNumber] })}
                      onCreate={onCreate}
                    />
                  ))}
                  {matches.length === 0 && <SectionMessage appearance="information" title="Nothing to show">This device no longer matches an open recall.</SectionMessage>}
                </div>
              </div>
            )}
          </SlideIn>
        </div>
      )}
    </ExitingPersistence>
  );
}
