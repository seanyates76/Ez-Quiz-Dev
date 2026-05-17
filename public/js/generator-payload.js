import { clampCount } from './utils.js';

const MAX_SOURCE_TEXT_CHARS = 30000;

function cleanSourceText(raw) {
  return String(raw || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_SOURCE_TEXT_CHARS);
}

export function buildGeneratorPayload(snapshot = {}) {
  const topicRaw = snapshot.topic == null ? '' : String(snapshot.topic);
  const difficultyRaw = snapshot.difficulty == null ? '' : String(snapshot.difficulty);
  const topic = topicRaw.trim() || 'General knowledge';
  const difficulty = difficultyRaw.trim() || 'medium';
  const count = clampCount(snapshot.count);
  const payload = { topic, difficulty, count };
  const sourceText = cleanSourceText(snapshot.sourceText);
  if (sourceText) {
    payload.sourceText = sourceText;
    const sourceName = String(snapshot.sourceName || '').trim();
    if (sourceName) payload.sourceName = sourceName.slice(0, 160);
  }
  return payload;
}
