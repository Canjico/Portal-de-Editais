export function renderEditais(container, editais) {
  container.innerHTML = '';

  if (!editais || editais.length === 0) {
    container.innerHTML = '<p class="no-results">Nenhum edital encontrado com os filtros aplicados.</p>';
    return;
  }

  editais.forEach((edital) => {
    const card = document.createElement('article');
    card.className = 'edital-card';

    // Tags (mantém padrão: área + estado + extras)
    const areaLower = (edital.area || '').trim().toLowerCase();
    const estadoLower = (edital.estado || '').trim().toLowerCase();

    const tagsExtras = (edital.tags || [])
      .filter(tag => {
        if (!tag) return false;
        const t = String(tag).trim().toLowerCase();
        return t && t !== areaLower && t !== estadoLower;
      })
      .slice(0, 2);

    const tagsHtml = [
      edital.area ? `<span class="pill">${escapeHtml(edital.area)}</span>` : '',
      edital.estado ? `<span class="pill gray">${escapeHtml(edital.estado)}</span>` : '',
      ...tagsExtras.map(t => `<span class="pill gray">${escapeHtml(t)}</span>`)
    ].filter(Boolean).join('');

    // Link amigável para compartilhar
    const baseUrl = window.location.origin + window.location.pathname.split('?')[0];
    const linkParam = edital.slug ? `edital=${encodeURIComponent(edital.slug)}` : `id=${encodeURIComponent(edital.id)}`;
    const localShareLink = `${baseUrl}?${linkParam}`;

    const instituicao = edital.instituicao || 'Instituição';
    const dataFinal = edital.data_fechamento || 'Não informada';
    const statusBadges = buildStatusBadges(edital.data_fechamento);
    const statusHtml = statusBadges
      .map((badge) => {
        const styleAttr = badge.style ? ` style="${escapeAttr(badge.style)}"` : '';
        return `<span class="${escapeAttr(badge.className)}"${styleAttr}>${escapeHtml(badge.label)}</span>`;
      })
      .join('');

    const valorFomento = formatFundingValue(edital.valor_total);
    const publicoAlvo = formatPublicoAlvo(edital.publico_alvo);
    const contextItems = [];

    if (valorFomento) {
      contextItems.push(`
        <div class="card-context-item">
          <i class="fas fa-money-bill-wave" aria-hidden="true"></i>
          <span><strong>Fomento:</strong> ${escapeHtml(valorFomento)}</span>
        </div>
      `);
    }

    if (publicoAlvo) {
      contextItems.push(`
        <div class="card-context-item">
          <i class="fas fa-users" aria-hidden="true"></i>
          <span><strong>Quem pode participar:</strong> ${escapeHtml(publicoAlvo)}</span>
        </div>
      `);
    }

    const contextHtml = contextItems.length
      ? `<div class="card-context">${contextItems.join('')}</div>`
      : '';

    card.innerHTML = `
      <div class="card-top">
        <div class="card-brand">
          <div class="card-logo">
            ${edital.icone ? `<img src="${edital.icone}" alt="${escapeHtml(instituicao)}">` : `<span style="font-weight:1000; color:#9CA3AF; font-size:12px;">${escapeHtml(shortCode(instituicao))}</span>`}
          </div>
          <div style="min-width:0;">
            <div class="card-org" title="${escapeHtml(instituicao)}">${escapeHtml(instituicao)}</div>
          </div>
        </div>

        <div class="card-top-right">
          <div class="card-status-list" aria-label="Status do edital">
            ${statusHtml}
          </div>

          <div class="card-actions">
            <button class="card-icon-btn share-btn" type="button" title="Copiar link" aria-label="Copiar link" data-share="${escapeAttr(localShareLink)}">
              <i class="fas fa-link"></i>
            </button>

            <button class="card-icon-btn save-btn ${edital.is_favorite ? 'is-saved' : ''}" type="button" title="${edital.is_favorite ? 'Remover dos salvos' : 'Salvar edital'}" aria-label="Salvar edital" data-id="${escapeAttr(edital.id)}">
              <i class="${edital.is_favorite ? 'fas' : 'far'} fa-star"></i>
            </button>
          </div>
        </div>
      </div>

      <h3 class="card-title">${escapeHtml(edital.titulo || 'Sem título')}</h3>
      <p class="card-desc">${escapeHtml(edital.descricao || 'Sem descrição')}</p>
      ${contextHtml}

      <div class="card-tags">${tagsHtml}</div>

      <div class="card-deadline">
        <i class="far fa-calendar"></i>
        <span><strong>Data final</strong> ${escapeHtml(dataFinal)}</span>
      </div>

      <button class="open-edital-btn" type="button" data-id="${escapeAttr(edital.id)}">saiba mais...</button>
    `;

    container.appendChild(card);
  });

  // share: só precisa um listener por render
  container.querySelectorAll('.share-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const link = btn.getAttribute('data-share');
      if (!link) return;
      navigator.clipboard.writeText(link)
        .then(() => alert('Link copiado!'))
        .catch(() => alert('Não foi possível copiar o link.'));
    });
  });
}

function shortCode(text) {
  const s = String(text || '').trim();
  if (!s) return 'ED';
  const parts = s.split(/\s+/).slice(0, 2);
  const letters = parts.map(p => p[0]).join('');
  return letters.toUpperCase();
}

function buildStatusBadges(dataFechamento) {
  const t = parseAnyDateToTime(dataFechamento);

  if (t === null) {
    return [{ label: 'Aberto', className: 'status-chip status-chip--open' }];
  }

  const target = toStartOfDayTime(t);
  const today = toStartOfDayTime(Date.now());
  const diffDays = Math.floor((target - today) / 86400000);

  if (diffDays < 0) {
    return [{ label: 'Encerrado', className: 'status-chip status-chip--closed' }];
  }

  const badges = [{ label: 'Aberto', className: 'status-chip status-chip--open' }];

  if (diffDays === 0) {
    badges.push({
      label: 'Fecha hoje',
      className: 'status-chip status-chip--deadline',
      style: `--status-chip-color:${buildUrgencyColor(diffDays)};`,
    });
    return badges;
  }

  if (diffDays === 1) {
    badges.push({
      label: 'Fecha amanhã',
      className: 'status-chip status-chip--deadline',
      style: `--status-chip-color:${buildUrgencyColor(diffDays)};`,
    });
    return badges;
  }

  badges.push({
    label: `Fecha em ${diffDays} dias`,
    className: 'status-chip status-chip--deadline',
    style: `--status-chip-color:${buildUrgencyColor(diffDays)};`,
  });

  return badges;
}

function buildUrgencyColor(daysLeft) {
  const maxWindow = 30;
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

  return `rgb(${r},${g},${b})`;
}

function toStartOfDayTime(timeMs) {
  const d = new Date(timeMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
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

function formatFundingValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  const raw = String(value).trim();
  if (!raw) return '';

  if (/^r\$/i.test(raw)) return raw;

  const maybeNumber = Number(
    raw
      .replace(/[^\d,.-]/g, '')
      .replace(/\.(?=\d{3}(\D|$))/g, '')
      .replace(',', '.')
  );

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
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
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
