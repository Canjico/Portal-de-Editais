import { apiFetchJson } from "./auth.js";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,255}$/;
const ATHOS_BASE_PATH = detectAthosBasePath();
const LANDING_PAGE_URL = toAbsoluteUrl(ATHOS_BASE_PATH);
const DASHBOARD_CANONICAL_URL = toAbsoluteUrl(`${ATHOS_BASE_PATH}/editais/`);

const contentEl = document.getElementById("publicShareContent");
const headerBrandLink = document.getElementById("headerBrandLink");
const headerPlatformLink = document.getElementById("headerPlatformLink");

document.addEventListener("DOMContentLoaded", initPublicSharePage);

async function initPublicSharePage() {
  applyHeaderLinks();
  syncCanonicalUrl();

  const shareToken = resolveShareToken();
  if (!shareToken) {
    renderInvalidState("Link de edital inválido ou indisponível.");
    return;
  }

  renderLoadingState("Validando acesso ao link compartilhado...");

  const session = await resolveSessionStatus();
  if (session.authenticated && window.AthosTheme?.setPreference && session.profile?.themePreference) {
    const nextTheme = window.AthosTheme.resolveProfilePreference
      ? window.AthosTheme.resolveProfilePreference(session.profile.themePreference)
      : session.profile.themePreference;
    window.AthosTheme.setPreference(nextTheme);
  }
  if (session.authenticated) {
    const redirected = redirectToAuthenticatedExperience(shareToken, session.profile);
    if (redirected) return;
  }

  renderLoadingState("Carregando dados públicos do edital...");

  try {
    const { res, data } = await apiFetchJson(`/editais/publico/${encodeURIComponent(shareToken)}`, {
      method: "GET",
    });

    if (!res.ok) {
      const detail = sanitizePlainText(data?.detail || data?.msg || "");
      if (res.status === 404) {
        renderInvalidState(detail || "Link de edital inválido ou indisponível.");
      } else {
        renderErrorState(detail || "Não foi possível carregar este edital compartilhado.");
      }
      return;
    }

    const edital = normalizePublicPayload(data);
    if (!edital.titulo) {
      renderErrorState("Este edital não possui dados públicos para exibição.");
      return;
    }

    renderPublicEdital(edital);
    syncMetadata(edital);
  } catch (err) {
    console.error("[edital-publico] falha ao carregar edital compartilhado", err);
    renderErrorState("Não foi possível carregar este edital compartilhado no momento.");
  }
}

function applyHeaderLinks() {
  if (headerBrandLink) headerBrandLink.href = LANDING_PAGE_URL;
  if (headerPlatformLink) headerPlatformLink.href = LANDING_PAGE_URL;
}

function detectAthosBasePath() {
  let pathname = String(window.location.pathname || "");
  try {
    pathname = decodeURIComponent(pathname);
  } catch (_) {}

  const match = pathname.match(/^(.*?\/athos)(?:\/|$)/i);
  if (match && match[1]) return trimTrailingSlashes(match[1]);
  return "/athos";
}

function toAbsoluteUrl(path) {
  const normalized = ensureLeadingSlash(path || "/");
  try {
    return new URL(normalized, window.location.origin).toString();
  } catch (_) {
    return normalized;
  }
}

function ensureLeadingSlash(value) {
  const text = String(value || "").trim();
  if (!text) return "/";
  return text.startsWith("/") ? text : `/${text}`;
}

function trimTrailingSlashes(value) {
  const normalized = ensureLeadingSlash(value);
  if (normalized.length <= 1) return normalized;
  return normalized.replace(/\/+$/, "");
}

async function resolveSessionStatus() {
  try {
    const { res, data } = await apiFetchJson("/cliente/me", { method: "GET" });
    if (!res.ok) return { authenticated: false, profile: null };
    if (data && typeof data === "object" && "logado" in data && !data.logado) {
      return { authenticated: false, profile: null };
    }
    return { authenticated: true, profile: (data && typeof data === "object" ? data : {}) };
  } catch (_) {
    return { authenticated: false, profile: null };
  }
}

function redirectToAuthenticatedExperience(shareToken, profile) {
  try {
    const baseUrl = resolveDashboardUrl(profile?.redirect);
    const target = new URL(baseUrl, window.location.origin);
    target.searchParams.set("share_token", shareToken);
    window.location.replace(target.toString());
    return true;
  } catch (err) {
    console.warn("[edital-publico] falha ao redirecionar para experiência autenticada", err);
    return false;
  }
}

function resolveDashboardUrl(raw) {
  const value = sanitizePlainText(raw || "");
  if (!value) return DASHBOARD_CANONICAL_URL;

  try {
    const parsed = new URL(value, window.location.origin);
    const host = String(parsed.hostname || "").toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") {
      return parsed.toString();
    }
  } catch (_) {}

  return DASHBOARD_CANONICAL_URL;
}

function syncCanonicalUrl() {
  const canonicalUrl = window.location.href.split("#")[0];
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute("href", canonicalUrl);
  setMetaTag("property", "og:url", canonicalUrl);
}

function resolveShareToken() {
  const params = new URLSearchParams(window.location.search);
  const queryToken = params.get("token") || params.get("share_token");
  if (isValidToken(queryToken)) return queryToken.trim();

  let pathname = window.location.pathname || "";
  try {
    pathname = decodeURIComponent(pathname);
  } catch (_) {}
  pathname = pathname.replace(/\/+$/, "");

  const patterns = [
    /\/share\/edital\/([A-Za-z0-9_-]{20,255})$/i,
    /\/edital\/publico\/([A-Za-z0-9_-]{20,255})$/i,
    /\/edital-publico(?:\.html)?\/([A-Za-z0-9_-]{20,255})$/i,
  ];

  for (const pattern of patterns) {
    const match = pathname.match(pattern);
    if (match && isValidToken(match[1])) return match[1];
  }

  return "";
}

function isValidToken(value) {
  return TOKEN_PATTERN.test(String(value || "").trim());
}

function renderLoadingState(message = "Carregando dados públicos do edital...") {
  if (!contentEl) return;
  contentEl.innerHTML = `
    <article class="share-state-card">
      <small>Acesso público em verificação</small>
      <h1>${escapeHtml(message)}</h1>
      <p>Estamos consultando os dados públicos disponíveis neste link compartilhado.</p>
      <div class="loading-bars" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </article>
  `;
}

function renderInvalidState(message) {
  renderStateCard({
    title: "Link de edital inválido ou indisponível",
    message,
    toneClass: "text-warning",
  });
}

function renderErrorState(message) {
  renderStateCard({
    title: "Não foi possível exibir este edital",
    message,
    toneClass: "text-danger",
  });
}

function renderStateCard({ title, message, toneClass = "" }) {
  if (!contentEl) return;
  contentEl.innerHTML = `
    <article class="share-state-card">
      <small class="${escapeAttr(toneClass)}">Acesso público limitado</small>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
    </article>
  `;
}

function normalizePublicPayload(raw) {
  const payload = raw && typeof raw === "object" ? raw : {};

  return {
    titulo: sanitizePlainText(payload.titulo || ""),
    instituicao: sanitizePlainText(payload.instituicao || ""),
    status: sanitizePlainText(payload.status || ""),
    prazo: sanitizePlainText(payload.prazo || ""),
    fluxoContinuo: Boolean(payload.fluxo_continuo),
    valor: sanitizePlainText(payload.valor || ""),
    descricao: sanitizePlainText(payload.descricao || ""),
    publicoAlvo: normalizePublico(payload.publico_alvo),
    categorias: normalizeStringList(payload.categorias),
    area: sanitizePlainText(payload.area || ""),
    estado: sanitizePlainText(payload.estado || ""),
    instrumento: sanitizePlainText(payload.instrumento || ""),
    fonte: sanitizePlainText(payload.fonte || ""),
    arquivos: normalizeArquivos(payload.arquivos),
    shareLink: sanitizePlainText(payload.share_link || "") || window.location.href,
  };
}

function normalizePublico(value) {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => sanitizePlainText(item))
      .filter(Boolean);
    return items.join(", ");
  }

  return sanitizePlainText(value);
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  const dedupe = new Set();
  const out = [];

  for (const item of value) {
    const clean = sanitizePlainText(item);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    out.push(clean);
  }

  return out;
}

function normalizeArquivos(value) {
  if (!Array.isArray(value)) return [];
  const out = [];

  value.forEach((item, idx) => {
    if (!item || typeof item !== "object") return;

    const url = sanitizeHttpUrl(item.url);
    if (!url) return;

    const nome = sanitizePlainText(item.nome) || `Documento ${idx + 1}`;
    const tipo = sanitizePlainText(item.tipo);

    out.push({
      nome,
      tipo,
      url,
      extensao: extractFileExtension(nome, url),
    });
  });

  return out;
}

function extractFileExtension(name = "", url = "") {
  const source = `${name} ${url}`.toLowerCase();
  const match = source.match(/\.([a-z0-9]{2,5})(?:$|[?#\s])/i);
  return match ? match[1].toLowerCase() : "";
}

function sanitizeHttpUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
    return "";
  } catch (_) {
    return "";
  }
}

function renderPublicEdital(edital) {
  if (!contentEl) return;

  const prazoState = resolvePrazoState(edital);
  const statusLabel = prazoState.statusLabel;
  const statusClass = classifyStatus(statusLabel);
  const prazoLabel = formatPrazo(edital.prazo, edital.fluxoContinuo, prazoState);
  const valorLabel = edital.valor || "Não informado";
  const publicoAlvo = edital.publicoAlvo || "Não informado";
  const descricao = edital.descricao || "Sem descrição pública cadastrada.";
  const categorias = edital.categorias.length ? edital.categorias : [edital.area || "Geral"];
  const documentosRestritosHtml = renderRestrictedDocumentsCallout();

  contentEl.innerHTML = `
    <article class="public-card">
      <header class="public-head">
        <div class="public-head-top">
          <span class="pill ${escapeAttr(statusClass)}">${escapeHtml(statusLabel)}</span>
          <button class="btn btn-ghost" type="button" id="copyPublicShareLinkBtn">Copiar este link</button>
        </div>
        <h1>${escapeHtml(edital.titulo || "Edital compartilhado")}</h1>
        <p class="public-sub">${escapeHtml(edital.instituicao || "Instituição não informada")}</p>
      </header>

      <div class="public-body">
        <div class="public-grid">
          <article class="metric">
            <small>Prazo</small>
            <strong>${escapeHtml(prazoLabel)}</strong>
          </article>
          <article class="metric">
            <small>Valor</small>
            <strong>${escapeHtml(valorLabel)}</strong>
          </article>
          <article class="metric">
            <small>Público elegível</small>
            <strong>${escapeHtml(publicoAlvo)}</strong>
          </article>
          <article class="metric">
            <small>Fonte</small>
            <strong>${escapeHtml(edital.fonte || "Não informada")}</strong>
          </article>
          <article class="metric">
            <small>Estado</small>
            <strong>${escapeHtml(edital.estado || "Não informado")}</strong>
          </article>
          <article class="metric">
            <small>Instrumento</small>
            <strong>${escapeHtml(edital.instrumento || "Não informado")}</strong>
          </article>
        </div>

        <h2 class="section-title">Descrição</h2>
        <p class="text-block">${escapeHtml(descricao)}</p>

        <h2 class="section-title">Categorias</h2>
        <div class="chips">
          ${categorias.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
        </div>

        <h2 class="section-title">Documentos</h2>
        ${documentosRestritosHtml}
      </div>
    </article>
  `;

  const copyBtn = document.getElementById("copyPublicShareLinkBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(edital.shareLink || window.location.href);
        copyBtn.textContent = "Link copiado";
        window.setTimeout(() => {
          copyBtn.textContent = "Copiar este link";
        }, 1700);
      } catch (_) {
        copyBtn.textContent = "Falha ao copiar";
        window.setTimeout(() => {
          copyBtn.textContent = "Copiar este link";
        }, 1700);
      }
    });
  }
}

function renderRestrictedDocumentsCallout() {
  return `
    <section class="docs-lock-callout" role="note" aria-label="Documentos restritos">
      <span class="docs-lock-badge">Acesso restrito</span>
      <h3>Documentos e análise com IA disponíveis apenas para usuários autenticados</h3>
      <p>Entre na plataforma para acessar os anexos completos deste edital e usar os recursos de IA. Use o botão "Acessar plataforma" no topo desta página.</p>
    </section>
  `;
}

function normalizeStatusToken(value) {
  return sanitizePlainText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasContinuousSignal(value) {
  const token = normalizeStatusToken(value);
  return Boolean(token && ((token.includes("fluxo") && token.includes("continu")) || token.includes("chamada continua")));
}

function hasClosedSignal(value) {
  const token = normalizeStatusToken(value);
  return Boolean(token && /(encerr|fechad|vencid|expirad)/.test(token));
}

function parsePrazoDate(value) {
  const raw = sanitizePlainText(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-").map(Number);
    const parsed = new Date(year, month - 1, day);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function resolvePrazoState(edital) {
  const deadline = parsePrazoDate(edital.prazo);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const explicitClosed = hasClosedSignal(edital.status);

  if (deadline) {
    const deadlineDay = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
    const closed = explicitClosed || deadlineDay.getTime() < today.getTime();
    return { deadline, closed, continuous: false, statusLabel: closed ? "Encerrado" : "Aberto" };
  }

  if (explicitClosed) return { deadline: null, closed: true, continuous: false, statusLabel: "Encerrado" };
  if (edital.fluxoContinuo || hasContinuousSignal(edital.status) || hasContinuousSignal(edital.prazo)) {
    return { deadline: null, closed: false, continuous: true, statusLabel: "Fluxo contínuo" };
  }
  return { deadline: null, closed: false, continuous: false, statusLabel: edital.status || "Aberto" };
}

function classifyStatus(status) {
  const token = normalizeStatusToken(status);
  if (token.includes("encerr")) return "status-encerrado";
  if (token.includes("fluxo")) return "status-fluxo";
  return "status-aberto";
}

function formatPrazo(value, fluxoContinuo, prazoState = null) {
  const state = prazoState || resolvePrazoState({ prazo: value, fluxoContinuo });
  if (state.deadline) {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(state.deadline);
  }
  if (state.continuous) return "Fluxo contínuo";
  const raw = sanitizePlainText(value);
  if (!raw || hasClosedSignal(raw) || hasContinuousSignal(raw)) return "Não informado";
  return raw;
}

function syncMetadata(edital) {
  const title = `${edital.titulo || "Edital compartilhado"} | ${edital.instituicao || "Athos"}`;
  const description = buildShareDescription(edital);

  document.title = title;
  setMetaTag("name", "description", description);
  setMetaTag("property", "og:title", title);
  setMetaTag("property", "og:description", description);
}

function buildShareDescription(edital) {
  const instituicao = edital.instituicao || "Instituição não informada";
  const resumo = sanitizePlainText(edital.descricao || "");
  const shortResumo = resumo.length > 170 ? `${resumo.slice(0, 167).trimEnd()}...` : resumo;
  if (shortResumo) return `${instituicao}. ${shortResumo}`;
  return `${instituicao}. Visualização pública de edital compartilhado no Athos.`;
}

function setMetaTag(attribute, key, content) {
  const safeContent = sanitizePlainText(content);
  if (!safeContent) return;
  const selector = `meta[${attribute}="${cssEscape(key)}"]`;
  let element = document.querySelector(selector);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute("content", safeContent);
}

function sanitizePlainText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "");
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
