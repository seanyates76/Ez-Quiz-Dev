/** @jest-environment jsdom */

'use strict';

const { readFile } = require('./utils');

function loadQuizExplainHarness(overrides = {}) {
  const source = readFile('public/js/quiz.js')
    .replace(/^import .*$/gm, '')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+let\s+/g, 'let ')
    .replace(/export\s+var\s+/g, 'var ');

  const S = overrides.S || {
    settings: { betaEnabled: true },
    quiz: {
      originalQuestions: [],
      questions: [],
      indexMap: [],
      originalAnswers: [],
      answers: [],
      explanations: {},
    },
  };

  const deps = {
    S,
    isBetaEnabled: overrides.isBetaEnabled || ((settings) => !!settings?.betaEnabled),
    $: (id) => document.getElementById(id),
    byQSA: (selector, root = document) => Array.from(root.querySelectorAll(selector)),
    clamp: (n, min, max) => Math.max(min, Math.min(max, n)),
    formatDuration: () => '00:00',
    escapeHTML: (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'),
    indexesToLetters: (idxs) => (idxs || []).map((i) => String.fromCharCode(65 + i)),
    arraysEqual: (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]),
    formatTopicLabel: (s) => String(s || ''),
    mmSsToMs: () => 0,
    showUpdateBannerIfReady: () => {},
    bindOnce: (el, type, handler, flag) => {
      const key = flag || `__bound_${type}`;
      if (!el || el[key]) return;
      el.addEventListener(type, handler);
      el[key] = true;
    },
    showToastNear: overrides.showToastNear || jest.fn(),
    requestLazyExplanation: overrides.requestLazyExplanation || jest.fn(),
  };

  const names = Object.keys(deps);
  const values = Object.values(deps);
  const factory = new Function(...names, `${source}\nreturn { questionToLegacyLine, buildExplanationRequest, wireExplainDelegation, buildUserAnswerDetail, buildCorrectAnswerDetail, renderMTResult };\n//# sourceURL=public/js/quiz.js`);
  return { S, ...deps, ...factory(...values) };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('results explanation UI', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('formats supported question types as legacy lines for the endpoint', () => {
    const { questionToLegacyLine } = loadQuizExplainHarness();

    expect(questionToLegacyLine({ type: 'MC', text: 'Pick letters?', options: ['Alpha', 'Beta'], correct: [0, 1] }))
      .toBe('MC|Pick letters?|A) Alpha;B) Beta|A,B');
    expect(questionToLegacyLine({ type: 'TF', text: 'Sky is blue.', correct: true }))
      .toBe('TF|Sky is blue.|T');
    expect(questionToLegacyLine({ type: 'YN', text: 'Continue?', correct: false }))
      .toBe('YN|Continue?|N');
    expect(questionToLegacyLine({
      type: 'MT',
      text: 'Match ports.',
      left: ['HTTP', 'HTTPS'],
      right: ['80', '443'],
      pairs: [[0, 0], [1, 1]],
    })).toBe('MT|Match ports.|1) HTTP;2) HTTPS|A) 80;B) 443|1-A,2-B');
  });

  test('formats multiple-choice result answers with readable letter prefixes', () => {
    const { buildUserAnswerDetail, buildCorrectAnswerDetail } = loadQuizExplainHarness();
    const question = { type: 'MC', text: 'Pick a number?', options: ['1', '2', '3'], correct: [1] };

    expect(buildUserAnswerDetail(question, [1])).toBe('B) <span class="ans-text">2</span>');
    expect(buildCorrectAnswerDetail(question)).toBe('B) <span class="ans-text">2</span>');
  });

  test('renders partial matching answers as incorrect', () => {
    const { renderMTResult } = loadQuizExplainHarness();
    const question = {
      type: 'MT',
      text: 'Match ports.',
      left: ['HTTP', 'HTTPS'],
      right: ['80', '443'],
      pairs: [[0, 0], [1, 1]],
    };

    document.body.innerHTML = renderMTResult(0, question, [0]);

    const item = document.querySelector('.missed-item');
    expect(item.classList.contains('is-wrong')).toBe(true);
    expect(item.classList.contains('is-correct')).toBe(false);
    expect(document.querySelector('.result-status').textContent).toBe('Incorrect');
    expect(document.querySelector('.mt-correct')).not.toBeNull();
    const button = document.querySelector('.explain-btn');
    const panel = document.querySelector('[data-explain-slot="0"]');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe(panel.id);
  });

  test('builds an explanation request from original questions without answers', () => {
    const S = {
      settings: { betaEnabled: true },
      quiz: {
        originalQuestions: [
          { type: 'TF', text: 'One.', correct: true },
          { type: 'MC', text: 'Two?', options: ['A', 'B'], correct: [1] },
        ],
        questions: [],
        indexMap: [],
        originalAnswers: [false, [0]],
        answers: [],
        explanations: {},
      },
    };
    const { buildExplanationRequest } = loadQuizExplainHarness({ S });

    expect(buildExplanationRequest(1)).toEqual({
      lines: ['TF|One.|T', 'MC|Two?|A) A;B) B|B'],
      index: 1,
    });
  });

  test('fetches and renders explanation text without turning it into HTML', async () => {
    const requestLazyExplanation = jest.fn(async () => ({
      explanations: {
        0: { explanation: 'Answer: A) Alpha.\nWhy it fits: <img src=x onerror=alert(1)> stays text.' },
      },
    }));
    const S = {
      settings: { betaEnabled: true },
      quiz: {
        originalQuestions: [
          { type: 'MC', text: 'Pick one?', options: ['Alpha', 'Beta'], correct: [0] },
        ],
        questions: [],
        indexMap: [],
        originalAnswers: [[1]],
        answers: [],
        explanations: {},
      },
    };
    const { wireExplainDelegation } = loadQuizExplainHarness({ S, requestLazyExplanation });
    document.body.innerHTML = `
      <div id="missedList">
        <div class="missed-item" data-orig="0">
          <button type="button" class="chip-btn explain-btn" data-explain="0">Explain</button>
          <div class="explain-panel is-hidden" data-explain-slot="0" role="status" aria-live="polite"></div>
        </div>
      </div>
    `;

    wireExplainDelegation();
    expect(document.querySelector('.explain-btn').getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.explain-btn').getAttribute('aria-controls')).toBe('explain-panel-0');
    document.querySelector('.explain-btn').click();
    await flush();
    await flush();

    const panel = document.querySelector('[data-explain-slot="0"]');
    expect(requestLazyExplanation).toHaveBeenCalledWith({
      lines: ['MC|Pick one?|A) Alpha;B) Beta|A'],
      index: 0,
    });
    expect(panel.classList.contains('is-hidden')).toBe(false);
    expect(panel.textContent).toContain('Answer: A) Alpha.');
    expect(panel.textContent).toContain('<img src=x onerror=alert(1)> stays text.');
    expect(panel.querySelector('img')).toBeNull();
    expect(panel.id).toBe('explain-panel-0');
    expect(document.querySelector('.explain-btn').getAttribute('aria-expanded')).toBe('true');
    expect(S.quiz.explanations[0]).toMatchObject({ state: 'loaded' });
  });
});
