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
});
