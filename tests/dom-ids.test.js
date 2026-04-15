/** @jest-environment jsdom */
'use strict';

const { loadDocument } = require('./utils');

describe('public/index.html structure', () => {
  let document;

  beforeAll(async () => {
    document = await loadDocument('public/index.html');
  });

  test('exposes key controls and editor surfaces by id', () => {
    const expectedIds = [
      ['generatorCard', 'SECTION'],
      ['generateBtn', 'BUTTON'],
      ['optionsBtn', 'BUTTON'],
      ['startBtn', 'BUTTON'],
      ['editor', 'TEXTAREA'],
      ['mirror', 'TEXTAREA'],
      ['importBtn', 'BUTTON'],
      ['importFile', 'INPUT'],
      ['welcomePanel', 'SECTION'],
      ['quickStartOpenHelp', 'BUTTON'],
      ['quickStartOpenEditor', 'BUTTON'],
      ['quickStartDismiss', 'BUTTON'],
      ['showQuickStartOnLaunch', 'INPUT'],
    ];

    expectedIds.forEach(([id, tag]) => {
      const el = document.getElementById(id);
      expect(el).not.toBeNull();
      expect(el.tagName).toBe(tag);
    });
  });

  test('start button defaults to disabled with helper text hookup', () => {
    const startBtn = document.getElementById('startBtn');
    expect(startBtn).not.toBeNull();
    expect(startBtn.hasAttribute('disabled')).toBe(true);
    expect(startBtn.getAttribute('aria-describedby')).toBe('startHelp');
  });

  test('mirror textarea stays read-only and flagged empty by default', () => {
    const mirror = document.getElementById('mirror');
    expect(mirror).not.toBeNull();
    expect(mirror.hasAttribute('readonly')).toBe(true);
    expect(mirror.dataset.empty).toBe('true');
    expect(mirror.getAttribute('aria-label')).toContain('Draft text');
  });

  test('quiz editor advanced block is hidden on load', () => {
    const advancedBlock = document.getElementById('advancedBlock');
    expect(advancedBlock).not.toBeNull();
    expect(advancedBlock.hasAttribute('hidden')).toBe(true);
  });

  test('uses plain-English builder copy for the main visible labels', () => {
    expect(document.getElementById('builderTitle')?.textContent.trim())
      .toBe('Build a quiz from your notes, topic, or source material.');
    expect(document.getElementById('generateBtn')?.textContent.trim()).toBe('Start quiz');
    expect(document.getElementById('optionsBtn')?.textContent.trim()).toBe('Options ▾');
    expect(document.getElementById('resultsTitle')?.textContent.trim()).toBe('Results');
    expect(document.getElementById('retakeLabel')?.textContent.trim()).toBe('Retake missed');
  });

  test('includes a lightweight quick-start surface and matching settings preference', () => {
    expect(document.getElementById('quickStartTitle')?.textContent.trim())
      .toBe('Start now, or open the draft first.');
    expect(document.getElementById('quickStartOpenEditor')?.textContent.trim()).toBe('Open draft');
    expect(document.getElementById('quickStartOpenHelp')?.textContent.trim()).toBe('Guide');
    expect(document.getElementById('quickStartDismiss')?.textContent.trim()).toBe('Dismiss');
    expect(document.querySelector('label.welcome-persist span')?.textContent.trim()).toBe("Don't show again");
    expect(document.getElementById('showQuickStartOnLaunch')?.getAttribute('type')).toBe('checkbox');
  });
});
