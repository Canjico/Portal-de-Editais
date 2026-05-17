import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mainSource = await readFile(new URL('../main.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

test('dashboard list endpoint uses paginated summary mode on initial load', () => {
  assert.match(mainSource, /params\.set\('summary', '1'\)/);
  assert.match(mainSource, /params\.set\('page', String\(Math\.trunc\(Number\(page\)\)\)\)/);
  assert.match(mainSource, /params\.set\('limit', String\(Math\.trunc\(Number\(limit\)\)\)\)/);
});

test('normalizeEdital supports lightweight summary payload without full json_data', () => {
  assert.match(mainSource, /const hasSummaryShape = Boolean\(/);
  assert.match(mainSource, /!api\?\.json_data/);
  assert.match(mainSource, /const summaryData = hasSummaryShape/);
});

test('bootstrap favoritos request asks only ids payload', () => {
  assert.match(mainSource, /apiFetchJson\('\/cliente\/favoritos\?ids_only=1'/);
});

test('favorite toggle is optimistic and reverts on API failure without full reload', () => {
  assert.match(mainSource, /edital\.is_favorite = proximoEstado;/);
  assert.match(mainSource, /await salvarOuRemoverFavorito\(editalId, proximoEstado\);/);
  assert.match(mainSource, /catch \(error\) \{[\s\S]*edital\.is_favorite = estavaSalvo;/);
});

test('card detail is fetched on demand when details are missing', () => {
  assert.match(mainSource, /async function ensureEditalDetailLoaded\(edital\)/);
  assert.match(mainSource, /if \(edital\.details_loaded\) return edital;/);
  assert.match(mainSource, /const path = `\/editais\/\$\{encodeURIComponent\(String\(edital\.id\)\)\}\?include_relevance=true&relevance_mode=fast`;/);
});

test('legacy fallback requests full dataset and does not use summary mode', () => {
  assert.match(mainSource, /summary:\s*false,\s*[\s\S]*view:\s*'full'/);
  assert.match(mainSource, /includeAttachments:\s*true/);
});

test('server paged hero uses global stats metadata from backend', () => {
  assert.match(mainSource, /updateHeroStats\([^,]+,\s*\{\s*globalStats:\s*[^?]+?\?\s*serverPageMeta\.stats\s*:\s*null\s*\}\)/);
  assert.match(mainSource, /function normalizeHeroStatsFromMeta\(globalStats, fallbackStats\)/);
});

test('chat refinement build is cache busted and logged', () => {
  assert.match(indexSource, /src="\.\/js\/main\.js\?v=20260517\.2"/);
  assert.match(indexSource, /href="\.\/CSS\/style\.css\?v=20260510\.4"/);
  assert.match(mainSource, /console\.info\('\[Athos\]\[main\.js\] vers\S*o Athos interesses \+ stats filtrados 20260510\.5 carregada'\)/);
});

test('dashboard refinements use accumulated filters and dashboard intelligence endpoint', () => {
  assert.doesNotMatch(mainSource, /\{\s*\.assistantSemanticMemory\s*,?\s*\}/);
  assert.match(mainSource, /handleChatSend\(\{ source: 'quick_refinement', forceDashboardRefinement: true \}\)/);
  assert.match(mainSource, /const dashboardRefinementQuestion = !dashboardListingQuestion && !backendRoutedFreeText && !documentalSemanticQuestion && \(forceDashboardRefinement \|\| isDashboardRefinementQuestion\(question\)\);/);
  assert.match(mainSource, /buildDashboardRefinementQuestion\(question, requestAccumulatedDashboardFilters\)/);
  assert.match(mainSource, /apiFetchJson\('\/chat\/dashboard-intelligence'/);
  assert.match(mainSource, /console\.info\('\[CHAT\]\[refinement\]'/);
  assert.match(mainSource, /mergeDashboardFilterState\(planFilters, requestAccumulatedDashboardFilters\)/);
  assert.match(mainSource, /const filteredCards = allCards\.filter\(\(card\) => dashboardCardMatchesFilters\(card, filters\)\);/);
});

test('refinement panel marks active filters and clears refinements locally', () => {
  assert.match(mainSource, /btn\.className = `chat-refine-chip\$\{isActive \? ' is-active' : ''\}\$\{isClear \? ' is-clear' : ''\}`;/);
  assert.match(mainSource, /btn\.disabled = true;/);
  assert.match(mainSource, /label: 'Limpar refinamentos'/);
  assert.match(mainSource, /action: 'clear_refinements'/);
  assert.match(mainSource, /function clearDashboardRefinementsFromChat\(\)/);
  assert.match(mainSource, /lastDashboardFilters: normalizeDashboardFilterState\(\)/);
  assert.match(mainSource, /Refinamentos limpos\. Voc\S* pode buscar novamente ou aplicar outro filtro\./);
});
