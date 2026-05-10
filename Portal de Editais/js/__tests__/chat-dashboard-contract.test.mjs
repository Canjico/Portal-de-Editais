import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dashboardPlanToLegacySearchPayload,
  normalizeDashboardAssistantPlan,
  scopeDisclosure,
} from '../chat-dashboard-contract.js';

test('normaliza contrato estruturado e preserva campos principais', () => {
  const out = normalizeDashboardAssistantPlan({
    intent: 'list_cards',
    scope: 'all_loaded_cards',
    filters: {
      estado: ['sp', 'SP'],
      status: ['abertos'],
      instituicao: ['FAPESP'],
      deadline_days: 15,
    },
    sort: { field: 'prazoFinal', direction: 'asc' },
    matched_card_ids: ['1', '2', '2'],
    result_summary: { total: 2 },
    ui_action: { type: 'highlight_cards_and_offer_filter' },
    suggested_reply: 'Encontrei 2 editais.',
  });

  assert.equal(out.intent, 'list_cards');
  assert.equal(out.scope, 'all_loaded_cards');
  assert.deepEqual(out.filters.estado, ['SP']);
  assert.deepEqual(out.filters.status, ['aberto']);
  assert.deepEqual(out.matched_card_ids, ['1', '2']);
  assert.equal(out.result_summary.total, 2);
  assert.equal(out.ui_action.type, 'highlight_cards_and_offer_filter');
  assert.doesNotMatch(out.suggested_reply, /Base:/);
});

test('remove url inline e limita resposta a 3 linhas', () => {
  const out = normalizeDashboardAssistantPlan({
    intent: 'count_cards',
    scope: 'visible_cards',
    suggested_reply: [
      'Linha 1',
      'Linha 2 https://exemplo.com',
      'Linha 3',
      'Linha 4',
    ].join('\n'),
  });

  const lines = out.suggested_reply.split('\n');
  assert.equal(lines.length <= 3, true);
  assert.equal(/https?:\/\//i.test(out.suggested_reply), false);
  assert.doesNotMatch(out.suggested_reply, /Base:/i);
});

test('converte contrato para payload legado de busca', () => {
  const plan = normalizeDashboardAssistantPlan({
    intent: 'apply_filter',
    scope: 'all_loaded_cards',
    filters: {
      estado: ['SP'],
      status: ['aberto'],
      instituicao: ['FAPESP'],
      deadline_days: 7,
      keywords: ['inovacao'],
    },
    matched_card_ids: ['10', '11'],
    result_summary: { total: 2 },
    suggested_reply: 'Encontrei 2.',
  });

  const payload = dashboardPlanToLegacySearchPayload(plan);
  assert.equal(payload.intent, 'edital_search');
  assert.equal(payload.total, 2);
  assert.deepEqual(payload.result_ids, ['10', '11']);
  assert.deepEqual(payload.filters.estado, ['SP']);
  assert.deepEqual(payload.filters.status, ['aberto']);
  assert.equal(payload.filters.deadline_range, 'next_7_days');
});

test('scope disclosure segue o contrato esperado', () => {
  assert.equal(scopeDisclosure('all_loaded_cards'), 'todos os cards carregados');
  assert.equal(scopeDisclosure('visible_cards'), 'cards visiveis no painel');
  assert.equal(scopeDisclosure('focused_cards'), 'cards em foco da conversa');
});
