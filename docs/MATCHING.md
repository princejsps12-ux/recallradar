# How matching works, in detail

The summary is in the [README](../README.md#how-matching-works). This page has each check, every number and the reason for it.

## How each fact is checked

- **UDI-DI.** The device's identifier (a GS1 GTIN of 8, 12, 13 or 14 digits, always compared as 14 digits with leading zeros) is looked for in the recall's code info. The shapes read: GS1 element strings `(01)GTIN(21)serial(10)lot(17)expiry`, labelled lists (`UDI-DI: a(each), b(case)`, `UDI-DI code:`, `GTIN:`, `DI:`) and unlabelled `<DI>/<serial>` and `<model>/<DI>` pairs (these need a correct GS1 check digit, so a random number beside a slash is not taken for one). A number the text ties to the device's own UDI-DI (`(01)...(21)209`) counts as listed at any length, because it names that product's unit directly. The identifiers in an imported device list must also pass the check digit; the ones in recall texts are compared without it, since recalls contain typos of their own. Code: [`src/udi.js`](../src/udi.js).
- **Normalising text.** Everything is lower-cased and split into words at any character that is not a letter or digit. `MMT-1885CLW/00763` and `mmt 1885clw 00763` are the same. Phrases must match **as whole words, in order**, so model `N15` matches `N12/N15/N17` but never `N150`.
- **Manufacturer.** Legal words (`Inc`, `Corporation`, `Ltd`, `GmbH`, `AB`...) are ignored. Two makers match when **all** words of the shorter name appear in the longer one (`Philips` matches `Philips North America Llc`), and at least one shared word is specific. Generic words (`Medical`, `Healthcare`, `Systems`...) alone never match: `Medical Systems` does not match `GE Medical Systems Information Technologies`.
- **Model.** Looked for in both the product description and the code info.
- **Lot/serial.** Looked for in the code info only, since that is where FDA lists them.
- **Serial ranges.** `serial numbers 1000 through 1500`, `SN 2001-2500`, `serial number < 2224`, `serial numbers 3000 and above`. Read only from text that follows the word *serial* (or `S/N`, `SN`) and stops at the next `lot`, `;` or sentence end, so a lot code such as `Lots: 2011-2331` is never a range, and a "range" whose end is below its start (`2008-1459`) is a code too. A limit (`< 2224`) is applied only to a serial with the same number of digits, and a range to a serial whose length lies between its ends, because one recall often lists several products with a limit each (a 7-digit part serial is never judged by an 11-digit ventilator limit). A serial with letters after the digits is not a number and is never judged by a range. Code: [`src/serials.js`](../src/serials.js).
- **All units.** The recall's code info contains `all serial`, `all lot`, `all unexpired` or `all units` and is not followed (within four words) by a condition such as `with`, `running`, `version`, `manufactured between`: "all serial numbers with software versions 22D28..." is not every unit.
- **Device type** (weakest rule only). Every word of the device's type (`infusion pump`) appears in the recall's product text.

## The numbers, and why

There are no unexplained constants. All are named exports in [`src/matching.js`](../src/matching.js) or [`src/recallSearch.js`](../src/recallSearch.js):

| Constant | Value | Reason |
| --- | --- | --- |
| `MIN_MODEL_LENGTH` | 3 characters | A model like `A1` or `10` would "appear" in almost every recall by chance. |
| `MIN_LOT_LENGTH` | 4 characters | Same reason for lot/serial numbers. (A short serial that the text ties to the device's own UDI-DI is trusted anyway.) |
| `MIN_SERIAL_DIGITS` | 3 digits | A serial shorter than this is never judged by a range or limit (`serial < 2224` must not catch a serial `7`). |
| `MIN_MODEL_LENGTH_OTHER_MAKER` | 5 characters | The `possible-model-other-maker` rule ignores the manufacturer, so the model alone must be distinctive. |
| `LOOKBACK_DAYS` | 3 x 365 | Looks at the last three years: recalls often stay open (the FDA lists them as "Ongoing") long after they were issued, and a hospital still has the devices. |
| `UDIS_PER_QUERY` | 5 | One search per five identifiers (each written in up to three forms), to keep URLs short. |
| `MAX_PAGES_PER_QUERY` | 4 | A search with more matches than one answer holds is read page by page, up to 100 recalls; a search with still more is flagged as capped. |
| `MAX_CONCURRENT_REQUESTS` | 6 | openFDA allows about 240 requests a minute per address; six at a time finishes a check in seconds and stays well inside that. |
| `MODELS_PER_QUERY` | 5 | Keeps search URLs short and stops one very common model crowding out others. |
| `MAX_RECALLS_PER_QUERY` | 100 | openFDA's per-request maximum. |
| `SEARCH_LIMIT_PER_QUERY` | 25 | Recalls requested per page. Smaller is faster; 25 kept every match in the demo, and a busy search continues on the next page. |
| `CACHE_TTL_HOURS` | 6 | How long a saved check stays fresh. FDA publishes about weekly, so a few hours old is fine, and it spares openFDA's request limit. |
| `SEARCH_DEADLINE_MS` | 240 s | Gives up on slow searches 60 s before the 300 s limit of the background function. |
| `STALE_JOB_MS` | 6 min | A background job with no progress update for this long counts as failed. |
| `MAX_CACHE_BYTES` | 200 KiB | Forge storage rejects values over 240 KiB; larger results are skipped (recomputed) instead of failing. |

## Ordering

Results are sorted by confidence (exact, likely, possible), then recall class (I is the most serious), then newest recall first, then device id, so the order is always the same.

## Known limits

- **A unit outside a stated range is not ruled out.** When a recall says `serial numbers 2001-2500` and the device's serial is 3000, the product is still shown as **likely**: a wrongly read range would hide a real recall, so a person decides. The reason names the range.
- **A very short serial needs a UDI-DI.** A serial or lot of fewer than four characters ("209") is not trusted on its own; recorded with the UDI-DI that the recall ties it to, it is **exact**.
- **UDI forms not yet read.** Only GS1 GTINs are read (8, 12, 13, 14 digits). HIBC codes (`+M335...`) and a DI that appears only in a picture are not.
- **No spelling variants.** `monitor` and `monitors` are different words, and `MMT1885CLW` does not match `MMT-1885CLW`.
- **At most 100 recalls per search.** A manufacturer or model group with more than 100 recalls in the three-year window may have older ones missed. The panel says so when any search hit this cap (openFDA reports the real total, so it is exact, not a guess). The model and UDI-DI searches still catch recalls that mention a hospital model or identifier.
- **openFDA rate limit.** Anonymous use is limited (about 1,000 requests a day per IP address, 240 a minute). One check makes about two dozen requests, which is why it runs on a button click, and why results are saved (see below).
- **The FDA is not the only source.** Recalls from other regulators are not included.

## How accurate is it?

Measured against 2,354 labeled pairs built from 40 real recalls: [ACCURACY.md](ACCURACY.md) (generated by `npm run eval`; `npm test` fails when it is out of date).
