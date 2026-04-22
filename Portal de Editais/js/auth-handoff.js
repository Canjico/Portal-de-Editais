const AUTH_HANDOFF_STORAGE_KEY = 'athos_auth_handoff_v1';
const AUTH_HANDOFF_HASH_KEY = '__athos_bootstrap';
const AUTH_HANDOFF_MAX_AGE_MS = 2 * 60 * 1000;

function nowMs() {
  return Date.now();
}

function normalizeText(value) {
  return String(value || '').trim();
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
    estadoUf: normalizeText(payload.estadoUf),
    themePreference: normalizeText(payload.themePreference),
    cnpj: normalizeText(payload.cnpj),
    permissions: {
      role: normalizeText(permissions.role),
      role_label: normalizeText(permissions.role_label),
      is_company_owner: Boolean(permissions.is_company_owner),
      can_manage_company: Boolean(permissions.can_manage_company),
      can_manage_subaccounts: Boolean(permissions.can_manage_subaccounts),
      can_view_company_tickets: Boolean(permissions.can_view_company_tickets),
      can_manage_company_tickets: Boolean(permissions.can_manage_company_tickets),
      can_view_company_sessions: Boolean(permissions.can_view_company_sessions),
    },
    company: company
      ? {
          id: Number(company.id || 0) || 0,
          nome: normalizeText(company.nome),
          cnpj: normalizeText(company.cnpj),
          estadoUf: normalizeText(company.estadoUf),
        }
      : null,
  };

  if (!normalized.id && !normalized.email && !normalized.nome) return null;
  return normalized;
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

function parseEnvelope(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const createdAt = Number(parsed.createdAt || parsed.at || 0) || 0;
    if (!createdAt || (nowMs() - createdAt) > AUTH_HANDOFF_MAX_AGE_MS) return null;
    return normalizePayload(parsed.payload || parsed.data || parsed);
  } catch (_) {
    return null;
  }
}

function removeHashParam() {
  try {
    const hash = String(window.location.hash || '').replace(/^#/, '');
    if (!hash) return;
    const params = new URLSearchParams(hash);
    if (!params.has(AUTH_HANDOFF_HASH_KEY)) return;
    params.delete(AUTH_HANDOFF_HASH_KEY);
    const nextHash = params.toString();
    const nextUrl = `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ''}`;
    window.history.replaceState({}, document.title, nextUrl);
  } catch (_) {}
}

function readFromHash({ consume = true } = {}) {
  try {
    const hash = String(window.location.hash || '').replace(/^#/, '');
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    const encoded = normalizeText(params.get(AUTH_HANDOFF_HASH_KEY));
    if (!encoded) return null;
    const payload = parseEnvelope(decodeBase64Url(encoded));
    if (consume) removeHashParam();
    return payload;
  } catch (_) {
    return null;
  }
}

function readFromStorage() {
  try {
    const raw = sessionStorage.getItem(AUTH_HANDOFF_STORAGE_KEY) || localStorage.getItem(AUTH_HANDOFF_STORAGE_KEY);
    if (!raw) return null;
    return parseEnvelope(raw);
  } catch (_) {
    return null;
  }
}

export function readAuthHandoff({ consume = true } = {}) {
  const fromHash = readFromHash({ consume });
  if (fromHash) return fromHash;
  return readFromStorage();
}
