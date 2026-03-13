import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAnyDateToTime,
  parseDateIntentFromQuery,
  buildSearchQueryContext,
  matchesDateIntent,
  collectEditalDateParts,
} from '../search-date-utils.js';

test('parseDateIntentFromQuery reconhece DD/MM/AAAA', () => {
  const out = parseDateIntentFromQuery('15/03/2026');
  assert.deepEqual(out, {
    kind: 'day',
    day: 15,
    month: 3,
    year: 2026,
    consumed: '15/03/2026',
  });
});

test('parseDateIntentFromQuery reconhece mes/ano por extenso', () => {
  const out = parseDateIntentFromQuery('abr/2026');
  assert.deepEqual(out, {
    kind: 'month',
    month: 4,
    year: 2026,
    consumed: 'abr/2026',
  });
});

test('parseDateIntentFromQuery reconhece ano isolado', () => {
  const out = parseDateIntentFromQuery('2026');
  assert.deepEqual(out, {
    kind: 'year',
    year: 2026,
    consumed: '2026',
  });
});

test('buildSearchQueryContext preserva texto e data na mesma busca', () => {
  const out = buildSearchQueryContext('fapesp abril 2026');
  assert.equal(out.textQuery, 'fapesp');
  assert.equal(out.hasMeaningfulText, true);
  assert.equal(out.dateIntent?.kind, 'month');
  assert.equal(out.dateIntent?.month, 4);
  assert.equal(out.dateIntent?.year, 2026);
});

test('parseAnyDateToTime aceita formatos numericos e mes por extenso', () => {
  const direct = parseAnyDateToTime('15-03-2026');
  const named = parseAnyDateToTime('abril de 2026');
  assert.ok(Number.isFinite(direct));
  assert.ok(Number.isFinite(named));
});

test('matchesDateIntent usa prazo, abertura e publicacao', () => {
  const edital = {
    data_fechamento: '2026-04-23',
    data_abertura: '01/03/2026',
    data_publicacao: '2025-12-20',
  };

  const monthMatch = matchesDateIntent(edital, { kind: 'month', month: 4, year: 2026 });
  const dayMatch = matchesDateIntent(edital, { kind: 'day', day: 1, month: 3, year: 2026 });
  const yearMatch = matchesDateIntent(edital, { kind: 'year', year: 2025 });
  const miss = matchesDateIntent(edital, { kind: 'month', month: 2, year: 2026 });

  assert.equal(monthMatch, true);
  assert.equal(dayMatch, true);
  assert.equal(yearMatch, true);
  assert.equal(miss, false);
});

test('collectEditalDateParts elimina duplicatas de datas equivalentes', () => {
  const parts = collectEditalDateParts({
    data_fechamento: '2026-04-23',
    data_abertura: '23/04/2026',
    data_publicacao: 'abril/2026',
  });

  const keys = parts.map((item) => `${item.year}-${item.month}-${item.day}`);
  assert.equal(new Set(keys).size, keys.length);
});
