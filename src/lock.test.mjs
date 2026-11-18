import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLock, isKeyExistsError } from './lock.js';
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
    // The holder works for a few turns of the event loop, the same unit the waiters' sleep is counted in, so the test does not
    // depend on how fast the machine is (a real timer here made it fail whenever 200 waits were shorter than the work).
    for (let turn = 0; turn < 3; turn += 1) await noSleep();
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

test('a refused "set only if absent" is read as "the key exists" by its code, its message or its HTTP status, and nothing else is', () => {
  assert.equal(isKeyExistsError({ code: 'KEY_ALREADY_EXISTS', message: 'x' }), true);
  assert.equal(isKeyExistsError({ code: 'CONFLICT', message: 'x' }), true);
  assert.equal(isKeyExistsError(new Error('The key already exists')), true);
  assert.equal(isKeyExistsError({ code: 'X', message: 'y', responseDetails: { status: 409 } }), true);
  assert.equal(isKeyExistsError({ code: 'X', message: 'y', responseDetails: { status: 412 } }), true);
  // Anything else means the storage cannot lock (the work then runs unlocked, with a warning in the log).
  assert.equal(isKeyExistsError({ code: 'INTERNAL_ERROR', message: 'boom', responseDetails: { status: 500 } }), false);
  assert.equal(isKeyExistsError(new Error('network down')), false);
  assert.equal(isKeyExistsError(undefined), false);
  assert.equal(isKeyExistsError(null), false);
});

test('a lock whose own lease has run out is taken over at once, and a live one is not', async () => {
  let now = 1_000_000;
  const kv = fakeKv({ 'lock:x': { token: 'dead', expiresAt: now - 60_000 } }); // the holder crashed a minute ago; the key was never deleted
  const lock = createLock(kv, { sleep: noSleep, attempts: 3, nowMs: () => now });
  assert.equal(await lock.run('x', async () => 'ran'), 'ran', 'taken over, no waiting');
  assert.equal(kv.data.has('lock:x'), false, 'and released');

  const live = fakeKv({ 'lock:y': { token: 'alive', expiresAt: now + 20_000 } });
  const waiting = createLock(live, { sleep: noSleep, attempts: 3, nowMs: () => now });
  await assert.rejects(() => waiting.run('y', async () => 'never'), /Could not get the "y" lock/);
  assert.equal(live.data.get('lock:y').token, 'alive', 'a live lock is left alone');
});

test('a lock a few seconds past its lease is still respected (clocks of two servers differ), a minute past is not', async () => {
  const now = 5_000_000;
  const justOver = fakeKv({ 'lock:z': { token: 'a', expiresAt: now - 2_000 } });
  await assert.rejects(() => createLock(justOver, { sleep: noSleep, attempts: 2, nowMs: () => now }).run('z', async () => 1), /Could not get/);
  const longOver = fakeKv({ 'lock:z': { token: 'a', expiresAt: now - 60_000 } });
  assert.equal(await createLock(longOver, { sleep: noSleep, attempts: 2, nowMs: () => now }).run('z', async () => 1), 1);
});

test('only the record that was judged expired is deleted: a lock taken over in the meantime survives', async () => {
  let now = 9_000_000;
  const kv = fakeKv({ 'lock:w': { token: 'old', expiresAt: now - 60_000 } });
  const realGet = kv.get.bind(kv);
  let reads = 0;
  kv.get = async (key) => {
    reads += 1;
    // After the first look at the stale record, somebody else takes the lock over.
    if (reads === 2) kv.data.set('lock:w', { token: 'new', expiresAt: now + 30_000 });
    return realGet(key);
  };
  const lock = createLock(kv, { sleep: noSleep, attempts: 2, nowMs: () => now });
  await assert.rejects(() => lock.run('w', async () => 'never'), /Could not get/);
  assert.equal(kv.data.get('lock:w').token, 'new', 'the new holder was not deleted');
});
