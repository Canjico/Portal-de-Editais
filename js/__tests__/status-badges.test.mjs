import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatusBadges } from '../render.js';

function isoDatePlus(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function labelsFor(edital) {
  return buildStatusBadges(edital).map((badge) => badge.label);
}

test('buildStatusBadges marks stale open flag with expired deadline as closed', () => {
  const labels = labelsFor({
    is_open: true,
    data_fechamento: isoDatePlus(-1),
    fluxo_continuo: false,
  });

  assert.deepEqual(labels, ['Encerrado']);
});

test('buildStatusBadges keeps continuous flow open with expired deadline', () => {
  const labels = labelsFor({
    is_open: true,
    data_fechamento: isoDatePlus(-1),
    fluxo_continuo: true,
  });

  assert.ok(labels.includes('Fluxo contínuo') || labels.includes('Aberto'));
  assert.equal(labels.includes('Encerrado'), false);
});

test('buildStatusBadges marks explicit closed edital as closed', () => {
  const labels = labelsFor({
    is_open: false,
    data_fechamento: isoDatePlus(10),
  });

  assert.deepEqual(labels, ['Encerrado']);
});

test('buildStatusBadges marks future deadline as open', () => {
  const labels = labelsFor({
    is_open: true,
    data_fechamento: isoDatePlus(10),
    fluxo_continuo: false,
  });

  assert.ok(labels.includes('Aberto'));
  assert.equal(labels.includes('Encerrado'), false);
});
