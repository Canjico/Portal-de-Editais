/* =========================================================
   Athos / Atimus — Editais (UX/UI novo + filtros + paginação)
   ========================================================= */

import { renderEditais } from './render.js';

// =========================
// CONFIGURAÇÕES & SEGURANÇA
// =========================
const API_BASE = 'https://atimus-api-acb4gfgagefcevb5.brazilsouth-01.azurewebsites.net';
const IS_LOCAL = window.location.hostname.includes('localhost') || window.location.hostname.includes('127.0.0.1');
const LOGIN_URL = IS_LOCAL ? '../Login/API/index.html' : 'https://login.atimus.agr.br';

function getStoredToken() {
  try { return localStorage.getItem('cliente_token') || sessionStorage.getItem('cliente_token'); } catch (_) { return null; }
}

function authHeaders() {
  const t = getStoredToken();
  if (!t) return {};
  return {
    'Authorization': `Bearer ${t}`,
    'X-Cliente-Token': t,
  };
}

// Se o backend redirecionar com ?token=..., salva e limpa da URL (evita "vazar" em compartilhamentos/referrer)
function bootstrapAuthFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token');
    if (!t) return;

    try { localStorage.setItem('cliente_token', t); } catch (_) {
      try { sessionStorage.setItem('cliente_token', t); } catch (_) {}
    }

    params.delete('token');
    const newQuery = params.toString();
    const newUrl = window.location.pathname + (newQuery ? `?${newQuery}` : '');
    window.history.replaceState({}, document.title, newUrl);
  } catch (_) {}
}

function buildLoginUrlWithNext() {
  const next = encodeURIComponent(window.location.href);
  const sep = LOGIN_URL.includes('?') ? '&' : '?';
  return `${LOGIN_URL}${sep}next=${next}`;
}

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
  apoio: [],        // Instrumento
  area: [],         // Categoria
  instituicao: [],
  situacao: [],
};

/** Normaliza texto pra comparação (ignora acento/case/duplo espaço). */
function normKey(v) {
  return String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Opções fixas (como você listou + a do print). */
const FIXED_FILTERS = {
  // Estados (UF)
  estado: [
    { value: 'AC', label: 'Acre - AC' },
    { value: 'AL', label: 'Alagoas - AL' },
    { value: 'AP', label: 'Amapá - AP' },
    { value: 'AM', label: 'Amazonas - AM' },
    { value: 'BA', label: 'Bahia - BA' },
    { value: 'CE', label: 'Ceará - CE' },
    { value: 'DF', label: 'Distrito Federal - DF' },
    { value: 'ES', label: 'Espírito Santo - ES' },
    { value: 'GO', label: 'Goiás - GO' },
    { value: 'MA', label: 'Maranhão - MA' },
    { value: 'MT', label: 'Mato Grosso - MT' },
    { value: 'MS', label: 'Mato Grosso do Sul - MS' },
    { value: 'MG', label: 'Minas Gerais - MG' },
    { value: 'PA', label: 'Pará - PA' },
    { value: 'PB', label: 'Paraíba - PB' },
    { value: 'PR', label: 'Paraná - PR' },
    { value: 'PE', label: 'Pernambuco - PE' },
    { value: 'PI', label: 'Piauí - PI' },
    { value: 'RJ', label: 'Rio de Janeiro - RJ' },
    { value: 'RN', label: 'Rio Grande do Norte - RN' },
    { value: 'RS', label: 'Rio Grande do Sul - RS' },
    { value: 'RO', label: 'Rondônia - RO' },
    { value: 'RR', label: 'Roraima - RR' },
    { value: 'SC', label: 'Santa Catarina - SC' },
    { value: 'SP', label: 'São Paulo - SP' },
    { value: 'SE', label: 'Sergipe - SE' },
    { value: 'TO', label: 'Tocantins - TO' },
  ],

  // Instrumento (print)
  apoio: [
    { value: 'Financiamento não reembolsável', label: 'Financiamento não reembolsável' },
    { value: 'Bolsa para pesquisadores', label: 'Bolsa para pesquisadores' },
    { value: 'Prêmios de Inovação', label: 'Prêmios de Inovação' },
    { value: 'Financiamento reembolsável', label: 'Financiamento reembolsável' },
    { value: 'Edital privado', label: 'Edital privado' },
    { value: 'Fundo de Investimento', label: 'Fundo de Investimento' },
  ],

  // Categoria
  area: [
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
  ],

  // Instituição
  instituicao: [
    { value: 'FINEP', label: 'FINEP' },
    { value: 'FAPESP', label: 'FAPESP' },
    { value: 'FAPEMIG', label: 'FAPEMIG' },
    { value: 'Araucaria', label: 'Araucária' },
    { value: 'FAPEG', label: 'FAPEG' },
    { value: 'FAPERGS', label: 'FAPERGS' },
    { value: 'FAPEAL', label: 'FAPEAL' },
    { value: 'FAPESB', label: 'FAPESB' },
    { value: 'FAPESC', label: 'FAPESC' },
    { value: 'FAPT', label: 'FAPT' },
    { value: 'FUNCAP', label: 'FUNCAP' },
    { value: 'FAPEMA', label: 'FAPEMA' },
    { value: 'FACEPE', label: 'FACEPE' },
    { value: 'FAPES', label: 'FAPES' },
    { value: 'FAPERO', label: 'FAPERO' },
    { value: 'FUNDECT', label: 'FUNDECT' },
    { value: 'FAPESQ', label: 'FAPESQ' },
    { value: 'FAPEAP', label: 'FAPEAP' },
    { value: 'FAPEAM', label: 'FAPEAM' },
    { value: 'FAPEPI', label: 'FAPEPI' },
    { value: 'FAPERJ', label: 'FAPERJ' },
    { value: 'FAPERN', label: 'FAPERN' },
    { value: 'FAPITEC', label: 'FAPITEC' },
    { value: 'CONFAP', label: 'CONFAP' },
    { value: 'Senai', label: 'SENAI' },
    { value: 'Serpro', label: 'SERPRO' },
    { value: 'AwesomeFoundation', label: 'Awesome Foundation' },
    { value: 'BASF', label: 'BASF' },
    { value: 'BNDES', label: 'BNDES' },
    { value: 'Prosas', label: 'Prosas' },
    { value: 'TetraPak', label: 'Tetra Pak' },
    { value: 'CocaCola', label: 'Coca-Cola' },
    { value: 'IAF', label: 'IAF' },
    { value: 'CAPES', label: 'CAPES' },
    { value: 'BRICS', label: 'BRICS' },
    { value: 'Santander', label: 'Santander' },
    { value: 'BancoDoNordeste', label: 'Banco do Nordeste' },
    { value: 'BRDE', label: 'BRDE' },
    { value: 'Cresol', label: 'Cresol' },
    { value: 'Correios', label: 'Correios' },
    { value: 'Petrobras', label: 'Petrobras' },
    { value: 'ANP', label: 'ANP' },
    { value: 'MiningHub', label: 'Mining Hub' },
    { value: 'VALE', label: 'VALE' },
    { value: 'Inovale', label: 'Inovale' },
    { value: 'Ambev', label: 'Ambev' },
  ],

  // Situação (calculada)
  situacao: [
    { value: 'Aberto', label: 'Aberto' },
    { value: 'Em andamento', label: 'Em andamento' },
    { value: 'Fechado', label: 'Fechado' },
  ],
};


// =========================
// ELEMENTOS DOM (novo layout)
// =========================
const container = document.getElementById('editais-container');
const searchInput = document.getElementById('search');
const sortSelect = document.getElementById('sortSelect');
const resultsMeta = document.getElementById('resultsMeta');
const paginationEl = document.getElementById('pagination');

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
const filterSearchApoio = document.getElementById('filterSearchApoio');
const filterSearchCategoria = document.getElementById('filterSearchCategoria');
const filterSearchInstituicao = document.getElementById('filterSearchInstituicao');
const filterSearchSituacao = document.getElementById('filterSearchSituacao');
// Sidebar + topbar
const sidebarToggle = document.getElementById('sidebarToggle');
const appSidebar = document.getElementById('appSidebar');
const userMenu = document.getElementById('userMenu');
const userMenuBtn = document.getElementById('userMenuBtn');
const logoutIconBtn = document.getElementById('logoutIconBtn');
const logoutBtn = document.getElementById('logoutBtn');

// Modal
const modalOverlay = document.getElementById('modal-overlay');
const modalContentContainer = document.getElementById('modal-content-container');
const modalCloseBtn = document.getElementById('modal-close-btn');

// Chat
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const messageContainer = document.getElementById('chatbot-messages');
const chatWrapper = document.getElementById('chatbot-wrapper');
const chatButton = document.querySelector('.e-contact-buttons__chat-button');

let botIsTyping = false;
let chatState = null;

// =========================
// INIT
// =========================
document.addEventListener('DOMContentLoaded', init);

async function init() {
  bootstrapAuthFromUrl();
  const isLogged = await checkAuth();
  if (!isLogged) return;

  await loadEditais();
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
}

// =========================
// AUTH
// =========================
async function checkAuth() {
  try {
    const res = await fetch(`${API_BASE}/cliente/me`, { credentials: 'include', headers: authHeaders() });
    if (!res.ok) throw new Error('Sessão inválida ou expirada');
    const data = await res.json();
    if (!data.logado) {
      window.location.href = buildLoginUrlWithNext();
      return false;
    }
    return true;
  } catch (e) {
    console.error('Erro na verificação de autenticação:', e);
    window.location.href = buildLoginUrlWithNext();
    return false;
  }
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
    const res = await fetch(`${API_BASE}/editais`);
    if (!res.ok) throw new Error('Erro na resposta da API');
    const apiData = await res.json();
    editaisOriginais = (apiData || []).map(normalizeEdital);
  } catch (e) {
    console.error('Erro ao carregar editais:', e);
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align:center; padding:2rem; color:#ef4444;">
        <i class="fas fa-exclamation-triangle fa-2x"></i>
        <p>Não foi possível carregar os editais.</p>
        <small>${escapeHtml(e.message)}</small>
        <br><br>
        <button onclick="location.reload()" class="btn btn-primary">Tentar novamente</button>
      </div>
    `;
  }
}

function normalizeEdital(api) {
  const data = typeof api?.json_data === 'string' ? safeJsonParse(api.json_data, {}) : (api?.json_data || {});
  const arquivos = typeof api?.arquivos_json === 'string' ? safeJsonParse(api.arquivos_json, []) : (api?.arquivos_json || []);
  const titulo = data.titulo || api?.titulo || 'Sem título';

  const data_fechamento = api?.data_final_submissao || data.data_final_submissao || null;
  const data_abertura = data.data_abertura || null;

  return {
    id: api?.id,
    titulo,
    slug: generateSlug(titulo),
    descricao: data.objetivo || data.descricao || 'Sem descrição',
    publico_alvo: data.publico_alvo || '',
    icone: data.icone_instituicao || null,
    instituicao: data.instituicao || '',
    estado: data.estado || 'BR',
    area: data.area || (Array.isArray(data.tags) && data.tags.length ? data.tags[0] : 'Geral'),
    apoio: data.apoio || 'Não informado', // Instrumento
    tipo: data.tipo || 'Não informado',
    valor_total: data.valor_total || '',
    data_fechamento,
    data_abertura,
    situacao: computeSituacao(data_abertura, data_fechamento),
    tags: data.tags || [],
    arquivos,
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
    { key: 'apoio', type: 'apoio' },
    { key: 'area', type: 'area' },
    { key: 'instituicao', type: 'instituicao' },
    { key: 'situacao', type: 'situacao' },
  ];

  types.forEach(({ key, type }) => {
    const box = document.querySelector(`.filter-options[data-filter-type="${type}"]`);
    if (!box) return;

    // conta por chave normalizada (pra não sofrer com acento/case)
    const counts = new Map();      // norm -> count
    const rawByKey = new Map();    // norm -> primeiro raw visto

    for (const e of editaisOriginais) {
      const raw = (e?.[key] ?? '').toString().trim();
      if (!raw) continue;
      const nk = normKey(raw);
      if (!nk) continue;
      counts.set(nk, (counts.get(nk) || 0) + 1);
      if (!rawByKey.has(nk)) rawByKey.set(nk, raw);
    }

    const fixed = FIXED_FILTERS[type] || null;
    let options = [];

    if (fixed && fixed.length) {
      const fixedKeys = new Set(fixed.map(o => normKey(o.value)));
      const extras = Array.from(rawByKey.entries())
        .filter(([nk]) => !fixedKeys.has(nk))
        .map(([, raw]) => ({ value: raw, label: raw }))
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

      options = [...fixed, ...extras];
    } else {
      options = Array.from(rawByKey.values())
        .sort((a, b) => a.localeCompare(b, 'pt-BR'))
        .map(v => ({ value: v, label: v }));
    }

    box.innerHTML = '';
    if (options.length === 0) {
      box.innerHTML = '<div style="font-size:12px; color:#9CA3AF; padding:6px;">Nenhuma opção</div>';
      return;
    }

    for (const opt of options) {
      const val = opt.value;
      const labelText = opt.label;

      const label = document.createElement('label');
      label.setAttribute('data-label', normKey(labelText));

      const left = document.createElement('span');
      left.className = 'label-left';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = val;

      const text = document.createElement('span');
      text.textContent = labelText;
      text.style.minWidth = '0';
      text.style.overflow = 'hidden';
      text.style.textOverflow = 'ellipsis';
      text.style.whiteSpace = 'nowrap';

      left.appendChild(input);
      left.appendChild(text);

      const count = document.createElement('span');
      count.className = 'filter-count';
      count.textContent = counts.get(normKey(val)) || counts.get(normKey(labelText)) || 0;

      label.appendChild(left);
      label.appendChild(count);
      box.appendChild(label);
    }
  });

  wireFilterSearch(filterSearchEstado, document.querySelector('.filter-options[data-filter-type="estado"]'));
  wireFilterSearch(filterSearchApoio, document.querySelector('.filter-options[data-filter-type="apoio"]'));
  wireFilterSearch(filterSearchCategoria, document.querySelector('.filter-options[data-filter-type="area"]'));
  wireFilterSearch(filterSearchInstituicao, document.querySelector('.filter-options[data-filter-type="instituicao"]'));
  wireFilterSearch(filterSearchSituacao, document.querySelector('.filter-options[data-filter-type="situacao"]'));
}

function wireFilterSearch(inputEl, optionsEl) {
  if (!inputEl || !optionsEl) return;
  inputEl.addEventListener('input', () => {
    const q = normKey(inputEl.value);
    optionsEl.querySelectorAll('label').forEach(label => {
      const key = label.getAttribute('data-label') || '';
      label.style.display = (!q || key.includes(q)) ? 'flex' : 'none';
    });
  });
}

function readSelected(type) {
  const root = document.querySelector(`.filter-options[data-filter-type="${type}"]`);
  if (!root) return [];
  return Array.from(root.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
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

const setEstado = new Set(applied.estado);
const setApoio = new Set(applied.apoio.map(normKey));
const setArea = new Set(applied.area.map(normKey));
const setInstituicao = new Set(applied.instituicao.map(normKey));
const setSituacao = new Set(applied.situacao.map(normKey));

if (applied.estado.length) filtered = filtered.filter(e => setEstado.has(e.estado));
if (applied.apoio.length) filtered = filtered.filter(e => setApoio.has(normKey(e.apoio)));
if (applied.area.length) filtered = filtered.filter(e => setArea.has(normKey(e.area)));
if (applied.instituicao.length) filtered = filtered.filter(e => setInstituicao.has(normKey(e.instituicao)));
if (applied.situacao.length) filtered = filtered.filter(e => setSituacao.has(normKey(e.situacao)));

// 3) Ordenação
const sort = (sortSelect?.value || 'prazo').toLowerCase();

if (sort === 'prazo') {
  filtered = [...filtered].sort((a, b) => compareIsoDate(a.data_fechamento, b.data_fechamento));
} else if (sort === 'titulo') {
  filtered = [...filtered].sort((a, b) => String(a.titulo || '').localeCompare(String(b.titulo || ''), 'pt-BR'));
} else if (sort === 'instituicao') {
  filtered = [...filtered].sort((a, b) => String(a.instituicao || '').localeCompare(String(b.instituicao || ''), 'pt-BR'));
} else if (sort === 'estado') {
  filtered = [...filtered].sort((a, b) => String(a.estado || '').localeCompare(String(b.estado || ''), 'pt-BR'));
} else if (sort === 'atualizado' || sort === 'atualizacao') {
  // "atualizado": mais recente primeiro (data_abertura quando existir)
  filtered = [...filtered].sort((a, b) => -compareIsoDate(a.data_abertura, b.data_abertura));
} else {
  // relevância: se veio do Fuse, mantém ordem; se não, mantém ordem do backend
  if (!fromFuse) filtered = filtered;
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
    resultsMeta.textContent = `Mostrando ${a}-${b} de ${total} editais`;
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


function computeSituacao(dataAbertura, dataFechamento) {
  const now = Date.now();
  const openT = parseAnyDateToTime(dataAbertura);
  const closeT = parseAnyDateToTime(dataFechamento);

  // Ainda não abriu
  if (openT !== null && now < openT) return 'Em andamento';

  // Tem prazo final: aberto até o fim do dia do fechamento
  if (closeT !== null) {
    const endOfCloseDay = closeT + (24 * 60 * 60 * 1000) - 1;
    return now > endOfCloseDay ? 'Fechado' : 'Aberto';
  }

  // Sem prazo (ou prazo inválido): mantém como "Em andamento"
  return 'Em andamento';
}

function updateHeroStats(filtered) {
  if (statTotal) statTotal.textContent = String(filtered.length);

  let abertos = 0;
  let fechados = 0;

  for (const e of filtered) {
    if (e.situacao === 'Fechado') fechados++;
    else if (e.situacao === 'Aberto') abertos++;
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
          const r = await fetch(ep.url, { method: ep.method, credentials: "include", headers: authHeaders() });
          if (r.ok) break;
        } catch (_) { /* tenta o próximo */ }
      }
    } finally {
      try { localStorage.removeItem('cliente_token'); } catch (_) {}
      try { sessionStorage.removeItem('cliente_token'); } catch (_) {}
      window.location.href = buildLoginUrlWithNext();
    }
  };
  if (logoutIconBtn) logoutIconBtn.addEventListener('click', doLogout);
  if (logoutBtn) logoutBtn.addEventListener('click', doLogout);

  // busca global (aplica instantâneo)
  if (searchInput) {
    searchInput.addEventListener('input', () => applyFiltersAndRender({ resetPage: true }));
  }

  // ordenar
  if (sortSelect) {
    sortSelect.addEventListener('change', () => applyFiltersAndRender({ resetPage: true }));
  }

  // aplicar / limpar filtros
  if (applyFiltersBtn) {
    applyFiltersBtn.addEventListener('click', () => {
      applied = {
        estado: readSelected('estado'),
        apoio: readSelected('apoio'),
        area: readSelected('area'),
        instituicao: readSelected('instituicao'),
        situacao: readSelected('situacao'),
      };
      closeFiltersMobile();
      applyFiltersAndRender({ resetPage: true });
    });
  }

  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
      document.querySelectorAll('.filter-options input[type="checkbox"]').forEach(cb => { cb.checked = false; });
      if (filterSearchEstado) filterSearchEstado.value = '';
      if (filterSearchApoio) filterSearchApoio.value = '';
      if (filterSearchCategoria) filterSearchCategoria.value = '';
      if (filterSearchInstituicao) filterSearchInstituicao.value = '';
      if (filterSearchSituacao) filterSearchSituacao.value = '';
      document.querySelectorAll('.filter-options label').forEach(l => l.style.display = 'flex');

      applied = { estado: [], apoio: [], area: [], instituicao: [], situacao: [] };
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

  // abrir edital (apenas pelo botão)
  if (container) {
    container.addEventListener('click', (e) => {
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
}

function openFiltersMobile() {
  if (!filtersPanel || !filtersBackdrop) return;
  filtersPanel.classList.add('open');
  filtersBackdrop.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeFiltersMobile() {
  if (!filtersPanel || !filtersBackdrop) return;
  filtersPanel.classList.remove('open');
  filtersBackdrop.hidden = true;
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
        <div class="attachments-summary">
          <h3>Recursos e Documentos</h3>
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

  modalContentContainer.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
      ${edital.icone ? `<img src="${escapeAttr(edital.icone)}" alt="${escapeHtml(edital.instituicao || '')}" style="max-height:70px; margin-bottom:10px;">` : '<div></div>'}
      <button class="modal-share-btn" type="button" id="modalCopyLinkBtn">
        <i class="fas fa-link"></i> Copiar link
      </button>
    </div>

    <h2>${escapeHtml(edital.titulo)}</h2>
    <p>${escapeHtml(edital.descricao)}</p>

    <div class="modal-details">
      <div><strong>Instituição</strong><span>${escapeHtml(edital.instituicao || 'Não informada')}</span></div>
      <div><strong>Estado</strong><span>${escapeHtml(edital.estado || '—')}</span></div>
      <div><strong>Instrumento</strong><span>${escapeHtml(edital.apoio || '—')}</span></div>
      ${edital.data_fechamento ? `<div><strong>Data final</strong><span>${escapeHtml(edital.data_fechamento)}</span></div>` : ''}
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

  const summary = modalContentContainer.querySelector('.attachments-summary');
  if (summary) {
    summary.addEventListener('click', () => {
      const wrapper = summary.nextElementSibling;
      const icon = summary.querySelector('i');
      wrapper.classList.toggle('open');
      if (wrapper.classList.contains('open')) {
        icon.classList.remove('fa-chevron-right');
        icon.classList.add('fa-chevron-down');
      } else {
        icon.classList.remove('fa-chevron-down');
        icon.classList.add('fa-chevron-right');
      }
    });
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

// =========================
// CHATBOT (mantido)
// =========================
function scrollToBottom() {
  if (!messageContainer) return;
  setTimeout(() => { messageContainer.scrollTop = messageContainer.scrollHeight; }, 50);
}

function addMessage(text, sender = 'bot', sources = null) {
  if (!messageContainer) return;
  const msg = document.createElement('div');
  msg.className = `chat-message ${sender}`;
  msg.innerHTML = `<div class="bubble">${escapeHtml(text)}</div>`;
  messageContainer.appendChild(msg);

  if (sources && Array.isArray(sources) && sources.length) {
    const details = buildSourcesDetails(sources);
    if (details) msg.appendChild(details);
  }

  scrollToBottom();
}

function buildSourcesDetails(sources) {
  const ok = sources.filter(s => s && s.status === 'ok').length;
  const total = sources.length;

  const details = document.createElement('details');
  details.className = 'chat-sources-details';
  details.style.marginTop = '10px';

  const summary = document.createElement('summary');
  summary.textContent = `📎 Fontes consultadas (${ok}/${total})`;
  details.appendChild(summary);

  const ul = document.createElement('ul');
  ul.style.margin = '8px 0 0 18px';

  sources.forEach((s) => {
    const li = document.createElement('li');
    const title = s?.title || s?.name || 'Fonte';
    const url = s?.url;
    li.innerHTML = url ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>` : escapeHtml(title);
    ul.appendChild(li);
  });

  details.appendChild(ul);
  return details;
}

async function handleChatSend() {
  if (botIsTyping) return;
  const question = (chatInput?.value || '').trim();
  if (!question) return;

  chatInput.value = '';
  addMessage(question, 'user');

  botIsTyping = true;
  addMessage('digitando...', 'bot');
  const lastBotBubble = messageContainer?.querySelector('.chat-message.bot:last-child .bubble');

  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, state: chatState }),
      credentials: 'include'
    });

    const data = await res.json();
    chatState = data?.state ?? chatState;

    if (lastBotBubble) {
      lastBotBubble.textContent = data?.answer || 'Não consegui responder agora.';
    }
  } catch (e) {
    console.error('Erro no chat:', e);
    if (lastBotBubble) lastBotBubble.textContent = 'Deu ruim aqui do meu lado. Tenta de novo em alguns segundos.';
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
