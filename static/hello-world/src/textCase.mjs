// Pure text helpers for the data the UI shows (FDA text, dates, ages). No imports, so they are unit tested
// from src/textCase.test.mjs. The UI re-exports them from ui/kit.js.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "4 Nov 2026" for every date in the UI (a fixed table, so the month never comes out as "Sept").
export function formatDay(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ''));
  return m && MONTHS[Number(m[2]) - 1] ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(day || '');
}

// "3 h ago" for a time stamp; '' when it is not a date. The exact time goes in a tooltip next to it.
export function ago(iso, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (!Number.isFinite(mins)) return '';
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

// The FDA writes some names and product lines in capitals. Only text that has NO lowercase letter at all is touched:
// anything already in mixed case is somebody's deliberate spelling and is left alone.
const isAllCaps = (s) => /[A-Z]/.test(s) && !/[a-z]/.test(s);
const capitalise = (word) => word.toLowerCase().replace(/(^|[-'/&])([a-z])/g, (m, a, b) => a + b.toUpperCase());

// Company endings that are not simply "first letter big": "INC" is "Inc", "GMBH" is "GmbH".
const FIRM_SUFFIXES = { INC: 'Inc', LTD: 'Ltd', CORP: 'Corp', CO: 'Co', GMBH: 'GmbH', LLC: 'LLC', LLP: 'LLP', LP: 'LP', PLC: 'PLC' };
const SMALL_WORDS = new Set(['AND', 'OF', 'THE', 'FOR', 'DE', 'DU', 'LA', 'LE', 'DI']);

// "PHILIPS MEDICAL SYSTEMS NEDERLAND B.V." becomes "Philips Medical Systems Nederland B.V.".
// Kept as written: words with a digit ("3M"), dotted abbreviations ("B.V."), and short capitals ("USA", "GE", "AG").
export function niceFirm(name) {
  if (typeof name !== 'string' || !isAllCaps(name) || !/[A-Z]{4}/.test(name)) return name;
  let first = true;
  return name
    .split(/(\s+)/)
    .map((piece) => {
      if (!piece.trim()) return piece;
      const [, lead, core, tail] = /^([([]*)(.*?)([),;:\]]*)$/.exec(piece);
      const bare = core.replace(/\.$/, '');
      const dot = core.endsWith('.') ? '.' : '';
      let out;
      if (/\d/.test(core) || /\w\.\w/.test(core)) out = core;
      else if (FIRM_SUFFIXES[bare]) out = FIRM_SUFFIXES[bare] + dot;
      else if (SMALL_WORDS.has(bare) && !first) out = bare.toLowerCase() + dot;
      else if (/^[A-Z]{1,3}$/.test(bare)) out = core;
      else out = capitalise(core);
      first = false;
      return lead + out + tail;
    })
    .join('');
}

// "ALPHENIX INTERVENTIONAL ANGIOGRAPHY SYSTEM REF: INFX-8000F" becomes "Alphenix interventional angiography
// system REF: INFX-8000F". Only plain words of four or more letters change; anything with a digit or a hyphen
// (model and part numbers) and short capitals ("REF") stay exactly as the FDA wrote them.
export function softCase(text) {
  if (typeof text !== 'string' || text.length < 12 || !isAllCaps(text)) return text;
  let first = true;
  return text
    .split(/(\s+)/)
    .map((piece) => {
      if (!piece.trim()) return piece;
      const m = /^([^A-Za-z0-9]*)([A-Za-z]{4,})([^A-Za-z0-9]*)$/.exec(piece);
      let out = piece;
      if (m) out = m[1] + (first ? m[2][0] + m[2].slice(1).toLowerCase() : m[2].toLowerCase()) + m[3];
      first = false;
      return out;
    })
    .join('');
}
