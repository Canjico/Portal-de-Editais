import test from 'node:test';
import assert from 'node:assert/strict';
import { createSingleFlight } from '../bootstrap-utils.js';

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
