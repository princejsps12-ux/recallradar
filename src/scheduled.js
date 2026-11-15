// Daily trigger: refreshes the saved recall check, so the result is usually already there before
// anyone clicks. Runs without a user. If a check is already running it does nothing, and any
// problem is recorded and logged, never thrown (Forge would not retry anyway).
import { runCheck } from './runtime';

export async function handler() {
  const outcome = await runCheck({ trigger: 'schedule' });
  console.info(`Daily recall refresh finished: ${outcome}`);
}
