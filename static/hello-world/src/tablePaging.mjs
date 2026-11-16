// Sorting and paging for the affected-devices table, as pure functions (unit tested in src/tablePaging.test.mjs).
//
// Why this exists: Atlaskit's DynamicTable pages by itself, but its built-in pager is drawn with the legacy Button,
// whose run-time styles the Forge iframe's CSP blocks (plain browser buttons, see ui/Pager.js). So we render the
// pages ourselves (sort ALL rows, cut one page) and show ui/Pager.js under the table. The table is then given one
// finished page (DynamicTableStateless, which has no pager of its own).

export const PAGE_SIZE = 10;

// One shared collator: building it for every comparison is slow. `numeric` puts "Z-2" before "Z-10".
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'accent' });

// The same order DynamicTable gives (numbers before text, text compared with the collator above), so the pass the
// table itself makes over the one page it is handed changes nothing.
function compare(a, b) {
  const aNumber = typeof a === 'number';
  const bNumber = typeof b === 'number';
  if (aNumber && bNumber) return a - b;
  if (aNumber) return -1;
  if (bNumber) return 1;
  return collator.compare(String(a), String(b));
}

// Rows sorted by `valueOf(row)`, ascending or descending. Stable: equal values keep their saved order, which is
// what makes "sort by class" keep the most urgent recalls together in a steady order.
export function sortRows(rows, valueOf, order = 'ASC') {
  const direction = order === 'DESC' ? -1 : 1;
  return rows
    .map((row, index) => [row, index, valueOf(row)])
    .sort((a, b) => direction * compare(a[2], b[2]) || a[1] - b[1])
    .map(([row]) => row);
}

export function pageCount(total, perPage = PAGE_SIZE) {
  return Math.max(1, Math.ceil(total / perPage));
}

// A page number that exists: filtering can leave fewer pages than the one we were on.
export function clampPage(page, total, perPage = PAGE_SIZE) {
  return Math.min(Math.max(1, Math.floor(page) || 1), pageCount(total, perPage));
}

export function pageOf(rows, page, perPage = PAGE_SIZE) {
  const current = clampPage(page, rows.length, perPage);
  return rows.slice((current - 1) * perPage, current * perPage);
}

// "11" and "20" of "Showing 11-20 of 24": the first and last row number on a page (both 0 when there are no rows).
export function rangeOf(page, total, perPage = PAGE_SIZE) {
  if (total === 0) return { from: 0, to: 0 };
  const current = clampPage(page, total, perPage);
  return { from: (current - 1) * perPage + 1, to: Math.min(total, current * perPage) };
}

export const GAP = '…';

// The page numbers a pager shows: at most seven slots, always the first and the last page, the current page with a
// neighbour either side, and "…" where pages are skipped. [1, 2, 3, 4, 5, '…', 20] near the start, [1, '…', 9, 10, 11,
// '…', 20] in the middle, [1, '…', 16, 17, 18, 19, 20] near the end. With seven pages or fewer, all of them.
export function pageWindow(current, total) {
  const last = Math.max(1, Math.floor(total) || 1);
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const page = Math.min(Math.max(1, Math.floor(current) || 1), last);
  if (page <= 4) return [1, 2, 3, 4, 5, GAP, last];
  if (page >= last - 3) return [1, GAP, last - 4, last - 3, last - 2, last - 1, last];
  return [1, GAP, page - 1, page, page + 1, GAP, last];
}
