const AUTH_HANDOFF_STORAGE_KEY = 'athos_auth_handoff_v1';
const AUTH_HANDOFF_HASH_KEY = '__athos_bootstrap';
const AUTH_HANDOFF_QUERY_KEYS = ['boot', AUTH_HANDOFF_HASH_KEY];
const AUTH_HANDOFF_MAX_AGE_MS = 2 * 60 * 1000;

function nowMs() {
  return Date.now();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function decodeBase64Url(value) {
  const input = normalizeText(value);
  if (!input) return '';
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  try {
    return decodeURIComponent(Array.from(atob(padded)).map((ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
  } catch (_) {
    try {
      return atob(padded);
    } catch (_) {
      return '';
    }
  }
}

function normalizePayload(raw) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const permissions = payload.permissions && typeof payload.permissions === 'object' ? payload.permissions : {};
  const company = payload.company && typeof payload.company === 'object' ? payload.company : null;

  const normalized = {
    id: Number(payload.id || payload.cliente_id || 0) || 0,
    nome: normalizeText(payload.nome || payload.nomeCompleto || payload.nome_completo || payload.user?.nome || payload.usuario?.nome),
    email: normalizeText(payload.email || payload.user?.email || payload.usuario?.email),
    role: normalizeText(payload.role || permissions.role),
    role_label: normalizeText(payload.role_label || permissions.role_label),
    estadoUf: normalizeText(payload.estadoUf || payload.estado_uf || payload.estadoUF),
    themePreference: normalizeText(payload.themePreference || payload.theme_preference),
    cnpj: normalizeText(payload.cnpj || payload.company?.cnpj),
    permissions: {
      role: normalizeText(permissions.role || payload.role),
      role_label: normalizeText(permissions.role_label || payload.role_label),
      is_company_owner: Boolean(permissions.is_company_owner || payload.is_company_owner),
      can_manage_company: Boolean(permissions.can_manage_company),
      can_manage_subaccounts: Boolean(permissions.can_manage_subaccounts),
      can_view_company_tickets: Boolean(permissions.can_view_company_tickets),
      can_manage_company_tickets: Boolean(permissions.can_manage_company_tickets),
      can_view_company_sessions: Boolean(permissions.can_view_company_sessions),
      can_manage_company_sessions: Boolean(permissions.can_manage_company_sessions),
    },
    company: company
      ? {
          id: Number(company.id || 0) || 0,
          nome: normalizeText(company.nome || company.nome_empresa),
          cnpj: normalizeText(company.cnpj),
          estadoUf: normalizeText(company.estadoUf || company.estado_uf || ''),
        }
      : null,
  };

  if (!normalized.id && !normalized.email && !normalized.nome) return null;
  return normalized;
}

function parseEnvelopeJson(raw, { allowMissingCreatedAt = false } = {}) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const createdAt = Number(parsed.createdAt || parsed.at || parsed.timestamp || 0) || 0;
    const expiresAt = Number(parsed.expiresAt || parsed.expireAt || 0) || 0;
    if (expiresAt && nowMs() > expiresAt) return null;
    if (createdAt && (nowMs() - createdAt) > AUTH_HANDOFF_MAX_AGE_MS) return null;
    if (!createdAt && !allowMissingCreatedAt) return null;

    const payload = normalizePayload(parsed.payload || parsed.data || parsed.bootstrap_user || parsed.user || parsed);
    return payload || null;
  } catch (_) {
    return null;
  }
}

function parseSignedToken(rawToken) {
  const token = normalizeText(rawToken);
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;

  const decoded = decodeBase64Url(parts[1]);
  if (!decoded) return null;
  try {
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object') return null;
    const expMs = Number(parsed.exp || 0) * 1000;
    const iatMs = Number(parsed.iat || 0) * 1000;
    if (expMs && nowMs() > expMs) return null;
    if (iatMs && (nowMs() - iatMs) > AUTH_HANDOFF_MAX_AGE_MS) return null;
    return normalizePayload(parsed.bootstrap_user || parsed.payload || parsed.data || parsed) || null;
  } catch (_) {
    return null;
  }
}

function parseRawHandoffValue(raw) {
  const value = normalizeText(raw);
  if (!value) return null;

  const fromSigned = parseSignedToken(value);
  if (fromSigned) return fromSigned;

  const fromEnvelope = parseEnvelopeJson(value, { allowMissingCreatedAt: true });
  if (fromEnvelope) return fromEnvelope;

  const decoded = decodeBase64Url(value);
  if (!decoded) return null;

  const decodedSigned = parseSignedToken(decoded);
  if (decodedSigned) return decodedSigned;

  return parseEnvelopeJson(decoded, { allowMissingCreatedAt: true });
}

function persistParsedPayload(payload, createdAt = nowMs()) {
  const safePayload = normalizePayload(payload);
  if (!safePayload) return false;

  const safeCreatedAt = Number(createdAt || 0) || nowMs();
  const envelope = {
    createdAt: safeCreatedAt,
    expiresAt: safeCreatedAt + AUTH_HANDOFF_MAX_AGE_MS,
    payload: safePayload,
  };
  const serialized = JSON.stringify(envelope);

  let stored = false;
  try {
    sessionStorage.setItem(AUTH_HANDOFF_STORAGE_KEY, serialized);
    stored = true;
  } catch (_) {}

  if (!stored) {
    try {
      localStorage.setItem(AUTH_HANDOFF_STORAGE_KEY, serialized);
      stored = true;
    } catch (_) {}
  }

  return stored;
}

function removeUrlParams(keys = []) {
  const keySet = new Set((Array.isArray(keys) ? keys : []).map((item) => normalizeText(item)).filter(Boolean));
  if (!keySet.size) return;

  try {
    const url = new URL(window.location.href);
    let changed = false;
    keySet.forEach((key) => {
      if (!url.searchParams.has(key)) return;
      url.searchParams.delete(key);
      changed = true;
    });
    if (changed) {
      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState({}, document.title, nextUrl);
    }
  } catch (_) {}
}

function removeHashParams(keys = []) {
  const keySet = new Set((Array.isArray(keys) ? keys : []).map((item) => normalizeText(item)).filter(Boolean));
  if (!keySet.size) return;

  try {
    const hash = String(window.location.hash || '').replace(/^#/, '');
    if (!hash) return;
    const params = new URLSearchParams(hash);
    let changed = false;
    keySet.forEach((key) => {
      if (!params.has(key)) return;
      params.delete(key);
      changed = true;
    });
    if (!changed) return;
    const nextHash = params.toString();
    const nextUrl = `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ''}`;
    window.history.replaceState({}, document.title, nextUrl);
  } catch (_) {}
}

function readFromQuery({ consume = true } = {}) {
  try {
    const params = new URLSearchParams(window.location.search || '');
    for (const key of AUTH_HANDOFF_QUERY_KEYS) {
      const raw = normalizeText(params.get(key));
      if (!raw) continue;
      const parsed = parseRawHandoffValue(raw);
      if (consume) removeUrlParams([key]);
      if (!parsed) continue;
      persistParsedPayload(parsed);
      return parsed;
    }
  } catch (_) {}
  return null;
}

function readFromHash({ consume = true } = {}) {
  try {
    const hash = String(window.location.hash || '').replace(/^#/, '');
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    const keys = [AUTH_HANDOFF_HASH_KEY, ...AUTH_HANDOFF_QUERY_KEYS];

    for (const key of keys) {
      const raw = normalizeText(params.get(key));
      if (!raw) continue;
      const parsed = parseRawHandoffValue(raw);
      if (consume) removeHashParams([key]);
      if (!parsed) continue;
      persistParsedPayload(parsed);
      return parsed;
    }
  } catch (_) {}
  return null;
}

function clearStoredHandoff() {
  try {
    sessionStorage.removeItem(AUTH_HANDOFF_STORAGE_KEY);
  } catch (_) {}
  try {
    localStorage.removeItem(AUTH_HANDOFF_STORAGE_KEY);
  } catch (_) {}
}

function readFromStorage() {
  try {
    const raw = sessionStorage.getItem(AUTH_HANDOFF_STORAGE_KEY) || localStorage.getItem(AUTH_HANDOFF_STORAGE_KEY);
    if (!raw) return null;
    const parsed = parseEnvelopeJson(raw);
    if (!parsed) {
      clearStoredHandoff();
      return null;
    }
    return parsed;
  } catch (_) {
    return null;
  }
}

export function persistAuthHandoff(payload, { createdAt = nowMs() } = {}) {
  return persistParsedPayload(payload, createdAt);
}

export function readAuthHandoff({ consume = true } = {}) {
  const fromQuery = readFromQuery({ consume });
  if (fromQuery) return fromQuery;

  const fromHash = readFromHash({ consume });
  if (fromHash) return fromHash;

  return readFromStorage();
}
