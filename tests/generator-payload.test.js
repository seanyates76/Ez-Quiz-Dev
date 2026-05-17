'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadBrowserModule } = require('./utils');

describe('buildGeneratorPayload', () => {
  let buildGeneratorPayload;
  let clampCount;

  beforeAll(() => {
    ({ clampCount } = loadBrowserModule('public/js/utils.js', ['clampCount']));
    const source = fs.readFileSync(path.resolve(__dirname, '../public/js/generator-payload.js'), 'utf8')
      .replace(/import[^;]+;\s*/g, '')
      .replace(/export\s+function\s+/g, 'function ');
    const factory = new Function('clampCount', `${source}\nreturn { buildGeneratorPayload };`);
    ({ buildGeneratorPayload } = factory(clampCount));
  });

  test('clamps the count to the configured maximum', () => {
    window.__EZQ__ = { MAX_QUESTIONS: 12 };
    const result = buildGeneratorPayload({ topic: 'Space', difficulty: 'hard', count: 99 });
    expect(result.count).toBe(12);
  });

  test('defaults topic and difficulty when values are blank', () => {
    delete window.__EZQ__;
    const result = buildGeneratorPayload({ topic: '   ', difficulty: '', count: '' });
    expect(result.topic).toBe('General knowledge');
    expect(result.difficulty).toBe('medium');
    expect(result.count).toBe(1);
  });

  test('carries cleaned source material when media import supplied it', () => {
    const result = buildGeneratorPayload({
      topic: 'Scan',
      difficulty: 'easy',
      count: 3,
      sourceName: 'notes.pdf',
      sourceText: ' Heading \n\n First   fact. \r\n Second fact. ',
    });

    expect(result).toMatchObject({
      topic: 'Scan',
      difficulty: 'easy',
      count: 3,
      sourceName: 'notes.pdf',
      sourceText: 'Heading\nFirst fact.\nSecond fact.',
    });
  });

  test('caps cleaned source material at the shared generation limit', () => {
    const result = buildGeneratorPayload({
      topic: 'Long Notes',
      difficulty: 'medium',
      count: 5,
      sourceText: 'A'.repeat(30010),
    });

    expect(result.sourceText).toHaveLength(30000);
  });
});
