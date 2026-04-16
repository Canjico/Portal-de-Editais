(function () {
  const STORAGE_KEY = 'athos_theme_preference';
  const VALID = new Set(['light', 'dark', 'system']);
  const DARK_QUERY = '(prefers-color-scheme: dark)';
  const DARK_MODE_LOGO_URL = 'https://atimus.agr.br/athos/editais/assets/img/icons/athoslp.png';
  const THEME_LOGO_SELECTOR = 'img.sidebar-logo, img.topbar-mobile-logo, .share-brand img';
  let systemListenerBound = false;

  function normalizePreference(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'auto') return 'system';
    return VALID.has(raw) ? raw : 'light';
  }

  function readStoredPreferenceRaw() {
    try {
      return String(localStorage.getItem(STORAGE_KEY) || '').trim().toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function hasStoredPreference() {
    const raw = readStoredPreferenceRaw();
    return raw === 'auto' || VALID.has(raw);
  }

  function resolveProfilePreference(preferenceFromApi) {
    const pref = normalizePreference(preferenceFromApi);
    if (pref !== 'system') return pref;
    if (hasStoredPreference()) {
      return normalizePreference(readStoredPreferenceRaw());
    }
    return 'light';
  }

  function readStoredPreference() {
    try {
      return normalizePreference(localStorage.getItem(STORAGE_KEY));
    } catch (_) {
      return 'light';
    }
  }

  function persistPreference(preference) {
    try {
      localStorage.setItem(STORAGE_KEY, normalizePreference(preference));
    } catch (_) {}
  }

  function getSystemTheme() {
    try {
      if (window.matchMedia && window.matchMedia(DARK_QUERY).matches) return 'dark';
    } catch (_) {}
    return 'light';
  }

  function resolveEffectiveTheme(preference) {
    const pref = normalizePreference(preference);
    return pref === 'system' ? getSystemTheme() : pref;
  }

  function updateMetaThemeColor(effectiveTheme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    meta.setAttribute('content', effectiveTheme === 'dark' ? '#0f172a' : '#0b7a67');
  }

  function updateThemeLogos(effectiveTheme) {
    const logos = document.querySelectorAll(THEME_LOGO_SELECTOR);
    if (!logos.length) return;

    logos.forEach((node) => {
      if (!(node instanceof HTMLImageElement)) return;

      if (!node.dataset.lightLogo) {
        node.dataset.lightLogo = node.getAttribute('src') || '';
      }

      if (!node.dataset.darkLogo) {
        node.dataset.darkLogo = DARK_MODE_LOGO_URL;
      }

      const nextSrc = effectiveTheme === 'dark' ? node.dataset.darkLogo : node.dataset.lightLogo;
      if (nextSrc && node.getAttribute('src') !== nextSrc) {
        node.setAttribute('src', nextSrc);
      }
    });
  }

  function applyTheme(preference, options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const pref = normalizePreference(preference);
    const effective = resolveEffectiveTheme(pref);
    const root = document.documentElement;

    root.setAttribute('data-theme-preference', pref);
    root.setAttribute('data-theme', effective);
    updateMetaThemeColor(effective);
    updateThemeLogos(effective);

    if (opts.persist !== false) {
      persistPreference(pref);
    }

    if (opts.emit !== false) {
      try {
        window.dispatchEvent(
          new CustomEvent('athos:theme-change', {
            detail: { preference: pref, effectiveTheme: effective },
          })
        );
      } catch (_) {}
    }

    return { preference: pref, effectiveTheme: effective };
  }

  function bindSystemListener() {
    if (systemListenerBound || !window.matchMedia) return;
    const media = window.matchMedia(DARK_QUERY);
    if (!media || typeof media.addEventListener !== 'function') return;

    media.addEventListener('change', () => {
      const currentPref = normalizePreference(
        document.documentElement.getAttribute('data-theme-preference') || readStoredPreference()
      );
      if (currentPref !== 'system') return;
      applyTheme(currentPref, { persist: false, emit: true });
    });

    systemListenerBound = true;
  }

  function bootstrap(preferenceOverride) {
    const inlinePref = normalizePreference(document.documentElement.getAttribute('data-theme-preference'));
    const preferred = normalizePreference(preferenceOverride || inlinePref || readStoredPreference());
    const applied = applyTheme(preferred, { persist: false, emit: false });
    bindSystemListener();
    return applied;
  }

  const api = {
    STORAGE_KEY,
    normalizePreference,
    readStoredPreference,
    resolveProfilePreference,
    resolveEffectiveTheme,
    applyTheme,
    setPreference(preference, options = {}) {
      return applyTheme(preference, options);
    },
    bootstrap,
  };

  window.AthosTheme = api;
  bootstrap();
})();
