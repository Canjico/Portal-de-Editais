/* =========================================================
   Athos / Atimus - Perfil
   ========================================================= */

import {
  API_BASE,
  LOGIN_URL,
  bootstrapAuthFromUrl,
  buildLoginUrlWithNext,
  apiFetch,
  apiFetchJson,
} from './auth.js';
import {
  normalizeTextValue,
  normalizeDigits,
  normalizeFormForComparison,
  serializeComparableForm,
  isComparableFormDirty,
  resolveDirtyTrackingState,
} from './perfil-dirty-state.js';

const sidebarToggle = document.getElementById('sidebarToggle');
const appSidebar = document.getElementById('appSidebar');
const logoutIconBtn = document.getElementById('logoutIconBtn');
const mobileSidebarBtn = document.getElementById('mobileSidebarBtn');
const mobileSidebarBackdrop = document.getElementById('mobileSidebarBackdrop');
const profileSaveBanner = document.getElementById('profileSaveBanner');
const saveAllProfileBtn = document.getElementById('saveAllProfileBtn');
const securityChangePasswordBtn = document.getElementById('securityChangePasswordBtn');
const securityLogoutOthersBtn = document.getElementById('securityLogoutOthersBtn');
const securityRefreshSessionsBtn = document.getElementById('securityRefreshSessionsBtn');
const security2faEnable = document.getElementById('security2faEnable');
const securityDeleteAccountBtn = document.getElementById('securityDeleteAccountBtn');
const accountDeleteOverlay = document.getElementById('accountDeleteOverlay');
const accountDeleteCancelBtn = document.getElementById('accountDeleteCancelBtn');
const accountDeleteConfirmBtn = document.getElementById('accountDeleteConfirmBtn');
const customSelectModels = [];
let customSelectGlobalHandlersBound = false;
let baselineForm = null;
let baselineFormHash = '';
let hasUserInteracted = false;
let isHydratingProfile = false;

const DIRTY_USER_HINT_ATTR = 'athosDirtyUserInitiated';

const profileCookieAnalytics = document.getElementById('profileCookieAnalytics');
const profileCookieMarketing = document.getElementById('profileCookieMarketing');
const profileCookiePersonalization = document.getElementById('profileCookiePersonalization');
const profileCookieSaveBtn = document.getElementById('profileCookieSaveBtn');
const profileCookieRejectBtn = document.getElementById('profileCookieRejectBtn');
const profileCookieStatus = document.getElementById('profileCookieStatus');

const TRACKED_INPUT_IDS = [
  'nomeCompleto',
  'email',
  'telefone',
  'cargo',
  'nomeEmpresa',
  'cnpj',
  'estadoUf',
  'setorEmpresa',
  'setorAtuacao',
  'prefTheme',
];

const TRACKED_CHECKBOX_IDS = [
  'prefEditais',
  'prefPrazo',
  'prefRelatorio',
  'prefSistema',
];

const THEME_PREFERENCES = new Set(['system', 'light', 'dark']);
const UF_CODES = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

document.addEventListener('DOMContentLoaded', init);

function clearTransientSelection(triggerEl = null) {
  try {
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount) sel.removeAllRanges();
  } catch (_) {}

  if (window.matchMedia('(pointer: coarse)').matches) {
    try { triggerEl?.blur?.(); } catch (_) {}
  }
}

async function init() {
  try {
    bootstrapAuthFromUrl();
    window.AthosTheme?.bootstrap?.();
    const me = await checkAuth();
    if (!me) return;

    setupUI();
    setupCookiePreferences();
    if (profileSaveBanner) profileSaveBanner.hidden = true;
    await loadProfileFromApi();
    bindDirtyTracking();
    syncBaselineSnapshot({ resetInteraction: true });
    updateDirtyState();
    setupSecurityActions();
    closeDeleteAccountModal();
  } finally {
    markAppReady();
  }
}

async function checkAuth() {
  try {
    const { res, data } = await apiFetchJson('/cliente/me', { method: 'GET' });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        window.location.href = buildLoginUrlWithNext();
        return null;
      }
      return {};
    }

    if (data && typeof data === 'object' && 'logado' in data && !data.logado) {
      window.location.href = buildLoginUrlWithNext();
      return null;
    }

    if (window.AthosTheme?.setPreference && data?.themePreference) {
      window.AthosTheme.setPreference(data.themePreference);
    }

    const nome = data?.nome || data?.nome_completo || data?.user?.nome || data?.usuario?.nome;
    const email = data?.email || data?.user?.email || data?.usuario?.email;
    const telefone = data?.celular || data?.telefone || '';
    const cnpj = data?.cnpj || '';
    const estadoUf = normalizeUf(data?.estadoUf || '');

    if (nome) {
      setText('sidebarUserName', nome);
      setText('profileName', nome);
      setValue('nomeCompleto', nome);
      setInitials('sidebarAvatar', nome);
      setInitials('profileAvatar', nome);
    }
    if (email) {
      setText('sidebarUserEmail', email);
      setText('profileEmail', email);
      setValue('email', email);
    }
    if (telefone) setValue('telefone', telefone);
    if (cnpj) setValue('cnpj', cnpj);
    if (estadoUf) setValue('estadoUf', estadoUf);

    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    console.error('Erro na verificação de autenticação:', e);

    if (e instanceof TypeError) return {};

    window.location.href = buildLoginUrlWithNext();
    return null;
  }
}

function setupUI() {
  if (appSidebar && window.matchMedia('(max-width: 980px)').matches) {
    appSidebar.classList.remove('mobile-open');
    appSidebar.classList.remove('collapsed');
  }

  if (sidebarToggle && appSidebar) {
    sidebarToggle.addEventListener('click', () => {
      if (window.matchMedia('(max-width: 980px)').matches) {
        closeSidebarMobile();
        return;
      }
      appSidebar.classList.toggle('collapsed');
    });
  }

  if (mobileSidebarBtn && appSidebar) {
    mobileSidebarBtn.addEventListener('click', () => {
      if (appSidebar.classList.contains('mobile-open')) {
        closeSidebarMobile();
      } else {
        openSidebarMobile();
      }
    });
  }

  if (mobileSidebarBackdrop) {
    mobileSidebarBackdrop.addEventListener('click', () => closeSidebarMobile());
  }

  if (appSidebar) {
    appSidebar.querySelectorAll('.sidebar-nav a').forEach((link) => {
      link.addEventListener('click', () => {
        clearTransientSelection(link);
        if (window.matchMedia('(max-width: 980px)').matches) {
          closeSidebarMobile();
        }
      });
    });
  }

  window.addEventListener('resize', () => {
    if (window.innerWidth > 980) {
      closeSidebarMobile();
      appSidebar?.classList.remove('mobile-open');
    }
  });

  setupCustomSelects();

  const prefTheme = document.getElementById('prefTheme');
  if (prefTheme && prefTheme.dataset.themeBound !== '1') {
    prefTheme.dataset.themeBound = '1';
    prefTheme.addEventListener('change', () => {
      const nextTheme = normalizeThemePreference(prefTheme.value);
      prefTheme.value = nextTheme;
      if (window.AthosTheme?.setPreference) {
        window.AthosTheme.setPreference(nextTheme);
      }
    });
  }

  const doLogout = async () => {
    const endpoints = [
      { url: API_BASE + '/logout', method: 'POST' },
      { url: API_BASE + '/auth/logout', method: 'POST' },
      { url: API_BASE + '/cliente/logout', method: 'POST' },
      { url: API_BASE + '/cliente/sair', method: 'POST' },
      { url: API_BASE + '/session/logout', method: 'POST' },
      { url: API_BASE + '/logout', method: 'GET' },
      { url: API_BASE + '/auth/logout', method: 'GET' },
      { url: API_BASE + '/cliente/logout', method: 'GET' },
      { url: API_BASE + '/cliente/sair', method: 'GET' },
      { url: API_BASE + '/session/logout', method: 'GET' },
    ];

    try {
      try {
        if (window.AthosPresence?.markOffline) {
          await window.AthosPresence.markOffline({ keepalive: true });
        }
      } catch (_) {}

      for (const ep of endpoints) {
        try {
          const r = await apiFetch(ep.url, { method: ep.method });
          if (r.ok) break;
        } catch (_) {}
      }
    } finally {
      try { window.dispatchEvent(new Event('athos:logout')); } catch (_) {}
      try { localStorage.removeItem('cliente_token'); } catch (_) {}
      try { sessionStorage.removeItem('cliente_token'); } catch (_) {}
      window.location.href = LOGIN_URL;
    }
  };

  if (logoutIconBtn) logoutIconBtn.addEventListener('click', doLogout);

  // Navegação interna do perfil (tabs)
  document.querySelectorAll('.profile-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      clearTransientSelection(btn);
      const target = btn.getAttribute('data-target');
      document.querySelectorAll('.profile-nav-item').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');

      document.querySelectorAll('.panel[role="tabpanel"]').forEach((p) => {
        const isTarget = p.id === target;
        p.toggleAttribute('hidden', !isTarget);
      });

      closeAllCustomSelects();

      document.querySelectorAll('.profile-nav-item').forEach((b) => {
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
    });
  });

  // Chips: remover
  const areas = document.getElementById('areasInteresse');
  if (areas) {
    areas.addEventListener('click', (e) => {
      const x = e.target.closest('.chip-x');
      if (!x) return;
      const chip = x.closest('.chip');
      if (chip && !chip.classList.contains('chip-add')) {
        chip.remove();
        updateDirtyState({ userInitiated: true });
      }
    });
  }

  // Chips: adicionar
  const addAreaBtn = document.getElementById('addAreaBtn');
  if (addAreaBtn) {
    addAreaBtn.addEventListener('click', () => {
      const name = prompt('Nome da nova área de interesse:');
      if (!name) return;
      const span = document.createElement('span');
      span.className = 'chip';
      span.innerHTML = `${escapeHtml(name)} <button type="button" class="chip-x" aria-label="Remover">&times;</button>`;
      addAreaBtn.before(span);
      updateDirtyState({ userInitiated: true });
    });
  }

  // Salvar no backend (SQL)
  const save = async (btn) => {
    const payload = collectForm();
    clearFieldValidationState();
    const errors = validateProfileForm(payload);
    if (errors.length > 0) {
      applyFieldValidation(errors);
      revealFieldForValidation(errors[0].field);
      toast(errors[0].message, 'error');
      return;
    }

    setButtonLoading(btn, true, 'Salvando...');

    try {
      const { res, data } = await apiFetchJson('/cliente/perfil', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          window.location.href = buildLoginUrlWithNext();
          return;
        }
        const msg = (data && typeof data === 'object' && (data.detail || data.msg))
          ? (data.detail || data.msg)
          : 'Não foi possível salvar o perfil.';
        throw new Error(msg);
      }

      fillProfileForm(data, { syncBaseline: true });
      toast('Perfil salvo com sucesso.', 'success');
    } catch (e) {
      console.error('Erro ao salvar perfil:', e);
      toast(e?.message || 'Não foi possível salvar o perfil.', 'error');
    } finally {
      setButtonLoading(btn, false);
    }
  };
  const saveDadosBtn = document.getElementById('saveDadosBtn');
  const saveEmpresaBtn = document.getElementById('saveEmpresaBtn');
  const savePrefsBtn = document.getElementById('savePrefsBtn');

  if (saveDadosBtn) saveDadosBtn.addEventListener('click', () => save(saveDadosBtn));
  if (saveEmpresaBtn) saveEmpresaBtn.addEventListener('click', () => save(saveEmpresaBtn));
  if (savePrefsBtn) savePrefsBtn.addEventListener('click', () => save(savePrefsBtn));
  if (saveAllProfileBtn) saveAllProfileBtn.addEventListener('click', () => save(saveAllProfileBtn));
}

function normalizeConsentStateForProfile(rawState) {
  const state = rawState && typeof rawState === 'object' ? rawState : {};
  return {
    analytics: Boolean(state.analytics),
    marketing: Boolean(state.marketing),
    personalization: Boolean(state.personalization),
  };
}

function syncCookieInputsFromConsent(rawState) {
  const consent = normalizeConsentStateForProfile(rawState);
  if (profileCookieAnalytics) profileCookieAnalytics.checked = consent.analytics;
  if (profileCookieMarketing) profileCookieMarketing.checked = consent.marketing;
  if (profileCookiePersonalization) profileCookiePersonalization.checked = consent.personalization;
}

function setCookieStatusMessage(message, tone = '') {
  if (!profileCookieStatus) return;
  profileCookieStatus.textContent = String(message || '').trim();
  profileCookieStatus.classList.toggle('is-success', tone === 'success');
  profileCookieStatus.classList.toggle('is-error', tone === 'error');
}

function setupCookiePreferences() {
  const hasCookieControls =
    profileCookieAnalytics &&
    profileCookieMarketing &&
    profileCookiePersonalization &&
    profileCookieSaveBtn &&
    profileCookieRejectBtn;

  if (!hasCookieControls) return;

  const consentApi = window.AthosConsent;
  if (!consentApi || typeof consentApi.getState !== 'function') {
    setCookieStatusMessage('Não foi possível carregar as preferências de cookies.', 'error');
    if (profileCookieSaveBtn) profileCookieSaveBtn.disabled = true;
    if (profileCookieRejectBtn) profileCookieRejectBtn.disabled = true;
    return;
  }

  syncCookieInputsFromConsent(consentApi.getState());
  setCookieStatusMessage('As preferências são aplicadas imediatamente após salvar.');

  if (typeof consentApi.onChange === 'function') {
    consentApi.onChange((nextState) => {
      syncCookieInputsFromConsent(nextState);
    });
  }

  if (profileCookieSaveBtn) {
    profileCookieSaveBtn.addEventListener('click', () => {
      const payload = {
        analytics: Boolean(profileCookieAnalytics?.checked),
        marketing: Boolean(profileCookieMarketing?.checked),
        personalization: Boolean(profileCookiePersonalization?.checked),
      };

      setButtonLoading(profileCookieSaveBtn, true, 'Salvando...');
      try {
        consentApi.setPreferences(payload, 'custom');
        setCookieStatusMessage('Preferências de cookies atualizadas.', 'success');
        toast('Preferências de cookies salvas.', 'success');
      } catch (err) {
        console.error('Erro ao salvar preferências de cookies:', err);
        setCookieStatusMessage('Não foi possível salvar as preferências de cookies.', 'error');
        toast('Não foi possível salvar as preferências de cookies.', 'error');
      } finally {
        setButtonLoading(profileCookieSaveBtn, false);
      }
    });
  }

  if (profileCookieRejectBtn) {
    profileCookieRejectBtn.addEventListener('click', () => {
      setButtonLoading(profileCookieRejectBtn, true, 'Aplicando...');
      try {
        consentApi.rejectOptional();
        syncCookieInputsFromConsent(consentApi.getState());
        setCookieStatusMessage('Cookies opcionais desativados.', 'success');
        toast('Cookies opcionais desativados.', 'success');
      } catch (err) {
        console.error('Erro ao recusar cookies opcionais:', err);
        setCookieStatusMessage('Não foi possível atualizar as preferências de cookies.', 'error');
        toast('Não foi possível atualizar as preferências de cookies.', 'error');
      } finally {
        setButtonLoading(profileCookieRejectBtn, false);
      }
    });
  }
}

function openSidebarMobile() {
  if (!appSidebar || !mobileSidebarBackdrop) return;
  appSidebar.classList.remove('collapsed');
  appSidebar.classList.add('mobile-open');
  mobileSidebarBackdrop.classList.add('active');
  mobileSidebarBackdrop.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeSidebarMobile() {
  if (!appSidebar || !mobileSidebarBackdrop) return;
  appSidebar.classList.remove('mobile-open');
  mobileSidebarBackdrop.classList.remove('active');
  mobileSidebarBackdrop.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function setupCustomSelects() {
  const selects = Array.from(document.querySelectorAll('.profile-right .field select'));

  selects.forEach((select) => {
    if (select.dataset.customSelectReady === '1') {
      updateCustomSelectUI(select);
      return;
    }
    createCustomSelect(select);
  });

  if (!customSelectGlobalHandlersBound) {
    document.addEventListener('click', onDocumentClickForCustomSelects);
    document.addEventListener('keydown', onDocumentKeydownForCustomSelects);
    customSelectGlobalHandlersBound = true;
  }
}

function createCustomSelect(select) {
  const field = select.closest('.field');
  if (!field) return;

  field.classList.add('field--with-custom-select');
  select.classList.add('select-native-hidden');
  select.dataset.customSelectReady = '1';
  select.setAttribute('tabindex', '-1');
  select.setAttribute('aria-hidden', 'true');

  const root = document.createElement('div');
  root.className = 'custom-select';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select__trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const valueEl = document.createElement('span');
  valueEl.className = 'custom-select__value';
  valueEl.textContent = 'Selecione';

  const icon = document.createElement('i');
  icon.className = 'fas fa-chevron-down custom-select__icon';
  icon.setAttribute('aria-hidden', 'true');

  trigger.appendChild(valueEl);
  trigger.appendChild(icon);

  const menu = document.createElement('div');
  menu.className = 'custom-select__menu';
  menu.setAttribute('role', 'listbox');

  const optionButtons = [];
  Array.from(select.options).forEach((option) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'custom-select__option';
    item.setAttribute('role', 'option');
    item.textContent = String(option.textContent || '').trim();
    item.dataset.value = option.value;
    item.disabled = !!option.disabled;

    if (option.disabled && !option.value) {
      item.classList.add('is-placeholder');
    }

    item.addEventListener('click', () => {
      if (item.disabled) return;
      select.value = item.dataset.value || '';
      markDirtyUserHint(select);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      closeAllCustomSelects();
      trigger.focus();
    });

    optionButtons.push(item);
    menu.appendChild(item);
  });

  trigger.addEventListener('click', () => {
    const isOpen = root.classList.contains('open');
    closeAllCustomSelects(isOpen ? null : root);
    if (!isOpen) {
      root.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    }
  });

  root.appendChild(trigger);
  root.appendChild(menu);
  select.insertAdjacentElement('afterend', root);

  customSelectModels.push({ select, root, trigger, valueEl, optionButtons });

  select.addEventListener('change', () => updateCustomSelectUI(select));
  updateCustomSelectUI(select);
}

function updateCustomSelectUI(select) {
  const model = customSelectModels.find((item) => item.select === select);
  if (!model) return;

  const currentValue = select.value || '';
  const selectedOption = select.options[select.selectedIndex];
  const label = selectedOption ? String(selectedOption.textContent || '').trim() : 'Selecione';
  const placeholder = !currentValue;

  model.valueEl.textContent = label || 'Selecione';
  model.valueEl.classList.toggle('is-placeholder', placeholder);
  model.trigger.classList.toggle('is-empty', placeholder);

  model.optionButtons.forEach((btn) => {
    const isSelected = btn.dataset.value === currentValue;
    btn.classList.toggle('is-selected', isSelected);
    btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
  });
}

function closeAllCustomSelects(exceptRoot = null) {
  customSelectModels.forEach((model) => {
    if (exceptRoot && model.root === exceptRoot) return;
    model.root.classList.remove('open');
    model.trigger.setAttribute('aria-expanded', 'false');
  });
}

function onDocumentClickForCustomSelects(ev) {
  if (ev.target.closest('.custom-select')) return;
  closeAllCustomSelects();
}

function onDocumentKeydownForCustomSelects(ev) {
  if (ev.key === 'Escape') closeAllCustomSelects();
}

function markAppReady() {
  document.body.classList.remove('app-loading');
}

function normalizeThemePreference(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'auto') return 'system';
  return THEME_PREFERENCES.has(raw) ? raw : 'system';
}

function normalizeUf(value) {
  const raw = String(value || '').trim().toUpperCase();
  return UF_CODES.has(raw) ? raw : '';
}

function collectForm() {
  const areas = Array.from(document.querySelectorAll('#areasInteresse .chip'))
    .filter((c) => !c.classList.contains('chip-add'))
    .map((c) => c.childNodes[0]?.textContent?.trim())
    .filter(Boolean);

  return {
    nomeCompleto: getValue('nomeCompleto'),
    email: getValue('email'),
    telefone: getValue('telefone'),
    cargo: getValue('cargo'),

    nomeEmpresa: getValue('nomeEmpresa'),
    cnpj: getValue('cnpj'),
    estadoUf: normalizeUf(getValue('estadoUf')),
    setorEmpresa: getValue('setorEmpresa'),
    setorAtuacao: getValue('setorAtuacao'),
    areasInteresse: areas,

    prefEditais: getChecked('prefEditais'),
    prefPrazo: getChecked('prefPrazo'),
    prefRelatorio: getChecked('prefRelatorio'),
    prefSistema: getChecked('prefSistema'),
    themePreference: normalizeThemePreference(getValue('prefTheme')),
  };
}

function collectComparableForm() {
  return normalizeFormForComparison(collectForm());
}

function syncBaselineSnapshot({ resetInteraction = true } = {}) {
  baselineForm = collectComparableForm();
  baselineFormHash = serializeComparableForm(baselineForm);
  if (resetInteraction) hasUserInteracted = false;
}

function markDirtyUserHint(el) {
  if (!el) return;
  el.dataset[DIRTY_USER_HINT_ATTR] = '1';
}

function consumeDirtyUserHint(el) {
  if (!el || el.dataset[DIRTY_USER_HINT_ATTR] !== '1') return false;
  delete el.dataset[DIRTY_USER_HINT_ATTR];
  return true;
}

function isLikelyUserInitiatedChange(event, el) {
  if (consumeDirtyUserHint(el)) return true;
  if (!event?.isTrusted || !el) return false;

  const activeElement = document.activeElement;
  const target = event.target instanceof Element ? event.target : null;
  const isDirectTarget = Boolean(target && (target === el || el.contains(target) || target.contains(el)));

  if (el.matches?.('input[type="checkbox"], select')) {
    return activeElement === el || isDirectTarget;
  }

  return activeElement === el;
}

function bindDirtyTracking() {
  [...TRACKED_INPUT_IDS, ...TRACKED_CHECKBOX_IDS].forEach((id) => {
    const el = document.getElementById(id);
    if (!el || el.dataset.dirtyBound === '1') return;
    const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, (event) => {
      if (isHydratingProfile) return;
      clearValidationForElement(el);
      updateDirtyState({ userInitiated: isLikelyUserInitiatedChange(event, el) });
    });
    el.dataset.dirtyBound = '1';
  });

  const areasWrap = document.getElementById('areasInteresse');
  if (areasWrap && areasWrap.dataset.dirtyBound !== '1') {
    areasWrap.addEventListener('click', (event) => {
      if (isHydratingProfile) return;
      const interactionEl = event.target?.closest?.('.chip-x, .chip-add') || areasWrap;
      const run = () => updateDirtyState({ userInitiated: isLikelyUserInitiatedChange(event, interactionEl) });
      if (typeof queueMicrotask === 'function') queueMicrotask(run);
      else setTimeout(run, 0);
    });
    areasWrap.dataset.dirtyBound = '1';
  }

  if (!window.__athosProfileBeforeUnloadBound) {
    window.addEventListener('beforeunload', (ev) => {
      if (!hasUnsavedChanges() || !hasUserInteracted) return;
      ev.preventDefault();
      ev.returnValue = '';
    });
    window.__athosProfileBeforeUnloadBound = true;
  }
}

function openDeleteAccountModal() {
  if (!accountDeleteOverlay) return;
  accountDeleteOverlay.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeDeleteAccountModal() {
  if (!accountDeleteOverlay) return;
  accountDeleteOverlay.hidden = true;
  document.body.style.overflow = '';
}

function clearClientSessionAndRedirect() {
  try { window.dispatchEvent(new Event('athos:logout')); } catch (_) {}
  try { localStorage.removeItem('cliente_token'); } catch (_) {}
  try { sessionStorage.removeItem('cliente_token'); } catch (_) {}
  window.location.href = LOGIN_URL;
}

async function deleteOwnAccount() {
  if (!accountDeleteConfirmBtn) return;

  setButtonLoading(accountDeleteConfirmBtn, true, 'Excluindo...');
  try {
    const { res, data } = await apiFetchJson('/cliente/conta', { method: 'DELETE' });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        clearClientSessionAndRedirect();
        return;
      }
      const msg = (data && typeof data === 'object' && (data.detail || data.msg))
        ? (data.detail || data.msg)
        : 'Não foi possível excluir a conta.';
      throw new Error(msg);
    }

    closeDeleteAccountModal();
    toast('Conta excluída com sucesso.', 'success');
    clearClientSessionAndRedirect();
  } catch (err) {
    console.error('Erro ao excluir conta:', err);
    toast(err?.message || 'Não foi possível excluir a conta.', 'error');
  } finally {
    setButtonLoading(accountDeleteConfirmBtn, false);
  }
}

function setupSecurityActions() {
  if (securityChangePasswordBtn) {
    securityChangePasswordBtn.addEventListener('click', async () => {
      const current = getValue('securityCurrentPassword');
      const next = getValue('securityNewPassword');
      const confirm = getValue('securityConfirmPassword');

      if (!current || !next || !confirm) {
        toast('Preencha todos os campos de senha.', 'error');
        return;
      }
      if (next.length < 8) {
        toast('A nova senha deve ter ao menos 8 caracteres.', 'error');
        return;
      }
      if (next !== confirm) {
        toast('A confirmação de senha não confere.', 'error');
        return;
      }

      setButtonLoading(securityChangePasswordBtn, true, 'Atualizando...');
      await new Promise((resolve) => setTimeout(resolve, 520));
      setButtonLoading(securityChangePasswordBtn, false);
      toast('Fluxo de alteração de senha pronto para integrar com o endpoint.', 'success');
    });
  }

  if (security2faEnable) {
    security2faEnable.addEventListener('change', () => {
      toast(
        security2faEnable.checked
          ? 'Preparação para 2FA ativada. Conecte o endpoint para concluir.'
          : 'Preparação para 2FA desativada.',
        'info'
      );
    });
  }

  if (securityLogoutOthersBtn) {
    securityLogoutOthersBtn.addEventListener('click', async () => {
      setButtonLoading(securityLogoutOthersBtn, true, 'Encerrando...');
      await new Promise((resolve) => setTimeout(resolve, 520));
      setButtonLoading(securityLogoutOthersBtn, false);
      toast('Fluxo para encerrar outras sessões pronto para integração.', 'success');
    });
  }

  if (securityRefreshSessionsBtn) {
    securityRefreshSessionsBtn.addEventListener('click', () => {
      toast('Atualização de sessões depende do endpoint de segurança.', 'info');
    });
  }

  if (securityDeleteAccountBtn) {
    securityDeleteAccountBtn.addEventListener('click', () => {
      openDeleteAccountModal();
    });
  }

  if (accountDeleteCancelBtn) {
    accountDeleteCancelBtn.addEventListener('click', () => {
      closeDeleteAccountModal();
    });
  }

  if (accountDeleteOverlay) {
    accountDeleteOverlay.addEventListener('click', (event) => {
      if (event.target === accountDeleteOverlay) {
        closeDeleteAccountModal();
      }
    });
  }

  if (accountDeleteConfirmBtn) {
    accountDeleteConfirmBtn.addEventListener('click', () => {
      deleteOwnAccount();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && accountDeleteOverlay && !accountDeleteOverlay.hidden) {
      closeDeleteAccountModal();
    }
  });
}

function hasUnsavedChanges() {
  if (!baselineFormHash) return false;
  return isComparableFormDirty(collectComparableForm(), baselineFormHash);
}

function updateDirtyState({ userInitiated = false } = {}) {
  const current = collectComparableForm();
  const resolved = resolveDirtyTrackingState({
    currentComparableForm: current,
    baselineComparableForm: baselineForm,
    baselineHash: baselineFormHash,
    hasUserInteracted,
    userInitiated,
  });

  baselineForm = resolved.baselineComparableForm;
  baselineFormHash = resolved.baselineHash;
  hasUserInteracted = resolved.hasUserInteracted;

  const baseline = baselineForm || current;

  TRACKED_INPUT_IDS.forEach((id) => {
    const isDirty = !isDeepEqual(current[id], baseline[id]);
    markFieldDirty(id, isDirty);
  });

  TRACKED_CHECKBOX_IDS.forEach((id) => {
    const isDirty = !isDeepEqual(current[id], baseline[id]);
    markFieldDirty(id, isDirty);
  });

  const areaDirty = !isDeepEqual(current.areasInteresse, baseline.areasInteresse);
  const areaField = document.getElementById('areasInteresse')?.closest('.field');
  if (areaField) areaField.classList.toggle('is-dirty', areaDirty);
  document.getElementById('areasInteresse')?.classList.toggle('is-dirty', areaDirty);

  if (profileSaveBanner) profileSaveBanner.hidden = !resolved.showUnsavedBanner;
}

function markFieldDirty(id, isDirty) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('is-dirty', isDirty);

  const checkWrap = el.closest('.check');
  if (checkWrap) checkWrap.classList.toggle('is-dirty', isDirty);

  const fieldWrap = el.closest('.field');
  if (fieldWrap) fieldWrap.classList.toggle('is-dirty', isDirty);

  const customSelect = fieldWrap?.querySelector('.custom-select');
  if (customSelect) customSelect.classList.toggle('is-dirty', isDirty);
}

function validateProfileForm(payload) {
  const out = [];
  const email = normalizeTextValue(payload.email, { lower: true });
  const nome = normalizeTextValue(payload.nomeCompleto);
  const cnpj = normalizeDigits(payload.cnpj);
  const telefone = normalizeDigits(payload.telefone);
  const estadoUf = normalizeUf(payload.estadoUf);

  if (!nome || nome.length < 3) {
    out.push({ field: 'nomeCompleto', message: 'Informe um nome completo válido.' });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    out.push({ field: 'email', message: 'Informe um e-mail válido.' });
  }

  if (cnpj && cnpj.length !== 14) {
    out.push({ field: 'cnpj', message: 'CNPJ deve conter 14 dígitos.' });
  }

  if (telefone && telefone.length < 10) {
    out.push({ field: 'telefone', message: 'Telefone deve conter DDD e número.' });
  }

  if (!estadoUf) {
    out.push({ field: 'estadoUf', message: 'Informe o estado principal (UF) para personalizar as recomendações.' });
  }

  return out;
}

function clearFieldValidationState() {
  document.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
}

function clearValidationForElement(el) {
  if (!el) return;
  el.classList.remove('is-invalid');
  el.closest('.field')?.classList.remove('is-invalid');
  el.closest('.check')?.classList.remove('is-invalid');
  el.closest('.custom-select')?.classList.remove('is-invalid');
}

function applyFieldValidation(errors) {
  errors.forEach(({ field }) => {
    const el = document.getElementById(field);
    if (!el) return;
    el.classList.add('is-invalid');
    el.closest('.field')?.classList.add('is-invalid');
    el.closest('.check')?.classList.add('is-invalid');
    el.closest('.custom-select')?.classList.add('is-invalid');
  });
}

function revealFieldForValidation(fieldId) {
  const el = document.getElementById(fieldId);
  if (!el) return;

  const pane = el.closest('.panel[role="tabpanel"]');
  if (pane && pane.hidden) {
    const tabButton = document.querySelector(`.profile-nav-item[data-target="${pane.id}"]`);
    tabButton?.click();
  }

  window.setTimeout(() => {
    try { el.focus({ preventScroll: false }); } catch (_) {}
  }, 20);
}

function isDeepEqual(a, b) {
  if (a === b) return true;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => isDeepEqual(v, b[i]));
  }

  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => isDeepEqual(a[key], b[key]));
  }

  return false;
}

function setButtonLoading(btn, loading, loadingText = 'Salvando...') {
  if (!btn) return;
  if (loading) {
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent || '';
    btn.disabled = true;
    btn.textContent = loadingText;
    return;
  }
  btn.disabled = false;
  if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
}

async function loadProfileFromApi() {
  try {
    const { res, data } = await apiFetchJson('/cliente/perfil', { method: 'GET' });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        // Mantém a tela usando os dados básicos já carregados em /cliente/me.
        return;
      }
      const msg = (data && typeof data === 'object' && (data.detail || data.msg))
        ? (data.detail || data.msg)
        : 'Não foi possível carregar o perfil.';
      throw new Error(msg);
    }

    fillProfileForm(data, { syncBaseline: true });
  } catch (e) {
    console.error('Erro ao carregar perfil:', e);
    toast(e?.message || 'Não foi possível carregar o perfil.', 'error');
  }
}

function fillProfileForm(data, { syncBaseline = false } = {}) {
  const profile = (data && typeof data === 'object') ? data : {};
  isHydratingProfile = true;

  try {
    if ('nomeCompleto' in profile) {
      const nome = profile.nomeCompleto || '';
      setValue('nomeCompleto', nome);
      setText('profileName', nome);
      setText('sidebarUserName', nome);
      setInitials('profileAvatar', nome || profile.email || 'U');
      setInitials('sidebarAvatar', nome || profile.email || 'U');
    }

    if ('email' in profile) {
      const email = profile.email || '';
      setValue('email', email);
      setText('profileEmail', email);
      setText('sidebarUserEmail', email);
    }

    if ('telefone' in profile) setValue('telefone', profile.telefone || '');
    if ('cargo' in profile) setValue('cargo', profile.cargo || '');
    if ('nomeEmpresa' in profile) setValue('nomeEmpresa', profile.nomeEmpresa || '');
    if ('cnpj' in profile) setValue('cnpj', profile.cnpj || '');
    if ('estadoUf' in profile) setValue('estadoUf', normalizeUf(profile.estadoUf || ''));
    if ('setorEmpresa' in profile) setValue('setorEmpresa', profile.setorEmpresa || '');
    if ('setorAtuacao' in profile) setValue('setorAtuacao', profile.setorAtuacao || '');

    setAreasInteresse(profile.areasInteresse);

    if ('prefEditais' in profile) setChecked('prefEditais', !!profile.prefEditais);
    if ('prefPrazo' in profile) setChecked('prefPrazo', !!profile.prefPrazo);
    if ('prefRelatorio' in profile) setChecked('prefRelatorio', !!profile.prefRelatorio);
    if ('prefSistema' in profile) setChecked('prefSistema', !!profile.prefSistema);
    if ('themePreference' in profile) {
      const prefTheme = normalizeThemePreference(profile.themePreference);
      setValue('prefTheme', prefTheme);
      if (window.AthosTheme?.setPreference) {
        window.AthosTheme.setPreference(prefTheme);
      }
    }
  } finally {
    isHydratingProfile = false;
    if (syncBaseline) {
      syncBaselineSnapshot({ resetInteraction: true });
    }
    updateDirtyState();
    if (syncBaseline && profileSaveBanner) profileSaveBanner.hidden = true;
  }
}

function setAreasInteresse(areas) {
  const add = document.getElementById('addAreaBtn');
  if (!add) return;

  document.querySelectorAll('#areasInteresse .chip').forEach((c) => {
    if (!c.classList.contains('chip-add')) c.remove();
  });

  if (!Array.isArray(areas)) return;

  areas.forEach((area) => {
    const text = String(area || '').trim();
    if (!text) return;
    const span = document.createElement('span');
    span.className = 'chip';
    span.innerHTML = `${escapeHtml(text)} <button type="button" class="chip-x" aria-label="Remover">&times;</button>`;
    add.before(span);
  });
}

function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 250);
  }, 1800);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value;
  if (el.tagName === 'SELECT') {
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function getValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function getChecked(id) {
  const el = document.getElementById(id);
  return el ? el.checked : false;
}

function setChecked(id, v) {
  const el = document.getElementById(id);
  if (el) el.checked = !!v;
}

function setInitials(id, name) {
  const el = document.getElementById(id);
  if (!el) return;
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || 'U';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  el.textContent = (a + b).toUpperCase();
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
