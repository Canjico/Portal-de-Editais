/* =========================================================
   Athos / Atimus — Editais (UX/UI novo + filtros + paginação)
   ========================================================= */

import { renderEditais } from './render.js?v=20260318.3';
import {
  parseAnyDateToTime,
  buildSearchQueryContext,
  matchesDateIntent,
} from './search-date-utils.js?v=20260313.1';

// =========================
// CONFIGURAÇÕES & SEGURANÇA
// =========================
import {
  API_BASE,
  LOGIN_URL,
  bootstrapAuthFromUrl,
  buildLoginUrlWithNext,
  apiFetchJson,
} from './auth.js';

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

const PAGE_SIZE = 12;
let currentPage = 1;
let lastFiltered = [];
let kpiFilter = 'all';
let assistantPanelContext = null;

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
let chatState = null;

// =========================
// INIT
// =========================
document.addEventListener('DOMContentLoaded', init);

async function init() {
  bootstrapAuthFromUrl();
  window.AthosTheme?.bootstrap?.();
  const me = await checkAuth();
  if (!me) return;

  hydrateSidebarUser(me);

  try {
    await loadEditais();
    await loadFavoritos();
    if (hasPersonalizedRelevance(editaisOriginais)) {
      setSortField('relevancia', { resetDirection: true });
    }
    buildFuseIndex();
    generateDynamicFilters();
    setupFilterGroupsAccordion();
    setupUIEvents();
    setupConsentAwareOptionalFeatures();
    syncKpiButtons();
    setSearchVisualState();
    renderChatQuickPrompts();
    applyFiltersAndRender({ resetPage: true });

    // deep link (?edital=slug ou ?id=)
    const urlParams = new URLSearchParams(window.location.search);
    const shareToken = normalizeShareTokenParam(urlParams.get('share_token'));
    const editalSlug = urlParams.get('edital');
    const editalId = urlParams.get('id');

    if (shareToken) {
      const target = editaisOriginais.find((e) => extractShareTokenFromLink(e.share_link) === shareToken);
      if (target) openModal(target);
    } else if (editalSlug) {
      const target = editaisOriginais.find(e => e.slug === editalSlug);
      if (target) openModal(target);
    } else if (editalId) {
      const target = editaisOriginais.find(e => String(e.id) === String(editalId));
      if (target) openModal(target);
    }
  } finally {
    markAppReady();
  }
}

function hasPersonalizedRelevance(items) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.some((item) => normalizeRelevanceScore(item?.relevance_score) > 0 || item?.is_highlighted);
}

// =========================
// AUTH
// =========================
async function checkAuth() {
  try {
    const { res, data } = await apiFetchJson('/cliente/me', { method: 'GET' });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        window.location.href = buildLoginUrlWithNext();
        return null;
      }
      return {};
    }

    if (data && typeof data === 'object' && 'logado' in data && !data.logado) {
      window.location.href = buildLoginUrlWithNext();
      return null;
    }

    if (window.AthosTheme?.setPreference && data?.themePreference) {
      window.AthosTheme.setPreference(data.themePreference);
    }

    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    console.error('Erro na verificação de autenticação:', e);

    if (e instanceof TypeError) return {};

    window.location.href = buildLoginUrlWithNext();
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
  document.body.classList.remove('app-loading');
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
    showToast('Ative cookies de personalização em Perfil > Preferências > Cookies para usar o chat.', 'info');
    return;
  }

  if (chatWrapper) {
    chatWrapper.classList.toggle('open', open);
    chatWrapper.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  syncAssistantLayoutState();
  syncChatLauncherVisibility();
  updateChatHeader();

  if (!open) return;

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
      handleChatSend();
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
async function loadEditais() {
  if (!container) return;

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
    const { res, data } = await apiFetchJson('/editais', { method: 'GET' });

    if (!res.ok) {
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

    const rawList =
      Array.isArray(data) ? data :
      (Array.isArray(data?.editais) ? data.editais :
      (Array.isArray(data?.data) ? data.data : []));

    editaisOriginais = rawList.map(normalizeEdital).filter(Boolean);
  } catch (e) {
    console.error('Erro ao carregar editais:', e);
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
async function loadFavoritos() {
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
  }

  // marca nos objetos (render usa isso)
  for (const e of editaisOriginais) {
    e.is_favorite = favoritosSet.has(String(e.id));
  }

  syncSavedBadge();
  syncSavedToggleUI();
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
  const rawArea = data.area || (Array.isArray(data.tags) && data.tags.length ? data.tags[0] : 'Geral');
  const titulo = data.titulo || api?.titulo || 'Sem título';

  return {
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
    is_favorite: false,
    share_link: api?.share_link || '',
    is_open: typeof api?.is_open === 'boolean' ? api.is_open : undefined,
    relevance_score: normalizeRelevanceScore(api?.relevance_score),
    is_highlighted: !!api?.is_highlighted,
    relevance_reasons: Array.isArray(api?.relevance_reasons) ? api.relevance_reasons.map((item) => String(item || '').trim()).filter(Boolean) : [],
  };
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

  if (idSet.size > 0) {
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

  // 2.5) Só salvos
  if (onlyFavoritos) filtered = filtered.filter(e => !!e.is_favorite);

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
      const relDiff = normalizeRelevanceScore(a?.relevance_score) - normalizeRelevanceScore(b?.relevance_score);
      if (relDiff !== 0) return relDiff;

      const highlightDiff = (a?.is_highlighted ? 1 : 0) - (b?.is_highlighted ? 1 : 0);
      if (highlightDiff !== 0) return highlightDiff;

      const openDiff = (isClosedEdital(a) ? 0 : 1) - (isClosedEdital(b) ? 0 : 1);
      if (openDiff !== 0) return openDiff;

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
    const label = onlyFavoritos ? 'salvos' : 'editais';
    resultsMeta.textContent = `Mostrando ${a}-${b} de ${total} ${label}`;
  }

  updateHeroStats(statsBase);
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

function updateHeroStats(filtered) {
  if (statTotal) statTotal.textContent = String(filtered.length);

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
      const sep = LOGIN_URL.includes('?') ? '&' : '?';
      window.location.href = `${LOGIN_URL}${sep}logged_out=1`;
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
              applyFiltersAndRender({ resetPage: true });
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
    sendButton.addEventListener('click', handleChatSend);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleChatSend();
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
        chatState = null;
        updateChatHeader();
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
        chatState = null;
        updateChatHeader();
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

function openModal(edital) {
  if (!modalOverlay || !modalContentContainer || !edital) return;

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
            applyFiltersAndRender({ resetPage: true });
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

function updateChatHeader() {
  const target = chatHeaderTitle || chatHeader;
  if (!target) return;
  const editalId = chatState?.edital_id ?? chatState?.editalId ?? null;
  const titulo = chatState?.titulo ?? chatState?.edital_titulo ?? chatState?.editalTitulo ?? null;
  if (editalId && titulo) {
    target.textContent = `Athos • Edital: ${truncateText(titulo, 28)}`;
  } else {
    target.textContent = 'Athos • Assistente';
  }
}

function startEditalChat(edital) {
  if (!edital) return;
  chatState = {
    mode: 'edital',
    edital_id: edital.id,
    titulo: edital.titulo || 'Edital'
  };

  setChatOpen(true, { focusInput: true, skipWelcome: true });

  addMessage(
    `Fechado. Vamos falar do edital: "${edital.titulo || 'Sem título'}".\n` +
    `Manda sua pergunta (ex: prazo, quem pode participar, valor, documentos, como enviar).`,
    'bot'
  );

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

function setMessageText(msgEl, text, sources = null) {
  if (!msgEl) return;
  const bubble = msgEl.querySelector('.bubble');
  if (bubble) bubble.innerHTML = renderSimpleMarkdown(text);
  if (msgEl.classList.contains('bot')) {
    applySourcesDetails(msgEl, sources);
  }
  msgEl.classList.remove('is-typing');
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
    options = fromBackend.slice(0, 5);
    if (panelTotal > options.length) {
      options.push({
        action: 'view_all',
        query,
        title: `Ver todos no painel (${panelTotal})`,
        meta: 'Aplicar filtros da IA no Dashboard',
        payload: panelPayload,
      });
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

  options.push({
    action: 'ask_new',
    title: 'Buscar outro tema',
    meta: 'Trocar a palavra-chave',
  });

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

async function handleChatSend() {
  if (botIsTyping) return;
  if (!hasPersonalizationConsent()) {
    showToast('Ative cookies de personalização em Perfil > Preferências > Cookies para usar o chat.', 'info');
    return;
  }

  const question = (chatInput?.value || '').trim();
  if (!question) return;

  chatInput.value = '';
  addMessage(question, 'user');

  setChatBusy(true);
  const typingMsg = addMessage('digitando...', 'bot', null, { isTyping: true });
  const contextualEditalId = chatState?.edital_id ?? chatState?.editalId ?? null;
  const canApplyDashboardSearch = !contextualEditalId;

  try {
    const endpoint = contextualEditalId ? `/chat/edital/${encodeURIComponent(contextualEditalId)}` : '/chat';

    const { res, data } = await apiFetchJson(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // manda "message" (backend) e "question" (compat)
      body: JSON.stringify({ message: question, question, state: chatState }),
    });

    if (!res.ok) {
      const localOutcome = buildLocalAssistantOutcome(question);
      setMessageText(
        typingMsg,
        localOutcome?.reply || 'O chat está indisponível no momento. Tenta de novo em alguns instantes.'
      );
      if (canApplyDashboardSearch && localOutcome?.shouldSearch) {
        attachEditaisOptions(typingMsg, question);
      }
      return;
    }

    chatState = data?.state ?? chatState;

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
    const isLocalNonSearch = localOutcome?.intent !== 'edital_search';
    const rawText = isLocalNonSearch
      ? (localOutcome?.reply || 'Não consegui responder agora.')
      : ((answer && String(answer).trim())
        ? normalizeBotText(answer)
        : (localOutcome?.reply || 'Não consegui responder agora.'));
    const extracted = extractEmbeddedSources(rawText);
    const finalText = extracted.text || rawText;
    const finalSources = normalizeSources(data?.sources, extracted.names);
    setMessageText(typingMsg, finalText, finalSources);

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
    setMessageText(typingMsg, localOutcome?.reply || 'Deu ruim aqui do meu lado. Tenta de novo em alguns segundos.');
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
