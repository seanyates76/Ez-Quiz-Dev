'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadBrowserModule } = require('./utils');

describe('parseLinesToState cap enforcement', () => {
  let parseLinesToState;

  beforeAll(() => {
    const { normalizeLettersToIndexes, getMaxQuestions } = loadBrowserModule('public/js/utils.js', ['normalizeLettersToIndexes', 'getMaxQuestions']);
    const source = fs.readFileSync(path.resolve(__dirname, '../public/js/parser.js'), 'utf8')
      .replace(/import\s+\{[^}]+\}\s+from\s+'\.\/utils\.js';?\s*/g, '')
      .replace(/export\s+function\s+/g, 'function ');
    const factory = new Function('normalizeLettersToIndexes', 'getMaxQuestions', `${source}\nreturn { parseLinesToState };`);
    ({ parseLinesToState } = factory(normalizeLettersToIndexes, getMaxQuestions));
  });

  afterEach(() => {
    if (typeof window !== 'undefined') {
      delete window.__EZQ__;
    }
  });

  function buildTrueFalseLines(count) {
    return Array.from({ length: count }, (_, idx) => `TF|Question ${idx + 1}|T`);
  }

  test('flags an error when question count exceeds the configured max', () => {
    window.__EZQ__ = { MAX_QUESTIONS: 3 };
    const result = parseLinesToState(buildTrueFalseLines(4));
    expect(result.error).toMatch(/Too many questions \(4\)/);
    expect(result.error).toMatch(/Limit is 3/);
  });

  test('accepts lists within the cap', () => {
    window.__EZQ__ = { MAX_QUESTIONS: 5 };
    const result = parseLinesToState(buildTrueFalseLines(5));
    expect(result.error).toBeUndefined();
    expect(result.questions).toHaveLength(5);
  });

  test('defaults to 50 when no global cap override is defined', () => {
    const withinCap = parseLinesToState(buildTrueFalseLines(50));
    expect(withinCap.error).toBeUndefined();
    expect(withinCap.questions).toHaveLength(50);

    const overCap = parseLinesToState(buildTrueFalseLines(51));
    expect(overCap.error).toMatch(/Limit is 50/);
  });
});
