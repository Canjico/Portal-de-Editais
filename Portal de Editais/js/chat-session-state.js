const CHAT_SESSION_STORAGE_KEY = 'athos_chat_session_state_v2';
const MAX_HISTORY_ITEMS = 24;
const MAX_SUMMARY_CHARS = 320;
const MAX_UI_OPTIONS = 10;
const MAX_UI_RESULT_IDS = 80;

export const DEFAULT_TOPIC_THRESHOLDS = Object.freeze({
  autoSwitch: 0.9,
  ambiguousMin: 0.6,
});

function createSessionId() {
  const hasCrypto = typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function';
  if (hasCrypto) return globalThis.crypto.randomUUID();
  return `chat_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function normalizeText(value, maxLen = 1200) {
  const raw = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, Math.max(0, maxLen - 3)).trimEnd()}...`;
}

function normalizeStringList(value, { maxItems = 20, maxLen = 180 } = {}) {
  const list = Array.isArray(value) ? value : (value == null ? [] : [value]);
  const seen = new Set();
  const out = [];

  list.forEach((item) => {
    const clean = normalizeText(item, maxLen);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });

  return out.slice(0, maxItems);
}

function normalizeUiSearchPayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  const filters = rawPayload.filters && typeof rawPayload.filters === 'object'
    ? rawPayload.filters
    : {};
  const resultIds = normalizeStringList(rawPayload.result_ids || rawPayload.resultIds || rawPayload.ids, {
    maxItems: MAX_UI_RESULT_IDS,
    maxLen: 120,
  });
  const normalized = {
    intent: normalizeText(rawPayload.intent || 'edital_search', 80) || 'edital_search',
    query: normalizeText(rawPayload.query, 260),
    summary: normalizeText(rawPayload.summary || rawPayload.reply, 360),
    total: Math.max(0, Math.trunc(Number(rawPayload.total || resultIds.length) || 0)),
    result_ids: resultIds,
    filters: {
      status: normalizeStringList(filters.status || filters.statuses, { maxItems: 4, maxLen: 40 }),
      deadline_range: normalizeText(filters.deadline_range || filters.deadlineRange || filters.deadline, 60),
      categories: normalizeStringList(filters.categories || filters.categorias, { maxItems: 20, maxLen: 160 }),
      instituicoes: normalizeStringList(filters.instituicoes || filters.instituicao, { maxItems: 20, maxLen: 180 }),
      estado: normalizeStringList(filters.estado || filters.estados, { maxItems: 27, maxLen: 12 }),
      keywords: normalizeStringList(filters.keywords || filters.termos || filters.temas, { maxItems: 20, maxLen: 80 }),
    },
  };

  const hasFilters = Object.entries(normalized.filters).some(([, value]) => (
    Array.isArray(value) ? value.length > 0 : Boolean(value)
  ));
  if (!normalized.result_ids.length && !hasFilters && !normalized.query) return null;
  return normalized;
}

function normalizeUiOption(rawOption) {
  if (!rawOption || typeof rawOption !== 'object') return null;
  const action = normalizeText(rawOption.action, 60);
  const title = normalizeText(rawOption.title || rawOption.label, 160);
  if (!action || !title) return null;

  const option = {
    action,
    title,
  };
  const id = normalizeText(rawOption.id ?? rawOption.edital_id ?? rawOption.editalId, 120);
  const query = normalizeText(rawOption.query, 260);
  const meta = normalizeText(rawOption.meta || rawOption.subtitle, 220);
  const payload = normalizeUiSearchPayload(rawOption.payload || rawOption.search_payload || rawOption.searchPayload);

  if (id) option.id = id;
  if (query) option.query = query;
  if (meta) option.meta = meta;
  if (payload) option.payload = payload;
  return option;
}

function normalizeConversationUi(rawUi) {
  if (!rawUi || typeof rawUi !== 'object') return null;
  const type = normalizeText(rawUi.type, 80);

  if (type === 'dashboard_options') {
    const searchPayload = normalizeUiSearchPayload(
      rawUi.search_payload || rawUi.searchPayload || rawUi.payload
    );
    const resultIds = normalizeStringList(
      rawUi.result_ids || rawUi.resultIds || searchPayload?.result_ids || rawUi.ids,
      { maxItems: MAX_UI_RESULT_IDS, maxLen: 120 }
    );
    const options = Array.isArray(rawUi.options)
      ? rawUi.options.map(normalizeUiOption).filter(Boolean).slice(0, MAX_UI_OPTIONS)
      : [];

    if (!resultIds.length && !searchPayload && !options.length) return null;
    return {
      type: 'dashboard_options',
      result_ids: resultIds,
      search_payload: searchPayload,
      options,
    };
  }

  if (type === 'sources') {
    const sources = Array.isArray(rawUi.sources)
      ? rawUi.sources
        .map((source) => {
          if (!source || typeof source !== 'object') return null;
          const title = normalizeText(source.title || source.source_name || source.name, 220);
          const url = normalizeText(source.url || source.source_url, 600);
          if (!title && !url) return null;
          return {
            title,
            url,
            type: normalizeText(source.type, 80),
            status: normalizeText(source.status, 80),
            editalId: normalizeText(source.editalId || source.edital_id, 120),
          };
        })
        .filter(Boolean)
        .slice(0, 12)
      : [];
    return sources.length ? { type: 'sources', sources } : null;
  }

  return null;
}

function normalizeHistoryEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== 'object') return null;
  const role = String(rawEntry.role || '').trim().toLowerCase();
  if (role !== 'user' && role !== 'assistant') return null;
  const text = normalizeText(rawEntry.text, 1600);
  if (!text) return null;
  const createdAt = String(rawEntry.createdAt || '').trim() || new Date().toISOString();
  const ui = role === 'assistant' ? normalizeConversationUi(rawEntry.ui) : null;
  return ui ? { role, text, createdAt, ui } : { role, text, createdAt };
}

function normalizeHistory(rawHistory) {
  if (!Array.isArray(rawHistory)) return [];
  const items = [];
  rawHistory.forEach((entry) => {
    const normalized = normalizeHistoryEntry(entry);
    if (normalized) items.push(normalized);
  });
  return items.slice(-MAX_HISTORY_ITEMS);
}

function buildShortSummary(conversationHistory) {
  const turns = Array.isArray(conversationHistory) ? conversationHistory.slice(-6) : [];
  if (!turns.length) return '';
  const summary = turns
    .map((turn) => `${turn.role === 'user' ? 'U' : 'A'}: ${normalizeText(turn.text, 80)}`)
    .join(' | ');
  if (summary.length <= MAX_SUMMARY_CHARS) return summary;
  return `${summary.slice(0, MAX_SUMMARY_CHARS - 3).trimEnd()}...`;
}

function normalizeThresholds(rawThresholds) {
  const autoSwitch = clamp(rawThresholds?.autoSwitch ?? DEFAULT_TOPIC_THRESHOLDS.autoSwitch, 0.75, 0.99);
  const ambiguousMin = clamp(rawThresholds?.ambiguousMin ?? DEFAULT_TOPIC_THRESHOLDS.ambiguousMin, 0.4, autoSwitch);
  return { autoSwitch, ambiguousMin };
}

function toLegacyFields(state) {
  if ((state.activeContextType || 'general') === 'edital' && state.activeEntityId) {
    return {
      mode: 'edital',
      edital_id: state.activeEntityId,
      titulo: state.activeEntityTitle || 'Edital',
      activeTitle: state.activeEntityTitle || 'Edital',
    };
  }
  return {
    mode: 'general',
    edital_id: null,
    titulo: '',
    activeTitle: '',
  };
}

export function createChatSessionState(overrides = {}) {
  const history = normalizeHistory(overrides.conversationHistory);
  const activeContextType = String(overrides.activeContextType || '').trim().toLowerCase() || 'general';
  const activeEntityId = overrides.activeEntityId == null ? null : String(overrides.activeEntityId).trim();
  const activeEntityTitle = normalizeText(overrides.activeEntityTitle ?? overrides.activeTitle, 180);
  const state = {
    sessionId: String(overrides.sessionId || '').trim() || createSessionId(),
    activeContext: normalizeText(overrides.activeContext, 240),
    activeContextType: activeContextType || 'general',
    activeEntityId: activeEntityId || null,
    activeEntityTitle: activeEntityTitle || '',
    conversationHistory: history,
    shortSummary: normalizeText(overrides.shortSummary, MAX_SUMMARY_CHARS) || buildShortSummary(history),
    pendingTopicExitConfirmation: Boolean(overrides.pendingTopicExitConfirmation),
    lastTopicDetection: (overrides.lastTopicDetection && typeof overrides.lastTopicDetection === 'object')
      ? {
        decision: String(overrides.lastTopicDetection.decision || '').trim(),
        confidence: clamp(overrides.lastTopicDetection.confidence, 0, 1),
        reason: String(overrides.lastTopicDetection.reason || '').trim(),
      }
      : null,
    topicConfidence: clamp(overrides.topicConfidence, 0, 1),
    lastUserIntent: String(overrides.lastUserIntent || '').trim() || 'unknown',
    topicThresholds: normalizeThresholds(overrides.topicThresholds),
    hasUserInteracted: Boolean(overrides.hasUserInteracted),
    hasSentFirstMessage: Boolean(overrides.hasSentFirstMessage || overrides.hasUserInteracted),
    shouldHideInitialSuggestions: Boolean(
      overrides.shouldHideInitialSuggestions ?? overrides.hasUserInteracted ?? overrides.hasSentFirstMessage
    ),
    firstInteractionSource: String(overrides.firstInteractionSource || '').trim() || '',
    firstInteractionAt: String(overrides.firstInteractionAt || '').trim() || '',
  };
  return { ...state, ...toLegacyFields(state) };
}

export function sanitizeChatSessionState(rawState) {
  if (!rawState || typeof rawState !== 'object') {
    return createChatSessionState();
  }

  const inferredType = String(rawState.activeContextType || '').trim().toLowerCase()
    || (String(rawState.mode || '').trim().toLowerCase() === 'edital' ? 'edital' : 'general');
  const inferredEntityId = rawState.activeEntityId ?? rawState.edital_id ?? null;
  const inferredEntityTitle = rawState.activeEntityTitle ?? rawState.activeTitle ?? rawState.titulo ?? '';
  const inferredContext = rawState.activeContext
    || (inferredType === 'edital' && inferredEntityId ? `edital:${inferredEntityId}` : '');

  return createChatSessionState({
    sessionId: rawState.sessionId,
    activeContext: inferredContext,
    activeContextType: inferredType,
    activeEntityId: inferredEntityId,
    activeEntityTitle: inferredEntityTitle,
    conversationHistory: rawState.conversationHistory,
    shortSummary: rawState.shortSummary,
    pendingTopicExitConfirmation: rawState.pendingTopicExitConfirmation,
    lastTopicDetection: rawState.lastTopicDetection,
    topicConfidence: rawState.topicConfidence,
    lastUserIntent: rawState.lastUserIntent,
    topicThresholds: rawState.topicThresholds,
    hasUserInteracted: rawState.hasUserInteracted,
    hasSentFirstMessage: rawState.hasSentFirstMessage,
    shouldHideInitialSuggestions: rawState.shouldHideInitialSuggestions,
    firstInteractionSource: rawState.firstInteractionSource,
    firstInteractionAt: rawState.firstInteractionAt,
  });
}

export function ensureChatSessionState(state) {
  return sanitizeChatSessionState(state);
}

export function loadChatSessionState(storage = globalThis?.sessionStorage) {
  try {
    const raw = storage?.getItem?.(CHAT_SESSION_STORAGE_KEY);
    if (!raw) return createChatSessionState();
    return sanitizeChatSessionState(JSON.parse(raw));
  } catch (_) {
    return createChatSessionState();
  }
}

export function saveChatSessionState(state, storage = globalThis?.sessionStorage) {
  const sanitized = sanitizeChatSessionState(state);
  try {
    storage?.setItem?.(CHAT_SESSION_STORAGE_KEY, JSON.stringify(sanitized));
  } catch (_) {}
  return sanitized;
}

export function clearChatSessionState(storage = globalThis?.sessionStorage) {
  try {
    storage?.removeItem?.(CHAT_SESSION_STORAGE_KEY);
  } catch (_) {}
}

export function setActiveEditalContextInState(state, edital) {
  const current = sanitizeChatSessionState(state);
  if (!edital || edital.id == null) return current;
  return sanitizeChatSessionState({
    ...current,
    activeContext: `edital:${String(edital.id)}`,
    activeContextType: 'edital',
    activeEntityId: String(edital.id),
    activeEntityTitle: normalizeText(edital.titulo || 'Edital', 180) || 'Edital',
    pendingTopicExitConfirmation: false,
  });
}

export function clearActiveContextInState(state) {
  const current = sanitizeChatSessionState(state);
  return sanitizeChatSessionState({
    ...current,
    activeContext: '',
    activeContextType: 'general',
    activeEntityId: null,
    activeEntityTitle: '',
    pendingTopicExitConfirmation: false,
  });
}

export function setPendingTopicExitConfirmation(state, pending) {
  const current = sanitizeChatSessionState(state);
  return sanitizeChatSessionState({
    ...current,
    pendingTopicExitConfirmation: Boolean(pending),
  });
}

export function markChatUserInteracted(state, source = 'message_send') {
  const current = sanitizeChatSessionState(state);
  if (current.hasUserInteracted) return current;
  return sanitizeChatSessionState({
    ...current,
    hasUserInteracted: true,
    hasSentFirstMessage: true,
    shouldHideInitialSuggestions: true,
    firstInteractionSource: String(source || '').trim() || 'message_send',
    firstInteractionAt: current.firstInteractionAt || new Date().toISOString(),
  });
}

export function shouldHideInitialChatSuggestions(state) {
  const current = sanitizeChatSessionState(state);
  return Boolean(current.shouldHideInitialSuggestions || current.hasUserInteracted || current.hasSentFirstMessage);
}

export function updateTopicDetection(state, detection, lastUserIntent = null) {
  const current = sanitizeChatSessionState(state);
  const normalizedDetection = (detection && typeof detection === 'object')
    ? {
      decision: String(detection.decision || '').trim(),
      confidence: clamp(detection.confidence, 0, 1),
      reason: String(detection.reason || '').trim(),
    }
    : null;

  return sanitizeChatSessionState({
    ...current,
    lastTopicDetection: normalizedDetection,
    topicConfidence: normalizedDetection?.confidence ?? current.topicConfidence,
    lastUserIntent: String(lastUserIntent || current.lastUserIntent || 'unknown').trim() || 'unknown',
  });
}

export function appendConversationTurn(state, role, text, metadata = {}) {
  const current = sanitizeChatSessionState(state);
  const entry = normalizeHistoryEntry({
    role,
    text,
    ui: metadata?.ui,
    createdAt: new Date().toISOString(),
  });
  if (!entry) return current;

  const conversationHistory = Array.isArray(current.conversationHistory) ? [...current.conversationHistory] : [];
  const recentWindow = conversationHistory.slice(-3);
  const normalizedEntryText = normalizeText(entry.text, 1600).toLowerCase();
  const hasDuplicate = recentWindow.some((turn) => (
    String(turn?.role || '').trim().toLowerCase() === entry.role
    && normalizeText(turn?.text, 1600).toLowerCase() === normalizedEntryText
  ));
  if (hasDuplicate) {
    return current;
  }

  conversationHistory.push(entry);
  const trimmed = conversationHistory.slice(-MAX_HISTORY_ITEMS);
  return sanitizeChatSessionState({
    ...current,
    conversationHistory: trimmed,
    shortSummary: buildShortSummary(trimmed),
  });
}

export function setLatestAssistantConversationTurn(state, turn) {
  const current = sanitizeChatSessionState(state);
  const isStructuredTurn = turn && typeof turn === 'object' && !Array.isArray(turn);
  const entry = normalizeHistoryEntry({
    role: 'assistant',
    text: isStructuredTurn ? turn.text : turn,
    ui: isStructuredTurn ? turn.ui : null,
    createdAt: new Date().toISOString(),
  });
  if (!entry) return current;

  const conversationHistory = Array.isArray(current.conversationHistory)
    ? [...current.conversationHistory]
    : [];
  const roles = conversationHistory.map((historyTurn) => String(historyTurn?.role || '').trim().toLowerCase());
  const lastUserIndex = roles.lastIndexOf('user');
  const lastAssistantIndex = roles.lastIndexOf('assistant');

  if (lastAssistantIndex > lastUserIndex) {
    conversationHistory[lastAssistantIndex] = {
      ...conversationHistory[lastAssistantIndex],
      text: entry.text,
      createdAt: conversationHistory[lastAssistantIndex]?.createdAt || entry.createdAt,
      ...(entry.ui ? { ui: entry.ui } : {}),
    };
    if (!entry.ui) delete conversationHistory[lastAssistantIndex].ui;

    return sanitizeChatSessionState({
      ...current,
      conversationHistory,
      shortSummary: buildShortSummary(conversationHistory),
    });
  }

  conversationHistory.push(entry);
  const trimmed = conversationHistory.slice(-MAX_HISTORY_ITEMS);
  return sanitizeChatSessionState({
    ...current,
    conversationHistory: trimmed,
    shortSummary: buildShortSummary(trimmed),
  });
}

export function restoreConversationHistory(state) {
  const current = sanitizeChatSessionState(state);
  return Array.isArray(current.conversationHistory) ? [...current.conversationHistory] : [];
}
