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
      ['narrowSourceModal', 'DIV'],
      ['narrowSourceTitle', 'H3'],
      ['narrowSourceMessage', 'P'],
      ['narrowSourceConfirm', 'BUTTON'],
      ['narrowSourceCancel', 'BUTTON'],
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

  test('landing intro headline includes the v3.6.0 release label', () => {
    const title = document.getElementById('landingTitle');
    expect(title).not.toBeNull();
    expect(title.textContent.trim()).toBe('Welcome to EZ Quiz 3.6.0!');
  });

  test('uses unique IDs and exposes both release-notes triggers', () => {
    const ids = Array.from(document.querySelectorAll('[id]')).map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(document.getElementById('versionInfoBtn')).not.toBeNull();
    expect(document.getElementById('settingsVersionInfoBtn')).not.toBeNull();
    expect(document.getElementById('versionInfoBtn').getAttribute('aria-controls')).toBe('releaseNotesModal');
    expect(document.getElementById('settingsVersionInfoBtn').getAttribute('aria-controls')).toBe('releaseNotesModal');
  });

  test('keeps versioned module imports aligned with the service worker asset version', () => {
    const serviceWorker = readFile('public/sw.js');
    const assetVersion = serviceWorker.match(/const ASSET_VERSION = '([^']+)'/)?.[1];
    expect(assetVersion).toBeTruthy();

    const moduleFiles = [
      'public/js/main.js',
      'public/js/quiz.js',
      'public/js/editor.gui.js',
      'public/js/generator.js',
    ];
    const importVersions = moduleFiles.flatMap((file) => Array.from(
      readFile(file).matchAll(/from\s+['"][^'"]+\?v=([^'"]+)['"]/g),
      (match) => match[1]
    ));

    expect(importVersions.length).toBeGreaterThan(0);
    expect(new Set(importVersions)).toEqual(new Set([assetVersion]));
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
    const progress = document.getElementById('generationStatusScan');
    const secondary = document.getElementById('generationStatusSecondary');
    expect(card.hidden).toBe(true);
    expect(card.dataset.generationState).toBe('idle');
    expect(card.classList.contains('generation-status-card')).toBe(true);
    expect(cancel.classList.contains('generation-status-cancel')).toBe(true);
    expect(cancel.textContent.trim()).toBe('Stop generation');
    expect(progress.getAttribute('role')).toBe('progressbar');
    expect(progress.getAttribute('aria-label')).toBe('Quiz generation progress');
    expect(progress.getAttribute('aria-valuemin')).toBe('0');
    expect(progress.getAttribute('aria-valuenow')).toBe('0');
    expect(secondary.textContent).toBe('');
    expect(readFile('public/index.html')).not.toContain('Counting to four. Repeatedly.');

    const css = readFile('public/styles.css');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('.generation-status-card');
    expect(css).toContain('grid-template-areas:');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.generation-status-scan span');
    expect(css).toContain('.generation-status-card.is-animating .generation-status-scan span');
    expect(css).toContain('.generation-status-card.is-complete .generation-status-scan span');
    expect(css).toContain('transition: width .32s ease');
  });

  test('results retake controls use a sticky action dock', () => {
    const actions = document.querySelector('.results-actions-dock');
    const retake = document.getElementById('retakeControl');
    expect(actions).not.toBeNull();
    expect(actions.contains(retake)).toBe(true);
    expect(retake.getAttribute('role')).toBe('group');
    expect(document.getElementById('retakePrimary').tagName).toBe('BUTTON');
    expect(document.getElementById('retakeCaret').getAttribute('aria-haspopup')).toBe('menu');

    const css = readFile('public/styles.css');
    expect(css).toContain('.results-actions-dock');
    expect(css).toContain('position: sticky');
    expect(css).toContain('bottom: max(12px, env(safe-area-inset-bottom))');
  });

  test('narrow source warning modal starts closed with confirm and cancel actions', () => {
    const modal = document.getElementById('narrowSourceModal');
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
    expect(modal.getAttribute('aria-hidden')).toBe('true');
    expect(modal.classList.contains('is-open')).toBe(false);
    expect(document.getElementById('narrowSourceConfirm').textContent.trim()).toBe('Generate anyway');
    expect(document.getElementById('narrowSourceCancel').textContent.trim()).toBe('Cancel');
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
