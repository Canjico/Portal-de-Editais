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

test('apiFetch GET usa cookie-first sem headers de token na tentativa inicial', async () => {
  fetchCalls = [];
  responseQueue = [createResponse(200)];
  sessionStorage.setItem('cliente_token', 'token-cookie-first');

  await apiFetch('/cliente/me?minimal=1', { method: 'GET' });

  assert.equal(fetchCalls.length, 1);
  const firstHeaders = fetchCalls[0].options.headers || {};
  assert.equal(fetchCalls[0].options.credentials, 'include');
  assert.equal(Object.prototype.hasOwnProperty.call(firstHeaders, 'Authorization'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(firstHeaders, 'X-Cliente-Token'), false);
});

test('apiFetch GET faz fallback com Authorization/X-Cliente-Token em 401', async () => {
  fetchCalls = [];
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

test('apiFetch GET faz fallback com token também em 403', async () => {
  fetchCalls = [];
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

test('apiFetch GET não faz fallback com token quando status não é 401/403', async () => {
  fetchCalls = [];
  responseQueue = [createResponse(500)];
  sessionStorage.setItem('cliente_token', 'token-no-fallback-500');

  const res = await apiFetch('/cliente/me?minimal=1', { method: 'GET' });

  assert.equal(res.status, 500);
  assert.equal(fetchCalls.length, 1);
  const firstHeaders = fetchCalls[0].options.headers || {};
  assert.equal(Object.prototype.hasOwnProperty.call(firstHeaders, 'Authorization'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(firstHeaders, 'X-Cliente-Token'), false);
});
