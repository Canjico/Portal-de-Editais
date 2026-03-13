import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeFormForComparison,
  collectComparableSnapshot,
  resolveDirtyTrackingState,
} from '../perfil-dirty-state.js';

const INITIAL_FORM = {
  nomeCompleto: 'Pedro Damiao Cruz',
  email: 'pedro.damiao2906@gmail.com',
  telefone: '(11) 98867-0339',
  cargo: 'Dev Full Stack',
  nomeEmpresa: 'Atimus',
  cnpj: '12.345.678/0001-90',
  setorEmpresa: 'Tecnologia da Informacao',
  setorAtuacao: 'Software',
  areasInteresse: ['Saude', 'Educacao'],
  prefEditais: true,
  prefPrazo: false,
  prefRelatorio: true,
  prefSistema: false,
};

test('render inicial nao exibe alerta de alteracoes nao salvas', () => {
  const initialSnapshot = collectComparableSnapshot(INITIAL_FORM);
  const state = resolveDirtyTrackingState({
    currentComparableForm: initialSnapshot.comparableForm,
    baselineComparableForm: initialSnapshot.comparableForm,
    baselineHash: initialSnapshot.hash,
    hasUserInteracted: false,
    userInitiated: false,
  });

  assert.equal(state.dirty, false);
  assert.equal(state.showUnsavedBanner, false);
});

test('edicao real mostra alerta', () => {
  const initialSnapshot = collectComparableSnapshot(INITIAL_FORM);
  const editedForm = normalizeFormForComparison({
    ...INITIAL_FORM,
    nomeCompleto: 'Pedro D Cruz',
  });

  const state = resolveDirtyTrackingState({
    currentComparableForm: editedForm,
    baselineComparableForm: initialSnapshot.comparableForm,
    baselineHash: initialSnapshot.hash,
    hasUserInteracted: false,
    userInitiated: true,
  });

  assert.equal(state.dirty, true);
  assert.equal(state.hasUserInteracted, true);
  assert.equal(state.showUnsavedBanner, true);
});

test('salvar com sucesso remove alerta e atualiza baseline', () => {
  const savedSnapshot = collectComparableSnapshot({
    ...INITIAL_FORM,
    cargo: 'Tech Lead',
  });

  const state = resolveDirtyTrackingState({
    currentComparableForm: savedSnapshot.comparableForm,
    baselineComparableForm: savedSnapshot.comparableForm,
    baselineHash: savedSnapshot.hash,
    hasUserInteracted: true,
    userInitiated: false,
  });

  assert.equal(state.dirty, false);
  assert.equal(state.hasUserInteracted, false);
  assert.equal(state.showUnsavedBanner, false);
});

test('voltar manualmente para valor original remove alerta', () => {
  const initialSnapshot = collectComparableSnapshot(INITIAL_FORM);
  const editedForm = normalizeFormForComparison({
    ...INITIAL_FORM,
    email: 'novo-email@atimus.com',
  });

  const dirtyState = resolveDirtyTrackingState({
    currentComparableForm: editedForm,
    baselineComparableForm: initialSnapshot.comparableForm,
    baselineHash: initialSnapshot.hash,
    hasUserInteracted: false,
    userInitiated: true,
  });

  const revertedState = resolveDirtyTrackingState({
    currentComparableForm: initialSnapshot.comparableForm,
    baselineComparableForm: initialSnapshot.comparableForm,
    baselineHash: initialSnapshot.hash,
    hasUserInteracted: dirtyState.hasUserInteracted,
    userInitiated: true,
  });

  assert.equal(revertedState.dirty, false);
  assert.equal(revertedState.hasUserInteracted, false);
  assert.equal(revertedState.showUnsavedBanner, false);
});

test('mudanca de sistema antes de interacao do usuario nao gera falso positivo', () => {
  const initialSnapshot = collectComparableSnapshot(INITIAL_FORM);
  const systemChangedForm = normalizeFormForComparison({
    ...INITIAL_FORM,
    telefone: '11988670339',
  });

  const state = resolveDirtyTrackingState({
    currentComparableForm: systemChangedForm,
    baselineComparableForm: initialSnapshot.comparableForm,
    baselineHash: initialSnapshot.hash,
    hasUserInteracted: false,
    userInitiated: false,
  });

  assert.equal(state.dirty, false);
  assert.equal(state.showUnsavedBanner, false);
  assert.deepEqual(state.baselineComparableForm, systemChangedForm);
});
