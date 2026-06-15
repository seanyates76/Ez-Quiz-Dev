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

function expectSharedDifficultyGuidance(out, level){
  expect(out).toContain(`Difficulty target: ${level}.`);
  expect(out).toContain('Difficulty should come from the thinking required, not from dense wording.');
  expect(out).toContain('Use clear technician/instructor language.');
  expect(out).toContain('Keep stems concise unless the scenario genuinely needs detail.');
  expect(out).toContain('inflated phrasing');
  expect(out).toContain('vague abstractions');
  expect(out).toContain('excessive absolute traps');
  expect(out).toContain('"solely", "exclusively", "guarantee", "inherently", "unequivocally", or "definitively"');
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

  test('easy difficulty guidance favors direct checks and avoids tricks', () => {
    const out = buildPrompt('Ports', 2, ['TF'], 'easy', [], '');
    expect(out).toMatch(/Task: Produce a quiz about Ports\./);
    expect(out).not.toMatch(/private instructor knowledge/i);
    expectSharedDifficultyGuidance(out, 'Easy');
    expect(out).toContain('Easy: test one direct fact, definition, command purpose, or basic behavior.');
    expect(out).toContain('Use short stems. Avoid trick wording.');
  });

  test('medium difficulty guidance favors compact applied scenarios', () => {
    const out = buildStructuredPrompt('Switching', 3, ['MC'], 'medium');
    expectSharedDifficultyGuidance(out, 'Medium');
    expect(out).toContain('Medium: test applied understanding.');
    expect(out).toContain('Use compact realistic scenarios that require one inference, comparison, or cause/effect link.');
    expect(out).toContain('Distractors should be plausible but not sneaky.');
  });

  test('hard difficulty guidance requires reasoning instead of verbal traps', () => {
    const legacy = buildPrompt('Routing', 4, ['MC','TF'], 'hard', [], '');
    const structured = buildStructuredPrompt('Routing', 4, ['MC','TF'], 'hard');

    [legacy, structured].forEach((out) => {
      expectSharedDifficultyGuidance(out, 'Hard');
      expect(out).toContain('Hard: test troubleshooting judgment, design tradeoffs, route/device behavior, command-output interpretation, or multi-step reasoning.');
      expect(out).toContain('Hard scenarios may include more context, but the wording should stay clean and practical.');
      expect(out).toContain('Prefer realistic network situations over abstract verbal traps.');
      expect(out).toContain('do not make most questions hinge on one sneaky absolute word');
      expect(out).toContain('networking knowledge, not legalistic reading');
    });
  });

  test('expert difficulty guidance emphasizes edge cases and clear language', () => {
    const out = buildPrompt('OSPF', 5, ['MC'], 'expert', [], '');
    expectSharedDifficultyGuidance(out, 'Expert');
    expect(out).toContain('Expert: test edge cases, multi-step diagnosis, competing design tradeoffs, or subtle protocol/device behavior.');
    expect(out).toContain('Keep the language clear even when the reasoning is demanding.');
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
    expectSharedDifficultyGuidance(out, 'Easy');
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
