'use strict';

const { loadBrowserModule } = require('./utils');

describe('clampCount', () => {
  let clampCount;
  let getMaxQuestions;
  let originalWindow;

  beforeAll(() => {
    originalWindow = global.window;
    ({ clampCount, getMaxQuestions } = loadBrowserModule('public/js/utils.js', ['clampCount', 'getMaxQuestions']));
  });

  beforeEach(() => {
    if (originalWindow) {
      global.window = originalWindow;
    }
    if (!global.window) {
      global.window = {};
    }
    global.window.__EZQ__ = { MAX_QUESTIONS: 30 };
  });

  afterEach(() => {
    if (global.window && global.window.__EZQ__) {
      delete global.window.__EZQ__;
    }
    if (originalWindow) {
      global.window = originalWindow;
    } else {
      delete global.window;
    }
  });

  test('returns fallback when input is empty', () => {
    expect(clampCount('', { fallback: 10 })).toBe(10);
  });

  test('clamps fallback to max when above limit', () => {
    window.__EZQ__.MAX_QUESTIONS = 20;
    expect(clampCount('', { fallback: 100 })).toBe(20);
  });

  test('truncates floats toward zero within bounds', () => {
    expect(clampCount('7.8')).toBe(7);
  });

  test('normalizes negatives to the minimum', () => {
    expect(clampCount(-4)).toBe(1);
  });

  test('clamps to configured max', () => {
    window.__EZQ__.MAX_QUESTIONS = 6;
    expect(clampCount(42)).toBe(6);
  });

  test('accepts values exactly at the limit', () => {
    window.__EZQ__.MAX_QUESTIONS = 9;
    expect(clampCount(9)).toBe(9);
  });

  test('getMaxQuestions falls back to default when window absent', () => {
    const savedWindow = global.window;
    const savedGlobalEzq = global.__EZQ__;
    global.window = undefined;
    global.__EZQ__ = undefined;
    try {
      expect(getMaxQuestions()).toBe(50);
    } finally {
      global.window = savedWindow;
      global.__EZQ__ = savedGlobalEzq;
    }
  });
});
