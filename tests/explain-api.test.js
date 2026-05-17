/** @jest-environment jsdom */
'use strict';

const { loadBrowserModule } = require('./utils');

describe('requestLazyExplanation', () => {
  let requestLazyExplanation;

  beforeAll(() => {
    ({ requestLazyExplanation } = loadBrowserModule('public/js/explain-api.js', ['requestLazyExplanation']));
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('posts to the lazy explanation endpoint with beta header', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ explanations: { 0: { explanation: 'Answer: A.\nWhy it fits: Because.' } } }),
    }));

    const payload = { lines: ['TF|Statement.|T'], index: 0 };
    await expect(requestLazyExplanation(payload)).resolves.toEqual({
      explanations: { 0: { explanation: 'Answer: A.\nWhy it fits: Because.' } },
    });

    expect(global.fetch).toHaveBeenCalledWith('/.netlify/functions/explain-answers-lazy', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Content-Type': 'application/json', 'x-ezq-beta': '1' }),
      body: JSON.stringify(payload),
    }));
  });

  test('turns JSON error responses into Error objects with status', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      headers: { get: () => 'application/json' },
      json: async () => ({ error: 'Explanation provider is not configured' }),
    }));

    await expect(requestLazyExplanation({ lines: ['TF|Statement.|T'], index: 0 }))
      .rejects.toMatchObject({ message: 'Explanation provider is not configured', status: 503 });
  });
});
