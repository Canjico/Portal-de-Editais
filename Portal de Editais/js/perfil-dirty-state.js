export function normalizeTextValue(value, { lower = false } = {}) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  return lower ? cleaned.toLowerCase() : cleaned;
}

export function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeAreasInteresse(values) {
  if (!Array.isArray(values)) return [];
  const unique = new Map();

  values.forEach((value) => {
    const cleaned = normalizeTextValue(value);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (!unique.has(key)) unique.set(key, cleaned);
  });

  return Array.from(unique.values())
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
}

export function normalizeFormForComparison(form) {
  const source = form && typeof form === 'object' ? form : {};
  return {
    nomeCompleto: normalizeTextValue(source.nomeCompleto),
    email: normalizeTextValue(source.email, { lower: true }),
    telefone: normalizeDigits(source.telefone),
    cargo: normalizeTextValue(source.cargo),
    nomeEmpresa: normalizeTextValue(source.nomeEmpresa),
    cnpj: normalizeDigits(source.cnpj),
    setorEmpresa: normalizeTextValue(source.setorEmpresa),
    setorAtuacao: normalizeTextValue(source.setorAtuacao),
    areasInteresse: normalizeAreasInteresse(source.areasInteresse),
    prefEditais: Boolean(source.prefEditais),
    prefPrazo: Boolean(source.prefPrazo),
    prefRelatorio: Boolean(source.prefRelatorio),
    prefSistema: Boolean(source.prefSistema),
  };
}

export function serializeComparableForm(form) {
  return JSON.stringify(form && typeof form === 'object' ? form : {});
}

export function collectComparableSnapshot(form) {
  const comparableForm = normalizeFormForComparison(form);
  return {
    comparableForm,
    hash: serializeComparableForm(comparableForm),
  };
}

export function isComparableFormDirty(currentComparableForm, baselineHash) {
  if (!baselineHash) return false;
  return serializeComparableForm(currentComparableForm) !== baselineHash;
}

export function resolveDirtyTrackingState({
  currentComparableForm,
  baselineComparableForm = null,
  baselineHash = '',
  hasUserInteracted = false,
  userInitiated = false,
} = {}) {
  const current = currentComparableForm && typeof currentComparableForm === 'object'
    ? currentComparableForm
    : normalizeFormForComparison({});

  let nextBaselineForm = baselineComparableForm;
  let nextBaselineHash = baselineHash;
  if (!nextBaselineHash) {
    nextBaselineForm = current;
    nextBaselineHash = serializeComparableForm(current);
  }

  let dirty = serializeComparableForm(current) !== nextBaselineHash;

  if (!userInitiated && dirty && !hasUserInteracted) {
    nextBaselineForm = current;
    nextBaselineHash = serializeComparableForm(current);
    dirty = false;
  }

  let nextHasUserInteracted = hasUserInteracted;
  if (userInitiated && dirty) nextHasUserInteracted = true;
  if (!dirty) nextHasUserInteracted = false;

  return {
    baselineComparableForm: nextBaselineForm,
    baselineHash: nextBaselineHash,
    dirty,
    hasUserInteracted: nextHasUserInteracted,
    showUnsavedBanner: dirty && nextHasUserInteracted,
  };
}
