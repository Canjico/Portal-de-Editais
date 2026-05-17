import test from 'node:test';
import assert from 'node:assert/strict';

let importCounter = 0;

class FakeClassList {
  add() {}
  remove() {}
  contains() {
    return false;
  }
  toggle() {
    return false;
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.children = [];
    this.classList = new FakeClassList();
    this.style = { setProperty() {} };
    this.dataset = {};
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.value = '';
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute() {}
  getAttribute() {
    return null;
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
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };

  const body = new FakeElement('body');
  const documentElement = new FakeElement('html');

  const document = {
    baseURI: 'https://portal.example/editais.html',
    title: 'Athos',
    body,
    documentElement,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: () => null,
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
      href: 'https://portal.example/editais.html',
      pathname: '/editais.html',
      search: '',
      hash: '',
    },
    history: { replaceState: () => {} },
    matchMedia: () => ({ matches: false }),
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    setTimeout: () => 0,
    clearTimeout: () => {},
  };

  Object.defineProperty(globalThis, 'document', { value: document, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: createStorage(), configurable: true, writable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: createStorage(), configurable: true, writable: true });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { value: (cb) => cb(), configurable: true, writable: true });

  return {
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
      }
    },
  };
}

async function importMain() {
  importCounter += 1;
  return import(`../main.js?chat-message-xss=${Date.now()}-${importCounter}`);
}

test('renderSimpleMarkdown escapes assistant HTML and keeps basic formatting', async () => {
  const dom = installFakeDom();
  try {
    const { renderSimpleMarkdown } = await importMain();
    const html = renderSimpleMarkdown([
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<svg onload=alert(1)></svg>',
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
      '**Importante**',
      '- item 1',
      '- item 2',
    ].join('\n'));

    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /&lt;svg onload=alert\(1\)&gt;&lt;\/svg&gt;/);
    assert.match(html, /&lt;iframe srcdoc=&quot;&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;&gt;&lt;\/iframe&gt;/);
    assert.match(html, /<strong>Importante<\/strong>/);
    assert.match(html, /- item 1<br>- item 2/);

    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /<img/i);
    assert.doesNotMatch(html, /<svg/i);
    assert.doesNotMatch(html, /<iframe/i);
  } finally {
    dom.restore();
  }
});

test('renderSimpleMarkdown blocks unsafe markdown links and preserves safe links', async () => {
  const dom = installFakeDom();
  try {
    const { renderSimpleMarkdown, safeChatUrl } = await importMain();

    const blocked = [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'blob:https://example.com/id',
      '',
    ];

    for (const value of blocked) {
      assert.equal(safeChatUrl(value), '', value);
    }

    assert.equal(safeChatUrl('https://exemplo.com/documento.pdf'), 'https://exemplo.com/documento.pdf');
    assert.equal(safeChatUrl('/politica-de-privacidade.html'), '/politica-de-privacidade.html');
    assert.equal(safeChatUrl('./termos-de-uso'), './termos-de-uso');
    assert.equal(safeChatUrl('documentos/fonte.pdf'), 'documentos/fonte.pdf');

    const html = renderSimpleMarkdown([
      '[clique aqui](javascript:alert(1))',
      '[clique aqui](JaVaScRiPt:alert(1))',
      '[fonte](https://exemplo.com/documento.pdf)',
      '[relativo](/politica-de-privacidade.html)',
    ].join('\n'));

    assert.doesNotMatch(html, /href="javascript:/i);
    assert.doesNotMatch(html, /href="data:/i);
    assert.doesNotMatch(html, /href="vbscript:/i);
    assert.doesNotMatch(html, /href="file:/i);
    assert.doesNotMatch(html, /href="blob:/i);
    assert.match(html, /clique aqui<br>clique aqui/);
    assert.match(html, /<a href="https:\/\/exemplo\.com\/documento\.pdf" target="_blank" rel="noopener noreferrer">fonte<\/a>/);
    assert.match(html, /<a href="\/politica-de-privacidade\.html" target="_blank" rel="noopener noreferrer">relativo<\/a>/);
  } finally {
    dom.restore();
  }
});
