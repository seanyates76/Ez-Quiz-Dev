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
const LARGE_SOURCE_MULTI_REQUEST_THRESHOLD = 20000;
export const LARGE_SOURCE_CHUNK_TARGET_CHARS = 4000;
const LARGE_SOURCE_SHORTFALL_RETRY_CAP = 2;

function toPositiveCount(value, fallback = 10){
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanStem(raw){
  return String(raw == null ? '' : raw)
    .replace(/[\r\n|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function normalizedStem(raw){
  return cleanStem(raw)
    .replace(/\s+([?!.,:;])/g, '$1')
    .toLowerCase();
}

function sanitizeAvoidStems(raw){
  if(!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for(const entry of raw){
    const stem = cleanStem(entry);
    const key = normalizedStem(stem);
    if(!stem || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(stem);
    if(out.length >= 60) break;
  }
  return out;
}

function splitQuizLines(raw){
  return String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^TITLE:/i.test(line));
}

function validMultipleChoiceLine(raw){
  const m = raw.match(/^MC\|(.+?)\|(.+?)\|([A-Za-z](?:\s*,\s*[A-Za-z])*)$/i);
  if(!m) return false;
  const options = m[2].split(';').map((s) => s.trim()).filter(Boolean);
  if(options.length < 2) return false;
  const answers = m[3].split(',').map((s) => s.trim()).filter(Boolean);
  return answers.length > 0 && answers.every((answer) => {
    const idx = answer.toUpperCase().charCodeAt(0) - 65;
    return idx >= 0 && idx < options.length;
  });
}

function isValidQuizLine(line){
  const raw = String(line || '').trim();
  if(/^MC\|/i.test(raw)) return validMultipleChoiceLine(raw);
  if(/^TF\|/i.test(raw)) return /^TF\|(.+?)\|(T|F)$/i.test(raw);
  if(/^YN\|/i.test(raw)) return /^YN\|(.+?)\|(Y|N)$/i.test(raw);
  if(/^MT\|/i.test(raw)) return /^MT\|(.+?)\|(.+?)\|(.+?)\|(.+?)$/i.test(raw);
  return false;
}

function questionStemFromLine(line){
  if(!isValidQuizLine(line)) return '';
  const parts = String(line || '').split('|');
  return cleanStem(parts.length > 1 ? parts[1] : '');
}

function addAvoidStem(stem, avoidStems, seenKeys){
  const cleaned = cleanStem(stem);
  const key = normalizedStem(cleaned);
  if(!cleaned || !key || seenKeys.has(key)) return false;
  seenKeys.add(key);
  avoidStems.push(cleaned);
  return true;
}

function collectUniqueQuizLines(rawLines, seenKeys, avoidStems){
  const accepted = [];
  for(const line of splitQuizLines(rawLines)){
    const stem = questionStemFromLine(line);
    const key = normalizedStem(stem);
    if(!stem || !key || seenKeys.has(key)) continue;
    addAvoidStem(stem, avoidStems, seenKeys);
    accepted.push(line);
  }
  return accepted;
}

function shouldUseLargeSourceBatching(count, opts){
  const sourceText = opts && typeof opts.sourceText === 'string' ? opts.sourceText : '';
  return sourceText.length >= LARGE_SOURCE_MULTI_REQUEST_THRESHOLD && count > 0;
}

function sourceChunkBoundary(windowText, target){
  const minUsefulCut = Math.floor(target * 0.55);
  const paragraphCut = windowText.lastIndexOf('\n\n');
  if(paragraphCut >= minUsefulCut) return paragraphCut;
  const newlineCut = windowText.lastIndexOf('\n');
  if(newlineCut >= minUsefulCut) return newlineCut;
  const sentenceCuts = ['. ', '? ', '! ', '; '].map((needle) => {
    const index = windowText.lastIndexOf(needle);
    return index >= 0 ? index + 1 : -1;
  });
  const sentenceCut = Math.max(...sentenceCuts);
  if(sentenceCut >= minUsefulCut) return sentenceCut;
  return target;
}

function splitSourceTextIntoChunks(sourceText, target = LARGE_SOURCE_CHUNK_TARGET_CHARS){
  const text = String(sourceText || '').trim();
  const safeTarget = Math.max(1000, parseInt(target, 10) || LARGE_SOURCE_CHUNK_TARGET_CHARS);
  if(!text) return [];
  if(text.length <= safeTarget) return [text];

  const chunks = [];
  let remaining = text;
  while(remaining.length > safeTarget){
    const windowText = remaining.slice(0, safeTarget);
    const cut = sourceChunkBoundary(windowText, safeTarget);
    const chunk = remaining.slice(0, cut).trim();
    if(chunk) chunks.push(chunk);
    remaining = remaining.slice(cut).trim();
  }
  if(remaining) chunks.push(remaining);
  return chunks;
}

function selectSourceChunksForCount(chunks, count){
  const requested = Math.max(1, toPositiveCount(count));
  if(chunks.length <= requested) return chunks;
  if(requested === 1) return [chunks[Math.floor(chunks.length / 2)]];

  const selected = [];
  const used = new Set();
  for(let i = 0; i < requested; i += 1){
    const index = Math.round((i * (chunks.length - 1)) / (requested - 1));
    if(used.has(index)) continue;
    used.add(index);
    selected.push(chunks[index]);
  }
  return selected;
}

function distributeQuestionCountAcrossChunks(chunks, count){
  const requested = Math.max(1, toPositiveCount(count));
  const selectedChunks = selectSourceChunksForCount(chunks, requested);
  if(!selectedChunks.length) return [];
  const base = Math.floor(requested / selectedChunks.length);
  const extra = requested % selectedChunks.length;
  return selectedChunks.map((chunk, index) => ({
    sourceText: chunk,
    count: base + (index < extra ? 1 : 0),
  })).filter((entry) => entry.count > 0);
}

function readableGenerationError(err){
  const msg = err && err.message ? err.message : String(err || 'Generation failed');
  try{
    const parsed = JSON.parse(msg);
    if(parsed && parsed.body && typeof parsed.body === 'object'){
      return parsed.body.details || parsed.body.error || msg;
    }
    if(parsed && typeof parsed.error === 'string') return parsed.error;
  }catch{}
  return msg;
}

function batchFailureError(err, batchNo, completed, requested){
  const detail = readableGenerationError(err);
  const message = `Generation batch ${batchNo} failed after ${completed} of ${requested} questions completed.${detail ? ` ${detail}` : ''}`;
  const wrapped = new Error(message);
  wrapped.name = 'GenerationBatchError';
  return wrapped;
}

async function postGenerate(topic, count, opts = {}){
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

async function generateLargeSourceWithAI(topic, count, opts = {}){
  const requested = toPositiveCount(count);
  const sourceChunks = splitSourceTextIntoChunks(opts.sourceText);
  const requestPlan = distributeQuestionCountAcrossChunks(sourceChunks, requested);
  const seenKeys = new Set();
  const avoidStems = sanitizeAvoidStems(opts.avoidStems);
  for(const stem of avoidStems){
    const key = normalizedStem(stem);
    if(key) seenKeys.add(key);
  }

  const collected = [];
  let title = '';
  let requestNo = 0;
  let retryCursor = 0;
  const maxInitialAsk = Math.max(...requestPlan.map((entry) => entry.count), 1);
  const maxRequests = requestPlan.length + LARGE_SOURCE_SHORTFALL_RETRY_CAP;

  while(collected.length < requested && requestNo < maxRequests){
    const remaining = requested - collected.length;
    const planned = requestPlan[requestNo];
    const chunk = planned
      ? planned.sourceText
      : sourceChunks[retryCursor++ % sourceChunks.length];
    const ask = planned ? planned.count : Math.min(maxInitialAsk, remaining);
    requestNo += 1;

    let out;
    try{
      out = await postGenerate(topic, ask, { ...opts, sourceText: chunk, avoidStems: avoidStems.slice(-60) });
    }catch(err){
      throw batchFailureError(err, requestNo, collected.length, requested);
    }

    if(!title && out && out.title) title = out.title;
    const accepted = collectUniqueQuizLines(out && out.lines, seenKeys, avoidStems);
    for(const line of accepted){
      if(collected.length >= requested) break;
      collected.push(line);
    }
  }

  if(collected.length !== requested){
    const err = new Error(`Generation returned ${collected.length} of ${requested} usable questions after ${requestNo} batches. Try fewer questions, a smaller source, or retry.`);
    err.name = 'GenerationUnderCount';
    throw err;
  }

  return { lines: collected.join('\n'), title, batched: true };
}

export async function generateWithAI(topic, count, opts = {}){
  const requested = toPositiveCount(count);
  if(shouldUseLargeSourceBatching(requested, opts)){
    return generateLargeSourceWithAI(topic, requested, opts);
  }
  return postGenerate(topic, count, opts);
}
