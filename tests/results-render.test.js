/** @jest-environment jsdom */
'use strict';

const { readFile, loadBrowserModule } = require('./utils');

function loadQuizModule(deps) {
  const source = readFile('public/js/quiz.js')
    .replace(/^import\s+.+?;$/gm, '')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+let\s+/g, 'let ')
    .replace(/export\s+var\s+/g, 'var ');
  const keys = Object.keys(deps);
  const values = keys.map((key) => deps[key]);
  const factory = new Function(...keys, `${source}\nreturn { renderResults };`);
  return factory(...values);
}

describe('results rendering', () => {
  let S;
  let renderResults;

  beforeAll(() => {
    ({ S } = loadBrowserModule('public/js/state.js', ['S']));
    const utils = loadBrowserModule('public/js/utils.js', [
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
    ]);
    ({ renderResults } = loadQuizModule({ S, ...utils }));
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <section id="resultsView">
        <div class="results-header-row">
          <div class="results-header-left">
            <h2 id="resultsTitle">Results</h2>
            <span id="resultsChip"></span>
          </div>
          <div class="results-filter">
            <button id="filterMissed" class="chip-btn" aria-pressed="false">Missed</button>
            <button id="filterAll" class="chip-btn active" aria-pressed="true">All</button>
          </div>
        </div>
        <div id="resultsSummary"></div>
        <div id="missedList"></div>
        <div id="retakeControl">
          <button id="retakePrimary" type="button"></button>
          <span id="retakeLabel"></span>
          <button id="retakeCaret" type="button" aria-expanded="false"></button>
          <div id="retakeMenu" class="hidden">
            <button id="retakeSwitch" type="button"></button>
          </div>
        </div>
      </section>
    `;

    S.ui = {};
    S.settings = {
      timerEnabled: true,
      countdown: false,
      durationMs: 0,
      betaEnabled: false,
    };
    S.quiz = {
      questions: [
        {
          type: 'MC',
          text: 'Which port does HTTPS use by default?',
          options: ['21', '22', '80', '443'],
          correct: [3],
        },
        {
          type: 'TF',
          text: 'A switch operates at Layer 2 of the OSI model.',
          correct: true,
        },
      ],
      originalQuestions: [
        {
          type: 'MC',
          text: 'Which port does HTTPS use by default?',
          options: ['21', '22', '80', '443'],
          correct: [3],
        },
        {
          type: 'TF',
          text: 'A switch operates at Layer 2 of the OSI model.',
          correct: true,
        },
      ],
      indexMap: [0, 1],
      originalAnswers: [[3], false],
      explanations: {},
      index: 0,
      answers: [[3], false],
      score: 1,
      startedAt: 0,
      finishedAt: 65000,
      endAt: 0,
      topic: 'CompTIA A+',
      title: 'CompTIA A+ Quiz',
    };
  });

  test('renders a review header with filters inside the summary and answer-first result cards', () => {
    renderResults();

    expect(document.querySelector('.results-overview__percent')?.textContent).toBe('50%');
    expect(document.querySelector('.results-overview__headline')?.textContent).toBe('Room to tighten');
    expect(document.querySelector('.results-overview__note')?.textContent).toBe('1 question to revisit.');
    expect(document.querySelector('.results-overview__filters .results-filter')).not.toBeNull();
    expect(document.querySelector('#resultsChip')?.classList.contains('sr-only')).toBe(true);
    expect(document.querySelector('#resultsChip')?.textContent).toContain('Results: 50 percent. 1 correct, 1 to revisit');

    const pills = Array.from(document.querySelectorAll('.res-pill')).map((node) => node.textContent.trim());
    expect(pills).toEqual(expect.arrayContaining(['Correct', 'Missed']));

    const correctCard = document.querySelector('.missed-item.is-correct');
    const wrongCard = document.querySelector('.missed-item.is-wrong');
    expect(correctCard?.querySelector('.result-answer-label')?.textContent).toBe('Answer');
    expect(Array.from(wrongCard?.querySelectorAll('.result-answer-label') || []).map((node) => node.textContent.trim()))
      .toEqual(expect.arrayContaining(['You chose', 'Correct answer']));
    expect(document.querySelectorAll('.result-answer-panel').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.result-answer-item').length).toBeGreaterThan(0);

    expect(document.querySelectorAll('.explain-btn')).toHaveLength(1);
    expect(document.querySelector('.ans-correct')).toBeNull();
    expect(document.querySelector('.ans-wrong')).toBeNull();
    expect(document.querySelector('.chip.tag')).toBeNull();
  });

  test('keeps the question number and text in the same header line structure', () => {
    renderResults();

    const header = Array.from(document.querySelectorAll('.res-question-line'))
      .find((node) => node.querySelector('.res-number')?.textContent === '1.');

    expect(header).toBeTruthy();
    expect(header.querySelector('.res-question')?.textContent).toBe('Which port does HTTPS use by default?');
  });

  test('keeps the live filter group mounted inside the summary after rerendering', () => {
    renderResults();

    const filterMissed = document.getElementById('filterMissed');
    const filterAll = document.getElementById('filterAll');
    filterMissed?.classList.add('active');
    filterMissed?.setAttribute('aria-pressed', 'true');
    filterAll?.classList.remove('active');
    filterAll?.setAttribute('aria-pressed', 'false');

    renderResults();

    expect(document.querySelectorAll('#resultsView .results-filter')).toHaveLength(1);
    expect(document.querySelector('.results-overview__filters .results-filter')).not.toBeNull();
  });
});
