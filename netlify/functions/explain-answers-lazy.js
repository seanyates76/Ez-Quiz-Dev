'use strict';

/**
 * Netlify Function: explain-answers-lazy
 * POST /.netlify/functions/explain-answers-lazy
 * 
 * Request body JSON:
 * {
 *   "lines": ["MC|...", "TF|...", ...],
 *   "index": 3            // OR: "indices": [0,2,5]
 * }
 * 
 * Response JSON:
 * {
 *   "explanations": {
 *     "3": { "explanation": "Concise rationale..." },
 *     "5": { "explanation": "..." }
 *   }
 * }
 * 
 * Errors return { error: string } with appropriate 400/405/500 codes.
 */

const { explainQuestions } = require('./lib/providers.explain.js');

// Question parsing regex patterns (consistent with public/js/parser.js)
const MC_RE = /^MC\|(.*)\|(.+?)\|([A-Za-z](?:\s*,\s*[A-Za-z])*)$/i;
const TF_RE = /^TF\|(.*)\|(T|F)$/i;
const YN_RE = /^YN\|(.*)\|(Y|N)$/i;
const MT_RE = /^MT\|(.*)\|(.+?)\|(.+?)\|(.+?)$/i;

// Utility: normalize letters to indexes (e.g., "A,C" -> [0,2])
function normalizeLettersToIndexes(letters) {
  if (!letters) return [];
  return letters.split(',')
    .map(l => l.trim().toUpperCase())
    .filter(l => /^[A-Z]$/.test(l))
    .map(l => l.charCodeAt(0) - 65);
}

// Parse a single quiz line into question object
function parseQuizLine(line, lineIndex) {
  const raw = line.trim();
  
  if (MC_RE.test(raw)) {
    const m = raw.match(MC_RE);
    const text = m[1].trim();
    const optRaw = m[2].trim();
    const corrRaw = m[3].trim();
    
    const options = optRaw.split(';').map(s => s.trim().replace(/^[A-D]\)\s*/i, '').trim());
    const correct = normalizeLettersToIndexes(corrRaw);
    
    // Validate correct answers are in range
    const bad = correct.find(c => c < 0 || c >= options.length);
    if (bad !== undefined) {
      throw new Error(`MC correct answer out of range at line ${lineIndex + 1}`);
    }
    
    return { type: 'MC', text, options, correct: correct.sort((a, b) => a - b) };
  }
  
  if (TF_RE.test(raw)) {
    const m = raw.match(TF_RE);
    const text = m[1].trim();
    const correct = m[2].toUpperCase() === 'T';
    return { type: 'TF', text, correct };
  }
  
  if (YN_RE.test(raw)) {
    const m = raw.match(YN_RE);
    const text = m[1].trim();
    const correct = m[2].toUpperCase() === 'Y';
    return { type: 'YN', text, correct };
  }
  
  if (MT_RE.test(raw)) {
    const m = raw.match(MT_RE);
    const text = m[1].trim();
    const leftRaw = m[2].trim();
    const rightRaw = m[3].trim();
    const pairsRaw = m[4].trim();
    
    const left = leftRaw.split(';').map(s => s.trim().replace(/^\d+\)\s*/, '').trim()).filter(Boolean);
    const right = rightRaw.split(';').map(s => s.trim().replace(/^[A-Z]\)\s*/i, '').trim()).filter(Boolean);
    
    // Parse pairs like "1-A,2-B,3-C"
    const pairs = pairsRaw.split(',').map(p => {
      const parts = p.split('-').map(x => x.trim());
      const li = parseInt(parts[0], 10) - 1; // Convert to 0-based
      const ri = parts[1].toUpperCase().charCodeAt(0) - 65; // Convert A->0, B->1, etc.
      return [li, ri];
    });
    
    // Validate pairs are in range
    const invalid = pairs.some(([li, ri]) => li < 0 || li >= left.length || ri < 0 || ri >= right.length);
    if (invalid) {
      throw new Error(`MT pair out of range at line ${lineIndex + 1}`);
    }
    
    return { type: 'MT', text, left, right, pairs };
  }
  
  throw new Error(`Unknown or invalid format at line ${lineIndex + 1}: ${raw}`);
}

// Parse multiple quiz lines and return only the requested indices
function parseRequestedQuestions(lines, requestedIndices) {
  const questions = [];
  const originalIndices = [];
  
  for (const index of requestedIndices) {
    if (index < 0 || index >= lines.length) {
      throw new Error(`Index ${index} out of range (0-${lines.length - 1})`);
    }
    
    try {
      const question = parseQuizLine(lines[index], index);
      questions.push(question);
      originalIndices.push(index);
    } catch (err) {
      throw new Error(`Failed to parse line ${index}: ${err.message}`);
    }
  }
  
  return { questions, originalIndices };
}

// CORS utilities (copied from generate-quiz.js pattern)
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
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

// Rate limiting (simple per-IP sliding window)
const RL = new Map(); // ip -> [timestamps]
const DEFAULT_LIMIT = 30; // Lower limit for explanation requests
const DEFAULT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function toPositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const LIMIT = toPositiveInt(process.env.EXPLAIN_LIMIT, DEFAULT_LIMIT);
const WINDOW_MS = toPositiveInt(process.env.EXPLAIN_WINDOW_MS, DEFAULT_WINDOW_MS);

function clientIp(event) {
  const h = event.headers || {};
  const forwarded = h['x-forwarded-for'] || h['X-Forwarded-For'] || '';
  const ip = forwarded.split(',')[0]?.trim() || h['x-real-ip'] || h['X-Real-IP'] || 'unknown';
  return String(ip).replace(/[^a-f0-9:.]/gi, '').slice(0, 45); // Basic sanitization
}

function rateLimited(event) {
  const ip = clientIp(event);
  const now = Date.now();
  const history = RL.get(ip) || [];
  
  // Remove old timestamps outside the window
  const recent = history.filter(ts => now - ts < WINDOW_MS);
  
  if (recent.length >= LIMIT) {
    return true; // Rate limited
  }
  
  // Update with new timestamp
  recent.push(now);
  RL.set(ip, recent);
  
  return false;
}

// Authorization (if EXPLAIN_BEARER_TOKEN is set)
const BEARER_TOKEN = process.env.EXPLAIN_BEARER_TOKEN ? String(process.env.EXPLAIN_BEARER_TOKEN) : '';

function authorize(event) {
  if (!BEARER_TOKEN) return true; // No auth required
  
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  return token === BEARER_TOKEN;
}

// Timeout utility
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), ms);
    }),
  ]);
}

// Main handler
exports.handler = async (event) => {
  const allowedOrigins = parseAllowedOrigins();
  const origin = getOrigin(event.headers);
  const originAllowed = !origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin);

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    if (!originAllowed) return reply(403, { error: 'Forbidden origin' }, '');
    return reply(204, '', origin || (allowedOrigins.length === 0 ? '*' : ''));
  }

  // Check origin
  if (!originAllowed) return reply(403, { error: 'Forbidden origin' }, '');

  const responseOrigin = origin || (allowedOrigins.length === 0 ? '*' : '');

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method not allowed' }, responseOrigin);
  }

  // Rate limiting
  if (rateLimited(event)) {
    return reply(429, { error: 'Rate limit exceeded' }, responseOrigin);
  }

  // Authorization check
  if (!authorize(event)) {
    return reply(401, { error: 'Unauthorized' }, responseOrigin);
  }

  // Parse request body
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    return reply(400, { error: 'Invalid JSON in request body' }, responseOrigin);
  }

  // Validate request format
  const { lines, index, indices, answer, answers } = payload;
  
  if (!Array.isArray(lines)) {
    return reply(400, { error: 'Missing or invalid "lines" array' }, responseOrigin);
  }

  // Determine requested indices
  let requestedIndices = [];
  if (typeof index === 'number') {
    requestedIndices = [index];
  } else if (Array.isArray(indices)) {
    requestedIndices = indices.filter(i => typeof i === 'number');
  } else {
    return reply(400, { error: 'Must provide either "index" (number) or "indices" (array)' }, responseOrigin);
  }

  if (requestedIndices.length === 0) {
    return reply(400, { error: 'No valid indices provided' }, responseOrigin);
  }

  // Limit number of questions per request to prevent abuse
  const MAX_QUESTIONS = 20;
  if (requestedIndices.length > MAX_QUESTIONS) {
    return reply(400, { error: `Too many questions requested (max ${MAX_QUESTIONS})` }, responseOrigin);
  }

  // Get provider configuration
  const provider = String(payload.provider || process.env.EXPLAIN_PROVIDER || process.env.AI_PROVIDER || '').trim();
  const model = String(payload.model || '');

  // Set timeout for explanation generation
  const TIMEOUT_MS = Math.max(5000, Math.min(30000, parseInt(process.env.EXPLAIN_TIMEOUT_MS || '15000', 10)));

  try {
    // Parse the requested questions
    const { questions, originalIndices } = parseRequestedQuestions(lines, requestedIndices);
    const attemptedAnswers = originalIndices.map((originalIndex, requestIndex) => {
      if (typeof index === 'number') return requestIndex === 0 ? answer : undefined;
      if (Array.isArray(answers)) return answers[requestIndex];
      if (answers && typeof answers === 'object') {
        return answers[originalIndex] ?? answers[String(originalIndex)];
      }
      return undefined;
    });

    // Generate explanations with timeout
    const explanations = await withTimeout(
      explainQuestions({ 
        provider, 
        model, 
        questions, 
        originalIndices, 
        attemptedAnswers,
        env: process.env 
      }),
      TIMEOUT_MS
    );

    return reply(200, { explanations }, responseOrigin);

  } catch (err) {
    console.error('Explanation error:', err);
    
    const msg = String((err && err.message) || err || 'Error');
    const status = (err && err.status) || 500;
    
    if (msg.includes('Timeout')) {
      return reply(504, { error: 'Explanation generation timed out' }, responseOrigin);
    }
    
    if (msg.includes('out of range') || msg.includes('Invalid') || msg.includes('Failed to parse')) {
      return reply(400, { error: msg }, responseOrigin);
    }
    
    if (status >= 400 && status < 500) {
      return reply(status, { error: msg }, responseOrigin);
    }

    if (msg.includes('not configured')) {
      return reply(503, { error: 'Explanation provider is not configured' }, responseOrigin);
    }

    return reply(500, { error: 'Internal server error' }, responseOrigin);
  }
};
