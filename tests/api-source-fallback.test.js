/** @jest-environment jsdom */
'use strict';

const { loadBrowserModule } = require('./utils');

function loadApi() {
  return loadBrowserModule('public/js/api.js', ['generateWithAI']);
}

describe('generateWithAI source-backed endpoint routing', () => {
  afterEach(() => {
    delete global.fetch;
    delete window.EZQ_API_ENDPOINTS;
  });

  test('does not send imported source text to default public fallback origins', async () => {
    const { generateWithAI } = loadApi();
    global.fetch = jest.fn(async () => { throw new Error('network unavailable'); });

    await expect(generateWithAI('Notes', 5, { sourceText: 'private study material' }))
      .rejects.toThrow(/All API endpoints failed/);

    const urls = global.fetch.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes('ez-quiz.netlify.app'))).toBe(false);
    expect(urls.some((url) => url.includes('eq-quiz.netlify.app'))).toBe(false);
  });

  test('allows explicit source fallback endpoint opt-in', async () => {
    window.EZQ_API_ENDPOINTS = [
      { url: 'https://example.test/generate', allowSourceFallback: true },
    ];
    const { generateWithAI } = loadApi();
    global.fetch = jest.fn(async () => { throw new Error('network unavailable'); });

    await expect(generateWithAI('Notes', 5, { sourceText: 'private study material' }))
      .rejects.toThrow(/All API endpoints failed/);

    const urls = global.fetch.mock.calls.map(([url]) => String(url));
    expect(urls).toContain('https://example.test/generate');
  });
});
