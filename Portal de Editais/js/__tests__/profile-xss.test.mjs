import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEditais } from '../render.js';

const DANGEROUS_TAGS = new Set(['SCRIPT', 'IMG', 'SVG', 'IFRAME']);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }

  sync(value) {
    this.values = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  add(...names) {
    names.forEach((name) => {
      if (name) this.values.add(String(name));
    });
    this.owner._className = Array.from(this.values).join(' ');
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(String(name)));
    this.owner._className = Array.from(this.values).join(' ');
  }

  contains(name) {
    return this.values.has(String(name));
  }

  toggle(name, force) {
    const next = force === undefined ? !this.contains(name) : Boolean(force);
    if (next) this.add(name);
    else this.remove(name);
    return next;
  }
}

class FakeTextNode {
  constructor(text = '') {
    this.nodeType = 3;
    this.textContent = String(text);
    this.parentNode = null;
  }

  get innerHTML() {
    return escapeHtml(this.textContent);
  }
}

class FakeElement {
  constructor(tagName = 'div', id = '') {
    this.nodeType = 1;
    this.tagName = String(tagName || 'div').toUpperCase();
    this.id = id;
    this.childNodes = [];
    this.children = [];
    this.attributes = new Map();
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.style = {};
    this.parentNode = null;
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.options = [];
    this.selectedIndex = -1;
    this._className = '';
    this._textContent = '';
    this._innerHTML = '';
  }

  set className(value) {
    this._className = String(value || '');
    this.classList.sync(this._className);
  }

  get className() {
    return this._className;
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this._innerHTML = '';
    this.childNodes = [];
    this.children = [];
  }

  get textContent() {
    return `${this._textContent}${this.childNodes.map((child) => child.textContent || '').join('')}`;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this._textContent = '';
    this.childNodes = [];
    this.children = [];
  }

  get innerHTML() {
    if (this._innerHTML) return this._innerHTML;
    const own = this._textContent ? escapeHtml(this._textContent) : '';
    return `${own}${this.childNodes.map(serializeNode).join('')}`;
  }

  appendChild(child) {
    child.parentNode = this;
    this.childNodes.push(child);
    if (child.nodeType === 1) this.children.push(child);
    this._innerHTML = '';
    return child;
  }

  before(node) {
    if (!this.parentNode) return;
    const parent = this.parentNode;
    const nodeIndex = parent.childNodes.indexOf(this);
    const elementIndex = parent.children.indexOf(this);
    node.parentNode = parent;
    parent.childNodes.splice(nodeIndex < 0 ? parent.childNodes.length : nodeIndex, 0, node);
    if (node.nodeType === 1) {
      parent.children.splice(elementIndex < 0 ? parent.children.length : elementIndex, 0, node);
    }
  }

  remove() {
    if (!this.parentNode) return;
    const parent = this.parentNode;
    parent.childNodes = parent.childNodes.filter((child) => child !== this);
    parent.children = parent.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.get(String(name)) ?? null;
  }

  addEventListener() {}

  removeEventListener() {}

  dispatchEvent() {
    return true;
  }

  querySelectorAll(selector) {
    return findAll(this, selector);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function serializeNode(node) {
  if (node.nodeType === 3) return node.innerHTML;
  const tag = node.tagName.toLowerCase();
  const classAttr = node.className ? ` class="${escapeHtml(node.className)}"` : '';
  const idAttr = node.id ? ` id="${escapeHtml(node.id)}"` : '';
  const attrs = Array.from(node.attributes.entries())
    .map(([name, value]) => ` ${escapeHtml(name)}="${escapeHtml(value)}"`)
    .join('');
  return `<${tag}${idAttr}${classAttr}${attrs}>${node.innerHTML}</${tag}>`;
}

function matchesSelector(node, selector) {
  if (node.nodeType !== 1) return false;
  if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
  if (selector.startsWith('#')) return node.id === selector.slice(1);
  return node.tagName.toLowerCase() === selector.toLowerCase();
}

function findAll(root, selector) {
  const parts = String(selector || '').trim().split(/\s+/);
  const simpleSelector = parts[parts.length - 1] || '';
  const out = [];

  const walk = (node) => {
    if (!node || node.nodeType !== 1) return;
    if (matchesSelector(node, simpleSelector)) out.push(node);
    node.children.forEach(walk);
  };

  walk(root);
  return out;
}

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
  };
}

function installFakeDom() {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    navigator: globalThis.navigator,
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    setTimeout: globalThis.setTimeout,
  };

  const elements = new Map();
  const body = new FakeElement('body');
  body.dataset = {};

  const selectIds = new Set(['estadoUf', 'setorEmpresa', 'setorAtuacao', 'prefTheme', 'companyTicketPriority']);
  const buttonIds = new Set(['addAreaBtn']);
  const inputIds = new Set([
    'nomeCompleto',
    'email',
    'telefone',
    'cargo',
    'nomeEmpresa',
    'cnpj',
    'companyTicketTitle',
    'companyTicketDescription',
  ]);

  const getOrCreate = (id) => {
    if (!elements.has(id)) {
      const tagName = selectIds.has(id) ? 'select' : (buttonIds.has(id) ? 'button' : (inputIds.has(id) ? 'input' : 'div'));
      elements.set(id, new FakeElement(tagName, id));
    }
    return elements.get(id);
  };

  const areas = getOrCreate('areasInteresse');
  const addAreaBtn = getOrCreate('addAreaBtn');
  addAreaBtn.className = 'chip chip-add';
  areas.appendChild(addAreaBtn);

  const document = {
    baseURI: 'https://portal.example/perfil.html',
    title: 'Perfil',
    body,
    createElement: (tagName) => new FakeElement(tagName),
    createTextNode: (text) => new FakeTextNode(text),
    getElementById: (id) => getOrCreate(id),
    querySelector: (selector) => document.querySelectorAll(selector)[0] || null,
    querySelectorAll: (selector) => {
      if (String(selector).startsWith('#areasInteresse')) return findAll(areas, selector.split(/\s+/).pop());
      return [];
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const window = {
    location: {
      hostname: 'portal.example',
      protocol: 'https:',
      origin: 'https://portal.example',
      href: 'https://portal.example/perfil.html',
      pathname: '/perfil.html',
      search: '',
      hash: '',
    },
    history: { replaceState: () => {} },
    matchMedia: () => ({ matches: false }),
    addEventListener: () => {},
    removeEventListener: () => {},
    AthosTheme: {
      resolveProfilePreference: (value) => value,
      setPreference: () => {},
      bootstrap: () => {},
    },
  };

  Object.defineProperty(globalThis, 'document', { value: document, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: createStorage(), configurable: true, writable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: createStorage(), configurable: true, writable: true });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { value: (cb) => cb(), configurable: true, writable: true });

  return {
    elements,
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
      }
    },
  };
}

function collectDangerousTags(root) {
  const found = [];
  const walk = (node) => {
    if (!node || node.nodeType !== 1) return;
    if (DANGEROUS_TAGS.has(node.tagName)) found.push(node.tagName);
    node.children.forEach(walk);
  };
  walk(root);
  return found;
}

test('perfil renders user, company and interest text without creating executable HTML', async () => {
  const dom = installFakeDom();
  try {
    const perfil = await import(`../perfil.js?profile-xss=${Date.now()}`);

    perfil.fillProfileForm({
      nomeCompleto: '<img src=x onerror=alert(1)>',
      email: 'user@example.test',
      telefone: '<svg onload=alert(1)>',
      cargo: '<iframe srcdoc="<script>alert(1)</script>">',
      nomeEmpresa: '<script>alert(1)</script>',
      estadoUf: '<svg onload=alert(1)>',
      areasInteresse: ['<svg onload=alert(1)>', 'Inovação aberta'],
    }, { refreshDirty: false });

    perfil.renderCompanySummary({
      nome_empresa: '<script>alert(1)</script>',
      cnpj: '<img src=x onerror=alert(1)>',
      owner_nome: '<svg onload=alert(1)>',
    });

    perfil.renderCompanyUsers([{
      nome: '<img src=x onerror=alert(1)>',
      email: '<script>alert(1)</script>',
      role_label: '<b>Owner</b>',
      status: '<svg onload=alert(1)>',
    }]);

    perfil.renderCompanyTickets([{
      titulo: '<iframe srcdoc="<script>alert(1)</script>">',
      status: '<svg onload=alert(1)>',
      prioridade: '<script>alert(1)</script>',
    }]);

    perfil.renderCompanySubaccountSessions([{
      nome: '<script>alert(1)</script>',
      email: '<img src=x onerror=alert(1)>',
      sessions_total: 1,
      sessions: [{ device_label: '<svg onload=alert(1)>', session_id: 'session-xss' }],
    }]);

    const profileName = dom.elements.get('profileName');
    const companySummary = dom.elements.get('companySummaryName');
    const areas = dom.elements.get('areasInteresse');
    const users = dom.elements.get('companyUsersList');
    const tickets = dom.elements.get('companyTicketsList');
    const sessions = dom.elements.get('companySubaccountSessionsList');

    assert.equal(profileName.textContent, '<img src=x onerror=alert(1)>');
    assert.equal(companySummary.textContent, '<script>alert(1)</script>');
    assert.match(areas.innerHTML, /&lt;svg onload=alert\(1\)&gt;/);
    assert.match(users.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(tickets.innerHTML, /&lt;iframe srcdoc=&quot;&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;&gt;/);
    assert.match(sessions.innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

    const combinedHtml = [
      profileName.innerHTML,
      companySummary.innerHTML,
      areas.innerHTML,
      users.innerHTML,
      tickets.innerHTML,
      sessions.innerHTML,
    ].join('\n');

    assert.doesNotMatch(combinedHtml, /<script/i);
    assert.doesNotMatch(combinedHtml, /<img src=x onerror/i);
    assert.doesNotMatch(combinedHtml, /<svg/i);
    assert.doesNotMatch(combinedHtml, /<iframe/i);

    assert.deepEqual(collectDangerousTags(areas), []);
    assert.deepEqual(collectDangerousTags(users), []);
    assert.deepEqual(collectDangerousTags(tickets), []);
    assert.deepEqual(collectDangerousTags(sessions), []);
  } finally {
    dom.restore();
  }
});

test('favoritos e interesses keep edital text escaped and unsafe urls disabled', () => {
  const dom = installFakeDom();
  try {
    const unsafeContainer = new FakeElement('section');
    renderEditais(unsafeContainer, [{
      id: 'xss-favorito-1',
      is_favorite: true,
      has_interest: true,
      titulo: '<iframe srcdoc="<script>alert(1)</script>">',
      descricao: '<img src=x onerror=alert(1)>',
      instituicao: '<script>alert(1)</script>',
      area: '<svg onload=alert(1)>',
      estado: 'SP',
      tags: ['<svg onload=alert(1)>'],
      share_link: 'javascript:alert(1)',
      icone: 'data:text/html,<script>alert(1)</script>',
    }]);

    const unsafeHtml = unsafeContainer.children.map((child) => child.innerHTML).join('\n');
    assert.match(unsafeHtml, /&lt;iframe srcdoc=&quot;&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;&gt;/);
    assert.match(unsafeHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(unsafeHtml, /data-share=""/);
    assert.doesNotMatch(unsafeHtml, /<script/i);
    assert.doesNotMatch(unsafeHtml, /<img src=x onerror/i);
    assert.doesNotMatch(unsafeHtml, /<svg/i);
    assert.doesNotMatch(unsafeHtml, /<iframe/i);
    assert.doesNotMatch(unsafeHtml, /javascript:/i);
    assert.doesNotMatch(unsafeHtml, /data:text\/html/i);

    const safeContainer = new FakeElement('section');
    renderEditais(safeContainer, [{
      id: 'safe-favorito-1',
      is_favorite: true,
      has_interest: true,
      titulo: 'Edital seguro',
      descricao: 'Descrição segura',
      instituicao: 'Instituição segura',
      share_link: 'https://legit.example/editais/1',
      icone: 'https://legit.example/logo.webp',
    }]);

    const safeHtml = safeContainer.children.map((child) => child.innerHTML).join('\n');
    assert.match(safeHtml, /data-share="https:\/\/legit\.example\/editais\/1"/);
    assert.match(safeHtml, /src="https:\/\/legit\.example\/logo\.webp"/);
  } finally {
    dom.restore();
  }
});
