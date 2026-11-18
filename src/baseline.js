// A deliberately plain "keyword search" matcher, used ONLY to measure what RecallRadar's rules add (docs/ACCURACY.md, the
// head-to-head table). It is what a spreadsheet filter or a saved FDA search does: flag a recall when the device's maker shares a
// word with the recall's firm, or when the device's model appears in the recall's text. It has no serials, no UDI-DI, no
// exclusions, no several-products reading and no confidence levels: it can only say "flagged" or "not flagged".

/** Words of three letters or more, lower case: shorter ones ("of", "co") would match every firm. */
const MIN_WORD_LENGTH = 3;
/** A model shorter than this is not searched: "A1" appears in thousands of unrelated texts. Same bound as a person would use. */
const MIN_MODEL_LENGTH = 3;

/** @param {unknown} text @returns {string[]} */
const wordsOf = (text) => String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= MIN_WORD_LENGTH);
/** @param {unknown} text @returns {string} */
const squash = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * @param {{ manufacturer?: string, model?: string }} device
 * @param {{ firm?: string, productText?: string, codeText?: string }} recall
 * @returns {boolean} true when a keyword search for this device would flag this recall
 */
export function keywordFlags(device, recall) {
  const firmWords = new Set(wordsOf(recall.firm));
  if (wordsOf(device.manufacturer).some((w) => firmWords.has(w))) return true;
  const model = squash(device.model);
  return model.length >= MIN_MODEL_LENGTH && squash(`${recall.productText} ${recall.codeText}`).includes(model);
}

/**
 * Precision and recall of "flagged" against "needs a task" (the right answer is exact or likely), over the same labeled rows the
 * matcher is scored on. Rows whose truth is "excluded" are left out, as in scoreCases.
 * @param {{ truth: string, flagged: boolean }[]} rows
 */
export function scoreFlags(rows) {
  const scored = rows.filter((row) => row.truth !== 'excluded');
  const needs = (/** @type {{ truth: string }} */ row) => row.truth === 'affected' || row.truth === 'product-covered';
  const tp = scored.filter((row) => row.flagged && needs(row)).length;
  const flagged = scored.filter((row) => row.flagged).length;
  const actual = scored.filter(needs).length;
  return {
    total: scored.length,
    tp,
    flagged,
    actual,
    falsePositives: flagged - tp,
    missed: actual - tp,
    precision: flagged === 0 ? null : tp / flagged,
    recall: actual === 0 ? null : tp / actual,
  };
}
