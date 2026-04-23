import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mainSource = await readFile(new URL('../main.js', import.meta.url), 'utf8');

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
