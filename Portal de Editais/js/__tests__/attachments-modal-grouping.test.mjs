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
      pathname: '/athos/editais.html',
      search: '',
      href: 'https://portal.example/athos/editais.html',
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

function assertInOrder(text, expected) {
  const positions = expected.map((item) => text.indexOf(item));
  positions.forEach((position, index) => {
    assert.notEqual(position, -1, `${expected[index]} should be rendered`);
  });
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index - 1] < positions[index], `${expected[index - 1]} should appear before ${expected[index]}`);
  }
}

test('modal renders edital attachments grouped by display group', async () => {
  const dom = installFakeDom();
  try {
    const { openModal } = await import(`../main.js?attachments-modal-grouping=${Date.now()}`);

    await openModal({
      id: 'modal-grouping-1',
      details_loaded: true,
      titulo: 'Edital de teste',
      descricao: 'Descricao de teste',
      instituicao: 'Instituicao',
      estado: 'SP',
      area: 'Inovacao',
      arquivos: [
        {
          nome: 'goias.gov.br',
          url: 'https://goias.gov.br/fapeg/chamada-publica-no-08-2026/',
          category: 'edital_principal',
          category_label: 'Edital principal',
          display_group: 'Documentos principais',
          priority: 10,
          is_primary: true,
          source_role: 'official_page',
        },
        { nome: 'Resultado final.pdf', url: 'https://site.gov.br/resultado.pdf', category: 'resultado_homologacao' },
        { nome: 'Anexo I.pdf', url: 'https://site.gov.br/anexo-i.pdf', category: 'anexo_tecnico' },
        { nome: 'Edital completo.pdf', url: 'https://site.gov.br/edital.pdf', category: 'edital_principal', is_primary: true },
        { nome: 'Cronograma de etapas.pdf', url: 'https://site.gov.br/cronograma.pdf', category: 'cronograma' },
        { nome: 'Retificacao.pdf', url: 'https://site.gov.br/retificacao.pdf', category: 'retificacao_adendo' },
        { nome: 'Formulario de inscricao.pdf', url: 'https://site.gov.br/formulario.pdf', category: 'formulario_modelo' },
      ],
    });

    const html = dom.elements.get('modal-content-container').innerHTML;

    assert.match(html, /class="attachment-groups"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-controls="attachments-wrapper-modal-grouping-1"/);
    assert.match(html, /id="attachments-wrapper-modal-grouping-1" aria-hidden="true"/);
    assert.match(html, /class="attachment-group-title" id="attachment-group-title-modal-grouping-1-0">Links oficiais<\/h4>/);
    assert.match(html, /class="attachment-group-count">2 arquivos<\/span>/);
    assert.match(html, /class="attachment-group-count">1 arquivo<\/span>/);
    assert.match(html, /P\u00e1gina oficial - goias\.gov\.br/);
    assert.match(html, /P\u00e1gina oficial/);
    assertInOrder(html, [
      'Links oficiais',
      'Documentos principais',
      'Cronograma',
      'Formul\u00e1rios e modelos',
      'Anexos t\u00e9cnicos',
      'Resultados e homologa\u00e7\u00f5es',
    ]);

    const documentosStart = html.indexOf('Documentos principais');
    const cronogramaStart = html.indexOf('Cronograma');
    const linksStart = html.indexOf('Links oficiais');
    const linksHtml = html.slice(linksStart, documentosStart);
    assert.match(linksHtml, /P\u00e1gina oficial - goias\.gov\.br/);
    assert.match(linksHtml, /P\u00e1gina oficial/);
    assert.doesNotMatch(linksHtml, /Edital principal/);
    assert.doesNotMatch(linksHtml, /Edital completo/);
    const documentosHtml = html.slice(documentosStart, cronogramaStart);
    assertInOrder(documentosHtml, ['Edital completo', 'Retificacao']);
  } finally {
    dom.restore();
  }
});

test('modal keeps fallback group for legacy attachments and filters unsafe urls', async () => {
  const dom = installFakeDom();
  try {
    const { openModal } = await import(`../main.js?attachments-modal-fallback=${Date.now()}`);

    await openModal({
      id: 'modal-grouping-legacy',
      details_loaded: true,
      titulo: 'Edital legado',
      descricao: 'Descricao de teste',
      instituicao: 'Instituicao',
      estado: 'BR',
      area: 'Geral',
      arquivos: [
        { nome: 'Documento antigo.pdf', url: 'https://site.gov.br/doc-antigo.pdf', tipo: 'pdf' },
        { nome: 'Arquivo inseguro.pdf', url: 'javascript:alert(1)', category: 'edital_principal' },
      ],
    });

    const html = dom.elements.get('modal-content-container').innerHTML;

    assert.match(html, /Outros documentos/);
    assert.match(html, /Documento antigo/);
    assert.match(html, /1 arquivo dispon\u00edvel/);
    assert.match(html, /class="attachment-group-count">1 arquivo<\/span>/);
    assert.doesNotMatch(html, /Arquivo inseguro/);
    assert.doesNotMatch(html, /javascript:/i);
  } finally {
    dom.restore();
  }
});
