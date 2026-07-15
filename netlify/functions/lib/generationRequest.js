'use strict';

const { cleanSourceText } = require('./sourceMaterial.js');

const VALID_QUESTION_TYPES = ['MC', 'TF', 'YN', 'MT'];

class GenerationRequestError extends Error {
  constructor(body, status = 400) {
    super(body && body.details ? body.details : (body && body.error) || 'Invalid request');
    this.name = 'GenerationRequestError';
    this.status = status;
    this.body = body;
  }
}

function toPositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function generationLimits(env = process.env) {
  const clientMax = Math.max(1, Math.min(100, toPositiveInt(env.GENERATE_CLIENT_MAX || env.CLIENT_MAX_QUESTIONS, 50)));
  const configuredMax = Math.max(1, Math.min(100, toPositiveInt(env.GENERATE_MAX_COUNT, clientMax)));
  return {
    clientMax,
    configuredMax,
    maxCount: Math.min(clientMax, configuredMax),
  };
}

function sanitizeAvoidStems(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    const cleaned = String(entry == null ? '' : entry)
      .replace(/[\r\n|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= 60) break;
  }
  return out;
}

function normalizeQuestionTypes(raw) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new GenerationRequestError({
      error: 'Invalid request',
      code: 'INVALID_TYPES',
      details: 'types must be an array containing only MC, TF, YN, or MT',
      field: 'types',
    });
  }
  const invalidTypes = [];
  const filtered = [];
  for (const rawType of raw) {
    const type = String(rawType || '').trim().toUpperCase();
    if (/^(MC|TF|YN|MT)$/.test(type)) {
      filtered.push(type);
    } else {
      invalidTypes.push(String(rawType));
    }
  }
  if (invalidTypes.length) {
    throw new GenerationRequestError({
      error: 'Invalid request',
      code: 'INVALID_TYPES',
      details: 'types must contain only MC, TF, YN, or MT',
      field: 'types',
      invalidTypes,
    });
  }
  return filtered;
}

function normalizeGenerationPayload(payload, options = {}) {
  const env = options.env || process.env;
  const { maxCount } = generationLimits(env);
  const body = payload && typeof payload === 'object' ? payload : {};

  const topicRaw = (body.topic == null ? '' : String(body.topic)).trim();
  const topic = topicRaw || 'General knowledge';
  const sourceText = cleanSourceText(body.sourceText);
  const sourceName = String(body.sourceName || '').trim().slice(0, 160);

  let count = body.count;
  if (count == null) count = 10;
  const parsedCount = parseInt(count, 10);
  if (!Number.isFinite(parsedCount)) {
    throw new GenerationRequestError({
      error: 'Invalid request',
      code: 'INVALID_COUNT',
      details: `count must be a number between 1 and ${maxCount}`,
      field: 'count',
    });
  }
  count = Math.max(1, Math.min(maxCount, parsedCount));

  const types = normalizeQuestionTypes(body.types);
  const difficulty = (body.difficulty && String(body.difficulty).trim().toLowerCase()) || undefined;
  const provider = String(body.provider || env.AI_PROVIDER || 'gemini').trim().toLowerCase();
  const model = String(body.model || '').trim();
  const avoidStems = sanitizeAvoidStems(body.avoidStems);
  const sourceReport = body.sourceReport && typeof body.sourceReport === 'object' && !Array.isArray(body.sourceReport)
    ? body.sourceReport
    : undefined;

  const responseMode = String(env.QUIZ_RESPONSE || '').toLowerCase();
  const useV2 = responseMode === 'v2';
  const query = options.queryStringParameters || {};
  const headers = options.headers || {};
  const queryFormat = query && query.format || '';
  const headerFormat = headers && (headers['x-quiz-format'] || headers['X-Quiz-Format']) || '';
  const requestedFormat = String(body.format || headerFormat || queryFormat).toLowerCase();
  const wantsLegacyOnly = requestedFormat === 'legacy-lines';
  const wantsStructured = useV2 && !wantsLegacyOnly && (requestedFormat === 'quiz-json' || requestedFormat === 'quiz-v2' || requestedFormat === 'json');

  return {
    topic,
    count,
    sourceText,
    sourceName,
    sourceReport,
    types,
    difficulty,
    provider,
    model,
    avoidStems,
    requestedFormat,
    wantsLegacyOnly,
    wantsStructured,
  };
}

module.exports = {
  GenerationRequestError,
  VALID_QUESTION_TYPES,
  generationLimits,
  normalizeGenerationPayload,
  sanitizeAvoidStems,
  toPositiveInt,
};
