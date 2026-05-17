import test from 'node:test';
import assert from 'node:assert/strict';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const next = force === undefined ? !this.values.has(name) : Boolean(force);
    if (next) this.values.add(name);
    else this.values.delete(name);
    return next;
  }
}

class FakeElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.style = {};
    this._innerHTML = '';
    this.textContent = '';
    this.value = '';
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener() {}

  removeEventListener() {}

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }
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
  };

  const elements = new Map();
  const body = new FakeElement('body');
  const head = new FakeElement('head');

  const getOrCreate = (id) => {
    if (!elements.has(id)) elements.set(id, new FakeElement('div', id));
    return elements.get(id);
  };

  const document = {
    baseURI: 'https://portal.example/athos/editais.html',
    body,
    head,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: (id) => getOrCreate(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const window = {
    location: {
      hostname: 'portal.example',
      protocol: 'https:',
      origin: 'https://portal.example',
      pathname: '/athos/edital-publico.html',
      search: '',
      href: 'https://portal.example/athos/edital-publico.html?token=abc',
    },
    CSS: { escape: (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&') },
    setTimeout: () => 0,
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  Object.defineProperty(globalThis, 'document', { value: document, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => {} } },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', { value: createStorage(), configurable: true, writable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: createStorage(), configurable: true, writable: true });

  return {
    elements,
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete globalThis[key];
        } else {
          Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
        }
      }
    },
  };
}

test('openModal escapes edital detail text and blocks unsafe detail urls', async () => {
  const dom = installFakeDom();
  try {
    const { openModal } = await import(`../main.js?detail-xss=${Date.now()}`);

    await openModal({
      id: 'detail-xss-1',
      details_loaded: true,
      titulo: '<img src=x onerror=alert(1)>',
      descricao: '<script>alert(1)</script>',
      instituicao: '<b>Instituicao</b>',
      estado: 'SP<script>alert(2)</script>',
      area: '<iframe srcdoc="<script>alert(1)</script>">',
      tags: ['<svg onload=alert(1)>', 'Inovacao'],
      publico_alvo: ['MEI', '<svg onload=alert(2)>'],
      valor_total: '<img src=x onerror=alert(3)>',
      data_fechamento: '2030-05-10',
      recommendation_label: '<strong>100%</strong>',
      is_highlighted: true,
      share_link: 'javascript:alert(1)',
      icone: 'javascript:alert(1)',
      arquivos: [
        { nome: '<img src=x onerror=alert(4)>', url: 'data:text/html,<script>alert(1)</script>' },
        { nome: '<svg onload=alert(5)>', url: 'javascript:alert(1)' },
        { nome: '<b>Edital legitimo</b>.pdf', url: 'https://legit.example/docs/edital.pdf' },
      ],
    });

    const html = dom.elements.get('modal-content-container').innerHTML;

    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&lt;iframe srcdoc=&quot;&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;&gt;/);
    assert.match(html, /&lt;svg onload=alert\(1\)&gt;/);
    assert.match(html, /&lt;strong&gt;100%&lt;\/strong&gt;/);
    assert.match(html, /href="https:\/\/legit\.example\/docs\/edital\.pdf"/);

    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /<img src=x onerror/i);
    assert.doesNotMatch(html, /<svg/i);
    assert.doesNotMatch(html, /<iframe/i);
    assert.doesNotMatch(html, /javascript:/i);
    assert.doesNotMatch(html, /data:text\/html/i);
    assert.doesNotMatch(html, /src="javascript:/i);
    assert.doesNotMatch(html, /href="javascript:/i);
  } finally {
    dom.restore();
  }
});

test('public edital detail escapes text and filters unsafe attachment urls', async () => {
  const dom = installFakeDom();
  try {
    const {
      normalizePublicPayload,
      renderPublicEdital,
      sanitizeHttpUrl,
    } = await import(`../edital-publico.js?detail-xss=${Date.now()}`);

    assert.equal(sanitizeHttpUrl('javascript:alert(1)'), '');
    assert.equal(sanitizeHttpUrl('data:text/html,<script>alert(1)</script>'), '');
    assert.equal(sanitizeHttpUrl('https://legit.example/anexo.pdf'), 'https://legit.example/anexo.pdf');

    const edital = normalizePublicPayload({
      titulo: '<img src=x onerror=alert(1)>',
      instituicao: '<b>Instituicao</b>',
      status: '<svg onload=alert(1)>',
      prazo: '2030-05-10',
      valor: '<script>alert(2)</script>',
      descricao: '<script>alert(1)</script>',
      publico_alvo: ['MEI', '<img src=x onerror=alert(3)>'],
      categorias: ['<iframe srcdoc="<script>alert(1)</script>">'],
      estado: 'SP',
      instrumento: '<svg onload=alert(4)>',
      fonte: '<b>Fonte</b>',
      share_link: 'javascript:alert(1)',
      arquivos: [
        { nome: 'bad.html', url: 'data:text/html,<script>alert(1)</script>' },
        { nome: 'ok.pdf', url: 'https://legit.example/ok.pdf' },
      ],
    });

    assert.deepEqual(edital.arquivos.map((file) => file.url), ['https://legit.example/ok.pdf']);
    assert.notEqual(edital.shareLink, 'javascript:alert(1)');

    renderPublicEdital(edital);
    const html = dom.elements.get('publicShareContent').innerHTML;

    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&lt;iframe srcdoc=&quot;&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;&gt;/);

    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /<img src=x onerror/i);
    assert.doesNotMatch(html, /<svg/i);
    assert.doesNotMatch(html, /<iframe/i);
    assert.doesNotMatch(html, /javascript:/i);
    assert.doesNotMatch(html, /data:text\/html/i);
  } finally {
    dom.restore();
  }
});
