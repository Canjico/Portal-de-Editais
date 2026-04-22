const CACHE_SCHEMA_VERSION = '20260417.1';
const CACHE_PREFIX = `athos:cache:${CACHE_SCHEMA_VERSION}`;
const CACHE_HINT_KEY = `${CACHE_PREFIX}:namespace_hint`;
const CACHE_VERSION_FALLBACK = 'v1';

const IDB_NAME = 'athos_cache_store';
const IDB_VERSION = 1;
const IDB_STORE = 'entries';
const DEFAULT_IDB_TIMEOUT_MS = 1200;

const memoryFallback = {
  local: new Map(),
  session: new Map(),
  idb: new Map(),
};

let activeNamespace = '';
let idbOpenPromise = null;

function getGlobalContext() {
  if (typeof window !== 'undefined') return window;
  if (typeof globalThis !== 'undefined') return globalThis;
  return {};
}

function nowMs() {
  return Date.now();
}

function resolveSafeTimeoutMs(rawValue, fallbackMs = DEFAULT_IDB_TIMEOUT_MS) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return Math.max(50, Number(fallbackMs) || DEFAULT_IDB_TIMEOUT_MS);
  return Math.max(50, Math.floor(parsed));
}

function getIdbTimeoutMs() {
  const ctx = getGlobalContext();
  return resolveSafeTimeoutMs(
    ctx?.__ATHOS_CACHE_IDB_TIMEOUT_MS ?? ctx?.__ATHOS_CACHE_IDB_OPEN_TIMEOUT_MS,
    DEFAULT_IDB_TIMEOUT_MS
  );
}

function safeJsonParse(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function normalizeNamespace(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9:_\-@.]/g, '')
    .slice(0, 120);
}

function normalizeVersion(value) {
  const raw = String(value || '').trim();
  return raw || CACHE_VERSION_FALLBACK;
}

function normalizeScope(scope) {
  const raw = String(scope || 'local').trim().toLowerCase();
  if (raw === 'local' || raw === 'session' || raw === 'idb') return raw;
  return 'local';
}

function sanitizeTtl(ttlMs, fallbackMs) {
  const ttl = Number(ttlMs);
  if (!Number.isFinite(ttl) || ttl < 0) return Math.max(0, Number(fallbackMs) || 0);
  return Math.floor(ttl);
}

function sanitizeKey(key) {
  return String(key || '').trim();
}

function sanitizeGroup(group) {
  return String(group || '').trim();
}

function buildStorageKey(namespace, key) {
  return `${CACHE_PREFIX}:${namespace}:${key}`;
}

function resolveStorage(scope) {
  const ctx = getGlobalContext();
  const normalizedScope = normalizeScope(scope);
  if (normalizedScope === 'local') {
    try {
      if (ctx.localStorage) return ctx.localStorage;
    } catch (_) {}
    return null;
  }
  if (normalizedScope === 'session') {
    try {
      if (ctx.sessionStorage) return ctx.sessionStorage;
    } catch (_) {}
    return null;
  }
  return null;
}

function normalizeTokenFingerprintSeed(token) {
  return String(token || '').trim();
}

export function buildTokenFingerprint(token) {
  const seed = normalizeTokenFingerprintSeed(token);
  if (!seed) return '';
  // FNV-1a 32-bit (suficiente para diferenciar sessao sem armazenar token).
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function readNamespaceHint() {
  const storage = resolveStorage('local');
  if (!storage) return null;
  try {
    const raw = storage.getItem(CACHE_HINT_KEY);
    if (!raw) return null;
    const parsed = safeJsonParse(raw, null);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      namespace: normalizeNamespace(parsed.namespace),
      tokenFingerprint: String(parsed.token_fingerprint || '').trim(),
      updatedAt: Number(parsed.updated_at || 0) || 0,
    };
  } catch (_) {
    return null;
  }
}

function writeNamespaceHint(namespace, tokenFingerprint) {
  const storage = resolveStorage('local');
  if (!storage) return false;
  try {
    storage.setItem(
      CACHE_HINT_KEY,
      JSON.stringify({
        namespace: normalizeNamespace(namespace),
        token_fingerprint: String(tokenFingerprint || '').trim(),
        updated_at: nowMs(),
      })
    );
    return true;
  } catch (_) {
    return false;
  }
}

export function clearCacheNamespaceHint() {
  const storage = resolveStorage('local');
  if (!storage) return;
  try {
    storage.removeItem(CACHE_HINT_KEY);
  } catch (_) {}
}

export function setActiveCacheNamespace(namespace) {
  activeNamespace = normalizeNamespace(namespace);
  return activeNamespace;
}

export function getActiveCacheNamespace() {
  return activeNamespace;
}

export function createCacheNamespaceForUser(userLike) {
  const user = userLike && typeof userLike === 'object' ? userLike : {};
  const id = Number(user.id || user.cliente_id || 0);
  if (Number.isFinite(id) && id > 0) {
    return normalizeNamespace(`u:${id}`);
  }
  const email = String(user.email || user.usuario_email || '').trim().toLowerCase();
  if (email) {
    return normalizeNamespace(`e:${email}`);
  }
  return '';
}

export function activateCacheNamespaceForUser(userLike, { token } = {}) {
  const namespace = createCacheNamespaceForUser(userLike);
  if (!namespace) return '';
  setActiveCacheNamespace(namespace);
  const tokenFingerprint = buildTokenFingerprint(token);
  if (tokenFingerprint) {
    writeNamespaceHint(namespace, tokenFingerprint);
  }
  return namespace;
}

export function restoreActiveCacheNamespaceFromToken(token) {
  const tokenFingerprint = buildTokenFingerprint(token);
  if (!tokenFingerprint) {
    activeNamespace = '';
    return '';
  }
  const hint = readNamespaceHint();
  if (!hint || !hint.namespace || !hint.tokenFingerprint) {
    activeNamespace = '';
    return '';
  }
  if (hint.tokenFingerprint !== tokenFingerprint) {
    activeNamespace = '';
    return '';
  }
  setActiveCacheNamespace(hint.namespace);
  return hint.namespace;
}

function resolveNamespace(namespace) {
  const explicit = normalizeNamespace(namespace);
  if (explicit) return explicit;
  return normalizeNamespace(activeNamespace);
}

function buildEntry({
  key,
  namespace,
  value,
  ttlMs,
  staleTtlMs,
  version,
  group,
}) {
  const now = nowMs();
  const ttl = sanitizeTtl(ttlMs, 5 * 60 * 1000);
  const staleTtl = sanitizeTtl(staleTtlMs, 0);
  const expiresAt = now + ttl;
  const staleUntil = expiresAt + staleTtl;

  return {
    schema: CACHE_SCHEMA_VERSION,
    key: sanitizeKey(key),
    namespace: normalizeNamespace(namespace),
    group: sanitizeGroup(group),
    version: normalizeVersion(version),
    created_at: now,
    updated_at: now,
    expires_at: expiresAt,
    stale_until: staleUntil,
    value,
  };
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const entry = {
    schema: String(raw.schema || ''),
    key: sanitizeKey(raw.key),
    namespace: normalizeNamespace(raw.namespace),
    group: sanitizeGroup(raw.group),
    version: normalizeVersion(raw.version),
    created_at: Number(raw.created_at || 0) || 0,
    updated_at: Number(raw.updated_at || 0) || 0,
    expires_at: Number(raw.expires_at || 0) || 0,
    stale_until: Number(raw.stale_until || 0) || 0,
    value: raw.value,
  };
  if (!entry.key || !entry.namespace) return null;
  return entry;
}

function createMiss(reason = 'miss') {
  return {
    hit: false,
    stale: false,
    reason,
    data: null,
    meta: null,
  };
}

function createHit(entry, { stale = false } = {}) {
  const now = nowMs();
  return {
    hit: true,
    stale: Boolean(stale),
    reason: stale ? 'stale' : 'fresh',
    data: entry.value,
    meta: {
      key: entry.key,
      namespace: entry.namespace,
      version: entry.version,
      group: entry.group,
      age_ms: Math.max(0, now - Number(entry.updated_at || now)),
      expires_in_ms: Math.max(0, Number(entry.expires_at || now) - now),
      expired: now > Number(entry.expires_at || 0),
    },
  };
}

function shouldTreatAsStale(entry, { allowStale, maxStaleMs }) {
  if (!allowStale) return false;
  const now = nowMs();
  const maxStale = sanitizeTtl(maxStaleMs, 0);
  const staleLimit = Math.max(
    Number(entry.stale_until || 0),
    Number(entry.expires_at || 0) + maxStale
  );
  return now <= staleLimit;
}

function readStorageEntry(scope, storageKey) {
  const normalizedScope = normalizeScope(scope);
  const storage = resolveStorage(normalizedScope);
  if (storage) {
    try {
      const raw = storage.getItem(storageKey);
      if (!raw) return null;
      return normalizeEntry(safeJsonParse(raw, null));
    } catch (_) {
      return null;
    }
  }
  return normalizeEntry(memoryFallback[normalizedScope]?.get(storageKey) || null);
}

function writeStorageEntry(scope, storageKey, entry) {
  const normalizedScope = normalizeScope(scope);
  const storage = resolveStorage(normalizedScope);
  if (storage) {
    try {
      storage.setItem(storageKey, JSON.stringify(entry));
      return true;
    } catch (_) {
      return false;
    }
  }
  memoryFallback[normalizedScope]?.set(storageKey, entry);
  return true;
}

function removeStorageEntry(scope, storageKey) {
  const normalizedScope = normalizeScope(scope);
  const storage = resolveStorage(normalizedScope);
  if (storage) {
    try {
      storage.removeItem(storageKey);
      return;
    } catch (_) {}
  }
  memoryFallback[normalizedScope]?.delete(storageKey);
}

function listStorageKeys(scope, namespace) {
  const normalizedScope = normalizeScope(scope);
  const ns = normalizeNamespace(namespace);
  if (!ns) return [];
  const prefix = `${CACHE_PREFIX}:${ns}:`;
  const storage = resolveStorage(normalizedScope);
  if (storage) {
    const out = [];
    try {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key && key.startsWith(prefix)) out.push(key);
      }
    } catch (_) {
      return [];
    }
    return out;
  }
  return Array.from(memoryFallback[normalizedScope]?.keys() || []).filter((key) => key.startsWith(prefix));
}

async function openIdb() {
  if (idbOpenPromise) return idbOpenPromise;
  const ctx = getGlobalContext();
  const indexedDb = ctx.indexedDB;
  if (!indexedDb || typeof indexedDb.open !== 'function') return null;

  idbOpenPromise = new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      resolve(value || null);
    };

    try {
      const request = indexedDb.open(IDB_NAME, IDB_VERSION);
      timeoutId = setTimeout(() => finish(null), getIdbTimeoutMs());

      request.onupgradeneeded = () => {
        try {
          const db = request.result;
          if (db && !db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE, { keyPath: 'storage_key' });
          }
        } catch (_) {
          finish(null);
        }
      };

      request.onsuccess = () => finish(request.result);
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch (_) {
      finish(null);
    }
  });

  const db = await idbOpenPromise;
  if (!db) {
    idbOpenPromise = null;
  }
  return db;
}

function withIdbStore(db, mode, executor) {
  return new Promise((resolve) => {
    if (!db) {
      resolve(null);
      return;
    }

    let settled = false;
    let timeoutId = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      resolve(value);
    };

    try {
      const tx = db.transaction(IDB_STORE, mode);
      const store = tx.objectStore(IDB_STORE);
      timeoutId = setTimeout(() => finish(null), getIdbTimeoutMs());

      if (typeof tx.addEventListener === 'function') {
        tx.addEventListener('abort', () => finish(null), { once: true });
        tx.addEventListener('error', () => finish(null), { once: true });
      }

      const result = executor(store, tx, finish);
      if (result !== undefined) {
        finish(result);
      }
    } catch (_) {
      finish(null);
    }
  });
}

async function readIdbEntry(storageKey) {
  const db = await openIdb();
  if (!db) return normalizeEntry(memoryFallback.idb.get(storageKey) || null);
  return withIdbStore(db, 'readonly', (store, tx, resolve) => {
    try {
      const req = store.get(storageKey);
      req.onsuccess = () => {
        const record = req.result;
        resolve(normalizeEntry(record?.entry || null));
      };
      req.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

async function writeIdbEntry(storageKey, entry) {
  const db = await openIdb();
  if (!db) {
    memoryFallback.idb.set(storageKey, entry);
    return true;
  }
  return withIdbStore(db, 'readwrite', (store, tx, resolve) => {
    try {
      const req = store.put({
        storage_key: storageKey,
        namespace: entry.namespace,
        group: entry.group || '',
        updated_at: Number(entry.updated_at || nowMs()),
        entry,
      });
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch (_) {
      resolve(false);
    }
  });
}

async function removeIdbEntry(storageKey) {
  const db = await openIdb();
  if (!db) {
    memoryFallback.idb.delete(storageKey);
    return;
  }
  await withIdbStore(db, 'readwrite', (store, tx, resolve) => {
    try {
      const req = store.delete(storageKey);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch (_) {
      resolve(false);
    }
  });
}

async function listIdbRecordsByNamespace(namespace) {
  const ns = normalizeNamespace(namespace);
  if (!ns) return [];
  const db = await openIdb();
  if (!db) {
    const out = [];
    const prefix = `${CACHE_PREFIX}:${ns}:`;
    memoryFallback.idb.forEach((entry, storageKey) => {
      if (!storageKey.startsWith(prefix)) return;
      out.push({
        storage_key: storageKey,
        namespace: ns,
        group: sanitizeGroup(entry?.group),
        entry: normalizeEntry(entry),
      });
    });
    return out;
  }

  return withIdbStore(db, 'readonly', (store, tx, resolve) => {
    const out = [];
    try {
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        const record = cursor.value;
        if (normalizeNamespace(record?.namespace) === ns) {
          out.push(record);
        }
        cursor.continue();
      };
      req.onerror = () => resolve(out);
      tx.onabort = () => resolve(out);
    } catch (_) {
      resolve(out);
    }
  });
}

async function readEntry(scope, storageKey) {
  const normalizedScope = normalizeScope(scope);
  if (normalizedScope === 'idb') {
    return readIdbEntry(storageKey);
  }
  return readStorageEntry(normalizedScope, storageKey);
}

async function writeEntry(scope, storageKey, entry) {
  const normalizedScope = normalizeScope(scope);
  if (normalizedScope === 'idb') {
    return writeIdbEntry(storageKey, entry);
  }
  return writeStorageEntry(normalizedScope, storageKey, entry);
}

async function deleteEntry(scope, storageKey) {
  const normalizedScope = normalizeScope(scope);
  if (normalizedScope === 'idb') {
    await removeIdbEntry(storageKey);
    return;
  }
  removeStorageEntry(normalizedScope, storageKey);
}

export async function cacheGet(
  key,
  {
    scope = 'local',
    namespace = '',
    version = CACHE_VERSION_FALLBACK,
    allowStale = false,
    maxStaleMs = 0,
  } = {}
) {
  const cacheKey = sanitizeKey(key);
  const ns = resolveNamespace(namespace);
  if (!cacheKey || !ns) return createMiss('invalid_key_or_namespace');
  const storageKey = buildStorageKey(ns, cacheKey);
  const entry = await readEntry(scope, storageKey);
  if (!entry) return createMiss('not_found');

  if (normalizeVersion(version) !== normalizeVersion(entry.version)) {
    await deleteEntry(scope, storageKey);
    return createMiss('version_mismatch');
  }

  const now = nowMs();
  if (now <= Number(entry.expires_at || 0)) {
    return createHit(entry, { stale: false });
  }

  if (shouldTreatAsStale(entry, { allowStale: Boolean(allowStale), maxStaleMs })) {
    return createHit(entry, { stale: true });
  }

  await deleteEntry(scope, storageKey);
  return createMiss('expired');
}

export async function cacheSet(
  key,
  value,
  {
    scope = 'local',
    namespace = '',
    ttlMs = 5 * 60 * 1000,
    staleTtlMs = 0,
    version = CACHE_VERSION_FALLBACK,
    group = '',
  } = {}
) {
  const cacheKey = sanitizeKey(key);
  const ns = resolveNamespace(namespace);
  if (!cacheKey || !ns) return false;
  const storageKey = buildStorageKey(ns, cacheKey);
  const entry = buildEntry({
    key: cacheKey,
    namespace: ns,
    value,
    ttlMs,
    staleTtlMs,
    version,
    group,
  });
  return writeEntry(scope, storageKey, entry);
}

export async function cacheRemove(
  key,
  {
    scope = 'local',
    namespace = '',
  } = {}
) {
  const cacheKey = sanitizeKey(key);
  const ns = resolveNamespace(namespace);
  if (!cacheKey || !ns) return;
  const storageKey = buildStorageKey(ns, cacheKey);
  await deleteEntry(scope, storageKey);
}

export async function cacheInvalidateGroup(
  group,
  {
    namespace = '',
    scopes = ['local', 'session', 'idb'],
  } = {}
) {
  const targetGroup = sanitizeGroup(group);
  const ns = resolveNamespace(namespace);
  if (!targetGroup || !ns) return 0;
  const uniqueScopes = Array.from(new Set((Array.isArray(scopes) ? scopes : [scopes]).map(normalizeScope)));
  let removed = 0;

  for (const scope of uniqueScopes) {
    if (scope === 'idb') {
      const records = await listIdbRecordsByNamespace(ns);
      for (const record of records) {
        if (sanitizeGroup(record?.group) !== targetGroup) continue;
        await deleteEntry('idb', String(record.storage_key || ''));
        removed += 1;
      }
      continue;
    }

    const keys = listStorageKeys(scope, ns);
    for (const storageKey of keys) {
      const entry = readStorageEntry(scope, storageKey);
      if (!entry || sanitizeGroup(entry.group) !== targetGroup) continue;
      removeStorageEntry(scope, storageKey);
      removed += 1;
    }
  }

  return removed;
}

export async function cacheInvalidateNamespace(
  namespace = '',
  {
    scopes = ['local', 'session', 'idb'],
  } = {}
) {
  const ns = resolveNamespace(namespace);
  if (!ns) return 0;
  const uniqueScopes = Array.from(new Set((Array.isArray(scopes) ? scopes : [scopes]).map(normalizeScope)));
  let removed = 0;

  for (const scope of uniqueScopes) {
    if (scope === 'idb') {
      const records = await listIdbRecordsByNamespace(ns);
      for (const record of records) {
        await deleteEntry('idb', String(record.storage_key || ''));
        removed += 1;
      }
      continue;
    }

    const keys = listStorageKeys(scope, ns);
    for (const storageKey of keys) {
      removeStorageEntry(scope, storageKey);
      removed += 1;
    }
  }

  return removed;
}

export async function clearActiveUserCache({
  clearHint = true,
  scopes = ['local', 'session', 'idb'],
} = {}) {
  const ns = resolveNamespace('');
  if (ns) {
    await cacheInvalidateNamespace(ns, { scopes });
  }
  activeNamespace = '';
  if (clearHint) {
    clearCacheNamespaceHint();
  }
}

function bindLogoutCacheCleanup() {
  const ctx = getGlobalContext();
  if (!ctx || !ctx.addEventListener) return;
  if (ctx.__athosCacheLogoutCleanupBound) return;
  ctx.__athosCacheLogoutCleanupBound = true;
  ctx.addEventListener('athos:logout', () => {
    void clearActiveUserCache({ clearHint: true });
  });
}

bindLogoutCacheCleanup();
