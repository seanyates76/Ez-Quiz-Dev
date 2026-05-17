'use strict';

function event(body, overrides = {}) {
  return {
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify(body || {}),
    ...overrides,
  };
}

function json(res) {
  return res.body ? JSON.parse(res.body) : null;
}

describe('generate-quiz count guarantees', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv, AI_PROVIDER: 'echo' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('allows and returns 20 generated questions by default', async () => {
    const { handler } = require('../generate-quiz.js');
    const res = await handler(event({ topic: 'Ports', count: 20, provider: 'echo' }));
    const body = json(res);

    expect(res.statusCode).toBe(200);
    expect(String(body.lines).trim().split('\n')).toHaveLength(20);
  });

  test('caps oversized public requests to the 20-question default max', async () => {
    const { handler } = require('../generate-quiz.js');
    const res = await handler(event({ topic: 'Ports', count: 99, provider: 'echo' }));
    const body = json(res);

    expect(res.statusCode).toBe(200);
    expect(String(body.lines).trim().split('\n')).toHaveLength(20);
  });

  test('can opt into a higher internal cap through env configuration', async () => {
    process.env.GENERATE_CLIENT_MAX = '50';
    process.env.GENERATE_MAX_COUNT = '50';
    const { handler } = require('../generate-quiz.js');
    const res = await handler(event({ topic: 'Ports', count: 50, provider: 'echo' }));
    const body = json(res);

    expect(res.statusCode).toBe(200);
    expect(String(body.lines).trim().split('\n')).toHaveLength(50);
  });

  test('accepts imported source material metadata for grounded generation', async () => {
    const { handler } = require('../generate-quiz.js');
    const res = await handler(event({
      topic: 'Lecture Notes',
      count: 2,
      provider: 'echo',
      sourceName: 'lecture.pdf',
      sourceText: ' Alpha fact. \n\n Beta   fact. ',
    }));
    const body = json(res);

    expect(res.statusCode).toBe(200);
    expect(String(body.lines).trim().split('\n')).toHaveLength(2);
    expect(body.source).toEqual({ name: 'lecture.pdf', charCount: 'Alpha fact.\nBeta fact.'.length });
  });

  test('fails explicitly when generation cannot fill the requested count', async () => {
    jest.doMock('../lib/providers.js', () => ({
      generateLines: jest.fn(async () => ({
        title: 'Short Quiz',
        lines: 'TF|One.|T\nTF|Two.|T',
        provider: 'mock',
        model: 'mock',
      })),
      generateInBatches: jest.fn(async () => ({
        title: 'Still Short',
        lines: 'TF|One.|T\nTF|Two.|T\nTF|Three.|T',
        provider: 'mock',
        model: 'mock',
      })),
      callProvider: jest.fn(),
      buildStructuredPrompt: jest.fn(),
    }));
    const { handler } = require('../generate-quiz.js');
    const res = await handler(event({ topic: 'Short', count: 5, provider: 'mock' }));
    const body = json(res);

    expect(res.statusCode).toBe(502);
    expect(body).toMatchObject({
      error: 'Generation failed',
      details: 'Only generated 3 of 5 requested questions',
      provider: 'mock',
    });
  });

  test('does not count malformed prefixed lines toward requested total', async () => {
    jest.doMock('../lib/providers.js', () => ({
      generateLines: jest.fn(async () => ({
        title: 'Malformed Quiz',
        lines: 'MC|Bad|A) one|D\nTF|Good one.|T',
        provider: 'mock',
        model: 'mock',
      })),
      generateInBatches: jest.fn(async () => ({
        title: 'Still Malformed',
        lines: 'MC|Bad|A) one|D\nTF|Good one.|T',
        provider: 'mock',
        model: 'mock',
      })),
      callProvider: jest.fn(),
      buildStructuredPrompt: jest.fn(),
    }));
    const { handler } = require('../generate-quiz.js');
    const res = await handler(event({ topic: 'Malformed', count: 2, provider: 'mock' }));
    const body = json(res);

    expect(res.statusCode).toBe(502);
    expect(body).toMatchObject({
      error: 'Generation failed',
      details: 'Only generated 1 of 2 requested questions',
      provider: 'mock',
    });
  });
});
