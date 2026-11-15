import React, { useEffect, useState } from 'react';
import { token } from '@atlaskit/tokens';
import Lozenge from '@atlaskit/lozenge';

// Spacing and colours come ONLY from Atlassian design tokens (they follow light and dark mode and meet
// contrast rules). No hex colours anywhere in the UI code.
export const sp = (n) => token(`space.${n}`);
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
  link: token('color.link'),
};

export const card = {
  background: color.raised,
  border: `1px solid ${color.border}`,
  borderRadius: '8px',
  padding: sp(200),
  boxSizing: 'border-box',
};

export const muted = { color: color.subtle, fontSize: '12px', lineHeight: '16px' };

const CLASS_APPEARANCE = { I: 'removed', II: 'moved', III: 'default' };
// Text AND colour, so the meaning never depends on colour alone.
export function ClassLozenge({ recallClass }) {
  return (
    <Lozenge isBold appearance={CLASS_APPEARANCE[recallClass] || 'default'}>
      {recallClass ? `Class ${recallClass}` : 'Class ?'}
    </Lozenge>
  );
}

export function MatchLozenge({ confidence }) {
  return (
    <Lozenge appearance={confidence === 'exact' ? 'inprogress' : 'new'} isBold={confidence === 'exact'}>
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
