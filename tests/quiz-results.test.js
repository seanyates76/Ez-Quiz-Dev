/** @jest-environment jsdom */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadQuizModule(S){
  const absPath = path.resolve(__dirname, '../public/js/quiz.js');
  const source = fs.readFileSync(absPath, 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/export\s+function\s+/g, 'function ');

  const factory = new Function(
    'S',
    '$',
    'byQSA',
    'clamp',
    'formatDuration',
    'escapeHTML',
    'arraysEqual',
    'formatTopicLabel',
    'mmSsToMs',
    'showUpdateBannerIfReady',
    'bindOnce',
    `${source}\nreturn { renderCurrentQuestion, renderResults };`
  );

  return factory(
    S,
    (id) => document.getElementById(id),
    (sel, root = document) => Array.from(root.querySelectorAll(sel)),
    (value, min, max) => Math.max(min, Math.min(max, value)),
    (ms) => {
      const totalSeconds = Math.max(0, Math.floor((ms || 0) / 1000));
      const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
      const ss = String(totalSeconds % 60).padStart(2, '0');
      return `${mm}:${ss}`;
    },
    (value) => String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;'),
    (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((entry, idx) => entry === b[idx]),
    (value) => String(value || '').trim(),
    () => 0,
    () => {},
    (el, type, handler, flagName) => {
      if(!el) return;
      const key = flagName || `__bound_${type}`;
      if(el[key]) return;
      el.addEventListener(type, handler);
      el[key] = true;
    }
  );
}

describe('quiz results UI', () => {
  let S;
  let renderCurrentQuestion;
  let renderResults;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="questionHost"></div>
      <div id="resultsSummary"></div>
      <div id="missedList"></div>
      <span id="resultsChip"></span>
      <button id="filterMissed" class="chip-btn" aria-pressed="false">Missed</button>
      <button id="filterAll" class="chip-btn active" aria-pressed="true">All</button>
    `;

    S = {
      mode: 'idle',
      quiz: {
        questions: [],
        originalQuestions: [],
        indexMap: [],
        originalAnswers: [],
        explanations: {},
        index: 0,
        answers: [],
        score: 0,
        startedAt: 0,
        finishedAt: 0,
        endAt: 0,
        topic: '',
        title: '',
      },
      settings: { timerEnabled: false, countdown: false, durationMs: 0 },
      ui: {},
    };

    ({ renderCurrentQuestion, renderResults } = loadQuizModule(S));

    S.quiz = {
      questions: [],
      originalQuestions: [],
      indexMap: [],
      originalAnswers: [],
      explanations: {},
      index: 0,
      answers: [],
      score: 0,
      startedAt: 0,
      finishedAt: 0,
      endAt: 0,
      topic: '',
      title: '',
    };
    global.fetch = undefined;
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('renders the runner question header with number and prompt in one line group', () => {
    S.quiz.questions = [{ type: 'TF', text: 'Plants convert light into stored energy.', correct: true }];
    S.quiz.answers = [null];
    S.quiz.index = 0;

    renderCurrentQuestion();

    const header = document.querySelector('.qhdr');
    expect(header).not.toBeNull();
    expect(header.querySelector('.qnum')?.textContent).toBe('Question 1/1');
    expect(header.querySelector('.qprompt')?.textContent).toBe('Plants convert light into stored energy.');
  });

  test('falls back to a local explanation when the endpoint returns stub text', async () => {
    S.quiz.questions = [{ type: 'TF', text: 'The Pacific is the smallest ocean.', correct: false }];
    S.quiz.originalQuestions = [{ type: 'TF', text: 'The Pacific is the smallest ocean.', correct: false }];
    S.quiz.indexMap = [0];
    S.quiz.answers = [true];
    S.quiz.originalAnswers = [true];
    S.quiz.startedAt = 10;
    S.quiz.finishedAt = 20;

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        explanations: {
          0: { explanation: 'Rationale stub for practice. False statement. This is a practice explanation for TF question type.' },
        },
      }),
    });

    renderResults();
    document.querySelector('.explain-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const explainer = document.querySelector('.result-explainer__body');
    expect(explainer).not.toBeNull();
    const labels = Array.from(document.querySelectorAll('.result-explainer__label')).map((node) => node.textContent.trim());
    const lines = Array.from(document.querySelectorAll('.result-explainer__line')).map((node) => node.textContent.trim());
    expect(labels).toEqual(expect.arrayContaining(['Answer', 'Why it fits', 'You chose']));
    expect(lines).toEqual(expect.arrayContaining(['False.', 'True.']));
    expect(document.querySelector('.result-explainer__row.is-lead .result-explainer__line')?.textContent).toBe('False.');
  });
});
