'use strict';

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || headers.get(name.toLowerCase()) || headers.get(name.toUpperCase()) || '';
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || '';
}

function requireBeta(request) {
  const headers = request?.headers || {};
  const cookieHeader = headerValue(headers, 'cookie') || '';
  const match = String(cookieHeader).match(/(?:^|;\s*)FEATURE_FLAGS=([^;]+)/);
  const hasCookie = !!match && decodeURIComponent(match[1] || '')
    .split(',')
    .map((flag) => flag.trim())
    .includes('beta');

  const headerBeta = headerValue(headers, 'x-ezq-beta') === '1';

  return hasCookie || headerBeta;
}

function betaForbiddenResponse() {
  const body = JSON.stringify({
    error: 'MCP is in beta.',
    action: 'Visit /beta to opt in, or send header x-ezq-beta: 1 in local dev.',
  });
  const init = {
    status: 403,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  };
  if (typeof Response === 'function') return new Response(body, init);
  return { ...init, text: async () => body };
}

module.exports = { requireBeta, betaForbiddenResponse };
