/** @jest-environment jsdom */
'use strict';

const { loadBrowserModule } = require('./utils');

function loadApi() {
  return loadBrowserModule('public/js/api.js', ['generateWithAI', 'LARGE_SOURCE_CHUNK_TARGET_CHARS']);
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

  function okResponse(lines, title = 'Generated Quiz') {
    return {
      ok: true,
      status: 200,
      json: async () => ({ lines, title }),
    };
  }

  function tfLines(start, count) {
    return Array.from({ length: count }, (_, idx) => `TF|Question ${start + idx}.|T`).join('\n');
  }

  test('large source count 20 sends chunked source requests without the full source', async () => {
    const { generateWithAI, LARGE_SOURCE_CHUNK_TARGET_CHARS } = loadApi();
    const sourceText = 'A'.repeat(30000);
    const bodies = [];
    let nextQuestion = 1;
    global.fetch = jest.fn(async (_url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      bodies.push(body);
      const start = nextQuestion;
      nextQuestion += body.count;
      return okResponse(tfLines(start, body.count));
    });

    const out = await generateWithAI('Long Notes', 20, {
      sourceText,
      types: ['TF'],
    });

    expect(LARGE_SOURCE_CHUNK_TARGET_CHARS).toBe(4000);
    expect(bodies).toHaveLength(8);
    expect(bodies.map((body) => body.count)).toEqual([3, 3, 3, 3, 2, 2, 2, 2]);
    expect(bodies.every((body) => body.sourceText.length <= LARGE_SOURCE_CHUNK_TARGET_CHARS)).toBe(true);
    expect(bodies.every((body) => body.sourceText !== sourceText)).toBe(true);
    expect(bodies[0].avoidStems).toEqual([]);
    expect(bodies[1].avoidStems).toEqual(['Question 1.', 'Question 2.', 'Question 3.']);
    expect(out.lines.split('\n')).toHaveLength(20);
  });

  test('large source count 10 distributes questions across source chunks', async () => {
    const { generateWithAI, LARGE_SOURCE_CHUNK_TARGET_CHARS } = loadApi();
    const sourceText = 'B'.repeat(30000);
    const bodies = [];
    let nextQuestion = 1;
    global.fetch = jest.fn(async (_url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      bodies.push(body);
      const start = nextQuestion;
      nextQuestion += body.count;
      return okResponse(tfLines(start, body.count));
    });

    const out = await generateWithAI('Long Notes', 10, {
      sourceText,
      types: ['TF'],
    });

    expect(bodies).toHaveLength(8);
    expect(bodies.map((body) => body.count)).toEqual([2, 2, 1, 1, 1, 1, 1, 1]);
    expect(bodies.every((body) => body.sourceText.length <= LARGE_SOURCE_CHUNK_TARGET_CHARS)).toBe(true);
    expect(bodies.every((body) => body.sourceText !== sourceText)).toBe(true);
    expect(out.lines.split('\n')).toHaveLength(10);
  });

  test('large source count 5 still uses source chunks instead of one full-source request', async () => {
    const { generateWithAI, LARGE_SOURCE_CHUNK_TARGET_CHARS } = loadApi();
    const sourceText = 'C'.repeat(30000);
    const bodies = [];
    let nextQuestion = 1;
    global.fetch = jest.fn(async (_url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      bodies.push(body);
      const start = nextQuestion;
      nextQuestion += body.count;
      return okResponse(tfLines(start, body.count));
    });

    const out = await generateWithAI('Long Notes', 5, {
      sourceText,
      types: ['TF'],
    });

    expect(bodies).toHaveLength(5);
    expect(bodies.map((body) => body.count)).toEqual([1, 1, 1, 1, 1]);
    expect(bodies.every((body) => body.sourceText.length <= LARGE_SOURCE_CHUNK_TARGET_CHARS)).toBe(true);
    expect(bodies.every((body) => body.sourceText !== sourceText)).toBe(true);
    expect(out.lines.split('\n')).toHaveLength(5);
  });

  test('large source batching dedupes duplicate stems and retries only the remaining count', async () => {
    const { generateWithAI, LARGE_SOURCE_CHUNK_TARGET_CHARS } = loadApi();
    const sourceText = 'D'.repeat(30000);
    const bodies = [];
    global.fetch = jest.fn(async (_url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      bodies.push(body);
      if(bodies.length === 1) return okResponse(tfLines(1, 3));
      if(bodies.length === 2) {
        return okResponse([
          'TF|Question 1.|T',
          tfLines(4, 2),
          'not a quiz line',
        ].join('\n'));
      }
      if(bodies.length === 3) return okResponse(tfLines(6, 3));
      if(bodies.length === 4) return okResponse(tfLines(9, 3));
      if(bodies.length === 5) return okResponse(tfLines(12, 2));
      if(bodies.length === 6) return okResponse(tfLines(14, 2));
      if(bodies.length === 7) return okResponse(tfLines(16, 2));
      if(bodies.length === 8) return okResponse(tfLines(18, 2));
      return okResponse(tfLines(20, body.count));
    });

    const out = await generateWithAI('Long Notes', 20, {
      sourceText,
      types: ['TF'],
    });

    const lines = out.lines.split('\n');
    expect(bodies.map((body) => body.count)).toEqual([3, 3, 3, 3, 2, 2, 2, 2, 1]);
    expect(bodies[8].avoidStems).toEqual(Array.from({ length: 19 }, (_, idx) => `Question ${idx + 1}.`));
    expect(bodies[8].sourceText.length).toBeLessThanOrEqual(LARGE_SOURCE_CHUNK_TARGET_CHARS);
    expect(bodies[8].sourceText).not.toBe(sourceText);
    expect(lines).toHaveLength(20);
    expect(lines.filter((line) => line === 'TF|Question 1.|T')).toHaveLength(1);
    expect(lines).not.toContain('not a quiz line');
  });

  test('topic-only count 20 still makes one API request', async () => {
    const { generateWithAI } = loadApi();
    const bodies = [];
    global.fetch = jest.fn(async (_url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      bodies.push(body);
      return okResponse(tfLines(1, body.count));
    });

    const out = await generateWithAI('Ports', 20, { types: ['TF'] });

    expect(bodies).toHaveLength(1);
    expect(bodies[0].count).toBe(20);
    expect(bodies[0]).not.toHaveProperty('sourceText');
    expect(out.lines.split('\n')).toHaveLength(20);
  });

  test('small-source count 20 still makes one API request', async () => {
    const { generateWithAI } = loadApi();
    const sourceText = 'Small source line.\n'.repeat(400);
    const bodies = [];
    global.fetch = jest.fn(async (_url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      bodies.push(body);
      return okResponse(tfLines(1, body.count));
    });

    const out = await generateWithAI('Short Notes', 20, {
      sourceText,
      types: ['TF'],
    });

    expect(bodies).toHaveLength(1);
    expect(bodies[0].count).toBe(20);
    expect(bodies[0].sourceText).toBe(sourceText);
    expect(out.lines.split('\n')).toHaveLength(20);
  });
});
