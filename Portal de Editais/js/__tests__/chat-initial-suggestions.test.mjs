import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createChatSessionState,
  loadChatSessionState,
  saveChatSessionState,
  clearChatSessionState,
} from '../chat-session-state.js';
import {
  markInitialChatInteraction,
  shouldShowInitialChatSuggestions,
} from '../chat-initial-suggestions.js';

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

test('sugestoes aparecem ao abrir chat em sessao nova', () => {
  const freshState = createChatSessionState();
  assert.equal(shouldShowInitialChatSuggestions(freshState, { hasActiveContext: false }), true);
});

test('primeira mensagem enviada esconde sugestoes', () => {
  const freshState = createChatSessionState();
  const interactedState = markInitialChatInteraction(freshState, 'message_send');
  assert.equal(interactedState.hasUserInteracted, true);
  assert.equal(interactedState.hasSentFirstMessage, true);
  assert.equal(shouldShowInitialChatSuggestions(interactedState, { hasActiveContext: false }), false);
});

test('clique em sugestao rapida conta como primeira interacao', () => {
  const freshState = createChatSessionState();
  const interactedState = markInitialChatInteraction(freshState, 'quick_prompt');
  assert.equal(interactedState.hasUserInteracted, true);
  assert.equal(interactedState.firstInteractionSource, 'quick_prompt');
  assert.equal(shouldShowInitialChatSuggestions(interactedState, { hasActiveContext: false }), false);
});

test('sugestoes nao reaparecem na mesma sessao', () => {
  const storage = createMemoryStorage();
  const interactedState = markInitialChatInteraction(createChatSessionState(), 'message_send');
  saveChatSessionState(interactedState, storage);
  const restored = loadChatSessionState(storage);
  assert.equal(restored.hasUserInteracted, true);
  assert.equal(shouldShowInitialChatSuggestions(restored, { hasActiveContext: false }), false);
});

test('sugestoes reaparecem em sessao limpa', () => {
  const storage = createMemoryStorage();
  const interactedState = markInitialChatInteraction(createChatSessionState(), 'message_send');
  saveChatSessionState(interactedState, storage);
  clearChatSessionState(storage);
  const fresh = loadChatSessionState(storage);
  assert.equal(fresh.hasUserInteracted, false);
  assert.equal(shouldShowInitialChatSuggestions(fresh, { hasActiveContext: false }), true);
});

