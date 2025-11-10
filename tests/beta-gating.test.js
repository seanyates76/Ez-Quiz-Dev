'use strict';

describe('beta gating helper', () => {
  afterEach(() => {
    if (typeof document !== 'undefined' && document?.body) {
      document.body.removeAttribute?.('data-beta');
      if (document.body.dataset) {
        delete document.body.dataset.beta;
      }
    }
    delete global.document;
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
