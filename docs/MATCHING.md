# How matching works, in detail

The summary is in the [README](../README.md#how-matching-works). This page has each check, every number and the reason for it.

## How each fact is checked

- **Normalising text.** Everything is lower-cased and split into words at any character that is not a letter or digit. `MMT-1885CLW/00763` and `mmt 1885clw 00763` are the same. Phrases must match **as whole words, in order**, so model `N15` matches `N12/N15/N17` but never `N150`.
- **Manufacturer.** Legal words (`Inc`, `Corporation`, `Ltd`, `GmbH`, `AB`...) are ignored. Two makers match when **all** words of the shorter name appear in the longer one (`Philips` matches `Philips North America Llc`), and at least one shared word is specific. Generic words (`Medical`, `Healthcare`, `Systems`...) alone never match: `Medical Systems` does not match `GE Medical Systems Information Technologies`.
- **Model.** Looked for in both the product description and the code info.
- **Lot/serial.** Looked for in the code info only, since that is where FDA lists them.
- **All units.** The recall's code info contains `all serial`, `all lot`, `all unexpired` or `all units`.
- **Device type** (weakest rule only). Every word of the device's type (`infusion pump`) appears in the recall's product text.

## The numbers, and why

There are no unexplained constants. All are named exports in [`src/matching.js`](../src/matching.js) or [`src/recallSearch.js`](../src/recallSearch.js):

| Constant | Value | Reason |
| --- | --- | --- |
| `MIN_MODEL_LENGTH` | 3 characters | A model like `A1` or `10` would "appear" in almost every recall by chance. |
| `MIN_LOT_LENGTH` | 4 characters | Same reason for lot/serial numbers. |
| `MIN_MODEL_LENGTH_OTHER_MAKER` | 5 characters | The `possible-model-other-maker` rule ignores the manufacturer, so the model alone must be distinctive. |
| `LOOKBACK_DAYS` | 365 | Looks at the last year of recalls: recent enough to matter, without old closed-out recalls. |
| `MODELS_PER_QUERY` | 5 | Keeps search URLs short and stops one very common model crowding out others. |
| `MAX_RECALLS_PER_QUERY` | 100 | openFDA's per-request maximum without paging. |
| `SEARCH_LIMIT_PER_QUERY` | 25 | Newest recalls requested per search. Smaller is faster; 25 kept every match in the demo (see "Speed" below). |
| `CACHE_TTL_HOURS` | 6 | How long a saved check stays fresh. FDA publishes about weekly, so a few hours old is fine, and it spares openFDA's request limit. |
| `SEARCH_DEADLINE_MS` | 240 s | Gives up on slow searches 60 s before the 300 s limit of the background function. |
| `STALE_JOB_MS` | 6 min | A background job with no progress update for this long counts as failed. |
| `MAX_CACHE_BYTES` | 200 KiB | Forge storage rejects values over 240 KiB; larger results are skipped (recomputed) instead of failing. |

## Ordering

Results are sorted by confidence (exact, likely, possible), then recall class (I is the most serious), then newest recall first, then device id, so the order is always the same.

## Known limits

- **Serial ranges are not understood.** A recall that says `serial number < 2224` lists no individual numbers, so a device inside the range shows as **likely** and needs a person to check.
- **No spelling variants.** `monitor` and `monitors` are different words, and `MMT1885CLW` does not match `MMT-1885CLW`.
- **Newest 25 recalls per search.** A manufacturer or model group with more than 25 recalls in the window may have older ones missed. The panel says so when any search hit this cap (openFDA reports the real total, so it is exact, not a guess). The model searches still catch recalls that mention a hospital model.
- **openFDA rate limit.** Anonymous use is limited (about 1,000 requests a day per IP address, 240 a minute). One check makes about two dozen requests, which is why it runs on a button click, and why results are saved (see below).
- **The FDA is not the only source.** Recalls from other regulators are not included.
