const ALLOWED_INTENTS = new Set([
  'list_cards',
  'count_cards',
  'summarize_cards',
  'explain_card',
  'apply_filter',
  'sort_cards',
  'compare_cards',
  'dashboard_state',
  'insufficient_context',
]);

const ALLOWED_SCOPES = new Set([
  'all_loaded_cards',
  'visible_cards',
  'focused_cards',
]);

const ALLOWED_UI_ACTIONS = new Set([
  'highlight_cards',
  'highlight_cards_and_offer_filter',
  'apply_filter',
  'show_top_urgent',
  'open_card',
  'ask_for_more_context',
  'none',
]);

const ALLOWED_SORT_FIELDS = new Set([
  'prazoFinal',
  'relevanceScore',
  'titulo',
  'instituicao',
  'estado',
  'status',
  'updatedAt',
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

function sanitizeText(value, max = 320) {
  const withoutUrls = String(value || '').replace(/https?:\/\/\S+/gi, '');
  const compact = withoutUrls.replace(/[ \t]+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= max) return compact;
  return compact.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function uniqueList(values, { normalize = null, max = 20 } = {}) {
  const list = Array.isArray(values) ? values : (values == null ? [] : [values]);
  const seen = new Set();
  const out = [];

  for (const value of list) {
    const raw = String(value || '').trim();
    if (!raw) continue;
    const normalized = typeof normalize === 'function' ? normalize(raw) : raw;
    const clean = String(normalized || '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= max) break;
  }

  return out;
}

function toStatusToken(value) {
  const token = normalizeText(value);
  if (!token) return '';
  if (token.includes('abert') || token.includes('vigent') || token.includes('ativ')) return 'aberto';
  if (token.includes('encerr') || token.includes('fechad') || token.includes('vencid') || token.includes('expir')) return 'encerrado';
  return '';
}

function toScope(value) {
  const token = normalizeText(value);
  if (!token) return 'all_loaded_cards';
  if (token === 'visible' || token === 'visible_cards') return 'visible_cards';
  if (token === 'focused_cards' || token === 'focus' || token === 'last_results') return 'focused_cards';
  return 'all_loaded_cards';
}

function toDirection(value) {
  return normalizeText(value) === 'desc' ? 'desc' : 'asc';
}

function toUiAction(value) {
  const token = normalizeText(value).replace(/\s+/g, '_');
  if (ALLOWED_UI_ACTIONS.has(token)) return token;
  return 'none';
}

function clampReplyLines(reply, maxLines = 3) {
  const lines = String(reply || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(0, maxLines).join('\n');
}

export function scopeDisclosure(scope) {
  if (scope === 'visible_cards') return 'Base: cards visiveis no painel.';
  if (scope === 'focused_cards') return 'Base: cards em foco da conversa.';
  return 'Base: todos os cards carregados.';
}

export function normalizeDashboardAssistantPlan(rawPlan, { allowedCardIds = [] } = {}) {
  if (!rawPlan || typeof rawPlan !== 'object') return null;

  const intent = ALLOWED_INTENTS.has(String(rawPlan.intent || '').trim()) ? String(rawPlan.intent).trim() : 'list_cards';
  const scope = ALLOWED_SCOPES.has(String(rawPlan.scope || '').trim()) ? String(rawPlan.scope).trim() : toScope(rawPlan.scope);
  const sourceScope = ALLOWED_SCOPES.has(String(rawPlan.source_scope || rawPlan.scope_used || '').trim())
    ? String(rawPlan.source_scope || rawPlan.scope_used).trim()
    : scope;

  const filtersRaw = rawPlan.filters && typeof rawPlan.filters === 'object' ? rawPlan.filters : {};
  const estado = uniqueList(filtersRaw.estado || filtersRaw.estados || [], {
    normalize: (v) => String(v || '').trim().toUpperCase(),
    max: 20,
  });
  const status = uniqueList(filtersRaw.status || [], { normalize: toStatusToken, max: 2 }).filter(Boolean);
  const instituicao = uniqueList(filtersRaw.instituicao || filtersRaw.instituicoes || [], { max: 10 });
  const area = uniqueList(filtersRaw.area || filtersRaw.areas || filtersRaw.categories || [], { max: 10 });
  const keywords = uniqueList(filtersRaw.keywords || filtersRaw.termos || [], {
    normalize: (v) => normalizeText(v),
    max: 10,
  }).filter(Boolean);
  const deadlineDaysParsed = Number(filtersRaw.deadline_days ?? filtersRaw.deadlineDays ?? 0);
  const deadlineDays = Number.isFinite(deadlineDaysParsed) && deadlineDaysParsed > 0 ? Math.min(365, Math.max(1, Math.round(deadlineDaysParsed))) : 0;

  const sortRaw = rawPlan.sort && typeof rawPlan.sort === 'object' ? rawPlan.sort : {};
  const sortField = ALLOWED_SORT_FIELDS.has(String(sortRaw.field || '').trim()) ? String(sortRaw.field).trim() : 'prazoFinal';
  const sortDirection = toDirection(sortRaw.direction);

  const allowedSet = new Set((Array.isArray(allowedCardIds) ? allowedCardIds : []).map((id) => String(id)));
  const matchedIds = uniqueList(rawPlan.matched_card_ids || rawPlan.result_ids || [], {
    normalize: (v) => String(v || ''),
    max: 120,
  }).filter((id) => !allowedSet.size || allowedSet.has(id));

  const resultSummaryRaw = rawPlan.result_summary && typeof rawPlan.result_summary === 'object'
    ? rawPlan.result_summary
    : {};
  const totalParsed = Number(resultSummaryRaw.total ?? rawPlan.total ?? matchedIds.length);
  const returnedParsed = Number(resultSummaryRaw.returned ?? matchedIds.length);
  const total = Number.isFinite(totalParsed) && totalParsed >= 0 ? Math.round(totalParsed) : matchedIds.length;
  const returned = Number.isFinite(returnedParsed) && returnedParsed >= 0 ? Math.round(returnedParsed) : matchedIds.length;

  const uiActionRaw = rawPlan.ui_action && typeof rawPlan.ui_action === 'object' ? rawPlan.ui_action : {};
  const uiActionType = toUiAction(uiActionRaw.type);
  const uiAction = {
    type: uiActionType,
    cta: sanitizeText(uiActionRaw.cta, 140),
    auto_apply: Boolean(uiActionRaw.auto_apply),
  };

  let suggestedReply = sanitizeText(rawPlan.suggested_reply || rawPlan.reply || '');
  if (!suggestedReply) {
    suggestedReply = total > 0
      ? `Encontrei ${total} edital(is) para esse recorte.`
      : 'Nao encontrei resultados com esse recorte.';
  }
  const disclosure = scopeDisclosure(sourceScope);
  if (!normalizeText(suggestedReply).includes(normalizeText(disclosure))) {
    suggestedReply = `${suggestedReply}\n${disclosure}`;
  }
  suggestedReply = clampReplyLines(suggestedReply, 3);

  return {
    intent,
    answer_style: 'concise',
    scope,
    source_scope: sourceScope,
    filters: {
      estado,
      status,
      instituicao,
      area,
      deadline_days: deadlineDays,
      keywords,
    },
    sort: {
      field: sortField,
      direction: sortDirection,
    },
    matched_card_ids: matchedIds,
    result_summary: {
      total,
      returned,
    },
    ui_action: uiAction,
    suggested_reply: suggestedReply,
    query: sanitizeText(rawPlan.query || '', 300),
  };
}

export function dashboardPlanToLegacySearchPayload(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const filters = plan.filters && typeof plan.filters === 'object' ? plan.filters : {};
  let deadlineRange = '';
  if (Number(filters.deadline_days) === 7) deadlineRange = 'next_7_days';
  if (Number(filters.deadline_days) === 15) deadlineRange = 'next_15_days';

  return {
    intent: 'edital_search',
    query: String(plan.query || '').trim(),
    summary: String(plan.suggested_reply || '').trim(),
    total: Number(plan?.result_summary?.total || 0),
    result_ids: Array.isArray(plan.matched_card_ids) ? [...plan.matched_card_ids] : [],
    filters: {
      status: Array.isArray(filters.status) ? [...filters.status] : [],
      deadline_range: deadlineRange,
      categories: Array.isArray(filters.area) ? [...filters.area] : [],
      instituicoes: Array.isArray(filters.instituicao) ? [...filters.instituicao] : [],
      estado: Array.isArray(filters.estado) ? [...filters.estado] : [],
      keywords: Array.isArray(filters.keywords) ? [...filters.keywords] : [],
    },
  };
}

