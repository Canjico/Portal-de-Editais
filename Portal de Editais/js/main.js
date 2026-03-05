/* =========================================================
   Athos / Atimus — Editais (UX/UI novo + filtros + paginação)
   ========================================================= */

import { renderEditais } from './render.js';

// =========================
// CONFIGURAÇÕES & SEGURANÇA
// =========================
import {
  API_BASE,
  LOGIN_URL,
  authHeaders,
  bootstrapAuthFromUrl,
  buildLoginUrlWithNext,
  safeReadJson,
  apiFetchJson,
} from './auth.js';

// =========================
// ESTADO
// =========================
let editaisOriginais = [];
let fuseInstance = null;

const PAGE_SIZE = 15;
let currentPage = 1;
let lastFiltered = [];

// Filtros aplicados (só mudam quando clicar em "Aplicar filtros")
let applied = {
  estado: [],
  instrumento: [],
  instituicao: [],
  area: [],
};

const CATEGORY_OPTIONS = [
  { value: 'Governo e Politicas Publicas', label: 'Governo & Políticas Públicas' },
  { value: 'Administracao e Gestao', label: 'Administração & Gestão' },
  { value: 'Tecnologia e Inovacao', label: 'Tecnologia & Inovação' },
  { value: 'Educacao e Capacitacao', label: 'Educação & Capacitação' },
  { value: 'Saude e Bem-Estar', label: 'Saúde & Bem-Estar' },
  { value: 'Meio Ambiente e Sustentabilidade', label: 'Meio Ambiente & Sustentabilidade' },
  { value: 'Agricultura e Desenvolvimento Rural', label: 'Agricultura & Desenvolvimento Rural' },
  { value: 'Infraestrutura, Obras e Engenharia', label: 'Infraestrutura, Obras & Engenharia' },
  { value: 'Logistica, Suprimentos e Operacoes', label: 'Logística, Suprimentos & Operações' },
  { value: 'Economia, Financas e Licitacoes', label: 'Economia, Finanças & Licitações' },
  { value: 'Ciencia, Pesquisa e Desenvolvimento', label: 'Ciência, Pesquisa & Desenvolvimento' },
  { value: 'Social, Direitos e Comunidade', label: 'Social, Direitos & Comunidade' },
  { value: 'Cultura, Arte e Patrimonio', label: 'Cultura, Arte & Patrimônio' },
  { value: 'Esporte, Lazer e Qualidade de Vida', label: 'Esporte, Lazer & Qualidade de Vida' },
  { value: 'Cooperacao e Relacoes Internacionais', label: 'Cooperação & Relações Internacionais' },
];

const INSTRUMENT_OPTIONS = [
  'Financiamento não reembolsável',
  'Bolsa para pesquisadores',
  'Prêmios de Inovação',
  'Financiamento reembolsável',
  'Edital privado',
  'Fundo de Investimento',
];


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
const sortSelect = document.getElementById('sortSelect');
const sortChips = document.getElementById('sortChips');
const sortDirectionBtn = document.getElementById('sortDirectionBtn');
const sortDirectionIcon = document.getElementById('sortDirectionIcon');
const sortDirectionText = document.getElementById('sortDirectionText');
const resultsMeta = document.getElementById('resultsMeta');
const paginationEl = document.getElementById('pagination');

let sortField = normalizeSortValue(sortSelect?.value || 'prazo');
let sortDirection = getDefaultSortDirection(sortField);

// Hero stats
const statTotal = document.getElementById('statTotal');
const statAbertos = document.getElementById('statAbertos');
const statFechados = document.getElementById('statFechados');

// Filtros
const filtersPanel = document.getElementById('filtersPanel');
const applyFiltersBtn = document.getElementById('applyFiltersBtn');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
const mobileFiltersBtn = document.getElementById('mobileFiltersBtn');
const filtersBackdrop = document.getElementById('filtersBackdrop');
const filtersCloseBtn = document.getElementById('filtersCloseBtn');

const filterSearchEstado = document.getElementById('filterSearchEstado');
const filterSearchInstrumento = document.getElementById('filterSearchInstrumento');
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
const chatButton = document.querySelector('.e-contact-buttons__chat-button');
const chatHeader = document.querySelector('.chat-header');

let botIsTyping = false;
let chatState = null;

// =========================
// INIT
// =========================
document.addEventListener('DOMContentLoaded', init);

async function init() {
  bootstrapAuthFromUrl();
  const me = await checkAuth();
  if (!me) return;

  hydrateSidebarUser(me);

  try {
    await loadEditais();
    await loadFavoritos();
    buildFuseIndex();
    generateDynamicFilters();
    setupUIEvents();
    applyFiltersAndRender({ resetPage: true });

    // deep link (?edital=slug ou ?id=)
    const urlParams = new URLSearchParams(window.location.search);
    const editalSlug = urlParams.get('edital');
    const editalId = urlParams.get('id');

    if (editalSlug) {
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


// =========================
// DATA LOAD
// =========================
async function loadEditais() {
  if (!container) return;

  container.innerHTML = `
    <div class="loading-container">
      <div class="spinner"></div>
      <p>Carregando editais...</p>
    </div>
  `;

  try {
    const { res, data } = await apiFetchJson('/editais', { method: 'GET' });

    if (!res.ok) {
      // Se não estiver logado, manda pro login.
      if (res.status === 401 || res.status === 403) {
        container.innerHTML = `
          <div style="grid-column: 1/-1; text-align:center; padding:2rem; color:#ef4444;">
            <i class="fas fa-lock fa-2x"></i>
            <p>Sessão expirada. Faça login para ver os editais.</p>
            <br>
            <a class="btn btn-primary" href="${buildLoginUrlWithNext()}">Ir para o login</a>
          </div>
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
      <div style="grid-column: 1/-1; text-align:center; padding:2rem; color:#ef4444;">
        <i class="fas fa-exclamation-triangle fa-2x"></i>
        <p>Não foi possível carregar os editais.</p>
        <small>${escapeHtml(e?.message || String(e))}</small>
        <br><br>
        <button onclick="location.reload()" class="btn btn-primary">Tentar novamente</button>
      </div>
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
    icone: data.icone_instituicao || null,
    instituicao: data.instituicao || '',
    estado: data.estado || 'BR',
    area: String(rawArea || 'Geral'),
    instrumento: toCanonicalInstrument(data.instrumento || data.apoio || 'Não informado'),
    tipo: data.tipo || 'Não informado',
    valor_total: data.valor_total || '',
    data_fechamento: api?.data_final_submissao || data.data_final_submissao || null,
    data_abertura: data.data_abertura || null,
    tags: data.tags || [],    arquivos,
    is_favorite: false,
    share_link: api?.share_link || ''
  };
}

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
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
    keys: ['titulo', 'descricao', 'instituicao', 'area', 'tags'],
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
    { key: 'instrumento', type: 'instrumento' },
    { key: 'instituicao', type: 'instituicao' },
  ];

  types.forEach(({ key, type }) => {
    const box = document.querySelector(`.filter-options[data-filter-type="${type}"]`);
    if (!box) return;

    const counts = new Map();
    for (const e of editaisOriginais) {
      const raw = type === 'instrumento'
        ? toCanonicalInstrument(e?.[key])
        : (e?.[key] ?? '').toString().trim();
      if (!raw) continue;
      counts.set(raw, (counts.get(raw) || 0) + 1);
    }

    const values = type === 'instrumento'
      ? INSTRUMENT_OPTIONS.slice()
      : Array.from(counts.keys()).sort((a, b) => a.localeCompare(b, 'pt-BR'));

    box.innerHTML = '';
    if (values.length === 0) {
      box.innerHTML = '<div style="font-size:12px; color:#9CA3AF; padding:6px;">Nenhuma opção</div>';
      return;
    }

    for (const val of values) {
      const label = document.createElement('label');
      label.setAttribute('data-label', val.toLowerCase());

      const left = document.createElement('span');
      left.className = 'label-left';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = val;

      const text = document.createElement('span');
      text.textContent = val;
      text.style.minWidth = '0';
      text.style.overflow = 'hidden';
      text.style.textOverflow = 'ellipsis';
      text.style.whiteSpace = 'nowrap';

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
  wireFilterSearch(filterSearchInstrumento, document.querySelector('.filter-options[data-filter-type="instrumento"]'));
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

  box.innerHTML = '';
  for (const category of CATEGORY_OPTIONS) {
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
    optionsEl.querySelectorAll('label').forEach(label => {
      const key = label.getAttribute('data-label') || '';
      const keyNorm = normalizeCategoryKey(key);
      label.style.display = (!q || keyNorm.includes(q)) ? 'flex' : 'none';
    });
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
  return s === 'atualizado' ? 'desc' : 'asc';
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

// =========================
// APLICAÇÃO DE FILTROS
// =========================
function applyFiltersAndRender({ resetPage } = { resetPage: false }) {
  if (resetPage) currentPage = 1;

  const termo = (searchInput?.value || '').trim();
  const termoLower = termo.toLowerCase();

  // 1) Base por relevância (Fuse) quando existir busca
  let base = [...editaisOriginais];
  let fromFuse = false;

  if (termo && fuseInstance) {
    base = fuseInstance.search(termo).map(r => r.item);
    fromFuse = true;
  } else if (termo) {
    base = base.filter(e =>
      (e.titulo || '').toLowerCase().includes(termoLower) ||
      (e.descricao || '').toLowerCase().includes(termoLower) ||
      (e.instituicao || '').toLowerCase().includes(termoLower) ||
      (e.area || '').toLowerCase().includes(termoLower) ||
      (Array.isArray(e.tags) && e.tags.some(t => String(t).toLowerCase().includes(termoLower)))
    );
  }

  // 2) Filtros aplicados (checkboxes)
  let filtered = base;
  if (applied.estado.length) filtered = filtered.filter(e => applied.estado.includes(e.estado));
  if (applied.instrumento.length) filtered = filtered.filter(e => applied.instrumento.includes(e.instrumento));
  if (applied.instituicao.length) filtered = filtered.filter(e => applied.instituicao.includes(e.instituicao));
  if (applied.area.length) filtered = filtered.filter(e => applied.area.includes(toCanonicalCategory(e.area)));

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
    // se veio do Fuse, mantém a ordem do Fuse; se não, mantém a ordem do backend
    filtered = sortDirection === 'asc' ? [...filtered].reverse() : filtered;
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

  updateHeroStats(filtered);
  renderEditais(container, pageItems);
  renderPagination(totalPages);
}

function compareIsoDate(a, b) {
  const da = parseAnyDateToTime(a);
  const db = parseAnyDateToTime(b);
  if (da === null && db === null) return 0;
  if (da === null) return 1;
  if (db === null) return -1;
  return da < db ? -1 : da > db ? 1 : 0;
}

function parseAnyDateToTime(dateString) {
  if (!dateString) return null;
  const s = String(dateString).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
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
  if (sidebarToggle && appSidebar) {
    sidebarToggle.addEventListener('click', () => appSidebar.classList.toggle('collapsed'));
  }

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
      for (const ep of endpoints) {
        try {
          const r = await fetch(ep.url, { method: ep.method, credentials: "include" });
          if (r.ok) break;
        } catch (_) { /* tenta o próximo */ }
      }
    } finally {
      try { localStorage.removeItem('cliente_token'); } catch (_) {}
      try { sessionStorage.removeItem('cliente_token'); } catch (_) {}
      const sep = LOGIN_URL.includes('?') ? '&' : '?';
      window.location.href = `${LOGIN_URL}${sep}logged_out=1`;
    }
  };
  if (logoutIconBtn) logoutIconBtn.addEventListener('click', doLogout);
  if (logoutBtn) logoutBtn.addEventListener('click', doLogout);

  syncSortControls();

  // busca global (aplica instantâneo)
  if (searchInput) {
    searchInput.addEventListener('input', () => applyFiltersAndRender({ resetPage: true }));
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
        instrumento: readSelected('instrumento'),
        instituicao: readSelected('instituicao'),
        area: readSelected('area'),
      };
      closeFiltersMobile();
      applyFiltersAndRender({ resetPage: true });
    });
  }

  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
      document.querySelectorAll('.filter-options input[type="checkbox"]').forEach(cb => { cb.checked = false; });
      if (filterSearchEstado) filterSearchEstado.value = '';
      if (filterSearchInstrumento) filterSearchInstrumento.value = '';
      if (filterSearchInstituicao) filterSearchInstituicao.value = '';
      if (filterSearchArea) filterSearchArea.value = '';
      document.querySelectorAll('.filter-options label').forEach(l => l.style.display = 'flex');

      applied = { estado: [], instrumento: [], instituicao: [], area: [] };
      closeFiltersMobile();
      applyFiltersAndRender({ resetPage: true });
    });
  }

  // mobile filters open/close
  if (mobileFiltersBtn && filtersPanel) {
    mobileFiltersBtn.addEventListener('click', () => openFiltersMobile());
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
            // Se estiver vendo só salvos e removeu, some do grid
            if (onlyFavoritos && !r.is_favorite) {
              applyFiltersAndRender({ resetPage: true });
            }
          }
        } catch (err) {
          alert(err?.message || 'Não foi possível salvar este edital.');
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
      chatWrapper.classList.toggle('open');
      updateChatHeader();
      scrollToBottom();
      if (messageContainer?.children.length === 0) {
        addMessage('Olá! Busque por um tema (ex: inovação) e eu listarei os editais disponíveis.', 'bot');
      }
    });
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
        if (searchInput) searchInput.value = q;
        applyFiltersAndRender({ resetPage: true });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (chatWrapper) chatWrapper.classList.remove('open');
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
}

function openFiltersMobile() {
  if (!filtersPanel || !filtersBackdrop) return;
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
  document.body.style.overflow = '';
}

// =========================
// MODAL (mantém links de documentos)
// =========================
function openModal(edital) {
  if (!modalOverlay || !modalContentContainer) return;

  let arquivosHtml = '';
  if (Array.isArray(edital.arquivos) && edital.arquivos.length > 0) {
    arquivosHtml = `
      <div class="attachments-section">
        <div class="attachments-summary" role="button" tabindex="0" aria-label="Abrir recursos e documentos">
          <div class="attachments-label">
            <h3>Recursos e Documentos</h3>
            <span class="attachments-hint">clique para ver</span>
          </div>
          <i class="fas fa-chevron-right"></i>
        </div>
        <div class="attachments-wrapper">
          <ul class="attachment-list">
            ${edital.arquivos.map(a => `
              <li>
                <a href="${escapeAttr(a.url)}" target="_blank" rel="noopener" download>
                  <i class="fas fa-link"></i> ${escapeHtml(a.nome || 'Acessar Documento')}
                </a>
              </li>
            `).join('')}
          </ul>
        </div>
      </div>
    `;
  } else {
    arquivosHtml = '<p style="margin-top:14px; color:#6B7280;">Nenhum documento anexado.</p>';
  }

  const baseUrl = window.location.origin + window.location.pathname.split('?')[0];
  const linkParam = edital.slug ? `edital=${encodeURIComponent(edital.slug)}` : `id=${encodeURIComponent(edital.id)}`;
  const localShareLink = `${baseUrl}?${linkParam}`;
  const uniqueTags = [];
  const seenTags = new Set();
  const rawTags = [edital.area, ...(Array.isArray(edital.tags) ? edital.tags : [])];
  for (const t of rawTags) {
    const clean = String(t || '').trim();
    if (!clean || clean.toLowerCase() === 'geral') continue;
    const key = clean.toLowerCase();
    if (seenTags.has(key)) continue;
    seenTags.add(key);
    uniqueTags.push(clean);
  }
  const tagsHtml = uniqueTags.length
    ? `<div class="modal-tags">${uniqueTags.map(t => `<span class="pill">${escapeHtml(t)}</span>`).join('')}</div>`
    : '';

  modalContentContainer.innerHTML = `
    <div class="modal-topbar">
      <div class="modal-top-left">
        ${edital.icone ? `<img src="${escapeAttr(edital.icone)}" alt="${escapeHtml(edital.instituicao || '')}" class="modal-logo">` : '<div></div>'}
      </div>

      <div class="modal-top-actions">
        <button class="modal-share-btn" type="button" id="modalCopyLinkBtn">
          <i class="fas fa-link"></i> Copiar link
        </button>

        <button class="modal-save-btn" type="button" id="modalSaveBtn" title="${edital.is_favorite ? 'Remover dos salvos' : 'Salvar edital'}">
          <i class="${edital.is_favorite ? 'fas' : 'far'} fa-star"></i> ${edital.is_favorite ? 'Salvo' : 'Salvar'}
        </button>
      </div>
    </div>

    <h2>${escapeHtml(edital.titulo)}</h2>
    <p>${escapeHtml(edital.descricao)}</p>

    <div class="modal-details">
      <div class="modal-detail-row"><strong>Instituição:</strong> <span>${escapeHtml(edital.instituicao || 'Não informada')}</span></div>
      <div class="modal-detail-row"><strong>Estado:</strong> <span>${escapeHtml(edital.estado || '—')}</span></div>
      <div class="modal-detail-row"><strong>Instrumento:</strong> <span>${escapeHtml(edital.instrumento || '—')}</span></div>
      ${edital.data_fechamento ? `<div class="modal-detail-row"><strong>Data final:</strong> <span>${escapeHtml(edital.data_fechamento)}</span></div>` : ''}
    </div>

    ${tagsHtml}

    <div class=\"edital-ai-cta\">
      <div class=\"cta-text\">
        <strong>Quer falar sobre este edital?</strong>
        <span>Pergunte e eu busco nos documentos deste card.</span>
      </div>
      <button class=\"btn btn-primary\" type=\"button\" id=\"talkEditalBtn\">
        <i class=\"fas fa-robot\"></i> Falar com a IA
      </button>
    </div>

    ${arquivosHtml}
  `;

  const copyBtn = modalContentContainer.querySelector('#modalCopyLinkBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(localShareLink)
        .then(() => alert('Link copiado!'))
        .catch(() => alert('Não foi possível copiar o link.'));
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
          // atualiza texto/ícone do modal
          const icon = modalSaveBtn.querySelector('i');
          if (icon) {
            icon.classList.toggle('fas', !!r.is_favorite);
            icon.classList.toggle('far', !r.is_favorite);
          }
          modalSaveBtn.innerHTML = `<i class="${r.is_favorite ? 'fas' : 'far'} fa-star"></i> ${r.is_favorite ? 'Salvo' : 'Salvar'}`;
          modalSaveBtn.setAttribute('title', r.is_favorite ? 'Remover dos salvos' : 'Salvar edital');

          // atualiza também o card (se estiver na página)
          const cardBtn = document.querySelector(`.save-btn[data-id="${String(edital.id)}"]`);
          if (cardBtn) updateSaveButtonUI(cardBtn, r.is_favorite);

          // Se estiver vendo só salvos e removeu, deixa o modal aberto,
          // mas atualiza o grid por trás.
          if (onlyFavoritos && !r.is_favorite) {
            applyFiltersAndRender({ resetPage: true });
          }
        }
      } catch (err) {
        alert(err?.message || 'Não foi possível atualizar os salvos.');
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
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  if (!modalOverlay) return;
  modalOverlay.classList.remove('open');
  modalOverlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function updateChatHeader() {
  if (!chatHeader) return;
  const editalId = chatState?.edital_id ?? chatState?.editalId ?? null;
  const titulo = chatState?.titulo ?? chatState?.edital_titulo ?? chatState?.editalTitulo ?? null;
  if (editalId && titulo) {
    chatHeader.textContent = `Athos • Edital: ${truncateText(titulo, 28)}`;
  } else {
    chatHeader.textContent = 'Athos • Assistente';
  }
}

function startEditalChat(edital) {
  if (!edital) return;
  chatState = {
    mode: 'edital',
    edital_id: edital.id,
    titulo: edital.titulo || 'Edital'
  };

  if (chatWrapper) chatWrapper.classList.add('open');
  updateChatHeader();

  addMessage(
    `Fechado. Vamos falar do edital: "${edital.titulo || 'Sem título'}".\n` +
    `Manda sua pergunta (ex: prazo, quem pode participar, valor, documentos, como enviar).`,
    'bot'
  );

  closeModal();
  try { chatInput?.focus(); } catch (_) {}
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
function shouldOfferEditaisOptions(answerText) {
  const t = String(answerText || '').toLowerCase();
  if (!t) return false;
  // cobre: "Encontrei estes editais", "Encontrei 3 edital(is)", "Encontrei esses editais"
  return t.includes('encontrei') && (t.includes('edital') || t.includes('editais'));
}

function searchEditaisForChat(query) {
  const q = String(query || '').trim();
  if (!q || !editaisOriginais || editaisOriginais.length === 0) return [];

  const qLower = q.toLowerCase();
  let items = [];

  if (fuseInstance && q.length >= 2) {
    items = fuseInstance.search(q).map(r => r.item);
  } else {
    items = editaisOriginais.filter(e => {
      const hay = [
        e.titulo, e.descricao, e.instituicao, e.estado, e.area,
        ...(Array.isArray(e.tags) ? e.tags : [])
      ].map(x => String(x || '').toLowerCase());
      return hay.some(x => x.includes(qLower));
    });
  }

  // dedupe por id
  const seen = new Set();
  const out = [];
  for (const e of items) {
    const id = String(e?.id ?? '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(e);
  }
  return out;
}

function truncateText(text, max = 80) {
  const s = String(text || '').replaceAll('\n', ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function attachEditaisOptions(msgEl, query) {
  if (!msgEl) return;

  const all = searchEditaisForChat(query);
  if (!all.length) return;

  const top = all.slice(0, 5);

  const options = top.map((e) => {
    const metaParts = [];
    if (e.instituicao) metaParts.push(e.instituicao);
    if (e.estado) metaParts.push(e.estado);
    if (e.data_fechamento) metaParts.push('Até ' + e.data_fechamento);
    const meta = metaParts.join(' • ');

    return {
      action: 'open_edital',
      id: e.id,
      title: e.titulo || 'Sem título',
      meta: meta || null
    };
  });

  if (all.length > top.length) {
    options.push({
      action: 'view_all',
      query,
      title: `Ver todos no painel (${all.length})`,
      meta: 'Aplica a busca no Dashboard'
    });
  }

  options.push({
    action: 'ask_new',
    title: 'Buscar outro tema',
    meta: 'Trocar a palavra-chave'
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


function localAssistantAnswer(question) {
  const q = String(question || '').trim();
  const qLower = q.toLowerCase();

  // Conversa humana básica (porque sim, somos mamíferos sociais)
  if (/^(oi|ol[áa]|eae|ea[íi]|bom dia|boa tarde|boa noite)\b/.test(qLower)) {
    return 'Oi! Me manda um tema (ex: inovação, saúde, educação, agricultura) que eu te listo os editais mais próximos.';
  }

  if (!editaisOriginais || editaisOriginais.length === 0) {
    return null;
  }

  let matches = [];
  if (fuseInstance && q.length >= 2) {
    matches = fuseInstance.search(q).map(r => r.item);
  } else {
    matches = editaisOriginais.filter(e => {
      const hay = [
        e.titulo, e.descricao, e.instituicao, e.estado, e.area,
        ...(Array.isArray(e.tags) ? e.tags : [])
      ].map(x => String(x || '').toLowerCase());
      return hay.some(x => x.includes(qLower));
    });
  }

  matches = matches.slice(0, 5);

  if (matches.length === 0) {
    return `Não achei editais parecidos com "${q}". Tenta outro termo (tema, instituição, estado) — tipo "inovação", "FAPESP", "SP".`;
  }

  const baseUrl = window.location.origin + window.location.pathname.split('?')[0];

  const linhas = matches.map((e, idx) => {
    const inst = e.instituicao || 'Instituição';
    const estado = e.estado || '—';
    const prazo = e.data_fechamento || 'não informado';
    const linkParam = e.slug ? `edital=${encodeURIComponent(e.slug)}` : `id=${encodeURIComponent(e.id)}`;
    const link = `${baseUrl}?${linkParam}`;
    return `${idx + 1}) ${e.titulo || 'Sem título'}\n   ${inst} • ${estado} • Data final: ${prazo}\n   ${link}`;
  });

  return `Encontrei ${matches.length} edital(is) que batem com "${q}":\n\n${linhas.join('\n\n')}`;
}

async function handleChatSend() {
  if (botIsTyping) return;

  const question = (chatInput?.value || '').trim();
  if (!question) return;

  chatInput.value = '';
  addMessage(question, 'user');

  botIsTyping = true;
  const typingMsg = addMessage('digitando...', 'bot', null, { isTyping: true });

  try {
    const editalId = chatState?.edital_id ?? chatState?.editalId ?? null;
const endpoint = editalId ? `/chat/edital/${encodeURIComponent(editalId)}` : '/chat';

const { res, data } = await apiFetchJson(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  // manda "message" (backend) e "question" (compat)
  body: JSON.stringify({ message: question, question, state: chatState }),
});

    if (!res.ok) {
      // fallback local (não deixa o usuário no vácuo)
      const local = localAssistantAnswer(question);
      setMessageText(typingMsg, local || 'O chat está indisponível no momento. Tenta de novo em alguns instantes.');
      if (shouldOfferEditaisOptions(local)) {
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

    // Se o backend vier vazio, responde localmente.
    const rawText = (answer && String(answer).trim()) ? normalizeBotText(answer) : (localAssistantAnswer(question) || 'Não consegui responder agora.');
    const extracted = extractEmbeddedSources(rawText);
    const finalText = extracted.text || rawText;
    const finalSources = normalizeSources(data?.sources, extracted.names);
    setMessageText(typingMsg, finalText, finalSources);

    // Se o bot disser que encontrou editais, mostra opções clicáveis (sem depender do backend)
    if (shouldOfferEditaisOptions(finalText)) {
      attachEditaisOptions(typingMsg, question);
    }

  } catch (e) {
    console.error('Erro no chat:', e);
    const local = localAssistantAnswer(question);
    setMessageText(typingMsg, local || 'Deu ruim aqui do meu lado. Tenta de novo em alguns segundos.');
    if (shouldOfferEditaisOptions(local)) {
      attachEditaisOptions(typingMsg, question);
    }
  } finally {
    botIsTyping = false;
    scrollToBottom();
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

