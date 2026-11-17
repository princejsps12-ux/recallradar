import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@forge/bridge';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import Spinner from '@atlaskit/spinner';
import SectionMessage from '@atlaskit/section-message';
import ChevronDownIcon from '@atlaskit/icon/core/chevron-down';
import ChevronRightIcon from '@atlaskit/icon/core/chevron-right';
import { sp, color, muted, LinkLike, formatDay } from '../ui/kit';
import { workloadText } from '../dashboardData.mjs';
import { openIssue } from './DevicesTable';

// What the graph said about a ward while the page is open, so closing and reopening a drawer does not ask again. Nothing is
// written anywhere: a reload starts empty.
const known = new Map();

// "Who handles this ward": the ward's team, the Jira project the team works in (and who leads it), and how much open Jira work
// each person has, read from the Teamwork Graph as the signed-in person WHEN THIS IS OPENED (every read is a call to the
// graph, so it does not run on its own). `suggestedIds` are the people the "Create and assign" button would name.
export default function WardPeople({ ward, suggestedIds = [] }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(() => (known.has(ward) ? { status: 'ready', data: known.get(ward) } : { status: 'idle', data: null }));
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    setOpen(false);
    setState(known.has(ward) ? { status: 'ready', data: known.get(ward) } : { status: 'idle', data: null });
  }, [ward]);

  if (!ward) return null;

  const load = () => {
    setState({ status: 'loading', data: null });
    invoke('getWardPeople', { ward })
      .then((r) => {
        if (!mounted.current) return;
        if (r && r.ok) {
          known.set(ward, r);
          setState({ status: 'ready', data: r });
        } else setState({ status: 'error', data: null, error: (r && r.error) || 'Could not read the Teamwork Graph.' });
      })
      .catch(() => mounted.current && setState({ status: 'error', data: null, error: 'Could not reach RecallRadar.' }));
  };
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && state.status === 'idle') load();
  };

  const bodyId = `rr-people-${String(ward).replace(/[^A-Za-z0-9]/g, '-')}`;
  const d = state.data;
  return (
    <section aria-label={`Who handles ${ward}`} style={{ border: `1px solid ${color.border}`, borderRadius: '8px', padding: `${sp(100)} ${sp(200)}`, marginBottom: sp(300), background: color.raised }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggle}
        style={{ width: '100%', minHeight: '32px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: `0 ${sp(100)}`, textAlign: 'left', background: 'none', border: 0, padding: 0, margin: 0, font: 'inherit', fontWeight: 600, color: 'inherit', cursor: 'pointer' }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: sp(100), whiteSpace: 'nowrap' }}>
          {open ? <ChevronDownIcon label="" size="small" /> : <ChevronRightIcon label="" size="small" />}
          Who handles this ward
        </span>
        <span style={{ ...muted, fontWeight: 400, whiteSpace: 'nowrap' }}>from the Teamwork Graph</span>
      </button>
      {open && (
        <div id={bodyId} style={{ marginTop: sp(100) }}>
          {state.status === 'loading' && (
            <div role="status" style={{ display: 'flex', alignItems: 'center', gap: sp(100) }}>
              <Spinner size="small" label="" />
              <span style={muted}>Reading the team and its work…</span>
            </div>
          )}
          {state.status === 'error' && (
            <SectionMessage appearance="warning" title="Could not read the Teamwork Graph" actions={<Button onClick={load}>Try again</Button>}>
              {state.error}
            </SectionMessage>
          )}
          {state.status === 'ready' && d && !d.mapped && (
            <p style={{ margin: 0 }}>No team is set for <strong>{ward}</strong> yet. A Jira administrator or project administrator can choose one on the Ward teams tab.</p>
          )}
          {state.status === 'ready' && d && d.mapped && (
            <div>
              <div>Team: <strong>{d.team.name}</strong></div>
              <div style={{ marginTop: sp(50) }}>
                {d.spaces === null && <span style={muted}>The Jira projects this team works in could not be read.</span>}
                {d.spaces && d.spaces.length === 0 && <span style={muted}>No Jira project is linked to this team.</span>}
                {d.spaces && d.spaces.length > 0 && (
                  <ul aria-label="Projects the team works in" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {d.spaces.map((s) => (
                      <li key={s.key}>
                        Works in <LinkLike onClick={() => openIssue(s.key)}>{`${s.name} (${s.key})`}</LinkLike>{s.lead ? <span style={muted}>{` · led by ${s.lead}`}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {d.people.length === 0 ? (
                <p style={{ ...muted, marginBottom: 0 }}>The team has no members you can see.</p>
              ) : (
                <ul aria-label="People on the team" style={{ listStyle: 'none', margin: `${sp(100)} 0 0`, padding: 0 }}>
                  {d.people.map((p, i) => (
                    <li key={p.accountId} style={{ padding: `${sp(100)} 0`, borderTop: `1px solid ${color.border}` }} data-first={i === 0 ? 'true' : undefined}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: sp(100) }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: sp(100) }}>
                          <strong>{p.name}</strong>{' '}
                          {suggestedIds.includes(p.accountId) && <Lozenge appearance="new">Suggested for new tasks</Lozenge>}
                        </span>{' '}
                        <span style={p.overdue > 0 ? { color: color.danger, fontWeight: 600 } : muted}>{workloadText(p)}</span>
                      </div>
                      {p.next && (
                        <div style={muted}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: `0 ${sp(100)}` }}>
                            <span style={{ whiteSpace: 'nowrap' }}>Next:</span>{' '}
                            <span style={{ whiteSpace: 'nowrap' }}><LinkLike onClick={() => openIssue(p.next.key)}>{p.next.key}</LinkLike></span>{' '}
                            {p.next.dueAt ? <span style={{ whiteSpace: 'nowrap' }}>{`· due ${formatDay(p.next.dueAt)}`}</span> : null}
                          </div>
                          <div title={p.next.summary} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.next.summary}</div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {d.moreMembers > 0 && <div style={muted}>{`…and ${d.moreMembers} more ${d.moreMembers === 1 ? 'person' : 'people'} on the team.`}</div>}
              <div style={{ ...muted, marginTop: sp(100) }}>Read from the Teamwork Graph as you, when you open this. Nothing is saved. Open work is Jira work assigned to the person that is not done{d.partial && d.partial.work ? '; for some people it could not be read' : ''}.</div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
