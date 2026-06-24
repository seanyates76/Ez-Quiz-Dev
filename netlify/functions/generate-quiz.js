'use strict';

/**

- Netlify Function: generate-quiz
- POST /api/generate  { topic: string, count: number }
- Returns: { lines: string }  // newline-separated quiz lines
-
- Requires env: GEMINI_API_KEY
  */

const { generateLines, generateInBatches, callProvider, buildStructuredPrompt } = require('./lib/providers.js');
const { normalizeQuizV2, parseLegacyQuestion, quizToLegacyLines } = require('./lib/normalizer.js');
const { cleanSourceText } = require('./lib/sourceMaterial.js');

function parseAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function getOrigin(headers) {
  const h = headers || {};
  return h.origin || h.Origin || '';
}

function makeCorsHeaders(origin) {
  const H = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (origin) H['Access-Control-Allow-Origin'] = origin;
  return H;
}

function normalizeHttpStatus(value, fallback = 500) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric < 100 || numeric > 599) return fallback;
  return numeric;
}

function generationFailureStatus(err, { is429 = false, isTimeout = false, fallback = 502 } = {}) {
  if (isTimeout) return 504;
  if (is429) return 429;
  const status = normalizeHttpStatus(err && err.status, fallback);
  if (status === 504) return 504;
  if (status === 404 || status >= 500) return 502;
  return status;
}

function errorCode(err) {
  const code = err && err.code ? String(err.code).trim() : '';
  return code || undefined;
}

function reply(statusCode, body, origin, extraHeaders = {}) {
  const isJson = typeof body !== 'string';
  const headers = {
    ...makeCorsHeaders(origin),
    ...(isJson ? { 'Content-Type': 'application/json' } : {}),
    ...extraHeaders,
  };
  return {
    statusCode: normalizeHttpStatus(statusCode),
    headers,
    body: isJson ? JSON.stringify(body) : body,
  };
}

// Sliding window rate limit per IP (defaults: 60 requests / 15 minutes)
const RL = new Map(); // ip -> [timestamps]
const DEFAULT_LIMIT = 60;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

function toPositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const LIMIT = toPositiveInt(process.env.GENERATE_LIMIT, DEFAULT_LIMIT);
const WINDOW_MS = toPositiveInt(process.env.GENERATE_WINDOW_MS, DEFAULT_WINDOW_MS);
const CLIENT_MAX = Math.max(1, Math.min(100, toPositiveInt(process.env.GENERATE_CLIENT_MAX || process.env.CLIENT_MAX_QUESTIONS, 50)));
const CONFIGURED_MAX = Math.max(1, Math.min(100, toPositiveInt(process.env.GENERATE_MAX_COUNT, CLIENT_MAX)));
const MAX_COUNT = Math.min(CLIENT_MAX, CONFIGURED_MAX);
const BEARER_TOKEN = process.env.GENERATE_BEARER_TOKEN ? String(process.env.GENERATE_BEARER_TOKEN) : '';

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

function clientIp(event) {
  const h = event.headers || {};
  const xf = h['x-forwarded-for'] || h['X-Forwarded-For'] || '';
  const ip = (Array.isArray(xf) ? xf[0] : String(xf).split(',')[0]).trim() || h['client-ip'] || h['x-nf-client-connection-ip'] || 'unknown';
  return String(ip);
}

function rateLimited(event) {
  if (!LIMIT) return false;
  const now = Date.now();
  const ip = clientIp(event);
  const arr = RL.get(ip) || [];
  const fresh = arr.filter(ts => now - ts < WINDOW_MS);
  if (fresh.length >= LIMIT) return true;
  fresh.push(now);
  RL.set(ip, fresh);
  if (RL.size > 500) {
    for (const [k, list] of RL.entries()) {
      const keep = list.filter(ts => now - ts < WINDOW_MS);
      if (keep.length) RL.set(k, keep); else RL.delete(k);
    }
  }
  return false;
}

function authorize(event) {
  if (!BEARER_TOKEN) return true;
  const h = event.headers || {};
  const raw = h.authorization || h.Authorization || '';
  if (!raw || typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) return false;
  const token = trimmed.slice(7).trim();
  return token === BEARER_TOKEN;
}

function countQuizLines(lines) {
  return usableQuizLines(lines).length;
}

function usableQuizLines(lines) {
  return String(lines || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !!parseLegacyQuestion(line));
}

function underCountError(actual, expected) {
  const err = new Error(`Only generated ${actual} of ${expected} requested questions`);
  err.status = 502;
  err.code = 'GENERATION_UNDER_COUNT';
  err.actual = actual;
  err.expected = expected;
  return err;
}

function partialLegacyResult(result, actual, expected) {
  return {
    ...result,
    lines: usableQuizLines(result && result.lines).join('\n'),
    partial: true,
    completedCount: actual,
    requestedCount: expected,
    warning: `Quiz ready with ${actual} of ${expected} questions.`,
  };
}

async function handleGenerateQuiz(event) {
  const allowedOrigins = parseAllowedOrigins();
  const origin = getOrigin(event.headers);
  const originAllowed = !origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin);

  if (event.httpMethod === 'OPTIONS') {
    if (!originAllowed) return reply(403, { error: 'Forbidden origin' }, '');
    return reply(204, '', origin || (allowedOrigins.length === 0 ? '*' : ''));
  }

  if (!originAllowed) return reply(403, { error: 'Forbidden origin' }, '');

  const responseOrigin = origin || (allowedOrigins.length === 0 ? '*' : '');

  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method Not Allowed' }, responseOrigin);

  if (!authorize(event)) {
    const res = reply(401, { error: 'Unauthorized' }, responseOrigin);
    res.headers['WWW-Authenticate'] = 'Bearer';
    return res;
  }

  if (rateLimited(event)) {
    const retry = Math.ceil(WINDOW_MS / 1000);
    const res = reply(429, { error: 'Rate limited' }, responseOrigin);
    res.headers['Retry-After'] = String(retry);
    return res;
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch {
    return reply(400, { error: 'Invalid JSON' }, responseOrigin);
  }

  // Normalization + validation (non‑breaking)
  const topicRaw = (payload.topic == null ? '' : String(payload.topic)).trim();
  const topic = topicRaw || 'General knowledge';
  const sourceText = cleanSourceText(payload.sourceText);
  const sourceName = String(payload.sourceName || '').trim().slice(0, 160);

  let count = payload.count;
  if (count == null) { count = 10; }
  const parsedCount = parseInt(count, 10);
  if (!Number.isFinite(parsedCount)) {
    return reply(400, {
      error: 'Invalid request',
      code: 'INVALID_COUNT',
      details: `count must be a number between 1 and ${MAX_COUNT}`,
      field: 'count',
    }, responseOrigin);
  }
  count = Math.max(1, Math.min(MAX_COUNT, parsedCount));

  let types = undefined;
  if (payload.types !== undefined) {
    if (!Array.isArray(payload.types)) {
      return reply(400, {
        error: 'Invalid request',
        code: 'INVALID_TYPES',
        details: 'types must be an array containing only MC, TF, YN, or MT',
        field: 'types',
      }, responseOrigin);
    }
    const invalidTypes = [];
    const filtered = [];
    for (const rawType of payload.types) {
      const type = String(rawType || '').trim().toUpperCase();
      if (/^(MC|TF|YN|MT)$/.test(type)) {
        filtered.push(type);
      } else {
        invalidTypes.push(String(rawType));
      }
    }
    if (invalidTypes.length) {
      return reply(400, {
        error: 'Invalid request',
        code: 'INVALID_TYPES',
        details: 'types must contain only MC, TF, YN, or MT',
        field: 'types',
        invalidTypes,
      }, responseOrigin);
    }
    types = filtered;
  }

  const difficulty = (payload.difficulty && String(payload.difficulty).toLowerCase()) || undefined;
  const provider = String(payload.provider || process.env.AI_PROVIDER || 'gemini');
  const model = String(payload.model || '');
  const avoidStems = sanitizeAvoidStems(payload.avoidStems);

  const responseMode = String(process.env.QUIZ_RESPONSE || '').toLowerCase();
  const useV2 = responseMode === 'v2';
  const queryFormat = (event.queryStringParameters && event.queryStringParameters.format) || '';
  const headerFormat = (event.headers && (event.headers['x-quiz-format'] || event.headers['X-Quiz-Format'])) || '';
  const requestedFormat = String(payload.format || headerFormat || queryFormat).toLowerCase();
  const wantsLegacyOnly = requestedFormat === 'legacy-lines';
  const wantsStructured = useV2 && !wantsLegacyOnly && (requestedFormat === 'quiz-json' || requestedFormat === 'quiz-v2' || requestedFormat === 'json');
  const structuredPrompt = wantsStructured ? buildStructuredPrompt(topic, count, types, difficulty, sourceText) : null;
  // [quiz-v2: hook] structured payload remains opt-in; default path keeps legacy lines for compatibility.

  function buildStructuredResponse({ quiz, provider: providerName, model: modelName, fallbackUsed = false, fallbackFrom, errorPrimary }) {
    const legacy = quizToLegacyLines(quiz, { count });
    const actual = countQuizLines(legacy.lines);
    if (actual < count) throw underCountError(actual, count);
    const meta = {
      provider: providerName,
      model: modelName,
      fallbackUsed: !!fallbackUsed,
    };
    if (fallbackUsed && fallbackFrom) meta.fallbackFrom = fallbackFrom;
    if (fallbackUsed && errorPrimary) meta.errorPrimary = errorPrimary;
    if (sourceText) meta.source = { name: sourceName, charCount: sourceText.length };
    const response = {
      ...meta,
      title: legacy.title,
      lines: legacy.lines,
    };
    if (!wantsLegacyOnly) {
      response.quiz = quiz;
    }
    return response;
  }

  function buildLegacyResponse(result, meta = {}) {
    const body = {
      ...meta,
      title: result.title,
      lines: result.lines,
      provider: result.provider,
      model: result.model,
    };
    if (result.partial) {
      body.partial = true;
      body.completedCount = result.completedCount;
      body.requestedCount = result.requestedCount;
      body.warning = result.warning;
    }
    if (sourceText) body.source = { name: sourceName, charCount: sourceText.length };
    return body;
  }

  // Timeout guard so the function never hangs on upstream calls
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const id = setTimeout(() => reject(Object.assign(new Error('Upstream timeout'), { status: 504 })), ms);
      promise.then(v => { clearTimeout(id); resolve(v); }, e => { clearTimeout(id); reject(e); });
    });
  }

  const TIMEOUT_MS = Math.max(8000, Math.min(30000, parseInt(process.env.GENERATE_TIMEOUT_MS || '25000', 10)));

  const corsHeaders = makeCorsHeaders(responseOrigin);
  const selectGenerator = (providerName) => {
    const normalized = String(providerName || '').toLowerCase();
    return count > 25 && normalized !== 'echo' ? generateInBatches : generateLines;
  };
  const runGeneratorExact = async (args) => {
    let generator = selectGenerator(args.provider);
    let result = await withTimeout(generator(args), TIMEOUT_MS);
    let actual = countQuizLines(result.lines);
    let bestPartial = actual > 0 ? { result, actual } : null;
    if (actual < count && generator !== generateInBatches) {
      generator = generateInBatches;
      result = await withTimeout(generator(args), TIMEOUT_MS);
      actual = countQuizLines(result.lines);
      if (actual > (bestPartial ? bestPartial.actual : 0)) {
        bestPartial = { result, actual };
      }
    }
    if (actual < count) {
      if (bestPartial) return partialLegacyResult(bestPartial.result, bestPartial.actual, count);
      throw underCountError(actual, count);
    }
    return result;
  };

  try {
    if(wantsStructured){
      const primary = await withTimeout(
        callProvider({ provider, model, topic, count, types, difficulty, env: process.env, prompt: structuredPrompt, kind: 'structured', sourceText }),
        TIMEOUT_MS
      );
      const quiz = normalizeQuizV2(primary.text, { topic, count, types });
      const payloadBody = buildStructuredResponse({ quiz, provider: primary.provider, model: primary.model, fallbackUsed: false });
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadBody),
      };
    }

    const result = await runGeneratorExact({ provider, model, topic, count, types, difficulty, sourceText, avoidStems, env: process.env });
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildLegacyResponse(result, { fallbackUsed: false })),
    };
  } catch (err) {
    const msg = String((err && err.message) || err || 'Error');
    const errStatus = normalizeHttpStatus(err && err.status, 0);
    const errCode = errorCode(err);
    const is429 = msg.includes('429') || /quota|rate limit/i.test(msg) || errStatus === 429;
    const isTimeout = err && (errStatus === 504 || errCode === 'PROVIDER_TIMEOUT' || /timeout/i.test(msg));

    // Fallback to Gemini if primary provider failed and Gemini credentials exist
    const primary = (provider || '').toLowerCase();
    const canFallbackToGemini = primary !== 'gemini' && !!process.env.GEMINI_API_KEY;
    if(wantsStructured){
      if (canFallbackToGemini && !isTimeout) {
        try {
          const fallback = await withTimeout(
            callProvider({ provider: 'gemini', model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite-preview-09-2025', topic, count, types, difficulty, env: process.env, prompt: structuredPrompt, kind: 'structured', sourceText }),
            TIMEOUT_MS
          );
          const fallbackLen = typeof fallback.text === 'string' ? fallback.text.length : 0;
          console.warn('[quiz-v2]', { reason: 'provider-fallback', len: fallbackLen });
          const quiz = normalizeQuizV2(fallback.text, { topic, count, types });
          const payloadBody = buildStructuredResponse({
            quiz,
            provider: fallback.provider,
            model: fallback.model,
            fallbackUsed: true,
            fallbackFrom: primary,
            errorPrimary: msg,
          });
          return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadBody),
          };
        } catch (fallbackErr) {
          console.warn('[quiz-v2]', { reason: 'provider-fallback-failed', len: 0 });
          const fbMsg = String((fallbackErr && fallbackErr.message) || fallbackErr || 'Error');
          const fallbackStatus = generationFailureStatus(fallbackErr);
          return reply(
            generationFailureStatus(err, { is429, isTimeout, fallback: fallbackStatus }),
            { error: 'Generation failed', details: msg, provider, code: errorCode(err), fallback: { tried: 'gemini', details: fbMsg, code: errorCode(fallbackErr) } },
            responseOrigin,
            { ...(is429 ? { 'Retry-After': '30' } : {}), ...(isTimeout ? { 'Retry-After': '15' } : {}) }
          );
        }
      }

      const statusCode = generationFailureStatus(err, { is429, isTimeout });
      if (isTimeout) {
        return reply(
          statusCode,
          { error: 'Generation timed out', details: msg, provider, code: errCode },
          responseOrigin,
          { 'Retry-After': '15' }
        );
      }

      // Structured path failed entirely; fall back to legacy generator so the UI still renders a quiz.
      try {
        const result = await runGeneratorExact({ provider, model, topic, count, types, difficulty, sourceText, avoidStems, env: process.env });
        console.warn('[quiz-v2]', { reason: 'structured-fallback-legacy' });
        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildLegacyResponse(result, { fallbackUsed: false })),
        };
      } catch (legacyErr) {
        const legacyMsg = String((legacyErr && legacyErr.message) || legacyErr || 'Error');
        return reply(
          statusCode,
          { error: isTimeout ? 'Generation timed out' : 'Generation failed', details: legacyMsg, provider, code: errorCode(legacyErr) || errorCode(err) },
          responseOrigin,
          { ...(is429 ? { 'Retry-After': '30' } : {}), ...(isTimeout ? { 'Retry-After': '15' } : {}) }
        );
      }
    }

    if (canFallbackToGemini && !isTimeout) {
      try {
        const result = await runGeneratorExact({ provider: 'gemini', model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite-preview-09-2025', topic, count, types, difficulty, sourceText, avoidStems, env: process.env });
        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildLegacyResponse(result, { fallbackUsed: true, fallbackFrom: primary, errorPrimary: msg })),
        };
      } catch (fallbackErr) {
        const fbMsg = String((fallbackErr && fallbackErr.message) || fallbackErr || 'Error');
        const fallbackStatus = generationFailureStatus(fallbackErr);
        return reply(
          generationFailureStatus(err, { is429, isTimeout, fallback: fallbackStatus }),
          { error: 'Generation failed', details: msg, provider, code: errorCode(err), fallback: { tried: 'gemini', details: fbMsg, code: errorCode(fallbackErr) } },
          responseOrigin,
          { ...(is429 ? { 'Retry-After': '30' } : {}), ...(isTimeout ? { 'Retry-After': '15' } : {}) }
        );
      }
    }

    return reply(
      generationFailureStatus(err, { is429, isTimeout }),
      { error: isTimeout ? 'Generation timed out' : 'Generation failed', details: msg, provider, code: errorCode(err) },
      responseOrigin,
      { ...(is429 ? { 'Retry-After': '30' } : {}), ...(isTimeout ? { 'Retry-After': '15' } : {}) }
    );
  }
}

exports.handler = async (event) => {
  try {
    return await handleGenerateQuiz(event);
  } catch (err) {
    const allowedOrigins = parseAllowedOrigins();
    const origin = getOrigin(event && event.headers);
    const originAllowed = !origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin);
    const responseOrigin = originAllowed ? (origin || (allowedOrigins.length === 0 ? '*' : '')) : '';
    const msg = String((err && err.message) || err || 'Unhandled error');
    return reply(
      normalizeHttpStatus(err && err.status, 500),
      { error: 'Generation failed', details: msg, code: errorCode(err) || 'UNHANDLED_GENERATE_QUIZ_ERROR' },
      responseOrigin
    );
  }
};
