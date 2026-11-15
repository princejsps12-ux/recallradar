import React, { useEffect, useState } from 'react';
import { token } from '@atlaskit/tokens';
import Lozenge from '@atlaskit/lozenge';
import Button from '@atlaskit/button/new';
import Spinner from '@atlaskit/spinner';
import ChevronRightIcon from '@atlaskit/icon/core/chevron-right';

// Spacing and colours come ONLY from Atlassian design tokens (they follow light and dark mode and meet
// contrast rules). No hex colours anywhere in the UI code.
// Token names are zero-padded to three digits: sp(50) is space.050 (4 px), sp(200) is space.200 (16 px).
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// FDA firm names often come in capitals ("PHILIPS MEDICAL SYSTEMS"): show those in normal case.
export const niceFirm = (s) => (s && s === s.toUpperCase() && /[A-Z]{4}/.test(s) ? s.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : s);
// "3 h ago" style age, for the panel header.
export function ago(iso, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (!Number.isFinite(mins)) return '';
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}
export const sp = (n) => token(`space.${String(n).padStart(3, '0')}`);
export const color = {
  text: token('color.text'),
  subtle: token('color.text.subtle'),
  danger: token('color.text.danger'),
  success: token('color.text.success'),
  surface: token('elevation.surface'),
  raised: token('elevation.surface.raised'),
  sunken: token('elevation.surface.sunken'),
  border: token('color.border'),
  borderDanger: token('color.border.danger'),
  borderSuccess: token('color.border.success'),
  borderBrand: token('color.border.brand'),
  borderBold: token('color.border.bold'),
  fillBrand: token('color.background.brand.bold'),
  track: token('color.background.neutral'),
  link: token('color.link'),
};

export const card = {
  background: color.raised,
  border: `1px solid ${color.border}`,
  borderRadius: '8px',
  padding: sp(200),
  boxSizing: 'border-box',
};

export const muted = { color: color.subtle, fontSize: '13px', lineHeight: '20px' };
// Recall numbers such as Z-0208-2027 must never break at their hyphens.
export const noBreak = { whiteSpace: 'nowrap' };

const CLASS_APPEARANCE = { I: 'removed', II: 'moved', III: 'default' };
// Text AND colour, so the meaning never depends on colour alone.
export function ClassLozenge({ recallClass }) {
  return (
    <Lozenge appearance={CLASS_APPEARANCE[recallClass] || 'default'}>
      {recallClass ? `Class ${recallClass}` : 'Class ?'}
    </Lozenge>
  );
}

export function MatchLozenge({ confidence }) {
  return (
    <Lozenge appearance={confidence === 'exact' ? 'inprogress' : 'new'}>
      {confidence === 'exact' ? 'Exact match' : 'Likely match'}
    </Lozenge>
  );
}

// The statuses of a person-readable "who": initials in a circle plus the name.
export const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

// True on a phone-width viewport (the iframe's own width, so it also holds when the Jira sidebar is open).
// Tables become cards there: a seven-column table cannot be read at 380 px.
export function useNarrow(maxWidth = 720) {
  const query = `(max-width: ${maxWidth}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setNarrow(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return narrow;
}

// One look for every "Details" button, on desktop and on a phone.
export function DetailsButton({ onClick, label = 'Details' }) {
  return (
    <Button appearance="subtle" spacing="compact" iconAfter={ChevronRightIcon} onClick={onClick}>
      {label}
    </Button>
  );
}

// Check progress in the brand colour (tokens only): a filled bar when the total is known, a spinner when not.
export function Progress({ done, total, label }) {
  const known = Boolean(total);
  return (
    <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: sp(150), minHeight: '24px' }}>
      {known ? (
        <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} style={{ flex: '0 0 160px', height: '6px', borderRadius: '3px', background: color.track, overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, Math.round((done / total) * 100))}%`, height: '100%', background: color.fillBrand }} />
        </div>
      ) : (
        <Spinner size="small" label="" />
      )}
      <span style={muted}>{known ? `Checked ${done} of ${total} FDA searches` : 'Starting the check'}. You can keep working.</span>
    </div>
  );
}

// "15 Nov 2026, 23:49" in the reader's own locale, never an ambiguous 15/11/2026.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "4 Nov 2026" for every date in the UI (a fixed table, so the month never comes out as "Sept").
export function formatDay(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ''));
  return m && MONTHS[Number(m[2]) - 1] ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(day || '');
}

export function formatWhen(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch (e) {
    return String(iso || '');
  }
}

// A button that looks like a real text link: token blue, underlined, with the browser's own keyboard focus ring.
// (Atlaskit's new Button has no link look, and the legacy one did not render as a link here.) `iconAfter` is an icon
// component, shown small after the text.
export function LinkLike({ children, onClick, iconAfter: Icon, ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...rest}
      style={{ background: 'none', border: 0, padding: 0, margin: 0, font: 'inherit', color: color.link, textDecoration: 'underline', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: sp(50) }}
    >
      {children}
      {Icon ? <Icon label="" size="small" /> : null}
    </button>
  );
}
