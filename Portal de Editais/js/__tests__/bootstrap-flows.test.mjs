import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runDashboardBootstrapFlow,
  runProfileBootstrapFlow,
} from '../bootstrap-flows.js';

test('perfil libera shell antes de concluir /cliente/perfil', async () => {
  const events = [];
  let resolveDetails;
  const detailsGate = new Promise((resolve) => {
    resolveDetails = resolve;
  });

  const result = await runProfileBootstrapFlow({
    bootstrapAuthFromUrl: () => events.push('bootstrap_auth'),
    bootstrapTheme: () => events.push('bootstrap_theme'),
    checkAuth: async () => ({ id: 1, nome: 'Cliente Teste' }),
    hydrateProfileShellFromBootstrap: () => events.push('hydrate_shell'),
    setupUI: () => events.push('setup_ui'),
    setupCookiePreferences: () => events.push('setup_cookies'),
    setupSecurityActions: () => events.push('setup_security'),
    setupCompanyActions: () => events.push('setup_company'),
    closeDeleteAccountModal: () => events.push('close_delete_modal'),
    markAppReady: () => events.push('mark_ready'),
    loadProfileDetailsInBackground: async () => {
      events.push('details_start');
      await detailsGate;
      events.push('details_done');
    },
  });

  assert.deepEqual(events.slice(0, 6), [
    'bootstrap_auth',
    'bootstrap_theme',
    'hydrate_shell',
    'setup_ui',
    'setup_cookies',
    'setup_security',
  ]);
  assert.ok(events.includes('mark_ready'));
  assert.ok(!events.includes('details_done'));

  resolveDetails();
  await result.backgroundPromise;
  assert.ok(events.indexOf('mark_ready') < events.indexOf('details_done'));
});

test('dashboard nao bloqueia bootstrap principal por favoritos', async () => {
  const events = [];
  let resolveFavoritos;
  const favoritosGate = new Promise((resolve) => {
    resolveFavoritos = resolve;
  });
  let favoritosCallbackPayload = null;

  const result = await runDashboardBootstrapFlow({
    bootstrapAuthFromUrl: () => events.push('bootstrap_auth'),
    bootstrapChatSessionState: () => events.push('bootstrap_chat'),
    bootstrapTheme: () => events.push('bootstrap_theme'),
    checkAuth: async () => ({ id: 2, nome: 'Dashboard User' }),
    hydrateSidebarUser: () => events.push('hydrate_sidebar'),
    prepareShell: () => events.push('prepare_shell'),
    markAppReady: () => events.push('mark_ready'),
    loadEditais: async () => events.push('load_editais'),
    loadFavoritos: async () => {
      events.push('load_favoritos_start');
      await favoritosGate;
      events.push('load_favoritos_done');
    },
    onEditaisReady: async () => events.push('editais_ready'),
    onDeepLinkReady: async () => events.push('deep_link_ready'),
    onFavoritosReady: (payload) => {
      favoritosCallbackPayload = payload;
      events.push('favoritos_ready');
    },
  });

  assert.ok(events.includes('mark_ready'));
  assert.ok(events.includes('editais_ready'));
  assert.ok(events.includes('deep_link_ready'));
  assert.ok(!events.includes('load_favoritos_done'));
  assert.ok(!events.includes('favoritos_ready'));

  resolveFavoritos();
  await result.favoritosPromise;

  assert.ok(events.includes('load_favoritos_done'));
  assert.ok(events.includes('favoritos_ready'));
  assert.equal(Boolean(favoritosCallbackPayload?.editaisReady), true);
});

test('dashboard usa handoff para liberar shell e confirma auth em background', async () => {
  const events = [];
  let resolveAuth;
  const authGate = new Promise((resolve) => {
    resolveAuth = resolve;
  });

  const result = await runDashboardBootstrapFlow({
    bootstrapAuthFromUrl: () => events.push('bootstrap_auth'),
    bootstrapChatSessionState: () => events.push('bootstrap_chat'),
    bootstrapTheme: () => events.push('bootstrap_theme'),
    readAuthHandoff: () => ({ id: 10, nome: 'Handoff User', email: 'handoff@athos.test' }),
    checkAuth: async () => {
      events.push('check_auth_start');
      const confirmed = await authGate;
      events.push('check_auth_done');
      return confirmed;
    },
    onAuthConfirmed: () => events.push('auth_confirmed'),
    hydrateSidebarUser: () => events.push('hydrate_sidebar'),
    prepareShell: () => events.push('prepare_shell'),
    markAppReady: () => events.push('mark_ready'),
    loadEditais: async () => events.push('load_editais'),
    loadFavoritos: async () => events.push('load_favoritos'),
    onEditaisReady: async () => events.push('editais_ready'),
    onDeepLinkReady: async () => events.push('deep_link_ready'),
  });

  assert.ok(events.includes('hydrate_sidebar'));
  assert.ok(events.includes('mark_ready'));
  assert.ok(events.includes('load_editais'));
  assert.ok(events.includes('load_favoritos'));
  assert.ok(events.includes('check_auth_start'));
  assert.ok(!events.includes('check_auth_done'));

  resolveAuth({ id: 10, nome: 'Handoff Confirmado' });
  await result.authConfirmationPromise;

  assert.ok(events.includes('check_auth_done'));
  assert.ok(events.includes('auth_confirmed'));
});

test('perfil usa handoff para hidratar shell e valida auth em background', async () => {
  const events = [];
  let resolveAuth;
  const authGate = new Promise((resolve) => {
    resolveAuth = resolve;
  });

  const result = await runProfileBootstrapFlow({
    bootstrapAuthFromUrl: () => events.push('bootstrap_auth'),
    bootstrapTheme: () => events.push('bootstrap_theme'),
    readAuthHandoff: () => ({ id: 7, nome: 'Perfil Handoff', email: 'perfil@athos.test' }),
    checkAuth: async () => {
      events.push('check_auth_start');
      const confirmed = await authGate;
      events.push('check_auth_done');
      return confirmed;
    },
    onAuthConfirmed: () => events.push('auth_confirmed'),
    hydrateProfileShellFromBootstrap: () => events.push('hydrate_shell'),
    setupUI: () => events.push('setup_ui'),
    setupCookiePreferences: () => events.push('setup_cookies'),
    setupSecurityActions: () => events.push('setup_security'),
    setupCompanyActions: () => events.push('setup_company'),
    closeDeleteAccountModal: () => events.push('close_delete_modal'),
    markAppReady: () => events.push('mark_ready'),
    loadProfileDetailsInBackground: async () => events.push('details_start'),
  });

  assert.ok(events.includes('hydrate_shell'));
  assert.ok(events.includes('mark_ready'));
  assert.ok(events.includes('details_start'));
  assert.ok(events.includes('check_auth_start'));
  assert.ok(!events.includes('check_auth_done'));

  resolveAuth({ id: 7, nome: 'Perfil Confirmado' });
  await result.authConfirmationPromise;

  assert.ok(events.includes('check_auth_done'));
  assert.ok(events.includes('auth_confirmed'));
});
