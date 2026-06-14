/** @jest-environment jsdom */
'use strict';

const { loadBrowserModule } = require('./utils');

function loadApi() {
  return loadBrowserModule('public/js/api.js', ['generateWithAI', 'LARGE_SOURCE_CHUNK_TARGET_CHARS', 'SECTION_PACKET_TEXT_MAX_CHARS']);
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

  function sectionReport(count, overrides = {}) {
    const weakIndexes = new Set(overrides.weakIndexes || []);
    const lowScoreIndexes = new Set(overrides.lowScoreIndexes || []);
    return {
      version: 1,
      sectionCount: count,
      quizWorthyCount: count - weakIndexes.size - lowScoreIndexes.size,
      weakCount: weakIndexes.size,
      sections: Array.from({ length: count }, (_, index) => {
        const n = index + 1;
        const weak = weakIndexes.has(n);
        const lowScore = lowScoreIndexes.has(n);
        const score = lowScore ? 32 : 100 - index;
        return {
          id: `section-${String(n).padStart(3, '0')}`,
          heading: `Topic ${n}`,
          headingPath: ['Domain', `Topic ${n}`],
          text: [
            `Topic ${n}: this section explains a quiz-worthy concept with definitions and comparisons.`,
            `Term ${n}: a compact explanation used for certification study.`,
            `Because this concept affects troubleshooting, learners should know the cause and effect.`,
          ].join('\n'),
          charCount: 220,
          lineCount: 3,
          bulletCount: n % 2 ? 4 : 0,
          codeBlockCount: n % 5 === 0 ? 1 : 0,
          listCount: n % 2 ? 1 : 0,
          definitionSignal: true,
          termSignal: true,
          commandSignal: n % 5 === 0,
          score,
          reasons: ['definitions', 'terms', n % 2 ? 'bullet-heavy' : 'cause-effect'].filter(Boolean),
          flags: weak ? ['weak', 'placeholder'] : [],
        };
      }),
    };
  }

  test('large source with sourceReport uses section-based requests instead of raw chunks', async () => {
    const { generateWithAI, SECTION_PACKET_TEXT_MAX_CHARS } = loadApi();
    const sourceText = 'A'.repeat(30000);
    const report = sectionReport(25);
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
      sourceName: 'ccna.md',
      sourceReport: report,
      types: ['TF'],
    });

    expect(bodies).toHaveLength(20);
    expect(bodies.every((body) => body.count === 1)).toBe(true);
    expect(bodies.every((body) => body.sourceText.length <= SECTION_PACKET_TEXT_MAX_CHARS + 120)).toBe(true);
    expect(bodies.every((body) => body.sourceText !== sourceText)).toBe(true);
    expect(bodies.every((body) => !body.sourceReport)).toBe(true);
    expect(bodies[0].sourceText).toContain('Heading path: Domain > Topic 1');
    expect(bodies[0].sourceText).toContain('Section content:');
    expect(bodies[0].sourceText).toContain('Topic 1: this section explains');
    expect(out.lines.split('\n')).toHaveLength(20);
  });

  test('section-aware count 10 and count 5 distribute across selected sections', async () => {
    const { generateWithAI } = loadApi();
    const sourceText = 'B'.repeat(30000);
    const report = sectionReport(12);
    const runs = [];

    for(const requested of [10, 5]){
      const bodies = [];
      let nextQuestion = 1;
      global.fetch = jest.fn(async (_url, options = {}) => {
        const body = JSON.parse(options.body || '{}');
        bodies.push(body);
        const start = nextQuestion;
        nextQuestion += body.count;
        return okResponse(tfLines(start, body.count));
      });

      const out = await generateWithAI('Long Notes', requested, {
        sourceText,
        sourceReport: report,
        types: ['TF'],
      });
      runs.push({ requested, bodies, out });
    }

    expect(runs[0].bodies).toHaveLength(10);
    expect(runs[0].bodies.every((body) => body.count === 1)).toBe(true);
    expect(runs[0].bodies[0].sourceText).toContain('Heading path: Domain > Topic 1');
    expect(runs[0].out.lines.split('\n')).toHaveLength(10);
    expect(runs[1].bodies).toHaveLength(5);
    expect(runs[1].bodies.every((body) => body.count === 1)).toBe(true);
    expect(runs[1].bodies[0].sourceText).toContain('Heading path: Domain > Topic 1');
    expect(runs[1].out.lines.split('\n')).toHaveLength(5);
  });

  test('weak sections are skipped and quiz-worthy sections are preferred', async () => {
    const { generateWithAI } = loadApi();
    const sourceText = 'C'.repeat(30000);
    const report = sectionReport(8, { weakIndexes: [1, 3], lowScoreIndexes: [2] });
    const bodies = [];
    let nextQuestion = 1;
    global.fetch = jest.fn(async (_url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      bodies.push(body);
      const start = nextQuestion;
      nextQuestion += body.count;
      return okResponse(tfLines(start, body.count));
    });

    await generateWithAI('Long Notes', 5, {
      sourceText,
      sourceReport: report,
      types: ['TF'],
    });

    const requestText = bodies.map((body) => body.sourceText).join('\n---\n');
    expect(requestText).not.toContain('Topic 1:');
    expect(requestText).not.toContain('Topic 2:');
    expect(requestText).not.toContain('Topic 3:');
    expect(requestText).toContain('Topic 4:');
    expect(requestText).toContain('Topic 5:');
    expect(bodies.every((body) => body.count === 1)).toBe(true);
  });

  test('section-aware dedupe passes avoidStems and retries against another safe section', async () => {
    const { generateWithAI } = loadApi();
    const sourceText = 'D'.repeat(30000);
    const report = sectionReport(4);
    const bodies = [];
    global.fetch = jest.fn(async (_url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      bodies.push(body);
      if(bodies.length === 1) return okResponse('TF|Question 1.|T');
      if(bodies.length === 2) return okResponse(['TF|Question 1.|T', 'not a quiz line'].join('\n'));
      if(bodies.length === 3) return okResponse('TF|Question 2.|T');
      return okResponse('TF|Question 3.|T');
    });

    const out = await generateWithAI('Long Notes', 3, {
      sourceText,
      sourceReport: report,
      types: ['TF'],
    });

    const lines = out.lines.split('\n');
    expect(bodies).toHaveLength(4);
    expect(bodies.map((body) => body.count)).toEqual([1, 1, 1, 1]);
    expect(bodies[0].avoidStems).toEqual([]);
    expect(bodies[1].avoidStems).toEqual(['Question 1.']);
    expect(bodies[3].avoidStems).toEqual(['Question 1.', 'Question 2.']);
    expect(bodies[3].sourceText).toContain('Heading path: Domain > Topic 4');
    expect(lines).toHaveLength(3);
    expect(lines.filter((line) => line === 'TF|Question 1.|T')).toHaveLength(1);
    expect(lines).not.toContain('not a quiz line');
  });

  test('unusable sourceReport falls back to raw source chunks', async () => {
    const { generateWithAI, LARGE_SOURCE_CHUNK_TARGET_CHARS } = loadApi();
    const sourceText = 'E'.repeat(30000);
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
      sourceReport: sectionReport(5, { weakIndexes: [1, 2, 3, 4, 5] }),
      types: ['TF'],
    });

    expect(bodies).toHaveLength(5);
    expect(bodies.every((body) => body.sourceText.length <= LARGE_SOURCE_CHUNK_TARGET_CHARS)).toBe(true);
    expect(bodies.every((body) => !String(body.sourceText || '').includes('Heading path:'))).toBe(true);
    expect(out.lines.split('\n')).toHaveLength(5);
  });

  test('large source count 20 falls back to chunked source requests without sourceReport', async () => {
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

  test('large source count 10 falls back to source chunks without sourceReport', async () => {
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

  test('large source count 5 falls back to source chunks instead of one full-source request without sourceReport', async () => {
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

  test('raw chunk fallback dedupes duplicate stems and retries only the remaining count', async () => {
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
