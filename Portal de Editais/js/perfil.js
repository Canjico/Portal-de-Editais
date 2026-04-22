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
  isPasswordChangeRequiredPayload,
  isPasswordChangeRequiredResponse,
  resolvePasswordChangeRedirectTarget,
  resolveAuthFailureRedirectTarget,
  redirectWithAuthGuard,
} from './auth.js?v=20260422.3';
import {
  normalizeTextValue,
  normalizeDigits,
  normalizeFormForComparison,
  serializeComparableForm,
  isComparableFormDirty,
  resolveDirtyTrackingState,
} from './perfil-dirty-state.js';
import { runProfileBootstrapFlow } from './bootstrap-flows.js?v=20260422.3';

const sidebarToggle = document.getElementById('sidebarToggle');
const appSidebar = document.getElementById('appSidebar');
const logoutIconBtn = document.getElementById('logoutIconBtn');
const mobileSidebarBtn = document.getElementById('mobileSidebarBtn');
const mobileSidebarBackdrop = document.getElementById('mobileSidebarBackdrop');
const profileSaveBanner = document.getElementById('profileSaveBanner');
const saveAllProfileBtn = document.getElementById('saveAllProfileBtn');
const securityStartPasswordChangeBtn = document.getElementById('securityStartPasswordChangeBtn');
const securityPasswordStatus = document.getElementById('securityPasswordStatus');
const securityLogoutOthersBtn = document.getElementById('securityLogoutOthersBtn');
const securityRefreshSessionsBtn = document.getElementById('securityRefreshSessionsBtn');
const securitySessionList = document.getElementById('securitySessionList');
const security2faEnable = document.getElementById('security2faEnable');
const privacyDeleteAccountBtn = document.getElementById('privacyDeleteAccountBtn');
const accountDeleteOverlay = document.getElementById('accountDeleteOverlay');
const accountDeleteCancelBtn = document.getElementById('accountDeleteCancelBtn');
const accountDeleteConfirmBtn = document.getElementById('accountDeleteConfirmBtn');
const customSelectModels = [];
let customSelectGlobalHandlersBound = false;
let baselineForm = null;
let baselineFormHash = '';
let hasUserInteracted = false;
let isHydratingProfile = false;
let sessionsLoadedAtLeastOnce = false;
let currentAuthContext = {};
let currentCompanyWorkspace = null;
let dirtyTrackingEnabled = false;
let profileHydrationFinalized = false;

const DIRTY_USER_HINT_ATTR = 'athosDirtyUserInitiated';

const profileCookieAnalytics = document.getElementById('profileCookieAnalytics');
const profileCookieMarketing = document.getElementById('profileCookieMarketing');
const profileCookiePersonalization = document.getElementById('profileCookiePersonalization');
const profileCookieSaveBtn = document.getElementById('profileCookieSaveBtn');
const profileCookieRejectBtn = document.getElementById('profileCookieRejectBtn');
const profileCookieStatus = document.getElementById('profileCookieStatus');
const companySummaryStatus = document.getElementById('companySummaryStatus');
const companySummaryName = document.getElementById('companySummaryName');
const companySummaryCnpj = document.getElementById('companySummaryCnpj');
const companySummaryLimit = document.getElementById('companySummaryLimit');
const companySummaryUsers = document.getElementById('companySummaryUsers');
const companySummaryUsed = document.getElementById('companySummaryUsed');
const companySummaryReserved = document.getElementById('companySummaryReserved');
const companySummaryAvailable = document.getElementById('companySummaryAvailable');
const companyViewerRole = document.getElementById('companyViewerRole');
const companySummaryOwner = document.getElementById('companySummaryOwner');
const companyUsersList = document.getElementById('companyUsersList');
const companyTicketsList = document.getElementById('companyTicketsList');
const companyTicketTitle = document.getElementById('companyTicketTitle');
const companyTicketDescription = document.getElementById('companyTicketDescription');
const companyTicketPriority = document.getElementById('companyTicketPriority');
const companyTicketSubmit = document.getElementById('companyTicketSubmit');
const companyTicketFeedback = document.getElementById('companyTicketFeedback');
const companySubaccountSessionsCard = document.getElementById('companySubaccountSessionsCard');
const companySubaccountSessionsList = document.getElementById('companySubaccountSessionsList');
const companySubaccountSessionsFeedback = document.getElementById('companySubaccountSessionsFeedback');
const companySessionsRefreshBtn = document.getElementById('companySessionsRefreshBtn');
const profileRole = document.getElementById('profileRole');

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
    dirtyTrackingEnabled = false;
    profileHydrationFinalized = false;
    await runProfileBootstrapFlow({
      bootstrapAuthFromUrl,
      bootstrapTheme: () => window.AthosTheme?.bootstrap?.(),
      checkAuth,
      hydrateProfileShellFromBootstrap,
      setupUI,
      setupCookiePreferences,
      setupSecurityActions,
      setupCompanyActions,
      closeDeleteAccountModal,
      markAppReady,
      loadProfileDetailsInBackground,
      onBackgroundError: (error) => {
        console.error('Falha inesperada ao carregar detalhes do perfil:', error);
      },
    });
  } catch (error) {
    console.error('Falha inesperada ao inicializar o perfil:', error);
    markAppReady();
  }
}

function mapRoleLabel(role, fallback = '') {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'owner_company') return 'Dono da PJ';
  if (normalized === 'employee') return 'Subconta / Funcionário';
  return fallback || 'Usuário';
}

function getCurrentPermissions() {
  const permissions = currentAuthContext?.permissions;
  if (permissions && typeof permissions === 'object') return permissions;
  return {};
}

function isCurrentCompanyOwner() {
  const permissions = getCurrentPermissions();
  if (permissions?.is_company_owner === true) return true;
  return String(currentAuthContext?.role || '').toLowerCase() === 'owner_company';
}

function redirectToLoginForAuthFailure(res, data, reasonPrefix = 'perfil.redirectToLoginForAuthFailure') {
  const decision = resolveAuthFailureRedirectTarget(res, data);
  if (!decision) {
    redirectWithAuthGuard(buildLoginUrlWithNext(), `${reasonPrefix}.unauthorized`);
    return;
  }
  redirectWithAuthGuard(decision.target, `${reasonPrefix}.${decision.reason}`);
}

async function checkAuth() {
  try {
    const { res, data } = await apiFetchJson('/cliente/me', { method: 'GET' });
    if (!res.ok) {
      const decision = resolveAuthFailureRedirectTarget(res, data);
      if (decision) {
        redirectWithAuthGuard(decision.target, `perfil.checkAuth.${decision.reason}`);
        return null;
      }
      return {};
    }

    if (isPasswordChangeRequiredPayload(data)) {
      const fallbackUrl = buildLoginUrlWithNext();
      redirectWithAuthGuard(
        resolvePasswordChangeRedirectTarget(data, fallbackUrl),
        'perfil.checkAuth.payload_password_change_required'
      );
      return null;
    }

    if (data && typeof data === 'object' && 'logado' in data && !data.logado) {
      redirectWithAuthGuard(buildLoginUrlWithNext(), 'perfil.checkAuth.logado_false');
      return null;
    }

    if (window.AthosTheme?.setPreference && data?.themePreference) {
      const nextTheme = window.AthosTheme.resolveProfilePreference
        ? window.AthosTheme.resolveProfilePreference(data.themePreference)
        : data.themePreference;
      window.AthosTheme.setPreference(nextTheme);
    }

    currentAuthContext = (data && typeof data === 'object') ? data : {};
    return currentAuthContext;
  } catch (e) {
    console.error('Erro na verificação de autenticação:', e);

    if (e instanceof TypeError) return {};

    redirectWithAuthGuard(buildLoginUrlWithNext(), 'perfil.checkAuth.exception');
    return null;
  }
}

function applyAuthContextFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return;
  const nextPermissions = payload.permissions && typeof payload.permissions === 'object'
    ? payload.permissions
    : currentAuthContext?.permissions;

  currentAuthContext = {
    ...currentAuthContext,
    ...payload,
    permissions: nextPermissions || {},
  };

  const roleLabel = mapRoleLabel(currentAuthContext?.role, currentAuthContext?.role_label || '');
  if (profileRole) profileRole.textContent = roleLabel;
}

function hydrateProfileShellFromBootstrap(me) {
  const bootstrapData = (me && typeof me === 'object') ? me : {};
  applyAuthContextFromPayload(bootstrapData);

  const shellPayload = {};
  const nome = bootstrapData?.nome || bootstrapData?.nome_completo || bootstrapData?.user?.nome || bootstrapData?.usuario?.nome;
  const email = bootstrapData?.email || bootstrapData?.user?.email || bootstrapData?.usuario?.email;
  const telefone = bootstrapData?.celular || bootstrapData?.telefone;
  const cnpj = bootstrapData?.cnpj;
  const estadoUf = normalizeUf(
    bootstrapData?.estadoUf ||
    bootstrapData?.estado_uf ||
    bootstrapData?.estadoUF ||
    ''
  );
  const themePreference = bootstrapData?.themePreference || bootstrapData?.theme_preference;

  if (nome) shellPayload.nomeCompleto = nome;
  if (email) shellPayload.email = email;
  if (telefone) shellPayload.telefone = telefone;
  if (cnpj) shellPayload.cnpj = cnpj;
  if (estadoUf) shellPayload.estadoUf = estadoUf;
  if (themePreference) shellPayload.themePreference = themePreference;

  hydrateProfileDetailsFromApi(shellPayload);
}

async function fetchProfileDetailsFromApi() {
  try {
    const { res, data } = await apiFetchJson('/cliente/perfil', { method: 'GET' });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        if (isPasswordChangeRequiredResponse(res, data) || isPasswordChangeRequiredPayload(data)) {
          redirectToLoginForAuthFailure(res, data, 'perfil.loadProfileDetailsInBackground');
        }
        return null;
      }
      const msg = (data && typeof data === 'object' && (data.detail || data.msg))
        ? (data.detail || data.msg)
        : 'Não foi possível carregar o perfil.';
      throw new Error(msg);
    }
    return (data && typeof data === 'object') ? data : {};
  } catch (error) {
    console.error('Erro ao carregar perfil:', error);
    toast(error?.message || 'Não foi possível carregar o perfil.', 'error');
    return null;
  }
}

function hydrateProfileDetailsFromApi(data) {
  const safeData = (data && typeof data === 'object') ? data : {};
  applyAuthContextFromPayload(safeData);
  fillProfileForm(safeData, { syncBaseline: false, refreshDirty: false });
}

async function loadProfileDetailsInBackground() {
  const companyPromise = loadCompanyWorkspace({ silent: true });
  try {
    const details = await fetchProfileDetailsFromApi();
    if (details) hydrateProfileDetailsFromApi(details);
  } finally {
    await Promise.allSettled([companyPromise]);
    finalizeProfileHydration();
  }
}

function finalizeProfileHydration() {
  if (profileHydrationFinalized) return;
  profileHydrationFinalized = true;
  applyRoleBasedUi();
  bindDirtyTracking();
  syncBaselineSnapshot({ resetInteraction: true });
  dirtyTrackingEnabled = true;
  updateDirtyState();
  if (profileSaveBanner) profileSaveBanner.hidden = true;
}

function applyRoleBasedUi() {
  const isOwner = isCurrentCompanyOwner();
  const managementFieldIds = ['nomeEmpresa', 'cnpj', 'setorEmpresa', 'setorAtuacao', 'estadoUf'];
  managementFieldIds.forEach((fieldId) => {
    const el = document.getElementById(fieldId);
    if (!el) return;
    el.disabled = !isOwner;
  });

  const addAreaBtn = document.getElementById('addAreaBtn');
  if (addAreaBtn) addAreaBtn.disabled = !isOwner;
  document.querySelectorAll('#areasInteresse .chip-x').forEach((btn) => {
    btn.disabled = !isOwner;
  });

  const saveEmpresaBtn = document.getElementById('saveEmpresaBtn');
  if (saveEmpresaBtn) {
    saveEmpresaBtn.disabled = !isOwner;
    saveEmpresaBtn.textContent = isOwner ? 'Salvar alterações' : 'Gestão restrita para subconta';
  }

  if (companySubaccountSessionsCard) {
    companySubaccountSessionsCard.hidden = !isOwner;
  }
  if (companySessionsRefreshBtn) {
    companySessionsRefreshBtn.disabled = !isOwner;
  }
  if (!isOwner && companySubaccountSessionsList) {
    companySubaccountSessionsList.innerHTML = `
      <li>
        <div>
          <strong>Acesso restrito.</strong>
          <small>Somente o dono da PJ pode gerenciar sessões de subcontas.</small>
        </div>
      </li>
    `;
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
      redirectWithAuthGuard(LOGIN_URL, 'perfil.logout');
    }
  };

  if (logoutIconBtn) logoutIconBtn.addEventListener('click', doLogout);

  // Navegação interna do perfil (tabs)
  document.querySelectorAll('.profile-nav-item').forEach((btn) => {
    if (btn.dataset.navBound === '1') return;
    btn.addEventListener('click', () => {
      clearTransientSelection(btn);
      const target = btn.getAttribute('data-target');
      activateProfilePane(target);
    });
    btn.dataset.navBound = '1';
  });

  document.querySelectorAll('[data-go-to-pane]').forEach((btn) => {
    if (btn.dataset.goPaneBound === '1') return;
    btn.addEventListener('click', () => {
      clearTransientSelection(btn);
      const target = btn.getAttribute('data-go-to-pane');
      activateProfilePane(target);
    });
    btn.dataset.goPaneBound = '1';
  });

  document.querySelectorAll('[data-section-target]').forEach((btn) => {
    if (btn.dataset.sectionBound === '1') return;
    btn.addEventListener('click', () => {
      clearTransientSelection(btn);
      const targetId = btn.getAttribute('data-section-target');
      if (!targetId) return;
      openSensitiveSection(targetId);
      if (targetId === 'security-sessions-section') {
        loadSecuritySessions({ silent: true });
      }
    });
    btn.dataset.sectionBound = '1';
  });

  const initialTarget =
    document.querySelector('.profile-nav-item.is-active')?.getAttribute('data-target') ||
    'pane-inicio';
  activateProfilePane(initialTarget);

  // Chips: remover
  const areas = document.getElementById('areasInteresse');
  if (areas) {
    areas.addEventListener('click', (e) => {
      if (!isCurrentCompanyOwner()) return;
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
      if (!isCurrentCompanyOwner()) {
        toast('Somente o dono da PJ pode editar áreas de interesse da empresa.', 'error');
        return;
      }
      const name = prompt('Nome da nova área de interesse:');
      if (!name) return;
      const span = document.createElement('span');
      span.className = 'chip';
      span.innerHTML = `${escapeHtml(name)} <button type="button" class="chip-x" aria-label="Remover">&times;</button>`;
      addAreaBtn.before(span);
      applyRoleBasedUi();
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
          redirectToLoginForAuthFailure(res, data);
          return;
        }
        const msg = (data && typeof data === 'object' && (data.detail || data.msg))
          ? (data.detail || data.msg)
          : 'Não foi possível salvar o perfil.';
        throw new Error(msg);
      }

      fillProfileForm(data, { syncBaseline: true });
      await loadCompanyWorkspace({ silent: true });
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

function activateProfilePane(targetPaneId) {
  const target = String(targetPaneId || '').trim();
  if (!target) return;

  let foundPanel = false;
  document.querySelectorAll('.panel[role="tabpanel"]').forEach((panel) => {
    const isTarget = panel.id === target;
    panel.toggleAttribute('hidden', !isTarget);
    if (isTarget) foundPanel = true;
  });

  if (!foundPanel) return;

  document.querySelectorAll('.profile-nav-item').forEach((btn) => {
    const isTarget = btn.getAttribute('data-target') === target;
    btn.classList.toggle('is-active', isTarget);
    btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
  });

  if (target !== 'pane-seguranca') hideSensitiveSectionsByGroup('security');
  if (target !== 'pane-privacidade') hideSensitiveSectionsByGroup('privacy');
  if (target === 'pane-empresa') {
    loadCompanyWorkspace({ silent: true });
  }

  closeAllCustomSelects();
}

function hideSensitiveSectionsByGroup(groupName) {
  if (!groupName) return;

  document
    .querySelectorAll(`.profile-sensitive-section[data-section-group="${groupName}"]`)
    .forEach((section) => {
      section.hidden = true;
    });

  document
    .querySelectorAll(`.section-entry-grid[data-entry-group="${groupName}"] .section-entry-btn[data-section-target]`)
    .forEach((btn) => {
      btn.classList.remove('is-active');
      btn.setAttribute('aria-expanded', 'false');
    });
}

function openSensitiveSection(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;

  const group = target.getAttribute('data-section-group');
  if (!group) {
    target.hidden = false;
    return;
  }

  document
    .querySelectorAll(`.profile-sensitive-section[data-section-group="${group}"]`)
    .forEach((section) => {
      section.hidden = section.id !== targetId;
    });

  document
    .querySelectorAll(`.section-entry-grid[data-entry-group="${group}"] .section-entry-btn[data-section-target]`)
    .forEach((btn) => {
      const isTarget = btn.getAttribute('data-section-target') === targetId;
      btn.classList.toggle('is-active', isTarget);
      btn.setAttribute('aria-expanded', isTarget ? 'true' : 'false');
    });
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
  const body = document.body;
  if (!body) return;
  const wasLoading = body.classList.contains('app-loading');
  body.classList.remove('app-loading');
  if (wasLoading) {
    try {
      window.dispatchEvent(new CustomEvent('athos:app-ready', { detail: { source: 'perfil' } }));
    } catch (_) {}
  }
}

function normalizeThemePreference(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'auto') return 'system';
  return THEME_PREFERENCES.has(raw) ? raw : 'light';
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
  redirectWithAuthGuard(LOGIN_URL, 'perfil.clearClientSessionAndRedirect');
}

async function deleteOwnAccount() {
  if (!accountDeleteConfirmBtn) return;

  setButtonLoading(accountDeleteConfirmBtn, true, 'Excluindo...');
  try {
    const { res, data } = await apiFetchJson('/cliente/conta', { method: 'DELETE' });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        if (isPasswordChangeRequiredResponse(res, data)) {
          redirectToLoginForAuthFailure(res, data);
          return;
        }
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

function setSecurityPasswordStatus(message, tone = '') {
  if (!securityPasswordStatus) return;
  securityPasswordStatus.textContent = String(message || '').trim();
  securityPasswordStatus.classList.toggle('is-success', tone === 'success');
  securityPasswordStatus.classList.toggle('is-error', tone === 'error');
}

function formatIsoDateTimeForSession(isoValue) {
  if (!isoValue) return '';
  const dt = new Date(isoValue);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function setSecuritySessionsLoadingState() {
  if (!securitySessionList) return;
  securitySessionList.innerHTML = '';
  const li = document.createElement('li');
  const info = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = 'Carregando sessões...';
  const desc = document.createElement('small');
  desc.textContent = 'Aguarde alguns segundos.';
  info.appendChild(title);
  info.appendChild(desc);
  const chip = document.createElement('span');
  chip.className = 'session-chip';
  chip.textContent = '...';
  li.appendChild(info);
  li.appendChild(chip);
  securitySessionList.appendChild(li);
}

function renderSecuritySessions(sessions) {
  if (!securitySessionList) return;
  securitySessionList.innerHTML = '';

  const safeSessions = Array.isArray(sessions) ? sessions : [];
  if (!safeSessions.length) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = 'Nenhuma sessão ativa adicional';
    const desc = document.createElement('small');
    desc.textContent = 'No momento, não há outras sessões para exibir.';
    info.appendChild(title);
    info.appendChild(desc);
    const chip = document.createElement('span');
    chip.className = 'session-chip';
    chip.textContent = 'Vazio';
    li.appendChild(info);
    li.appendChild(chip);
    securitySessionList.appendChild(li);
    return;
  }

  safeSessions.forEach((session) => {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = session?.device_label || 'Sessão';

    const details = [];
    if (session?.ip_address) details.push(`IP ${session.ip_address}`);
    const lastSeen = formatIsoDateTimeForSession(session?.last_seen_at);
    if (lastSeen) details.push(`Última atividade: ${lastSeen}`);
    const expiresAt = formatIsoDateTimeForSession(session?.expires_at);
    if (expiresAt) details.push(`Expira: ${expiresAt}`);

    const desc = document.createElement('small');
    desc.textContent = details.length ? details.join(' | ') : 'Sem dados adicionais desta sessão.';

    const chip = document.createElement('span');
    chip.className = 'session-chip';
    const isCurrent = Boolean(session?.is_current);
    const status = String(session?.status || '').toLowerCase();
    chip.textContent = isCurrent ? 'Atual' : (status === 'expirada' ? 'Expirada' : 'Ativa');

    info.appendChild(title);
    info.appendChild(desc);
    li.appendChild(info);
    li.appendChild(chip);
    securitySessionList.appendChild(li);
  });
}

async function loadSecuritySessions({ silent = false } = {}) {
  if (!securitySessionList) return;
  setSecuritySessionsLoadingState();

  try {
    const { res, data } = await apiFetchJson('/cliente/seguranca/sessoes', { method: 'GET' });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        if (isPasswordChangeRequiredResponse(res, data)) {
          redirectToLoginForAuthFailure(res, data);
          return;
        }
        clearClientSessionAndRedirect();
        return;
      }
      const msg = (data && typeof data === 'object' && (data.detail || data.msg))
        ? (data.detail || data.msg)
        : 'Não foi possível carregar as sessões ativas.';
      throw new Error(msg);
    }

    renderSecuritySessions(data?.sessions);
    sessionsLoadedAtLeastOnce = true;
    if (!silent) toast('Sessões atualizadas.', 'success');
  } catch (err) {
    console.error('Erro ao carregar sessões:', err);
    renderSecuritySessions([]);
    if (!silent) toast(err?.message || 'Não foi possível carregar as sessões ativas.', 'error');
  }
}

async function startPasswordChangeVerification() {
  if (!securityStartPasswordChangeBtn) return;

  setButtonLoading(securityStartPasswordChangeBtn, true, 'Enviando...');
  setSecurityPasswordStatus('Enviando verificação para o seu e-mail...');

  try {
    const { res, data } = await apiFetchJson('/cliente/seguranca/trocar-senha/iniciar', {
      method: 'POST',
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        if (isPasswordChangeRequiredResponse(res, data)) {
          redirectToLoginForAuthFailure(res, data);
          return;
        }
        clearClientSessionAndRedirect();
        return;
      }
      const msg = (data && typeof data === 'object' && (data.detail || data.msg))
        ? (data.detail || data.msg)
        : 'Não foi possível iniciar a troca de senha.';
      throw new Error(msg);
    }

    const message = (data && typeof data === 'object' && data.msg)
      ? data.msg
      : 'Verificação enviada. Confira seu e-mail para continuar.';
    setSecurityPasswordStatus(
      `${message} Se não receber, verifique spam/lixeira e tente novamente.`,
      'success'
    );
    toast('Verificação enviada por e-mail.', 'success');
  } catch (err) {
    console.error('Erro ao iniciar troca de senha:', err);
    const message = err?.message || 'Não foi possível iniciar a troca de senha.';
    setSecurityPasswordStatus(message, 'error');
    toast(message, 'error');
  } finally {
    setButtonLoading(securityStartPasswordChangeBtn, false);
  }
}

async function logoutOtherSessions() {
  if (!securityLogoutOthersBtn) return;

  setButtonLoading(securityLogoutOthersBtn, true, 'Encerrando...');
  try {
    const { res, data } = await apiFetchJson('/cliente/seguranca/sessoes/encerrar-outras', {
      method: 'POST',
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        if (isPasswordChangeRequiredResponse(res, data)) {
          redirectToLoginForAuthFailure(res, data);
          return;
        }
        clearClientSessionAndRedirect();
        return;
      }
      const msg = (data && typeof data === 'object' && (data.detail || data.msg))
        ? (data.detail || data.msg)
        : 'Não foi possível encerrar as outras sessões.';
      throw new Error(msg);
    }

    toast(data?.msg || 'Solicitação processada para encerrar outras sessões.', 'success');
    await loadSecuritySessions({ silent: true });
  } catch (err) {
    console.error('Erro ao encerrar outras sessões:', err);
    toast(err?.message || 'Não foi possível encerrar as outras sessões.', 'error');
  } finally {
    setButtonLoading(securityLogoutOthersBtn, false);
  }
}

function setupSecurityActions() {
  if (securityStartPasswordChangeBtn && securityStartPasswordChangeBtn.dataset.bound !== '1') {
    securityStartPasswordChangeBtn.addEventListener('click', () => {
      startPasswordChangeVerification();
    });
    securityStartPasswordChangeBtn.dataset.bound = '1';
  }

  if (security2faEnable && security2faEnable.dataset.bound !== '1') {
    security2faEnable.addEventListener('change', () => {
      toast(
        security2faEnable.checked
          ? 'Preparação para 2FA ativada. Conecte o endpoint para concluir.'
          : 'Preparação para 2FA desativada.',
        'info'
      );
    });
    security2faEnable.dataset.bound = '1';
  }

  if (securityLogoutOthersBtn && securityLogoutOthersBtn.dataset.bound !== '1') {
    securityLogoutOthersBtn.addEventListener('click', () => {
      logoutOtherSessions();
    });
    securityLogoutOthersBtn.dataset.bound = '1';
  }

  if (securityRefreshSessionsBtn && securityRefreshSessionsBtn.dataset.bound !== '1') {
    securityRefreshSessionsBtn.addEventListener('click', () => {
      loadSecuritySessions();
    });
    securityRefreshSessionsBtn.dataset.bound = '1';
  }

  if (privacyDeleteAccountBtn && privacyDeleteAccountBtn.dataset.bound !== '1') {
    privacyDeleteAccountBtn.addEventListener('click', () => {
      openDeleteAccountModal();
    });
    privacyDeleteAccountBtn.dataset.bound = '1';
  }

  if (accountDeleteCancelBtn && accountDeleteCancelBtn.dataset.bound !== '1') {
    accountDeleteCancelBtn.addEventListener('click', () => {
      closeDeleteAccountModal();
    });
    accountDeleteCancelBtn.dataset.bound = '1';
  }

  if (accountDeleteOverlay && accountDeleteOverlay.dataset.bound !== '1') {
    accountDeleteOverlay.addEventListener('click', (event) => {
      if (event.target === accountDeleteOverlay) {
        closeDeleteAccountModal();
      }
    });
    accountDeleteOverlay.dataset.bound = '1';
  }

  if (accountDeleteConfirmBtn && accountDeleteConfirmBtn.dataset.bound !== '1') {
    accountDeleteConfirmBtn.addEventListener('click', () => {
      deleteOwnAccount();
    });
    accountDeleteConfirmBtn.dataset.bound = '1';
  }

  if (!document.body.dataset.profileEscapeBound) {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && accountDeleteOverlay && !accountDeleteOverlay.hidden) {
        closeDeleteAccountModal();
      }
    });
    document.body.dataset.profileEscapeBound = '1';
  }

  if (securitySessionList && !sessionsLoadedAtLeastOnce) {
    renderSecuritySessions([]);
  }
}

function setCompanyTicketFeedback(message, tone = '') {
  if (!companyTicketFeedback) return;
  companyTicketFeedback.textContent = String(message || '').trim();
  companyTicketFeedback.classList.toggle('is-success', tone === 'success');
  companyTicketFeedback.classList.toggle('is-error', tone === 'error');
}

function renderCompanyUsers(users) {
  if (!companyUsersList) return;
  companyUsersList.innerHTML = '';
  const safeUsers = Array.isArray(users) ? users : [];

  if (!safeUsers.length) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = 'Nenhum usuário vinculado';
    const desc = document.createElement('small');
    desc.textContent = 'No momento não há outros membros para exibir.';
    info.appendChild(title);
    info.appendChild(desc);
    li.appendChild(info);
    companyUsersList.appendChild(li);
    return;
  }

  safeUsers.forEach((user) => {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const title = document.createElement('strong');
    const roleLabel = mapRoleLabel(user?.role, user?.role_label || '');
    const ownerSuffix = user?.is_owner ? ' (Conta principal)' : '';
    title.textContent = `${user?.nome || user?.email || 'Usuário'}${ownerSuffix}`;
    const desc = document.createElement('small');
    const status = String(user?.status || '').trim() || 'ativo';
    desc.textContent = `${user?.email || '-'} | ${roleLabel} | ${status}`;
    info.appendChild(title);
    info.appendChild(desc);
    li.appendChild(info);
    companyUsersList.appendChild(li);
  });
}

function renderCompanyTickets(tickets) {
  if (!companyTicketsList) return;
  companyTicketsList.innerHTML = '';
  const safeTickets = Array.isArray(tickets) ? tickets : [];

  if (!safeTickets.length) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = 'Nenhum ticket cadastrado';
    const desc = document.createElement('small');
    desc.textContent = 'Quando necessário, abra um ticket da empresa por aqui.';
    info.appendChild(title);
    info.appendChild(desc);
    li.appendChild(info);
    companyTicketsList.appendChild(li);
    return;
  }

  safeTickets.forEach((ticket) => {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = ticket?.titulo || 'Ticket sem título';
    const desc = document.createElement('small');
    const status = String(ticket?.status || 'aberto');
    const prioridade = String(ticket?.prioridade || 'media');
    desc.textContent = `${status} | ${prioridade} | ${formatIsoDateTimeForSession(ticket?.criado_em) || '-'}`;
    info.appendChild(title);
    info.appendChild(desc);
    li.appendChild(info);
    companyTicketsList.appendChild(li);
  });
}

function setCompanySubaccountSessionsFeedback(message, tone = '') {
  if (!companySubaccountSessionsFeedback) return;
  companySubaccountSessionsFeedback.textContent = String(message || '').trim();
  companySubaccountSessionsFeedback.classList.toggle('is-success', tone === 'success');
  companySubaccountSessionsFeedback.classList.toggle('is-error', tone === 'error');
}

function renderCompanySubaccountSessions(subcontas) {
  if (!companySubaccountSessionsList) return;
  companySubaccountSessionsList.innerHTML = '';

  const safeSubcontas = Array.isArray(subcontas) ? subcontas : [];
  if (!safeSubcontas.length) {
    companySubaccountSessionsList.innerHTML = `
      <li>
        <div>
          <strong>Nenhuma sessão ativa de subconta</strong>
          <small>Não há sessões para gerenciar no momento.</small>
        </div>
      </li>
    `;
    return;
  }

  safeSubcontas.forEach((subconta) => {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `${subconta?.nome || subconta?.email || 'Subconta'} (${Number(subconta?.sessions_total || 0)} sessão(ões))`;
    const desc = document.createElement('small');
    desc.textContent = `${subconta?.email || '-'} | ${mapRoleLabel(subconta?.role, subconta?.role_label || '')}`;
    info.appendChild(title);
    info.appendChild(desc);
    li.appendChild(info);

    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'status-stack';

    const btnAll = document.createElement('button');
    btnAll.type = 'button';
    btnAll.className = 'btn btn-tertiary';
    btnAll.textContent = 'Encerrar todas';
    btnAll.dataset.action = 'encerrar-todas';
    btnAll.dataset.subcontaId = String(subconta?.cliente_id || '');
    btnAll.disabled = Number(subconta?.sessions_total || 0) < 1;
    actionsWrap.appendChild(btnAll);

    const safeSessions = Array.isArray(subconta?.sessions) ? subconta.sessions : [];
    safeSessions.forEach((session) => {
      const btnSession = document.createElement('button');
      btnSession.type = 'button';
      btnSession.className = 'btn btn-tertiary';
      btnSession.textContent = `Encerrar ${session?.device_label || 'sessão'}`;
      btnSession.dataset.action = 'encerrar-uma';
      btnSession.dataset.subcontaId = String(subconta?.cliente_id || '');
      btnSession.dataset.sessionId = String(session?.session_id || '');
      actionsWrap.appendChild(btnSession);
    });

    li.appendChild(actionsWrap);
    companySubaccountSessionsList.appendChild(li);
  });
}

async function submitSubaccountSessionAction(actionType, subcontaId, sessionId = '') {
  const id = Number(subcontaId || 0);
  if (!id) return;

  const endpoint = actionType === 'encerrar-todas'
    ? `/cliente/empresa/subcontas/${id}/sessoes/encerrar-todas`
    : `/cliente/empresa/subcontas/${id}/sessoes/${encodeURIComponent(String(sessionId || ''))}/encerrar`;

  try {
    const { res, data } = await apiFetchJson(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Ação de segurança da conta principal' }),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        if (isPasswordChangeRequiredResponse(res, data)) {
          redirectToLoginForAuthFailure(res, data);
          return;
        }
        clearClientSessionAndRedirect();
        return;
      }
      const msg = (data && typeof data === 'object' && (data.detail || data.msg))
        ? (data.detail || data.msg)
        : 'Não foi possível encerrar a sessão da subconta.';
      throw new Error(msg);
    }
    setCompanySubaccountSessionsFeedback(data?.msg || 'Sessões atualizadas com sucesso.', 'success');
    await loadCompanyWorkspace({ silent: true });
  } catch (err) {
    console.error('Erro ao gerenciar sessões de subcontas:', err);
    setCompanySubaccountSessionsFeedback(err?.message || 'Não foi possível concluir a ação.', 'error');
  }
}

function renderCompanySummary(company) {
  const safe = company && typeof company === 'object' ? company : {};
  const status = String(safe.status || 'inactive').toLowerCase();
  const seatsTotal = Number(
    safe.seats_total ?? safe.assentos_total ?? safe.limite_acessos ?? 0
  );
  const seatsOccupied = Number(
    safe.seats_occupied ?? safe.assentos_ocupados ?? safe.subcontas_utilizadas ?? 0
  );
  const seatsReserved = Number(
    safe.seats_reserved ?? safe.assentos_reservados ?? 0
  );
  const seatsAvailable = Number(
    safe.seats_available ?? safe.assentos_disponiveis ?? safe.subcontas_disponiveis ?? 0
  );
  if (companySummaryStatus) {
    companySummaryStatus.textContent = status === 'active' ? 'Ativa' : 'Inativa';
    companySummaryStatus.classList.toggle('security-badge--danger', status !== 'active');
  }
  if (companySummaryName) companySummaryName.textContent = safe.nome_empresa || 'Não vinculada';
  if (companySummaryCnpj) companySummaryCnpj.textContent = safe.cnpj || '-';
  if (companySummaryLimit) companySummaryLimit.textContent = String(Math.max(0, seatsTotal));
  if (companySummaryUsers) companySummaryUsers.textContent = String(Number(safe.total_usuarios_vinculados || 0));
  if (companySummaryUsed) companySummaryUsed.textContent = String(Math.max(0, seatsOccupied));
  if (companySummaryReserved) companySummaryReserved.textContent = String(Math.max(0, seatsReserved));
  if (companySummaryAvailable) companySummaryAvailable.textContent = String(Math.max(0, seatsAvailable));
  if (companyViewerRole) {
    companyViewerRole.textContent = mapRoleLabel(currentAuthContext?.role, currentAuthContext?.role_label || '');
  }
  if (companySummaryOwner) {
    const ownerName = String(safe.owner_nome || '').trim();
    const ownerEmail = String(safe.owner_email || '').trim();
    companySummaryOwner.textContent = ownerName || ownerEmail || '-';
  }
}

async function loadCompanyWorkspace({ silent = false } = {}) {
  const hasCompanyUi = companySummaryName || companyUsersList || companyTicketsList;
  if (!hasCompanyUi) return;

  try {
    const { res, data } = await apiFetchJson('/cliente/empresa/perfil', { method: 'GET' });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        if (isPasswordChangeRequiredResponse(res, data)) {
          redirectToLoginForAuthFailure(res, data);
          return;
        }
        clearClientSessionAndRedirect();
        return;
      }
      if (res.status === 404) {
        currentCompanyWorkspace = null;
        renderCompanySummary(null);
        renderCompanyUsers([]);
        renderCompanyTickets([]);
        renderCompanySubaccountSessions([]);
        applyRoleBasedUi();
        return;
      }
      const msg = (data && typeof data === 'object' && (data.detail || data.msg))
        ? (data.detail || data.msg)
        : 'Não foi possível carregar os dados da empresa.';
      throw new Error(msg);
    }

    currentCompanyWorkspace = (data && typeof data === 'object') ? data : null;
    const viewer = currentCompanyWorkspace?.viewer;
    if (viewer && typeof viewer === 'object') {
      currentAuthContext = {
        ...currentAuthContext,
        role: viewer.role || currentAuthContext?.role,
        role_label: viewer.role_label || currentAuthContext?.role_label,
        is_company_owner: Boolean(viewer.is_company_owner),
        permissions: viewer,
      };
      if (profileRole) profileRole.textContent = mapRoleLabel(currentAuthContext?.role, currentAuthContext?.role_label || '');
    }
    renderCompanySummary(data?.company || null);
    renderCompanyUsers(data?.usuarios || []);
    renderCompanyTickets(data?.tickets || []);
    renderCompanySubaccountSessions(data?.subcontas_sessoes || []);
    applyRoleBasedUi();
  } catch (err) {
    console.error('Erro ao carregar contexto da empresa:', err);
    if (!silent) {
      toast(err?.message || 'Não foi possível carregar o contexto da empresa.', 'error');
    }
  }
}

async function submitCompanyTicket() {
  if (!companyTicketSubmit) return;
  const titulo = String(companyTicketTitle?.value || '').trim();
  const descricao = String(companyTicketDescription?.value || '').trim();
  const prioridade = String(companyTicketPriority?.value || 'media');

  if (titulo.length < 3) {
    setCompanyTicketFeedback('Informe um título para o ticket.', 'error');
    return;
  }

  setCompanyTicketFeedback('');
  setButtonLoading(companyTicketSubmit, true, 'Criando...');
  try {
    const payload = { titulo, descricao, prioridade };
    const { res, data } = await apiFetchJson('/cliente/empresa/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        if (isPasswordChangeRequiredResponse(res, data)) {
          redirectToLoginForAuthFailure(res, data);
          return;
        }
        clearClientSessionAndRedirect();
        return;
      }
      const msg = (data && typeof data === 'object' && (data.detail || data.msg))
        ? (data.detail || data.msg)
        : 'Não foi possível criar o ticket.';
      throw new Error(msg);
    }

    if (companyTicketTitle) companyTicketTitle.value = '';
    if (companyTicketDescription) companyTicketDescription.value = '';
    setCompanyTicketFeedback(data?.msg || 'Ticket criado com sucesso.', 'success');
    await loadCompanyWorkspace({ silent: true });
  } catch (err) {
    console.error('Erro ao criar ticket da empresa:', err);
    setCompanyTicketFeedback(err?.message || 'Não foi possível criar o ticket.', 'error');
  } finally {
    setButtonLoading(companyTicketSubmit, false);
  }
}

function setupCompanyActions() {
  if (companyTicketSubmit && companyTicketSubmit.dataset.bound !== '1') {
    companyTicketSubmit.addEventListener('click', () => {
      submitCompanyTicket();
    });
    companyTicketSubmit.dataset.bound = '1';
  }

  if (companySessionsRefreshBtn && companySessionsRefreshBtn.dataset.bound !== '1') {
    companySessionsRefreshBtn.addEventListener('click', () => {
      loadCompanyWorkspace();
    });
    companySessionsRefreshBtn.dataset.bound = '1';
  }

  if (companySubaccountSessionsList && companySubaccountSessionsList.dataset.bound !== '1') {
    companySubaccountSessionsList.addEventListener('click', (event) => {
      const btn = event.target?.closest?.('button[data-action]');
      if (!btn) return;
      const action = String(btn.dataset.action || '');
      const subcontaId = btn.dataset.subcontaId || '';
      const sessionId = btn.dataset.sessionId || '';
      if (!action || !subcontaId) return;
      submitSubaccountSessionAction(action, subcontaId, sessionId);
    });
    companySubaccountSessionsList.dataset.bound = '1';
  }
}

function hasUnsavedChanges() {
  if (!baselineFormHash) return false;
  return isComparableFormDirty(collectComparableForm(), baselineFormHash);
}

function updateDirtyState({ userInitiated = false } = {}) {
  if (!dirtyTrackingEnabled) {
    if (profileSaveBanner) profileSaveBanner.hidden = true;
    return;
  }

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
  const isOwner = isCurrentCompanyOwner();
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

  if (isOwner && cnpj && cnpj.length !== 14) {
    out.push({ field: 'cnpj', message: 'CNPJ deve conter 14 dígitos.' });
  }

  if (telefone && telefone.length < 10) {
    out.push({ field: 'telefone', message: 'Telefone deve conter DDD e número.' });
  }

  if (isOwner && !estadoUf) {
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
  const details = await fetchProfileDetailsFromApi();
  if (details) hydrateProfileDetailsFromApi(details);
  finalizeProfileHydration();
}

function fillProfileForm(data, { syncBaseline = false, refreshDirty = true } = {}) {
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

    if ('areasInteresse' in profile) {
      setAreasInteresse(profile.areasInteresse);
    }

    if ('prefEditais' in profile) setChecked('prefEditais', !!profile.prefEditais);
    if ('prefPrazo' in profile) setChecked('prefPrazo', !!profile.prefPrazo);
    if ('prefRelatorio' in profile) setChecked('prefRelatorio', !!profile.prefRelatorio);
    if ('prefSistema' in profile) setChecked('prefSistema', !!profile.prefSistema);
    if ('themePreference' in profile) {
      const prefTheme = window.AthosTheme?.resolveProfilePreference
        ? window.AthosTheme.resolveProfilePreference(profile.themePreference)
        : normalizeThemePreference(profile.themePreference);
      setValue('prefTheme', prefTheme);
      if (window.AthosTheme?.setPreference) {
        window.AthosTheme.setPreference(prefTheme);
      }
    }
  } finally {
    isHydratingProfile = false;
    applyRoleBasedUi();
    if (syncBaseline) {
      syncBaselineSnapshot({ resetInteraction: true });
    }
    if (refreshDirty) updateDirtyState();
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
  applyRoleBasedUi();
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
