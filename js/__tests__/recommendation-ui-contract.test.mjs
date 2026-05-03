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

test('dashboard cards do not render recommendation reason bullets', () => {
  assert.doesNotMatch(renderSource, /card-relevance-reasons/);
  assert.doesNotMatch(renderSource, /relevanceReasonsHtml/);
  assert.doesNotMatch(renderSource, /Motivos da recomenda/);
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
  assert.match(indexSource, /AderÃªncia perfeita|Aderência perfeita/);
});

test('renderResultsStateHint diferencia aderencia perfeita alta e perfil incompleto', () => {
  assert.match(mainSource, /const perfectCount = Array\.isArray\(lastFiltered\)/);
  assert.match(mainSource, /const highCount = Array\.isArray\(lastFiltered\)/);
  assert.match(mainSource, /const mediumCount = Array\.isArray\(lastFiltered\)/);
  assert.match(mainSource, /Com base no seu perfil, \$\{perfectCount\}/);
  assert.match(mainSource, /Encontramos editais com alta aderÃªncia ao seu perfil|Encontramos editais com alta aderência ao seu perfil/);
  assert.match(mainSource, /Complete seu perfil para melhorar as recomendaÃ§Ãµes|Complete seu perfil para melhorar as recomendações/);
  assert.doesNotMatch(mainSource, /No momento, nÃ£o hÃ¡ edital 100% aderente ao seu perfil em destaque|No momento, não há edital 100% aderente ao seu perfil em destaque/);
});

test('replayChatSessionHistory restaura dashboard_options sem duplicar cards', () => {
  assert.match(mainSource, /setLatestAssistantConversationTurn,\s*[\s\S]*\} from '\.\/chat-session-state\.js\?v=\d+(?:\.\d+)?';/);
  assert.match(mainSource, /restoreChatMessageUi\(msg, entry\?\.ui\)/);
  assert.match(mainSource, /function restoreDashboardOptionsUi\(msgEl, rawUi\)/);
  assert.match(mainSource, /ui\.type === 'dashboard_options'/);
  assert.match(mainSource, /pendingDashboardOptionsRestores\.push\(\{ msgEl, ui \}\)/);
  assert.match(mainSource, /msgEl\.querySelectorAll\('\.chat-options'\)\.forEach\(\(node\) => node\.remove\(\)\)/);
  assert.match(mainSource, /if \(msgEl\.querySelector\('\.chat-options'\)\) return true;/);
});
