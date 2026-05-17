'use strict';

describe('beta gating helper', () => {
  const originalDocument = global.document;

  afterEach(() => {
    if (originalDocument === undefined) {
      delete global.document;
    } else {
      global.document = originalDocument;
      if (global.document?.body) {
        global.document.body.removeAttribute?.('data-beta');
        if (global.document.body.dataset) {
          delete global.document.body.dataset.beta;
        }
      }
    }
  });

  test('returns true when settings flag is enabled', async () => {
    const { isBetaEnabled } = await import('../public/js/beta.mjs');
    expect(isBetaEnabled({ betaEnabled: true })).toBe(true);
  });

  test('returns true when data-beta attribute is present', async () => {
    const { isBetaEnabled } = await import('../public/js/beta.mjs');
    if (typeof document !== 'undefined' && document?.body) {
      document.body.setAttribute?.('data-beta', '');
    } else {
      global.document = { body: { hasAttribute: () => true, dataset: { beta: '' } } };
    }
    expect(isBetaEnabled({ betaEnabled: false })).toBe(true);
  });

  test('returns false when beta is disabled everywhere', async () => {
    const { isBetaEnabled } = await import('../public/js/beta.mjs');
    expect(isBetaEnabled({ betaEnabled: false })).toBe(false);
  });
});
