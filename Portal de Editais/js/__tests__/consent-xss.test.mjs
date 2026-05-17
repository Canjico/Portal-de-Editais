import test from 'node:test';
import assert from 'node:assert/strict';

const STORAGE_KEY = 'athos_cookie_consent_v1';
const DANGEROUS_TAGS = new Set(['SCRIPT', 'IMG', 'SVG', 'IFRAME']);

let importCounter = 0;

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
  constructor(tagName = 'div', recorder = null) {
    this.nodeType = 1;
    this.tagName = String(tagName || 'div').toUpperCase();
    this.children = [];
    this.childNodes = [];
    this.parentNode = null;
    this._attributes = new Map();
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.style = {};
    this.eventListeners = new Map();
    this.recorder = recorder;
    this.id = '';
    this._className = '';
    this._textContent = '';
    this._innerHTML = '';
    this.type = '';
    this.hidden = false;
    this.checked = false;
    this.disabled = false;
    this.tabIndex = 0;
    this.value = '';
  }

  get attributes() {
    return Array.from(this._attributes.entries()).map(([name, value]) => ({ name, value }));
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
    this.recorder?.innerHtmlAssignments.push({ tagName: this.tagName, value: this._innerHTML });
  }

  get innerHTML() {
    if (this._innerHTML) return this._innerHTML;
    const ownText = this._textContent ? escapeHtml(this._textContent) : '';
    return `${ownText}${this.childNodes.map(serializeNode).join('')}`;
  }

  set href(value) {
    this.setAttribute('href', value);
  }

  get href() {
    return this.getAttribute('href') || '';
  }

  set src(value) {
    this.setAttribute('src', value);
  }

  get src() {
    return this.getAttribute('src') || '';
  }

  appendChild(child) {
    child.parentNode = this;
    this.childNodes.push(child);
    if (child.nodeType === 1) this.children.push(child);
    this._innerHTML = '';
    return child;
  }

  replaceWith(node) {
    if (!this.parentNode) return;
    const parent = this.parentNode;
    const nodeIndex = parent.childNodes.indexOf(this);
    const childIndex = parent.children.indexOf(this);
    node.parentNode = parent;
    if (nodeIndex >= 0) parent.childNodes.splice(nodeIndex, 1, node);
    if (childIndex >= 0 && node.nodeType === 1) parent.children.splice(childIndex, 1, node);
    this.parentNode = null;
  }

  remove() {
    if (!this.parentNode) return;
    const parent = this.parentNode;
    parent.childNodes = parent.childNodes.filter((child) => child !== this);
    parent.children = parent.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  setAttribute(name, value) {
    const key = String(name);
    const stringValue = String(value);
    this._attributes.set(key, stringValue);
    if (key === 'id') this.id = stringValue;
    if (key === 'class') this.className = stringValue;
    if (key.startsWith('data-')) {
      this.dataset[toDatasetKey(key.slice(5))] = stringValue;
    }
  }

  getAttribute(name) {
    return this._attributes.get(String(name)) ?? null;
  }

  removeAttribute(name) {
    const key = String(name);
    this._attributes.delete(key);
    if (key === 'id') this.id = '';
    if (key === 'class') this.className = '';
  }

  addEventListener(type, handler) {
    const key = String(type);
    if (!this.eventListeners.has(key)) this.eventListeners.set(key, []);
    this.eventListeners.get(key).push(handler);
  }

  removeEventListener(type, handler) {
    const key = String(type);
    const handlers = this.eventListeners.get(key) || [];
    this.eventListeners.set(key, handlers.filter((candidate) => candidate !== handler));
  }

  click() {
    const handlers = this.eventListeners.get('click') || [];
    handlers.forEach((handler) => handler({ target: this }));
  }

  focus() {}

  closest(selector) {
    let current = this;
    while (current) {
      if (matchesSelector(current, selector)) return current;
      current = current.parentNode;
    }
    return null;
  }

  querySelectorAll(selector) {
    return findAll(this, (node) => matchesSelector(node, selector));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function toDatasetKey(value) {
  return String(value || '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function serializeNode(node) {
  if (node.nodeType === 3) return node.innerHTML;

  const tag = node.tagName.toLowerCase();
  const idAttr = node.id ? ` id="${escapeHtml(node.id)}"` : '';
  const classAttr = node.className ? ` class="${escapeHtml(node.className)}"` : '';
  const boolAttrs = [
    node.hidden ? ' hidden' : '',
    node.disabled ? ' disabled' : '',
    node.checked ? ' checked' : '',
  ].join('');
  const attrs = node.attributes
    .filter((attr) => attr.name !== 'id' && attr.name !== 'class')
    .map((attr) => ` ${escapeHtml(attr.name)}="${escapeHtml(attr.value)}"`)
    .join('');

  return `<${tag}${idAttr}${classAttr}${boolAttrs}${attrs}>${node.innerHTML}</${tag}>`;
}

function hasAttribute(node, name) {
  return node.getAttribute(name) !== null;
}

function matchesSelector(node, selector) {
  if (!node || node.nodeType !== 1) return false;

  const raw = String(selector || '').trim();
  if (!raw) return false;

  if (raw === 'script[type="text/plain"][data-consent]:not([data-consent-activated])') {
    return node.tagName === 'SCRIPT'
      && node.getAttribute('type') === 'text/plain'
      && hasAttribute(node, 'data-consent')
      && !hasAttribute(node, 'data-consent-activated');
  }

  if (raw.startsWith('#')) return node.id === raw.slice(1);
  if (raw.startsWith('.')) return node.classList.contains(raw.slice(1));
  if (raw === '[data-cookie-consent-manager]') return hasAttribute(node, 'data-cookie-consent-manager');
  return node.tagName.toLowerCase() === raw.toLowerCase();
}

function findAll(root, predicate, found = []) {
  if (!root || root.nodeType !== 1) return found;
  if (predicate(root)) found.push(root);
  root.children.forEach((child) => findAll(child, predicate, found));
  return found;
}

function collectDangerousTags(root) {
  return findAll(root, (node) => DANGEROUS_TAGS.has(node.tagName)).map((node) => node.tagName);
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
  };
}

function createScript(document, attrs = {}, text = '') {
  const script = document.createElement('script');
  Object.entries(attrs).forEach(([name, value]) => script.setAttribute(name, value));
  script.textContent = text;
  return script;
}

function installFakeDom({ storage = {}, scripts = [] } = {}) {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    localStorage: globalThis.localStorage,
    CustomEvent: globalThis.CustomEvent,
  };

  const recorder = { innerHtmlAssignments: [] };
  const documentElement = new FakeElement('html', recorder);
  const body = new FakeElement('body', recorder);
  documentElement.appendChild(body);

  const document = {
    readyState: 'complete',
    documentElement,
    body,
    createElement: (tagName) => new FakeElement(tagName, recorder),
    createTextNode: (text) => new FakeTextNode(text),
    getElementById: (id) => findAll(documentElement, (node) => node.id === String(id))[0] || null,
    querySelectorAll: (selector) => findAll(documentElement, (node) => matchesSelector(node, selector)),
    querySelector: (selector) => document.querySelectorAll(selector)[0] || null,
    addEventListener: () => {},
    removeEventListener: () => {},
    get cookie() {
      return this._cookie || '';
    },
    set cookie(value) {
      this._cookie = String(value || '');
    },
  };

  scripts.forEach((script) => body.appendChild(createScript(document, script.attrs, script.text)));

  const listeners = new Map();
  const window = {
    addEventListener(type, handler) {
      const key = String(type);
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(handler);
    },
    removeEventListener(type, handler) {
      const key = String(type);
      const handlers = listeners.get(key) || [];
      listeners.set(key, handlers.filter((candidate) => candidate !== handler));
    },
    dispatchEvent(event) {
      const handlers = listeners.get(String(event?.type || '')) || [];
      handlers.forEach((handler) => handler(event));
      return true;
    },
  };

  class FakeCustomEvent {
    constructor(type, options = {}) {
      this.type = String(type);
      this.detail = options.detail;
    }
  }

  Object.defineProperty(globalThis, 'document', { value: document, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: createStorage(storage), configurable: true, writable: true });
  Object.defineProperty(globalThis, 'CustomEvent', { value: FakeCustomEvent, configurable: true, writable: true });

  return {
    document,
    recorder,
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
      }
    },
  };
}

async function importConsent() {
  importCounter += 1;
  await import(`../consent.js?consent-xss=${Date.now()}-${importCounter}`);
}

test('consent banner and panel are built without executable HTML sinks', async () => {
  const maliciousConsent = JSON.stringify({
    status: '<script>alert(1)</script>',
    analytics: true,
    marketing: true,
    personalization: true,
    updatedAt: '<img src=x onerror=alert(1)>',
  });
  const dom = installFakeDom({ storage: { [STORAGE_KEY]: maliciousConsent } });

  try {
    await importConsent();

    const root = dom.document.getElementById('cookieConsentRoot');
    assert.ok(root);
    assert.deepEqual(dom.recorder.innerHtmlAssignments, []);
    assert.equal(globalThis.window.AthosConsent.getState().status, 'pending');
    assert.equal(dom.document.documentElement.dataset.consentStatus, 'pending');

    const html = root.innerHTML;
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /<img/i);
    assert.doesNotMatch(html, /<svg/i);
    assert.doesNotMatch(html, /<iframe/i);
    assert.deepEqual(collectDangerousTags(root), []);

    const links = findAll(root, (node) => node.tagName === 'A');
    assert.ok(links.some((link) => link.textContent === 'Termos de Uso' && link.getAttribute('href') === './termos-de-uso'));
    assert.ok(links.some((link) => link.textContent === 'Política de Privacidade' && link.getAttribute('href') === './politica-de-privacidade'));

    dom.document.getElementById('cookieConsentAcceptAll').click();
    const saved = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY));
    assert.equal(saved.status, 'accepted_all');
    assert.equal(saved.analytics, true);
    assert.equal(saved.marketing, true);
    assert.equal(saved.personalization, true);
  } finally {
    dom.restore();
  }
});

test('deferred consent scripts block dangerous urls and preserve safe urls', async () => {
  const acceptedConsent = JSON.stringify({
    version: 1,
    status: 'accepted_all',
    necessary: true,
    analytics: true,
    marketing: true,
    personalization: true,
    updatedAt: '2026-05-17T00:00:00.000Z',
  });

  const dom = installFakeDom({
    storage: { [STORAGE_KEY]: acceptedConsent },
    scripts: [
      {
        attrs: {
          type: 'text/plain',
          'data-consent': 'analytics',
          src: 'javascript:alert(1)',
          onload: 'alert(1)',
        },
      },
      {
        attrs: {
          type: 'text/plain',
          'data-consent': 'marketing',
          src: ' data:text/html,<script>alert(1)</script>',
        },
      },
      {
        attrs: {
          type: 'text/plain',
          'data-consent': 'analytics',
          src: 'https://exemplo.com/politica.js',
          onload: 'alert(1)',
          'data-safe': 'kept',
        },
      },
      {
        attrs: {
          type: 'text/plain',
          'data-consent': 'personalization',
          src: '/politica-de-privacidade.html',
        },
      },
    ],
  });

  try {
    await importConsent();

    const scripts = findAll(dom.document.body, (node) => node.tagName === 'SCRIPT');
    const blocked = scripts.filter((script) => script.getAttribute('data-consent-activated') === 'blocked');
    const activated = scripts.filter((script) => script.getAttribute('src'));

    assert.equal(blocked.length, 2);
    assert.ok(activated.some((script) => script.getAttribute('src') === 'https://exemplo.com/politica.js'));
    assert.ok(activated.some((script) => script.getAttribute('src') === '/politica-de-privacidade.html'));
    assert.equal(activated.find((script) => script.getAttribute('src') === 'https://exemplo.com/politica.js')?.getAttribute('onload'), null);

    const html = dom.document.body.innerHTML;
    assert.doesNotMatch(html, /src="javascript:/i);
    assert.doesNotMatch(html, /src=" data:text\/html/i);
    assert.doesNotMatch(html, /onload=/i);
  } finally {
    dom.restore();
  }
});
