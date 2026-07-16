'use strict';

const { cleanSourceText } = require('./sourceMaterial.js');

const VALID_QUESTION_TYPES = ['MC', 'TF', 'YN', 'MT'];
const MAX_SOURCE_REPORT_SECTIONS = 100;
const MAX_SOURCE_REPORT_TEXT_CHARS = 60000;
const MAX_SOURCE_SECTION_TEXT_CHARS = 4000;

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

function boundedNumber(value, min, max, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function boundedString(value, maxChars) {
  return String(value == null ? '' : value).trim().slice(0, maxChars);
}

function boundedStringList(value, maxItems, maxChars) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems)
    .map((entry) => boundedString(entry, maxChars))
    .filter(Boolean);
}

function sanitizeSourceReport(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  let remainingTextChars = MAX_SOURCE_REPORT_TEXT_CHARS;
  const rawSections = Array.isArray(raw.sections)
    ? raw.sections.slice(0, MAX_SOURCE_REPORT_SECTIONS)
    : [];
  const sections = [];
  for (let index = 0; index < rawSections.length && remainingTextChars > 0; index += 1) {
    const section = rawSections[index];
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue;
    const text = boundedString(
      section.text,
      Math.min(MAX_SOURCE_SECTION_TEXT_CHARS, remainingTextChars)
    );
    remainingTextChars -= text.length;
    sections.push({
      id: boundedString(section.id || `section-${index + 1}`, 80),
      heading: boundedString(section.heading, 200),
      headingPath: boundedStringList(section.headingPath, 8, 160),
      text,
      charCount: boundedNumber(section.charCount, 0, MAX_SOURCE_SECTION_TEXT_CHARS, text.length),
      lineCount: boundedNumber(section.lineCount, 0, 10000),
      bulletCount: boundedNumber(section.bulletCount, 0, 10000),
      codeBlockCount: boundedNumber(section.codeBlockCount, 0, 1000),
      listCount: boundedNumber(section.listCount, 0, 1000),
      definitionSignal: !!section.definitionSignal,
      termSignal: !!section.termSignal,
      commandSignal: !!section.commandSignal,
      score: boundedNumber(section.score, 0, 100),
      reasons: boundedStringList(section.reasons, 20, 80),
      flags: boundedStringList(section.flags, 20, 80),
    });
  }
  const weakCount = sections.filter((section) => section.flags.includes('weak')).length;
  const quizWorthyCount = sections.filter((section) => section.score >= 45 && !section.flags.includes('weak')).length;
  return {
    version: boundedNumber(raw.version, 0, 100, 1),
    sourceCharCount: boundedNumber(raw.sourceCharCount, 0, MAX_SOURCE_REPORT_TEXT_CHARS),
    sourceLineCount: boundedNumber(raw.sourceLineCount, 0, 100000),
    sectionCount: sections.length,
    quizWorthyCount,
    weakCount,
    largestSectionId: boundedString(raw.largestSectionId, 80),
    largestSectionHeading: boundedString(raw.largestSectionHeading, 200),
    largestSectionCharCount: boundedNumber(raw.largestSectionCharCount, 0, MAX_SOURCE_SECTION_TEXT_CHARS),
    detectedSignals: boundedStringList(raw.detectedSignals, 20, 80),
    flags: boundedStringList(raw.flags, 20, 80),
    sections,
  };
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
  const sourceReport = sanitizeSourceReport(body.sourceReport);

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
  MAX_SOURCE_REPORT_SECTIONS,
  MAX_SOURCE_REPORT_TEXT_CHARS,
  MAX_SOURCE_SECTION_TEXT_CHARS,
  VALID_QUESTION_TYPES,
  generationLimits,
  normalizeGenerationPayload,
  sanitizeSourceReport,
  sanitizeAvoidStems,
  toPositiveInt,
};
