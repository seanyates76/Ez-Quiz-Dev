/** @jest-environment node */
'use strict';

const { handler } = require('../standalone-ai.js');
const connection = { provider: 'gemini', model: 'gemini-test', apiKey: 'fake-key-for-tests-only' };
const originalFetch = global.fetch;
const event = (payload, headers = {}) => ({
  httpMethod: 'POST',
  headers: { host: 'deploy-preview-84--ez-quiz.netlify.app', origin: 'https://deploy-preview-84--ez-quiz.netlify.app', 'content-type': 'application/json', ...headers },
  body: JSON.stringify(payload),
});

afterEach(() => { global.fetch = originalFetch; });

test('uses the supplied key without a passphrase or shared provider credentials', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'TF|Routers forward packets.|T' }] } }] }) }));
  const result = await handler(event({ route: '/api/generate', connection, topic: 'Networking', count: 1, types: ['TF'] }));
  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body).lines).toBe('TF|Routers forward packets.|T');
  expect(result.body).not.toContain(connection.apiKey);
  expect(result.headers['Cache-Control']).toBe('no-store');
  expect(fetch).toHaveBeenCalledWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent', expect.objectContaining({
    redirect: 'error', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': connection.apiKey },
  }));
});

test('lists OpenAI models using the supplied provider key', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: [{ id: 'gpt-4.1-mini' }] }) }));
  const result = await handler(event({ route: '/api/models', connection: { ...connection, provider: 'openai' } }));
  expect(JSON.parse(result.body)).toEqual({ models: ['gpt-4.1-mini'] });
  expect(fetch).toHaveBeenCalledWith('https://api.openai.com/v1/models', expect.objectContaining({ headers: { Authorization: 'Bearer ' + connection.apiKey } }));
});

test.each([
  [{ origin: 'https://other.example' }, 403],
  [{ origin: undefined }, 403],
  [{ 'sec-fetch-site': 'cross-site' }, 403],
  [{ 'content-type': 'text/plain' }, 415],
])('rejects incompatible requests before forwarding a key: %j', async (headers, expected) => {
  global.fetch = jest.fn();
  expect((await handler(event({ route: '/api/models', connection }, headers))).statusCode).toBe(expected);
  expect(fetch).not.toHaveBeenCalled();
});

test('does not forward missing credentials, arbitrary routes, or invalid model URLs', async () => {
  global.fetch = jest.fn();
  expect((await handler(event({ route: '/api/models' }))).statusCode).toBe(400);
  expect((await handler(event({ route: 'https://other.example', connection }))).statusCode).toBe(404);
  expect((await handler(event({ route: '/api/models', connection: { ...connection, model: 'https://other.example' } }))).statusCode).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});

test('redacts transport errors that contain credentials', async () => {
  global.fetch = jest.fn(async () => { throw new Error('Network failure: ' + connection.apiKey); });
  const result = await handler(event({ route: '/api/models', connection }));
  expect(result.statusCode).toBe(502);
  expect(result.body).not.toContain(connection.apiKey);
});

test('rejects malformed, oversized, and non-POST requests', async () => {
  const valid = event({ route: '/api/models', connection });
  expect((await handler({ ...valid, body: '{' })).statusCode).toBe(400);
  expect((await handler({ ...valid, body: 'x'.repeat(6 * 1024 * 1024 + 1) })).statusCode).toBe(413);
  expect((await handler({ ...valid, httpMethod: 'GET' })).statusCode).toBe(405);
});
