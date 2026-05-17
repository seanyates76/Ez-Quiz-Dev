const DEFAULT_NETLIFY_ORIGINS = [
  'https://ez-quiz.netlify.app',
  'https://eq-quiz.netlify.app'
];

function isAbsoluteUrl(url) {
  return /^[a-z][a-z0-9+.-]*:/i.test(String(url || '').trim());
}

function isSameOriginEndpoint(url, origin) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (!isAbsoluteUrl(raw)) return true;
  if (!origin || origin === 'null') return false;
  try {
    return new URL(raw, origin).origin === origin;
  } catch {
    return false;
  }
}

function normalizeEndpointSpecs(){
  const seen = new Set();
  const out = [];

  const origin = (typeof window !== 'undefined' && window && window.location && window.location.origin) ? window.location.origin : '';

  const push = (url, allow404Fallback, options = {}) => {
    if (!url || typeof url !== 'string') return;
    const trimmed = url.trim();
    if (!trimmed || seen.has(`${trimmed}::${allow404Fallback ? '1' : '0'}`)) return;
    seen.add(`${trimmed}::${allow404Fallback ? '1' : '0'}`);
    out.push({
      url: trimmed,
      allow404Fallback: !!allow404Fallback,
      allowSourceFallback: !!options.allowSourceFallback || isSameOriginEndpoint(trimmed, origin),
    });
  };

  const configured = (typeof window !== 'undefined' && window && Array.isArray(window.EZQ_API_ENDPOINTS)) ? window.EZQ_API_ENDPOINTS : null;

  // Primary endpoints on the current origin.
  push('/.netlify/functions/generate-quiz', false);
  push('/api/generate', true);

  // Consumer-provided overrides.
  if (configured) {
    configured.forEach((entry) => {
      if (!entry) return;
      if (typeof entry === 'string') {
        push(entry, false);
        return;
      }
      if (entry && typeof entry === 'object') {
        push(entry.url, !!entry.allow404Fallback, { allowSourceFallback: !!entry.allowSourceFallback });
      }
    });
  }

  // Explicit absolute URLs for the current origin.
  if (origin) {
    const base = origin.replace(/\/$/, '');
    push(`${base}/.netlify/functions/generate-quiz`, false);
    push(`${base}/api/generate`, true);
  }

  // Netlify default domains (only when custom overrides are absent).
  if (!configured) {
    DEFAULT_NETLIFY_ORIGINS.forEach((originCandidate) => {
      if (!originCandidate) return;
      const base = originCandidate.replace(/\/$/, '');
      push(`${base}/.netlify/functions/generate-quiz`, false);
      push(`${base}/api/generate`, true);
    });
  }

  return out;
}

const API_ENDPOINT_CANDIDATES = normalizeEndpointSpecs();

export async function generateWithAI(topic, count, opts = {}){
  const payload = JSON.stringify({ topic, count, ...opts });
  const attemptErrors = [];
  const hasSourceText = !!String(opts && opts.sourceText || '').trim();
  const endpointCandidates = hasSourceText
    ? API_ENDPOINT_CANDIDATES.filter((spec) => spec.allowSourceFallback)
    : API_ENDPOINT_CANDIDATES;

  for (let i = 0; i < endpointCandidates.length; i++) {
    const { url: endpoint, allow404Fallback } = endpointCandidates[i];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal
      });

      if (!res.ok) {
        let body;
        try { body = await res.json(); }
        catch { body = await res.text().catch(() => String(res.status)); }

        // Fallback to the next endpoint when the route is missing (404).
        if (res.status === 404 && allow404Fallback && i < endpointCandidates.length - 1) {
          attemptErrors.push({ endpoint, status: res.status, body });
          continue;
        }

        const serious = new Error(JSON.stringify({ endpoint, status: res.status, body }));
        serious.__ezStopFallback = true;
        throw serious;
      }

      const data = await res.json();
      return { lines: String(data.lines || '').trim(), title: String(data.title || '') };
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      attemptErrors.push({ endpoint, error: message });
      if (err && err.__ezStopFallback) {
        throw err;
      }
      if (err && err.name === 'AbortError') {
        const timeout = new Error('Generation timed out locally. Try fewer questions or retry.');
        timeout.name = 'GenerationTimeout';
        throw timeout;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(JSON.stringify({ error: 'All API endpoints failed', attempts: attemptErrors }));
}
