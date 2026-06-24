/** @jest-environment jsdom */
'use strict';

const { loadDocument } = require('./utils');
const { readFile } = require('./utils');

describe('public/index.html structure', () => {
  let document;

  beforeAll(async () => {
    document = await loadDocument('public/index.html');
  });

  test('exposes key controls and editor surfaces by id', () => {
    const expectedIds = [
      ['generatorCard', 'SECTION'],
      ['landingIntro', 'SECTION'],
      ['landingPreview', 'DIV'],
      ['landingIntroClose', 'BUTTON'],
      ['landingIntroDontShow', 'BUTTON'],
      ['landingTabNew', 'BUTTON'],
      ['landingTabSoon', 'BUTTON'],
      ['landingTabTips', 'BUTTON'],
      ['landingPanelNew', 'DIV'],
      ['landingPanelSoon', 'DIV'],
      ['landingPanelTips', 'DIV'],
      ['generateBtn', 'BUTTON'],
      ['startToolbarBtn', 'BUTTON'],
      ['optionsBtn', 'BUTTON'],
      ['startBtn', 'BUTTON'],
      ['status', 'DIV'],
      ['generationStatusCard', 'DIV'],
      ['generationStatusTitle', 'DIV'],
      ['generationStatusMessage', 'DIV'],
      ['generationStatusScan', 'DIV'],
      ['generationStatusMeta', 'DIV'],
      ['generationStatusSecondary', 'DIV'],
      ['cancelGenerationBtn', 'BUTTON'],
      ['editor', 'TEXTAREA'],
      ['mirror', 'TEXTAREA'],
      ['importBtn', 'BUTTON'],
      ['importFile', 'INPUT'],
      ['mediaSourceStatus', 'DIV'],
      ['clearMediaSourceBtn', 'BUTTON'],
    ];

    expectedIds.forEach(([id, tag]) => {
      const el = document.getElementById(id);
      expect(el).not.toBeNull();
      expect(el.tagName).toBe(tag);
    });
  });

  test('start button defaults to disabled with helper text hookup', () => {
    const startBtn = document.getElementById('startBtn');
    const toolbarStart = document.getElementById('startToolbarBtn');
    expect(startBtn).not.toBeNull();
    expect(toolbarStart).not.toBeNull();
    expect(startBtn.hasAttribute('disabled')).toBe(true);
    expect(toolbarStart.hasAttribute('disabled')).toBe(false);
    expect(toolbarStart.getAttribute('aria-disabled')).toBe('true');
    expect(startBtn.getAttribute('aria-describedby')).toBe('startHelp');
    expect(toolbarStart.getAttribute('aria-describedby')).toBe('startHelp');
  });

  test('mirror textarea stays read-only and flagged empty by default', () => {
    const mirror = document.getElementById('mirror');
    expect(mirror).not.toBeNull();
    expect(mirror.hasAttribute('readonly')).toBe(true);
    expect(mirror.dataset.empty).toBe('true');
    expect(mirror.getAttribute('aria-label')).toContain('Generated quiz lines');
  });

  test('quiz editor advanced block is hidden on load', () => {
    const advancedBlock = document.getElementById('advancedBlock');
    expect(advancedBlock).not.toBeNull();
    expect(advancedBlock.hasAttribute('hidden')).toBe(true);
  });

  test('generation status card starts hidden and exposes mobile/reduced-motion hooks', () => {
    const card = document.getElementById('generationStatusCard');
    const cancel = document.getElementById('cancelGenerationBtn');
    expect(card.hidden).toBe(true);
    expect(card.dataset.generationState).toBe('idle');
    expect(card.classList.contains('generation-status-card')).toBe(true);
    expect(cancel.classList.contains('generation-status-cancel')).toBe(true);

    const css = readFile('public/styles.css');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('.generation-status-card');
    expect(css).toContain('grid-template-areas:');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.generation-status-scan span');
    expect(css).toContain('.generation-status-card.is-animating .generation-status-scan span');
  });

  test('landing intro exposes feature cards, roadmap, and tips styling hooks', () => {
    const featureCards = document.querySelectorAll('#landingPanelNew .landing-feature-card');
    const roadmapItems = document.querySelectorAll('#landingPanelSoon .roadmap-list li');
    const tips = document.querySelectorAll('#landingPanelTips .tips-list li');
    expect(featureCards).toHaveLength(6);
    expect(roadmapItems).toHaveLength(6);
    expect(tips).toHaveLength(3);

    featureCards.forEach((card) => {
      const toggle = card.querySelector('[data-feature-card-toggle]');
      const detailId = toggle && toggle.getAttribute('aria-controls');
      expect(toggle).not.toBeNull();
      expect(toggle.tagName).toBe('BUTTON');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(detailId).toBeTruthy();
      expect(document.getElementById(detailId).hidden).toBe(true);
    });

    const css = readFile('public/styles.css');
    expect(css).toContain('.landing-feature-card');
    expect(css).toContain('.roadmap-list');
    expect(css).toContain('.tips-list');
  });
});
