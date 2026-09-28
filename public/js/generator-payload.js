import { clampCount } from './utils.js';

const MAX_SOURCE_TEXT_CHARS = 240000;
const COMPACT_SOURCE_TEXT_CHARS = 60000;

function cleanSourceText(raw, limit = MAX_SOURCE_TEXT_CHARS) {
  return String(raw || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\n')
    .slice(0, Math.max(1000, Math.min(MAX_SOURCE_TEXT_CHARS, Number(limit) || MAX_SOURCE_TEXT_CHARS)));
}

function isUsableSourceReport(report) {
  return !!(report && typeof report === 'object' && Array.isArray(report.sections));
}

function cleanLearningProfile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const safe = {
    version: 1,
    attempts: Math.max(0, Math.min(1000, Number(raw.attempts) || 0)),
    questions: Math.max(0, Math.min(10000, Number(raw.questions) || 0)),
    correct: Math.max(0, Math.min(10000, Number(raw.correct) || 0)),
    weakTopics: Array.isArray(raw.weakTopics) ? raw.weakTopics.slice(0, 4).map((item) => ({
      name: String(item?.name || '').trim().slice(0, 120),
      missed: Math.max(0, Math.min(1000, Number(item?.missed) || 0)),
      accuracy: Math.max(0, Math.min(1, Number(item?.accuracy) || 0)),
    })).filter((item) => item.name) : [],
    weakTypes: Array.isArray(raw.weakTypes) ? raw.weakTypes.slice(0, 4).map((item) => ({
      name: String(item?.name || '').trim().slice(0, 8).toUpperCase(),
      missed: Math.max(0, Math.min(1000, Number(item?.missed) || 0)),
      accuracy: Math.max(0, Math.min(1, Number(item?.accuracy) || 0)),
    })).filter((item) => item.name) : [],
    recentMisses: Array.isArray(raw.recentMisses) ? raw.recentMisses.slice(-6).map((item) => ({
      topic: String(item?.topic || '').trim().slice(0, 120),
      type: String(item?.type || '').trim().slice(0, 8).toUpperCase(),
      stem: String(item?.stem || '').trim().replace(/\s+/g, ' ').slice(0, 160),
    })).filter((item) => item.topic && item.type && item.stem) : [],
  };
  return safe.attempts || safe.questions || safe.recentMisses.length ? safe : null;
}

export function buildGeneratorPayload(snapshot = {}) {
  const topicRaw = snapshot.topic == null ? '' : String(snapshot.topic);
  const difficultyRaw = snapshot.difficulty == null ? '' : String(snapshot.difficulty);
  const topic = topicRaw.trim() || 'General knowledge';
  const difficulty = difficultyRaw.trim() || 'medium';
  const count = clampCount(snapshot.count);
  const payload = {
    topic,
    difficulty,
    count,
    generationMode: snapshot.generationMode === 'lite' ? 'lite' : 'full',
    promptLimitEnabled: !!snapshot.promptLimitEnabled,
    promptLimitChars: Math.max(60000, Math.min(MAX_SOURCE_TEXT_CHARS, Number(snapshot.promptLimitChars) || 120000)),
  };
  const requestedLimit = payload.promptLimitEnabled
    ? payload.promptLimitChars
    : MAX_SOURCE_TEXT_CHARS;
  const sourceText = cleanSourceText(snapshot.sourceText, requestedLimit);
  if (sourceText) {
    payload.sourceText = sourceText;
    const sourceName = String(snapshot.sourceName || '').trim();
    if (sourceName) payload.sourceName = sourceName.slice(0, 160);
    if (isUsableSourceReport(snapshot.sourceReport)) payload.sourceReport = snapshot.sourceReport;
  }
  const learningProfile = cleanLearningProfile(snapshot.learningProfile);
  if (learningProfile) payload.learningProfile = learningProfile;
  return payload;
}
