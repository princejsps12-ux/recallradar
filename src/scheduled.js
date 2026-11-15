// Daily trigger: refreshes the saved recall check, so the result is usually already there before
// anyone clicks, and first deletes expired previews and task guards and any result older than 24 hours. Runs without a user. If a check is already running it does nothing, and any
// problem is recorded and logged, never thrown (Forge would not retry anyway).
import { runCheck, cleanupStorage } from './runtime';

export async function handler() {
  console.info('Daily cleanup deleted', await cleanupStorage());
  const outcome = await runCheck({ trigger: 'schedule' });
  console.info(`Daily recall refresh finished: ${outcome}`);
}
