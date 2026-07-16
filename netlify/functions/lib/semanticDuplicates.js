'use strict';

const SEMANTIC_DUPLICATE_STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'all', 'also', 'and', 'answer', 'are', 'before', 'best', 'can', 'could',
  'does', 'during', 'each', 'from', 'have', 'how', 'into', 'likely', 'main', 'most', 'one', 'only', 'question',
  'should', 'that', 'the', 'their', 'there', 'these', 'this', 'those', 'true', 'what', 'when', 'where', 'which',
  'while', 'with', 'would', 'your',
]);

function stemSemanticToken(raw) {
  const token = String(raw || '');
  if (token.length >= 7 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length >= 6 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length >= 5 && /(?:ches|shes|sses|xes|zes)$/.test(token)) return token.slice(0, -2);
  if (token.length >= 5 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function semanticTokens(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map(stemSemanticToken)
    .filter((token) => token.length >= 3 && !SEMANTIC_DUPLICATE_STOP_WORDS.has(token));
}

function isSemanticDuplicateStem(stem, previousStems = []) {
  const current = new Set(semanticTokens(stem));
  if (current.size < 5) return false;
  for (const previous of previousStems) {
    const prior = new Set(semanticTokens(previous));
    if (prior.size < 5) continue;
    let overlap = 0;
    current.forEach((token) => { if (prior.has(token)) overlap += 1; });
    const smaller = Math.min(current.size, prior.size);
    const larger = Math.max(current.size, prior.size);
    if (smaller >= 5 && overlap / smaller >= 0.78 && overlap / larger >= 0.55) return true;
  }
  return false;
}

module.exports = {
  isSemanticDuplicateStem,
  semanticTokens,
  stemSemanticToken,
};
