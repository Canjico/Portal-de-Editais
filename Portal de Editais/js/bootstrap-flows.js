function didBootstrapAuthToken(result) {
  if (result === true) return true;
  if (result && typeof result === 'object' && result.tokenStored === true) return true;
  return false;
}

function hasStoredToken(getStoredToken) {
  if (typeof getStoredToken !== 'function') return false;
  try {
    return Boolean(String(getStoredToken() || '').trim());
  } catch (_) {
    return false;
  }
}

function shouldUseAuthHandoff(handoff, bootstrapAuthResult, getStoredToken) {
  if (!handoff || typeof handoff !== 'object') return false;
  if (didBootstrapAuthToken(bootstrapAuthResult)) return true;
  if (bootstrapAuthResult === undefined && hasStoredToken(getStoredToken)) return true;
  if (bootstrapAuthResult === undefined && typeof getStoredToken !== 'function') return true;
  return false;
}

export async function runProfileBootstrapFlow({
  bootstrapAuthFromUrl,
  bootstrapTheme,
  getStoredToken,
  readAuthHandoff,
  checkAuth,
  onAuthConfirmed,
  onAuthConfirmationError,
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
  const bootstrapAuthResult = bootstrapAuthFromUrl?.();
  bootstrapTheme?.();

  const handoff = readAuthHandoff?.({ consume: true });
  const hasFreshHandoff = shouldUseAuthHandoff(handoff, bootstrapAuthResult, getStoredToken);

  const me = hasFreshHandoff ? handoff : await checkAuth?.();
  if (!me) {
    return {
      me: null,
      authConfirmationPromise: Promise.resolve(null),
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

  const authConfirmationPromise = (hasFreshHandoff && typeof checkAuth === 'function')
    ? Promise.resolve()
      .then(() => checkAuth?.())
      .then((confirmed) => {
        const hasMeaningfulPayload = Boolean(
          confirmed &&
          typeof confirmed === 'object' &&
          Object.keys(confirmed).length > 0
        );
        if (hasMeaningfulPayload) onAuthConfirmed?.(confirmed);
        return confirmed || null;
      })
      .catch((error) => {
        onAuthConfirmationError?.(error);
        return null;
      })
    : Promise.resolve(me);

  const backgroundPromise = Promise.resolve()
    .then(() => loadProfileDetailsInBackground?.())
    .catch((error) => {
      onBackgroundError?.(error);
      return null;
    });

  return { me, authConfirmationPromise, backgroundPromise };
}

export async function runDashboardBootstrapFlow({
  bootstrapAuthFromUrl,
  bootstrapChatSessionState,
  bootstrapTheme,
  getStoredToken,
  readAuthHandoff,
  checkAuth,
  onAuthConfirmed,
  onAuthConfirmationError,
  hydrateSidebarUser,
  prepareShell,
  markAppReady,
  loadEditais,
  loadFavoritos,
  onEditaisReady,
  onDeepLinkReady,
  onFavoritosReady,
  onFavoritosError,
} = {}) {
  const bootstrapAuthResult = bootstrapAuthFromUrl?.();
  bootstrapChatSessionState?.();
  bootstrapTheme?.();

  const handoff = readAuthHandoff?.({ consume: true });
  const hasFreshHandoff = shouldUseAuthHandoff(handoff, bootstrapAuthResult, getStoredToken);

  const me = hasFreshHandoff ? handoff : await checkAuth?.();
  if (!me) {
    return {
      me: null,
      authConfirmationPromise: Promise.resolve(null),
      favoritosPromise: Promise.resolve({ status: "fulfilled", value: null }),
    };
  }

  hydrateSidebarUser?.(me);
  prepareShell?.();
  markAppReady?.();

  const authConfirmationPromise = (hasFreshHandoff && typeof checkAuth === 'function')
    ? Promise.resolve()
      .then(() => checkAuth?.())
      .then((confirmed) => {
        const hasMeaningfulPayload = Boolean(
          confirmed &&
          typeof confirmed === 'object' &&
          Object.keys(confirmed).length > 0
        );
        if (hasMeaningfulPayload) onAuthConfirmed?.(confirmed);
        return confirmed || null;
      })
      .catch((error) => {
        onAuthConfirmationError?.(error);
        return null;
      })
    : Promise.resolve(me);

  let editaisReady = false;
  const favoritosPromise = Promise.resolve().then(() => loadFavoritos?.());
  const favoritosSettledPromise = Promise.allSettled([favoritosPromise]).then((results) => {
    const [result] = results;
    if (result?.status === "fulfilled") {
      onFavoritosReady?.({ editaisReady });
    } else if (result?.status === "rejected") {
      onFavoritosError?.(result.reason);
    }
    return result;
  });

  await loadEditais?.();
  editaisReady = true;
  await onEditaisReady?.();
  await onDeepLinkReady?.();

  return { me, authConfirmationPromise, favoritosPromise: favoritosSettledPromise };
}
