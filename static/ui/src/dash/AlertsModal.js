import React, { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog';
import Button from '@atlaskit/button/new';
import Select from '@atlaskit/select';
import Textfield from '@atlaskit/textfield';
import Toggle from '@atlaskit/toggle';
import SectionMessage from '@atlaskit/section-message';
import { sp, color, muted, formatDay, ago } from '../ui/kit';
import { lastRunText, NOT_RUN_REASONS } from '../dashboardData.mjs';

// The daily alerts: whether RecallRadar creates the Jira task for a recall that is new, in which project, and which issue gets the
// one daily comment. Everyone can read it; saving and "Run now" are for Jira administrators (the server decides).
export default function AlertsModal({ isOpen, onClose, alerts, projects, canManage, hasResult, onChanged }) {
  const data = alerts.data;
  const saved = (data && data.settings) || { enabled: false, projectKey: '', commentIssueKey: '' };
  const [enabled, setEnabled] = useState(saved.enabled);
  const [projectKey, setProjectKey] = useState(saved.projectKey);
  const [issueKey, setIssueKey] = useState(saved.commentIssueKey);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);

  // Start from what is saved each time the dialog opens.
  useEffect(() => {
    if (isOpen) {
      setEnabled(saved.enabled);
      setProjectKey(saved.projectKey);
      setIssueKey(saved.commentIssueKey);
      setMessage(null);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = projects.map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }));
  // A project the administrator saved earlier stays selectable even when this list does not show it.
  if (projectKey && !options.some((o) => o.value === projectKey)) options.unshift({ label: projectKey, value: projectKey });
  const changed = enabled !== saved.enabled || projectKey !== saved.projectKey || issueKey.trim().toUpperCase() !== saved.commentIssueKey;
  const shut = !canManage || busy !== '';
  // Why a button is shut, in words, shown beside the buttons (and read out with them): a disabled button with no reason looks broken.
  const saveBlocked = !canManage ? 'only a Jira administrator can change this.' : busy ? 'working…' : !changed ? 'nothing has changed.' : enabled && !projectKey ? 'choose a project first.' : '';
  const runBlocked = !canManage ? 'only a Jira administrator can run it.' : busy ? 'working…' : !saved.enabled ? 'turn the alerts on and save first.' : changed ? 'save your changes first.' : !hasResult ? 'there is no saved check yet, press Refresh first.' : '';

  const save = async () => {
    setBusy('save');
    setMessage(null);
    try {
      const r = await invoke('saveAlertSettings', { enabled, projectKey, commentIssueKey: issueKey });
      if (r && r.ok) {
        setMessage({ kind: 'success', text: r.settings.enabled ? 'Saved. The alerts start from today: the devices that are affected now are the starting point, and only recalls that arrive later are alerted.' : 'Saved. The alerts are off.' });
        await onChanged();
      } else {
        setMessage({ kind: 'error', text: (r && r.error) || 'Could not save.' });
      }
    } catch (e) {
      setMessage({ kind: 'error', text: 'Could not reach RecallRadar.' });
    }
    setBusy('');
  };

  const run = async () => {
    setBusy('run');
    setMessage(null);
    try {
      const r = await invoke('runAlertsNow');
      if (r && r.ok && r.ran) {
        const text = lastRunText(r.summary);
        // A problem is explained once, in the status above ("The last run had a problem"), which this run has just updated.
        setMessage({ kind: r.summary.error ? 'warning' : 'success', text: `Ran just now: ${text}.` });
        await onChanged(r.summary.created.length > 0);
      } else if (r && r.ok) {
        setMessage({ kind: 'info', text: NOT_RUN_REASONS[r.reason] || 'Nothing was done.' });
      } else {
        setMessage({ kind: 'error', text: (r && r.error) || 'Could not run the alerts.' });
      }
    } catch (e) {
      setMessage({ kind: 'error', text: 'Could not reach RecallRadar.' });
    }
    setBusy('');
  };

  const last = data && data.last;
  const lastText = lastRunText(last);
  return (
    <ModalTransition>
      {isOpen && (
        <Modal onClose={onClose} width="medium" label="Daily alerts">
          <ModalHeader hasCloseButton><ModalTitle>Daily alerts</ModalTitle></ModalHeader>
          <ModalBody>
            <p style={{ marginTop: 0 }}>Every day RecallRadar checks the FDA again. When a recall starts to affect one of your devices, it creates the Jira task for it, and can post one comment.</p>
            {!canManage && <SectionMessage appearance="information" title="Jira administrators only">Only a Jira administrator can change the daily alerts. You can see how they are set up.</SectionMessage>}
            <div style={{ marginTop: sp(200), display: 'flex', alignItems: 'center', gap: sp(100) }}>
              <Toggle id="rr-alerts-on" isChecked={enabled} isDisabled={shut} onChange={(e) => setEnabled(e.target.checked)} label="Create tasks for new recalls every day" />
              <label htmlFor="rr-alerts-on"><strong>Create tasks for new recalls every day</strong></label>
            </div>
            <div style={{ display: 'grid', gap: sp(200), marginTop: sp(200) }}>
              <div>
                <label style={muted} htmlFor="rr-alerts-project">Project for the new tasks</label>
                <div style={muted}>The RecallRadar app creates them. Saving checks that it may create issues there.</div>
                <Select inputId="rr-alerts-project" aria-label="Project for the new tasks" spacing="compact" isDisabled={shut || !enabled} options={options} value={options.find((o) => o.value === projectKey) || null} placeholder="Choose a project" onChange={(o) => setProjectKey(o.value)} menuPosition="fixed" />
              </div>
              <div>
                <label style={muted} htmlFor="rr-alerts-issue">Post a comment on this issue (optional)</label>
                <Textfield id="rr-alerts-issue" name="alert-issue" value={issueKey} isDisabled={shut || !enabled} placeholder="For example MOBL-12" onChange={(e) => setIssueKey(e.target.value)} />
                <div style={muted}>One comment a day listing the new tasks, on an issue the team follows.</div>
              </div>
            </div>
            <div role="group" aria-label="Status" style={{ border: `1px solid ${color.border}`, borderRadius: '8px', padding: sp(200), background: color.sunken, marginTop: sp(200), display: 'grid', gridTemplateColumns: 'auto 1fr', gap: `${sp(100)} ${sp(300)}` }}>
              <span style={muted}>Watching</span>
              <strong>{data && data.watching ? `since ${formatDay(data.since)}` : 'starts with the next check'}</strong>
              <span style={muted}>Last daily run</span>
              <span>{last ? <><strong>{ago(last.at)}</strong>: {lastText}.</> : 'not yet'}</span>
            </div>
            {last && last.error && <div style={{ marginTop: sp(150) }}><SectionMessage appearance="warning" title="The last run had a problem">{last.error}</SectionMessage></div>}
            <div role="status" aria-live="polite" style={{ marginTop: sp(150), minHeight: '24px' }}>
              {message && <SectionMessage appearance={message.kind}>{message.text}</SectionMessage>}
            </div>
          </ModalBody>
          <ModalFooter>
            <span id="rr-alerts-why" style={{ ...muted, flex: '1 1 auto', textAlign: 'left' }}>
              {[saveBlocked && `Save: ${saveBlocked}`, runBlocked && `Run now: ${runBlocked}`].filter(Boolean).join(' ')}
            </span>
            <Button appearance="subtle" onClick={onClose}>Close</Button>
            <Button aria-describedby="rr-alerts-why" isDisabled={Boolean(runBlocked)} isLoading={busy === 'run'} onClick={run}>Run now</Button>
            <Button aria-describedby="rr-alerts-why" appearance="primary" isDisabled={Boolean(saveBlocked)} isLoading={busy === 'save'} onClick={save}>Save</Button>
          </ModalFooter>
        </Modal>
      )}
    </ModalTransition>
  );
}
