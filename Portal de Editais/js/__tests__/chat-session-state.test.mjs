import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendConversationTurn,
  clearChatSessionState,
  createChatSessionState,
  loadChatSessionState,
  restoreConversationHistory,
  saveChatSessionState,
  setActiveEditalContextInState,
  setLatestAssistantConversationTurn,
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
  assert.equal(restored.activeTitle, 'Edital Teste Sessao');
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

test('historico preserva metadados de UI das opcoes do dashboard', () => {
  const storage = createMemoryStorage();
  let state = createChatSessionState();
  state = appendConversationTurn(state, 'user', 'Mostre oportunidades para tecnologia e inovacao');
  state = appendConversationTurn(state, 'assistant', 'Separei alguns editais abaixo.', {
    ui: {
      type: 'dashboard_options',
      result_ids: [101, 102],
      search_payload: {
        intent: 'edital_search',
        query: 'tecnologia inovacao',
        total: 2,
        result_ids: [101, 102],
        filters: {
          keywords: ['tecnologia', 'inovacao'],
        },
      },
      options: [
        { action: 'open_edital', id: 101, title: 'Edital 101', meta: 'FINEP' },
        { action: 'view_all', title: 'Ver todos no painel (2)', payload: { result_ids: [101, 102], total: 2 } },
      ],
    },
  });

  saveChatSessionState(state, storage);
  const restored = loadChatSessionState(storage);
  const history = restoreConversationHistory(restored);
  const assistantTurn = history.at(-1);

  assert.equal(assistantTurn.role, 'assistant');
  assert.equal(assistantTurn.ui.type, 'dashboard_options');
  assert.deepEqual(assistantTurn.ui.result_ids, ['101', '102']);
  assert.equal(assistantTurn.ui.search_payload.query, 'tecnologia inovacao');
  assert.equal(assistantTurn.ui.options.length, 2);
  assert.equal(assistantTurn.ui.options[0].id, '101');
});

test('setLatestAssistantConversationTurn atualiza ultima resposta assistant preservando ui', () => {
  let state = createChatSessionState();
  state = appendConversationTurn(state, 'user', 'Mostre oportunidades para tecnologia');
  state = appendConversationTurn(state, 'assistant', 'Resposta inicial');
  state = setLatestAssistantConversationTurn(state, {
    text: 'Separei os editais abaixo.',
    ui: {
      type: 'dashboard_options',
      result_ids: [201],
      search_payload: {
        intent: 'edital_search',
        total: 1,
        result_ids: [201],
      },
      options: [
        { action: 'open_edital', id: 201, title: 'Edital 201' },
      ],
    },
  });

  const history = restoreConversationHistory(state);

  assert.equal(history.length, 2);
  assert.equal(history.at(-1).role, 'assistant');
  assert.equal(history.at(-1).text, 'Separei os editais abaixo.');
  assert.equal(history.at(-1).ui.type, 'dashboard_options');
  assert.deepEqual(history.at(-1).ui.result_ids, ['201']);
});

test('setLatestAssistantConversationTurn adiciona assistant quando nao existe resposta no turno atual', () => {
  let state = createChatSessionState();
  state = appendConversationTurn(state, 'user', 'Mostre oportunidades para inovacao');
  state = setLatestAssistantConversationTurn(state, 'Encontrei 2 editais.');

  let history = restoreConversationHistory(state);
  assert.equal(history.length, 2);
  assert.equal(history.at(-1).role, 'assistant');
  assert.equal(history.at(-1).text, 'Encontrei 2 editais.');

  state = appendConversationTurn(state, 'user', 'Da FINEP');
  state = setLatestAssistantConversationTurn(state, {
    text: 'Filtrei por FINEP.',
    ui: {
      type: 'dashboard_options',
      result_ids: [301],
      options: [{ action: 'open_edital', id: 301, title: 'Edital FINEP' }],
    },
  });

  history = restoreConversationHistory(state);
  assert.equal(history.length, 4);
  assert.equal(history.at(-1).role, 'assistant');
  assert.equal(history.at(-1).ui.result_ids[0], '301');
});
