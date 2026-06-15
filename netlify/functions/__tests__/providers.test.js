'use strict';

const {
  buildPrompt,
  buildStructuredPrompt,
  callProvider,
  generateLines,
  generateInBatches,
  outputTokenBudget,
} = require('../lib/providers.js');

describe('providers helpers', () => {
  test('buildStructuredPrompt requests minified JSON schema', () => {
    const out = buildStructuredPrompt('History', 3, ['MC','YN'], 'hard');
    expect(out).toMatch(/structured quiz about History/);
    expect(out).toMatch(/Allowed question types: MC, YN/);
    expect(out).toMatch(/Respond with valid minified JSON only/);
    expect(out).toMatch(/Include exactly 3 questions/);
    expect(out).toMatch(/"type": "MC" \| "TF" \| "YN" \| "MT"/);
  });

  test('buildPrompt grounds generated questions in source material when provided', () => {
    const out = buildPrompt('Lecture Notes', 4, ['MC'], 'medium', [], 'Term A means alpha.\nTerm B means beta.');
    expect(out).toMatch(/Task: Produce a quiz from the source material/);
    expect(out).toMatch(/SOURCE MATERIAL START/);
    expect(out).toMatch(/Term A means alpha/);
    expect(out).toMatch(/Base every question and answer on this source material/);
    expect(out).toMatch(/EXACTLY 4 quiz lines/);
  });

  test('source material cleanup uses the shared generation cap', () => {
    const out = buildPrompt('Long Notes', 4, ['MC'], 'medium', [], 'A'.repeat(60010));
    const source = out.match(/SOURCE MATERIAL START\n([\s\S]+)\nSOURCE MATERIAL END/)[1];
    expect(source).toHaveLength(60000);
  });

  test('callProvider echo returns deterministic text', async () => {
    const { text, provider, model } = await callProvider({ provider: 'echo', topic: 'Biology', count: 3, env: {} });
    expect(provider).toBe('echo');
    expect(model).toBe('echo');
    expect(text.split('\n')).toHaveLength(3);
  });

  test('generateLines echo normalizes to requested count', async () => {
    const { title, lines, provider } = await generateLines({ provider: 'echo', topic: 'Chemistry', count: 5, env: {} });
    expect(provider).toBe('echo');
    expect(typeof title).toBe('string');
    const l = String(lines).trim().split('\n');
    expect(l).toHaveLength(5);
  });

  test('legacy provider budget is large enough for complete small quizzes', () => {
    expect(outputTokenBudget(5, 'legacy')).toBeGreaterThanOrEqual(2500);
  });

  test('generateInBatches echo can fill a 50 question request', async () => {
    const { lines, provider } = await generateInBatches({ provider: 'echo', topic: 'History', count: 50, env: {} });
    expect(provider).toBe('echo');
    expect(String(lines).trim().split('\n')).toHaveLength(50);
  });
});
