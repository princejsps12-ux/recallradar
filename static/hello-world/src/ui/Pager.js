import React, { forwardRef } from 'react';
import Pagination from '@atlaskit/pagination';
import Button, { IconButton } from '@atlaskit/button/new';
import ChevronLeftIcon from '@atlaskit/icon/core/chevron-left';
import ChevronRightIcon from '@atlaskit/icon/core/chevron-right';
import { sp } from './kit';

// Why the buttons are ours: Atlaskit's Pagination (and the pager built into DynamicTable) draws its buttons with the
// LEGACY Button, which writes its styles into <style> tags at run time. The Forge iframe's content security policy
// blocks those, so the pager came out as plain browser buttons: small, with no clear current page. Pagination lets us
// hand it the three button components; these use the NEW Button, whose styles are in a normal stylesheet and do load.
//
// The legacy Button gives each of them aria-current, aria-label, disabled and onClick (it keeps `isSelected` for its own
// styling), so the current page is read from aria-current. Every button is 32 px tall, the size of an Atlaskit button.
const PageButton = forwardRef(function PageButton({ children, onClick, disabled, 'aria-current': current, 'aria-label': label, 'data-testid': testId }, ref) {
  return (
    <Button ref={ref} appearance={current ? 'primary' : 'subtle'} isDisabled={disabled} onClick={onClick} aria-current={current} aria-label={label} testId={testId}>
      {children}
    </Button>
  );
});

const PreviousButton = forwardRef(function PreviousButton({ onClick, disabled, 'aria-label': label, 'data-testid': testId }, ref) {
  return <IconButton ref={ref} appearance="subtle" icon={ChevronLeftIcon} label={label} isDisabled={disabled} onClick={onClick} testId={testId} />;
});

const NextButton = forwardRef(function NextButton({ onClick, disabled, 'aria-label': label, 'data-testid': testId }, ref) {
  return <IconButton ref={ref} appearance="subtle" icon={ChevronRightIcon} label={label} isDisabled={disabled} onClick={onClick} testId={testId} />;
});

// Defined once: a new object on every render would remount the buttons and lose keyboard focus.
const components = { Page: PageButton, Previous: PreviousButton, Next: NextButton };

// Page numbers (1-based) centred under a table. `label` names the navigation for screen readers.
export default function Pager({ page, pages, onChange, label }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: sp(200) }}>
      <Pagination
        label={label}
        pages={Array.from({ length: pages }, (_, i) => i + 1)}
        selectedIndex={page - 1}
        onChange={(event, next) => onChange(next)}
        previousLabel="Previous page"
        nextLabel="Next page"
        pageLabel="Page"
        components={components}
      />
    </div>
  );
}
