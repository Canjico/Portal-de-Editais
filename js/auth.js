/* =========================================================
   Athos / Atimus — Auth + Fetch (shared)
   - Centraliza API_BASE, token opcional, login redirect e fetch robusto
   ========================================================= */

export const API_BASE = 'https://atimus-api-acb4gfgagefcevb5.brazilsouth-01.azurewebsites.net';

export const IS_LOCAL =
  window.location.hostname.includes('localhost') ||
  window.location.hostname.includes('127.0.0.1') ||
  window.location.protocol === 'file:';

// Caminho local padrão (absoluto quando possível, pra não depender do "../")
export const LOGIN_URL = IS_LOCAL
  ? ((window.location.origin && window.location.origin !== 'null')
      ? `${window.location.origin}/Login/API/index.html`
      : './Login/API/index.html')
  : 'https://login.atimus.agr.br';

// =========================
// TOKEN OPCIONAL
// =========================
export function getStoredToken() {
  try {
    return localStorage.getItem('cliente_token') || sessionStorage.getItem('cliente_token');
  } catch (_) {
    return null;
  }
}

export function authHeaders(extra = {}) {
  const t = getStoredToken();
  const base = { ...extra };
  if (!t) return base;

  // manda nos dois formatos porque backend pode aceitar um ou outro
  base['Authorization'] = `Bearer ${t}`;
  base['X-Cliente-Token'] = t;
  return base;
}

export function bootstrapAuthFromUrl() {
  // Se vier ?token= na URL (ex: vindo do login), salva e limpa a query.
  try {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token');
    if (!t) return;

    try {
      localStorage.setItem('cliente_token', t);
    } catch (_) {
      try { sessionStorage.setItem('cliente_token', t); } catch (_) {}
    }

    params.delete('token');
    const newQuery = params.toString();
    const newUrl = window.location.pathname + (newQuery ? `?${newQuery}` : '');
    window.history.replaceState({}, document.title, newUrl);
  } catch (_) {}
}

export function buildLoginUrlWithNext() {
  const next = encodeURIComponent(window.location.href);
  const sep = LOGIN_URL.includes('?') ? '&' : '?';
  return `${LOGIN_URL}${sep}next=${next}`;
}

export async function safeReadJson(res) {
  // Evita crash quando o backend não devolve JSON (ou devolve HTML).
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('application/json')) {
    try { return await res.json(); } catch { return null; }
  }
  try {
    const text = await res.text();
    return { _rawText: text };
  } catch {
    return null;
  }
}

function absolutize(pathOrUrl) {
  if (!pathOrUrl) return API_BASE;
  const s = String(pathOrUrl);
  if (/^https?:\/\//i.test(s)) return s;
  if (!s.startsWith('/')) return `${API_BASE}/${s}`;
  return `${API_BASE}${s}`;
}

/**
 * Fetch "forte": tenta com cookies (credentials=include) e, se der pau de CORS/rede, tenta sem.
 * Isso evita a tela "morta" quando o ambiente bloqueia credenciais.
 */
export async function apiFetch(pathOrUrl, options = {}) {
  const url = absolutize(pathOrUrl);

  const baseHeaders = options.headers instanceof Headers
    ? Object.fromEntries(options.headers.entries())
    : (options.headers || {});

  // Sempre injeta token (se houver) por cima do que veio.
  const mergedHeaders = authHeaders(baseHeaders);

  const attempts = [
    { ...options, headers: mergedHeaders, credentials: 'include' },
    { ...options, headers: mergedHeaders }, // sem credentials (ajuda em CORS chato)
  ];

  let lastErr = null;

  for (const opt of attempts) {
    try {
      const res = await fetch(url, opt);
      return res;
    } catch (e) {
      lastErr = e;
      // tenta o próximo
    }
  }

  throw lastErr || new Error('Falha ao fazer requisição.');
}

export async function apiFetchJson(pathOrUrl, options = {}) {
  const res = await apiFetch(pathOrUrl, options);
  const data = await safeReadJson(res);
  return { res, data };
}
