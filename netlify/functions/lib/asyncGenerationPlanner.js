'use strict';

const { VALID_QUESTION_TYPES } = require('./generationRequest.js');

const GENERATION_BATCH_SIZE = 5;
const TOPIC_ONLY_BATCH_SIZE = GENERATION_BATCH_SIZE;
const SECTION_AWARE_BATCH_SIZE = 5;
const LARGE_SOURCE_MULTI_REQUEST_THRESHOLD = 20000;
const LARGE_SOURCE_CHUNK_TARGET_CHARS = 4000;
const SECTION_QUIZ_WORTHY_MIN_SCORE = 45;
const SECTION_PACKET_TEXT_MAX_CHARS = 2800;
const SECTION_BATCH_SOURCE_TEXT_MAX_CHARS = 3500;
const SECTION_BATCH_EXCERPT_TARGET_CHARS = 520;
const SECTION_BASE_TYPE_SEQUENCE = ['MC', 'TF', 'YN'];
const SECTION_SAFE_FALLBACK_TYPE_SEQUENCE = ['TF', 'MC', 'YN'];
const SECTION_BATCH_HEADING_MAX_CHARS = 180;

function toPositiveCount(value, fallback = 10) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeQuestionTypesForPlanning(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return VALID_QUESTION_TYPES.slice();
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    const type = String(entry || '').trim().toUpperCase();
    if (!VALID_QUESTION_TYPES.includes(type) || seen.has(type)) continue;
    seen.add(type);
    out.push(type);
  }
  return out.length ? out : VALID_QUESTION_TYPES.slice();
}

function sourceChunkBoundary(windowText, target) {
  const minUsefulCut = Math.floor(target * 0.55);
  const paragraphCut = windowText.lastIndexOf('\n\n');
  if (paragraphCut >= minUsefulCut) return paragraphCut;
  const newlineCut = windowText.lastIndexOf('\n');
  if (newlineCut >= minUsefulCut) return newlineCut;
  const sentenceCuts = ['. ', '? ', '! ', '; '].map((needle) => {
    const index = windowText.lastIndexOf(needle);
    return index >= 0 ? index + 1 : -1;
  });
  const sentenceCut = Math.max(...sentenceCuts);
  if (sentenceCut >= minUsefulCut) return sentenceCut;
  return target;
}

function compactInline(raw, maxChars) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  const limit = Math.max(20, parseInt(maxChars, 10) || 80);
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function compactSectionExcerpt(raw, maxChars) {
  const text = String(raw || '').trim().replace(/\r\n?/g, '\n');
  const limit = Math.max(0, parseInt(maxChars, 10) || 0);
  if (!text || limit <= 0) return '';
  if (text.length <= limit) return text;
  const windowText = text.slice(0, limit);
  const cut = sourceChunkBoundary(windowText, limit);
  return text.slice(0, cut).trim().slice(0, limit).trim();
}

function splitSourceTextIntoChunks(sourceText, target = LARGE_SOURCE_CHUNK_TARGET_CHARS) {
  const text = String(sourceText || '').trim();
  const safeTarget = Math.max(1000, parseInt(target, 10) || LARGE_SOURCE_CHUNK_TARGET_CHARS);
  if (!text) return [];
  if (text.length <= safeTarget) return [text];

  const chunks = [];
  let remaining = text;
  while (remaining.length > safeTarget) {
    const windowText = remaining.slice(0, safeTarget);
    const cut = sourceChunkBoundary(windowText, safeTarget);
    const chunk = remaining.slice(0, cut).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function selectSourceChunksForCount(chunks, count) {
  const requested = Math.max(1, toPositiveCount(count));
  if (chunks.length <= requested) return chunks;
  if (requested === 1) return [chunks[Math.floor(chunks.length / 2)]];

  const selected = [];
  const used = new Set();
  for (let i = 0; i < requested; i += 1) {
    const index = Math.round((i * (chunks.length - 1)) / (requested - 1));
    if (used.has(index)) continue;
    used.add(index);
    selected.push(chunks[index]);
  }
  return selected;
}

function distributeQuestionCountAcrossChunks(chunks, count) {
  const requested = Math.max(1, toPositiveCount(count));
  const minimumRequestCount = Math.ceil(requested / SECTION_AWARE_BATCH_SIZE);
  const selectedChunks = selectSourceChunksForCount(chunks, Math.max(1, requested));
  if (!selectedChunks.length) return [];
  const requestCount = Math.max(minimumRequestCount, selectedChunks.length);
  const base = Math.floor(requested / requestCount);
  const extra = requested % requestCount;
  return Array.from({ length: requestCount }, (_, index) => ({
    sourceText: selectedChunks[index % selectedChunks.length],
    count: base + (index < extra ? 1 : 0),
  })).filter((entry) => entry.count > 0);
}

function distributeTopicOnlyQuestionCount(count, batchSize = TOPIC_ONLY_BATCH_SIZE) {
  const requested = Math.max(1, toPositiveCount(count));
  const size = Math.max(1, Math.min(TOPIC_ONLY_BATCH_SIZE, toPositiveCount(batchSize, TOPIC_ONLY_BATCH_SIZE)));
  const plan = [];
  let remaining = requested;
  while (remaining > 0) {
    const ask = Math.min(size, remaining);
    plan.push({ count: ask });
    remaining -= ask;
  }
  return plan;
}

function hasDisqualifyingSectionFlag(section) {
  const flags = Array.isArray(section && section.flags) ? section.flags : [];
  return flags.some((flag) => /^(weak|empty|too-short|placeholder|boilerplate|low-information)$/i.test(String(flag || '')));
}

function sectionSignalCount(section) {
  const reasons = Array.isArray(section && section.reasons) ? section.reasons : [];
  let count = reasons.filter((reason) => /^(bullet-heavy|many-bullets|definitions|terms|commands|code-blocks|cause-effect|comparison|important-keywords|multiple-lists)$/i.test(String(reason || ''))).length;
  if (section && section.definitionSignal) count += 1;
  if (section && section.termSignal) count += 1;
  if (section && section.commandSignal) count += 1;
  if (section && Number(section.bulletCount || 0) >= 3) count += 1;
  if (section && Number(section.codeBlockCount || 0) > 0) count += 1;
  return count;
}

function sectionHasStrongMatchingSignal(section) {
  const reasons = Array.isArray(section && section.reasons)
    ? section.reasons.map((reason) => String(reason || '').toLowerCase())
    : [];
  const hasDefinitionSignal = !!(section && section.definitionSignal) || reasons.includes('definitions');
  const hasTermSignal = !!(section && section.termSignal) || reasons.includes('terms');
  const listLike = Number(section && section.bulletCount || 0) >= 2 || Number(section && section.listCount || 0) >= 1;
  const enoughPairs = listLike || Number(section && section.lineCount || 0) >= 3;
  return hasDefinitionSignal && hasTermSignal && enoughPairs;
}

function normalizeSectionForPlanning(section, index) {
  if (!section || typeof section !== 'object') return null;
  const text = String(section.text || '').trim();
  const score = Number(section.score || 0);
  if (!text || text.length < 80) return null;
  if (score < SECTION_QUIZ_WORTHY_MIN_SCORE) return null;
  if (hasDisqualifyingSectionFlag(section)) return null;
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

function selectUsableSections(sourceReport) {
  const sections = sourceReport && Array.isArray(sourceReport.sections) ? sourceReport.sections : [];
  return sections
    .map((section, index) => normalizeSectionForPlanning(section, index))
    .filter(Boolean)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.signalCount !== a.signalCount) return b.signalCount - a.signalCount;
      if (b.charCount !== a.charCount) return b.charCount - a.charCount;
      return a.originalIndex - b.originalIndex;
    });
}

function trimSectionTextForPacket(raw, maxChars = SECTION_PACKET_TEXT_MAX_CHARS) {
  const text = String(raw || '').trim();
  const safeMax = Math.max(600, parseInt(maxChars, 10) || SECTION_PACKET_TEXT_MAX_CHARS);
  if (text.length <= safeMax) return text;
  const windowText = text.slice(0, safeMax);
  const cut = sourceChunkBoundary(windowText, safeMax);
  return text.slice(0, cut).trim();
}

function buildSectionPacket(section, opts = {}) {
  const sourceName = String(opts.sourceName || '').trim();
  const pathText = section.headingPath.length
    ? section.headingPath.join(' > ')
    : section.heading;
  const lines = [];
  if (sourceName) lines.push(`Source name: ${sourceName}`);
  if (pathText) lines.push(`Heading path: ${pathText}`);
  if (section.heading && section.heading !== pathText) lines.push(`Section heading: ${section.heading}`);
  lines.push('Section content:');
  lines.push(trimSectionTextForPacket(section.text));
  return {
    sectionId: section.id,
    sourceName,
    headingPath: pathText,
    sectionHeading: section.heading || '',
    sectionText: section.text || '',
    sourceText: lines.join('\n').trim(),
  };
}

function sectionPlanningPool(sections, allowedTypes) {
  const baseTypes = SECTION_BASE_TYPE_SEQUENCE.filter((type) => allowedTypes.includes(type));
  if (baseTypes.length) return sections;
  if (allowedTypes.includes('MT')) return sections.filter((section) => section.mtEligible);
  return [];
}

function createSectionTypePlanner(allowedTypes) {
  const baseTypes = SECTION_BASE_TYPE_SEQUENCE.filter((type) => allowedTypes.includes(type));
  const allowMt = allowedTypes.includes('MT');
  let baseCursor = 0;
  let baseSinceMt = 0;
  return (section) => {
    if (!baseTypes.length) return allowMt && section && section.mtEligible ? 'MT' : '';
    if (allowMt && section && section.mtEligible && baseSinceMt >= baseTypes.length) {
      baseSinceMt = 0;
      return 'MT';
    }
    const type = baseTypes[baseCursor % baseTypes.length];
    baseCursor += 1;
    baseSinceMt += 1;
    return type;
  };
}

function buildSectionRequestEntry(section, opts, plannedType) {
  const packet = buildSectionPacket(section, opts);
  return {
    ...packet,
    count: 1,
    plannedType,
    types: [plannedType],
    mtEligible: !!section.mtEligible,
    attemptedTypes: [plannedType],
  };
}

function plannedTypeForEntry(entry) {
  const type = String(entry && (entry.plannedType || (Array.isArray(entry.types) && entry.types[0]) || '')).toUpperCase();
  return VALID_QUESTION_TYPES.includes(type) ? type : '';
}

function fallbackSectionTextFromPacket(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const marker = 'Section content:';
  const index = text.indexOf(marker);
  if (index < 0) return text;
  return text.slice(index + marker.length).trim();
}

function buildSectionBatchSourceText(entries) {
  const plannedEntries = Array.isArray(entries) ? entries.filter(Boolean).slice(0, SECTION_AWARE_BATCH_SIZE) : [];
  if (!plannedEntries.length) return '';
  const sourceName = compactInline(plannedEntries.find((entry) => entry && entry.sourceName)?.sourceName || '', 160);
  const metas = plannedEntries.map((entry, index) => {
    const type = plannedTypeForEntry(entry);
    const headingPath = compactInline(entry && (entry.headingPath || entry.sectionHeading || ''), SECTION_BATCH_HEADING_MAX_CHARS);
    const lines = [`Planned question ${index + 1}${type ? ` type: ${type}` : ''}`];
    if (headingPath) lines.push(`Heading path: ${headingPath}`);
    lines.push('Section excerpt:');
    return {
      lines,
      text: entry && entry.sectionText ? entry.sectionText : fallbackSectionTextFromPacket(entry && entry.sourceText),
    };
  });
  const render = (excerptMax) => {
    const lines = [];
    if (sourceName) lines.push(`Source name: ${sourceName}`);
    metas.forEach((meta, index) => {
      if (index > 0) lines.push('---');
      lines.push(...meta.lines);
      const excerpt = compactSectionExcerpt(meta.text, excerptMax);
      if (excerpt) lines.push(excerpt);
    });
    return lines.join('\n').trim();
  };

  const empty = render(0);
  const available = SECTION_BATCH_SOURCE_TEXT_MAX_CHARS - empty.length - plannedEntries.length;
  let excerptMax = Math.max(0, Math.min(
    SECTION_BATCH_EXCERPT_TARGET_CHARS,
    Math.floor(available / plannedEntries.length)
  ));
  let out = render(excerptMax);
  while (out.length > SECTION_BATCH_SOURCE_TEXT_MAX_CHARS && excerptMax > 0) {
    excerptMax = Math.max(0, excerptMax - 40);
    out = render(excerptMax);
  }
  return out.length > SECTION_BATCH_SOURCE_TEXT_MAX_CHARS
    ? out.slice(0, SECTION_BATCH_SOURCE_TEXT_MAX_CHARS).trim()
    : out;
}

function buildSectionBatchRequestEntry(entries) {
  const plannedEntries = Array.isArray(entries) ? entries.filter(Boolean).slice(0, SECTION_AWARE_BATCH_SIZE) : [];
  if (!plannedEntries.length) return null;
  return {
    count: plannedEntries.length,
    sourceText: buildSectionBatchSourceText(plannedEntries),
    types: plannedEntries.map(plannedTypeForEntry).filter(Boolean),
    plannedEntries,
  };
}

function chunkSectionRequestPlan(plan, batchSize = SECTION_AWARE_BATCH_SIZE) {
  const entries = Array.isArray(plan) ? plan.filter(Boolean) : [];
  const size = Math.max(1, Math.min(SECTION_AWARE_BATCH_SIZE, toPositiveCount(batchSize, SECTION_AWARE_BATCH_SIZE)));
  const chunks = [];
  for (let i = 0; i < entries.length; i += size) {
    const batch = buildSectionBatchRequestEntry(entries.slice(i, i + size));
    if (batch) chunks.push(batch);
  }
  return chunks;
}

function distributeQuestionCountAcrossSections(sections, count, opts = {}) {
  const requested = Math.max(1, toPositiveCount(count));
  if (!Array.isArray(sections) || !sections.length) return { requestPlan: [], retryPackets: [], allowedTypes: [] };
  const allowedTypes = normalizeQuestionTypesForPlanning(opts.types);
  if (!allowedTypes.length) return { requestPlan: [], retryPackets: [], allowedTypes: [] };
  const plannedSections = sectionPlanningPool(sections, allowedTypes);
  if (!plannedSections.length) return { requestPlan: [], retryPackets: [], allowedTypes };
  const chooseType = createSectionTypePlanner(allowedTypes);
  const plan = [];
  for (let index = 0; index < requested; index += 1) {
    const section = plannedSections[index % plannedSections.length];
    const plannedType = chooseType(section);
    if (!plannedType) continue;
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

function buildSectionRequestPlan(opts, count) {
  const sections = selectUsableSections(opts && opts.sourceReport);
  if (!sections.length) return null;
  const distribution = distributeQuestionCountAcrossSections(sections, count, opts);
  const requestPlan = distribution.requestPlan;
  if (!requestPlan.length) return null;
  return {
    requestPlan,
    retryPackets: distribution.retryPackets,
    allowedTypes: distribution.allowedTypes,
  };
}

function makeBatch(entry, index, kind) {
  return {
    batchId: `batch-${index + 1}`,
    batchNo: index + 1,
    kind,
    count: Math.max(1, toPositiveCount(entry.count, 1)),
    sourceText: String(entry.sourceText || '').trim(),
    types: Array.isArray(entry.types) && entry.types.length ? entry.types : undefined,
    plannedEntries: Array.isArray(entry.plannedEntries) ? entry.plannedEntries : undefined,
  };
}

function buildPlannedBatches(request = {}) {
  const requested = Math.max(1, toPositiveCount(request.count || request.requestedCount, 10));
  const sourceText = String(request.sourceText || '').trim();
  const opts = {
    sourceText,
    sourceName: request.sourceName || '',
    sourceReport: request.sourceReport || null,
    types: request.types,
  };

  if (sourceText) {
    const sectionPlan = buildSectionRequestPlan(opts, requested);
    if (sectionPlan) {
      return chunkSectionRequestPlan(sectionPlan.requestPlan)
        .map((entry, index) => makeBatch(entry, index, 'section'));
    }
    const chunks = splitSourceTextIntoChunks(sourceText);
    return distributeQuestionCountAcrossChunks(chunks, requested)
      .map((entry, index) => makeBatch(entry, index, 'source-chunk'));
  }

  return distributeTopicOnlyQuestionCount(requested)
    .map((entry, index) => makeBatch(entry, index, 'topic'));
}

function shouldPlanAsAsyncSource(request = {}) {
  const sourceText = String(request.sourceText || '').trim();
  if (!sourceText) return false;
  const count = Math.max(1, toPositiveCount(request.count || request.requestedCount, 10));
  const report = request.sourceReport || {};
  const sections = Number(report.sectionCount || (Array.isArray(report.sections) ? report.sections.length : 0) || 0);
  return sourceText.length >= LARGE_SOURCE_MULTI_REQUEST_THRESHOLD
    || sections >= 50
    || (count >= 30 && sourceText.length >= 10000);
}

module.exports = {
  GENERATION_BATCH_SIZE,
  LARGE_SOURCE_CHUNK_TARGET_CHARS,
  LARGE_SOURCE_MULTI_REQUEST_THRESHOLD,
  SECTION_AWARE_BATCH_SIZE,
  SECTION_BATCH_SOURCE_TEXT_MAX_CHARS,
  SECTION_PACKET_TEXT_MAX_CHARS,
  TOPIC_ONLY_BATCH_SIZE,
  buildPlannedBatches,
  buildSectionBatchSourceText,
  buildSectionRequestPlan,
  shouldPlanAsAsyncSource,
  splitSourceTextIntoChunks,
};
