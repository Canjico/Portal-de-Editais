import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEditais } from '../render.js';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.className = '';
    this._innerHTML = '';
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

  querySelectorAll() {
    return [];
  }

  addEventListener() {}
}

function withFakeDom(fn) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;

  globalThis.document = {
    baseURI: 'https://portal.example/editais.html',
    body: new FakeElement('body'),
    createElement: (tagName) => new FakeElement(tagName),
  };
  globalThis.window = {
    location: {
      protocol: 'https:',
      origin: 'https://portal.example',
    },
  };

  try {
    return fn();
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
}

test('renderEditais escapes edital card text and blocks unsafe card urls', () => {
  withFakeDom(() => {
    const container = new FakeElement('section');

    renderEditais(container, [{
      id: 'xss-card-1',
      titulo: '<img src=x onerror=alert(1)>',
      descricao: '<script>alert(1)</script>',
      instituicao: '<b>Instituicao</b>',
      estado: 'SP',
      area: '<svg onload=alert(1)>',
      tags: ['<svg onload=alert(1)>', 'Tecnologia'],
      publico_alvo: ['MEI', '<img src=x onerror=alert(2)>'],
      valor_total: '<img src=x onerror=alert(3)>',
      data_fechamento: '<script>alert(4)</script>',
      recommendation_label: '<strong>100%</strong>',
      is_highlighted: true,
      share_link: 'javascript:alert(1)',
      icone: 'javascript:alert(1)',
    }]);

    const html = container.children.map((child) => child.innerHTML).join('\n');

    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&lt;svg onload=alert\(1\)&gt;/);
    assert.match(html, /&lt;strong&gt;100%&lt;\/strong&gt;/);
    assert.match(html, /data-share=""/);

    assert.doesNotMatch(html, /<img src=x onerror/i);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /<svg/i);
    assert.doesNotMatch(html, /data-share="javascript:/i);
    assert.doesNotMatch(html, /src="javascript:/i);
  });
});
