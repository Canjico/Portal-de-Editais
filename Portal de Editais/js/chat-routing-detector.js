const DOCUMENTAL_SEMANTIC_PHRASES = [
  'cnpj',
  'contrapartida',
  'documento',
  'documentos',
  'documentacao',
  'documentacao exigida',
  'documentos preciso enviar',
  'quais documentos preciso enviar',
  'anexo',
  'anexos',
  'resuma os anexos',
  'resumir os anexos',
  'requisito',
  'requisitos',
  'certidao',
  'certidoes',
  'regularidade fiscal',
  'curriculo lattes',
  'lattes',
  'diploma',
  'plano de trabalho',
  'orcamento',
  'quem pode participar',
  'publico alvo',
  'publico-alvo',
  'elegibilidade',
  'elegivel',
  'esse edital',
  'este edital',
  'desse edital',
  'deste edital',
  'esse edital combina comigo',
  'esse edital combina com minha empresa',
  'este edital combina comigo',
  'este edital combina com minha empresa',
  'combina comigo',
  'combina com minha empresa',
];

export function normalizeChatRouteQuery(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isDocumentalSemanticQuestion(question) {
  const normalized = normalizeChatRouteQuery(question);
  if (!normalized) return false;

  if (DOCUMENTAL_SEMANTIC_PHRASES.some((phrase) => normalized.includes(normalizeChatRouteQuery(phrase)))) {
    return true;
  }

  return (
    /\b(quais|qual)\s+documentos?\b/.test(normalized) ||
    /\b(editais?|chamadas?)\s+(pedem|exigem|exige|solicitam|solicita|mencionam|menciona)\s+(cnpj|contrapartida|documentos?|anexos?|certidoes?|requisitos?)\b/.test(normalized) ||
    /\b(tem|exige|pede|solicita|menciona)\s+(cnpj|contrapartida|documentos?|anexos?|certidoes?|requisitos?)\b/.test(normalized)
  );
}

export function shouldBlockDashboardForDocumentalQuestion(question) {
  return isDocumentalSemanticQuestion(question);
}
