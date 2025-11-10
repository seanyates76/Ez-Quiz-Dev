'use strict';

const { loadBrowserModule } = require('./utils');

const originalDocument = typeof document !== 'undefined' ? document : undefined;

describe('beta gating helper', () => {

  afterEach(() => {
    if (originalDocument) {
      global.document = originalDocument;
      globalThis.document = originalDocument;
      if (originalDocument.body && typeof originalDocument.body.removeAttribute === 'function') {
        originalDocument.body.removeAttribute('data-beta');
      }
    } else {
      delete global.document;
      delete globalThis.document;
    }
  });

  test('returns true when settings flag is enabled', () => {
    const { isBetaEnabled } = loadBrowserModule('public/js/beta.mjs', ['isBetaEnabled']);
    expect(isBetaEnabled({ betaEnabled: true })).toBe(true);
  });

  test('returns true when data-beta attribute is present', () => {
    if (originalDocument && originalDocument.body) {
      originalDocument.body.setAttribute('data-beta', '');
      const { isBetaEnabled } = loadBrowserModule('public/js/beta.mjs', ['isBetaEnabled']);
      expect(isBetaEnabled({ betaEnabled: false })).toBe(true);
      return;
    }

    const body = { hasAttribute: () => false, dataset: { beta: '' } };
    global.document = { body };
    globalThis.document = global.document;
    const { isBetaEnabled } = loadBrowserModule('public/js/beta.mjs', ['isBetaEnabled']);
    expect(isBetaEnabled({ betaEnabled: false })).toBe(true);
  });

  test('returns false when beta is disabled everywhere', () => {
    const { isBetaEnabled } = loadBrowserModule('public/js/beta.mjs', ['isBetaEnabled']);
    expect(isBetaEnabled({ betaEnabled: false })).toBe(false);
  });
});
