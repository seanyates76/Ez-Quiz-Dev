'use strict';

const {
  buildExplanationPrompt,
  parseExplanationOutput,
  extractJsonObject,
  normalizeExplanationText,
} = require('../lib/providers.explain.js');

describe('providers.explain', () => {
  test('builds a structured prompt with JSON instructions and learner answer context', () => {
    const prompt = buildExplanationPrompt([
      {
        type: 'MC',
        text: 'Which port does HTTPS use by default?',
        options: ['21', '22', '80', '443'],
        correct: [3],
      },
    ], [[2]]);

    expect(prompt).toContain('Return minified JSON only.');
    expect(prompt).toContain('Line 1 must start with "Answer:".');
    expect(prompt).toContain('Q1: Which port does HTTPS use by default?');
    expect(prompt).toContain('Learner answer: C) 80');
    expect(prompt).toContain('Correct answer(s): D');
    expect(prompt).toContain('Correct option text: D) 443');
  });

  test('extracts JSON from fenced model output', () => {
    const raw = '```json\n{"items":[{"q":1,"explanation":"HTTPS uses TCP port 443 by default."}]}\n```';
    expect(extractJsonObject(raw)).toBe('{"items":[{"q":1,"explanation":"HTTPS uses TCP port 443 by default."}]}');
  });

  test('parses JSON explanation output back to original indices', () => {
    const parsed = parseExplanationOutput(
      '{"items":[{"q":1,"explanation":"HTTPS uses TCP port 443 by default."},{"q":2,"explanation":"SSH uses port 22."}]}',
      [7, 11]
    );

    expect(parsed).toEqual({
      7: { explanation: 'HTTPS uses TCP port 443 by default.' },
      11: { explanation: 'SSH uses port 22.' },
    });
  });

  test('falls back to line-based parsing when the model ignores JSON', () => {
    const parsed = parseExplanationOutput(
      'Q1: Answer: D) 443.\nWhy it fits: HTTPS uses TCP port 443 by default.\nQ2: Answer: B) 22.\nWhy it fits: SSH uses port 22.',
      [2, 4]
    );

    expect(parsed).toEqual({
      2: { explanation: 'Answer: D) 443.\nWhy it fits: HTTPS uses TCP port 443 by default.' },
      4: { explanation: 'Answer: B) 22.\nWhy it fits: SSH uses port 22.' },
    });
  });

  test('normalizes explanation punctuation without losing line breaks', () => {
    expect(normalizeExplanationText('Answer: D) 443.\n- Why it fits: HTTPS uses TCP port 443 by default — not 80.'))
      .toBe('Answer: D) 443.\nWhy it fits: HTTPS uses TCP port 443 by default, not 80.');
  });
});
