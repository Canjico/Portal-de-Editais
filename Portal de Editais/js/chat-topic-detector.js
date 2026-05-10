const TOPIC_STOPWORDS = new Set([
  'a', 'as', 'o', 'os', 'um', 'uma', 'uns', 'umas',
  'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'para', 'por', 'com', 'sem', 'que', 'quais', 'qual', 'me',
  'eu', 'voce', 'voces', 'vc', 'isso', 'isto', 'aquele', 'aquela',
  'agora', 'hoje', 'amanha', 'ontem', 'esse', 'essa', 'este', 'esta',
  'edital', 'editais', 'sobre',
]);

const EXPLICIT_EXIT_PHRASES = [
  'sair',
  'voltar para busca geral',
  'voltar para busca',
  'quero falar de outro assunto',
  'mudar de assunto',
  'nao quero mais esse edital',
  'não quero mais esse edital',
  'agora quero ver outros editais',
  'me mostre oportunidades diferentes',
];

const STRONG_SWITCH_PHRASES = [
  'outro assunto',
  'outros assuntos',
  'outro edital',
  'outros editais',
  'voltar para busca geral',
  'voltar para busca',
  'quero ver outros editais',
  'agora quero ver',
  'quero falar de tecnologia',
  'nao quero mais esse edital',
  'não quero mais esse edital',
  'me mostre oportunidades diferentes',
  'mudar de assunto',
  'trocar de assunto',
  'trocar assunto',
];

const AMBIGUOUS_SWITCH_PHRASES = [
  'quero ver outra coisa',
  'quero mudar',
  'e agora',
  'tem mais opcoes',
  'tem mais opções',
  'mais opcoes',
  'mais opções',
];

const EXPLICIT_STAY_PHRASES = [
  'continuar',
  'continuar nesse edital',
  'continuar neste edital',
  'seguir nesse edital',
  'seguir neste edital',
  'manter nesse edital',
  'manter neste edital',
];

const CONTEXT_REFERENCE_PHRASES = [
  'desse edital',
  'deste edital',
  'esse edital',
  'esse aqui',
  'isso',
  'ele',
  'qual o objetivo',
  'qual objetivo',
  'qual o prazo',
  'quem pode participar',
  'me resume',
  'resuma',
  'resume isso',
  'esse aceita pequena empresa',
  'quanto ele financia',
  'quais sao os requisitos',
  'quais são os requisitos',
  'como funciona esse aqui',
];

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function normalizeTopicText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAnyPhrase(normalizedText, phrases) {
  if (!normalizedText) return false;
  return phrases.some((phrase) => normalizedText.includes(normalizeTopicText(phrase)));
}

function extractSignalTokens(text) {
  const normalized = normalizeTopicText(text);
  if (!normalized) return [];
  const seen = new Set();
  return normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length >= 3 && !TOPIC_STOPWORDS.has(token))
    .filter((token) => {
      if (seen.has(token)) return false;
      seen.add(token);
      return true;
    });
}

function buildContextCorpus(state) {
  if (!state || typeof state !== 'object') return '';
  const history = Array.isArray(state.conversationHistory) ? state.conversationHistory : [];
  const tail = history.slice(-6).map((entry) => entry?.text || '');
  return [
    state.activeContext || '',
    state.activeEntityTitle || '',
    state.shortSummary || '',
    ...tail,
  ].join(' ');
}

function computeSemanticMatch(messageTokens, contextTokens) {
  const msgSet = new Set(Array.isArray(messageTokens) ? messageTokens : []);
  const ctxSet = new Set(Array.isArray(contextTokens) ? contextTokens : []);
  if (!msgSet.size || !ctxSet.size) return 0;

  let intersection = 0;
  msgSet.forEach((token) => {
    if (ctxSet.has(token)) intersection += 1;
  });
  const union = new Set([...msgSet, ...ctxSet]).size;
  const jaccard = union > 0 ? (intersection / union) : 0;
  const messageRecall = msgSet.size > 0 ? (intersection / msgSet.size) : 0;
  return Math.max(jaccard, messageRecall);
}

function looksLikeFollowUpQuestion(normalizedMessage) {
  if (!normalizedMessage) return false;
  const tokenCount = normalizedMessage.split(/\s+/).filter(Boolean).length;
  if (tokenCount > 10) return false;
  return /^(qual|quais|quem|como|quanto|quando|onde|por que|pq|me resume|resuma|resume)\b/.test(normalizedMessage);
}

export function isExplicitExitCommand(message) {
  const normalized = normalizeTopicText(message);
  if (!normalized) return false;
  if (normalized === 'sair' || normalized === 'voltar') return true;
  if (/^(sair|voltar|fechar edital|encerrar edital|encerrar assunto|fechar assunto)$/.test(normalized)) return true;
  return hasAnyPhrase(normalized, EXPLICIT_EXIT_PHRASES);
}

export function isExplicitStayCommand(message) {
  const normalized = normalizeTopicText(message);
  if (!normalized) return false;
  return hasAnyPhrase(normalized, EXPLICIT_STAY_PHRASES);
}

function detectNewDominantIntent(normalizedMessage, hasContextReference) {
  if (!normalizedMessage || hasContextReference) return false;
  if (hasAnyPhrase(normalizedMessage, STRONG_SWITCH_PHRASES)) return true;
  return /(quero falar de|agora quero ver|me mostre|voltar para busca|nao quero mais|não quero mais)/.test(normalizedMessage);
}

function normalizeThresholds(rawThresholds) {
  const autoSwitch = clamp(rawThresholds?.autoSwitch ?? 0.9, 0.75, 0.99);
  const ambiguousMin = clamp(rawThresholds?.ambiguousMin ?? 0.6, 0.4, autoSwitch);
  return { autoSwitch, ambiguousMin };
}

export function detectTopicTransition({
  message,
  state = null,
  topicThresholds = null,
} = {}) {
  const normalizedMessage = normalizeTopicText(message);
  const thresholds = normalizeThresholds(topicThresholds || state?.topicThresholds);

  if (!normalizedMessage) {
    return {
      decision: 'ambiguous',
      confidence: 0.5,
      reason: 'uncertain',
      thresholds,
      debug: {
        hasContextReference: false,
        hasStrongSwitchHint: false,
        semanticMatch: 0,
      },
    };
  }

  if (isExplicitExitCommand(normalizedMessage)) {
    return {
      decision: 'switch_topic',
      confidence: 1,
      reason: 'explicit_exit',
      thresholds,
      debug: {
        hasContextReference: false,
        hasStrongSwitchHint: true,
        semanticMatch: 0,
      },
    };
  }

  if (isExplicitStayCommand(normalizedMessage)) {
    return {
      decision: 'stay_on_topic',
      confidence: 0.98,
      reason: 'context_reference',
      thresholds,
      debug: {
        hasContextReference: true,
        hasStrongSwitchHint: false,
        semanticMatch: 0,
      },
    };
  }

  const hasContextReference = hasAnyPhrase(normalizedMessage, CONTEXT_REFERENCE_PHRASES) || looksLikeFollowUpQuestion(normalizedMessage);
  const hasStrongSwitchHint = hasAnyPhrase(normalizedMessage, STRONG_SWITCH_PHRASES);
  const hasAmbiguousSwitchHint = hasAnyPhrase(normalizedMessage, AMBIGUOUS_SWITCH_PHRASES);
  const messageTokens = extractSignalTokens(normalizedMessage);
  const contextTokens = extractSignalTokens(buildContextCorpus(state));
  const semanticMatch = computeSemanticMatch(messageTokens, contextTokens);
  const hasNewDominantIntent = detectNewDominantIntent(normalizedMessage, hasContextReference);

  let switchConfidence = 0;
  if (hasStrongSwitchHint) switchConfidence = Math.max(switchConfidence, 0.92);
  if (hasAmbiguousSwitchHint) switchConfidence = Math.max(switchConfidence, 0.68);
  if (hasNewDominantIntent) switchConfidence = Math.max(switchConfidence, 0.86);
  if (hasNewDominantIntent && semanticMatch < 0.2 && messageTokens.length >= 2) {
    switchConfidence = Math.min(0.98, switchConfidence + 0.08);
  }
  if (hasContextReference) switchConfidence = Math.max(0, switchConfidence - 0.3);
  if (semanticMatch >= 0.35) switchConfidence = Math.max(0, switchConfidence - 0.2);

  let stayConfidence = 0.52;
  if (hasContextReference) stayConfidence = Math.max(stayConfidence, 0.93);
  if (semanticMatch >= 0.45) stayConfidence = Math.max(stayConfidence, 0.9);
  else if (semanticMatch >= 0.25) stayConfidence = Math.max(stayConfidence, 0.78);
  if (looksLikeFollowUpQuestion(normalizedMessage) && !hasStrongSwitchHint) {
    stayConfidence = Math.max(stayConfidence, 0.86);
  }
  if (hasStrongSwitchHint && !hasContextReference) {
    stayConfidence = Math.min(stayConfidence, 0.55);
  }

  let decision = 'stay_on_topic';
  let confidence = stayConfidence;
  let reason = hasContextReference ? 'context_reference' : (semanticMatch >= 0.25 ? 'semantic_match' : 'uncertain');

  if (switchConfidence >= thresholds.autoSwitch) {
    decision = 'switch_topic';
    confidence = switchConfidence;
    reason = 'new_topic_detected';
  } else if (switchConfidence >= thresholds.ambiguousMin) {
    decision = 'ambiguous';
    confidence = switchConfidence;
    reason = hasStrongSwitchHint ? 'new_topic_detected' : 'uncertain';
  } else if (stayConfidence < 0.6 && hasAmbiguousSwitchHint) {
    decision = 'ambiguous';
    confidence = 0.62;
    reason = 'uncertain';
  } else if (stayConfidence < 0.6) {
    decision = 'stay_on_topic';
    confidence = 0.55;
    reason = 'uncertain';
  }

  return {
    decision,
    confidence: clamp(confidence, 0, 1),
    reason,
    thresholds,
    debug: {
      hasContextReference,
      hasStrongSwitchHint,
      hasAmbiguousSwitchHint,
      hasNewDominantIntent,
      semanticMatch: clamp(semanticMatch, 0, 1),
      messageTokens: messageTokens.slice(0, 10),
      contextTokens: contextTokens.slice(0, 10),
    },
  };
}

export function buildTopicDisambiguationNotice(state) {
  const contextType = String(state?.activeContextType || '').trim().toLowerCase() || 'general';
  if (contextType === 'edital') {
    return 'Ainda estou considerando que você está falando do edital atual. Se quiser sair deste edital e voltar para a busca geral, digite "sair".';
  }
  return 'Se quiser mudar de assunto, digite "sair".';
}

