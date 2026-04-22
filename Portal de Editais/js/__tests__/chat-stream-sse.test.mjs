import test from 'node:test';
import assert from 'node:assert/strict';
import { createAbortableRequestTracker } from '../chat-stream-controller.js';
import {
  parseSseDataPayload,
  readSsePayloadsFromBuffer,
} from '../chat-stream-sse.js';

test('parseSseDataPayload interpreta evento SSE válido', () => {
  const payload = parseSseDataPayload(
    [
      'event: message',
      'data: {"type":"delta","text":"Resposta parcial"}',
    ].join('\n')
  );

  assert.deepEqual(payload, { type: 'delta', text: 'Resposta parcial' });
});

test('parseSseDataPayload ignora comentários/linhas inválidas e não quebra em JSON inválido', () => {
  let invalidPayloadText = '';
  const payload = parseSseDataPayload(
    [
      ': heartbeat',
      'id: 123',
      'data: {"type":"delta"',
    ].join('\n'),
    {
      onInvalidJson(rawPayload) {
        invalidPayloadText = rawPayload;
      },
    }
  );

  assert.equal(payload, null);
  assert.equal(invalidPayloadText, '{"type":"delta"');
});

test('readSsePayloadsFromBuffer lida com múltiplos blocos por chunk e bloco parcial final', () => {
  const firstPass = readSsePayloadsFromBuffer(
    '',
    [
      'data: {"type":"delta","text":"A"}',
      '',
      'data: {"type":"delta","text":"B"}',
      '',
      'data: {"type":"done"',
    ].join('\n')
  );

  assert.deepEqual(firstPass.payloads, [
    { type: 'delta', text: 'A' },
    { type: 'delta', text: 'B' },
  ]);
  assert.equal(firstPass.remainder, 'data: {"type":"done"');

  const secondPass = readSsePayloadsFromBuffer(firstPass.remainder, '}\n\n');
  assert.deepEqual(secondPass.payloads, [{ type: 'done' }]);
  assert.equal(secondPass.remainder, '');
});

test('abortActiveController não deixa estado do stream travado', () => {
  const tracker = createAbortableRequestTracker();
  let abortCalls = 0;
  const controller = {
    abort() {
      abortCalls += 1;
    },
  };

  tracker.setActiveController(controller);
  assert.equal(tracker.hasActiveController(), true);
  assert.equal(tracker.abortActiveController(), true);
  assert.equal(abortCalls, 1);
  assert.equal(tracker.hasActiveController(), false);
});
