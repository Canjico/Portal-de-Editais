import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function createEventTarget() {
  const listeners = new Map();

  return {
    addEventListener(type, handler, options = {}) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ handler, once: Boolean(options?.once) });
    },
    removeEventListener(type, handler) {
      const entries = listeners.get(type) || [];
      listeners.set(
        type,
        entries.filter((entry) => entry.handler !== handler)
      );
    },
    dispatchEvent(event) {
      const type = typeof event === 'string' ? event : event?.type;
      if (!type) return false;
      const entries = (listeners.get(type) || []).slice();
      entries.forEach((entry) => {
        entry.handler.call(this, event);
      });
      listeners.set(
        type,
        (listeners.get(type) || []).filter((entry) => !entry.once)
      );
      return true;
    },
  };
}

function createStorageStub() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(String(key));
    },
  };
}

function buildPresenceSandbox() {
  const timeoutTasks = new Map();
  const intervalTasks = new Map();
  let timerId = 1;
  const fetchCalls = [];

  const windowTarget = createEventTarget();
  const documentTarget = createEventTarget();

  const bodyClasses = new Set(['app-loading']);
  const body = {
    classList: {
      add(name) {
        bodyClasses.add(String(name));
      },
      remove(name) {
        bodyClasses.delete(String(name));
      },
      contains(name) {
        return bodyClasses.has(String(name));
      },
    },
  };

  const windowObject = {
    ...windowTarget,
    location: { pathname: '/Portal%20de%20Editais/index.html' },
    localStorage: createStorageStub(),
    sessionStorage: createStorageStub(),
  };

  const documentObject = {
    ...documentTarget,
    readyState: 'complete',
    visibilityState: 'visible',
    body,
  };

  function setTimeoutMock(callback, _delay) {
    const id = timerId++;
    timeoutTasks.set(id, callback);
    return id;
  }

  function clearTimeoutMock(id) {
    timeoutTasks.delete(id);
  }

  function setIntervalMock(callback, _delay) {
    const id = timerId++;
    intervalTasks.set(id, callback);
    return id;
  }

  function clearIntervalMock(id) {
    intervalTasks.delete(id);
  }

  async function fetchMock(url, options = {}) {
    fetchCalls.push({ url: String(url), options });
    return { ok: true, status: 200 };
  }

  function runAllTimeouts() {
    const jobs = Array.from(timeoutTasks.entries());
    timeoutTasks.clear();
    jobs.forEach(([, callback]) => callback());
  }

  const sandbox = {
    window: windowObject,
    document: documentObject,
    localStorage: windowObject.localStorage,
    sessionStorage: windowObject.sessionStorage,
    Intl,
    Date,
    Math,
    Promise,
    JSON,
    setTimeout: setTimeoutMock,
    clearTimeout: clearTimeoutMock,
    setInterval: setIntervalMock,
    clearInterval: clearIntervalMock,
    fetch: fetchMock,
    console,
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  sandbox.window.setTimeout = setTimeoutMock;
  sandbox.window.clearTimeout = clearTimeoutMock;
  sandbox.window.setInterval = setIntervalMock;
  sandbox.window.clearInterval = clearIntervalMock;
  sandbox.window.fetch = fetchMock;
  sandbox.window.Intl = Intl;
  sandbox.window.Date = Date;

  return {
    sandbox,
    fetchCalls,
    runAllTimeouts,
    body,
    windowObject,
  };
}

test('presence tracker aguarda app ready para iniciar heartbeat', async () => {
  const source = await readFile(new URL('../presence.js', import.meta.url), 'utf8');
  const { sandbox, fetchCalls, runAllTimeouts, body, windowObject } = buildPresenceSandbox();

  vm.runInNewContext(source, sandbox, { filename: 'presence.js' });

  assert.equal(fetchCalls.length, 0);

  body.classList.remove('app-loading');
  windowObject.dispatchEvent({ type: 'athos:app-ready' });
  assert.equal(fetchCalls.length, 0);

  runAllTimeouts();
  await Promise.resolve();
  await Promise.resolve();

  assert.ok(fetchCalls.length >= 1);
});
