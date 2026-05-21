/* =========================================================
   Athos / Atimus — Editais (UX/UI novo + filtros + paginação)
   ========================================================= */

import { renderEditais } from './render.js?v=20260516.1';
import {
  parseAnyDateToTime,
  buildSearchQueryContext,
  matchesDateIntent,
} from './search-date-utils.js?v=20260510.2';
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
  setLatestAssistantConversationTurn,
  setPendingTopicExitConfirmation,
  updateTopicDetection,
} from './chat-session-state.js?v=20260426.1';
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
import { createSingleFlight } from './bootstrap-utils.js?v=20260415.1';
import { createAbortableRequestTracker } from './chat-stream-controller.js?v=20260425.1';
import {
  applyChatStreamPayload,
  readSsePayloadsFromBuffer,
} from './chat-stream-sse.js?v=20260425.1';
import {
  buildSourcesDetails,
  normalizeSources,
} from './chat-sources.js?v=20260517.1';
import {
  isConceptualOrAdvisoryQuestion,
  isDocumentalSemanticQuestion,
} from './chat-routing-detector.js?v=20260429.1';
import { groupAttachmentsForDisplay } from './attachments_display.js?v=20260521.1';

// =========================
// CONFIGURAÇÕES & SEGURANÇA
// =========================
import {
  API_BASE,
  LOGIN_URL,
  apiFetch,
  bootstrapAuthFromUrl,
  buildLoginUrlWithNext,
  getStoredToken,
  apiFetchJson,
  isPasswordChangeRequiredPayload,
  isPasswordChangeRequiredResponse,
  resolvePasswordChangeRedirectTarget,
  resolveAuthFailureRedirectTarget,
  redirectWithAuthGuard,
} from './auth.js?v=20260512.1';
import { runDashboardBootstrapFlow } from './bootstrap-flows.js?v=20260512.1';
import { readAuthHandoff } from './auth-handoff.js?v=20260422.1';

console.info('[Athos][main.js] versão Athos interesses + stats filtrados 20260510.5 carregada');

const APP_BASE_URL = new URL('../', import.meta.url);
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,255}$/;

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
let fuseInstance = null;
let interessesSet = new Set();
let onlyInteresses = false;
let clientNotifications = [];

const PAGE_SIZE = 12;
const ALL_EDITAIS_BACKGROUND_LIMIT = 2000;
const ALL_EDITAIS_BACKGROUND_DELAY_MS = 650;
const FAST_CARDS_CACHE_KEY = 'athos:editais:first-page:v20260510.4';
const FAST_CARDS_CACHE_TTL_MS = 10 * 60 * 1000;
const RELEVANCE_REFRESH_DELAY_MS = 350;
let currentPage = 1;
let lastFiltered = [];
let kpiFilter = 'all';
let assistantPanelContext = null;
let assistantSemanticMemory = createDashboardMemoryState();
let serverPageMeta = {};
let bootstrapInitPromise = null;
let uiEventsBound = false;
let relevanceRefreshTimerId = null;
let relevanceRefreshInProgress = false;
let allEditaisHydrationTimerId = null;
let allEditaisHydrationInProgress = false;
let allEditaisHydrationSignature = '';
let lastFastCardsRequestOptions = null;
const loadEditaisSingleFlight = createSingleFlight(() => loadEditais());
const loadFavoritosSingleFlight = createSingleFlight(() => loadFavoritos());
const loadInteressesSingleFlight = createSingleFlight(() => loadInteresses());
const loadClientNotificationsSingleFlight = createSingleFlight(() => loadClientNotifications());

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
const statRecomendados = document.getElementById('statRecomendados');
const statChipTotal = document.getElementById('statChipTotal');
const statChipAbertos = document.getElementById('statChipAbertos');
const statChipFechados = document.getElementById('statChipFechados');
const statChipRecomendados = document.getElementById('statChipRecomendados');

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
const interestToggleBtn = document.getElementById('interestToggleBtn');
const interestBadge = document.getElementById('interestBadge');
const clientNotificationMenu = document.getElementById('clientNotificationMenu');
const clientNotificationBtn = document.getElementById('clientNotificationBtn');
const clientNotificationBadge = document.getElementById('clientNotificationBadge');
const clientNotificationDropdown = document.getElementById('clientNotificationDropdown');
const clientNotificationList = document.getElementById('clientNotificationList');
const clientNotificationRefreshBtn = document.getElementById('clientNotificationRefreshBtn');

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
const chatRequestTracker = createAbortableRequestTracker();
let chatState = createChatSessionState();
let chatQuickPromptsTransitionCleanup = null;
let activeLegacyAssistantLoading = null;
let pendingDashboardOptionsRestores = [];

function persistChatState(nextState = chatState) {
  chatState = saveChatSessionState(sanitizeChatStateAssistantReplies(ensureChatSessionState(nextState)));
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
    const msg = addMessage(entry?.text || '', sender, entry?.ui?.type === 'sources' ? entry.ui.sources : null);
    if (sender === 'bot') restoreChatMessageUi(msg, entry?.ui);
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

  bootstrapInitPromise = runDashboardBootstrapFlow({
    bootstrapAuthFromUrl,
    bootstrapChatSessionState,
    bootstrapTheme: () => window.AthosTheme?.bootstrap?.(),
    getStoredToken,
    readAuthHandoff,
    checkAuth,
    onAuthConfirmed: (confirmedMe) => {
      hydrateSidebarUser(confirmedMe);
    },
    onAuthConfirmationError: (error) => {
      console.warn('Falha na confirmação de autenticação em background:', error);
    },
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
    onEditaisReady: async () => {
      await Promise.allSettled([loadInteressesSingleFlight(), loadClientNotificationsSingleFlight()]);
      applyInteressesToLoadedEditais();
      hydrateDashboardAfterEditaisLoad({ resetPage: true });
    },
    onDeepLinkReady: openDeepLinkedEditalFromUrl,
    onFavoritosReady: ({ editaisReady }) => {
      applyFavoritosToLoadedEditais();
      if (editaisReady) {
        applyFiltersAndRender({ resetPage: false });
      }
    },
    onFavoritosError: () => {
      applyFavoritosToLoadedEditais();
    },
  }).catch((err) => {
    console.error('Falha inesperada ao inicializar a aplicação:', err);
    bootstrapInitPromise = null;
    markAppReady();
    return null;
  });

  return bootstrapInitPromise;
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
    if (target) openModal(target);
  }
}

function hasPersonalizedRelevance(items) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.some((item) => (
    normalizeRelevanceScore(item?.relevance_score) > 0 ||
    item?.is_highlighted ||
    ['perfect', 'high', 'medium'].includes(String(item?.relevance_level || '').trim())
  ));
}

// =========================
// AUTH
// =========================
async function checkAuth() {
  try {
    const { res, data } = await apiFetchJson('/cliente/me?minimal=1', { method: 'GET' });
    const passwordFallback = buildLoginUrlWithNext();

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

    if (window.AthosTheme?.setPreference && data?.themePreference) {
      const nextTheme = window.AthosTheme.resolveProfilePreference
        ? window.AthosTheme.resolveProfilePreference(data.themePreference)
        : data.themePreference;
      window.AthosTheme.setPreference(nextTheme);
    }

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
    stopLegacyAssistantLoading(activeLegacyAssistantLoading);
    chatRequestTracker.abortActiveController();
    setChatBusy(false);
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

function clearAllFilters({ keepSearch = false, keepFavorites = false, keepInterests = false, rerender = true } = {}) {
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
  if (!keepInterests && onlyInteresses) onlyInteresses = false;
  syncSavedToggleUI();
  syncInterestToggleUI();
  setSearchVisualState();
  updateFilterActionsState();
  if (rerender) applyFiltersAndRender({ resetPage: true });
}

function syncKpiButtons() {
  const rows = [
    { btn: statChipTotal, key: 'all' },
    { btn: statChipAbertos, key: 'abertos' },
    { btn: statChipFechados, key: 'fechados' },
    { btn: statChipRecomendados, key: 'recomendados' },
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

  if (onlyInteresses) {
    chips.push(makeFilterChip('Somente interesses', () => {
      onlyInteresses = false;
      syncInterestToggleUI();
      applyFiltersAndRender({ resetPage: true });
    }, 'chip-favorites'));
  }

  if (kpiFilter !== 'all') {
    const kpiLabel = kpiFilter === 'abertos'
      ? 'KPI: Abertos'
      : (kpiFilter === 'fechados' ? 'KPI: Encerrados' : 'KPI: 100% aderentes');
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
  const perfectCount = Array.isArray(lastFiltered)
    ? lastFiltered.filter((e) => e?.relevance_level === 'perfect' || e?.is_highlighted).length
    : 0;
  const highCount = Array.isArray(lastFiltered)
    ? lastFiltered.filter((e) => e?.relevance_level === 'high').length
    : 0;
  const mediumCount = Array.isArray(lastFiltered)
    ? lastFiltered.filter((e) => e?.relevance_level === 'medium').length
    : 0;
  const hasPersonalizedSignals = perfectCount > 0 ||
    highCount > 0 ||
    mediumCount > 0 ||
    (Array.isArray(lastFiltered) ? hasPersonalizedRelevance(lastFiltered) : false);
  const hasProfileRecommendations = perfectCount > 0;

  let text = '';
  if (relevanceRefreshInProgress && total > 0 && !hasSearch && !hasFilters && !onlyFavoritos && !onlyInteresses && kpiFilter === 'all') {
    text = 'Editais carregados. Calculando as melhores opções para o seu perfil...';
  } else if (total === 0 && onlyFavoritos && favoritosSet.size === 0) {
    text = 'Você ainda não salvou editais. Clique na estrela para montar sua lista.';
  } else if (total === 0 && onlyFavoritos) {
    text = 'Nenhum edital salvo corresponde aos filtros atuais.';
  } else if (total === 0 && onlyInteresses && interessesSet.size === 0) {
    text = 'Você ainda não enviou interesse em nenhum edital. Clique em “Tenho interesse” para montar sua lista.';
  } else if (total === 0 && onlyInteresses) {
    text = 'Nenhum edital com interesse enviado corresponde aos filtros atuais.';
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
    !onlyInteresses &&
    kpiFilter === 'all'
  ) {
    text = `Com base no seu perfil, ${perfectCount} ${perfectCount === 1 ? 'edital 100% aderente está' : 'editais 100% aderentes estão'} em destaque.`;
  } else if (
    total > 0 &&
    !hasProfileRecommendations &&
    (hasPersonalizedSignals || highCount === 0) &&
    !hasSearch &&
    !hasFilters &&
    !onlyFavoritos &&
    !onlyInteresses &&
    kpiFilter === 'all'
  ) {
    text = highCount > 0
      ? 'Encontramos editais com alta aderência ao seu perfil. Nenhum atingiu 100% por enquanto.'
      : 'No momento, não há edital 100% aderente ao seu perfil. Complete seu perfil para melhorar as recomendações.';
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

    // Mantém o estado atual quando os filtros são regenerados em background.
    // Antes, cada hidratação chamava esta função de novo, recolhia os grupos e
    // adicionava outro listener no mesmo botão. Resultado: um clique abria e o
    // listener duplicado fechava logo em seguida, dando a sensação de precisar
    // clicar duas vezes. Aqui a vinculação vira idempotente.
    if (!group.dataset.accordionInitialized) {
      setFilterGroupExpanded(group, false, { animate: false });
      group.dataset.accordionInitialized = 'true';
    } else {
      const isExpanded = btn.getAttribute('aria-expanded') === 'true';
      group.classList.toggle('is-collapsed', !isExpanded);
      body.hidden = !isExpanded;
      body.setAttribute('aria-hidden', isExpanded ? 'false' : 'true');
      body.toggleAttribute('inert', !isExpanded);
    }

    if (!btn.dataset.accordionClickBound) {
      btn.dataset.accordionClickBound = 'true';
      btn.addEventListener('click', () => {
        const isExpanded = btn.getAttribute('aria-expanded') === 'true';
        setFilterGroupExpanded(group, !isExpanded, { animate: true });
      });
    }

    if (!btn.dataset.accordionKeyboardBound) {
      btn.dataset.accordionKeyboardBound = 'true';
      btn.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = (idx + step + groups.length) % groups.length;
        const nextBtn = groups[nextIndex]?.querySelector('[data-filter-toggle]');
        nextBtn?.focus();
      });
    }
  });

  if (!filtersPanel.dataset.filterChangeBound) {
    filtersPanel.dataset.filterChangeBound = 'true';
    filtersPanel.addEventListener('change', (event) => {
      if (event.target?.matches?.('.filter-options input[type=\"checkbox\"]')) {
        updateFilterActionsState();
      }
    });
  }

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


// =========================
// DATA LOAD
// =========================
function buildEditaisRequestPath({
  summary = true,
  page = 1,
  limit = PAGE_SIZE,
  view = 'card',
  includeAttachments = false,
  includeRelevance = false,
} = {}) {
  const params = new URLSearchParams();
  params.set('modo', view);
  params.set('include_relevance', includeRelevance ? 'true' : 'false');
  params.set('relevance_mode', 'fast');

  if (summary) {
    params.set('summary', '1');
    params.set('page', String(Math.trunc(Number(page))));
    params.set('limit', String(Math.trunc(Number(limit))));
    params.set('sort_by', normalizeSortValue(sortField || sortSelect?.value || 'prazo'));
    params.set('sort_order', sortDirection || 'asc');
  }

  if (includeAttachments) {
    params.set('include_attachments', 'true');
  }

  return `/editais?${params.toString()}`;
}

function readFastCardsCache(requestOptions = {}) {
  try {
    const raw = sessionStorage.getItem(FAST_CARDS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const savedAt = Number(parsed?.saved_at || 0);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > FAST_CARDS_CACHE_TTL_MS) {
      sessionStorage.removeItem(FAST_CARDS_CACHE_KEY);
      return null;
    }
    const signature = JSON.stringify({
      page: Number(requestOptions.page || 1),
      limit: Number(requestOptions.limit || PAGE_SIZE),
      view: String(requestOptions.view || 'card'),
    });
    if (parsed?.signature !== signature) return null;
    return parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload : null;
  } catch (_) {
    return null;
  }
}

function writeFastCardsCache(requestOptions = {}, payload) {
  try {
    if (!payload) return;
    const signature = JSON.stringify({
      page: Number(requestOptions.page || 1),
      limit: Number(requestOptions.limit || PAGE_SIZE),
      view: String(requestOptions.view || 'card'),
    });
    sessionStorage.setItem(FAST_CARDS_CACHE_KEY, JSON.stringify({
      saved_at: Date.now(),
      signature,
      payload,
    }));
  } catch (_) {}
}

function setResultsHintMessage(message) {
  if (!resultsStateHint) return;
  const text = String(message || '').trim();
  if (!text) {
    resultsStateHint.hidden = true;
    resultsStateHint.textContent = '';
    return;
  }
  resultsStateHint.hidden = false;
  resultsStateHint.textContent = text;
}

function hydrateDashboardAfterEditaisLoad({ resetPage = true } = {}) {
  applyFavoritosToLoadedEditais();
  applyInteressesToLoadedEditais();
  if (hasPersonalizedRelevance(editaisOriginais)) {
    setSortField('relevancia', { resetDirection: true });
  }
  buildFuseIndex();
  generateDynamicFilters();
  setupFilterGroupsAccordion();
  flushPendingDashboardOptionsRestores();
  applyFiltersAndRender({ resetPage });
}

function unpackEditaisResponsePayload(data) {
  const rawList =
    Array.isArray(data) ? data :
    (Array.isArray(data?.items) ? data.items :
    (Array.isArray(data?.editais) ? data.editais :
    (Array.isArray(data?.data) ? data.data : [])));
  return {
    rawList,
    meta: Array.isArray(data) ? {} : normalizeServerPageMeta(data),
  };
}

function mergeRelevancePayloadIntoLoadedEditais(relevanceItems = []) {
  if (!Array.isArray(relevanceItems) || !relevanceItems.length || !Array.isArray(editaisOriginais)) return false;
  const byId = new Map(relevanceItems.map((item) => [String(item?.id), item]).filter(([id]) => id && id !== 'undefined'));
  let changed = false;

  editaisOriginais = editaisOriginais.map((edital) => {
    const incoming = byId.get(String(edital?.id));
    if (!incoming) return edital;
    const normalized = normalizeEdital(incoming);
    if (!normalized) return edital;
    changed = true;
    return {
      ...edital,
      relevance_score: normalized.relevance_score,
      relevance_level: normalized.relevance_level,
      is_highlighted: normalized.is_highlighted,
      recommendation_label: normalized.recommendation_label,
      relevance_reasons: normalized.relevance_reasons,
      relevance_warnings: normalized.relevance_warnings,
      missing_profile_fields: normalized.missing_profile_fields,
      matched_criteria: normalized.matched_criteria,
      blockers: normalized.blockers,
    };
  });

  return changed;
}


function getFastCardsRequestSignature(requestOptions = {}) {
  return JSON.stringify({
    view: String(requestOptions.view || 'card'),
    sort: normalizeSortValue(sortField || sortSelect?.value || 'prazo'),
    direction: sortDirection || 'asc',
  });
}

function mergeSummaryPayloadIntoLoadedEditais(rawList = [], { replace = false } = {}) {
  const incoming = (Array.isArray(rawList) ? rawList : [])
    .map(normalizeEdital)
    .filter(Boolean);
  if (!incoming.length) return false;

  const currentById = new Map((Array.isArray(editaisOriginais) ? editaisOriginais : [])
    .map((item) => [String(item?.id), item])
    .filter(([id]) => id && id !== 'undefined'));

  const mergedById = replace ? new Map() : new Map(currentById);
  for (const next of incoming) {
    const id = String(next?.id);
    if (!id || id === 'undefined') continue;
    const prev = currentById.get(id);
    mergedById.set(id, {
      ...(prev || {}),
      ...next,
      is_favorite: prev?.is_favorite ?? next.is_favorite,
      has_interest: prev?.has_interest ?? next.has_interest,
      relevance_score: prev?.relevance_score || next.relevance_score,
      relevance_level: prev?.relevance_level && prev.relevance_level !== 'not_recommended' ? prev.relevance_level : next.relevance_level,
      is_highlighted: prev?.is_highlighted || next.is_highlighted,
      recommendation_label: prev?.recommendation_label || next.recommendation_label,
      relevance_reasons: prev?.relevance_reasons?.length ? prev.relevance_reasons : next.relevance_reasons,
      relevance_warnings: prev?.relevance_warnings?.length ? prev.relevance_warnings : next.relevance_warnings,
      missing_profile_fields: prev?.missing_profile_fields?.length ? prev.missing_profile_fields : next.missing_profile_fields,
      matched_criteria: Object.keys(prev?.matched_criteria || {}).length ? prev.matched_criteria : next.matched_criteria,
      blockers: prev?.blockers?.length ? prev.blockers : next.blockers,
    });
  }

  const before = Array.isArray(editaisOriginais) ? editaisOriginais.length : 0;
  editaisOriginais = Array.from(mergedById.values());
  return replace || editaisOriginais.length !== before || incoming.length > 0;
}

function scheduleAllEditaisHydration(requestOptions = {}) {
  if (!requestOptions.summary || requestOptions.includeRelevance || Number(requestOptions.page || 1) !== 1) return;
  const expectedTotal = Number(serverPageMeta?.total || 0);
  if (!expectedTotal || expectedTotal <= editaisOriginais.length) return;

  const signature = getFastCardsRequestSignature(requestOptions);
  if (allEditaisHydrationInProgress && allEditaisHydrationSignature === signature) return;
  if (allEditaisHydrationTimerId) clearTimeout(allEditaisHydrationTimerId);

  allEditaisHydrationSignature = signature;
  allEditaisHydrationTimerId = setTimeout(() => {
    allEditaisHydrationTimerId = null;
    hydrateAllEditaisInBackground(requestOptions, signature);
  }, ALL_EDITAIS_BACKGROUND_DELAY_MS);
}

async function hydrateAllEditaisInBackground(requestOptions = {}, signature = '') {
  if (allEditaisHydrationInProgress) return;
  allEditaisHydrationInProgress = true;
  setResultsHintMessage('Primeiros editais carregados. Trazendo o restante em segundo plano...');

  try {
    const expectedTotal = Number(serverPageMeta?.total || 0);
    const backgroundLimit = Math.max(PAGE_SIZE, Math.min(ALL_EDITAIS_BACKGROUND_LIMIT, expectedTotal || ALL_EDITAIS_BACKGROUND_LIMIT));
    const firstRequest = {
      ...requestOptions,
      page: 1,
      limit: backgroundLimit,
      summary: true,
      includeRelevance: false,
      includeAttachments: false,
      view: 'card',
    };

    const { res, data } = await apiFetchJson(buildEditaisRequestPath(firstRequest), { method: 'GET' });
    if (!res.ok) return;

    const { rawList, meta } = unpackEditaisResponsePayload(data);
    if (Object.keys(meta || {}).length) serverPageMeta = { ...serverPageMeta, ...meta };
    let allRaw = Array.isArray(rawList) ? [...rawList] : [];
    const totalPages = Number(meta?.total_pages || 1);

    for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) {
      const { res: pageRes, data: pageData } = await apiFetchJson(buildEditaisRequestPath({ ...firstRequest, page: pageNumber }), { method: 'GET' });
      if (!pageRes.ok) break;
      const { rawList: pageItems } = unpackEditaisResponsePayload(pageData);
      if (!pageItems.length) break;
      allRaw = allRaw.concat(pageItems);
    }

    // Mesmo se o usuário mexer em ordenação/filtros enquanto a hidratação roda,
    // os editais baixados continuam válidos. O estado atual é respeitado no render.
    if (mergeSummaryPayloadIntoLoadedEditais(allRaw, { replace: false })) {
      buildFuseIndex();
      generateDynamicFilters();
      setupFilterGroupsAccordion();
      applyFavoritosToLoadedEditais();
      applyInteressesToLoadedEditais();
      applyFiltersAndRender({ resetPage: false });
      if (hasPersonalizedRelevance(editaisOriginais)) {
        renderResultsStateHint(Array.isArray(lastFiltered) ? lastFiltered.length : 0);
        return;
      }
      setResultsHintMessage('Todos os editais foram carregados. A aderência continua sendo calculada em segundo plano.');
    }
  } catch (error) {
    console.warn('Falha ao carregar todos os editais em background:', error);
  } finally {
    allEditaisHydrationInProgress = false;
  }
}

function scheduleRelevanceRefresh(requestOptions = {}) {
  if (relevanceRefreshTimerId) {
    clearTimeout(relevanceRefreshTimerId);
    relevanceRefreshTimerId = null;
  }

  relevanceRefreshTimerId = setTimeout(async () => {
    relevanceRefreshTimerId = null;
    relevanceRefreshInProgress = true;
    setResultsHintMessage('Editais carregados. Calculando as melhores opções para o seu perfil...');

    try {
      const relevanceRequest = {
        ...requestOptions,
        includeRelevance: true,
        includeAttachments: false,
        view: 'card',
      };
      const { res, data } = await apiFetchJson(buildEditaisRequestPath(relevanceRequest), { method: 'GET' });
      if (!res.ok) return;
      const { rawList, meta } = unpackEditaisResponsePayload(data);
      if (!rawList.length) return;
      if (Object.keys(meta || {}).length) serverPageMeta = meta;
      const changed = mergeRelevancePayloadIntoLoadedEditais(rawList);
      if (changed) {
        if (hasPersonalizedRelevance(editaisOriginais)) {
          setSortField('relevancia', { resetDirection: true });
        }
        buildFuseIndex();
        generateDynamicFilters();
        setupFilterGroupsAccordion();
        applyFiltersAndRender({ resetPage: true });
      }
    } catch (error) {
      console.warn('Falha ao atualizar relevância em background:', error);
    } finally {
      relevanceRefreshInProgress = false;
      renderResultsStateHint(Array.isArray(lastFiltered) ? lastFiltered.length : 0);
    }
  }, RELEVANCE_REFRESH_DELAY_MS);
}

function normalizeServerPageMeta(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const stats = data.stats && typeof data.stats === 'object' ? data.stats : {};
  const optionalNumber = (...values) => {
    for (const value of values) {
      if (value === null || value === undefined || value === '') continue;
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return undefined;
  };
  return {
    page: Number(data.page || 1),
    limit: Number(data.limit || PAGE_SIZE),
    total: Number(data.total || 0),
    total_pages: Number(data.total_pages || 1),
    has_next: Boolean(data.has_next),
    has_prev: Boolean(data.has_prev),
    stats: {
      total: optionalNumber(stats.total, data.total),
      open_total: optionalNumber(stats.open_total, stats.abertos_total, data.open_total, data.abertos_total),
      closed_total: optionalNumber(stats.closed_total, stats.fechados_total, data.closed_total, data.fechados_total),
      recommended_total: optionalNumber(stats.recommended_total, stats.recomendados_total, data.recommended_total, data.recomendados_total),
    },
  };
}

async function loadLegacyFullEditaisFallback() {
  const legacyRequestOptions = {
    summary: false,
    view: 'full',
    includeAttachments: true,
    includeRelevance: false,
  };
  const { res, data } = await apiFetchJson(buildEditaisRequestPath(legacyRequestOptions), { method: 'GET' });
  if (!res.ok) return false;

  const { rawList, meta } = unpackEditaisResponsePayload(data);
  serverPageMeta = meta;
  editaisOriginais = rawList.map(normalizeEdital).filter(Boolean);
  return true;
}

async function loadEditais(options = {}) {
  if (!container) return;

  const requestOptions = {
    summary: options.summary !== false,
    page: options.page || 1,
    limit: options.limit || PAGE_SIZE,
    view: options.view || 'card',
    includeAttachments: Boolean(options.includeAttachments),
    includeRelevance: Boolean(options.includeRelevance),
  };

  if (requestOptions.summary && !requestOptions.includeRelevance) {
    lastFastCardsRequestOptions = { ...requestOptions };
  }

  const cachedPayload = readFastCardsCache(requestOptions);
  let renderedFromCache = false;

  if (cachedPayload) {
    const { rawList, meta } = unpackEditaisResponsePayload(cachedPayload);
    if (rawList.length) {
      serverPageMeta = meta;
      editaisOriginais = rawList.map(normalizeEdital).filter(Boolean);
      hydrateDashboardAfterEditaisLoad({ resetPage: true });
      setResultsHintMessage('Mostrando editais salvos em cache. Atualizando em segundo plano...');
      scheduleAllEditaisHydration(requestOptions);
      renderedFromCache = true;
    }
  }

  if (!renderedFromCache) {
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
  }

  try {
    const { res, data } = await apiFetchJson(buildEditaisRequestPath(requestOptions), { method: 'GET' });

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

      if (requestOptions.summary && !requestOptions.includeRelevance) {
        const legacyLoaded = await loadLegacyFullEditaisFallback();
        if (legacyLoaded) return;
      }

      throw new Error(`Erro na API (${res.status})`);
    }

    const { rawList, meta } = unpackEditaisResponsePayload(data);
    serverPageMeta = meta;
    editaisOriginais = rawList.map(normalizeEdital).filter(Boolean);
    writeFastCardsCache(requestOptions, data);

    if (!requestOptions.includeRelevance) {
      scheduleAllEditaisHydration(requestOptions);
      scheduleRelevanceRefresh(requestOptions);
    }
  } catch (e) {
    console.error('Erro ao carregar editais:', e);
    if (renderedFromCache && editaisOriginais.length) {
      setResultsHintMessage('Não foi possível atualizar agora. Mantive os editais carregados do cache.');
      return;
    }
    container.innerHTML = `
      <section class="results-empty-state is-error">
        <div class="empty-icon"><i class="fas fa-exclamation-triangle" aria-hidden="true"></i></div>
        <h3>Não foi possível carregar os editais</h3>
        <p>${escapeHtml(e?.message || String(e))}</p>
        <button onclick="location.reload()" class="btn btn-primary">Tentar novamente</button>
      </section>
    `;
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
  // Se o endpoint ainda não existir no backend, a UI segue normalmente.
  favoritosSet = new Set();
  try {
    const { res, data } = await apiFetchJson('/cliente/favoritos?ids_only=1', { method: 'GET' });
    if (res.ok) {
      const ids = Array.isArray(data) ? data : (Array.isArray(data?.ids) ? data.ids : []);
      favoritosSet = new Set((ids || []).map(v => String(v)));
    }
  } catch (_) {
    // silencioso de propósito (não quebra a listagem)
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
  const proximoEstado = !estavaSalvo;

  edital.is_favorite = proximoEstado;
  if (proximoEstado) favoritosSet.add(idStr);
  else favoritosSet.delete(idStr);
  syncSavedBadge();

  try {
    await salvarOuRemoverFavorito(editalId, proximoEstado);
    return { ok: true, is_favorite: edital.is_favorite, edital };
  } catch (error) {
    edital.is_favorite = estavaSalvo;
    if (estavaSalvo) favoritosSet.add(idStr);
    else favoritosSet.delete(idStr);
    syncSavedBadge();
    throw error;
  }
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




// =========================
// INTERESSES + NOTIFICAÇÕES DO CLIENTE
// =========================
function applyInteressesToLoadedEditais() {
  for (const edital of editaisOriginais) {
    edital.has_interest = interessesSet.has(String(edital.id));
  }
  syncInterestBadge();
  syncInterestToggleUI();
}

async function loadInteresses() {
  interessesSet = new Set();
  try {
    const { res, data } = await apiFetchJson('/cliente/interesses?ids_only=1', { method: 'GET' });
    if (res.ok) {
      const ids = Array.isArray(data) ? data : (Array.isArray(data?.ids) ? data.ids : []);
      interessesSet = new Set((ids || []).map((value) => String(value)));
    }
  } catch (_) {
    // não quebra o dashboard se o backend antigo ainda não tiver o endpoint
  }
  applyInteressesToLoadedEditais();
}

function syncInterestBadge() {
  if (!interestBadge) return;
  const n = interessesSet.size;
  if (n > 0) {
    interestBadge.hidden = false;
    interestBadge.textContent = String(n);
  } else {
    interestBadge.hidden = true;
    interestBadge.textContent = '0';
  }
}

function syncInterestToggleUI() {
  if (!interestToggleBtn) return;
  interestToggleBtn.classList.toggle('is-active', !!onlyInteresses);
  interestToggleBtn.setAttribute('aria-pressed', onlyInteresses ? 'true' : 'false');
  interestToggleBtn.setAttribute('title', onlyInteresses ? 'Exibindo apenas interesses' : 'Ver interesses');
  const icon = interestToggleBtn.querySelector('i');
  if (icon) {
    icon.classList.toggle('fas', !!onlyInteresses);
    icon.classList.toggle('far', !onlyInteresses);
  }
}

function updateAllInterestButtons(editalId, isInterested) {
  document.querySelectorAll(`.interest-btn[data-id="${cssEscape(String(editalId))}"]`).forEach((btn) => updateInterestButtonUI(btn, isInterested));
}

function updateInterestButtonUI(btn, isInterested) {
  if (!btn) return;
  btn.classList.toggle('is-interested', !!isInterested);
  btn.setAttribute('title', isInterested ? 'Interesse enviado' : 'Tenho interesse');
  btn.setAttribute('data-tooltip', isInterested ? 'Interesse enviado' : 'Tenho interesse');
  btn.setAttribute('aria-label', isInterested ? 'Interesse enviado neste edital' : 'Tenho interesse neste edital');
  const icon = btn.querySelector('i');
  if (icon) {
    icon.classList.toggle('fas', !!isInterested);
    icon.classList.toggle('far', !isInterested);
  }
  const label = btn.querySelector('span');
  if (label) label.textContent = isInterested ? 'Interesse enviado' : 'Tenho interesse';
}

function confirmarRemocaoInteresse() {
  return new Promise((resolve) => {
    const existing = document.querySelector('.interest-confirm-backdrop');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'interest-confirm-backdrop';
    backdrop.setAttribute('role', 'presentation');
    backdrop.innerHTML = `
      <div class="interest-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="interestConfirmTitle" aria-describedby="interestConfirmText">
        <div class="interest-confirm-dialog__icon"><i class="fas fa-handshake-slash" aria-hidden="true"></i></div>
        <h3 id="interestConfirmTitle">Deseja remover o interesse?</h3>
        <p id="interestConfirmText">Esse edital sairá da sua lista de interesses enviados.</p>
        <div class="interest-confirm-dialog__actions">
          <button type="button" class="btn btn-secondary" data-interest-confirm="no">Não</button>
          <button type="button" class="btn btn-primary" data-interest-confirm="yes">Sim</button>
        </div>
      </div>
    `;

    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
      resolve(Boolean(value));
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') finish(false);
    };
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) finish(false);
      const btn = event.target.closest('[data-interest-confirm]');
      if (!btn) return;
      finish(btn.getAttribute('data-interest-confirm') === 'yes');
    });
    document.addEventListener('keydown', onKeyDown);
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => {
      const noButton = backdrop.querySelector('[data-interest-confirm="no"]');
      try { noButton?.focus(); } catch (_) {}
    });
  });
}

async function registrarInteresse(editalId) {
  const { res, data } = await apiFetchJson('/cliente/interesses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edital_id: Number(editalId) }),
  });
  if (!res.ok) {
    const msg = (data && (data.detail || data.message || data.msg)) ? (data.detail || data.message || data.msg) : 'Não foi possível registrar o interesse.';
    throw new Error(msg);
  }
  return data || {};
}

async function removerInteresse(editalId) {
  const idStr = String(editalId);
  const { res, data } = await apiFetchJson(`/cliente/interesses/${encodeURIComponent(idStr)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const msg = (data && (data.detail || data.message || data.msg)) ? (data.detail || data.message || data.msg) : 'Não foi possível remover o interesse.';
    throw new Error(msg);
  }
  return data || {};
}

async function sinalizarInteresse(editalId) {
  const idStr = String(editalId);
  const edital = editaisOriginais.find((e) => String(e.id) === idStr);
  if (edital?.has_interest || interessesSet.has(idStr)) {
    return { ok: true, already: true, interested: true, edital };
  }

  if (edital) edital.has_interest = true;
  interessesSet.add(idStr);
  syncInterestBadge();
  try {
    const data = await registrarInteresse(editalId);
    await loadClientNotifications();
    return { ok: true, interested: true, edital, data };
  } catch (error) {
    if (edital) edital.has_interest = false;
    interessesSet.delete(idStr);
    syncInterestBadge();
    throw error;
  }
}

async function cancelarInteresse(editalId) {
  const idStr = String(editalId);
  const edital = editaisOriginais.find((e) => String(e.id) === idStr);
  const tinhaInteresse = Boolean(edital?.has_interest || interessesSet.has(idStr));
  if (!tinhaInteresse) {
    return { ok: true, interested: false, edital };
  }

  if (edital) edital.has_interest = false;
  interessesSet.delete(idStr);
  syncInterestBadge();
  try {
    const data = await removerInteresse(editalId);
    return { ok: true, interested: false, edital, data };
  } catch (error) {
    if (edital) edital.has_interest = true;
    interessesSet.add(idStr);
    syncInterestBadge();
    throw error;
  }
}

async function handleInterestButtonClick(editalId, button = null) {
  const idStr = String(editalId);
  const edital = editaisOriginais.find((e) => String(e.id) === idStr);
  const isInterested = Boolean(edital?.has_interest || interessesSet.has(idStr));

  if (isInterested) {
    const shouldRemove = await confirmarRemocaoInteresse();
    if (!shouldRemove) return { ok: true, cancelled: true, interested: true, edital };
    updateAllInterestButtons(idStr, false);
    const result = await cancelarInteresse(idStr);
    updateAllInterestButtons(idStr, false);
    if (onlyInteresses) applyFiltersAndRender({ resetPage: true });
    return result;
  }

  if (button) updateInterestButtonUI(button, true);
  const result = await sinalizarInteresse(idStr);
  updateAllInterestButtons(idStr, true);
  return result;
}

function renderClientNotifications() {
  if (clientNotificationBadge) {
    const unread = clientNotifications.filter((item) => !item.is_read).length;
    clientNotificationBadge.hidden = unread <= 0;
    clientNotificationBadge.textContent = String(unread);
  }
  if (!clientNotificationList) return;
  if (!Array.isArray(clientNotifications) || clientNotifications.length === 0) {
    clientNotificationList.innerHTML = '<p class="notification-empty">Nenhuma notificação ainda.</p>';
    return;
  }
  clientNotificationList.innerHTML = clientNotifications.map((item) => {
    const unreadClass = item.is_read ? '' : ' is-unread';
    const dateLabel = item.created_at ? formatDateTimeLabel(item.created_at) : '';
    return `
      <button class="notification-item${unreadClass}" type="button" data-notification-id="${escapeHtml(item.id)}">
        <strong>${escapeHtml(item.title || 'Notificação')}</strong>
        <span>${escapeHtml(item.message || '')}</span>
        ${dateLabel ? `<small>${escapeHtml(dateLabel)}</small>` : ''}
      </button>
    `;
  }).join('');
}

async function loadClientNotifications() {
  try {
    const { res, data } = await apiFetchJson('/cliente/notificacoes?limit=20', { method: 'GET' });
    if (!res.ok) return;
    clientNotifications = Array.isArray(data?.items) ? data.items : [];
    renderClientNotifications();
  } catch (_) {
    // silencioso: sininho não pode derrubar o painel
  }
}

async function markClientNotificationRead(notificationId) {
  const id = String(notificationId || '').trim();
  if (!id) return;
  const target = clientNotifications.find((item) => String(item.id) === id);
  if (target) {
    target.is_read = true;
    renderClientNotifications();
  }
  try {
    await apiFetchJson(`/cliente/notificacoes/${encodeURIComponent(id)}/lida`, { method: 'POST' });
  } catch (_) {}
}

function formatDateTimeLabel(value) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}



function normalizeEdital(api) {
  const hasSummaryShape = Boolean(
    api &&
    typeof api === 'object' &&
    !api?.json_data &&
    (
      api?.titulo ||
      api?.instituicao ||
      api?.estado ||
      api?.area ||
      api?.data_fechamento ||
      api?.data_final_submissao
    )
  );
  const summaryData = hasSummaryShape ? {
    titulo: api?.titulo,
    descricao: api?.descricao,
    objetivo: api?.descricao,
    publico_alvo: api?.publico_alvo,
    instituicao: api?.instituicao,
    estado: api?.estado,
    area: api?.area,
    instrumento: api?.instrumento,
    tipo: api?.tipo,
    valor_total: api?.valor_total || api?.valor,
    data_final_submissao: api?.data_final_submissao || api?.data_fechamento,
    data_fechamento: api?.data_fechamento || api?.data_final_submissao,
    data_abertura: api?.data_abertura,
    data_publicacao: api?.data_publicacao || api?.created_at || api?.criado_em,
    tags: Array.isArray(api?.tags) ? api.tags : [],
    icone_instituicao: api?.icone_instituicao || api?.icone,
  } : {};
  const jsonData = typeof api?.json_data === 'string' ? safeJsonParse(api.json_data, {}) : (api?.json_data || {});
  const data = { ...summaryData, ...jsonData };
  const arquivos = typeof api?.arquivos_json === 'string' ? safeJsonParse(api.arquivos_json, []) : (api?.arquivos_json || []);
  const rawArea = data.area || (Array.isArray(data.tags) && data.tags.length ? data.tags[0] : 'Geral');
  const titulo = data.titulo || api?.titulo || 'Sem título';
  const fluxoContinuo = [api?.fluxo_continuo, api?.fluxoContinuo, data.fluxo_continuo, data.fluxoContinuo]
    .some((value) => {
      if (value === true) return true;
      const token = String(value ?? '').trim().toLowerCase();
      return token === 'true' || token === '1' || token === 'sim';
    });

  const normalized = {
    id: api?.id,
    titulo,
    slug: generateSlug(titulo),
    descricao: data.objetivo || data.descricao || 'Sem descrição',
    publico_alvo: data.publico_alvo || '',
    icone: resolveIconPath(data.icone_instituicao),
    instituicao: data.instituicao || '',
    estado: normalizeEstadoValue(data.estado || 'BR') || 'BR',
    area: String(rawArea || 'Geral'),
    instrumento: toCanonicalInstrument(data.instrumento || data.apoio || 'Não informado'),
    tipo: data.tipo || 'Não informado',
    valor_total: data.valor_total || '',
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
    tags: data.tags || [],
    arquivos,
    is_favorite: Boolean(api?.is_favorite),
    has_interest: Boolean(api?.has_interest),
    share_link: api?.share_link || '',
    is_open: typeof api?.is_open === 'boolean' ? api.is_open : undefined,
    fluxo_continuo: fluxoContinuo,
    relevance_score: normalizeRelevanceScore(api?.relevance_score),
    relevance_level: normalizeRelevanceLevel(api?.relevance_level),
    is_highlighted: !!api?.is_highlighted,
    recommendation_label: String(api?.recommendation_label || '').trim(),
    relevance_reasons: normalizeStringList(api?.relevance_reasons),
    relevance_warnings: normalizeStringList(api?.relevance_warnings),
    missing_profile_fields: normalizeStringList(api?.missing_profile_fields),
    matched_criteria: api?.matched_criteria && typeof api.matched_criteria === 'object' ? { ...api.matched_criteria } : {},
    blockers: normalizeStringList(api?.blockers),
    details_loaded: Boolean(api?.details_loaded) || arquivos.length > 0,
  };

  if (isClosedEdital(normalized)) {
    normalized.is_open = false;
    normalized.is_highlighted = false;
    if (normalized.relevance_level === 'perfect' || normalized.relevance_level === 'high') {
      normalized.relevance_level = normalized.relevance_score > 0 ? 'medium' : 'not_recommended';
      normalized.recommendation_label = normalized.relevance_score > 0 ? 'Pode interessar como referência' : '';
    }
  }

  return normalized;
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
    const prevInterest = Boolean(edital.has_interest);
    Object.assign(edital, normalized);
    edital.is_favorite = prevFavorite;
    edital.has_interest = prevInterest || interessesSet.has(String(edital.id));
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

function normalizeRelevanceLevel(value) {
  const level = String(value || '').trim();
  const allowed = new Set(['perfect', 'high', 'medium', 'low', 'not_recommended']);
  return allowed.has(level) ? level : '';
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

const OPTIMIZED_ICON_BY_KEY = Object.freeze({
  'awesome foundation': 'Awesome_Foundation.webp',
  'ambev': 'ambev.webp',
  'anp': 'anp.webp',
  'banco do nordeste': 'banco do nordeste.webp',
  'basf': 'basf.webp',
  'bndes': 'bndes.webp',
  'brde': 'brde.webp',
  'brics wba': 'brics wba.webp',
  'capes': 'capes.webp',
  'cnpq': 'cnpq.webp',
  'coca cola': 'coca-cola.webp',
  'confap': 'confap.webp',
  'correios': 'correios.webp',
  'cresol': 'cresol.webp',
  'facepe': 'facepe.webp',
  'fapeal': 'fapeal.webp',
  'fapeam': 'fapeam.webp',
  'fapeap': 'fapeap.webp',
  'fapeg': 'fapeg.webp',
  'fapema': 'fapema.webp',
  'fapemig': 'fapemig.webp',
  'fapepi': 'fapepi.webp',
  'fapergs': 'fapergs.webp',
  'faperj': 'faperj.webp',
  'fapern': 'fapern.webp',
  'fapero': 'fapero.webp',
  'fapes': 'fapes.webp',
  'fapesb': 'fapesb.webp',
  'fapesc': 'fapesc.webp',
  'fapesp': 'fapesp.webp',
  'fapesq': 'fapesq.webp',
  'fapitec': 'fapitec.webp',
  'fapt': 'fapt.webp',
  'finep': 'finep.webp',
  'funcap': 'funcap.webp',
  'fundacao araucaria': 'fundacao-araucaria.webp',
  'fundacao araucaria pr': 'fundacao-araucaria.webp',
  'fundacao araucaria de apoio ao desenvolvimento cientifico e tecnologico': 'fundacao-araucaria.webp',
  'araucaria': 'fundacao-araucaria.webp',
  'fundect': 'fundect.webp',
  'iaf': 'iaf.webp',
  'inovale': 'inovale.webp',
  'mining hub': 'mining hub.webp',
  'petrobras': 'petrobras.webp',
  'portal industria': 'portal-industria.webp',
  'prosas': 'prosas.webp',
  'santander': 'santander.webp',
  'serpro': 'serpro.webp',
  'tetrapak': 'tetrapak.webp',
  'vale': 'vale.webp',
});

function normalizeIconLookupKey(value) {
  return String(value || '')
    .split(/[?#]/)[0]
    .split('/')
    .pop()
    .replace(/\.(?:png|jpe?g|gif|webp|svg|avif)$/ig, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function resolveOptimizedIconUrl(value, baseUrl = APP_BASE_URL) {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  if (!raw || /^(?:data:|blob:)/i.test(raw)) return null;

  let candidate = raw;
  try {
    if (/^https?:\/\//i.test(raw) || raw.startsWith('//')) {
      const absolute = raw.startsWith('//') ? `${window.location.protocol}${raw}` : raw;
      const parsed = new URL(absolute);
      candidate = decodeURIComponent(parsed.pathname.split('/').pop() || '');
    }
  } catch (_) {}

  const key = normalizeIconLookupKey(candidate);
  const fileName = OPTIMIZED_ICON_BY_KEY[key];
  return fileName ? new URL(`icons-optimized/${fileName}`, baseUrl).href : null;
}

function resolveIconPath(value) {
  if (value === null || value === undefined) return null;

  const raw = String(value).trim().replace(/\\/g, '/');
  if (!raw) return null;

  const optimizedUrl = resolveOptimizedIconUrl(raw, APP_BASE_URL);
  if (optimizedUrl) return optimizedUrl;

  if (/^https?:/i.test(raw)) return safeUrl(raw, '');
  if (raw.startsWith('//')) return safeUrl(`${window.location.protocol}${raw}`, '');

  const normalized = raw
    .replace(/^\.?\//, '')
    .replace(/^\/+/,'');

  const isProjectIconPath =
    normalized.toLowerCase().startsWith('icons-optimized/') ||
    normalized.toLowerCase().startsWith('icons/') ||
    normalized.toLowerCase().startsWith('assets/img/icons/');

  const isBareImageFilename = /^[^/]+\.(?:png|jpe?g|gif|webp|svg|avif)$/i.test(normalized);

  if (isProjectIconPath) {
    return safeUrl(new URL(normalized.replace(/^icons\//i, 'icons-optimized/').replace(/\.(?:png|jpe?g|gif|svg|avif)$/i, '.webp'), APP_BASE_URL).href, '');
  }

  if (isBareImageFilename) {
    return safeUrl(new URL(`icons-optimized/${normalized.replace(/\.(?:png|jpe?g|gif|svg|avif)$/i, '.webp')}`, APP_BASE_URL).href, '');
  }

  return safeUrl(raw, '');
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
// FUSE (relevância)
// =========================
function buildFuseIndex() {
  if (typeof Fuse === 'undefined') return;
  fuseInstance = new Fuse(editaisOriginais, {
    keys: ['titulo', 'descricao', 'instituicao', 'area', 'tags', 'data_fechamento', 'data_abertura', 'data_publicacao'],
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });
}

// =========================
// FILTROS (gera opções)
// =========================
function generateDynamicFilters() {
  const types = [
    { key: 'estado', type: 'estado' },
    { key: 'instituicao', type: 'instituicao' },
  ];

  types.forEach(({ key, type }) => {
    const box = document.querySelector(`.filter-options[data-filter-type="${type}"]`);
    if (!box) return;

    const selectedBeforeRender = new Set([...(applied[type] || []), ...readSelected(type)]);
    const counts = new Map();
    for (const e of editaisOriginais) {
      const raw = type === 'estado'
        ? normalizeEstadoValue(e?.[key])
        : (e?.[key] ?? '').toString().trim();
      if (!raw) continue;
      counts.set(raw, (counts.get(raw) || 0) + 1);
    }

    const values = Array.from(counts.keys())
      .sort((a, b) => {
        const diff = (counts.get(b) || 0) - (counts.get(a) || 0);
        if (diff !== 0) return diff;
        return a.localeCompare(b, 'pt-BR');
      });

    box.innerHTML = '';
    if (values.length === 0) {
      box.innerHTML = '<div style="font-size:12px; color:#9CA3AF; padding:6px;">Nenhuma opção</div>';
      return;
    }

    for (const val of values) {
      const displayVal = type === 'estado' ? formatEstadoLabel(val) : val;
      const label = document.createElement('label');
      label.setAttribute('data-label', normalizeCategoryKey(`${val} ${displayVal}`));

      const left = document.createElement('span');
      left.className = 'label-left';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = val;
      input.checked = selectedBeforeRender.has(val);

      const text = document.createElement('span');
      text.textContent = displayVal;
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

      const count = document.createElement('span');
      count.className = 'filter-count';
      count.textContent = counts.get(val) || 0;

      label.appendChild(left);
      label.appendChild(count);
      box.appendChild(label);
    }
  });

  generateCategoryFilters();

  wireFilterSearch(filterSearchEstado, document.querySelector('.filter-options[data-filter-type="estado"]'));
  wireFilterSearch(filterSearchInstituicao, document.querySelector('.filter-options[data-filter-type="instituicao"]'));
  wireFilterSearch(filterSearchArea, document.querySelector('.filter-options[data-filter-type="area"]'));
}

function generateCategoryFilters() {
  const box = document.querySelector('.filter-options[data-filter-type="area"]');
  if (!box) return;

  const selectedBeforeRender = new Set([...(applied.area || []), ...readSelected('area')]);
  const counts = new Map();
  for (const e of editaisOriginais) {
    const cat = toCanonicalCategory(e?.area);
    if (!cat) continue;
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }

  const orderedCategories = CATEGORY_OPTIONS.slice().sort((a, b) => {
    const diff = (counts.get(b.value) || 0) - (counts.get(a.value) || 0);
    if (diff !== 0) return diff;
    return a.label.localeCompare(b.label, 'pt-BR');
  });

  box.innerHTML = '';
  for (const category of orderedCategories) {
    const label = document.createElement('label');
    label.setAttribute('data-label', normalizeCategoryKey(`${category.label} ${category.value}`));

    const left = document.createElement('span');
    left.className = 'label-left';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = category.value;
    input.checked = selectedBeforeRender.has(category.value);

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
  if (inputEl.dataset.filterSearchBound === 'true') return;
  inputEl.dataset.filterSearchBound = 'true';
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

function normalizeDashboardFilterState(rawFilters = {}) {
  const filters = rawFilters && typeof rawFilters === 'object' ? rawFilters : {};
  return {
    estado: toUniqueStringList(filters.estado || filters.estados, {
      normalize: (v) => String(v || '').trim().toUpperCase(),
    }),
    instituicoes: toUniqueStringList(filters.instituicoes || filters.instituicao),
    categories: toUniqueStringList(filters.categories || filters.categorias || filters.area, {
      normalize: (v) => toCanonicalCategory(v),
    }),
    status: toUniqueStringList(filters.status || filters.statuses, {
      normalize: normalizeAssistantStatusToken,
    }).filter(Boolean),
    deadline_range: normalizeAssistantDeadlineRange(filters.deadline_range || filters.deadlineRange || filters.deadline),
    keywords: toUniqueStringList(filters.keywords || filters.termos || filters.temas, {
      normalize: (v) => normalizeAssistantQuery(v),
    }),
  };
}

function createDashboardMemoryState(seed = {}) {
  return {
    ...createDashboardAssistantMemory(seed),
    lastDashboardFilters: normalizeDashboardFilterState(seed?.lastDashboardFilters),
    lastRefinementQuestion: String(seed?.lastRefinementQuestion || '').trim(),
  };
}

function dashboardFiltersFromPayload(payload) {
  const normalized = normalizeAssistantSearchPayload(payload);
  return normalizeDashboardFilterState(normalized?.filters || {});
}

function dashboardFiltersFromPlan(plan) {
  const filters = plan?.filters && typeof plan.filters === 'object' ? plan.filters : {};
  return normalizeDashboardFilterState({
    estado: filters.estado,
    instituicoes: filters.instituicao,
    categories: filters.area,
    status: filters.status,
    deadline_range: Number(filters.deadline_days || 0) > 0 && Number(filters.deadline_days || 0) <= 7 ? 'next_7_days' : '',
    keywords: filters.keywords,
  });
}

function hasDashboardFilterValue(filters) {
  const normalized = normalizeDashboardFilterState(filters);
  return Boolean(
    normalized.estado.length ||
    normalized.instituicoes.length ||
    normalized.categories.length ||
    normalized.status.length ||
    normalized.deadline_range ||
    normalized.keywords.length
  );
}

function mergeDashboardFilterState(baseFilters, nextFilters) {
  const base = normalizeDashboardFilterState(baseFilters);
  const next = normalizeDashboardFilterState(nextFilters);
  return {
    estado: next.estado.length ? next.estado : base.estado,
    instituicoes: next.instituicoes.length ? next.instituicoes : base.instituicoes,
    categories: next.categories.length ? next.categories : base.categories,
    status: next.status.length ? next.status : base.status,
    deadline_range: next.deadline_range || base.deadline_range,
    keywords: next.keywords.length ? next.keywords : base.keywords,
  };
}

function formatDashboardFiltersForPrompt(rawFilters) {
  const filters = normalizeDashboardFilterState(rawFilters);
  const parts = [];
  if (filters.categories.length) parts.push(`categoria ${filters.categories.join(', ')}`);
  if (filters.keywords.length) parts.push(`tema ${filters.keywords.join(', ')}`);
  if (filters.estado.length) parts.push(`estado ${filters.estado.join(', ')}`);
  if (filters.instituicoes.length) parts.push(`instituição ${filters.instituicoes.join(', ')}`);
  if (filters.status.length) parts.push(`status ${filters.status.join(', ')}`);
  if (filters.deadline_range === 'next_7_days') parts.push('prazo nesta semana');
  return parts.join('; ');
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
  assistantSemanticMemory = createDashboardMemoryState({
    ...assistantSemanticMemory,
    lastOpenedCardId: id,
    updatedAt: new Date().toISOString(),
  });
}

function rememberAssistantResultSetFromPayload(payload, { question = '', intent = '', dashboardFilters = null } = {}) {
  if (!payload || typeof payload !== 'object') return;
  const ids = Array.isArray(payload.result_ids)
    ? payload.result_ids.map((id) => String(id || '').trim()).filter(Boolean)
    : [];

  const nextFilters = hasDashboardFilterValue(dashboardFilters)
    ? normalizeDashboardFilterState(dashboardFilters)
    : normalizeDashboardFilterState(payload.filters || assistantSemanticMemory?.lastDashboardFilters);

  if (!ids.length && !hasDashboardFilterValue(nextFilters)) return;

  assistantSemanticMemory = createDashboardMemoryState({
    ...assistantSemanticMemory,
    lastResultIds: ids,
    lastResultScope: 'all_loaded',
    lastIntent: String(intent || payload.intent || '').trim() || assistantSemanticMemory?.lastIntent || '',
    lastQuestion: String(question || payload.query || '').trim() || assistantSemanticMemory?.lastQuestion || '',
    lastDashboardFilters: nextFilters,
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
    assistantSemanticMemory = createDashboardMemoryState({
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
    relevance_level: String(rawCard?.relevance_level || '').trim(),
    is_highlighted: Boolean(rawCard?.is_highlighted),
    recommendation_label: String(rawCard?.recommendation_label || '').trim(),
    relevance_reasons: normalizeStringList(rawCard?.relevance_reasons).slice(0, 5),
    relevance_warnings: normalizeStringList(rawCard?.relevance_warnings).slice(0, 5),
    missing_profile_fields: normalizeStringList(rawCard?.missing_profile_fields).slice(0, 8),
    matched_criteria: rawCard?.matched_criteria && typeof rawCard.matched_criteria === 'object' ? { ...rawCard.matched_criteria } : {},
    blockers: normalizeStringList(rawCard?.blockers).slice(0, 5),
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
      only_interesses: Boolean(onlyInteresses),
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
  const matchedIdSet = new Set(matchedIds);
  const backendCards = backendNormalized.filter((opt) => (
    String(opt?.action || '').trim() === 'open_edital' &&
    opt.id != null &&
    (!matchedIdSet.size || matchedIdSet.has(String(opt.id)))
  ));
  const backendActions = backendNormalized.filter((opt) => {
    const action = String(opt?.action || '').trim();
    return action !== 'open_edital' && action !== 'view_all' && action !== 'ask_new';
  });

  if (backendCards.length) {
    options.push(...backendCards.slice(0, 5));
  } else if (total > 0 && matchedIds.length) {
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

  backendActions.forEach((actionOption) => {
    const action = String(actionOption?.action || '').trim();
    const title = String(actionOption?.title || '').trim().toLowerCase();
    const alreadyAdded = options.some((opt) => (
      String(opt?.action || '').trim() === action &&
      String(opt?.title || '').trim().toLowerCase() === title
    ));
    if (!alreadyAdded) options.push(actionOption);
  });

  if (total > 0 && payload) {
    const hasViewAllAction = options.some((opt) => String(opt?.action || '').trim() === 'view_all');
    if (!hasViewAllAction) options.push({
      action: 'view_all',
      query,
      title: total > 5 ? `Ver todos no painel (${total})` : 'Ver no painel',
      meta: 'Aplicar filtro no painel',
      payload,
    });

    if (total > 5 && matchedIds.length > 5) {
      const hasTopUrgentAction = options.some((opt) => String(opt?.title || '').toLowerCase().includes('mais urgentes'));
      if (!hasTopUrgentAction) options.push({
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

function applyAssistantContextFilters(items) {
  if (!assistantPanelContext || !Array.isArray(items) || !items.length) return items;

  let scoped = [...items];
  const context = assistantPanelContext;
  const filters = context.filters || {};
  const idSet = context.resultIdsSet instanceof Set ? context.resultIdsSet : new Set();

  const expectedTotal = Number(context.total || context.search_payload?.total || context.searchPayload?.total || 0) || 0;
  const hasFilterCriteria = hasDashboardFilterValue(filters);
  const hasCompleteIdScope = idSet.size > 0 && (!expectedTotal || idSet.size >= expectedTotal);
  const shouldUseIdScope = hasCompleteIdScope || (idSet.size > 0 && !hasFilterCriteria);
  if (shouldUseIdScope) {
    scoped = scoped.filter((edital) => idSet.has(String(edital?.id)));
    return scoped;
  }

  const status = Array.isArray(filters.status) ? filters.status : [];
  const onlyOpen = status.includes('aberto') && !status.includes('encerrado');
  const onlyClosed = status.includes('encerrado') && !status.includes('aberto');
  if (onlyOpen) scoped = scoped.filter((edital) => isOpenEditalForChat(edital));
  if (onlyClosed) scoped = scoped.filter((edital) => !isOpenEditalForChat(edital));

  if (filters.deadline_range === 'next_7_days') {
    scoped = scoped.filter((edital) => isOpenEditalForChat(edital) && isDeadlineWithinNextDays(edital, 7));
  }

  if (Array.isArray(filters.estado) && filters.estado.length) {
    const ufSet = new Set(filters.estado.map((uf) => String(uf || '').trim().toUpperCase()).filter(Boolean));
    scoped = scoped.filter((edital) => ufSet.has(String(edital?.estado || '').trim().toUpperCase()));
  }

  if (Array.isArray(filters.instituicoes) && filters.instituicoes.length) {
    const wanted = filters.instituicoes.map((item) => normalizeAssistantQuery(item));
    scoped = scoped.filter((edital) => {
      const inst = normalizeAssistantQuery(edital?.instituicao || '');
      return wanted.some((needle) => inst.includes(needle));
    });
  }

  if (Array.isArray(filters.categories) && filters.categories.length) {
    const wanted = new Set(filters.categories.map((item) => toCanonicalCategory(item)));
    scoped = scoped.filter((edital) => wanted.has(toCanonicalCategory(edital?.area || '')));
  }

  if ((!idSet.size) && Array.isArray(filters.keywords) && filters.keywords.length) {
    scoped = scoped.filter((edital) => {
      const blob = normalizeAssistantQuery([
        edital?.titulo,
        edital?.descricao,
        edital?.instituicao,
        edital?.estado,
        edital?.area,
        ...(Array.isArray(edital?.tags) ? edital.tags : []),
      ].filter(Boolean).join(' '));
      return filters.keywords.some((keyword) => blob.includes(normalizeAssistantQuery(keyword)));
    });
  }

  return scoped;
}

// =========================
// APLICAÇÃO DE FILTROS
// =========================


function hasScopedDashboardContext(searchContext = null) {
  const hasTextOrDateSearch = Boolean(
    String(searchInput?.value || '').trim() ||
    searchContext?.textQuery ||
    searchContext?.dateIntent
  );
  return Boolean(
    hasTextOrDateSearch ||
    hasAppliedFilters() ||
    onlyFavoritos ||
    onlyInteresses ||
    assistantPanelContext
  );
}

function ensureAllEditaisHydrationScheduled() {
  const expectedTotal = Number(serverPageMeta?.total || 0);
  if (!expectedTotal || expectedTotal <= (Array.isArray(editaisOriginais) ? editaisOriginais.length : 0)) return;
  if (allEditaisHydrationInProgress || allEditaisHydrationTimerId) return;

  const requestOptions = lastFastCardsRequestOptions || {
    summary: true,
    page: 1,
    limit: PAGE_SIZE,
    view: 'card',
    includeAttachments: false,
    includeRelevance: false,
  };
  scheduleAllEditaisHydration({
    ...requestOptions,
    summary: true,
    page: 1,
    limit: Number(requestOptions.limit || PAGE_SIZE),
    view: 'card',
    includeAttachments: false,
    includeRelevance: false,
  });
}

function applyFiltersAndRender({ resetPage } = { resetPage: false }) {
  if (resetPage) currentPage = 1;

  const termo = (searchInput?.value || '').trim();
  const searchContext = buildSearchQueryContext(termo);
  const textQuery = searchContext.textQuery;
  const textQueryLower = textQuery.toLowerCase();
  setSearchVisualState();

  // 1) Base por relevância (Fuse) quando existir busca
  let base = [...editaisOriginais];

  if (textQuery && fuseInstance) {
    base = fuseInstance.search(textQuery).map(r => r.item);
  } else if (textQuery) {
    base = base.filter(e =>
      (e.titulo || '').toLowerCase().includes(textQueryLower) ||
      (e.descricao || '').toLowerCase().includes(textQueryLower) ||
      (e.instituicao || '').toLowerCase().includes(textQueryLower) ||
      (e.area || '').toLowerCase().includes(textQueryLower) ||
      (Array.isArray(e.tags) && e.tags.some(t => String(t).toLowerCase().includes(textQueryLower)))
    );
  }

  if (searchContext.dateIntent) {
    const dateMatches = editaisOriginais.filter((edital) => matchesDateIntent(edital, searchContext.dateIntent));
    if (searchContext.hasMeaningfulText && textQuery) {
      const dateIds = new Set(dateMatches.map((edital) => String(edital.id)));
      base = base.filter((edital) => dateIds.has(String(edital.id)));
    } else {
      base = dateMatches;
    }
  }

  // 2) Filtros aplicados (checkboxes)
  let filtered = base;
  if (applied.estado.length) filtered = filtered.filter(e => applied.estado.includes(e.estado));
  if (applied.instituicao.length) filtered = filtered.filter(e => applied.instituicao.includes(e.instituicao));
  if (applied.area.length) filtered = filtered.filter(e => applied.area.includes(toCanonicalCategory(e.area)));
  filtered = applyAssistantContextFilters(filtered);
  const statsBase = [...filtered];

  // 2.4) Recorte por KPI clicado
  if (kpiFilter === 'abertos') filtered = filtered.filter((edital) => !isClosedEdital(edital));
  if (kpiFilter === 'fechados') filtered = filtered.filter((edital) => isClosedEdital(edital));
  if (kpiFilter === 'recomendados') filtered = filtered.filter((edital) => !isClosedEdital(edital) && (edital?.is_highlighted || edital?.relevance_level === 'perfect'));

  // 2.5) Só salvos / só interesses
  if (onlyFavoritos) filtered = filtered.filter(e => !!e.is_favorite);
  if (onlyInteresses) filtered = filtered.filter(e => !!e.has_interest);

  // 3) Ordenação
  const sort = normalizeSortValue(sortField || sortSelect?.value || 'prazo');
  const directionFactor = sortDirection === 'desc' ? -1 : 1;

  const collate = (a, b) => String(a || '').localeCompare(String(b || ''), 'pt-BR', { sensitivity: 'base' });

  if (sort === 'prazo') {
    filtered = [...filtered].sort((a, b) => compareIsoDate(a.data_fechamento, b.data_fechamento) * directionFactor);
  } else if (sort === 'atualizado' || sort === 'atualizacao') {
    filtered = [...filtered].sort((a, b) => compareIsoDate(a.data_abertura, b.data_abertura) * directionFactor);
  } else if (sort === 'titulo') {
    filtered = [...filtered].sort((a, b) => collate(a.titulo, b.titulo) * directionFactor);
  } else if (sort === 'instituicao') {
    filtered = [...filtered].sort((a, b) => collate(a.instituicao, b.instituicao) * directionFactor);
  } else if (sort === 'estado') {
    filtered = [...filtered].sort((a, b) => collate(a.estado, b.estado) * directionFactor);
  } else if (sort === 'relevancia') {
    const compareRelevance = (a, b) => {
      const openDiff = (isClosedEdital(a) ? 0 : 1) - (isClosedEdital(b) ? 0 : 1);
      if (openDiff !== 0) return openDiff;

      const relDiff = normalizeRelevanceScore(a?.relevance_score) - normalizeRelevanceScore(b?.relevance_score);
      if (relDiff !== 0) return relDiff;

      const highlightDiff = (a?.is_highlighted ? 1 : 0) - (b?.is_highlighted ? 1 : 0);
      if (highlightDiff !== 0) return highlightDiff;

      return collate(a?.titulo, b?.titulo) * -1;
    };
    filtered = [...filtered].sort((a, b) => compareRelevance(a, b) * directionFactor);
  } else {
    // fallback
    filtered = filtered;
  }

  lastFiltered = filtered;

  // 4) Paginação + render
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const endIdx = Math.min(startIdx + PAGE_SIZE, total);
  const pageItems = filtered.slice(startIdx, endIdx);

  if (resultsMeta) {
    const a = total === 0 ? 0 : startIdx + 1;
    const b = endIdx;
    const label = onlyFavoritos ? 'salvos' : (onlyInteresses ? 'interesses' : 'editais');
    resultsMeta.textContent = `Mostrando ${a}-${b} de ${total} ${label}`;
  }

  const shouldUseGlobalStats = !hasScopedDashboardContext(searchContext) && kpiFilter === 'all';
  const heroStatsScope = onlyFavoritos
    ? statsBase.filter((edital) => !!edital.is_favorite)
    : (onlyInteresses ? statsBase.filter((edital) => !!edital.has_interest) : statsBase);
  updateHeroStats(heroStatsScope, { globalStats: shouldUseGlobalStats ? serverPageMeta.stats : null });
  ensureAllEditaisHydrationScheduled();
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

  if (onlyInteresses && interessesSet.size === 0) {
    return {
      icon: 'fa-handshake',
      title: 'Sem interesses enviados ainda',
      message: 'Você ainda não marcou nenhum card com “Tenho interesse”. Quando marcar, ele aparece aqui.',
      actionLabel: 'Ver todos os editais',
      action: () => {
        onlyInteresses = false;
        syncInterestToggleUI();
        applyFiltersAndRender({ resetPage: true });
      },
    };
  }

  if (onlyInteresses) {
    return {
      icon: 'fa-filter',
      title: 'Sem interesses para este recorte',
      message: 'Tente remover alguns filtros para encontrar editais com interesse enviado.',
      actionLabel: 'Limpar filtros',
      action: () => clearAllFilters({ keepInterests: true }),
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
  const t = parseAnyDateToTime(edital?.data_fechamento);
  if (t !== null) {
    const d = new Date(t);
    const prazo = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return prazo < today;
  }
  if (typeof edital?.is_open === 'boolean') return !edital.is_open;
  if (edital?.fluxo_continuo === true) return false;
  return false;
}

function compareIsoDate(a, b) {
  const da = parseAnyDateToTime(a);
  const db = parseAnyDateToTime(b);
  if (da === null && db === null) return 0;
  if (da === null) return 1;
  if (db === null) return -1;
  return da < db ? -1 : da > db ? 1 : 0;
}

function normalizeHeroStatsFromMeta(globalStats, fallbackStats) {
  const meta = globalStats && typeof globalStats === 'object' ? globalStats : {};
  const total = Number(meta.total);
  const openTotal = Number(meta.open_total ?? meta.abertos_total);
  const closedTotal = Number(meta.closed_total ?? meta.fechados_total);
  const recommendedTotal = Number(meta.recommended_total ?? meta.recomendados_total);

  return {
    total: Number.isFinite(total) && total >= 0 ? Math.round(total) : fallbackStats.total,
    abertos: Number.isFinite(openTotal) && openTotal >= 0 ? Math.round(openTotal) : fallbackStats.abertos,
    fechados: Number.isFinite(closedTotal) && closedTotal >= 0 ? Math.round(closedTotal) : fallbackStats.fechados,
    recomendados: Number.isFinite(recommendedTotal) && recommendedTotal >= 0 ? Math.round(recommendedTotal) : fallbackStats.recomendados,
  };
}

function updateHeroStats(filtered, { globalStats = null } = {}) {
  let abertos = 0;
  let fechados = 0;
  let recomendados = 0;

  const safeFiltered = Array.isArray(filtered) ? filtered : [];
  for (const e of safeFiltered) {
    const closed = isClosedEdital(e);
    if (!closed && (e?.is_highlighted || e?.relevance_level === 'perfect')) recomendados++;
    if (closed) fechados++;
    else abertos++;
  }

  const stats = normalizeHeroStatsFromMeta(globalStats, {
    total: safeFiltered.length,
    abertos,
    fechados,
    recomendados,
  });

  if (statTotal) statTotal.textContent = String(stats.total);
  if (statAbertos) statAbertos.textContent = String(stats.abertos);
  if (statFechados) statFechados.textContent = String(stats.fechados);
  if (statRecomendados) statRecomendados.textContent = String(stats.recomendados);
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
      assistantSemanticMemory = createDashboardMemoryState();
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
      applyFiltersAndRender({ resetPage: true });
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

  [statChipTotal, statChipAbertos, statChipFechados, statChipRecomendados].forEach((btn) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      const next = String(btn.getAttribute('data-kpi-filter') || 'all');
      kpiFilter = next;
      syncKpiButtons();
      applyFiltersAndRender({ resetPage: true });
    });
  });

  // ver salvos / interesses (atalhos ao lado das notificações)
  if (savedToggleBtn) {
    savedToggleBtn.addEventListener('click', () => {
      onlyFavoritos = !onlyFavoritos;
      if (onlyFavoritos) onlyInteresses = false;
      syncSavedToggleUI();
      syncInterestToggleUI();
      applyFiltersAndRender({ resetPage: true });
    });
  }

  if (interestToggleBtn) {
    interestToggleBtn.addEventListener('click', () => {
      onlyInteresses = !onlyInteresses;
      if (onlyInteresses) onlyFavoritos = false;
      syncInterestToggleUI();
      syncSavedToggleUI();
      applyFiltersAndRender({ resetPage: true });
    });
  }

  if (clientNotificationBtn && clientNotificationDropdown) {
    clientNotificationBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const willOpen = clientNotificationDropdown.hidden;
      clientNotificationDropdown.hidden = !willOpen;
      clientNotificationBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (willOpen) await loadClientNotifications();
    });

    document.addEventListener('click', (e) => {
      if (clientNotificationMenu && !clientNotificationMenu.contains(e.target)) {
        clientNotificationDropdown.hidden = true;
        clientNotificationBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  if (clientNotificationRefreshBtn) {
    clientNotificationRefreshBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void loadClientNotifications();
    });
  }

  if (clientNotificationList) {
    clientNotificationList.addEventListener('click', (e) => {
      const item = e.target.closest('.notification-item[data-notification-id]');
      if (!item) return;
      void markClientNotificationRead(item.getAttribute('data-notification-id'));
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
      clearAllFilters({ keepSearch: true, keepFavorites: true, keepInterests: true, rerender: true });
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
    paginationEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-page]');
      if (!btn) return;
      const p = Number(btn.getAttribute('data-page'));
      if (!Number.isFinite(p) || p === currentPage) return;
      currentPage = p;
      applyFiltersAndRender({ resetPage: false });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // abrir edital (apenas pelo botão) + salvar (estrela) + interesse
  if (container) {
    container.addEventListener('click', async (e) => {
      const interestBtn = e.target.closest('.interest-btn');
      if (interestBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = interestBtn.getAttribute('data-id');
        if (!id) return;
        const prevDisabled = interestBtn.disabled;
        interestBtn.disabled = true;
        try {
          const result = await handleInterestButtonClick(id, interestBtn);
          if (!result?.cancelled) {
            const message = result?.interested
              ? (result?.already ? 'Interesse já registrado para este edital.' : (result?.data?.message || 'Interesse enviado ao administrador da sua conta.'))
              : 'Interesse removido deste edital.';
            showToast(message, 'success', 2400);
          }
        } catch (err) {
          updateAllInterestButtons(id, interessesSet.has(String(id)));
          showToast(err?.message || 'Não foi possível atualizar interesse neste edital.', 'error');
        } finally {
          interestBtn.disabled = prevDisabled;
        }
        return;
      }

      const saveBtn = e.target.closest('.save-btn');
      if (saveBtn) {
        e.preventDefault();
        e.stopPropagation();

        const id = saveBtn.getAttribute('data-id');
        if (!id) return;

        const editalAntes = editaisOriginais.find(e => String(e.id) === String(id));
        const estadoOtimista = editalAntes ? !editalAntes.is_favorite : !saveBtn.classList.contains('is-saved');
        updateSaveButtonUI(saveBtn, estadoOtimista);

        const prevDisabled = saveBtn.disabled;
        saveBtn.disabled = true;

        try {
          const r = await toggleFavorito(id);
          if (r?.ok) {
            updateSaveButtonUI(saveBtn, r.is_favorite);
            showToast(r.is_favorite ? 'Edital salvo na sua lista.' : 'Edital removido dos salvos.', 'success', 1800);
            // Se estiver vendo só salvos e removeu, some do grid
            if (onlyFavoritos && !r.is_favorite) {
              applyFiltersAndRender({ resetPage: true });
            }
          }
        } catch (err) {
          updateSaveButtonUI(saveBtn, Boolean(editalAntes?.is_favorite));
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
    sendButton.addEventListener('click', () => handleChatSend({ source: 'message_send' }));
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleChatSend({ source: 'message_send' });
      }
    });
  }


  // opções clicáveis do chat (ex: lista de editais)
  if (messageContainer) {
    messageContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('button.chat-option-btn, button.chat-refine-chip');
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

      if (action === 'send_refinement') {
        if (btn.disabled || btn.classList.contains('is-active')) return;
        const q = btn.getAttribute('data-query') || '';
        if (!q || !chatInput) return;
        const panel = btn.closest('.chat-refine-panel');
        if (panel?.dataset.submitted === 'true') return;
        if (panel) {
          panel.dataset.submitted = 'true';
          panel.querySelectorAll('button.chat-refine-chip').forEach((chip) => {
            chip.disabled = true;
          });
        }
        chatInput.value = q;
        handleChatSend({ source: 'quick_refinement', forceDashboardRefinement: true });
        return;
      }

      if (action === 'clear_refinements') {
        clearDashboardRefinementsFromChat();
        return;
      }

      if (action === 'ask_new') {
        clearActiveEditalContext();
        if (chatInput) {
          chatInput.value = '';
          chatInput.focus();
        }
        showDashboardRefinementPanel();
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
    chips.push(`<span class="status-chip status-chip--highlight">${escapeHtml(getRecommendationBadgeLabel(edital))}</span>`);
  } else if (edital?.relevance_level === 'high') {
    chips.push('<span class="status-chip status-chip--recommendation">Alta aderência</span>');
  } else if (edital?.relevance_level === 'medium') {
    chips.push('<span class="status-chip status-chip--recommendation-muted">Pode interessar</span>');
  }
  if (isClosedEdital(edital)) chips.push('<span class="status-chip status-chip--closed">Encerrado</span>');
  else chips.push('<span class="status-chip status-chip--open">Aberto</span>');
  return chips.join('');
}

function getRecommendationBadgeLabel(edital) {
  const explicit = String(edital?.recommendation_label || '').trim();
  if (explicit) return explicit;
  if (edital?.relevance_level === 'perfect') return '100% aderente ao seu perfil';
  return 'Recomendado para você';
}

function formatProfileFieldLabel(field) {
  const labels = {
    porte_empresa: 'porte da empresa',
    tipo_participante: 'tipo de participante',
    documentos_disponiveis: 'documentos disponíveis',
    estado_uf: 'estado (UF)',
    areas_interesse: 'áreas de interesse',
    setor_atuacao: 'setor de atuação',
  };
  return labels[field] || String(field || '').replace(/_/g, ' ');
}

function formatMatchedCriteriaLabel(key) {
  const labels = {
    area: 'Área/categoria',
    estado: 'Estado/abrangência',
    publico_alvo: 'Público-alvo',
    porte_empresa: 'Porte da empresa',
    setor: 'Setor',
    prazo: 'Prazo/status',
    documentos: 'Documentos',
    instrumento: 'Instrumento',
  };
  return labels[key] || String(key || '').replace(/_/g, ' ');
}

function buildRecommendationModalSection(edital) {
  const score = normalizeRelevanceScore(edital?.relevance_score);
  const level = normalizeRelevanceLevel(edital?.relevance_level);
  const label = getRecommendationBadgeLabel(edital);
  const reasons = normalizeStringList(edital?.relevance_reasons).slice(0, 4);
  const warnings = normalizeStringList(edital?.relevance_warnings).slice(0, 4);
  const missing = normalizeStringList(edital?.missing_profile_fields).slice(0, 6);
  const blockers = normalizeStringList(edital?.blockers).slice(0, 4);
  const matchedCriteria = edital?.matched_criteria && typeof edital.matched_criteria === 'object' ? edital.matched_criteria : {};
  const attended = Object.entries(matchedCriteria)
    .filter(([, value]) => value === true)
    .map(([key]) => formatMatchedCriteriaLabel(key));
  const notAttended = Object.entries(matchedCriteria)
    .filter(([, value]) => value === false)
    .map(([key]) => formatMatchedCriteriaLabel(key));

  if (!score && !level && !reasons.length && !warnings.length && !missing.length && !blockers.length) return '';

  const listHtml = (items, emptyText = '') => {
    if (!items.length) return emptyText ? `<p class="recommendation-empty">${escapeHtml(emptyText)}</p>` : '';
    return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  };

  return `
    <section class="recommendation-section" aria-label="Por que este edital foi recomendado?">
      <div class="recommendation-header">
        <div>
          <h3>Por que recomendado?</h3>
          <p>${escapeHtml(label)}${score ? ` · ${score}/100` : ''}</p>
        </div>
      </div>
      <div class="recommendation-grid">
        <article>
          <h4>Critérios atendidos</h4>
          ${listHtml([...attended, ...reasons].slice(0, 6), 'Nenhum critério atendido com segurança.')}
        </article>
        <article>
          <h4>Pontos de atenção</h4>
          ${listHtml([...blockers, ...warnings, ...notAttended.map((item) => `${item} não confirmado`)].slice(0, 6), 'Sem pontos de atenção relevantes.')}
        </article>
        <article>
          <h4>Informações faltantes</h4>
          ${listHtml(missing.map(formatProfileFieldLabel), 'Perfil suficiente para esta análise.')}
        </article>
      </div>
    </section>
  `;
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

export async function openModal(edital) {
  if (!modalOverlay || !modalContentContainer || !edital) return;
  edital = await ensureEditalDetailLoaded(edital);
  rememberAssistantOpenedCard(edital.id);

  const shareLink = safeUrl(edital.share_link || '', '');

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
  const modalLogoSrc = safeUrl(edital.icone || '', '');

  const attachmentGroups = groupAttachmentsForDisplay(Array.isArray(edital.arquivos) ? edital.arquivos : [])
    .map((group) => {
      const items = group.items
        .map((file) => {
          const url = safeUrl(file?.url || '', '');
          if (!url) return null;
          const ext = getFileExtension(file?.nome, url);
          const originalIndex = Number.isFinite(Number(file?.originalIndex)) ? Number(file.originalIndex) : 0;
          const isOfficialPage = file?.category === 'pagina_oficial' || file?.source_role === 'official_page';
          return {
            url,
            ext,
            icon: isOfficialPage ? 'fa-arrow-up-right-from-square' : getFileIcon(ext),
            name: isOfficialPage
              ? (String(file?.nome || '').trim() || 'Página oficial do edital')
              : friendlyAttachmentName(file?.nome, url, originalIndex),
            categoryLabel: String(file?.category_label || '').trim(),
          };
        })
        .filter(Boolean);

      if (!items.length) return null;
      return {
        group: group.group || 'Outros documentos',
        priority: group.priority,
        items,
      };
    })
    .filter(Boolean);
  const attachmentCount = attachmentGroups.reduce((total, group) => total + group.items.length, 0);
  const attachmentSectionSuffix = String(edital.id ?? 'edital')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64) || 'edital';
  const attachmentsWrapperId = `attachments-wrapper-${attachmentSectionSuffix}`;
  const attachmentCountLabel = attachmentCount === 1
    ? '1 arquivo disponível'
    : `${attachmentCount} arquivos disponíveis`;
  const attachmentDisplayGroups = attachmentGroups.map((group, groupIndex) => ({
    ...group,
    titleId: `attachment-group-title-${attachmentSectionSuffix}-${groupIndex}`,
    countLabel: group.items.length === 1 ? '1 arquivo' : `${group.items.length} arquivos`,
  }));

  const arquivosHtml = attachmentCount
    ? `
      <div class="attachments-section">
        <div class="attachments-summary" role="button" tabindex="0" aria-label="Abrir recursos e documentos" aria-expanded="false" aria-controls="${escapeAttr(attachmentsWrapperId)}">
          <div class="attachments-label">
            <h3>Recursos e documentos</h3>
            <span class="attachments-hint">${escapeHtml(attachmentCountLabel)}</span>
          </div>
          <i class="fas fa-chevron-right" aria-hidden="true"></i>
        </div>
        <div class="attachments-wrapper" id="${escapeAttr(attachmentsWrapperId)}" aria-hidden="true">
          <div class="attachment-groups">
            ${attachmentDisplayGroups.map((group) => `
              <section class="attachment-group" aria-labelledby="${escapeAttr(group.titleId)}">
                <div class="attachment-group-header">
                  <h4 class="attachment-group-title" id="${escapeAttr(group.titleId)}">${escapeHtml(group.group)}</h4>
                  <span class="attachment-group-count">${escapeHtml(group.countLabel)}</span>
                </div>
                <ul class="attachment-list">
                  ${group.items.map((file) => `
                    <li>
                      <a href="${escapeAttr(file.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttr(`${file.name} - ${file.categoryLabel || group.group}`)}">
                        <i class="fas ${file.icon}" aria-hidden="true"></i>
                        <span class="attachment-item-copy">
                          <strong>${escapeHtml(file.name)}</strong>
                          <small>${escapeHtml(file.categoryLabel || (file.ext ? file.ext.toUpperCase() : 'Arquivo'))}</small>
                        </span>
                      </a>
                    </li>
                  `).join('')}
                </ul>
              </section>
            `).join('')}
          </div>
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
        ${modalLogoSrc ? `<img src="${escapeAttr(modalLogoSrc)}" alt="${escapeHtml(edital.instituicao || '')}" class="modal-logo">` : '<div class="modal-logo-placeholder"><i class="fas fa-building"></i></div>'}
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

        <button class="modal-interest-btn interest-btn ${edital.has_interest ? 'is-interested' : ''}" type="button" id="modalInterestBtn" data-id="${escapeAttr(edital.id)}" title="${edital.has_interest ? 'Interesse enviado' : 'Tenho interesse'}" data-tooltip="${edital.has_interest ? 'Interesse enviado' : 'Tenho interesse'}">
          <i class="${edital.has_interest ? 'fas' : 'far'} fa-handshake"></i> <span>${edital.has_interest ? 'Interesse enviado' : 'Tenho interesse'}</span>
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
    ${buildRecommendationModalSection(edital)}

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

  const modalInterestBtn = modalContentContainer.querySelector('#modalInterestBtn');
  if (modalInterestBtn) {
    modalInterestBtn.addEventListener('click', async () => {
      const prev = modalInterestBtn.disabled;
      modalInterestBtn.disabled = true;
      try {
        const result = await handleInterestButtonClick(edital.id, modalInterestBtn);
        edital.has_interest = Boolean(result?.interested);
        updateInterestButtonUI(modalInterestBtn, Boolean(result?.interested));
        if (!result?.cancelled) {
          const message = result?.interested
            ? (result?.already ? 'Interesse já registrado para este edital.' : 'Interesse enviado ao administrador da sua conta.')
            : 'Interesse removido deste edital.';
          showToast(message, 'success', 2400);
        }
      } catch (err) {
        updateInterestButtonUI(modalInterestBtn, Boolean(edital.has_interest || interessesSet.has(String(edital.id))));
        showToast(err?.message || 'Não foi possível atualizar interesse.', 'error');
      } finally {
        modalInterestBtn.disabled = prev;
      }
    });
  }

  const modalSaveBtn = modalContentContainer.querySelector('#modalSaveBtn');
  if (modalSaveBtn) {
    modalSaveBtn.addEventListener('click', async () => {
      const prev = modalSaveBtn.disabled;
      const estadoOtimista = !Boolean(edital.is_favorite);
      modalSaveBtn.innerHTML = `<i class="${estadoOtimista ? 'fas' : 'far'} fa-star"></i> ${estadoOtimista ? 'Salvo' : 'Salvar'}`;
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
            applyFiltersAndRender({ resetPage: true });
          }
        }
      } catch (err) {
        modalSaveBtn.innerHTML = `<i class="${edital.is_favorite ? 'fas' : 'far'} fa-star"></i> ${edital.is_favorite ? 'Salvo' : 'Salvar'}`;
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
      summary.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      wrapper.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
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
  return String(htmlStr ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/(?:\r?\n){3,}/g, '\n\n')
    .trim();
}

function sanitizeAssistantReplyText(text) {
  return String(text || '')
    .replace(/^\s*Base:\s*(?:todos os cards carregados|cards vis[ií]veis no painel|cards em foco da conversa)\.?\s*$/gim, '')
    .replace(/(?:\r?\n){3,}/g, '\n\n')
    .trim();
}

function sanitizeChatStateAssistantReplies(state) {
  const safeState = ensureChatSessionState(state);
  const history = Array.isArray(safeState.conversationHistory)
    ? safeState.conversationHistory
    : [];
  let changed = false;
  const sanitizedHistory = history
    .map((turn) => {
      if (turn?.role !== 'assistant') return turn;
      const cleanText = sanitizeAssistantReplyText(turn.text);
      if (cleanText !== turn.text) changed = true;
      return { ...turn, text: cleanText };
    })
    .filter((turn) => String(turn?.text || '').trim());

  if (!changed) return safeState;
  return ensureChatSessionState({
    ...safeState,
    conversationHistory: sanitizedHistory,
    shortSummary: '',
  });
}

function normalizeBotText(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const text = s.includes('<') && s.includes('>') ? stripHtmlPreserveBreaks(s) : s;
  return sanitizeAssistantReplyText(text);
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

export function safeChatUrl(value) {
  const rawInput = String(value ?? '');
  if (/[\u0000-\u001F\u007F]/.test(rawInput)) return '';

  const raw = rawInput.trim();
  if (!raw || raw !== rawInput || /\s/.test(raw) || /[<>"'`\\]/.test(raw)) return '';

  const schemeMatch = raw.match(/^([a-z][a-z0-9+.-]*):/i);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return '';
    if (!/^https?:\/\//i.test(raw)) return '';
    try {
      const parsed = new URL(raw);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
    } catch (_) {
      return '';
    }
  }

  if (raw.startsWith('//') || raw.startsWith('/\\')) return '';
  if (raw.startsWith('/')) return raw;
  if (raw.startsWith('./') && raw.length > 2) return raw;
  if (raw.startsWith('../') || raw === '.' || raw === '..' || raw.startsWith('#') || raw.startsWith('?')) return '';
  if (raw.includes(':')) return '';

  return /^[A-Za-z0-9][A-Za-z0-9._~!$&()*+,;=@/%?-]*$/.test(raw) ? raw : '';
}

function renderAssistantInlineMarkdown(text) {
  const safe = escapeHtml(String(text ?? ''));
  return safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

export function renderSimpleMarkdown(text) {
  const raw = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const linkPattern = /\[([^\]\n]{1,300})\]\(((?:[^()\n]|\([^()\n]*\)){1,2048})\)/g;
  let lastIndex = 0;
  let html = '';
  let match;

  while ((match = linkPattern.exec(raw)) !== null) {
    const [fullMatch, label, url] = match;
    html += renderAssistantInlineMarkdown(raw.slice(lastIndex, match.index));

    const safeUrl = safeChatUrl(url);
    if (safeUrl) {
      html += `<a href="${escapeAttr(safeUrl)}" target="_blank" rel="noopener noreferrer">${renderAssistantInlineMarkdown(label)}</a>`;
    } else {
      html += renderAssistantInlineMarkdown(label);
    }

    lastIndex = match.index + fullMatch.length;
  }

  html += renderAssistantInlineMarkdown(raw.slice(lastIndex));
  return html.replace(/\n/g, '<br>');
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
    bubble.innerHTML = renderSimpleMarkdown(sanitizeAssistantReplyText(text));
  } else {
    bubble.textContent = String(text ?? '');
  }
  msg.appendChild(bubble);
  if (sender === 'bot') applySourcesDetails(msg, sources);

  messageContainer.appendChild(msg);

  scrollToBottom();
  return msg;
}

function setMessageText(msgEl, text, sources = null, opts = {}) {
  if (!msgEl) return;
  const bubble = msgEl.querySelector('.bubble');
  if (bubble) bubble.innerHTML = renderSimpleMarkdown(sanitizeAssistantReplyText(text));
  if (msgEl.classList.contains('bot')) {
    applySourcesDetails(msgEl, sources);
  }
  if (!opts?.keepTyping) {
    msgEl.classList.remove('is-typing');
  }
}

const LEGACY_ASSISTANT_LOADING_TEXTS = [
  'Analisando os editais...',
  'Aplicando filtros...',
  'Conferindo os cards...',
  'Montando resposta...',
];

function stopLegacyAssistantLoading(controller) {
  if (!controller || controller.stopped) return;
  if (controller.intervalId) clearInterval(controller.intervalId);
  controller.stopped = true;
  if (activeLegacyAssistantLoading === controller) {
    activeLegacyAssistantLoading = null;
  }
}

function startLegacyAssistantLoading(messageElement) {
  stopLegacyAssistantLoading(activeLegacyAssistantLoading);

  const controller = {
    intervalId: null,
    stopped: false,
  };
  let index = 0;

  activeLegacyAssistantLoading = controller;
  setMessageText(messageElement, LEGACY_ASSISTANT_LOADING_TEXTS[index], null, { keepTyping: true });

  controller.intervalId = setInterval(() => {
    if (controller.stopped) return;
    index = (index + 1) % LEGACY_ASSISTANT_LOADING_TEXTS.length;
    setMessageText(messageElement, LEGACY_ASSISTANT_LOADING_TEXTS[index], null, { keepTyping: true });
    scrollToBottom();
  }, 800);

  return controller;
}

function updateStreamTypingMessage(msgEl, streamState, { forceDone = false } = {}) {
  if (!msgEl) return;
  const finalText = String(streamState?.text || '').trim() || '...';
  const normalizedSources = normalizeSources(streamState?.sources);
  setMessageText(msgEl, finalText, normalizedSources, { keepTyping: !forceDone && !streamState?.done });
}

function consumeSsePayload(typingMsg, streamState, payload) {
  const nextState = applyChatStreamPayload(streamState, payload);
  if (Array.isArray(nextState?.sources)) {
    nextState.sources = normalizeSources(nextState.sources);
  }

  if (payload?.type === 'meta' && payload?.semantic_rag) {
    console.info('[CHAT][semantic_rag]', payload.semantic_rag);
  }

  const shouldRefreshText =
    payload?.type === 'delta' ||
    payload?.type === 'sources' ||
    payload?.type === 'done';

  if (shouldRefreshText) {
    updateStreamTypingMessage(typingMsg, nextState, { forceDone: payload?.type === 'done' });
    scrollToBottom();
  }
  return nextState;
}

async function tryChatStreamRequest({
  endpoint,
  requestBody,
  typingMsg,
}) {
  const controller = new AbortController();
  chatRequestTracker.setActiveController(controller);

  let streamState = {
    text: '',
    sources: [],
    isTyping: true,
    done: false,
    donePayload: null,
    meta: null,
    error: '',
  };
  let sseBuffer = '';

  try {
    const response = await apiFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody || {}),
      signal: controller.signal,
    });

    if (!response?.ok || !response.body) {
      return { ok: false, status: Number(response?.status || 0) };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunkText = decoder.decode(value, { stream: true });
      const parsed = readSsePayloadsFromBuffer(sseBuffer, chunkText);
      sseBuffer = parsed.remainder;

      for (const payload of parsed.payloads) {
        streamState = consumeSsePayload(typingMsg, streamState, payload);
      }
    }

    const trailing = decoder.decode();
    if (trailing) {
      const parsedTrailing = readSsePayloadsFromBuffer(sseBuffer, trailing);
      sseBuffer = parsedTrailing.remainder;
      for (const payload of parsedTrailing.payloads) {
        streamState = consumeSsePayload(typingMsg, streamState, payload);
      }
    }

    if (!streamState.done && String(sseBuffer || '').trim()) {
      const finalPass = readSsePayloadsFromBuffer('', `${sseBuffer}\n\n`);
      for (const payload of finalPass.payloads) {
        streamState = consumeSsePayload(typingMsg, streamState, payload);
      }
      sseBuffer = finalPass.remainder;
    }

    if (streamState.error) {
      return { ok: false, status: 0, error: streamState.error };
    }

    if (!streamState.done) {
      return { ok: false, status: 0, error: 'stream-incomplete' };
    }

    const extracted = extractEmbeddedSources(streamState.text || '');
    const finalText = normalizeBotText(extracted.text || streamState.text || '');
    const finalSources = normalizeSources(streamState.sources, extracted.names);
    setMessageText(typingMsg, finalText, finalSources);

    return {
      ok: true,
      text: finalText,
      sources: finalSources,
      donePayload: streamState.donePayload || null,
      meta: streamState.meta || null,
    };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, aborted: true };
    }
    console.warn('[CHAT][stream] falha no stream SSE', err);
    return {
      ok: false,
      status: 0,
      error: String(err?.message || err || 'stream-error'),
    };
  } finally {
    chatRequestTracker.clearActiveController(controller);
  }
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

const DASHBOARD_LISTING_QUESTION_HINTS = [
  'quais editais',
  'quantos editais',
  'mostre editais',
  'liste editais',
  'editais abertos',
  'editais em',
  'vencem',
  'prazo nesta semana',
  'tem edital',
];

const DASHBOARD_LISTING_ACTION_HINTS = [
  'mostre',
  'mostrar',
  'liste',
  'listar',
  'quais',
  'quantos',
  'tem',
  'buscar',
  'busque',
  'busca',
  'procura',
  'procure',
  'procurar',
  'oportunidade',
  'oportunidades',
  'chamada',
  'chamadas',
  'programa',
  'programas',
];

const DASHBOARD_OPPORTUNITY_HINTS = [
  'edital',
  'editais',
  'oportunidade',
  'oportunidades',
  'chamada',
  'chamadas',
  'programa',
  'programas',
  'fomento',
  'financiamento',
  'apoio',
  'linha',
  'linhas',
  'selecao',
  'selecoes',
];

const DASHBOARD_REFINEMENT_PREFIX_HINTS = [
  'quero',
  'em',
  'no',
  'na',
  'so',
  'só',
  'apenas',
  'filtra',
  'filtrar',
  'filtre',
  'agora',
  'da',
  'do',
  'de',
  'com',
  'vencendo',
];

const DASHBOARD_REFINEMENT_CATEGORY_HINTS = [
  'tecnologia',
  'inovacao',
  'inovação',
  'saude',
  'saúde',
  'educacao',
  'educação',
  'agricultura',
  'cultura',
  'ciencia',
  'ciência',
  'pesquisa',
  'meio ambiente',
  'sustentabilidade',
  'social',
  'esporte',
  'infraestrutura',
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

function isDashboardListingQuestion(question) {
  if (isConceptualOrAdvisoryQuestion(question)) return false;
  if (isDocumentalSemanticQuestion(question)) return false;
  const normalizedQuery = normalizeAssistantQuery(question);
  if (!normalizedQuery) return false;
  if (messageHasAnyPhrase(normalizedQuery, DASHBOARD_LISTING_QUESTION_HINTS)) return true;

  const hasListingAction = messageHasAnyPhrase(normalizedQuery, DASHBOARD_LISTING_ACTION_HINTS);
  const hasOpportunityTerm = messageHasAnyPhrase(normalizedQuery, DASHBOARD_OPPORTUNITY_HINTS);
  if (hasListingAction && hasOpportunityTerm) return true;

  return (
    /\bmostre\s+(os\s+|as\s+)?editais\b/.test(normalizedQuery) ||
    /\bliste\s+(os\s+|as\s+)?editais\b/.test(normalizedQuery) ||
    /\beditais\s+(em|no|na|nos|nas)\b/.test(normalizedQuery)
  );
}

function hasDashboardSearchMemory() {
  const lastQuestion = String(assistantSemanticMemory?.lastQuestion || '').trim();
  const resultIds = Array.isArray(assistantSemanticMemory?.lastResultIds)
    ? assistantSemanticMemory.lastResultIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  return Boolean(lastQuestion || resultIds.length);
}

function getDashboardStateAliases() {
  const aliases = [];
  Object.entries(ESTADO_LABELS).forEach(([uf, name]) => {
    aliases.push({ alias: normalizeAssistantQuery(uf), value: uf });
    aliases.push({ alias: normalizeAssistantQuery(name), value: uf });
  });
  return aliases
    .filter((item) => item.alias)
    .sort((a, b) => b.alias.length - a.alias.length);
}

function detectDashboardRefinementStates(normalizedQuery) {
  if (!normalizedQuery) return [];
  const found = [];
  const seen = new Set();

  getDashboardStateAliases().forEach(({ alias, value }) => {
    if (!alias || seen.has(value)) return;
    if (alias === 'para' && !/(?:^|\s)(?:pa|estado\s+do\s+para|estado\s+de\s+para|no\s+para|em\s+para)(?:\s|$)/.test(normalizedQuery)) {
      return;
    }
    const pattern = alias.length <= 2
      ? new RegExp(`(?:^|\\s)${alias}(?:\\s|$)`)
      : new RegExp(`(?:^|\\s)${alias}(?:\\s|$)`);
    if (!pattern.test(normalizedQuery)) return;
    seen.add(value);
    found.push(value);
  });

  return found;
}

function detectDashboardRefinementStatus(normalizedQuery) {
  if (!normalizedQuery) return [];
  const wantsClosed = hasAnyChatHint(normalizedQuery, ['encerrado', 'encerrados', 'encerrada', 'encerradas', 'fechado', 'fechados', 'fechada', 'fechadas', 'vencido', 'vencidos', 'expirado']);
  const wantsOpen = !wantsClosed && hasAnyChatHint(normalizedQuery, ['aberto', 'abertos', 'aberta', 'abertas', 'vigente', 'vigentes', 'ativo', 'ativos']);
  if (wantsOpen) return ['aberto'];
  if (wantsClosed) return ['encerrado'];
  return [];
}

function detectDashboardRefinementInstitution(question, normalizedQuery) {
  const raw = String(question || '');
  const acronymMatch = raw.match(/\b[A-ZÀ-Ý]{3,}(?:[-/][A-ZÀ-Ý0-9]{2,})?\b/);
  if (acronymMatch) {
    const acronym = acronymMatch[0].trim();
    if (!ESTADO_LABELS[acronym.toUpperCase()]) return acronym;
  }

  const institutions = Array.from(
    new Set(
      (Array.isArray(editaisOriginais) ? editaisOriginais : [])
        .map((item) => String(item?.instituicao || '').trim())
        .filter(Boolean)
    )
  ).sort((a, b) => b.length - a.length);

  const exactMatch = institutions.find((institution) => {
    const normalizedInstitution = normalizeAssistantQuery(institution);
    return normalizedInstitution && new RegExp(`(?:^|\\s)${normalizedInstitution.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`).test(normalizedQuery);
  });
  if (exactMatch) return exactMatch;

  const requestedTokens = normalizedQuery.split(/\s+/).filter((token) => (
    token.length >= 3 &&
    !['da', 'de', 'do', 'das', 'dos', 'quero', 'filtra', 'filtrar', 'por', 'em', 'so', 'apenas'].includes(token)
  ));
  const tokenMatch = institutions.find((institution) => {
    const tokens = normalizeAssistantQuery(institution).split(/\s+/).filter(Boolean);
    return requestedTokens.some((token) => (
      /^[a-z0-9]{4,12}$/.test(token) &&
      !DASHBOARD_REFINEMENT_CATEGORY_HINTS.some((hint) => normalizeAssistantQuery(hint) === token) &&
      tokens.includes(token)
    ));
  });
  if (tokenMatch) {
    const matchedToken = requestedTokens.find((token) => normalizeAssistantQuery(tokenMatch).split(/\s+/).includes(token));
    return matchedToken ? matchedToken.toUpperCase() : tokenMatch;
  }

  const match = institutions.find((institution) => {
    const normalizedInstitution = normalizeAssistantQuery(institution);
    if (!normalizedInstitution || normalizedInstitution.length < 6) return false;
    return normalizedQuery.includes(normalizedInstitution);
  });
  return match || '';
}

function detectDashboardRefinementCategory(normalizedQuery) {
  if (!normalizedQuery) return '';
  const option = CATEGORY_OPTIONS.find((item) => {
    const valueKey = normalizeAssistantQuery(item.value);
    const labelKey = normalizeAssistantQuery(item.label);
    return (valueKey && normalizedQuery.includes(valueKey)) || (labelKey && normalizedQuery.includes(labelKey));
  });
  if (option) return option.label;

  const hint = DASHBOARD_REFINEMENT_CATEGORY_HINTS.find((item) => normalizedQuery.includes(normalizeAssistantQuery(item)));
  return hint || '';
}

function detectDashboardRefinementDeadline(normalizedQuery) {
  if (!normalizedQuery) return false;
  return (
    hasAnyChatHint(normalizedQuery, ['semana', 'esta semana', 'essa semana', 'nesta semana', 'proximos dias', 'próximos dias', '7 dias']) ||
    hasAnyChatHint(normalizedQuery, ['vencem', 'vence', 'vencendo', 'prazo', 'prazos'])
  ) && (
    hasAnyChatHint(normalizedQuery, ['semana', 'proximos dias', 'próximos dias', '7 dias']) ||
    hasAnyChatHint(normalizedQuery, ['vencem', 'vence', 'vencendo'])
  );
}

function getDashboardRefinementSignals(question) {
  const normalizedQuery = normalizeAssistantQuery(question);
  if (!normalizedQuery || isConceptualOrAdvisoryQuestion(question) || isDocumentalSemanticQuestion(question)) {
    return {
      hasSignal: false,
      isComplementary: false,
      states: [],
      status: [],
      institution: '',
      category: '',
      deadline: false,
    };
  }

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const startsLikeRefinement = messageHasAnyPhrase(
    tokens.slice(0, 2).join(' '),
    DASHBOARD_REFINEMENT_PREFIX_HINTS
  ) || DASHBOARD_REFINEMENT_PREFIX_HINTS.includes(tokens[0]);
  const isShort = tokens.length <= 8;
  const states = detectDashboardRefinementStates(normalizedQuery);
  const status = detectDashboardRefinementStatus(normalizedQuery);
  const institution = detectDashboardRefinementInstitution(question, normalizedQuery);
  const category = detectDashboardRefinementCategory(normalizedQuery);
  const deadline = detectDashboardRefinementDeadline(normalizedQuery);
  const hasSignal = Boolean(states.length || status.length || institution || category || deadline);

  return {
    hasSignal,
    isComplementary: isShort || startsLikeRefinement || /\b(filtr|apenas|so|só|agora)\b/.test(normalizedQuery),
    states,
    status,
    institution,
    category,
    deadline,
  };
}

function dashboardFiltersFromRefinementQuestion(question) {
  const signals = getDashboardRefinementSignals(question);
  return normalizeDashboardFilterState({
    estado: signals.states,
    instituicoes: signals.institution ? [signals.institution] : [],
    categories: signals.category ? [signals.category] : [],
    status: signals.status,
    deadline_range: signals.deadline ? 'next_7_days' : '',
  });
}

function isDashboardRefinementQuestion(question) {
  if (isDocumentalSemanticQuestion(question)) return false;
  if (!hasDashboardSearchMemory()) return false;
  const signals = getDashboardRefinementSignals(question);
  return Boolean(signals.hasSignal && signals.isComplementary);
}

function getDashboardBaseQuestionForRefinement() {
  const lastQuestion = String(assistantSemanticMemory?.lastQuestion || '').trim();
  if (!lastQuestion) return 'a última busca do dashboard';

  let baseQuestion = lastQuestion;
  for (let i = 0; i < 5; i += 1) {
    const enrichedMatch = baseQuestion.match(/^Refine a busca anterior:\s*(.*?)\.\s*Novo filtro:/i);
    if (enrichedMatch?.[1]) {
      baseQuestion = String(enrichedMatch[1] || '').trim();
      continue;
    }
    const prefixMatch = baseQuestion.match(/^Refine a busca anterior:\s*(.+)$/i);
    if (prefixMatch?.[1]) {
      baseQuestion = String(prefixMatch[1] || '').trim();
      continue;
    }
    break;
  }
  return baseQuestion || 'a última busca do dashboard';
}

function buildDashboardRefinementQuestion(question, appliedFilters = null) {
  const baseQuestion = getDashboardBaseQuestionForRefinement();
  const filtersLabel = formatDashboardFiltersForPrompt(appliedFilters || assistantSemanticMemory?.lastDashboardFilters);
  const filtersPart = filtersLabel ? ` Filtros já aplicados: ${filtersLabel}.` : '';
  return `Refine a busca anterior: ${baseQuestion}.${filtersPart} Novo filtro: ${String(question || '').trim()}.`;
}

function getDashboardRefinementText(question) {
  const text = String(question || '').trim();
  const match = text.match(/Novo filtro:\s*(.+?)\.?\s*$/i);
  return String(match?.[1] || '').trim();
}

function formatDashboardCategoryLabel(value) {
  const canonical = toCanonicalCategory(value);
  const canonicalKey = normalizeCategoryKey(canonical);
  const option = CATEGORY_OPTIONS.find((item) => (
    normalizeCategoryKey(item.value) === canonicalKey ||
    normalizeCategoryKey(item.label) === canonicalKey
  ));
  return option?.label || canonical;
}

function findDashboardCategoryLabel(plan, question) {
  const filters = plan?.filters && typeof plan.filters === 'object' ? plan.filters : {};
  const area = Array.isArray(filters.area) ? filters.area.find(Boolean) : '';
  if (area) return formatDashboardCategoryLabel(area);

  const questionKey = normalizeCategoryKey(question);
  if (!questionKey) return '';
  const option = CATEGORY_OPTIONS.find((item) => {
    const valueKey = normalizeCategoryKey(item.value);
    const labelKey = normalizeCategoryKey(item.label);
    return questionKey.includes(valueKey) || questionKey.includes(labelKey);
  });
  return option?.label || '';
}

function formatDashboardStateReference(uf, question, { preferFullName = false } = {}) {
  const rawLabel = String(normalizeEstadoValue(uf) || uf || '').trim();
  const code = rawLabel.toUpperCase();
  const name = ESTADO_LABELS[code] || '';
  const isKnownUf = Boolean(name);
  const normalizedQuestion = normalizeAssistantQuery(question);
  const questionUsesName = Boolean(name && normalizedQuestion.includes(normalizeAssistantQuery(name)));
  if (preferFullName || questionUsesName) return name || rawLabel || code;
  return isKnownUf ? code : rawLabel;
}

function getDashboardKeywordReference(plan) {
  const filters = plan?.filters && typeof plan.filters === 'object' ? plan.filters : {};
  const keywords = Array.isArray(filters.keywords) ? filters.keywords : [];
  const clean = keywords
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item) => !CHAT_GENERIC_QUERY_KEYWORDS.has(normalizeAssistantQuery(item)));
  return clean.slice(0, 2).join(' e ');
}

function describeDashboardRefinement(plan, question, noun) {
  const refinementText = getDashboardRefinementText(question);
  const referenceText = refinementText || question;
  const normalizedReference = normalizeAssistantQuery(referenceText);
  const signals = getDashboardRefinementSignals(referenceText);
  const filters = plan?.filters && typeof plan.filters === 'object' ? plan.filters : {};
  const status = Array.isArray(filters.status) ? filters.status : [];
  const estados = Array.isArray(filters.estado) ? filters.estado : [];
  const instituicoes = Array.isArray(filters.instituicao) ? filters.instituicao : [];
  const deadlineDays = Number(filters.deadline_days || 0);
  const stateSuffix = estados.length
    ? ` em ${formatDashboardStateReference(estados[0], referenceText)}`
    : '';
  const contextLabel = instituicoes.length
    ? `por ${instituicoes[0]}${stateSuffix}`
    : (estados.length ? `para ${formatDashboardStateReference(estados[0], referenceText)}` : '');
  const openSuffix = status.includes('aberto') && !status.includes('encerrado')
    ? `, mantendo apenas ${noun.openPlural}`
    : '';

  if (signals.institution) {
    return `por ${signals.institution}${stateSuffix}${openSuffix}`;
  }
  if (signals.states.length) {
    return instituicoes.length
      ? `por ${instituicoes[0]} em ${formatDashboardStateReference(signals.states[0], referenceText)}${openSuffix}`
      : `para ${formatDashboardStateReference(signals.states[0], referenceText)}${openSuffix}`;
  }
  if (signals.status.includes('aberto')) {
    return contextLabel
      ? `${contextLabel}, mantendo apenas ${noun.openPlural}`
      : `para ${noun.openPlural}`;
  }
  if (signals.status.includes('encerrado')) {
    const closedLabel = noun.plural === 'editais' ? 'editais encerrados' : 'oportunidades encerradas';
    return contextLabel ? `${contextLabel}, mantendo apenas ${closedLabel}` : `para ${closedLabel}`;
  }
  if (signals.deadline) {
    return contextLabel ? `${contextLabel}, com prazo nesta semana` : 'para prazos desta semana';
  }
  if (signals.category) {
    return `para ${formatDashboardCategoryLabel(signals.category)}${openSuffix}`;
  }

  const detectedInstitution = detectDashboardRefinementInstitution(referenceText, normalizedReference);
  if (detectedInstitution) {
    return `por ${detectedInstitution}${stateSuffix}${openSuffix}`;
  }
  const detectedStates = detectDashboardRefinementStates(normalizedReference);
  if (detectedStates.length) {
    return instituicoes.length
      ? `por ${instituicoes[0]} em ${formatDashboardStateReference(detectedStates[0], referenceText)}${openSuffix}`
      : `para ${formatDashboardStateReference(detectedStates[0], referenceText)}${openSuffix}`;
  }
  const detectedStatus = detectDashboardRefinementStatus(normalizedReference);
  if (detectedStatus.includes('aberto')) return contextLabel ? `${contextLabel}, mantendo apenas ${noun.openPlural}` : `para ${noun.openPlural}`;
  if (detectedStatus.includes('encerrado')) {
    const closedLabel = noun.plural === 'editais' ? 'editais encerrados' : 'oportunidades encerradas';
    return contextLabel ? `${contextLabel}, mantendo apenas ${closedLabel}` : `para ${closedLabel}`;
  }
  if (detectDashboardRefinementDeadline(normalizedReference)) return contextLabel ? `${contextLabel}, com prazo nesta semana` : 'para prazos desta semana';

  if (status.includes('aberto') && !status.includes('encerrado')) {
    return `para ${noun.openPlural}`;
  }
  if (status.includes('encerrado') && !status.includes('aberto')) {
    return `para ${noun.plural === 'editais' ? 'editais encerrados' : 'oportunidades encerradas'}`;
  }
  if ((deadlineDays > 0 && deadlineDays <= 7) || detectDashboardRefinementDeadline(normalizedReference)) {
    return 'para prazos desta semana';
  }
  if (instituicoes.length) {
    return `por ${instituicoes[0]}${stateSuffix}`;
  }

  const categoryLabel = findDashboardCategoryLabel(plan, referenceText);
  if (categoryLabel) {
    return `para ${categoryLabel}`;
  }

  return 'com o novo filtro';
}

function buildDashboardShortReply(plan, question) {
  if (!plan || typeof plan !== 'object') return '';
  if (plan.intent === 'insufficient_context' && String(plan.suggested_reply || '').trim()) {
    return sanitizeAssistantReplyText(plan.suggested_reply);
  }

  const filters = plan.filters && typeof plan.filters === 'object' ? plan.filters : {};
  const total = Math.max(0, Number(plan?.result_summary?.total || 0));
  const totalLabel = String(Number.isFinite(total) ? Math.round(total) : 0);
  const normalizedQuestion = normalizeAssistantQuery(question);
  const isCountQuestion = plan.intent === 'count_cards' || /\b(quantos|quantas|total|contagem)\b/.test(normalizedQuestion);
  const wantsOpportunityLanguage = messageHasAnyPhrase(normalizedQuestion, [
    'oportunidade',
    'oportunidades',
    'chamada',
    'chamadas',
    'programa',
    'programas',
    'fomento',
    'financiamento',
    'apoio',
  ]);
  const noun = wantsOpportunityLanguage
    ? {
      singular: 'oportunidade',
      plural: 'oportunidades',
      relatedSingular: 'relacionada',
      relatedPlural: 'relacionadas',
      openSingular: 'oportunidade aberta',
      openPlural: 'oportunidades abertas',
      below: 'as principais',
      all: 'todas',
    }
    : {
      singular: 'edital',
      plural: 'editais',
      relatedSingular: 'relacionado',
      relatedPlural: 'relacionados',
      openSingular: 'edital aberto',
      openPlural: 'editais abertos',
      below: 'os principais',
      all: 'todos',
    };
  const itemLabel = total === 1 ? noun.singular : noun.plural;
  const relatedLabel = total === 1 ? noun.relatedSingular : noun.relatedPlural;
  const openLabel = total === 1 ? noun.openSingular : noun.openPlural;
  const refinementText = getDashboardRefinementText(question);

  if (refinementText) {
    const filterLabel = describeDashboardRefinement(plan, question, noun);
    if (total <= 0) {
      return sanitizeAssistantReplyText(`Filtrei a busca anterior ${filterLabel}. Não encontrei resultados nesse recorte.`);
    }
    const usesGenericCount = (
      filterLabel.includes('abertas') ||
      filterLabel.includes('encerradas') ||
      filterLabel.includes('prazos') ||
      filterLabel.includes('prazo') ||
      filterLabel.includes('mantendo apenas')
    );
    const countLabel = usesGenericCount ? (total === 1 ? 'resultado' : 'resultados') : itemLabel;
    return sanitizeAssistantReplyText(`Filtrei a busca anterior ${filterLabel}. Encontrei ${totalLabel} ${countLabel} e separei ${noun.below} abaixo.`);
  }

  const status = Array.isArray(filters.status) ? filters.status : [];
  const estados = Array.isArray(filters.estado) ? filters.estado : [];
  const instituicoes = Array.isArray(filters.instituicao) ? filters.instituicao : [];
  const deadlineDays = Number(filters.deadline_days || 0);
  const categoryLabel = findDashboardCategoryLabel(plan, question);
  const keywordLabel = getDashboardKeywordReference(plan);
  const hasDeadlineIntent =
    (deadlineDays > 0 && deadlineDays <= 7) ||
    hasAnyChatHint(normalizedQuestion, ['vencem', 'vence', 'prazo nesta semana', 'prazo nessa semana', 'esta semana', 'nesta semana']);
  const wantsOpen = status.includes('aberto') && !status.includes('encerrado');

  let firstSentence = '';
  if (total <= 0) {
    firstSentence = 'Não encontrei editais para esse recorte.';
  } else if (hasDeadlineIntent) {
    firstSentence = `Encontrei ${totalLabel} ${total === 1 ? 'edital com prazo nesta semana' : 'editais com prazo nesta semana'}.`;
  } else if (wantsOpen && estados.length) {
    const stateLabel = formatDashboardStateReference(estados[0], question);
    firstSentence = `Encontrei ${totalLabel} ${openLabel} em ${stateLabel}.`;
  } else if (wantsOpen) {
    firstSentence = `Encontrei ${totalLabel} ${openLabel}.`;
  } else if (categoryLabel) {
    firstSentence = `Encontrei ${totalLabel} ${itemLabel} ${relatedLabel} a ${categoryLabel}.`;
  } else if (estados.length) {
    const stateLabel = formatDashboardStateReference(estados[0], question, { preferFullName: isCountQuestion });
    firstSentence = isCountQuestion
      ? `Encontrei ${totalLabel} ${itemLabel} ${relatedLabel} a ${stateLabel}.`
      : `Encontrei ${totalLabel} ${itemLabel} em ${stateLabel}.`;
  } else if (instituicoes.length) {
    firstSentence = `Encontrei ${totalLabel} ${itemLabel} ${relatedLabel} a ${instituicoes[0]}.`;
  } else if (keywordLabel) {
    firstSentence = `Encontrei ${totalLabel} ${itemLabel} ${relatedLabel} a ${keywordLabel}.`;
  } else {
    firstSentence = `Encontrei ${totalLabel} ${itemLabel} para esse recorte.`;
  }

  let secondSentence = '';
  if (total <= 0) {
    secondSentence = 'Tente ajustar tema, estado ou prazo.';
  } else if (hasDeadlineIntent) {
    secondSentence = 'Mostrei os mais urgentes abaixo.';
  } else if (isCountQuestion) {
    secondSentence = 'Você pode ver todos aplicando o filtro no painel.';
  } else if (total > 5) {
    secondSentence = `Separei ${noun.below} abaixo e você pode aplicar o filtro para ver ${noun.all} no painel.`;
  } else {
    secondSentence = `Separei ${noun.below} abaixo.`;
  }

  return sanitizeAssistantReplyText(`${firstSentence} ${secondSentence}`);
}

function buildDashboardPlanFromLegacyPayload(payload, { intent = 'list_cards' } = {}) {
  if (!payload || typeof payload !== 'object') return null;
  const filters = payload.filters && typeof payload.filters === 'object' ? payload.filters : {};
  const resultIds = Array.isArray(payload.result_ids)
    ? payload.result_ids.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const total = Number(payload.total || resultIds.length || 0);
  return {
    intent: intent || payload.intent || 'list_cards',
    filters: {
      estado: Array.isArray(filters.estado) ? filters.estado : [],
      status: Array.isArray(filters.status) ? filters.status : [],
      instituicao: Array.isArray(filters.instituicoes) ? filters.instituicoes : [],
      area: Array.isArray(filters.categories) ? filters.categories : [],
      deadline_days: filters.deadline_range === 'next_7_days' ? 7 : 0,
      keywords: Array.isArray(filters.keywords) ? filters.keywords : [],
    },
    matched_card_ids: resultIds,
    result_summary: {
      total: Number.isFinite(total) ? total : resultIds.length,
      returned: resultIds.length,
    },
    ui_action: {
      type: 'highlight_cards_and_offer_filter',
      cta: '',
      auto_apply: false,
    },
    suggested_reply: String(payload.summary || '').trim(),
    query: String(payload.query || '').trim(),
  };
}

function dashboardInstitutionMatches(cardInstitution, requestedInstitution) {
  const cardRaw = String(cardInstitution || '').trim();
  const requestedRaw = String(requestedInstitution || '').trim();
  const card = normalizeAssistantQuery(cardRaw);
  const requested = normalizeAssistantQuery(requestedRaw);
  if (!card || !requested) return false;
  if (card === requested) return true;

  const requestedIsSigla = /^[a-z0-9]{3,12}$/.test(requested) && !requested.includes(' ');
  const cardTokens = card.split(/\s+/).filter(Boolean);
  if (requestedIsSigla) {
    return cardTokens.includes(requested);
  }

  return card.includes(requested) || requested.includes(card);
}

function dashboardCardMatchesFilters(card, rawFilters) {
  const filters = normalizeDashboardFilterState(rawFilters);
  if (!card) return false;

  if (filters.estado.length) {
    const cardUf = String(normalizeEstadoValue(card?.estado) || '').trim().toUpperCase();
    if (!filters.estado.includes(cardUf)) return false;
  }

  if (filters.instituicoes.length) {
    const cardInstitution = String(card?.instituicao || '').trim();
    if (!filters.instituicoes.some((institution) => dashboardInstitutionMatches(cardInstitution, institution))) {
      return false;
    }
  }

  if (filters.categories.length) {
    const cardCategory = toCanonicalCategory(card?.area || '');
    if (!filters.categories.some((category) => toCanonicalCategory(category) === cardCategory)) return false;
  }

  if (filters.status.length) {
    const isOpen = isOpenEditalForChat(card);
    const wantsOpen = filters.status.includes('aberto');
    const wantsClosed = filters.status.includes('encerrado');
    if (wantsOpen && !wantsClosed && !isOpen) return false;
    if (wantsClosed && !wantsOpen && isOpen) return false;
  }

  if (filters.deadline_range === 'next_7_days') {
    if (!isOpenEditalForChat(card) || !isDeadlineWithinNextDays(card, 7)) return false;
  }

  if (filters.keywords.length) {
    const haystack = normalizeAssistantQuery([
      card?.titulo,
      card?.descricao,
      card?.instituicao,
      card?.estado,
      card?.area,
      ...(Array.isArray(card?.tags) ? card.tags : []),
    ].filter(Boolean).join(' '));
    if (!filters.keywords.some((keyword) => haystack.includes(normalizeAssistantQuery(keyword)))) {
      return false;
    }
  }

  return true;
}

function applyAccumulatedFiltersToDashboardPlan(plan, rawFilters) {
  if (!plan || typeof plan !== 'object') return plan;
  const filters = normalizeDashboardFilterState(rawFilters);
  if (!hasDashboardFilterValue(filters)) return plan;

  const allCards = Array.isArray(editaisOriginais) ? editaisOriginais : [];
  const filteredCards = allCards.filter((card) => dashboardCardMatchesFilters(card, filters));
  const filteredIds = filteredCards.map((card) => String(card?.id ?? '')).filter(Boolean);

  return {
    ...plan,
    filters: {
      ...(plan.filters || {}),
      estado: filters.estado,
      instituicao: filters.instituicoes,
      area: filters.categories,
      status: filters.status,
      deadline_days: filters.deadline_range === 'next_7_days' ? 7 : 0,
      keywords: filters.keywords,
    },
    matched_card_ids: filteredIds,
    result_summary: {
      ...(plan.result_summary || {}),
      total: filteredIds.length,
      returned: filteredIds.length,
    },
  };
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
  if (edital.fluxo_continuo === true) return true;

  const deadline = parseChatDeadline(edital);
  if (deadline !== null) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return deadline >= today.getTime();
  }

  if (typeof edital.is_open === 'boolean') return edital.is_open;
  return true;
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

  if (keywords.length && fuseInstance) {
    items = fuseInstance.search(keywords.join(' ')).map((r) => r.item);
  } else if (keywords.length) {
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

const MAX_CHAT_UI_OPTIONS = 10;
const MAX_CHAT_UI_RESULT_IDS = 700;

function limitAssistantSearchPayloadForUi(rawPayload) {
  const normalized = normalizeAssistantSearchPayload(rawPayload);
  if (!normalized) return null;
  return {
    ...normalized,
    result_ids: (normalized.result_ids || []).map((id) => String(id || '').trim()).filter(Boolean).slice(0, MAX_CHAT_UI_RESULT_IDS),
    filters: {
      status: Array.isArray(normalized.filters?.status) ? [...normalized.filters.status] : [],
      deadline_range: String(normalized.filters?.deadline_range || '').trim(),
      categories: Array.isArray(normalized.filters?.categories) ? [...normalized.filters.categories] : [],
      instituicoes: Array.isArray(normalized.filters?.instituicoes) ? [...normalized.filters.instituicoes] : [],
      estado: Array.isArray(normalized.filters?.estado) ? [...normalized.filters.estado] : [],
      keywords: Array.isArray(normalized.filters?.keywords) ? [...normalized.filters.keywords] : [],
    },
  };
}

function normalizeDashboardOptionForUiState(option) {
  if (!option || typeof option !== 'object') return null;
  const action = String(option.action || '').trim();
  const title = String(option.title || option.label || '').trim();
  if (!action || !title) return null;

  const normalized = {
    action,
    title: truncateText(title, 160),
  };
  if (option.id !== null && option.id !== undefined) normalized.id = String(option.id);
  if (option.query) normalized.query = truncateText(option.query, 260);
  if (option.meta) normalized.meta = truncateText(option.meta, 220);
  const payload = limitAssistantSearchPayloadForUi(option.payload || option.search_payload || option.searchPayload);
  if (payload) normalized.payload = payload;
  return normalized;
}

function collectDashboardOptionResultIds(options = [], payload = null) {
  const ids = [];
  const addIds = (values) => {
    if (!Array.isArray(values)) return;
    values.forEach((id) => {
      const clean = String(id || '').trim();
      if (clean) ids.push(clean);
    });
  };

  addIds(payload?.result_ids);
  options.forEach((option) => {
    if (!option || typeof option !== 'object') return;
    if (option.id !== null && option.id !== undefined) ids.push(String(option.id));
    addIds(option.payload?.result_ids);
  });

  return toUniqueStringList(ids, { normalize: (id) => String(id || '').trim() })
    .slice(0, MAX_CHAT_UI_RESULT_IDS);
}

function normalizeDashboardOptionsUiMetadata(rawUi) {
  if (!rawUi || typeof rawUi !== 'object') return null;
  if (String(rawUi.type || '').trim() !== 'dashboard_options') return null;

  const searchPayload = limitAssistantSearchPayloadForUi(
    rawUi.search_payload || rawUi.searchPayload || rawUi.payload
  );
  const options = Array.isArray(rawUi.options)
    ? rawUi.options.map(normalizeDashboardOptionForUiState).filter(Boolean).slice(0, MAX_CHAT_UI_OPTIONS)
    : [];
  const resultIds = collectDashboardOptionResultIds(options, searchPayload)
    .concat(toUniqueStringList(rawUi.result_ids || rawUi.resultIds || rawUi.ids, {
      normalize: (id) => String(id || '').trim(),
    }))
    .filter(Boolean);
  const uniqueResultIds = toUniqueStringList(resultIds, { normalize: (id) => String(id || '').trim() })
    .slice(0, MAX_CHAT_UI_RESULT_IDS);

  if (!uniqueResultIds.length && !searchPayload && !options.length) return null;
  return {
    type: 'dashboard_options',
    result_ids: uniqueResultIds,
    search_payload: searchPayload,
    options,
  };
}

function createDashboardOptionsUiMetadata(query, options, rawSearchPayload) {
  const searchPayload = limitAssistantSearchPayloadForUi(rawSearchPayload);
  const normalizedOptions = Array.isArray(options)
    ? options.map(normalizeDashboardOptionForUiState).filter(Boolean).slice(0, MAX_CHAT_UI_OPTIONS)
    : [];
  const resultIds = collectDashboardOptionResultIds(normalizedOptions, searchPayload);
  const payloadWithQuery = searchPayload
    ? {
      ...searchPayload,
      query: searchPayload.query || String(query || '').trim(),
      result_ids: searchPayload.result_ids?.length ? searchPayload.result_ids : resultIds,
    }
    : null;

  return normalizeDashboardOptionsUiMetadata({
    type: 'dashboard_options',
    result_ids: resultIds,
    search_payload: payloadWithQuery,
    options: normalizedOptions,
  });
}

function getMessageBubblePlainText(msgEl) {
  const bubble = msgEl?.querySelector?.('.bubble');
  return String(bubble?.textContent || '').trim();
}

function persistLatestAssistantDashboardOptions(msgEl, ui) {
  if (!ui) return;
  const text = getMessageBubblePlainText(msgEl);
  if (!text) return;
  chatState = setLatestAssistantConversationTurn(chatState, { text, ui });
  persistChatState(chatState);
}

function buildChatOptionFromEdital(edital) {
  if (!edital || edital.id == null) return null;
  const metaParts = [];
  if (edital?.is_highlighted || edital?.relevance_level === 'perfect') metaParts.push('100% aderente');
  else if (edital?.relevance_level === 'high') metaParts.push('Alta aderência');
  if (edital.instituicao) metaParts.push(edital.instituicao);
  if (edital.estado) metaParts.push(formatEstadoLabel(edital.estado));
  if (edital.data_fechamento) metaParts.push(`Até ${formatChatDate(edital.data_fechamento)}`);
  return {
    action: 'open_edital',
    id: edital.id,
    title: edital.titulo || 'Sem título',
    meta: metaParts.join(' • ') || null,
  };
}

function appendChatOptionOnce(options, nextOption) {
  const normalized = normalizeDashboardOptionForUiState(nextOption);
  if (!normalized) return;
  const key = [
    normalized.action,
    normalized.id || '',
    normalized.query || '',
    normalized.title || '',
  ].join('::').toLowerCase();
  const exists = options.some((option) => ([
    option.action,
    option.id || '',
    option.query || '',
    option.title || '',
  ].join('::').toLowerCase()) === key);
  if (!exists) options.push(normalized);
}

function buildDashboardOptionsFromUiMetadata(rawUi) {
  const ui = normalizeDashboardOptionsUiMetadata(rawUi);
  if (!ui) return [];

  const byId = new Map(
    (Array.isArray(editaisOriginais) ? editaisOriginais : [])
      .map((item) => [String(item?.id ?? ''), item])
      .filter(([id]) => Boolean(id))
  );
  const savedOpenIds = ui.options
    .filter((option) => option.action === 'open_edital' && option.id != null)
    .map((option) => String(option.id));
  const savedOpenOptionsById = new Map(
    ui.options
      .filter((option) => option.action === 'open_edital' && option.id != null)
      .map((option) => [String(option.id), option])
  );
  const idsForCards = savedOpenIds.length ? savedOpenIds : ui.result_ids.slice(0, 5);
  const options = [];

  idsForCards.forEach((id) => {
    const idKey = String(id);
    const card = byId.get(idKey);
    if (card) {
      appendChatOptionOnce(options, buildChatOptionFromEdital(card));
      return;
    }

    const savedOption = savedOpenOptionsById.get(idKey);
    if (savedOption) {
      appendChatOptionOnce(options, savedOption);
    }
  });

  ui.options
    .filter((option) => option.action !== 'open_edital')
    .forEach((option) => {
      const nextOption = { ...option };
      if (nextOption.action === 'view_all' && !nextOption.payload && ui.search_payload) {
        nextOption.payload = ui.search_payload;
      }
      if (nextOption.action === 'view_all' && !nextOption.query) {
        nextOption.query = ui.search_payload?.query || '';
      }
      appendChatOptionOnce(options, nextOption);
    });

  const hasViewAll = options.some((option) => option.action === 'view_all');
  if (!hasViewAll && ui.search_payload && Number(ui.search_payload.total || 0) > options.length) {
    appendChatOptionOnce(options, {
      action: 'view_all',
      query: ui.search_payload.query || '',
      title: `Ver todos no painel (${Number(ui.search_payload.total || ui.result_ids.length)})`,
      meta: 'Aplicar filtro no painel',
      payload: ui.search_payload,
    });
  }

  const hasAskNew = options.some((option) => option.action === 'ask_new');
  if (!hasAskNew && options.length) {
    appendChatOptionOnce(options, {
      action: 'ask_new',
      title: 'Buscar outro tema',
      meta: 'Trocar a palavra-chave',
    });
  }

  return options.slice(0, MAX_CHAT_UI_OPTIONS);
}

function renderChatOptions(msgEl, rawOptions) {
  if (!msgEl || !Array.isArray(rawOptions) || !rawOptions.length) return false;
  msgEl.querySelectorAll('.chat-options').forEach((node) => node.remove());

  const options = rawOptions.map(normalizeDashboardOptionForUiState).filter(Boolean);
  if (!options.length) return false;

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
  return true;
}

function dashboardOptionsUiNeedsEditais(rawUi) {
  const ui = normalizeDashboardOptionsUiMetadata(rawUi);
  if (!ui) return false;
  return ui.result_ids.length > 0 || ui.options.some((option) => (
    option.action === 'open_edital' && option.id != null
  ));
}

function restoreDashboardOptionsUi(msgEl, rawUi) {
  const ui = normalizeDashboardOptionsUiMetadata(rawUi);
  if (!msgEl || !ui) return false;
  if (msgEl.querySelector('.chat-options')) return true;

  const needsEditais = dashboardOptionsUiNeedsEditais(ui);
  const hasLoadedEditais = Array.isArray(editaisOriginais) && editaisOriginais.length > 0;
  if (needsEditais && !hasLoadedEditais) {
    pendingDashboardOptionsRestores.push({ msgEl, ui });
    return false;
  }

  const options = buildDashboardOptionsFromUiMetadata(ui);
  return renderChatOptions(msgEl, options);
}

function restoreChatMessageUi(msgEl, ui) {
  if (!msgEl || !ui || typeof ui !== 'object') return false;
  if (ui.type === 'dashboard_options') return restoreDashboardOptionsUi(msgEl, ui);
  if (ui.type === 'sources') {
    applySourcesDetails(msgEl, ui.sources);
    return true;
  }
  return false;
}

function flushPendingDashboardOptionsRestores() {
  if (!pendingDashboardOptionsRestores.length) return;
  const pending = pendingDashboardOptionsRestores;
  pendingDashboardOptionsRestores = [];
  pending.forEach(({ msgEl, ui }) => {
    if (!msgEl?.isConnected || msgEl.querySelector?.('.chat-options')) return;
    restoreDashboardOptionsUi(msgEl, ui);
  });
}

function attachEditaisOptions(msgEl, query, rawOptions = null, rawStructuredPayload = null) {
  if (!msgEl) return;

  const structuredPayload = normalizeAssistantSearchPayload(rawStructuredPayload);
  const fromBackend = normalizeBackendChatOptions(rawOptions);
  const hasBackendOptions = fromBackend.length > 0;
  let optionsSearchPayload = structuredPayload;
  let options = [];

  if (hasBackendOptions) {
    const panelPayload = structuredPayload || buildAssistantPayloadFromQuery(query);
    optionsSearchPayload = panelPayload;
    const panelTotal = Number(panelPayload?.total) > 0 ? Number(panelPayload.total) : fromBackend.length;
    options = fromBackend.slice(0, 8);
    const hasViewAllAction = options.some((opt) => String(opt?.action || '').trim() === 'view_all');
    if (panelTotal > options.length && !hasViewAllAction) {
      options.push({
        action: 'view_all',
        query,
        title: `Ver todos no painel (${panelTotal})`,
        meta: 'Aplicar filtro no painel',
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
    optionsSearchPayload = panelPayload;
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
        meta: 'Aplicar filtro no painel',
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

  const rendered = renderChatOptions(msgEl, options);
  if (rendered) {
    persistLatestAssistantDashboardOptions(
      msgEl,
      createDashboardOptionsUiMetadata(query, options, optionsSearchPayload)
    );
  }
}

function getLastDashboardResultCards() {
  const ids = Array.isArray(assistantSemanticMemory?.lastResultIds)
    ? assistantSemanticMemory.lastResultIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  if (!ids.length || !Array.isArray(editaisOriginais) || !editaisOriginais.length) return [];

  const byId = new Map(editaisOriginais.map((item) => [String(item?.id ?? ''), item]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function mostFrequentString(values) {
  const counts = new Map();
  values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .forEach((value) => {
      const key = normalizeAssistantQuery(value);
      if (!key) return;
      const current = counts.get(key) || { value, count: 0 };
      current.count += 1;
      counts.set(key, current);
    });

  return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'pt-BR'))[0]?.value || '';
}

function inferInstitutionShortLabel(institution) {
  const text = String(institution || '').trim();
  if (!text) return '';
  const acronym = text.match(/\b[A-ZÀ-Ý]{3,}(?:[-/][A-ZÀ-Ý0-9]{2,})?\b/);
  if (acronym) return acronym[0];
  return truncateText(text, 14);
}

function buildDashboardRefinementSuggestions() {
  const cards = getLastDashboardResultCards();
  const activeFilters = normalizeDashboardFilterState(assistantSemanticMemory?.lastDashboardFilters);
  const states = cards.map((card) => String(normalizeEstadoValue(card?.estado) || '').trim().toUpperCase()).filter(Boolean);
  const stateLabel = states.includes('SP') ? 'SP' : (mostFrequentString(states) || 'SP');
  const institution = mostFrequentString(cards.map((card) => card?.instituicao));
  const institutionLabel = inferInstitutionShortLabel(institution) || 'FAPESP';
  const institutionQuery = institution || institutionLabel || 'FAPESP';
  const stateActive = Boolean(stateLabel && activeFilters.estado.includes(stateLabel));
  const openActive = activeFilters.status.includes('aberto') && !activeFilters.status.includes('encerrado');
  const weekActive = activeFilters.deadline_range === 'next_7_days';
  const institutionActive = Boolean(institutionQuery && activeFilters.instituicoes.some((activeInstitution) => (
    dashboardInstitutionMatches(institutionQuery, activeInstitution) ||
    dashboardInstitutionMatches(activeInstitution, institutionQuery)
  )));

  const rawSuggestions = [
    { label: stateLabel || 'SP', query: `Quero em ${stateLabel || 'SP'}`, active: stateActive },
    { label: 'Abertas', query: 'Só abertas', active: openActive },
    { label: 'Esta semana', query: 'Vencem esta semana', active: weekActive },
    { label: institutionLabel, query: `Da ${institutionQuery}`, active: institutionActive },
  ];

  const seen = new Set();
  const suggestions = rawSuggestions.filter((suggestion) => {
    const key = normalizeAssistantQuery(suggestion.label);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (hasDashboardFilterValue(activeFilters)) {
    suggestions.push({
      label: 'Limpar refinamentos',
      action: 'clear_refinements',
      clear: true,
    });
  }

  return suggestions;
}

function removeRefinementPanels() {
  if (!messageContainer) return;
  messageContainer.querySelectorAll('.chat-refine-message').forEach((node) => node.remove());
}

function showDashboardRefinementPanel() {
  if (!hasDashboardSearchMemory()) {
    addMessage('Faça uma busca primeiro, por exemplo: "Mostre oportunidades para inovação" ou "Quais editais estão abertos em SP".', 'bot');
    return;
  }

  removeRefinementPanels();
  const msg = addMessage('', 'bot');
  if (!msg) return;
  msg.classList.add('chat-refine-message');
  attachRefinementSuggestionOptions(msg);
}

function attachRefinementSuggestionOptions(msgEl) {
  if (!msgEl) return;
  const bubble = msgEl.querySelector('.bubble');
  if (!bubble) return;
  const hasActiveFilters = hasDashboardFilterValue(assistantSemanticMemory?.lastDashboardFilters);
  const subtitle = hasActiveFilters
    ? 'Você já está refinando a busca. Escolha outro filtro ou limpe os refinamentos.'
    : 'Escolha um atalho ou digite seu próprio filtro.';

  const panel = document.createElement('div');
  panel.className = 'chat-refine-panel';
  panel.setAttribute('data-refine-panel', 'true');
  panel.innerHTML = `
    <div class="chat-refine-title">Refinar busca</div>
    <div class="chat-refine-subtitle">${escapeHtml(subtitle)}</div>
    <div class="chat-refine-actions"></div>
  `.trim();

  const actions = panel.querySelector('.chat-refine-actions');
  buildDashboardRefinementSuggestions().forEach((suggestion) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = Boolean(suggestion.active);
    const isClear = Boolean(suggestion.clear);
    btn.className = `chat-refine-chip${isActive ? ' is-active' : ''}${isClear ? ' is-clear' : ''}`;
    btn.setAttribute('data-action', suggestion.action || 'send_refinement');
    if (suggestion.query) btn.setAttribute('data-query', suggestion.query);
    if (isActive) {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.setAttribute('title', 'Refinamento já aplicado');
    }
    btn.textContent = isActive ? `${suggestion.label} ✓` : suggestion.label;
    actions.appendChild(btn);
  });

  bubble.innerHTML = '';
  bubble.appendChild(panel);
  scrollToBottom();
}

function clearDashboardRefinementsFromChat() {
  const baseQuestion = getDashboardBaseQuestionForRefinement();
  assistantSemanticMemory = createDashboardMemoryState({
    ...assistantSemanticMemory,
    lastQuestion: baseQuestion,
    lastDashboardFilters: normalizeDashboardFilterState(),
    lastRefinementQuestion: '',
    updatedAt: new Date().toISOString(),
  });
  clearAssistantPanelContext();
  removeRefinementPanels();
  applyFiltersAndRender({ resetPage: true });

  const notice = 'Refinamentos limpos. Você pode buscar novamente ou aplicar outro filtro.';
  addMessage(notice, 'bot');
  chatState = appendConversationTurn(chatState, 'assistant', notice);
  persistChatState(chatState);
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

async function handleChatSend(options = {}) {
  if (botIsTyping) {
    const aborted = chatRequestTracker.abortActiveController();
    stopLegacyAssistantLoading(activeLegacyAssistantLoading);
    if (!aborted) return;
    setChatBusy(false);
  }
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

  const forceDashboardRefinement = Boolean(options?.forceDashboardRefinement);
  const backendRoutedFreeText = isConceptualOrAdvisoryQuestion(question);
  const documentalSemanticQuestion = isDocumentalSemanticQuestion(question);
  const dashboardListingQuestion = !backendRoutedFreeText && !documentalSemanticQuestion && isDashboardListingQuestion(question);
  const dashboardRefinementQuestion = !dashboardListingQuestion && !backendRoutedFreeText && !documentalSemanticQuestion && (forceDashboardRefinement || isDashboardRefinementQuestion(question));
  const dashboardRefinementSignals = getDashboardRefinementSignals(question);
  let activeContext = getActiveEditalContext();
  if (activeContext?.editalId && (dashboardListingQuestion || dashboardRefinementQuestion)) {
    clearActiveEditalContext({ clearAssistantContext: true });
    activeContext = null;
  }

  if (activeContext?.editalId && dashboardRefinementSignals.hasSignal && dashboardRefinementSignals.isComplementary) {
    const notice = 'Para refinar o painel, faça primeiro uma busca geral de editais. Exemplo: "Mostre oportunidades para tecnologia e inovação".';
    addMessage(notice, 'bot');
    chatState = appendConversationTurn(chatState, 'assistant', notice);
    persistChatState(chatState);
    return;
  }

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
  const routeEndpoint = '/chat/agent/stream';
  console.info('[CHAT][route]', {
    question,
    backendRoutedFreeText,
    isDocumentalSemanticQuestion: documentalSemanticQuestion,
    dashboardListingQuestion,
    dashboardRefinementQuestion,
    activeEditalId: contextualEditalId,
    endpoint: routeEndpoint,
  });

  const useAthosAgent = true;
  if (useAthosAgent) {
    setChatBusy(true);
    const typingMsg = addMessage('pensando...', 'bot', null, { isTyping: true });
    const canApplyDashboardSearch = !contextualEditalId;

    try {
      const dashboardContext = buildDashboardIntelligenceContext();
      const streamOutcome = await tryChatStreamRequest({
        endpoint: '/chat/agent/stream',
        requestBody: {
          message: question,
          question,
          state: chatState,
          dashboard_context: dashboardContext,
          edital_id: contextualEditalId,
        },
        typingMsg,
      });

      if (streamOutcome.ok) {
        const donePayload = streamOutcome?.donePayload && typeof streamOutcome.donePayload === 'object'
          ? streamOutcome.donePayload
          : {};
        const hasBackendState = Boolean(donePayload?.state && typeof donePayload.state === 'object');

        if (Object.prototype.hasOwnProperty.call(donePayload || {}, 'state')) {
          if (hasBackendState) {
            chatState = ensureChatSessionState(donePayload.state);
            persistChatState(chatState);
            updateChatHeader();
          } else {
            clearActiveEditalContext({ clearAssistantContext: true });
          }
        } else {
          chatState = appendConversationTurn(chatState, 'assistant', streamOutcome.text || '');
          persistChatState(chatState);
        }

        const backendOptions = Array.isArray(donePayload?.options) ? donePayload.options : [];
        const backendStructuredPayload = normalizeAssistantSearchPayload(
          donePayload?.search_payload ||
          donePayload?.intent_payload ||
          donePayload?.searchPayload ||
          null
        );
        const assistantPlan = donePayload?.assistant_plan && typeof donePayload.assistant_plan === 'object'
          ? donePayload.assistant_plan
          : null;

        if (backendStructuredPayload) {
          rememberAssistantResultSetFromPayload(backendStructuredPayload, {
            question,
            intent: donePayload?.intent || backendStructuredPayload?.intent || '',
            dashboardFilters: normalizeDashboardFilterState(backendStructuredPayload?.filters || {}),
          });
        }

        if (canApplyDashboardSearch && assistantPlan?.ui_action?.auto_apply && backendStructuredPayload) {
          applyAssistantPayloadToDashboard(backendStructuredPayload, { fallbackQuery: question });
        }

        if (canApplyDashboardSearch && donePayload?.should_search) {
          attachEditaisOptions(
            typingMsg,
            question,
            backendOptions.length ? backendOptions : null,
            backendStructuredPayload
          );
        }
        return;
      }

      if (streamOutcome.aborted) return;

      const localOutcome = buildLocalAssistantOutcome(question);
      const fallbackText = localOutcome?.reply || 'O chat está indisponível no momento. Tenta de novo em alguns instantes.';
      setMessageText(typingMsg, fallbackText);
      chatState = appendConversationTurn(chatState, 'assistant', fallbackText);
      persistChatState(chatState);
      if (canApplyDashboardSearch && localOutcome?.shouldSearch) {
        attachEditaisOptions(typingMsg, question);
      }
    } catch (err) {
      console.error('[CHAT][agent] erro no Athos Agent', err);
      const localOutcome = buildLocalAssistantOutcome(question);
      const fallbackText = localOutcome?.reply || 'Deu ruim aqui do meu lado. Tenta de novo em alguns segundos.';
      setMessageText(typingMsg, fallbackText);
      chatState = appendConversationTurn(chatState, 'assistant', fallbackText);
      persistChatState(chatState);
      if (canApplyDashboardSearch && localOutcome?.shouldSearch) {
        attachEditaisOptions(typingMsg, question);
      }
    } finally {
      setChatBusy(false);
      scrollToBottom();
    }
    return;
  }

  if (dashboardListingQuestion || dashboardRefinementQuestion) {
    const dashboardBaseQuestion = dashboardRefinementQuestion
      ? getDashboardBaseQuestionForRefinement()
      : question;
    const priorDashboardFilters = normalizeDashboardFilterState(assistantSemanticMemory?.lastDashboardFilters);
    const refinementDashboardFilters = dashboardRefinementQuestion
      ? dashboardFiltersFromRefinementQuestion(question)
      : normalizeDashboardFilterState();
    const requestAccumulatedDashboardFilters = dashboardRefinementQuestion
      ? mergeDashboardFilterState(priorDashboardFilters, refinementDashboardFilters)
      : priorDashboardFilters;
    const dashboardRequestQuestion = dashboardRefinementQuestion
      ? buildDashboardRefinementQuestion(question, requestAccumulatedDashboardFilters)
      : question;
    const dashboardOptionsQuestion = dashboardRequestQuestion;
    if (dashboardRefinementQuestion) {
      console.info('[CHAT][refinement]', {
        question,
        priorDashboardFilters,
        refinementDashboardFilters,
        accumulatedDashboardFilters: requestAccumulatedDashboardFilters,
      });
    }
    setChatBusy(true);
    const typingMsg = addMessage('Analisando os editais...', 'bot', null, { isTyping: true });
    const requestController = new AbortController();
    chatRequestTracker.setActiveController(requestController);
    const loadingController = startLegacyAssistantLoading(typingMsg);

    try {
      const dashboardContext = buildDashboardIntelligenceContext();
      const { res, data } = await apiFetchJson('/chat/dashboard-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: requestController.signal,
        body: JSON.stringify({
          message: dashboardRequestQuestion,
          question: dashboardRequestQuestion,
          state: chatState,
          dashboard_context: dashboardContext,
        }),
      });

      if (!res.ok) throw new Error(`dashboard-intelligence-${res.status}`);

      const hasBackendState = Boolean(data?.state && typeof data.state === 'object');
      if (hasBackendState) {
        chatState = ensureChatSessionState(data.state);
        updateChatHeader();
      }

      const plan = normalizeDashboardPlanFromBackend(data);
      if (!plan) throw new Error('invalid-dashboard-plan');
      const planFilters = dashboardFiltersFromPlan(plan);
      const accumulatedDashboardFilters = dashboardRefinementQuestion
        ? mergeDashboardFilterState(planFilters, requestAccumulatedDashboardFilters)
        : planFilters;
      const displayPlan = applyAccumulatedFiltersToDashboardPlan(plan, accumulatedDashboardFilters);

      const finalReply = sanitizeAssistantReplyText(
        buildDashboardShortReply(displayPlan, dashboardRequestQuestion) ||
        normalizeConciseBotText(displayPlan?.suggested_reply || data?.reply || 'Não consegui responder com os dados do painel.')
      );
      stopLegacyAssistantLoading(loadingController);
      setMessageText(typingMsg, finalReply);

      chatState = setLatestAssistantConversationTurn(chatState, finalReply);
      persistChatState(chatState);

      const planPayload = dashboardPlanToLegacySearchPayload(displayPlan);
      const normalizedPlanPayload = normalizeAssistantSearchPayload(planPayload);
      if (normalizedPlanPayload) {
        rememberAssistantResultSetFromPayload(normalizedPlanPayload, {
          question: dashboardBaseQuestion,
          intent: plan.intent || normalizedPlanPayload.intent || '',
          dashboardFilters: accumulatedDashboardFilters,
        });
      }

      if (plan?.ui_action?.auto_apply && normalizedPlanPayload) {
        applyAssistantPayloadToDashboard(normalizedPlanPayload, { fallbackQuery: dashboardOptionsQuestion });
      }

      const optionSeed = buildDashboardPlanOptions(displayPlan, dashboardOptionsQuestion, Array.isArray(data?.options) ? data.options : []);
      if (Array.isArray(optionSeed) && optionSeed.length) {
        attachEditaisOptions(
          typingMsg,
          dashboardOptionsQuestion,
          optionSeed,
          normalizedPlanPayload || planPayload || null
        );
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        stopLegacyAssistantLoading(loadingController);
        return;
      }
      console.warn('[CHAT][dashboard-intelligence] fallback local ativado', err);
      const localSemanticQuestion = dashboardRefinementQuestion
        ? `${question} nesses resultados`
        : question;
      const semanticOutcome = runLocalDashboardSemanticAssistant(localSemanticQuestion);
      if (dashboardRefinementQuestion) {
        assistantSemanticMemory = createDashboardMemoryState({
          ...assistantSemanticMemory,
          lastQuestion: dashboardBaseQuestion,
          lastDashboardFilters: priorDashboardFilters,
        });
      }
      const semanticPayload = normalizeAssistantSearchPayload(semanticOutcome?.structuredPayload || null);
      const fallbackPlan = buildDashboardPlanFromLegacyPayload(semanticPayload, {
        intent: semanticOutcome?.intent || 'list_cards',
      });
      const fallbackPlanFilters = dashboardFiltersFromPlan(fallbackPlan);
      const accumulatedFallbackFilters = dashboardRefinementQuestion
        ? mergeDashboardFilterState(fallbackPlanFilters, requestAccumulatedDashboardFilters)
        : fallbackPlanFilters;
      const displayFallbackPlan = applyAccumulatedFiltersToDashboardPlan(fallbackPlan, accumulatedFallbackFilters);
      const filteredSemanticPayload = normalizeAssistantSearchPayload(
        dashboardPlanToLegacySearchPayload(displayFallbackPlan)
      ) || semanticPayload;
      const semanticReply = buildDashboardShortReply(displayFallbackPlan, dashboardRequestQuestion) ||
        normalizeConciseBotText(semanticOutcome?.reply || 'Não consegui responder com os dados do painel.');
      const finalSemanticReply = sanitizeAssistantReplyText(semanticReply);
      stopLegacyAssistantLoading(loadingController);
      setMessageText(typingMsg, finalSemanticReply);
      chatState = setLatestAssistantConversationTurn(chatState, finalSemanticReply);
      persistChatState(chatState);

      if (filteredSemanticPayload) {
        rememberAssistantResultSetFromPayload(filteredSemanticPayload, {
          question: dashboardBaseQuestion,
          intent: semanticOutcome?.intent || filteredSemanticPayload?.intent || '',
          dashboardFilters: accumulatedFallbackFilters,
        });
      }

      const semanticOptionSeed = buildDashboardPlanOptions(
        displayFallbackPlan,
        dashboardOptionsQuestion,
        Array.isArray(semanticOutcome?.options) ? semanticOutcome.options : []
      );
      if (Array.isArray(semanticOptionSeed) && semanticOptionSeed.length) {
        attachEditaisOptions(
          typingMsg,
          dashboardOptionsQuestion,
          semanticOptionSeed,
          filteredSemanticPayload || semanticOutcome?.structuredPayload || null
        );
      }
    } finally {
      stopLegacyAssistantLoading(loadingController);
      const shouldReleaseBusy =
        chatRequestTracker.getActiveController() === requestController ||
        !chatRequestTracker.hasActiveController();
      chatRequestTracker.clearActiveController(requestController);
      if (shouldReleaseBusy) setChatBusy(false);
      scrollToBottom();
    }
    return;
  }

  setChatBusy(true);
  const typingMsg = addMessage('pensando...', 'bot', null, { isTyping: true });
  const canApplyDashboardSearch = !contextualEditalId;

  try {
    const streamEndpoint = contextualEditalId
      ? `/chat/edital/${encodeURIComponent(contextualEditalId)}/stream`
      : '/chat/stream';
    const streamOutcome = await tryChatStreamRequest({
      endpoint: streamEndpoint,
      requestBody: { message: question, question, state: chatState },
      typingMsg,
    });

    if (streamOutcome.ok) {
      const donePayload = streamOutcome?.donePayload && typeof streamOutcome.donePayload === 'object'
        ? streamOutcome.donePayload
        : {};
      const hasBackendState = Boolean(donePayload?.state && typeof donePayload.state === 'object');

      if (Object.prototype.hasOwnProperty.call(donePayload || {}, 'state')) {
        if (hasBackendState) {
          chatState = ensureChatSessionState(donePayload.state);
          persistChatState(chatState);
          updateChatHeader();
        } else {
          clearActiveEditalContext({ clearAssistantContext: true });
        }
      } else {
        chatState = appendConversationTurn(chatState, 'assistant', streamOutcome.text || '');
        persistChatState(chatState);
      }

      const streamOptions = Array.isArray(donePayload?.options) ? donePayload.options : [];
      if (canApplyDashboardSearch && donePayload?.should_search) {
        attachEditaisOptions(
          typingMsg,
          question,
          streamOptions.length ? streamOptions : null,
          null
        );
      }
      return;
    }
    if (streamOutcome.aborted) return;

    setMessageText(typingMsg, 'digitando...', null, { keepTyping: true });
    const endpoint = contextualEditalId ? `/chat/edital/${encodeURIComponent(contextualEditalId)}` : '/chat';

    const { res, data } = await apiFetchJson(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // manda "message" (backend) e "question" (compat)
      body: JSON.stringify({ message: question, question, state: chatState }),
    });

    if (!res.ok) {
      const localOutcome = buildLocalAssistantOutcome(question);
      const fallbackText = localOutcome?.reply || 'O chat está indisponível no momento. Tenta de novo em alguns instantes.';
      setMessageText(
        typingMsg,
        fallbackText
      );
      chatState = appendConversationTurn(chatState, 'assistant', fallbackText);
      persistChatState(chatState);
      if (canApplyDashboardSearch && localOutcome?.shouldSearch) {
        attachEditaisOptions(typingMsg, question);
      }
      return;
    }

    const hasBackendState = Boolean(data?.state && typeof data.state === 'object');
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

    // tolera nomes diferentes de campo
    const answer =
      data?.answer ??
      data?.reply ??
      data?.resposta ??
      data?.message ??
      data?.text ??
      data?._rawText ??
      null;

    const localOutcome = buildLocalAssistantOutcome(question);
    const preferContextualAnswer = Boolean(contextualEditalId);
    const isLocalNonSearch = !preferContextualAnswer && localOutcome?.intent !== 'edital_search';
    const rawText = isLocalNonSearch
      ? (localOutcome?.reply || 'Não consegui responder agora.')
      : ((answer && String(answer).trim())
        ? normalizeBotText(answer)
        : (localOutcome?.reply || 'Não consegui responder agora.'));
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

    const backendOptions = Array.isArray(data?.options) ? data.options : [];
    const backendStructuredPayload = normalizeAssistantSearchPayload(
      data?.search_payload ||
      data?.intent_payload ||
      data?.searchPayload ||
      null
    );

    const chatDecision = isLocalNonSearch
      ? { intent: localOutcome?.intent || 'unknown', shouldSearch: false }
      : resolveBackendSearchDecision({
        data,
        question,
        backendOptions,
        backendStructuredPayload,
      });

    if (canApplyDashboardSearch && chatDecision.shouldSearch) {
      attachEditaisOptions(
        typingMsg,
        question,
        backendOptions.length ? backendOptions : null,
        backendStructuredPayload
      );
    }

  } catch (e) {
    console.error('Erro no chat:', e);
    const localOutcome = buildLocalAssistantOutcome(question);
    const fallbackText = localOutcome?.reply || 'Deu ruim aqui do meu lado. Tenta de novo em alguns segundos.';
    setMessageText(typingMsg, fallbackText);
    chatState = appendConversationTurn(chatState, 'assistant', fallbackText);
    persistChatState(chatState);
    if (canApplyDashboardSearch && localOutcome?.shouldSearch) {
      attachEditaisOptions(typingMsg, question);
    }
  } finally {
    setChatBusy(false);
    scrollToBottom();
  }
}

function setChatBusy(isBusy) {
  botIsTyping = !!isBusy;
  if (chatInput) chatInput.disabled = !!isBusy;
  if (sendButton) sendButton.disabled = !!isBusy;
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

function safeUrl(value, fallback = '#') {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;

  const compact = raw.replace(/[\u0000-\u001F\u007F\s]+/g, '').toLowerCase();
  if (/^(?:javascript|data|vbscript):/.test(compact)) return fallback;
  if (/[<>"'`\u0000-\u001F\u007F\\]/.test(raw)) return fallback;

  const schemeMatch = compact.match(/^([a-z][a-z0-9+.-]*):/i);
  if (schemeMatch && !/^https?:/i.test(compact)) return fallback;

  if (raw.startsWith('//')) {
    try {
      const protocol = globalThis.window?.location?.protocol === 'http:' ? 'http:' : 'https:';
      const parsed = new URL(`${protocol}${raw}`);
      return /^https?:$/.test(parsed.protocol) ? parsed.href : fallback;
    } catch (_) {
      return fallback;
    }
  }

  if (/^https?:/i.test(raw)) {
    try {
      const parsed = new URL(raw);
      return /^https?:$/.test(parsed.protocol) ? parsed.href : fallback;
    } catch (_) {
      return fallback;
    }
  }

  return raw;
}
