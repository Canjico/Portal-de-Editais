import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSingleFlight,
  runAfterFirstPaint,
  runWhenIdle,
} from '../bootstrap-utils.js';

test('createSingleFlight deduplica chamadas concorrentes e subsequentes', async () => {
  let callCount = 0;
  const task = async () => {
    callCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { ok: true, callCount };
  };

  const runOnce = createSingleFlight(task);

  const [a, b, c] = await Promise.all([runOnce(), runOnce(), runOnce()]);
  assert.equal(callCount, 1);
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);

  const again = await runOnce();
  assert.equal(callCount, 1);
  assert.deepEqual(again, a);
});

test('runAfterFirstPaint agenda execucao apos requestAnimationFrame', async () => {
  const events = [];
  const windowObject = {
    requestAnimationFrame(callback) {
      events.push('raf');
      callback(16);
      return 1;
    },
  };

  const promise = runAfterFirstPaint(() => {
    events.push('task');
  }, { windowObject });
  events.push('scheduled');

  await promise;
  assert.deepEqual(events, ['raf', 'scheduled', 'task']);
});

test('runWhenIdle usa requestIdleCallback quando disponivel', async () => {
  const events = [];
  let idleTimeout = null;
  const windowObject = {
    requestIdleCallback(callback, options) {
      idleTimeout = options?.timeout ?? null;
      events.push('idle');
      callback({
        didTimeout: false,
        timeRemaining: () => 8,
      });
      return 1;
    },
  };

  const promise = runWhenIdle(() => {
    events.push('task');
  }, { windowObject, timeout: 700 });
  events.push('scheduled');

  await promise;

  assert.equal(idleTimeout, 700);
  assert.deepEqual(events, ['idle', 'scheduled', 'task']);
});
