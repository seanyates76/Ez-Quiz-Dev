/** @jest-environment jsdom */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadLearning(S) {
  const file = path.resolve(__dirname, '../public/js/learning.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import\s+[^;]+;\n/gm, '')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/if \(typeof window !== 'undefined'\) window\.EZQ_LEARNING[^;]+;/, '');
  return new Function('S', `${source}\nreturn { getLearningProfile, recordQuizAttempt, resetLearningProfile };`)(S);
}

describe('adaptive learning profile', () => {
  beforeEach(() => localStorage.clear());

  test('records misses locally and exposes bounded weak-area context', () => {
    const S = { learning: null };
    const { recordQuizAttempt, getLearningProfile } = loadLearning(S);
    recordQuizAttempt({
      topic: ' VLAN trunking ',
      questions: [
        { type: 'MC', text: 'Which tag is added to a trunk frame?' },
        { type: 'TF', text: 'A trunk carries one VLAN only.' },
      ],
      answers: [[], false],
      compare: (_q, answer) => answer === true,
    });
    const profile = getLearningProfile();
    expect(profile.attempts).toBe(1);
    expect(profile.weakTopics[0].name).toBe('vlan trunking');
    expect(profile.weakTopics[0].missed).toBe(2);
    expect(profile.recentMisses[0].stem).toContain('trunk frame');
    expect(JSON.parse(localStorage.getItem('ezq.learning')).recentMisses).toHaveLength(2);
  });

  test('reset removes the device-only profile', () => {
    const S = { learning: null };
    const { recordQuizAttempt, resetLearningProfile } = loadLearning(S);
    recordQuizAttempt({ topic: 'History', questions: [{ type: 'TF', text: 'Fact.' }], answers: [true], compare: () => true });
    resetLearningProfile();
    expect(localStorage.getItem('ezq.learning')).toBeNull();
    expect(S.learning.attempts).toBe(0);
  });
});
