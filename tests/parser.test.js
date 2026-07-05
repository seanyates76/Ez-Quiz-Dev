'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadBrowserModule } = require('./utils');
const { parseLegacyQuestion } = require('../netlify/functions/lib/normalizer.js');

describe('legacy parser compatibility', () => {
  let parseEditorInput;

  beforeAll(() => {
    const { normalizeLettersToIndexes, getMaxQuestions } = loadBrowserModule('public/js/utils.js', ['normalizeLettersToIndexes', 'getMaxQuestions']);
    const source = fs.readFileSync(path.resolve(__dirname, '../public/js/parser.js'), 'utf8')
      .replace(/import\s+\{[^}]+\}\s+from\s+'\.\/utils\.js';?\s*/g, '')
      .replace(/export\s+function\s+/g, 'function ');
    const factory = new Function('normalizeLettersToIndexes', 'getMaxQuestions', `${source}\nreturn { parseEditorInput };`);
    ({ parseEditorInput } = factory(normalizeLettersToIndexes, getMaxQuestions));
  });

  test('rejects malformed MT mappings before they can be counted', () => {
    const malformed = 'MT|Match terms.|1) One;2) Two;3) Three|A) Alpha;B) Beta;C) Gamma|1-B,2-A,3';

    const browserParsed = parseEditorInput(malformed);

    expect(browserParsed.questions).toHaveLength(0);
    expect(browserParsed.errors).toEqual(['Line 1: MT parse error']);
    expect(parseLegacyQuestion(malformed)).toBeNull();
  });

  test('accepts valid MT mappings', () => {
    const valid = 'MT|Match terms.|1) One;2) Two;3) Three|A) Alpha;B) Beta;C) Gamma|1-B,2-A,3-C';

    const browserParsed = parseEditorInput(valid);
    const serverParsed = parseLegacyQuestion(valid);

    expect(browserParsed.errors).toEqual([]);
    expect(browserParsed.questions).toHaveLength(1);
    expect(serverParsed).toMatchObject({
      type: 'MT',
      matches: [[0, 1], [1, 0], [2, 2]],
    });
  });

  test('server rejects incomplete MT mappings even when pair syntax is otherwise valid', () => {
    const incomplete = 'MT|Match terms.|1) One;2) Two;3) Three|A) Alpha;B) Beta;C) Gamma|1-B,2-A';

    expect(parseLegacyQuestion(incomplete)).toBeNull();
  });
});
