import React, { useEffect, useRef, useState } from 'react';
import { token } from '@atlaskit/tokens';
import { SlideIn, ExitingPersistence } from '@atlaskit/motion';
import Heading from '@atlaskit/heading';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import Avatar from '@atlaskit/avatar';
import SectionMessage from '@atlaskit/section-message';
import CrossIcon from '@atlaskit/icon/core/cross';
import LinkExternalIcon from '@atlaskit/icon/core/link-external';
import { router } from '@forge/bridge';
import { sp, color, muted, ClassLozenge, MatchLozenge, LinkLike, formatDay } from '../ui/kit';
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

// The side drawer for one device: its details, each affected recall with the reason we matched it and what the
// FDA says is wrong, and the Jira task (or the buttons to create one). It slides in from the right (Atlaskit's own
// Drawer is always left-anchored). Keyboard: focus moves in when it opens, Tab stays inside, Escape closes it,
// and focus returns to what opened it.
export default function DeviceDrawer({ deviceId, result, tasks, suggestions, teams, canCreate, busy, onCreate, onClose }) {
  const matches = deviceId ? matchesForDevice(result, deviceId) : [];
  const first = matches[0];
  const panel = useRef(null);
  const closeWrap = useRef(null);
  const opener = useRef(null);

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
              <aside
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
                <div style={{ padding: sp(300) }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: sp(100) }}>
                    <div>
                      <Heading size="large">{first.deviceName}</Heading>
                      <div style={{ ...muted, marginBottom: sp(200) }}>{first.deviceManufacturer} {first.deviceModel}</div>
                    </div>
                    <span ref={closeWrap}>
                      <Button appearance="subtle" spacing="compact" aria-label="Close details" onClick={onClose} iconBefore={CrossIcon} />
                    </span>
                  </div>
                  <div role="group" aria-label="Device facts" style={{ margin: `0 0 ${sp(300)}`, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: sp(200) }}>
                    <Field label="Ward">{first.ward}</Field>
                    <Field label="Team">{first.ward && teams[first.ward]}</Field>
                    <Field label="Serial or lot">{first.lotOrSerial}</Field>
                  </div>
                  <Heading size="medium">Recalls that affect it ({matches.length})</Heading>
                  {matches.map((m) => {
                    const key = tasks[pairOf(m)];
                    const suggestion = suggestions[pairOf(m)];
                    const details = (result.recallDetails || {})[m.recallNumber] || {};
                    return (
                      <section key={m.recallNumber} aria-label={`Recall ${m.recallNumber}`} style={{ border: `1px solid ${color.border}`, borderRadius: '8px', padding: sp(200), marginTop: sp(150), background: color.raised }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(100), alignItems: 'center' }}>
                          <strong>{m.recallNumber}</strong>
                          <ClassLozenge recallClass={m.recallClass} />
                          <MatchLozenge confidence={m.confidence} />
                          {details.status && <Lozenge>{details.status}</Lozenge>}
                        </div>
                        <div style={muted}>{m.firm}{m.date ? ` · reported ${formatDay(m.date)}` : ''}{details.initiated ? ` · started ${formatDay(details.initiated)}` : ''}</div>
                        <div style={{ marginTop: sp(50) }}><LinkLike iconAfter={LinkExternalIcon} onClick={() => router.open(recallUrl(m.recallNumber))}>Full FDA record</LinkLike></div>
                        <div style={{ margin: `${sp(150)} 0 ${sp(50)}` }}><Heading size="xsmall" as="h3">Why we think it matches</Heading></div>
                        <p style={{ margin: 0 }}>{m.reason}</p>
                        {details.reason && (
                          <>
                            <div style={{ margin: `${sp(150)} 0 ${sp(50)}` }}><Heading size="xsmall" as="h3">What the FDA says is wrong</Heading></div>
                            <ExpandableText text={details.reason} />
                          </>
                        )}
                        <div style={{ marginTop: sp(150), display: 'flex', flexWrap: 'wrap', gap: sp(100), alignItems: 'center' }}>
                          {key ? (
                            <>
                              <span>Task:</span>
                              <LinkLike onClick={() => openIssue(key)}>{key}</LinkLike>
                            </>
                          ) : (
                            <>
                              <Button spacing="compact" isDisabled={!canCreate || busy} onClick={() => onCreate(m, false)}>Create task</Button>
                              {suggestion && (
                                <Button spacing="compact" isDisabled={!canCreate || busy} onClick={() => onCreate(m, true)}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: sp(75) }}>
                                    <Avatar size="xsmall" name={suggestion.name} />
                                    Create and assign to {suggestion.name}
                                  </span>
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                        {!key && !canCreate && <div style={{ ...muted, marginTop: sp(50) }}>Choose a project on the Overview tab first.</div>}
                        {suggestion && <div style={{ ...muted, marginTop: sp(50) }}>Suggested because they have the fewest open RecallRadar tasks in {suggestion.teamName}. Nobody is assigned unless you choose it.</div>}
                      </section>
                    );
                  })}
                  {matches.length === 0 && <SectionMessage appearance="information" title="Nothing to show">This device no longer matches an open recall.</SectionMessage>}
                </div>
              </aside>
            )}
          </SlideIn>
        </div>
      )}
    </ExitingPersistence>
  );
}
