'use strict';

const {
  buildPrompt,
  buildStructuredPrompt,
  callProvider,
  generateLines,
  generateInBatches,
  outputTokenBudget,
} = require('../lib/providers.js');

function expectSourceHiddenFraming(out){
  expect(out).toMatch(/private instructor knowledge/i);
  expect(out).toMatch(/hidden teacher knowledge/i);
  expect(out).toMatch(/hidden from the learner/i);
  [
    'source material',
    'provided material',
    'notes',
    'lesson',
    'documentation',
    'provided information',
    'provided text',
    'workflow guidance',
    'excerpts',
    'handouts',
    'according to',
    'based solely on',
  ].forEach((phrase) => {
    expect(out).toContain(phrase);
  });
  expect(out).toContain('real troubleshooting scenarios');
  expect(out).toContain('device/config behavior questions');
  expect(out).toContain('conceptual networking questions');
  expect(out).toContain('command-output interpretation questions');
  expect(out).toContain('design/tradeoff questions');
  expect(out).toContain('complete standalone answer choice');
  expect(out).toContain('dangling connector');
  expect(out).toContain('"however," "because," "therefore," or "although"');
  expect(out).toContain('test one claim at a time');
  expect(out).toContain('multi-claim sentences joined by "and," "while," "although," or "because"');
}

describe('providers helpers', () => {
  test('buildStructuredPrompt requests minified JSON schema', () => {
    const out = buildStructuredPrompt('History', 3, ['MC','YN'], 'hard');
    expect(out).toMatch(/structured quiz about History/);
    expect(out).not.toMatch(/private instructor knowledge/i);
    expect(out).toMatch(/Allowed question types: MC, YN/);
    expect(out).toMatch(/Respond with valid minified JSON only/);
    expect(out).toMatch(/Include exactly 3 questions/);
    expect(out).toMatch(/"type": "MC" \| "TF" \| "YN" \| "MT"/);
  });

  test('buildPrompt treats source-backed generation as hidden instructor knowledge', () => {
    const out = buildPrompt('Lecture Notes', 4, ['MC'], 'medium', ['Old source stem?'], 'Term A means alpha.\nTerm B means beta.');
    expect(out).toMatch(/Task: Produce a normal subject-matter quiz about Lecture Notes/);
    expect(out).toMatch(/PRIVATE INSTRUCTOR KNOWLEDGE START/);
    expect(out).toMatch(/Term A means alpha/);
    expect(out).not.toMatch(/Produce a quiz from the source material/);
    expectSourceHiddenFraming(out);
    expect(out).toMatch(/Avoid repeating these already-used question stems: Old source stem\?\./);
    expect(out).toMatch(/EXACTLY 4 quiz lines/);
  });

  test('buildStructuredPrompt uses the same source-hidden framing', () => {
    const out = buildStructuredPrompt('Networking', 2, ['TF','YN'], 'easy', 'Switches learn MAC addresses from source frames.');
    expect(out).toMatch(/structured normal subject-matter quiz about Networking/);
    expect(out).toMatch(/PRIVATE INSTRUCTOR KNOWLEDGE START/);
    expect(out).toMatch(/Switches learn MAC addresses/);
    expectSourceHiddenFraming(out);
    expect(out).toMatch(/Include exactly 2 questions/);
  });

  test('buildPrompt keeps topic-only prompt behavior unchanged', () => {
    const out = buildPrompt('Ports', 2, ['TF'], 'easy', ['Old stem'], '');
    expect(out).toMatch(/Task: Produce a quiz about Ports\./);
    expect(out).not.toMatch(/private instructor knowledge/i);
    expect(out).not.toMatch(/PRIVATE INSTRUCTOR KNOWLEDGE START/);
    expect(out).toMatch(/Avoid repeating these already-used question stems: Old stem\./);
    expect(out).toMatch(/EXACTLY 2 quiz lines/);
  });

  test('source material cleanup uses the shared generation cap', () => {
    const out = buildPrompt('Long Notes', 4, ['MC'], 'medium', [], 'A'.repeat(60010));
    const source = out.match(/PRIVATE INSTRUCTOR KNOWLEDGE START\n([\s\S]+)\nPRIVATE INSTRUCTOR KNOWLEDGE END/)[1];
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
