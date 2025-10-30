import { clampCount } from './utils.js';

export function buildGeneratorPayload(snapshot = {}) {
  const topicRaw = snapshot.topic == null ? '' : String(snapshot.topic);
  const difficultyRaw = snapshot.difficulty == null ? '' : String(snapshot.difficulty);
  const topic = topicRaw.trim() || 'General knowledge';
  const difficulty = difficultyRaw.trim() || 'medium';
  const count = clampCount(snapshot.count);
  return { topic, difficulty, count };
}
