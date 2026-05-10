/** @jest-environment jsdom */
'use strict';

const { readFile } = require('./utils');

function loadStateModule() {
  const source = readFile('public/js/state.js')
    .replace(/export\s+const\s+/g, 'const ');
  const factory = new Function(`${source}\nreturn { S, STORAGE_KEYS };`);
  return factory();
}

function loadSettingsModule({ S, STORAGE_KEYS }) {
  const source = readFile('public/js/settings.js')
    .replace(/^import\s+.+$/gm, '')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'const ');

  const factory = new Function(
    'S',
    'STORAGE_KEYS',
    'msToMmSs',
    'mmSsToMs',
    'hasFlag',
    'setFlag',
    'addCookieFlag',
    'clearCookieFlag',
    `${source}\nreturn { loadSettingsFromStorage, reflectSettingsIntoUI, wireSettingsPanel, setShowQuickStartPreference };`,
  );

  return factory(
    S,
    STORAGE_KEYS,
    (ms) => {
      const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
      const mm = String(Math.floor(total / 60)).padStart(2, '0');
      const ss = String(total % 60).padStart(2, '0');
      return `${mm}:${ss}`;
    },
    (value) => {
      const [mm = '0', ss = '0'] = String(value || '').split(':');
      return ((Number(mm) || 0) * 60 + (Number(ss) || 0)) * 1000;
    },
    () => false,
    () => {},
    () => {},
    () => {},
  );
}

function makeEls(quickStartPrefEl) {
  return {
    themeRadios: [],
    timerEnabledEl: null,
    countdownModeEl: null,
    timerDurationEl: null,
    autoStartEl: null,
    requireAnswerEl: null,
    quizEditorPrefEl: null,
    quickStartPrefEl,
    betaEnabledEl: null,
  };
}

describe('quick start preference', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    try { delete window.EZQ; } catch {}
    try { delete window.__EZQ__; } catch {}
  });

  test('defaults to showing the quick start panel when nothing is saved yet', () => {
    const { S, STORAGE_KEYS } = loadStateModule();
    const { loadSettingsFromStorage, reflectSettingsIntoUI } = loadSettingsModule({ S, STORAGE_KEYS });
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';

    loadSettingsFromStorage();
    reflectSettingsIntoUI(makeEls(checkbox));

    expect(S.settings.showQuickStart).toBe(true);
    expect(checkbox.checked).toBe(true);
  });

  test('persists quick start preference changes in saved settings', () => {
    const { S, STORAGE_KEYS } = loadStateModule();
    const { wireSettingsPanel, setShowQuickStartPreference } = loadSettingsModule({ S, STORAGE_KEYS });
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    document.body.appendChild(checkbox);

    S.settings.showQuickStart = true;
    wireSettingsPanel(makeEls(checkbox));

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(S.settings.showQuickStart).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.settings)).showQuickStart).toBe(false);

    setShowQuickStartPreference(true);
    expect(S.settings.showQuickStart).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.settings)).showQuickStart).toBe(true);
  });
});
