import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLock } from './lock.js';
import { fakeKv } from './fakeKv.mjs';

const noSleep = () => new Promise((resolve) => setImmediate(resolve));

test('two runs under the same lock never overlap, and both finish', async () => {
  const kv = fakeKv();
  const lock = createLock(kv, { sleep: noSleep, attempts: 200 });
  let inside = 0;
  let overlapped = false;
  const work = async () => {
    inside += 1;
    if (inside > 1) overlapped = true;
    await new Promise((resolve) => setTimeout(resolve, 5));
    inside -= 1;
    return 'done';
  };
  const results = await Promise.all([lock.run('x', work), lock.run('x', work), lock.run('x', work)]);
  assert.deepEqual(results, ['done', 'done', 'done']);
  assert.equal(overlapped, false);
  assert.equal(kv.data.has('lock:x'), false, 'the lock is released');
});

test('different lock names do not wait for each other', async () => {
  const lock = createLock(fakeKv(), { sleep: noSleep, attempts: 2 });
  let release;
  const held = lock.run('a', () => new Promise((resolve) => { release = resolve; }));
  assert.equal(await lock.run('b', async () => 'free'), 'free');
  release();
  await held;
});

test('a lock that stays held makes the run throw instead of writing without it, and an expired lock is taken over', async () => {
  const kv = fakeKv({ 'lock:x': { token: 'someone else' } });
  const lock = createLock(kv, { sleep: noSleep, attempts: 3 });
  await assert.rejects(lock.run('x', async () => 'never'), /Could not get the "x" lock/);
  kv.data.delete('lock:x'); // what the storage does when the ttl runs out
  assert.equal(await lock.run('x', async () => 'now'), 'now');
});

test('only the holder releases the lock, and a failing job still releases it', async () => {
  const kv = fakeKv();
  const lock = createLock(kv, { sleep: noSleep, makeToken: () => 'mine' });
  await assert.rejects(lock.run('x', async () => { throw new Error('work failed'); }), /work failed/);
  assert.equal(kv.data.has('lock:x'), false);
  await lock.run('x', async () => { kv.data.set('lock:x', { token: 'taken over after expiry' }); });
  assert.deepEqual(kv.data.get('lock:x'), { token: 'taken over after expiry' }, "someone else's lock is left alone");
});

test('without an atomic set in the storage, or when it cannot lock, the work runs unlocked as before', async () => {
  const plain = { get: async () => undefined, set: async () => {}, delete: async () => {} };
  assert.equal(await createLock(plain).run('x', async () => 'ok'), 'ok');
  const cannot = { ...plain, setIfAbsent: async () => null };
  assert.equal(await createLock(cannot).run('x', async () => 'ok2'), 'ok2');
});
