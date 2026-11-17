import React, { useEffect, useState } from 'react';
import { token } from '@atlaskit/tokens';
import Lozenge from '@atlaskit/lozenge';
import Spinner from '@atlaskit/spinner';
import Tooltip from '@atlaskit/tooltip';
import { formatDay, ago, niceFirm, softCase } from '../textCase.mjs';
import { taskStatusLabel, taskStatusAppearance } from '../dashboardData.mjs';

// Pure text helpers live in textCase.mjs (unit tested); everything in the UI imports them from here.
export { formatDay, ago, niceFirm, softCase };

// Spacing and colours come ONLY from Atlassian design tokens (they follow light and dark mode and meet
// contrast rules). No hex colours anywhere in the UI code.
// Token names are zero-padded to three digits: sp(50) is space.050 (4 px), sp(200) is space.200 (16 px).
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
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

export const muted = { color: color.subtle, fontSize: '14px', lineHeight: '20px' };
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

// Jira's status of a task (text AND colour): grey to do, blue in progress, green done. `info` is { status, category }.
export function TaskStatusLozenge({ info }) {
  return <Lozenge appearance={taskStatusAppearance(info)}>{taskStatusLabel(info)}</Lozenge>;
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

// ONE link style for the whole app: link blue and underlined (so a link is never told apart from text by colour alone),
// the same underline offset everywhere, the darker "pressed" blue while hovered or focused, and the browser's own focus ring.
// NameLink and LinkLike below only differ in weight (a device name is a title, so it is semi-bold) and in what they hold.
const LINK_LOOK = { background: 'none', border: 0, font: 'inherit', textDecoration: 'underline', textUnderlineOffset: '3px', textDecorationThickness: '1px', cursor: 'pointer' };
const linkColor = (active) => (active ? token('color.link.pressed') : color.link);

// A device name that opens its details: semi-bold, in the link style above. One of these replaces a separate "Details" button in every row. `label` names the target for
// screen readers, because the same device appears on several rows ("Details for Impella Controller, recall Z-0208-2027");
// it always contains the visible name. The 4 px of padding (cancelled by an equal negative margin, so the layout does
// not move) make the target 32 px tall, the size of an Atlaskit button.
export function NameLink({ children, onClick, label, style }) {
  const [active, setActive] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      style={{ ...LINK_LOOK, display: 'inline-block', maxWidth: '100%', padding: `${sp(50)} 0`, margin: `calc(-1 * ${sp(50)}) 0`, lineHeight: '24px', fontWeight: 600, textAlign: 'left', color: linkColor(active), ...style }}
    >
      {children}
    </button>
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

// "Last checked 3 h ago": the same wording in the dashboard header and the issue panel. The exact time is in a
// tooltip (and in the element's own title), never the only way to read it.
export function CheckedAt({ iso, stale, prefix = 'Checked' }) {
  if (!iso) return null;
  const exact = formatWhen(iso);
  return (
    <>
      {prefix}{' '}
      <Tooltip content={exact} position="bottom">
        {(tooltipProps) => (
          <time {...tooltipProps} dateTime={iso} title={exact} tabIndex={0} style={{ textDecoration: 'underline dotted', textUnderlineOffset: '3px', cursor: 'default' }}>
            {ago(iso)}
          </time>
        )}
      </Tooltip>
      {stale ? ' (older than 6 hours)' : ''}
    </>
  );
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
// component, shown small after the text. The 2 px of padding (cancelled by an equal negative margin, so nothing moves)
// make the target 24 px tall, the minimum size WCAG 2.2 asks for.
export function LinkLike({ children, onClick, iconAfter: Icon, ...rest }) {
  const [active, setActive] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      {...rest}
      style={{ ...LINK_LOOK, padding: `${sp(25)} 0`, margin: `calc(-1 * ${sp(25)}) 0`, color: linkColor(active), display: 'inline-flex', alignItems: 'center', gap: sp(50) }}
    >
      {children}
      {Icon ? <Icon label="" size="small" /> : null}
    </button>
  );
}
