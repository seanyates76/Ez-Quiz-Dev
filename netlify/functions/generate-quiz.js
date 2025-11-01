'use strict';

/**

- Netlify Function: generate-quiz
- POST /api/generate  { topic: string, count: number }
- Returns: { lines: string }  // newline-separated quiz lines
-
- Requires env: GEMINI_API_KEY
  */

const { generateLines, generateInBatches, callProvider, buildStructuredPrompt } = require('./lib/providers.js');
const { normalizeQuizV2, quizToLegacyLines } = require('./lib/normalizer.js');

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

function reply(statusCode, body, origin) {
  const headers = makeCorsHeaders(origin);
  return {
    statusCode,
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
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
const CLIENT_MAX = Math.max(1, Math.min(100, toPositiveInt(process.env.GENERATE_CLIENT_MAX || process.env.CLIENT_MAX_QUESTIONS, 30)));
const CONFIGURED_MAX = Math.max(1, Math.min(100, toPositiveInt(process.env.GENERATE_MAX_COUNT, CLIENT_MAX)));
const MAX_COUNT = Math.min(CLIENT_MAX, CONFIGURED_MAX);
const BEARER_TOKEN = process.env.GENERATE_BEARER_TOKEN ? String(process.env.GENERATE_BEARER_TOKEN) : '';

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

exports.handler = async (event) => {
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

  let count = payload.count;
  if (count == null) { count = 10; }
  const parsedCount = parseInt(count, 10);
  if (!Number.isFinite(parsedCount)) {
    return reply(400, { error: `Invalid count: must be a number between 1 and ${MAX_COUNT}` }, responseOrigin);
  }
  count = Math.max(1, Math.min(MAX_COUNT, parsedCount));

  let types = undefined;
  if (payload.types !== undefined) {
    if (!Array.isArray(payload.types)) {
      return reply(400, { error: 'Invalid types: must be an array of MC|TF|YN|MT' }, responseOrigin);
    }
    const filtered = payload.types.filter(t => /^(MC|TF|YN|MT)$/i.test(String(t)));
    if (payload.types.length && filtered.length === 0) {
      return reply(400, { error: 'Invalid types: use MC, TF, YN, MT' }, responseOrigin);
    }
    types = filtered;
  }

  const difficulty = (payload.difficulty && String(payload.difficulty).toLowerCase()) || undefined;
  const provider = String(payload.provider || process.env.AI_PROVIDER || 'gemini');
  const model = String(payload.model || '');

  const responseMode = String(process.env.QUIZ_RESPONSE || '').toLowerCase();
  const useV2 = responseMode === 'v2';
  const queryFormat = (event.queryStringParameters && event.queryStringParameters.format) || '';
  const headerFormat = (event.headers && (event.headers['x-quiz-format'] || event.headers['X-Quiz-Format'])) || '';
  const requestedFormat = String(payload.format || headerFormat || queryFormat).toLowerCase();
  const wantsLegacyOnly = requestedFormat === 'legacy-lines';
  const wantsStructured = useV2 && !wantsLegacyOnly && (requestedFormat === 'quiz-json' || requestedFormat === 'quiz-v2' || requestedFormat === 'json');
  const structuredPrompt = wantsStructured ? buildStructuredPrompt(topic, count, types, difficulty) : null;
  // [quiz-v2: hook] structured payload remains opt-in; default path keeps legacy lines for compatibility.

  function buildStructuredResponse({ quiz, provider: providerName, model: modelName, fallbackUsed = false, fallbackFrom, errorPrimary }) {
    const legacy = quizToLegacyLines(quiz, { count });
    const meta = {
      provider: providerName,
      model: modelName,
      fallbackUsed: !!fallbackUsed,
    };
    if (fallbackUsed && fallbackFrom) meta.fallbackFrom = fallbackFrom;
    if (fallbackUsed && errorPrimary) meta.errorPrimary = errorPrimary;
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

  // Timeout guard so the function never hangs on upstream calls
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const id = setTimeout(() => reject(Object.assign(new Error('Upstream timeout'), { status: 504 })), ms);
      promise.then(v => { clearTimeout(id); resolve(v); }, e => { clearTimeout(id); reject(e); });
    });
  }

  const TIMEOUT_MS = Math.max(8000, Math.min(20000, parseInt(process.env.GENERATE_TIMEOUT_MS || '15000', 10)));

  const corsHeaders = makeCorsHeaders(responseOrigin);

  try {
    if(wantsStructured){
      const primary = await withTimeout(
        callProvider({ provider, model, topic, count, types, difficulty, env: process.env, prompt: structuredPrompt, kind: 'structured' }),
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

    const generator = count > 50 ? generateInBatches : generateLines;
    const { title, lines, provider: usedProvider, model: usedModel } = await withTimeout(
      generator({ provider, model, topic, count, types, difficulty, env: process.env }),
      TIMEOUT_MS
    );
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, lines, provider: usedProvider, model: usedModel, fallbackUsed: false }),
    };
  } catch (err) {
    const msg = String((err && err.message) || err || 'Error');
    const is429 = msg.includes('429') || /quota|rate limit/i.test(msg) || (err && err.status === 429);
    const isTimeout = err && (err.status === 504 || /timeout/i.test(msg));

    // Fallback to Gemini if primary provider failed and Gemini credentials exist
    const primary = (provider || '').toLowerCase();
    const canFallbackToGemini = primary !== 'gemini' && !!process.env.GEMINI_API_KEY;
    if(wantsStructured){
      if (canFallbackToGemini && !isTimeout) {
        try {
          const fallback = await withTimeout(
            callProvider({ provider: 'gemini', model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite-preview-09-2025', topic, count, types, difficulty, env: process.env, prompt: structuredPrompt, kind: 'structured' }),
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
          return {
            statusCode: isTimeout ? 504 : ((err && err.status) || (fallbackErr && fallbackErr.status) || (is429 ? 429 : 502)),
            headers: { ...corsHeaders, ...(is429 ? { 'Retry-After': '30' } : {}), ...(isTimeout ? { 'Retry-After': '15' } : {}) },
            body: JSON.stringify({ error: 'Generation failed', details: msg, fallback: { tried: 'gemini', details: fbMsg } }),
          };
        }
      }

      const statusFromError = err && err.status;
      let statusCode = isTimeout ? 504 : (is429 ? 429 : statusFromError || 502);
      if (statusCode === 404) {
        statusCode = 502;
      }

      // Structured path failed entirely; fall back to legacy generator so the UI still renders a quiz.
      try {
        const generator = count > 50 ? generateInBatches : generateLines;
        const { title, lines, provider: usedProvider, model: usedModel } = await withTimeout(
          generator({ provider, model, topic, count, types, difficulty, env: process.env }),
          TIMEOUT_MS
        );
        console.warn('[quiz-v2]', { reason: 'structured-fallback-legacy' });
        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, lines, provider: usedProvider, model: usedModel, fallbackUsed: false }),
        };
      } catch (legacyErr) {
        const legacyMsg = String((legacyErr && legacyErr.message) || legacyErr || 'Error');
        return {
          statusCode,
          headers: { ...corsHeaders, ...(is429 ? { 'Retry-After': '30' } : {}), ...(isTimeout ? { 'Retry-After': '15' } : {}) },
          body: JSON.stringify({ error: isTimeout ? 'Generation timed out' : 'Generation failed', details: legacyMsg, provider }),
        };
      }
    }

    if (canFallbackToGemini && !isTimeout) {
      const generator = count > 50 ? generateInBatches : generateLines;
      try {
        const { title, lines, provider: usedProvider, model: usedModel } = await withTimeout(
          generator({ provider: 'gemini', model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite-preview-09-2025', topic, count, types, difficulty, env: process.env }),
          TIMEOUT_MS
        );
        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, lines, provider: usedProvider, model: usedModel, fallbackUsed: true, fallbackFrom: primary, errorPrimary: msg }),
        };
      } catch (fallbackErr) {
        const fbMsg = String((fallbackErr && fallbackErr.message) || fallbackErr || 'Error');
        return {
          statusCode: isTimeout ? 504 : ((err && err.status) || (fallbackErr && fallbackErr.status) || (is429 ? 429 : 502)),
          headers: { ...corsHeaders, ...(is429 ? { 'Retry-After': '30' } : {}), ...(isTimeout ? { 'Retry-After': '15' } : {}) },
          body: JSON.stringify({ error: 'Generation failed', details: msg, fallback: { tried: 'gemini', details: fbMsg } }),
        };
      }
    }

    const statusFromError = err && err.status;
    let statusCode = isTimeout ? 504 : (is429 ? 429 : statusFromError || 502);
    if (statusCode === 404) {
      statusCode = 502;
    }

    return {
      statusCode,
      headers: { ...corsHeaders, ...(is429 ? { 'Retry-After': '30' } : {}), ...(isTimeout ? { 'Retry-After': '15' } : {}) },
      body: JSON.stringify({ error: isTimeout ? 'Generation timed out' : 'Generation failed', details: msg, provider }),
    };
  }
};
