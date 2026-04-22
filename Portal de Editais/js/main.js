/* =========================================================
   Athos / Atimus — Editais (UX/UI novo + filtros + paginação)
   ========================================================= */

import { renderEditais } from './render.js?v=20260318.3';
import {
  parseAnyDateToTime,
  buildSearchQueryContext,
} from './search-date-utils.js?v=20260313.1';
import {
  appendConversationTurn,
  clearChatSessionState,
  clearActiveContextInState,
  createChatSessionState,
  ensureChatSessionState,
  loadChatSessionState,
  restoreConversationHistory,
  saveChatSessionState,
  setActiveEditalContextInState,
  setPendingTopicExitConfirmation,
  updateTopicDetection,
} from './chat-session-state.js?v=20260401.1';
import {
  markInitialChatInteraction,
  prefersReducedMotion,
  shouldShowInitialChatSuggestions,
} from './chat-initial-suggestions.js?v=20260401.1';
import {
  buildTopicDisambiguationNotice,
  detectTopicTransition,
  isExplicitStayCommand,
} from './chat-topic-detector.js?v=20260401.1';
import {
  createDashboardAssistantMemory,
  runDashboardAssistantSemanticQuery,
} from './chat-card-semantics.js?v=20260402.1';
import {
  dashboardPlanToLegacySearchPayload,
  normalizeDashboardAssistantPlan,
} from './chat-dashboard-contract.js?v=20260403.1';
import { createSingleFlight, runWhenIdle } from './bootstrap-utils.js?v=20260422.3';
import { createAbortableRequestTracker } from './chat-stream-controller.js?v=20260421.1';
import {
  parseSseDataPayload,
  readSsePayloadsFromBuffer,
} from './chat-stream-sse.js?v=20260421.1';

// =========================
// CONFIGURAÇÕES & SEGURANÇA
// =========================
import {
  API_BASE,
  LOGIN_URL,
  bootstrapAuthFromUrl,
  buildLoginUrlWithNext,
  getStoredToken,
  readBootstrapUserFromSession,
  apiFetch,
  apiFetchJson,
  isPasswordChangeRequiredPayload,
  isPasswordChangeRequiredResponse,
  resolvePasswordChangeRedirectTarget,
  resolveAuthFailureRedirectTarget,
  redirectWithAuthGuard,
} from './auth.js?v=20260422.3';
import { runDashboardBootstrapFlow } from './bootstrap-flows.js?v=20260422.3';

const APP_BASE_URL = new URL('../', import.meta.url);
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,255}$/;
const PERF_DEBUG_TAG = '[PERF][Dashboard]';
const BOOTSTRAP_DEBUG_TAG = '[BOOTSTRAP][Dashboard]';
const LIST_REQUEST_DEBUG_TAG = '[PERF][Dashboard][Listagem]';
const FACET_REQUEST_DEBUG_TAG = '[PERF][Dashboard][Facets]';
const PERF_DEBUG_STORAGE_KEY = 'athos_perf_debug';
const BOOTSTRAP_DEBUG_STORAGE_KEY = 'athos_bootstrap_debug';
const SEARCH_INPUT_DEBOUNCE_MS = 300;
let dashboardGlobalBootstrapErrorHandlersBound = false;
let deferredFacetRefreshScheduled = false;

function isPerfDebugEnabled() {
  try {
    if (window.ATHOS_PERF_DEBUG === true) return true;
  } catch (_) {}

  const host = String(window.location.hostname || '').toLowerCase();
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    return true;
  }

  try {
    const value = String(
      localStorage.getItem(PERF_DEBUG_STORAGE_KEY) ||
      sessionStorage.getItem(PERF_DEBUG_STORAGE_KEY) ||
      ''
    )
      .trim()
      .toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
  } catch (_) {
    return false;
  }
}

function isBootstrapDebugEnabled() {
  try {
    if (window.ATHOS_BOOTSTRAP_DEBUG === true) return true;
  } catch (_) {}

  const host = String(window.location.hostname || '').toLowerCase();
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    return true;
  }

  try {
    const value = String(
      localStorage.getItem(BOOTSTRAP_DEBUG_STORAGE_KEY) ||
      sessionStorage.getItem(BOOTSTRAP_DEBUG_STORAGE_KEY) ||
      ''
    )
      .trim()
      .toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
  } catch (_) {
    return false;
  }
}

function logBootstrapStep(event, details) {
  if (!event || !isBootstrapDebugEnabled()) return;
  if (details === undefined) {
    console.info(`${BOOTSTRAP_DEBUG_TAG} ${event}`);
    return;
  }
  console.info(`${BOOTSTRAP_DEBUG_TAG} ${event}`, details);
}

function logBootstrapError(event, error, details = {}) {
  const payload = {
    ...(details && typeof details === 'object' ? details : {}),
    error,
  };
  console.error(`${BOOTSTRAP_DEBUG_TAG} ${event}`, payload);
}

function reportBootstrapFlowStep(event, details) {
  const step = String(event || '').trim();
  if (!step) return;

  if (step.endsWith('_error')) {
    logBootstrapStep(step, details);
    return;
  }

  logBootstrapStep(step, details);
}

function ensureBootstrapGlobalErrorHandlersInDev() {
  if (dashboardGlobalBootstrapErrorHandlersBound || !isBootstrapDebugEnabled()) return;
  dashboardGlobalBootstrapErrorHandlersBound = true;

  const previousOnError = window.onerror;
  const previousOnUnhandledRejection = window.onunhandledrejection;

  window.onerror = function onBootstrapWindowError(message, source, lineno, colno, error) {
    logBootstrapError('window.onerror', error, {
      message: String(message || ''),
      source: String(source || ''),
      lineno: Number(lineno || 0),
      colno: Number(colno || 0),
    });

    if (typeof previousOnError === 'function') {
      try {
        return previousOnError.call(this, message, source, lineno, colno, error);
      } catch (handlerError) {
        logBootstrapError('window.onerror_handler_error', handlerError);
      }
    }
    return false;
  };

  window.onunhandledrejection = function onBootstrapUnhandledRejection(event) {
    const reason = event?.reason;
    const rejectionError = reason instanceof Error
      ? reason
      : new Error(String(reason || 'Unhandled promise rejection'));
    logBootstrapError('window.onunhandledrejection', rejectionError, { reason });

    if (typeof previousOnUnhandledRejection === 'function') {
      try {
        return previousOnUnhandledRejection.call(this, event);
      } catch (handlerError) {
        logBootstrapError('window.onunhandledrejection_handler_error', handlerError);
      }
    }
    return undefined;
  };

  logBootstrapStep('global_error_handlers_installed');
}

function perfMark(name) {
  if (!name || typeof performance?.mark !== 'function') return;
  try {
    performance.mark(name);
  } catch (_) {}
}

function perfMeasure(name, startMark, endMark) {
  if (!name || !startMark || !endMark || typeof performance?.measure !== 'function') return;
  try {
    performance.measure(name, startMark, endMark);
    if (!isPerfDebugEnabled()) return;
    const measures = performance.getEntriesByName(name);
    const latest = measures[measures.length - 1];
    if (!latest) return;
    console.debug(`${PERF_DEBUG_TAG} ${name}`, {
      durationMs: Number(latest.duration || 0).toFixed(1),
      startMark,
      endMark,
    });
  } catch (_) {}
}

function normalizeShareTokenParam(value) {
  const token = String(value || '').trim();
  return SHARE_TOKEN_PATTERN.test(token) ? token : '';
}

function extractShareTokenFromLink(link) {
  const raw = String(link || '').trim();
  if (!raw) return '';

  const patterns = [
    /\/share\/edital\/([A-Za-z0-9_-]{20,255})$/i,
    /\/edital\/publico\/([A-Za-z0-9_-]{20,255})$/i,
    /\/edital-publico(?:\.html)?\/([A-Za-z0-9_-]{20,255})$/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && SHARE_TOKEN_PATTERN.test(String(match[1] || ''))) {
      return match[1];
    }
  }

  try {
    const parsed = new URL(raw, window.location.origin);
    const qsToken = normalizeShareTokenParam(parsed.searchParams.get('token'));
    if (qsToken) return qsToken;
    const pathname = String(parsed.pathname || '').replace(/\/+$/, '');
    for (const pattern of patterns) {
      const match = pathname.match(pattern);
      if (match && SHARE_TOKEN_PATTERN.test(String(match[1] || ''))) {
        return match[1];
      }
    }
  } catch (_) {}

  return '';
}

// =========================
// ESTADO
// =========================
let editaisOriginais = [];

const PAGE_SIZE = 12;
const INITIAL_PAGE_SIZE = 12;
let currentPage = 1;
let lastFiltered = [];
let kpiFilter = 'all';
let assistantPanelContext = null;
let assistantSemanticMemory = createDashboardAssistantMemory();
let bootstrapInitPromise = null;
let uiEventsBound = false;
let lastLoadedListPath = '';
let lastLoadedListIncludedFacets = false;
let applyFiltersRenderSeq = 0;
let searchInputDebounceTimer = null;
let listRequestCounter = 0;
let activeListRequest = null;
let facetRequestCounter = 0;
let activeFacetRequest = null;
let serverPageState = {
  total: 0,
  page: 1,
  pageSize: PAGE_SIZE,
  hasNext: false,
};
const EMPTY_SERVER_FILTER_FACETS = Object.freeze({
  estado: [],
  instituicao: [],
  area: [],
});
let serverFilterFacets = {
  estado: [],
  instituicao: [],
  area: [],
};
let serverFilterFacetsSignature = '';
let lastRenderedFacetSignature = '__not_rendered__';
let serverFacetContextSignature = '';
let serverFacetsLoaded = false;
let serverFacetUiState = 'ready';
let serverFacetUiMessage = '';
const loadEditaisSingleFlight = createSingleFlight(() => loadEditais());
const loadFavoritosSingleFlight = createSingleFlight(() => loadFavoritos());

// Filtros aplicados (só mudam quando clicar em "Aplicar filtros")
let applied = {
  estado: [],
  instituicao: [],
  area: [],
};

const CATEGORY_OPTIONS = [
  { value: 'Governo e Políticas Públicas', label: 'Governo & Políticas Públicas' },
  { value: 'Administração e Gestão', label: 'Administração & Gestão' },
  { value: 'Tecnologia e Inovação', label: 'Tecnologia & Inovação' },
  { value: 'Educação e Capacitação', label: 'Educação & Capacitação' },
  { value: 'Saúde e Bem-Estar', label: 'Saúde & Bem-Estar' },
  { value: 'Meio Ambiente e Sustentabilidade', label: 'Meio Ambiente & Sustentabilidade' },
  { value: 'Agricultura e Desenvolvimento Rural', label: 'Agricultura & Desenvolvimento Rural' },
  { value: 'Infraestrutura, Obras e Engenharia', label: 'Infraestrutura, Obras & Engenharia' },
  { value: 'Logística, Suprimentos e Operações', label: 'Logística, Suprimentos & Operações' },
  { value: 'Economia, Finanças e Licitações', label: 'Economia, Finanças & Licitações' },
  { value: 'Ciência, Pesquisa e Desenvolvimento', label: 'Ciência, Pesquisa & Desenvolvimento' },
  { value: 'Social, Direitos e Comunidade', label: 'Social, Direitos & Comunidade' },
  { value: 'Cultura, Arte e Patrimônio', label: 'Cultura, Arte & Patrimônio' },
  { value: 'Esporte, Lazer e Qualidade de Vida', label: 'Esporte, Lazer & Qualidade de Vida' },
  { value: 'Cooperação e Relações Internacionais', label: 'Cooperação & Relações Internacionais' },
];

const INSTRUMENT_OPTIONS = [
  'Financiamento não reembolsável',
  'Bolsa para pesquisadores',
  'Prêmios de Inovação',
  'Financiamento reembolsável',
  'Edital privado',
  'Fundo de Investimento',
];

const FILTER_META = {
  estado: { label: 'Estado', icon: 'fa-map' },
  instituicao: { label: 'Instituição', icon: 'fa-building' },
  area: { label: 'Categoria', icon: 'fa-tags' },
};

const ESTADO_LABELS = {
  BR: 'Brasil',
  AC: 'Acre',
  AL: 'Alagoas',
  AP: 'Amapá',
  AM: 'Amazonas',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais',
  PA: 'Pará',
  PB: 'Paraíba',
  PR: 'Paraná',
  PE: 'Pernambuco',
  PI: 'Piauí',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul',
  RO: 'Rondônia',
  RR: 'Roraima',
  SC: 'Santa Catarina',
  SP: 'São Paulo',
  SE: 'Sergipe',
  TO: 'Tocantins',
};


// =========================
// SALVOS (FAVORITOS)
// =========================
let favoritosSet = new Set();   // ids como string
let onlyFavoritos = false;

// =========================
// ELEMENTOS DOM (novo layout)
// =========================
const container = document.getElementById('editais-container');
const searchInput = document.getElementById('search');
const searchWrapper = document.getElementById('mainSearchWrapper');
const sortSelect = document.getElementById('sortSelect');
const sortChips = document.getElementById('sortChips');
const sortDirectionBtn = document.getElementById('sortDirectionBtn');
const sortDirectionIcon = document.getElementById('sortDirectionIcon');
const sortDirectionText = document.getElementById('sortDirectionText');
const resultsMeta = document.getElementById('resultsMeta');
const paginationEl = document.getElementById('pagination');
const resultsStateHint = document.getElementById('resultsStateHint');

let sortField = normalizeSortValue(sortSelect?.value || 'prazo');
let sortDirection = getDefaultSortDirection(sortField);

// Hero stats
const statTotal = document.getElementById('statTotal');
const statAbertos = document.getElementById('statAbertos');
const statFechados = document.getElementById('statFechados');
const statChipTotal = document.getElementById('statChipTotal');
const statChipAbertos = document.getElementById('statChipAbertos');
const statChipFechados = document.getElementById('statChipFechados');

// Filtros
const filtersPanel = document.getElementById('filtersPanel');
const applyFiltersBtn = document.getElementById('applyFiltersBtn');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
const clearActiveFiltersBtn = document.getElementById('clearActiveFiltersBtn');
const mobileFiltersBtn = document.getElementById('mobileFiltersBtn');
const filtersBackdrop = document.getElementById('filtersBackdrop');
const filtersCloseBtn = document.getElementById('filtersCloseBtn');
const mobileSidebarBtn = document.getElementById('mobileSidebarBtn');
const mobileSidebarBackdrop = document.getElementById('mobileSidebarBackdrop');
const filtersCountBadge = document.getElementById('filtersCountBadge');
const filtersAppliedState = document.getElementById('filtersAppliedState');
const activeFiltersBar = document.getElementById('activeFiltersBar');
const activeFiltersChips = document.getElementById('activeFiltersChips');
const filtersFooterSummary = document.getElementById('filtersFooterSummary');

const filterSearchEstado = document.getElementById('filterSearchEstado');
const filterSearchInstituicao = document.getElementById('filterSearchInstituicao');
const filterSearchArea = document.getElementById('filterSearchArea');
const sidebarAvatar = document.getElementById('sidebarAvatar');
const sidebarUserName = document.getElementById('sidebarUserName');
const sidebarUserEmail = document.getElementById('sidebarUserEmail');

// Sidebar + topbar
const sidebarToggle = document.getElementById('sidebarToggle');
const appSidebar = document.getElementById('appSidebar');
const userMenu = document.getElementById('userMenu');
const userMenuBtn = document.getElementById('userMenuBtn');
const logoutIconBtn = document.getElementById('logoutIconBtn');
const logoutBtn = document.getElementById('logoutBtn');

// Salvos
const savedToggleBtn = document.getElementById('savedToggleBtn');
const savedBadge = document.getElementById('savedBadge');

// Modal
const modalOverlay = document.getElementById('modal-overlay');
const modalContentContainer = document.getElementById('modal-content-container');
const modalCloseBtn = document.getElementById('close-modal-btn') || document.getElementById('modal-close-btn');

// Chat
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const messageContainer = document.getElementById('chatbot-messages');
const chatWrapper = document.getElementById('chatbot-wrapper');
const chatQuickPrompts = document.getElementById('chatQuickPrompts');
const chatButton = document.querySelector('.e-contact-buttons__chat-button');
const chatHeader = document.querySelector('.chat-header');
const chatHeaderTitle = document.querySelector('.chat-header-title');
const chatCloseBtn = document.getElementById('chatCloseBtn');
const chatButtonContainer = document.querySelector('.e-contact-buttons__chat-button-container');
const assistantBackdrop = document.getElementById('assistantBackdrop');

const ASSISTANT_OVERLAY_BREAKPOINT = '(max-width: 1279px)';

let botIsTyping = false;
let chatState = createChatSessionState();
let chatQuickPromptsTransitionCleanup = null;
const chatRequestTracker = createAbortableRequestTracker();
const CHAT_SEND_BUTTON_SEND_HTML = '<i class="fas fa-paper-plane" aria-hidden="true"></i>';
const CHAT_SEND_BUTTON_STOP_HTML = '<i class="fas fa-stop" aria-hidden="true"></i>';

function persistChatState(nextState = chatState) {
  chatState = saveChatSessionState(ensureChatSessionState(nextState));
  return chatState;
}

function bootstrapChatSessionState() {
  chatState = loadChatSessionState(window.sessionStorage);
}

function replayChatSessionHistory() {
  if (!messageContainer || messageContainer.children.length > 0) return;
  const history = restoreConversationHistory(chatState);
  history.forEach((entry) => {
    const sender = entry?.role === 'assistant' ? 'bot' : 'user';
    addMessage(entry?.text || '', sender);
  });
}

function clearChatQuickPromptsTransitionListener() {
  if (typeof chatQuickPromptsTransitionCleanup === 'function') {
    try {
      chatQuickPromptsTransitionCleanup();
    } catch (_) {}
  }
  chatQuickPromptsTransitionCleanup = null;
}

function setQuickPromptsCollapsedInstantly() {
  if (!chatQuickPrompts) return;
  clearChatQuickPromptsTransitionListener();
  chatQuickPrompts.classList.remove('is-collapsing');
  chatQuickPrompts.classList.add('is-collapsed');
  chatQuickPrompts.hidden = true;
}

function revealQuickPromptsInstantly() {
  if (!chatQuickPrompts) return;
  clearChatQuickPromptsTransitionListener();
  chatQuickPrompts.hidden = false;
  chatQuickPrompts.classList.remove('is-collapsing');
  chatQuickPrompts.classList.remove('is-collapsed');
}

function collapseQuickPromptsWithAnimation() {
  if (!chatQuickPrompts) return;
  if (chatQuickPrompts.hidden || chatQuickPrompts.classList.contains('is-collapsing') || chatQuickPrompts.classList.contains('is-collapsed')) {
    setQuickPromptsCollapsedInstantly();
    return;
  }

  if (prefersReducedMotion(window)) {
    setQuickPromptsCollapsedInstantly();
    return;
  }

  clearChatQuickPromptsTransitionListener();
  const measuredHeight = Math.max(chatQuickPrompts.scrollHeight, chatQuickPrompts.offsetHeight, 1);
  chatQuickPrompts.style.setProperty('--chat-quick-prompts-expanded-height', `${measuredHeight}px`);
  chatQuickPrompts.hidden = false;
  chatQuickPrompts.classList.add('is-collapsing');

  const onTransitionEnd = (event) => {
    if (event.target !== chatQuickPrompts || event.propertyName !== 'max-height') return;
    clearChatQuickPromptsTransitionListener();
    if (!chatQuickPrompts) return;
    chatQuickPrompts.classList.remove('is-collapsing');
    chatQuickPrompts.classList.add('is-collapsed');
    chatQuickPrompts.hidden = true;
  };

  chatQuickPrompts.addEventListener('transitionend', onTransitionEnd);
  chatQuickPromptsTransitionCleanup = () => {
    chatQuickPrompts?.removeEventListener?.('transitionend', onTransitionEnd);
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      chatQuickPrompts?.classList?.add('is-collapsed');
    });
  });
}

function syncInitialQuickPromptsVisibility({ animate = false } = {}) {
  if (!chatQuickPrompts) return;
  const hasActiveContext = Boolean(getActiveEditalContext()?.editalId);
  const shouldShow = shouldShowInitialChatSuggestions(chatState, { hasActiveContext });
  if (shouldShow) {
    revealQuickPromptsInstantly();
    return;
  }
  if (animate) {
    collapseQuickPromptsWithAnimation();
    return;
  }
  setQuickPromptsCollapsedInstantly();
}

function markFirstChatInteraction(source = 'message_send', { animateSuggestions = true } = {}) {
  const hadInteraction = Boolean(chatState?.hasUserInteracted);
  chatState = markInitialChatInteraction(chatState, source);
  persistChatState(chatState);
  if (!hadInteraction) {
    syncInitialQuickPromptsVisibility({ animate: animateSuggestions });
  }
}

// =========================
// INIT
// =========================
document.addEventListener('DOMContentLoaded', () => {
  void init();
});

async function init() {
  if (bootstrapInitPromise) return bootstrapInitPromise;
  perfMark('dashboard_bootstrap_start');
  ensureBootstrapGlobalErrorHandlersInDev();

  bootstrapInitPromise = runDashboardBootstrapFlow({
    bootstrapAuthFromUrl,
    bootstrapChatSessionState,
    bootstrapTheme: () => window.AthosTheme?.bootstrap?.(),
    checkAuth,
    hydrateSidebarUser,
    prepareShell: () => {
      if (!uiEventsBound) {
        setupUIEvents();
        uiEventsBound = true;
      }
      setupConsentAwareOptionalFeatures();
      replayChatSessionHistory();
      updateChatHeader();
      persistChatState(chatState);
      syncKpiButtons();
      setSearchVisualState();
      renderChatQuickPrompts();
      syncInitialQuickPromptsVisibility({ animate: false });
    },
    markAppReady,
    loadEditais: loadEditaisSingleFlight,
    loadFavoritos: loadFavoritosSingleFlight,
    onAuthError: (error) => {
      logBootstrapError('checkAuth_error', error, { source: 'runDashboardBootstrapFlow' });
      redirectWithAuthGuard(buildLoginUrlWithNext(), 'main.init.checkAuth_error');
    },
    logStep: reportBootstrapFlowStep,
    onEditaisReady: async () => {
      if (hasPersonalizedRelevance(editaisOriginais)) {
        try {
          setSortField('relevancia', { resetDirection: true });
        } catch (error) {
          logBootstrapError('onEditaisReady_sort_relevance_error', error);
        }
      }

      let cardsRendered = false;
      try {
        await applyFiltersAndRender({ resetPage: true, deferFacets: true });
        cardsRendered = true;
      } catch (error) {
        logBootstrapError('onEditaisReady_first_render_error', error);
      }

      if (!cardsRendered) {
        renderEditaisCardsFallback({
          source: 'onEditaisReady_first_render_fallback',
        });
      }

      try {
        generateDynamicFilters();
        setupFilterGroupsAccordion();
      } catch (error) {
        logBootstrapError('onEditaisReady_facets_shell_error', error);
      }

      scheduleDeferredFacetRefresh();
    },
    onDeepLinkReady: openDeepLinkedEditalFromUrl,
    onFavoritosReady: ({ editaisReady }) => {
      applyFavoritosToLoadedEditais();
      if (editaisReady) {
        void applyFiltersAndRender({ resetPage: false, deferFacets: true }).catch((error) => {
          logBootstrapError('onFavoritosReady_render_error', error);
          renderEditaisCardsFallback({
            source: 'onFavoritosReady_render_fallback',
          });
        });
      }
    },
    onFavoritosError: () => {
      applyFavoritosToLoadedEditais();
    },
  }).catch((err) => {
    logBootstrapError('init_error', err);
    bootstrapInitPromise = null;
    markAppReady();
    return null;
  });

  return bootstrapInitPromise;
}

function scheduleDeferredFacetRefresh() {
  if (deferredFacetRefreshScheduled) return;
  deferredFacetRefreshScheduled = true;

  void runWhenIdle(async () => {
    logBootstrapStep('deferredFacets_start');
    try {
      await applyFiltersAndRender({
        resetPage: false,
        forceReload: false,
        deferFacets: false,
      });
      logBootstrapStep('deferredFacets_done');
    } catch (error) {
      logBootstrapError('deferredFacets_error', error);
    } finally {
      deferredFacetRefreshScheduled = false;
    }
  }).catch((error) => {
    deferredFacetRefreshScheduled = false;
    logBootstrapError('deferredFacets_schedule_error', error);
  });
}

function renderEditaisCardsFallback({ source = 'fallback' } = {}) {
  if (!container) return;

  try {
    const pageItems = [...editaisOriginais];
    lastFiltered = pageItems;

    const total = Math.max(0, Number(serverPageState.total || pageItems.length || 0));
    const pageSize = Math.max(1, Number(serverPageState.pageSize || INITIAL_PAGE_SIZE));
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    currentPage = Math.min(Math.max(1, Number(serverPageState.page || currentPage || 1)), totalPages);

    const startIdx = total === 0 ? 0 : ((currentPage - 1) * pageSize);
    const endIdx = total === 0 ? 0 : Math.min(startIdx + pageItems.length, total);
    if (resultsMeta) {
      const from = total === 0 ? 0 : startIdx + 1;
      const label = onlyFavoritos ? 'salvos' : 'editais';
      resultsMeta.textContent = `Mostrando ${from}-${endIdx} de ${total} ${label}`;
    }

    updateHeroStats(pageItems, { totalOverride: total });
    syncKpiButtons();
    renderResultsStateHint(total);
    renderEditais(container, pageItems, {
      emptyState: buildEmptyState({
        total,
        termo: (searchInput?.value || '').trim(),
      }),
    });
    renderPagination(totalPages);
    logBootstrapStep('cards_fallback_rendered', {
      source,
      total,
      renderedItems: pageItems.length,
    });
  } catch (error) {
    logBootstrapError('cards_fallback_render_error', error, { source });
  }
}

async function openDeepLinkedEditalFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const shareToken = normalizeShareTokenParam(urlParams.get('share_token'));
  const editalSlug = urlParams.get('edital');
  const editalId = urlParams.get('id');

  if (shareToken) {
    const target = editaisOriginais.find((e) => extractShareTokenFromLink(e.share_link) === shareToken);
    if (target) openModal(target);
    return;
  }
  if (editalSlug) {
    const target = editaisOriginais.find((e) => e.slug === editalSlug);
    if (target) openModal(target);
    return;
  }
  if (editalId) {
    const target = editaisOriginais.find((e) => String(e.id) === String(editalId));
    if (target) {
      openModal(target);
      return;
    }
    try {
      const { res, data } = await apiFetchJson(`/editais/${encodeURIComponent(String(editalId))}?include_relevance=true&relevance_mode=fast`, { method: 'GET' });
      if (!res.ok || !data || typeof data !== 'object') return;
      const normalized = normalizeEdital(data);
      if (!normalized) return;
      editaisOriginais.unshift(normalized);
      openModal(normalized);
    } catch (_) {
      // silencioso: mantém fallback de não abrir modal quando o ID não está acessível
    }
  }
}

function hasPersonalizedRelevance(items) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.some((item) => normalizeRelevanceScore(item?.relevance_score) > 0 || item?.is_highlighted);
}

// =========================
// AUTH
// =========================
function applyThemePreferenceFromAuthPayload(payload) {
  if (!window.AthosTheme?.setPreference || !payload?.themePreference) return;
  const nextTheme = window.AthosTheme.resolveProfilePreference
    ? window.AthosTheme.resolveProfilePreference(payload.themePreference)
    : payload.themePreference;
  window.AthosTheme.setPreference(nextTheme);
}

function readBootstrapAuthUser() {
  return readBootstrapUserFromSession({
    consume: true,
    maxAgeMs: 10 * 60 * 1000,
  });
}

async function checkAuth() {
  const passwordFallback = buildLoginUrlWithNext();
  const hasStoredToken = Boolean(getStoredToken());
  logBootstrapStep('checkAuth_headers_presence', { hasStoredToken });
  const bootstrapUser = readBootstrapAuthUser();
  if (bootstrapUser) {
    if (isPasswordChangeRequiredPayload(bootstrapUser)) {
      redirectWithAuthGuard(
        resolvePasswordChangeRedirectTarget(bootstrapUser, passwordFallback),
        'main.checkAuth.bootstrap_password_change_required'
      );
      return null;
    }
    applyThemePreferenceFromAuthPayload(bootstrapUser);
    return bootstrapUser;
  }

  try {
    const { res, data } = await apiFetchJson('/cliente/me', { method: 'GET' });

    if (!res.ok) {
      const decision = resolveAuthFailureRedirectTarget(res, data);
      if (decision) {
        redirectWithAuthGuard(decision.target, `main.checkAuth.${decision.reason}`);
        return null;
      }
      return {};
    }

    if (isPasswordChangeRequiredPayload(data)) {
      redirectWithAuthGuard(
        resolvePasswordChangeRedirectTarget(data, passwordFallback),
        'main.checkAuth.payload_password_change_required'
      );
      return null;
    }

    if (data && typeof data === 'object' && 'logado' in data && !data.logado) {
      redirectWithAuthGuard(buildLoginUrlWithNext(), 'main.checkAuth.logado_false');
      return null;
    }

    applyThemePreferenceFromAuthPayload(data);

    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    console.error('Erro na verificação de autenticação:', e);

    if (e instanceof TypeError) return {};

    redirectWithAuthGuard(buildLoginUrlWithNext(), 'main.checkAuth.exception');
    return null;
  }
}

function hydrateSidebarUser(me) {
  const nome = me?.nome || '';
  const email = me?.email || '';

  if (sidebarUserName) sidebarUserName.textContent = nome;
  if (sidebarUserEmail) sidebarUserEmail.textContent = email;
  setInitials(sidebarAvatar, nome || email || 'U');
}

function setInitials(el, name) {
  if (!el) return;
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || 'U';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  el.textContent = (a + b).toUpperCase();
}

function markAppReady() {
  const body = document.body;
  if (!body) return;
  const wasLoading = body.classList.contains('app-loading');
  body.classList.remove('app-loading');
  perfMark('dashboard_shell_ready');
  perfMeasure('dashboard_bootstrap_to_shell_ms', 'dashboard_bootstrap_start', 'dashboard_shell_ready');
  if (wasLoading) {
    try {
      window.dispatchEvent(new CustomEvent('athos:app-ready', { detail: { source: 'dashboard' } }));
    } catch (_) {}
  }
}

function showToast(message, type = 'info', duration = 2200) {
  const msg = String(message || '').trim();
  if (!msg) return;
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  window.setTimeout(() => {
    toast.classList.remove('show');
    window.setTimeout(() => toast.remove(), 220);
  }, Math.max(1200, duration));
}

function setSearchVisualState() {
  if (!searchWrapper || !searchInput) return;
  const isActive = String(searchInput.value || '').trim().length > 0;
  searchWrapper.classList.toggle('is-active', isActive);
}

function isAbortError(err) {
  if (!err) return false;
  return err.name === 'AbortError' || String(err?.code || '') === '20';
}

function cancelPendingSearchInputDebounce() {
  if (searchInputDebounceTimer === null) return;
  window.clearTimeout(searchInputDebounceTimer);
  searchInputDebounceTimer = null;
}

function scheduleDebouncedSearchRefresh() {
  cancelPendingSearchInputDebounce();
  searchInputDebounceTimer = window.setTimeout(() => {
    searchInputDebounceTimer = null;
    void applyFiltersAndRender({ resetPage: true });
  }, SEARCH_INPUT_DEBOUNCE_MS);
}

function beginTrackedListRequest(path) {
  const targetPath = String(path || '').trim();
  if (activeListRequest?.controller) {
    activeListRequest.controller.abort('superseded_by_newer_list_request');
  }

  const requestId = ++listRequestCounter;
  const controller = new AbortController();
  const startedAt = performance.now();
  activeListRequest = { requestId, controller, path: targetPath, startedAt };

  if (isPerfDebugEnabled()) {
    console.debug(`${LIST_REQUEST_DEBUG_TAG} start`, {
      requestId,
      path: targetPath,
    });
  }

  return activeListRequest;
}

function finishTrackedListRequest(requestMeta, { aborted = false, ok = false, error = null } = {}) {
  if (!requestMeta) return;
  const isCurrent = activeListRequest?.requestId === requestMeta.requestId;
  if (isCurrent) activeListRequest = null;

  if (!isPerfDebugEnabled()) return;
  const durationMs = Number((performance.now() - Number(requestMeta.startedAt || 0)).toFixed(1));
  if (aborted) {
    console.debug(`${LIST_REQUEST_DEBUG_TAG} canceled`, {
      requestId: requestMeta.requestId,
      path: requestMeta.path,
      durationMs,
    });
    return;
  }
  if (error) {
    console.debug(`${LIST_REQUEST_DEBUG_TAG} failed`, {
      requestId: requestMeta.requestId,
      path: requestMeta.path,
      durationMs,
      error: String(error?.message || error),
    });
    return;
  }
  console.debug(`${LIST_REQUEST_DEBUG_TAG} done`, {
    requestId: requestMeta.requestId,
    path: requestMeta.path,
    durationMs,
    ok: Boolean(ok),
  });
}

function beginTrackedFacetRequest(path, contextSignature = '') {
  const targetPath = String(path || '').trim();
  if (activeFacetRequest?.controller) {
    activeFacetRequest.controller.abort('superseded_by_newer_facet_request');
  }

  const requestId = ++facetRequestCounter;
  const controller = new AbortController();
  const startedAt = performance.now();
  activeFacetRequest = {
    requestId,
    controller,
    path: targetPath,
    startedAt,
    contextSignature: String(contextSignature || ''),
  };

  if (isPerfDebugEnabled()) {
    console.debug(`${FACET_REQUEST_DEBUG_TAG} start`, {
      requestId,
      path: targetPath,
      contextSignature: String(contextSignature || ''),
    });
  }

  return activeFacetRequest;
}

function finishTrackedFacetRequest(requestMeta, { aborted = false, ok = false, error = null } = {}) {
  if (!requestMeta) return;
  const isCurrent = activeFacetRequest?.requestId === requestMeta.requestId;
  if (isCurrent) activeFacetRequest = null;

  if (!isPerfDebugEnabled()) return;
  const durationMs = Number((performance.now() - Number(requestMeta.startedAt || 0)).toFixed(1));
  if (aborted) {
    console.debug(`${FACET_REQUEST_DEBUG_TAG} canceled`, {
      requestId: requestMeta.requestId,
      path: requestMeta.path,
      durationMs,
      contextSignature: requestMeta.contextSignature,
    });
    return;
  }
  if (error) {
    console.debug(`${FACET_REQUEST_DEBUG_TAG} failed`, {
      requestId: requestMeta.requestId,
      path: requestMeta.path,
      durationMs,
      contextSignature: requestMeta.contextSignature,
      error: String(error?.message || error),
    });
    return;
  }
  console.debug(`${FACET_REQUEST_DEBUG_TAG} done`, {
    requestId: requestMeta.requestId,
    path: requestMeta.path,
    durationMs,
    contextSignature: requestMeta.contextSignature,
    ok: Boolean(ok),
  });
}

function countAppliedFilters() {
  return Object.values(applied).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
}

function countSelectedFilters() {
  return ['estado', 'instituicao', 'area']
    .reduce((sum, key) => sum + readSelected(key).length, 0);
}

function hasAppliedFilters() {
  return countAppliedFilters() > 0;
}

function updateFilterActionsState() {
  const selectedCount = countSelectedFilters();
  const appliedCount = countAppliedFilters();

  if (applyFiltersBtn) {
    applyFiltersBtn.textContent = selectedCount > 0
      ? `Aplicar filtros (${selectedCount})`
      : 'Aplicar filtros';
  }

  if (clearFiltersBtn) {
    clearFiltersBtn.disabled = selectedCount === 0;
  }

  if (filtersFooterSummary) {
    if (selectedCount === 0 && appliedCount === 0) {
      filtersFooterSummary.textContent = 'Nenhum filtro selecionado';
    } else if (selectedCount === appliedCount) {
      filtersFooterSummary.textContent = `${selectedCount} selecionado${selectedCount > 1 ? 's' : ''}`;
    } else {
      filtersFooterSummary.textContent = `${selectedCount} selecionado${selectedCount > 1 ? 's' : ''} • ${appliedCount} ativo${appliedCount > 1 ? 's' : ''}`;
    }
  }
}

function hasPersonalizationConsent() {
  const state = window.AthosConsent?.getState?.();
  if (!state || state.status === 'pending') return false;
  return Boolean(window.AthosConsent?.hasConsent?.('personalization'));
}

function isChatOpen() {
  return Boolean(chatWrapper?.classList.contains('open'));
}

function isAssistantOverlayMode() {
  return window.matchMedia(ASSISTANT_OVERLAY_BREAKPOINT).matches;
}

function syncAssistantLayoutState() {
  const overlay = isAssistantOverlayMode();
  const open = isChatOpen();

  document.body.classList.toggle('assistant-overlay', overlay);
  document.body.classList.toggle('chat-open', open);

  if (assistantBackdrop) {
    const shouldShowBackdrop = open && overlay;
    assistantBackdrop.hidden = !shouldShowBackdrop;
    assistantBackdrop.setAttribute('aria-hidden', shouldShowBackdrop ? 'false' : 'true');
  }
}

function syncChatLauncherVisibility() {
  const canUseChat = hasPersonalizationConsent();
  const open = isChatOpen();
  const shouldHideLauncher = !canUseChat || open;

  if (chatButtonContainer) {
    chatButtonContainer.hidden = shouldHideLauncher;
    chatButtonContainer.setAttribute('aria-hidden', shouldHideLauncher ? 'true' : 'false');
  }

  if (chatButton) {
    chatButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    chatButton.setAttribute('aria-label', open ? 'Fechar assistente' : 'Abrir chat');
  }
}

function setChatOpen(nextOpen, { focusInput = false, skipWelcome = false } = {}) {
  const open = Boolean(nextOpen);
  const canUseChat = hasPersonalizationConsent();

  if (open && !canUseChat) {
    showToast('Ative cookies de personalização em Perfil > Privacidade > Cookies para usar o chat.', 'info');
    return;
  }

  if (chatWrapper) {
    chatWrapper.classList.toggle('open', open);
    chatWrapper.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  syncAssistantLayoutState();
  syncChatLauncherVisibility();
  updateChatHeader();

  if (!open) {
    abortActiveChatRequest('chat_close');
    return;
  }

  scrollToBottom();
  if (!skipWelcome && messageContainer?.children.length === 0) {
    addMessage('Olá! Busque por um tema (ex: inovação) e eu listarei os editais disponíveis.', 'bot');
  }
  if (focusInput) {
    try { chatInput?.focus(); } catch (_) {}
  }
}

function syncOptionalFeaturesByConsent() {
  const canUseChat = hasPersonalizationConsent();

  if (chatWrapper) {
    chatWrapper.hidden = !canUseChat;
    chatWrapper.setAttribute('aria-hidden', (!canUseChat || !isChatOpen()) ? 'true' : 'false');
  }

  if (!canUseChat) {
    setChatOpen(false);
  }

  syncAssistantLayoutState();
  syncChatLauncherVisibility();
}

function setupConsentAwareOptionalFeatures() {
  syncOptionalFeaturesByConsent();
  window.addEventListener('athos:cookie-consent-updated', () => {
    syncOptionalFeaturesByConsent();
  });
}

function clearAllFilters({ keepSearch = false, keepFavorites = false, rerender = true } = {}) {
  document.querySelectorAll('.filter-options input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  if (filterSearchEstado) filterSearchEstado.value = '';
  if (filterSearchInstituicao) filterSearchInstituicao.value = '';
  if (filterSearchArea) filterSearchArea.value = '';
  document.querySelectorAll('.filter-options label').forEach(l => l.style.display = 'flex');
  document.querySelectorAll('.filter-empty').forEach(el => { el.hidden = true; });

  applied = { estado: [], instituicao: [], area: [] };
  clearAssistantPanelContext();
  kpiFilter = 'all';
  syncKpiButtons();
  if (!keepSearch && searchInput) searchInput.value = '';
  if (!keepFavorites && onlyFavoritos) onlyFavoritos = false;
  syncSavedToggleUI();
  setSearchVisualState();
  updateFilterActionsState();
  if (rerender) applyFiltersAndRender({ resetPage: true });
}

function syncKpiButtons() {
  const rows = [
    { btn: statChipTotal, key: 'all' },
    { btn: statChipAbertos, key: 'abertos' },
    { btn: statChipFechados, key: 'fechados' },
  ];
  rows.forEach(({ btn, key }) => {
    if (!btn) return;
    const active = kpiFilter === key;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function makeFilterChip(label, removeFn, tone = '') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'active-filter-chip' + (tone ? ` ${tone}` : '');
  btn.innerHTML = `<span>${escapeHtml(label)}</span><i class="fas fa-xmark" aria-hidden="true"></i>`;
  btn.setAttribute('aria-label', `Remover filtro ${label}`);
  btn.addEventListener('click', removeFn);
  return btn;
}

function renderActiveFilters() {
  if (!activeFiltersBar || !activeFiltersChips) return;

  const chips = [];
  const selectedTotal = countAppliedFilters();
  const assistantLabels = assistantPanelContext?.filterLabels || [];
  const assistantCount = assistantLabels.length;

  if (assistantCount > 0) {
    assistantLabels.forEach((label) => {
      chips.push(makeFilterChip(label, () => {
        clearAssistantPanelContext();
        applyFiltersAndRender({ resetPage: true });
      }, 'chip-assistant'));
    });
  }

  Object.entries(applied).forEach(([key, values]) => {
    if (!Array.isArray(values) || values.length === 0) return;
    const meta = FILTER_META[key] || { label: key };
    values.forEach((value) => {
      const displayValue = key === 'estado' ? formatEstadoLabel(value) : value;
      chips.push(makeFilterChip(`${meta.label}: ${displayValue}`, () => {
        applied[key] = (applied[key] || []).filter(v => v !== value);
        const checkbox = document.querySelector(`.filter-options[data-filter-type=\"${key}\"] input[value=\"${cssEscape(value)}\"]`);
        if (checkbox) checkbox.checked = false;
        applyFiltersAndRender({ resetPage: true });
      }));
    });
  });

  if (searchInput && String(searchInput.value || '').trim()) {
    const searchValue = String(searchInput.value || '').trim();
    chips.push(makeFilterChip(`Busca: ${searchValue}`, () => {
      searchInput.value = '';
      applyFiltersAndRender({ resetPage: true });
    }));
  }

  if (onlyFavoritos) {
    chips.push(makeFilterChip('Somente salvos', () => {
      onlyFavoritos = false;
      syncSavedToggleUI();
      applyFiltersAndRender({ resetPage: true });
    }, 'chip-favorites'));
  }

  if (kpiFilter !== 'all') {
    const kpiLabel = kpiFilter === 'abertos' ? 'KPI: Abertos' : 'KPI: Encerrados';
    chips.push(makeFilterChip(kpiLabel, () => {
      kpiFilter = 'all';
      syncKpiButtons();
      applyFiltersAndRender({ resetPage: true });
    }));
  }

  activeFiltersChips.innerHTML = '';
  chips.forEach(chip => activeFiltersChips.appendChild(chip));
  activeFiltersBar.hidden = chips.length === 0;

  const visibleFilterCount = selectedTotal + assistantCount;

  if (filtersCountBadge) {
    if (visibleFilterCount > 0) {
      filtersCountBadge.hidden = false;
      filtersCountBadge.textContent = `${visibleFilterCount} ativo${visibleFilterCount > 1 ? 's' : ''}`;
    } else {
      filtersCountBadge.hidden = true;
      filtersCountBadge.textContent = '0 ativos';
    }
  }

  if (filtersAppliedState) {
    if (assistantCount > 0 && selectedTotal > 0) {
      filtersAppliedState.textContent = `Refinando por IA + ${selectedTotal} filtro${selectedTotal > 1 ? 's' : ''}.`;
    } else if (assistantCount > 0) {
      filtersAppliedState.textContent = 'Refinando por critérios sugeridos pela IA.';
    } else if (selectedTotal > 0) {
      filtersAppliedState.textContent = `Refinando por ${selectedTotal} filtro${selectedTotal > 1 ? 's' : ''}.`;
    } else if (kpiFilter !== 'all') {
      filtersAppliedState.textContent = 'Recorte rápido ativo pelo KPI.';
    } else {
      filtersAppliedState.textContent = 'Nenhum filtro aplicado';
    }
  }

  if (applyFiltersBtn) applyFiltersBtn.classList.toggle('has-active-filters', selectedTotal > 0);
  updateFilterActionsState();
}

function renderResultsStateHint(total) {
  if (!resultsStateHint) return;

  const hasSearch = String(searchInput?.value || '').trim().length > 0;
  const hasFilters = hasAppliedFilters() || Boolean(assistantPanelContext);
  const highlightedTotal = Array.isArray(lastFiltered)
    ? lastFiltered.filter((item) => item?.is_highlighted).length
    : 0;
  const hasPersonalizedSignals = Array.isArray(lastFiltered)
    ? hasPersonalizedRelevance(lastFiltered)
    : false;
  const hasProfileRecommendations = highlightedTotal > 0;

  let text = '';
  if (total === 0 && onlyFavoritos && favoritosSet.size === 0) {
    text = 'Você ainda não salvou editais. Clique na estrela para montar sua lista.';
  } else if (total === 0 && onlyFavoritos) {
    text = 'Nenhum edital salvo corresponde aos filtros atuais.';
  } else if (total === 0 && hasSearch && hasFilters) {
    text = 'Busca sem correspondência para os filtros ativos.';
  } else if (total === 0 && hasSearch) {
    text = 'Nenhum resultado encontrado para esta busca.';
  } else if (total === 0 && hasFilters) {
    text = 'Nenhum edital para os filtros atuais.';
  } else if (
    total > 0 &&
    hasProfileRecommendations &&
    !hasSearch &&
    !hasFilters &&
    !onlyFavoritos &&
    kpiFilter === 'all'
  ) {
    text = `Com base no seu perfil, ${highlightedTotal} edital${highlightedTotal > 1 ? 'is estão' : ' está'} em destaque.`;
  } else if (
    total > 0 &&
    !hasProfileRecommendations &&
    hasPersonalizedSignals &&
    !hasSearch &&
    !hasFilters &&
    !onlyFavoritos &&
    kpiFilter === 'all'
  ) {
    text = 'No momento, não há edital 100% aderente ao seu perfil em destaque.';
  } else if (total > 0 && hasFilters) {
    text = 'Filtros aplicados para resultados mais relevantes.';
  }

  if (!text) {
    resultsStateHint.hidden = true;
    resultsStateHint.textContent = '';
    return;
  }

  resultsStateHint.hidden = false;
  resultsStateHint.textContent = text;
}

function setFilterGroupExpanded(group, expanded, { animate = true } = {}) {
  if (!group) return;
  const btn = group.querySelector('[data-filter-toggle]');
  const body = group.querySelector('.filter-group-body');
  if (!btn || !body) return;

  const current = btn.getAttribute('aria-expanded') === 'true';
  const collapsedStateAlreadyApplied = group.classList.contains('is-collapsed') === !expanded;
  const ariaStateAlreadyApplied = (body.getAttribute('aria-hidden') === 'true') === !expanded;
  const hiddenStateAlreadyApplied = body.hidden === !expanded;

  if (
    current === expanded &&
    !body.dataset.animating &&
    collapsedStateAlreadyApplied &&
    ariaStateAlreadyApplied &&
    hiddenStateAlreadyApplied
  ) {
    return;
  }

  if (typeof body.__onTransitionEnd === 'function') {
    body.removeEventListener('transitionend', body.__onTransitionEnd);
    body.__onTransitionEnd = null;
  }

  group.classList.toggle('is-collapsed', !expanded);
  btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  body.setAttribute('aria-hidden', expanded ? 'false' : 'true');
  body.toggleAttribute('inert', !expanded);

  const shouldAnimate = animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!shouldAnimate) {
    body.dataset.animating = '';
    body.hidden = !expanded;
    body.style.height = '';
    body.style.overflow = '';
    body.style.willChange = '';
    return;
  }

  if (body.hidden) body.hidden = false;
  const currentHeight = body.getBoundingClientRect().height;
  const targetHeight = expanded ? body.scrollHeight : 0;

  if (Math.abs(targetHeight - currentHeight) < 1) {
    body.dataset.animating = '';
    body.hidden = !expanded;
    body.style.height = '';
    body.style.overflow = '';
    body.style.willChange = '';
    return;
  }

  body.style.height = `${currentHeight}px`;
  body.style.overflow = 'hidden';
  body.style.willChange = 'height';
  body.dataset.animating = 'true';

  requestAnimationFrame(() => {
    body.style.height = `${targetHeight}px`;
  });

  body.__onTransitionEnd = (event) => {
    if (event.target !== body || event.propertyName !== 'height') return;
    body.removeEventListener('transitionend', body.__onTransitionEnd);
    body.__onTransitionEnd = null;
    body.dataset.animating = '';
    body.style.height = '';
    body.style.overflow = '';
    body.style.willChange = '';
    body.hidden = !expanded;
  };

  body.addEventListener('transitionend', body.__onTransitionEnd);
}

function setupFilterGroupsAccordion() {
  if (!filtersPanel) return;
  const groups = Array.from(filtersPanel.querySelectorAll('.filter-group'));

  groups.forEach((group, idx) => {
    const btn = group.querySelector('[data-filter-toggle]');
    const body = group.querySelector('.filter-group-body');
    if (!btn || !body) return;

    if (!body.id) body.id = `filter-group-body-${idx + 1}`;
    btn.setAttribute('aria-controls', body.id);

    setFilterGroupExpanded(group, false, { animate: false });

    btn.addEventListener('click', () => {
      const isExpanded = btn.getAttribute('aria-expanded') === 'true';
      setFilterGroupExpanded(group, !isExpanded, { animate: true });
    });

    btn.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (idx + step + groups.length) % groups.length;
      const nextBtn = groups[nextIndex]?.querySelector('[data-filter-toggle]');
      nextBtn?.focus();
    });
  });

  filtersPanel.addEventListener('change', (event) => {
    if (event.target?.matches?.('.filter-options input[type=\"checkbox\"]')) {
      updateFilterActionsState();
    }
  });

  updateFilterActionsState();
}

function renderChatQuickPrompts() {
  if (!chatQuickPrompts) return;

  const prompts = [
    'Quais editais estão com prazo nesta semana?',
    'Mostre oportunidades para tecnologia e inovação.',
    'Quais editais aceitam pequenas empresas?',
    'Resuma os documentos mais importantes deste edital.',
  ];

  chatQuickPrompts.innerHTML = '';
  prompts.forEach((prompt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-prompt-btn';
    btn.textContent = prompt;
    btn.addEventListener('click', () => {
      if (!chatInput) return;
      chatInput.value = prompt;
      handleChatSend({ source: 'quick_prompt' });
    });
    chatQuickPrompts.appendChild(btn);
  });
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(String(value ?? ''));
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function mergeUniqueListValues(...lists) {
  const out = [];
  const seen = new Set();

  lists.forEach((list) => {
    const arr = Array.isArray(list) ? list : (list == null ? [] : [list]);
    arr.forEach((item) => {
      const clean = String(item || '').trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(clean);
    });
  });

  return out;
}

function normalizeServerFacetValue(type, value) {
  if (type === 'estado') return normalizeEstadoValue(value);
  if (type === 'area') return toCanonicalCategory(value);
  return String(value || '').trim();
}

function normalizeServerFacetItems(type, rawItems) {
  const list = Array.isArray(rawItems) ? rawItems : [];
  const counts = new Map();

  list.forEach((item) => {
    const valueRaw = (item && typeof item === 'object') ? item.value : item;
    const parsedCount = Number((item && typeof item === 'object') ? item.count : 0);
    const value = normalizeServerFacetValue(type, valueRaw);
    if (!value) return;
    const safeCount = Number.isFinite(parsedCount) && parsedCount > 0 ? Math.floor(parsedCount) : 0;
    counts.set(value, (counts.get(value) || 0) + safeCount);
  });

  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => {
      const diff = (b.count || 0) - (a.count || 0);
      if (diff !== 0) return diff;
      return String(a.value || '').localeCompare(String(b.value || ''), 'pt-BR');
    });
}

function parseServerFilterFacets(rawFacets) {
  if (!rawFacets || typeof rawFacets !== 'object') return null;
  return {
    estado: normalizeServerFacetItems('estado', rawFacets.estado),
    instituicao: normalizeServerFacetItems('instituicao', rawFacets.instituicao),
    area: normalizeServerFacetItems('area', rawFacets.area),
  };
}

function getEmptyServerFilterFacets() {
  return {
    estado: [...EMPTY_SERVER_FILTER_FACETS.estado],
    instituicao: [...EMPTY_SERVER_FILTER_FACETS.instituicao],
    area: [...EMPTY_SERVER_FILTER_FACETS.area],
  };
}

function normalizeServerFacetPayload(rawFacets) {
  if (!rawFacets || typeof rawFacets !== 'object') return null;
  return {
    estado: Array.isArray(rawFacets.estado) ? rawFacets.estado : [],
    instituicao: Array.isArray(rawFacets.instituicao) ? rawFacets.instituicao : [],
    area: Array.isArray(rawFacets.area) ? rawFacets.area : [],
  };
}

function buildFacetSignature(rawFacets) {
  const facets = normalizeServerFacetPayload(rawFacets) || getEmptyServerFilterFacets();
  const normalizeBucket = (type, items) => (Array.isArray(items) ? items : [])
    .map((item) => ({
      value: normalizeServerFacetValue(type, item?.value ?? item),
      count: Number.isFinite(Number(item?.count)) ? Math.max(0, Math.floor(Number(item?.count))) : 0,
    }))
    .filter((item) => item.value)
    .sort((a, b) => {
      const diff = String(a.value || '').localeCompare(String(b.value || ''), 'pt-BR');
      if (diff !== 0) return diff;
      return (a.count || 0) - (b.count || 0);
    })
    .map((item) => `${item.value}:${item.count}`);

  return JSON.stringify({
    estado: normalizeBucket('estado', facets.estado),
    instituicao: normalizeBucket('instituicao', facets.instituicao),
    area: normalizeBucket('area', facets.area),
  });
}

function normalizeFacetContextList(values, normalizer = (value) => String(value || '').trim()) {
  return mergeUniqueListValues(values)
    .map((value) => normalizer(value))
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
}

function buildFacetContextSignature({ searchContext = null } = {}) {
  const queryState = collectEditaisServerQueryState({ searchContext });
  return JSON.stringify({
    q: String(queryState.q || '').trim().toLowerCase(),
    status: String(queryState.status || 'todos').trim().toLowerCase(),
    favoritosOnly: Boolean(queryState.favoritosOnly),
    estado: normalizeFacetContextList(queryState.estado, (value) => normalizeEstadoValue(value)),
    instituicao: normalizeFacetContextList(queryState.instituicao, (value) => String(value || '').trim().toLowerCase()),
    area: normalizeFacetContextList(queryState.area, (value) => toCanonicalCategory(value)),
    ids: normalizeFacetContextList(queryState.ids, (value) => String(value || '').trim()),
  });
}

function setServerFacetUiState(state = 'ready', message = '') {
  const normalizedState = String(state || '').trim().toLowerCase();
  if (normalizedState === 'loading') {
    serverFacetUiState = 'loading';
  } else if (normalizedState === 'unavailable') {
    serverFacetUiState = 'unavailable';
  } else {
    serverFacetUiState = 'ready';
  }
  serverFacetUiMessage = String(message || '').trim();
}

function setServerFilterFacetsUnavailable(
  { contextSignature = '', uiState = 'unavailable', message = '' } = {},
) {
  serverFilterFacets = getEmptyServerFilterFacets();
  serverFilterFacetsSignature = buildFacetSignature(serverFilterFacets);
  if (contextSignature) {
    serverFacetContextSignature = String(contextSignature);
  }
  serverFacetsLoaded = false;
  setServerFacetUiState(uiState, message);
}

function setServerFilterFacets(rawFacets, { contextSignature = '' } = {}) {
  const normalized = normalizeServerFacetPayload(rawFacets) || getEmptyServerFilterFacets();
  const nextSignature = buildFacetSignature(normalized);
  const changed = nextSignature !== serverFilterFacetsSignature;
  serverFilterFacets = normalized;
  serverFilterFacetsSignature = nextSignature;
  if (contextSignature) {
    serverFacetContextSignature = String(contextSignature);
  }
  serverFacetsLoaded = true;
  setServerFacetUiState('ready');
  return changed;
}

function buildCurrentFacetContextSignature() {
  const termo = (searchInput?.value || '').trim();
  const searchContext = buildSearchQueryContext(termo);
  return buildFacetContextSignature({ searchContext });
}

async function recoverServerFacetsForContext({ searchContext = null, contextSignature = '' } = {}) {
  const resolvedContextSignature = String(
    contextSignature || buildFacetContextSignature({ searchContext }),
  );
  const path = buildEditaisFacetsPath({ searchContext });
  const requestMeta = beginTrackedFacetRequest(path, resolvedContextSignature);
  let aborted = false;
  try {
    const { res, data, facets } = await fetchEditaisFacetsFromApi({
      searchContext,
      path,
      signal: requestMeta.controller.signal,
    });

    if (activeFacetRequest?.requestId !== requestMeta.requestId) {
      finishTrackedFacetRequest(requestMeta, { aborted: true });
      return false;
    }
    if (!res.ok) {
      throw new Error(`Erro na API (${res.status})`);
    }

    const latestContextSignature = buildCurrentFacetContextSignature();
    if (latestContextSignature !== resolvedContextSignature) {
      finishTrackedFacetRequest(requestMeta, { aborted: true });
      return false;
    }

    if (!facets) {
      setServerFilterFacetsUnavailable({
        contextSignature: resolvedContextSignature,
        uiState: 'unavailable',
        message: 'Os filtros do servidor estão indisponíveis no momento.',
      });
      generateDynamicFilters();
      finishTrackedFacetRequest(requestMeta, { ok: false });
      if (isPerfDebugEnabled()) {
        console.debug(`${FACET_REQUEST_DEBUG_TAG} missing_facets_payload`, {
          contextSignature: resolvedContextSignature,
          path,
          statusCode: Number(res?.status || 0),
          hasData: Boolean(data),
        });
      }
      return false;
    }

    setServerFilterFacets(facets, { contextSignature: resolvedContextSignature });
    generateDynamicFilters();
    finishTrackedFacetRequest(requestMeta, { ok: true });
    return true;
  } catch (err) {
    if (isAbortError(err)) {
      aborted = true;
      finishTrackedFacetRequest(requestMeta, { aborted: true });
      return false;
    }
    setServerFilterFacetsUnavailable({
      contextSignature: resolvedContextSignature,
      uiState: 'unavailable',
      message: 'Não foi possível atualizar os filtros agora.',
    });
    generateDynamicFilters();
    finishTrackedFacetRequest(requestMeta, { error: err });
    return false;
  } finally {
    if (!aborted && activeFacetRequest?.requestId === requestMeta.requestId) {
      activeFacetRequest = null;
    }
  }
}

function resolveServerStatusFilter(assistantStatusFilters = []) {
  if (kpiFilter === 'abertos') return 'aberto';
  if (kpiFilter === 'fechados') return 'encerrado';

  const statusList = Array.isArray(assistantStatusFilters) ? assistantStatusFilters : [];
  const hasOpen = statusList.includes('aberto');
  const hasClosed = statusList.includes('encerrado');
  if (hasOpen && !hasClosed) return 'aberto';
  if (hasClosed && !hasOpen) return 'encerrado';
  return 'todos';
}

function collectEditaisServerQueryState({ searchContext = null } = {}) {
  const context = searchContext || buildSearchQueryContext((searchInput?.value || '').trim());
  const rawSearch = String(searchInput?.value || '').trim();
  const assistantFilters = assistantPanelContext?.filters || {};
  const assistantStatuses = mergeUniqueListValues(assistantFilters.status || [])
    .map((value) => normalizeAssistantStatusToken(value))
    .filter(Boolean);
  const assistantEstado = mergeUniqueListValues(assistantFilters.estado || [])
    .map((value) => normalizeEstadoValue(value))
    .filter(Boolean);
  const assistantInstituicoes = mergeUniqueListValues(assistantFilters.instituicoes || assistantFilters.instituicao || []);
  const assistantAreas = mergeUniqueListValues(assistantFilters.categories || [])
    .map((value) => toCanonicalCategory(value))
    .filter(Boolean);
  const assistantKeywords = mergeUniqueListValues(assistantFilters.keywords || []);
  const assistantResultIds = assistantPanelContext?.resultIdsSet instanceof Set
    ? Array.from(assistantPanelContext.resultIdsSet)
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    : [];

  const estado = mergeUniqueListValues(applied.estado, assistantEstado)
    .map((value) => normalizeEstadoValue(value))
    .filter(Boolean);
  const instituicao = mergeUniqueListValues(applied.instituicao, assistantInstituicoes).filter(Boolean);
  const area = mergeUniqueListValues(applied.area, assistantAreas)
    .map((value) => toCanonicalCategory(value))
    .filter(Boolean);

  let q = String(context?.textQuery || rawSearch || '').trim();
  if (assistantKeywords.length) {
    q = `${q} ${assistantKeywords.join(' ')}`.trim();
  }

  return {
    q,
    estado,
    instituicao,
    area,
    favoritosOnly: Boolean(onlyFavoritos),
    status: resolveServerStatusFilter(assistantStatuses),
    sortField: normalizeSortValue(sortField || sortSelect?.value || 'prazo'),
    sortDirection: String(sortDirection || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc',
    ids: assistantResultIds,
  };
}

function appendEditaisQueryStateToParams(params, queryState) {
  if (!(params instanceof URLSearchParams) || !queryState || typeof queryState !== 'object') return;
  if (queryState.q) params.set('q', queryState.q);
  if (queryState.favoritosOnly) params.set('favoritos_only', 'true');
  queryState.estado.forEach((value) => params.append('estado', value));
  queryState.instituicao.forEach((value) => params.append('instituicao', value));
  queryState.area.forEach((value) => params.append('area', value));
  queryState.ids.forEach((value) => params.append('ids', value));
}

function buildEditaisListPath({ page = 1, pageSize = PAGE_SIZE, searchContext = null, includeFacets = false } = {}) {
  const params = new URLSearchParams();
  const queryState = collectEditaisServerQueryState({ searchContext });

  params.set('modo', 'card');
  params.set('include_relevance', 'true');
  params.set('relevance_mode', 'fast');
  params.set('page', String(Math.max(1, Number(page) || 1)));
  params.set('page_size', String(Math.max(1, Number(pageSize) || PAGE_SIZE)));
  params.set('status', queryState.status || 'todos');
  params.set('sort_field', queryState.sortField || 'prazo');
  params.set('sort_direction', queryState.sortDirection || 'desc');
  if (includeFacets) params.set('include_facets', 'true');
  appendEditaisQueryStateToParams(params, queryState);

  return `/editais?${params.toString()}`;
}

function buildEditaisFacetsPath({ searchContext = null } = {}) {
  const params = new URLSearchParams();
  const queryState = collectEditaisServerQueryState({ searchContext });

  params.set('modo', 'card');
  params.set('include_relevance', 'false');
  params.set('page', '1');
  params.set('page_size', '1');
  params.set('status', queryState.status || 'todos');
  params.set('sort_field', queryState.sortField || 'prazo');
  params.set('sort_direction', queryState.sortDirection || 'desc');
  params.set('include_facets', 'true');
  appendEditaisQueryStateToParams(params, queryState);

  return `/editais?${params.toString()}`;
}

function normalizeListPathForComparison(path) {
  const rawPath = String(path || '').trim();
  if (!rawPath) return '';

  const [pathname = '', queryString = ''] = rawPath.split('?');
  const params = new URLSearchParams(queryString);
  params.delete('include_facets');
  const normalizedQuery = params.toString();
  return normalizedQuery ? `${pathname}?${normalizedQuery}` : pathname;
}

function parseEditaisListPayload(raw) {
  const items =
    Array.isArray(raw) ? raw :
    (Array.isArray(raw?.items) ? raw.items :
    (Array.isArray(raw?.editais) ? raw.editais :
    (Array.isArray(raw?.data) ? raw.data : [])));

  const parsedPage = Number(raw?.page);
  const parsedPageSize = Number(raw?.page_size);
  const parsedTotal = Number(raw?.total);
  const parsedHasNext = raw?.has_next;
  const rawFacets = raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'facets')
    ? parseServerFilterFacets(raw.facets)
    : null;

  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 1;
  const pageSize = Number.isFinite(parsedPageSize) && parsedPageSize > 0 ? Math.floor(parsedPageSize) : PAGE_SIZE;
  const fallbackTotal = ((page - 1) * pageSize) + items.length;
  const total = Number.isFinite(parsedTotal) && parsedTotal >= 0 ? Math.floor(parsedTotal) : fallbackTotal;
  const hasNext = typeof parsedHasNext === 'boolean'
    ? parsedHasNext
    : (page * pageSize) < total;

  return {
    items,
    total: Math.max(total, items.length),
    page,
    pageSize,
    hasNext,
    facets: rawFacets,
  };
}

async function fetchEditaisPageFromApi({
  page = 1,
  pageSize = PAGE_SIZE,
  searchContext = null,
  includeFacets = false,
  signal = null,
  path = '',
} = {}) {
  const resolvedPath = String(path || '').trim() || buildEditaisListPath({ page, pageSize, searchContext, includeFacets });
  const fetchOptions = { method: 'GET' };
  if (signal) fetchOptions.signal = signal;
  const { res, data } = await apiFetchJson(resolvedPath, fetchOptions);
  return { path: resolvedPath, res, data, parsed: parseEditaisListPayload(data) };
}

function parseEditaisFacetsPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(raw, 'facets')) return null;
  return parseServerFilterFacets(raw.facets);
}

async function fetchEditaisFacetsFromApi({
  searchContext = null,
  signal = null,
  path = '',
} = {}) {
  const resolvedPath = String(path || '').trim() || buildEditaisFacetsPath({ searchContext });
  const fetchOptions = { method: 'GET' };
  if (signal) fetchOptions.signal = signal;
  const { res, data } = await apiFetchJson(resolvedPath, fetchOptions);
  return { path: resolvedPath, res, data, facets: parseEditaisFacetsPayload(data) };
}

function setServerPageState(parsedPage) {
  serverPageState = {
    total: Number(parsedPage?.total || 0) || 0,
    page: Number(parsedPage?.page || 1) || 1,
    pageSize: Number(parsedPage?.pageSize || PAGE_SIZE) || PAGE_SIZE,
    hasNext: Boolean(parsedPage?.hasNext),
  };
}

function hydrateEditaisFromPagePayload(
  parsedPage,
  { includeFacetsRequested = false, facetContextSignature = '' } = {},
) {
  let facetsStatus = 'skipped';
  editaisOriginais = (parsedPage?.items || []).map(normalizeEdital).filter(Boolean);
  setServerPageState(parsedPage);
  currentPage = serverPageState.page;
  if (includeFacetsRequested) {
    if (parsedPage?.facets) {
      setServerFilterFacets(parsedPage.facets, { contextSignature: facetContextSignature });
      facetsStatus = 'loaded';
    } else {
      setServerFilterFacetsUnavailable({
        contextSignature: facetContextSignature,
        uiState: 'unavailable',
        message: 'Os filtros do servidor não foram retornados nesta consulta.',
      });
      facetsStatus = 'missing';
      if (isPerfDebugEnabled()) {
        console.debug(`${LIST_REQUEST_DEBUG_TAG} facets_missing_in_response`, {
          contextSignature: String(facetContextSignature || ''),
        });
      }
    }
  }
  applyFavoritosToLoadedEditais();
  return { facetsStatus };
}

async function loadServerPage(
  page,
  {
    pageSize = PAGE_SIZE,
    searchContext = null,
    includeFacets = false,
    facetContextSignature = '',
  } = {},
) {
  const targetPage = Math.max(1, Number(page) || 1);
  const resolvedFacetContextSignature = String(
    facetContextSignature || buildFacetContextSignature({ searchContext }),
  );
  const path = buildEditaisListPath({ page: targetPage, pageSize, searchContext, includeFacets });
  const requestMeta = beginTrackedListRequest(path);
  let aborted = false;
  try {
    const { res, data, parsed } = await fetchEditaisPageFromApi({
      page: targetPage,
      pageSize,
      searchContext,
      includeFacets,
      path,
      signal: requestMeta.controller.signal,
    });

    if (!res.ok) {
      if (isPasswordChangeRequiredResponse(res, data) || isPasswordChangeRequiredPayload(data)) {
        const fallbackUrl = buildLoginUrlWithNext();
        redirectWithAuthGuard(
          resolvePasswordChangeRedirectTarget(data, fallbackUrl),
          'main.loadServerPage.password_change_required'
        );
        finishTrackedListRequest(requestMeta, { ok: false });
        return false;
      }

      if (res.status === 401 || res.status === 403) {
        const fallbackUrl = buildLoginUrlWithNext();
        redirectWithAuthGuard(
          resolveAuthFailureRedirectTarget(data, fallbackUrl),
          'main.loadServerPage.auth_failed'
        );
        finishTrackedListRequest(requestMeta, { ok: false });
        return false;
      }

      throw new Error(`Erro na API (${res.status})`);
    }

    if (activeListRequest?.requestId !== requestMeta.requestId) {
      finishTrackedListRequest(requestMeta, { aborted: true });
      return false;
    }

    const hydration = hydrateEditaisFromPagePayload(parsed, {
      includeFacetsRequested: includeFacets,
      facetContextSignature: resolvedFacetContextSignature,
    });
    let facetsReadyForContext = hydration?.facetsStatus === 'loaded';
    if (includeFacets && hydration?.facetsStatus === 'missing') {
      setServerFilterFacetsUnavailable({
        contextSignature: resolvedFacetContextSignature,
        uiState: 'loading',
        message: 'Atualizando opções de filtros...',
      });
      generateDynamicFilters();
      facetsReadyForContext = await recoverServerFacetsForContext({
        searchContext,
        contextSignature: resolvedFacetContextSignature,
      });
      if (activeListRequest?.requestId !== requestMeta.requestId) {
        finishTrackedListRequest(requestMeta, { aborted: true });
        return false;
      }
    }
    lastLoadedListPath = path;
    lastLoadedListIncludedFacets = Boolean(includeFacets && facetsReadyForContext);
    if (includeFacets) {
      generateDynamicFilters();
    }
    finishTrackedListRequest(requestMeta, { ok: true });
    return true;
  } catch (err) {
    if (isAbortError(err)) {
      aborted = true;
      finishTrackedListRequest(requestMeta, { aborted: true });
      return false;
    }
    finishTrackedListRequest(requestMeta, { error: err });
    throw err;
  } finally {
    if (!aborted && activeListRequest?.requestId === requestMeta.requestId) {
      activeListRequest = null;
    }
  }
}

// =========================
// DATA LOAD
// =========================
async function loadEditais() {
  perfMark('editais_load_start');
  if (!container) {
    perfMark('editais_load_end');
    perfMeasure('dashboard_editais_load_ms', 'editais_load_start', 'editais_load_end');
    return;
  }

  container.innerHTML = `
    <div class="loading-container">
      <div class="spinner"></div>
      <p>Carregando editais...</p>
      <div class="cards-skeleton" aria-hidden="true">
        <div class="card-skeleton"></div>
        <div class="card-skeleton"></div>
        <div class="card-skeleton"></div>
      </div>
    </div>
  `;

  try {
    const facetContextSignature = buildFacetContextSignature({ searchContext: null });
    const { path, res, data, parsed } = await fetchEditaisPageFromApi({
      page: 1,
      pageSize: INITIAL_PAGE_SIZE,
      includeFacets: false,
    });

    if (!res.ok) {
      if (isPasswordChangeRequiredResponse(res, data) || isPasswordChangeRequiredPayload(data)) {
        const fallbackUrl = buildLoginUrlWithNext();
        redirectWithAuthGuard(
          resolvePasswordChangeRedirectTarget(data, fallbackUrl),
          'main.loadEditais.password_change_required'
        );
        return;
      }
      // Se não estiver logado, manda pro login.
      if (res.status === 401 || res.status === 403) {
        container.innerHTML = `
          <section class="results-empty-state is-error">
            <div class="empty-icon"><i class="fas fa-lock" aria-hidden="true"></i></div>
            <h3>Sessão expirada</h3>
            <p>Faça login novamente para acessar os editais.</p>
            <a class="btn btn-primary" href="${buildLoginUrlWithNext()}">Ir para o login</a>
          </section>
        `;
        return;
      }

      throw new Error(`Erro na API (${res.status})`);
    }

    hydrateEditaisFromPagePayload(parsed, {
      includeFacetsRequested: false,
      facetContextSignature,
    });
    setServerFilterFacetsUnavailable({
      contextSignature: facetContextSignature,
      uiState: 'loading',
      message: 'Carregando filtros em segundo plano...',
    });
    lastLoadedListPath = path;
    lastLoadedListIncludedFacets = false;
    renderEditaisCardsFallback({ source: 'loadEditais_first_render' });
  } catch (e) {
    console.error('Erro ao carregar editais:', e);
    logBootstrapError('loadEditais_error', e);
    container.innerHTML = `
      <section class="results-empty-state is-error">
        <div class="empty-icon"><i class="fas fa-exclamation-triangle" aria-hidden="true"></i></div>
        <h3>Não foi possível carregar os editais</h3>
        <p>${escapeHtml(e?.message || String(e))}</p>
        <button onclick="location.reload()" class="btn btn-primary">Tentar novamente</button>
      </section>
    `;
  } finally {
    perfMark('editais_load_end');
    perfMeasure('dashboard_editais_load_ms', 'editais_load_start', 'editais_load_end');
  }
}

// =========================
// FAVORITOS (carrega / salva / remove)
// =========================
function applyFavoritosToLoadedEditais() {
  for (const edital of editaisOriginais) {
    edital.is_favorite = favoritosSet.has(String(edital.id));
  }
  syncSavedBadge();
  syncSavedToggleUI();
}

async function loadFavoritos() {
  perfMark('favoritos_load_start');
  // Se o endpoint ainda não existir no backend, a UI segue normalmente.
  favoritosSet = new Set();
  try {
    const { res, data } = await apiFetchJson('/cliente/favoritos', { method: 'GET' });
    if (res.ok) {
      const ids = Array.isArray(data) ? data : (Array.isArray(data?.ids) ? data.ids : []);
      favoritosSet = new Set((ids || []).map(v => String(v)));
    }
  } catch (_) {
    // silencioso de propósito (não quebra a listagem)
  } finally {
    perfMark('favoritos_load_end');
    perfMeasure('dashboard_favoritos_load_ms', 'favoritos_load_start', 'favoritos_load_end');
  }
  applyFavoritosToLoadedEditais();
}

function syncSavedBadge() {
  if (!savedBadge) return;
  const n = favoritosSet.size;
  if (n > 0) {
    savedBadge.hidden = false;
    savedBadge.textContent = String(n);
  } else {
    savedBadge.hidden = true;
    savedBadge.textContent = '0';
  }
}

function syncSavedToggleUI() {
  if (!savedToggleBtn) return;
  savedToggleBtn.classList.toggle('is-active', !!onlyFavoritos);
  savedToggleBtn.setAttribute('aria-pressed', onlyFavoritos ? 'true' : 'false');
  savedToggleBtn.setAttribute('title', onlyFavoritos ? 'Exibindo apenas salvos' : 'Ver salvos');
  const icon = savedToggleBtn.querySelector('i');
  if (icon) {
    icon.classList.toggle('fas', !!onlyFavoritos);
    icon.classList.toggle('far', !onlyFavoritos);
  }
}

async function salvarOuRemoverFavorito(editalId, salvar) {
  const idStr = String(editalId);
  const url = salvar ? '/cliente/favoritos' : `/cliente/favoritos/${encodeURIComponent(idStr)}`;
  const opt = salvar
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edital_id: Number(editalId) }) }
    : { method: 'DELETE' };

  const { res, data } = await apiFetchJson(url, opt);
  if (!res.ok) {
    const msg = (data && (data.detail || data.msg)) ? (data.detail || data.msg) : 'Não foi possível atualizar os salvos.';
    throw new Error(msg);
  }
  return data;
}


async function toggleFavorito(editalId) {
  const idStr = String(editalId);
  const edital = editaisOriginais.find(e => String(e.id) === idStr);
  if (!edital) return { ok: false };

  const estavaSalvo = !!edital.is_favorite;

  await salvarOuRemoverFavorito(editalId, !estavaSalvo);

  edital.is_favorite = !estavaSalvo;
  if (edital.is_favorite) favoritosSet.add(idStr);
  else favoritosSet.delete(idStr);

  syncSavedBadge();

  return { ok: true, is_favorite: edital.is_favorite, edital };
}

function updateSaveButtonUI(btn, isSaved) {
  if (!btn) return;
  btn.classList.toggle('is-saved', !!isSaved);
  btn.setAttribute('title', isSaved ? 'Remover dos salvos' : 'Salvar edital');
  btn.setAttribute('data-tooltip', isSaved ? 'Remover dos salvos' : 'Salvar edital');

  const icon = btn.querySelector('i');
  if (icon) {
    icon.classList.toggle('fas', !!isSaved);
    icon.classList.toggle('far', !isSaved);
  }
}




function normalizeEdital(api) {
  const data = typeof api?.json_data === 'string' ? safeJsonParse(api.json_data, {}) : (api?.json_data || {});
  const arquivos = typeof api?.arquivos_json === 'string' ? safeJsonParse(api.arquivos_json, []) : (api?.arquivos_json || []);
  const mergedTags = Array.isArray(api?.tags) && api.tags.length ? api.tags : (Array.isArray(data.tags) ? data.tags : []);
  const rawArea = api?.area || data.area || (mergedTags.length ? mergedTags[0] : 'Geral');
  const titulo = api?.titulo || data.titulo || 'Sem título';

  return {
    id: api?.id,
    titulo,
    slug: generateSlug(titulo),
    descricao: api?.descricao || data.objetivo || data.descricao || 'Sem descrição',
    publico_alvo: api?.publico_alvo || data.publico_alvo || '',
    icone: resolveIconPath(api?.icone_instituicao || data.icone_instituicao),
    instituicao: api?.instituicao || data.instituicao || '',
    estado: normalizeEstadoValue(api?.estado || data.estado || 'BR') || 'BR',
    area: String(rawArea || 'Geral'),
    instrumento: toCanonicalInstrument(api?.instrumento || data.instrumento || data.apoio || 'Não informado'),
    tipo: api?.tipo || data.tipo || 'Não informado',
    valor_total: api?.valor_total || data.valor_total || '',
    data_fechamento:
      api?.data_final_submissao ||
      api?.data_fechamento ||
      data.data_final_submissao ||
      data.data_fechamento ||
      null,
    data_abertura: api?.data_abertura || data.data_abertura || data.data_inicio_submissao || null,
    data_publicacao:
      api?.data_publicacao ||
      data.data_publicacao ||
      data.data_publicacao_edital ||
      data.data_publicacao_resultado ||
      api?.created_at ||
      null,
    tags: mergedTags,
    arquivos,
    is_favorite: false,
    share_link: api?.share_link || '',
    is_open: typeof api?.is_open === 'boolean' ? api.is_open : undefined,
    relevance_score: normalizeRelevanceScore(api?.relevance_score),
    is_highlighted: !!api?.is_highlighted,
    relevance_reasons: Array.isArray(api?.relevance_reasons) ? api.relevance_reasons.map((item) => String(item || '').trim()).filter(Boolean) : [],
    details_loaded: Boolean(api?.details_loaded) || arquivos.length > 0,
  };
}

async function ensureEditalDetailLoaded(edital) {
  if (!edital || edital.id === null || edital.id === undefined) return edital;
  if (edital.details_loaded) return edital;

  try {
    const path = `/editais/${encodeURIComponent(String(edital.id))}?include_relevance=true&relevance_mode=fast`;
    const { res, data } = await apiFetchJson(path, { method: 'GET' });
    if (!res.ok || !data || typeof data !== 'object') return edital;

    const normalized = normalizeEdital(data);
    const prevFavorite = Boolean(edital.is_favorite);
    Object.assign(edital, normalized);
    edital.is_favorite = prevFavorite;
    edital.details_loaded = true;
  } catch (err) {
    console.warn('Falha ao carregar detalhes do edital:', err);
  }
  return edital;
}

function normalizeRelevanceScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function resolveIconPath(value) {
  if (value === null || value === undefined) return null;

  const raw = String(value).trim().replace(/\\/g, '/');
  if (!raw) return null;

  if (/^(?:https?:|data:|blob:)/i.test(raw)) return raw;
  if (raw.startsWith('//')) return `${window.location.protocol}${raw}`;

  const normalized = raw
    .replace(/^\.?\//, '')
    .replace(/^\/+/, '');

  const isProjectIconPath =
    normalized.toLowerCase().startsWith('icons/') ||
    normalized.toLowerCase().startsWith('assets/img/icons/');

  const isBareImageFilename = /^[^/]+\.(?:png|jpe?g|gif|webp|svg|avif)$/i.test(normalized);

  if (isProjectIconPath) {
    return new URL(normalized, APP_BASE_URL).href;
  }

  if (isBareImageFilename) {
    return new URL(`icons/${normalized}`, APP_BASE_URL).href;
  }

  return raw;
}

function generateSlug(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeCategoryKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeEstadoValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const upper = raw.toUpperCase();
  if (ESTADO_LABELS[upper]) return upper;

  const byPrefix = upper.match(/^([A-Z]{2})\b/);
  if (byPrefix && ESTADO_LABELS[byPrefix[1]]) return byPrefix[1];

  return raw;
}

function formatEstadoLabel(value) {
  const normalized = normalizeEstadoValue(value);
  const code = String(normalized || '').toUpperCase();
  const nome = ESTADO_LABELS[code];
  if (nome) return `${code} - ${nome}`;
  return String(value || '').trim();
}

const CATEGORY_KEY_MAP = new Map(
  CATEGORY_OPTIONS.map(item => [normalizeCategoryKey(item.value), item.value])
);

const INSTRUMENT_KEY_MAP = new Map(
  INSTRUMENT_OPTIONS.map(item => [normalizeCategoryKey(item), item])
);

function toCanonicalCategory(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Geral';
  const key = normalizeCategoryKey(raw);
  return CATEGORY_KEY_MAP.get(key) || raw;
}

function toCanonicalInstrument(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Não informado';
  const key = normalizeCategoryKey(raw);
  return INSTRUMENT_KEY_MAP.get(key) || raw;
}

// =========================
// FILTROS (gera opções)
// =========================
function renderFacetOptions(type, values, selectedValues = []) {
  const box = document.querySelector(`.filter-options[data-filter-type="${type}"]`);
  if (!box) return;

  const selectedSet = new Set((Array.isArray(selectedValues) ? selectedValues : [])
    .map((value) => normalizeServerFacetValue(type, value))
    .filter(Boolean));

  box.innerHTML = '';
  if (!Array.isArray(values) || values.length === 0) {
    box.innerHTML = '<div style="font-size:12px; color:#9CA3AF; padding:6px;">Nenhuma opção</div>';
    return;
  }

  values.forEach(({ value, count }) => {
    const cleanValue = normalizeServerFacetValue(type, value);
    if (!cleanValue) return;
    const displayValue = type === 'estado' ? formatEstadoLabel(cleanValue) : cleanValue;

    const label = document.createElement('label');
    label.setAttribute('data-label', normalizeCategoryKey(`${cleanValue} ${displayValue}`));

    const left = document.createElement('span');
    left.className = 'label-left';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = cleanValue;
    input.checked = selectedSet.has(cleanValue);

    const text = document.createElement('span');
    text.textContent = displayValue;
    text.style.minWidth = '0';
    text.style.overflow = 'hidden';
    text.style.textOverflow = 'ellipsis';
    text.style.whiteSpace = 'nowrap';
    if (type === 'estado') {
      text.style.overflow = 'visible';
      text.style.textOverflow = 'clip';
      text.style.whiteSpace = 'normal';
    }

    left.appendChild(input);
    left.appendChild(text);

    const countEl = document.createElement('span');
    countEl.className = 'filter-count';
    countEl.textContent = Number.isFinite(Number(count)) ? Math.max(0, Math.floor(Number(count))) : 0;

    label.appendChild(left);
    label.appendChild(countEl);
    box.appendChild(label);
  });
}

function renderFacetInfoState(type, message) {
  const box = document.querySelector(`.filter-options[data-filter-type="${type}"]`);
  if (!box) return;
  box.innerHTML = `<div style="font-size:12px; color:#9CA3AF; padding:6px;">${escapeHtml(message)}</div>`;
}

function generateDynamicFilters() {
  const resolvedFacets = normalizeServerFacetPayload(serverFilterFacets) || getEmptyServerFilterFacets();
  const currentSignature = `${buildFacetSignature(resolvedFacets)}|${serverFacetUiState}|${serverFacetUiMessage}`;
  if (currentSignature === lastRenderedFacetSignature) return;
  lastRenderedFacetSignature = currentSignature;

  if (serverFacetUiState === 'loading') {
    const message = serverFacetUiMessage || 'Atualizando opções de filtros...';
    renderFacetInfoState('estado', message);
    renderFacetInfoState('instituicao', message);
    renderFacetInfoState('area', message);
    return;
  }

  if (serverFacetUiState === 'unavailable') {
    const message = serverFacetUiMessage || 'Os filtros do servidor estão indisponíveis no momento.';
    renderFacetInfoState('estado', message);
    renderFacetInfoState('instituicao', message);
    renderFacetInfoState('area', message);
    return;
  }

  renderFacetOptions('estado', resolvedFacets.estado, applied.estado);
  renderFacetOptions('instituicao', resolvedFacets.instituicao, applied.instituicao);
  generateCategoryFilters(resolvedFacets.area);

  wireFilterSearch(filterSearchEstado, document.querySelector('.filter-options[data-filter-type="estado"]'));
  wireFilterSearch(filterSearchInstituicao, document.querySelector('.filter-options[data-filter-type="instituicao"]'));
  wireFilterSearch(filterSearchArea, document.querySelector('.filter-options[data-filter-type="area"]'));
  [filterSearchEstado, filterSearchInstituicao, filterSearchArea].forEach((inputEl) => {
    if (!inputEl || !String(inputEl.value || '').trim()) return;
    inputEl.dispatchEvent(new Event('input'));
  });
}

function generateCategoryFilters(areaFacets = []) {
  const box = document.querySelector('.filter-options[data-filter-type="area"]');
  if (!box) return;

  const counts = new Map();
  (Array.isArray(areaFacets) ? areaFacets : []).forEach(({ value, count }) => {
    const cat = toCanonicalCategory(value);
    if (!cat) continue;
    const parsedCount = Number(count);
    const safeCount = Number.isFinite(parsedCount) && parsedCount > 0 ? Math.floor(parsedCount) : 0;
    counts.set(cat, (counts.get(cat) || 0) + safeCount);
  });
  const knownCategorySet = new Set(CATEGORY_OPTIONS.map((item) => item.value));
  const extras = Array.from(counts.keys())
    .filter((value) => !knownCategorySet.has(value))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map((value) => ({ value, label: value }));
  const orderedCategories = [...CATEGORY_OPTIONS, ...extras];
  const selectedSet = new Set((applied.area || []).map((value) => toCanonicalCategory(value)));

  box.innerHTML = '';
  for (const category of orderedCategories) {
    const label = document.createElement('label');
    label.setAttribute('data-label', normalizeCategoryKey(`${category.label} ${category.value}`));

    const left = document.createElement('span');
    left.className = 'label-left';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = category.value;
    input.checked = selectedSet.has(category.value);

    const text = document.createElement('span');
    text.textContent = category.label;
    text.style.minWidth = '0';
    text.style.overflow = 'hidden';
    text.style.textOverflow = 'ellipsis';
    text.style.whiteSpace = 'nowrap';

    left.appendChild(input);
    left.appendChild(text);

    const count = document.createElement('span');
    count.className = 'filter-count';
    count.textContent = counts.get(category.value) || 0;

    label.appendChild(left);
    label.appendChild(count);
    box.appendChild(label);
  }
}

function wireFilterSearch(inputEl, optionsEl) {
  if (!inputEl || !optionsEl) return;
  if (inputEl.dataset.searchBound === '1') return;
  inputEl.dataset.searchBound = '1';
  inputEl.addEventListener('input', () => {
    const q = normalizeCategoryKey(inputEl.value);
    let visible = 0;
    optionsEl.querySelectorAll('label').forEach(label => {
      const key = label.getAttribute('data-label') || '';
      const keyNorm = normalizeCategoryKey(key);
      const show = !q || keyNorm.includes(q);
      label.style.display = show ? 'flex' : 'none';
      if (show) visible += 1;
    });

    let empty = optionsEl.querySelector('.filter-empty');
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'filter-empty';
      empty.textContent = 'Nenhuma opção encontrada para essa busca.';
      optionsEl.appendChild(empty);
    }
    empty.hidden = visible > 0;
  });
}

function readSelected(type) {
  const root = document.querySelector(`.filter-options[data-filter-type="${type}"]`);
  if (!root) return [];
  return Array.from(root.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
}

function normalizeSortValue(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'atualizacao') return 'atualizado';
  if (v === 'prazo' || v === 'titulo' || v === 'instituicao' || v === 'estado' || v === 'atualizado' || v === 'relevancia') {
    return v;
  }
  return 'prazo';
}

function getDefaultSortDirection(sort) {
  const s = normalizeSortValue(sort);
  return (s === 'atualizado' || s === 'prazo' || s === 'relevancia') ? 'desc' : 'asc';
}

function syncSortControls() {
  const normalized = normalizeSortValue(sortField);
  sortField = normalized;

  if (sortSelect) sortSelect.value = normalized;

  if (sortChips) {
    sortChips.querySelectorAll('.sort-chip[data-sort]').forEach((btn) => {
      const chipSort = normalizeSortValue(btn.getAttribute('data-sort'));
      btn.classList.toggle('is-active', chipSort === normalized);
      btn.setAttribute('aria-pressed', chipSort === normalized ? 'true' : 'false');
    });
  }

  if (sortDirectionBtn) {
    const isDesc = sortDirection === 'desc';
    sortDirectionBtn.classList.toggle('is-desc', isDesc);
    sortDirectionBtn.setAttribute('title', `Direção: ${isDesc ? 'decrescente' : 'crescente'}`);
    sortDirectionBtn.setAttribute('aria-label', `Direção da ordenação: ${isDesc ? 'decrescente' : 'crescente'}`);
  }

  if (sortDirectionText) {
    sortDirectionText.textContent = sortDirection === 'desc' ? 'Decrescente' : 'Crescente';
  }

  if (sortDirectionIcon) {
    const isDesc = sortDirection === 'desc';
    sortDirectionIcon.classList.toggle('fa-arrow-down-wide-short', isDesc);
    sortDirectionIcon.classList.toggle('fa-arrow-up-wide-short', !isDesc);
  }
}

function setSortField(value, { resetDirection = false } = {}) {
  sortField = normalizeSortValue(value);
  if (resetDirection) {
    sortDirection = getDefaultSortDirection(sortField);
  }
  syncSortControls();
}

function toggleSortDirection() {
  sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
  syncSortControls();
}

function toUniqueStringList(value, { normalize = null } = {}) {
  const list = Array.isArray(value) ? value : (value == null ? [] : [value]);
  const seen = new Set();
  const out = [];

  list.forEach((item) => {
    const raw = String(item || '').trim();
    if (!raw) return;
    const normalizedValue = typeof normalize === 'function' ? normalize(raw) : raw;
    const clean = String(normalizedValue || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });

  return out;
}

function normalizeAssistantStatusToken(value) {
  const token = normalizeAssistantQuery(value);
  if (!token) return '';
  if (token.includes('encerr') || token.includes('fechad') || token.includes('vencid')) return 'encerrado';
  if (token.includes('abert') || token.includes('vigent') || token.includes('ativ')) return 'aberto';
  return '';
}

function normalizeAssistantDeadlineRange(value) {
  const token = normalizeAssistantQuery(value).replace(/\s+/g, '_');
  if (!token) return '';
  if (
    token.includes('next_7_days') ||
    token.includes('next7days') ||
    token.includes('this_week') ||
    token.includes('esta_semana') ||
    token.includes('nesta_semana') ||
    token.includes('semana')
  ) {
    return 'next_7_days';
  }
  return '';
}

function normalizeAssistantSearchPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw && typeof raw === 'object' ? raw : {};
  const rawFilters = payload.filters && typeof payload.filters === 'object' ? payload.filters : {};

  const status = toUniqueStringList(rawFilters.status || rawFilters.statuses, {
    normalize: normalizeAssistantStatusToken,
  }).filter(Boolean);

  const deadlineRange = normalizeAssistantDeadlineRange(
    rawFilters.deadline_range || rawFilters.deadlineRange || rawFilters.deadline
  );

  const categories = toUniqueStringList(rawFilters.categories || rawFilters.categorias, {
    normalize: (v) => toCanonicalCategory(v),
  });
  const instituicoes = toUniqueStringList(rawFilters.instituicoes || rawFilters.instituicao);
  const estado = toUniqueStringList(rawFilters.estado || rawFilters.estados, {
    normalize: (v) => String(v || '').trim().toUpperCase(),
  });
  const keywords = toUniqueStringList(rawFilters.keywords || rawFilters.termos || rawFilters.temas, {
    normalize: (v) => normalizeAssistantQuery(v),
  });

  const resultIds = toUniqueStringList(payload.result_ids || payload.resultIds || payload.ids, {
    normalize: (v) => String(v),
  });

  const fallbackTotal = resultIds.length;
  const parsedTotal = Number(payload.total);
  const total = Number.isFinite(parsedTotal) && parsedTotal >= 0 ? parsedTotal : fallbackTotal;

  const summary = String(payload.summary || payload.reply || '').trim();
  const query = String(payload.query || '').trim();
  const intent = normalizeAssistantIntent(payload.intent || 'edital_search');

  const hasStructuredFilters =
    status.length > 0 ||
    Boolean(deadlineRange) ||
    categories.length > 0 ||
    instituicoes.length > 0 ||
    estado.length > 0 ||
    keywords.length > 0;

  if (!hasStructuredFilters && resultIds.length === 0) return null;

  return {
    intent,
    query,
    summary,
    total,
    result_ids: resultIds,
    filters: {
      status,
      deadline_range: deadlineRange,
      categories,
      instituicoes,
      estado,
      keywords,
    },
  };
}

function buildAssistantPayloadFromQuery(query, precomputedResults = null) {
  const q = String(query || '').trim();
  if (!q) return null;

  const normalizedQuery = normalizeAssistantQuery(q);
  const keywords = extractChatKeywords(normalizedQuery);
  const wantsClosed = hasAnyChatHint(normalizedQuery, ['encerrado', 'encerrados', 'fechado', 'fechados']);
  const wantsOpen = !wantsClosed && hasAnyChatHint(normalizedQuery, CHAT_OPEN_HINTS);
  const wantsWeek = hasAnyChatHint(normalizedQuery, CHAT_WEEK_HINTS) && hasAnyChatHint(normalizedQuery, CHAT_DEADLINE_HINTS);

  const all = Array.isArray(precomputedResults) ? precomputedResults : searchEditaisForChat(q);
  const ids = all
    .map((item) => String(item?.id || '').trim())
    .filter(Boolean);

  return normalizeAssistantSearchPayload({
    intent: 'edital_search',
    query: q,
    total: all.length,
    result_ids: ids,
    filters: {
      status: wantsOpen ? ['aberto'] : (wantsClosed ? ['encerrado'] : []),
      deadline_range: wantsWeek ? 'next_7_days' : '',
      keywords,
    },
  });
}

function buildAssistantFilterLabels(context) {
  if (!context || !context.filters) return [];
  const labels = [];
  const filters = context.filters;

  if (filters.status.includes('aberto')) labels.push('Status: aberto');
  if (filters.status.includes('encerrado')) labels.push('Status: encerrado');
  if (filters.deadline_range === 'next_7_days') labels.push('Prazo: próximos 7 dias');
  if (filters.estado.length) {
    const estadoLabels = filters.estado.slice(0, 3).map((uf) => formatEstadoLabel(uf));
    labels.push(`Estado: ${estadoLabels.join(', ')}`);
  }
  if (filters.instituicoes.length) labels.push(`Instituição: ${filters.instituicoes.slice(0, 2).join(', ')}`);
  if (filters.categories.length) labels.push(`Categoria: ${filters.categories.slice(0, 2).join(', ')}`);
  const hasPrimaryCriteria = labels.length > 0;
  if (!hasPrimaryCriteria && filters.keywords.length) labels.push(`Tema: ${filters.keywords.slice(0, 3).join(', ')}`);
  if (!labels.length && context.total > 0) labels.push(`Resultados IA: ${context.total}`);

  return labels;
}

function clearAssistantPanelContext() {
  assistantPanelContext = null;
}

function rememberAssistantOpenedCard(editalId) {
  const id = String(editalId || '').trim();
  if (!id) return;
  assistantSemanticMemory = createDashboardAssistantMemory({
    ...assistantSemanticMemory,
    lastOpenedCardId: id,
    updatedAt: new Date().toISOString(),
  });
}

function rememberAssistantResultSetFromPayload(payload, { question = '', intent = '' } = {}) {
  if (!payload || typeof payload !== 'object') return;
  const ids = Array.isArray(payload.result_ids)
    ? payload.result_ids.map((id) => String(id || '').trim()).filter(Boolean)
    : [];

  if (!ids.length) return;

  assistantSemanticMemory = createDashboardAssistantMemory({
    ...assistantSemanticMemory,
    lastResultIds: ids,
    lastResultScope: 'all_loaded',
    lastIntent: String(intent || payload.intent || '').trim() || assistantSemanticMemory?.lastIntent || '',
    lastQuestion: String(question || payload.query || '').trim() || assistantSemanticMemory?.lastQuestion || '',
    updatedAt: new Date().toISOString(),
  });
}

function buildAssistantSemanticUiState() {
  return {
    appliedFilters: {
      estado: Array.isArray(applied?.estado) ? [...applied.estado] : [],
      instituicao: Array.isArray(applied?.instituicao) ? [...applied.instituicao] : [],
      area: Array.isArray(applied?.area) ? [...applied.area] : [],
    },
    kpiFilter,
    onlyFavoritos,
    assistantFilterLabels: Array.isArray(assistantPanelContext?.filterLabels) ? [...assistantPanelContext.filterLabels] : [],
    sortField,
    sortDirection,
  };
}

function runLocalDashboardSemanticAssistant(question) {
  const outcome = runDashboardAssistantSemanticQuery({
    question,
    cards: Array.isArray(editaisOriginais) ? editaisOriginais : [],
    visibleCards: Array.isArray(lastFiltered) ? lastFiltered : [],
    uiState: buildAssistantSemanticUiState(),
    memory: assistantSemanticMemory,
    now: new Date(),
  });

  if (outcome?.nextMemory) {
    assistantSemanticMemory = createDashboardAssistantMemory({
      ...assistantSemanticMemory,
      ...outcome.nextMemory,
    });
  }

  return outcome;
}

function normalizeDashboardCardForIntelligence(rawCard) {
  const status = isOpenEditalForChat(rawCard) ? 'aberto' : 'encerrado';
  const estadoUf = String(rawCard?.estado || '').trim().toUpperCase();
  const estadoLabel = formatEstadoLabel(estadoUf);
  const prazoFinal = String(rawCard?.data_fechamento || '').trim();
  const updatedAt = String(rawCard?.data_abertura || rawCard?.updated_at || '').trim();
  const valorFomento = String(rawCard?.valor_total || rawCard?.valor || '').trim();
  return {
    id: String(rawCard?.id ?? '').trim(),
    titulo: String(rawCard?.titulo || '').trim(),
    instituicao: String(rawCard?.instituicao || '').trim(),
    estado_uf: estadoUf,
    estado_label: estadoLabel,
    status,
    prazo_final: prazoFinal,
    updated_at: updatedAt,
    valor_fomento: valorFomento,
    area: String(rawCard?.area || '').trim(),
    tags: Array.isArray(rawCard?.tags) ? rawCard.tags.slice(0, 12).map((tag) => String(tag || '').trim()).filter(Boolean) : [],
    relevance_score: Number(rawCard?.relevance_score || 0) || 0,
    is_highlighted: Boolean(rawCard?.is_highlighted),
    is_open: status === 'aberto',
  };
}

function buildDashboardFiltersAvailable(cards) {
  const estados = Array.from(
    new Set(
      (Array.isArray(cards) ? cards : [])
        .map((card) => String(card?.estado || '').trim().toUpperCase())
        .filter(Boolean)
    )
  ).slice(0, 40);
  const instituicoes = Array.from(
    new Set(
      (Array.isArray(cards) ? cards : [])
        .map((card) => String(card?.instituicao || '').trim())
        .filter(Boolean)
    )
  ).slice(0, 120);
  const areas = Array.from(
    new Set(
      (Array.isArray(cards) ? cards : [])
        .map((card) => String(card?.area || '').trim())
        .filter(Boolean)
    )
  ).slice(0, 120);

  return {
    estado: estados,
    instituicao: instituicoes,
    area: areas,
    status: ['aberto', 'encerrado'],
  };
}

function buildDashboardHistoryContext(maxTurns = 8) {
  const turns = Array.isArray(chatState?.conversationHistory) ? chatState.conversationHistory : [];
  return turns
    .slice(-Math.max(1, maxTurns))
    .map((turn) => ({
      role: turn?.role === 'user' ? 'user' : 'assistant',
      text: String(turn?.text || '').trim().slice(0, 260),
    }))
    .filter((turn) => turn.text);
}

function buildDashboardIntelligenceContext() {
  const allCards = Array.isArray(editaisOriginais) ? editaisOriginais : [];
  const visibleCards = Array.isArray(lastFiltered) ? lastFiltered : [];
  const normalizedAll = allCards.map(normalizeDashboardCardForIntelligence).filter((card) => card.id);
  const normalizedVisible = visibleCards.map(normalizeDashboardCardForIntelligence).filter((card) => card.id);
  const focusIds = Array.isArray(assistantSemanticMemory?.lastResultIds)
    ? assistantSemanticMemory.lastResultIds.map((id) => String(id || '').trim()).filter(Boolean).slice(0, 20)
    : [];
  const openedCardId = String(assistantSemanticMemory?.lastOpenedCardId || '').trim();

  return {
    cards_loaded: normalizedAll,
    visible_cards: normalizedVisible,
    filters_available: buildDashboardFiltersAvailable(allCards),
    filters_active: {
      estado: Array.isArray(applied?.estado) ? [...applied.estado] : [],
      instituicao: Array.isArray(applied?.instituicao) ? [...applied.instituicao] : [],
      area: Array.isArray(applied?.area) ? [...applied.area] : [],
      status: kpiFilter === 'abertos' ? ['aberto'] : (kpiFilter === 'fechados' ? ['encerrado'] : []),
      kpi_filter: kpiFilter,
      only_favoritos: Boolean(onlyFavoritos),
      assistant_filter_labels: Array.isArray(assistantPanelContext?.filterLabels) ? [...assistantPanelContext.filterLabels] : [],
    },
    sort_active: {
      field: String(sortField || '').trim() || 'prazoFinal',
      direction: String(sortDirection || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc',
    },
    history_short: buildDashboardHistoryContext(8),
    focus: {
      card_ids: focusIds,
      opened_card_id: openedCardId || '',
    },
  };
}

function normalizeDashboardPlanFromBackend(rawData) {
  const rawPlan = rawData?.assistant_plan && typeof rawData.assistant_plan === 'object'
    ? rawData.assistant_plan
    : (rawData?.plan && typeof rawData.plan === 'object' ? rawData.plan : rawData);
  const allowedIds = Array.isArray(editaisOriginais)
    ? editaisOriginais.map((card) => String(card?.id || '').trim()).filter(Boolean)
    : [];
  return normalizeDashboardAssistantPlan(rawPlan, { allowedCardIds: allowedIds });
}

function buildDashboardPlanOptions(plan, query, backendOptions = []) {
  const payload = dashboardPlanToLegacySearchPayload(plan);
  const options = [];
  const total = Number(plan?.result_summary?.total || 0);
  const matchedIds = Array.isArray(plan?.matched_card_ids) ? plan.matched_card_ids.map((id) => String(id || '').trim()).filter(Boolean) : [];

  const backendNormalized = normalizeBackendChatOptions(backendOptions);
  if (backendNormalized.length && total <= 5) {
    options.push(...backendNormalized.slice(0, 5));
  } else if (!backendNormalized.length && total > 0 && total <= 5 && matchedIds.length) {
    matchedIds.slice(0, 5).forEach((id) => {
      const card = (Array.isArray(editaisOriginais) ? editaisOriginais : []).find((item) => String(item?.id) === id);
      if (!card) return;
      const metaParts = [];
      if (card?.instituicao) metaParts.push(card.instituicao);
      if (card?.estado) metaParts.push(formatEstadoLabel(card.estado));
      if (card?.data_fechamento) metaParts.push(`Até ${formatChatDate(card.data_fechamento)}`);
      options.push({
        action: 'open_edital',
        id: card.id,
        title: card.titulo || 'Sem título',
        meta: metaParts.join(' • ') || null,
      });
    });
  }

  if (total > 0 && payload) {
    options.push({
      action: 'view_all',
      query,
      title: total > 5 ? `Aplicar filtro no painel (${total})` : 'Aplicar recorte no painel',
      meta: plan?.ui_action?.cta || 'Usar a IA para orientar os cards na interface',
      payload,
    });

    if (total > 5 && matchedIds.length > 5) {
      options.push({
        action: 'view_all',
        query,
        title: 'Mostrar 5 mais urgentes',
        meta: 'Recorte rápido por prazo',
        payload: {
          ...payload,
          total: Math.min(5, matchedIds.length),
          result_ids: matchedIds.slice(0, 5),
        },
      });
    }
  }

  options.push({
    action: 'ask_new',
    title: 'Refinar busca',
    meta: 'Mudar estado, instituição, prazo ou status',
  });

  return options;
}

function applyAssistantPayloadToDashboard(rawPayload, { fallbackQuery = '' } = {}) {
  const normalized = normalizeAssistantSearchPayload(rawPayload) || buildAssistantPayloadFromQuery(fallbackQuery);
  if (!normalized) return false;

  // Evita divergência com filtros antigos antes de aplicar o contexto da IA.
  applied = { estado: [], instituicao: [], area: [] };
  document.querySelectorAll('.filter-options input[type="checkbox"]').forEach((cb) => {
    cb.checked = false;
  });
  kpiFilter = 'all';
  syncKpiButtons();
  if (onlyFavoritos) {
    onlyFavoritos = false;
    syncSavedToggleUI();
  }

  assistantPanelContext = {
    ...normalized,
    resultIdsSet: new Set((normalized.result_ids || []).map((id) => String(id))),
    filterLabels: [],
  };
  assistantPanelContext.filterLabels = buildAssistantFilterLabels(assistantPanelContext);
  rememberAssistantResultSetFromPayload(normalized, { question: fallbackQuery, intent: normalized.intent });

  if (searchInput) searchInput.value = '';
  setSearchVisualState();
  applyFiltersAndRender({ resetPage: true });
  return true;
}

// =========================
// APLICAÇÃO DE FILTROS
// =========================

async function applyFiltersAndRender(
  { resetPage, forceReload = false, deferFacets = false } = { resetPage: false, forceReload: false, deferFacets: false },
) {
  if (!container) return;
  cancelPendingSearchInputDebounce();
  if (resetPage) currentPage = 1;

  const termo = (searchInput?.value || '').trim();
  const searchContext = buildSearchQueryContext(termo);
  const targetPage = Math.max(1, Number(currentPage) || 1);
  const facetContextSignature = buildFacetContextSignature({ searchContext });
  const shouldIncludeFacets = !deferFacets && Boolean(
    forceReload ||
    !serverFacetsLoaded ||
    facetContextSignature !== serverFacetContextSignature
  );
  const targetPath = buildEditaisListPath({
    page: targetPage,
    pageSize: INITIAL_PAGE_SIZE,
    searchContext,
    includeFacets: shouldIncludeFacets,
  });
  const normalizedTargetPath = normalizeListPathForComparison(targetPath);
  const normalizedLoadedPath = normalizeListPathForComparison(lastLoadedListPath);
  const pathChanged = normalizedTargetPath !== normalizedLoadedPath;
  const facetsRefreshPending = shouldIncludeFacets && !lastLoadedListIncludedFacets;
  const isFacetRefreshOnly = facetsRefreshPending && !forceReload && !pathChanged;
  const requestSeq = ++applyFiltersRenderSeq;

  setSearchVisualState();

  if (forceReload || pathChanged || facetsRefreshPending) {
    try {
      const ok = await loadServerPage(targetPage, {
        pageSize: INITIAL_PAGE_SIZE,
        searchContext,
        includeFacets: shouldIncludeFacets,
        facetContextSignature,
      });
      if (!ok) return;
    } catch (err) {
      console.error('Falha ao carregar resultados refinados no backend:', err);
      if (isFacetRefreshOnly) {
        setServerFilterFacetsUnavailable({
          contextSignature: facetContextSignature,
          uiState: 'unavailable',
          message: 'Não foi possível atualizar os filtros agora.',
        });
        try {
          generateDynamicFilters();
        } catch (facetRenderError) {
          logBootstrapError('applyFiltersAndRender_facets_render_error', facetRenderError);
        }
        logBootstrapError('applyFiltersAndRender_facets_refresh_error', err);
        return;
      }
      renderEditais(container, [], {
        emptyState: {
          icon: 'fa-triangle-exclamation',
          title: 'Falha ao atualizar resultados',
          message: escapeHtml(err?.message || 'Tente novamente em instantes.'),
        },
      });
      return;
    }
  }

  if (requestSeq !== applyFiltersRenderSeq) return;

  const pageItems = [...editaisOriginais];
  lastFiltered = pageItems;

  const total = Math.max(0, Number(serverPageState.total || 0));
  const pageSize = Math.max(1, Number(serverPageState.pageSize || INITIAL_PAGE_SIZE));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  currentPage = Math.min(Math.max(1, Number(serverPageState.page || targetPage)), totalPages);

  const startIdx = total === 0 ? 0 : ((currentPage - 1) * pageSize);
  const endIdx = total === 0 ? 0 : Math.min(startIdx + pageItems.length, total);

  if (resultsMeta) {
    const a = total === 0 ? 0 : startIdx + 1;
    const b = endIdx;
    const label = onlyFavoritos ? 'salvos' : 'editais';
    resultsMeta.textContent = `Mostrando ${a}-${b} de ${total} ${label}`;
  }

  updateHeroStats(pageItems, { totalOverride: total });
  syncKpiButtons();
  renderActiveFilters();
  renderResultsStateHint(total);
  renderEditais(container, pageItems, {
    emptyState: buildEmptyState({ total, termo }),
  });
  renderPagination(totalPages);
}

function buildEmptyState({ total, termo }) {
  if (total > 0) return null;

  const query = String(termo || '').trim();
  if (onlyFavoritos && favoritosSet.size === 0) {
    return {
      icon: 'fa-star',
      title: 'Sem favoritos ainda',
      message: 'Você ainda não salvou editais. Clique na estrela dos cards para acompanhar depois.',
      actionLabel: 'Ver todos os editais',
      action: () => {
        onlyFavoritos = false;
        syncSavedToggleUI();
        applyFiltersAndRender({ resetPage: true });
      },
    };
  }

  if (onlyFavoritos) {
    return {
      icon: 'fa-filter',
      title: 'Sem salvos para este recorte',
      message: 'Tente remover alguns filtros para encontrar editais favoritos.',
      actionLabel: 'Limpar filtros',
      action: () => clearAllFilters({ keepFavorites: true }),
    };
  }

  if (query) {
    return {
      icon: 'fa-magnifying-glass',
      title: 'Busca sem correspondência',
      message: `Não encontramos editais para \"${query}\" com os filtros atuais.`,
      actionLabel: 'Limpar busca',
      action: () => {
        if (searchInput) searchInput.value = '';
        applyFiltersAndRender({ resetPage: true });
      },
    };
  }

  if (hasAppliedFilters() || kpiFilter !== 'all') {
    return {
      icon: 'fa-sliders',
      title: 'Nenhum edital para os filtros atuais',
      message: 'Ajuste os filtros ou recorte por KPI para ampliar os resultados.',
      actionLabel: 'Limpar filtros',
      action: () => clearAllFilters({ keepSearch: true }),
    };
  }

  return {
    icon: 'fa-folder-open',
    title: 'Nenhum edital disponível',
    message: 'No momento não há editais para exibir.',
  };
}

function isClosedEdital(edital) {
  if (typeof edital?.is_open === 'boolean') return !edital.is_open;
  const t = parseAnyDateToTime(edital?.data_fechamento);
  if (t === null) return false;
  const d = new Date(t);
  const prazo = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return prazo < today;
}

function compareIsoDate(a, b) {
  const da = parseAnyDateToTime(a);
  const db = parseAnyDateToTime(b);
  if (da === null && db === null) return 0;
  if (da === null) return 1;
  if (db === null) return -1;
  return da < db ? -1 : da > db ? 1 : 0;
}

function updateHeroStats(filtered, { totalOverride = null } = {}) {
  const totalValue = Number(totalOverride);
  const resolvedTotal = Number.isFinite(totalValue) && totalValue >= 0 ? Math.round(totalValue) : filtered.length;
  if (statTotal) statTotal.textContent = String(resolvedTotal);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  let abertos = 0;
  let fechados = 0;

  for (const e of filtered) {
    const t = parseAnyDateToTime(e.data_fechamento);
    // Sem data final: considera como aberto (melhor UX do que sumir com números)
    if (t === null) {
      abertos++;
      continue;
    }
    // Data final no passado (ou hoje): fechado
    if (t < todayStart) fechados++;
    else abertos++;
  }

  if (statAbertos) statAbertos.textContent = String(abertos);
  if (statFechados) statFechados.textContent = String(fechados);
}



function parseMoneyToNumber(value) {
  if (!value) return NaN;
  const s = String(value)
    .replace(/[^0-9,\.]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function formatBRL(n) {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);
  } catch {
    return `R$ ${Math.round(n)}`;
  }
}

// =========================
// PAGINAÇÃO (UI)
// =========================
function renderPagination(totalPages) {
  if (!paginationEl) return;
  paginationEl.innerHTML = '';
  if (totalPages <= 1) return;

  const makeBtn = (label, page, { active = false, disabled = false, icon = null } = {}) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'page-btn' + (active ? ' active' : '');
    btn.disabled = disabled;
    btn.setAttribute('data-page', String(page));
    btn.innerHTML = icon ? `<i class="${icon}"></i>` : escapeHtml(label);
    return btn;
  };

  paginationEl.appendChild(makeBtn('', Math.max(1, currentPage - 1), {
    disabled: currentPage === 1,
    icon: 'fas fa-chevron-left'
  }));

  const pages = getPageWindow(currentPage, totalPages, 7);
  for (const p of pages) {
    if (p === '…') {
      const span = document.createElement('span');
      span.className = 'page-ellipsis';
      span.textContent = '…';
      paginationEl.appendChild(span);
      continue;
    }
    paginationEl.appendChild(makeBtn(String(p), p, { active: p === currentPage }));
  }

  paginationEl.appendChild(makeBtn('', Math.min(totalPages, currentPage + 1), {
    disabled: currentPage === totalPages,
    icon: 'fas fa-chevron-right'
  }));
}

function getPageWindow(page, totalPages, maxButtons) {
  const out = [];
  if (totalPages <= maxButtons) {
    for (let i = 1; i <= totalPages; i++) out.push(i);
    return out;
  }

  const side = Math.floor((maxButtons - 3) / 2);
  let start = Math.max(2, page - side);
  let end = Math.min(totalPages - 1, page + side);

  if (page <= 1 + side) {
    start = 2;
    end = 2 + (maxButtons - 3);
  } else if (page >= totalPages - side) {
    end = totalPages - 1;
    start = totalPages - 1 - (maxButtons - 3);
  }

  out.push(1);
  if (start > 2) out.push('…');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < totalPages - 1) out.push('…');
  out.push(totalPages);
  return out;
}

// =========================
// UI EVENTS
// =========================
function setupUIEvents() {
  if (appSidebar && window.matchMedia('(max-width: 980px)').matches) {
    appSidebar.classList.remove('mobile-open');
    appSidebar.classList.remove('collapsed');
  }

  if (sidebarToggle && appSidebar) {
    sidebarToggle.addEventListener('click', () => {
      if (window.matchMedia('(max-width: 980px)').matches) {
        closeSidebarMobile();
        return;
      }
      appSidebar.classList.toggle('collapsed');
    });
  }

  if (mobileSidebarBtn && appSidebar) {
    mobileSidebarBtn.addEventListener('click', () => {
      if (appSidebar.classList.contains('mobile-open')) {
        closeSidebarMobile();
      } else {
        closeFiltersMobile();
        openSidebarMobile();
      }
    });
  }

  if (mobileSidebarBackdrop) {
    mobileSidebarBackdrop.addEventListener('click', () => closeSidebarMobile());
  }

  if (appSidebar) {
    appSidebar.querySelectorAll('.sidebar-nav a').forEach((link) => {
      link.addEventListener('click', () => {
        if (window.matchMedia('(max-width: 980px)').matches) {
          closeSidebarMobile();
        }
      });
    });
  }

  window.addEventListener('resize', () => {
    if (window.innerWidth > 980) {
      closeSidebarMobile();
      appSidebar?.classList.remove('mobile-open');
    }
    syncAssistantLayoutState();
    syncChatLauncherVisibility();
  });

  // user dropdown
  if (userMenuBtn && userMenu) {
    userMenuBtn.addEventListener('click', (e) => {
      e.preventDefault();
      userMenu.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!userMenu.contains(e.target)) userMenu.classList.remove('open');
    });
  }

  // logout (tenta encerrar sessão no back; se não existir endpoint, cai no redirect)
const doLogout = async () => {
    const endpoints = [
      { url: API_BASE + "/logout", method: "POST" },
      { url: API_BASE + "/auth/logout", method: "POST" },
      { url: API_BASE + "/cliente/logout", method: "POST" },
      { url: API_BASE + "/cliente/sair", method: "POST" },
      { url: API_BASE + "/session/logout", method: "POST" },
      { url: API_BASE + "/logout", method: "GET" },
      { url: API_BASE + "/auth/logout", method: "GET" },
      { url: API_BASE + "/cliente/logout", method: "GET" },
      { url: API_BASE + "/cliente/sair", method: "GET" },
      { url: API_BASE + "/session/logout", method: "GET" },
    ];

    try {
      try {
        if (window.AthosPresence?.markOffline) {
          await window.AthosPresence.markOffline({ keepalive: true });
        }
      } catch (_) {}

      for (const ep of endpoints) {
        try {
          const r = await fetch(ep.url, { method: ep.method, credentials: "include" });
          if (r.ok) break;
        } catch (_) { /* tenta o próximo */ }
      }
    } finally {
      try { window.dispatchEvent(new Event('athos:logout')); } catch (_) {}
      try { localStorage.removeItem('cliente_token'); } catch (_) {}
      try { sessionStorage.removeItem('cliente_token'); } catch (_) {}
      clearChatSessionState(window.sessionStorage);
      assistantSemanticMemory = createDashboardAssistantMemory();
      const sep = LOGIN_URL.includes('?') ? '&' : '?';
      redirectWithAuthGuard(`${LOGIN_URL}${sep}logged_out=1`, 'main.logout');
    }
  };
  if (logoutIconBtn) logoutIconBtn.addEventListener('click', doLogout);
  if (logoutBtn) logoutBtn.addEventListener('click', doLogout);

  syncSortControls();
  syncKpiButtons();
  setSearchVisualState();

  // busca global (aplica instantâneo)
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      if (assistantPanelContext && String(searchInput.value || '').trim()) {
        clearAssistantPanelContext();
      }
      setSearchVisualState();
      scheduleDebouncedSearchRefresh();
    });
  }

  // ordenar
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      setSortField(sortSelect.value, { resetDirection: true });
      applyFiltersAndRender({ resetPage: true });
    });
  }

  if (sortChips) {
    sortChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.sort-chip[data-sort]');
      if (!chip) return;

      const nextSort = normalizeSortValue(chip.getAttribute('data-sort'));
      if (nextSort === sortField) {
        toggleSortDirection();
      } else {
        setSortField(nextSort, { resetDirection: true });
      }
      applyFiltersAndRender({ resetPage: true });
    });
  }

  if (sortDirectionBtn) {
    sortDirectionBtn.addEventListener('click', () => {
      toggleSortDirection();
      applyFiltersAndRender({ resetPage: true });
    });
  }

  [statChipTotal, statChipAbertos, statChipFechados].forEach((btn) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      const next = String(btn.getAttribute('data-kpi-filter') || 'all');
      kpiFilter = next;
      syncKpiButtons();
      applyFiltersAndRender({ resetPage: true });
    });
  });

  // ver salvos (bookmark ao lado das notificações)
  if (savedToggleBtn) {
    savedToggleBtn.addEventListener('click', () => {
      onlyFavoritos = !onlyFavoritos;
      syncSavedToggleUI();
      applyFiltersAndRender({ resetPage: true });
    });
  }

  // aplicar / limpar filtros
  if (applyFiltersBtn) {
    applyFiltersBtn.addEventListener('click', () => {
      applied = {
        estado: readSelected('estado'),
        instituicao: readSelected('instituicao'),
        area: readSelected('area'),
      };
      updateFilterActionsState();
      closeFiltersMobile();
      applyFiltersAndRender({ resetPage: true });
    });
  }

  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
      closeFiltersMobile();
      clearAllFilters({ keepSearch: true, keepFavorites: true, rerender: true });
    });
  }

  if (clearActiveFiltersBtn) {
    clearActiveFiltersBtn.addEventListener('click', () => {
      clearAllFilters({ keepSearch: true, keepFavorites: false, rerender: true });
    });
  }

  // mobile filters open/close
  if (mobileFiltersBtn && filtersPanel) {
    mobileFiltersBtn.addEventListener('click', () => {
      closeSidebarMobile();
      openFiltersMobile();
    });
  }
  if (filtersCloseBtn) {
    filtersCloseBtn.addEventListener('click', () => closeFiltersMobile());
  }
  if (filtersBackdrop) {
    filtersBackdrop.addEventListener('click', () => closeFiltersMobile());
  }

  // paginação click
  if (paginationEl) {
    paginationEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-page]');
      if (!btn) return;
      const p = Number(btn.getAttribute('data-page'));
      if (!Number.isFinite(p) || p === currentPage) return;
      currentPage = p;
      await applyFiltersAndRender({ resetPage: false });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // abrir edital (apenas pelo botão) + salvar (estrela)
  if (container) {
    container.addEventListener('click', async (e) => {
      const saveBtn = e.target.closest('.save-btn');
      if (saveBtn) {
        e.preventDefault();
        e.stopPropagation();

        const id = saveBtn.getAttribute('data-id');
        if (!id) return;

        // otimista: desabilita rapidinho pra evitar double click
        const prevDisabled = saveBtn.disabled;
        saveBtn.disabled = true;

        try {
          const r = await toggleFavorito(id);
          if (r?.ok) {
            updateSaveButtonUI(saveBtn, r.is_favorite);
            showToast(r.is_favorite ? 'Edital salvo na sua lista.' : 'Edital removido dos salvos.', 'success', 1800);
            // Se estiver vendo só salvos e removeu, some do grid
            if (onlyFavoritos && !r.is_favorite) {
              applyFiltersAndRender({ resetPage: true, forceReload: true });
            }
          }
        } catch (err) {
          showToast(err?.message || 'Não foi possível atualizar este edital nos salvos.', 'error');
        } finally {
          saveBtn.disabled = prevDisabled;
        }
        return;
      }

      const btn = e.target.closest('.open-edital-btn');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      const edital = editaisOriginais.find(ed => String(ed.id) === String(id));
      if (edital) openModal(edital);
    });
  }

  // modal close
  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeModal();
    });
  }

  // chat
  if (chatButton && chatWrapper) {
    chatButton.addEventListener('click', () => {
      setChatOpen(!isChatOpen(), { focusInput: true });
    });
  }

  if (chatCloseBtn) {
    chatCloseBtn.addEventListener('click', () => setChatOpen(false));
  }

  if (assistantBackdrop) {
    assistantBackdrop.addEventListener('click', () => setChatOpen(false));
  }

  if (sendButton && chatInput) {
    sendButton.addEventListener('click', () => {
      if (isChatStreamActive()) {
        abortActiveChatRequest('stop_button');
        return;
      }
      void handleChatSend({ source: 'message_send' });
    });
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (isChatStreamActive()) return;
        void handleChatSend({ source: 'message_send' });
      }
    });
  }


  // opções clicáveis do chat (ex: lista de editais)
  if (messageContainer) {
    messageContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('button.chat-option-btn');
      if (!btn) return;

      const action = btn.getAttribute('data-action');

      if (action === 'open_edital') {
        const id = btn.getAttribute('data-edital-id');
        const edital = editaisOriginais.find(ed => String(ed.id) === String(id));
        if (edital) openModal(edital);
        return;
      }

      if (action === 'view_all') {
        clearActiveEditalContext();
        const q = btn.getAttribute('data-query') || '';
        const payload = btn._chatPayload || null;
        const appliedFromChat = applyAssistantPayloadToDashboard(payload, { fallbackQuery: q });
        if (!appliedFromChat) {
          const normalized = normalizeAssistantQuery(q);
          const fallbackKeywords = extractChatKeywords(normalized).join(' ');
          if (searchInput) searchInput.value = fallbackKeywords;
          applyFiltersAndRender({ resetPage: true });
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setChatOpen(false);
        return;
      }

      if (action === 'ask_new') {
        clearActiveEditalContext();
        if (chatInput) {
          chatInput.value = '';
          chatInput.focus();
        }
        addMessage('Me diga um tema (ex: inovação, saúde, educação, agricultura) ou uma instituição (ex: FAPEAL, FINEP).', 'bot');
        return;
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!isChatOpen()) return;
    if (modalOverlay?.classList.contains('open')) return;
    setChatOpen(false);
  });

  syncAssistantLayoutState();
  syncChatLauncherVisibility();
}

function openFiltersMobile() {
  if (!filtersPanel || !filtersBackdrop) return;
  setChatOpen(false);
  filtersPanel.classList.add('open');
  filtersBackdrop.classList.add('active');
  filtersBackdrop.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeFiltersMobile() {
  if (!filtersPanel || !filtersBackdrop) return;
  filtersPanel.classList.remove('open');
  filtersBackdrop.classList.remove('active');
  filtersBackdrop.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = appSidebar?.classList.contains('mobile-open') ? 'hidden' : '';
}

function openSidebarMobile() {
  if (!appSidebar || !mobileSidebarBackdrop) return;
  setChatOpen(false);
  appSidebar.classList.remove('collapsed');
  appSidebar.classList.add('mobile-open');
  mobileSidebarBackdrop.classList.add('active');
  mobileSidebarBackdrop.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeSidebarMobile() {
  if (!appSidebar || !mobileSidebarBackdrop) return;
  appSidebar.classList.remove('mobile-open');
  mobileSidebarBackdrop.classList.remove('active');
  mobileSidebarBackdrop.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = filtersPanel?.classList.contains('open') ? 'hidden' : '';
}

// =========================
// MODAL (detalhes do edital)
// =========================
function formatModalDate(dateValue) {
  const t = parseAnyDateToTime(dateValue);
  if (t === null) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(t));
}

function formatModalFunding(value) {
  if (value === null || value === undefined || String(value).trim() === '') return 'Não informado';
  const parsed = parseMoneyToNumber(value);
  if (Number.isFinite(parsed) && parsed > 0) return formatBRL(parsed);
  return String(value);
}

function formatModalPublicoAlvo(value) {
  if (Array.isArray(value)) {
    const items = value.map(v => String(v || '').trim()).filter(Boolean);
    return items.length ? items.join(', ') : 'Não informado';
  }
  const clean = String(value || '').trim();
  return clean || 'Não informado';
}

function getFileExtension(name = '', url = '') {
  const source = `${name} ${url}`.toLowerCase();
  const match = source.match(/\.([a-z0-9]{2,5})(?:$|[?#\s])/i);
  return match ? match[1] : '';
}

function getFileIcon(ext) {
  switch (ext) {
    case 'pdf': return 'fa-file-pdf';
    case 'xls':
    case 'xlsx':
    case 'csv': return 'fa-file-excel';
    case 'doc':
    case 'docx':
    case 'rtf':
    case 'odt': return 'fa-file-word';
    case 'ppt':
    case 'pptx': return 'fa-file-powerpoint';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg': return 'fa-file-image';
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar': return 'fa-file-zipper';
    default: return 'fa-file-lines';
  }
}

function friendlyAttachmentName(rawName, url, index) {
  const source = String(rawName || '').trim() || extractFileNameFromUrl(url) || `Documento ${index + 1}`;
  const noQuery = source.split('?')[0];
  const cleaned = decodeURIComponent(noQuery)
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b[a-f0-9]{24,}\b/gi, '')
    .trim();
  if (!cleaned) return `Documento ${index + 1}`;
  return cleaned.replace(/\.[a-z0-9]{2,5}$/i, '').trim() || `Documento ${index + 1}`;
}

function extractFileNameFromUrl(url) {
  try {
    const pathname = new URL(String(url || ''), window.location.origin).pathname;
    const parts = pathname.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  } catch {
    const clean = String(url || '').split('?')[0];
    const parts = clean.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }
}

function getModalStatusChip(edital) {
  const chips = [];
  if (edital?.is_highlighted) {
    chips.push('<span class="status-chip status-chip--highlight">Em destaque</span>');
  }
  if (isClosedEdital(edital)) chips.push('<span class="status-chip status-chip--closed">Encerrado</span>');
  else chips.push('<span class="status-chip status-chip--open">Aberto</span>');
  return chips.join('');
}

function isNotInformedLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return (
    !normalized ||
    normalized === 'não informado' ||
    normalized === 'nao informado' ||
    normalized === 'não informada' ||
    normalized === 'nao informada' ||
    normalized === 'n/a'
  );
}

async function openModal(edital) {
  if (!modalOverlay || !modalContentContainer || !edital) return;
  edital = await ensureEditalDetailLoaded(edital);
  rememberAssistantOpenedCard(edital.id);

  const shareLink = String(edital.share_link || '').trim();

  const uniqueTags = [];
  const seenTags = new Set();
  const rawTags = [edital.area, ...(Array.isArray(edital.tags) ? edital.tags : [])];
  for (const t of rawTags) {
    const clean = String(t || '').trim();
    if (!clean || clean.toLowerCase() === 'geral' || isNotInformedLabel(clean)) continue;
    const key = clean.toLowerCase();
    if (seenTags.has(key)) continue;
    seenTags.add(key);
    uniqueTags.push(clean);
  }

  const tagsHtml = uniqueTags.length
    ? `<div class="modal-tags">${uniqueTags.map(t => `<span class="pill">${escapeHtml(t)}</span>`).join('')}</div>`
    : '';

  const estadoTopTag = String(edital.estado || '').trim();
  const estadoTopTagHtml = estadoTopTag && !isNotInformedLabel(estadoTopTag)
    ? `<span class="pill gray">${escapeHtml(estadoTopTag)}</span>`
    : '';

  const files = (Array.isArray(edital.arquivos) ? edital.arquivos : [])
    .map((file, index) => {
      const url = String(file?.url || '').trim();
      if (!url) return null;
      const ext = getFileExtension(file?.nome, url);
      return {
        url,
        ext,
        icon: getFileIcon(ext),
        name: friendlyAttachmentName(file?.nome, url, index),
      };
    })
    .filter(Boolean);

  const arquivosHtml = files.length
    ? `
      <div class="attachments-section">
        <div class="attachments-summary" role="button" tabindex="0" aria-label="Abrir recursos e documentos">
          <div class="attachments-label">
            <h3>Recursos e documentos</h3>
            <span class="attachments-hint">${files.length} arquivo(s) disponível(is)</span>
          </div>
          <i class="fas fa-chevron-right"></i>
        </div>
        <div class="attachments-wrapper">
          <ul class="attachment-list">
            ${files.map((file) => `
              <li>
                <a href="${escapeAttr(file.url)}" target="_blank" rel="noopener noreferrer">
                  <i class="fas ${file.icon}" aria-hidden="true"></i>
                  <span class="attachment-item-copy">
                    <strong>${escapeHtml(file.name)}</strong>
                    <small>${escapeHtml(file.ext ? file.ext.toUpperCase() : 'Arquivo')}</small>
                  </span>
                </a>
              </li>
            `).join('')}
          </ul>
        </div>
      </div>
    `
    : `
      <div class="attachments-section">
        <div class="attachments-empty">
          <i class="fas fa-folder-open" aria-hidden="true"></i>
          <span>Nenhum documento anexado.</span>
        </div>
      </div>
    `;

  modalContentContainer.innerHTML = `
    <div class="modal-breadcrumb">
      <i class="fas fa-house" aria-hidden="true"></i>
      <span>Dashboard</span>
      <i class="fas fa-chevron-right" aria-hidden="true"></i>
      <span>Detalhes do edital</span>
    </div>

    <div class="modal-topbar modal-topbar--premium">
      <div class="modal-top-left">
        ${edital.icone ? `<img src="${escapeAttr(edital.icone)}" alt="${escapeHtml(edital.instituicao || '')}" class="modal-logo">` : '<div class="modal-logo-placeholder"><i class="fas fa-building"></i></div>'}
        <div class="modal-top-copy">
          <div class="modal-kicker">${escapeHtml(edital.instituicao || 'Instituição não informada')}</div>
          <div class="modal-status-row">
            ${getModalStatusChip(edital)}
            ${estadoTopTagHtml}
          </div>
        </div>
      </div>

      <div class="modal-top-actions">
        <button class="modal-share-btn" type="button" id="modalCopyLinkBtn" data-tooltip="Copiar link">
          <i class="fas fa-link"></i> Copiar link
        </button>

        <button class="modal-save-btn" type="button" id="modalSaveBtn" title="${edital.is_favorite ? 'Remover dos salvos' : 'Salvar edital'}" data-tooltip="${edital.is_favorite ? 'Remover dos salvos' : 'Salvar edital'}">
          <i class="${edital.is_favorite ? 'fas' : 'far'} fa-star"></i> ${edital.is_favorite ? 'Salvo' : 'Salvar'}
        </button>
      </div>
    </div>

    <h2 class="modal-title">${escapeHtml(edital.titulo || 'Sem título')}</h2>
    <p class="modal-desc">${escapeHtml(edital.descricao || 'Sem descrição cadastrada')}</p>

    <div class="modal-highlights">
      <article class="modal-highlight">
        <span>Prazo final</span>
        <strong>${escapeHtml(formatModalDate(edital.data_fechamento))}</strong>
      </article>
      <article class="modal-highlight">
        <span>Valor do fomento</span>
        <strong>${escapeHtml(formatModalFunding(edital.valor_total))}</strong>
      </article>
      <article class="modal-highlight">
        <span>Quem pode participar</span>
        <strong>${escapeHtml(truncateText(formatModalPublicoAlvo(edital.publico_alvo), 120))}</strong>
      </article>
    </div>

    <div class="modal-details">
      <div class="modal-detail-row"><strong>Instituição:</strong> <span>${escapeHtml(edital.instituicao || 'Não informada')}</span></div>
      <div class="modal-detail-row"><strong>Estado:</strong> <span>${escapeHtml(edital.estado || 'Não informado')}</span></div>
      <div class="modal-detail-row"><strong>Categoria:</strong> <span>${escapeHtml(edital.area || 'Não informada')}</span></div>
    </div>

    ${tagsHtml}

    <div class="edital-ai-cta">
      <div class="cta-text">
        <strong>Converse com a IA sobre este edital</strong>
        <span>Pergunte sobre prazos, documentos, público-alvo e próximos passos.</span>
      </div>
      <button class="btn btn-primary" type="button" id="talkEditalBtn">
        <i class="fas fa-robot"></i> Falar com a IA
      </button>
    </div>

    ${arquivosHtml}
  `;

  const copyBtn = modalContentContainer.querySelector('#modalCopyLinkBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (!shareLink) {
        showToast('Link público indisponível para este edital.', 'error');
        return;
      }
      navigator.clipboard.writeText(shareLink)
        .then(() => showToast('Link copiado para compartilhar.', 'success', 1800))
        .catch(() => showToast('Não foi possível copiar o link.', 'error'));
    });
  }

  const modalSaveBtn = modalContentContainer.querySelector('#modalSaveBtn');
  if (modalSaveBtn) {
    modalSaveBtn.addEventListener('click', async () => {
      const prev = modalSaveBtn.disabled;
      modalSaveBtn.disabled = true;
      try {
        const r = await toggleFavorito(edital.id);
        if (r?.ok) {
          modalSaveBtn.innerHTML = `<i class="${r.is_favorite ? 'fas' : 'far'} fa-star"></i> ${r.is_favorite ? 'Salvo' : 'Salvar'}`;
          modalSaveBtn.setAttribute('title', r.is_favorite ? 'Remover dos salvos' : 'Salvar edital');
          modalSaveBtn.setAttribute('data-tooltip', r.is_favorite ? 'Remover dos salvos' : 'Salvar edital');

          const cardBtn = document.querySelector(`.save-btn[data-id="${String(edital.id)}"]`);
          if (cardBtn) updateSaveButtonUI(cardBtn, r.is_favorite);
          showToast(r.is_favorite ? 'Edital salvo com sucesso.' : 'Edital removido dos salvos.', 'success', 1800);

          if (onlyFavoritos && !r.is_favorite) {
            applyFiltersAndRender({ resetPage: true, forceReload: true });
          }
        }
      } catch (err) {
        showToast(err?.message || 'Não foi possível atualizar os salvos.', 'error');
      } finally {
        modalSaveBtn.disabled = prev;
      }
    });
  }

  const summary = modalContentContainer.querySelector('.attachments-summary');
  if (summary) {
    const toggle = () => {
      const wrapper = summary.nextElementSibling;
      const icon = summary.querySelector('i');
      const isOpen = wrapper.classList.toggle('open');
      summary.classList.toggle('open', isOpen);
      if (isOpen) {
        icon.classList.remove('fa-chevron-right');
        icon.classList.add('fa-chevron-down');
      } else {
        icon.classList.remove('fa-chevron-down');
        icon.classList.add('fa-chevron-right');
      }
    };

    summary.addEventListener('click', toggle);
    summary.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        toggle();
      }
    });
  }

  const talkBtn = modalContentContainer.querySelector('#talkEditalBtn');
  if (talkBtn) {
    talkBtn.addEventListener('click', () => startEditalChat(edital));
  }

  modalOverlay.classList.add('open');
  modalOverlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  if (!modalOverlay) return;
  modalOverlay.classList.remove('open');
  modalOverlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  document.body.style.overflow = '';
}

function getActiveEditalContext() {
  chatState = ensureChatSessionState(chatState);
  const editalId = chatState?.activeEntityId ?? chatState?.edital_id ?? chatState?.editalId ?? null;
  if (editalId === null || editalId === undefined || editalId === '') return null;
  const contextType = String(chatState?.activeContextType || chatState?.mode || '').trim().toLowerCase();
  if (contextType && contextType !== 'edital') return null;
  const titulo = chatState?.activeEntityTitle ?? chatState?.titulo ?? chatState?.edital_titulo ?? chatState?.editalTitulo ?? 'Edital';
  return {
    editalId: String(editalId),
    titulo: String(titulo || 'Edital').trim() || 'Edital',
  };
}

function clearActiveEditalContext({ clearAssistantContext = false } = {}) {
  chatState = clearActiveContextInState(chatState);
  persistChatState(chatState);
  if (clearAssistantContext) {
    clearAssistantPanelContext();
  }
  updateChatHeader();
}

function setActiveEditalContext(edital) {
  if (!edital || edital.id === null || edital.id === undefined) return false;
  chatState = setActiveEditalContextInState(chatState, edital);
  persistChatState(chatState);
  updateChatHeader();
  return true;
}

function buildEditalContextIntroMessage(title) {
  const safeTitle = truncateText(String(title || 'Edital').trim() || 'Edital', 92);
  return `Estamos falando deste edital: ${safeTitle}. Se quiser sair desse edital e voltar a busca geral, e so digitar "sair".`;
}

function buildEditalContextExitMessage() {
  return 'Beleza, sai desse edital. Agora voce pode buscar outro tema ou perguntar sobre outro edital.';
}

function buildEditalContextSwitchMessage(targetLabel) {
  const safeTarget = truncateText(String(targetLabel || 'outro assunto').trim(), 92);
  return `Entendi, saindo do edital atual. Agora vamos falar sobre: ${safeTarget}.`;
}

function updateChatHeader() {
  const target = chatHeaderTitle || chatHeader;
  if (!target) return;
  const active = getActiveEditalContext();
  if (active?.editalId) {
    target.textContent = `Athos • Edital: ${truncateText(active.titulo, 28)}`;
    if (chatInput) {
      chatInput.placeholder = 'Pergunte sobre este edital ou digite "sair" para voltar.';
    }
  } else {
    target.textContent = 'Athos • Assistente';
    if (chatInput) {
      chatInput.placeholder = 'Digite sua mensagem...';
    }
  }
  syncInitialQuickPromptsVisibility({ animate: false });
}

function startEditalChat(edital) {
  if (!edital) return;
  if (!setActiveEditalContext(edital)) return;

  setChatOpen(true, { focusInput: true, skipWelcome: true });

  const introMessage = buildEditalContextIntroMessage(edital.titulo || 'Sem titulo');
  addMessage(introMessage, 'bot');
  chatState = appendConversationTurn(chatState, 'assistant', introMessage);
  persistChatState(chatState);

  closeModal();
}

function stripHtmlPreserveBreaks(htmlStr) {
  const s = String(htmlStr ?? '');
  const withBreaks = s.replace(/<br\s*\/?\s*>/gi, '\n');
  const tmp = document.createElement('div');
  tmp.innerHTML = withBreaks;
  return (tmp.textContent || tmp.innerText || '').trim();
}

function normalizeBotText(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (s.includes('<') && s.includes('>')) return stripHtmlPreserveBreaks(s);
  return s;
}

function normalizeConciseBotText(value, { maxLines = 3 } = {}) {
  const raw = normalizeBotText(value).replace(/https?:\/\/\S+/gi, '').trim();
  if (!raw) return '';
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(0, Math.max(1, maxLines)).join('\n');
}

function renderSimpleMarkdown(text) {
  // Escapa HTML e depois aplica apenas negrito com **texto**.
  const safe = escapeHtml(String(text ?? ''));
  const withBold = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return withBold.replace(/\n/g, '<br>');
}

function extractEmbeddedSources(text) {
  const raw = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!raw) return { text: '', names: [] };

  const lines = raw.split('\n');
  let headerIdx = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const normalizedLine = lines[i].replace(/\*/g, '').trim().toLowerCase();
    if (/^fontes?\s*:?\s*$/.test(normalizedLine)) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx < 0 || headerIdx >= lines.length - 1) {
    return { text: raw, names: [] };
  }

  const names = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const bulletMatch = trimmed.match(/^[-*]\s*(.+)$/);
    const numberedMatch = trimmed.match(/^\d+[.)]\s*(.+)$/);
    const value = (bulletMatch?.[1] || numberedMatch?.[1] || trimmed).trim();
    if (value) names.push(value);
  }

  if (!names.length) {
    return { text: raw, names: [] };
  }

  const cleanText = lines.slice(0, headerIdx).join('\n').trim();
  return { text: cleanText || raw, names };
}

function normalizeSources(rawSources, fallbackNames = []) {
  const byTitle = new Map();
  const seenUrls = new Set();

  const addSource = (titleRaw, urlRaw = '', status = 'ok') => {
    const title = String(titleRaw ?? '').trim();
    const url = String(urlRaw ?? '').trim();
    if (!title && !url) return;

    const safeTitle = title || url || 'Fonte';
    const titleKey = safeTitle.toLowerCase().replace(/\s+/g, ' ').trim();
    const urlKey = url.toLowerCase();
    const existing = byTitle.get(titleKey);

    if (urlKey && seenUrls.has(urlKey)) return;

    if (!existing) {
      byTitle.set(titleKey, { title: safeTitle, url, status });
      if (urlKey) seenUrls.add(urlKey);
      return;
    }

    const existingHasUrl = Boolean(existing.url);
    const incomingHasUrl = Boolean(url);

    // Se já existe item com o mesmo nome, mantém a versão clicável.
    if (!existingHasUrl && incomingHasUrl) {
      byTitle.set(titleKey, { title: safeTitle, url, status });
      seenUrls.add(urlKey);
    }
  };

  if (Array.isArray(rawSources)) {
    rawSources.forEach((s, idx) => {
      if (!s || typeof s !== 'object') return;

      const title = s.title || s.name || s.nome || `Fonte ${idx + 1}`;
      const url = s.url || s.link || '';
      const status = s.status || (s.ok === false ? 'error' : 'ok');
      const isOk = status === 'ok' || s.ok === true || !('status' in s);

      if (!isOk && !url) return;
      addSource(title, url, isOk ? 'ok' : status);
    });
  }

  if (Array.isArray(fallbackNames)) {
    fallbackNames.forEach((name) => {
      const label = String(name ?? '').trim();
      if (!label) return;

      const url = /^https?:\/\//i.test(label) ? label : '';
      addSource(label, url, 'ok');
    });
  }

  return Array.from(byTitle.values());
}

// =========================
// CHATBOT (mantido)
// =========================
function scrollToBottom() {
  if (!messageContainer) return;
  setTimeout(() => { messageContainer.scrollTop = messageContainer.scrollHeight; }, 50);
}

function applySourcesDetails(msgEl, sources) {
  if (!msgEl) return;

  const oldDetails = msgEl.querySelector('.chat-sources-details');
  if (oldDetails) oldDetails.remove();

  const normalized = normalizeSources(sources);
  if (!normalized.length) return;

  msgEl.appendChild(buildSourcesDetails(normalized));
}

function addMessage(text, sender = 'bot', sources = null, opts = {}) {
  if (!messageContainer) return null;

  const msg = document.createElement('div');
  msg.className = `chat-message ${sender}` + (opts.isTyping ? ' is-typing' : '');

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (sender === 'bot') {
    bubble.innerHTML = renderSimpleMarkdown(text);
  } else {
    bubble.textContent = String(text ?? '');
  }
  msg.appendChild(bubble);
  if (sender === 'bot') applySourcesDetails(msg, sources);

  messageContainer.appendChild(msg);

  scrollToBottom();
  return msg;
}

function setMessageText(msgEl, text, sources = null, options = {}) {
  if (!msgEl) return;
  const bubble = msgEl.querySelector('.bubble');
  if (bubble) bubble.innerHTML = renderSimpleMarkdown(text);
  if (msgEl.classList.contains('bot')) {
    applySourcesDetails(msgEl, sources);
  }
  if (!options?.keepTyping) {
    msgEl.classList.remove('is-typing');
  }
}

function buildSourcesDetails(sources) {
  const total = sources.length;
  const ok = sources.filter(s => s && (s.status === 'ok' || s.ok === true || !('status' in s))).length;

  const details = document.createElement('details');
  details.className = 'chat-sources-details';

  const summary = document.createElement('summary');
  const icon = document.createElement('i');
  icon.className = 'fas fa-file-lines';
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = `Fontes consultadas (${ok}/${total})`;
  summary.appendChild(icon);
  summary.appendChild(label);
  details.appendChild(summary);

  const ul = document.createElement('ul');
  ul.className = 'chat-sources-list';

  sources.forEach((s) => {
    const li = document.createElement('li');
    li.className = 'chat-source-item';

    const title = String(s?.title || s?.name || s?.nome || 'Fonte').trim();
    const url = String(s?.url || '').trim();

    if (url) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = title;
      li.appendChild(a);
    } else {
      const span = document.createElement('span');
      span.textContent = title;
      li.appendChild(span);
    }

    ul.appendChild(li);
  });

  details.appendChild(ul);
  return details;
}


// =========================
// CHAT — OPÇÕES (quick replies)
// =========================
const CHAT_QUERY_STOPWORDS = new Set([
  'a', 'as', 'o', 'os', 'um', 'uma', 'uns', 'umas',
  'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'para', 'por', 'com', 'sem', 'que', 'quais', 'qual', 'me', 'mostre',
  'quero', 'tem', 'têm', 'temos', 'sobre', 'site', 'athos', 'edital', 'editais',
  'esta', 'estao', 'estão', 'nesta', 'nesse', 'nessa', 'agora', 'hoje',
]);

const CHAT_OPEN_HINTS = [
  'aberto', 'abertos', 'aberta', 'abertas', 'em aberto', 'inscricoes abertas', 'inscrições abertas',
  'ativos', 'ativas', 'vigente', 'vigentes',
];

const CHAT_DEADLINE_HINTS = [
  'prazo', 'prazos', 'vence', 'vencem', 'vencimento', 'encerramento',
  'inscricao', 'inscricoes', 'inscrição', 'inscrições', 'data limite',
];

const CHAT_WEEK_HINTS = [
  'semana', 'esta semana', 'nesta semana', 'proxima semana', 'próxima semana', '7 dias', 'sete dias',
];

const CHAT_GREETING_HINTS = [
  'oi', 'ola', 'olá', 'opa', 'e ai', 'e aí', 'eae', 'bom dia', 'boa tarde', 'boa noite', 'salve',
];

const CHAT_SMALL_TALK_HINTS = [
  'tudo bem', 'como voce esta', 'como você está', 'como vai', 'obrigado', 'obrigada', 'valeu',
];

const CHAT_HELP_HINTS = [
  'o que voce pode', 'o que você pode', 'o que vc pode', 'como funciona', 'como usar', 'como eu uso',
  'como filtro', 'como filtrar', 'filtro', 'filtros', 'ajuda', 'onde vejo', 'documento', 'documentos',
  'anexo', 'anexos', 'dashboard', 'painel', 'portal', 'plataforma',
];

const CHAT_LISTING_HINTS = [
  'quais', 'mostre', 'listar', 'liste', 'busque', 'buscar', 'procure', 'encontre',
  'tem edital', 'tem editais', 'oportunidade', 'oportunidades',
];

const CHAT_REFINE_HINTS = [
  'quero edital', 'quero editais', 'quero buscar', 'quero buscar algo',
  'me mostra oportunidade', 'me mostra oportunidades', 'tem alguma oportunidade',
  'tem alguma coisa', 'preciso de ajuda com edital', 'preciso de edital',
  'tem edital', 'tem editais',
];

const CHAT_PLATFORM_HINTS = [
  'edital', 'editais', 'oportunidade', 'oportunidades', 'prazo', 'prazos', 'instituicao', 'instituição',
  'estado', 'categoria', 'filtro', 'filtros', 'documento', 'documentos', 'anexo', 'anexos',
  'dashboard', 'painel', 'portal', 'plataforma', 'athos', 'ia',
];

const CHAT_GENERIC_QUERY_KEYWORDS = new Set([
  'algum', 'alguma', 'coisa', 'coisas', 'oportunidade', 'oportunidades',
  'buscar', 'busca', 'procura', 'procurar', 'mostrar', 'mostre', 'quero', 'tem', 'algo', 'qualquer',
]);

const CHAT_EDITAL_EXIT_HINTS = [
  'sair',
  'voltar',
  'sair do edital',
  'sair desse edital',
  'sair deste edital',
  'voltar para busca',
  'voltar para busca geral',
  'fechar edital',
  'encerrar edital',
  'encerrar assunto',
  'fechar assunto',
  'modo geral',
];

const CHAT_EDITAL_SWITCH_HINTS = [
  'outro edital',
  'outro tema',
  'outro assunto',
  'mudar assunto',
  'trocar assunto',
  'trocar de edital',
  'buscar outro tema',
  'buscar outro edital',
  'buscar editais',
  'quero ver editais',
  'quero buscar editais',
  'me mostre editais',
  'listar editais',
  'voltar para busca',
  'voltar para o painel',
];

const CHAT_EDITAL_CONFIRM_EXIT_HINTS = [
  'sim',
  'sair',
  'voltar',
  'pode sair',
  'pode voltar',
  'quero sair',
  'quero voltar',
  'fechar edital',
  'encerrar assunto',
];

const CHAT_EDITAL_CONFIRM_STAY_HINTS = [
  'nao',
  'não',
  'continuar',
  'continuar neste edital',
  'continuar nesse edital',
  'ficar neste edital',
  'ficar nesse edital',
  'manter edital',
];

function normalizeAssistantQuery(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAnyChatHint(normalizedQuery, hints) {
  if (!normalizedQuery) return false;
  return hints.some((hint) => normalizedQuery.includes(normalizeAssistantQuery(hint)));
}

function extractChatKeywords(normalizedQuery) {
  if (!normalizedQuery) return [];
  const seen = new Set();
  return normalizedQuery
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((token) => token.length >= 3 && !CHAT_QUERY_STOPWORDS.has(token))
    .filter((token) => {
      if (seen.has(token)) return false;
      seen.add(token);
      return true;
    });
}

function normalizeAssistantIntent(value) {
  const token = normalizeAssistantQuery(value || '');
  if (!token) return 'unknown';
  if (token === 'search_edital') return 'edital_search';
  return token;
}

function hasSpecificChatKeywords(keywords) {
  if (!Array.isArray(keywords) || !keywords.length) return false;
  return keywords.some((token) => !CHAT_GENERIC_QUERY_KEYWORDS.has(String(token || '').trim()));
}

function messageHasAnyPhrase(normalizedQuery, phrases) {
  if (!normalizedQuery || !Array.isArray(phrases) || !phrases.length) return false;
  return phrases.some((phrase) => normalizedQuery.includes(normalizeAssistantQuery(phrase)));
}

function classifyAssistantIntent(question) {
  const normalizedQuery = normalizeAssistantQuery(question);
  if (!normalizedQuery) return 'unknown';

  if (messageHasAnyPhrase(normalizedQuery, CHAT_GREETING_HINTS) || /^(oi|ola|opa|e ai|eae|bom dia|boa tarde|boa noite)\b/.test(normalizedQuery)) {
    return 'greeting';
  }

  if (messageHasAnyPhrase(normalizedQuery, CHAT_SMALL_TALK_HINTS)) {
    return 'small_talk';
  }

  if (messageHasAnyPhrase(normalizedQuery, CHAT_HELP_HINTS)) {
    return 'help_intent';
  }

  const wantsClosed = hasAnyChatHint(normalizedQuery, ['encerrado', 'encerrados', 'fechado', 'fechados', 'vencido', 'expirado']);
  const wantsOpen = !wantsClosed && hasAnyChatHint(normalizedQuery, CHAT_OPEN_HINTS);
  const wantsWeek = hasAnyChatHint(normalizedQuery, CHAT_WEEK_HINTS) && hasAnyChatHint(normalizedQuery, CHAT_DEADLINE_HINTS);
  const keywords = extractChatKeywords(normalizedQuery);
  const hasStructuredCriteria = hasSpecificChatKeywords(keywords) || wantsOpen || wantsClosed || wantsWeek;
  const hasPlatformScope = messageHasAnyPhrase(normalizedQuery, CHAT_PLATFORM_HINTS);
  const isListingRequest = messageHasAnyPhrase(normalizedQuery, CHAT_LISTING_HINTS);

  if ((wantsOpen || wantsClosed || wantsWeek) && (hasPlatformScope || hasStructuredCriteria)) {
    return 'edital_search';
  }
  if (isListingRequest && hasStructuredCriteria) {
    return 'edital_search';
  }
  if (hasPlatformScope && hasStructuredCriteria) {
    return 'edital_search';
  }
  if (messageHasAnyPhrase(normalizedQuery, CHAT_REFINE_HINTS) && !hasStructuredCriteria) {
    return 'refine_search';
  }
  if (!hasPlatformScope) {
    return normalizedQuery.split(' ').length <= 1 ? 'unknown' : 'out_of_scope';
  }
  if (hasPlatformScope && !hasStructuredCriteria) {
    return 'refine_search';
  }
  return 'unknown';
}

function buildLocalHelpReply(normalizedQuery) {
  if (messageHasAnyPhrase(normalizedQuery, ['filtro', 'filtrar', 'ordenar', 'busca', 'buscar'])) {
    return 'No dashboard, use busca + filtros laterais + ordenação para chegar nos editais mais relevantes.';
  }
  if (messageHasAnyPhrase(normalizedQuery, ['documento', 'documentos', 'anexo', 'anexos'])) {
    return 'Abra um edital para ver anexos e documentos disponíveis no card detalhado.';
  }
  if (messageHasAnyPhrase(normalizedQuery, ['perfil', 'conta', 'preferencia', 'preferencias'])) {
    return 'No Perfil, você atualiza seus dados e preferências de uso da plataforma.';
  }
  return 'Posso te ajudar a encontrar editais por tema, prazo, estado, instituição e categoria, além de orientar no uso dos filtros e da navegação do portal.';
}

function buildLocalAssistantOutcome(question) {
  const q = String(question || '').trim();
  const normalizedQuery = normalizeAssistantQuery(q);
  const intent = classifyAssistantIntent(q);

  if (intent === 'greeting' || intent === 'small_talk') {
    return {
      intent,
      shouldSearch: false,
      reply: 'Oi! Posso te ajudar a encontrar editais por tema, prazo, estado ou instituição.',
      total: 0,
    };
  }

  if (intent === 'help_intent') {
    return {
      intent,
      shouldSearch: false,
      reply: buildLocalHelpReply(normalizedQuery),
      total: 0,
    };
  }

  if (intent === 'refine_search') {
    return {
      intent,
      shouldSearch: false,
      reply: 'Claro. Me diga um critério para refinar: tema, estado, instituição, categoria ou prazo.',
      total: 0,
    };
  }

  if (intent === 'out_of_scope') {
    return {
      intent,
      shouldSearch: false,
      reply: 'Sou focada no portal de editais. Posso te ajudar com busca de oportunidades, filtros, prazos, documentos e navegação da plataforma.',
      total: 0,
    };
  }

  if (intent !== 'edital_search') {
    return {
      intent: 'unknown',
      shouldSearch: false,
      reply: 'Não entendi bem. Quer buscar por tema, estado, instituição, categoria ou prazo?',
      total: 0,
    };
  }

  const matches = searchEditaisForChat(q);
  const total = matches.length;
  if (total === 0) {
    return {
      intent,
      shouldSearch: true,
      reply: 'Não encontrei editais com esse recorte. Tente ajustar por tema, instituição, estado ou prazo.',
      total,
    };
  }

  const normalized = normalizeAssistantQuery(q);
  const wantsClosed = hasAnyChatHint(normalized, ['encerrado', 'encerrados', 'fechado', 'fechados', 'vencido', 'expirado']);
  const wantsOpen = !wantsClosed && hasAnyChatHint(normalized, CHAT_OPEN_HINTS);
  const wantsWeek = hasAnyChatHint(normalized, CHAT_WEEK_HINTS) && hasAnyChatHint(normalized, CHAT_DEADLINE_HINTS);

  let reply = `Encontrei ${total} edital(is) relacionado(s) ao seu pedido.`;
  if (wantsWeek) {
    reply = `Encontrei ${total} edital(is) em aberto com prazo nos próximos 7 dias.`;
  } else if (wantsOpen) {
    reply = `Encontrei ${total} edital(is) em aberto.`;
  } else if (wantsClosed) {
    reply = `Encontrei ${total} edital(is) encerrado(s).`;
  }

  return {
    intent,
    shouldSearch: true,
    reply,
    total,
  };
}

function formatChatDate(value) {
  const t = parseAnyDateToTime(value);
  if (t === null) return String(value || '').trim();
  return new Date(t).toLocaleDateString('pt-BR');
}

function parseChatDeadline(edital) {
  const time = parseAnyDateToTime(edital?.data_fechamento ?? edital?.prazo ?? null);
  if (time === null) return null;
  const d = new Date(time);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function isOpenEditalForChat(edital) {
  if (!edital) return false;
  if (typeof edital.is_open === 'boolean') return edital.is_open;
  if (edital.fluxo_continuo === true) return true;

  const deadline = parseChatDeadline(edital);
  if (deadline === null) return true;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return deadline >= today.getTime();
}

function isDeadlineWithinNextDays(edital, days = 7) {
  const deadline = parseChatDeadline(edital);
  if (deadline === null) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const limit = new Date(today);
  limit.setDate(limit.getDate() + Number(days || 0));
  return deadline >= today.getTime() && deadline <= limit.getTime();
}

function sortEditaisForChat(items, { prioritizeOpen = false, prioritizeWeek = false } = {}) {
  const arr = Array.isArray(items) ? [...items] : [];
  if (!arr.length) return arr;

  return arr.sort((a, b) => {
    const da = parseChatDeadline(a);
    const db = parseChatDeadline(b);

    if (prioritizeWeek) {
      const aw = isDeadlineWithinNextDays(a, 7) ? 0 : 1;
      const bw = isDeadlineWithinNextDays(b, 7) ? 0 : 1;
      if (aw !== bw) return aw - bw;
    }

    if (prioritizeOpen) {
      const ao = isOpenEditalForChat(a) ? 0 : 1;
      const bo = isOpenEditalForChat(b) ? 0 : 1;
      if (ao !== bo) return ao - bo;
    }

    const relevanceDiff = normalizeRelevanceScore(b?.relevance_score) - normalizeRelevanceScore(a?.relevance_score);
    if (relevanceDiff !== 0) return relevanceDiff;

    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
}

function searchEditaisForChat(query) {
  const q = String(query || '').trim();
  if (!q || !Array.isArray(editaisOriginais) || editaisOriginais.length === 0) return [];

  const normalizedQuery = normalizeAssistantQuery(q);
  const keywords = extractChatKeywords(normalizedQuery);
  const wantsClosed = hasAnyChatHint(normalizedQuery, ['encerrado', 'encerrados', 'fechado', 'fechados']);
  const wantsOpen = !wantsClosed && hasAnyChatHint(normalizedQuery, CHAT_OPEN_HINTS);
  const wantsWeek = hasAnyChatHint(normalizedQuery, CHAT_WEEK_HINTS) && hasAnyChatHint(normalizedQuery, CHAT_DEADLINE_HINTS);

  let items = [];

  if (keywords.length) {
    items = editaisOriginais.filter((e) => {
      const hay = [
        e.titulo, e.descricao, e.instituicao, e.estado, e.area,
        ...(Array.isArray(e.tags) ? e.tags : []),
      ]
        .map((x) => normalizeAssistantQuery(String(x || '')))
        .filter(Boolean)
        .join(' ');
      return keywords.some((k) => hay.includes(k));
    });
  } else {
    items = [...editaisOriginais];
  }

  if (wantsOpen) {
    items = items.filter((e) => isOpenEditalForChat(e));
  }

  if (wantsWeek) {
    items = items.filter((e) => isOpenEditalForChat(e) && isDeadlineWithinNextDays(e, 7));
  }

  // Para perguntas amplas (ex: "quais editais estão em aberto"), não depender de texto livre.
  if (!items.length && (wantsOpen || wantsWeek)) {
    items = [...editaisOriginais];
    if (wantsOpen) items = items.filter((e) => isOpenEditalForChat(e));
    if (wantsWeek) items = items.filter((e) => isOpenEditalForChat(e) && isDeadlineWithinNextDays(e, 7));
  }

  const seen = new Set();
  const deduped = [];
  for (const e of sortEditaisForChat(items, { prioritizeOpen: wantsOpen, prioritizeWeek: wantsWeek })) {
    const id = String(e?.id ?? '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push(e);
  }
  return deduped;
}

function extractDistinctiveContextTokens(value, maxItems = 8) {
  return normalizeAssistantQuery(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length >= 4 && !CHAT_QUERY_STOPWORDS.has(token))
    .slice(0, Math.max(1, Number(maxItems || 8)));
}

function isEditalContextExitCommand(question) {
  const normalizedQuery = normalizeAssistantQuery(question);
  if (!normalizedQuery) return false;
  if (normalizedQuery === 'sair' || normalizedQuery === 'voltar') return true;
  if (messageHasAnyPhrase(normalizedQuery, CHAT_EDITAL_EXIT_HINTS)) return true;
  return /^(sair|voltar|fechar edital|encerrar edital|encerrar assunto|fechar assunto)$/.test(normalizedQuery);
}

function resolvePendingEditalContextDecision(question) {
  if (!chatState?.pendingTopicExitConfirmation) return null;

  const normalizedQuery = normalizeAssistantQuery(question);
  if (!normalizedQuery) {
    return {
      action: 'ask_confirmation_repeat',
      notice: 'Voce quer continuar neste edital ou quer sair para buscar outro?',
    };
  }

  if (isEditalContextExitCommand(question) || messageHasAnyPhrase(normalizedQuery, CHAT_EDITAL_CONFIRM_EXIT_HINTS)) {
    chatState = setPendingTopicExitConfirmation(chatState, false);
    persistChatState(chatState);
    return { action: 'exit_only' };
  }

  if (messageHasAnyPhrase(normalizedQuery, CHAT_EDITAL_CONFIRM_STAY_HINTS)) {
    chatState = setPendingTopicExitConfirmation(chatState, false);
    persistChatState(chatState);
    return {
      action: 'stay_ack',
      notice: 'Perfeito, seguimos neste edital. Pode mandar sua pergunta.',
    };
  }

  if (classifyAssistantIntent(question) === 'edital_search') {
    chatState = setPendingTopicExitConfirmation(chatState, false);
    persistChatState(chatState);
    return {
      action: 'exit_to_general',
      notice: buildEditalContextSwitchMessage(question),
    };
  }

  return {
    action: 'ask_confirmation_repeat',
    notice: 'Se quiser sair deste edital, digite "sair". Se quiser continuar nele, digite "continuar".',
  };
}

function findClearlyMentionedDifferentEdital(question, currentEditalId) {
  const normalizedQuery = normalizeAssistantQuery(question);
  if (!normalizedQuery) return null;

  const mentionsSpecificEdital = /(?:^|\s)(edital|chamada)\s+/.test(normalizedQuery);
  if (!mentionsSpecificEdital) return null;

  const candidates = searchEditaisForChat(question);
  if (!Array.isArray(candidates) || !candidates.length) return null;

  for (const candidate of candidates) {
    const candidateId = String(candidate?.id ?? '');
    if (!candidateId || String(currentEditalId) === candidateId) continue;

    const titleTokens = extractDistinctiveContextTokens(candidate?.titulo, 6);
    if (!titleTokens.length) continue;

    const titleMatches = titleTokens.filter((token) => normalizedQuery.includes(token)).length;
    const institutionTokens = extractDistinctiveContextTokens(candidate?.instituicao, 4);
    const institutionMatches = institutionTokens.filter((token) => normalizedQuery.includes(token)).length;
    const requiredTitleMatches = titleTokens.length >= 3 ? 2 : 1;

    if (titleMatches >= requiredTitleMatches || (titleMatches >= 1 && institutionMatches >= 1)) {
      return candidate;
    }
  }

  return null;
}

function analyzeEditalContextTransition(question, currentEditalId) {
  const normalizedQuery = normalizeAssistantQuery(question);
  if (!normalizedQuery || !currentEditalId) {
    return { action: 'stay' };
  }

  if (isEditalContextExitCommand(question)) {
    return { action: 'exit_only' };
  }

  const mentionedOtherEdital = findClearlyMentionedDifferentEdital(question, currentEditalId);
  if (mentionedOtherEdital) {
    return {
      action: 'switch_to_edital',
      edital: mentionedOtherEdital,
      notice: buildEditalContextSwitchMessage(mentionedOtherEdital?.titulo || 'outro edital'),
    };
  }

  const intent = classifyAssistantIntent(question);
  if (intent === 'edital_search') {
    return {
      action: 'exit_to_general',
      notice: buildEditalContextSwitchMessage(question),
    };
  }

  const hasSwitchHint = messageHasAnyPhrase(normalizedQuery, CHAT_EDITAL_SWITCH_HINTS);
  if (hasSwitchHint) {
    const keywords = extractChatKeywords(normalizedQuery);
    const hasConcreteCriteria =
      hasSpecificChatKeywords(keywords) ||
      hasAnyChatHint(normalizedQuery, CHAT_OPEN_HINTS) ||
      hasAnyChatHint(normalizedQuery, CHAT_DEADLINE_HINTS) ||
      hasAnyChatHint(normalizedQuery, CHAT_WEEK_HINTS);

    if (hasConcreteCriteria || /buscar|listar|mostre|quero ver/.test(normalizedQuery)) {
      return {
        action: 'exit_to_general',
        notice: buildEditalContextSwitchMessage(question),
      };
    }

    return {
      action: 'ask_confirmation',
      notice: 'Voce quer continuar falando deste edital ou quer sair para buscar outro?',
    };
  }

  if (intent === 'out_of_scope') {
    const hasClearOutsideSignal = messageHasAnyPhrase(normalizedQuery, [
      'perfil',
      'conta',
      'preferencia',
      'preferencias',
      'notificacao',
      'suporte',
      'dashboard',
      'painel',
    ]);

    if (hasClearOutsideSignal) {
      return {
        action: 'exit_to_general',
        notice: buildEditalContextSwitchMessage(question),
      };
    }
  }

  if (intent === 'unknown' && messageHasAnyPhrase(normalizedQuery, ['outro tema', 'outro assunto', 'mudar assunto'])) {
    return {
      action: 'ask_confirmation',
      notice: 'Voce quer continuar falando deste edital ou quer sair para buscar outro?',
    };
  }

  return { action: 'stay' };
}

function truncateText(text, max = 80) {
  const s = String(text || '').replaceAll('\n', ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function normalizeBackendChatOptions(rawOptions) {
  if (!Array.isArray(rawOptions)) return [];

  const out = [];
  const seen = new Set();

  rawOptions.forEach((opt) => {
    if (!opt || typeof opt !== 'object') return;
    const explicitAction = String(opt.action || '').trim();
    const explicitTitle = String(opt.title || '').trim();
    if (explicitAction && explicitTitle) {
      const explicitKey = `${explicitAction}::${explicitTitle.toLowerCase()}`;
      if (seen.has(explicitKey)) return;
      seen.add(explicitKey);
      out.push({
        action: explicitAction,
        id: opt.id ?? opt.edital_id ?? opt.editalId ?? null,
        query: opt.query ? String(opt.query) : null,
        title: explicitTitle,
        meta: String(opt.meta || '').trim() || null,
        payload: (opt.payload && typeof opt.payload === 'object') ? opt.payload : null,
      });
      return;
    }

    const id = opt.id ?? opt.edital_id ?? opt.editalId ?? null;
    if (id === null || id === undefined) return;

    const idKey = String(id);
    if (seen.has(idKey)) return;
    seen.add(idKey);

    const title = String(opt.titulo || opt.title || opt.nome || 'Sem título').trim();
    const instituicao = String(opt.instituicao || opt.instituição || '').trim();
    const estado = String(opt.estado || '').trim();
    const dataFechamento = opt.data_fechamento || opt.prazo || opt.deadline || null;
    const isHighlighted = !!opt.is_highlighted;
    const prazoLabel = dataFechamento ? formatChatDate(dataFechamento) : '';

    const metaParts = [];
    if (isHighlighted) metaParts.push('Em destaque');
    if (instituicao) metaParts.push(instituicao);
    if (estado) metaParts.push(estado);
    if (prazoLabel) metaParts.push(`Até ${prazoLabel}`);

    out.push({
      action: 'open_edital',
      id,
      title,
      meta: metaParts.length ? metaParts.join(' • ') : null,
    });
  });

  return out;
}

function attachEditaisOptions(msgEl, query, rawOptions = null, rawStructuredPayload = null) {
  if (!msgEl) return;

  const structuredPayload = normalizeAssistantSearchPayload(rawStructuredPayload);
  const fromBackend = normalizeBackendChatOptions(rawOptions);
  const hasBackendOptions = fromBackend.length > 0;
  let options = [];

  if (hasBackendOptions) {
    const panelPayload = structuredPayload || buildAssistantPayloadFromQuery(query);
    const panelTotal = Number(panelPayload?.total) > 0 ? Number(panelPayload.total) : fromBackend.length;
    options = fromBackend.slice(0, 6);
    const hasViewAllAction = options.some((opt) => String(opt?.action || '').trim() === 'view_all');
    if (panelTotal > options.length && !hasViewAllAction) {
      options.push({
        action: 'view_all',
        query,
        title: `Ver todos no painel (${panelTotal})`,
        meta: 'Aplicar filtros da IA no Dashboard',
        payload: panelPayload,
      });
    }
    if (panelPayload && panelTotal > 5) {
      const hasTopUrgent = options.some((opt) => String(opt?.title || '').toLowerCase().includes('mais urgentes'));
      const topIds = Array.isArray(panelPayload?.result_ids) ? panelPayload.result_ids.slice(0, 5) : [];
      if (!hasTopUrgent && topIds.length > 0) {
        options.push({
          action: 'view_all',
          query,
          title: 'Mostrar os 5 mais urgentes',
          meta: 'Recorte rápido por prazo',
          payload: {
            ...panelPayload,
            total: topIds.length,
            result_ids: topIds,
          },
        });
      }
    }
  } else {
    const all = searchEditaisForChat(query);
    if (!all.length) return;
    const panelPayload = structuredPayload || buildAssistantPayloadFromQuery(query, all);
    const panelTotal = Number(panelPayload?.total) > 0 ? Number(panelPayload.total) : all.length;

    const top = all.slice(0, 5);
    options = top.map((e) => {
      const metaParts = [];
      if (e?.is_highlighted) metaParts.push('Em destaque');
      if (e.instituicao) metaParts.push(e.instituicao);
      if (e.estado) metaParts.push(e.estado);
      if (e.data_fechamento) metaParts.push(`Até ${formatChatDate(e.data_fechamento)}`);
      const meta = metaParts.join(' • ');

      return {
        action: 'open_edital',
        id: e.id,
        title: e.titulo || 'Sem título',
        meta: meta || null,
      };
    });

    if (all.length > top.length) {
      options.push({
        action: 'view_all',
        query,
        title: `Ver todos no painel (${panelTotal})`,
        meta: 'Aplicar filtros da IA no Dashboard',
        payload: panelPayload,
      });
    }
  }

  const hasAskNew = options.some((opt) => String(opt?.action || '').trim() === 'ask_new');
  if (!hasAskNew) {
    options.push({
      action: 'ask_new',
      title: 'Buscar outro tema',
      meta: 'Trocar a palavra-chave',
    });
  }

  const wrap = document.createElement('div');
  wrap.className = 'chat-options';

  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-option-btn';
    btn.setAttribute('data-action', opt.action);

    if (opt.id != null) btn.setAttribute('data-edital-id', String(opt.id));
    if (opt.query) btn.setAttribute('data-query', String(opt.query));
    if (opt.payload && typeof opt.payload === 'object') btn._chatPayload = opt.payload;

    const title = truncateText(opt.title, 70);
    const meta = opt.meta ? truncateText(opt.meta, 92) : '';

    btn.innerHTML = `
      <div class="chat-opt-title">${escapeHtml(title)}</div>
      ${meta ? `<div class="chat-opt-meta">${escapeHtml(meta)}</div>` : ''}
    `.trim();

    wrap.appendChild(btn);
  }

  msgEl.appendChild(wrap);
  scrollToBottom();
}


function resolveBackendSearchDecision({ data, question, backendOptions, backendStructuredPayload }) {
  const normalizedIntent = normalizeAssistantIntent(
    data?.intent || backendStructuredPayload?.intent || ''
  );
  const localIntent = classifyAssistantIntent(question);

  const explicitShouldSearch = (typeof data?.should_search === 'boolean') ? data.should_search : null;
  let shouldSearch = explicitShouldSearch;
  const hasBackendOptions = Array.isArray(backendOptions) && backendOptions.length > 0;
  const payloadTotal = Number(backendStructuredPayload?.total || 0);
  const payloadIds = Array.isArray(backendStructuredPayload?.result_ids) ? backendStructuredPayload.result_ids : [];
  const payloadHasData = payloadTotal > 0 || payloadIds.length > 0;

  if (shouldSearch === null) {
    if (normalizedIntent && normalizedIntent !== 'unknown') {
      shouldSearch = normalizedIntent === 'edital_search';
    } else if (hasBackendOptions) {
      shouldSearch = true;
    } else if (payloadHasData) {
      shouldSearch = true;
    } else {
      shouldSearch = localIntent === 'edital_search';
    }
  }

  const finalIntent = normalizedIntent && normalizedIntent !== 'unknown' ? normalizedIntent : localIntent;
  if (finalIntent !== 'edital_search') {
    shouldSearch = false;
  }

  return {
    intent: finalIntent,
    shouldSearch: Boolean(shouldSearch),
  };
}

function setActiveChatRequestController(controller) {
  chatRequestTracker.setActiveController(controller);
}

function clearActiveChatRequestController(controller) {
  chatRequestTracker.clearActiveController(controller);
}

function isChatStreamActive() {
  return chatRequestTracker.hasActiveController();
}

function abortActiveChatRequest(reason = 'manual') {
  const aborted = chatRequestTracker.abortActiveController();
  if (aborted) {
    console.info('[CHAT][stream] requisicao abortada pelo cliente', { reason });
  }
  return aborted;
}

async function readResponsePayloadFallback(res) {
  if (!res) return null;
  const contentType = String(res.headers?.get('content-type') || '').toLowerCase();
  let rawText = '';
  try {
    rawText = await res.text();
  } catch (_) {
    rawText = '';
  }

  if (!rawText) return null;
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawText);
    } catch (_) {
      return { _rawText: rawText };
    }
  }

  try {
    return JSON.parse(rawText);
  } catch (_) {
    return { _rawText: rawText };
  }
}

async function handleChatSend(options = {}) {
  if (botIsTyping) return;
  if (!hasPersonalizationConsent()) {
    showToast('Ative cookies de personalização em Perfil > Privacidade > Cookies para usar o chat.', 'info');
    return;
  }

  const question = (chatInput?.value || '').trim();
  if (!question) return;

  const interactionSource = String(options?.source || 'message_send').trim() || 'message_send';
  markFirstChatInteraction(interactionSource, { animateSuggestions: true });

  chatInput.value = '';
  addMessage(question, 'user');
  chatState = appendConversationTurn(chatState, 'user', question);
  persistChatState(chatState);

  const activeContext = getActiveEditalContext();
  if (activeContext?.editalId) {
    const detection = detectTopicTransition({
      message: question,
      state: chatState,
      topicThresholds: chatState?.topicThresholds,
    });
    chatState = updateTopicDetection(chatState, detection, 'edital_context_chat');
    console.info('[CHAT][topic-detector][frontend]', {
      context: { type: chatState?.activeContextType, entityId: chatState?.activeEntityId },
      userMessage: String(question || '').slice(0, 180),
      decision: detection?.decision,
      confidence: Number(detection?.confidence || 0).toFixed(2),
      reason: detection?.reason,
    });

    if (chatState?.pendingTopicExitConfirmation && isExplicitStayCommand(question)) {
      chatState = setPendingTopicExitConfirmation(chatState, false);
      persistChatState(chatState);
      const stayNotice = 'Perfeito, seguimos no edital atual. Pode mandar sua pergunta.';
      addMessage(stayNotice, 'bot');
      chatState = appendConversationTurn(chatState, 'assistant', stayNotice);
      persistChatState(chatState);
      return;
    }

    if (detection.decision === 'ambiguous') {
      chatState = setPendingTopicExitConfirmation(chatState, true);
      persistChatState(chatState);
      const notice = buildTopicDisambiguationNotice(chatState);
      addMessage(notice, 'bot');
      chatState = appendConversationTurn(chatState, 'assistant', notice);
      persistChatState(chatState);
      return;
    }

    if (detection.decision === 'switch_topic' && detection.confidence >= Number(detection?.thresholds?.autoSwitch || 0.9)) {
      clearActiveEditalContext({ clearAssistantContext: true });
      const isExplicitExit = detection.reason === 'explicit_exit';
      const switchNotice = isExplicitExit ? buildEditalContextExitMessage() : buildEditalContextSwitchMessage(question);
      addMessage(switchNotice, 'bot');
      chatState = appendConversationTurn(chatState, 'assistant', switchNotice);
      persistChatState(chatState);
      if (isExplicitExit) {
        return;
      }
    } else {
      chatState = setPendingTopicExitConfirmation(chatState, false);
      persistChatState(chatState);
    }
  }

  const contextualEditalId = getActiveEditalContext()?.editalId ?? null;
  if (!contextualEditalId) {
    setChatBusy(true);
    const typingMsg = addMessage('digitando...', 'bot', null, { isTyping: true });

    try {
      const dashboardContext = buildDashboardIntelligenceContext();
      const { res, data } = await apiFetchJson('/chat/dashboard-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: question,
          question,
          state: chatState,
          dashboard_context: dashboardContext,
        }),
      });

      if (!res.ok) throw new Error(`dashboard-intelligence-${res.status}`);

      const hasBackendState = Boolean(data?.state && typeof data.state === 'object');
      if (hasBackendState) {
        chatState = ensureChatSessionState(data.state);
        persistChatState(chatState);
        updateChatHeader();
      }

      const plan = normalizeDashboardPlanFromBackend(data);
      if (!plan) throw new Error('invalid-dashboard-plan');

      const backendReply = normalizeConciseBotText(
        data?.reply || plan?.suggested_reply || 'Nao consegui responder com os dados estruturados do dashboard.'
      );
      const finalReply = normalizeConciseBotText(plan?.suggested_reply || backendReply);
      setMessageText(typingMsg, finalReply);

      if (!hasBackendState) {
        chatState = appendConversationTurn(chatState, 'assistant', finalReply);
      }
      persistChatState(chatState);

      const planPayload = dashboardPlanToLegacySearchPayload(plan);
      const normalizedPlanPayload = normalizeAssistantSearchPayload(planPayload);
      if (normalizedPlanPayload) {
        rememberAssistantResultSetFromPayload(normalizedPlanPayload, {
          question,
          intent: plan.intent || normalizedPlanPayload.intent || '',
        });
      }

      if (plan?.ui_action?.auto_apply && normalizedPlanPayload) {
        applyAssistantPayloadToDashboard(normalizedPlanPayload, { fallbackQuery: question });
      }

      const optionSeed = buildDashboardPlanOptions(plan, question, Array.isArray(data?.options) ? data.options : []);
      if (Array.isArray(optionSeed) && optionSeed.length) {
        attachEditaisOptions(
          typingMsg,
          question,
          optionSeed,
          normalizedPlanPayload || planPayload || null
        );
      }
    } catch (err) {
      console.warn('[CHAT][dashboard-intelligence] fallback local ativado', err);
      const semanticOutcome = runLocalDashboardSemanticAssistant(question);
      const semanticReply = normalizeConciseBotText(
        semanticOutcome?.reply || 'Nao consegui responder com os dados estruturados do dashboard.'
      );
      setMessageText(typingMsg, semanticReply);
      chatState = appendConversationTurn(chatState, 'assistant', semanticReply);
      persistChatState(chatState);

      const semanticPayload = normalizeAssistantSearchPayload(semanticOutcome?.structuredPayload || null);
      if (semanticPayload) {
        rememberAssistantResultSetFromPayload(semanticPayload, {
          question,
          intent: semanticOutcome?.intent || semanticPayload?.intent || '',
        });
      }

      if (Array.isArray(semanticOutcome?.options) && semanticOutcome.options.length) {
        attachEditaisOptions(
          typingMsg,
          question,
          semanticOutcome.options,
          semanticPayload || semanticOutcome?.structuredPayload || null
        );
      }
    } finally {
      setChatBusy(false);
      scrollToBottom();
    }
    return;
  }

  setChatBusy(true, { streaming: true });
  const typingMsg = addMessage('', 'bot', null, { isTyping: true });
  const streamController = new AbortController();
  setActiveChatRequestController(streamController);
  let streamedText = '';
  let streamedSources = [];
  let streamTopicDetection = null;
  let hasBackendState = false;
  let streamErrorMessage = '';
  let streamDoneReceived = false;

  try {
    const endpoint = `/chat/edital/${encodeURIComponent(contextualEditalId)}/stream`;
    const res = await apiFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ message: question, question, state: chatState }),
      signal: streamController.signal,
    });

    const contentType = String(res.headers?.get('content-type') || '').toLowerCase();
    const isSseResponse = Boolean(res.ok && res.body && contentType.includes('text/event-stream'));

    if (!isSseResponse) {
      const data = await readResponsePayloadFallback(res);

      if (!res.ok) {
        const localOutcome = buildLocalAssistantOutcome(question);
        const fallbackText = localOutcome?.reply || 'O chat está indisponível no momento. Tenta de novo em alguns instantes.';
        setMessageText(typingMsg, fallbackText);
        chatState = appendConversationTurn(chatState, 'assistant', fallbackText);
        persistChatState(chatState);
        return;
      }

      hasBackendState = Boolean(data?.state && typeof data.state === 'object');
      if (Object.prototype.hasOwnProperty.call(data || {}, 'state')) {
        if (data?.state && typeof data.state === 'object') {
          chatState = ensureChatSessionState(data.state);
          persistChatState(chatState);
          updateChatHeader();
        } else {
          clearActiveEditalContext({ clearAssistantContext: true });
        }
      }

      if (data?.switch_to_general) {
        clearActiveEditalContext({ clearAssistantContext: true });
        const switchText = normalizeBotText(
          data?.reply || 'Entendi, saindo do edital atual. Agora voce pode buscar outro tema.'
        );
        setMessageText(typingMsg, switchText);
        if (!hasBackendState) {
          chatState = appendConversationTurn(chatState, 'assistant', switchText);
        }
        persistChatState(chatState);
        return;
      }

      const answer =
        data?.answer ??
        data?.reply ??
        data?.resposta ??
        data?.message ??
        data?.text ??
        data?._rawText ??
        null;
      const rawText = (answer && String(answer).trim())
        ? normalizeBotText(answer)
        : 'Nao consegui responder agora.';
      const extracted = extractEmbeddedSources(rawText);
      const finalText = extracted.text || rawText;
      const finalSources = normalizeSources(data?.sources, extracted.names);
      setMessageText(typingMsg, finalText, finalSources);
      if (!hasBackendState) {
        chatState = appendConversationTurn(chatState, 'assistant', finalText);
      }
      if (data?.topic_detection && typeof data.topic_detection === 'object') {
        chatState = updateTopicDetection(chatState, data.topic_detection);
        console.info('[CHAT][topic-detector][backend]', {
          context: { type: chatState?.activeContextType, entityId: chatState?.activeEntityId },
          userMessage: String(question || '').slice(0, 180),
          decision: data.topic_detection?.decision,
          confidence: Number(data.topic_detection?.confidence || 0).toFixed(2),
          reason: data.topic_detection?.reason,
        });
      }
      persistChatState(chatState);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const sseParseOptions = {
      onInvalidJson(payloadText, err) {
        console.warn('[CHAT][stream] evento SSE invalido', { payloadText, err });
      },
    };

    const applyStreamDelta = (deltaText) => {
      const nextChunk = String(deltaText || '');
      if (!nextChunk) return;
      streamedText += nextChunk;
      setMessageText(typingMsg, streamedText, streamedSources, { keepTyping: true });
      scrollToBottom();
    };

    const handleStreamPayload = (payload) => {
      if (!payload || typeof payload !== 'object') return;
      const type = String(payload.type || '').trim().toLowerCase();
      if (!type || type === 'start') return;

      if (type === 'delta') {
        applyStreamDelta(payload.text || '');
        return;
      }

      if (type === 'sources') {
        const extracted = extractEmbeddedSources(streamedText);
        streamedSources = normalizeSources(payload.sources, extracted.names);
        setMessageText(typingMsg, streamedText, streamedSources, { keepTyping: true });
        scrollToBottom();
        return;
      }

      if (type === 'state') {
        if (payload.state && typeof payload.state === 'object') {
          chatState = ensureChatSessionState(payload.state);
          persistChatState(chatState);
          updateChatHeader();
          hasBackendState = true;
        }
        if (payload.topic_detection && typeof payload.topic_detection === 'object') {
          streamTopicDetection = payload.topic_detection;
          chatState = updateTopicDetection(chatState, payload.topic_detection);
          persistChatState(chatState);
          console.info('[CHAT][topic-detector][backend]', {
            context: { type: chatState?.activeContextType, entityId: chatState?.activeEntityId },
            userMessage: String(question || '').slice(0, 180),
            decision: payload.topic_detection?.decision,
            confidence: Number(payload.topic_detection?.confidence || 0).toFixed(2),
            reason: payload.topic_detection?.reason,
          });
        }
        return;
      }

      if (type === 'error') {
        streamErrorMessage = normalizeBotText(
          payload.message || 'Ocorreu um erro ao consultar a IA. Tente novamente em instantes.'
        );
        return;
      }

      if (type === 'done') {
        streamDoneReceived = true;
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunkText = decoder.decode(value, { stream: true });
      const parsed = readSsePayloadsFromBuffer(buffer, chunkText, sseParseOptions);
      buffer = parsed.remainder;

      for (const payload of parsed.payloads) {
        handleStreamPayload(payload);
        if (streamDoneReceived || streamErrorMessage) break;
      }

      if (streamDoneReceived || streamErrorMessage) break;
    }

    const flushChunk = decoder.decode();
    if (flushChunk) {
      const parsedFlush = readSsePayloadsFromBuffer(buffer, flushChunk, sseParseOptions);
      buffer = parsedFlush.remainder;
      for (const payload of parsedFlush.payloads) {
        handleStreamPayload(payload);
        if (streamDoneReceived || streamErrorMessage) break;
      }
    }

    if (buffer.trim()) {
      const tailPayload = parseSseDataPayload(buffer, sseParseOptions);
      if (tailPayload) {
        handleStreamPayload(tailPayload);
      }
    }

    if (streamErrorMessage) {
      const fallbackText = streamErrorMessage || 'Ocorreu um erro ao consultar a IA. Tente novamente em instantes.';
      setMessageText(typingMsg, fallbackText, streamedSources);
      if (!hasBackendState) {
        chatState = appendConversationTurn(chatState, 'assistant', fallbackText);
        if (streamTopicDetection && typeof streamTopicDetection === 'object') {
          chatState = updateTopicDetection(chatState, streamTopicDetection);
        }
        persistChatState(chatState);
      }
      return;
    }

    const extracted = extractEmbeddedSources(streamedText);
    const fallbackText = normalizeBotText(streamedText) || 'Nao consegui responder agora.';
    const finalText = extracted.text || fallbackText;
    const finalSources = normalizeSources(streamedSources, extracted.names);
    setMessageText(typingMsg, finalText, finalSources);

    if (!hasBackendState) {
      chatState = appendConversationTurn(chatState, 'assistant', finalText);
      if (streamTopicDetection && typeof streamTopicDetection === 'object') {
        chatState = updateTopicDetection(chatState, streamTopicDetection);
      }
      persistChatState(chatState);
    }

  } catch (e) {
    if (e?.name === 'AbortError') {
      console.info('[CHAT][stream] requisicao abortada', e);
      const abortedText = normalizeBotText(streamedText) || 'Conversa interrompida. Voce pode enviar novamente.';
      const extracted = extractEmbeddedSources(abortedText);
      const finalText = extracted.text || abortedText;
      const finalSources = normalizeSources(streamedSources, extracted.names);
      setMessageText(typingMsg, finalText, finalSources);
      if (!hasBackendState) {
        chatState = appendConversationTurn(chatState, 'assistant', finalText);
        persistChatState(chatState);
      }
      return;
    }

    console.error('Erro no chat:', e);
    const localOutcome = buildLocalAssistantOutcome(question);
    const fallbackText = localOutcome?.reply || 'Deu ruim aqui do meu lado. Tenta de novo em alguns segundos.';
    setMessageText(typingMsg, fallbackText);
    chatState = appendConversationTurn(chatState, 'assistant', fallbackText);
    persistChatState(chatState);
  } finally {
    clearActiveChatRequestController(streamController);
    setChatBusy(false);
    scrollToBottom();
  }
}

function setChatBusy(isBusy, options = {}) {
  const busy = Boolean(isBusy);
  const streaming = busy && Boolean(options?.streaming);

  botIsTyping = busy;

  if (chatInput) chatInput.disabled = busy;
  if (sendButton) {
    sendButton.disabled = busy && !streaming;
    sendButton.classList.toggle('is-stop-mode', streaming);
    sendButton.dataset.mode = streaming ? 'stop' : 'send';
    sendButton.setAttribute('aria-label', streaming ? 'Parar geração' : 'Enviar');
    sendButton.title = streaming ? 'Parar geração' : 'Enviar';
    const nextIcon = streaming ? CHAT_SEND_BUTTON_STOP_HTML : CHAT_SEND_BUTTON_SEND_HTML;
    if (sendButton.innerHTML !== nextIcon) {
      sendButton.innerHTML = nextIcon;
    }
  }
}



// =========================
// SANITIZE
// =========================
function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('`', '');
}
