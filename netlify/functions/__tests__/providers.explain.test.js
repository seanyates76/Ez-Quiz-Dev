'use strict';

const {
  buildExplanationPrompt,
  parseExplanationOutput,
  extractJsonObject,
  normalizeExplanationText,
  explainQuestions,
} = require('../lib/providers.explain.js');

describe('providers.explain', () => {
  const question = {
    type: 'MC',
    text: 'Which port does HTTPS use by default?',
    options: ['21', '22', '80', '443'],
    correct: [3],
  };

  test('builds a structured prompt with JSON instructions and learner answer context', () => {
    const prompt = buildExplanationPrompt([question], [[2]]);

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

  test('accepts provider JSON array and index aliases', () => {
    const parsed = parseExplanationOutput(
      '[{"index":1,"explanation":"Answer: True.\nWhy it fits: The statement is correct."}]',
      [3]
    );

    expect(parsed).toEqual({
      3: { explanation: 'Answer: True.\nWhy it fits: The statement is correct.' },
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

  test('does not default to echo in production when no provider is configured', async () => {
    await expect(explainQuestions({
      questions: [question],
      originalIndices: [0],
      env: { NODE_ENV: 'production' },
    })).rejects.toMatchObject({ message: 'Explanation provider is not configured' });
  });

  test('allows echo only through explicit local/test opt-in', async () => {
    await expect(explainQuestions({
      provider: 'echo',
      questions: [question],
      originalIndices: [5],
      env: { NODE_ENV: 'production' },
    })).rejects.toMatchObject({ message: 'Echo explanations are disabled' });

    await expect(explainQuestions({
      provider: 'echo',
      questions: [question],
      originalIndices: [5],
      env: { ALLOW_ECHO_EXPLANATIONS: '1' },
    })).resolves.toEqual({
      5: { explanation: expect.stringContaining('Echo fallback should only run') },
    });
  });

  test('uses an injected provider call for configured gemini path and parses output', async () => {
    const callGemini = jest.fn(async ({ prompt, model, apiKey }) => {
      expect(prompt).toContain('Which port does HTTPS use by default?');
      expect(model).toBe('gemini-test');
      expect(apiKey).toBe('secret');
      return '{"items":[{"q":1,"explanation":"Answer: D) 443.\nWhy it fits: HTTPS uses TCP port 443 by default."}]}';
    });

    await expect(explainQuestions({
      questions: [question],
      originalIndices: [8],
      env: { EXPLAIN_PROVIDER: 'gemini', GEMINI_API_KEY: 'secret', GEMINI_MODEL: 'gemini-test' },
      callGemini,
    })).resolves.toEqual({
      8: { explanation: 'Answer: D) 443.\nWhy it fits: HTTPS uses TCP port 443 by default.' },
    });
    expect(callGemini).toHaveBeenCalledTimes(1);
  });

  test('returns structured errors for unsupported providers', async () => {
    await expect(explainQuestions({
      provider: 'anthropic',
      questions: [question],
      originalIndices: [0],
      env: {},
    })).rejects.toMatchObject({
      code: 'EXPLAIN_PROVIDER_UNSUPPORTED',
      status: 400,
    });
  });
});
