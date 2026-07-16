'use strict';

const crypto = require('node:crypto');

function parseAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function getOrigin(headers) {
  const h = headers || {};
  return h.origin || h.Origin || '';
}

function makeCorsHeaders(origin) {
  const H = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  if (origin) H['Access-Control-Allow-Origin'] = origin;
  return H;
}

function normalizeHttpStatus(value, fallback = 500) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric < 100 || numeric > 599) return fallback;
  return numeric;
}

function responseOriginFor(event) {
  const allowedOrigins = parseAllowedOrigins();
  const origin = getOrigin(event && event.headers);
  const originAllowed = !origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin);
  return {
    origin,
    allowed: originAllowed,
    responseOrigin: originAllowed ? (origin || (allowedOrigins.length === 0 ? '*' : '')) : '',
  };
}

function reply(statusCode, body, origin, extraHeaders = {}) {
  const isJson = typeof body !== 'string';
  return {
    statusCode: normalizeHttpStatus(statusCode),
    headers: {
      ...makeCorsHeaders(origin),
      ...(isJson ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    },
    body: isJson ? JSON.stringify(body) : body,
  };
}

function bearerToken(event) {
  const h = event && event.headers || {};
  const raw = h.authorization || h.Authorization || '';
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) return '';
  return trimmed.slice(7).trim();
}

function timingSafeStringEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authorize(event) {
  const token = process.env.GENERATE_BEARER_TOKEN ? String(process.env.GENERATE_BEARER_TOKEN) : '';
  if (!token) return true;
  return configuredBearerMatches(event);
}

function configuredBearerMatches(event) {
  const token = process.env.GENERATE_BEARER_TOKEN ? String(process.env.GENERATE_BEARER_TOKEN) : '';
  return !!token && timingSafeStringEqual(bearerToken(event), token);
}

function parseJsonBody(event) {
  try {
    return JSON.parse(event && event.body || '{}');
  } catch {
    const err = new Error('Invalid JSON');
    err.status = 400;
    throw err;
  }
}

function methodNotAllowed(origin) {
  return reply(405, { error: 'Method Not Allowed' }, origin);
}

function unauthorized(origin) {
  const res = reply(401, { error: 'Unauthorized' }, origin);
  res.headers['WWW-Authenticate'] = 'Bearer';
  return res;
}

function handleCors(event, allowedMethods, { requireAuth = true } = {}) {
  const originInfo = responseOriginFor(event);
  if (!originInfo.allowed) return { done: true, response: reply(403, { error: 'Forbidden origin' }, '') };
  if (event && event.httpMethod === 'OPTIONS') {
    return { done: true, response: reply(204, '', originInfo.responseOrigin) };
  }
  const methods = Array.isArray(allowedMethods) ? allowedMethods : [allowedMethods];
  if (methods.length && !methods.includes(event && event.httpMethod)) {
    return { done: true, response: methodNotAllowed(originInfo.responseOrigin) };
  }
  if (requireAuth && !authorize(event)) {
    return { done: true, response: unauthorized(originInfo.responseOrigin) };
  }
  return { done: false, origin: originInfo.responseOrigin };
}

module.exports = {
  authorize,
  bearerToken,
  configuredBearerMatches,
  handleCors,
  normalizeHttpStatus,
  parseJsonBody,
  reply,
  timingSafeStringEqual,
  unauthorized,
};
