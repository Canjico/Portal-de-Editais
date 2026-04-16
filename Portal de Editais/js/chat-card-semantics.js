import { parseAnyDateToTime } from './search-date-utils.js';

const DEFAULT_MAX_LIST_ITEMS = 5;
const MAX_MEMORY_RESULT_IDS = 120;

const CARD_STATUS_OPEN_HINTS = [
  'aberto', 'abertos', 'aberta', 'abertas', 'em aberto', 'vigente', 'vigentes', 'ativo', 'ativos',
];

const CARD_STATUS_CLOSED_HINTS = [
  'encerrado', 'encerrados', 'encerrada', 'encerradas', 'fechado', 'fechados', 'vencido', 'vencidos', 'expirado', 'expirados',
];

const LIST_HINTS = [
  'quais', 'mostre', 'listar', 'liste', 'me mostra', 'me mostre', 'me traga', 'quero ver',
];

const COUNT_HINTS = [
  'quantos', 'quantas', 'qtd', 'quantidade', 'numero de', 'total de',
];

const SUMMARY_HINTS = [
  'resuma', 'resumir', 'resumo', 'sintetize', 'visao geral',
];

const EXPLAIN_FILTER_HINTS = [
  'filtro', 'filtros', 'filtrar', 'como filtrar', 'como funciona filtro',
];

const EXPLAIN_CARD_HINTS = [
  'esse edital', 'este edital', 'esse card', 'este card', 'me explique esse', 'explica esse', 'detalhes desse',
  'qual o prazo desse', 'qual o prazo deste', 'qual o valor desse', 'quem pode participar desse',
];

const COMPARE_HINTS = [
  'compare', 'comparar', 'comparacao', 'comparativo', 'diferenca entre',
];

const ORDER_HINTS = [
  'ordene', 'ordenar', 'ordenado', 'organize', 'classifique',
];

const VISIBLE_SCOPE_HINTS = [
  'na tela', 'visiveis', 'visiveis agora', 'do painel', 'filtros aplicados', 'com os filtros atuais',
];

const LAST_SCOPE_HINTS = [
  'esses', 'essas', 'desses', 'dessas', 'destes', 'destas', 'os abertos', 'os encerrados', 'os de', 'as de', 'esses da', 'essas da',
];

const THIS_MONTH_HINTS = [
  'este mes', 'esse mes', 'neste mes', 'mes atual', 'mes corrente',
];

const NEXT_WEEK_HINTS = [
  'nesta semana', 'essa semana', 'proxima semana', 'proximos 7 dias', 'proximas 1 semana', '7 dias',
];

const FUNDING_HINTS = [
  'valor de fomento', 'valor do fomento', 'fomento', 'valor total',
];

const FUNDING_MISSING_HINTS = [
  'nao informado', 'nao informados', 'sem valor', 'sem fomento', 'nao tem valor', 'sem informacao', 'sem informacoes',
];

const FUNDING_INFORMED_HINTS = [
  'informado', 'informados', 'com valor', 'tem valor', 'com fomento',
];

const REFERENCE_FIRST_HINTS = ['primeiro', 'primeira', '1o', '1a', '1'];
const REFERENCE_SECOND_HINTS = ['segundo', 'segunda', '2o', '2a', '2'];
const REFERENCE_THIRD_HINTS = ['terceiro', 'terceira', '3o', '3a', '3'];
const REFERENCE_LAST_HINTS = ['ultimo', 'ultima', 'mais recente', 'final da lista'];

const STATE_LABELS = Object.freeze({
  BR: 'Brasil',
  AC: 'Acre',
  AL: 'Alagoas',
  AP: 'Amapa',
  AM: 'Amazonas',
  BA: 'Bahia',
  CE: 'Ceara',
  DF: 'Distrito Federal',
  ES: 'Espirito Santo',
  GO: 'Goias',
  MA: 'Maranhao',
  MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais',
  PA: 'Para',
  PB: 'Paraiba',
  PR: 'Parana',
  PE: 'Pernambuco',
  PI: 'Piaui',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul',
  RO: 'Rondonia',
  RR: 'Roraima',
  SC: 'Santa Catarina',
  SP: 'Sao Paulo',
  SE: 'Sergipe',
  TO: 'Tocantins',
});

const MONTH_ALIASES = Object.freeze({
  janeiro: 1,
  jan: 1,
  fevereiro: 2,
  fev: 2,
  marco: 3,
  mar: 3,
  abril: 4,
  abr: 4,
  maio: 5,
  mai: 5,
  junho: 6,
  jun: 6,
  julho: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  setembro: 9,
  set: 9,
  outubro: 10,
  out: 10,
  novembro: 11,
  nov: 11,
  dezembro: 12,
  dez: 12,
});

const KEYWORD_STOPWORDS = new Set([
  'a', 'as', 'o', 'os', 'um', 'uma', 'uns', 'umas',
  'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'para', 'por', 'com', 'sem', 'que', 'qual', 'quais', 'me', 'mostre', 'mostrar',
  'quero', 'tem', 'sobre', 'site', 'dashboard', 'painel', 'edital', 'editais', 'card', 'cards',
  'estado', 'instituicao', 'status', 'prazo', 'filtro', 'filtros', 'ordene', 'ordenar', 'ordem',
  'abertos', 'aberto', 'encerrado', 'encerrados', 'aberta', 'encerrada',
  'esse', 'essa', 'este', 'esta', 'esses', 'essas',
  'valor', 'fomento', 'informado', 'informados', 'nao', 'informacao',
  'mes', 'semana', 'hoje', 'agora', 'quais', 'quais sao', 'sao',
]);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueByNormalized(values) {
  const seen = new Set();
  const out = [];
  values.forEach((value) => {
    const clean = String(value || '').trim();
    if (!clean) return;
    const key = normalizeText(clean);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });
  return out;
}

function hasAnyPhrase(normalizedQuery, phrases) {
  if (!normalizedQuery) return false;
  return phrases.some((phrase) => normalizedQuery.includes(normalizeText(phrase)));
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function startOfDayFromTime(time) {
  if (!Number.isFinite(time)) return null;
  const d = new Date(time);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function parseDateDay(value) {
  const rawTime = parseAnyDateToTime(value);
  return startOfDayFromTime(rawTime);
}

function formatDatePtBr(value) {
  const time = parseDateDay(value);
  if (time === null) return 'Nao informado';
  return new Date(time).toLocaleDateString('pt-BR');
}

function formatStatusLabel(status) {
  return status === 'encerrado' ? 'Encerrado' : 'Aberto';
}

function isFundingMissingValue(value) {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  if (normalized === '-' || normalized === '--') return true;
  if (normalized === 'n a' || normalized === 'na') return true;
  if (normalized === 'nao informado' || normalized === 'nao informada') return true;
  if (normalized === 'sem informacao' || normalized === 'sem informacoes') return true;
  return false;
}

function detectStatus({ rawStatus, isOpenFallback, deadlineTime, nowStart }) {
  const normalizedStatus = normalizeText(rawStatus);
  if (normalizedStatus) {
    if (normalizedStatus.includes('encerr') || normalizedStatus.includes('fechad') || normalizedStatus.includes('vencid')) {
      return 'encerrado';
    }
    if (normalizedStatus.includes('abert') || normalizedStatus.includes('ativ') || normalizedStatus.includes('vigent')) {
      return 'aberto';
    }
  }
  if (typeof isOpenFallback === 'boolean') return isOpenFallback ? 'aberto' : 'encerrado';
  if (deadlineTime === null) return 'aberto';
  return deadlineTime >= nowStart ? 'aberto' : 'encerrado';
}

function buildStateAliasMap() {
  const map = new Map();
  Object.entries(STATE_LABELS).forEach(([uf, name]) => {
    const ufKey = normalizeText(uf);
    const nameKey = normalizeText(name);
    if (ufKey) map.set(ufKey, uf);
    if (nameKey) map.set(nameKey, uf);
  });

  map.set('sao paulo', 'SP');
  map.set('rio de janeiro', 'RJ');
  map.set('minas gerais', 'MG');
  map.set('pernambuco', 'PE');
  map.set('distrito federal', 'DF');
  map.set('brasil', 'BR');
  return map;
}

const STATE_ALIAS_TO_UF = buildStateAliasMap();
const AMBIGUOUS_STATE_ALIASES = new Set(['para']);

function resolveState(rawValue) {
  const raw = String(rawValue || '').trim();
  const normalized = normalizeText(raw);
  if (!normalized) {
    return { estadoUf: '', estadoNome: '', estadoLabel: 'Nao informado' };
  }

  if (STATE_LABELS[raw.toUpperCase()]) {
    const uf = raw.toUpperCase();
    return { estadoUf: uf, estadoNome: STATE_LABELS[uf], estadoLabel: `${uf} - ${STATE_LABELS[uf]}` };
  }

  const byPrefix = normalized.match(/^([a-z]{2})\b/);
  if (byPrefix) {
    const maybeUf = byPrefix[1].toUpperCase();
    if (STATE_LABELS[maybeUf]) {
      return { estadoUf: maybeUf, estadoNome: STATE_LABELS[maybeUf], estadoLabel: `${maybeUf} - ${STATE_LABELS[maybeUf]}` };
    }
  }

  if (STATE_ALIAS_TO_UF.has(normalized)) {
    const uf = STATE_ALIAS_TO_UF.get(normalized);
    return { estadoUf: uf, estadoNome: STATE_LABELS[uf], estadoLabel: `${uf} - ${STATE_LABELS[uf]}` };
  }

  const matchByName = Array.from(STATE_ALIAS_TO_UF.entries()).find(([alias]) => alias.length > 2 && normalized.includes(alias));
  if (matchByName) {
    const uf = matchByName[1];
    return { estadoUf: uf, estadoNome: STATE_LABELS[uf], estadoLabel: `${uf} - ${STATE_LABELS[uf]}` };
  }

  return { estadoUf: raw.toUpperCase(), estadoNome: raw, estadoLabel: raw };
}

export function normalizeAssistantCard(rawCard, { now = new Date() } = {}) {
  const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const stateInfo = resolveState(rawCard?.estado);
  const prazoFinal = firstNonEmpty(rawCard?.prazoFinal, rawCard?.data_fechamento, rawCard?.prazo, rawCard?.deadline);
  const prazoTime = parseDateDay(prazoFinal);
  const updatedAt = firstNonEmpty(
    rawCard?.atualizadoEm,
    rawCard?.data_publicacao,
    rawCard?.data_abertura,
    rawCard?.updated_at,
    rawCard?.created_at
  );
  const status = detectStatus({
    rawStatus: rawCard?.status,
    isOpenFallback: typeof rawCard?.is_open === 'boolean' ? rawCard.is_open : null,
    deadlineTime: prazoTime,
    nowStart,
  });
  const valorFomento = firstNonEmpty(rawCard?.valorFomento, rawCard?.valor_total, rawCard?.valor, rawCard?.fomento);
  const instituicao = firstNonEmpty(rawCard?.instituicao, rawCard?.instituição);

  return {
    id: rawCard?.id ?? null,
    titulo: firstNonEmpty(rawCard?.titulo, rawCard?.title, rawCard?.nome) || 'Sem titulo',
    instituicao: instituicao || 'Nao informada',
    estadoUf: stateInfo.estadoUf,
    estado: stateInfo.estadoLabel,
    status,
    prazoFinal: prazoFinal || '',
    prazoFinalTime: prazoTime,
    valorFomento: valorFomento || '',
    valorFomentoInformado: !isFundingMissingValue(valorFomento),
    descricao: firstNonEmpty(rawCard?.descricao, rawCard?.resumo, rawCard?.objetivo),
    link: firstNonEmpty(rawCard?.link, rawCard?.url, rawCard?.share_link),
    atualizadoEm: updatedAt || '',
    atualizadoEmTime: parseDateDay(updatedAt),
    area: firstNonEmpty(rawCard?.area),
    tags: Array.isArray(rawCard?.tags) ? rawCard.tags.map((item) => String(item || '').trim()).filter(Boolean) : [],
    relevanceScore: Number(rawCard?.relevance_score || 0) || 0,
    isHighlighted: Boolean(rawCard?.is_highlighted),
    source: rawCard,
  };
}

export function normalizeAssistantCards(rawCards, { now = new Date() } = {}) {
  if (!Array.isArray(rawCards)) return [];
  const seen = new Set();
  const out = [];
  rawCards.forEach((rawCard) => {
    const normalized = normalizeAssistantCard(rawCard, { now });
    const idKey = String(normalized?.id ?? '').trim();
    if (!idKey) return;
    if (seen.has(idKey)) return;
    seen.add(idKey);
    out.push(normalized);
  });
  return out;
}

function detectStateFilters(normalizedQuery) {
  if (!normalizedQuery) return [];
  const candidates = [];
  const sortedAliases = Array.from(STATE_ALIAS_TO_UF.keys()).sort((a, b) => b.length - a.length);
  sortedAliases.forEach((alias) => {
    if (!alias) return;
    if (alias.length <= 2) {
      const regex = new RegExp(`(?:^|\\s)${escapeRegExp(alias)}(?:\\s|$)`);
      if (!regex.test(normalizedQuery)) return;
    } else {
      const aliasRegex = new RegExp(`(?:^|\\s)${escapeRegExp(alias)}(?:\\s|$)`);
      if (!aliasRegex.test(normalizedQuery)) return;
      if (AMBIGUOUS_STATE_ALIASES.has(alias)) {
        const contextRegex = new RegExp(`(?:de|do|da|em|no|na|estado)\\s+${escapeRegExp(alias)}(?:\\s|$)`);
        if (!contextRegex.test(normalizedQuery)) return;
      }
    }
    candidates.push(STATE_ALIAS_TO_UF.get(alias));
  });
  return uniqueByNormalized(candidates.map((uf) => String(uf || '').toUpperCase())).filter(Boolean);
}

function buildInstitutionCatalog(cards) {
  const items = [];
  const seen = new Set();
  cards.forEach((card) => {
    const label = String(card?.instituicao || '').trim();
    const normalized = normalizeText(label);
    if (!label || !normalized) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    items.push({ label, normalized });
  });
  items.sort((a, b) => b.normalized.length - a.normalized.length);
  return items;
}

function detectInstitutionFilters(normalizedQuery, cards) {
  if (!normalizedQuery) return [];
  const catalog = buildInstitutionCatalog(cards);
  const matches = [];

  catalog.forEach((item) => {
    if (!item?.normalized) return;
    const regex = new RegExp(`(?:^|\\s)${escapeRegExp(item.normalized)}(?:\\s|$)`);
    if (regex.test(normalizedQuery)) matches.push(item.label);
  });

  return uniqueByNormalized(matches).slice(0, 6);
}

function detectStatusFilters(normalizedQuery) {
  const wantsOpen = hasAnyPhrase(normalizedQuery, CARD_STATUS_OPEN_HINTS);
  const wantsClosed = hasAnyPhrase(normalizedQuery, CARD_STATUS_CLOSED_HINTS);
  if (wantsOpen && !wantsClosed) return ['aberto'];
  if (wantsClosed && !wantsOpen) return ['encerrado'];
  return [];
}

function detectDeadlineFilter(normalizedQuery, now = new Date()) {
  if (!normalizedQuery) return null;

  if (hasAnyPhrase(normalizedQuery, NEXT_WEEK_HINTS)) {
    return {
      type: 'next_7_days',
      label: 'Proximos 7 dias',
      deadline_range: 'next_7_days',
    };
  }

  if (hasAnyPhrase(normalizedQuery, THIS_MONTH_HINTS)) {
    return {
      type: 'month',
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      label: 'Este mes',
      deadline_range: '',
    };
  }

  const yearMatch = normalizedQuery.match(/\b(20\d{2}|19\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : now.getFullYear();

  for (const [alias, month] of Object.entries(MONTH_ALIASES)) {
    const regex = new RegExp(`(?:^|\\s)${escapeRegExp(alias)}(?:\\s|$)`);
    if (!regex.test(normalizedQuery)) continue;
    return {
      type: 'month',
      month,
      year,
      label: `${alias} ${year}`,
      deadline_range: '',
    };
  }

  return null;
}

function detectFundingFilter(normalizedQuery) {
  if (!hasAnyPhrase(normalizedQuery, FUNDING_HINTS)) return null;
  if (hasAnyPhrase(normalizedQuery, FUNDING_MISSING_HINTS)) return 'missing';
  if (hasAnyPhrase(normalizedQuery, FUNDING_INFORMED_HINTS)) return 'informed';
  return null;
}

function detectSortInstruction(normalizedQuery) {
  if (!normalizedQuery) return null;

  const hasBiggerDeadline = /maior prazo|prazo mais longo|prazo mais distante|vence por ultimo|vence por ultimo/.test(normalizedQuery);
  if (hasBiggerDeadline) {
    return { field: 'prazo', direction: 'desc', mode: 'pick_first' };
  }

  const hasSmallestDeadline = /menor prazo|prazo mais curto|prazo mais proximo|vence primeiro/.test(normalizedQuery);
  if (hasSmallestDeadline) {
    return { field: 'prazo', direction: 'asc', mode: 'pick_first' };
  }

  if (!hasAnyPhrase(normalizedQuery, ORDER_HINTS) && !/\b(ordem|ordenado)\b/.test(normalizedQuery)) {
    return null;
  }

  if (/\bprazo\b/.test(normalizedQuery)) return { field: 'prazo', direction: 'asc', mode: 'list' };
  if (/\btitulo\b/.test(normalizedQuery)) return { field: 'titulo', direction: 'asc', mode: 'list' };
  if (/\binstituicao\b/.test(normalizedQuery)) return { field: 'instituicao', direction: 'asc', mode: 'list' };
  if (/\bestado\b/.test(normalizedQuery)) return { field: 'estado', direction: 'asc', mode: 'list' };
  if (/\batualizado\b|atualizacao/.test(normalizedQuery)) return { field: 'atualizado', direction: 'desc', mode: 'list' };
  if (/\brelevancia\b/.test(normalizedQuery)) return { field: 'relevancia', direction: 'desc', mode: 'list' };

  return { field: 'prazo', direction: 'asc', mode: 'list' };
}

function extractFallbackKeywords(normalizedQuery) {
  if (!normalizedQuery) return [];
  const tokens = normalizedQuery
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length >= 3 && !KEYWORD_STOPWORDS.has(token));
  return uniqueByNormalized(tokens).slice(0, 8).map((item) => normalizeText(item));
}

function hasStructuredCriteria(criteria) {
  return (
    (Array.isArray(criteria.states) && criteria.states.length > 0)
    || (Array.isArray(criteria.institutions) && criteria.institutions.length > 0)
    || (Array.isArray(criteria.status) && criteria.status.length > 0)
    || Boolean(criteria.deadline)
    || Boolean(criteria.funding)
  );
}

function classifyIntent(normalizedQuery, criteria) {
  if (!normalizedQuery) return 'dashboard_general';
  if (hasAnyPhrase(normalizedQuery, EXPLAIN_FILTER_HINTS)) return 'explain_filters';
  if (hasAnyPhrase(normalizedQuery, COMPARE_HINTS)) return 'compare_cards';
  if (hasAnyPhrase(normalizedQuery, EXPLAIN_CARD_HINTS) || /\b(primeiro|segundo|terceiro|ultimo|ultima)\b/.test(normalizedQuery)) {
    return 'explain_specific_card';
  }
  if (detectSortInstruction(normalizedQuery)) return 'sort_cards';
  if (hasAnyPhrase(normalizedQuery, COUNT_HINTS)) return 'count_cards';
  if (hasAnyPhrase(normalizedQuery, SUMMARY_HINTS)) return 'summarize_cards';

  if (hasAnyPhrase(normalizedQuery, LIST_HINTS) || hasStructuredCriteria(criteria)) {
    const hasStateOnly = criteria.states.length > 0
      && criteria.institutions.length === 0
      && criteria.status.length === 0
      && !criteria.deadline
      && !criteria.funding;
    if (hasStateOnly) return 'filter_by_state';

    const hasInstitutionOnly = criteria.institutions.length > 0
      && criteria.states.length === 0
      && criteria.status.length === 0
      && !criteria.deadline
      && !criteria.funding;
    if (hasInstitutionOnly) return 'filter_by_institution';

    const hasStatusOnly = criteria.status.length > 0
      && criteria.states.length === 0
      && criteria.institutions.length === 0
      && !criteria.deadline
      && !criteria.funding;
    if (hasStatusOnly) return 'filter_by_status';

    const hasDeadlineOnly = Boolean(criteria.deadline)
      && criteria.states.length === 0
      && criteria.institutions.length === 0
      && criteria.status.length === 0
      && !criteria.funding;
    if (hasDeadlineOnly) return 'filter_by_deadline';

    return 'list_cards';
  }

  if (/dashboard|painel|site|portal|como funciona|o que voce faz|o que voce pode/.test(normalizedQuery)) {
    return 'dashboard_general';
  }

  return 'dashboard_general';
}

function compareByField(field, direction = 'asc') {
  const factor = direction === 'desc' ? -1 : 1;
  return (a, b) => {
    if (field === 'prazo') {
      const da = a?.prazoFinalTime;
      const db = b?.prazoFinalTime;
      if (da === null && db === null) return 0;
      if (da === null) return 1 * factor;
      if (db === null) return -1 * factor;
      return (da - db) * factor;
    }
    if (field === 'atualizado') {
      const da = a?.atualizadoEmTime;
      const db = b?.atualizadoEmTime;
      if (da === null && db === null) return 0;
      if (da === null) return 1 * factor;
      if (db === null) return -1 * factor;
      return (da - db) * factor;
    }
    if (field === 'relevancia') {
      return ((Number(b?.relevanceScore || 0) - Number(a?.relevanceScore || 0)) * factor);
    }
    const va = String(a?.[field] || '').toLowerCase();
    const vb = String(b?.[field] || '').toLowerCase();
    return va.localeCompare(vb, 'pt-BR', { sensitivity: 'base' }) * factor;
  };
}

function sortCards(cards, sortInstruction = null) {
  const arr = Array.isArray(cards) ? [...cards] : [];
  if (!arr.length) return arr;

  if (sortInstruction?.field) {
    return arr.sort(compareByField(sortInstruction.field === 'titulo' ? 'titulo'
      : sortInstruction.field === 'instituicao' ? 'instituicao'
        : sortInstruction.field === 'estado' ? 'estado'
          : sortInstruction.field === 'atualizado' ? 'atualizado'
            : sortInstruction.field === 'relevancia' ? 'relevancia'
              : 'prazo', sortInstruction.direction || 'asc'));
  }

  return arr.sort((a, b) => {
    const openDiff = (a.status === 'aberto' ? 0 : 1) - (b.status === 'aberto' ? 0 : 1);
    if (openDiff !== 0) return openDiff;
    const highlightDiff = (b.isHighlighted ? 1 : 0) - (a.isHighlighted ? 1 : 0);
    if (highlightDiff !== 0) return highlightDiff;
    const relevanceDiff = Number(b.relevanceScore || 0) - Number(a.relevanceScore || 0);
    if (relevanceDiff !== 0) return relevanceDiff;
    if (a.prazoFinalTime === null && b.prazoFinalTime === null) return 0;
    if (a.prazoFinalTime === null) return 1;
    if (b.prazoFinalTime === null) return -1;
    return a.prazoFinalTime - b.prazoFinalTime;
  });
}

function applyCriteriaFilters(cards, criteria, { now = new Date() } = {}) {
  let filtered = Array.isArray(cards) ? [...cards] : [];

  if (criteria.states.length) {
    const ufSet = new Set(criteria.states.map((uf) => String(uf || '').trim().toUpperCase()));
    filtered = filtered.filter((card) => ufSet.has(String(card?.estadoUf || '').trim().toUpperCase()));
  }

  if (criteria.institutions.length) {
    const normalizedInstitutions = criteria.institutions.map((item) => normalizeText(item));
    filtered = filtered.filter((card) => {
      const cardInst = normalizeText(card?.instituicao || '');
      if (!cardInst) return false;
      return normalizedInstitutions.some((needle) => (
        cardInst === needle || cardInst.includes(needle) || needle.includes(cardInst)
      ));
    });
  }

  if (criteria.status.length === 1) {
    const wanted = criteria.status[0];
    filtered = filtered.filter((card) => card?.status === wanted);
  }

  if (criteria.deadline?.type === 'next_7_days') {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).getTime();
    filtered = filtered.filter((card) => (
      card.status === 'aberto'
      && Number.isFinite(card.prazoFinalTime)
      && card.prazoFinalTime >= today
      && card.prazoFinalTime <= limit
    ));
  } else if (criteria.deadline?.type === 'month') {
    filtered = filtered.filter((card) => {
      if (!Number.isFinite(card.prazoFinalTime)) return false;
      const d = new Date(card.prazoFinalTime);
      return d.getFullYear() === criteria.deadline.year && (d.getMonth() + 1) === criteria.deadline.month;
    });
  }

  if (criteria.funding === 'missing') {
    filtered = filtered.filter((card) => !card.valorFomentoInformado);
  } else if (criteria.funding === 'informed') {
    filtered = filtered.filter((card) => card.valorFomentoInformado);
  }

  const canUseKeywordFallback = criteria.keywords.length > 0;
  if (canUseKeywordFallback) {
    filtered = filtered.filter((card) => {
      const blob = normalizeText([
        card?.titulo,
        card?.descricao,
        card?.instituicao,
        card?.estado,
        card?.area,
        ...(Array.isArray(card?.tags) ? card.tags : []),
      ].filter(Boolean).join(' '));
      return criteria.keywords.some((keyword) => blob.includes(keyword));
    });
  }

  return filtered;
}

function formatCardListLine(card) {
  const title = String(card?.titulo || 'Sem titulo').trim();
  const instituicao = String(card?.instituicao || 'Nao informada').trim() || 'Nao informada';
  const estado = String(card?.estado || 'Nao informado').trim() || 'Nao informado';
  const statusLabel = formatStatusLabel(card?.status);
  const prazoLabel = formatDatePtBr(card?.prazoFinal);
  const link = String(card?.link || '').trim();
  const linkText = link ? ` | Link: ${link}` : '';
  return `- ${title} | ${instituicao} | ${estado} | ${statusLabel} | Prazo: ${prazoLabel}${linkText}`;
}

function formatExplainCard(card) {
  if (!card) return '';
  const parts = [
    `Titulo: ${card.titulo || 'Sem titulo'}`,
    `Instituicao: ${card.instituicao || 'Nao informada'}`,
    `Estado: ${card.estado || 'Nao informado'}`,
    `Status: ${formatStatusLabel(card.status)}`,
    `Prazo final: ${formatDatePtBr(card.prazoFinal)}`,
    `Valor do fomento: ${card.valorFomentoInformado ? card.valorFomento : 'Nao informado'}`,
    `Resumo: ${card.descricao || 'Nao informado'}`,
  ];
  if (card.link) parts.push(`Link: ${card.link}`);
  return parts.join('\n');
}

function formatUiFilters(uiState = {}) {
  const chunks = [];
  const appliedFilters = uiState?.appliedFilters && typeof uiState.appliedFilters === 'object'
    ? uiState.appliedFilters
    : {};

  const estado = Array.isArray(appliedFilters.estado) ? appliedFilters.estado.filter(Boolean) : [];
  const instituicao = Array.isArray(appliedFilters.instituicao) ? appliedFilters.instituicao.filter(Boolean) : [];
  const area = Array.isArray(appliedFilters.area) ? appliedFilters.area.filter(Boolean) : [];

  if (estado.length) chunks.push(`Estado (${estado.slice(0, 3).join(', ')})`);
  if (instituicao.length) chunks.push(`Instituicao (${instituicao.slice(0, 2).join(', ')})`);
  if (area.length) chunks.push(`Categoria (${area.slice(0, 2).join(', ')})`);

  if (uiState?.kpiFilter === 'abertos') chunks.push('KPI: Abertos');
  if (uiState?.kpiFilter === 'fechados') chunks.push('KPI: Encerrados');
  if (uiState?.onlyFavoritos) chunks.push('Somente salvos');

  const assistantLabels = Array.isArray(uiState?.assistantFilterLabels) ? uiState.assistantFilterLabels : [];
  if (assistantLabels.length) chunks.push(`IA: ${assistantLabels.slice(0, 2).join(', ')}`);

  return chunks.join(' | ');
}

function resolveBaseScope(normalizedQuery, cardsAll, cardsVisible, memory, cardsById) {
  const allCards = Array.isArray(cardsAll) ? cardsAll : [];
  const visible = Array.isArray(cardsVisible) && cardsVisible.length ? cardsVisible : allCards;
  const memoryIds = Array.isArray(memory?.lastResultIds) ? memory.lastResultIds.map((id) => String(id)) : [];
  const memoryCards = memoryIds.map((id) => cardsById.get(id)).filter(Boolean);

  const useVisible = hasAnyPhrase(normalizedQuery, VISIBLE_SCOPE_HINTS);
  const useLastByHint = hasAnyPhrase(normalizedQuery, LAST_SCOPE_HINTS);
  const hasReferenceHint = hasAnyPhrase(normalizedQuery, EXPLAIN_CARD_HINTS)
    || /\b(primeiro|segunda?|terceiro|ultimo|ultima)\b/.test(normalizedQuery);

  if (useVisible) {
    return {
      scope: 'visible_cards',
      label: `cards visiveis (${visible.length})`,
      cards: visible,
    };
  }

  if ((useLastByHint || hasReferenceHint) && memoryCards.length) {
    return {
      scope: 'last_results',
      label: `ultima lista retornada (${memoryCards.length})`,
      cards: memoryCards,
    };
  }

  return {
    scope: 'all_loaded',
    label: `todos os cards carregados (${allCards.length})`,
    cards: allCards,
  };
}

function detectReferenceIndex(normalizedQuery) {
  if (!normalizedQuery) return null;
  if (hasAnyPhrase(normalizedQuery, REFERENCE_FIRST_HINTS)) return 0;
  if (hasAnyPhrase(normalizedQuery, REFERENCE_SECOND_HINTS)) return 1;
  if (hasAnyPhrase(normalizedQuery, REFERENCE_THIRD_HINTS)) return 2;
  if (hasAnyPhrase(normalizedQuery, REFERENCE_LAST_HINTS)) return -1;
  return null;
}

function resolveSpecificCard(normalizedQuery, filteredCards, memory, cardsById) {
  const cards = Array.isArray(filteredCards) ? filteredCards : [];
  if (!cards.length) return null;

  const indexHint = detectReferenceIndex(normalizedQuery);
  if (indexHint === -1) return cards[cards.length - 1] || null;
  if (indexHint !== null && indexHint >= 0) return cards[indexHint] || null;

  const hasThisHint = /\b(esse|essa|este|esta)\b/.test(normalizedQuery);
  if (hasThisHint) {
    const openedId = String(memory?.lastOpenedCardId || '').trim();
    if (openedId && cardsById.has(openedId)) return cardsById.get(openedId);
    const memoryIds = Array.isArray(memory?.lastResultIds) ? memory.lastResultIds : [];
    if (memoryIds.length) {
      const firstId = String(memoryIds[0] || '').trim();
      if (firstId && cardsById.has(firstId)) return cardsById.get(firstId);
    }
    return null;
  }

  return null;
}

function buildStructuredPayload(question, intent, criteria, results, summary) {
  const ids = Array.isArray(results)
    ? results
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean)
    : [];

  return {
    intent: intent === 'dashboard_general' ? 'edital_search' : intent,
    query: String(question || '').trim(),
    summary: String(summary || '').trim(),
    total: ids.length,
    result_ids: ids,
    filters: {
      status: Array.isArray(criteria?.status) ? criteria.status : [],
      deadline_range: criteria?.deadline?.deadline_range || '',
      categories: [],
      instituicoes: Array.isArray(criteria?.institutions) ? criteria.institutions : [],
      estado: Array.isArray(criteria?.states) ? criteria.states : [],
      keywords: Array.isArray(criteria?.keywords) ? criteria.keywords : [],
    },
  };
}

function buildChatOptions(results) {
  if (!Array.isArray(results) || !results.length) return [];
  return results.slice(0, 8).map((card) => ({
    id: card.id,
    titulo: card.titulo,
    instituicao: card.instituicao,
    estado: card.estado,
    data_fechamento: card.prazoFinal,
    is_highlighted: Boolean(card.isHighlighted),
    status: formatStatusLabel(card.status),
    share_link: card.link || '',
  }));
}

function buildCriteria(normalizedQuery, cards, now) {
  const states = detectStateFilters(normalizedQuery);
  const institutions = detectInstitutionFilters(normalizedQuery, cards);
  const status = detectStatusFilters(normalizedQuery);
  const deadline = detectDeadlineFilter(normalizedQuery, now);
  const funding = detectFundingFilter(normalizedQuery);
  const hasStructured = (
    states.length > 0
    || institutions.length > 0
    || status.length > 0
    || Boolean(deadline)
    || Boolean(funding)
  );
  const keywords = hasStructured ? [] : extractFallbackKeywords(normalizedQuery);
  return { states, institutions, status, deadline, funding, keywords };
}

function buildTransparencyLine(baseScope, uiState) {
  const uiFilters = formatUiFilters(uiState);
  if (uiFilters) {
    return `Base usada: ${baseScope.label}. Filtros ativos na tela: ${uiFilters}.`;
  }
  return `Base usada: ${baseScope.label}.`;
}

function buildNoDataReply(baseScope, uiState, criteria) {
  const missing = [];
  if (criteria.deadline && baseScope.cards.every((card) => !Number.isFinite(card?.prazoFinalTime))) {
    missing.push('prazo final dos cards');
  }
  if (criteria.funding && baseScope.cards.every((card) => isFundingMissingValue(card?.valorFomento))) {
    missing.push('valor de fomento');
  }

  const transparency = buildTransparencyLine(baseScope, uiState);
  if (missing.length) {
    return `Nao encontrei resultado com os criterios pedidos porque falta ${missing.join(' e ')} em boa parte dos cards.\n${transparency}`;
  }
  return `Nao encontrei cards com esse recorte.\n${transparency}`;
}

function createMemoryFrom(baseMemory = {}) {
  const ids = Array.isArray(baseMemory?.lastResultIds)
    ? baseMemory.lastResultIds.map((id) => String(id || '').trim()).filter(Boolean).slice(0, MAX_MEMORY_RESULT_IDS)
    : [];
  return {
    lastResultIds: ids,
    lastResultScope: String(baseMemory?.lastResultScope || '').trim() || 'all_loaded',
    lastIntent: String(baseMemory?.lastIntent || '').trim() || '',
    lastQuestion: String(baseMemory?.lastQuestion || '').trim() || '',
    lastOpenedCardId: String(baseMemory?.lastOpenedCardId || '').trim() || '',
    updatedAt: String(baseMemory?.updatedAt || '').trim() || '',
  };
}

export function createDashboardAssistantMemory(seed = {}) {
  return createMemoryFrom(seed);
}

export function runDashboardAssistantSemanticQuery({
  question,
  cards = [],
  visibleCards = [],
  uiState = {},
  memory = {},
  now = new Date(),
} = {}) {
  const safeQuestion = String(question || '').trim();
  const normalizedQuestion = normalizeText(safeQuestion);
  const normalizedCards = normalizeAssistantCards(cards, { now });
  const normalizedVisibleCards = normalizeAssistantCards(visibleCards, { now });
  const cardById = new Map(normalizedCards.map((card) => [String(card.id), card]));
  const safeMemory = createMemoryFrom(memory);

  if (!safeQuestion) {
    return {
      handled: true,
      intent: 'dashboard_general',
      reply: 'Me diga o que voce quer consultar no dashboard: estado, instituicao, status, prazo, valor de fomento ou ordenacao.',
      total: 0,
      results: [],
      options: [],
      structuredPayload: null,
      nextMemory: safeMemory,
    };
  }

  if (!normalizedCards.length) {
    return {
      handled: true,
      intent: 'dashboard_general',
      reply: 'Nao consigo responder com precisao agora porque nao encontrei cards carregados no dashboard.',
      total: 0,
      results: [],
      options: [],
      structuredPayload: null,
      nextMemory: createMemoryFrom({
        ...safeMemory,
        lastIntent: 'dashboard_general',
        lastQuestion: safeQuestion,
        updatedAt: new Date().toISOString(),
      }),
    };
  }

  const criteria = buildCriteria(normalizedQuestion, normalizedCards, now);
  const intent = classifyIntent(normalizedQuestion, criteria);
  const baseScope = resolveBaseScope(normalizedQuestion, normalizedCards, normalizedVisibleCards, safeMemory, cardById);

  if (intent === 'explain_filters') {
    const states = uniqueByNormalized(normalizedCards.map((card) => card.estado)).slice(0, 8);
    const institutions = uniqueByNormalized(normalizedCards.map((card) => card.instituicao)).slice(0, 8);
    const transparency = buildTransparencyLine(baseScope, uiState);
    const reply = [
      'Posso filtrar os cards por Estado, Instituicao, Categoria, Status e Prazo, alem de ordenar por Relevancia, Prazo, Titulo, Instituicao, Estado e Atualizado.',
      'Exemplos: "editais de SP", "abertos da FAPESP", "vencem este mes", "ordene por prazo".',
      `Estados disponiveis (amostra): ${states.join(', ') || 'Nao informado'}.`,
      `Instituicoes disponiveis (amostra): ${institutions.join(', ') || 'Nao informado'}.`,
      transparency,
    ].join('\n');
    return {
      handled: true,
      intent,
      reply,
      total: 0,
      results: [],
      options: [],
      structuredPayload: null,
      nextMemory: createMemoryFrom({
        ...safeMemory,
        lastIntent: intent,
        lastQuestion: safeQuestion,
        updatedAt: new Date().toISOString(),
      }),
    };
  }

  const filtered = applyCriteriaFilters(baseScope.cards, criteria, { now });
  const explicitSortInstruction = detectSortInstruction(normalizedQuestion);
  const sortInstruction = explicitSortInstruction || (criteria.deadline ? { field: 'prazo', direction: 'asc', mode: 'list' } : null);
  const sorted = sortCards(filtered, sortInstruction);
  const total = sorted.length;
  const transparency = buildTransparencyLine(baseScope, uiState);

  if (!total && intent !== 'dashboard_general') {
    const reply = buildNoDataReply(baseScope, uiState, criteria);
    return {
      handled: true,
      intent,
      reply,
      total: 0,
      results: [],
      options: [],
      structuredPayload: buildStructuredPayload(safeQuestion, intent, criteria, [], reply),
      nextMemory: createMemoryFrom({
        ...safeMemory,
        lastResultIds: [],
        lastResultScope: baseScope.scope,
        lastIntent: intent,
        lastQuestion: safeQuestion,
        updatedAt: new Date().toISOString(),
      }),
    };
  }

  if (intent === 'explain_specific_card') {
    const selected = resolveSpecificCard(normalizedQuestion, sorted.length ? sorted : baseScope.cards, safeMemory, cardById);
    if (!selected) {
      const reply = [
        'Nao consegui identificar qual card voce quer explicar.',
        'Para eu responder com precisao, use "me explique o primeiro" ou abra um card e pergunte "me explique esse card".',
        transparency,
      ].join('\n');
      return {
        handled: true,
        intent,
        reply,
        total: 0,
        results: [],
        options: [],
        structuredPayload: null,
        nextMemory: createMemoryFrom({
          ...safeMemory,
          lastIntent: intent,
          lastQuestion: safeQuestion,
          updatedAt: new Date().toISOString(),
        }),
      };
    }

    const reply = [
      'Detalhes do card solicitado:',
      formatExplainCard(selected),
      transparency,
    ].join('\n');
    return {
      handled: true,
      intent,
      reply,
      total: 1,
      results: [selected],
      options: buildChatOptions([selected]),
      structuredPayload: buildStructuredPayload(safeQuestion, 'list_cards', criteria, [selected], reply),
      nextMemory: createMemoryFrom({
        ...safeMemory,
        lastResultIds: [String(selected.id)],
        lastResultScope: baseScope.scope,
        lastIntent: intent,
        lastQuestion: safeQuestion,
        lastOpenedCardId: String(selected.id),
        updatedAt: new Date().toISOString(),
      }),
    };
  }

  if (intent === 'compare_cards') {
    const pair = sorted.slice(0, 2);
    if (pair.length < 2) {
      const reply = [
        'Nao encontrei dois cards suficientes para comparar com esse recorte.',
        transparency,
      ].join('\n');
      return {
        handled: true,
        intent,
        reply,
        total,
        results: sorted,
        options: buildChatOptions(sorted),
        structuredPayload: buildStructuredPayload(safeQuestion, 'list_cards', criteria, sorted, reply),
        nextMemory: createMemoryFrom({
          ...safeMemory,
          lastResultIds: sorted.map((card) => String(card.id)).slice(0, MAX_MEMORY_RESULT_IDS),
          lastResultScope: baseScope.scope,
          lastIntent: intent,
          lastQuestion: safeQuestion,
          updatedAt: new Date().toISOString(),
        }),
      };
    }

    const reply = [
      `Comparacao entre 2 cards (${pair[0].titulo} x ${pair[1].titulo}):`,
      `- 1) ${pair[0].instituicao} | ${pair[0].estado} | ${formatStatusLabel(pair[0].status)} | Prazo: ${formatDatePtBr(pair[0].prazoFinal)}`,
      `- 2) ${pair[1].instituicao} | ${pair[1].estado} | ${formatStatusLabel(pair[1].status)} | Prazo: ${formatDatePtBr(pair[1].prazoFinal)}`,
      transparency,
    ].join('\n');

    return {
      handled: true,
      intent,
      reply,
      total: pair.length,
      results: pair,
      options: buildChatOptions(pair),
      structuredPayload: buildStructuredPayload(safeQuestion, 'list_cards', criteria, pair, reply),
      nextMemory: createMemoryFrom({
        ...safeMemory,
        lastResultIds: pair.map((card) => String(card.id)),
        lastResultScope: baseScope.scope,
        lastIntent: intent,
        lastQuestion: safeQuestion,
        updatedAt: new Date().toISOString(),
      }),
    };
  }

  if (intent === 'count_cards') {
    const reply = [
      `Encontrei ${total} card(s) com esse recorte.`,
      transparency,
    ].join('\n');
    return {
      handled: true,
      intent,
      reply,
      total,
      results: sorted,
      options: buildChatOptions(sorted),
      structuredPayload: buildStructuredPayload(safeQuestion, 'list_cards', criteria, sorted, reply),
      nextMemory: createMemoryFrom({
        ...safeMemory,
        lastResultIds: sorted.map((card) => String(card.id)).slice(0, MAX_MEMORY_RESULT_IDS),
        lastResultScope: baseScope.scope,
        lastIntent: intent,
        lastQuestion: safeQuestion,
        updatedAt: new Date().toISOString(),
      }),
    };
  }

  if (intent === 'summarize_cards') {
    const openCount = sorted.filter((card) => card.status === 'aberto').length;
    const closedCount = total - openCount;
    const topStates = uniqueByNormalized(sorted.map((card) => card.estado)).slice(0, 3);
    const topInstitutions = uniqueByNormalized(sorted.map((card) => card.instituicao)).slice(0, 3);
    const reply = [
      `Resumo dos cards encontrados (${total}):`,
      `- Abertos: ${openCount}`,
      `- Encerrados: ${closedCount}`,
      `- Estados mais frequentes: ${topStates.join(', ') || 'Nao informado'}`,
      `- Instituicoes mais frequentes: ${topInstitutions.join(', ') || 'Nao informado'}`,
      transparency,
    ].join('\n');
    return {
      handled: true,
      intent,
      reply,
      total,
      results: sorted,
      options: buildChatOptions(sorted),
      structuredPayload: buildStructuredPayload(safeQuestion, 'list_cards', criteria, sorted, reply),
      nextMemory: createMemoryFrom({
        ...safeMemory,
        lastResultIds: sorted.map((card) => String(card.id)).slice(0, MAX_MEMORY_RESULT_IDS),
        lastResultScope: baseScope.scope,
        lastIntent: intent,
        lastQuestion: safeQuestion,
        updatedAt: new Date().toISOString(),
      }),
    };
  }

  if (intent === 'sort_cards' && sortInstruction?.mode === 'pick_first') {
    const top = sorted[0] || null;
    if (!top) {
      const reply = `Nao encontrei card com prazo valido para ordenar.\n${transparency}`;
      return {
        handled: true,
        intent,
        reply,
        total: 0,
        results: [],
        options: [],
        structuredPayload: null,
        nextMemory: createMemoryFrom({
          ...safeMemory,
          lastIntent: intent,
          lastQuestion: safeQuestion,
          updatedAt: new Date().toISOString(),
        }),
      };
    }
    const reply = [
      'Card com maior prioridade de prazo para esse criterio:',
      formatCardListLine(top),
      transparency,
    ].join('\n');
    return {
      handled: true,
      intent,
      reply,
      total: 1,
      results: [top],
      options: buildChatOptions([top]),
      structuredPayload: buildStructuredPayload(safeQuestion, 'list_cards', criteria, [top], reply),
      nextMemory: createMemoryFrom({
        ...safeMemory,
        lastResultIds: [String(top.id)],
        lastResultScope: baseScope.scope,
        lastIntent: intent,
        lastQuestion: safeQuestion,
        updatedAt: new Date().toISOString(),
      }),
    };
  }

  if (intent === 'dashboard_general') {
    const reply = [
      'Sou a assistente do dashboard de editais. Posso responder sobre cards, filtros, contagens, status, prazos, instituicoes e estados.',
      'Exemplos: "quais sao os editais de SP?", "quantos encerrados existem?", "ordene os editais por prazo".',
      transparency,
    ].join('\n');
    return {
      handled: true,
      intent,
      reply,
      total: 0,
      results: [],
      options: [],
      structuredPayload: null,
      nextMemory: createMemoryFrom({
        ...safeMemory,
        lastIntent: intent,
        lastQuestion: safeQuestion,
        updatedAt: new Date().toISOString(),
      }),
    };
  }

  const limitMatch = normalizedQuestion.match(/\b(?:top|primeiros?)\s+(\d{1,2})\b/);
  const listLimit = Math.max(1, Math.min(10, Number(limitMatch?.[1] || DEFAULT_MAX_LIST_ITEMS)));
  const shown = sorted.slice(0, listLimit);

  const criteriaDetails = [];
  if (criteria.states.length) criteriaDetails.push(`Estado: ${criteria.states.join(', ')}`);
  if (criteria.institutions.length) criteriaDetails.push(`Instituicao: ${criteria.institutions.join(', ')}`);
  if (criteria.status.length) criteriaDetails.push(`Status: ${criteria.status.join(', ')}`);
  if (criteria.deadline?.label) criteriaDetails.push(`Prazo: ${criteria.deadline.label}`);
  if (criteria.funding === 'missing') criteriaDetails.push('Valor de fomento: nao informado');
  if (criteria.funding === 'informed') criteriaDetails.push('Valor de fomento: informado');

  const header = criteriaDetails.length
    ? `Encontrei ${total} card(s) com o recorte (${criteriaDetails.join(' | ')}).`
    : `Encontrei ${total} card(s).`;
  const shownInfo = `Mostrando ${shown.length} de ${total}.`;
  const reply = [
    header,
    shownInfo,
    ...shown.map((card) => formatCardListLine(card)),
    transparency,
  ].join('\n');

  return {
    handled: true,
    intent,
    reply,
    total,
    results: sorted,
    options: buildChatOptions(sorted),
    structuredPayload: buildStructuredPayload(safeQuestion, 'list_cards', criteria, sorted, reply),
    nextMemory: createMemoryFrom({
      ...safeMemory,
      lastResultIds: sorted.map((card) => String(card.id)).slice(0, MAX_MEMORY_RESULT_IDS),
      lastResultScope: baseScope.scope,
      lastIntent: intent,
      lastQuestion: safeQuestion,
      updatedAt: new Date().toISOString(),
    }),
  };
}
