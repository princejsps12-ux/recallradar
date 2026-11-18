import React from 'react';
import Button, { IconButton } from '@atlaskit/button/new';
import VisuallyHidden from '@atlaskit/visually-hidden';
import ChevronLeftIcon from '@atlaskit/icon/core/chevron-left';
import ChevronRightIcon from '@atlaskit/icon/core/chevron-right';
import { sp, muted } from './kit';
import { Inline } from './layout';
import { pageWindow, GAP } from '../tablePaging.mjs';

// Page numbers under a table, built only from Atlaskit's NEW Button (32 px tall, filled blue current page).
//
// Why not @atlaskit/pagination (or the pager inside DynamicTable)? Both draw their buttons with the LEGACY Button, which
// writes its styles into <style> tags at run time. The Forge iframe's content security policy blocks those, so the pager
// came out as plain browser buttons. Handing Pagination our own button components fixed the look but not the cause: the
// legacy Button still tried to write its blocked styles on every render (the preview's check reports that as a CSP
// violation). A pager is a nav, a list and buttons, so this one has none of that.
//
// `page` is 1-based; `label` names the navigation for screen readers. The pure part (which numbers to show) is
// pageWindow in tablePaging.mjs, unit tested.
export default function Pager({ page, pages, onChange, label }) {
  return (
    <nav aria-label={label} style={{ marginTop: sp(200) }}>
      <Inline as="div" role="list" space="space.050" alignInline="center" alignBlock="center">
        <li>
          <IconButton appearance="subtle" icon={ChevronLeftIcon} label="Previous page" isDisabled={page <= 1} onClick={() => onChange(page - 1)} />
        </li>
        {pageWindow(page, pages).map((item, index) => (
          <li key={item === GAP ? `gap-${index}` : item}>
            {item === GAP ? (
              <span style={{ ...muted, padding: `0 ${sp(100)}` }}>
                <span aria-hidden="true">…</span>
                <VisuallyHidden>Skipped pages</VisuallyHidden>
              </span>
            ) : (
              <Button appearance={item === page ? 'primary' : 'subtle'} aria-current={item === page ? 'page' : undefined} aria-label={`Page ${item}`} onClick={() => onChange(item)}>
                {item}
              </Button>
            )}
          </li>
        ))}
        <li>
          <IconButton appearance="subtle" icon={ChevronRightIcon} label="Next page" isDisabled={page >= pages} onClick={() => onChange(page + 1)} />
        </li>
      </Inline>
    </nav>
  );
}
