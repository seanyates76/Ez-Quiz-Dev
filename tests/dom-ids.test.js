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
      ['landingHero', 'SECTION'],
      ['generateBtn', 'BUTTON'],
      ['optionsBtn', 'BUTTON'],
      ['startBtn', 'BUTTON'],
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
    expect(startBtn).not.toBeNull();
    expect(startBtn.hasAttribute('disabled')).toBe(true);
    expect(startBtn.getAttribute('aria-describedby')).toBe('startHelp');
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
});
