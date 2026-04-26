import test from 'node:test';
import assert from 'node:assert/strict';
import { createAbortableRequestTracker } from '../chat-stream-controller.js';
import {
  applyChatStreamPayload,
  parseSseDataPayload,
  readSsePayloadsFromBuffer,
} from '../chat-stream-sse.js';
import {
  buildSourcesDetails,
  normalizeSources,
} from '../chat-sources.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || '').toUpperCase();
    this.children = [];
    this.attributes = {};
    this.className = '';
    this.textContent = '';
    this.href = '';
    this.target = '';
    this.rel = '';
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}

const fakeDocument = {
  createElement(tagName) {
    return new FakeElement(tagName);
  },
};

function findElement(root, predicate) {
  if (!root) return null;
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

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

test('normalizeSources aceita source_name, source_url e source_type do backend', () => {
  const sources = normalizeSources([
    {
      source_type: 'edital_attachment',
      source_name: 'arquivo.pdf',
      source_url: 'https://example.com/arquivo.pdf',
      edital_id: 42,
      status: 'ok',
    },
  ]);

  assert.equal(sources.length, 1);
  assert.equal(sources[0].title, 'arquivo.pdf');
  assert.equal(sources[0].url, 'https://example.com/arquivo.pdf');
  assert.equal(sources[0].type, 'edital_attachment');
  assert.equal(sources[0].editalId, 42);
});

test('buildSourcesDetails renderiza source_url como link clicavel', () => {
  const details = buildSourcesDetails(
    [
      {
        source_type: 'edital_attachment',
        source_name: 'regulamento.pdf',
        source_url: 'https://example.com/regulamento.pdf',
        status: 'ok',
      },
    ],
    fakeDocument
  );

  const link = findElement(details, (node) => node.tagName === 'A');
  assert.ok(link);
  assert.equal(link.href, 'https://example.com/regulamento.pdf');
  assert.match(link.textContent, /Anexo: regulamento\.pdf/);
});

test('normalizeSources preserva fonte com erro sem url', () => {
  const sources = normalizeSources([
    {
      source_type: 'edital_attachment',
      source_name: 'arquivo invalido',
      status: 'error',
      error: 'Nao foi possivel extrair texto',
    },
  ]);

  assert.equal(sources.length, 1);
  assert.equal(sources[0].title, 'arquivo invalido');
  assert.equal(sources[0].url, '');
  assert.equal(sources[0].status, 'error');
  assert.equal(sources[0].type, 'edital_attachment');
  assert.equal(sources[0].error, 'Nao foi possivel extrair texto');
});
