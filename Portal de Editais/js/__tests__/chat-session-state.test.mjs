import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendConversationTurn,
  clearChatSessionState,
  createChatSessionState,
  loadChatSessionState,
  saveChatSessionState,
  setActiveEditalContextInState,
} from '../chat-session-state.js';

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

test('memória temporária permanece durante a sessão ativa', () => {
  const storage = createMemoryStorage();
  let state = createChatSessionState();
  state = setActiveEditalContextInState(state, { id: 77, titulo: 'Edital Teste Sessao' });
  state = appendConversationTurn(state, 'user', 'qual o prazo desse edital?');
  state = appendConversationTurn(state, 'assistant', 'O prazo final é 30/06/2026.');
  saveChatSessionState(state, storage);

  const restored = loadChatSessionState(storage);
  assert.equal(restored.activeContextType, 'edital');
  assert.equal(restored.activeEntityId, '77');
  assert.equal(restored.conversationHistory.length >= 2, true);
  assert.equal(restored.conversationHistory.at(-1).role, 'assistant');
});

test('memória reseta ao iniciar sessão limpa (nova aba/janela)', () => {
  const storageA = createMemoryStorage();
  const storageB = createMemoryStorage();

  const stateA = saveChatSessionState(createChatSessionState(), storageA);
  clearChatSessionState(storageA);

  const afterClear = loadChatSessionState(storageA);
  const freshSession = loadChatSessionState(storageB);

  assert.notEqual(afterClear.sessionId, stateA.sessionId);
  assert.equal(afterClear.conversationHistory.length, 0);
  assert.equal(freshSession.conversationHistory.length, 0);
  assert.notEqual(afterClear.sessionId, freshSession.sessionId);
});

