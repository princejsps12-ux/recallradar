// Daily trigger: refreshes the saved recall check, so the result is usually already there before
// anyone clicks, and first deletes expired previews and task guards and any result older than 24 hours. Then, when the check
// finished, the daily alert: tasks and one comment for the recalls that are new (see alertService.js). Runs without a user. If
// a check is already running it does nothing, and any problem is recorded and logged, never thrown (Forge would not retry anyway).
import { cleanupStorage, enqueueStep } from './runtime';

// The daily trigger only does the cheap part and hands the rest to the queue, where each step has its own 300 seconds and starts the
// next one itself: the cleanup here, then the check (consumer.js), then the alerts (consumer.js). A check that runs long can no longer
// take the alerts down with it, and nothing runs inside the trigger's own time limit.
export async function handler() {
  console.info('Daily cleanup deleted', await cleanupStorage());
  await enqueueStep({ step: 'check', trigger: 'schedule' });
  console.info('Daily check queued');
}
