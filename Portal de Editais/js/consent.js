(() => {
  'use strict';

  const STORAGE_KEY = 'athos_cookie_consent_v1';
  const COOKIE_KEY = 'athos_cookie_consent_v1';
  const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180 dias
  const TERMS_URL = './termos-de-uso';
  const PRIVACY_URL = './politica-de-privacidade';

  const DEFAULT_CONSENT = Object.freeze({
    version: 1,
    status: 'pending',
    necessary: true,
    analytics: false,
    marketing: false,
    personalization: false,
    updatedAt: null,
  });

  let consent = loadConsent();
  let ui = null;

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function safeConsentUrl(value) {
    const rawInput = String(value ?? '');
    if (/[\u0000-\u001F\u007F]/.test(rawInput)) return '';

    const raw = rawInput.trim();
    if (!raw || raw !== rawInput || /\s/.test(raw) || /[<>"'`\\]/.test(raw)) return '';

    const schemeMatch = raw.match(/^([a-z][a-z0-9+.-]*):/i);
    if (schemeMatch) {
      const scheme = schemeMatch[1].toLowerCase();
      if (scheme !== 'http' && scheme !== 'https') return '';
      if (!/^https?:\/\//i.test(raw)) return '';
      try {
        const parsed = new URL(raw);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? raw : '';
      } catch (_) {
        return '';
      }
    }

    if (raw.startsWith('//') || raw.startsWith('/\\')) return '';
    if (raw.startsWith('/')) return raw;
    if (raw.startsWith('./') && raw.length > 2) return raw;
    if (raw.startsWith('../') || raw === '.' || raw === '..' || raw.startsWith('#') || raw.startsWith('?')) return '';
    if (raw.includes(':')) return '';

    return /^[A-Za-z0-9][A-Za-z0-9._~!$&()*+,;=@/%?-]*$/.test(raw) ? raw : '';
  }

  function setSafeHref(anchor, value) {
    const safeUrl = safeConsentUrl(value);
    if (safeUrl) {
      anchor.setAttribute('href', safeUrl);
      if (typeof anchor.removeAttribute === 'function') {
        anchor.removeAttribute('aria-disabled');
      }
      anchor.tabIndex = 0;
      return safeUrl;
    }

    if (typeof anchor.removeAttribute === 'function') {
      anchor.removeAttribute('href');
    }
    anchor.setAttribute('aria-disabled', 'true');
    anchor.tabIndex = -1;
    return '';
  }

  function appendChildren(parent, children = []) {
    const items = Array.isArray(children) ? children.flat() : [children];
    items.forEach((child) => {
      if (child === null || child === undefined) return;
      if (typeof child === 'string' || typeof child === 'number') {
        parent.appendChild(document.createTextNode(String(child)));
        return;
      }
      parent.appendChild(child);
    });
    return parent;
  }

  function createNode(tagName, options = {}, children = []) {
    const node = document.createElement(tagName);

    if (options.id) node.id = String(options.id);
    if (options.className) node.className = String(options.className);
    if (options.text !== undefined) node.textContent = String(options.text ?? '');
    if (options.type) node.type = String(options.type);
    if (options.hidden !== undefined) node.hidden = Boolean(options.hidden);
    if (options.checked !== undefined) node.checked = Boolean(options.checked);
    if (options.disabled !== undefined) node.disabled = Boolean(options.disabled);

    Object.entries(options.attrs || {}).forEach(([name, value]) => {
      node.setAttribute(name, String(value));
    });

    return appendChildren(node, children);
  }

  function createButton(id, className, text, attrs = {}) {
    return createNode('button', {
      id,
      className,
      text,
      type: 'button',
      attrs,
    });
  }

  function createSafeAnchor(text, href) {
    const anchor = createNode('a', { text });
    setSafeHref(anchor, href);
    return anchor;
  }

  function createSwitch(inputId, options = {}) {
    const inputOptions = {
      type: 'checkbox',
      checked: Boolean(options.checked),
      disabled: Boolean(options.disabled),
    };
    if (inputId) inputOptions.id = inputId;

    return createNode('label', { className: 'cookie-switch' }, [
      createNode('input', inputOptions),
      createNode('span'),
    ]);
  }

  function createConsentRow(title, description, inputId, options = {}) {
    const rowClass = options.locked
      ? 'cookie-consent-row cookie-consent-row--locked'
      : 'cookie-consent-row';

    return createNode('div', { className: rowClass }, [
      createNode('div', {}, [
        createNode('strong', { text: title }),
        createNode('span', { text: description }),
      ]),
      createSwitch(inputId, options),
    ]);
  }

  function createLegalParagraph(children) {
    return createNode('p', {}, children);
  }

  function neutralizeBlockedScriptPlaceholder(placeholder) {
    if (typeof placeholder.removeAttribute === 'function') {
      placeholder.removeAttribute('src');
      Array.from(placeholder.attributes || []).forEach((attr) => {
        const key = String(attr.name || '').toLowerCase();
        if (key.startsWith('on')) placeholder.removeAttribute(attr.name);
      });
    }
    placeholder.setAttribute('data-consent-activated', 'blocked');
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

    const normalizedStatus = allowedStatus.has(status) ? status : DEFAULT_CONSENT.status;

    return {
      version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : DEFAULT_CONSENT.version,
      status: normalizedStatus,
      necessary: true,
      analytics: Object.prototype.hasOwnProperty.call(raw, 'analytics')
        ? Boolean(raw.analytics)
        : normalizedStatus === 'accepted_all',
      marketing: Object.prototype.hasOwnProperty.call(raw, 'marketing')
        ? Boolean(raw.marketing)
        : normalizedStatus === 'accepted_all',
      personalization: Object.prototype.hasOwnProperty.call(raw, 'personalization')
        ? Boolean(raw.personalization)
        : normalizedStatus === 'accepted_all',
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

  function deleteCookie(name) {
    if (!name) return;
    try {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
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
    const normalized = String(category || '').trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === 'necessary') return true;
    if (normalized === 'analytics') return Boolean(consent.analytics);
    if (normalized === 'marketing') return Boolean(consent.marketing);
    if (normalized === 'personalization') return Boolean(consent.personalization);
    return false;
  }

  function pruneOptionalCookies() {
    if (!consent.analytics) {
      ['_ga', '_gid', '_gat'].forEach(deleteCookie);
      try {
        const dynamicGaCookies = (document.cookie ? document.cookie.split('; ') : [])
          .map((item) => item.split('=')[0])
          .filter((name) => String(name || '').startsWith('_ga_'));
        dynamicGaCookies.forEach(deleteCookie);
      } catch (_) {}
    }

    if (!consent.marketing) {
      ['_fbp', '_fbc', 'hubspotutk'].forEach(deleteCookie);
    }
  }

  function applyRuntimeConsentState() {
    const root = document.documentElement;
    if (!root) return;

    root.dataset.consentStatus = String(consent.status || 'pending');
    root.dataset.consentAnalytics = consent.analytics ? 'granted' : 'denied';
    root.dataset.consentMarketing = consent.marketing ? 'granted' : 'denied';
    root.dataset.consentPersonalization = consent.personalization ? 'granted' : 'denied';
  }

  function removeLegacyFloatingManagers() {
    const selectors = [
      '.cookie-consent-manager',
      '#cookieConsentManager',
      '[data-cookie-consent-manager]',
    ];

    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => {
        try {
          node.remove();
        } catch (_) {}
      });
    });
  }

  function emitConsentChanged() {
    try {
      window.dispatchEvent(new CustomEvent('athos:cookie-consent-updated', { detail: { ...consent } }));
    } catch (_) {}
  }

  function updateBodyLock() {
    const panelOpen = Boolean(ui?.panel && !ui.panel.hidden);
    const bannerOpen = Boolean(ui?.banner && !ui.banner.hidden);
    document.body.classList.toggle('cookie-consent-required', panelOpen || bannerOpen);
  }

  function setBannerVisible(show) {
    if (!ui) return;
    ui.banner.hidden = !show;
  }

  function openPanel() {
    if (!ui || !ui.panel) return;

    if (ui.analytics) ui.analytics.checked = Boolean(consent.analytics);
    if (ui.marketing) ui.marketing.checked = Boolean(consent.marketing);
    if (ui.personalization) ui.personalization.checked = Boolean(consent.personalization);

    ui.panel.hidden = false;
    ui.panel.classList.add('open');
    ui.panel.setAttribute('aria-hidden', 'false');

    setBannerVisible(false);
    if (ui.backdrop) ui.backdrop.hidden = false;

    updateBodyLock();
    if (ui.closePanelBtn) ui.closePanelBtn.focus();
  }

  function closePanel(force = false) {
    if (!ui || !ui.panel) return;

    ui.panel.classList.remove('open');
    ui.panel.setAttribute('aria-hidden', 'true');
    ui.panel.hidden = true;

    if (!force && !hasDecision()) {
      setBannerVisible(true);
      if (ui.backdrop) ui.backdrop.hidden = false;
    } else if (ui.backdrop) {
      ui.backdrop.hidden = hasDecision();
    }

    updateBodyLock();
  }

  function refreshUi() {
    if (!ui) return;

    const decisionDone = hasDecision();
    ui.backdrop.hidden = decisionDone;
    setBannerVisible(!decisionDone);
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
      personalization: Boolean(values?.personalization),
      updatedAt: new Date().toISOString(),
    };

    persistConsent(consent);
    applyRuntimeConsentState();
    pruneOptionalCookies();
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

      const rawSrc = placeholder.getAttribute('src') || '';
      const safeSrc = rawSrc ? safeConsentUrl(rawSrc) : '';
      if (rawSrc && !safeSrc) {
        neutralizeBlockedScriptPlaceholder(placeholder);
        return;
      }

      const script = document.createElement('script');
      const desiredType = placeholder.getAttribute('data-script-type');
      script.type = desiredType || 'text/javascript';

      for (const attr of Array.from(placeholder.attributes)) {
        const key = String(attr.name || '');
        const normalizedKey = key.toLowerCase();
        if (
          !key
          || normalizedKey === 'type'
          || normalizedKey === 'src'
          || normalizedKey === 'data-consent'
          || normalizedKey === 'data-script-type'
          || normalizedKey === 'data-consent-activated'
          || normalizedKey.startsWith('on')
        ) {
          continue;
        }
        script.setAttribute(key, attr.value);
      }

      if (safeSrc) {
        script.src = safeSrc;
      } else {
        script.textContent = placeholder.textContent || '';
      }

      placeholder.setAttribute('data-consent-activated', '1');
      placeholder.replaceWith(script);
    });
  }

  function buildUi() {
    if (document.getElementById('cookieConsentRoot')) {
      removeLegacyFloatingManagers();
      return {
        root: document.getElementById('cookieConsentRoot'),
        backdrop: document.getElementById('cookieConsentBackdrop'),
        banner: document.getElementById('cookieConsentBanner'),
        panel: document.getElementById('cookieConsentPanel'),
        analytics: document.getElementById('cookieConsentAnalytics'),
        marketing: document.getElementById('cookieConsentMarketing'),
        personalization: document.getElementById('cookieConsentPersonalization'),
        closePanelBtn: document.getElementById('cookieConsentClosePanel'),
      };
    }

    const root = document.createElement('div');
    root.id = 'cookieConsentRoot';
    const backdrop = createNode('div', {
      id: 'cookieConsentBackdrop',
      className: 'cookie-consent-backdrop',
      hidden: true,
    });

    const banner = createNode('section', {
      id: 'cookieConsentBanner',
      className: 'cookie-consent',
      hidden: true,
      attrs: {
        role: 'dialog',
        'aria-live': 'polite',
        'aria-label': 'Consentimento de cookies',
      },
    }, [
      createNode('div', { className: 'cookie-consent__bar' }, [
        createNode('div', { className: 'cookie-consent__copy' }, [
          createNode('h2', { text: 'Privacidade e cookies' }),
          createNode('p', {
            text: 'Usamos cookies essenciais para login, segurança e funcionamento da plataforma. Cookies opcionais (analíticos, marketing e personalização) só serão ativados com seu consentimento.',
          }),
        ]),
        createNode('div', { className: 'cookie-consent__actions' }, [
          createButton('cookieConsentAcceptAll', 'cookie-btn cookie-btn--primary', 'Aceitar todos'),
          createButton('cookieConsentManage', 'cookie-btn cookie-btn--secondary', 'Preferências'),
          createButton('cookieConsentRejectOptional', 'cookie-btn cookie-btn--ghost', 'Recusar opcionais'),
        ]),
      ]),
    ]);

    const contactLink = createNode('a', { text: 'privacidade@atimus.agr.br' });
    contactLink.setAttribute('href', 'mailto:privacidade@atimus.agr.br');

    const panel = createNode('div', {
      id: 'cookieConsentPanel',
      className: 'cookie-consent-panel',
      hidden: true,
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Preferências de cookies',
        'aria-hidden': 'true',
      },
    }, [
      createNode('div', { className: 'cookie-consent-panel__card' }, [
        createNode('div', { className: 'cookie-consent-panel__head' }, [
          createNode('h3', { text: 'Preferências de cookies' }),
          createButton('cookieConsentClosePanel', 'cookie-consent-panel__close', '×', {
            'aria-label': 'Fechar painel de cookies',
          }),
        ]),

        createNode('p', {
          className: 'cookie-consent-panel__intro',
          text: 'Você pode escolher quais categorias opcionais quer habilitar. Os cookies essenciais permanecem ativos porque são necessários para autenticar sua sessão e manter a segurança.',
        }),

        createConsentRow(
          'Essenciais (obrigatórios)',
          'Login, segurança e funcionamento básico do portal.',
          '',
          { checked: true, disabled: true, locked: true }
        ),
        createConsentRow(
          'Analíticos',
          'Medem desempenho e uso para melhorar a experiência.',
          'cookieConsentAnalytics'
        ),
        createConsentRow(
          'Marketing',
          'Personalização de campanhas e comunicações promocionais.',
          'cookieConsentMarketing'
        ),
        createConsentRow(
          'Personalização',
          'Adapta recursos opcionais, como chat/widget externo e preferências de uso.',
          'cookieConsentPersonalization'
        ),

        createNode('details', { className: 'cookie-consent-legal' }, [
          createNode('summary', { text: 'Informações de privacidade (LGPD/GDPR)' }),
          createNode('div', {}, [
            createLegalParagraph('Finalidades: autenticação, segurança da conta, melhoria do produto e comunicação institucional.'),
            createLegalParagraph('Base legal: execução de contrato/interesse legítimo para essenciais e consentimento para opcionais.'),
            createLegalParagraph([
              'Contato para privacidade e exercício de direitos: ',
              contactLink,
              '.',
            ]),
            createLegalParagraph([
              'Documentos oficiais: ',
              createSafeAnchor('Termos de Uso', TERMS_URL),
              ' e ',
              createSafeAnchor('Política de Privacidade', PRIVACY_URL),
              '.',
            ]),
            createLegalParagraph('Recomendação: validar este texto com o jurídico da empresa antes da publicação final.'),
          ]),
        ]),

        createNode('div', { className: 'cookie-consent-panel__actions' }, [
          createButton('cookieConsentSaveCustom', 'cookie-btn cookie-btn--primary', 'Salvar preferências'),
          createButton('cookieConsentAcceptInPanel', 'cookie-btn cookie-btn--secondary', 'Aceitar todos'),
          createButton('cookieConsentRejectInPanel', 'cookie-btn cookie-btn--ghost', 'Recusar opcionais'),
        ]),
      ]),
    ]);

    root.appendChild(backdrop);
    root.appendChild(banner);
    root.appendChild(panel);

    document.body.appendChild(root);

    return {
      root,
      backdrop: document.getElementById('cookieConsentBackdrop'),
      banner: document.getElementById('cookieConsentBanner'),
      panel: document.getElementById('cookieConsentPanel'),
      analytics: document.getElementById('cookieConsentAnalytics'),
      marketing: document.getElementById('cookieConsentMarketing'),
      personalization: document.getElementById('cookieConsentPersonalization'),
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
        saveConsent('accepted_all', { analytics: true, marketing: true, personalization: true });
      });
    });

    const rejectOptionalBtns = [
      document.getElementById('cookieConsentRejectOptional'),
      document.getElementById('cookieConsentRejectInPanel'),
    ].filter(Boolean);

    rejectOptionalBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        saveConsent('rejected_optional', { analytics: false, marketing: false, personalization: false });
      });
    });

    const manageBtn = document.getElementById('cookieConsentManage');
    if (manageBtn) {
      manageBtn.addEventListener('click', openPanel);
    }

    const saveCustomBtn = document.getElementById('cookieConsentSaveCustom');
    if (saveCustomBtn) {
      saveCustomBtn.addEventListener('click', () => {
        saveConsent('custom', {
          analytics: Boolean(ui.analytics?.checked),
          marketing: Boolean(ui.marketing?.checked),
          personalization: Boolean(ui.personalization?.checked),
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
    removeLegacyFloatingManagers();
    ui = buildUi();
    bindEvents();
    applyRuntimeConsentState();
    pruneOptionalCookies();
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
    acceptAll() {
      saveConsent('accepted_all', { analytics: true, marketing: true, personalization: true });
      return { ...consent };
    },
    rejectOptional() {
      saveConsent('rejected_optional', { analytics: false, marketing: false, personalization: false });
      return { ...consent };
    },
    setPreferences(values = {}, status = 'custom') {
      saveConsent(status, {
        analytics: Boolean(values.analytics),
        marketing: Boolean(values.marketing),
        personalization: Boolean(values.personalization),
      });
      return { ...consent };
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
