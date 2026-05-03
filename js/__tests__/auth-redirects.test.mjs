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

globalThis.localStorage = createStorageStub();
globalThis.sessionStorage = createStorageStub();
globalThis.window = {
  location: {
    hostname: 'portal.atimus.agr.br',
    protocol: 'https:',
    origin: 'https://portal.atimus.agr.br',
    href: 'https://portal.atimus.agr.br/Portal%20de%20Editais/index.html',
  },
  history: { replaceState() {} },
};
globalThis.document = { title: 'Portal' };

const { resolveAuthFailureRedirectTarget } = await import('../auth.js');

test('resolveAuthFailureRedirectTarget retorna login para unauthorized', () => {
  const decision = resolveAuthFailureRedirectTarget({ status: 401 }, {});
  assert.equal(decision?.reason, 'unauthorized');
  assert.ok(String(decision?.target || '').includes('login.atimus.agr.br'));
});

test('resolveAuthFailureRedirectTarget prioriza fluxo de troca de senha obrigatória', () => {
  const decision = resolveAuthFailureRedirectTarget(
    { status: 403 },
    {
      code: 'PASSWORD_CHANGE_REQUIRED',
      reset_token: 'token-reset-123',
    },
    {
      buildLoginUrl: () => 'https://login.atimus.agr.br',
    }
  );

  assert.equal(decision?.reason, 'password_change_required');
  assert.ok(String(decision?.target || '').includes('force_password_change=1'));
  assert.ok(String(decision?.target || '').includes('reset_token=token-reset-123'));
});
