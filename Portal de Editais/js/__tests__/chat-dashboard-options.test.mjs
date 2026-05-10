import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDashboardChatOptionsFromPayload,
  filterDashboardOptionsAgainstPayload,
  resolveDashboardCardsFromPayload,
} from '../chat-dashboard-options.js';

const CARDS = [
  {
    id: 'sp-open-1',
    titulo: 'FAPESP Inovacao SP',
    instituicao: 'FAPESP',
    estado: 'SP',
    status: 'Aberto',
    data_fechamento: '2030-05-10',
  },
  {
    id: 'sp-open-2',
    titulo: 'Tecnologia Sao Paulo',
    instituicao: 'USP',
    estado: 'SP',
    is_open: true,
    data_fechamento: '2030-05-12',
  },
  {
    id: 'sp-closed-1',
    titulo: 'SP Encerrado',
    instituicao: 'FAPESP',
    estado: 'SP',
    status: 'Encerrado',
    data_fechamento: '2020-01-01',
  },
  {
    id: 'pe-open-1',
    titulo: 'FACEPE Pernambuco',
    instituicao: 'FACEPE',
    estado: 'PE',
    status: 'Aberto',
    data_fechamento: '2030-05-20',
  },
  {
    id: 'sc-open-1',
    titulo: 'FAPESC Santa Catarina',
    instituicao: 'FAPESC',
    estado: 'SC',
    status: 'Aberto',
    data_fechamento: '2030-05-21',
  },
];

const SP_OPEN_PAYLOAD = {
  intent: 'edital_search',
  query: 'Quais editais estao abertos em SP?',
  total: 2,
  result_ids: ['sp-open-1', 'sp-open-2', 'pe-open-1'],
  filters: {
    estado: ['SP'],
    status: ['aberto'],
    deadline_range: '',
    categories: [],
    instituicoes: [],
    keywords: [],
  },
};

test('search_payload com estado SP e status aberto resolve apenas cards locais SP abertos', () => {
  const cards = resolveDashboardCardsFromPayload(CARDS, SP_OPEN_PAYLOAD);

  assert.deepEqual(cards.map((card) => card.id), ['sp-open-1', 'sp-open-2']);
  assert.ok(cards.every((card) => card.estado === 'SP'));
});

test('opcoes inconsistentes do backend sao descartadas contra o payload estruturado', () => {
  const backendOptions = [
    { action: 'open_edital', id: 'sp-open-1', title: 'SP correto' },
    { action: 'open_edital', id: 'pe-open-1', title: 'PE errado' },
    { action: 'open_edital', id: 'sc-open-1', title: 'SC errado' },
  ];

  const filtered = filterDashboardOptionsAgainstPayload(backendOptions, CARDS, SP_OPEN_PAYLOAD);

  assert.deepEqual(filtered.map((option) => option.id), ['sp-open-1']);
});

test('attachEditaisOptions usa payload para reconstruir cards locais e view_all com os mesmos result_ids', () => {
  const out = buildDashboardChatOptionsFromPayload({
    cards: CARDS,
    payload: SP_OPEN_PAYLOAD,
    query: 'Quais editais estao abertos em SP?',
    formatDate: (value) => value,
    formatEstadoLabel: (value) => value,
  });

  const cardOptions = out.options.filter((option) => option.action === 'open_edital');
  assert.deepEqual(cardOptions.map((option) => option.id), ['sp-open-1', 'sp-open-2']);

  const viewAll = out.options.find((option) => option.action === 'view_all');
  assert.ok(viewAll);
  assert.deepEqual(viewAll.payload.result_ids, ['sp-open-1', 'sp-open-2']);
  assert.equal(viewAll.payload.total, 2);
  assert.deepEqual(viewAll.payload.filters.estado, ['SP']);
  assert.deepEqual(viewAll.payload.filters.status, ['aberto']);
});
