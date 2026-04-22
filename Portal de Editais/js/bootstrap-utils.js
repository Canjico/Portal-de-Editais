export function createSingleFlight(task) {
  if (typeof task !== 'function') {
    throw new TypeError('createSingleFlight requer uma função assíncrona.');
  }

  let inFlight = null;
  return function runSingleFlight(...args) {
    if (inFlight) return inFlight;
    inFlight = Promise.resolve().then(() => task(...args));
    return inFlight;
  };
}

function scheduleMacroTask(callback) {
  if (typeof setTimeout === 'function') {
    setTimeout(callback, 0);
    return;
  }
  Promise.resolve().then(callback);
}

export function runAfterFirstPaint(task, { windowObject = globalThis.window } = {}) {
  if (typeof task !== 'function') {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const execute = () => {
      Promise.resolve()
        .then(() => task())
        .then(resolve, reject);
    };

    const requestAnimationFrameFn = (
      windowObject && typeof windowObject.requestAnimationFrame === 'function'
    )
      ? windowObject.requestAnimationFrame.bind(windowObject)
      : null;

    if (!requestAnimationFrameFn) {
      scheduleMacroTask(execute);
      return;
    }

    requestAnimationFrameFn(() => {
      scheduleMacroTask(execute);
    });
  });
}

export function runWhenIdle(task, { windowObject = globalThis.window, timeout = 1200 } = {}) {
  if (typeof task !== 'function') {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const execute = () => {
      Promise.resolve()
        .then(() => task())
        .then(resolve, reject);
    };

    const requestIdleCallbackFn = (
      windowObject && typeof windowObject.requestIdleCallback === 'function'
    )
      ? windowObject.requestIdleCallback.bind(windowObject)
      : null;

    if (!requestIdleCallbackFn) {
      scheduleMacroTask(execute);
      return;
    }

    requestIdleCallbackFn(() => {
      execute();
    }, { timeout: Math.max(0, Number(timeout) || 0) });
  });
}
