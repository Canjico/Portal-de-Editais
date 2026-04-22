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

test('dashboard não bloqueia bootstrap principal por favoritos', async () => {
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
  assert.ok(!events.includes('load_favoritos_start'));
  assert.ok(!events.includes('load_favoritos_done'));
  assert.ok(!events.includes('favoritos_ready'));

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(events.includes('load_favoritos_start'));
  assert.ok(!events.includes('load_favoritos_done'));

  resolveFavoritos();
  await result.favoritosPromise;

  assert.ok(events.includes('load_favoritos_done'));
  assert.ok(events.includes('favoritos_ready'));
  assert.equal(Boolean(favoritosCallbackPayload?.editaisReady), true);
  assert.ok(events.indexOf('deep_link_ready') < events.indexOf('load_favoritos_start'));
});
