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
} = {}) {
  bootstrapAuthFromUrl?.();
  bootstrapChatSessionState?.();
  bootstrapTheme?.();

  const me = await checkAuth?.();
  if (!me) {
    return {
      me: null,
      favoritosPromise: Promise.resolve({ status: "fulfilled", value: null }),
    };
  }

  hydrateSidebarUser?.(me);
  prepareShell?.();
  markAppReady?.();

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

  return { me, favoritosPromise: favoritosSettledPromise };
}
