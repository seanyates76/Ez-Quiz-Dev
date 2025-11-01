export const S = (window.EZQ = window.EZQ || {});
S.mode = S.mode || 'idle';
S.quiz = S.quiz || { questions: [], originalQuestions: [], indexMap: [], originalAnswers: [], index: 0, answers: [], score: 0, startedAt: 0, finishedAt: 0, endAt: 0, topic: '', title: '' };
S.settings = S.settings || { theme: 'dark', timerEnabled: true, countdown: false, durationMs: 0, autoStart: true, requireAnswer: false, showQuizEditor: false, betaEnabled: false };
S.ui = S.ui || { primaryMode: 'start' };

export const STORAGE_KEYS = { theme: 'ezq.theme', settings: 'ezq.settings', defaults: 'ezq.defaults', last: 'ezq.last' };

// Bridge: unify __EZQ__ with EZQ so both references point to the same object.
try {
  if (!Object.getOwnPropertyDescriptor(window, '__EZQ__')) {
    Object.defineProperty(window, '__EZQ__', {
      configurable: true,
      get() { return window.EZQ; },
      set(v) { if (v && typeof v === 'object') Object.assign(window.EZQ, v); },
    });
  }
} catch {}

try {
  const bag = (window.__EZQ__ = window.__EZQ__ || window.EZQ || {});
  if (!Number.isFinite(bag.MAX_QUESTIONS)) {
    bag.MAX_QUESTIONS = 30;
  }
  if (window.EZQ && window.EZQ !== bag && !Number.isFinite(window.EZQ.MAX_QUESTIONS)) {
    window.EZQ.MAX_QUESTIONS = bag.MAX_QUESTIONS;
  }
} catch {}
