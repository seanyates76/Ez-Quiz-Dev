/** @jest-environment jsdom */
'use strict';

const { loadBrowserModule } = require('./utils');
const { loadDocument } = require('./utils');

describe('landing intro shell', () => {
  let LANDING_INTRO_STORAGE_KEY;
  let LANDING_LAST_SEEN_VERSION_STORAGE_KEY;
  let LANDING_INTRO_VISIBILITY;
  let LEGACY_LANDING_PREVIEW_STORAGE_KEY;
  let wireLandingIntro;

  beforeAll(() => {
    ({
      LANDING_INTRO_STORAGE_KEY,
      LANDING_LAST_SEEN_VERSION_STORAGE_KEY,
      LANDING_INTRO_VISIBILITY,
      LEGACY_LANDING_PREVIEW_STORAGE_KEY,
      wireLandingIntro,
    } = loadBrowserModule('public/js/landing-intro.js', [
      'LANDING_INTRO_STORAGE_KEY',
      'LANDING_LAST_SEEN_VERSION_STORAGE_KEY',
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
          <button data-preview-tab="2" type="button" role="tab"></button>
          <div data-preview-panel="0">
            <article class="landing-feature-card">
              <button type="button" aria-expanded="false" aria-controls="featureHarness" data-feature-card-toggle>
                Harness feature
              </button>
              <div id="featureHarness" data-feature-card-detail hidden>Harness detail</div>
            </article>
          </div>
          <div data-preview-panel="1"></div>
          <div data-preview-panel="2"></div>
        </div>
        <button id="landingIntroDontShow" type="button"></button>
      </section>
      <div id="releaseNotesModal">
        <section class="release-notes--production">
          <h4>v3.6.0</h4>
        </section>
      </div>
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
    expect(panels[2].hidden).toBe(true);
  });

  test('what’s new feature cards expand and collapse by click', () => {
    wireLandingIntro();

    const toggle = document.querySelector('[data-feature-card-toggle]');
    const detail = document.getElementById('featureHarness');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(detail.hidden).toBe(true);

    toggle.click();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(detail.hidden).toBe(false);

    toggle.click();

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(detail.hidden).toBe(true);
  });

  test('what’s new feature cards support keyboard activation without moving focus', () => {
    wireLandingIntro();

    const toggle = document.querySelector('[data-feature-card-toggle]');
    const detail = document.getElementById('featureHarness');
    toggle.focus();

    toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(detail.hidden).toBe(false);
    expect(document.activeElement).toBe(toggle);

    toggle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(detail.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
  });

  test('landing intro copy keeps what’s new, roadmap, and tips separate', async () => {
    const doc = await loadDocument('public/index.html');
    const newPanel = doc.getElementById('landingPanelNew');
    const soonPanel = doc.getElementById('landingPanelSoon');
    const tipsPanel = doc.getElementById('landingPanelTips');

    expect(newPanel.querySelectorAll('.landing-feature-card')).toHaveLength(6);
    expect(newPanel.textContent).toContain('Up to 50 questions');
    expect(newPanel.textContent).toContain('New generation status card');
    expect(newPanel.textContent).not.toContain('Bring your own API key');

    expect(soonPanel.textContent).toContain('Bring your own API key');
    expect(soonPanel.textContent).toContain('Quiz sharing');
    expect(soonPanel.textContent).not.toContain('Up to 50 questions');

    const tips = Array.from(tipsPanel.querySelectorAll('.tips-list li')).map((item) => item.textContent.trim());
    expect(tips).toEqual([
      'Create builds the quiz. Start begins it.',
      'Better study material makes better quizzes.',
      'If a quiz feels too broad, use fewer questions or a smaller source.',
    ]);
  });

  test('stored never preference hides the shell on init', () => {
    localStorage.setItem(LANDING_INTRO_STORAGE_KEY, LANDING_INTRO_VISIBILITY.NEVER);
    localStorage.setItem(LANDING_LAST_SEEN_VERSION_STORAGE_KEY, 'v3.6.0');

    wireLandingIntro();

    expect(document.getElementById('landingIntro').hidden).toBe(true);
  });

  test('default visibility shows an unseen version once', () => {
    wireLandingIntro();

    expect(document.getElementById('landingIntro').hidden).toBe(false);
    document.getElementById('landingIntroClose').click();

    expect(localStorage.getItem(LANDING_LAST_SEEN_VERSION_STORAGE_KEY)).toBe('v3.6.0');

    document.getElementById('landingIntro').hidden = false;
    wireLandingIntro();

    expect(document.getElementById('landingIntro').hidden).toBe(true);
  });

  test('don’t show again still allows a new version update panel once', () => {
    localStorage.setItem(LANDING_INTRO_STORAGE_KEY, LANDING_INTRO_VISIBILITY.NEVER);
    localStorage.setItem(LEGACY_LANDING_PREVIEW_STORAGE_KEY, '1');
    localStorage.setItem(LANDING_LAST_SEEN_VERSION_STORAGE_KEY, 'v3.5.0');

    wireLandingIntro();

    const intro = document.getElementById('landingIntro');
    const tabs = Array.from(document.querySelectorAll('[data-preview-tab]'));
    expect(intro.hidden).toBe(false);
    expect(intro.dataset.landingMode).toBe('update');
    expect(tabs[0].hidden).toBe(false);
    expect(tabs[1].hidden).toBe(true);
    expect(tabs[2].hidden).toBe(true);
    expect(document.getElementById('landingIntroDontShow').hidden).toBe(true);

    document.getElementById('landingIntroClose').click();

    expect(localStorage.getItem(LANDING_INTRO_STORAGE_KEY)).toBe(LANDING_INTRO_VISIBILITY.NEVER);
    expect(localStorage.getItem(LANDING_LAST_SEEN_VERSION_STORAGE_KEY)).toBe('v3.6.0');
  });
});
