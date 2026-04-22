import { runAfterFirstPaint, runWhenIdle } from './bootstrap-utils.js?v=20260422.3';

const DASHBOARD_BOOTSTRAP_DEBUG_TAG = '[BOOTSTRAP][Dashboard]';
const DASHBOARD_BOOTSTRAP_DEBUG_STORAGE_KEY = 'athos_bootstrap_debug';

function isDashboardBootstrapDebugEnabled() {
  try {
    if (window.ATHOS_BOOTSTRAP_DEBUG === true) return true;
  } catch (_) {}

  const host = String(window.location.hostname || '').toLowerCase();
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    return true;
  }

  try {
    const value = String(
      localStorage.getItem(DASHBOARD_BOOTSTRAP_DEBUG_STORAGE_KEY) ||
      sessionStorage.getItem(DASHBOARD_BOOTSTRAP_DEBUG_STORAGE_KEY) ||
      ''
    )
      .trim()
      .toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
  } catch (_) {
    return false;
  }
}

function createDashboardBootstrapLogger(logStep) {
  const debugEnabled = isDashboardBootstrapDebugEnabled();

  const emit = (event, details) => {
    if (typeof logStep === 'function') {
      try {
        logStep(event, details);
      } catch (_) {}
      return;
    }
    if (!debugEnabled) return;
    if (details === undefined) {
      console.info(`${DASHBOARD_BOOTSTRAP_DEBUG_TAG} ${event}`);
      return;
    }
    console.info(`${DASHBOARD_BOOTSTRAP_DEBUG_TAG} ${event}`, details);
  };

  const emitError = (event, error, details = {}) => {
    const payload = {
      ...(details && typeof details === 'object' ? details : {}),
      error,
    };
    if (typeof logStep === 'function') {
      try {
        logStep(event, payload);
      } catch (_) {}
    }
    console.error(`${DASHBOARD_BOOTSTRAP_DEBUG_TAG} ${event}`, payload);
  };

  return { emit, emitError };
}

export async function runProfileBootstrapFlow({
  bootstrapAuthFromUrl,
  bootstrapTheme,
  checkAuth,
  hydrateProfileShellFromBootstrap,
  setupUI,
  setupCookiePreferences,
  setupSecurityActions,
  setupCompanyActions,
  closeDeleteAccountModal,
  markAppReady,
  loadProfileDetailsInBackground,
  onBackgroundError,
} = {}) {
  bootstrapAuthFromUrl?.();
  bootstrapTheme?.();

  const me = await checkAuth?.();
  if (!me) {
    return {
      me: null,
      backgroundPromise: Promise.resolve(null),
    };
  }

  hydrateProfileShellFromBootstrap?.(me);
  setupUI?.();
  setupCookiePreferences?.();
  setupSecurityActions?.();
  setupCompanyActions?.();
  closeDeleteAccountModal?.();
  markAppReady?.();

  const backgroundPromise = Promise.resolve()
    .then(() => loadProfileDetailsInBackground?.())
    .catch((error) => {
      onBackgroundError?.(error);
      return null;
    });

  return { me, backgroundPromise };
}

export async function runDashboardBootstrapFlow({
  bootstrapAuthFromUrl,
  bootstrapChatSessionState,
  bootstrapTheme,
  checkAuth,
  hydrateSidebarUser,
  prepareShell,
  markAppReady,
  loadEditais,
  loadFavoritos,
  onEditaisReady,
  onDeepLinkReady,
  onFavoritosReady,
  onFavoritosError,
  onAuthError,
  logStep,
} = {}) {
  const logger = createDashboardBootstrapLogger(logStep);
  logger.emit('init_start');

  logger.emit('bootstrapAuthFromUrl_start');
  try {
    bootstrapAuthFromUrl?.();
    logger.emit('bootstrapAuthFromUrl_done');
  } catch (error) {
    logger.emitError('bootstrapAuthFromUrl_error', error);
  }

  logger.emit('bootstrapChatSessionState_start');
  try {
    bootstrapChatSessionState?.();
    logger.emit('bootstrapChatSessionState_done');
  } catch (error) {
    logger.emitError('bootstrapChatSessionState_error', error);
  }

  logger.emit('bootstrapTheme_start');
  try {
    bootstrapTheme?.();
    logger.emit('bootstrapTheme_done');
  } catch (error) {
    logger.emitError('bootstrapTheme_error', error);
  }

  logger.emit('checkAuth_start');
  let me = null;
  try {
    me = await checkAuth?.();
    logger.emit('checkAuth_done', { authenticated: Boolean(me) });
  } catch (error) {
    logger.emitError('checkAuth_error', error);
    try {
      onAuthError?.(error);
    } catch (authErrorHandlerError) {
      logger.emitError('checkAuth_error', authErrorHandlerError, {
        handler: 'onAuthError',
      });
    }
    return {
      me: null,
      favoritosPromise: Promise.resolve({ status: 'fulfilled', value: null }),
    };
  }

  if (!me) {
    return {
      me: null,
      favoritosPromise: Promise.resolve({ status: 'fulfilled', value: null }),
    };
  }

  logger.emit('hydrateSidebarUser_start');
  try {
    hydrateSidebarUser?.(me);
    logger.emit('hydrateSidebarUser_done');
  } catch (error) {
    logger.emitError('hydrateSidebarUser_error', error);
  }

  logger.emit('prepareShell_start');
  try {
    prepareShell?.();
    logger.emit('prepareShell_done');
  } catch (error) {
    logger.emitError('prepareShell_error', error);
  }

  logger.emit('markAppReady_start');
  try {
    markAppReady?.();
    logger.emit('markAppReady_done');
  } catch (error) {
    logger.emitError('markAppReady_error', error);
  }

  let editaisReady = false;
  logger.emit('loadEditais_start');
  try {
    await runAfterFirstPaint(() => loadEditais?.());
    editaisReady = true;
    logger.emit('loadEditais_done');
  } catch (error) {
    logger.emitError('loadEditais_error', error);
  }

  logger.emit('onEditaisReady_start');
  try {
    if (editaisReady) {
      await onEditaisReady?.({ editaisReady });
    }
    logger.emit('onEditaisReady_done', { skipped: !editaisReady });
  } catch (error) {
    logger.emitError('onEditaisReady_error', error);
  }

  logger.emit('onDeepLinkReady_start');
  try {
    await onDeepLinkReady?.({ editaisReady });
    logger.emit('onDeepLinkReady_done', { editaisReady });
  } catch (error) {
    logger.emitError('onDeepLinkReady_error', error);
  }

  const favoritosPromise = runWhenIdle(async () => {
    logger.emit('loadFavoritos_start');
    try {
      const value = await loadFavoritos?.();
      logger.emit('loadFavoritos_done');
      return value;
    } catch (error) {
      logger.emitError('loadFavoritos_error', error);
      throw error;
    }
  });
  const favoritosSettledPromise = Promise.allSettled([favoritosPromise]).then((results) => {
    const [result] = results;
    if (result?.status === "fulfilled") {
      try {
        onFavoritosReady?.({ editaisReady });
      } catch (error) {
        logger.emitError('onFavoritosReady_error', error, { editaisReady });
      }
    } else if (result?.status === "rejected") {
      try {
        onFavoritosError?.(result.reason);
      } catch (error) {
        logger.emitError('onFavoritosError_error', error);
      }
    }
    return result;
  });

  return { me, favoritosPromise: favoritosSettledPromise };
}
