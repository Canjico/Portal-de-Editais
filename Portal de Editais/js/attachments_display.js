const CATEGORY_META = {
  edital_principal: {
    label: 'Edital principal',
    group: 'Documentos principais',
    priority: 10,
  },
  retificacao_adendo: {
    label: 'Retifica\u00e7\u00e3o ou adendo',
    group: 'Documentos principais',
    priority: 20,
  },
  cronograma: {
    label: 'Cronograma',
    group: 'Cronograma',
    priority: 30,
  },
  formulario_modelo: {
    label: 'Formul\u00e1rio ou modelo',
    group: 'Formul\u00e1rios e modelos',
    priority: 40,
  },
  anexo_tecnico: {
    label: 'Anexo t\u00e9cnico',
    group: 'Anexos t\u00e9cnicos',
    priority: 50,
  },
  manual_orientacao: {
    label: 'Manual ou orienta\u00e7\u00e3o',
    group: 'Manuais e orienta\u00e7\u00f5es',
    priority: 60,
  },
  resultado_homologacao: {
    label: 'Resultado ou homologa\u00e7\u00e3o',
    group: 'Resultados e homologa\u00e7\u00f5es',
    priority: 70,
  },
  documento_institucional: {
    label: 'Documento institucional',
    group: 'Documentos institucionais',
    priority: 80,
  },
  outros: {
    label: 'Outros documentos',
    group: 'Outros documentos',
    priority: 90,
  },
};

export function getAttachmentCategoryMeta(category) {
  const key = typeof category === 'string' && CATEGORY_META[category]
    ? category
    : 'outros';
  return { ...CATEGORY_META[key] };
}

export function normalizeAttachmentForDisplay(attachment, originalIndex = 0) {
  const source = isPlainObject(attachment) ? attachment : {};
  const rawCategory = typeof source.category === 'string' && source.category.trim()
    ? source.category.trim()
    : 'outros';
  const category = CATEGORY_META[rawCategory] ? rawCategory : 'outros';
  const meta = getAttachmentCategoryMeta(category);
  const priority = coercePriority(source.priority, meta.priority);

  return {
    ...source,
    nome: stringOrFallback(source.nome, 'Documento'),
    url: stringOrFallback(source.url, ''),
    tipo: stringOrFallback(source.tipo, ''),
    category,
    category_label: stringOrFallback(source.category_label, meta.label),
    display_group: stringOrFallback(source.display_group, meta.group),
    priority,
    is_primary: typeof source.is_primary === 'boolean'
      ? source.is_primary
      : category === 'edital_principal',
    source_role: stringOrFallback(source.source_role, category === 'outros' ? 'outros' : category),
    confidence: coerceNumber(source.confidence, 0),
    reasons: Array.isArray(source.reasons) ? [...source.reasons] : [],
    originalIndex: coerceOriginalIndex(originalIndex),
  };
}

export function groupAttachmentsForDisplay(attachments) {
  if (!Array.isArray(attachments)) return [];

  const normalized = attachments
    .map((attachment, index) => normalizeAttachmentForDisplay(attachment, index))
    .sort((a, b) => {
      const priorityDiff = a.priority - b.priority;
      if (priorityDiff !== 0) return priorityDiff;
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      return a.originalIndex - b.originalIndex;
    });

  const groupsByName = new Map();
  normalized.forEach((attachment) => {
    const groupName = attachment.display_group || 'Outros documentos';
    if (!groupsByName.has(groupName)) {
      groupsByName.set(groupName, {
        group: groupName,
        priority: attachment.priority,
        items: [],
      });
    }
    const group = groupsByName.get(groupName);
    group.priority = Math.min(group.priority, attachment.priority);
    group.items.push(attachment);
  });

  return Array.from(groupsByName.values()).sort((a, b) => a.priority - b.priority);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringOrFallback(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function coercePriority(value, fallback) {
  const priority = coerceNumber(value, null);
  return priority === null ? fallback : priority;
}

function coerceNumber(value, fallback) {
  if (typeof value === 'boolean' || value === null || value === undefined) return fallback;
  const numberValue = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function coerceOriginalIndex(value) {
  const index = coerceNumber(value, 0);
  return Number.isFinite(index) ? index : 0;
}
