import {
  ensureChatSessionState,
  markChatUserInteracted,
  shouldHideInitialChatSuggestions,
} from './chat-session-state.js';

export function shouldShowInitialChatSuggestions(state, { hasActiveContext = false } = {}) {
  if (hasActiveContext) return false;
  return !shouldHideInitialChatSuggestions(ensureChatSessionState(state));
}

export function markInitialChatInteraction(state, source = 'message_send') {
  return markChatUserInteracted(ensureChatSessionState(state), source);
}

export function prefersReducedMotion(win = globalThis) {
  try {
    return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch (_) {
    return false;
  }
}

