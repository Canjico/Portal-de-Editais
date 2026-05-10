import { parseAnyDateToTime } from './search-date-utils.js';

const DEFAULT_ESTADO_LABELS = Object.freeze({
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

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildEstadoAliasMap(estadoLabels = DEFAULT_ESTADO_LABELS) {
  const map = new Map();
  Object.entries({ ...DEFAULT_ESTADO_LABELS, ...(estadoLabels || {}) }).forEach(([uf, label]) => {
    const code = String(uf || '').trim().toUpperCase();
    if (!code) return;
    map.set(normalizeText(code), code);
    map.set(normalizeText(label), code);
    map.set(normalizeText(`${code} ${label}`), code);
  });
  map.set('sao paulo', 'SP');
  map.set('rio de janeiro', 'RJ');
  map.set('minas gerais', 'MG');
  map.set('pernambuco', 'PE');
  map.set('distrito federal', 'DF');
  return map;
}

export function normalizeDashboardEstadoUf(value, { estadoLabels = DEFAULT_ESTADO_LABELS } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const upper = raw.toUpperCase();
  const labels = { ...DEFAULT_ESTADO_LABELS, ...(estadoLabels || {}) };
  if (labels[upper]) return upper;

  const prefix = upper.match(/^([A-Z]{2})\b/);
  if (prefix && labels[prefix[1]]) return prefix[1];

  const aliasMap = buildEstadoAliasMap(labels);
  const normalized = normalizeText(raw);
  if (aliasMap.has(normalized)) return aliasMap.get(normalized);

  for (const [alias, uf] of aliasMap.entries()) {
    if (alias.length > 2 && normalized.includes(alias)) return uf;
  }

  return upper;
}

function normalizeStatus(value) {
  const token = normalizeText(value);
  if (!token) return '';
  if (token.includes('encerr') || token.includes('fechad') || token.includes('vencid') || token.includes('expir')) {
    return 'encerrado';
  }
  if (token.includes('abert') || token.includes('vigent') || token.includes('ativ')) {
    return 'aberto';
  }
  return '';
}

function startOfToday(now = new Date()) {
  const d = now instanceof Date ? now : new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function parseDeadlineDay(card) {
  const raw = card?.data_fechamento ?? card?.prazo_final ?? card?.prazoFinal ?? card?.prazo ?? card?.deadline ?? null;
  const time = parseAnyDateToTime(raw);
  if (time === null) return null;
  const d = new Date(time);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function isDashboardCardOpen(card, { now = new Date() } = {}) {
  if (!card) return false;
  if (typeof card.is_open === 'boolean') return card.is_open;
  if (card.fluxo_continuo === true) return true;

  const status = normalizeStatus(card.status);
  if (status === 'aberto') return true;
  if (status === 'encerrado') return false;

  const deadline = parseDeadlineDay(card);
  if (deadline === null) return true;
  return deadline >= startOfToday(now);
}

function isWithinNextDays(card, days, { now = new Date() } = {}) {
  const deadline = parseDeadlineDay(card);
  if (deadline === null) return false;
  const today = startOfToday(now);
  const limit = new Date(today);
  limit.setDate(limit.getDate() + Number(days || 0));
  return deadline >= today && deadline <= limit.getTime();
}

function cardId(card) {
  const id = card?.id ?? card?.edital_id ?? card?.editalId ?? null;
  return id === null || id === undefined ? '' : String(id).trim();
}

function getCardEstadoUf(card, options = {}) {
  return normalizeDashboardEstadoUf(card?.estado_uf || card?.estadoUf || card?.estado || '', options);
}

function normalizeList(value) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function payloadHasStructuredFilters(payload) {
  const filters = payload?.filters && typeof payload.filters === 'object' ? payload.filters : {};
  return Boolean(
    normalizeList(filters.estado || filters.estados).length ||
    normalizeList(filters.status || filters.statuses).length ||
    String(filters.deadline_range || filters.deadlineRange || '').trim() ||
    normalizeList(filters.instituicoes || filters.instituicao).length ||
    normalizeList(filters.categories || filters.categorias || filters.area).length ||
    normalizeList(filters.keywords || filters.termos || filters.temas).length
  );
}

export function dashboardCardMatchesPayload(card, payload, {
  estadoLabels = DEFAULT_ESTADO_LABELS,
  normalizeCategory = null,
  now = new Date(),
  respectResultIds = true,
} = {}) {
  if (!card || !payload || typeof payload !== 'object') return false;
  const filters = payload.filters && typeof payload.filters === 'object' ? payload.filters : {};
  const resultIds = normalizeList(payload.result_ids || payload.resultIds || payload.ids);
  const id = cardId(card);
  if (respectResultIds && resultIds.length && !resultIds.includes(id)) return false;

  const estados = normalizeList(filters.estado || filters.estados)
    .map((uf) => normalizeDashboardEstadoUf(uf, { estadoLabels }))
    .filter(Boolean);
  if (estados.length && !estados.includes(getCardEstadoUf(card, { estadoLabels }))) return false;

  const status = normalizeList(filters.status || filters.statuses).map(normalizeStatus).filter(Boolean);
  const onlyOpen = status.includes('aberto') && !status.includes('encerrado');
  const onlyClosed = status.includes('encerrado') && !status.includes('aberto');
  if (onlyOpen && !isDashboardCardOpen(card, { now })) return false;
  if (onlyClosed && isDashboardCardOpen(card, { now })) return false;

  const deadlineRange = String(filters.deadline_range || filters.deadlineRange || '').trim();
  if (deadlineRange === 'next_7_days' && !(isDashboardCardOpen(card, { now }) && isWithinNextDays(card, 7, { now }))) {
    return false;
  }

  const instituicoes = normalizeList(filters.instituicoes || filters.instituicao).map(normalizeText);
  if (instituicoes.length) {
    const inst = normalizeText(card?.instituicao || card?.instituição || '');
    if (!instituicoes.some((needle) => inst.includes(needle))) return false;
  }

  const categories = normalizeList(filters.categories || filters.categorias || filters.area).map((item) => {
    if (typeof normalizeCategory === 'function') return normalizeText(normalizeCategory(item));
    return normalizeText(item);
  });
  if (categories.length) {
    const cardCategory = typeof normalizeCategory === 'function'
      ? normalizeText(normalizeCategory(card?.area || ''))
      : normalizeText(card?.area || '');
    if (!categories.includes(cardCategory)) return false;
  }

  const keywords = normalizeList(filters.keywords || filters.termos || filters.temas).map(normalizeText).filter(Boolean);
  if (keywords.length) {
    const haystack = normalizeText([
      card?.titulo,
      card?.descricao,
      card?.instituicao,
      card?.estado,
      card?.area,
      ...(Array.isArray(card?.tags) ? card.tags : []),
    ].filter(Boolean).join(' '));
    if (!keywords.some((keyword) => haystack.includes(keyword))) return false;
  }

  return true;
}

export function resolveDashboardCardsFromPayload(cards, payload, options = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const resultIds = normalizeList(payload?.result_ids || payload?.resultIds || payload?.ids);
  const payloadTotal = Number(payload?.total || 0);
  const respectResultIds = !(
    payloadHasStructuredFilters(payload) &&
    resultIds.length > 0 &&
    Number.isFinite(payloadTotal) &&
    payloadTotal > resultIds.length
  );
  const matched = list.filter((card) => dashboardCardMatchesPayload(card, payload, {
    ...options,
    respectResultIds,
  }));
  if (!resultIds.length) return matched;

  const order = new Map(resultIds.map((id, index) => [String(id), index]));
  return matched.sort((a, b) => {
    const aOrder = order.has(cardId(a)) ? order.get(cardId(a)) : Number.MAX_SAFE_INTEGER;
    const bOrder = order.has(cardId(b)) ? order.get(cardId(b)) : Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder;
  });
}

export function filterDashboardOptionsAgainstPayload(options, cards, payload, matcherOptions = {}) {
  const normalizedOptions = Array.isArray(options) ? options : [];
  const byId = new Map((Array.isArray(cards) ? cards : []).map((card) => [cardId(card), card]));
  return normalizedOptions.filter((option) => {
    if (!option || typeof option !== 'object') return false;
    const action = String(option.action || '').trim();
    if (action !== 'open_edital') return true;
    const id = String(option.id ?? option.edital_id ?? option.editalId ?? '').trim();
    const card = byId.get(id);
    return Boolean(card && dashboardCardMatchesPayload(card, payload, matcherOptions));
  });
}

function buildPayloadFromCards(payload, cards) {
  const base = payload && typeof payload === 'object' ? payload : {};
  const filters = base.filters && typeof base.filters === 'object' ? base.filters : {};
  const ids = (Array.isArray(cards) ? cards : []).map(cardId).filter(Boolean);
  return {
    ...base,
    intent: String(base.intent || 'edital_search').trim() || 'edital_search',
    total: ids.length,
    result_ids: ids,
    filters: {
      status: normalizeList(filters.status || filters.statuses),
      deadline_range: String(filters.deadline_range || filters.deadlineRange || '').trim(),
      categories: normalizeList(filters.categories || filters.categorias || filters.area),
      instituicoes: normalizeList(filters.instituicoes || filters.instituicao),
      estado: normalizeList(filters.estado || filters.estados),
      keywords: normalizeList(filters.keywords || filters.termos || filters.temas),
    },
  };
}

function buildOptionFromCard(card, {
  formatDate = null,
  formatEstadoLabel = null,
} = {}) {
  const metaParts = [];
  if (card?.is_highlighted) metaParts.push('Em destaque');
  if (card?.instituicao) metaParts.push(String(card.instituicao));
  const estado = card?.estado ? String(card.estado) : '';
  if (estado) {
    metaParts.push(typeof formatEstadoLabel === 'function' ? formatEstadoLabel(estado) : estado);
  }
  const deadline = card?.data_fechamento || card?.prazo_final || card?.prazoFinal || '';
  if (deadline) {
    const label = typeof formatDate === 'function' ? formatDate(deadline) : String(deadline);
    if (label) metaParts.push(`Ate ${label}`);
  }

  return {
    action: 'open_edital',
    id: card?.id,
    title: card?.titulo || card?.title || card?.nome || 'Sem titulo',
    meta: metaParts.length ? metaParts.join(' • ') : null,
  };
}

export function buildDashboardChatOptionsFromPayload({
  cards,
  payload,
  query = '',
  maxCards = 5,
  formatDate = null,
  formatEstadoLabel = null,
  estadoLabels = DEFAULT_ESTADO_LABELS,
  normalizeCategory = null,
  now = new Date(),
} = {}) {
  if (!payload || typeof payload !== 'object') {
    return { options: [], payload: null, cards: [] };
  }

  const matchedCards = resolveDashboardCardsFromPayload(cards, payload, {
    estadoLabels,
    normalizeCategory,
    now,
  });

  if (!matchedCards.length) {
    return { options: [], payload: buildPayloadFromCards(payload, []), cards: [] };
  }

  const panelPayload = buildPayloadFromCards(payload, matchedCards);
  const topCards = matchedCards.slice(0, Math.max(1, Number(maxCards || 5)));
  const options = topCards.map((card) => buildOptionFromCard(card, { formatDate, formatEstadoLabel }));

  options.push({
    action: 'view_all',
    query,
    title: `Ver todos no painel (${panelPayload.total})`,
    meta: 'Aplicar o mesmo recorte no Dashboard',
    payload: panelPayload,
  });

  return { options, payload: panelPayload, cards: matchedCards };
}
