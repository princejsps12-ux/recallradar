import React, { useState } from 'react';
import Heading from '@atlaskit/heading';
import ChevronDownIcon from '@atlaskit/icon/core/chevron-down';
import ChevronRightIcon from '@atlaskit/icon/core/chevron-right';
import { sp, color, card, muted } from '../ui/kit';
import data from '../headToHead.json';

const pct = (v) => (v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(0)}%`);
const cell = { padding: `${sp(100)} ${sp(150)}`, textAlign: 'right', borderTop: `1px solid ${color.border}` };
const head = { ...cell, borderTop: 0, textAlign: 'right', fontWeight: 600 };

// Why trust the "exact / likely" labels? Because the same labeled pairs were also run through a plain keyword search (maker
// word or model in the recall text), the way a spreadsheet filter would. The numbers come from docs/ACCURACY.md
// (`npm run eval` writes headToHead.json, and npm test fails when it is stale). Collapsed: it is evidence, not the daily work.
export default function HeadToHead() {
  const [open, setOpen] = useState(false);
  const v = data.all;
  return (
    <section style={card} aria-labelledby="rr-h2h-h">
      <Heading size="medium" as="h2" id="rr-h2h-h">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? 'rr-h2h-body' : undefined}
          onClick={() => setOpen(!open)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: sp(50), minHeight: '32px', background: 'none', border: 0, padding: 0, margin: 0, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
        >
          {open ? <ChevronDownIcon label="" /> : <ChevronRightIcon label="" />}
          How much better than a keyword search?
        </button>
      </Heading>
      <div style={{ ...muted, marginLeft: sp(300) }}>Tested on {v.pairs.toLocaleString('en-US')} labeled pairs from real FDA recalls.</div>
      {open && (
        <div id="rr-h2h-body" style={{ marginTop: sp(200), overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '420px' }}>
            <caption style={{ ...muted, textAlign: 'left', paddingBottom: sp(100) }}>Does this device need a task for this recall? {v.needTask} pairs do.</caption>
            <thead>
              <tr>
                <th scope="col" style={{ ...head, textAlign: 'left' }}>Method</th>
                <th scope="col" style={head}>False alarms</th>
                <th scope="col" style={head}>Missed</th>
                <th scope="col" style={head}>Precision</th>
                <th scope="col" style={head}>Recall</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" style={{ ...cell, textAlign: 'left', fontWeight: 400 }}>Keyword search (maker word or model in the recall text)</th>
                <td style={cell}>{v.keyword.falsePositives}</td>
                <td style={cell}>{v.keyword.missed}</td>
                <td style={cell}>{pct(v.keyword.precision)}</td>
                <td style={cell}>{pct(v.keyword.recall)}</td>
              </tr>
              <tr>
                <th scope="row" style={{ ...cell, textAlign: 'left' }}>RecallRadar (exact or likely)</th>
                <td style={cell}>{v.recallradar.falsePositives}</td>
                <td style={cell}>{v.recallradar.missed}</td>
                <td style={cell}>{pct(v.recallradar.precision)}</td>
                <td style={cell}>{pct(v.recallradar.recall)}</td>
              </tr>
            </tbody>
          </table>
          <p style={{ ...muted, margin: `${sp(150)} 0 0` }}>The labels were written by the developer from the recall text, so this shows what the rules add on real recall wording, not accuracy in your hospital. Details and limits: docs/ACCURACY.md in the repository.</p>
        </div>
      )}
    </section>
  );
}
