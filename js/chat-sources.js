function cleanString(value) {
  return String(value ?? '').trim();
}

function normalizeKey(value) {
  return cleanString(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeSourceStatus(source) {
  const status = cleanString(source?.status).toLowerCase();
  if (status) return status;
  if (source?.ok === false) return 'error';
  return 'ok';
}

export function isSourceOk(source) {
  return normalizeSourceStatus(source) === 'ok';
}

export function getSourceTypeLabel(type) {
  const normalized = normalizeKey(type).replace(/-/g, '_');
  if (!normalized) return '';
  if (normalized === 'edital_attachment' || normalized === 'attachment' || normalized === 'anexo') {
    return 'Anexo';
  }
  if (normalized === 'edital_card' || normalized === 'edital') {
    return 'Edital';
  }
  if (normalized === 'site_page' || normalized === 'page' || normalized === 'pagina') {
    return 'Pagina';
  }
  if (normalized === 'dashboard') {
    return 'Dashboard';
  }
  return cleanString(type).replace(/[_-]+/g, ' ');
}

function normalizeSourceLike(source, idx = 0) {
  if (!source || typeof source !== 'object') return null;

  const rawTitle = cleanString(source.title || source.source_name || source.name || source.nome);
  const url = cleanString(source.source_url || source.url || source.link);
  const error = cleanString(source.error);

  if (!rawTitle && !url && !error) return null;

  const title = rawTitle || url || `Fonte ${idx + 1}`;
  const status = normalizeSourceStatus(source);
  const type = cleanString(source.source_type || source.type);
  const editalId = source.edital_id ?? source.editalId ?? null;

  return {
    title,
    url,
    status,
    type,
    error,
    editalId,
  };
}

function mergeSource(existing, incoming) {
  if (!existing) return incoming;

  const existingOk = isSourceOk(existing);
  const incomingOk = isSourceOk(incoming);
  return {
    title: existing.title || incoming.title,
    url: existing.url || incoming.url,
    status: existingOk && !incomingOk ? incoming.status : existing.status,
    type: existing.type || incoming.type,
    error: existing.error || incoming.error,
    editalId: existing.editalId ?? incoming.editalId ?? null,
  };
}

export function normalizeSources(rawSources, fallbackNames = []) {
  const byTitle = new Map();
  const seenUrls = new Set();

  const addNormalizedSource = (source) => {
    if (!source) return;

    const titleKey = normalizeKey(`${source.type || ''}|${source.title || ''}|${source.editalId ?? ''}`);
    const urlKey = normalizeKey(source.url);
    if (!titleKey && !urlKey && !source.error) return;

    const existing = byTitle.get(titleKey);
    if (urlKey && seenUrls.has(urlKey) && !existing) return;

    byTitle.set(titleKey, mergeSource(existing, source));
    if (urlKey) seenUrls.add(urlKey);
  };

  if (Array.isArray(rawSources)) {
    rawSources.forEach((source, idx) => {
      if (typeof source === 'string') {
        const label = cleanString(source);
        if (!label) return;
        addNormalizedSource({
          title: label,
          url: /^https?:\/\//i.test(label) ? label : '',
          status: 'ok',
          type: '',
          error: '',
          editalId: null,
        });
        return;
      }

      addNormalizedSource(normalizeSourceLike(source, idx));
    });
  }

  if (Array.isArray(fallbackNames)) {
    fallbackNames.forEach((name) => {
      const label = cleanString(name);
      if (!label) return;
      addNormalizedSource({
        title: label,
        url: /^https?:\/\//i.test(label) ? label : '',
        status: 'ok',
        type: '',
        error: '',
        editalId: null,
      });
    });
  }

  return Array.from(byTitle.values());
}

function sourceStatusLabel(status) {
  const normalized = normalizeKey(status);
  if (normalized === 'error') return 'Erro';
  if (normalized === 'warning' || normalized === 'warn') return 'Aviso';
  return cleanString(status);
}

export function buildSourceDisplayText(source) {
  const title = cleanString(source?.title || source?.name || source?.nome || 'Fonte');
  const typeLabel = getSourceTypeLabel(source?.type || source?.source_type);
  const titlePrefix = typeLabel ? `${typeLabel}:` : '';
  const headline = titlePrefix && !normalizeKey(title).startsWith(normalizeKey(titlePrefix))
    ? `${titlePrefix} ${title}`
    : title;

  const status = normalizeSourceStatus(source);
  const error = cleanString(source?.error);
  const details = [];

  if (status !== 'ok') {
    details.push(error ? `${sourceStatusLabel(status)}: ${error}` : sourceStatusLabel(status));
  } else if (error) {
    details.push(error);
  }

  return [headline, ...details].filter(Boolean).join(' - ');
}

export function buildSourcesDetails(sources, documentRef = globalThis.document) {
  const normalized = normalizeSources(sources);
  if (!normalized.length) return null;
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new Error('document.createElement indisponivel para renderizar fontes');
  }

  const total = normalized.length;
  const ok = normalized.filter(isSourceOk).length;

  const details = documentRef.createElement('details');
  details.className = 'chat-sources-details';

  const summary = documentRef.createElement('summary');
  const icon = documentRef.createElement('i');
  icon.className = 'fas fa-file-lines';
  icon.setAttribute('aria-hidden', 'true');
  const label = documentRef.createElement('span');
  label.textContent = `Fontes consultadas (${ok}/${total})`;
  summary.appendChild(icon);
  summary.appendChild(label);
  details.appendChild(summary);

  const ul = documentRef.createElement('ul');
  ul.className = 'chat-sources-list';

  normalized.forEach((source) => {
    const li = documentRef.createElement('li');
    li.className = 'chat-source-item';
    const text = buildSourceDisplayText(source);

    if (source.url) {
      const a = documentRef.createElement('a');
      a.href = source.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = text;
      li.appendChild(a);
    } else {
      const span = documentRef.createElement('span');
      span.textContent = text;
      li.appendChild(span);
    }

    ul.appendChild(li);
  });

  details.appendChild(ul);
  return details;
}
