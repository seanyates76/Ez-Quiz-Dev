'use strict';

const mockExplainQuestions = jest.fn();

jest.mock('../lib/providers.explain.js', () => ({
  explainQuestions: mockExplainQuestions,
}));

function loadHandler() {
  jest.resetModules();
  jest.doMock('../lib/providers.explain.js', () => ({
    explainQuestions: mockExplainQuestions,
  }));
  return require('../explain-answers-lazy.js').handler;
}

function event(overrides = {}) {
  return {
    httpMethod: 'POST',
    headers: { 'x-ezq-beta': '1' },
    body: JSON.stringify({
      lines: ['MC|Which port does HTTPS use?|A) 21;B) 22;C) 80;D) 443|D'],
      index: 0,
      attemptedAnswers: [[2]],
      provider: 'anthropic',
      model: 'abuse-model',
    }),
    ...overrides,
  };
}

function json(res) {
  return res.body ? JSON.parse(res.body) : null;
}

describe('explain-answers-lazy endpoint', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, NODE_ENV: 'test', EXPLAIN_PROVIDER: 'gemini', GEMINI_MODEL: 'safe-model' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('returns 403 for non-beta requests', async () => {
    const handler = loadHandler();
    const res = await handler(event({ headers: {}, body: '{}' }));
    expect(res.statusCode).toBe(403);
    expect(json(res)).toMatchObject({ error: expect.any(String) });
    expect(mockExplainQuestions).not.toHaveBeenCalled();
  });

  test('returns 405 for non-POST methods', async () => {
    const handler = loadHandler();
    const res = await handler(event({ httpMethod: 'GET' }));
    expect(res.statusCode).toBe(405);
    expect(json(res)).toMatchObject({ error: 'Method not allowed' });
    expect(mockExplainQuestions).not.toHaveBeenCalled();
  });

  test('returns 400 for bad payloads', async () => {
    const handler = loadHandler();
    const res = await handler(event({ body: JSON.stringify({ lines: 'not-array', index: 0 }) }));
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ code: 'EXPLAIN_BAD_REQUEST' });
    expect(mockExplainQuestions).not.toHaveBeenCalled();
  });

  test('returns 200 for mocked provider success and passes attempted answer context', async () => {
    mockExplainQuestions.mockResolvedValue({ 0: { explanation: 'Answer: D) 443.\nWhy it fits: HTTPS uses 443.' } });
    const handler = loadHandler();
    const res = await handler(event());
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ explanations: { 0: { explanation: 'Answer: D) 443.\nWhy it fits: HTTPS uses 443.' } } });
    expect(mockExplainQuestions).toHaveBeenCalledWith(expect.objectContaining({
      questions: [expect.objectContaining({ type: 'MC', text: 'Which port does HTTPS use?' })],
      originalIndices: [0],
      attemptedAnswers: [[2]],
      provider: undefined,
      model: undefined,
      env: process.env,
    }));
  });

  test('maps provider unavailable and provider errors to stable responses', async () => {
    mockExplainQuestions.mockRejectedValue(Object.assign(new Error('Explanation provider is not configured'), {
      code: 'EXPLAIN_PROVIDER_NOT_CONFIGURED',
      status: 503,
    }));
    const handler = loadHandler();
    const res = await handler(event());
    expect(res.statusCode).toBe(503);
    expect(json(res)).toEqual({
      error: 'Explanation provider is not configured',
      code: 'EXPLAIN_PROVIDER_NOT_CONFIGURED',
    });
  });

  test('hides raw provider auth failures from the browser response', async () => {
    mockExplainQuestions.mockRejectedValue(Object.assign(new Error('API_KEY_INVALID from provider'), {
      code: 'EXPLAIN_PROVIDER_ERROR',
      status: 500,
    }));
    const handler = loadHandler();
    const res = await handler(event());
    expect(res.statusCode).toBe(500);
    expect(json(res)).toEqual({
      error: 'Explanation provider failed',
      code: 'EXPLAIN_PROVIDER_ERROR',
    });
  });

  test('does not allow public payload to select provider or model', async () => {
    mockExplainQuestions.mockResolvedValue({ 0: { explanation: 'ok' } });
    const handler = loadHandler();
    const res = await handler(event());
    expect(res.statusCode).toBe(200);
    const call = mockExplainQuestions.mock.calls[0][0];
    expect(call.provider).toBeUndefined();
    expect(call.model).toBeUndefined();
  });

  test('allows x-ezq-beta in CORS preflight headers', async () => {
    const handler = loadHandler();
    const res = await handler(event({ httpMethod: 'OPTIONS', body: '' }));
    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Headers']).toContain('x-ezq-beta');
  });
});
