# The recall check as a background job

The summary is in the [README](../README.md#the-check-runs-in-the-background). This page has the design, the rules that keep it correct and the measurements.

A check makes about two dozen openFDA requests and a cold one takes 10 to 14 seconds on the demo site. A Forge UI function is cut off after 25 seconds and that limit cannot be raised (custom timeouts exist only for queue consumers and scheduled triggers), so a slow day could make a click fail. Instead:

1. **Pressing Refresh (or loading the demo hospital) starts a background job and returns at once.** The resolver records a job and puts a message on a Forge queue (async events). A queue consumer ([`src/consumer.js`](../src/consumer.js), allowed to run for up to 300 seconds) does the work.
2. **The panel shows progress.** It asks for the job's status every 2 seconds and shows "Checked 14 of 24 FDA searches". If you reload the page mid-check, it picks the running job back up.
3. **Results are saved for 6 hours** in Forge storage (an older one is shown flagged as old while a refresh runs, but **nothing is kept longer than 24 hours**), with a "last checked" time and a **Refresh** button. A saved result is used only while it is under 6 hours old and the device list is unchanged (a fingerprint of the devices). When the panel opens on an **expired** result, it shows that result flagged "older than 6 hours" and refreshes it in the background, so the panel is never empty.
4. **A daily trigger refreshes the saved result** ([`src/scheduled.js`](../src/scheduled.js)), so it is usually already there before anyone clicks.

The rules that keep it correct (each has unit tests): a check with failed lookups is shown but **not** saved; only the running job with the right id may be updated, so late or duplicate queue deliveries are skipped; a job that stops reporting for 6 minutes counts as failed; starting a job takes a short lock (`src/lock.js`) so two clicks at the same moment start one job; a big result is saved in parts (up to 60 parts of 50,000 characters, the head record written last so nobody reads half a result) and the job record keeps a copy only while that fits in one storage value, and only a result that fits nowhere (partial and large) is reported as a failure, not lost; the search has its own 240-second deadline inside the 300-second limit. The pieces are [`src/checkJob.js`](../src/checkJob.js) (job record), [`src/matchService.js`](../src/matchService.js) (start / run / status) and [`src/matchCache.js`](../src/matchCache.js) (saved result, in parts). [`src/lock.js`](../src/lock.js) is the small lock the job, the alert record and the task guard use: Forge storage has no compare-and-set, so a lock is a `lock:<name>` record written with Forge's *fail if it exists* policy and a 30-second expiry (only one writer gets it, a crashed holder lets go by itself); when the storage cannot do that, the work runs unlocked and every step stays safe to repeat.

Searches are also kept small: each asks for 25 recalls at a time (`SEARCH_LIMIT_PER_QUERY`) and continues to the next page, up to 100 per search (`MAX_PAGES_PER_QUERY`), over a three-year window.

## Measurements (demo hospital: 30 devices, 24 searches)

| | Before | After |
| --- | --- | --- |
| Search size | 100 recalls | 25 recalls |
| Cold check, on a laptop | 5 to 15 s (about 10 s on average, 4 runs) | 5 to 12 s (about 7 s on average, 6 runs) |
| Cold check, on the demo Jira site | about 30 s (read off the screen, so rough) | 13.4 s and 10.7 s (reported by the app, 2 runs) |
| Downloaded | 21.4 MB | 19.5 MB |
| Recalls fetched / matches found | 280 / 101 | 200 / 101 |
| Best match per device | 12 exact, 9 likely, 4 possible | unchanged |
| **Repeat check (saved result)** | same as a cold check | **0 ms, 0 MB** |

The honest picture: smaller searches help a little and cold timings are noisy (openFDA's response time varies a lot), but they do not fix the real cost. **One recall record (Z-1645-2026, BD Alaris) is 8.7 MB**, almost all of it a sub-object we never use, and openFDA cannot leave fields out. It is downloaded twice (by a manufacturer search and by a model search), which is about 17 of the 19.5 MB. Saving the result is what makes the panel feel instant: the cost is paid once per 6 hours instead of on every click.

Ideas not built: skip the duplicate download, or fetch per-device in the background.
