'use strict';

const {
  DEFAULT_ASYNC_PROVIDER_TIMEOUT_MS,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  asyncProviderTimeoutMs,
  buildPrompt,
  buildStructuredPrompt,
  callProvider,
  generateLines,
  generateInBatches,
  outputTokenBudget,
  providerTimeoutMs,
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
  expect(out).toContain('Use clear subject-matter language.');
  expect(out).toContain('Keep stems concise unless the scenario genuinely needs detail.');
  expect(out).toContain('Use technical terms when the topic requires them');
  expect(out).toContain('do not make the wording artificially dense');
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
    expect(out).toContain('Easy: test one direct fact, definition, purpose, command/function, or basic behavior.');
    expect(out).toContain('Use short stems. Avoid trick wording.');
  });

  test('very easy difficulty guidance stays simple without dense wording', () => {
    const legacy = buildPrompt('Ports', 2, ['TF'], 'very-easy', [], '');
    const structured = buildStructuredPrompt('Ports', 2, ['TF'], 'very-easy');

    [legacy, structured].forEach((out) => {
      expectSharedDifficultyGuidance(out, 'Very Easy');
      expect(out).toContain('Very Easy: test one obvious fact, term, definition, purpose, command/function, or basic behavior.');
      expect(out).toContain('Use short direct stems and obvious distractors.');
    });
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
      expect(out).toContain('Hard: test applied judgment, important distinctions, cause/effect, classification, chronology, troubleshooting, design tradeoffs, or multi-step reasoning.');
      expect(out).toContain("Use the subject's real context.");
      expect(out).toContain('For technical topics, this may include device behavior, command output, configuration choices, protocols, procedures, or failure diagnosis.');
      expect(out).toContain('For nontechnical topics, this may include meaningful comparisons, timeline/order relationships, role/status distinctions, evidence-based interpretation, or choosing the best action in a realistic scenario.');
      expect(out).toContain('Prefer useful difficulty over obscure trivia.');
      expect(out).toContain('niche names, one-off facts, or fan-lore minutiae');
      expect(out).toContain('do not make most questions hinge on one sneaky absolute word');
    });
  });

  test('expert difficulty guidance emphasizes edge cases and clear language', () => {
    const out = buildPrompt('OSPF', 5, ['MC'], 'expert', [], '');
    expectSharedDifficultyGuidance(out, 'Expert');
    expect(out).toContain('Expert: test edge cases, competing interpretations, multi-step diagnosis, subtle distinctions, or advanced subject-matter relationships.');
    expect(out).toContain('For technical topics, protocol/device behavior and command-output interpretation are appropriate when relevant.');
    expect(out).toContain('Keep language clear even when reasoning is demanding.');
  });

  test('hard guidance appears in topic-only and source-backed prompt builders', () => {
    const topicOnly = buildPrompt('World History', 3, ['MC'], 'hard', [], '');
    const sourceBacked = buildStructuredPrompt('Lecture Notes', 3, ['MC'], 'hard', 'Alpha caused Beta after the treaty.');

    [topicOnly, sourceBacked].forEach((out) => {
      expectSharedDifficultyGuidance(out, 'Hard');
      expect(out).toContain('classification, chronology, troubleshooting, design tradeoffs, or multi-step reasoning');
      expect(out).toContain('command output, configuration choices, protocols, procedures, or failure diagnosis');
      expect(out).toContain('meaningful comparisons, timeline/order relationships, role/status distinctions');
      expect(out).toContain('Prefer useful difficulty over obscure trivia.');
    });
    expect(topicOnly).not.toMatch(/PRIVATE INSTRUCTOR KNOWLEDGE START/);
    expect(sourceBacked).toMatch(/PRIVATE INSTRUCTOR KNOWLEDGE START/);
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

  test('provider timeout helpers keep sync short and async worker longer', () => {
    expect(DEFAULT_PROVIDER_TIMEOUT_MS).toBe(22000);
    expect(DEFAULT_ASYNC_PROVIDER_TIMEOUT_MS).toBe(90000);
    expect(providerTimeoutMs({})).toBe(22000);
    expect(providerTimeoutMs({ PROVIDER_TIMEOUT_MS: '1200' })).toBe(1200);
    expect(asyncProviderTimeoutMs({})).toBe(90000);
    expect(asyncProviderTimeoutMs({ ASYNC_PROVIDER_TIMEOUT_MS: '75000' })).toBe(75000);
  });

  test('callProvider hard-times out Gemini requests when the SDK call never settles', async () => {
    jest.useFakeTimers();
    jest.resetModules();
    const generateContent = jest.fn(() => new Promise(() => {}));
    jest.doMock('@google/generative-ai', () => ({
      __esModule: true,
      GoogleGenerativeAI: jest.fn(() => ({
        getGenerativeModel: jest.fn(() => ({ generateContent })),
      })),
    }));
    const { callProvider: callProviderWithMockedGemini } = require('../lib/providers.js');

    try {
      const pending = callProviderWithMockedGemini({
        provider: 'gemini',
        topic: 'Routing',
        count: 5,
        env: {
          GEMINI_API_KEY: 'test-key',
          GEMINI_MODEL: 'test-model',
          GENERATE_PROVIDER_TIMEOUT_MS: '1200',
        },
      });

      await Promise.resolve();
      await Promise.resolve();
      expect(generateContent).toHaveBeenCalledTimes(1);
      expect(generateContent.mock.calls[0][1]).toMatchObject({ timeout: 1200 });
      expect(generateContent.mock.calls[0][1].signal.aborted).toBe(false);
      jest.advanceTimersByTime(1200);
      await expect(pending).rejects.toMatchObject({
        status: 504,
        code: 'PROVIDER_TIMEOUT',
        message: 'Gemini provider timed out after 1200ms',
      });
      expect(generateContent.mock.calls[0][1].signal.aborted).toBe(true);
    } finally {
      jest.dontMock('@google/generative-ai');
      jest.useRealTimers();
    }
  });

  test('callProvider hard-times out OpenAI requests when fetch never settles', async () => {
    jest.useFakeTimers();
    const originalFetch = global.fetch;
    let capturedSignal;
    global.fetch = jest.fn((_url, options = {}) => {
      capturedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        }, { once: true });
      });
    });

    try {
      const pending = callProvider({
        provider: 'openai',
        topic: 'Routing',
        count: 5,
        env: {
          OPENAI_API_KEY: 'test-key',
          OPENAI_MODEL: 'test-model',
          GENERATE_PROVIDER_TIMEOUT_MS: '1200',
        },
      });
      await Promise.resolve();

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(capturedSignal.aborted).toBe(false);
      jest.advanceTimersByTime(1200);
      await expect(pending).rejects.toMatchObject({
        status: 504,
        code: 'PROVIDER_TIMEOUT',
        message: 'OpenAI provider timed out after 1200ms',
      });
      expect(capturedSignal.aborted).toBe(true);
    } finally {
      global.fetch = originalFetch;
      jest.useRealTimers();
    }
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
