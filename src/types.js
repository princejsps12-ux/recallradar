// The shapes of the data that moves between the modules, as JSDoc typedefs. Nothing runs here: it exists so the type checker
// (`npm run typecheck`) and an editor know what a device, a recall or a match looks like. Import one with
//   /** @param {import('./types.js').Device} device */
// No Forge imports.

/**
 * A hospital device as stored (see deviceStore.js).
 * @typedef {object} Device
 * @property {string} id
 * @property {string} name
 * @property {string} type
 * @property {string} manufacturer
 * @property {string} model
 * @property {string} lotOrSerial   the unit's lot or serial number ('' when not recorded)
 * @property {string} ward
 * @property {string} [udiDi]       the UDI-DI (a GS1 GTIN) as 14 digits, '' when not recorded
 * @property {string} [source]      'demo', 'manual' or 'assets'
 */

/**
 * A recall as the matching needs it (see openfda.js parseRecallForMatching).
 * @typedef {object} Recall
 * @property {string} recallNumber
 * @property {string} recallClass   'I', 'II', 'III' or ''
 * @property {string} date          ISO day of the FDA report
 * @property {string} firm          the recalling firm
 * @property {string} product       short product text for display
 * @property {string} productText   the product description in full, for matching
 * @property {string} codeText      the lot, serial and UDI text, for matching
 */

/**
 * How sure a match is.
 * @typedef {'exact' | 'likely' | 'possible'} Confidence
 */

/**
 * What the matcher decides about one device and one recall (see matching.js evaluateMatch).
 * @typedef {object} Verdict
 * @property {Confidence} confidence
 * @property {string} rule
 * @property {string} reason
 */

/**
 * One (device, recall) pair the matcher found (see matching.js evaluateMatch and its callers).
 * @typedef {object} Match
 * @property {Confidence} confidence
 * @property {string} rule          the name of the rule that decided it
 * @property {string} reason        the sentence shown to the person
 * @property {string} deviceId
 * @property {string} deviceName
 * @property {string} deviceManufacturer
 * @property {string} deviceModel
 * @property {string} deviceUdiDi   the device's UDI-DI ('' when not recorded)
 * @property {string} lotOrSerial
 * @property {string} ward
 * @property {string} recallNumber
 * @property {string} recallClass
 * @property {string} firm
 * @property {string} product
 * @property {string} date
 */

/**
 * What a recall check saves (see matchService.js and matchCache.js).
 * @typedef {object} CheckResult
 * @property {number} deviceCount
 * @property {number} recallCount
 * @property {Match[]} matches
 * @property {Record<string, {status?: string, initiated?: string, reason?: string}>} [recallDetails]
 * @property {number} failedQueries
 * @property {number} cappedQueries
 * @property {string} [checkedAt]
 */

/**
 * A task as Jira reports it for a (recall, device) pair.
 * @typedef {object} TaskInfo
 * @property {string} key
 * @property {string} status        the project's own name for the status ('' when unknown)
 * @property {'new' | 'indeterminate' | 'done'} category   Jira's own grouping of statuses
 */

/**
 * The key/value storage behind the stores (see kvAdapter.js).
 * @typedef {object} Kv
 * @property {(key: string) => Promise<any>} get
 * @property {(key: string, value: any) => Promise<void>} set
 * @property {(key: string) => Promise<void>} delete
 * @property {(prefix: string) => Promise<Array<{key: string, value: any}>>} [listByPrefix]
 */

export {};
