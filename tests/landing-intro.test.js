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
        <button id="landingIntroClose" type="button"></button>
        <div id="landingPreview">
          <button data-preview-tab="0" type="button" role="tab"></button>
          <button data-preview-tab="1" type="button" role="tab"></button>
          <div data-preview-panel="0"></div>
          <div data-preview-panel="1"></div>
        </div>
        <button id="landingIntroDontShow" type="button"></button>
      </section>
    `;
  });

  test('close control hides the unified landing intro shell', () => {
    wireLandingIntro();

    document.getElementById('landingIntroClose').click();

    expect(document.getElementById('landingIntro').hidden).toBe(true);
  });

  test('don’t show again persists full-section dismissal', () => {
    wireLandingIntro();

    document.getElementById('landingIntroDontShow').click();

    expect(localStorage.getItem(LANDING_INTRO_STORAGE_KEY)).toBe(LANDING_INTRO_VISIBILITY.NEVER);
    expect(localStorage.getItem(LEGACY_LANDING_PREVIEW_STORAGE_KEY)).toBe('1');
    expect(document.getElementById('landingIntro').hidden).toBe(true);
  });

  test('tabs swap visible intro content', () => {
    wireLandingIntro();

    const tabs = Array.from(document.querySelectorAll('[data-preview-tab]'));
    const panels = Array.from(document.querySelectorAll('[data-preview-panel]'));
    tabs[1].click();

    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(panels[0].hidden).toBe(true);
    expect(panels[1].hidden).toBe(false);
  });

  test('stored never preference hides the shell on init', () => {
    localStorage.setItem(LANDING_INTRO_STORAGE_KEY, LANDING_INTRO_VISIBILITY.NEVER);

    wireLandingIntro();

    expect(document.getElementById('landingIntro').hidden).toBe(true);
  });
});
