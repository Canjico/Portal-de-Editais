import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAttachmentCategoryMeta,
  groupAttachmentsForDisplay,
  normalizeAttachmentForDisplay,
} from '../attachments_display.js';

test('agrupa anexos por display_group', () => {
  const groups = groupAttachmentsForDisplay([
    { nome: 'Edital completo', category: 'edital_principal' },
    { nome: 'Retifica\u00e7\u00e3o', category: 'retificacao_adendo' },
    { nome: 'Formul\u00e1rio', category: 'formulario_modelo' },
    { nome: 'Anexo I', category: 'anexo_tecnico' },
    { nome: 'Resultado final', category: 'resultado_homologacao' },
  ]);

  const byGroup = new Map(groups.map((group) => [group.group, group.items]));

  assert.equal(byGroup.get('Documentos principais').length, 2);
  assert.equal(byGroup.get('Formul\u00e1rios e modelos').length, 1);
  assert.equal(byGroup.get('Anexos t\u00e9cnicos').length, 1);
  assert.equal(byGroup.get('Resultados e homologa\u00e7\u00f5es').length, 1);
});

test('ordena grupos por prioridade', () => {
  const groups = groupAttachmentsForDisplay([
    { nome: 'Resultado final', category: 'resultado_homologacao' },
    { nome: 'Anexo I', category: 'anexo_tecnico' },
    { nome: 'Edital completo', category: 'edital_principal' },
    { nome: 'Cronograma', category: 'cronograma' },
  ]);

  assert.deepEqual(groups.map((group) => group.group), [
    'Documentos principais',
    'Cronograma',
    'Anexos t\u00e9cnicos',
    'Resultados e homologa\u00e7\u00f5es',
  ]);
});

test('ordena itens dentro do grupo', () => {
  const groups = groupAttachmentsForDisplay([
    {
      nome: 'Retifica\u00e7\u00e3o do Edital',
      category: 'retificacao_adendo',
      priority: 20,
    },
    {
      nome: 'Edital completo',
      category: 'edital_principal',
      priority: 10,
      is_primary: true,
    },
  ]);

  assert.deepEqual(groups[0].items.map((item) => item.nome), [
    'Edital completo',
    'Retifica\u00e7\u00e3o do Edital',
  ]);
});

test('mantem estabilidade dentro da mesma categoria', () => {
  const groups = groupAttachmentsForDisplay([
    { nome: 'Anexo II', category: 'anexo_tecnico' },
    { nome: 'Anexo I', category: 'anexo_tecnico' },
    { nome: 'Anexo III', category: 'anexo_tecnico' },
  ]);

  assert.deepEqual(groups[0].items.map((item) => item.nome), [
    'Anexo II',
    'Anexo I',
    'Anexo III',
  ]);
});

test('nao muta objetos originais', () => {
  const original = { nome: 'Documento.pdf', category: 'edital_principal' };

  groupAttachmentsForDisplay([original]);

  assert.equal(Object.hasOwn(original, 'originalIndex'), false);
  assert.equal(Object.hasOwn(original, 'category_label'), false);
  assert.equal(Object.hasOwn(original, 'display_group'), false);
  assert.equal(Object.hasOwn(original, 'priority'), false);
});

test('usa fallback para anexo antigo', () => {
  const groups = groupAttachmentsForDisplay([
    {
      nome: 'Documento.pdf',
      url: 'https://site.gov.br/doc.pdf',
      tipo: 'pdf',
    },
  ]);
  const attachment = groups[0].items[0];

  assert.equal(attachment.category, 'outros');
  assert.equal(attachment.display_group, 'Outros documentos');
  assert.equal(attachment.priority, 90);
});

test('retorna array vazio para entrada invalida', () => {
  assert.deepEqual(groupAttachmentsForDisplay(null), []);
  assert.deepEqual(groupAttachmentsForDisplay(undefined), []);
  assert.deepEqual(groupAttachmentsForDisplay({}), []);
  assert.deepEqual(groupAttachmentsForDisplay('abc'), []);
});

test('getAttachmentCategoryMeta retorna copia dos metadados conhecidos', () => {
  const meta = getAttachmentCategoryMeta('cronograma');
  meta.priority = 999;

  assert.deepEqual(getAttachmentCategoryMeta('cronograma'), {
    label: 'Cronograma',
    group: 'Cronograma',
    priority: 30,
  });
});

test('normalizeAttachmentForDisplay aplica fallbacks sem mutar entrada', () => {
  const original = { reasons: 'legado' };
  const normalized = normalizeAttachmentForDisplay(original, 7);

  assert.equal(normalized.nome, 'Documento');
  assert.equal(normalized.url, '');
  assert.equal(normalized.category, 'outros');
  assert.deepEqual(normalized.reasons, []);
  assert.equal(normalized.originalIndex, 7);
  assert.deepEqual(original, { reasons: 'legado' });
});
