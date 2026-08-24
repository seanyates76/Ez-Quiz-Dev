'use strict';

function plainResponse(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
    body,
  };
}

exports.handler = async (event = {}) => {
  const method = String(event.httpMethod || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return plainResponse(405, 'Method not allowed', { Allow: 'GET, HEAD' });
  }

  const token = String(process.env.OPENAI_APPS_CHALLENGE || '').trim();
  if (!token || token.length > 2048 || /[\r\n]/.test(token)) {
    return plainResponse(404, 'Domain verification is not configured');
  }

  return plainResponse(200, method === 'HEAD' ? '' : token);
};
