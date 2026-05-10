function safeAbort(controller) {
  if (!controller || typeof controller.abort !== 'function') return false;
  try {
    controller.abort();
    return true;
  } catch (_) {
    return false;
  }
}

export function createAbortableRequestTracker() {
  let activeController = null;

  return {
    getActiveController() {
      return activeController;
    },

    hasActiveController() {
      return Boolean(activeController);
    },

    setActiveController(nextController) {
      if (activeController && activeController !== nextController) {
        safeAbort(activeController);
      }
      activeController = nextController || null;
      return activeController;
    },

    clearActiveController(expectedController = null) {
      if (!expectedController) {
        activeController = null;
        return true;
      }
      if (activeController !== expectedController) {
        return false;
      }
      activeController = null;
      return true;
    },

    abortActiveController() {
      if (!activeController) return false;
      const controllerToAbort = activeController;
      activeController = null;
      safeAbort(controllerToAbort);
      return true;
    },
  };
}
