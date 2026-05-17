'use strict';

const { explainQuestions } = require('./lib/providers.explain.js');

const MC_RE = /^MC\|(.*)\|(.+?)\|([A-Za-z](?:\s*,\s*[A-Za-z])*)$/i;
const TF_RE = /^TF\|(.*)\|(T|F)$/i;
const YN_RE = /^YN\|(.*)\|(Y|N)$/i;
const MT_RE = /^MT\|(.*)\|(.+?)\|(.+?)\|(.+?)$/i;

const MAX_BODY_BYTES = 64 * 1024;
const MAX_LINES = 200;
const MAX_LINE_CHARS = 4000;
const MAX_QUESTIONS = 20;
const DEFAULT_LIMIT = 30;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

function normalizeLettersToIndexes(letters) {
  if (!letters) return [];
  return letters.split(',').map((l) => l.trim().toUpperCase()).filter((l) => /^[A-Z]$/.test(l)).map((l) => l.charCodeAt(0) - 65);
}

function parseQuizLine(line, lineIndex) {
  const raw = line.trim();
  if (MC_RE.test(raw)) {
    const m = raw.match(MC_RE);
    const text = m[1].trim();
    const options = m[2].trim().split(';').map((s) => s.trim().replace(/^[A-D]\)\s*/i, '').trim());
    const correct = normalizeLettersToIndexes(m[3].trim());
    const bad = correct.find((c) => c < 0 || c >= options.length);
    if (bad !== undefined) throw new Error(`MC correct answer out of range at line ${lineIndex + 1}`);
    return { type: 'MC', text, options, correct: correct.sort((a, b) => a - b) };
  }
  if (TF_RE.test(raw)) {
    const m = raw.match(TF_RE);
    return { type: 'TF', text: m[1].trim(), correct: m[2].toUpperCase() === 'T' };
  }
  if (YN_RE.test(raw)) {
    const m = raw.match(YN_RE);
    return { type: 'YN', text: m[1].trim(), correct: m[2].toUpperCase() === 'Y' };
  }
  if (MT_RE.test(raw)) {
    const m = raw.match(MT_RE);
    const text = m[1].trim();
    const left = m[2].trim().split(';').map((s) => s.trim().replace(/^\d+\)\s*/, '').trim()).filter(Boolean);
    const right = m[3].trim().split(';').map((s) => s.trim().replace(/^[A-Z]\)\s*/i, '').trim()).filter(Boolean);
    const pairs = m[4].trim().split(',').map((p) => {
      const parts = p.split('-').map((x) => x.trim());
      return [parseInt(parts[0], 10) - 1, parts[1].toUpperCase().charCodeAt(0) - 65];
    });
    const invalid = pairs.some(([li, ri]) => li < 0 || li >= left.length || ri < 0 || ri >= right.length);
    if (invalid) throw new Error(`MT pair out of range at line ${lineIndex + 1}`);
    return { type: 'MT', text, left, right, pairs };
  }
  throw new Error(`Unknown or invalid format at line ${lineIndex + 1}: ${raw}`);
}

function parseRequestedQuestions(lines, requestedIndices) {
  const questions = [];
  const originalIndices = [];
  for (const index of requestedIndices) {
    if (index < 0 || index >= lines.length) throw new Error(`Index ${index} out of range (0-${lines.length - 1})`);
    try {
      questions.push(parseQuizLine(lines[index], index));
      originalIndices.push(index);
    } catch (err) {
      throw new Error(`Failed to parse line ${index}: ${err.message}`);
    }
  }
  return { questions, originalIndices };
}

function parseAllowedOrigins() {
  return String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function getOrigin(headers) {
  return (headers || {}).origin || (headers || {}).Origin || '';
}

function makeCorsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-ezq-beta',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function reply(statusCode, body, origin) {
  const headers = makeCorsHeaders(origin);
  return { statusCode, headers: { ...headers, 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

async function netlifyFromResponse(response, origin) {
  const bodyText = await response.text().catch(() => '');
  let body;
  try { body = JSON.parse(bodyText); } catch { body = { error: bodyText || 'Forbidden' }; }
  return reply(response.status || 403, body, origin);
}

function badRequest(message, origin, details) {
  return reply(400, { error: message, code: 'EXPLAIN_BAD_REQUEST', ...(details ? { details } : {}) }, origin);
}

const RL = new Map();
function toPositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
const LIMIT = toPositiveInt(process.env.EXPLAIN_LIMIT, DEFAULT_LIMIT);
const WINDOW_MS = toPositiveInt(process.env.EXPLAIN_WINDOW_MS, DEFAULT_WINDOW_MS);
const MAX_RATE_LIMIT_KEYS = 500;

function clientIp(event) {
  const h = event.headers || {};
  const forwarded = h['x-forwarded-for'] || h['X-Forwarded-For'] || '';
  return String(forwarded.split(',')[0]?.trim() || h['x-real-ip'] || h['X-Real-IP'] || 'unknown').replace(/[^a-f0-9:.]/gi, '').slice(0, 45);
}

function rateLimited(event) {
  const ip = clientIp(event);
  const now = Date.now();
  const recent = (RL.get(ip) || []).filter((ts) => now - ts < WINDOW_MS);
  if (recent.length >= LIMIT) return true;
  recent.push(now);
  RL.set(ip, recent);
  if (RL.size > MAX_RATE_LIMIT_KEYS) {
    for (const [key, list] of RL.entries()) {
      const keep = list.filter((ts) => now - ts < WINDOW_MS);
      if (keep.length) RL.set(key, keep); else RL.delete(key);
    }
  }
  return false;
}

const BEARER_TOKEN = process.env.EXPLAIN_BEARER_TOKEN ? String(process.env.EXPLAIN_BEARER_TOKEN) : '';
function authorize(event) {
  if (!BEARER_TOKEN) return true;
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  return authHeader.replace(/^Bearer\s+/i, '') === BEARER_TOKEN;
}

async function withTimeout(promise, ms) {
  let timer;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isSafeInteger(value) {
  return Number.isInteger(value) && Number.isSafeInteger(value);
}

function validatePayload(payload, origin) {
  const { lines, index, indices } = payload;
  if (!Array.isArray(lines)) return { error: badRequest('Missing or invalid "lines" array', origin) };
  if (lines.length === 0 || lines.length > MAX_LINES) return { error: badRequest(`"lines" must contain 1-${MAX_LINES} items`, origin) };
  const badLine = lines.findIndex((line) => typeof line !== 'string' || !line.trim() || line.length > MAX_LINE_CHARS);
  if (badLine !== -1) return { error: badRequest(`Invalid line at index ${badLine}`, origin) };

  if (index !== undefined && indices !== undefined) return { error: badRequest('Provide either "index" or "indices", not both', origin) };
  let requestedIndices;
  if (isSafeInteger(index)) requestedIndices = [index];
  else if (Array.isArray(indices)) requestedIndices = indices;
  else return { error: badRequest('Must provide either "index" (number) or "indices" (array)', origin) };

  if (!requestedIndices.length || requestedIndices.some((i) => !isSafeInteger(i))) return { error: badRequest('No valid indices provided', origin) };
  requestedIndices = Array.from(new Set(requestedIndices));
  if (requestedIndices.length > MAX_QUESTIONS) return { error: badRequest(`Too many questions requested (max ${MAX_QUESTIONS})`, origin) };
  return { lines, requestedIndices };
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

  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' }, responseOrigin);
  if (rateLimited(event)) return reply(429, { error: 'Rate limit exceeded' }, responseOrigin);
  if (!authorize(event)) return reply(401, { error: 'Unauthorized' }, responseOrigin);
  if (Buffer.byteLength(String(event.body || ''), 'utf8') > MAX_BODY_BYTES) {
    return reply(413, { error: `Request body too large (max ${MAX_BODY_BYTES} bytes)`, code: 'EXPLAIN_PAYLOAD_TOO_LARGE' }, responseOrigin);
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return badRequest('Invalid JSON in request body', responseOrigin); }
  const validated = validatePayload(payload, responseOrigin);
  if (validated.error) return validated.error;

  const TIMEOUT_MS = Math.max(5000, Math.min(30000, parseInt(process.env.EXPLAIN_TIMEOUT_MS || '15000', 10)));
  try {
    const { questions, originalIndices } = parseRequestedQuestions(validated.lines, validated.requestedIndices);
    const explanations = await withTimeout(explainQuestions({ provider: undefined, model: undefined, questions, originalIndices, env: process.env }), TIMEOUT_MS);
    return reply(200, { explanations }, responseOrigin);
  } catch (err) {
    console.error('Explanation error:', err && { message: err.message, code: err.code, status: err.status });
    const msg = String((err && err.message) || err || 'Error');
    const status = (err && err.status) || 500;
    if (msg.includes('Timeout')) return reply(504, { error: 'Explanation generation timed out', code: 'EXPLAIN_TIMEOUT' }, responseOrigin);
    if (msg.includes('out of range') || msg.includes('Invalid') || msg.includes('Failed to parse')) return badRequest(msg, responseOrigin);
    if (err && err.code && status >= 400 && status < 600) {
      const body = { error: status >= 500 && err.code !== 'EXPLAIN_PROVIDER_NOT_CONFIGURED' ? 'Explanation provider failed' : msg, code: err.code };
      if (err.details !== undefined && status < 500) body.details = err.details;
      return reply(status, body, responseOrigin);
    }
    return reply(500, { error: 'Internal server error', code: 'EXPLAIN_INTERNAL_ERROR' }, responseOrigin);
  }
};

module.exports._internals = {
  rateLimited,
  rateLimitSize: () => RL.size,
  clearRateLimit: () => RL.clear(),
};
