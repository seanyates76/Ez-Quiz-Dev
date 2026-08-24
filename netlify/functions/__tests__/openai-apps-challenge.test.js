'use strict';

describe('OpenAI Apps domain challenge', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.OPENAI_APPS_CHALLENGE;
  });

  afterAll(() => { process.env = originalEnv; });

  test('stays unavailable until the portal token is configured', async () => {
    const { handler } = require('../openai-apps-challenge.js');
    await expect(handler({ httpMethod: 'GET' })).resolves.toMatchObject({
      statusCode: 404,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
    });
  });

  test('returns the exact configured token for GET and an empty HEAD response', async () => {
    process.env.OPENAI_APPS_CHALLENGE = 'openai-apps-domain-token_123';
    const { handler } = require('../openai-apps-challenge.js');
    await expect(handler({ httpMethod: 'GET' })).resolves.toMatchObject({
      statusCode: 200,
      body: 'openai-apps-domain-token_123',
    });
    await expect(handler({ httpMethod: 'HEAD' })).resolves.toMatchObject({ statusCode: 200, body: '' });
  });

  test('rejects unsafe token values and unsupported methods', async () => {
    process.env.OPENAI_APPS_CHALLENGE = 'bad\r\ntoken';
    const { handler } = require('../openai-apps-challenge.js');
    await expect(handler({ httpMethod: 'GET' })).resolves.toMatchObject({ statusCode: 404 });
    await expect(handler({ httpMethod: 'POST' })).resolves.toMatchObject({
      statusCode: 405,
      headers: { Allow: 'GET, HEAD' },
    });
  });
});
