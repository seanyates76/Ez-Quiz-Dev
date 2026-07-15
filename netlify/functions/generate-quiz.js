'use strict';

/**

- Netlify Function: generate-quiz
- POST /api/generate  { topic: string, count: number }
- Returns: { lines: string }  // newline-separated quiz lines
-
- Requires env: GEMINI_API_KEY
  */

const providers = require('./lib/providers.js');
const {
  generateLines,
  generateInBatches,
  callProvider,
  buildStructuredPrompt,
} = providers;
const providerTimeoutMs = providers.providerTimeoutMs || (() => 22000);
const asyncProviderTimeoutMs = providers.asyncProviderTimeoutMs || (() => 90000);
const { normalizeQuizV2, parseLegacyQuestion, quizToLegacyLines } = require('./lib/normalizer.js');
const { normalizeGenerationPayload, sanitizeAvoidStems } = require('./lib/generationRequest.js');
const { rateLimited, retryAfterSeconds } = require('./lib/generationRateLimit.js');

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

const BEARER_TOKEN = process.env.GENERATE_BEARER_TOKEN ? String(process.env.GENERATE_BEARER_TOKEN) : '';

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

function safeInternalLaneContract(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const quizLane = ['TRIVIA', 'EXACT_STUDY', 'ABSTRACT_STUDY'].includes(raw.quizLane) ? raw.quizLane : '';
  const questionType = /^(MC|TF|YN|MT)$/.test(String(raw.questionType || '').toUpperCase())
    ? String(raw.questionType).toUpperCase()
    : '';
  if (!quizLane || !questionType) return null;
  return {
    quizLane,
    contractFlavor: String(raw.contractFlavor || '').replace(/[^a-z0-9_-]+/gi, '').slice(0, 80),
    questionType,
    scenario: !!raw.scenario,
    curveball: !!raw.curveball,
    curveballCount: Math.max(0, Math.min(50, parseInt(raw.curveballCount || 0, 10) || 0)),
  };
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
    warning: `${actual} of ${expected} questions ready.`,
  };
}

async function handleGenerateQuiz(event, options = {}) {
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

  const trustedInternalRequest = options.trustedInternalRequest === true;
  if (!trustedInternalRequest && !authorize(event)) {
    const res = reply(401, { error: 'Unauthorized' }, responseOrigin);
    res.headers['WWW-Authenticate'] = 'Bearer';
    return res;
  }

  if (!options.skipRateLimit && rateLimited(event)) {
    const retry = retryAfterSeconds();
    const res = reply(429, { error: 'Rate limited' }, responseOrigin);
    res.headers['Retry-After'] = String(retry);
    return res;
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch {
    return reply(400, { error: 'Invalid JSON' }, responseOrigin);
  }

  let normalized;
  try {
    normalized = normalizeGenerationPayload(payload, {
      env: process.env,
      queryStringParameters: event.queryStringParameters,
      headers: event.headers,
    });
  } catch (err) {
    return reply(normalizeHttpStatus(err && err.status, 400), err && err.body ? err.body : { error: 'Invalid request' }, responseOrigin);
  }

  const {
    topic,
    count,
    sourceText,
    sourceName,
    types,
    difficulty,
    provider,
    model,
    avoidStems,
    wantsLegacyOnly,
    wantsStructured,
  } = normalized;
  const laneContract = trustedInternalRequest ? safeInternalLaneContract(options.laneContract) : null;
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
    const lines = usableQuizLines(result && result.lines).slice(0, count);
    const body = {
      ...meta,
      title: result.title,
      lines: lines.join('\n'),
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

  const asyncWorkerMode = !!(options.asyncWorker || options.timeoutMode === 'async-worker');
  const providerCallTimeoutMs = asyncWorkerMode
    ? asyncProviderTimeoutMs(process.env)
    : providerTimeoutMs(process.env);
  const syncTimeoutMs = Math.max(8000, Math.min(30000, parseInt(process.env.GENERATE_TIMEOUT_MS || '25000', 10)));
  const asyncTimeoutRaw = parseInt(process.env.ASYNC_GENERATE_TIMEOUT_MS || process.env.ASYNC_FUNCTION_TIMEOUT_MS || '', 10);
  const TIMEOUT_MS = asyncWorkerMode
    ? Math.max(providerCallTimeoutMs + 1000, Math.min(125000, Number.isFinite(asyncTimeoutRaw) ? asyncTimeoutRaw : providerCallTimeoutMs + 5000))
    : syncTimeoutMs;

  const corsHeaders = makeCorsHeaders(responseOrigin);
  const selectGenerator = (providerName) => {
    const normalized = String(providerName || '').toLowerCase();
    return count > 25 && normalized !== 'echo' ? generateInBatches : generateLines;
  };
  const runGeneratorExact = async (args) => {
    let generator = selectGenerator(args.provider);
    let result = await withTimeout(generator({ ...args, providerTimeoutMs: providerCallTimeoutMs }), TIMEOUT_MS);
    let actual = countQuizLines(result.lines);
    let bestPartial = actual > 0 ? { result, actual } : null;
    if (actual < count && generator !== generateInBatches) {
      generator = generateInBatches;
      result = await withTimeout(generator({ ...args, providerTimeoutMs: providerCallTimeoutMs }), TIMEOUT_MS);
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
        callProvider({ provider, model, topic, count, types, difficulty, env: process.env, prompt: structuredPrompt, kind: 'structured', sourceText, timeoutMs: providerCallTimeoutMs }),
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

    const result = await runGeneratorExact({ provider, model, topic, count, types, difficulty, sourceText, avoidStems, laneContract, env: process.env });
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
            callProvider({ provider: 'gemini', model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite-preview-09-2025', topic, count, types, difficulty, env: process.env, prompt: structuredPrompt, kind: 'structured', sourceText, timeoutMs: providerCallTimeoutMs }),
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
        const result = await runGeneratorExact({ provider, model, topic, count, types, difficulty, sourceText, avoidStems, laneContract, env: process.env });
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
        const result = await runGeneratorExact({ provider: 'gemini', model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite-preview-09-2025', topic, count, types, difficulty, sourceText, avoidStems, laneContract, env: process.env });
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

exports.handleGenerateQuiz = handleGenerateQuiz;
exports._private = {
  countQuizLines,
  handleGenerateQuiz,
  safeInternalLaneContract,
  sanitizeAvoidStems,
  usableQuizLines,
};
