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

  test('allows and returns 50 generated questions by default', async () => {
    const { handler } = require('../generate-quiz.js');
    const res = await handler(event({ topic: 'Ports', count: 50, provider: 'echo' }));
    const body = json(res);

    expect(res.statusCode).toBe(200);
    expect(String(body.lines).trim().split('\n')).toHaveLength(50);
  });

  test('caps oversized public requests to the 50-question default max', async () => {
    const { handler } = require('../generate-quiz.js');
    const res = await handler(event({ topic: 'Ports', count: 99, provider: 'echo' }));
    const body = json(res);

    expect(res.statusCode).toBe(200);
    expect(String(body.lines).trim().split('\n')).toHaveLength(50);
  });

  test('can lower the public cap through env configuration', async () => {
    process.env.GENERATE_CLIENT_MAX = '30';
    process.env.GENERATE_MAX_COUNT = '30';
    const { handler } = require('../generate-quiz.js');
    const res = await handler(event({ topic: 'Ports', count: 50, provider: 'echo' }));
    const body = json(res);

    expect(res.statusCode).toBe(200);
    expect(String(body.lines).trim().split('\n')).toHaveLength(30);
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

  test('reports the shared source material cap after server cleanup', async () => {
    const { handler } = require('../generate-quiz.js');
    const res = await handler(event({
      topic: 'Long Notes',
      count: 1,
      provider: 'echo',
      sourceName: 'long.txt',
      sourceText: 'A'.repeat(60010),
    }));
    const body = json(res);

    expect(res.statusCode).toBe(200);
    expect(body.source).toEqual({ name: 'long.txt', charCount: 60000 });
  });

  test('sanitizes request avoidStems and passes them to the provider path', async () => {
    const generateLines = jest.fn(async (args) => ({
      title: 'Avoided Quiz',
      lines: Array.from({ length: args.count }, (_, idx) => `TF|Avoided ${idx + 1}.|T`).join('\n'),
      provider: 'mock',
      model: 'mock',
    }));
    jest.doMock('../lib/providers.js', () => ({
      generateLines,
      generateInBatches: jest.fn(),
      callProvider: jest.fn(),
      buildStructuredPrompt: jest.fn(),
    }));
    const { handler } = require('../generate-quiz.js');
    const res = await handler(event({
      topic: 'Ports',
      count: 2,
      provider: 'mock',
      avoidStems: [' Alpha stem? ', '', 'Alpha stem?', 'Beta|stem\nagain', null],
    }));

    expect(res.statusCode).toBe(200);
    expect(generateLines).toHaveBeenCalledTimes(1);
    expect(generateLines.mock.calls[0][0].avoidStems).toEqual([
      'Alpha stem?',
      'Beta stem again',
    ]);
  });

  test('returns partial legacy lines when generation cannot fill the requested count', async () => {
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

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      title: 'Still Short',
      provider: 'mock',
      partial: true,
      completedCount: 3,
      requestedCount: 5,
      warning: 'Quiz ready with 3 of 5 questions.',
    });
    expect(String(body.lines).trim().split('\n')).toHaveLength(3);
  });

  test('filters malformed prefixed lines out of partial legacy responses', async () => {
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

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      title: 'Malformed Quiz',
      provider: 'mock',
      partial: true,
      completedCount: 1,
      requestedCount: 2,
      warning: 'Quiz ready with 1 of 2 questions.',
    });
    expect(body.lines).toBe('TF|Good one.|T');
  });

  test('fails explicitly when generation returns zero usable questions', async () => {
    jest.doMock('../lib/providers.js', () => ({
      generateLines: jest.fn(async () => ({
        title: 'Empty Quiz',
        lines: 'not a quiz line',
        provider: 'mock',
        model: 'mock',
      })),
      generateInBatches: jest.fn(async () => ({
        title: 'Still Empty',
        lines: 'MC|Bad|A) one|D\nnot a quiz line',
        provider: 'mock',
        model: 'mock',
      })),
      callProvider: jest.fn(),
      buildStructuredPrompt: jest.fn(),
    }));
    const { handler } = require('../generate-quiz.js');
    const res = await handler(event({ topic: 'Empty', count: 2, provider: 'mock' }));
    const body = json(res);

    expect(res.statusCode).toBe(502);
    expect(body).toMatchObject({
      error: 'Generation failed',
      details: 'Only generated 0 of 2 requested questions',
      provider: 'mock',
    });
  });
});
