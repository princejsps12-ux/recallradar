// Queue consumer: does the recall check in the background (started by the "Check devices" button or by the daily trigger) and the
// daily alerts that follow it. Each message is ONE step with its own 300 seconds (timeoutSeconds in manifest.yml), and a step that
// finishes well queues the next one itself:
//   { jobId, trigger }                   the button's check
//   { step: 'check', trigger: 'schedule' }  the daily check; when it is done it queues the alerts
//   { step: 'alerts' }                   the daily alerts, in their own invocation
import { runCheck, runDailyAlerts, enqueueStep } from './runtime';

// Forge delivers queue events at least once. runCheck and runDailyAlerts never throw, so Forge does not retry a step that already
// recorded its own failure.
export async function handler(event) {
  const body = (event && event.body) || {};
  if (body.step === 'alerts') {
    console.info(`Daily alerts finished: ${await runDailyAlerts()}`);
    return;
  }
  const trigger = body.trigger || 'user';
  const outcome = await runCheck({ trigger, jobId: body.jobId || null });
  console.info(`Recall check (${trigger}) finished: ${outcome}`);
  if (body.step === 'check' && outcome === 'done') await enqueueStep({ step: 'alerts' });
}
