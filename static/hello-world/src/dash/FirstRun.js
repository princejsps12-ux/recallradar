import React, { useState } from 'react';
import Heading from '@atlaskit/heading';
import Button from '@atlaskit/button/new';
import SectionMessage from '@atlaskit/section-message';
import Lozenge from '@atlaskit/lozenge';
import { sp, color, card, muted } from '../ui/kit';

const STEPS = [
  ['1', 'Add your devices', 'Start with a sample hospital of 30 devices that use real manufacturer and model names, or paste your own list from a spreadsheet.'],
  ['2', 'We check the FDA recalls', 'RecallRadar compares them with the last year of FDA device recalls and says how sure each match is, and why.'],
  ['3', 'Create the follow-up tasks', 'Create a Jira task for each affected device with the ward, the reason, a link to the recall and a due date.'],
];

export default function FirstRun({ onLoadDemo, onImport, error }) {
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ ...card, padding: sp(400), textAlign: 'center' }}>
      <Heading size="xlarge">Welcome to RecallRadar</Heading>
      <p style={{ ...muted, fontSize: '16px', maxWidth: '620px', margin: `${sp(100)} auto ${sp(300)}`, textWrap: 'balance' }}>
        Find out which of your hospital's devices an FDA recall affects, how sure we are, and why.
      </p>
      <ol style={{ listStyle: 'none', margin: `0 auto ${sp(400)}`, padding: 0, display: 'grid', alignItems: 'stretch', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: sp(200), maxWidth: '900px', textAlign: 'left' }}>
        {STEPS.map(([n, title, text]) => (
          <li key={n} style={{ border: `1px solid ${color.border}`, borderRadius: '8px', padding: sp(200), background: color.sunken, margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <Lozenge isBold appearance="inprogress">{`Step ${n}`}</Lozenge>
            <div style={{ margin: `${sp(100)} 0 ${sp(50)}` }}><Heading size="small">{title}</Heading></div>
            <div style={muted}>{text}</div>
          </li>
        ))}
      </ol>
      {error && <div role="alert" style={{ maxWidth: '620px', margin: `0 auto ${sp(200)}`, textAlign: 'left' }}><SectionMessage appearance="error" title="Something went wrong">{error}</SectionMessage></div>}
      <div style={{ display: 'flex', gap: sp(150), justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button appearance="primary" isLoading={busy} onClick={async () => { setBusy(true); await onLoadDemo(); setBusy(false); }}>Load demo hospital</Button>
        <Button onClick={onImport}>Import your own devices</Button>
      </div>
      <p style={muted}>Nothing is sent anywhere except manufacturer and model names to the public FDA service.</p>
    </div>
  );
}
