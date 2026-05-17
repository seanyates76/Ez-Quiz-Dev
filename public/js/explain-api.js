const DEFAULT_TIMEOUT_MS = 25000;
const EXPLAIN_ENDPOINT = '/.netlify/functions/explain-answers-lazy';

function makeExplainError(message, status, body) {
  const err = new Error(message || 'Explanation failed');
  err.status = status;
  err.body = body;
  return err;
}

export async function requestLazyExplanation(payload, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(5000, timeoutMs));
  const abort = () => controller.abort();

  try {
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', abort, { once: true });
    }

    const res = await fetch(EXPLAIN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ezq-beta': '1' },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });
    const contentType = res.headers.get('content-type') || '';
    let body;
    if (contentType.includes('application/json')) {
      body = await res.json();
    } else {
      body = await res.text().catch(() => '');
    }
    if (!res.ok) {
      const message = body && typeof body === 'object' && body.error ? body.error : `Explanation failed (${res.status})`;
      throw makeExplainError(message, res.status, body);
    }
    return body;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw makeExplainError('Explanation request timed out. Try again.', 0);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    if (signal) {
      try { signal.removeEventListener('abort', abort); } catch {}
    }
  }
}
