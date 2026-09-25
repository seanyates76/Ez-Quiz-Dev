import { S } from './state.js';

const KEY = 'ezq.learning';
const VERSION = 1;
const MAX_RECENT = 12;
const MAX_TOPIC = 120;
const MAX_STEM = 160;

function clean(value, max = 120) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function blankProfile() {
  return { version: VERSION, attempts: 0, questions: 0, correct: 0, topics: {}, types: {}, recentMisses: [] };
}

function safeBucket(raw) {
  const bucket = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const seen = Math.max(0, Math.min(10000, Number(bucket.seen) || 0));
  const correct = Math.max(0, Math.min(seen, Number(bucket.correct) || 0));
  return { seen, correct, missed: Math.max(0, seen - correct) };
}

function sanitize(raw) {
  const base = blankProfile();
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  base.attempts = Math.max(0, Math.min(1000, Number(input.attempts) || 0));
  base.questions = Math.max(0, Math.min(10000, Number(input.questions) || 0));
  base.correct = Math.max(0, Math.min(base.questions, Number(input.correct) || 0));
  for (const group of ['topics', 'types']) {
    const source = input[group] && typeof input[group] === 'object' ? input[group] : {};
    for (const [key, value] of Object.entries(source).slice(0, 80)) {
      const name = clean(key, group === 'types' ? 8 : MAX_TOPIC).toLowerCase();
      if (!name) continue;
      base[group][name] = safeBucket(value);
    }
  }
  base.recentMisses = Array.isArray(input.recentMisses) ? input.recentMisses.slice(-MAX_RECENT).map((item) => ({
    topic: clean(item?.topic, MAX_TOPIC),
    type: clean(item?.type, 8).toUpperCase(),
    stem: clean(item?.stem, MAX_STEM),
  })).filter((item) => item.topic && item.type && item.stem) : [];
  return base;
}

export function loadLearningProfile() {
  try { return sanitize(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return blankProfile(); }
}

export function saveLearningProfile(profile) {
  const safe = sanitize(profile);
  S.learning = safe;
  try { localStorage.setItem(KEY, JSON.stringify(safe)); } catch {}
  return safe;
}

export function recordQuizAttempt({ topic, questions = [], answers = [], compare } = {}) {
  const profile = loadLearningProfile();
  const topicName = clean(topic || 'General knowledge', MAX_TOPIC) || 'General knowledge';
  profile.attempts += 1;
  const add = (group, key, isCorrect) => {
    const name = clean(key, group === 'types' ? 8 : MAX_TOPIC).toLowerCase();
    if (!name) return;
    const bucket = profile[group][name] || { seen: 0, correct: 0, missed: 0 };
    bucket.seen += 1;
    if (isCorrect) bucket.correct += 1;
    bucket.missed = Math.max(0, bucket.seen - bucket.correct);
    profile[group][name] = bucket;
  };
  questions.forEach((question, index) => {
    if (!question) return;
    const isCorrect = typeof compare === 'function' ? !!compare(question, answers[index]) : false;
    profile.questions += 1;
    if (isCorrect) profile.correct += 1;
    add('topics', topicName, isCorrect);
    add('types', question.type || 'MC', isCorrect);
    if (!isCorrect) {
      profile.recentMisses.push({
        topic: topicName,
        type: clean(question.type || 'MC', 8).toUpperCase(),
        stem: clean(question.text || question.prompt || question.left?.join(', ') || 'Question', MAX_STEM),
      });
    }
  });
  profile.recentMisses = profile.recentMisses.slice(-MAX_RECENT);
  return saveLearningProfile(profile);
}

export function resetLearningProfile() {
  try { localStorage.removeItem(KEY); } catch {}
  S.learning = blankProfile();
  return S.learning;
}

function weakestBuckets(group, limit = 4) {
  return Object.entries(group || {})
    .map(([name, bucket]) => ({ name, ...safeBucket(bucket), accuracy: bucket.seen ? bucket.correct / bucket.seen : 0 }))
    .filter((item) => item.missed > 0)
    .sort((a, b) => b.missed - a.missed || a.accuracy - b.accuracy)
    .slice(0, limit);
}

export function getLearningProfile() {
  const profile = sanitize(S.learning || loadLearningProfile());
  S.learning = profile;
  return {
    version: VERSION,
    attempts: profile.attempts,
    questions: profile.questions,
    correct: profile.correct,
    weakTopics: weakestBuckets(profile.topics),
    weakTypes: weakestBuckets(profile.types),
    recentMisses: profile.recentMisses.slice(-6),
  };
}

export function learningStatusText() {
  const profile = getLearningProfile();
  if (!profile.attempts) return 'Your completed quizzes will teach EZ Quiz what to reinforce next.';
  const weak = profile.weakTopics[0]?.name;
  return weak ? `Learning from ${profile.attempts} quiz${profile.attempts === 1 ? '' : 'zes'} · reinforcing ${weak}.` : `Learning from ${profile.attempts} completed quiz${profile.attempts === 1 ? '' : 'zes'}.`;
}

export function syncLearningStatus() {
  const status = document.getElementById('learningStatus');
  if (status) status.textContent = learningStatusText();
}

S.learning = S.learning || loadLearningProfile();
if (typeof window !== 'undefined') window.EZQ_LEARNING = { getLearningProfile, recordQuizAttempt, resetLearningProfile };
