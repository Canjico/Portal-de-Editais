import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mainSource = await readFile(new URL('../main.js', import.meta.url), 'utf8');
const renderSource = await readFile(new URL('../render.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

test('recommended card badge supports 100 percent adherence label', () => {
  assert.match(renderSource, /function getRecommendationBadgeLabel\(edital\)/);
  assert.match(renderSource, /100% aderente ao seu perfil/);
  assert.match(renderSource, /status-chip status-chip--highlight/);
});

test('cards render short recommendation reasons only when present', () => {
  assert.match(renderSource, /card-relevance-reasons/);
  assert.match(renderSource, /relevanceReasons\.length\s*\?/);
  assert.match(renderSource, /Motivos da recomenda/);
});

test('modal exposes recommendation explanation section', () => {
  assert.match(mainSource, /function buildRecommendationModalSection\(edital\)/);
  assert.match(mainSource, /Por que recomendado\?/);
  assert.match(mainSource, /Critérios atendidos/);
  assert.match(mainSource, /Informações faltantes/);
  assert.match(mainSource, /blockers/);
});

test('recommendation fields are normalized without breaking legacy relevance sort', () => {
  assert.match(mainSource, /relevance_level: normalizeRelevanceLevel\(api\?\.relevance_level\)/);
  assert.match(mainSource, /matched_criteria: api\?\.matched_criteria/);
  assert.match(indexSource, /data-sort="relevancia"/);
  assert.match(mainSource, /normalizeSortValue\(sortField \|\| sortSelect\?\.value \|\| 'prazo'\)/);
});

test('dashboard has 100 percent adherent KPI filter', () => {
  assert.match(indexSource, /id="statChipRecomendados"/);
  assert.match(indexSource, /data-kpi-filter="recomendados"/);
  assert.match(mainSource, /kpiFilter === 'recomendados'/);
});
