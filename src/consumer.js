// Queue consumer: does the recall check in the background, started by the "Check devices" button.
// It may run for up to 300 s (timeoutSeconds in manifest.yml), unlike a UI function (25 s).
import { runCheck } from './runtime';

// Forge delivers queue events at least once. The message body is what the resolver pushed:
// { jobId, trigger }. runCheck never throws, so Forge does not retry a check that already
// recorded its own failure.
export async function handler(event) {
  const body = (event && event.body) || {};
  const outcome = await runCheck({ trigger: body.trigger || 'user', jobId: body.jobId || null });
  console.info(`Recall check (${body.trigger || 'user'}) finished: ${outcome}`);
}
