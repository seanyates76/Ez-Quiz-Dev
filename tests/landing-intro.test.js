/** @jest-environment jsdom */
'use strict';

const { loadBrowserModule } = require('./utils');

describe('landing intro shell', () => {
  let LANDING_INTRO_STORAGE_KEY;
  let LANDING_INTRO_VISIBILITY;
  let LEGACY_LANDING_PREVIEW_STORAGE_KEY;
  let wireLandingIntro;

  beforeAll(() => {
    ({
      LANDING_INTRO_STORAGE_KEY,
      LANDING_INTRO_VISIBILITY,
      LEGACY_LANDING_PREVIEW_STORAGE_KEY,
      wireLandingIntro,
    } = loadBrowserModule('public/js/landing-intro.js', [
      'LANDING_INTRO_STORAGE_KEY',
      'LANDING_INTRO_VISIBILITY',
      'LEGACY_LANDING_PREVIEW_STORAGE_KEY',
      'wireLandingIntro',
    ]));
  });

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
      <section id="landingIntro">
        <div class="landing-copy"></div>
        <div id="landingPreview">
          <div id="landingPreviewTitle"></div>
          <button id="landingPreviewClose" type="button"></button>
          <div data-preview-slide="0"></div>
          <div data-preview-slide="1"></div>
          <button id="landingPreviewPrev" type="button"></button>
          <button data-preview-step="0" type="button"></button>
          <button data-preview-step="1" type="button"></button>
          <button id="landingPreviewNext" type="button"></button>
          <input id="landingPreviewDontShow" type="checkbox" />
        </div>
      </section>
    `;
  });

  test('close control hides the unified landing intro shell', () => {
    wireLandingIntro();

    document.getElementById('landingPreviewClose').click();

    expect(document.getElementById('landingIntro').hidden).toBe(true);
  });

  test('don’t show again persists full-section dismissal', () => {
    document.getElementById('landingPreviewDontShow').checked = true;
    wireLandingIntro();

    document.getElementById('landingPreviewClose').click();

    expect(localStorage.getItem(LANDING_INTRO_STORAGE_KEY)).toBe(LANDING_INTRO_VISIBILITY.NEVER);
    expect(localStorage.getItem(LEGACY_LANDING_PREVIEW_STORAGE_KEY)).toBe('1');
  });

  test('stored never preference hides the shell on init', () => {
    localStorage.setItem(LANDING_INTRO_STORAGE_KEY, LANDING_INTRO_VISIBILITY.NEVER);

    wireLandingIntro();

    expect(document.getElementById('landingIntro').hidden).toBe(true);
  });
});
