import test from 'node:test';
import assert from 'node:assert/strict';

function createStorageStub() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key(index) {
      return Array.from(map.keys())[index] || null;
    },
    getItem(key) {
      return map.has(String(key)) ? map.get(String(key)) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(String(key));
    },
    clear() {
      map.clear();
    },
  };
}

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    dispatchEvent(event) {
      const type = typeof event === 'string' ? event : event?.type;
      if (!type) return false;
      const handlers = listeners.get(type) || [];
      handlers.forEach((handler) => {
        try {
          handler.call(this, event);
        } catch (_) {}
      });
      return handlers.length > 0;
    },
  };
}

let moduleCounter = 0;
async function loadCacheModule() {
  moduleCounter += 1;
  return import(`../cache-store.js?test=${moduleCounter}`);
}

function setupBrowserStubs() {
  const localStorage = createStorageStub();
  const sessionStorage = createStorageStub();
  const windowTarget = createEventTarget();

  const windowObject = {
    ...windowTarget,
    localStorage,
    sessionStorage,
  };

  globalThis.window = windowObject;
  globalThis.localStorage = localStorage;
  globalThis.sessionStorage = sessionStorage;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('cache-store respeita TTL com stale-while-revalidate curto', async () => {
  setupBrowserStubs();
  const cache = await loadCacheModule();
  cache.setActiveCacheNamespace('u:101');

  await cache.cacheSet('dashboard.editais', { total: 3 }, {
    scope: 'local',
    ttlMs: 20,
    staleTtlMs: 80,
    version: 'v1',
    group: 'dashboard',
  });

  const fresh = await cache.cacheGet('dashboard.editais', {
    scope: 'local',
    version: 'v1',
  });
  assert.equal(fresh.hit, true);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.data.total, 3);

  await sleep(30);
  const stale = await cache.cacheGet('dashboard.editais', {
    scope: 'local',
    version: 'v1',
    allowStale: true,
    maxStaleMs: 0,
  });
  assert.equal(stale.hit, true);
  assert.equal(stale.stale, true);

  await sleep(90);
  const expired = await cache.cacheGet('dashboard.editais', {
    scope: 'local',
    version: 'v1',
    allowStale: true,
    maxStaleMs: 0,
  });
  assert.equal(expired.hit, false);
});

test('cache-store isola chaves por namespace de usuario', async () => {
  setupBrowserStubs();
  const cache = await loadCacheModule();

  cache.setActiveCacheNamespace('u:1');
  await cache.cacheSet('perfil.summary', { nome: 'Alice' }, {
    scope: 'local',
    ttlMs: 1000,
    version: 'v1',
    group: 'profile',
  });

  cache.setActiveCacheNamespace('u:2');
  const miss = await cache.cacheGet('perfil.summary', {
    scope: 'local',
    version: 'v1',
  });
  assert.equal(miss.hit, false);

  cache.setActiveCacheNamespace('u:1');
  const hit = await cache.cacheGet('perfil.summary', {
    scope: 'local',
    version: 'v1',
  });
  assert.equal(hit.hit, true);
  assert.equal(hit.data.nome, 'Alice');
});

test('cache-store restaura namespace ativo apenas quando token bate', async () => {
  setupBrowserStubs();
  const cache = await loadCacheModule();

  const ns = cache.activateCacheNamespaceForUser({ id: 88 }, { token: 'token-abc' });
  assert.equal(ns, 'u:88');

  cache.setActiveCacheNamespace('');
  const restored = cache.restoreActiveCacheNamespaceFromToken('token-abc');
  assert.equal(restored, 'u:88');

  cache.setActiveCacheNamespace('');
  const mismatch = cache.restoreActiveCacheNamespaceFromToken('token-xyz');
  assert.equal(mismatch, '');
});

test('cache-store limpa cache do usuario ativo quando recebe evento athos:logout', async () => {
  setupBrowserStubs();
  const cache = await loadCacheModule();
  cache.activateCacheNamespaceForUser({ id: 55 }, { token: 'logout-token' });

  await cache.cacheSet('dashboard.ui', { page: 3 }, {
    scope: 'local',
    ttlMs: 1000,
    version: 'v1',
    group: 'dashboard_ui',
  });

  const before = await cache.cacheGet('dashboard.ui', {
    scope: 'local',
    version: 'v1',
  });
  assert.equal(before.hit, true);

  window.dispatchEvent({ type: 'athos:logout' });
  await sleep(10);

  const after = await cache.cacheGet('dashboard.ui', {
    scope: 'local',
    version: 'v1',
  });
  assert.equal(after.hit, false);
});

test('cache-store nao bloqueia quando indexedDB.open fica pendente', async () => {
  setupBrowserStubs();
  window.__ATHOS_CACHE_IDB_TIMEOUT_MS = 60;
  window.indexedDB = {
    open() {
      return {};
    },
  };

  const cache = await loadCacheModule();
  cache.setActiveCacheNamespace('u:999');

  const startedAt = Date.now();
  const result = await cache.cacheGet('dashboard.idb.timeout', {
    scope: 'idb',
    version: 'v1',
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.hit, false);
  assert.ok(elapsedMs < 450, `cacheGet demorou demais com indexedDB pendente: ${elapsedMs}ms`);
});
