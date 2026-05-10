import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDashboardAssistantMemory,
  runDashboardAssistantSemanticQuery,
} from '../chat-card-semantics.js';

const FIXED_NOW = new Date('2026-04-02T10:00:00Z');

const SAMPLE_CARDS = [
  {
    id: 1,
    titulo: 'FAPESP Inovacao SP 2026',
    instituicao: 'FAPESP',
    estado: 'SP',
    status: 'Aberto',
    data_fechamento: '2026-04-25',
    valor_total: 'R$ 500.000',
    descricao: 'Fomento para pesquisa e inovacao',
    share_link: 'https://exemplo.com/1',
    data_publicacao: '2026-03-01',
    relevance_score: 90,
    is_highlighted: true,
  },
  {
    id: 2,
    titulo: 'FINEP Nacional 2026',
    instituicao: 'FINEP',
    estado: 'SP',
    status: 'Encerrado',
    data_fechamento: '2026-03-10',
    valor_total: 'Nao informado',
    descricao: 'Edital encerrado',
    share_link: 'https://exemplo.com/2',
    data_publicacao: '2026-01-12',
    relevance_score: 40,
  },
  {
    id: 3,
    titulo: 'FACEPE Pernambuco Aberto',
    instituicao: 'FACEPE',
    estado: 'PE',
    status: 'Aberto',
    data_fechamento: '2026-04-15',
    valor_total: 'R$ 120.000',
    descricao: 'Inovacao em Pernambuco',
    share_link: 'https://exemplo.com/3',
    data_publicacao: '2026-02-05',
    relevance_score: 65,
  },
  {
    id: 4,
    titulo: 'FAPESP Pesquisa Aplicada',
    instituicao: 'FAPESP',
    estado: 'SP',
    status: 'Aberto',
    data_fechamento: '2026-05-20',
    valor_total: '',
    descricao: 'Pesquisa aplicada',
    share_link: 'https://exemplo.com/4',
    data_publicacao: '2026-02-20',
    relevance_score: 80,
  },
  {
    id: 5,
    titulo: 'FUNCAP Ceara Tecnologia',
    instituicao: 'FUNCAP',
    estado: 'CE',
    status: 'Aberto',
    data_fechamento: '2026-04-08',
    valor_total: 'R$ 250.000',
    descricao: 'Tecnologia no Ceara',
    share_link: 'https://exemplo.com/5',
    data_publicacao: '2026-03-10',
    relevance_score: 70,
  },
  {
    id: 6,
    titulo: 'Programa SPARK Rio',
    instituicao: 'FAPERJ',
    estado: 'RJ',
    status: 'Aberto',
    data_fechamento: '2026-04-18',
    valor_total: 'R$ 80.000',
    descricao: 'Tem SP no titulo, mas estado RJ',
    share_link: 'https://exemplo.com/6',
    data_publicacao: '2026-03-12',
    relevance_score: 50,
  },
];

function ask(question, memory = createDashboardAssistantMemory()) {
  return runDashboardAssistantSemanticQuery({
    question,
    cards: SAMPLE_CARDS,
    visibleCards: SAMPLE_CARDS,
    memory,
    now: FIXED_NOW,
    uiState: {
      appliedFilters: { estado: [], instituicao: [], area: [] },
      kpiFilter: 'all',
      onlyFavoritos: false,
      assistantFilterLabels: [],
    },
  });
}

test('quais sao os editais de SP filtra por campo estado', () => {
  const out = ask('quais sao os editais de SP?');
  assert.equal(out.handled, true);
  assert.equal(out.total, 3);
  assert.ok(out.results.every((card) => card.estadoUf === 'SP'));
  assert.ok(!out.results.some((card) => card.id === 6));
});

test('quais sao os editais da FAPESP em SP combina instituicao e estado', () => {
  const out = ask('quais sao os editais da FAPESP em SP?');
  assert.equal(out.total, 2);
  assert.deepEqual(out.results.map((card) => card.id), [1, 4]);
});

test('quais estao abertos usa status estruturado', () => {
  const out = ask('quais estao abertos?');
  assert.equal(out.total, 5);
  assert.ok(out.results.every((card) => card.status === 'aberto'));
});

test('quais vencem este mes filtra por prazo final do mes atual', () => {
  const out = ask('quais vencem este mes?');
  assert.deepEqual(out.results.map((card) => card.id), [5, 3, 6, 1]);
});

test('qual edital tem maior prazo retorna o card com prazo mais distante', () => {
  const out = ask('qual edital tem maior prazo?');
  assert.equal(out.total, 1);
  assert.equal(out.results[0].id, 4);
});

test('me explique esse card usa memoria da ultima lista', () => {
  const first = ask('quais sao os editais de SP?');
  const second = ask('me explique esse card', first.nextMemory);
  assert.equal(second.intent, 'explain_specific_card');
  assert.match(second.reply, /FAPESP Inovacao SP 2026/i);
});

test('quantos editais encerrados existem retorna contagem real', () => {
  const out = ask('quantos editais encerrados existem?');
  assert.equal(out.intent, 'count_cards');
  assert.equal(out.total, 1);
  assert.match(out.reply, /1 card\(s\)/i);
});

test('quais tem valor de fomento nao informado filtra campo valor', () => {
  const out = ask('quais tem valor de fomento nao informado?');
  assert.deepEqual(out.results.map((card) => card.id), [4, 2]);
});

test('ordene os editais por prazo ordena em ordem crescente', () => {
  const out = ask('ordene os editais por prazo');
  assert.equal(out.intent, 'sort_cards');
  assert.deepEqual(out.results.slice(0, 3).map((card) => card.id), [2, 5, 3]);
});

test('quais sao os editais de Pernambuco mapeia estado por nome', () => {
  const out = ask('quais sao os editais de Pernambuco?');
  assert.equal(out.total, 1);
  assert.equal(out.results[0].estadoUf, 'PE');
  assert.equal(out.results[0].id, 3);
});
