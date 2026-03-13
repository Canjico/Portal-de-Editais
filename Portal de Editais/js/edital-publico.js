import {
  LOGIN_URL,
  buildLoginUrlWithNext,
  apiFetchJson,
} from "./auth.js";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,255}$/;

const contentEl = document.getElementById("publicShareContent");
const headerLoginLink = document.getElementById("headerLoginLink");
const headerPlatformLink = document.getElementById("headerPlatformLink");

document.addEventListener("DOMContentLoaded", initPublicSharePage);

async function initPublicSharePage() {
  const loginHref = buildLoginHref();
  applyLoginLinks(loginHref);
  syncCanonicalUrl();

  const shareToken = resolveShareToken();
  if (!shareToken) {
    renderInvalidState("Link de edital invalido ou indisponivel.");
    return;
  }

  renderLoadingState();

  try {
    const { res, data } = await apiFetchJson(`/editais/publico/${encodeURIComponent(shareToken)}`, {
      method: "GET",
    });

    if (!res.ok) {
      const detail = sanitizePlainText(data?.detail || data?.msg || "");
      if (res.status === 404) {
        renderInvalidState(detail || "Link de edital invalido ou indisponivel.");
      } else {
        renderErrorState(detail || "Nao foi possivel carregar este edital compartilhado.");
      }
      return;
    }

    const edital = normalizePublicPayload(data);
    if (!edital.titulo) {
      renderErrorState("Este edital nao possui dados publicos para exibicao.");
      return;
    }

    renderPublicEdital(edital, loginHref);
    syncMetadata(edital);
  } catch (err) {
    console.error("[edital-publico] falha ao carregar edital compartilhado", err);
    renderErrorState("Nao foi possivel carregar este edital compartilhado no momento.");
  }
}

function buildLoginHref() {
  try {
    return buildLoginUrlWithNext();
  } catch (_) {
    const next = encodeURIComponent(window.location.href);
    const sep = LOGIN_URL.includes("?") ? "&" : "?";
    return `${LOGIN_URL}${sep}next=${next}`;
  }
}

function applyLoginLinks(loginHref) {
  if (headerLoginLink) headerLoginLink.href = loginHref;
  if (headerPlatformLink) headerPlatformLink.href = loginHref;
}

function syncCanonicalUrl() {
  const canonicalUrl = window.location.href.split("#")[0];
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute("href", canonicalUrl);
  setMetaTag("property", "og:url", canonicalUrl);
}

function resolveShareToken() {
  const queryToken = new URLSearchParams(window.location.search).get("token");
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

function renderLoadingState() {
  if (!contentEl) return;
  contentEl.innerHTML = `
    <article class="share-state-card">
      <small>Acesso publico em andamento</small>
      <h1>Carregando edital compartilhado...</h1>
      <p>Estamos consultando os dados publicos deste link.</p>
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
    title: "Link de edital invalido ou indisponivel",
    message,
    toneClass: "text-warning",
  });
}

function renderErrorState(message) {
  renderStateCard({
    title: "Nao foi possivel exibir este edital",
    message,
    toneClass: "text-danger",
  });
}

function renderStateCard({ title, message, toneClass = "" }) {
  if (!contentEl) return;
  const loginHref = buildLoginHref();
  contentEl.innerHTML = `
    <article class="share-state-card">
      <small class="${escapeAttr(toneClass)}">Acesso publico restrito</small>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      <div class="state-actions">
        <a class="btn btn-outline" href="${escapeAttr(loginHref)}">Entrar na plataforma</a>
        <a class="btn btn-primary" href="/athos">Ir para pagina inicial</a>
      </div>
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

    out.push({
      nome: sanitizePlainText(item.nome) || `Documento ${idx + 1}`,
      tipo: sanitizePlainText(item.tipo),
      url,
    });
  });

  return out;
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

function renderPublicEdital(edital, loginHref) {
  if (!contentEl) return;

  const statusLabel = edital.status || (edital.fluxoContinuo ? "Fluxo continuo" : "Aberto");
  const statusClass = classifyStatus(statusLabel);
  const prazoLabel = formatPrazo(edital.prazo, edital.fluxoContinuo);
  const valorLabel = edital.valor || "Nao informado";
  const publicoAlvo = edital.publicoAlvo || "Nao informado";
  const descricao = edital.descricao || "Sem descricao publica cadastrada.";
  const categorias = edital.categorias.length ? edital.categorias : [edital.area || "Geral"];

  const arquivosHtml = edital.arquivos.length
    ? `
      <div class="docs-list">
        ${edital.arquivos.map((item) => `
          <a href="${escapeAttr(item.url)}" target="_blank" rel="noopener noreferrer">
            <span>${escapeHtml(item.nome)}</span>
            <small>${escapeHtml(item.tipo || "Abrir")}</small>
          </a>
        `).join("")}
      </div>
    `
    : `<p class="text-block">Nenhum documento publico foi anexado neste compartilhamento.</p>`;

  contentEl.innerHTML = `
    <article class="public-card">
      <header class="public-head">
        <div class="public-head-top">
          <span class="pill ${escapeAttr(statusClass)}">${escapeHtml(statusLabel)}</span>
          <button class="btn btn-ghost" type="button" id="copyPublicShareLinkBtn">Copiar este link</button>
        </div>
        <h1>${escapeHtml(edital.titulo || "Edital compartilhado")}</h1>
        <p class="public-sub">${escapeHtml(edital.instituicao || "Instituicao nao informada")}</p>
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
            <small>Publico elegivel</small>
            <strong>${escapeHtml(publicoAlvo)}</strong>
          </article>
          <article class="metric">
            <small>Fonte</small>
            <strong>${escapeHtml(edital.fonte || "Nao informada")}</strong>
          </article>
          <article class="metric">
            <small>Estado</small>
            <strong>${escapeHtml(edital.estado || "Nao informado")}</strong>
          </article>
          <article class="metric">
            <small>Instrumento</small>
            <strong>${escapeHtml(edital.instrumento || "Nao informado")}</strong>
          </article>
        </div>

        <h2 class="section-title">Descricao</h2>
        <p class="text-block">${escapeHtml(descricao)}</p>

        <h2 class="section-title">Categorias</h2>
        <div class="chips">
          ${categorias.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
        </div>

        <h2 class="section-title">Arquivos</h2>
        ${arquivosHtml}

        <div class="state-actions">
          <a class="btn btn-outline" href="${escapeAttr(loginHref)}">Entrar para ver outros editais</a>
          <a class="btn btn-primary" href="/athos">Conhecer o Athos</a>
        </div>
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

function classifyStatus(status) {
  const token = sanitizePlainText(status).toLowerCase();
  if (token.includes("encerr")) return "status-encerrado";
  if (token.includes("fluxo")) return "status-fluxo";
  return "status-aberto";
}

function formatPrazo(value, fluxoContinuo) {
  if (fluxoContinuo) return "Fluxo continuo";
  const raw = sanitizePlainText(value);
  if (!raw) return "Nao informado";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-").map(Number);
    const parsed = new Date(year, month - 1, day);
    if (Number.isFinite(parsed.getTime())) {
      return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(parsed);
    }
  }

  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(parsed));
  }

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
  const instituicao = edital.instituicao || "Instituicao nao informada";
  const resumo = sanitizePlainText(edital.descricao || "");
  const shortResumo = resumo.length > 170 ? `${resumo.slice(0, 167).trimEnd()}...` : resumo;
  if (shortResumo) return `${instituicao}. ${shortResumo}`;
  return `${instituicao}. Visualizacao publica de edital compartilhado no Athos.`;
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
