import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isConceptualOrAdvisoryQuestion, isDocumentalSemanticQuestion } from '../chat-routing-detector.js';

const mainSource = await readFile(new URL('../main.js', import.meta.url), 'utf8');

test('documental questions are detected before dashboard routing', () => {
  const questions = [
    'Quais editais pedem CNPJ?',
    'Quais editais exigem contrapartida?',
    'Esse edital tem contrapartida?',
    'Quem pode participar?',
    'Quais documentos preciso enviar?',
    'Resuma os anexos desse edital.',
  ];

  for (const question of questions) {
    assert.equal(isDocumentalSemanticQuestion(question), true, question);
  }
});

test('dashboard listing and refinement examples remain non-documental', () => {
  const questions = [
    'Mostre oportunidades para tecnologia e inovação',
    'Quais editais estão abertos em SP?',
    'Quero em SP',
    'Da FAPESP',
    'Só abertas',
    'Vencem esta semana',
  ];

  for (const question of questions) {
    assert.equal(isDocumentalSemanticQuestion(question), false, question);
  }
});

test('conceptual and advisory free text stays backend-routed', () => {
  const questions = [
    'O que é uma ICT em um edital de inovação?',
    'Minha empresa é uma startup de software. Em um edital, faz mais sentido eu entrar como proponente ou coexecutora?',
  ];

  for (const question of questions) {
    assert.equal(isConceptualOrAdvisoryQuestion(question), true, question);
    assert.equal(isDocumentalSemanticQuestion(question), false, question);
  }
});

test('main router blocks dashboard-intelligence for documental questions', () => {
  assert.match(mainSource, /const backendRoutedFreeText = isConceptualOrAdvisoryQuestion\(question\);/);
  assert.match(mainSource, /const documentalSemanticQuestion = isDocumentalSemanticQuestion\(question\);/);
  assert.match(mainSource, /const dashboardListingQuestion = !backendRoutedFreeText && !documentalSemanticQuestion && isDashboardListingQuestion\(question\);/);
  assert.match(mainSource, /const dashboardRefinementQuestion = !dashboardListingQuestion && !backendRoutedFreeText && !documentalSemanticQuestion && \(forceDashboardRefinement \|\| isDashboardRefinementQuestion\(question\)\);/);
  assert.match(mainSource, /if \(isConceptualOrAdvisoryQuestion\(question\)\) return false;[\s\S]*if \(isDocumentalSemanticQuestion\(question\)\) return false;[\s\S]*function hasDashboardSearchMemory/);
  assert.match(mainSource, /console\.info\('\[CHAT\]\[route\]'/);
});
