'use strict';

const DEFAULT_LIMIT = 60;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const MAX_RATE_LIMIT_KEYS = 500;
const requestsByIp = new Map();

function positiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function settings(env = process.env) {
  return {
    limit: positiveInt(env.GENERATE_LIMIT, DEFAULT_LIMIT),
    windowMs: positiveInt(env.GENERATE_WINDOW_MS, DEFAULT_WINDOW_MS),
  };
}

function clientIp(event) {
  const headers = event && event.headers || {};
  const forwarded = headers['x-forwarded-for'] || headers['X-Forwarded-For'] || '';
  const firstForwarded = (Array.isArray(forwarded) ? forwarded[0] : String(forwarded).split(',')[0]).trim();
  return String(firstForwarded || headers['client-ip'] || headers['x-nf-client-connection-ip'] || 'unknown');
}

function prune(now, windowMs) {
  for (const [key, timestamps] of requestsByIp.entries()) {
    const fresh = timestamps.filter((timestamp) => now - timestamp < windowMs);
    if (fresh.length) requestsByIp.set(key, fresh);
    else requestsByIp.delete(key);
  }
  while (requestsByIp.size > MAX_RATE_LIMIT_KEYS) {
    const oldestKey = requestsByIp.keys().next().value;
    if (!oldestKey) break;
    requestsByIp.delete(oldestKey);
  }
}

function rateLimited(event, options = {}) {
  const env = options.env || process.env;
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const { limit, windowMs } = settings(env);
  const ip = clientIp(event);
  const fresh = (requestsByIp.get(ip) || []).filter((timestamp) => now - timestamp < windowMs);
  if (fresh.length >= limit) return true;
  fresh.push(now);
  requestsByIp.set(ip, fresh);
  if (requestsByIp.size > MAX_RATE_LIMIT_KEYS) prune(now, windowMs);
  return false;
}

function retryAfterSeconds(env = process.env) {
  return Math.ceil(settings(env).windowMs / 1000);
}

function clearRateLimit() {
  requestsByIp.clear();
}

module.exports = {
  MAX_RATE_LIMIT_KEYS,
  clearRateLimit,
  clientIp,
  rateLimitSize: () => requestsByIp.size,
  rateLimited,
  retryAfterSeconds,
};
