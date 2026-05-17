import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSourcesDetails,
  normalizeSources,
  safeSourceUrl,
} from '../chat-sources.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || '').toUpperCase();
    this.children = [];
    this.attributes = {};
    this.className = '';
    this.textContent = '';
    this.href = '';
    this.target = '';
    this.rel = '';
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}

const fakeDocument = {
  createElement(tagName) {
    return new FakeElement(tagName);
  },
};

function findAll(root, predicate, found = []) {
  if (!root) return found;
  if (predicate(root)) found.push(root);
  for (const child of root.children || []) {
    findAll(child, predicate, found);
  }
  return found;
}

test('safeSourceUrl bloqueia protocolos perigosos e variacoes com espacos', () => {
  const blocked = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://example.com/id',
    'https://example.com/\nmalicioso',
    '',
  ];

  for (const value of blocked) {
    assert.equal(safeSourceUrl(value), '', value);
  }
});

test('safeSourceUrl permite http, https e caminhos relativos seguros', () => {
  assert.equal(safeSourceUrl('https://exemplo.com/fonte.pdf'), 'https://exemplo.com/fonte.pdf');
  assert.equal(safeSourceUrl('http://exemplo.com/fonte.pdf'), 'http://exemplo.com/fonte.pdf');
  assert.equal(safeSourceUrl('/documentos/fonte.pdf'), '/documentos/fonte.pdf');
  assert.equal(safeSourceUrl('./documentos/fonte.pdf'), './documentos/fonte.pdf');
  assert.equal(safeSourceUrl('documentos/fonte.pdf'), 'documentos/fonte.pdf');
});

test('buildSourcesDetails nao cria link clicavel para source_url perigosa', () => {
  const details = buildSourcesDetails(
    [
      {
        source_type: 'edital_attachment',
        source_name: '<img src=x onerror=alert(1)>',
        source_url: 'javascript:alert(1)',
        status: 'ok',
      },
      {
        source_type: 'edital_attachment',
        source_name: '<script>alert(1)</script>',
        source_url: ' data:text/html,<script>alert(1)</script>',
        status: 'ok',
      },
    ],
    fakeDocument
  );

  const links = findAll(details, (node) => node.tagName === 'A');
  const injectedNodes = findAll(details, (node) => ['SCRIPT', 'IMG', 'SVG', 'IFRAME'].includes(node.tagName));
  const sourceTexts = findAll(details, (node) => node.tagName === 'SPAN')
    .map((node) => node.textContent)
    .join('\n');

  assert.equal(links.length, 0);
  assert.equal(injectedNodes.length, 0);
  assert.match(sourceTexts, /<img src=x onerror=alert\(1\)>/);
  assert.match(sourceTexts, /<script>alert\(1\)<\/script>/);
});

test('buildSourcesDetails preserva links legitimos de fontes', () => {
  const details = buildSourcesDetails(
    [
      {
        source_type: 'edital_attachment',
        source_name: 'fonte.pdf',
        source_url: 'https://exemplo.com/fonte.pdf',
        status: 'ok',
      },
      {
        source_type: 'edital_attachment',
        source_name: 'arquivo local',
        source_url: '/documentos/fonte.pdf',
        status: 'ok',
      },
    ],
    fakeDocument
  );

  const links = findAll(details, (node) => node.tagName === 'A');

  assert.equal(links.length, 2);
  assert.equal(links[0].href, 'https://exemplo.com/fonte.pdf');
  assert.equal(links[0].target, '_blank');
  assert.equal(links[0].rel, 'noopener noreferrer');
  assert.equal(links[1].href, '/documentos/fonte.pdf');
});

test('normalizeSources remove href de URL perigosa sem apagar titulo da fonte', () => {
  const sources = normalizeSources([
    {
      source_type: 'edital_attachment',
      source_name: 'arquivo.pdf',
      source_url: 'vbscript:msgbox(1)',
      status: 'ok',
    },
  ]);

  assert.equal(sources.length, 1);
  assert.equal(sources[0].title, 'arquivo.pdf');
  assert.equal(sources[0].url, '');
});
