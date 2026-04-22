/* =========================================================
   Athos / Atimus — Auth + Fetch (shared)
   - Centraliza API_BASE, token opcional, login redirect e fetch robusto
   ========================================================= */

export const API_BASE = 'https://atimus-api-acb4gfgagefcevb5.brazilsouth-01.azurewebsites.net';
const CLIENTE_TOKEN_KEY = 'cliente_token';
const BOOTSTRAP_ME_KEY = 'athos_bootstrap_me';
const BOOTSTRAP_ME_SAVED_AT_KEY = 'athos_bootstrap_me_saved_at';
const BOOTSTRAP_HANDOFF_QUERY_KEY = 'boot';
const AUTH_DEBUG_TAG = '[DEBUG_AUTH][Portal]';
const AUTH_DEBUG_STORAGE_KEY = 'athos_auth_debug';
let authRedirectInProgress = false;

export const IS_LOCAL =
  window.location.hostname.includes('localhost') ||
  window.location.hostname.includes('127.0.0.1') ||
  window.location.protocol === 'file:';

// Caminho local padrão (absoluto quando possível, para não depender do "../")
export const LOGIN_URL = IS_LOCAL
  ? ((window.location.origin && window.location.origin !== 'null')
      ? `${window.location.origin}/Login-main/Login/index.html`
      : './Login-main/Login/index.html')
  : 'https://login.atimus.agr.br';

function debugAuth(event, details) {
  if (!isAuthDebugEnabled()) return;
  if (details === undefined) {
    console.debug(`${AUTH_DEBUG_TAG} ${event}`);
    return;
  }
  console.debug(`${AUTH_DEBUG_TAG} ${event}`, details);
}

function isAuthDebugEnabled() {
  try {
    if (window.ATHOS_AUTH_DEBUG === true) return true;
  } catch (_) {}

  try {
    const value = String(
      localStorage.getItem(AUTH_DEBUG_STORAGE_KEY) ||
      sessionStorage.getItem(AUTH_DEBUG_STORAGE_KEY) ||
      ''
    )
      .trim()
      .toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
  } catch (_) {
    return false;
  }
}

// =========================
// TOKEN OPCIONAL
// =========================
export function getStoredToken() {
  try {
    return localStorage.getItem(CLIENTE_TOKEN_KEY) || sessionStorage.getItem(CLIENTE_TOKEN_KEY);
  } catch (_) {
    return null;
  }
}

export function extractAuthToken(data) {
  if (!data || typeof data !== 'object') return '';
  const detail = data.detail && typeof data.detail === 'object' ? data.detail : {};
  const nested = data.data && typeof data.data === 'object' ? data.data : {};
  const user = data.user && typeof data.user === 'object' ? data.user : {};
  const candidates = [
    data.token,
    data.access_token,
    data.cliente_token,
    data.jwt,
    data.auth_token,
    data.accessToken,
    data.clienteToken,
    data.authToken,
    detail.token,
    detail.access_token,
    detail.cliente_token,
    detail.jwt,
    detail.auth_token,
    detail.accessToken,
    detail.clienteToken,
    detail.authToken,
    nested.token,
    nested.access_token,
    nested.cliente_token,
    nested.jwt,
    nested.auth_token,
    nested.accessToken,
    nested.clienteToken,
    nested.authToken,
    user.token,
    user.access_token,
    user.accessToken,
    user.cliente_token,
    user.clienteToken,
  ];

  for (const value of candidates) {
    const token = String(value || '').trim();
    if (token) return token;
  }
  return '';
}

export function persistClienteToken(tokenValue, { remember = true } = {}) {
  const token = String(tokenValue || '').trim();
  if (!token) return false;

  let saved = false;
  try {
    sessionStorage.setItem(CLIENTE_TOKEN_KEY, token);
    saved = true;
  } catch (_) {}

  try {
    if (remember) {
      localStorage.setItem(CLIENTE_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(CLIENTE_TOKEN_KEY);
    }
    saved = true;
  } catch (_) {}

  debugAuth('token_persisted', { saved, remember });
  return saved;
}

function normalizeBootstrapUserCandidate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = (
    raw.bootstrap_user &&
    typeof raw.bootstrap_user === 'object' &&
    !Array.isArray(raw.bootstrap_user)
  )
    ? raw.bootstrap_user
    : raw;

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const hasMinimumIdentity = Boolean(
    candidate.id ||
    String(candidate.nome || '').trim() ||
    String(candidate.email || '').trim()
  );
  if (!hasMinimumIdentity) return null;
  return candidate;
}

export function persistBootstrapUserInSession(bootstrapUser, { savedAt = Date.now() } = {}) {
  const normalized = normalizeBootstrapUserCandidate(bootstrapUser);
  if (!normalized) return false;

  try {
    sessionStorage.setItem(BOOTSTRAP_ME_KEY, JSON.stringify(normalized));
    sessionStorage.setItem(BOOTSTRAP_ME_SAVED_AT_KEY, String(Number(savedAt) || Date.now()));
    debugAuth('bootstrap_user_saved', {
      hasId: Boolean(normalized.id),
      hasEmail: Boolean(normalized.email),
    });
    return true;
  } catch (_) {
    return false;
  }
}

export function clearBootstrapUserFromSession() {
  try {
    sessionStorage.removeItem(BOOTSTRAP_ME_KEY);
    sessionStorage.removeItem(BOOTSTRAP_ME_SAVED_AT_KEY);
  } catch (_) {}
}

export function readBootstrapUserFromSession({ consume = true, maxAgeMs = 10 * 60 * 1000 } = {}) {
  try {
    const raw = sessionStorage.getItem(BOOTSTRAP_ME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const normalized = normalizeBootstrapUserCandidate(parsed);
    if (!normalized) {
      clearBootstrapUserFromSession();
      return null;
    }

    const savedAt = Number(sessionStorage.getItem(BOOTSTRAP_ME_SAVED_AT_KEY) || 0);
    if (savedAt > 0 && Number(maxAgeMs) > 0 && (Date.now() - savedAt) > Number(maxAgeMs)) {
      debugAuth('bootstrap_user_expired', { ageMs: Date.now() - savedAt, maxAgeMs: Number(maxAgeMs) });
      clearBootstrapUserFromSession();
      return null;
    }

    if (consume) {
      clearBootstrapUserFromSession();
      debugAuth('bootstrap_user_consumed', { consume: true });
    }
    return normalized;
  } catch (_) {
    clearBootstrapUserFromSession();
    return null;
  }
}

export function authHeaders(extra = {}) {
  const t = getStoredToken();
  const base = { ...extra };
  if (!t) return base;

  // Manda nos dois formatos porque o backend pode aceitar um ou outro.
  base.Authorization = `Bearer ${t}`;
  base['X-Cliente-Token'] = t;
  return base;
}

function decodeBase64Url(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
    const remainder = padded.length % 4;
    const normalized = remainder === 0 ? padded : `${padded}${'='.repeat(4 - remainder)}`;
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(bytes);
    }
    return decodeURIComponent(
      Array.from(bytes, (b) => `%${b.toString(16).padStart(2, '0')}`).join('')
    );
  } catch (_) {
    return '';
  }
}

function parseBootstrapHandoffToken(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) return null;

  let payloadEncoded = token;
  const parts = token.split('.');
  if (parts.length >= 3 && String(parts[0] || '').toLowerCase() === 'v1') {
    payloadEncoded = parts[1];
  }

  const payloadJson = decodeBase64Url(payloadEncoded);
  if (!payloadJson) return null;

  try {
    const parsed = JSON.parse(payloadJson);
    if (!parsed || typeof parsed !== 'object') return null;
    const expiresAt = Number(parsed.exp || parsed.expires_at || 0);
    const nowSec = Math.floor(Date.now() / 1000);
    if (expiresAt > 0 && nowSec > expiresAt) {
      debugAuth('bootstrap_handoff_expired', { nowSec, expiresAt });
      return null;
    }

    const bootstrapUser = normalizeBootstrapUserCandidate(
      parsed.bootstrap_user || parsed.bootstrapUser || parsed.user || parsed.b || null
    );
    if (!bootstrapUser) return null;
    const issuedAtMs = Number(parsed.iat || 0) > 0 ? Number(parsed.iat) * 1000 : Date.now();
    return { bootstrapUser, issuedAtMs };
  } catch (_) {
    return null;
  }
}

export function bootstrapAuthFromUrl() {
  // Consome handoff transitório de bootstrap e, por compatibilidade, token legado na URL.
  try {
    const params = new URLSearchParams(window.location.search);
    let shouldCleanUrl = false;

    const bootToken = String(params.get(BOOTSTRAP_HANDOFF_QUERY_KEY) || '').trim();
    if (bootToken) {
      const parsedHandoff = parseBootstrapHandoffToken(bootToken);
      if (parsedHandoff?.bootstrapUser) {
        persistBootstrapUserInSession(parsedHandoff.bootstrapUser, {
          savedAt: parsedHandoff.issuedAtMs,
        });
        debugAuth('bootstrap_handoff_from_url', { hasBootstrapUser: true });
      } else {
        clearBootstrapUserFromSession();
        debugAuth('bootstrap_handoff_invalid_or_expired', { hasBootstrapUser: false });
      }
      params.delete(BOOTSTRAP_HANDOFF_QUERY_KEY);
      shouldCleanUrl = true;
    }

    const t = params.get('token');
    if (t) {
      persistClienteToken(t, { remember: true });
      debugAuth('bootstrap_token_from_url', { hasToken: true });
      params.delete('token');
      shouldCleanUrl = true;
    }

    if (!shouldCleanUrl) return;
    const newQuery = params.toString();
    const newUrl = window.location.pathname + (newQuery ? `?${newQuery}` : '') + (window.location.hash || '');
    window.history.replaceState({}, document.title, newUrl);
    debugAuth('bootstrap_auth_query_cleaned', { newUrl });
  } catch (_) {}
}

function appendQueryParams(baseUrl, params = {}) {
  const target = String(baseUrl || LOGIN_URL || '').trim() || LOGIN_URL;
  try {
    const url = new URL(target, window.location.origin);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      url.searchParams.set(String(key), String(value));
    });
    return url.toString();
  } catch (_) {
    const entries = Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== null && value !== '');
    if (!entries.length) return target;
    const serialized = entries
      .map(([key, value]) => `${encodeURIComponent(String(key))}=${encodeURIComponent(String(value))}`)
      .join('&');
    const sep = target.includes('?') ? '&' : '?';
    return `${target}${sep}${serialized}`;
  }
}

export function buildLoginUrlWithNext(extraParams = {}) {
  const loginUrl = appendQueryParams(LOGIN_URL, {
    next: window.location.href,
    ...extraParams,
  });
  debugAuth('build_login_url_with_next', { loginUrl, extraParams });
  return loginUrl;
}

function toAbsoluteUrl(value) {
  try {
    return new URL(String(value || ''), window.location.origin).toString();
  } catch (_) {
    return '';
  }
}

export function redirectWithAuthGuard(target, reason, { replace = false, allowSameUrl = false } = {}) {
  const resolvedTarget = toAbsoluteUrl(target);
  if (!resolvedTarget) {
    debugAuth('redirect_cancelled_invalid_target', { reason, target });
    return false;
  }

  const currentUrl = toAbsoluteUrl(window.location.href);
  if (!allowSameUrl && currentUrl && currentUrl === resolvedTarget) {
    debugAuth('redirect_cancelled_same_url', { reason, target: resolvedTarget });
    return false;
  }

  if (authRedirectInProgress) {
    debugAuth('redirect_cancelled_already_in_progress', { reason, target: resolvedTarget });
    return false;
  }

  authRedirectInProgress = true;
  debugAuth('redirect_dispatch', { reason, target: resolvedTarget, replace });
  if (replace) {
    window.location.replace(resolvedTarget);
  } else {
    window.location.href = resolvedTarget;
  }
  return true;
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
 * Fetch "forte": tenta com cookies (credentials=include) e, se der erro de CORS/rede,
 * tenta sem credentials.
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
    { ...options, headers: mergedHeaders },
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

export function extractApiErrorMessage(data, fallback = 'Erro ao processar a solicitação.') {
  if (!data || typeof data !== 'object') return fallback;
  if (typeof data.detail === 'string' && data.detail.trim()) return data.detail;
  if (data.detail && typeof data.detail === 'object') {
    if (typeof data.detail.detail === 'string' && data.detail.detail.trim()) return data.detail.detail;
    if (typeof data.detail.msg === 'string' && data.detail.msg.trim()) return data.detail.msg;
  }
  if (typeof data.msg === 'string' && data.msg.trim()) return data.msg;
  return fallback;
}

function normalizeComparableMessage(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  } catch (_) {
    return raw.toLowerCase();
  }
}

function isTruthyLike(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const normalized = normalizeComparableMessage(value);
    return normalized === 'true' || normalized === '1' || normalized === 'sim';
  }
  return false;
}

export function isPasswordChangeRequiredPayload(data) {
  if (!data || typeof data !== 'object') return false;

  const code = String(
    data.code ||
    data.auth_code ||
    (data.detail && typeof data.detail === 'object' ? data.detail.code : '')
  ).trim().toUpperCase();

  if (
    code === 'PASSWORD_CHANGE_REQUIRED' ||
    code === 'FIRST_ACCESS_PASSWORD_CHANGE_REQUIRED' ||
    code === 'PASSWORD_RESET_REQUIRED' ||
    code === 'FORCE_PASSWORD_CHANGE' ||
    code === 'FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED'
  ) {
    return true;
  }

  const detail = data.detail && typeof data.detail === 'object' ? data.detail : {};
  const flags = [
    data.password_change_required,
    data.must_change_password,
    data.temporary_password,
    data.forcar_troca_senha,
    data.force_password_change,
    data.first_access,
    data.first_login,
    data.password_reset_required,
    data.requires_password_reset,
    data.must_reset_password,
    data.need_password_change,
    detail.password_change_required,
    detail.must_change_password,
    detail.temporary_password,
    detail.forcar_troca_senha,
    detail.force_password_change,
    detail.first_access,
    detail.first_login,
    detail.password_reset_required,
    detail.requires_password_reset,
    detail.must_reset_password,
    detail.need_password_change,
  ];
  if (flags.some(isTruthyLike)) {
    return true;
  }

  const message = normalizeComparableMessage(extractApiErrorMessage(data, ''));
  return (
    message.includes('troca de senha obrigatoria') ||
    message.includes('obrigatorio trocar senha') ||
    message.includes('senha deve ser alterada') ||
    message.includes('password change required') ||
    message.includes('must change password') ||
    message.includes('force password change') ||
    message.includes('first access password change')
  );
}

export function extractPasswordChangeToken(data) {
  if (!data || typeof data !== 'object') return '';
  const detail = data.detail && typeof data.detail === 'object' ? data.detail : {};
  const nested = data.data && typeof data.data === 'object' ? data.data : {};
  const candidates = [
    data.reset_token,
    data.password_reset_token,
    data.password_change_token,
    data.token_redefinicao,
    data.token_redefinir_senha,
    data.resetToken,
    data.passwordResetToken,
    data.passwordChangeToken,
    data.tokenRedefinicao,
    data.tokenRedefinirSenha,
    data.token,
    detail.reset_token,
    detail.password_reset_token,
    detail.password_change_token,
    detail.token_redefinicao,
    detail.token_redefinir_senha,
    detail.resetToken,
    detail.passwordResetToken,
    detail.passwordChangeToken,
    detail.tokenRedefinicao,
    detail.tokenRedefinirSenha,
    detail.token,
    nested.reset_token,
    nested.password_reset_token,
    nested.password_change_token,
    nested.token_redefinicao,
    nested.token_redefinir_senha,
    nested.resetToken,
    nested.passwordResetToken,
    nested.passwordChangeToken,
    nested.tokenRedefinicao,
    nested.tokenRedefinirSenha,
    nested.token,
  ];

  for (const value of candidates) {
    const token = String(value || '').trim();
    if (token) return token;
  }
  return '';
}

function isPasswordFlowPath(path = '') {
  const normalized = normalizeComparableMessage(path).replace(/\s+/g, '');
  if (!normalized) return false;
  return (
    normalized.includes('redefin') ||
    normalized.includes('reset') ||
    normalized.includes('trocasenha') ||
    normalized.includes('alterarsenha') ||
    normalized.includes('novasenha') ||
    normalized.includes('primeiroacesso') ||
    normalized.includes('password')
  );
}

function isLikelyLoginRoute(url) {
  if (!url) return false;
  const host = String(url.hostname || '').toLowerCase();
  const path = String(url.pathname || '').toLowerCase();
  if (host === 'login.atimus.agr.br') return true;
  return path.includes('/login') || path.includes('/signin');
}

export function resolvePasswordChangeRedirectTarget(data, fallbackUrl = LOGIN_URL) {
  const candidates = [
    data?.redirect,
    data?.next,
    data?.password_change_url,
    data?.reset_url,
    data?.detail && typeof data.detail === 'object' ? data.detail.redirect : '',
    data?.detail && typeof data.detail === 'object' ? data.detail.next : '',
    data?.detail && typeof data.detail === 'object' ? data.detail.password_change_url : '',
    data?.detail && typeof data.detail === 'object' ? data.detail.reset_url : '',
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, window.location.origin);
      const hasResetToken = Boolean(url.searchParams.get('reset_token'));
      const hasForceParam = url.searchParams.get('force_password_change') === '1';
      if (
        hasResetToken ||
        isPasswordFlowPath(url.pathname) ||
        (hasForceParam && isLikelyLoginRoute(url))
      ) {
        const resolved = url.toString();
        debugAuth('password_change_redirect_from_payload_url', { resolved });
        return resolved;
      }
    } catch (_) {
      // ignora URL inválida
    }
  }

  const resetToken = extractPasswordChangeToken(data);
  if (resetToken) {
    const resolved = appendQueryParams(fallbackUrl, {
      force_password_change: '1',
      reset_token: resetToken,
    });
    debugAuth('password_change_redirect_from_token', { resolved, hasResetToken: true });
    return resolved;
  }

  debugAuth('password_change_redirect_fallback', { fallback: fallbackUrl });
  return fallbackUrl;
}

export function isPasswordChangeRequiredResponse(res, data) {
  if (!res) return false;
  const status = Number(res.status);
  if (!(status === 401 || status === 403)) return false;
  const required = isPasswordChangeRequiredPayload(data);
  if (required) {
    debugAuth('password_change_required_response', { status });
  }
  return required;
}

export function resolveAuthFailureRedirectTarget(
  res,
  data,
  {
    buildLoginUrl = () => buildLoginUrlWithNext(),
    resolvePasswordTarget = (payload, fallback) => resolvePasswordChangeRedirectTarget(payload, fallback),
  } = {}
) {
  const status = Number(res?.status || 0);
  if (!(status === 401 || status === 403)) return null;

  if (isPasswordChangeRequiredResponse(res, data) || isPasswordChangeRequiredPayload(data)) {
    const fallbackUrl = buildLoginUrl();
    return {
      target: resolvePasswordTarget(data, fallbackUrl),
      reason: 'password_change_required',
    };
  }

  return {
    target: buildLoginUrl(),
    reason: 'unauthorized',
  };
}
