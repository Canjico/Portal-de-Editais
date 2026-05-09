/* =========================================================
   Athos / Atimus - Presença de Usuário (Portal de Editais)
   - Heartbeat periódico enquanto houver atividade real no portal
   - Marcação de offline em logout, fechamento de aba e troca de página
   ========================================================= */

(function bootstrapPresenceTracker() {
  const API_BASE = 'https://atimus-api-acb4gfgagefcevb5.brazilsouth-01.azurewebsites.net';

  const HEARTBEAT_INTERVAL_MS = 30000;
  const ACTIVE_GRACE_MS = 60000;
  const FAILED_RETRY_COOLDOWN_MS = 300000;
  const START_AFTER_APP_READY_DELAY_MS = 1200;
  const START_FALLBACK_DELAY_MS = 6000;

  const HEARTBEAT_ENDPOINTS = [
    '/cliente/presenca/heartbeat',
    '/cliente/presenca',
    '/cliente/heartbeat',
    '/cliente/activity',
    '/presenca/heartbeat',
  ];

  const OFFLINE_ENDPOINTS = [
    '/cliente/presenca/offline',
    '/cliente/offline',
    '/cliente/presenca',
    '/presenca/offline',
  ];

  const PRESENCE_ENDPOINT_KEY = 'athos_presence_endpoint';
  const PRESENCE_SOURCE = 'portal_editais';

  let started = false;
  let intervalId = null;
  let deferredStartTimerId = null;
  let fallbackStartTimerId = null;
  let lastInteractionAt = Date.now();
  let resolvedEndpoint = null;
  let failedProbeUntil = 0;
  let firstInteractionListeners = [];

  function getStoredToken() {
    try {
      return null;
    } catch (_) {
      return null;
    }
  }

  function normalizeEndpoint(pathOrUrl) {
    if (!pathOrUrl) return '';
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    const path = String(pathOrUrl).startsWith('/') ? String(pathOrUrl) : `/${String(pathOrUrl)}`;
    return `${API_BASE}${path}`;
  }

  function uniqueEndpoints(candidates) {
    const seen = new Set();
    const out = [];
    for (const candidate of candidates) {
      const normalized = normalizeEndpoint(candidate);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  }

  function readCachedEndpoint() {
    try {
      const raw = sessionStorage.getItem(PRESENCE_ENDPOINT_KEY);
      return raw ? normalizeEndpoint(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeCachedEndpoint(value) {
    const normalized = normalizeEndpoint(value);
    if (!normalized) return;
    resolvedEndpoint = normalized;
    try {
      sessionStorage.setItem(PRESENCE_ENDPOINT_KEY, normalized);
    } catch (_) {}
  }

  async function postPresence(url, payload, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const request = {
      method: 'POST',
      credentials: 'include',
      keepalive: !!options.keepalive,
      headers,
      body: JSON.stringify(payload),
    };

    return fetch(url, request);
  }

  async function tryPresenceRequest(kind, options = {}) {
    const now = Date.now();
    const payload = {
      source: PRESENCE_SOURCE,
      status: kind,
      event_type: kind,
      online: kind === 'online',
      path: window.location.pathname,
      occurred_at: new Date(now).toISOString(),
      last_seen_at: new Date(now).toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    };

    const fallbackEndpoints = kind === 'online' ? HEARTBEAT_ENDPOINTS : OFFLINE_ENDPOINTS;
    const candidates = resolvedEndpoint
      ? [resolvedEndpoint, ...fallbackEndpoints]
      : fallbackEndpoints;
    const endpoints = uniqueEndpoints(candidates);

    for (const endpoint of endpoints) {
      try {
        const res = await postPresence(endpoint, payload, options);
        if (res.ok || res.status === 202 || res.status === 204) {
          if (kind === 'online') writeCachedEndpoint(endpoint);
          return true;
        }
      } catch (_) {
        // tenta próximo endpoint
      }
    }

    return false;
  }

  async function markOnline() {
    const now = Date.now();
    if (!resolvedEndpoint && failedProbeUntil > now) {
      return false;
    }

    const ok = await tryPresenceRequest('online');
    if (ok) {
      failedProbeUntil = 0;
      return true;
    }

    if (!resolvedEndpoint) {
      failedProbeUntil = now + FAILED_RETRY_COOLDOWN_MS;
    }
    return false;
  }

  async function markOffline(options = {}) {
    return tryPresenceRequest('offline', { keepalive: options.keepalive !== false });
  }

  function shouldSendHeartbeat() {
    if (document.visibilityState !== 'visible') return false;
    return (Date.now() - lastInteractionAt) <= ACTIVE_GRACE_MS;
  }

  function registerUserInteraction() {
    lastInteractionAt = Date.now();
  }

  function bindActivityEvents() {
    const passive = { passive: true };
    const handler = () => registerUserInteraction();

    window.addEventListener('mousemove', handler, passive);
    window.addEventListener('pointerdown', handler, passive);
    window.addEventListener('keydown', handler);
    window.addEventListener('scroll', handler, passive);
    window.addEventListener('touchstart', handler, passive);
    window.addEventListener('focus', handler);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        registerUserInteraction();
        markOnline();
      }
    });

    window.addEventListener('pagehide', () => {
      markOffline({ keepalive: true });
    });

    window.addEventListener('beforeunload', () => {
      markOffline({ keepalive: true });
    });

    window.addEventListener('athos:logout', () => {
      markOffline({ keepalive: true });
    });
  }

  function clearDeferredStartTimers() {
    if (deferredStartTimerId) {
      clearTimeout(deferredStartTimerId);
      deferredStartTimerId = null;
    }
    if (fallbackStartTimerId) {
      clearTimeout(fallbackStartTimerId);
      fallbackStartTimerId = null;
    }
  }

  function removeFirstInteractionListeners() {
    if (!firstInteractionListeners.length) return;
    firstInteractionListeners.forEach(({ target, eventName, handler, options }) => {
      try {
        target.removeEventListener(eventName, handler, options);
      } catch (_) {}
    });
    firstInteractionListeners = [];
  }

  function bindFirstInteractionStart() {
    if (firstInteractionListeners.length) return;

    const startOnInteraction = () => {
      removeFirstInteractionListeners();
      clearDeferredStartTimers();
      start();
    };

    const bindings = [
      { target: window, eventName: 'pointerdown', options: { once: true, passive: true } },
      { target: window, eventName: 'keydown', options: { once: true } },
      { target: window, eventName: 'touchstart', options: { once: true, passive: true } },
    ];

    bindings.forEach(({ target, eventName, options }) => {
      target.addEventListener(eventName, startOnInteraction, options);
      firstInteractionListeners.push({ target, eventName, handler: startOnInteraction, options });
    });
  }

  function scheduleStartAfterBootstrapDelay(delayMs = START_AFTER_APP_READY_DELAY_MS) {
    if (started || deferredStartTimerId) return;
    const safeDelay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : START_AFTER_APP_READY_DELAY_MS;
    deferredStartTimerId = setTimeout(() => {
      deferredStartTimerId = null;
      removeFirstInteractionListeners();
      start();
    }, safeDelay);
  }

  function bootstrapDeferredStart() {
    bindFirstInteractionStart();

    const trySchedule = () => {
      const appLoading = Boolean(document.body?.classList?.contains?.('app-loading'));
      if (!appLoading) {
        scheduleStartAfterBootstrapDelay();
      }
    };

    window.addEventListener('athos:app-ready', () => {
      scheduleStartAfterBootstrapDelay();
    }, { once: true });

    fallbackStartTimerId = setTimeout(() => {
      scheduleStartAfterBootstrapDelay(0);
    }, START_FALLBACK_DELAY_MS);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', trySchedule, { once: true });
      return;
    }
    trySchedule();
  }

  function start() {
    if (started) return;
    started = true;
    clearDeferredStartTimers();
    removeFirstInteractionListeners();
    resolvedEndpoint = readCachedEndpoint();
    registerUserInteraction();
    bindActivityEvents();

    markOnline();

    intervalId = setInterval(() => {
      if (!shouldSendHeartbeat()) return;
      markOnline();
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stop() {
    if (!started) return;
    started = false;
    clearDeferredStartTimers();
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  window.AthosPresence = {
    start,
    stop,
    markOnline,
    markOffline,
    registerUserInteraction,
    config: {
      HEARTBEAT_INTERVAL_MS,
      ACTIVE_GRACE_MS,
    },
  };

  bootstrapDeferredStart();
})();
