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

  test('accepts source-backed batched requests with mixed planned types', async () => {
    const sectionExcerpt = (label) => `${label} ${'CCNA troubleshooting detail with terms, commands, and cause effect relationships. '.repeat(7)}`.slice(0, 520);
    const sourceText = [
      'Source name: CCNA_Notes.md',
      'Planned question 1 type: MC',
      'Heading path: Switching > VLANs',
      'Section excerpt:',
      sectionExcerpt('VLANs segment broadcast domains.'),
      '---',
      'Planned question 2 type: TF',
      'Heading path: Routing > OSPF',
      'Section excerpt:',
      sectionExcerpt('OSPF uses cost and adjacencies.'),
      '---',
      'Planned question 3 type: YN',
      'Heading path: IPv6',
      'Section excerpt:',
      sectionExcerpt('IPv6 neighbor discovery uses ICMPv6.'),
      '---',
      'Planned question 4 type: MC',
      'Heading path: Switching > STP',
      'Section excerpt:',
      sectionExcerpt('STP blocks redundant paths.'),
      '---',
      'Planned question 5 type: MT',
      'Heading path: Services > Ports',
      'Section excerpt:',
      sectionExcerpt('SSH uses 22 and DNS uses 53.'),
    ].join('\n');
    const { handler } = require('../generate-quiz.js');
    const res = await handler(event({
      topic: 'CCNA Notes',
      count: 5,
      types: ['MC', 'TF', 'YN', 'MC', 'MT'],
      difficulty: 'hard',
      provider: 'echo',
      sourceName: 'CCNA_Notes.md',
      sourceText,
      avoidStems: [],
    }));
    const body = json(res);
    const lines = String(body.lines || '').trim().split('\n');
    const cleanedCharCount = sourceText
      .split('\n')
      .map((line) => line.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .join('\n')
      .length;

    expect(res.statusCode).toBe(200);
    expect(sourceText.length).toBeLessThanOrEqual(3500);
    expect((sourceText.match(/Source name:/g) || [])).toHaveLength(1);
    expect(lines).toHaveLength(5);
    expect(lines.map((line) => line.split('|')[0])).toEqual(['MC', 'TF', 'YN', 'MC', 'MT']);
    expect(body.source).toEqual({ name: 'CCNA_Notes.md', charCount: cleanedCharCount });
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

  test('returns a structured 400 for invalid request types', async () => {
    const { handler } = require('../generate-quiz.js');
    const res = await handler(event({
      topic: 'Ports',
      count: 5,
      provider: 'echo',
      types: ['MC', 'ESSAY'],
    }));
    const body = json(res);

    expect(res.statusCode).toBe(400);
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(body).toMatchObject({
      error: 'Invalid request',
      code: 'INVALID_TYPES',
      field: 'types',
      invalidTypes: ['ESSAY'],
    });
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

  test('returns JSON instead of a raw 500 body for handled provider failures', async () => {
    const generateLines = jest.fn(async () => {
      const err = new Error('Provider exploded while generating the batch');
      err.status = '500';
      err.code = 'PROVIDER_BATCH_FAILED';
      throw err;
    });
    jest.doMock('../lib/providers.js', () => ({
      generateLines,
      generateInBatches: jest.fn(),
      callProvider: jest.fn(),
      buildStructuredPrompt: jest.fn(),
    }));
    const { handler } = require('../generate-quiz.js');
    const res = await handler(event({
      topic: 'CCNA Notes',
      count: 5,
      provider: 'mock',
      types: ['MC', 'TF', 'YN', 'MC', 'MT'],
      difficulty: 'hard',
      sourceName: 'CCNA_Notes.md',
      sourceText: 'Planned question 1 type: MC\nSection content: switching notes.',
      avoidStems: [],
    }));
    const body = json(res);

    expect(generateLines).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(502);
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(res.body).not.toBe('500');
    expect(body).toMatchObject({
      error: 'Generation failed',
      details: 'Provider exploded while generating the batch',
      provider: 'mock',
      code: 'PROVIDER_BATCH_FAILED',
    });
  });

  test('returns structured timeout JSON for provider timeouts', async () => {
    const generateLines = jest.fn(async () => {
      const err = new Error('Gemini provider timed out after 22000ms');
      err.status = 504;
      err.code = 'PROVIDER_TIMEOUT';
      throw err;
    });
    jest.doMock('../lib/providers.js', () => ({
      generateLines,
      generateInBatches: jest.fn(),
      callProvider: jest.fn(),
      buildStructuredPrompt: jest.fn(),
    }));
    const { handler } = require('../generate-quiz.js');
    const res = await handler(event({
      topic: 'CCNA Notes',
      count: 5,
      provider: 'mock',
      types: ['MC', 'TF', 'YN', 'MC', 'MT'],
      sourceName: 'CCNA_Notes.md',
      sourceText: 'Source name: CCNA_Notes.md\nPlanned question 1 type: MC\nHeading path: Switching\nSection excerpt:\nVLAN notes.',
    }));
    const body = json(res);

    expect(res.statusCode).toBe(504);
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(res.body).not.toBe('500');
    expect(body).toMatchObject({
      error: 'Generation timed out',
      details: 'Gemini provider timed out after 22000ms',
      provider: 'mock',
      code: 'PROVIDER_TIMEOUT',
    });
  });

  test('does not attempt Gemini fallback after provider timeout', async () => {
    process.env.GEMINI_API_KEY = 'fallback-key';
    const generateLines = jest.fn(async () => {
      const err = new Error('OpenAI provider timed out after 22000ms');
      err.status = 504;
      err.code = 'PROVIDER_TIMEOUT';
      throw err;
    });
    jest.doMock('../lib/providers.js', () => ({
      generateLines,
      generateInBatches: jest.fn(),
      callProvider: jest.fn(),
      buildStructuredPrompt: jest.fn(),
    }));
    const { handler } = require('../generate-quiz.js');
    const res = await handler(event({
      topic: 'CCNA Notes',
      count: 5,
      provider: 'openai',
      types: ['MC', 'TF', 'YN', 'MC', 'MT'],
      sourceName: 'CCNA_Notes.md',
      sourceText: 'Source name: CCNA_Notes.md\nPlanned question 1 type: MC\nHeading path: Switching\nSection excerpt:\nVLAN notes.',
    }));
    const body = json(res);

    expect(generateLines).toHaveBeenCalledTimes(1);
    expect(generateLines.mock.calls[0][0].provider).toBe('openai');
    expect(res.statusCode).toBe(504);
    expect(body).toMatchObject({
      error: 'Generation timed out',
      details: 'OpenAI provider timed out after 22000ms',
      provider: 'openai',
      code: 'PROVIDER_TIMEOUT',
    });
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
