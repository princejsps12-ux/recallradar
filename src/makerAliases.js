// Companies that go by more than one name. A hospital writes the name on the device's label or in its own asset list ("BD",
// "Hill-Rom", "Datex-Ohmeda"); the FDA files a recall under the firm that is responsible TODAY ("Becton, Dickinson and Company",
// "Baxter Healthcare Corporation", "GE Healthcare"). Without a list of who is the same company, a true match fell to "possible"
// (which creates no task) or was not found at all.
//
// Each FAMILY lists the names that mean the same company for matching. A maker belongs to a family when its identifying words (the
// legal suffixes removed, letters with marks folded: see makerWords in matching.js) CONTAIN one of the family's names as a run of
// whole words: "BD Medical" and "Becton Dickinson Infusion Therapy Systems" both belong to the BD family. A name of three letters
// or fewer ("bd", "ge", "3m") must be the FIRST word of the maker, so that a stray "ge" inside an unrelated name joins nothing.
//
// What is on the list: the parent and the brands and subsidiaries whose recalls are filed under the parent, or the other way round,
// after the acquisitions below. It is deliberately a short list of well-known relationships and not a database: a company that is
// missing is compared by its words as before (nothing gets worse), and a wrong entry would only make two firms that are really
// separate compare as one, which the model number, the serial and the kind of device still have to confirm. `search` is the one
// name that is also searched in openFDA when a hospital owns a device of the family under another name ("BD" is also searched as
// "Becton Dickinson"), so the list costs at most one more search per family.
//
// No Forge imports, so this is unit tested with plain Node.
import { tokenize } from './text.js';

/**
 * @typedef {{ name: string, search: string, names: string[] }} MakerFamily
 */

/** @type {readonly MakerFamily[]} */
export const MAKER_FAMILIES = Object.freeze([
  // BD bought CareFusion (Alaris pumps, Pyxis) in 2015 and C. R. Bard in 2017.
  { name: 'BD (Becton Dickinson)', search: 'becton dickinson', names: ['bd', 'becton dickinson', 'carefusion', 'bard', 'alaris'] },
  // GE HealthCare became a company of its own in 2023. Datex-Ohmeda (anesthesia) and Marquette (monitoring) are GE brands.
  { name: 'GE HealthCare', search: 'ge', names: ['ge', 'general electric', 'wipro ge', 'datex ohmeda', 'datex', 'ohmeda', 'marquette'] },
  // Philips bought Respironics in 2008, Volcano in 2015, Vidacare in 2016 and Spectranetics in 2017.
  { name: 'Philips', search: 'philips', names: ['philips', 'respironics', 'volcano', 'spectranetics', 'vidacare'] },
  // Medtronic bought Covidien (Nellcor, Puritan Bennett, Valleylab, ev3) in 2015, HeartWare in 2016 and Mazor in 2018; MiniMed is its
  // diabetes business.
  { name: 'Medtronic', search: 'medtronic', names: ['medtronic', 'covidien', 'nellcor', 'puritan bennett', 'valleylab', 'ev3', 'minimed', 'heartware', 'mazor', 'sofamor danek'] },
  // Baxter bought Hillrom (which owned Welch Allyn, Voalte and Mortara) in 2021: Hill-Rom beds and Welch Allyn monitors are now recalled by Baxter.
  { name: 'Baxter', search: 'baxter', names: ['baxter', 'hill rom', 'hillrom', 'welch allyn', 'voalte', 'mortara'] },
  // ICU Medical bought Hospira's infusion business in 2017 and Smiths Medical in 2022.
  { name: 'ICU Medical', search: 'icu medical', names: ['icu medical', 'hospira', 'smiths medical'] },
  // Stryker bought Physio-Control in 2016, Wright Medical in 2020 and Vocera in 2022.
  { name: 'Stryker', search: 'stryker', names: ['stryker', 'physio control', 'sage products', 'mako surgical', 'wright medical', 'vocera'] },
  // Siemens Healthineers bought Varian in 2021 and Corindus in 2019.
  { name: 'Siemens Healthineers', search: 'siemens', names: ['siemens', 'healthineers', 'varian', 'corindus', 'dade behring', 'acuson'] },
  // Johnson & Johnson MedTech: Ethicon, DePuy Synthes, Biosense Webster, and Abiomed since 2022.
  { name: 'Johnson & Johnson MedTech', search: 'johnson johnson', names: ['johnson johnson', 'jnj', 'ethicon', 'depuy', 'synthes', 'biosense webster', 'abiomed'] },
  { name: 'Zimmer Biomet', search: 'zimmer', names: ['zimmer', 'biomet'] },
  // Abbott bought Thoratec in 2015, St. Jude Medical in 2017 and Alere in 2017.
  { name: 'Abbott', search: 'abbott', names: ['abbott', 'st jude', 'alere', 'thoratec'] },
  { name: 'Fresenius', search: 'fresenius', names: ['fresenius', 'nxstage'] },
  // Getinge bought Maquet in 2009 (Maquet is still a brand and a recalling firm).
  { name: 'Getinge', search: 'getinge', names: ['getinge', 'maquet'] },
  // Written with the umlaut, as "Draeger" and as "Drager": the same company ("Dräger" folds to "draeger").
  { name: 'Dräger', search: 'draeger', names: ['draeger', 'drager', 'draegerwerk'] },
  // 3M's health care business became Solventum in 2024.
  { name: '3M / Solventum', search: 'solventum', names: ['3m', 'solventum'] },
  // LivaNova was formed in 2015 from Sorin and Cyberonics.
  { name: 'LivaNova', search: 'livanova', names: ['livanova', 'sorin', 'cyberonics'] },
  { name: 'Olympus', search: 'olympus', names: ['olympus', 'gyrus acmi'] },
  { name: 'Terumo', search: 'terumo', names: ['terumo', 'vascutek', 'bolton medical'] },
  { name: 'Teleflex', search: 'teleflex', names: ['teleflex', 'arrow international'] },
  { name: 'ZOLL', search: 'zoll', names: ['zoll', 'cardiac science'] },
]);

// A name this short is only taken at the START of a maker's words.
const SHORT_NAME_LETTERS = 3;

/** @type {ReadonlyArray<{ family: MakerFamily, search: string[], names: Array<{ words: string[], anchored: boolean }> }>} */
const COMPILED = MAKER_FAMILIES.map((family) => ({
  family,
  search: tokenize(family.search),
  names: family.names.map((name) => {
    const words = tokenize(name);
    return { words, anchored: words.join('').length <= SHORT_NAME_LETTERS };
  }),
}));

/**
 * @param {string[]} words
 * @param {{ words: string[], anchored: boolean }} name
 * @returns {boolean}
 */
function containsName(words, { words: run, anchored }) {
  const last = anchored ? 0 : words.length - run.length;
  for (let start = 0; start <= last; start += 1) {
    if (run.every((word, i) => words[start + i] === word)) return true;
  }
  return false;
}

/**
 * The families a maker belongs to, as positions in MAKER_FAMILIES (usually none, at most one).
 * @param {string[]} makerWords  the identifying words of the maker's name (legal suffixes removed)
 * @returns {number[]}
 */
export function familiesOf(makerWords) {
  /** @type {number[]} */
  const found = [];
  COMPILED.forEach((entry, index) => {
    if (entry.names.some((name) => containsName(makerWords, name))) found.push(index);
  });
  return found;
}

/**
 * Whether two makers are the same company under different names.
 * @param {string[]} wordsA
 * @param {string[]} wordsB
 * @returns {boolean}
 */
export function sameMakerFamily(wordsA, wordsB) {
  const a = familiesOf(wordsA);
  if (a.length === 0) return false;
  const b = new Set(familiesOf(wordsB));
  return a.some((index) => b.has(index));
}

/**
 * The names to search openFDA for, besides the maker as written: the main name of each family the maker belongs to.
 * @param {string[]} makerWords
 * @returns {string[][]}
 */
export function familySearchNames(makerWords) {
  return familiesOf(makerWords).map((index) => COMPILED[index].search);
}
