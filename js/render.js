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

        <div class="card-actions">
          <button class="card-icon-btn share-btn" type="button" title="Copiar link" aria-label="Copiar link" data-share="${escapeAttr(localShareLink)}">
            <i class="fas fa-link"></i>
          </button>

          <button class="card-icon-btn save-btn ${edital.is_favorite ? 'is-saved' : ''}" type="button" title="${edital.is_favorite ? 'Remover dos salvos' : 'Salvar edital'}" aria-label="Salvar edital" data-id="${escapeAttr(edital.id)}">
            <i class="${edital.is_favorite ? 'fas' : 'far'} fa-star"></i>
          </button>
        </div>
      </div>

      <h3 class="card-title">${escapeHtml(edital.titulo || 'Sem título')}</h3>
      <p class="card-desc">${escapeHtml(edital.descricao || 'Sem descrição')}</p>

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
