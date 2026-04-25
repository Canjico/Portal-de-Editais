import test from 'node:test';
import assert from 'node:assert/strict';
import { createAbortableRequestTracker } from '../chat-stream-controller.js';
import {
  applyChatStreamPayload,
  parseSseDataPayload,
  readSsePayloadsFromBuffer,
} from '../chat-stream-sse.js';

test('parseSseDataPayload interpreta evento SSE valido', () => {
  const payload = parseSseDataPayload(
    [
      'event: message',
      'data: {"type":"delta","text":"Resposta parcial"}',
    ].join('\n')
  );

  assert.deepEqual(payload, { type: 'delta', text: 'Resposta parcial' });
});

test('parseSseDataPayload ignora comentarios/linhas invalidas e nao quebra em JSON invalido', () => {
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

test('readSsePayloadsFromBuffer lida com multiplos blocos por chunk e bloco parcial final', () => {
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

test('abortActiveController nao deixa estado do stream travado', () => {
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

test('applyChatStreamPayload acumula deltas incrementalmente', () => {
  let state = applyChatStreamPayload(null, { type: 'start' });
  state = applyChatStreamPayload(state, { type: 'delta', text: 'Ola' });
  state = applyChatStreamPayload(state, { type: 'delta', text: ', mundo' });

  assert.equal(state.text, 'Ola, mundo');
  assert.equal(state.isTyping, true);
  assert.equal(state.done, false);
});

test('applyChatStreamPayload finaliza no done e remove typing', () => {
  const state = applyChatStreamPayload(
    { text: 'Resposta parcial', isTyping: true, done: false },
    { type: 'done' }
  );

  assert.equal(state.done, true);
  assert.equal(state.isTyping, false);
  assert.equal(state.text, 'Resposta parcial');
});

test('applyChatStreamPayload atualiza fontes no evento sources', () => {
  const state = applyChatStreamPayload(
    { text: 'Resposta', sources: [] },
    {
      type: 'sources',
      sources: [{ source_name: 'Card X', source_url: 'https://example.com/x' }],
    }
  );

  assert.equal(Array.isArray(state.sources), true);
  assert.equal(state.sources.length, 1);
  assert.equal(state.sources[0].source_name, 'Card X');
});

test('applyChatStreamPayload sinaliza erro para acionar fallback legado', () => {
  const state = applyChatStreamPayload(
    { text: 'Parcial', done: false, isTyping: true },
    { type: 'error', message: 'falha-stream' }
  );

  assert.equal(state.done, true);
  assert.equal(state.isTyping, false);
  assert.equal(state.error, 'falha-stream');
});
