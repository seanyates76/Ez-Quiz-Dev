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
export const GENERATION_BATCH_SIZE = 5;
export const TOPIC_ONLY_BATCH_SIZE = GENERATION_BATCH_SIZE;
export const LARGE_SOURCE_CHUNK_TARGET_CHARS = 4000;
export const SECTION_QUIZ_WORTHY_MIN_SCORE = 45;
export const SECTION_PACKET_TEXT_MAX_CHARS = 2800;
const LARGE_SOURCE_SHORTFALL_RETRY_CAP = 2;
const TOPIC_ONLY_SHORTFALL_RETRY_CAP = 2;
const PARTIAL_RESULT_MIN_QUESTIONS = 1;
const SECTION_REQUEST_QUESTION_COUNT = 1;
const VALID_QUESTION_TYPES = ['MC', 'TF', 'YN', 'MT'];
const SECTION_BASE_TYPE_SEQUENCE = ['MC', 'TF', 'YN'];
const SECTION_SAFE_FALLBACK_TYPE_SEQUENCE = ['TF', 'MC', 'YN'];

function toPositiveCount(value, fallback = 10){
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeQuestionTypesForPlanning(raw){
  if(!Array.isArray(raw) || raw.length === 0) return VALID_QUESTION_TYPES.slice();
  const out = [];
  const seen = new Set();
  for(const entry of raw){
    const type = String(entry || '').trim().toUpperCase();
    if(!VALID_QUESTION_TYPES.includes(type) || seen.has(type)) continue;
    seen.add(type);
    out.push(type);
  }
  return out;
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
  const sourceText = opts && typeof opts.sourceText === 'string' ? opts.sourceText.trim() : '';
  if(!sourceText) return false;
  return count > GENERATION_BATCH_SIZE || sourceText.length >= LARGE_SOURCE_MULTI_REQUEST_THRESHOLD;
}

function shouldUseTopicOnlyBatching(count, opts){
  const sourceText = opts && typeof opts.sourceText === 'string' ? opts.sourceText.trim() : '';
  return !sourceText && count > GENERATION_BATCH_SIZE;
}

function stripClientOnlyOptions(opts = {}){
  const { sourceReport, signal, ...safe } = opts || {};
  return safe;
}

function generationAbortError(){
  try {
    return new DOMException('Aborted', 'AbortError');
  } catch {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    return err;
  }
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
  const minimumRequestCount = Math.ceil(requested / GENERATION_BATCH_SIZE);
  const selectedChunks = selectSourceChunksForCount(chunks, Math.max(1, requested));
  if(!selectedChunks.length) return [];
  const requestCount = Math.max(minimumRequestCount, selectedChunks.length);
  const base = Math.floor(requested / requestCount);
  const extra = requested % requestCount;
  return Array.from({ length: requestCount }, (_, index) => ({
    sourceText: selectedChunks[index % selectedChunks.length],
    count: base + (index < extra ? 1 : 0),
  })).filter((entry) => entry.count > 0);
}

function distributeTopicOnlyQuestionCount(count, batchSize = TOPIC_ONLY_BATCH_SIZE){
  const requested = Math.max(1, toPositiveCount(count));
  const size = Math.max(1, Math.min(TOPIC_ONLY_BATCH_SIZE, toPositiveCount(batchSize, TOPIC_ONLY_BATCH_SIZE)));
  const plan = [];
  let remaining = requested;
  while(remaining > 0){
    const ask = Math.min(size, remaining);
    plan.push({ count: ask });
    remaining -= ask;
  }
  return plan;
}

function hasDisqualifyingSectionFlag(section){
  const flags = Array.isArray(section && section.flags) ? section.flags : [];
  return flags.some((flag) => /^(weak|empty|too-short|placeholder|boilerplate|low-information)$/i.test(String(flag || '')));
}

function sectionSignalCount(section){
  const reasons = Array.isArray(section && section.reasons) ? section.reasons : [];
  let count = reasons.filter((reason) => /^(bullet-heavy|many-bullets|definitions|terms|commands|code-blocks|cause-effect|comparison|important-keywords|multiple-lists)$/i.test(String(reason || ''))).length;
  if(section && section.definitionSignal) count += 1;
  if(section && section.termSignal) count += 1;
  if(section && section.commandSignal) count += 1;
  if(section && Number(section.bulletCount || 0) >= 3) count += 1;
  if(section && Number(section.codeBlockCount || 0) > 0) count += 1;
  return count;
}

function sectionHasStrongMatchingSignal(section){
  const reasons = Array.isArray(section && section.reasons)
    ? section.reasons.map((reason) => String(reason || '').toLowerCase())
    : [];
  const hasDefinitionSignal = !!(section && section.definitionSignal) || reasons.includes('definitions');
  const hasTermSignal = !!(section && section.termSignal) || reasons.includes('terms');
  const listLike = Number(section && section.bulletCount || 0) >= 2 || Number(section && section.listCount || 0) >= 1;
  const enoughPairs = listLike || Number(section && section.lineCount || 0) >= 3;
  return hasDefinitionSignal && hasTermSignal && enoughPairs;
}

function normalizeSectionForPlanning(section, index){
  if(!section || typeof section !== 'object') return null;
  const text = String(section.text || '').trim();
  const score = Number(section.score || 0);
  if(!text || text.length < 80) return null;
  if(score < SECTION_QUIZ_WORTHY_MIN_SCORE) return null;
  if(hasDisqualifyingSectionFlag(section)) return null;
  const id = String(section.id || `section-${index + 1}`).trim() || `section-${index + 1}`;
  const heading = String(section.heading || '').trim();
  const headingPath = Array.isArray(section.headingPath)
    ? section.headingPath.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  return {
    id,
    heading,
    headingPath,
    text,
    score,
    signalCount: sectionSignalCount(section),
    charCount: Number(section.charCount || text.length) || text.length,
    originalIndex: index,
    mtEligible: sectionHasStrongMatchingSignal(section),
  };
}

function selectUsableSections(sourceReport){
  const sections = sourceReport && Array.isArray(sourceReport.sections) ? sourceReport.sections : [];
  return sections
    .map((section, index) => normalizeSectionForPlanning(section, index))
    .filter(Boolean)
    .sort((a, b) => {
      if(b.score !== a.score) return b.score - a.score;
      if(b.signalCount !== a.signalCount) return b.signalCount - a.signalCount;
      if(b.charCount !== a.charCount) return b.charCount - a.charCount;
      return a.originalIndex - b.originalIndex;
    });
}

function trimSectionTextForPacket(raw, maxChars = SECTION_PACKET_TEXT_MAX_CHARS){
  const text = String(raw || '').trim();
  const safeMax = Math.max(600, parseInt(maxChars, 10) || SECTION_PACKET_TEXT_MAX_CHARS);
  if(text.length <= safeMax) return text;
  const windowText = text.slice(0, safeMax);
  const cut = sourceChunkBoundary(windowText, safeMax);
  return text.slice(0, cut).trim();
}

function buildSectionPacket(section, opts = {}){
  const sourceName = String(opts.sourceName || '').trim();
  const path = section.headingPath.length
    ? section.headingPath.join(' > ')
    : section.heading;
  const lines = [];
  if(sourceName) lines.push(`Source name: ${sourceName}`);
  if(path) lines.push(`Heading path: ${path}`);
  if(section.heading && section.heading !== path) lines.push(`Section heading: ${section.heading}`);
  lines.push('Section content:');
  lines.push(trimSectionTextForPacket(section.text));
  return {
    sectionId: section.id,
    sourceText: lines.join('\n').trim(),
  };
}

function sectionPlanningPool(sections, allowedTypes){
  const baseTypes = SECTION_BASE_TYPE_SEQUENCE.filter((type) => allowedTypes.includes(type));
  if(baseTypes.length) return sections;
  if(allowedTypes.includes('MT')) return sections.filter((section) => section.mtEligible);
  return [];
}

function createSectionTypePlanner(allowedTypes){
  const baseTypes = SECTION_BASE_TYPE_SEQUENCE.filter((type) => allowedTypes.includes(type));
  const allowMt = allowedTypes.includes('MT');
  let baseCursor = 0;
  let baseSinceMt = 0;
  return (section) => {
    if(!baseTypes.length){
      return allowMt && section && section.mtEligible ? 'MT' : '';
    }
    if(allowMt && section && section.mtEligible && baseSinceMt >= baseTypes.length){
      baseSinceMt = 0;
      return 'MT';
    }
    const type = baseTypes[baseCursor % baseTypes.length];
    baseCursor += 1;
    baseSinceMt += 1;
    return type;
  };
}

function buildSectionRequestEntry(section, opts, plannedType){
  const packet = buildSectionPacket(section, opts);
  return {
    ...packet,
    count: SECTION_REQUEST_QUESTION_COUNT,
    plannedType,
    types: [plannedType],
    mtEligible: !!section.mtEligible,
    attemptedTypes: [plannedType],
  };
}

function distributeQuestionCountAcrossSections(sections, count, opts = {}){
  const requested = Math.max(1, toPositiveCount(count));
  if(!Array.isArray(sections) || !sections.length) return { requestPlan: [], retryPackets: [], allowedTypes: [] };
  const allowedTypes = normalizeQuestionTypesForPlanning(opts.types);
  if(!allowedTypes.length) return { requestPlan: [], retryPackets: [], allowedTypes: [] };
  const plannedSections = sectionPlanningPool(sections, allowedTypes);
  if(!plannedSections.length) return { requestPlan: [], retryPackets: [], allowedTypes };
  const chooseType = createSectionTypePlanner(allowedTypes);
  const plan = [];
  for(let index = 0; index < requested; index += 1){
    const section = plannedSections[index % plannedSections.length];
    const plannedType = chooseType(section);
    if(!plannedType) continue;
    plan.push(buildSectionRequestEntry(section, opts, plannedType));
  }
  return {
    requestPlan: plan,
    retryPackets: plannedSections.map((section) => ({
      ...buildSectionPacket(section, opts),
      mtEligible: !!section.mtEligible,
    })),
    allowedTypes,
  };
}

function buildSectionRequestPlan(opts, count){
  const sections = selectUsableSections(opts && opts.sourceReport);
  if(!sections.length) return null;
  const distribution = distributeQuestionCountAcrossSections(sections, count, opts);
  const requestPlan = distribution.requestPlan;
  if(!requestPlan.length) return null;
  return {
    requestPlan,
    retryPackets: distribution.retryPackets,
    allowedTypes: distribution.allowedTypes,
  };
}

function sectionFallbackTypeOrder(allowedTypes, packet){
  const safeTypes = SECTION_SAFE_FALLBACK_TYPE_SEQUENCE.filter((type) => allowedTypes.includes(type));
  if(safeTypes.length) return safeTypes;
  if(allowedTypes.includes('MT') && packet && packet.mtEligible) return ['MT'];
  return [];
}

function sameSectionRetryPacket(entry, sectionPlan){
  const retryPackets = Array.isArray(sectionPlan && sectionPlan.retryPackets) ? sectionPlan.retryPackets : [];
  return retryPackets.find((packet) => packet && packet.sectionId === entry.sectionId) || null;
}

function buildSectionZeroLineRetry(entry, sectionPlan){
  const packet = sameSectionRetryPacket(entry, sectionPlan) || entry;
  if(!packet || !packet.sourceText) return null;
  const allowedTypes = Array.isArray(sectionPlan && sectionPlan.allowedTypes) ? sectionPlan.allowedTypes : [];
  const attemptedTypes = Array.isArray(entry && entry.attemptedTypes)
    ? entry.attemptedTypes.map((type) => String(type || '').toUpperCase()).filter(Boolean)
    : [];
  const order = sectionFallbackTypeOrder(allowedTypes, packet);
  if(!order.length) return null;
  const nextType = order.find((type) => !attemptedTypes.includes(type))
    || (order.length === 1 && attemptedTypes.length < 2 ? order[0] : '');
  if(!nextType) return null;
  return {
    ...packet,
    count: SECTION_REQUEST_QUESTION_COUNT,
    plannedType: nextType,
    types: [nextType],
    attemptedTypes: Array.from(new Set([...attemptedTypes, nextType])),
    retryOfSectionId: entry && entry.sectionId || packet.sectionId,
  };
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

function isZeroQuestionUnderCountError(err, expected){
  const detail = readableGenerationError(err);
  const match = String(detail || '').match(/Only generated\s+0\s+of\s+(\d+)\s+requested questions/i);
  return !!(match && Number(match[1]) === Number(expected));
}

async function postGenerate(topic, count, opts = {}){
  const upstreamSignal = opts && opts.signal;
  const requestOpts = stripClientOnlyOptions(opts);
  const payload = JSON.stringify({ topic, count, ...requestOpts });
  const attemptErrors = [];
  const hasSourceText = !!String(requestOpts && requestOpts.sourceText || '').trim();
  const endpointCandidates = hasSourceText
    ? API_ENDPOINT_CANDIDATES.filter((spec) => spec.allowSourceFallback)
    : API_ENDPOINT_CANDIDATES;

  for (let i = 0; i < endpointCandidates.length; i++) {
    const { url: endpoint, allow404Fallback } = endpointCandidates[i];
    if(upstreamSignal && upstreamSignal.aborted) throw generationAbortError();
    const controller = new AbortController();
    let timedOut = false;
    const onUpstreamAbort = () => {
      try{ controller.abort(); }catch{}
    };
    if(upstreamSignal){
      upstreamSignal.addEventListener('abort', onUpstreamAbort, { once: true });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 45000);
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
      const out = { lines: String(data.lines || '').trim(), title: String(data.title || '') };
      if(data && data.partial) out.partial = true;
      if(data && Number.isFinite(Number(data.completedCount))) out.completedCount = Number(data.completedCount);
      if(data && Number.isFinite(Number(data.requestedCount))) out.requestedCount = Number(data.requestedCount);
      if(data && data.warning) out.warning = String(data.warning);
      return out;
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      attemptErrors.push({ endpoint, error: message });
      if (err && err.__ezStopFallback) {
        throw err;
      }
      if (err && err.name === 'AbortError') {
        if(upstreamSignal && upstreamSignal.aborted && !timedOut) {
          throw err;
        }
        const timeout = new Error('Generation timed out locally. Try fewer questions or retry.');
        timeout.name = 'GenerationTimeout';
        throw timeout;
      }
    } finally {
      clearTimeout(timer);
      if(upstreamSignal){
        try{ upstreamSignal.removeEventListener('abort', onUpstreamAbort); }catch{}
      }
    }
  }

  throw new Error(JSON.stringify({ error: 'All API endpoints failed', attempts: attemptErrors }));
}

function createCollectionState(opts = {}){
  const seenKeys = new Set();
  const avoidStems = sanitizeAvoidStems(opts.avoidStems);
  for(const stem of avoidStems){
    const key = normalizedStem(stem);
    if(key) seenKeys.add(key);
  }
  return { seenKeys, avoidStems };
}

function generationUnderCountError(completed, requested, requestNo){
  const err = new Error(`Generation returned ${completed} of ${requested} usable questions after ${requestNo} batches. Try fewer questions, a smaller source, or retry.`);
  err.name = 'GenerationUnderCount';
  return err;
}

function partialGenerationResult(collected, title, requested, requestNo){
  if(collected.length < Math.min(PARTIAL_RESULT_MIN_QUESTIONS, requested)) return null;
  return {
    lines: collected.join('\n'),
    title,
    batched: true,
    partial: true,
    completedCount: collected.length,
    requestedCount: requested,
    failedBatch: requestNo,
    warning: `Quiz ready with ${collected.length} of ${requested} questions.`,
  };
}

async function generateSectionLargeSourceWithAI(topic, requested, opts, sectionPlan){
  const { seenKeys, avoidStems } = createCollectionState(opts);
  const pending = sectionPlan.requestPlan.slice();
  const collected = [];
  let title = '';
  let requestNo = 0;
  const maxRequests = sectionPlan.requestPlan.length + Math.max(LARGE_SOURCE_SHORTFALL_RETRY_CAP, requested);

  while(collected.length < requested && pending.length && requestNo < maxRequests){
    const planned = pending.shift();
    const ask = Math.min(SECTION_REQUEST_QUESTION_COUNT, requested - collected.length);
    requestNo += 1;

    let out;
    try{
      out = await postGenerate(topic, ask, {
        ...opts,
        sourceText: planned.sourceText,
        types: planned.types,
        avoidStems: avoidStems.slice(-60),
      });
    }catch(err){
      const retry = isZeroQuestionUnderCountError(err, ask)
        ? buildSectionZeroLineRetry(planned, sectionPlan)
        : null;
      if(retry){
        pending.unshift(retry);
        continue;
      }
      const partial = partialGenerationResult(collected, title, requested, requestNo);
      if(partial) return partial;
      throw batchFailureError(err, requestNo, collected.length, requested);
    }

    if(!title && out && out.title) title = out.title;
    const beforeCount = collected.length;
    const accepted = collectUniqueQuizLines(out && out.lines, seenKeys, avoidStems);
    for(const line of accepted){
      if(collected.length >= requested) break;
      collected.push(line);
    }

    if(collected.length === beforeCount){
      const retry = buildSectionZeroLineRetry(planned, sectionPlan);
      if(retry) pending.unshift(retry);
    }
  }

  if(collected.length !== requested){
    const partial = partialGenerationResult(collected, title, requested, requestNo);
    if(partial) return partial;
    throw generationUnderCountError(collected.length, requested, requestNo);
  }

  return { lines: collected.join('\n'), title, batched: true };
}

async function generateChunkedLargeSourceWithAI(topic, requested, opts = {}){
  const sourceChunks = splitSourceTextIntoChunks(opts.sourceText);
  const requestPlan = distributeQuestionCountAcrossChunks(sourceChunks, requested);
  const { seenKeys, avoidStems } = createCollectionState(opts);

  const collected = [];
  let title = '';
  let requestNo = 0;
  let retryCursor = 0;
  const maxInitialAsk = Math.max(...requestPlan.map((entry) => entry.count), 1);
  const maxRequests = requestPlan.length + LARGE_SOURCE_SHORTFALL_RETRY_CAP;

  while(collected.length < requested && requestNo < maxRequests){
    const remaining = requested - collected.length;
    const planned = requestPlan[requestNo];
    let sourceText;
    let ask;
    if(planned){
      sourceText = planned.sourceText;
      ask = planned.count;
    } else {
      sourceText = sourceChunks[retryCursor++ % sourceChunks.length];
      ask = Math.min(maxInitialAsk, remaining);
    }
    requestNo += 1;

    let out;
    try{
      out = await postGenerate(topic, ask, { ...opts, sourceText, avoidStems: avoidStems.slice(-60) });
    }catch(err){
      const partial = partialGenerationResult(collected, title, requested, requestNo);
      if(partial) return partial;
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
    const partial = partialGenerationResult(collected, title, requested, requestNo);
    if(partial) return partial;
    throw generationUnderCountError(collected.length, requested, requestNo);
  }

  return { lines: collected.join('\n'), title, batched: true };
}

async function generateLargeSourceWithAI(topic, count, opts = {}){
  const requested = toPositiveCount(count);
  const sectionPlan = buildSectionRequestPlan(opts, requested);
  if(sectionPlan){
    return generateSectionLargeSourceWithAI(topic, requested, opts, sectionPlan);
  }
  return generateChunkedLargeSourceWithAI(topic, requested, opts);
}

async function generateTopicOnlyWithAI(topic, count, opts = {}){
  const requested = toPositiveCount(count);
  const requestPlan = distributeTopicOnlyQuestionCount(requested);
  const { seenKeys, avoidStems } = createCollectionState(opts);
  const collected = [];
  let title = '';
  let requestNo = 0;
  const maxRequests = requestPlan.length + TOPIC_ONLY_SHORTFALL_RETRY_CAP;

  while(collected.length < requested && requestNo < maxRequests){
    const remaining = requested - collected.length;
    const planned = requestPlan[requestNo];
    const ask = planned ? planned.count : Math.min(TOPIC_ONLY_BATCH_SIZE, remaining);
    requestNo += 1;

    let out;
    try{
      out = await postGenerate(topic, ask, { ...opts, avoidStems: avoidStems.slice(-60) });
    }catch(err){
      const partial = partialGenerationResult(collected, title, requested, requestNo);
      if(partial) return partial;
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
    const partial = partialGenerationResult(collected, title, requested, requestNo);
    if(partial) return partial;
    throw generationUnderCountError(collected.length, requested, requestNo);
  }

  return { lines: collected.join('\n'), title, batched: true };
}

export async function generateWithAI(topic, count, opts = {}){
  const requested = toPositiveCount(count);
  if(shouldUseLargeSourceBatching(requested, opts)){
    return generateLargeSourceWithAI(topic, requested, opts);
  }
  if(shouldUseTopicOnlyBatching(requested, opts)){
    return generateTopicOnlyWithAI(topic, requested, opts);
  }
  return postGenerate(topic, count, opts);
}
