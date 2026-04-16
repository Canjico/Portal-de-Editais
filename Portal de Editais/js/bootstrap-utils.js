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
