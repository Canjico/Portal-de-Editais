import test from 'node:test';
import assert from 'node:assert/strict';

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
    clear() {
      map.clear();
    },
  };
}

function createResponse(status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get() {
        return '';
      },
    },
  };
}

globalThis.localStorage = createStorageStub();
globalThis.sessionStorage = createStorageStub();
globalThis.window = {
  location: {
    hostname: 'portal.atimus.agr.br',
    protocol: 'https:',
    origin: 'https://portal.atimus.agr.br',
    href: 'https://portal.atimus.agr.br/Portal%20de%20Editais/index.html',
  },
  history: {
    replaceState() {},
  },
};
globalThis.document = { title: 'Portal' };

let fetchCalls = [];
let responseQueue = [];

globalThis.fetch = async (_url, options = {}) => {
  fetchCalls.push({ options });
  const next = responseQueue.shift();
  if (!next) throw new Error('missing mocked response');
  if (next instanceof Error) throw next;
  return next;
};

const { apiFetch } = await import('../auth.js');

function resetAuthTestState() {
  fetchCalls = [];
  responseQueue = [];
  localStorage.clear();
  sessionStorage.clear();
}

test('apiFetch GET uses cookie-first without token headers on first attempt', async () => {
  resetAuthTestState();
  responseQueue = [createResponse(200)];
  sessionStorage.setItem('cliente_token', 'token-cookie-first');

  await apiFetch('/cliente/me?minimal=1', { method: 'GET' });

  assert.equal(fetchCalls.length, 1);
  const firstHeaders = fetchCalls[0].options.headers || {};
  assert.equal(fetchCalls[0].options.credentials, 'include');
  assert.equal(Object.prototype.hasOwnProperty.call(firstHeaders, 'Authorization'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(firstHeaders, 'X-Cliente-Token'), false);
});

test('apiFetch GET falls back to Authorization and X-Cliente-Token on 401', async () => {
  resetAuthTestState();
  responseQueue = [createResponse(401), createResponse(200)];
  sessionStorage.setItem('cliente_token', 'token-fallback-401');

  await apiFetch('/cliente/me?minimal=1', { method: 'GET' });

  assert.equal(fetchCalls.length, 2);
  const firstHeaders = fetchCalls[0].options.headers || {};
  const secondHeaders = fetchCalls[1].options.headers || {};

  assert.equal(Object.prototype.hasOwnProperty.call(firstHeaders, 'Authorization'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(firstHeaders, 'X-Cliente-Token'), false);
  assert.equal(String(secondHeaders.Authorization || '').startsWith('Bearer '), true);
  assert.equal(String(secondHeaders['X-Cliente-Token'] || ''), 'token-fallback-401');
});

test('apiFetch GET falls back to token headers on 403', async () => {
  resetAuthTestState();
  responseQueue = [createResponse(403), createResponse(200)];
  sessionStorage.setItem('cliente_token', 'token-fallback-403');

  await apiFetch('/cliente/me?minimal=1', { method: 'GET' });

  assert.equal(fetchCalls.length, 2);
  const firstHeaders = fetchCalls[0].options.headers || {};
  const secondHeaders = fetchCalls[1].options.headers || {};

  assert.equal(Object.prototype.hasOwnProperty.call(firstHeaders, 'Authorization'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(firstHeaders, 'X-Cliente-Token'), false);
  assert.equal(String(secondHeaders.Authorization || '').startsWith('Bearer '), true);
  assert.equal(String(secondHeaders['X-Cliente-Token'] || ''), 'token-fallback-403');
});

test('apiFetch GET does not fallback with token when status is not 401 or 403', async () => {
  resetAuthTestState();
  responseQueue = [createResponse(500)];
  sessionStorage.setItem('cliente_token', 'token-no-fallback-500');

  const res = await apiFetch('/cliente/me?minimal=1', { method: 'GET' });

  assert.equal(res.status, 500);
  assert.equal(fetchCalls.length, 1);
  const firstHeaders = fetchCalls[0].options.headers || {};
  assert.equal(Object.prototype.hasOwnProperty.call(firstHeaders, 'Authorization'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(firstHeaders, 'X-Cliente-Token'), false);
});

test('apiFetch GET enables temporary token_preferred mode after repeated cookie-first failures', async () => {
  resetAuthTestState();
  sessionStorage.setItem('cliente_token', 'token-adaptive-mode');

  responseQueue = [createResponse(401), createResponse(200)];
  await apiFetch('/cliente/me?minimal=1', { method: 'GET' });

  responseQueue = [createResponse(403), createResponse(200)];
  await apiFetch('/editais?view=card&summary=1&page=1&limit=12', { method: 'GET' });

  const adaptivePayloadRaw = sessionStorage.getItem('athos_auth_transport_mode_v1');
  assert.ok(adaptivePayloadRaw);
  const adaptivePayload = JSON.parse(adaptivePayloadRaw);
  assert.equal(adaptivePayload?.mode, 'token_preferred');

  fetchCalls = [];
  responseQueue = [createResponse(200)];
  await apiFetch('/cliente/favoritos?ids_only=1', { method: 'GET' });

  assert.equal(fetchCalls.length, 1);
  const firstHeaders = fetchCalls[0].options.headers || {};
  assert.equal(String(firstHeaders.Authorization || '').startsWith('Bearer '), true);
  assert.equal(String(firstHeaders['X-Cliente-Token'] || ''), 'token-adaptive-mode');
});

test('apiFetch GET expires token_preferred mode and retries cookie-first', async () => {
  resetAuthTestState();
  sessionStorage.setItem('cliente_token', 'token-adaptive-expired');
  sessionStorage.setItem('athos_auth_transport_mode_v1', JSON.stringify({
    mode: 'token_preferred',
    expiresAt: Date.now() - 500,
  }));

  responseQueue = [createResponse(200)];
  await apiFetch('/cliente/me?minimal=1', { method: 'GET' });

  assert.equal(fetchCalls.length, 1);
  const firstHeaders = fetchCalls[0].options.headers || {};
  assert.equal(Object.prototype.hasOwnProperty.call(firstHeaders, 'Authorization'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(firstHeaders, 'X-Cliente-Token'), false);
  assert.equal(sessionStorage.getItem('athos_auth_transport_mode_v1'), null);
});
