'use strict';

const { handleApi } = require('../../standalone/server.cjs');
const previewPolicy = require('./lib/shared-preview.json');

function sharedConnection(host) {
  if (!previewPolicy.enabled || host !== previewPolicy.hostname) return null;
  const apiKey = (process.env.ezq_bmok_shared || '').trim();
  if (!apiKey) return null;
  return { provider: 'openai', model: 'gpt-4.1-mini', apiKey };
}

const ROUTES = new Set(['/api/models', '/api/generate', '/api/explain', '/api/import']);
const MAX_BODY_BYTES = 6 * 1024 * 1024;

function reply(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    body: JSON.stringify(payload),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Use POST for AI requests.' });
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([name, value]) => [name.toLowerCase(), value]));
  let origin;
  try { origin = new URL(headers.origin); } catch {}
  if (!origin || origin.protocol !== 'https:' || origin.host !== headers.host || headers['sec-fetch-site'] === 'cross-site') {
    return reply(403, { error: 'Open AI setup on this EZ Quiz site to connect.' });
  }
  if (!/^application\/json(?:;|$)/i.test(headers['content-type'] || '')) return reply(415, { error: 'Expected JSON.' });
  const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return reply(413, { error: 'The request exceeds the 6 MiB limit.' });
  let payload;
  try { payload = JSON.parse(body); } catch { return reply(400, { error: 'The request is not valid JSON.' }); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reply(400, { error: 'Expected an object.' });
  const { route, useShared, ...input } = payload;
  const shared = sharedConnection(headers.host);
  if (route === '/api/connection') {
    return reply(200, shared
      ? { shared: { provider: shared.provider, model: shared.model } }
      : { shared: null, unavailable: !previewPolicy.enabled ? 'deployment-disabled' : headers.host !== previewPolicy.hostname ? 'outside-preview' : 'missing-runtime-key' });
  }
  if (!ROUTES.has(route)) return reply(404, { error: 'Endpoint not found.' });
  if (useShared === true && !input.connection?.apiKey) {
    if (!shared) return reply(403, { error: 'Shared AI is unavailable on this deployment. Add your own key in AI settings.' });
    input.connection = shared;
  }
  const signal = AbortSignal.timeout(25000);
  try {
    return reply(200, await handleApi(route, input, { fetchImpl: fetch, signal }));
  } catch (err) {
    if (signal.aborted) return reply(504, { error: 'The AI provider timed out. Try fewer questions or Lite mode.' });
    return reply(err.status || 500, { error: err.status ? err.message : 'The AI request could not be completed. Try again.' });
  }
};
