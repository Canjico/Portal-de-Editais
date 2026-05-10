import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTopicTransition, buildTopicDisambiguationNotice } from '../chat-topic-detector.js';

const BASE_STATE = {
  activeContextType: 'edital',
  activeEntityId: '42',
  activeEntityTitle: 'Finep Mais Inovacao Brasil - Rodada 2',
  conversationHistory: [
    { role: 'assistant', text: 'Estamos falando do edital Finep Mais Inovacao Brasil.', createdAt: '2026-04-01T12:00:00Z' },
  ],
  shortSummary: 'Conversa sobre detalhes do edital Finep.',
  topicThresholds: { autoSwitch: 0.9, ambiguousMin: 0.6 },
};

test('detectTopicTransition mantém contexto com referência anafórica', () => {
  const out = detectTopicTransition({
    message: 'qual o objetivo desse edital?',
    state: BASE_STATE,
  });

  assert.equal(out.decision, 'stay_on_topic');
  assert.equal(out.reason, 'context_reference');
  assert.ok(out.confidence >= 0.9);
});

test('detectTopicTransition troca quando usuário usa comando explícito de saída', () => {
  const out = detectTopicTransition({
    message: 'sair',
    state: BASE_STATE,
  });

  assert.equal(out.decision, 'switch_topic');
  assert.equal(out.reason, 'explicit_exit');
  assert.equal(out.confidence, 1);
});

test('detectTopicTransition marca pedido ambíguo como ambiguous', () => {
  const out = detectTopicTransition({
    message: 'quero mudar',
    state: BASE_STATE,
  });

  assert.equal(out.decision, 'ambiguous');
  assert.ok(out.confidence >= 0.6 && out.confidence < 0.9);
});

test('buildTopicDisambiguationNotice orienta digitar "sair"', () => {
  const text = buildTopicDisambiguationNotice(BASE_STATE);
  assert.match(text, /sair/i);
});

