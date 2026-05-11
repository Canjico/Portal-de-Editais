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

function resolveOptimizedLogoSrc(value) {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  if (!raw || /^(?:data:|blob:)/i.test(raw)) return '';

  let candidate = raw;
  try {
    if (/^https?:\/\//i.test(raw) || raw.startsWith('//')) {
      const absolute = raw.startsWith('//') ? `${window.location.protocol}${raw}` : raw;
      const parsed = new URL(absolute);
      candidate = decodeURIComponent(parsed.pathname.split('/').pop() || '');
    }
  } catch (_) {}

  const fileName = OPTIMIZED_ICON_BY_KEY[normalizeIconLookupKey(candidate)];
  return fileName ? new URL(`icons-optimized/${fileName}`, document.baseURI).href : '';
}

export function renderEditais(container, editais, options = {}) {
  container.innerHTML = '';

  if (!editais || editais.length === 0) {
    renderEmptyState(container, options.emptyState);
    return;
  }

  editais.forEach((edital) => {
    const card = document.createElement('article');
    card.className = 'edital-card';

    const areaLower = (edital.area || '').trim().toLowerCase();
    const estadoLower = (edital.estado || '').trim().toLowerCase();

    const tagsExtras = (edital.tags || [])
      .filter((tag) => {
        if (!tag) return false;
        const t = String(tag).trim().toLowerCase();
        return t && t !== areaLower && t !== estadoLower && !isNotInformedTag(t);
      })
      .slice(0, 3);

    const tagsHtml = [
      !isNotInformedTag(edital.area) ? `<span class="pill">${escapeHtml(edital.area)}</span>` : '',
      !isNotInformedTag(edital.estado) ? `<span class="pill gray">${escapeHtml(edital.estado)}</span>` : '',
      ...tagsExtras.map((t) => `<span class="pill gray">${escapeHtml(t)}</span>`),
    ].filter(Boolean).join('');

    const shareLink = String(edital.share_link || '').trim();

    const instituicao = edital.instituicao || 'Instituição';
    const logoSrc = resolveLogoSrc(edital.icone || edital.instituicao, edital.instituicao);
    const dataFinal = formatDeadlineLabel(edital);
    const statusBadges = buildStatusBadges(edital);
    const statusHtml = statusBadges
      .map((badge) => {
        const styleAttr = badge.style ? ` style="${escapeAttr(badge.style)}"` : '';
        return `<span class="${escapeAttr(badge.className)}"${styleAttr}>${escapeHtml(badge.label)}</span>`;
      })
      .join('');

    const valorFomento = formatFundingValue(edital.valor_total) || 'Não informado';
    const publicoAlvo = formatPublicoAlvo(edital.publico_alvo) || 'Não informado';

    card.innerHTML = `
      <div class="card-top">
        <div class="card-brand">
          <div class="card-logo">
            ${logoSrc
              ? `<img src="${escapeAttr(logoSrc)}" alt="${escapeHtml(instituicao)}" loading="lazy" decoding="async">`
              : `<span class="card-logo-fallback">${escapeHtml(shortCode(instituicao))}</span>`}
          </div>
          <div class="card-brand-copy">
            <div class="card-org" title="${escapeHtml(instituicao)}">${escapeHtml(instituicao)}</div>
            <div class="card-status-list" aria-label="Status do edital">${statusHtml}</div>
          </div>
        </div>

        <div class="card-actions" aria-label="Ações do edital">
          <button class="card-icon-btn share-btn" type="button" title="Copiar link" data-tooltip="Copiar link" aria-label="Copiar link" data-share="${escapeAttr(shareLink)}">
            <i class="fas fa-link"></i>
          </button>

          <button class="card-icon-btn save-btn ${edital.is_favorite ? 'is-saved' : ''}" type="button" title="${edital.is_favorite ? 'Remover dos salvos' : 'Salvar edital'}" data-tooltip="${edital.is_favorite ? 'Remover dos salvos' : 'Salvar edital'}" aria-label="Salvar edital" data-id="${escapeAttr(edital.id)}">
            <i class="${edital.is_favorite ? 'fas' : 'far'} fa-star"></i>
          </button>
        </div>
      </div>

      <h3 class="card-title">${escapeHtml(edital.titulo || 'Sem título')}</h3>
      <p class="card-desc">${escapeHtml(edital.descricao || 'Sem descrição')}</p>

      <div class="card-kpis" aria-label="Informações principais">
        <div class="card-kpi">
          <span>Prazo final</span>
          <strong>${escapeHtml(dataFinal)}</strong>
        </div>
        <div class="card-kpi">
          <span>Valor do fomento</span>
          <strong>${escapeHtml(valorFomento)}</strong>
        </div>
        <div class="card-kpi card-kpi--full">
          <span>Quem pode participar</span>
          <strong>${escapeHtml(publicoAlvo)}</strong>
        </div>
      </div>

      <div class="card-tags">${tagsHtml}</div>

      <div class="card-footer-actions">
        <button class="interest-btn ${edital.has_interest ? 'is-interested' : ''}" type="button" data-id="${escapeAttr(edital.id)}" title="${edital.has_interest ? 'Interesse enviado' : 'Tenho interesse'}" data-tooltip="${edital.has_interest ? 'Interesse enviado' : 'Tenho interesse'}" aria-label="Tenho interesse neste edital">
          <i class="${edital.has_interest ? 'fas' : 'far'} fa-handshake" aria-hidden="true"></i>
          <span>${edital.has_interest ? 'Interesse enviado' : 'Tenho interesse'}</span>
        </button>
        <button class="open-edital-btn" type="button" data-id="${escapeAttr(edital.id)}">
          Ver detalhes
          <i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i>
        </button>
      </div>
    `;

    container.appendChild(card);
  });

  container.querySelectorAll('.share-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const link = btn.getAttribute('data-share');
      if (!link) {
        notify('Link público indisponível para este edital.', 'error');
        return;
      }
      navigator.clipboard.writeText(link)
        .then(() => notify('Link copiado para compartilhamento.', 'success'))
        .catch(() => notify('Não foi possível copiar o link.', 'error'));
    });
  });
}

function renderEmptyState(container, state) {
  const fallback = {
    icon: 'fa-folder-open',
    title: 'Nenhum edital encontrado',
    message: 'Tente ajustar os filtros ou buscar por outro termo.',
  };

  const payload = {
    ...fallback,
    ...(state && typeof state === 'object' ? state : {}),
  };

  container.innerHTML = `
    <section class="results-empty-state" role="status" aria-live="polite">
      <div class="empty-icon"><i class="fas ${escapeAttr(payload.icon)}" aria-hidden="true"></i></div>
      <h3>${escapeHtml(payload.title)}</h3>
      <p>${escapeHtml(payload.message)}</p>
      ${payload.actionLabel ? `<button type="button" class="btn btn-primary" id="emptyStateActionBtn">${escapeHtml(payload.actionLabel)}</button>` : ''}
    </section>
  `;

  if (typeof payload.action === 'function') {
    const btn = container.querySelector('#emptyStateActionBtn');
    if (btn) btn.addEventListener('click', payload.action);
  }
}

function notify(message, type = 'info') {
  const text = String(message || '').trim();
  if (!text) return;
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = text;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  window.setTimeout(() => {
    toast.classList.remove('show');
    window.setTimeout(() => toast.remove(), 240);
  }, 2000);
}

function isNotInformedTag(value) {
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

function formatDisplayDate(dateString) {
  const t = parseAnyDateToTime(dateString);
  if (t === null) return String(dateString || 'Não informado');
  try {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(t));
  } catch {
    return String(dateString || 'Não informado');
  }
}

function formatDeadlineLabel(edital) {
  const raw = edital?.data_fechamento ?? edital?.data_final_submissao ?? '';
  const t = parseAnyDateToTime(raw);
  if (t !== null) return formatDisplayDate(raw);
  if (edital?.fluxo_continuo === true) return 'Fluxo contínuo';

  const text = String(raw || '').trim();
  if (!text) return 'Não informado';
  if (/^\d{6,}$/.test(text)) return 'Não informado';
  return text;
}

function shortCode(text) {
  const s = String(text || '').trim();
  if (!s) return 'ED';
  const parts = s.split(/\s+/).slice(0, 2);
  const letters = parts.map((p) => p[0]).join('');
  return letters.toUpperCase();
}

function resolveLogoSrc(value, institutionFallback = '') {
  if (value === null || value === undefined) return '';

  const raw = String(value).trim().replace(/\\/g, '/');
  if (!raw) return '';

  const optimized = resolveOptimizedLogoSrc(raw) || resolveOptimizedLogoSrc(institutionFallback);
  if (optimized) return optimized;

  if (/^(?:https?:|data:|blob:)/i.test(raw)) return raw;
  if (raw.startsWith('//')) return `${window.location.protocol}${raw}`;

  const normalized = raw
    .replace(/^\.?\//, '')
    .replace(/^\/+/,'');

  const isProjectIconPath =
    normalized.toLowerCase().startsWith('icons-optimized/') ||
    normalized.toLowerCase().startsWith('icons/') ||
    normalized.toLowerCase().startsWith('assets/img/icons/');
  const isBareImageFilename = /^[^/]+\.(?:png|jpe?g|gif|webp|svg|avif)$/i.test(normalized);

  if (isProjectIconPath) {
    const iconFile = normalized.split('/').pop() || '';
    const optimizedUrl = resolveOptimizedLogoSrc(iconFile);
    if (optimizedUrl) return optimizedUrl;
    return new URL(`icons-optimized/${iconFile.replace(/\.(?:png|jpe?g|gif|svg|avif)$/i, '.webp')}`, document.baseURI).href;
  }
  if (isBareImageFilename) return new URL(`icons-optimized/${normalized.replace(/\.(?:png|jpe?g|gif|svg|avif)$/i, '.webp')}`, document.baseURI).href;

  return raw;
}

export function buildStatusBadges(edital) {
  const dataFechamento = edital?.data_fechamento ?? edital;
  const highlighted = Boolean(edital?.is_highlighted);
  const explicitOpen = typeof edital?.is_open === 'boolean' ? edital.is_open : null;
  const fluxoContinuo = edital?.fluxo_continuo === true;
  const COUNTDOWN_WINDOW_DAYS = 30;
  const t = parseAnyDateToTime(dataFechamento);
  const badges = [];

  if (highlighted) {
    badges.push({ label: getRecommendationBadgeLabel(edital), className: 'status-chip status-chip--highlight' });
  } else if (edital?.relevance_level === 'high') {
    badges.push({ label: 'Alta aderência', className: 'status-chip status-chip--recommendation' });
  } else if (edital?.relevance_level === 'medium') {
    badges.push({ label: 'Pode interessar', className: 'status-chip status-chip--recommendation-muted' });
  }

  if (t === null) {
    if (explicitOpen === false) {
      return [{ label: 'Encerrado', className: 'status-chip status-chip--closed' }];
    }
    if (fluxoContinuo) {
      badges.push({ label: 'Fluxo contínuo', className: 'status-chip status-chip--open' });
      return badges;
    }
    badges.push({ label: 'Aberto', className: 'status-chip status-chip--open' });
    return badges;
  }

  const target = toStartOfDayTime(t);
  const today = toStartOfDayTime(Date.now());
  const diffDays = Math.floor((target - today) / 86400000);

  if (diffDays < 0) {
    return [{ label: 'Encerrado', className: 'status-chip status-chip--closed' }];
  }

  badges.push({ label: 'Aberto', className: 'status-chip status-chip--open' });
  if (diffDays > COUNTDOWN_WINDOW_DAYS) return badges;

  const urgencyTone = buildUrgencyTone(diffDays, COUNTDOWN_WINDOW_DAYS);
  const urgencyStyle = [
    `--status-chip-bg:${urgencyTone.bg}`,
    `--status-chip-border:${urgencyTone.border}`,
    `--status-chip-text:${urgencyTone.text}`,
  ].join(';');

  if (diffDays === 0) {
    badges.push({
      label: 'Fecha hoje',
      className: 'status-chip status-chip--deadline',
      style: urgencyStyle,
    });
    return badges;
  }

  if (diffDays === 1) {
    badges.push({
      label: 'Fecha amanhã',
      className: 'status-chip status-chip--deadline',
      style: urgencyStyle,
    });
    return badges;
  }

  badges.push({
    label: `Fecha em ${diffDays} dias`,
    className: 'status-chip status-chip--deadline',
    style: urgencyStyle,
  });

  return badges;
}

function getRecommendationBadgeLabel(edital) {
  const explicit = String(edital?.recommendation_label || '').trim();
  if (explicit) return explicit;
  if (edital?.relevance_level === 'perfect') return '100% aderente ao seu perfil';
  return 'Recomendado para você';
}

function buildUrgencyTone(daysLeft, maxWindow = 30) {
  const clamped = Math.max(0, Math.min(maxWindow, Number(daysLeft) || 0));
  const ratio = clamped / maxWindow;

  const redA = 220;
  const greenA = 38;
  const blueA = 38;
  const redB = 22;
  const greenB = 163;
  const blueB = 74;

  const r = Math.round(redA + (redB - redA) * ratio);
  const g = Math.round(greenA + (greenB - greenA) * ratio);
  const b = Math.round(blueA + (blueB - blueA) * ratio);

  let text = '#166534';
  if (clamped <= 7) text = '#991B1B';
  else if (clamped <= 15) text = '#92400E';

  return {
    bg: `rgba(${r},${g},${b},0.14)`,
    border: `rgba(${r},${g},${b},0.35)`,
    text,
  };
}

function toStartOfDayTime(timeMs) {
  const d = new Date(timeMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function parseAnyDateToTime(dateString) {
  if (dateString === null || dateString === undefined || dateString === '') return null;
  const s = String(dateString).trim();
  if (!s) return null;

  const epoch = parseEpochDateToTime(s);
  if (epoch !== null) return epoch;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/').map(Number);
    return new Date(y, m - 1, d).getTime();
  }

  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const [d, m, y] = s.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }

  if (/^\d{1,2}[\/-]\d{4}$/.test(s)) {
    const [m, y] = s.split(/[\/-]/).map(Number);
    if (m >= 1 && m <= 12) return new Date(y, m - 1, 1).getTime();
  }

  if (/^\d{4}$/.test(s)) {
    return new Date(Number(s), 0, 1).getTime();
  }

  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function parseEpochDateToTime(value) {
  const s = String(value || '').trim();
  if (!/^\d{10,13}(?:\.0+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const ms = s.replace(/\.0+$/, '').length <= 10 ? n * 1000 : n;
  const min = Date.UTC(2000, 0, 1);
  const max = Date.UTC(2100, 11, 31, 23, 59, 59);
  if (ms < min || ms > max) return null;
  return ms;
}

function formatFundingValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  const raw = String(value).trim();
  if (!raw) return '';

  const maybeNumber = Number(
    raw
      .replace(/[^\d,.-]/g, '')
      .replace(/\.(?=\d{3}(\D|$))/g, '')
      .replace(',', '.')
  );

  if (Number.isFinite(maybeNumber) && maybeNumber === 0) return '';
  if (/^r\$/i.test(raw)) return raw;
  if (!Number.isFinite(maybeNumber)) return raw;

  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 0,
    }).format(maybeNumber);
  } catch {
    return raw;
  }
}

function formatPublicoAlvo(value) {
  if (Array.isArray(value)) {
    const joined = value.map((v) => String(v || '').trim()).filter(Boolean).join(', ');
    return truncateText(joined, 120);
  }

  if (value && typeof value === 'object') return '';

  const s = String(value || '').trim();
  if (!s) return '';
  return truncateText(s, 120);
}

function truncateText(value, max) {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  if (!s || s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + '...';
}

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
