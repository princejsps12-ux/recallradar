import React, { useState } from 'react';
import Heading from '@atlaskit/heading';
import DynamicTable from '@atlaskit/dynamic-table';
import SectionMessage from '@atlaskit/section-message';
import Skeleton from '@atlaskit/skeleton';
import VisuallyHidden from '@atlaskit/visually-hidden';
import ChevronDownIcon from '@atlaskit/icon/core/chevron-down';
import ChevronRightIcon from '@atlaskit/icon/core/chevron-right';
import { sp, color, card, muted, useNarrow, ClassLozenge, niceFirm, softCase, formatDay } from '../ui/kit';

// Two lines at most, with the full text on hover: some FDA product names are 300 characters long.
const clamp = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };

// The newest FDA device recalls, for context only (they are not matched to the hospital's devices; the matches are
// above). Collapsed by default: it is the least important thing on the page, and the list is not even requested from
// the FDA until it is opened (`onOpen` asks the hook to load it, once, or again after an error).
// The toggle is a button INSIDE the heading, the usual accordion pattern, so screen readers list it among the headings.
export default function RecentRecalls({ recent, onOpen }) {
  const [open, setOpen] = useState(false);
  const narrow = useNarrow();
  const recalls = recent.recalls || [];
  const loading = recent.state === 'idle' || recent.state === 'loading';

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && (recent.state === 'idle' || recent.state === 'error')) onOpen();
  };

  const rows = recalls.slice(0, 10).map((r) => ({
    key: r.recallNumber,
    cells: [
      { key: 'n', content: <span style={{ whiteSpace: 'nowrap' }}>{r.recallNumber}</span> },
      { key: 'c', content: <ClassLozenge recallClass={r.recallClass} /> },
      { key: 'f', content: niceFirm(r.firm) || 'Unknown firm' },
      { key: 'p', content: <span style={clamp} title={r.product}>{softCase(r.product)}</span> },
      { key: 'd', content: <span style={{ whiteSpace: 'nowrap' }}>{r.date ? formatDay(r.date) : '–'}</span> },
    ],
  }));

  return (
    <section style={card} aria-labelledby="rr-recent-h">
      <Heading size="medium" as="h2" id="rr-recent-h">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? 'rr-recent-body' : undefined}
          onClick={toggle}
          style={{ display: 'inline-flex', alignItems: 'center', gap: sp(50), minHeight: '32px', background: 'none', border: 0, padding: 0, margin: 0, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
        >
          {open ? <ChevronDownIcon label="" /> : <ChevronRightIcon label="" />}
          Recent FDA device recalls
        </button>
      </Heading>
      <div style={{ ...muted, marginLeft: sp(300) }}>The newest recalls from the FDA, for context. The ones that match your devices are listed above.</div>
      {open && (
        <div id="rr-recent-body" style={{ marginTop: sp(200) }}>
          {recent.state === 'error' ? (
            <SectionMessage appearance="warning" title="Could not load recent recalls">The public FDA service did not answer. Close this section and open it again to retry.</SectionMessage>
          ) : narrow ? (
            loading ? (
              <div role="status" aria-busy="true">
                <VisuallyHidden>Loading recent recalls…</VisuallyHidden>
                <div aria-hidden="true" style={{ display: 'grid', gap: sp(100) }}>
                  {[0, 1, 2].map((i) => <Skeleton key={i} height="64px" width="100%" isShimmering />)}
                </div>
              </div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(100) }} aria-label="Recent FDA device recalls">
                {recalls.slice(0, 6).map((r) => (
                  <li key={r.recallNumber} style={{ borderTop: `1px solid ${color.border}`, paddingTop: sp(100) }}>
                    <strong>{r.recallNumber}</strong> <span style={muted}>{r.recallClass ? `Class ${r.recallClass}` : ''} · {r.date ? formatDay(r.date) : ''}</span>
                    <div style={muted}>{niceFirm(r.firm) || 'Unknown firm'}</div>
                    <div>{softCase(r.product)}</div>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div style={{ marginTop: `calc(-1 * ${sp(300)})` }}>
              <DynamicTable
                caption={<VisuallyHidden>The newest FDA device recalls</VisuallyHidden>}
                label="Recent FDA device recalls"
                isLoading={loading}
                head={{ cells: [{ key: 'n', content: 'Recall', width: 14 }, { key: 'c', content: 'Class', width: 10 }, { key: 'f', content: 'Firm', width: 22 }, { key: 'p', content: 'Product', width: 44 }, { key: 'd', content: 'Date', width: 10 }] }}
                rows={rows}
                rowsPerPage={10}
                isFixedSize
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
