(() => {
  'use strict';

  const STORAGE_KEY = 'athos_cookie_consent_v1';
  const COOKIE_KEY = 'athos_cookie_consent_v1';
  const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180 dias

  const DEFAULT_CONSENT = Object.freeze({
    version: 1,
    status: 'pending',
    necessary: true,
    analytics: false,
    marketing: false,
    updatedAt: null,
  });

  let consent = loadConsent();
  let ui = null;

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function normalizeConsent(raw) {
    if (!isObject(raw)) return null;

    const status = String(raw.status || '').trim().toLowerCase();
    const allowedStatus = new Set([
      'pending',
      'accepted_all',
      'rejected_optional',
      'custom',
    ]);

    return {
      version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : DEFAULT_CONSENT.version,
      status: allowedStatus.has(status) ? status : DEFAULT_CONSENT.status,
      necessary: true,
      analytics: Boolean(raw.analytics),
      marketing: Boolean(raw.marketing),
      updatedAt: raw.updatedAt ? String(raw.updatedAt) : null,
    };
  }

  function readCookie(name) {
    try {
      const cookies = document.cookie ? document.cookie.split('; ') : [];
      for (const c of cookies) {
        const idx = c.indexOf('=');
        if (idx < 0) continue;
        const key = c.slice(0, idx);
        if (key !== name) continue;
        return decodeURIComponent(c.slice(idx + 1));
      }
    } catch (_) {}
    return null;
  }

  function writeCookie(name, value, maxAgeSeconds) {
    try {
      document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax`;
    } catch (_) {}
  }

  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  function parseConsentString(raw) {
    if (!raw) return null;
    try {
      return normalizeConsent(JSON.parse(raw));
    } catch (_) {
      return null;
    }
  }

  function loadConsent() {
    const fromStorage = parseConsentString(readStorage(STORAGE_KEY));
    if (fromStorage) return fromStorage;

    const fromCookie = parseConsentString(readCookie(COOKIE_KEY));
    if (fromCookie) return fromCookie;

    return { ...DEFAULT_CONSENT };
  }

  function persistConsent(next) {
    const serialized = JSON.stringify(next);
    writeStorage(STORAGE_KEY, serialized);
    writeCookie(COOKIE_KEY, serialized, COOKIE_MAX_AGE_SECONDS);
  }

  function hasDecision(value = consent) {
    return Boolean(value && value.status && value.status !== 'pending');
  }

  function hasCategoryConsent(category) {
    if (!category) return false;
    if (category === 'necessary') return true;
    if (category === 'analytics') return Boolean(consent.analytics);
    if (category === 'marketing') return Boolean(consent.marketing);
    return false;
  }

  function emitConsentChanged() {
    try {
      window.dispatchEvent(new CustomEvent('athos:cookie-consent-updated', { detail: { ...consent } }));
    } catch (_) {}
  }

  function updateBodyLock() {
    document.body.classList.toggle('cookie-consent-required', !hasDecision());
  }

  function setBannerVisible(show) {
    if (!ui) return;
    ui.banner.hidden = !show;
  }

  function setManagerVisible(show) {
    if (!ui) return;
    ui.manager.hidden = !show;
  }

  function getManagerSlot() {
    return document.querySelector('[data-cookie-manager-slot]');
  }

  function placeManagerButton() {
    if (!ui || !ui.manager) return;

    const slot = getManagerSlot();
    if (slot) {
      ui.manager.classList.add('cookie-consent-manager--inline');
      slot.appendChild(ui.manager);
      return;
    }

    ui.manager.classList.remove('cookie-consent-manager--inline');
  }

  function openPanel() {
    if (!ui || !ui.panel) return;
    if (ui.analytics) ui.analytics.checked = Boolean(consent.analytics);
    if (ui.marketing) ui.marketing.checked = Boolean(consent.marketing);
    ui.panel.hidden = false;
    ui.panel.classList.add('open');
    ui.panel.setAttribute('aria-hidden', 'false');
    // Enquanto o painel estiver aberto, não mostra o banner por trás.
    setBannerVisible(false);
    if (ui.backdrop) ui.backdrop.hidden = true;
    if (ui.closePanelBtn) ui.closePanelBtn.focus();
  }

  function closePanel(force = false) {
    if (!ui || !ui.panel) return;
    ui.panel.classList.remove('open');
    ui.panel.setAttribute('aria-hidden', 'true');
    ui.panel.hidden = true;

    // Se ainda não houve decisão final, volta para o banner principal.
    if (!force && !hasDecision()) {
      setBannerVisible(true);
      if (ui.backdrop) ui.backdrop.hidden = false;
    }
  }

  function refreshUi() {
    if (!ui) return;

    const decisionDone = hasDecision();
    const managerSlotExists = Boolean(getManagerSlot());
    ui.backdrop.hidden = decisionDone;
    setBannerVisible(!decisionDone);
    setManagerVisible(decisionDone && managerSlotExists);
    updateBodyLock();

    if (!decisionDone) {
      ui.panel.hidden = true;
      ui.panel.classList.remove('open');
      ui.panel.setAttribute('aria-hidden', 'true');
    }
  }

  function saveConsent(status, values) {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    const allowedStatus = new Set(['accepted_all', 'rejected_optional', 'custom']);
    const finalStatus = allowedStatus.has(normalizedStatus) ? normalizedStatus : 'custom';

    consent = {
      ...DEFAULT_CONSENT,
      ...consent,
      status: finalStatus,
      necessary: true,
      analytics: Boolean(values?.analytics),
      marketing: Boolean(values?.marketing),
      updatedAt: new Date().toISOString(),
    };

    persistConsent(consent);
    refreshUi();
    closePanel(true);
    activateDeferredScripts();
    emitConsentChanged();
  }

  function activateDeferredScripts() {
    const deferred = document.querySelectorAll('script[type="text/plain"][data-consent]:not([data-consent-activated])');

    deferred.forEach((placeholder) => {
      const category = String(placeholder.getAttribute('data-consent') || '').trim().toLowerCase();
      if (!hasCategoryConsent(category)) return;

      const script = document.createElement('script');
      const desiredType = placeholder.getAttribute('data-script-type');
      script.type = desiredType || 'text/javascript';

      for (const attr of Array.from(placeholder.attributes)) {
        const key = String(attr.name || '');
        if (!key || key === 'type' || key === 'data-consent' || key === 'data-script-type' || key === 'data-consent-activated') {
          continue;
        }
        script.setAttribute(key, attr.value);
      }

      if (placeholder.src) {
        script.src = placeholder.src;
      } else {
        script.textContent = placeholder.textContent || '';
      }

      placeholder.setAttribute('data-consent-activated', '1');
      placeholder.replaceWith(script);
    });
  }

  function buildUi() {
    if (document.getElementById('cookieConsentRoot')) {
      return {
        root: document.getElementById('cookieConsentRoot'),
        backdrop: document.getElementById('cookieConsentBackdrop'),
        banner: document.getElementById('cookieConsentBanner'),
        manager: document.getElementById('cookieConsentManagerBtn'),
        panel: document.getElementById('cookieConsentPanel'),
        analytics: document.getElementById('cookieConsentAnalytics'),
        marketing: document.getElementById('cookieConsentMarketing'),
        closePanelBtn: document.getElementById('cookieConsentClosePanel'),
      };
    }

    const root = document.createElement('div');
    root.id = 'cookieConsentRoot';
    root.innerHTML = `
      <div class="cookie-consent-backdrop" id="cookieConsentBackdrop" hidden></div>

      <section class="cookie-consent" id="cookieConsentBanner" role="dialog" aria-live="polite" aria-label="Consentimento de cookies" hidden>
        <div class="cookie-consent__bar">
          <div class="cookie-consent__copy">
            <h2>Privacidade e cookies</h2>
            <p>
              Usamos cookies essenciais para login, seguranca e funcionamento da plataforma.
              Cookies opcionais (analiticos e marketing) so serao ativados com seu consentimento.
            </p>
          </div>
          <div class="cookie-consent__actions">
            <button class="cookie-btn cookie-btn--primary" type="button" id="cookieConsentAcceptAll">Aceitar todos</button>
            <button class="cookie-btn cookie-btn--secondary" type="button" id="cookieConsentRejectOptional">Recusar opcionais</button>
            <button class="cookie-btn cookie-btn--ghost" type="button" id="cookieConsentManage">Preferencias</button>
          </div>
        </div>
      </section>

      <button class="cookie-consent-manager" id="cookieConsentManagerBtn" type="button" aria-label="Gerenciar cookies" hidden>
        Cookies
      </button>

      <div class="cookie-consent-panel" id="cookieConsentPanel" role="dialog" aria-modal="true" aria-label="Preferencias de cookies" aria-hidden="true" hidden>
        <div class="cookie-consent-panel__card">
          <div class="cookie-consent-panel__head">
            <h3>Preferencias de cookies</h3>
            <button type="button" class="cookie-consent-panel__close" id="cookieConsentClosePanel" aria-label="Fechar painel de cookies">×</button>
          </div>

          <p class="cookie-consent-panel__intro">
            Voce pode escolher quais categorias opcionais quer habilitar. Os cookies essenciais permanecem ativos porque sao necessarios para autenticar sua sessao e manter a seguranca.
          </p>

          <div class="cookie-consent-row cookie-consent-row--locked">
            <div>
              <strong>Essenciais (obrigatorios)</strong>
              <span>Login, seguranca e funcionamento basico do portal.</span>
            </div>
            <label class="cookie-switch">
              <input type="checkbox" checked disabled />
              <span></span>
            </label>
          </div>

          <div class="cookie-consent-row">
            <div>
              <strong>Analiticos</strong>
              <span>Medem desempenho e uso para melhorar a experiencia.</span>
            </div>
            <label class="cookie-switch">
              <input type="checkbox" id="cookieConsentAnalytics" />
              <span></span>
            </label>
          </div>

          <div class="cookie-consent-row">
            <div>
              <strong>Marketing</strong>
              <span>Personalizacao de campanhas e comunicacoes promocionais.</span>
            </div>
            <label class="cookie-switch">
              <input type="checkbox" id="cookieConsentMarketing" />
              <span></span>
            </label>
          </div>

          <details class="cookie-consent-legal">
            <summary>Informacoes de privacidade (LGPD)</summary>
            <div>
              <p>Finalidades: autenticacao, seguranca da conta, melhoria do produto e comunicacao institucional.</p>
              <p>Base legal: execucao de contrato/interesse legitimo para essenciais e consentimento para opcionais.</p>
              <p>Contato para privacidade e exercicio de direitos: <a href="mailto:privacidade@atimus.agr.br">privacidade@atimus.agr.br</a>.</p>
              <p>Recomendacao: validar este texto com o juridico da empresa antes da publicacao final.</p>
            </div>
          </details>

          <div class="cookie-consent-panel__actions">
            <button class="cookie-btn cookie-btn--secondary" type="button" id="cookieConsentSaveCustom">Salvar preferencias</button>
            <button class="cookie-btn cookie-btn--ghost" type="button" id="cookieConsentAcceptInPanel">Aceitar todos</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(root);

    return {
      root,
      backdrop: document.getElementById('cookieConsentBackdrop'),
      banner: document.getElementById('cookieConsentBanner'),
      manager: document.getElementById('cookieConsentManagerBtn'),
      panel: document.getElementById('cookieConsentPanel'),
      analytics: document.getElementById('cookieConsentAnalytics'),
      marketing: document.getElementById('cookieConsentMarketing'),
      closePanelBtn: document.getElementById('cookieConsentClosePanel'),
    };
  }

  function bindEvents() {
    if (!ui) return;

    const acceptAllBtns = [
      document.getElementById('cookieConsentAcceptAll'),
      document.getElementById('cookieConsentAcceptInPanel'),
    ].filter(Boolean);

    acceptAllBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        saveConsent('accepted_all', { analytics: true, marketing: true });
      });
    });

    const rejectOptionalBtn = document.getElementById('cookieConsentRejectOptional');
    if (rejectOptionalBtn) {
      rejectOptionalBtn.addEventListener('click', () => {
        saveConsent('rejected_optional', { analytics: false, marketing: false });
      });
    }

    const manageBtn = document.getElementById('cookieConsentManage');
    if (manageBtn) {
      manageBtn.addEventListener('click', openPanel);
    }

    if (ui.manager) {
      ui.manager.addEventListener('click', openPanel);
    }

    const saveCustomBtn = document.getElementById('cookieConsentSaveCustom');
    if (saveCustomBtn) {
      saveCustomBtn.addEventListener('click', () => {
        saveConsent('custom', {
          analytics: Boolean(ui.analytics?.checked),
          marketing: Boolean(ui.marketing?.checked),
        });
      });
    }

    if (ui.closePanelBtn) {
      ui.closePanelBtn.addEventListener('click', () => closePanel(false));
    }

    if (ui.panel) {
      ui.panel.addEventListener('click', (ev) => {
        const card = ev.target.closest('.cookie-consent-panel__card');
        if (card) return;
        closePanel(false);
      });
    }

    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      if (!ui.panel || ui.panel.hidden) return;
      closePanel(false);
    });
  }

  function boot() {
    ui = buildUi();
    placeManagerButton();
    bindEvents();
    refreshUi();
    activateDeferredScripts();
    emitConsentChanged();
  }

  window.AthosConsent = {
    getState() {
      return { ...consent };
    },
    hasConsent(category) {
      return hasCategoryConsent(String(category || '').trim().toLowerCase());
    },
    openPreferences() {
      openPanel();
    },
    onChange(callback) {
      if (typeof callback !== 'function') return () => {};

      const handler = (event) => {
        try {
          callback(event?.detail ? { ...event.detail } : { ...consent });
        } catch (_) {}
      };

      window.addEventListener('athos:cookie-consent-updated', handler);
      return () => window.removeEventListener('athos:cookie-consent-updated', handler);
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
