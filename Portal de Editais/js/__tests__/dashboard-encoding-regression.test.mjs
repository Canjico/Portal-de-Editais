import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboardHtml = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

test('dashboard critical labels are UTF-8 without mojibake', () => {
  assert.match(dashboardHtml, /Instituição/);
  assert.match(dashboardHtml, /Inscrições ativas/);
  assert.match(dashboardHtml, /Direção da ordenação/);
  assert.match(dashboardHtml, /Atualizado/);
  assert.match(dashboardHtml, /Política de Privacidade/);
  assert.doesNotMatch(dashboardHtml, /InstituiÃ§Ã£o|InscriÃ§Ãµes|NotificaÃ§Ãµes|AÃ§Ãµes|DireÃ§Ã£o|PolÃ­tica/);
});
